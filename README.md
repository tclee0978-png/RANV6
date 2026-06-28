# 然然贏家 Pro V6 Ultimate

這是 GitHub Pages 可直接部署的多檔案版本。

## 檔案
- index.html：主頁面
- style.css：介面樣式
- config.js：API 基本設定
- api.js：FinMind / Fugle / OpenAI 串接
- scanner.js：量化掃描與評分邏輯
- app.js：頁面互動與渲染

## 部署方式
1. 到你的 GitHub repo：RANLEE123
2. 刪掉舊的 index.html 或先備份
3. 上傳這 6 個檔案到 repo 根目錄
4. GitHub Pages 等 1～3 分鐘更新
5. 開啟網頁後，到「API 設定」貼上 FinMind Token

## 重要限制
GitHub Pages 是純前端，API Key 存在瀏覽器 LocalStorage，個人測試可以，正式實戰不建議。
如果遇到 Failed to fetch / CORS，請使用 Cloudflare Worker Proxy。

## 資料源
- FinMind：股票清單 TaiwanStockInfo、歷史日線 TaiwanStockPrice
- Fugle：盤中即時報價 intraday quote
- OpenAI：TOP 股票 AI 點評

## 操作建議
先把掃描上限設 100～300 測試，確認 Token 正常後再提高到 1000 以上。
