import { randomUUID } from 'node:crypto';
import { isText, isUuid } from './workspace.mjs';
import { isGbifKey } from './gbif.mjs';

const api = 'https://www.tbn.org.tw/api/v26/';

export async function queryTbn(endpoint, params, maxPages, fetchPage = fetch) {
  const initial = new URL(endpoint, api);
  initial.search = new URLSearchParams(params);
  let current = initial.href;
  const pages = [];
  const visited = new Set();
  while (current && pages.length < maxPages) {
    const url = new URL(current, initial);
    if (url.origin !== initial.origin || url.pathname !== initial.pathname
        || url.username || url.password || url.hash || visited.has(url.href)) {
      throw new Error('TBN 分頁連結無效或重複。');
    }
    const nextParams = new Map([...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]));
    for (const [key, value] of initial.searchParams) {
      if (nextParams.get(key.toLowerCase()) !== value) throw new Error(`TBN 分頁改變了查詢參數 ${key}。`);
    }
    visited.add(url.href);
    const response = await fetchPage(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`TBN ${endpoint} HTTP ${response.status}。`);
    const page = await response.json();
    if (page?.meta?.status !== 'SUCCESS' || !Array.isArray(page.data) || !page.links
        || (page.links.next != null && typeof page.links.next !== 'string')) {
      throw new Error('TBN 回應格式不符，請檢查 API 規格。');
    }
    pages.push({ request: url.href, response: page });
    current = page.links.next;
  }
  const records = pages.flatMap((page) => page.response.data);
  const total = pages[0].response.meta.total;
  return {
    url: initial.href, retrievedAt: new Date().toISOString(), pages, records,
    reportedTotal: Number.isSafeInteger(total) ? total : null,
    truncated: Boolean(current) || (Number.isSafeInteger(total) && total > records.length),
  };
}

export async function findTaxon(name) {
  if (!isText(name)) throw new Error('請輸入中文名或學名。');
  const query = await queryTbn('taxon', { name: name.trim(), withChildren: '1' }, 1);
  const vascular = new Set(['石松類', '裸子植物', '被子植物', '蕨類']);
  const candidates = query.records.filter((row) => vascular.has(row.taxonGroup));
  return { url: query.url, retrievedAt: query.retrievedAt, truncated: query.truncated, candidates };
}

export async function getOccurrences(taxon, maxPages) {
  if (taxon.confirmed !== true || !isUuid(taxon.tbnUuid)) throw new Error('請先確認分類群與 TBN taxonUUID。');
  const query = await queryTbn('occurrence', { taxonUUID: taxon.tbnUuid, limit: '200' }, maxPages);
  return {
    version: 1, id: `tbn-${randomUUID()}`, taxonId: taxon.id, taxonUuid: taxon.tbnUuid,
    source: 'TBN Open API v26', provider: 'tbn', ...query, records: undefined,
  };
}

function decimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function screen(snapshot) {
  const seen = new Set();
  const duplicates = new Set();
  const rows = [];
  const gbif = snapshot.provider === 'gbif';
  const records = snapshot.pages.flatMap((page) => gbif ? page.response.results : page.response.data);
  for (const row of records) {
    const id = gbif && isGbifKey(row.key) ? String(row.key) : row.occurrenceID;
    if (!isText(id)) throw new Error('觀測紀錄缺少識別碼，無法建立可追溯篩選表。');
    if (seen.has(id)) {
      duplicates.add(id);
      continue;
    }
    seen.add(id);
    const lat = decimal(row.decimalLatitude);
    const lon = decimal(row.decimalLongitude);
    const uncertaintyM = decimal(row.coordinateUncertaintyInMeters);
    const flags = [];
    if (gbif) {
      if ((row.acceptedTaxonKey ?? row.taxonKey) !== snapshot.taxonKey) flags.push('taxon-mismatch');
      if (row.dataGeneralizations || row.informationWithheld) flags.push('generalized-or-unknown');
      if (row.countryCode !== 'TW' || row.issues?.some((issue) => ['COUNTRY_COORDINATE_MISMATCH', 'COORDINATE_INVALID', 'ZERO_COORDINATE', 'COORDINATE_OUT_OF_RANGE', 'GEODETIC_DATUM_INVALID', 'GEODETIC_DATUM_ASSUMED_WGS84'].includes(issue))) {
        flags.push('coordinate-needs-review');
      }
      if (row.occurrenceStatus !== 'PRESENT') flags.push('presence-unverified');
    } else {
      if (String(row.taxonUUID).toLowerCase() !== snapshot.taxonUuid.toLowerCase()) flags.push('taxon-mismatch');
      if (row.dataGeneralizations !== false || [row.dataSensitiveCategory, row.sensitiveCategory]
        .some((category) => category && category !== '無')) flags.push('generalized-or-unknown');
      if (row.geodeticDatum !== 'WGS84') flags.push('datum-unverified');
    }
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) flags.push('invalid-coordinate');
    if (uncertaintyM === null || uncertaintyM <= 0) flags.push('uncertainty-needs-review');
    if (uncertaintyM >= 2000) flags.push('coarse-coordinate');
    if (gbif ? row.establishmentMeans !== 'NATIVE' : (row.degreeOfEstablishment ?? row.establishmentMeans) !== '野生') flags.push('wild-status-needs-review');
    if (!row.year) flags.push('date-unknown');
    rows.push({ id, lat, lon, uncertaintyM, flags, row });
  }
  for (const record of rows) if (duplicates.has(record.id)) record.flags.push('duplicate-id');
  return rows;
}

export function reviewTemplate(snapshot, scope) {
  const gbif = snapshot.provider === 'gbif';
  return {
    version: 1, snapshotId: snapshot.id, scope, reviewer: '',
    decisions: screen(snapshot).map(({ id, lat, lon, uncertaintyM, flags, row }) => ({
      id, decision: 'pending', rationale: '',
      context: {
        lat, lon, uncertaintyM, flags, year: row.year, county: row.county ?? row.stateProvince,
        dataset: row.datasetName ?? row.datasetKey, license: row.license,
        source: gbif ? `https://www.gbif.org/occurrence/${id}` : row.source,
      },
    })),
  };
}

export function reviewedPoints(snapshot, review, scope) {
  if (review.version !== 1 || review.snapshotId !== snapshot.id || review.scope !== scope || !isText(review.reviewer)
      || !Array.isArray(review.decisions)) throw new Error('篩選表需對應此快照與評估區域，並填寫審閱者。');
  const decisions = new Map();
  for (const entry of review.decisions) {
    if (decisions.has(entry.id) || !['include', 'exclude', 'pending'].includes(entry.decision)
        || (entry.decision !== 'pending' && !isText(entry.rationale))) {
      throw new Error(`紀錄 ${entry.id} 的決策重複、無效或缺少理由。`);
    }
    decisions.set(entry.id, entry.decision);
  }
  const counts = { include: 0, exclude: 0, pending: 0 };
  const points = [];
  for (const record of screen(snapshot)) {
    const decision = decisions.get(record.id) ?? 'pending';
    decisions.delete(record.id);
    counts[decision]++;
    if (decision !== 'include') continue;
    const blocking = ['taxon-mismatch', 'generalized-or-unknown', 'datum-unverified', 'invalid-coordinate', 'coarse-coordinate', 'presence-unverified', 'duplicate-id'];
    if (record.flags.some((flag) => blocking.includes(flag))) {
      throw new Error(`紀錄 ${record.id} 有無法納入的座標或分類問題 ${record.flags.join(', ')}。`);
    }
    points.push({ id: record.id, lon: record.lon, lat: record.lat });
  }
  if (decisions.size) throw new Error('篩選表含快照中不存在的紀錄。');
  return { points, counts };
}
