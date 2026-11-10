import { criteria, isText } from './workspace.mjs';

const categories = ['EX', 'EW', 'RE', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NA'];
const risk = ['LC', 'NT', 'VU', 'EN', 'CR'];
const threatened = ['CR', 'EN', 'VU'];
const statuses = ['pending', 'insufficient', 'not-met', 'met'];
const outcomes = ['pending', 'not-applicable', 'unchanged', 'uplisted', 'downlisted'];
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function validate(record) {
  const { taxon, eligibility, evidence, preliminary, regional, reviewer, uncertainties } = record;
  const errors = [];
  const missing = [];
  const ids = new Set();
  for (const entry of evidence) {
    if (!isText(entry.id) || ids.has(entry.id) || !isText(entry.citation) || !isText(entry.locator) || !isText(entry.finding)) {
      errors.push(`證據 ${entry.id ?? ''} 缺少唯一 ID、來源、定位或摘記。`);
    }
    ids.add(entry.id);
  }
  function checkRefs(refs, label, required) {
    if (!Array.isArray(refs) || refs.some((ref) => !ids.has(ref))) errors.push(`${label} 含未知的證據 ID。`);
    else if (required && !refs.length) missing.push(`${label} 缺少證據。`);
  }
  if (taxon.confirmed !== true || !isText(taxon.authority)) missing.push('確認接受名、分類概念、階層與分類來源。');
  if (!['unresolved', 'eligible', 'not-applicable'].includes(eligibility.status)) errors.push('評估適用性無效。');
  if (eligibility.status === 'unresolved' || !isText(eligibility.rationale)) missing.push('記錄區域評估適用性及理由。');
  checkRefs(eligibility.evidence, '適用性', eligibility.status !== 'unresolved');

  const supportedCodes = new Set();
  for (const key of criteria) {
    const row = record.criteria[key];
    if (!statuses.includes(row.status)) errors.push(`準則 ${key} 狀態無效。`);
    if (!Array.isArray(row.codes) || row.codes.some((code) => typeof code !== 'string' || !code.startsWith(key))
        || (row.status !== 'met' && row.codes.length > 0)) errors.push(`準則 ${key} 代碼與狀態不符。`);
    if (row.status === 'met') {
      if (!row.codes.length) missing.push(`記錄準則 ${key} 成立的代碼。`);
      for (const code of row.codes) supportedCodes.add(code);
    }
    const needsCriteria = eligibility.status === 'eligible' && !['EX', 'EW', 'RE'].includes(preliminary.category);
    if (needsCriteria && (row.status === 'pending' || !isText(row.rationale))) missing.push(`補充準則 ${key} 或記錄資料缺口。`);
    checkRefs(row.evidence, `準則 ${key}`, ['met', 'not-met'].includes(row.status));
  }
  if (preliminary.category !== null && !categories.includes(preliminary.category)) errors.push('區內初評類別無效。');
  if (!Array.isArray(preliminary.codes) || preliminary.codes.some((code) => !supportedCodes.has(code))) {
    errors.push('區內初評含未在 A–E 成立的代碼。');
  }
  if (threatened.includes(preliminary.category) && !preliminary.codes.length) missing.push('區內受脅初評缺少成立準則代碼。');
  if (eligibility.status === 'eligible' && preliminary.category === 'NA') errors.push('適用評估的分類群不可初評為 NA。');
  if (['LC', 'NT', 'DD'].includes(preliminary.category) && supportedCodes.size) errors.push('已有受脅準則成立，請核對區內初評。');
  if (['LC', 'NT'].includes(preliminary.category) && !criteria.some((key) => record.criteria[key].status === 'not-met')) {
    missing.push('記錄可用來判斷 LC 或 NT 的準則證據。');
  }
  if (eligibility.status === 'eligible' && (!preliminary.category || !isText(preliminary.rationale))) missing.push('記錄區內初評類別及理由。');

  if (!outcomes.includes(regional.outcome) || (regional.category !== null && !categories.includes(regional.category))) {
    errors.push('區域結果或調整方式無效。');
  }
  if (regional.outcome === 'pending' && regional.category !== null) errors.push('區域調整待查時，區域類別應保留為 null。');
  if (regional.outcome === 'not-applicable' && (regional.category !== 'NA' || eligibility.status !== 'not-applicable')) {
    errors.push('區域 NA 需要適用性判為不適用。');
  }
  if (eligibility.status === 'not-applicable' && (preliminary.category !== null || !['pending', 'not-applicable'].includes(regional.outcome))) {
    errors.push('不適用的分類群只需完成適用性及區域 NA。');
  }
  if (regional.outcome === 'unchanged' && (!preliminary.category || regional.category !== preliminary.category)) {
    errors.push('維持時，區域類別應與區內初評一致。');
  }
  if (['uplisted', 'downlisted'].includes(regional.outcome)) {
    const before = risk.indexOf(preliminary.category);
    const after = risk.indexOf(regional.category);
    if (before < 0 || after < 0 || (regional.outcome === 'uplisted' ? after <= before : after >= before)) {
      errors.push('升降級需要可比較的區內及區域類別，並符合調整方向。');
    }
  }
  if (regional.outcome === 'pending' || !isText(regional.rationale)) missing.push('記錄區外族群查核或不適用理由，以及區域結論。');
  checkRefs(regional.evidence, '區域結論', regional.outcome !== 'pending');
  if (!Array.isArray(uncertainties) || uncertainties.some((item) => !isText(item))) errors.push('不確定性應是文字陣列。');
  else if (!uncertainties.length) missing.push('記錄不確定性與資料缺口。');
  if (!isText(reviewer.name) || !isDate(reviewer.date)) missing.push('由使用者確認後填寫審閱者與日期。');
  return { errors, missing, ready: !errors.length && !missing.length };
}

export function renderReport(record, region, check) {
  const { taxon, eligibility, evidence, preliminary, regional, reviewer, uncertainties } = record;
  const text = (value) => isText(value) ? value : '待補';
  const refs = (ids) => ids.length ? `\n\n證據編號　${ids.join('、')}` : '';
  const codes = (values) => values.length ? `　${values.join('、')}` : '';
  const criteriaMd = criteria.map((key) => {
    const row = record.criteria[key];
    return `### ${key} · ${row.status}${codes(row.codes)}\n\n${text(row.rationale)}${refs(row.evidence)}`;
  }).join('\n\n');
  const evidenceMd = evidence.map((item) => `- **${item.id}**　${item.citation} · ${item.locator}\n  ${item.finding}`).join('\n');
  return `# ${taxon.scientificName}｜臺灣區域受脅評估\n\n**${check.ready ? '個人審閱版' : '工作草稿'}**\n\n`
    + `- 區域　${region}\n- 分類群　${taxon.vernacularName || '—'} · ${taxon.rank}\n`
    + `- 分類來源　${text(taxon.authority)}\n- GBIF taxon key　${taxon.gbifKey || '—'}\n- TBN 分類群 UUID　${taxon.tbnUuid || '—'}\n`
    + `- 異名與用名　${taxon.synonyms.join('、') || '—'}\n- 分類說明　${text(taxon.notes)}\n`
    + `- 人工審閱　${text(reviewer.name)} · ${text(reviewer.date)}\n`
    + `- 依據　IUCN 類別與準則 3.1、使用指引 16、區域指引 4.0\n\n`
    + `## 適用性 · ${eligibility.status}\n\n${text(eligibility.rationale)}${refs(eligibility.evidence)}\n\n`
    + `## 區內初評 · ${preliminary.category ?? '待評'}${codes(preliminary.codes)}\n\n${text(preliminary.rationale)}\n\n${criteriaMd}\n\n`
    + `## 區域評估 · ${regional.category ?? '待評'}\n\n${regional.outcome} · ${text(regional.rationale)}${refs(regional.evidence)}\n\n`
    + `## 不確定性與待辦\n\n${[...uncertainties, ...check.missing].map((item) => `- ${item}`).join('\n') || '待補'}\n\n`
    + `## 資料來源與查核位置\n\n${evidenceMd || '待補'}\n`;
}
