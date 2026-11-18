(() => {
'use strict';

const D = window.DATA;
const app = document.getElementById('app');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- 日期 ---------- */
const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOff = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const today = () => dstr(new Date());
const addDays = n => dstr(dayOff(n));

/* ---------- 内容索引 ---------- */
const V = [];
D.vocab.forEach((c, ci) => c.items.forEach((it, i) =>
  V.push({ id: it[0], cat: c.id, catName: c.name, t: it[0], m: it[1], e: it[2], z: it[3], ord: i * 100 + ci })));
const VM = Object.fromEntries(V.map(v => [v.id, v]));
const SC = Object.fromEntries(D.scenarios.map(s => [s.id, s]));

/* ---------- 存储 ---------- */
const KEY = 'bizeng.v1';
const defaults = () => ({ cards: {}, log: {}, done: {}, settings: { newPerDay: 10, rate: 1, voice: '', autoSpeak: true } });
function merge(raw) {
  const s = defaults();
  if (raw && typeof raw === 'object') {
    Object.assign(s.cards, raw.cards); Object.assign(s.log, raw.log); Object.assign(s.done, raw.done);
    Object.assign(s.settings, raw.settings);
  }
  return s;
}
let S;
try { S = merge(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { S = defaults(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 存储不可用时仅本次有效 */ } }
function bump(k, n = 1) {
  const t = today();
  const l = S.log[t] || (S.log[t] = { n: 0, r: 0, sp: 0, li: 0, ok: 0, tot: 0 });
  l[k] = (l[k] || 0) + n; save();
}
const logOf = d => S.log[d] || {};
const score = l => (l.n || 0) + (l.r || 0) + (l.sp || 0) + (l.li || 0);
function streak() {
  let i = score(logOf(today())) > 0 ? 0 : -1, n = 0;
  while (score(logOf(addDays(i))) > 0) { n++; i--; }
  return n;
}

/* ---------- 朗读 ---------- */
const TTS = {
  ok: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  voices: [], token: 0, cur: null,
  init() {
    if (!this.ok) return;
    const ld = () => {
      this.voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
      if (route()[0] === 'settings') render();
    };
    ld(); speechSynthesis.addEventListener('voiceschanged', ld);
  },
  main() {
    const vs = this.voices;
    return vs.find(v => v.name === S.settings.voice)
      || vs.find(v => /en[-_]US/i.test(v.lang) && /Natural|Google|Aria|Jenny|Samantha/i.test(v.name))
      || vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
  },
  alt() {
    const m = this.main(); if (!m) return null;
    return this.voices.find(v => v !== m && v.lang === m.lang && /Natural|Google|Guy|Ryan|Daniel|David|Mark/i.test(v.name))
      || this.voices.find(v => v !== m && v.lang === m.lang)
      || this.voices.find(v => v !== m) || m;
  },
  /* 返回 Promise：正常读完为 true，被打断或失败为 false */
  say(text, { rate, alt = false } = {}) {
    return new Promise(res => {
      if (!this.ok) return res(false);
      const my = ++this.token;
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const m = this.main(), v = alt ? this.alt() : m;
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      if (alt && v === m) u.pitch = 0.7;
      u.rate = rate || S.settings.rate;
      u.onend = () => res(my === this.token);
      u.onerror = () => res(false);
      this.cur = u; // 保持引用，避免 Chrome 提前回收导致 onend 不触发
      speechSynthesis.speak(u);
    });
  },
  stop() { this.token++; if (this.ok) speechSynthesis.cancel(); }
};

const ICON = {
  spk: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7.5"/></svg>'
};
const spk = (text, alt) => `<button class="icon-btn" data-a="say" data-text="${esc(text)}"${alt ? ' data-alt="1"' : ''} aria-label="Play audio" title="Play audio">${ICON.spk}</button>`;
const ttsWarn = () => TTS.ok ? '' : '<div class="warnbox">This browser does not support text-to-speech, so audio features will not work. Try Chrome or Edge.</div>';
const seg = items => `<div class="seg">${items.map(([h, l, on]) => `<a href="${h}"${on ? ' class="on"' : ''}>${l}</a>`).join('')}</div>`;

/* ---------- 间隔重复 ---------- */
function schedule(c, g) { // g: 0 忘了 1 模糊 2 记得 3 很熟
  let { iv = 0, ease = 2.5, reps = 0 } = c || {};
  if (g === 0) { reps = 0; iv = 0; ease = Math.max(1.3, ease - 0.2); }
  else if (g === 1) { iv = reps === 0 ? 1 : Math.max(1, Math.round(iv * 1.2)); ease = Math.max(1.3, ease - 0.15); reps++; }
  else if (g === 2) { iv = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(iv + 1, Math.round(iv * ease)); reps++; }
  else { iv = reps === 0 ? 4 : Math.max(iv + 2, Math.round(iv * ease * 1.3)); ease += 0.15; reps++; }
  return { iv, ease: Math.round(ease * 100) / 100, reps, due: addDays(iv) };
}
const statusOf = id => { const c = S.cards[id]; return !c ? 'new' : c.iv >= 7 ? 'known' : 'learning'; };
const dueList = () => { const t = today(); return V.filter(v => S.cards[v.id] && S.cards[v.id].due <= t); };
const freshList = () => V.filter(v => !S.cards[v.id]).sort((a, b) => a.ord - b.ord);
const newLeft = () => Math.min(Math.max(0, S.settings.newPerDay - (logOf(today()).n || 0)), freshList().length);

let sess = null;
function startSess(extra = 0) {
  const fresh = freshList().slice(0, newLeft() + extra);
  sess = { q: [...shuffle(dueList()), ...fresh].map(v => v.id), flipped: false, done: 0 };
}
function speakCard() { if (S.settings.autoSpeak && sess && sess.q.length) TTS.say(VM[sess.q[0]].t); }
function rateCard(g) {
  if (!sess || !sess.q.length || !sess.flipped) return;
  const id = sess.q.shift(), old = S.cards[id];
  S.cards[id] = schedule(old, g);
  bump(old ? 'r' : 'n');
  if (g === 0) sess.q.push(id); else sess.done++;
  sess.flipped = false;
  render(); speakCard();
}

/* ---------- 听写比对 ---------- */
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORD = { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', tenth: '10th', fifteenth: '15th', twentieth: '20th' };
/* 把句子拆成用于比较的词；数字的单词写法和阿拉伯数字写法视为相同 */
function toks(s) {
  const words = s.replace(/[’‘]/g, "'").split(/\s+/).filter(Boolean);
  const raw = [];
  words.forEach((w, i) => {
    // 撇号直接去掉：写成 Im / I'm 都算对
    w.toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/'/g, '').replace(/%/g, ' percent ').replace(/[^a-z0-9]+/g, ' ').split(' ').forEach(t => {
      if (!t) return;
      if (t in NUM) t = String(NUM[t]); else if (t in ORD) t = ORD[t];
      raw.push({ t, o: [i] });
    });
  });
  const m = [];
  for (const x of raw) {
    const p = m[m.length - 1];
    if (p && /^\d+$/.test(p.t)) {
      if (x.t === 'hundred') { p.t = String(p.t * 100); p.o.push(...x.o); continue; }
      if (x.t === 'thousand') { p.t = String(p.t * 1000); p.o.push(...x.o); continue; }
      if (/^[1-9]$/.test(x.t) && /^[2-9]0$/.test(p.t)) { p.t = String(+p.t + +x.t); p.o.push(...x.o); continue; }
    }
    m.push(x);
  }
  return { words, m };
}
function compare(input, ref) {
  const U = toks(input), R = toks(ref), a = U.m, b = R.m, n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i].t === b[j].t ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const uHit = new Array(n).fill(false), rHit = new Array(m).fill(false);
  let i = 0, j = 0, hits = 0;
  while (i < n && j < m) {
    if (a[i].t === b[j].t) { uHit[i] = rHit[j] = true; hits++; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const uBad = new Set(), rMiss = new Set();
  a.forEach((x, k) => { if (!uHit[k]) x.o.forEach(o => uBad.add(o)); });
  b.forEach((x, k) => { if (!rHit[k]) x.o.forEach(o => rMiss.add(o)); });
  return {
    hits, total: m, acc: m ? hits / m : 0, extra: uBad.size,
    refHtml: R.words.map((w, k) => rMiss.has(k) ? `<mark class="miss">${esc(w)}</mark>` : esc(w)).join(' '),
    userHtml: U.words.map((w, k) => uBad.has(k) ? `<s class="bad">${esc(w)}</s>` : esc(w)).join(' ')
  };
}

/* ---------- 路由 ---------- */
const route = () => location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
function render() {
  const [p = '', a, b] = route();
  const page = p || 'home';
  document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('on', x.dataset.n === page));
  let html;
  if (page === 'vocab') html = a === 'list' ? vList() : vStudy();
  else if (page === 'speak') html = SC[a] ? vScenario(SC[a], b === 'role') : vSpeak();
  else if (page === 'listen') html = a === 'dict' ? vDict() : (a === 'dlg' && SC[b]) ? vDlg(SC[b]) : vListen();
  else if (page === 'settings') html = vSettings();
  else html = vHome();
  app.innerHTML = html;
  if (page === 'vocab' && a === 'list') renderList();
}

/* ---------- 首页 ---------- */
function nextScenario() {
  return D.scenarios.find(s => !S.done[s.id]) || D.scenarios.slice().sort((x, y) => S.done[x.id] < S.done[y.id] ? -1 : 1)[0];
}
function vHome() {
  const L = logOf(today());
  const learned = V.filter(v => S.cards[v.id]).length, due = dueList().length, nl = newLeft();
  let ok = 0, tot = 0;
  const days = [];
  for (let i = -6; i <= 0; i++) { const d = dayOff(i), l = logOf(dstr(d)); ok += l.ok || 0; tot += l.tot || 0; days.push({ d, v: score(l), today: i === 0 }); }
  const max = Math.max(1, ...days.map(x => x.v));
  const ns = nextScenario();
  const vocabDone = due + nl === 0 && (L.n || L.r);
  const task = (done, title, desc, href, label) => `
    <div class="card task${done ? ' done' : ''}">
      <span class="tick">${ICON.check}</span>
      <div class="body"><b>${title}</b><span>${desc}</span></div>
      <a class="btn${done ? '' : ' primary'}" href="${href}">${done ? 'Keep going' : label}</a>
    </div>`;
  return `
    <p class="eyebrow">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    <h1>What will you practice today?</h1>
    <div class="stats">
      <div class="stat"><b>${streak()}</b><span>Day streak</span></div>
      <div class="stat"><b>${learned}<small class="sub" style="font-size:.9rem;font-weight:400"> / ${V.length}</small></b><span>Words learned</span></div>
      <div class="stat"><b>${due}</b><span>Due for review</span></div>
      <div class="stat"><b>${tot ? Math.round(ok / tot * 100) + '%' : '–'}</b><span>Dictation accuracy, 7 days</span></div>
    </div>
    <h2>Today's plan</h2>
    ${task(vocabDone, 'Vocabulary', vocabDone ? `Done for today: ${L.n || 0} new, ${L.r || 0} reviews` : `${due} to review · ${nl} new`, '#vocab', 'Start')}
    ${task((L.sp || 0) > 0, 'Speaking', `Scenario: ${esc(ns.title)}${L.sp ? ` · ${L.sp} line${L.sp === 1 ? '' : 's'} practiced today` : ''}`, '#speak/' + ns.id, 'Start')}
    ${task((L.li || 0) >= 5, 'Listening', `Dictate 5 sentences${L.li ? ` · ${L.li} done today` : ''}`, '#listen/dict', 'Start')}
    <h2>Last 7 days</h2>
    <div class="card"><div class="bars">${days.map(x => `
      <div class="col${x.today ? ' today' : ''}" title="${x.v} activities">
        <div class="bar${x.v ? '' : ' zero'}" style="height:${x.v ? Math.max(6, x.v / max * 100) : 0}%"></div>
        <span>${x.today ? 'Today' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.d.getDay()]}</span>
      </div>`).join('')}</div></div>`;
}

/* ---------- 词汇：学习 ---------- */
const vocabSeg = list => seg([['#vocab', 'Study', !list], ['#vocab/list', 'Word list', list]]);
function vStudy() {
  if (!sess || (!sess.q.length && !sess.done)) startSess();
  const head = `<h1>Vocabulary</h1>${vocabSeg(false)}${ttsWarn()}`;
  if (!sess.q.length) {
    const L = logOf(today()), more = freshList().length;
    return `${head}
      <div class="card flash">
        <div class="grow"></div>
        <span class="chip">All done for today</span>
        <p class="term" style="font-size:1.6rem">Vocabulary complete</p>
        <p class="sub">${L.n || 0} new · ${L.r || 0} reviews. Words due tomorrow will show up here automatically.</p>
        <div class="grow"></div>
        <div class="row-btns">
          ${more ? `<button class="btn primary" data-a="more">Learn ${Math.min(5, more)} more</button>` : ''}
          <a class="btn" href="#vocab/list">Browse word list</a>
        </div>
      </div>`;
  }
  const v = VM[sess.q[0]], c = S.cards[v.id], total = sess.done + sess.q.length;
  const hint = g => { const iv = schedule(c, g).iv; return g === 0 ? 'again soon' : 'in ' + iv + 'd'; };
  const rateBtn = (g, label) => `<button class="btn g${g}" data-a="rate" data-g="${g}">${label}<small>${hint(g)} <kbd>${g + 1}</kbd></small></button>`;
  return `${head}
    <div class="status">Session progress ${sess.done} / ${total}</div>
    <div class="prog"><i style="width:${sess.done / total * 100}%"></i></div>
    <div class="card flash">
      <div><span class="chip">${esc(v.catName)}</span> <span class="chip gray">${c ? 'Review' : 'New'}</span></div>
      <p class="term">${esc(v.t)}</p>
      ${spk(v.t)}
      ${sess.flipped ? `
        <p class="mean">${esc(v.m)}</p>
        <div class="ex">
          <p class="en">${esc(v.e)} ${spk(v.e)}</p>
          <p class="zh">${esc(v.z)}</p>
        </div>
        <div class="grow"></div>
        <div class="rate">${rateBtn(0, 'Again')}${rateBtn(1, 'Hard')}${rateBtn(2, 'Good')}${rateBtn(3, 'Easy')}</div>
      ` : `
        <div class="grow"></div>
        <p class="sub">Recall the meaning and how it is used, then check</p>
        <div class="row-btns"><button class="btn primary" data-a="flip">Show answer <kbd style="border-color:currentColor;color:inherit">Space</kbd></button></div>
      `}
    </div>`;
}

/* ---------- 词汇：词表 ---------- */
const listF = { cat: 'all', q: '' };
function vList() {
  return `<h1>Vocabulary</h1>${vocabSeg(true)}
    <div class="filters">
      <input type="search" id="vq" placeholder="Search English or Chinese…" value="${esc(listF.q)}" aria-label="Search">
      <select id="vcat" aria-label="Category">
        <option value="all">All categories</option>
        ${D.vocab.map(c => `<option value="${c.id}"${listF.cat === c.id ? ' selected' : ''}>${esc(c.name)} (${c.items.length})</option>`).join('')}
      </select>
    </div>
    <div class="legend"><span><i class="dot"></i>New</span><span><i class="dot learning"></i>Learning</span><span><i class="dot known"></i>Mastered</span></div>
    <div id="vlist"></div>`;
}
function renderList() {
  const box = $('#vlist'); if (!box) return;
  const q = listF.q.trim().toLowerCase();
  const rows = V.filter(v => (listF.cat === 'all' || v.cat === listF.cat) && (!q || v.t.toLowerCase().includes(q) || v.m.includes(q)));
  box.innerHTML = rows.length ? rows.map(v => `
    <details class="vrow">
      <summary><i class="dot ${statusOf(v.id)}"></i><b>${esc(v.t)}</b><span class="m">${esc(v.m)}</span></summary>
      <div class="more">${spk(v.e)}<div><p class="en">${esc(v.e)}</p><p class="zh">${esc(v.z)}</p></div></div>
    </details>`).join('') : '<p class="sub" style="padding:24px 0">No matching words.</p>';
}

/* ---------- 口语 ---------- */
let mask = false, rp = null;
function vSpeak() {
  return `<h1>Speaking</h1><p class="sub">Learn the phrases for each scenario, then say them out loud in a role-play.</p>${ttsWarn()}
    <div class="grid" style="margin-top:20px">${D.scenarios.map(s => `
      <a class="card tile" href="#speak/${s.id}">
        <b>${esc(s.title)}</b>
        <div class="meta">
          <span class="chip gray">${s.phrases.reduce((n, g) => n + g.items.length, 0)} phrases</span>
          ${S.done[s.id] ? '<span class="chip">Role-play done</span>' : ''}
        </div>
      </a>`).join('')}</div>`;
}
function vScenario(s, role) {
  const head = `<a class="back" href="#speak">← All scenarios</a><h1>${esc(s.title)}</h1>
    ${seg([['#speak/' + s.id, 'Key phrases', !role], ['#speak/' + s.id + '/role', 'Role-play', role]])}`;
  if (role) return head + vRole(s);
  return `${head}
    <label class="toggle"><input type="checkbox" data-s="mask"${mask ? ' checked' : ''}> Hide the English: read the Chinese, say it yourself, then tap to check</label>
    ${s.phrases.map(g => `
      <h2>${esc(g.g)}</h2>
      <div class="card" style="padding:6px 20px">${g.items.map(p => `
        <div class="ph">
          <div class="txt">
            <p class="en${mask ? ' masked' : ''}"${mask ? ' data-a="unmask" title="Tap to reveal"' : ''} data-text="${esc(p[0])}">${esc(p[0])}</p>
            <p class="zh">${esc(p[1])}</p>
          </div>${spk(p[0])}
        </div>`).join('')}</div>`).join('')}
    <div class="row-btns"><a class="btn primary" href="#speak/${s.id}/role">Go to role-play</a></div>`;
}
function vRole(s) {
  const dl = s.dialogue, L = dl.lines;
  if (!rp || rp.sid !== s.id) rp = { sid: s.id, me: null, i: 0, shown: false };
  if (!rp.me) return `
    <div class="card">
      <p><b>Setting</b>&nbsp; ${esc(dl.setting)}</p>
      <p class="note">Pick a role. The other speaker's lines are read aloud. On your turn you only get a Chinese prompt: say it in English first, then check the model answer.</p>
      <div class="row-btns">
        <button class="btn primary" data-a="rp-pick" data-r="A">Play ${esc(dl.roles.A)}</button>
        <button class="btn primary" data-a="rp-pick" data-r="B">Play ${esc(dl.roles.B)}</button>
      </div>
    </div>`;
  const bubbles = L.slice(0, rp.i).map(l => {
    const mine = l[0] === rp.me;
    return `<div class="bubble${mine ? ' me' : ''}">
      <div class="who"><span>${esc(dl.roles[l[0]])}</span>${spk(l[1], !mine)}</div>
      <p class="en">${esc(l[1])}</p><p class="zh">${esc(l[2])}</p></div>`;
  }).join('');
  let tail;
  if (rp.i >= L.length) {
    tail = `<div class="card" style="text-align:center">
      <span class="chip">Dialogue complete</span>
      <p style="margin-top:10px">Switch roles and run it again to get both sides down.</p>
      <div class="row-btns" style="justify-content:center">
        <button class="btn primary" data-a="rp-pick" data-r="${rp.me === 'A' ? 'B' : 'A'}">Switch roles</button>
        <a class="btn" href="#speak">Back to scenarios</a>
      </div></div>`;
  } else {
    const l = L[rp.i];
    tail = `<div class="turn">
      <p class="label">Your turn · ${esc(dl.roles[rp.me])} (line ${rp.i + 1} of ${L.length})</p>
      <p class="zh">${esc(l[2])}</p>
      ${rp.shown
        ? `<p class="ref"><span>${esc(l[1])}</span>${spk(l[1])}</p><button class="btn primary" data-a="rp-next">Next line</button>`
        : `<button class="btn primary" data-a="rp-show">Done. Show model answer</button>`}
    </div>`;
  }
  return `<div class="chat">${bubbles}</div>${tail}`;
}
function rpAdvance() { // 自动带过对方的台词，停在自己的下一句
  const s = SC[rp.sid], L = s.dialogue.lines;
  rp.shown = false;
  if (rp.i < L.length && L[rp.i][0] !== rp.me) { TTS.say(L[rp.i][1], { alt: true }); rp.i++; }
  if (rp.i >= L.length) { S.done[s.id] = today(); save(); }
  render();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

/* ---------- 听力 ---------- */
const dict = { src: 'all', cur: null, res: null, count: 0 };
const dc = { sid: null, ans: [], submitted: false, playing: false, tok: 0 };
function dictPool() {
  const a = [];
  if (dict.src !== 'dlg') V.forEach(v => { if (dict.src === 'all' || S.cards[v.id]) a.push({ t: v.e, z: v.z }); });
  if (dict.src !== 'learned') D.scenarios.forEach(s => {
    s.phrases.forEach(g => g.items.forEach(p => a.push({ t: p[0], z: p[1] })));
    s.dialogue.lines.forEach(l => a.push({ t: l[1], z: l[2] }));
  });
  return a.filter(x => { const n = x.t.split(/\s+/).length; return n >= 4 && n <= 16; });
}
function pickDict() {
  const pool = dictPool().filter(x => !dict.cur || x.t !== dict.cur.t);
  dict.cur = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  dict.res = null;
}
function vListen() {
  return `<h1>Listening</h1><p class="sub">Dictation trains your ear for detail. Dialogue comprehension trains you to catch the gist.</p>${ttsWarn()}
    <h2>Sentence dictation</h2>
    <div class="card task">
      <div class="body"><b>Listen and type</b><span>Sentences come from vocabulary examples and scenario phrases. Missed words are highlighted when you check.</span></div>
      <a class="btn primary" href="#listen/dict">Start dictation</a>
    </div>
    <h2>Dialogue comprehension</h2>
    <div class="grid">${D.scenarios.map(s => {
      const r = S.done['L:' + s.id];
      return `<a class="card tile" href="#listen/dlg/${s.id}">
        <b>${esc(s.title)}</b>
        <div class="meta"><span class="chip gray">${s.dialogue.lines.length} lines · ${s.quiz.length} questions</span>${r ? `<span class="chip">Last score ${r.score} / ${s.quiz.length}</span>` : ''}</div>
      </a>`;
    }).join('')}</div>`;
}
function vDict() {
  if (!dict.cur) pickDict();
  const head = `<a class="back" href="#listen">← Listening</a><h1>Sentence dictation</h1>${ttsWarn()}`;
  const srcSel = `<select data-s="dsrc" aria-label="Sentence source">
    ${[['all', 'All sentences'], ['learned', 'Learned-word examples'], ['dlg', 'Scenario phrases and dialogues']].map(([v, l]) => `<option value="${v}"${dict.src === v ? ' selected' : ''}>${l}</option>`).join('')}
  </select>`;
  if (!dict.cur) return `${head}<div class="card"><div class="dict-top">${srcSel}</div><p class="sub">No learned words yet. <a href="#vocab" style="color:var(--accent)">Learn a few</a> first, or choose another sentence source.</p></div>`;
  const r = dict.res, L = logOf(today());
  return `${head}
    <div class="card">
      <div class="dict-top">
        <button class="btn primary" data-a="d-play">${ICON.spk} Play</button>
        <button class="btn" data-a="d-slow">Slow</button>
        <span class="sp"></span>${srcSel}
      </div>
      <textarea id="dinput" rows="3" placeholder="Type what you hear. Replay as often as you like…" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"${r ? ' readonly' : ''}>${r ? esc(r.input) : ''}</textarea>
      ${r ? `
        <div class="result">
          <p class="score" style="color:var(--${r.acc >= .9 ? 'good' : r.acc >= .6 ? 'warn' : 'bad'})">${Math.round(r.acc * 100)}%</p>
          <p class="sub">${r.hits} of ${r.total} words correct${r.extra ? `, ${r.extra} extra or wrong` : ''}</p>
          ${r.input.trim() ? `<p class="lbl">Your answer</p><p class="line">${r.userHtml}</p>` : ''}
          <p class="lbl">Original sentence (missed words in red)</p>
          <p class="line">${r.refHtml} ${spk(dict.cur.t)}</p>
          <p class="sub" style="margin-top:6px">${esc(dict.cur.z)}</p>
        </div>
        <div class="row-btns"><button class="btn primary" data-a="d-next">Next <kbd style="border-color:currentColor;color:inherit">Enter</kbd></button></div>
      ` : `
        <div class="row-btns">
          <button class="btn primary" data-a="d-check">Check <kbd style="border-color:currentColor;color:inherit">Enter</kbd></button>
          <button class="btn" data-a="d-giveup">Give up, show answer</button>
        </div>
        <p class="note">Capitalization, punctuation and apostrophes are ignored. Numbers count either way: 12 or twelve.</p>`}
    </div>
    <p class="status" style="margin-top:12px">${L.li || 0} listening exercises done today</p>`;
}
function dictCheck(giveup) {
  const el = $('#dinput'), input = giveup ? '' : (el ? el.value : '');
  if (!giveup && !input.trim()) { if (el) el.focus(); return; }
  dict.res = { ...compare(input, dict.cur.t), input };
  bump('li'); bump('ok', dict.res.hits); bump('tot', dict.res.total);
  render();
}
function dictNext() { pickDict(); render(); if (dict.cur) TTS.say(dict.cur.t); const el = $('#dinput'); if (el) el.focus(); }

function vDlg(s) {
  if (dc.sid !== s.id) Object.assign(dc, { sid: s.id, ans: [], submitted: false, playing: false });
  const dl = s.dialogue, n = s.quiz.length;
  const right = s.quiz.filter((q, i) => dc.ans[i] === q.a).length;
  return `<a class="back" href="#listen">← Listening</a><h1>${esc(s.title)}</h1><p class="sub">${esc(dl.setting)}</p>${ttsWarn()}
    <div class="card" style="margin-top:16px">
      <div class="dict-top">
        <button class="btn primary" data-a="dc-play" id="dcbtn">${dc.playing ? 'Stop' : ICON.spk + ' Play dialogue'}</button>
        <span class="status" id="dcstat">${dc.playing ? '' : `${dl.lines.length} lines. Read the questions first, then listen.`}</span>
      </div>
      ${s.quiz.map((q, i) => `
        <div class="q"><p class="en">${i + 1}. ${esc(q.q)}</p><div class="opts">${q.o.map((o, k) => {
          let c = '';
          if (dc.submitted) c = k === q.a ? ' right' : dc.ans[i] === k ? ' wrong' : '';
          else if (dc.ans[i] === k) c = ' sel';
          return `<button class="btn opt en${c}" data-a="dc-ans" data-q="${i}" data-o="${k}"${dc.submitted ? ' disabled' : ''}>${esc(o)}</button>`;
        }).join('')}</div></div>`).join('')}
      <div class="row-btns">${dc.submitted
        ? `<span class="chip" style="align-self:center">${right} / ${n} correct</span><button class="btn" data-a="dc-reset">Try again</button>`
        : `<button class="btn primary" data-a="dc-submit"${dc.ans.filter(x => x != null).length < n ? ' disabled' : ''}>Submit</button>`}
      </div>
    </div>
    ${dc.submitted ? `
      <h2>Transcript</h2>
      <div class="chat">${dl.lines.map(l => `
        <div class="bubble${l[0] === 'B' ? ' me' : ''}">
          <div class="who"><span>${esc(dl.roles[l[0]])}</span>${spk(l[1], l[0] === 'B')}</div>
          <p class="en">${esc(l[1])}</p><p class="zh">${esc(l[2])}</p>
        </div>`).join('')}</div>
      <div class="row-btns"><a class="btn primary" href="#speak/${s.id}/role">Practice this dialogue in role-play</a></div>` : ''}`;
}
async function playDlg() {
  const s = SC[dc.sid], L = s.dialogue.lines, my = ++dc.tok;
  dc.playing = true;
  const ui = i => {
    const b = $('#dcbtn'), st = $('#dcstat');
    if (b) b.innerHTML = dc.playing ? 'Stop' : ICON.spk + ' Play dialogue';
    if (st) st.textContent = dc.playing ? `Playing ${i + 1} / ${L.length}` : 'Finished. Play again any time.';
  };
  for (let i = 0; i < L.length; i++) {
    ui(i);
    const ok = await TTS.say(L[i][1], { alt: L[i][0] === 'B' });
    if (my !== dc.tok) return;
    if (!ok) break;
    await sleep(300);
    if (my !== dc.tok) return;
  }
  dc.playing = false; ui(0);
}
function stopDlg() { dc.tok++; dc.playing = false; TTS.stop(); }

/* ---------- 设置 ---------- */
function vSettings() {
  const st = S.settings, cur = TTS.main();
  return `<h1>Settings</h1>${ttsWarn()}
    <h2>Study</h2>
    <div class="card" style="padding:6px 20px">
      <div class="set"><div class="lab"><b>New words per day</b><span>The most new words introduced each day</span></div>
        <div class="ctl"><select data-s="newPerDay">${[5, 10, 15, 20].map(n => `<option${st.newPerDay === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <div class="set"><div class="lab"><b>Auto-play new cards</b><span>Read each word aloud when its card appears</span></div>
        <div class="ctl"><label class="toggle" style="margin:0"><input type="checkbox" data-s="autoSpeak"${st.autoSpeak ? ' checked' : ''}></label></div></div>
    </div>
    <h2>Audio</h2>
    <div class="card" style="padding:6px 20px">
      <div class="set"><div class="lab"><b>Voice</b><span>Options depend on your system and browser</span></div>
        <div class="ctl"><select data-s="voice" style="max-width:240px">${TTS.voices.length
          ? TTS.voices.map(v => `<option value="${esc(v.name)}"${cur === v ? ' selected' : ''}>${esc(v.name.replace(/^Microsoft |^Google /, ''))}</option>`).join('')
          : '<option>No English voices found</option>'}</select>
          <button class="btn" data-a="say" data-text="Thanks for joining. Shall we get started?">Preview</button></div></div>
      <div class="set"><div class="lab"><b>Speed</b><span>1.0 is normal speed</span></div>
        <div class="ctl"><input type="range" min="0.6" max="1.3" step="0.1" value="${st.rate}" data-s="rate" aria-label="Speed"><span id="rateval" class="status">${(+st.rate).toFixed(1)}×</span></div></div>
    </div>
    <h2>Data</h2>
    <div class="card" style="padding:6px 20px">
      <div class="set"><div class="lab"><b>Backup and restore</b><span>Progress is saved only in this browser on this device. Export before switching.</span></div>
        <div class="ctl"><button class="btn" data-a="exp">Export</button><button class="btn" data-a="imp">Import</button><input type="file" id="impfile" accept="application/json,.json" hidden></div></div>
      <div class="set"><div class="lab"><b>Reset progress</b><span>Delete all learning history. This cannot be undone.</span></div>
        <div class="ctl"><button class="btn" data-a="reset" style="color:var(--bad)">Reset</button></div></div>
    </div>`;
}

/* ---------- 事件 ---------- */
const A = {
  say(el) { TTS.say(el.dataset.text, { alt: el.dataset.alt === '1' }); },
  flip() { if (sess) { sess.flipped = true; render(); } },
  rate(el) { rateCard(+el.dataset.g); },
  more() { startSess(5); render(); speakCard(); },
  unmask(el) { el.classList.remove('masked'); el.removeAttribute('data-a'); el.removeAttribute('title'); bump('sp'); TTS.say(el.dataset.text); },
  'rp-pick'(el) { rp = { sid: rp.sid, me: el.dataset.r, i: 0, shown: false }; rpAdvance(); },
  'rp-show'() { rp.shown = true; bump('sp'); render(); TTS.say(SC[rp.sid].dialogue.lines[rp.i][1]); window.scrollTo({ top: document.body.scrollHeight }); },
  'rp-next'() { rp.i++; rpAdvance(); },
  'd-play'() { if (dict.cur) TTS.say(dict.cur.t); const el = $('#dinput'); if (el && !dict.res) el.focus(); },
  'd-slow'() { if (dict.cur) TTS.say(dict.cur.t, { rate: Math.max(0.5, S.settings.rate * 0.7) }); const el = $('#dinput'); if (el && !dict.res) el.focus(); },
  'd-check'() { dictCheck(false); },
  'd-giveup'() { dictCheck(true); },
  'd-next'() { dictNext(); },
  'dc-play'() { if (dc.playing) { stopDlg(); render(); } else playDlg(); },
  'dc-ans'(el) { if (dc.submitted) return; dc.ans[+el.dataset.q] = +el.dataset.o; const y = window.scrollY; const playing = dc.playing; render(); window.scrollTo(0, y); if (playing) { const b = $('#dcbtn'); if (b) b.textContent = 'Stop'; } },
  'dc-submit'() {
    const s = SC[dc.sid]; stopDlg(); dc.submitted = true;
    S.done['L:' + s.id] = { score: s.quiz.filter((q, i) => dc.ans[i] === q.a).length, date: today() };
    bump('li'); render();
  },
  'dc-reset'() { stopDlg(); dc.ans = []; dc.submitted = false; render(); window.scrollTo(0, 0); },
  exp() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
    a.download = `biz-english-progress-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  imp() { $('#impfile').click(); },
  reset() { if (confirm('Reset all progress? This cannot be undone.')) { S = defaults(); sess = null; save(); render(); } }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && A[el.dataset.a]) A[el.dataset.a](el, e);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'vcat') { listF.cat = el.value; renderList(); return; }
  if (el.id === 'impfile' && el.files[0]) {
    el.files[0].text().then(txt => {
      const raw = JSON.parse(txt);
      if (!raw || typeof raw.cards !== 'object') throw new Error('bad file');
      if (confirm('Importing will overwrite your current progress. Continue?')) { S = merge(raw); sess = null; save(); render(); }
    }).catch(() => alert('That file is not a valid progress backup.'));
    return;
  }
  const k = el.dataset && el.dataset.s; if (!k) return;
  if (k === 'mask') { mask = el.checked; render(); }
  else if (k === 'dsrc') { dict.src = el.value; dict.cur = null; pickDict(); render(); }
  else if (k === 'newPerDay') { S.settings.newPerDay = +el.value; sess = null; save(); }
  else if (k === 'autoSpeak') { S.settings.autoSpeak = el.checked; save(); }
  else if (k === 'voice') { S.settings.voice = el.value; save(); }
  else if (k === 'rate') { S.settings.rate = +el.value; save(); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'vq') { listF.q = el.value; renderList(); }
  else if (el.dataset && el.dataset.s === 'rate') { const o = $('#rateval'); if (o) o.textContent = (+el.value).toFixed(1) + '×'; }
});
document.addEventListener('keydown', e => {
  const [p, a] = route(), tag = e.target.tagName;
  if (p === 'listen' && a === 'dict' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && tag !== 'BUTTON' && tag !== 'SELECT') {
    e.preventDefault(); dict.res ? dictNext() : dictCheck(false); return;
  }
  if (p === 'vocab' && !a && sess && sess.q.length && !/INPUT|TEXTAREA|SELECT/.test(tag) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === ' ' && tag !== 'BUTTON' && !sess.flipped) { e.preventDefault(); A.flip(); }
    else if (sess.flipped && /^[1-4]$/.test(e.key)) { e.preventDefault(); rateCard(+e.key - 1); }
  }
});
window.addEventListener('hashchange', () => { TTS.stop(); dc.tok++; dc.playing = false; render(); window.scrollTo(0, 0); });

TTS.init();
render();
})();
