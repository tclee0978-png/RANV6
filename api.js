const Api = (() => {
  const cfg = window.RANLEE_CONFIG;

  function getSettings() {
    return JSON.parse(localStorage.getItem(cfg.storageKey) || '{}');
  }

  function saveSettings(data) {
    localStorage.setItem(cfg.storageKey, JSON.stringify(data));
  }

  function buildUrl(base, params) {
    const url = new URL(base);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        url.searchParams.set(k, v);
      }
    });
    return url.toString();
  }

  async function safeFetch(url, options = {}) {
    const settings = getSettings();

    const proxy = (settings.proxyUrl || cfg.proxyUrl || '')
      .trim()
      .replace(/\/$/, '');

    const finalUrl = proxy
      ? `${proxy}?url=${encodeURIComponent(url)}`
      : url;

    const res = await fetch(finalUrl, options);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text.slice(0, 160)}`);
    }

    return res.json();
  }

  async function finmind(dataset, params = {}) {
    const settings = getSettings();
    const token = settings.finmindToken || '';

    const url = buildUrl(cfg.finmindBase, {
      dataset,
      token,
      ...params
    });

    return safeFetch(url);
  }

  async function getStockInfo() {
    const data = await finmind('TaiwanStockInfo');
    const rows = Array.isArray(data.data) ? data.data : [];

    return rows
      .filter(x => /^\d{4}$/.test(String(x.stock_id || '')))
      .map(x => ({
        code: String(x.stock_id),
        name: x.stock_name || '',
        industry: x.industry_category || '',
        market: normalizeMarket(x.type || x.market || '')
      }))
      .filter(x => x.market === 'TWSE' || x.market === 'TPEX');
  }

  async function getDailyPrice(code, startDate, endDate) {
    const data = await finmind('TaiwanStockPrice', {
      data_id: code,
      start_date: startDate,
      end_date: endDate
    });

    const rows = Array.isArray(data.data) ? data.data : [];

    return rows
      .map(r => ({
        date: r.date,
        code: String(r.stock_id || code),
        open: Number(r.open || 0),
        high: Number(r.max || r.high || 0),
        low: Number(r.min || r.low || 0),
        close: Number(r.close || 0),
        volume: Number(r.Trading_Volume || r.trading_volume || 0),
        value: Number(r.Trading_money || r.trading_money || 0),
        spread: Number(r.spread || 0)
      }))
      .filter(x => x.close > 0);
  }

  async function getFugleQuote(code) {
    const settings = getSettings();
    const key = settings.fugleKey || '';

    if (!key) throw new Error('缺 Fugle API Key');

    const url = `${cfg.fugleBase}/intraday/quote/${encodeURIComponent(code)}?apiKey=${encodeURIComponent(key)}`;

    return safeFetch(url);
  }

  async function askOpenAI(prompt) {
    const settings = getSettings();
    const key = settings.openaiKey || '';

    if (!key) throw new Error('缺 OpenAI API Key');

    const body = {
      model: cfg.defaultModel,
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
      const data = await finmind('TaiwanStockInfo');
      return `成功：取得 ${Array.isArray(data.data) ? data.data.length : 0} 筆股票資訊`;
    }

    if (type === 'fugle') {
      const data = await getFugleQuote('2330');
      return `成功：Fugle 2330 回應 OK，欄位 ${Object.keys(data).slice(0, 5).join(', ')}`;
    }

    if (type === 'openai') {
      const txt = await askOpenAI('只回答：連線成功');
      return `成功：${txt.slice(0, 80)}`;
    }

    throw new Error('未知測試類型');
  }

  function normalizeMarket(type) {
    const t = String(type).toLowerCase();

    if (t.includes('twse') || t.includes('上市')) return 'TWSE';
    if (t.includes('tpex') || t.includes('otc') || t.includes('上櫃')) return 'TPEX';

    return String(type).toUpperCase();
  }

  return {
    getSettings,
    saveSettings,
    getStockInfo,
    getDailyPrice,
    getFugleQuote,
    askOpenAI,
    test
  };
})();
