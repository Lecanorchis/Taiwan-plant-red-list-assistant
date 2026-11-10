import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const criteria = ['A', 'B', 'C', 'D', 'E'];
const ranks = ['species', 'subspecies', 'variety'];
export const isText = (value) => typeof value === 'string' && Boolean(value.trim());
export const isUuid = (value) => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export const readJson = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, ''));

export async function save(path, content) {
  const body = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
  await writeFile(path, body, { flag: 'wx' });
}

export function requireId(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id)) {
    throw new Error(`無效的識別碼 ${id}，請使用英文字母開頭及小寫字母、數字、連字號。`);
  }
  return id;
}

export async function init(root, region) {
  if (!isText(region)) throw new Error('請先確認評估區域，包含哪些島嶼。');
  await mkdir(join(root, 'taxa'), { recursive: true });
  await save(join(root, 'project.json'), { version: 1, region: region.trim() });
  return { root, region: region.trim() };
}

export async function projectAt(root) {
  const project = await readJson(join(root, 'project.json'));
  if (project.version !== 1 || !isText(project.region)) throw new Error('無法讀取專案版本或區域。');
  return project;
}

function normalizeName(name) {
  return name.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function newAssessment(row) {
  const { id, scientificName, rank, vernacularName = '', parentId = null } = row;
  requireId(id);
  if (!isText(scientificName) || !ranks.includes(rank)
      || typeof vernacularName !== 'string') {
    throw new Error(`${id} 需提供學名與 species、subspecies 或 variety 階層。`);
  }
  if (parentId !== null) requireId(parentId);
  return {
    version: 1,
    taxon: {
      id, scientificName: scientificName.trim(), rank, vernacularName, parentId,
      confirmed: false, tbnUuid: null, gbifKey: null, authority: '', synonyms: [], notes: '',
    },
    eligibility: { status: 'unresolved', rationale: '', evidence: [] },
    evidence: [],
    criteria: Object.fromEntries(criteria.map((key) => [key, { status: 'pending', rationale: '', evidence: [], codes: [] }])),
    preliminary: { category: null, rationale: '', codes: [] },
    regional: { outcome: 'pending', category: null, rationale: '', evidence: [] },
    uncertainties: [],
    reviewer: { name: '', date: '' },
  };
}

export function taxonFile(root, id) {
  return join(root, 'taxa', `${requireId(id)}.json`);
}

export async function list(root) {
  await projectAt(root);
  const names = await readdir(join(root, 'taxa'));
  const records = await Promise.all(names.filter((name) => name.endsWith('.json'))
    .map((name) => readJson(join(root, 'taxa', name))));
  const parents = new Set(records.map((record) => record.taxon.parentId).filter(Boolean));
  return records.map(({ taxon, preliminary, regional, reviewer }) => ({
    ...taxon, leaf: !parents.has(taxon.id), preliminary: preliminary.category, regional: regional.category,
    reviewerDate: reviewer.date || null,
  }));
}

export async function add(root, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('清單需為非空 JSON 陣列。');
  const existing = await list(root);
  const incoming = rows.map(newAssessment);
  const seen = new Map(existing.map((row) => [row.id, row]));
  const names = new Set(existing.map((row) => normalizeName(row.scientificName)));
  const created = [];
  for (const record of incoming) {
    const row = record.taxon;
    const prior = seen.get(row.id);
    if (prior && normalizeName(prior.scientificName) === normalizeName(row.scientificName)
        && prior.rank === row.rank && prior.parentId === row.parentId) continue;
    if (prior || names.has(normalizeName(row.scientificName))) throw new Error(`重複的分類群 ID 或學名 ${row.id}。`);
    seen.set(row.id, row);
    names.add(normalizeName(row.scientificName));
    created.push(record);
  }
  for (const { taxon: row } of created) {
    if (!row.parentId) continue;
    const parent = seen.get(row.parentId);
    if (!parent || ranks.indexOf(parent.rank) >= ranks.indexOf(row.rank)) {
      throw new Error(`${row.id} 的上位分類群不存在或階層不符。`);
    }
  }
  created.sort((a, b) => ranks.indexOf(a.taxon.rank) - ranks.indexOf(b.taxon.rank));
  for (const record of created) await save(taxonFile(root, record.taxon.id), record);
  return { created: created.map(({ taxon }) => taxon.id), skipped: rows.length - created.length };
}

export async function leafAt(root, id) {
  const rows = await list(root);
  const row = rows.find((item) => item.id === id);
  if (!row?.leaf) throw new Error(`找不到可評估的末端分類群 ${id}。`);
  const record = await readJson(taxonFile(root, id));
  if (record.version !== 1) throw new Error('不支援此評估檔版本。');
  return record;
}
