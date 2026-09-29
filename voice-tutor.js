/* ================= Voice tutor – free conversation + guided voice lesson, on every page =================
   Hebrew speech in (Web Speech API), Claude streaming answers, Hebrew speech out (speechSynthesis).
   Self-contained: drop <script src="voice-tutor.js"></script> into any page of the site. */
(function(){
  if (window.__VT) return; window.__VT = true;
  const LS = {
    get(k, d){ try { const v = localStorage.getItem('vt.' + k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
    set(k, v){ try { localStorage.setItem('vt.' + k, JSON.stringify(v)); } catch(e){} }
  };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = window.speechSynthesis;
  // phones beep on every mic restart, so they retry silence less before pausing
  const TOUCH = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  const MODES = {
    free:   {label: '🗣️ שיחה חופשית', hint: 'שואלים כל שאלה, והמורה עונה בקול. אפשר לשאול שאלות המשך, להתווכח ולבקש דוגמאות.'},
    guided: {label: '🎓 הדרכה קולית', hint: 'המורה מלמד את הנושא שבעמוד, שלב אחרי שלב: מסביר, שואל אותך, נותן משוב וממשיך.'}
  };
  const S = {
    open: false, mode: LS.get('mode', 'free'), active: false, state: 'idle',
    history: [], rec: null, heard: '', emptyTries: 0, abort: null,
    queue: [], streamDone: true, speaking: false, noFallback: LS.get('noFallback', false)
  };
  const cfg = () => ({
    key: LS.get('key', '') || (window.CBT_AI_CONFIG && window.CBT_AI_CONFIG.anthropicKey) || '',
    model: LS.get('model', 'claude-opus-5-5'),
    voice: LS.get('voice', ''), rate: LS.get('rate', 1.05), autoListen: LS.get('autoListen', true)
  });

  /* ---------- styles ---------- */
  const css = `
.vt-fab{position:fixed;z-index:9990;inset-inline-end:20px;bottom:20px;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;background:var(--accent,#ffda2a);color:var(--accent-ink,#171717);font:700 15px/1 Heebo,Arial,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.35);cursor:pointer}
.vt-fab:hover{transform:translateY(-1px)}
.vt-panel{position:fixed;z-index:9991;inset-inline-end:20px;bottom:20px;width:min(420px,calc(100vw - 32px));height:min(640px,calc(100vh - 40px));display:none;flex-direction:column;background:var(--panel,#1c1c1c);color:var(--ink,#fff);border:1px solid var(--line,#2c2c2c);border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.5);font:15px/1.55 Heebo,Arial,sans-serif;direction:rtl;overflow:hidden}
.vt-panel.on{display:flex}
.vt-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line,#2c2c2c)}
.vt-head b{font-size:16px;flex:1}
.vt-ib{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer;padding:4px 6px;border-radius:8px}
.vt-ib:hover{background:var(--panel2,#242424)}
.vt-ctx{font-size:12.5px;color:var(--muted,#9a9a9a);padding:6px 14px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vt-modes{display:flex;gap:6px;padding:8px 14px}
.vt-mode{flex:1;border:1px solid var(--line,#2c2c2c);background:var(--bg2,#171717);color:inherit;border-radius:12px;padding:8px 6px;font:600 14px Heebo,Arial,sans-serif;cursor:pointer}
.vt-mode.on{border-color:var(--accent,#ffda2a);background:var(--accent-soft,rgba(255,218,42,.14))}
.vt-log{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.vt-msg{max-width:88%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
.vt-msg.me{align-self:flex-start;background:var(--accent,#ffda2a);color:var(--accent-ink,#171717);border-end-start-radius:4px}
.vt-msg.ai{align-self:flex-end;background:var(--panel2,#242424);border-end-end-radius:4px}
.vt-msg.sys{align-self:center;background:transparent;color:var(--muted,#9a9a9a);font-size:13px;text-align:center}
.vt-hint{color:var(--muted,#9a9a9a);font-size:14px;text-align:center;margin:auto 8px}
.vt-stage{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 14px 4px;border-top:1px solid var(--line,#2c2c2c)}
.vt-orb{width:74px;height:74px;border-radius:50%;border:0;cursor:pointer;font-size:30px;background:var(--accent,#ffda2a);color:var(--accent-ink,#171717);box-shadow:0 0 0 0 rgba(255,218,42,.5);transition:transform .15s}
.vt-orb:hover{transform:scale(1.04)}
.vt-orb.listening{animation:vtpulse 1.3s infinite;background:#3fae6a;color:#fff}
.vt-orb.thinking{background:var(--panel2,#242424);color:var(--ink,#fff);animation:vtspin 1.4s linear infinite}
.vt-orb.speaking{background:#3b7ddd;color:#fff;animation:vtpulse 1.8s infinite}
@keyframes vtpulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.35)}70%{box-shadow:0 0 0 16px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
@keyframes vtspin{to{transform:rotate(360deg)}}
.vt-status{font-size:13.5px;color:var(--muted,#9a9a9a);min-height:20px;text-align:center}
.vt-end{border:1px solid var(--line,#2c2c2c);background:transparent;color:inherit;border-radius:999px;padding:4px 14px;font:600 13px Heebo,Arial,sans-serif;cursor:pointer;display:none}
.vt-end.on{display:inline-block}
.vt-type{display:flex;gap:6px;padding:8px 14px 12px}
.vt-type input{flex:1;height:40px;border-radius:999px;border:1px solid var(--line,#2c2c2c);background:var(--bg2,#171717);color:inherit;padding:0 14px;font:inherit;outline:none}
.vt-type input:focus{border-color:var(--accent,#ffda2a)}
.vt-type button{border:0;border-radius:999px;background:var(--accent,#ffda2a);color:var(--accent-ink,#171717);padding:0 14px;font:700 14px Heebo,Arial,sans-serif;cursor:pointer}
.vt-set{position:absolute;inset:52px 0 0;background:var(--panel,#1c1c1c);padding:14px;overflow-y:auto;display:none;flex-direction:column;gap:12px}
.vt-set.on{display:flex}
.vt-set label{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600}
.vt-set input,.vt-set select{height:38px;border-radius:10px;border:1px solid var(--line,#2c2c2c);background:var(--bg2,#171717);color:inherit;padding:0 10px;font:inherit;font-weight:400}
.vt-set .row{flex-direction:row;align-items:center;gap:8px}
.vt-set .row input{height:auto}
.vt-set small{color:var(--muted,#9a9a9a);font-weight:400;font-size:12.5px}
.vt-set .ok{align-self:flex-start;border:0;border-radius:999px;background:var(--accent,#ffda2a);color:var(--accent-ink,#171717);padding:8px 20px;font:700 14px Heebo,Arial,sans-serif;cursor:pointer}
@media (max-width:760px){
  .vt-fab{bottom:calc(80px + env(safe-area-inset-bottom));inset-inline-end:12px;padding:12px 14px;font-size:14px}
  .vt-panel{inset:0;width:100vw;height:100vh;height:100dvh;border-radius:0;border:0;padding-top:env(safe-area-inset-top)}
  .vt-set{inset:calc(52px + env(safe-area-inset-top)) 0 0}
  .vt-type{padding-bottom:calc(12px + env(safe-area-inset-bottom))}
  .vt-type input{font-size:16px}
  .vt-set input,.vt-set select{font-size:16px}
  .vt-orb{width:88px;height:88px;font-size:36px}
  .vt-ib{font-size:22px;padding:6px 10px}
}
.vt-panel,.vt-fab,.vt-orb,.vt-mode{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
@media print{.vt-fab,.vt-panel{display:none!important}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- markup ---------- */
  const fab = document.createElement('button');
  fab.className = 'vt-fab'; fab.type = 'button'; fab.innerHTML = '🎙️ <span>דברו עם המורה</span>';
  fab.title = 'שיחה קולית והדרכה קולית על הנושא שבעמוד';
  const P = document.createElement('div');
  P.className = 'vt-panel'; P.setAttribute('role', 'dialog'); P.setAttribute('aria-label', 'המורה הקולי');
  P.innerHTML = `
  <div class="vt-head"><span style="font-size:20px">🎙️</span><b>המורה הקולי</b>
    <button class="vt-ib" data-vt="new" title="שיחה חדשה">🔄</button>
    <button class="vt-ib" data-vt="settings" title="הגדרות">⚙️</button>
    <button class="vt-ib" data-vt="close" title="סגירה">✕</button></div>
  <div class="vt-ctx" id="vt-ctx"></div>
  <div class="vt-modes">${Object.entries(MODES).map(([k, m]) => `<button type="button" class="vt-mode" data-vt="mode" data-m="${k}">${m.label}</button>`).join('')}</div>
  <div class="vt-log" id="vt-log" aria-live="polite"></div>
  <div class="vt-stage">
    <button type="button" class="vt-orb" id="vt-orb" title="התחלת שיחה">🎙️</button>
    <div class="vt-status" id="vt-status"></div>
    <button type="button" class="vt-end" id="vt-end">⏹ סיום שיחה</button>
  </div>
  <form class="vt-type" id="vt-form"><input id="vt-input" placeholder="או כתבו כאן שאלה…" autocomplete="off"><button type="submit">שליחה</button></form>
  <div class="vt-set" id="vt-set">
    <label>מפתח Claude API
      <input id="vt-key" type="password" autocomplete="off" placeholder="sk-ant-...">
      <small>המפתח נשמר רק בדפדפן הזה, במחשב הזה. מקבלים מפתח ב-console.anthropic.com.</small></label>
    <label>מודל
      <select id="vt-model">
        <option value="claude-opus-5-5">Claude Opus 5.5 – הכי חכם</option>
        <option value="claude-sonnet-5-5">Claude Sonnet 5.5 – מהיר וזול יותר</option>
        <option value="claude-haiku-4-5">Claude Haiku 4.5 – הכי מהיר</option>
      </select></label>
    <label>קול
      <select id="vt-voice"></select>
      <small>את הקולות העבריים הטבעיים ביותר ("Hila" / "Avri") תמצאו בדפדפן Edge.</small></label>
    <label>מהירות דיבור <input id="vt-rate" type="range" min="0.7" max="1.5" step="0.05"></label>
    <label class="row"><input id="vt-auto" type="checkbox"> להמשיך להקשיב אוטומטית אחרי כל תשובה (שיחה רציפה)</label>
    <button type="button" class="ok" data-vt="saveset">שמירה</button>
  </div>`;
  const mount = () => { document.body.appendChild(fab); document.body.appendChild(P); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  const $ = id => P.querySelector('#' + id);

  /* ---------- page context ---------- */
  function pageContext(){
    const root = document.querySelector('#view') || document.querySelector('#app') || document.querySelector('main') || document.body;
    const heading = (document.querySelector('#title') && document.querySelector('#title').innerText.trim())
      || ((root.querySelector('h1') || root.querySelector('h2') || {}).innerText || '').trim()
      || document.title;
    let text = (root.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    if (text.length > 9000) text = text.slice(0, 9000) + '\n…';
    return {heading, text, where: location.hash || '#/'};
  }
  function showCtx(){ const c = pageContext(); $('vt-ctx').textContent = '📍 הנושא עכשיו: ' + c.heading; }

  function systemPrompt(){
    const c = pageContext();
    const base = `את/ה "המורה" – מורה ומדריך/ה קולי/ת, חם/ה וסבלני/ת, באתר הלימוד של נדב דוד (ייעוץ חינוכי וטיפול CBT: חרדה, דיכאון, OCD, ויסות רגשי, ACT, סכמה תרפיה, פסיכולוגיה חיובית, אבחון, חוזרי מנכ"ל ועוד).
התשובות שלך מוקראות בקול, ולכן:
- כתוב/כתבי עברית מדוברת, טבעית וזורמת, כמו בשיחה אמיתית.
- תשובות קצרות: 2–4 משפטים בכל תור, אלא אם ביקשו במפורש הסבר ארוך.
- בלי כותרות, בלי רשימות, בלי כוכביות, בלי אימוג'י ובלי קישורים. מספרים ומונחים לועזיים – לכתוב כפי שהוגים אותם.
- כדי שהשיחה תמשיך, מותר לסיים בשאלה קצרה.
- מדובר בלמידה מקצועית. אל תאבחן/י אנשים אמיתיים. אם עולה סיכון ממשי – להפנות לגורם מקצועי.
הקשר: המשתמש/ת נמצא/ת עכשיו בעמוד "${c.heading}" (${c.where}). זה התוכן שמופיע בעמוד:
<page>
${c.text}
</page>
מותר להסתמך על התוכן הזה ולהרחיב מעבר לו מהידע המקצועי שלך.`;
    const free = `\nמצב: שיחה חופשית. עונים לשאלות, מסבירים, נותנים דוגמאות מבית הספר ומנהלים דיון. אם המשתמש/ת רוצה, אפשר לתרגל מקרה (משחק תפקידים, למשל תלמיד/ה או הורה) או לבחון אותו/ה.`;
    const guided = `\nמצב: הדרכה קולית. את/ה מוביל/ה שיעור קולי על הנושא של העמוד:
1. בתור הראשון: ברכה קצרה, מה נלמד (בשלושה חלקים לכל היותר), ושאלה קצרה מה המשתמש/ת כבר יודע/ת.
2. בכל תור מלמדים רעיון קטן אחד (2–3 משפטים), עם דוגמה מבית הספר, ומסיימים בשאלת הבנה אחת.
3. מקשיבים לתשובה: מחזקים את מה שנכון, מתקנים בעדינות את מה שלא, וממשיכים לרעיון הבא.
4. אם מבקשים "חזור", "לא הבנתי" או "דוגמה" – נענים ולא ממשיכים הלאה.
5. בסוף: סיכום של שלושה משפטים ושלוש שאלות חזרה קצרות, אחת בכל פעם.`;
    return base + (S.mode === 'guided' ? guided : free);
  }

  /* ---------- UI helpers ---------- */
  function addMsg(who, text){
    const log = $('vt-log'); const h = log.querySelector('.vt-hint'); if (h) h.remove();
    const d = document.createElement('div'); d.className = 'vt-msg ' + who; d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function renderHint(){
    const log = $('vt-log'); if (log.children.length) return;
    log.innerHTML = `<div class="vt-hint">${MODES[S.mode].hint}<br><br>לוחצים על המיקרופון ומתחילים לדבר.${SR ? '' : '<br><br>⚠️ הדפדפן הזה לא תומך בזיהוי דיבור. אפשר לכתוב, והמורה יענה בקול. לדיבור מומלץ Chrome או Edge.'}</div>`;
  }
  function setState(s, msg){
    S.state = s; const o = $('vt-orb');
    o.className = 'vt-orb ' + (s === 'idle' ? '' : s);
    o.textContent = s === 'listening' ? '👂' : s === 'thinking' ? '⏳' : s === 'speaking' ? '🔊' : '🎙️';
    o.title = s === 'speaking' ? 'לעצור את המורה ולדבר' : s === 'listening' ? 'להפסיק להקשיב' : 'התחלת שיחה';
    const def = {idle: S.active ? 'לחצו על המיקרופון כדי להמשיך' : (S.mode === 'guided' ? 'לחצו כדי להתחיל את ההדרכה' : 'לחצו כדי להתחיל לדבר'),
      listening: 'מקשיב… דברו עכשיו', thinking: 'חושב…', speaking: 'מדבר… (לחיצה עוצרת אותו כדי שתוכלו לדבר)'}[s];
    $('vt-status').textContent = msg || def;
    $('vt-end').classList.toggle('on', S.active);
  }
  function setMode(m){
    S.mode = m; LS.set('mode', m);
    P.querySelectorAll('.vt-mode').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  }

  /* ---------- speech out ---------- */
  function hebVoices(){ return (TTS ? TTS.getVoices() : []).filter(v => /^he|^iw/i.test(v.lang)); }
  function pickVoice(){
    const all = TTS ? TTS.getVoices() : [], want = cfg().voice;
    if (want) { const v = all.find(x => x.name === want); if (v) return v; }
    const he = hebVoices();
    return he.find(v => /natural|online/i.test(v.name)) || he[0] || null;
  }
  const clean = t => t.replace(/[*_#`>|~]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  function enqueue(sentence){
    const t = clean(sentence); if (!t || !TTS) return;
    S.queue.push(t); if (!S.speaking) speakNext();
  }
  function speakNext(){
    if (!S.queue.length) { S.speaking = false; if (S.streamDone) afterSpeech(); return; }
    S.speaking = true; if (S.state !== 'speaking') setState('speaking');
    const u = new SpeechSynthesisUtterance(S.queue.shift());
    const v = pickVoice(); if (v) u.voice = v;
    u.lang = v ? v.lang : 'he-IL'; u.rate = +cfg().rate || 1;
    u.onend = u.onerror = () => { if (S.speaking) speakNext(); };
    TTS.speak(u);
  }
  function stopSpeech(){ S.queue = []; S.speaking = false; if (TTS) TTS.cancel(); }
  // iPhone/iPad only let a page talk after it spoke once inside a tap; call this from every tap handler
  let unlocked = false;
  function unlockSpeech(){
    if (unlocked || !TTS) return; unlocked = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'he-IL'; TTS.speak(u); } catch(e){}
  }
  // keep the phone screen on while a conversation is running
  let wake = null;
  async function keepAwake(on){
    try {
      if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      else if (!on && wake) { await wake.release(); wake = null; }
    } catch(e){ wake = null; }
  }
  function afterSpeech(){
    if (S.state === 'thinking') return;
    if (S.active && SR && cfg().autoListen && S.open) listen(); else setState('idle');
  }

  /* ---------- speech in ---------- */
  function listen(){
    if (!SR) { setState('idle', 'אין זיהוי דיבור בדפדפן הזה – כתבו למטה'); return; }
    stopSpeech(); stopListening();
    const r = new SR(); S.rec = r; S.heard = '';
    r.lang = 'he-IL'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    r.onresult = e => {
      let fin = '', tmp = '';
      for (let i = 0; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fin += x[0].transcript; else tmp += x[0].transcript; }
      S.heard = (fin || tmp).trim();
      if (S.heard) $('vt-status').textContent = '👂 ' + S.heard;
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { S.active = false; setState('idle', '🎤 צריך לאשר גישה למיקרופון (בסמל המנעול שבשורת הכתובת)'); S.rec = null; }
    };
    r.onend = () => {
      if (S.rec !== r) return; S.rec = null;
      const said = S.heard; S.heard = '';
      if (said) { S.emptyTries = 0; send(said); return; }
      if (S.active && S.state === 'listening' && ++S.emptyTries < (TOUCH ? 2 : 4)) { listen(); return; }
      S.emptyTries = 0; setState('idle', S.active ? 'לא שמעתי כלום. לחצו על המיקרופון כדי להמשיך' : '');
    };
    try { r.start(); setState('listening'); } catch(e){ setState('idle', 'לא הצלחתי להפעיל את המיקרופון'); }
  }
  function stopListening(){ const r = S.rec; S.rec = null; if (r) { try { r.abort(); } catch(e){} } }

  /* ---------- Claude (streaming) ---------- */
  async function callClaude(onText){
    const c = cfg();
    const body = {model: c.model, max_tokens: 8000, stream: true, system: systemPrompt(), messages: S.history.slice(-40)};
    if (c.model !== 'claude-haiku-4-5') body.output_config = {effort: 'low'};
    const headers = {'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'};
    const useFallback = !S.noFallback && c.model !== 'claude-haiku-4-5';
    if (useFallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
    S.abort = new AbortController();
    const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers, body: JSON.stringify(body), signal: S.abort.signal});
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      if (useFallback && r.status === 400 && /fallback|beta/i.test(t)) { S.noFallback = true; LS.set('noFallback', true); return callClaude(onText); }
      throw {status: r.status, text: t};
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', full = '', stop = '';
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch(e){ continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { full += ev.delta.text; onText(ev.delta.text); }
        else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === 'error') throw {status: 0, text: (ev.error && ev.error.message) || 'stream error'};
      }
    }
    return {full, stop};
  }
  function errText(e){
    if (e && e.name === 'AbortError') return '';
    const s = e && e.status;
    if (s === 401 || s === 403) return 'המפתח לא תקין. בדקו אותו בהגדרות (⚙️).';
    if (s === 429) return 'יותר מדי בקשות ברגע זה. נסו שוב בעוד רגע.';
    if (s === 529 || s >= 500) return 'השרת של Claude עמוס כרגע. נסו שוב בעוד רגע.';
    if (s === 400) return 'הבקשה נדחתה: ' + String((e.text || '')).slice(0, 160);
    return 'אין חיבור לאינטרנט, או שהבקשה נחסמה.';
  }

  async function send(text, hidden){
    text = (text || '').trim(); if (!text) return;
    if (!cfg().key) { openSettings('כדי לנהל שיחה צריך להכניס מפתח Claude API (פעם אחת בלבד).'); return; }
    stopListening(); stopSpeech(); if (S.abort) S.abort.abort();
    if (!hidden) addMsg('me', text);
    S.history.push({role: 'user', content: text});
    setState('thinking');
    const bubble = addMsg('ai', ''); let pending = ''; S.streamDone = false;
    try {
      const {full, stop} = await callClaude(t => {
        bubble.textContent += t.replace(/\*\*/g, ''); $('vt-log').scrollTop = 1e9;
        pending += t;
        let m;
        while ((m = pending.match(/^([\s\S]*?[.!?…:](?:\s|$)|[\s\S]*?\n)/))) { enqueue(m[1]); pending = pending.slice(m[1].length); }
      });
      if (pending.trim()) enqueue(pending);
      if (full) bubble.textContent = full.replace(/\*\*|__|^#+\s*/gm, '').trim();
      if (stop === 'refusal' && !full.trim()) { bubble.textContent = 'על זה אני לא יכול לענות. אפשר לשאול משהו אחר?'; enqueue(bubble.textContent); }
      S.history.push({role: 'assistant', content: full.trim() || bubble.textContent || '...'});
      S.streamDone = true; S.state = 'speaking';
      if (!S.speaking && !S.queue.length) afterSpeech();
    } catch(e){
      S.streamDone = true; S.history.pop(); bubble.remove();
      const m = errText(e); if (m) addMsg('sys', '⚠️ ' + m);
      S.active = false; setState('idle');
    }
  }

  /* ---------- flow ---------- */
  function start(){
    if (!cfg().key) { openSettings('כדי לנהל שיחה צריך להכניס מפתח Claude API (פעם אחת בלבד).'); return; }
    S.active = true; keepAwake(true);
    if (S.mode === 'guided' && !S.history.length) send('בוא נתחיל את ההדרכה הקולית על הנושא של העמוד הזה.', true);
    else listen();
  }
  function end(){
    S.active = false; stopListening(); stopSpeech(); if (S.abort) S.abort.abort(); keepAwake(false);
    setState('idle', 'השיחה הסתיימה');
  }
  function reset(){ end(); S.history = []; $('vt-log').innerHTML = ''; renderHint(); showCtx(); setState('idle'); }
  function openPanel(){
    S.open = true; P.classList.add('on'); fab.style.display = 'none';
    setMode(S.mode); showCtx(); renderHint(); setState(S.state);
    if (TTS) TTS.getVoices();
  }
  function closePanel(){ end(); S.open = false; P.classList.remove('on'); fab.style.display = ''; }
  function fillVoices(){
    const sel = $('vt-voice'); if (!sel || !TTS) return;
    const all = TTS.getVoices(), he = hebVoices(), cur = cfg().voice;
    const list = he.length ? he : all;
    sel.innerHTML = `<option value="">אוטומטי – הקול העברי הטוב ביותר</option>` + list.map(v => `<option value="${v.name.replace(/"/g, '&quot;')}" ${v.name === cur ? 'selected' : ''}>${v.name} (${v.lang})</option>`).join('');
  }
  function openSettings(note){
    const c = cfg();
    $('vt-key').value = LS.get('key', ''); $('vt-model').value = c.model; $('vt-rate').value = c.rate; $('vt-auto').checked = c.autoListen;
    fillVoices(); $('vt-set').classList.add('on');
    if (note) { const n = $('vt-set').querySelector('.vt-note') || document.createElement('div'); n.className = 'vt-note'; n.style.cssText = 'color:var(--accent,#ffda2a);font-weight:600'; n.textContent = note; $('vt-set').prepend(n); }
  }
  function saveSettings(){
    LS.set('key', $('vt-key').value.trim()); LS.set('model', $('vt-model').value); LS.set('voice', $('vt-voice').value);
    LS.set('rate', +$('vt-rate').value); LS.set('autoListen', $('vt-auto').checked); LS.set('noFallback', false); S.noFallback = false;
    $('vt-set').classList.remove('on'); const n = $('vt-set').querySelector('.vt-note'); if (n) n.remove();
    if (TTS && $('vt-voice').value !== undefined) { const u = new SpeechSynthesisUtterance('שלום, אני המורה הקולי. אפשר להתחיל.'); const v = pickVoice(); if (v) u.voice = v; u.lang = v ? v.lang : 'he-IL'; u.rate = +cfg().rate; TTS.cancel(); TTS.speak(u); }
  }

  /* ---------- events ---------- */
  fab.addEventListener('click', () => { unlockSpeech(); openPanel(); });
  P.addEventListener('pointerdown', unlockSpeech);
  P.addEventListener('click', e => {
    const b = e.target.closest('[data-vt]'); if (!b) return;
    const a = b.dataset.vt;
    if (a === 'close') closePanel();
    else if (a === 'new') reset();
    else if (a === 'settings') { $('vt-set').classList.contains('on') ? $('vt-set').classList.remove('on') : openSettings(); }
    else if (a === 'saveset') saveSettings();
    else if (a === 'mode' && b.dataset.m !== S.mode) { setMode(b.dataset.m); reset(); }
  });
  P.addEventListener('click', e => {
    if (!e.target.closest('#vt-orb')) return;
    if (S.state === 'speaking') { stopSpeech(); S.active = true; listen(); }
    else if (S.state === 'listening') { stopListening(); setState('idle'); }
    else if (S.state === 'thinking') { if (S.abort) S.abort.abort(); }
    else if (!S.active) start();
    else listen();
  });
  $('vt-end').addEventListener('click', end);
  $('vt-form').addEventListener('submit', e => {
    e.preventDefault(); const v = $('vt-input').value; $('vt-input').value = '';
    if (v.trim()) { if (!S.active && SR) S.active = true; send(v); }
  });
  window.addEventListener('hashchange', () => { if (S.open) showCtx(); });
  // phone locked or app switched: stop talking and listening instead of running in the background
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.active) end(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open && !$('vt-set').classList.contains('on')) closePanel(); });
  if (TTS) TTS.onvoiceschanged = fillVoices;
  window.VoiceTutor = {open: openPanel, close: closePanel, mode: m => { setMode(m); reset(); }};
})();
