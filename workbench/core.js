"use strict";
const WB = (() => {
  const snapshot = "TaiCOL-20261030+parents-20261120";
  const scope = "tw-red-list-land-v1";
  const units = new Map();
  const children = new Set(Object.values(parentSnapshot.edges));
  const normalize = (value) =>
    value
      .trim()
      .normalize("NFKC")
      .replace(/台/g, "臺")
      .replace(/\s+/g, " ")
      .toLowerCase();
  const index = new Map();
  function indexName(text, taxon, match) {
    if (!text.trim()) return;
    const key = normalize(text);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ taxon, match });
  }
  for (const row of catalogRows) {
    const [
      id,
      nameId,
      name,
      author,
      chinese,
      rank,
      family,
      familyZh,
      genus,
      genusZh,
      synonyms,
      misapplied,
      aliases,
      origin,
      unofficial,
    ] = row;
    const taxon = {
      id,
      nameId,
      name,
      author,
      chinese,
      rank,
      family,
      familyZh,
      genus,
      genusZh,
      origin,
      unofficial: unofficial === "true",
      parent: parentSnapshot.edges[id] || null,
      group: children.has(id),
    };
    units.set(id, taxon);
    for (const key of [
      name,
      name + " " + author,
      chinese,
      ...aliases.split(","),
    ])
      indexName(key, taxon, "名稱");
    for (const key of synonyms.split(",")) indexName(key, taxon, "異名");
    for (const key of misapplied.split(","))
      indexName(key, taxon, "誤用名待查");
    for (const key of [family, familyZh, genus, genusZh])
      indexName(key, taxon, "科／屬展開");
  }
  function match(query) {
    const found = new Map();
    for (const item of index.get(normalize(query)) || [])
      if (!found.has(item.taxon.id)) found.set(item.taxon.id, item);
    return [...found.values()].sort((a, b) =>
      a.taxon.name.localeCompare(b.taxon.name, "en"),
    );
  }
  const blank = () => ({
    adoptedName: "",
    adoptedRank: "",
    coverage: "未確認",
    citation: "",
    notes: "",
    status: "待查核",
    assessmentNotes: "",
  });
  function newEntry(taxon, input) {
    return {
      key: taxon ? taxon.id : "manual-" + crypto.randomUUID(),
      input,
      name: taxon?.name || input,
      chinese: taxon?.chinese || "",
      rank: taxon?.rank || "unresolved",
      group: taxon?.group || false,
      draft: blank(),
      history: [],
    };
  }
  function newProject(title) {
    return {
      id: crypto.randomUUID(),
      title,
      revision: 0,
      snapshot,
      scope,
      entries: [],
      modified: new Date().toISOString(),
    };
  }
  function readCsv(text) {
    const rows = [];
    let row = [],
      cell = "",
      quoted = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"' && (quoted || !cell)) {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = !quoted;
      } else if (!quoted && ch === ",") {
        row.push(cell);
        cell = "";
      } else if (!quoted && (ch === "\n" || ch === "\r")) {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += ch;
    }
    if (quoted) throw Error("CSV 的引號尚未結束。");
    row.push(cell);
    rows.push(row);
    const header = rows[0].map(normalize);
    const column = header.findIndex((x) =>
      [
        "scientificname",
        "scientific_name",
        "name",
        "學名",
        "名稱",
        "分類群",
      ].includes(x),
    );
    if (column < 0 && rows.some((r) => r.length > 1))
      throw Error("多欄 CSV 請為名稱欄加上「學名」或 scientificName 標題。");
    return rows
      .slice(column >= 0 ? 1 : 0)
      .map((r) => (r[Math.max(column, 0)] || "").trim())
      .filter(Boolean);
  }
  const draftFields = Object.keys(blank());
  const isText = (v, max) => typeof v === "string" && v.length <= max;
  function validDraft(d) {
    return (
      d &&
      Object.keys(d).length === draftFields.length &&
      draftFields.every((k) => isText(d[k], 32000)) &&
      ["", "Species", "Subspecies", "Variety"].includes(d.adoptedRank) &&
      ["未確認", "部分涵蓋", "完整涵蓋"].includes(d.coverage) &&
      ["待查核", "已確認"].includes(d.status) &&
      !(
        d.status === "已確認" &&
        (d.adoptedName || d.adoptedRank) &&
        (!d.citation.trim() || !d.notes.trim())
      )
    );
  }
  function validate(p) {
    if (
      !p ||
      !isText(p.id, 100) ||
      !p.id ||
      !isText(p.title, 120) ||
      !p.title.trim() ||
      p.scope !== scope ||
      p.snapshot !== snapshot ||
      !Number.isSafeInteger(p.revision) ||
      p.revision < 0 ||
      !isText(p.modified, 60) ||
      !Array.isArray(p.entries) ||
      p.entries.length > 25000
    )
      throw Error("專案欄位或名錄版本不相容。");
    const seen = new Set();
    for (const e of p.entries) {
      if (
        !e ||
        !isText(e.key, 100) ||
        seen.has(e.key) ||
        (!units.has(e.key) && !/^manual-[a-f0-9-]{36}$/.test(e.key)) ||
        ![e.name, e.chinese, e.input].every((x) => isText(x, 400)) ||
        !e.name.trim() ||
        !["Species", "Subspecies", "Variety", "unresolved"].includes(e.rank) ||
        typeof e.group !== "boolean" ||
        !validDraft(e.draft) ||
        !Array.isArray(e.history) ||
        !e.history.every((h) => h && isText(h.at, 60) && validDraft(h.before))
      )
        throw Error("清單含重複識別碼或無效的分類查核內容。");
      seen.add(e.key);
    }
    return p;
  }
  let database;
  function open() {
    return new Promise((resolve, reject) => {
      const q = indexedDB.open("taiwan-plant-red-list-workbench", 1);
      q.onupgradeneeded = () =>
        q.result.createObjectStore("projects", { keyPath: "id" });
      q.onsuccess = () => {
        database = q.result;
        resolve();
      };
      q.onerror = () => reject(q.error);
    });
  }
  function projects() {
    return new Promise((resolve, reject) => {
      const q = database
        .transaction("projects")
        .objectStore("projects")
        .getAll();
      q.onsuccess = () =>
        resolve(q.result.sort((a, b) => b.modified.localeCompare(a.modified)));
      q.onerror = () => reject(q.error);
    });
  }
  function save(project, priorRevision) {
    validate(project);
    return new Promise((resolve, reject) => {
      const tx = database.transaction("projects", "readwrite"),
        store = tx.objectStore("projects");
      const check = store.get(project.id);
      let conflict = false;
      check.onsuccess = () => {
        if ((check.result?.revision ?? null) !== priorRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(project);
      };
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(
          Error(
            conflict
              ? "其他分頁已修改此專案。請先複製未保存文字，再重新載入。"
              : "本機儲存失敗，請檢查瀏覽器可用空間。",
          ),
        );
    });
  }
  async function digest(bytes) {
    const result = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(result), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }
  const maxBytes = 32 * 1024 * 1024;
  async function pack(project) {
    const bytes = fflate.strToU8(JSON.stringify(validate(project)));
    if (bytes.length > maxBytes) throw Error("此版本的備份上限為 32 MiB。");
    const manifest = {
      format: "tprla-workbench",
      schemaVersion: 1,
      profile: "backup",
      projectId: project.id,
      bytes: bytes.length,
      sha256: await digest(bytes),
    };
    // Store without compression so declared and actual sizes can be checked before reading entries.
    return fflate.zipSync(
      {
        "manifest.json": fflate.strToU8(JSON.stringify(manifest)),
        "project.json": bytes,
      },
      { level: 0 },
    );
  }
  async function unpack(file) {
    if (file.size > maxBytes + 65536) throw Error("資料包超過本版讀取上限。");
    const names = new Set();
    const files = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        if (
          names.has(entry.name) ||
          !["manifest.json", "project.json"].includes(entry.name) ||
          entry.compression !== 0 ||
          entry.size !== entry.originalSize ||
          entry.size > (entry.name === "manifest.json" ? 4096 : maxBytes)
        )
          throw Error("檔案結構不符合本版備份格式。");
        names.add(entry.name);
        return true;
      },
    });
    if (names.size !== 2) throw Error("資料包缺少必要檔案。");
    const m = JSON.parse(fflate.strFromU8(files["manifest.json"])),
      bytes = files["project.json"];
    if (
      m.format !== "tprla-workbench" ||
      m.schemaVersion !== 1 ||
      m.profile !== "backup" ||
      m.bytes !== bytes.length ||
      m.sha256 !== (await digest(bytes))
    )
      throw Error("資料包版本或內容校驗失敗。");
    const p = validate(JSON.parse(fflate.strFromU8(bytes)));
    if (p.id !== m.projectId) throw Error("資料包的專案識別碼不一致。");
    return p;
  }
  return {
    snapshot,
    units,
    match,
    normalize,
    newEntry,
    newProject,
    open,
    projects,
    save,
    pack,
    unpack,
    readCsv,
  };
})();
