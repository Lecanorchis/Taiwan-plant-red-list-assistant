import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { queryTbn } from '../skills/taiwan-plant-red-list/scripts/occurrences.mjs';
import { gridRange, project } from '../skills/taiwan-plant-red-list/scripts/range.mjs';

const cli = fileURLToPath(new URL('../skills/taiwan-plant-red-list/scripts/redlist.mjs', import.meta.url));
const uuid = '11111111-2222-4333-8444-555555555555';

test('清單只評估末端，觀測需人工篩選，草稿保留證據缺口', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redlist-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, RED_LIST_WORKSPACE: root }, encoding: 'utf8',
  });
  const json = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  const write = (path, data) => writeFileSync(path, JSON.stringify(data));
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const scope = '合成範例區域';
  const id = 'sample-variety';
  json('init', scope);
  const list = join(root, 'list.json');
  write(list, [
    { id, scientificName: 'Exemplaria montana var. parva', rank: 'variety', parentId: 'sample' },
    { id: 'sample', scientificName: 'Exemplaria montana', rank: 'species' },
  ]);
  assert.equal(json('add', list).created.length, 2);
  assert.equal(json('add', list).skipped, 2);
  assert.equal(json('list').find((item) => item.id === 'sample').leaf, false);
  assert.equal(run('report', 'sample').status, 1);
  const assessmentPath = join(root, 'taxa', `${id}.json`);
  const assessment = read(assessmentPath);
  Object.assign(assessment.taxon, { confirmed: true, tbnUuid: uuid, authority: '合成分類來源' });
  write(assessmentPath, assessment);

  const record = {
    occurrenceID: 'fake-1', taxonUUID: uuid, dataGeneralizations: false, geodeticDatum: 'WGS84',
    decimalLatitude: '23.5', decimalLongitude: '121.2', coordinateUncertaintyInMeters: '30',
    degreeOfEstablishment: '野生', year: 2026,
  };
  const snapshotPath = join(root, 'snapshot.json');
  const snapshot = {
    id: 'tbn-fixture', version: 1, provider: 'tbn', taxonId: id, taxonUuid: uuid, truncated: true,
    pages: [{ response: { data: [record, { ...record, occurrenceID: 'fake-2', dataGeneralizations: true }] } }],
  };
  write(snapshotPath, snapshot);
  const reviewPath = json('review', id, snapshotPath).path;
  const review = read(reviewPath);
  assert.deepEqual(review.decisions.map((item) => item.decision), ['pending', 'pending']);
  review.reviewer = '測試';
  for (const item of review.decisions) Object.assign(item, { decision: 'include', rationale: '合成範例' });
  write(reviewPath, review);
  assert.match(run('range', id, snapshotPath, reviewPath).stderr, /generalized-or-unknown/);
  review.decisions[1].decision = 'exclude';
  write(reviewPath, review);
  const result = json('range', id, snapshotPath, reviewPath);
  assert.deepEqual(result.counts, { include: 1, exclude: 1, pending: 0 });
  assert.equal(result.aooKm2, 4);
  assert.equal(result.eooKm2, null);
  assert.equal(result.truncated, true);
  assert.match(readFileSync(join(result.dir, 'map.svg'), 'utf8'), /<title>fake-1<\/title>/);
  write(snapshotPath, { ...snapshot, truncated: false });
  assert.match(run('range', id, snapshotPath, reviewPath).stderr, /內容與篩選表不符/);

  const report = json('report', id);
  assert.equal(report.ready, false);
  assert.equal(json('report', id).path, report.path);
  assert.match(readFileSync(report.path, 'utf8'), /工作草稿[\s\S]*區外族群查核/);
  assert.equal(run('validate', id).status, 1);

  assessment.evidence.push({ id: 'e1', citation: '合成來源', locator: '合成表', finding: '只出現於栽培地' });
  assessment.eligibility = { status: 'not-applicable', rationale: '合成栽培案例', evidence: ['e1'] };
  assessment.regional = { outcome: 'not-applicable', category: 'NA', rationale: '未見野生族群', evidence: ['e1'] };
  assessment.uncertainties.push('野生狀態有待後續調查');
  assessment.reviewer = { name: '測試', date: '2026-11-10' };
  write(assessmentPath, assessment);
  assert.equal(json('validate', id).ready, true);
  const reviewed = json('report', id);
  assert.notEqual(reviewed.path, report.path);
  assert.match(readFileSync(reviewed.path, 'utf8'), /個人審閱版[\s\S]*區域評估 · NA/);
});

test('TBN 分頁保留分類群條件，並標記頁數截斷', async () => {
  const next = `https://www.tbn.org.tw/api/v26/occurrence?taxonuuid=${uuid}&limit=1&minID=100`;
  const requested = [];
  const fetchPage = async (url) => {
    requested.push(url.href);
    return Response.json({ meta: { status: 'SUCCESS', total: 2 }, links: { next: requested.length === 1 ? next : '' }, data: [{}] });
  };
  const params = { taxonUUID: uuid, limit: '1' };
  const partial = await queryTbn('occurrence', params, 1, fetchPage);
  assert.equal(partial.truncated, true);
  requested.length = 0;
  const complete = await queryTbn('occurrence', params, 2, fetchPage);
  assert.equal(complete.truncated, false);
  assert.equal(requested[1], next);
  await assert.rejects(queryTbn('occurrence', params, 2, async () => Response.json({
    meta: { status: 'SUCCESS', total: 2 }, links: { next: next.replace(uuid, 'other') }, data: [{}],
  })), /改變了查詢參數/);
});

test('投影與空間計算保留退化凸包及 2 公里格網', () => {
  const [x, y] = project({ lon: 120, lat: 30 });
  assert.ok(Math.abs(x - 11578353.6301) < 0.01);
  assert.ok(Math.abs(y - 3658789.3249) < 0.01);
  assert.equal(gridRange([]).metrics.aooKm2, null);
  const points = [{ lon: 120, lat: 23 }, { lon: 120.001, lat: 23 }, { lon: 120, lat: 23.001 }];
  const { metrics } = gridRange(points);
  assert.ok(metrics.eooHullKm2 > 0 && metrics.eooHullKm2 < 1);
  assert.equal(metrics.aooKm2, 4);
  assert.equal(metrics.eooKm2, 4);
});
