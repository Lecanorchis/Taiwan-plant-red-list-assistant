# 個人工作區與 CLI

用 `node <技能目錄>/scripts/redlist.mjs help` 查看命令。stdout 為 JSON，`help` 為純文字。退出碼 1 表示執行失敗，或 `validate` 尚未通過。預設 `./assessments/`，也可用 `RED_LIST_WORKSPACE` 指定路徑。放在個人位置以便換模型續作，避免將工作區放在公開儲存庫的其他路徑。

## 清單與分類

1. `init "臺灣本島、澎湖、蘭嶼、綠島"` 建立工作區。範例中的範圍可依評估目的調整，並與使用者確認。
2. `add <list.json>` 接受物件陣列。每筆需有 `id`、`scientificName`、`rank`。階層為 `species`、`subspecies` 或 `variety`。可附 `vernacularName` 及指向清單上位分類群的 `parentId`。ID 須為小寫英數加連字號，且以英文字母開頭。相同清單可重送，既有評估保留。後續發現有種下單位時，先核對並更新清單階層再續評。
3. `list` 顯示清單、末端標記與進度。`taxon "名稱"` 查 TBN 候選，`taxon "學名" gbif` 查 GBIF 候選。查詢回傳資料須和臺灣物種名錄或適當分類來源交叉核對。GBIF 如回傳異名，查證並採用相同階層的接受名 key。確認後編輯 `taxa/<id>.json` 的 `taxon`，填 `confirmed: true`、`authority`、對應 `tbnUuid` 或 `gbifKey`，必要時填 `synonyms` 與 `notes`。

## 分布與人工篩選

1. `occurrences <id> tbn 10` 依確認的 TBN UUID 查 v26 開放端點，保存每頁原始回傳、URL、查詢時間與頁數截斷狀態。`occurrences <id> gbif 10` 查 GBIF `country=TW` 的存在紀錄。兩個來源的涵蓋範圍與評估邊界可能不同，特別需查漏離島。換來源時重新核對識別碼和範圍，保留查詢失敗紀錄。
2. `review <id> <snapshot.json>` 產生篩選表，初始決策全部是 `pending`。以紀錄 ID 逐筆核對，填 `reviewer` 及 `decision`（`include`、`exclude`、`pending`）。納入及排除都需填 `rationale`。查現存野生族群、分類、區域、採集年代及來源，排除栽培、逸失、重複採集及位置不可靠的點。來源不明或紀錄不足時保留待查。若把不確定性缺值的紀錄納入，需引用可查的座標品質依據。工具會拒絕把分類不符、無有效座標、已模糊化或誤差達 2 公里的點用於精細網格。重複 ID 需另外釐清來源。
3. `range <id> <snapshot.json> <review.json> [boundary.geojson]` 產生 `range/<id>/<run>/range.json`、篩選表副本及 `map.svg`。選用底圖時請提供 WGS84 Polygon 或 MultiPolygon GeoJSON，圖層只供視覺定位。可用瀏覽器離線開 SVG，滑鼠移到點上可看紀錄 ID。快照雜湊不同時須重新篩選。

## 報告欄位

在 `taxa/<id>.json` 維護以下欄位，逐步更新並用 `report <id>` 產生 `reports/<id>/<版本>.md`。報告可在審閱前輸出，會列出待辦。每次內容變更會保留一份新版。以 `validate <id>` 檢查結構與證據參照，再由使用者判讀科學內容。

| 欄位 | 寫入內容 |
| --- | --- |
| `eligibility` | `status` 為 `unresolved`、`eligible` 或 `not-applicable`，加 `rationale` 及證據 ID 陣列 `evidence`。 |
| `evidence[]` | 每筆用 `{ "id": "e1", "citation": "作者、年份、DOI 或資料集", "locator": "頁碼、圖表、紀錄 ID 或快照路徑", "finding": "可查證的觀察與限制" }`。空間證據另記查詢時間、點數及截斷狀態，資料集附其授權及歸屬。 |
| `criteria.A` 至 `criteria.E` | 每項含 `status`（`pending`、`insufficient`、`not-met`、`met`）、`rationale`、`evidence`、`codes`。`met` 填成立的準則代碼。 |
| `preliminary` | 區內初評的 `category`、`rationale` 及同級成立的 `codes`。未知時 `category: null`，不適用者直接記錄區域 NA。 |
| `regional` | `outcome` 為 `pending`、`unchanged`、`uplisted`、`downlisted` 或 `not-applicable`，加 `category`、`rationale` 與 `evidence`。待查時 `category: null`。 |
| `uncertainties` | 文字陣列，記錄不確定性、合理範圍、分歧及待查問題。 |
| `reviewer` | 使用者完成審閱後才填 `name` 與 ISO `date`。 |

對外引用時，2017 名錄採 CC BY 4.0 並附原始出處與頁碼。GBIF 紀錄各有授權，應核對資料集及資料出版者歸屬，正式報告若用 GBIF 可另外取得有 DOI 的資料下載。分布快照、篩選表、圖及報告是個人工作資料，分享前由使用者檢視可公開範圍。
