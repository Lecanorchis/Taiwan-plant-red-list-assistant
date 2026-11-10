import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { add, init, leafAt, list, projectAt, readJson, requireId, save } from './workspace.mjs';
import { findTaxon, getOccurrences, reviewedPoints, reviewTemplate } from './occurrences.mjs';
import { findGbifTaxon, getGbifOccurrences, isGbifKey } from './gbif.mjs';
import { gridRange, rangeSvg } from './range.mjs';
import { renderReport, validate } from './report.mjs';
import standardRegion from '../references/region.json' with { type: 'json' };

const help = `redlist <command>

  sources [keyword]                    查詢準則、文獻及資料來源
  init ["自訂區域"]                      建立工作區，預設採新版紅皮書評估範圍
  add <list.json>                      加入種、亞種、變種清單
  list                                 檢視清單、末端分類群與進度
  taxon "名稱" [gbif|tbn]               查詢候選。GBIF 用學名，TBN 可用中文名
  occurrences <taxon-id> [tbn|gbif] [max-pages]
                                       擷取觀測快照，預設 TBN、10 頁
  review <taxon-id> <snapshot.json>     建立人工篩選表
  range <taxon-id> <snapshot.json> <review.json> [boundary.geojson]
                                       計算初步 EOO/AOO 並輸出本機地圖
  validate <taxon-id>                  檢查草稿欄位、證據參照及人工審閱狀態
  report <taxon-id>                    產生 Markdown 報告

工作資料預設在目前目錄的 assessments/，可用 RED_LIST_WORKSPACE 設定其他路徑。`;

const root = resolve(process.env.RED_LIST_WORKSPACE || 'assessments');
const [command, ...args] = process.argv.slice(2);

function arity(min, max = min) {
  if (args.length < min || args.length > max) throw new Error(`參數有誤。\n${help}`);
}

async function loadSnapshot(id, file) {
  const { taxon } = await leafAt(root, id);
  const snapshot = await readJson(file);
  const matchingTaxon = snapshot.provider === 'gbif' ? isGbifKey(taxon.gbifKey) && taxon.gbifKey === snapshot.taxonKey
    : snapshot.provider === 'tbn' && typeof taxon.tbnUuid === 'string' && taxon.tbnUuid === snapshot.taxonUuid;
  if (snapshot.version !== 1 || snapshot.taxonId !== id || taxon.confirmed !== true || !matchingTaxon || !Array.isArray(snapshot.pages)) {
    throw new Error('快照需與工作區已確認的末端分類群及來源識別碼一致。');
  }
  requireId(snapshot.id);
  return snapshot;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function checkProvider(provider) {
  if (provider !== 'gbif' && provider !== 'tbn') throw new Error('來源須為 gbif 或 tbn。');
}

async function run() {
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
      return help;
    case 'sources': {
      arity(0, 1);
      const sources = await readJson(new URL('../references/sources.json', import.meta.url));
      return args[0] ? sources.filter((source) => JSON.stringify(source).toLowerCase().includes(args[0].toLowerCase())) : sources;
    }
    case 'init':
      arity(0, 1);
      return init(root, args[0] ?? standardRegion.description);
    case 'add':
      arity(1);
      return add(root, await readJson(args[0]));
    case 'list':
      arity(0);
      return list(root);
    case 'taxon': {
      arity(1, 2);
      const [name, provider = 'tbn'] = args;
      checkProvider(provider);
      return provider === 'gbif' ? findGbifTaxon(name) : findTaxon(name);
    }
    case 'occurrences': {
      arity(1, 3);
      const [id, provider = 'tbn', pageLimit = '10'] = args;
      checkProvider(provider);
      const maxPages = Number(pageLimit);
      if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('頁數上限須為 1–100。');
      const { taxon } = await leafAt(root, id);
      const { region } = await projectAt(root);
      const searchAreas = region === standardRegion.description ? standardRegion.searchAreas : [];
      const snapshot = provider === 'gbif' ? await getGbifOccurrences(taxon, maxPages, searchAreas) : await getOccurrences(taxon, maxPages);
      const dir = join(root, 'occurrences', id);
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${snapshot.id}.json`);
      await save(path, snapshot);
      return { path, pages: snapshot.pages.length, total: snapshot.reportedTotal, truncated: snapshot.truncated };
    }
    case 'review': {
      arity(2);
      const [id, file] = args;
      const snapshot = await loadSnapshot(id, file);
      const { region } = await projectAt(root);
      const dir = join(root, 'review', id);
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${snapshot.id}.json`);
      const review = reviewTemplate(snapshot, region);
      await save(path, { ...review, snapshotHash: fingerprint(snapshot) });
      return { path, decisions: review.decisions.length };
    }
    case 'range': {
      arity(3, 4);
      const [id, file, decisions, boundaryPath] = args;
      const snapshot = await loadSnapshot(id, file);
      const review = await readJson(decisions);
      if (review.snapshotHash !== fingerprint(snapshot)) throw new Error('快照內容與篩選表不符，請重新建立篩選表。');
      const { region } = await projectAt(root);
      const { taxon } = await leafAt(root, id);
      const { points, counts } = reviewedPoints(snapshot, review, region);
      const result = gridRange(points);
      const boundary = boundaryPath ? await readJson(boundaryPath) : await readJson(new URL('../assets/taiwan-context.geojson', import.meta.url));
      const map = rangeSvg(result, taxon.scientificName, boundary, region === standardRegion.description ? standardRegion : undefined);
      const dir = join(root, 'range', id, randomUUID());
      const output = {
        version: 1, taxonId: id, scope: region, snapshotId: snapshot.id, snapshotHash: review.snapshotHash,
        reviewHash: fingerprint(review), provider: snapshot.provider, occurrenceUrl: snapshot.url, retrievedAt: snapshot.retrievedAt,
        truncated: snapshot.truncated, counts, provisional: true, ...result.metrics,
      };
      await mkdir(dir, { recursive: true });
      await save(join(dir, 'review.json'), review);
      await save(join(dir, 'map.svg'), map);
      await save(join(dir, 'range.json'), output);
      return { dir, ...output };
    }
    case 'validate':
    case 'report': {
      arity(1);
      const record = await leafAt(root, args[0]);
      const check = validate(record);
      if (check.errors.length || (command === 'validate' && !check.ready)) process.exitCode = 1;
      if (command === 'validate' || check.errors.length) return check;
      const { region } = await projectAt(root);
      const dir = join(root, 'reports', record.taxon.id);
      await mkdir(dir, { recursive: true });
      const report = renderReport(record, region, check);
      const path = join(dir, `${fingerprint(report).slice(0, 16)}.md`);
      try {
        await save(path, report);
      } catch (error) {
        if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== report) throw error;
      }
      return { path, ...check };
    }
    default:
      throw new Error(`未知命令 ${command}。\n${help}`);
  }
}

try {
  const result = await run();
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message, error.cause?.code ?? '');
  process.exitCode = 1;
}
