const Api = (() => {
  const cfg = window.RANLEE_CONFIG;

  const WORKER_URL =
    cfg.proxyUrl || 'https://ranwinner-api.tclee0978.workers.dev';

  async function safeFetch(url) {
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text.slice(0, 160)}`);
    }

    return res.json();
  }

  async function getTwseQuotes() {
    const url = `${WORKER_URL.replace(/\/$/, '')}/?target=twse`;
    const rows = await safeFetch(url);

    if (!Array.isArray(rows)) {
      throw new Error('TWSE 回傳格式不是陣列');
    }

    return rows
      .map(r => {
        const code =
          r.Code ||
          r.code ||
          r['證券代號'] ||
          r['有價證券代號'] ||
          '';

        const name =
          r.Name ||
          r.name ||
          r['證券名稱'] ||
          r['有價證券名稱'] ||
          '';

        const close = num(
          r.ClosingPrice ||
          r.Close ||
          r.close ||
          r['收盤價']
        );

        const open = num(
          r.OpeningPrice ||
          r.Open ||
          r.open ||
          r['開盤價']
        );

        const high = num(
          r.HighestPrice ||
          r.High ||
          r.high ||
          r['最高價']
        );

        const low = num(
          r.LowestPrice ||
          r.Low ||
          r.low ||
          r['最低價']
        );

        const volume = num(
          r.TradeVolume ||
          r.Volume ||
          r.volume ||
          r['成交股數']
        );

        const change = num(
          r.Change ||
          r.change ||
          r['漲跌價差']
        );

        const changePct =
          close && open
            ? Number((((close - open) / open) * 100).toFixed(2))
            : 0;

        return {
          code: String(code).trim(),
          name: String(name).trim(),
          market: 'TWSE',
          open,
          high,
          low,
          close,
          volume,
          change,
          changePct
        };
      })
      .filter(x => /^\d{4}$/.test(x.code) && x.close > 0);
  }

  async function getMarketQuotes() {
    const twse = await getTwseQuotes();
    return twse;
  }

  async function getStockInfo() {
    const rows = await getMarketQuotes();

    return rows.map(x => ({
      code: x.code,
      name: x.name,
      market: x.market,
      industry: ''
    }));
  }

  async function getDailyPrice(code) {
    const rows = await getMarketQuotes();
    const found = rows.find(x => x.code === String(code));

    if (!found) return [];

    return [{
      date: new Date().toISOString().slice(0, 10),
      code: found.code,
      open: found.open,
      high: found.high,
      low: found.low,
      close: found.close,
      volume: found.volume,
      value: 0,
      spread: found.change
    }];
  }

  async function getFugleQuote(code) {
    const rows = await getMarketQuotes();
    const found = rows.find(x => x.code === String(code));

    if (!found) {
      throw new Error(`查無 ${code}`);
    }

    return found;
  }

  async function askOpenAI(prompt) {
    const settings = getSettings();
    const key = settings.openaiKey || '';

    if (!key) {
      return '未設定 OpenAI Key，已使用本地量價規則完成掃描。';
    }

    const body = {
      model: cfg.defaultModel || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '你是台股量化交易助理。回答要精簡、保守、重視風險，不保證獲利。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2
    };

    const res = await fetch(cfg.openaiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${res.status} ${text.slice(0, 160)}`);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content || 'AI 無回應';
  }

  async function test(type) {
    if (type === 'finmind') {
      const rows = await getTwseQuotes();
      return `成功：V7 Free 已取得上市 ${rows.length} 支股票，不需 FinMind Token`;
    }

    if (type === 'fugle') {
      const rows = await getTwseQuotes();
      const tsmc = rows.find(x => x.code === '2330');
      return `成功：V7 Free 即時資料 OK，2330 收盤 ${tsmc?.close || '-'}`;
    }

    if (type === 'openai') {
      const txt = await askOpenAI('只回答：連線成功');
      return `成功：${txt.slice(0, 80)}`;
    }

    throw new Error('未知測試類型');
  }

  function getSettings() {
    return JSON.parse(localStorage.getItem(cfg.storageKey) || '{}');
  }

  function saveSettings(data) {
    localStorage.setItem(cfg.storageKey, JSON.stringify(data));
  }

  function num(v) {
    if (v === undefined || v === null) return 0;
    return Number(String(v).replace(/,/g, '').replace(/X/g, '').trim()) || 0;
  }

  return {
    getSettings,
    saveSettings,
    getStockInfo,
    getDailyPrice,
    getFugleQuote,
    askOpenAI,
    test,
    getMarketQuotes
  };
})();
