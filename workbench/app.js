"use strict";
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const rankName = {
  Species: "種",
  Subspecies: "亞種",
  Variety: "變種",
  unresolved: "階層待查",
};
let project = null,
  page = "list",
  editing = null,
  candidates = [],
  restore = null;
let listQuery = "",
  statusFilter = "",
  heldDraft = null,
  timer = 0,
  sequence = Promise.resolve();
const notify = (msg, error = false) => {
  $("notice").textContent = msg;
  $("notice").classList.toggle("error", error);
};
function queue(task) {
  sequence = sequence
    .then(task)
    .catch((e) => notify(e.message || String(e), true));
  return sequence;
}
async function refreshProjects() {
  const rows = await WB.projects();
  $("projects").innerHTML = rows.length
    ? rows
        .map(
          (p) =>
            '<option value="' +
            escapeHtml(p.id) +
            '">' +
            escapeHtml(p.title) +
            "</option>",
        )
        .join("")
    : "<option>尚無專案</option>";
  if (project) $("projects").value = project.id;
  return rows;
}
async function change(edit) {
  const current = structuredClone(project);
  edit(current);
  current.revision++;
  current.modified = new Date().toISOString();
  await WB.save(current, project.revision);
  project = current;
}
function show(next) {
  page = next;
  candidates = [];
  restore = null;
  document
    .querySelectorAll("nav button")
    .forEach((b) =>
      b.classList.toggle(
        "active",
        b.dataset.page === page ||
          (page === "taxon" && b.dataset.page === "list"),
      ),
    );
  if (page === "backup") return backupPage();
  if (!project) {
    $("page").innerHTML =
      '<h1>評估清單</h1><div class="box"><h2>建立第一份植物清單</h2><p>選擇專案名稱後，可以輸入學名、屬名或科名，從 TaiCOL 名錄加入分類群。</p><button class="primary" id="firstProject">建立專案</button> <button id="firstRestore">從備份還原</button></div>';
    $("firstProject").onclick = openProjectDialog;
    $("firstRestore").onclick = () => show("backup");
    return;
  }
  if (page === "add") return addPage();
  if (page === "taxon") return taxonPage();
  listPage();
}
function openProjectDialog() {
  $("projectForm").reset();
  $("projectDialog").showModal();
  $("projectForm").elements.title.focus();
}
function listPage() {
  const entries = project.entries,
    individual = entries.filter((e) => !e.group);
  $("page").innerHTML =
    '<div class="head"><div><h1>' +
    escapeHtml(project.title) +
    '</h1><p class="desc">評估清單</p></div><button class="primary" id="addNow">加入分類群</button></div>' +
    '<div class="stats"><span><b>' +
    individual.length +
    "</b>評估單位</span><span><b>" +
    individual.filter((e) => e.draft.status === "已確認").length +
    "</b>分類已確認</span><span><b>" +
    entries.filter((e) => e.group).length +
    "</b>種層級整理項</span></div>" +
    '<div class="box"><div class="grid"><label>搜尋清單<input id="filter" placeholder="學名、中文名或原始輸入"></label><label>分類查核<select id="status"><option value="">全部狀態</option><option>待查核</option><option>已確認</option></select></label></div><div id="entries"></div></div>';
  $("addNow").onclick = () => show("add");
  $("filter").value = listQuery;
  $("status").value = statusFilter;
  $("filter").oninput = (e) => {
    listQuery = e.target.value;
    renderEntries();
  };
  $("status").onchange = (e) => {
    statusFilter = e.target.value;
    renderEntries();
  };
  renderEntries();
}
function renderEntries() {
  const query = WB.normalize(listQuery);
  const found = project.entries.filter(
    (e) =>
      (!statusFilter || e.draft.status === statusFilter) &&
      WB.normalize(
        [e.name, e.chinese, e.input, e.draft.adoptedName].join(" "),
      ).includes(query),
  );
  $("entries").innerHTML = found.length
    ? found
        .map(
          (e) =>
            '<div class="row"><button class="link" data-edit="' +
            escapeHtml(e.key) +
            '"><strong>' +
            escapeHtml(e.chinese || e.name) +
            "</strong> <i>" +
            escapeHtml(e.draft.adoptedName || e.name) +
            "</i><small>" +
            rankName[e.draft.adoptedRank || e.rank] +
            (e.group ? " · 種層級整理項" : "") +
            '</small></button><span class="pill">' +
            e.draft.status +
            "</span></div>",
        )
        .join("")
    : '<p class="field">' +
      (project.entries.length
        ? "沒有符合條件的項目。"
        : "清單尚空白。可先用「皿柱蘭屬」試建一份清單。") +
      "</p>";
  $("entries").onclick = (e) => {
    const b = e.target.closest("[data-edit]");
    if (b) {
      editing = b.dataset.edit;
      show("taxon");
    }
  };
}
function addPage() {
  $("page").innerHTML =
    '<h1>加入分類群</h1><p class="desc">輸入種、屬或科的學名或中文名，每行一個。預覽後可選取要加入的項目。</p><div class="box"><label>名稱清單<textarea id="queries" placeholder="皿柱蘭屬&#10;臺灣杉"></textarea></label><div class="actions"><button class="primary" id="preview">預覽候選</button><button id="csvButton">讀取 CSV 名單</button><input id="csv" type="file" accept=".csv,text/csv" hidden></div></div><div id="previewPanel"></div>';
  $("preview").onclick = () => queue(preview);
  $("queries").oninput = () => {
    $("previewPanel").replaceChildren();
    candidates = [];
  };
  $("csvButton").onclick = () => $("csv").click();
  $("csv").onchange = (e) =>
    queue(async () => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024)
        throw Error("請選擇 1 MiB 以下的 UTF-8 名單。");
      $("queries").value = WB.readCsv(await file.text()).join("\n");
      preview();
    });
}
function preview() {
  const names = [
    ...new Set(
      $("queries")
        .value.split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!names.length || names.some((n) => n.length > 400))
    throw Error("請輸入名稱，每個名稱最多 400 字。");
  const found = new Map(),
    existing = new Set(project.entries.map((e) => e.key)),
    manual = new Set(
      project.entries
        .filter((e) => !WB.units.has(e.key))
        .map((e) => WB.normalize(e.input)),
    );
  for (const input of names) {
    const matches = WB.match(input);
    if (!matches.length) {
      const k = "?:" + WB.normalize(input);
      found.set(k, {
        input,
        label: "名錄未解 · 人工查核",
        selected: false,
        exists: manual.has(WB.normalize(input)),
      });
      continue;
    }
    const ambiguous =
      matches.length > 1 && !matches.every((r) => r.match === "科／屬展開");
    for (const { taxon, match } of matches) {
      if (found.has(taxon.id)) continue;
      const needsParent = taxon.rank !== "Species" && !taxon.parent;
      const needsReview =
        ambiguous || match === "誤用名待查" || taxon.unofficial || needsParent;
      found.set(taxon.id, {
        input,
        taxon,
        label: [
          match,
          rankName[taxon.rank],
          taxon.group ? "母種整理項" : "",
          needsParent ? "父階層待查" : "",
          ambiguous ? "多個匹配" : "",
          taxon.unofficial ? "非正式紀錄" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        exists: existing.has(taxon.id),
        selected: !needsReview && !taxon.group,
      });
    }
  }
  candidates = [...found.values()];
  $("previewPanel").innerHTML =
    '<div class="box"><div class="head"><h2>候選預覽</h2><span id="selection"></span></div><p class="desc">母種可加入整理頁。種級紀錄保留原鑑定階層，可待分類查核時處理。</p><div class="listpane">' +
    candidates
      .map(
        (c, i) =>
          '<div class="row"><label><input type="checkbox" data-i="' +
          i +
          '" ' +
          (c.exists ? "disabled" : c.selected ? "checked" : "") +
          "><span>" +
          escapeHtml(c.taxon?.chinese || c.input) +
          " <i>" +
          escapeHtml(c.taxon?.name || "") +
          "</i><small>" +
          escapeHtml(c.label) +
          "</small></span></label><span>" +
          (c.exists ? "已在清單" : "") +
          "</span></div>",
      )
      .join("") +
    '</div><div class="actions"><button id="applyList" class="primary">加入所選項目</button><button id="deselect">清除勾選</button></div></div>';
  const update = () => {
    const count = candidates.filter((c) => c.selected && !c.exists).length;
    $("selection").textContent =
      count + " 項已選／" + candidates.length + " 項候選";
    $("applyList").disabled = !count;
  };
  $("previewPanel").onchange = (e) => {
    if (e.target.matches("[data-i]")) {
      candidates[Number(e.target.dataset.i)].selected = e.target.checked;
      update();
    }
  };
  $("deselect").onclick = () => {
    candidates.forEach((c) => (c.selected = false));
    $("previewPanel")
      .querySelectorAll("input")
      .forEach((x) => (x.checked = false));
    update();
  };
  $("applyList").onclick = () =>
    queue(async () => {
      const selected = candidates.filter((c) => c.selected && !c.exists);
      if (!selected.length) return;
      await change((p) =>
        p.entries.push(...selected.map((c) => WB.newEntry(c.taxon, c.input))),
      );
      listQuery = "";
      statusFilter = "";
      show("list");
      notify("已加入 " + selected.length + " 項，並保存於此瀏覽器。");
    });
  update();
}
function taxonPage() {
  const e = project.entries.find((x) => x.key === editing),
    t = WB.units.get(e.key),
    d = e.draft;
  const field = (key, title, area = false) =>
    '<label class="field">' +
    title +
    (area
      ? '<textarea maxlength="32000" name="' +
        key +
        '">' +
        escapeHtml(d[key]) +
        "</textarea>"
      : '<input maxlength="32000" name="' +
        key +
        '" value="' +
        escapeHtml(d[key]) +
        '">') +
    "</label>";
  $("page").innerHTML =
    '<button class="link" id="back">返回評估清單</button><h1>' +
    escapeHtml(e.chinese || e.name) +
    "</h1><p><i>" +
    escapeHtml(e.name) +
    "</i> " +
    escapeHtml(t?.author || "") +
    '</p><section class="box"><h2>名錄與原始輸入</h2><p>' +
    escapeHtml(e.input) +
    "　·　" +
    rankName[e.rank] +
    "　·　" +
    escapeHtml(t?.family || "待查科別") +
    "</p>" +
    (t
      ? "<p>分類群 " +
        escapeHtml(t.id) +
        "　學名編號 " +
        escapeHtml(t.nameId) +
        "　" +
        escapeHtml(t.origin || "原生性待查") +
        "</p>"
      : "<p>名錄未解，請補上採用名稱及文獻。</p>") +
    (e.group
      ? '<p class="warn">此種有下位分類群，可在此保留尚未歸屬的紀錄與理由。</p>'
      : "") +
    '</section><form class="box" id="editor"><div class="head"><h2>分類查核與評估筆記</h2><span id="saved" class="stateline">已保存</span></div>' +
    field("adoptedName", "人工採用名（沿用名錄可留空）") +
    '<label class="field">採用階層<select name="adoptedRank"><option value="">沿用原階層</option><option value="Species">種</option><option value="Subspecies">亞種</option><option value="Variety">變種</option></select></label>' +
    field("citation", "分類依據與出處") +
    field("notes", "分類差異、未歸屬紀錄與理由", true) +
    field("assessmentNotes", "評估筆記與待辦", true) +
    (e.group
      ? '<label class="field">下位單位對母種的涵蓋<select name="coverage"><option>未確認</option><option>部分涵蓋</option><option>完整涵蓋</option></select></label>'
      : "") +
    '<label>分類查核狀態<select name="status"><option>待查核</option><option>已確認</option></select></label><div class="actions"><button class="primary">保存查核</button><button type="button" id="remove">從清單移除</button></div></form><details class="box"><summary>修改歷程</summary><div id="history"></div></details>';
  const form = $("editor");
  form.elements.status.value = d.status;
  form.elements.adoptedRank.value = d.adoptedRank;
  if (e.group) form.elements.coverage.value = d.coverage;
  function history() {
    const item = project.entries.find((x) => x.key === editing);
    $("history").innerHTML =
      item.history
        .slice()
        .reverse()
        .map(
          (h) =>
            "<details><summary>" +
            escapeHtml(new Date(h.at).toLocaleString("zh-TW")) +
            "</summary><p>變更前　" +
            escapeHtml(
              [
                h.before.adoptedName,
                h.before.adoptedRank,
                h.before.coverage,
                h.before.citation,
                h.before.notes,
                h.before.assessmentNotes,
                h.before.status,
              ]
                .filter(Boolean)
                .join(" ／ "),
            ) +
            "</p></details>",
        )
        .join("") || "尚無修改。";
  }
  $("history").parentElement.ontoggle = history;
  history();
  form.oninput = () => {
    heldDraft = {
      key: e.key,
      draft: { ...d, ...Object.fromEntries(new FormData(form)) },
    };
    $("saved").textContent = "等待儲存";
    clearTimeout(timer);
    timer = setTimeout(() => queue(flush), 700);
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    queue(async () => {
      await flush();
      history();
      notify("分類查核已保存。");
    });
  };
  $("back").onclick = () =>
    queue(async () => {
      await flush();
      show("list");
    });
  $("remove").onclick = () =>
    queue(async () => {
      await flush();
      if (!confirm("移除這筆分類群及其本機筆記？可先匯出備份。")) return;
      await change(
        (p) => (p.entries = p.entries.filter((x) => x.key !== editing)),
      );
      show("list");
    });
}
async function flush() {
  clearTimeout(timer);
  const pending = heldDraft;
  if (!pending) return;
  const old = project.entries.find((e) => e.key === pending.key);
  if (
    pending.draft.status === "已確認" &&
    (((pending.draft.adoptedName || pending.draft.adoptedRank) &&
      (!pending.draft.citation.trim() || !pending.draft.notes.trim())) ||
      (!WB.units.has(old.key) &&
        (!pending.draft.adoptedName.trim() || !pending.draft.adoptedRank)))
  ) {
    $("saved").textContent = "尚未儲存";
    throw Error(
      "確認人工分類處理前請補上依據與差異理由。名錄未解者也需填採用名與階層；可先選「待查核」儲存草稿。",
    );
  }
  if (JSON.stringify(old.draft) !== JSON.stringify(pending.draft)) {
    await change((p) => {
      const entry = p.entries.find((e) => e.key === pending.key);
      entry.history.push({ at: new Date().toISOString(), before: entry.draft });
      entry.draft = pending.draft;
    });
  }
  if (heldDraft === pending) {
    heldDraft = null;
    if ($("saved")) $("saved").textContent = "已保存於此瀏覽器";
    notify("");
  } else {
    await flush();
  }
}
function backupPage() {
  $("page").innerHTML =
    '<h1>備份與還原</h1><div class="box"><h2>匯出本機專案</h2><p>' +
    escapeHtml(project?.title || "尚未建立專案") +
    "　·　" +
    (project?.entries.length || 0) +
    ' 筆清單項目</p><p class="desc">資料包包含清單、分類查核、評估筆記與修改歷程。工作進行中也可以備份。</p><button id="download" class="primary" ' +
    (!project ? "disabled" : "") +
    '>下載完整備份</button></div><div class="box"><h2>從資料包還原</h2><p class="desc">先檢查檔案並預覽內容，再建立獨立的本機副本。</p><label>選擇備份 ZIP<input id="archive" type="file" accept=".zip"></label><div id="restorePreview"></div></div>';
  $("download").onclick = () =>
    queue(async () => {
      const bytes = await WB.pack(project),
        url = URL.createObjectURL(
          new Blob([bytes], { type: "application/zip" }),
        );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        project.title.replace(/[<>:"/\\|?*]/g, "-") +
        "-" +
        project.modified.slice(0, 10) +
        ".tprla.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify("已產生 ZIP。請確認下載的檔案已保存。");
    });
  $("archive").onchange = (event) => {
    const file = event.target.files[0];
    restore = null;
    $("restorePreview").replaceChildren();
    if (file)
      queue(async () => {
        restore = await WB.unpack(file);
        $("restorePreview").innerHTML =
          '<p class="field">' +
          escapeHtml(restore.title) +
          "　·　" +
          restore.entries.length +
          " 筆　·　版本 " +
          restore.revision +
          '</p><button id="restoreBtn" class="primary">還原為新副本</button>';
        $("restoreBtn").onclick = () =>
          queue(async () => {
            if (!restore) return;
            const p = structuredClone(restore);
            p.id = crypto.randomUUID();
            p.title = p.title.slice(0, 110) + "（還原副本）";
            p.modified = new Date().toISOString();
            await WB.save(p, null);
            project = p;
            await refreshProjects();
            listQuery = "";
            statusFilter = "";
            show("list");
            notify("已建立還原副本。");
          });
      });
  };
}
document.querySelector("nav").onclick = (event) => {
  const b = event.target.closest("[data-page]");
  if (b)
    queue(async () => {
      await flush();
      notify("");
      show(b.dataset.page);
    });
};
$("newProject").onclick = () =>
  queue(async () => {
    await flush();
    openProjectDialog();
  });
$("cancelProject").onclick = () => $("projectDialog").close();
$("projectForm").onsubmit = (event) => {
  event.preventDefault();
  queue(async () => {
    const title = $("projectForm").elements.title.value.trim();
    if (!title) throw Error("請填寫專案名稱。");
    const p = WB.newProject(title);
    await WB.save(p, null);
    project = p;
    await refreshProjects();
    $("projectDialog").close();
    listQuery = "";
    statusFilter = "";
    show("add");
    notify("已建立本機專案。");
  });
};
$("projects").onchange = (event) => {
  const id = event.target.value;
  if (project) $("projects").value = project.id;
  queue(async () => {
    await flush();
    const all = await WB.projects();
    project = all.find((p) => p.id === id);
    await refreshProjects();
    listQuery = "";
    statusFilter = "";
    show("list");
    notify("");
  });
};
window.addEventListener("beforeunload", (event) => {
  if (heldDraft) {
    event.preventDefault();
    event.returnValue = "";
  }
});
queue(async () => {
  await WB.open();
  const all = await refreshProjects();
  project = all[0] || null;
  show("list");
});
