const App = (() => {
  let results = JSON.parse(localStorage.getItem(RANLEE_CONFIG.resultsKey) || '[]');
  let watch = JSON.parse(localStorage.getItem(RANLEE_CONFIG.watchKey) || '[]');
  let stockInfoCache = [];
  const $ = id => document.getElementById(id);

  function init(){
    setDefaultDates();
    loadSettingsToInputs();
    bindEvents();
    renderCards();
    renderResults(results);
    renderWatch();
    tick(); setInterval(tick, 1000);
    highlightNav(); window.addEventListener('scroll', highlightNav);
  }

  function setDefaultDates(){
    const end = new Date();
    const start = new Date(); start.setDate(end.getDate() - 130);
    $('endDate').value = toDate(end);
    $('startDate').value = toDate(start);
  }
  function toDate(d){ return d.toISOString().slice(0,10); }

  function loadSettingsToInputs(){
    const s = Api.getSettings();
    ['finmindToken','fugleKey','openaiKey','proxyUrl'].forEach(id => { if($(id)) $(id).value = s[id] || ''; });
  }
  function saveSettingsFromInputs(){
    Api.saveSettings({
      finmindToken: $('finmindToken').value.trim(),
      fugleKey: $('fugleKey').value.trim(),
      openaiKey: $('openaiKey').value.trim(),
      proxyUrl: $('proxyUrl').value.trim()
    });
  }

  function bindEvents(){
    $('saveKeysBtn').addEventListener('click', () => { saveSettingsFromInputs(); setStatus('saveStatus','✅ 已儲存到本機瀏覽器'); });
    document.querySelectorAll('[data-test]').forEach(btn => btn.addEventListener('click', async () => {
      saveSettingsFromInputs();
      const type = btn.dataset.test;
      setStatus(`${type}Status`, '🔄 測試中...');
      try{ setStatus(`${type}Status`, await Api.test(type), 'ok'); }
      catch(err){ setStatus(`${type}Status`, `❌ ${err.message}`, 'bad'); }
    }));
    $('loadInfoBtn').addEventListener('click', loadInfo);
    $('scanNowBtn').addEventListener('click', runScan);
    $('searchBox').addEventListener('input', () => renderResults(results));
    $('singleBtn').addEventListener('click', analyzeSingle);
    $('singleInput').addEventListener('keydown', e => { if(e.key === 'Enter') analyzeSingle(); });
  }

  async function loadInfo(){
    saveSettingsFromInputs();
    log('📥 載入股票清單中...');
    try{
      stockInfoCache = await Api.getStockInfo();
      log(`✅ 已載入 ${stockInfoCache.length} 支上市櫃股票。`);
      $('marketStatus').textContent = '股票清單就緒';
    }catch(err){ log(`❌ 載入失敗：${err.message}`); }
  }

  async function runScan(){
    saveSettingsFromInputs();
    $('scanNowBtn').disabled = true;
    $('progressFill').style.width = '0%';
    log('🔥 開始全市場掃描。請注意：純前端逐檔抓資料會比較慢，先用數量上限控制。');
    try{
      const opts = {
        market: $('marketFilter').value,
        minScore: Number($('minScore').value),
        minVolume: Number($('minVolume').value),
        limit: Number($('scanLimit').value),
        startDate: $('startDate').value,
        endDate: $('endDate').value,
        aiLimit: Number($('aiLimit').value)
      };
      const out = await Scanner.scan(opts, {
        onLog: msg => log(msg),
        onProgress: pct => $('progressFill').style.width = pct + '%'
      });
      results = out.results.slice(0,50);
      localStorage.setItem(RANLEE_CONFIG.resultsKey, JSON.stringify(results));
      renderCards(out.total);
      renderResults(results);
      $('scanCount').textContent = `掃描 ${out.total} 支`;
      $('bestStock').textContent = results[0] ? `最強 ${results[0].name} ${results[0].score}` : '最強 -';
      $('marketStatus').textContent = '掃描完成';
      log(`✅ 掃描完成：入選 ${results.length} 支。錯誤 ${out.errors.length} 筆。`);
      if(out.errors.length) log(`⚠️ 部分錯誤：\n${out.errors.slice(0,8).join('\n')}`);
      await makeAiSummary(results, opts.aiLimit);
    }catch(err){ log(`❌ 掃描失敗：${err.message}`); }
    finally{ $('scanNowBtn').disabled = false; }
  }

  async function makeAiSummary(rows, limit){
    if(!rows.length){ $('aiSummary').textContent = '沒有入選股票。'; return; }
    const settings = Api.getSettings();
    if(!settings.openaiKey || Number(limit) <= 0){
      $('aiSummary').innerHTML = localSummary(rows);
      return;
    }
    try{
      $('aiSummary').textContent = '🤖 OpenAI 分析中...';
      const txt = await Api.askOpenAI(Scanner.buildAiPrompt(rows.slice(0, limit)));
      $('aiSummary').textContent = txt;
    }catch(err){
      $('aiSummary').innerHTML = localSummary(rows) + `<br><br><span class="score-low">OpenAI 失敗：${escapeHtml(err.message)}</span>`;
    }
  }

  function localSummary(rows){
    const top = rows.slice(0,3).map(s => `${s.code} ${s.name}（${s.score}分 / ${s.pattern}）`).join('、');
    const risk = rows.filter(s => s.riskScore >= 60).slice(0,3).map(s => `${s.code} ${s.name}`).join('、') || '暫無高風險名單';
    return `本次最值得觀察：<b>${top}</b>。<br>高風險提醒：${risk}。<br>明日重點：只看突破是否有量、回測是否守住 MA20；分數高不是無腦買點。`;
  }

  async function analyzeSingle(){
    saveSettingsFromInputs();
    const code = $('singleInput').value.trim().match(/\d{4}/)?.[0];
    if(!code){ $('detailBox').textContent = '請輸入 4 碼股票代號。'; return; }
    $('detailBox').textContent = '分析中...';
    try{
      let info = stockInfoCache.find(x => x.code === code) || results.find(x => x.code === code);
      if(!info){
        if(!stockInfoCache.length) stockInfoCache = await Api.getStockInfo();
        info = stockInfoCache.find(x => x.code === code) || { code, name:'未知', market:'' };
      }
      const rows = await Api.getDailyPrice(code, $('startDate').value, $('endDate').value);
      const analyzed = Scanner.analyzeDaily(info, rows);
      if(!analyzed){ $('detailBox').textContent = '資料不足，無法分析。'; return; }
      renderDetail(analyzed);
    }catch(err){ $('detailBox').textContent = `失敗：${err.message}`; }
  }

  function renderCards(total=0){
    const avg = results.length ? Math.round(results.reduce((a,b)=>a+b.score,0)/results.length) : 0;
    const high = results.filter(x=>x.score>=85).length;
    const risk = results.filter(x=>x.riskScore>=60).length;
    $('cards').innerHTML = [
      ['本次掃描', total || results.length, '資料來源 API'],
      ['入選 TOP', results.length, '符合門檻'],
      ['平均主力分', avg, '只看入選股'],
      ['高分 / 高風險', `${high} / ${risk}`, '嚴禁追高']
    ].map(c => `<div class="card"><div class="metric">${c[0]}</div><div class="big">${c[1]}</div><div class="muted">${c[2]}</div></div>`).join('');
  }

  function renderResults(rows){
    const q = $('searchBox')?.value?.trim() || '';
    const filtered = rows.filter(s => !q || s.code.includes(q) || s.name.includes(q));
    if(!filtered.length){ $('resultBody').innerHTML = '<tr><td colspan="10" class="empty">沒有資料</td></tr>'; return; }
    $('resultBody').innerHTML = filtered.map((s,i) => `<tr>
      <td>${i+1}</td>
      <td><b>${s.code}</b> ${escapeHtml(s.name)}</td>
      <td><span class="pill pb">${s.market}</span></td>
      <td>${s.close}</td>
      <td class="${s.changePct>=0?'score-high':'score-low'}">${s.changePct}%</td>
      <td>${formatVolume(s.volume)}</td>
      <td><span class="pill ${pillClass(s.score)}">${s.score}</span></td>
      <td>${s.pattern}</td>
      <td>${s.suggestion}</td>
      <td><button class="btn secondary" onclick="App.pick('${s.code}')">分析</button> <button class="btn secondary" onclick="App.toggleWatch('${s.code}')">⭐</button></td>
    </tr>`).join('');
  }

  function renderDetail(s){
    $('detailBox').innerHTML = `<h3>${s.code} ${escapeHtml(s.name)}｜${s.pattern}｜主力分 ${s.score}</h3>
      <div class="detail-grid">
        ${detailCard('收盤價', s.close)}${detailCard('漲跌幅', s.changePct + '%')}${detailCard('量比', s.volumeRatio)}${detailCard('距突破', s.distToBreakout + '%')}
        ${detailCard('MA5/20', `${s.ma5} / ${s.ma20}`)}${detailCard('20日箱體', `${s.low20} ~ ${s.high20}`)}${detailCard('箱體幅度', s.boxPct + '%')}${detailCard('風險分', s.riskScore)}
      </div>
      <div class="ai-box" style="margin-top:12px"><b>結論：</b>${s.suggestion}<br><b>判斷：</b>趨勢 ${s.trendScore}、量能 ${s.volumeScore}、築底 ${s.baseScore}、突破 ${s.breakoutScore}、風險 ${s.riskScore}。</div>`;
  }
  function detailCard(k,v){ return `<div class="detail-card"><div class="metric">${k}</div><div class="big">${v}</div></div>`; }

  function pick(code){ $('singleInput').value = code; location.hash = '#detail'; analyzeSingle(); }
  function toggleWatch(code){
    const row = results.find(x=>x.code===code) || { code, name:'' };
    const idx = watch.findIndex(x=>x.code===code);
    if(idx >= 0) watch.splice(idx,1); else watch.push({ code: row.code, name: row.name, addedAt: new Date().toISOString() });
    localStorage.setItem(RANLEE_CONFIG.watchKey, JSON.stringify(watch));
    renderWatch();
  }
  function renderWatch(){
    if(!watch.length){ $('watchList').innerHTML = '<div class="card muted">尚未加入 WatchList。</div>'; return; }
    $('watchList').innerHTML = watch.map(w => `<div class="card watch-item"><div><b>${w.code}</b> ${escapeHtml(w.name)}</div><div><button class="btn secondary" onclick="App.pick('${w.code}')">分析</button><button class="btn secondary" onclick="App.toggleWatch('${w.code}')">移除</button></div></div>`).join('');
  }

  function log(msg){ $('scanLog').textContent += ($('scanLog').textContent ? '\n' : '') + `[${new Date().toLocaleTimeString()}] ${msg}`; $('scanLog').scrollTop = $('scanLog').scrollHeight; }
  function setStatus(id, msg, type=''){ const el=$(id); el.textContent=msg; el.style.color=type==='ok'?'#86efac':type==='bad'?'#fca5a5':'#cbd5e1'; }
  function tick(){ $('clock').textContent = new Date().toLocaleTimeString('zh-TW', { hour12:false }); }
  function pillClass(v){ return v>=85?'pg':v>=70?'pw':'pr'; }
  function formatVolume(v){ if(v>=100000000) return (v/100000000).toFixed(1)+'億'; if(v>=10000) return (v/10000).toFixed(1)+'萬'; return String(v||0); }
  function escapeHtml(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function highlightNav(){
    const secs = [...document.querySelectorAll('.section')];
    let id = secs[0].id;
    secs.forEach(sec => { if(scrollY >= sec.offsetTop - 90) id = sec.id; });
    document.querySelectorAll('.nav').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#'+id));
  }
  return { init, pick, toggleWatch };
})();

document.addEventListener('DOMContentLoaded', App.init);
