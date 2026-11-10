import { randomUUID } from 'node:crypto';
import { isText } from './workspace.mjs';

export const isGbifKey = (value) => Number.isSafeInteger(value) && value > 0;

async function request(endpoint, params) {
  const url = new URL(`https://api.gbif.org/v1/${endpoint}`);
  url.search = new URLSearchParams(params);
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GBIF ${endpoint} HTTP ${response.status}。`);
  return { url: url.href, response: await response.json() };
}

export async function findGbifTaxon(name) {
  if (!isText(name)) throw new Error('請輸入學名。');
  const { url, response } = await request('species/match', { name: name.trim(), kingdom: 'Plantae', strict: 'true', verbose: 'true' });
  const candidates = [response, ...(response.alternatives ?? [])].filter((row) => isGbifKey(row.usageKey));
  return { url, retrievedAt: new Date().toISOString(), candidates };
}

export async function getGbifOccurrences(taxon, maxPages) {
  if (taxon.confirmed !== true || !isGbifKey(taxon.gbifKey)) throw new Error('請先確認分類群與 GBIF gbifKey。');
  const params = { taxon_key: taxon.gbifKey, country: 'TW', occurrence_status: 'PRESENT', limit: '200' };
  const pages = [];
  let count = 0;
  let truncated = true;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const offset = count;
    const page = await request('occurrence/search', { ...params, offset });
    const { results, endOfRecords } = page.response;
    if (!Array.isArray(results) || page.response.offset !== offset || typeof endOfRecords !== 'boolean') {
      throw new Error('GBIF 回應格式或分頁偏移量不符。');
    }
    pages.push({ request: page.url, response: page.response });
    count += results.length;
    if (endOfRecords) {
      truncated = count < Number(pages[0].response.count);
      break;
    }
    if (!results.length) break;
  }
  return {
    version: 1, id: `gbif-${randomUUID()}`, taxonId: taxon.id, taxonKey: taxon.gbifKey,
    source: 'GBIF Occurrence API v1', provider: 'gbif', url: pages[0].request, retrievedAt: new Date().toISOString(),
    pages, reportedTotal: pages[0].response.count, truncated,
  };
}
