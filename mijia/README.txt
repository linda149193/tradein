米家捷報｜Xiaomi 門市報價 — 網站檔案

【內容】
index.html          主程式（報價頁）
config.js           設定檔：Google Drive API 金鑰、舊換新資料夾 ID（管理員只需改這個）
tradein.json        內建的舊換新資料（2026-11-25，11/25–01/03）
parse.js            解析回收價／加碼金 PDF 的程式（沿用舊換新估價 App）
vendor/             PDF 解析元件（pdf.js）
img/                商品照片

【上傳到 GitHub Pages（建議放在舊換新 App 同一個 repo）】
1. 打開 GitHub 上的 tradein repo，進入 Add file → Upload files。
2. 把整個「mijia」資料夾拖進去（保持資料夾結構），按 Commit changes。
3. 約 1 分鐘後網址會是：https://linda149193.github.io/tradein/mijia/
4. 手機用 Safari／Chrome 打開，選「加到主畫面」，就能像 App 一樣使用。

【Google Drive 自動更新】
- 「從 Drive 更新」會用 config.js 的 API 金鑰，搜尋兩個資料夾（含 2026、2027… 子資料夾）裡最新上傳的 PDF。
- 金鑰若有限制網站來源，放在 linda149193.github.io 底下即可沿用；放到其他網址需在 Google Cloud 加入該網址。
- 資料夾與 PDF 需設為「知道連結的人都能檢視」。
- 抓不到時，可改用頁面上的「貼上新的 Drive 連結更新」或「手動選擇 PDF」。

【注意】
- 需透過網址開啟（GitHub Pages 或其他網站），直接在電腦上雙擊 index.html 開啟時，舊換新資料與 PDF 解析可能無法載入。
- 報價單 PDF 會直接下載到裝置。
