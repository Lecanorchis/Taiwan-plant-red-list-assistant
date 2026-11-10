# 臺灣維管束植物紅皮書評估助手

以可跨模型使用的 Agent Skill 和本機工具，協助使用者依 IUCN 指引完成臺灣維管束植物的個人區域評估。工作從一份分類群清單開始，逐一處理種、亞種或變種，保留可追溯的證據、區內初評、區域調整及審閱狀態。

## 新版紅皮書評估範圍

以中華民國目前實際管轄範圍內的陸域為準，涵蓋臺灣本島及周邊附屬島嶼（蘭嶼、小蘭嶼、綠島、小琉球、龜山島、基隆嶼、彭佳嶼、棉花嶼、花瓶嶼等）、澎湖群島、金門群島、馬祖列島、烏坵、東沙島及太平島。 [範圍設定](skills/taiwan-plant-red-list/references/region.json)

## 開始使用

將 [技能目錄](skills/taiwan-plant-red-list/) 整份提供給支援 [Agent Skills](https://agentskills.io/specification) 的主機，或讓具備檔案和終端機工具的 agent 先讀取 [SKILL.md](skills/taiwan-plant-red-list/SKILL.md)。技能使用 Markdown 與本機 CLI，無須設定模型 API 金鑰。僅能對話的模型可讀相同指南，搭配人工執行工具。

在儲存庫根目錄使用 Node.js 22 或更新版本。`init` 採新版紅皮書評估範圍，下列分類群清單供試跑。

```sh
node skills/taiwan-plant-red-list/scripts/redlist.mjs sources
node skills/taiwan-plant-red-list/scripts/redlist.mjs init
node skills/taiwan-plant-red-list/scripts/redlist.mjs add examples/taxa.json
node skills/taiwan-plant-red-list/scripts/redlist.mjs list
node skills/taiwan-plant-red-list/scripts/redlist.mjs report taiwania-cryptomerioides
```

接著在 agent 協助下核對接受名、異名及來源識別碼。`taxon` 查分類候選，`occurrences` 保存開放 API 快照，預設使用 TBN v2.6，也可指定 GBIF。`review` 產生人工篩選表，`range` 輸出初步 EOO、AOO 和可離線檢視的分布圖。完整命令、報告欄位及來源引註見 [工作區與 CLI](skills/taiwan-plant-red-list/references/workspace.md)。科學判讀見 [評估方法](skills/taiwan-plant-red-list/references/method.md)。

工作檔預設放在 Git 忽略的 `assessments/`，可透過 `RED_LIST_WORKSPACE` 指定其他個人路徑。換模型時可接續同一份清單、快照及評估檔。`npm test` 執行離線測試。

## 資料與授權

- 原創程式與指南採 [MIT](LICENSE)。
- 隨附的《2017 臺灣維管束植物紅皮書名錄》由臺灣植物紅皮書編輯委員會編著，特有生物研究保育中心、林務局及臺灣植物分類學會出版。檔案原樣收錄，採 CC BY 4.0。其用途為歷史評估參考。 [出版頁](https://www.tbri.gov.tw/view.php?id=653&theme=web_structure) · [授權紀錄](https://commons.wikimedia.org/wiki/File:The_Red_List_of_Vascular_Plants_of_Taiwan,_2017.pdf) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 離線底圖擷取自 Natural Earth v5.1.2 的公眾領域圖資，為分布圖定位背景。 [底圖來源與授權](https://www.naturalearthdata.com/about/terms-of-use/)
- IUCN 準則與指引由來源目錄連到官方版本。外部觀測資料保留其原有授權，逐資料集及紀錄核對。 [來源目錄](skills/taiwan-plant-red-list/references/sources.json)

工作流程參考 `ai-redlist-assessments` 的分項查核概念，以單一 agent 和臺灣區域指引設計。分布圖沿用原評估小幫手的點位、網格、凸包三層呈現，由 CLI 產生 SVG。 [參考儲存庫](https://github.com/shaneweisz/ai-redlist-assessments) · [原評估小幫手](https://taiwan-plant-red-list-helper.lecanorchis.chatgpt.site/)

第一階段交付個人草稿與人工審閱報告。資料上傳、多人整合及互評留待下一階段。分類來源優先序和報告格式可由首批實際評估案例校正。
