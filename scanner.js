const Scanner = (() => {
  function sma(values, n){
    if(values.length < n) return null;
    const arr = values.slice(-n);
    return arr.reduce((a,b)=>a+b,0) / n;
  }
  function pct(a,b){
    if(!b) return 0;
    return (a-b)/b*100;
  }
  function maxBy(rows, key){ return Math.max(...rows.map(r => Number(r[key] || 0))); }
  function minBy(rows, key){ return Math.min(...rows.map(r => Number(r[key] || 0))); }
  function clamp(v, min=0, max=100){ return Math.max(min, Math.min(max, v)); }
  function avg(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

  function analyzeDaily(stock, rows){
    if(!rows || rows.length < 20) return null;
    const sorted = [...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2] || last;
    const closes = sorted.map(x=>x.close);
    const vols = sorted.map(x=>x.volume);
    const ma5 = sma(closes, 5);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);
    const ma60 = sma(closes, 60) || ma20;
    const v5 = sma(vols, 5) || last.volume;
    const v20 = sma(vols, 20) || v5;
    const recent20 = sorted.slice(-20);
    const recent60 = sorted.slice(-60);
    const high20 = maxBy(recent20, 'high');
    const low20 = minBy(recent20, 'low');
    const high60 = maxBy(recent60, 'high');
    const low60 = minBy(recent60, 'low');
    const boxPct = pct(high20, low20);
    const changePct = pct(last.close, prev.close);
    const distToBreakout = pct(high20, last.close);
    const volumeRatio = v20 ? last.volume / v20 : 1;
    const trendScore = clamp((last.close > ma5 ? 18 : 0) + (last.close > ma10 ? 18 : 0) + (last.close > ma20 ? 18 : 0) + (ma20 > ma60 ? 18 : 0) + (ma5 > ma20 ? 18 : 0) + 10);
    const volumeScore = clamp(volumeRatio * 35 + (v5 > v20 ? 20 : 0) + (last.volume > 500000 ? 15 : 0));
    const baseScore = clamp(100 - boxPct * 2.2 + (sorted.length >= 60 ? 12 : 0));
    const breakoutScore = clamp(100 - Math.abs(distToBreakout) * 9 + (last.close >= high20 * .97 ? 18 : 0));
    const riskScore = clamp((changePct > 7 ? 25 : 0) + (last.close > ma20 * 1.18 ? 25 : 0) + (volumeRatio > 3 && changePct < 2 ? 30 : 0) + (pct(last.close, low60) > 60 ? 20 : 0));
    const rawScore = trendScore * .33 + volumeScore * .20 + baseScore * .18 + breakoutScore * .22 - riskScore * .18 + 8;
    const score = Math.round(clamp(rawScore));
    const pattern = detectPattern({ last, ma5, ma10, ma20, ma60, boxPct, distToBreakout, volumeRatio, changePct, riskScore });
    const suggestion = suggest(score, pattern, riskScore, distToBreakout, changePct);

    return {
      code: stock.code,
      name: stock.name,
      market: stock.market,
      industry: stock.industry,
      date: last.date,
      close: round(last.close),
      changePct: round(changePct, 2),
      volume: last.volume,
      ma5: round(ma5), ma10: round(ma10), ma20: round(ma20), ma60: round(ma60),
      high20: round(high20), low20: round(low20), high60: round(high60), low60: round(low60),
      boxPct: round(boxPct, 2),
      distToBreakout: round(distToBreakout, 2),
      volumeRatio: round(volumeRatio, 2),
      trendScore: Math.round(trendScore),
      volumeScore: Math.round(volumeScore),
      baseScore: Math.round(baseScore),
      breakoutScore: Math.round(breakoutScore),
      riskScore: Math.round(riskScore),
      score,
      pattern,
      suggestion,
      rows: sorted.slice(-80)
    };
  }

  function detectPattern(x){
    if(x.riskScore >= 65) return '派貨警戒';
    if(x.distToBreakout <= 3 && x.volumeRatio >= 1.2 && x.last.close > x.ma20) return '突破臨界';
    if(x.last.close > x.ma5 && x.ma5 > x.ma20 && x.volumeRatio > 1.5) return '主升啟動';
    if(x.boxPct <= 16 && x.last.close >= x.ma20 * .96) return '箱型築底';
    if(x.last.close > x.ma20 && x.volumeRatio < .85) return '洗盤量縮';
    if(x.last.close < x.ma20) return '弱勢整理';
    return '觀察中';
  }

  function suggest(score, pattern, risk, dist, change){
    if(risk >= 65) return '不追高，等回檔';
    if(score >= 85 && pattern.includes('突破')) return '等放量突破確認';
    if(score >= 80 && change < 5) return '列入隔日觀察';
    if(score >= 70) return '小量追蹤，不急買';
    return '淘汰或等待轉強';
  }

  function round(v, d=2){
    if(v === null || v === undefined || Number.isNaN(v)) return 0;
    return Number(Number(v).toFixed(d));
  }

  async function scan(options, hooks = {}){
    const { onLog=()=>{}, onProgress=()=>{} } = hooks;
    const info = await Api.getStockInfo();
    onLog(`✅ 股票清單載入：${info.length} 支`);

    let stocks = info.filter(s => {
      if(options.market === 'twse') return s.market === 'TWSE';
      if(options.market === 'tpex') return s.market === 'TPEX';
      return s.market === 'TWSE' || s.market === 'TPEX';
    });

    stocks = stocks.slice(0, Number(options.limit || 300));
    const results = [];
    const errors = [];

    for(let i=0; i<stocks.length; i++){
      const s = stocks[i];
      try{
        const rows = await Api.getDailyPrice(s.code, options.startDate, options.endDate);
        const analyzed = analyzeDaily(s, rows);
        if(analyzed && analyzed.volume >= Number(options.minVolume || 0) && analyzed.score >= Number(options.minScore || 0)){
          results.push(analyzed);
        }
      }catch(err){
        errors.push(`${s.code} ${s.name}: ${err.message}`);
      }
      if(i % 5 === 0 || i === stocks.length - 1){
        onProgress(Math.round((i+1)/stocks.length*100));
        onLog(`掃描進度 ${i+1}/${stocks.length}，目前入選 ${results.length} 支`);
        await new Promise(r => setTimeout(r, 80));
      }
    }

    results.sort((a,b) => b.score - a.score || b.volume - a.volume);
    return { results, errors, total: stocks.length };
  }

  function buildAiPrompt(rows){
    const top = rows.slice(0, 10).map((s,i) => `${i+1}. ${s.code} ${s.name} 分數${s.score} 型態${s.pattern} 收盤${s.close} 漲跌${s.changePct}% 量比${s.volumeRatio} 風險${s.riskScore}`).join('\n');
    return `請用繁體中文，針對以下台股掃描結果做極簡戰術點評。\n要求：1. 不保證獲利 2. 說明最值得觀察前三名 3. 說明最大風險 4. 給明日觀盤重點。\n${top}`;
  }

  return { scan, analyzeDaily, buildAiPrompt };
})();
