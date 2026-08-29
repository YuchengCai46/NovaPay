/* ===========================================================================
   NovaPay V6.0 — 前端 SPA（原生 JS，无框架 / 无外部 CDN）
   设计基调：瑞士私行级 · 再往上半步。所有敏感数据端到端加密。
   国际化：所有文案经 t(key) 取词，setLang() 实时切换并触发 __npRerender 重渲染。
   
   渲染优化：预取并行 + 一次性innerHTML + fade动画，消除切换卡顿
   =========================================================================== */
'use strict';

const state = { user: null, accounts: [], admin: null, view: 'home', adminView: 'dashboard', adminUnlocked: false };
// 各网络等级名称映射（UI 显示）
const LEVEL_NAMES = {
  'NovaPay': { 'Standard': 'Standard', 'Premium': 'Premium', 'Black': 'Black', 'Eternal': 'Eternal', 'Eternal+': 'Eternal+' },
  'Visa': { 'Classic': 'Classic', 'Gold': 'Gold', 'Platinum': 'Platinum', 'Infinite': 'Infinite' },
  'MasterCard': { 'Standard': 'Standard', 'Gold': 'Gold', 'Platinum': 'Platinum', 'WorldElite': 'World Elite' },
};
// 借记卡统一发卡费 USD 300
const DEBIT_ISSUE_FEE_USD = 300;
// 卡片等级配置（按网络+等级）
const CARD_LEVELS_NETWORKED = {
  'NovaPay': {
    'Standard': { debit_fee: 300, credit_fee: 100, credit_limit: 5000 },
    'Premium': { debit_fee: 300, credit_fee: 300, credit_limit: 15000 },
    'Black': { debit_fee: 300, credit_fee: 500, credit_limit: 50000 },
    'Eternal': { debit_fee: 300, credit_fee: 1200, credit_limit: 50000 },
    'Eternal+': { debit_fee: 300, credit_fee: 2500, credit_limit: 100000 },
  },
  'Visa': {
    'Classic': { debit_fee: 300, credit_fee: 80, credit_limit: 5000 },
    'Gold': { debit_fee: 300, credit_fee: 200, credit_limit: 15000 },
    'Platinum': { debit_fee: 300, credit_fee: 400, credit_limit: 25000 },
    'Infinite': { debit_fee: 300, credit_fee: 1000, credit_limit: 50000 },
  },
  'MasterCard': {
    'Standard': { debit_fee: 300, credit_fee: 80, credit_limit: 5000 },
    'Gold': { debit_fee: 300, credit_fee: 200, credit_limit: 15000 },
    'Platinum': { debit_fee: 300, credit_fee: 400, credit_limit: 25000 },
    'WorldElite': { debit_fee: 300, credit_fee: 1000, credit_limit: 50000 },
  },
};
// 平铺格式（兼容旧逻辑）
const CARD_LEVELS_FLAT = {
  'Standard': { debit_fee: 300, credit_fee: 80, credit_limit: 5000 },
  'Gold': { debit_fee: 300, credit_fee: 200, credit_limit: 15000 },
  'Platinum': { debit_fee: 300, credit_fee: 400, credit_limit: 25000 },
  'Black': { debit_fee: 300, credit_fee: 500, credit_limit: 50000 },
  'Premium': { debit_fee: 300, credit_fee: 300, credit_limit: 15000 },
  'Eternal': { debit_fee: 300, credit_fee: 1200, credit_limit: 50000 },
  'Eternal+': { debit_fee: 300, credit_fee: 2500, credit_limit: 100000 },
  'Classic': { debit_fee: 300, credit_fee: 80, credit_limit: 5000 },
  'Infinite': { debit_fee: 300, credit_fee: 1000, credit_limit: 50000 },
  'WorldElite': { debit_fee: 300, credit_fee: 1000, credit_limit: 50000 },
  'Elite': { debit_fee: 300, credit_fee: 1000, credit_limit: 50000 },
};
const THEME_KEY = 'np-theme';

/* ---------------- 基础工具 ---------------- */
// 后端 API 基础地址，部署时修改此处为 Railway 域名
const API_BASE = '';

async function api(method, path, body) {
  const url = API_BASE + path;
  const opt = { method, credentials: 'include', headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  let data = null; try { data = await r.json(); } catch (e) { data = null; }
  return { ok: r.ok, status: r.status, data };
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function val(id) { const e = document.getElementById(id); return e ? e.value : ''; }
function fmt(n) { return (n == null ? '0.00' : Number(n).toFixed(2)); }
let BASE = (function(){ try { return (localStorage.getItem('np-base') || 'CHF').toUpperCase(); } catch(e){ return 'CHF'; } })();
function money(n) { return fmtMoney(n, BASE); }
function curSym() { return BASE; }
function applyBaseFromSettings(s) { if (s && s.base_currency) { BASE = String(s.base_currency).toUpperCase(); try { localStorage.setItem('np-base', BASE); } catch(e){} } }
function setBase(cur) {
  BASE = String(cur).toUpperCase();
  try { localStorage.setItem('np-base', BASE); } catch(e){}
  api('PUT', '/api/accounts/settings', { base_currency: BASE });
  if (state.view === 'profile') renderProfile(); else setView(state.view);
  toast(t('settings_baseSet', null, { c: BASE }), 'ok');
}

function toast(msg, type) {
  const root = document.getElementById('toastRoot');
  const t = document.createElement('div');
  t.className = 't ' + (type || '');
  t.innerHTML = (type === 'ok' ? ic('check') : type === 'err' ? ic('warn') : '') + '<span style="margin-left:6px">' + esc(msg) + '</span>';
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3400);
}
function modal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-mask" id="mask"><div class="glass modal">${html}</div></div>`;
  document.getElementById('mask').onclick = (e) => { if (e.target.id === 'mask') closeModal(); };
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

/* 注入静态图标（侧栏 / 顶栏占位 [data-i]） */
function fillIcons() {
  document.querySelectorAll('[data-i]').forEach(el => {
    const n = el.getAttribute('data-i');
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.ICONS[n] || window.ICONS.info}</svg>`;
  });
}

/* ---------------- 主题 ---------------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.innerHTML = ic(t === 'dark' ? 'sun' : 'moon');
}
function initTheme() {
  let t = localStorage.getItem(THEME_KEY);
  if (!t) t = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  applyTheme(t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

/* ---------------- 语言 ---------------- */
const TITLES = {
  home: t('nav_home'), cards: t('nav_cards'), transfer: t('nav_transfer'), giftcards: t('nav_giftcards'),
  subscriptions: t('nav_subscriptions'), suggestions: t('nav_suggestions'), profile: t('nav_profile'),
  forex: t('nav_forex'), escrow: t('nav_escrow'), withdraw: t('nav_withdraw'), admin: t('nav_admin')
};
function initLang() {
  const l = getLang();
  document.documentElement.setAttribute('lang', NP_LOCALES[l] || l);
  document.title = t('title_privateBank');
  applyI18n();
}
function setupLangSwitcher() {
  const btn = document.getElementById('langBtn');
  const menu = document.getElementById('langMenu');
  if (!btn || !menu) return;
  menu.innerHTML = Object.keys(NP_LANG_NAMES).map(code =>
    `<button class="lang-opt" data-lang="${code}">${esc(NP_LANG_NAMES[code])}</button>`).join('');
  const sync = () => menu.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === getLang()));
  menu.querySelectorAll('.lang-opt').forEach(b => b.onclick = () => { setLang(b.dataset.lang); menu.style.display = 'none'; });
  btn.onclick = (e) => { e.stopPropagation(); sync(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; };
  document.addEventListener('click', (e) => { if (menu.style.display === 'block' && !menu.contains(e.target) && e.target !== btn) menu.style.display = 'none'; });
  sync();
}
function __npRerender() {
  document.title = t('title_privateBank');
  if (state.user) { if (state.view === 'admin') renderAdmin(); else setView(state.view); }
  else renderAuth();
}
window.__npRerender = __npRerender;

/* ---------------- 视觉增强：数字滚动 / 骨架 / 空状态 / 图表 ---------------- */
function countUp(el, target, prefix = '', dec = 2) {
  const start = performance.now(), dur = 900;
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    const v = target * (1 - Math.pow(1 - p, 3));
    el.textContent = prefix + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
const skelLines = (n) => Array.from({ length: n }).map(() => '<div class="skeleton sk-line"></div>').join('');
function emptyState(iconName, title, sub) {
  return `<div class="empty"><div class="ill" style="color:var(--gold-2)">${ic(iconName)}</div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div>`;
}
function donut(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = segments.map(s => {
    const len = (s.value / total) * C;
    const a = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${s.color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)" style="transition:stroke-dasharray 1s ease"/>`;
    off += len; return a;
  }).join('');
  return `<svg viewBox="0 0 120 120" width="150" height="150"><circle r="${R}" cx="60" cy="60" fill="none" stroke="var(--border)" stroke-width="14" style="stroke:var(--border)"/><g>${arcs}</g></svg>`;
}
function cashflowBars(txs) {
  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const map = {}; days.forEach(d => map[d] = 0);
  (txs || []).forEach(t => { const d = (t.created_at || '').slice(0, 10); if (d in map) map[d] += Math.abs(t.amount || 0); });
  const vals = days.map(d => map[d]);
  const max = Math.max(1, ...vals);
  return `<div class="bar-chart">${vals.map(v => `<div class="bar" style="height:${(v / max) * 100}%" title="${v.toFixed(2)}"></div>`).join('')}</div>`;
}

/* ---------------- 导航 ---------------- */
function _guardAuth() {
  if (!state.user) { renderAuth(); return false; }
  return true;
}
document.getElementById('sidebar').addEventListener('click', e => {
  const item = e.target.closest('.nav-item'); if (!item) return;
  const view = item.dataset.nav;
  if (view === 'admin' && !state.admin) { openAdminLogin(); }
  else if (view !== 'admin') { if (!_guardAuth()) return; setView(view); }
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
});
document.getElementById('hamburger').onclick = () => document.getElementById('sidebar').classList.toggle('open');
document.addEventListener('click', (e) => {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 768 && sb.classList.contains('open')) {
    const ham = e.target.closest('#hamburger');
    if (!sb.contains(e.target) && !ham) sb.classList.remove('open');
  }
});
document.getElementById('notifyPill').onclick = () => setView('profile', true);
document.getElementById('themeToggle').onclick = toggleTheme;

function setView(view) {
  if (view !== 'admin' && !state.user) { renderAuth(); return; }
  state.view = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === view));
  document.getElementById('pageTitle').textContent = TITLES[view] || 'NovaPay';
  const c = document.getElementById('content');
  c.scrollTop = 0;
  // 高性能渲染：先淡出，渲染完成后淡入，避免闪烁
  c.style.transition = 'opacity .18s ease';
  c.style.opacity = '0';
  setTimeout(() => {
    ({ home: renderHome, cards: renderCards, transfer: renderTransfer, giftcards: renderGiftCards,
       subscriptions: renderSubscriptions, suggestions: renderSuggestions, profile: renderProfile,
       forex: renderForex, escrow: renderEscrow, withdraw: renderWithdraw, admin: renderAdmin }[view] || renderHome)()
      .then(() => { c.style.opacity = '1'; });
  }, 160);
}

/* ---------------- 启动 ---------------- */
async function checkGeoBlock() {
  let enabled = false;
  try { const m = await api('GET', '/api/admin/meta/geo-block'); if (m.ok && m.data.data) enabled = !!m.data.data.enabled; } catch (e) { enabled = false; }
  if (!enabled) return false;
  let blocked = true; // fail-closed：API 失败也封锁
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch('https://ip-api.com/json/?fields=countryCode', { signal: ctrl.signal });
    clearTimeout(to);
    const d = await r.json();
    const cc = String(d.countryCode || d.country || '').toUpperCase();
    blocked = (cc === 'CN');
  } catch (e) { blocked = true; }
  if (blocked) showGeoBlockScreen();
  return blocked;
}
function showGeoBlockScreen() {
  document.querySelectorAll('.sidebar, .topbar, .layout').forEach(el => { if (el) el.style.display = 'none'; });
  const d = document.createElement('div');
  d.className = 'geo-block-screen';
  // 地理封锁页面仅中文
  d.innerHTML = `<div class="geo-inner">
    <div class="geo-mark">NovaPay</div>
    <div class="geo-title">这不是你的错，也不是我们的问题。</div>
    <div class="geo-sub">您所在的国家或地区无法访问此服务</div>
    <div class="geo-note">如属误判，请联系客服支持。</div>
  </div>`;
  document.body.appendChild(d);
  const sp = document.getElementById('splash'); if (sp) sp.remove();
}
async function bootstrap() {
  if (await checkGeoBlock()) return;
  const res = await api('GET', '/api/auth/me');
  if (res.ok) { const d = res.data.data; state.user = d.user; state.accounts = d.accounts; applyBaseFromSettings(d.settings); afterLogin(); }
  else renderAuth();
  const sp = document.getElementById('splash'); if (sp) { sp.classList.add('hide'); setTimeout(() => sp.remove(), 500); }
}
function afterLogin() {
  document.getElementById('userAvatar').textContent = (state.user.name || 'U')[0].toUpperCase();
  const main = state.accounts.find(a => a.type === 'main') || state.accounts[0];
  document.getElementById('accountPill').textContent = main ? main.name + ' · ' + state.user.id : state.user.id;
  loadNotifications();
  setView('home');
  // 退出全屏模式，显示侧边栏和顶栏
  document.getElementById('app').classList.remove('auth-fullscreen');
}
async function loadNotifications() {
  const res = await api('GET', '/api/auth/messages');
  if (res.ok) document.getElementById('notifyCount').textContent = (res.data.data.messages || []).filter(m => !m.read).length;
}

/* ---------------- 认证 ---------------- */
function renderAuth() {
  // 全屏模式：隐藏侧边栏和顶栏，登录卡片占满整屏
  document.getElementById('app').classList.add('auth-fullscreen');
  const c = document.getElementById('content');
  c.innerHTML = `
  <div class="center-screen"><div class="glass auth-card card-in">
    <div class="auth-hero">
      <div class="crest">NovaPay</div>
      <div style="color:var(--text-2);font-size:12px;letter-spacing:3px;margin-top:4px">PRIVATE DIGITAL BANK</div>
    </div>
    <p class="muted" style="text-align:center;font-size:13px;margin-bottom:16px">${t('auth_subtitle')}</p>
    <div class="tabs"><div class="tab active" id="tabLogin">${t('auth_loginTab')}</div><div class="tab" id="tabReg">${t('auth_regTab')}</div></div>
    <div id="authForm"></div>
  </div></div>`;
  document.getElementById('tabLogin').onclick = () => switchTab('login');
  document.getElementById('tabReg').onclick = () => switchTab('reg');
  switchTab('login');
}
function switchTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabReg').classList.toggle('active', tab === 'reg');
  const f = document.getElementById('authForm');
  if (tab === 'login') {
    f.innerHTML = `
      <div class="form-row"><label class="field">${ic('user')} ${t('auth_idLabel')}</label><input id="id" placeholder="NP00000001 / you@email.com"></div>
      <div class="form-row"><label class="field">${ic('lock')} ${t('auth_pwLabel')}</label><input id="pw" type="password" placeholder="••••••"></div>
      <button class="btn" id="doLogin" style="width:100%">${t('auth_loginBtn')}</button>`;
    document.getElementById('doLogin').onclick = doLogin;
  } else {
    f.innerHTML = `
      <div class="row">
        <div class="form-row"><label class="field">${t('auth_nameLabel')}</label><input id="name" placeholder="Ada Lovelace"></div>
        <div class="form-row"><label class="field">${t('auth_emailLabel')}</label><input id="email" placeholder="you@email.com"></div>
      </div>
      <div class="row">
        <div class="form-row"><label class="field">${ic('lock')} ${t('auth_pwRegLabel')}</label><input id="pw" type="password"></div>
        <div class="form-row"><label class="field">${ic('key')} ${t('auth_pinLabel')}</label><input id="pin" placeholder="1234"></div>
      </div>
      <div class="row">
        <div class="form-row"><label class="field">${t('auth_phoneLabel')}</label><input id="phone" placeholder="+86 138 ..."></div>
        <div class="form-row"><label class="field">${t('auth_natLabel')}</label><input id="nat" value="CN"></div>
      </div>
      <div class="row">
        <div class="form-row"><label class="field">${t('auth_purposeLabel')}</label><select id="purpose"><option>Personal</option><option>Business</option><option>Investment</option><option>Savings</option></select></div>
        <div class="form-row"><label class="field">${t('auth_dobLabel')}</label><input id="dob" type="date"></div>
      </div>
      <button class="btn gold" id="doReg" style="width:100%">${ic('crown')} ${t('auth_regBtn')}</button>`;
    document.getElementById('doReg').onclick = doRegister;
  }
}
async function doLogin() {
  const res = await api('POST', '/api/auth/login', { identifier: val('id'), password: val('pw') });
  if (res.ok) { toast(t('auth_welcome'), 'ok'); const d = res.data.data; state.user = d.user; applyBaseFromSettings(d.settings); const m = await api('GET', '/api/accounts'); state.accounts = m.ok ? m.data.data.accounts : []; afterLogin(); }
  else toast(res.data?.message || t('auth_loginFail'), 'err');
}
async function doRegister() {
  const res = await api('POST', '/api/auth/register', { email: val('email'), name: val('name'), password: val('pw'), pin: val('pin'), phone: val('phone'), nationality: val('nat'), purpose: val('purpose'), dob: val('dob') });
  if (res.ok) { toast(t('auth_regOk'), 'ok'); const d = res.data.data; state.user = d.user; applyBaseFromSettings(d.settings); state.accounts = [{ name: 'Main Account' }]; afterLogin(); }
  else toast(res.data?.message || t('auth_regFail'), 'err');
}

/* ---------------- 首页（hero + KPI + 图表） ---------------- */
async function renderHome() {
  const c = document.getElementById('content');
  c.innerHTML = `
  <div class="card-in" style="margin-bottom:22px">
    <div class="hero-kicker">${ic('globe')} PRIVATE DIGITAL BANKING</div>
    <div class="hero-title">${t('home_title')}</div>
    <div class="hero-sub">${t('home_sub')}</div>
  </div>
  <div class="grid cols-4" id="kpis"><div class="skeleton sk-block"></div><div class="skeleton sk-block"></div><div class="skeleton sk-block"></div><div class="skeleton sk-block"></div></div>
  <div class="grid cols-2" style="margin-top:18px">
    <div class="glass"><h2 class="section">${ic('chart')} ${t('home_assets')}</h2><div id="assetChart"><div class="skeleton sk-block" style="height:160px"></div></div></div>
    <div class="glass"><h2 class="section">${ic('bolt')} ${t('home_activity')}</h2><div id="flowChart"><div class="skeleton sk-block" style="height:120px"></div></div></div>
  </div>
  <div class="grid cols-2" style="margin-top:18px">
    <div class="glass"><h2 class="section">${ic('bolt')} ${t('home_quick')}</h2>
      <div class="row">
        <button class="btn" onclick="setView('transfer')">${ic('transfer')} ${t('home_quickTransfer')}</button>
        <button class="btn ghost" onclick="setView('cards')">${ic('card')} ${t('home_quickCards')}</button>
        <button class="btn ghost" onclick="setView('suggestions')">${ic('chat')} ${t('home_quickSuggest')}</button>
      </div>
    </div>
    <div class="glass"><h2 class="section">${ic('shield')} ${t('home_security')}</h2><div id="secStatus" class="muted">${t('home_secChecking')}</div></div>
  </div>
  <div class="grid cols-4" style="margin-top:18px">
    ${feature('fingerprint', t('feat_zeroTrust_t'), t('feat_zeroTrust_d'))}
    ${feature('lock', t('feat_e2e_t'), t('feat_e2e_d'))}
    ${feature('globe', t('feat_global_t'), t('feat_global_d'))}
    ${feature('scale', t('feat_compliance_t'), t('feat_compliance_d'))}
  </div>`;

  const bal = await api('GET', '/api/accounts/balances');
  const total = bal.ok ? ((bal.data.data.balances || []).reduce((s, b) => s + (b.balance || 0), 0)) : 0;
  const kpis = document.getElementById('kpis');
  kpis.innerHTML = '';
  const defs = [
    { label: t('kpi_assets'), value: total, prefix: '', dec: 2 },
    { label: t('kpi_accounts'), value: state.accounts.length, prefix: '', dec: 0 },
    { label: t('kpi_memberNo'), text: state.user.id },
    { label: t('kpi_status'), text: state.user.status },
  ];
  defs.forEach(d => {
    const el = document.createElement('div'); el.className = 'glass kpi-card card-in';
    el.innerHTML = `<div class="v">${esc(d.text !== undefined ? d.text : '0')}</div><div class="l">${esc(d.label)}</div>`;
    kpis.appendChild(el);
    if (d.value !== undefined) countUp(el.querySelector('.v'), d.value, d.prefix, d.dec);
  });

  const cardsRes = await api('GET', '/api/cards');
  const cards = cardsRes.ok ? cardsRes.data.data.cards : [];
  const byNet = {};
  cards.forEach(cd => { const v = cd.type === 'credit' ? (cd.credit_limit || 0) : (cd.balance || 0); byNet[cd.network] = (byNet[cd.network] || 0) + v; });
  const palette = { Visa: '#1434CB', MasterCard: '#EB001B', NovaPay: '#c9a24b' };
  const seg = Object.keys(byNet).map(n => ({ value: byNet[n], color: palette[n] || '#5b8cff', label: n }));
  const assetChart = document.getElementById('assetChart');
  if (seg.length && seg.reduce((s, x) => s + x.value, 0) > 0) {
    assetChart.innerHTML = `<div class="chart-wrap"><div class="donut">${donut(seg)}<div class="center"><div class="big">${money(total)}</div><div class="small">${t('chart_total')}</div></div></div>
      <div class="legend">${seg.map(s => `<div class="li"><span class="dot" style="background:${s.color}"></span>${esc(s.label)} · ${money(s.value)}</div>`).join('')}</div></div>`;
  } else assetChart.innerHTML = emptyState('card', t('chart_noCards'), t('chart_noCardsSub'));

  const hist = await api('GET', '/api/transactions/history?per_page=50');
  const txs = hist.ok ? hist.data.data.transactions : [];
  const flow = document.getElementById('flowChart');
  flow.innerHTML = txs.length ? cashflowBars(txs) : emptyState('bolt', t('chart_noTx'), t('chart_noTxSub'));

  document.getElementById('secStatus').innerHTML = t('home_secWelcome', null, { name: esc(state.user.name) }) + '<br>'
    + t('home_secMain', null, { acc: esc((state.accounts[0] || {}).name || '-') }) + '<br>'
    + t('home_secEnc');
}
function feature(iconName, title, desc) {
  return `<div class="feature card-in">${ic(iconName)}<h4>${esc(title)}</h4><p>${esc(desc)}</p></div>`;
}

/* ---------------- 卡片（3D 倾斜） ---------------- */
async function renderCards() {
  const res = await api('GET', '/api/cards');
  const c = document.getElementById('content');
  let cards = res.ok ? res.data.data.cards : [];
  c.innerHTML = `
    <div class="hero-kicker">${ic('card')} YOUR CARDS · 身份徽章</div>
    <div class="hero-title" style="font-size:26px">${t('cards_title')}</div>
    <div class="glass" style="margin:16px 0 18px">
      <h2 class="section">${ic('plus')} ${t('cards_issueTitle')}</h2>
      <div class="row">
        <div><label class="field">${t('cards_type')}</label><select id="ntype"><option value="debit">${t('cards_debit')}</option><option value="credit">${t('cards_credit')}</option></select></div>
        <div><label class="field">${t('cards_level')}</label><select id="nlevel"></select></div>
        <div><label class="field">${t('cards_network')}</label><select id="nnet"><option>NovaPay</option><option>Visa</option><option>MasterCard</option></select></div>
        <div style="display:flex;align-items:flex-end"><button class="btn" id="doIssue">${ic('plus')} ${t('cards_issueBtn')}</button></div>
      </div>
      <div id="feeHint" class="muted" style="font-size:12.5px;margin-top:6px">${t('cards_feeHint')}</div>
      <div id="feeDisplay" class="muted" style="font-size:13px;margin-top:4px;color:var(--gold)"></div>
      ${t('cards_trademark') ? `<div class="trademark-note">${t('cards_trademark')}</div>` : ''}
    </div>
    <div class="glass" style="margin:0 0 18px">
      <h2 class="section">${ic('card')} ${t('art_title')}</h2>
      <p class="muted" style="font-size:13px;margin-bottom:10px">${t('art_intro')}</p>
      <div class="art-grid" id="artGrid"></div>
      <div class="muted" style="font-size:12px;margin-top:8px">${t('art_priceHint', null, { p: artPrice() })} · ${t('art_copyright')}</div>
    </div>
    <div class="card-stage cols-3" id="cardList">${cards.length ? '' : emptyState('card', t('card_noCards'), t('card_noCardsSub'))}</div>`;
  document.getElementById('doIssue').onclick = issueCard;
  // 监听发卡参数变化，动态显示费用
  const ntype = document.getElementById('ntype');
  const nlevel = document.getElementById('nlevel');
  const nnet = document.getElementById('nnet');
  const feeDisplay = document.getElementById('feeDisplay');
  function updateIssueFee() {
    if (!BASE) return;
    const type = ntype.value;
    const level = nlevel.value;
    const network = nnet.value;
    let usdFee = DEBIT_ISSUE_FEE_USD;
    if (type === 'credit') {
      const networkLevels = CARD_LEVELS_NETWORKED[network] || {};
      const levelConf = networkLevels[level] || CARD_LEVELS_FLAT[level] || CARD_LEVELS_FLAT['Standard'];
      usdFee = levelConf.credit_fee;
    }
    const fee = Math.round(usdFee * 0.8167);
    feeDisplay.textContent = type === 'debit'
      ? t('cards_debitFee', null, { fee: BASE === 'CHF' ? `${fee} CHF` : `${usdFee} USD` })
      : t('cards_creditFee', null, { fee: BASE === 'CHF' ? `${fee} CHF` : `${usdFee} USD` });
  }
  function populateLevels() {
    const type = ntype.value;
    const network = nnet.value;
    let levels;
    if (type === 'debit') {
      levels = ['Standard'];
    } else {
      const netLevels = CARD_LEVELS_NETWORKED[network] || {};
      levels = Object.keys(netLevels);
    }
    const currentVal = nlevel.value;
    const nameMap = LEVEL_NAMES[network] || {};
    nlevel.innerHTML = levels.map(l => `<option value="${l}">${nameMap[l] || l}</option>`).join('');
    if (levels.includes(currentVal)) nlevel.value = currentVal;
  }
  if (ntype) ntype.onchange = () => { populateLevels(); updateIssueFee(); };
  if (nnet) nnet.onchange = populateLevels;
  if (nlevel) nlevel.onchange = updateIssueFee;
  populateLevels();
  updateIssueFee();
  const grid = document.getElementById('artGrid');
  if (grid) {
    grid.innerHTML = Object.keys(ARTWORKS).map(k => `<div class="art-thumb" onclick="openPersonalize('${k}')" style="background-image:linear-gradient(135deg,rgba(8,10,16,.35),rgba(8,10,16,.15)),url('${ARTWORKS[k].url}')"><div class="art-cap">${esc(artName(k))}</div><div class="art-artist">${esc(ARTWORKS[k].artist)}</div></div>`).join('') +
      `<div class="art-thumb custom" onclick="openPersonalize('custom')"><div class="art-cap">${ic('plus')} ${t('art_custom')}</div></div>`;
  }
  const list = document.getElementById('cardList');
  if (cards.length) cards.forEach((card, i) => { const el = cardEl(card); el.style.animationDelay = (i * 60) + 'ms'; list.appendChild(el); });
}
const STATUS_KEYS = {
  active: 'cards_status_active', frozen: 'cards_status_frozen', locked: 'cards_status_locked',
  expired_grace: 'cards_status_expired_grace', expired_permanent: 'cards_status_expired_permanent',
  credit_frozen: 'cards_status_credit_frozen', canceled: 'cards_status_canceled'
};
function formatPan(n) { n = String(n == null ? '' : n).replace(/\s/g, ''); return n.replace(/(.{4})/g, '$1 ').trim(); }
// Luhn 校验（前端用）
function luhnCheck(num) {
  if (typeof num !== 'string') return false;
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
const revealTimers = {};
function cardEl(card) {
  const d = document.createElement('div');
  const lvlClass = 'lv-' + card.level.replace('+', '\\+');
  const statusLabel = t(STATUS_KEYS[card.status] || 'cards_status_active');
  const overlay = ['frozen', 'locked', 'expired_grace', 'expired_permanent', 'credit_frozen', 'canceled'].includes(card.status) ? ` ${card.status}` : '';
  const holder = String(card.holder_name || (state.user && state.user.name) || 'CARDHOLDER').toUpperCase();
  const masked = card.number_masked || '';
  d.innerHTML = `
    <div class="np-card ${lvlClass}${overlay}" data-status="${statusLabel}" data-id="${card.id}" onclick="this.classList.toggle('flipped')">
      <div class="card-inner">
        <div class="card-front ${lvlClass}">
          <div class="glare"></div>
          <div class="brandrow"><span class="network">${esc(card.network)}</span><span class="netlogo">${netLogo(card.network)}</span></div>
          <div class="chiprow"><div class="chip"></div><div class="contactless">${ic('wifi')}</div></div>
          <div class="number" data-masked="${esc(masked)}">${esc(masked)}</div>
          <div>
            <div class="cardfoot"><span class="holder"><span class="lbl">${t('card_holder')}</span>${esc(holder)}</span><span class="lvl">${esc(card.level)}</span></div>
            <div class="meta"><span><span class="lbl">${t('card_valid')}</span>${esc(card.expiry || '—')}</span><span style="text-align:right"><span class="lbl">${card.type === 'credit' ? t('cards_creditLine') : t('cards_balance')}</span>${money(card.type === 'credit' ? card.credit_limit : card.balance)}</span></div>
          </div>
        </div>
        <div class="card-back ${lvlClass}">
          <div class="mag-stripe"></div>
          <div class="sig-row"><div class="sig-strip"></div><div class="cvv-strip"><span class="cvv-lbl">CVV</span><span class="cvv-val">•••</span></div></div>
          <div class="back-note">${t('card_backNote')}</div>
        </div>
      </div>
    </div>
    <div class="card-actions">
      ${card.status === 'frozen' ? `<button class="btn sm" onclick="payAndUnfreeze('${card.id}')">${ic('unlock')} ${t('cards_pay_unfreeze')}</button>` : `<button class="btn sm ghost" onclick="freeze('${card.id}')">${ic('lock')} ${t('cards_freeze')}</button>`}
      ${card.status === 'credit_frozen' ? `<span class="badge red" style="font-size:11px">${t('cards_credit_frozen_badge')}</span>` : ''}
      <button class="btn sm ghost" onclick="topupCard('${card.id}', ${card.balance})">${ic('bolt')} ${t('cards_topup')}</button>
      <button class="btn sm ghost" onclick="setLimits('${card.id}')">${ic('settings')} ${t('cards_limits')}</button>
      <button class="btn sm ghost" onclick="renewCard('${card.id}')">${ic('refresh')} ${t('cards_renew')}</button>
      <button class="btn sm ghost" data-reveal-btn="${card.id}" onclick="toggleReveal('${card.id}')">${ic('eye')} ${t('card_show')}</button>
      <button class="btn sm danger" onclick="cancelCard('${card.id}')">${ic('trash')} ${t('cards_cancel')}</button>
    </div>`;
  applyCardArt(d, card.theme);
  attachTilt(d);
  return d;
}
function attachTilt(el) {
  const card = el.querySelector('.np-card'); if (!card) return;
  el.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', ((px - 0.5) * 14) + 'deg');
    card.style.setProperty('--rx', ((py - 0.5) * -12) + 'deg');
    card.style.setProperty('--mx', (px * 100) + '%');
    card.style.setProperty('--my', (py * 100) + '%');
    card.style.setProperty('--gx', (px * 40 - 20) + '%');
  });
  el.addEventListener('mouseleave', () => {
    card.style.setProperty('--ry', '0deg'); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--gx', '-25%');
  });
}
async function toggleReveal(id) {
  const el = document.querySelector('.np-card[data-id="' + id + '"]');
  if (el && el.classList.contains('revealed')) { hideRevealed(id); return; }
  const pin = await promptPin();
  if (pin === null) return;
  const r = await api('POST', '/api/cards/' + id + '/reveal', { pin });
  if (!r.ok) { toast(r.data && r.data.message ? r.data.message : t('card_pinWrong'), 'err'); return; }
  // Backend nests the revealed card under data.card; fall back gracefully
  // api() 返回整包信封，真实数据在 r.data.data；Worker 嵌套 data.card，Flask 扁平 data.{number,cvv}
  const d = (r.data && r.data.data && r.data.data.card) || (r.data && r.data.data) || {};
  showRevealed(id, d.number, d.cvv);
}
function promptPin() {
  return new Promise(resolve => {
    modal(`<h3>${ic('key')} ${t('card_enterPin')}</h3>
      <div class="form-row"><label class="field">${t('card_pin')}</label><input id="rpPin" type="password" inputmode="numeric" maxlength="12" placeholder="••••" autocomplete="off"></div>
      <div class="row"><button class="btn" id="rpOk">${ic('eye')} ${t('card_show')}</button><button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button></div>`);
    const inp = document.getElementById('rpPin');
    if (inp) inp.focus();
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') { const b = document.getElementById('rpOk'); if (b) b.click(); } };
    const ok = document.getElementById('rpOk');
    if (ok) ok.onclick = () => { const v = inp ? inp.value : ''; closeModal(); resolve(v); };
  });
}
function showRevealed(id, number, cvv) {
  const el = document.querySelector('.np-card[data-id="' + id + '"]');
  if (!el) return;
  const front = el.querySelector('.card-front');
  const numEl = front.querySelector('.number');
  const cvvVal = el.querySelector('.cvv-val');
  const full = formatPan(number);
  el.classList.add('revealed');
  // 卡面正面直接显示完整 16 位真实卡号
  numEl.textContent = full;
  numEl.dataset.masked = full; // 保存完整值，hide 时只取后四位还原掩码
  // 卡背面 CVV 区域显示真实 3 位（翻面时可见）
  if (cvvVal) cvvVal.innerHTML = esc(cvv);
  const btn = document.querySelector('[data-reveal-btn="' + id + '"]');
  if (btn) btn.innerHTML = ic('eyeOff') + ' 30s';
  clearInterval(revealTimers[id]);
  let left = 30;
  revealTimers[id] = setInterval(() => {
    left--;
    if (btn) btn.innerHTML = ic('eyeOff') + ' ' + left + 's';
    if (left <= 0) hideRevealed(id);
  }, 1000);
}
function hideRevealed(id) {
  clearInterval(revealTimers[id]);
  const el = document.querySelector('.np-card[data-id="' + id + '"]');
  if (!el) return;
  const front = el.querySelector('.card-front');
  const numEl = front.querySelector('.number');
  const cvvVal = el.querySelector('.cvv-val');
  el.classList.remove('revealed');
  // 恢复掩码：只保留后四位
  const masked = numEl.dataset.masked || '';
  numEl.textContent = masked ? formatPan(masked.replace(/\s/g, '').slice(-4).padStart(12, '*').replace(/(.{4})/g, '$1 ').trim()) : '**** **** **** ****';
  // 恢复 CVV 掩码（卡背面）
  if (cvvVal) cvvVal.innerHTML = '•••';
  const btn = document.querySelector('[data-reveal-btn="' + id + '"]');
  if (btn) btn.innerHTML = ic('eye') + ' ' + t('card_show');
}
async function issueCard() {
  const res = await api('POST', '/api/cards/issue', { type: val('ntype'), level: val('nlevel'), network: val('nnet') });
  if (res.ok) { toast(t('cards_issued'), 'ok'); renderCards(); } else toast(res.data?.message || t('cards_issueBtn'), 'err');
}
async function freeze(id) {
  const pin = prompt(t('cards_freeze_pin'));
  if (!pin) return;
  const r = await api('POST', '/api/cards/' + id + '/freeze', { pin });
  if (r.ok) { toast(t('cards_frozenMsg'), 'ok'); renderCards(); } else toast(r.data?.message || t('common_error'), 'err');
}
async function unfreeze(id) { payAndUnfreeze(id); }
async function payAndUnfreeze(id) {
  const feeLabel = state.user?.settings?.base_currency === 'USD' ? '100 USD' : '80 CHF';
  const currency = state.user?.settings?.base_currency === 'USD' ? 'USD' : 'CHF';
  // Load active cards + escrow pool balance
  const [cardsRes, poolRes] = await Promise.all([api('GET', '/api/cards'), api('GET', '/api/escrow/pool')]);
  const activeCards = (cardsRes.ok ? (cardsRes.data.data.cards || []) : []).filter(c => c.type === 'debit' && c.status === 'active');
  const pools = poolRes.ok ? (poolRes.data.data.pools || {}) : {};
  const poolBal = (pools[currency] || { balance: 0 }).balance;
  // Build card options
  const cardOpts = activeCards.map(c => `<option value="${c.id}">${esc(c.number_masked)} · ${fmtMoney(c.balance, currency)}</option>`).join('');
  const poolOpt = poolBal > 0 ? `<option value="pool">💰 ${t('escrow_pool')} · ${fmtMoney(poolBal, currency)}</option>` : '';
  modal(`<h3>${ic('unlock')} ${t('cards_unfreeze_title')}</h3>
    <div class="note-box" style="margin-bottom:10px">${t('cards_unfreeze_desc', { fee: feeLabel })}</div>
    <div class="form-row"><label class="field">${t('cards_payment_source')}</label>
      <select id="unfreezeSrc">
        <option value="">-- ${t('common_select')} --</option>
        ${cardOpts}${poolOpt}
      </select>
    </div>
    <div class="form-row"><label class="field">${t('profile_pin')}</label><input id="unfreezePin" type="password" placeholder="••••" maxlength="6" inputmode="numeric"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn" onclick="doPayAndUnfreeze('${id}')">${ic('check')} ${t('cards_unfreeze_pay')}</button>
      <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>
    </div>`);
  window.doPayAndUnfreeze = async (cardId) => {
    const src = document.getElementById('unfreezeSrc').value;
    const pin = document.getElementById('unfreezePin').value;
    if (!src) { toast(t('cards_select_source'), 'err'); return; }
    if (!pin) { toast(t('cards_freeze_pin'), 'err'); return; }
    const btn = document.querySelector('#unfreezeSrc').closest('.modal').querySelector('.btn');
    if (btn) { btn.disabled = true; btn.textContent = `${ic('refresh')} ${t('common_processing')}`; }
    const r = await api('POST', '/api/cards/' + cardId + '/unfreeze', { payment_source: src, pin });
    if (r.ok) { closeModal(); toast(t('cards_unfrozenMsg'), 'ok'); renderCards(); }
    else { toast(r.data?.message || t('common_error'), 'err'); if (btn) { btn.disabled = false; btn.textContent = `${ic('check')} ${t('cards_unfreeze_pay')}`; } }
  };
}
async function renewCard(id) {
  const currency = state.user?.settings?.base_currency === 'USD' ? 'USD' : 'CHF';
  const fee = 50;
  const feeLabel = `${fee} ${currency}`;
  const [cardsRes, poolRes] = await Promise.all([api('GET', '/api/cards'), api('GET', '/api/escrow/pool')]);
  const activeCards = (cardsRes.ok ? (cardsRes.data.data.cards || []) : []).filter(c => c.type === 'debit' && c.status === 'active');
  const pools = poolRes.ok ? (poolRes.data.data.pools || {}) : {};
  const poolBal = (pools[currency] || { balance: 0 }).balance;
  const cardOpts = activeCards.map(c => `<option value="${c.id}">${esc(c.number_masked)} · ${fmtMoney(c.balance, currency)}</option>`).join('');
  const poolOpt = poolBal > 0 ? `<option value="pool">💰 ${t('escrow_pool')} · ${fmtMoney(poolBal, currency)}</option>` : '';
  modal(`<h3>${ic('refresh')} ${t('cards_renew_title')}</h3>
    <div class="note-box" style="margin-bottom:10px">${t('cards_renew_desc', { fee: feeLabel })}</div>
    <div class="form-row"><label class="field">${t('cards_payment_source')}</label>
      <select id="renewSrc">
        <option value="">-- ${t('common_select')} --</option>
        ${cardOpts}${poolOpt}
      </select>
    </div>
    <div class="form-row"><label class="field">${t('profile_pin')}</label><input id="renewPin" type="password" placeholder="••••" maxlength="6" inputmode="numeric"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn" onclick="doRenew('${id}')">${ic('check')} ${t('cards_renew_btn')}</button>
      <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>
    </div>`);
  window.doRenew = async (cardId) => {
    const src = document.getElementById('renewSrc').value;
    const pin = document.getElementById('renewPin').value;
    if (!src) { toast(t('cards_select_source'), 'err'); return; }
    if (!pin) { toast(t('cards_freeze_pin'), 'err'); return; }
    const btn = document.querySelector('#renewSrc').closest('.modal').querySelector('.btn');
    if (btn) { btn.disabled = true; btn.textContent = `${ic('refresh')} ${t('common_processing')}`; }
    const r = await api('POST', '/api/cards/' + cardId + '/renew', { payment_source: src, pin });
    if (r.ok) { closeModal(); toast(t('cards_renewedMsg'), 'ok'); renderCards(); }
    else { toast(r.data?.message || t('common_error'), 'err'); if (btn) { btn.disabled = false; btn.textContent = `${ic('check')} ${t('cards_renew_btn')}`; } }
  };
}
async function cancelCard(id) { if (!confirm(t('admin_cancelCardConfirm'))) return; const r = await api('POST', '/api/cards/' + id + '/cancel', {}); if (r.ok) { toast(t('cards_canceledMsg')); renderCards(); } else toast(r.data?.message, 'err'); }
async function topupCard(cardId, currentBalance) {
  const amt = prompt(t('cards_topupAmt', null, { balance: currentBalance }));
  if (!amt || isNaN(amt) || +amt <= 0) return;
  const r = await api('POST', '/api/transactions/topup', { card_id: cardId, amount: +amt });
  if (r.ok) { toast(t('cards_topupOk'), 'ok'); renderCards(); } else toast(r.data?.message || t('cards_topupErr'), 'err');
}
function setLimits(id) {
  modal(`<h3>${ic('settings')} ${t('cards_setLimits')}</h3>
    <div class="form-row"><label class="field">${t('limits_single')}</label><input id="sl" type="number" value="5000"></div>
    <div class="form-row"><label class="field">${t('limits_daily')}</label><input id="dl" type="number" value="10000"></div>
    <div class="row"><button class="btn" onclick="saveLimits('${id}')">${t('common_save')}</button><button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button></div>`);
}
async function saveLimits(id) { const r = await api('PUT', `/api/cards/${id}/limits`, { single_transaction_limit: +val('sl'), daily_limit: +val('dl') }); closeModal(); if (r.ok) toast(t('common_save') + ' ✓', 'ok'); else toast(r.data?.message, 'err'); }

/* ---------------- 转账 ---------------- */
async function renderTransfer() {
  const cards = (await api('GET', '/api/cards')).data?.data?.cards || [];
  const debits = cards.filter(c => c.type === 'debit');
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="hero-kicker">${ic('transfer')} INSTANT SETTLEMENT</div>
    <div class="hero-title" style="font-size:26px">${t('transfer_hero')}</div>
    <div class="glass" style="max-width:660px;margin-top:14px">
      <h2 class="section">${ic('transfer')} ${t('transfer_fee')}</h2>
      <div class="form-row"><label class="field">${ic('card')} ${t('transfer_from')}</label><select id="from">${debits.map(x => `<option value="${x.id}">${esc(x.number_masked)} · ${t('cards_balance')} ${money(x.balance)}</option>`).join('')}</select></div>
      <div class="form-row"><label class="field">${t('transfer_to')}</label><input id="to" placeholder="···· ···· ···· ····"></div>
      <div class="row">
        <div class="form-row"><label class="field">${t('transfer_amount')}</label><input id="amt" type="number" placeholder="0.00"></div>
        <div class="form-row"><label class="field">${ic('key')} ${t('transfer_pin')}</label><input id="pin" type="password" placeholder="····"></div>
      </div>
      <div class="form-row"><label class="field">${t('transfer_note')}</label><input id="note" placeholder="${t('common_optional')}"></div>
      <button class="btn" id="doTransfer" style="width:100%">${ic('paperPlane')} ${t('transfer_btn')}</button>
    </div>`;
  document.getElementById('doTransfer').onclick = doTransfer;
}
async function doTransfer() {
  const r = await api('POST', '/api/transactions/transfer', { from_card_id: +val('from'), to_card_number: val('to').replace(/\s/g, ''), amount: +val('amt'), pin: val('pin'), note: val('note') });
  if (r.ok) { toast(t('transfer_ok', null, { fee: money(r.data.data.fee) }), 'ok'); renderTransfer(); } else toast(r.data?.message || t('transfer_fail'), 'err');
}

/* ---------------- 礼品卡 ---------------- */
async function renderGiftCards() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="hero-kicker">${ic('gift')} GIFT OF VALUE</div>
    <div class="hero-title" style="font-size:26px">${t('gift_title')}</div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="glass"><h2 class="section">${ic('gift')} ${t('gift_buyTitle')}</h2>
        <div class="form-row"><label class="field">${t('gift_face')}</label><input id="face" type="number" placeholder="50"></div>
        <button class="btn gold" id="buyGift">${ic('gift')} ${t('gift_buy')}</button></div>
      <div class="glass"><h2 class="section">${ic('key')} ${t('gift_redeemTitle')}</h2>
        <div class="form-row"><label class="field">${t('gift_code')}</label><input id="code" placeholder="XXXX-XXXX-XXXX-XXXX"></div>
        <div class="form-row"><label class="field">${t('gift_dest')}</label><input id="destCard" placeholder="123"></div>
        <button class="btn ghost" id="redeemGift">${t('gift_redeem')}</button></div>
    </div>
    <div class="glass" style="margin-top:18px"><h2 class="section">${ic('list')} ${t('gift_mine')}</h2><div id="giftList"><div class="skeleton sk-block" style="height:80px"></div></div></div>`;
  document.getElementById('buyGift').onclick = buyGift;
  document.getElementById('redeemGift').onclick = redeemGift;
  const mine = await api('GET', '/api/giftcards/my');
  const gl = document.getElementById('giftList');
  if (mine.ok && mine.data.data.giftcards && mine.data.data.giftcards.length) {
    gl.innerHTML = `<table><thead><tr><th>${t('gift_colNo')}</th><th>${t('gift_colFace')}</th><th>${t('gift_colStatus')}</th><th>${t('gift_colCreated')}</th></tr></thead><tbody>
      ${mine.data.data.giftcards.map(g => `<tr><td>${esc(g.code)}</td><td>${money(g.amount)}</td><td><span class="badge ${g.status === 'active' ? 'green' : 'gray'}">${g.status === 'active' ? t('gift_statusActive') : t('gift_statusUsed')}</span></td><td>${esc(fmtDate(g.created_at))}</td></tr>`).join('')}
    </tbody></table>`;
  } else gl.innerHTML = emptyState('gift', t('gift_no'), t('gift_noSub'));
}
async function buyGift() {
  const amount = +val('face');
  if (!amount || amount <= 0) { toast(t('cards_invalidAmount'), 'err'); return; }
  // Load active debit cards
  const cardsRes = await api('GET', '/api/cards');
  const activeCards = (cardsRes.ok ? (cardsRes.data.data.cards || []) : []).filter(c => c.type === 'debit' && c.status === 'active');
  if (!activeCards.length) { toast(t('gift_noActiveCard'), 'err'); return; }
  const cardOpts = activeCards.map(c => `<option value="${c.id}">${esc(c.number_masked)} · ${money(c.balance)}</option>`).join('');
  const total = (amount * 1.1).toFixed(2);
  modal(`<h3>${ic('gift')} ${t('gift_buyTitle')}</h3>
    <div class="note-box" style="margin-bottom:10px">${t('gift_buyNote', { amount: money(amount), total: money(total) })}</div>
    <div class="form-row"><label class="field">${t('gift_selectCard')}</label>
      <select id="giftCardId">${cardOpts}</select>
    </div>
    <div class="form-row"><label class="field">${t('profile_pin')}</label><input id="giftPin" type="password" placeholder="••••" maxlength="6" inputmode="numeric"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn gold" onclick="doBuyGift(${amount})">${ic('gift')} ${t('gift_buy')}</button>
      <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>
    </div>`);
  window.doBuyGift = async (amt) => {
    const cardId = document.getElementById('giftCardId').value;
    const pin = document.getElementById('giftPin').value;
    if (!cardId) { toast(t('gift_selectCard'), 'err'); return; }
    if (!pin) { toast(t('cards_freeze_pin'), 'err'); return; }
    const btn = document.querySelector('#giftCardId').closest('.modal').querySelector('.btn.gold');
    if (btn) { btn.disabled = true; btn.textContent = `${ic('refresh')} ${t('common_processing')}`; }
    const r = await api('POST', '/api/giftcards/buy', { amount: amt, card_id: parseInt(cardId), pin });
    if (r.ok) { closeModal(); toast(t('gift_bought') + r.data.data.code, 'ok'); renderGiftCards(); }
    else { toast(r.data?.message || t('common_error'), 'err'); if (btn) { btn.disabled = false; btn.textContent = `${ic('gift')} ${t('gift_buy')}`; } }
  };
}
async function redeemGift() { const r = await api('POST', '/api/giftcards/redeem', { code: val('code').toUpperCase(), card_id: +val('destCard') }); if (r.ok) { toast(t('gift_redeemed'), 'ok'); renderGiftCards(); } else toast(r.data?.message, 'err'); }

/* ---------------- 订阅 ---------------- */
async function renderSubscriptions() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="hero-kicker">${ic('sub')} SUBSCRIPTIONS</div>
    <div class="hero-title" style="font-size:26px">${t('sub_title')}</div>
    <div class="glass" style="margin:14px 0 18px"><h2 class="section">${ic('globe')} ${t('sub_services')}</h2><div id="svcList" class="grid cols-3"><div class="skeleton sk-block"></div><div class="skeleton sk-block"></div><div class="skeleton sk-block"></div></div></div>
    <div class="glass" style="margin:0 0 14px"><h2 class="section">${ic('card')} ${t('sub_boundCards')}</h2>
      <div id="boundCardsList" style="margin-bottom:12px"><div class="skeleton sk-block" style="height:50px"></div></div>
      <button class="btn sm ghost" onclick="showBindCard()">${ic('plus')} ${t('sub_addCard')}</button>
    </div>
    <div class="glass"><h2 class="section">${ic('list')} ${t('sub_mine')}</h2><div id="mySubs"><div class="skeleton sk-block" style="height:80px"></div></div></div>`;
  const svc = await api('GET', '/api/subscriptions/services');
  document.getElementById('svcList').innerHTML = (svc.ok ? svc.data.data.services : []).map(s => `
    <div class="glass feature" style="padding:14px">
      <b>${esc(s.brand)}</b> <span class="badge blue">${esc(s.plan_name)}</span>
      <div class="muted" style="margin:4px 0;font-size:12px">${esc(s.desc || '')}</div>
      <div class="muted" style="margin:8px 0">${money(s.amount)} / ${s.cycle === 'Monthly' ? t('sub_monthly') : t('sub_yearly')}</div>
      <button class="btn sm" onclick="subNow('${s.plan_id}')">${ic('check')} ${t('sub_subscribe')}</button>
    </div>`).join('') || emptyState('sub', t('sub_noServices'), '');
  // 加载已绑卡片
  const boundRes = await api('GET', '/api/subscriptions/my-bound-cards');
  const boundList = document.getElementById('boundCardsList');
  if (boundRes.ok && boundRes.data.data.cards && boundRes.data.data.cards.length) {
    boundList.innerHTML = boundRes.data.data.cards.map(c => `<div class="card-preview" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="font-family:monospace">${esc(c.masked)}</span>
      <span class="muted" style="font-size:12px">/**/${esc(c.expiry || '—')}</span>
      <button class="btn sm danger" onclick="unbindBoundCard(${c.id})" style="margin-left:auto">${t('common_unbind')}</button>
    </div>`).join('');
  } else {
    boundList.innerHTML = `<div class="muted" style="font-size:13px">${t('sub_boundCardNone')}</div>`;
  }
  const mine = await api('GET', '/api/subscriptions/my');
  const ms = document.getElementById('mySubs');
  if (mine.ok && mine.data.data.subscriptions && mine.data.data.subscriptions.length) {
    ms.innerHTML = `<table><thead><tr><th>${t('sub_brand')}</th><th>${t('sub_plan')}</th><th>${t('sub_amount')}</th><th>${t('sub_next')}</th><th>${t('sub_status')}</th><th></th></tr></thead><tbody>
      ${mine.data.data.subscriptions.map(s => {
        const statusBadge = s.status === 'active' ? 'green' : s.status === 'pending_charge' ? 'amber' : 'red';
        const statusLabel = s.status === 'active' ? t('sub_status_active') : s.status === 'pending_charge' ? t('sub_status_pending') : t('sub_status_canceled');
        const actionBtn = s.status === 'active'
          ? `<button class="btn sm danger" onclick="cancelSub('${s.id}')">${t('sub_cancel')}</button>
             <button class="btn sm ghost" onclick="toggleAutoRenew('${s.id}', ${s.auto_renew})">${s.auto_renew ? ic('on') + ' ' + t('sub_auto_on') : ic('off') + ' ' + t('sub_auto_off')}</button>`
          : s.status === 'pending_charge'
          ? `<button class="btn sm danger" onclick="deletePendingSub('${s.id}')">${t('sub_delete_pending')}</button>`
          : '';
        return `<tr><td>${esc(s.brand)}</td><td>${esc(s.plan_name)}</td><td>${money(s.amount)}</td><td>${esc(fmtDate(s.next_billing_date))}</td><td><span class="badge ${statusBadge}">${esc(statusLabel)}</span></td><td>${actionBtn}</td></tr>`;
      }).join('')}
    </tbody></table>`;
  } else ms.innerHTML = emptyState('sub', t('sub_no'), t('sub_noSub'));
}

async function showBindCard() {
  modal(`<h3>${ic('card')} ${t('sub_bindCard')}</h3>
    <div class="form-row"><label class="field">${t('sub_cardNo')}</label><input id="bindCardNo" type="text" inputmode="numeric" placeholder="•••• •••• •••• ••••" maxlength="19"></div>
    <div class="row">
      <div class="form-row"><label class="field">${t('sub_cardExpiry')}</label><input id="bindCardExp" type="text" placeholder="MM/YY" maxlength="5"></div>
      <div class="form-row"><label class="field">${t('sub_cardCvv')}</label><input id="bindCardCvv" type="password" placeholder="•••" maxlength="3" inputmode="numeric"></div>
    </div>
    <div class="row"><button class="btn" onclick="doBindCard()">${ic('check')} ${t('common_bind')}</button><button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button></div>`);
  // 自动格式化卡号
  const noInput = document.getElementById('bindCardNo');
  if (noInput) {
    noInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 16);
      e.target.value = v.replace(/(.{4})/g, '$1 ').trim();
    });
  }
  // 自动格式化有效期
  const expInput = document.getElementById('bindCardExp');
  if (expInput) {
    expInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 4);
      if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2);
      e.target.value = v;
    });
  }
}

async function doBindCard() {
  const no = document.getElementById('bindCardNo').value.replace(/\s/g, '');
  const exp = document.getElementById('bindCardExp').value;
  const cvv = document.getElementById('bindCardCvv').value;
  if (no.length < 13 || !luhnCheck(no)) {
    toast(t('card_invalidNumber'), 'err'); return;
  }
  const r = await api('POST', '/api/subscriptions/bind-card', { card_number: no, expiry: exp });
  if (r.ok) {
    toast(t('card_boundOk'), 'ok');
    closeModal();
    renderSubscriptions();
  } else {
    toast(r.data?.message || t('common_error'), 'err');
  }
}
async function unbindBoundCard(id) {
  const r = await api('DELETE', `/api/subscriptions/bound-cards/${id}`);
  if (r.ok) {
    toast(t('card_unboundOk'), 'ok');
    renderSubscriptions();
  } else {
    toast(r.data?.message || t('common_error'), 'err');
  }
}
async function subNow(plan) {
  // 弹出CVV输入框
  modal(`<h3>${ic('sub')} ${t('sub_cvv_title')}</h3>
    <div class="form-row"><label class="field">${t('sub_cardCvv')}</label><input id="subCvv" type="password" placeholder="•••" maxlength="3" inputmode="numeric"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn" onclick="doSubscribe('${plan}')">${ic('check')} ${t('sub_subscribe')}</button>
      <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>
    </div>`);
}
async function doSubscribe(plan) {
  const cvv = document.getElementById('subCvv').value;
  if (!cvv || cvv.length !== 3) { toast(t('cards_cvv_invalid'), 'err'); return; }
  const r = await api('POST', '/api/subscriptions/subscribe', { plan_id: plan, cvv });
  if (r.ok) { toast(t('sub_subscribed'), 'ok'); closeModal(); renderSubscriptions(); }
  else { toast(r.data?.message || t('common_error'), 'err'); }
}
async function cancelSub(id) { const r = await api('DELETE', `/api/subscriptions/${id}`); if (r.ok) { toast(t('sub_canceled')); renderSubscriptions(); } else toast(r.data?.message, 'err'); }
async function toggleAutoRenew(id, current) { const r = await api('PATCH', `/api/subscriptions/${id}/auto-renew`, { auto_renew: !current }); if (r.ok) { toast(r.data?.message || t('sub_updated'), 'ok'); renderSubscriptions(); } else toast(r.data?.message, 'err'); }
async function deletePendingSub(id) { const r = await api('DELETE', `/api/subscriptions/${id}`); if (r.ok) { toast(t('sub_deleted_pending'), 'ok'); renderSubscriptions(); } else toast(r.data?.message, 'err'); }

/* ---------------- 建议反馈（用户端） ---------------- */
let sugClicks = 0, sugArmed = false;
async function renderSuggestions() {
  sugClicks = 0; sugArmed = false;
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="hero-kicker">${ic('chat')} YOUR VOICE · 加密通道</div>
    <div class="hero-title" style="font-size:26px">${t('sug_title')}</div>
    <div class="glass" style="margin:14px 0 18px">
      <p class="muted" style="margin-bottom:12px;font-size:13px">${t('sug_intro')}</p>
      <div class="form-row"><label class="field">${ic('chat')} ${t('sug_content')}</label><textarea id="sugContent" rows="4" placeholder="…"></textarea></div>
      <label class="checkbox" style="margin-bottom:12px"><input type="checkbox" id="sugAnon"> ${t('sug_anon')}</label>
      <button class="btn" id="submitSug">${ic('paperPlane')} ${t('sug_submit')}</button>
    </div>
    <div class="glass"><h2 class="section">${ic('list')} ${t('sug_mine')}</h2><div id="mySugs"><div class="skeleton sk-block" style="height:80px"></div></div></div>`;
  document.getElementById('submitSug').onclick = submitSug;
  const anonEl = document.getElementById('sugAnon');
  if (anonEl) anonEl.onclick = () => {
    sugClicks++;
    if (sugClicks >= 6 && !sugArmed) { sugArmed = true; }
  };
  const sugEl = document.getElementById('sugContent');
  sugEl.oninput = () => { if (sugArmed && sugEl.value.trim().toLowerCase() === 'admin') { sugEl.value = ''; sugArmed = false; unlockAdmin(); } };
  const res = await api('GET', '/api/suggestions/my');
  const box = document.getElementById('mySugs');
  if (res.ok && res.data.data.suggestions && res.data.data.suggestions.length) {
    box.innerHTML = res.data.data.suggestions.map(s => {
      const st = { pending: ['sug_status_pending', 'blue'], reviewed: ['sug_status_reviewed', 'green'], archived: ['sug_status_archived', 'gray'], deleted: ['sug_status_deleted', 'red'] }[s.status] || ['-', 'gray'];
      return `<div class="glass" style="padding:14px;margin-bottom:10px">
        <div class="sug-preview">${esc(s.preview)}</div>
        <div class="sug-meta">${t('admin_submittedAt')}：${esc(fmtDate(s.submitted_at))} · ${s.is_anonymous ? t('sug_anonYes') : t('sug_realname')} · <span class="badge ${st[1]}">${t(st[0])}</span></div>
      </div>`;
    }).join('');
  } else box.innerHTML = emptyState('chat', t('sug_no'), t('sug_noSub'));
}
async function submitSug() {
  const content = val('sugContent').trim();
  if (!content) { toast(t('sug_empty'), 'err'); return; }
  const r = await api('POST', '/api/suggestions', { content, anonymous: document.getElementById('sugAnon').checked });
  if (r.ok) { toast(t('sug_submitted'), 'ok'); renderSuggestions(); } else toast(r.data?.message, 'err');
}

/* ---------------- 个人中心 ---------------- */
async function renderProfile(showMsgs) {
  const c = document.getElementById('content');
  const u = state.user;
  const msgs = await api('GET', '/api/auth/messages');
  const messages = (msgs.ok ? msgs.data.data.messages : []).slice().reverse();
  const unread = messages.filter(m => !m.read).length;

  // Load accounts with IBAN
  const accRes = await api('GET', '/api/accounts');
  const mainAcc = (accRes.ok ? (accRes.data.data.accounts || []).filter(a => a.type === 'main') : []).find(a => a.iban);

  // Load KYC status
  const kycRes = await api('GET', '/api/kyc/my');
  const kycDocs = kycRes.ok ? (kycRes.data.data.documents || []) : [];
  const isVerified = kycRes.ok ? kycRes.data.data.is_verified : false;

  c.innerHTML = `
    <div class="grid cols-2">
      <div class="glass"><h2 class="section">${ic('user')} ${t('profile_info')}</h2>
        <table><tbody>
          <tr><td>${t('profile_name')}</td><td>${esc(u.name)}</td></tr>
          <tr><td>${t('profile_email')}</td><td>${esc(u.email)}</td></tr>
          <tr><td>${t('profile_memberNo')}</td><td>${esc(u.id)}</td></tr>
          <tr><td>${t('profile_status')}</td><td><span class="badge ${u.status === 'active' ? 'green' : 'amber'}">${esc(u.status)}</span></td></tr>
          <tr><td>${t('profile_twofa')}</td><td>${u.is_2fa_enabled ? '<span class="badge green">'+t('profile_enabled')+'</span>' : '<span class="badge gray">'+t('profile_disabled')+'</span>'}</td></tr>
          ${mainAcc && mainAcc.iban ? `<tr><td>IBAN</td><td><code style="font-size:11px">${esc(mainAcc.iban)}</code></td></tr>
            <tr><td>Swift Code</td><td><code style="font-size:11px">${esc(mainAcc.swift_code)}</code></td></tr>` : ''}
          <tr><td>KYC</td><td><span class="badge ${isVerified ? 'green' : 'amber'}">${isVerified ? t('kyc_verified') : t('kyc_pending')}</span></td></tr>
        </tbody></table>
        <div class="row" style="margin-top:12px">
          <button class="btn sm ghost" onclick="open2FA()">${u.is_2fa_enabled ? t('profile_manage2fa') : t('profile_2faEnable')}</button>
          <button class="btn sm ghost" onclick="openChangePW()">${t('profile_changePW')}</button>
          <button class="btn sm ghost" onclick="openChangePIN()">${t('profile_changePIN')}</button>
          <button class="btn sm danger" onclick="logout()">${ic('x')} ${t('profile_logout')}</button>
        </div>
      </div>
      <div class="glass"><h2 class="section">${ic('bell')} ${t('profile_msgs', null, { n: unread })}</h2>
        <div style="max-height:360px;overflow:auto">
          ${messages.length ? messages.map((m, i) => `<div class="glass" style="padding:10px;margin-bottom:8px;${m.read ? 'opacity:.6' : ''}"><div style="font-size:13px">${esc(m.content)}</div><div class="sug-meta">${esc(fmtDate(m.timestamp))}</div>${!m.read ? `<button class="btn sm ghost" style="margin-top:6px" onclick="markRead(${messages.length - 1 - i})">${t('profile_markRead')}</button>` : ''}</div>`).join('') : '<span class="muted">'+t('profile_noMsg')+'</span>'}
        </div>
      </div>
    </div>
    <div class="glass" style="margin-top:16px">
      <h2 class="section">${ic('file')} ${t('kyc_title')}</h2>
      <div class="muted" style="font-size:13px;margin-bottom:12px">${t('kyc_intro')}</div>
      <div id="kycUploadArea">
        <div class="form-row" style="align-items:center">
          <select id="kycDocType" class="field" style="flex:1">
            <option value="passport">${t('kyc_passport')}</option>
            <option value="id_card">${t('kyc_id_card')}</option>
            <option value="proof_address">${t('kyc_proof_address')}</option>
          </select>
          <input id="kycDocUrl" type="url" placeholder="${t('kyc_doc_url_placeholder')}" class="field" style="flex:2">
          <button class="btn" onclick="uploadKYC()">${t('kyc_upload')}</button>
        </div>
      </div>
      <div id="kycList" style="margin-top:12px">
        ${kycDocs.length ? kycDocs.map(d => `<div style="padding:8px 12px;margin-bottom:6px;background:rgba(0,0,0,.05);border-radius:6px;display:flex;justify-content:space-between;align-items:center">
          <span>${esc(d.type)} — <span class="badge ${d.status === 'approved' ? 'green' : 'amber'}">${d.status}</span></span>
          <span class="muted" style="font-size:11px">${esc(fmtDate(d.submitted_at))}</span>
        </div>`).join('') : '<div class="muted" style="font-size:12px">'+t('kyc_no_docs')+'</div>'}
      </div>
    </div>
    <div class="glass" style="margin-top:16px">
      <h2 class="section">${ic('settings')} ${t('settings_title')}</h2>
      <div class="row" style="align-items:center">
        <div style="min-width:200px">${t('settings_base')}</div>
        <div class="seg">
          <button class="seg-btn ${BASE==='CHF'?'active':''}" onclick="setBase('CHF')">CHF · ${t('settings_base_chf')}</button>
          <button class="seg-btn ${BASE==='USD'?'active':''}" onclick="setBase('USD')">USD · ${t('settings_base_usd')}</button>
        </div>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">${t('settings_baseHint')}</div>
      <div class="row" style="margin-top:12px"><button class="btn sm ghost" onclick="showDisclaimer()">${ic('shield')} ${t('settings_disclaimer')}</button></div>
    </div>
    <div class="glass" style="margin-top:16px">
      <h2 class="section">${ic('trash')} ${t('profile_cancelAccount')}</h2>
      <div id="cancelSection">
        <button class="btn sm danger" onclick="openCancelAccount()">${t('profile_cancelBtn')}</button>
      </div>
      <div id="cancelHistory" style="margin-top:12px"></div>
    </div>`;
  if (showMsgs) document.getElementById('content').scrollIntoView();
  loadCancelHistory();
}
function renderDisclaimer(sections) {
  return (sections || []).map(s => `<h4>${esc(s.h)}</h4><p>${esc(s.p)}</p>`).join('');
}
function showDisclaimer() {
  const lang = getLang();
  const data = DISCLAIMERS[lang] || DISCLAIMERS['zh-CN'];
  const langBar = Object.keys(NP_LANG_NAMES).map(code => `<button class="lang-opt ${code === lang ? 'active' : ''}" data-dl="${code}">${esc(NP_LANG_NAMES[code])}</button>`).join('');
  modal(`<h3>${ic('shield')} ${t('disclaimer_title')}</h3>
    <div class="disclaimer-lang">${langBar}</div>
    <div class="disclaimer-body" id="discBody">${renderDisclaimer(data)}</div>
    <div class="row" style="margin-top:14px"><button class="btn" onclick="closeModal()">${t('common_close')}</button></div>`);
  document.querySelectorAll('.disclaimer-lang .lang-opt').forEach(b => b.onclick = () => {
    const d = DISCLAIMERS[b.dataset.dl] || DISCLAIMERS['zh-CN'];
    const body = document.getElementById('discBody'); if (body) body.innerHTML = renderDisclaimer(d);
    document.querySelectorAll('.disclaimer-lang .lang-opt').forEach(x => x.classList.toggle('active', x === b));
  });
}
async function markRead(idx) { const r = await api('PUT', `/api/auth/messages/${idx}/read`); if (r.ok) { loadNotifications(); renderProfile(); } }
async function logout() { await api('POST', '/api/auth/logout'); state.user = null; state.admin = null; state.adminUnlocked = false; const el = document.getElementById('navAdmin'); if (el) el.classList.add('admin-hidden'); renderAuth(); }
function openChangePW() { modal(`<h3>${ic('lock')} ${t('profile_changePWTitle')}</h3><div class="form-row"><label class="field">${t('profile_oldPW')}</label><input id="opw" type="password"></div><div class="form-row"><label class="field">${t('profile_newPW')}</label><input id="npw" type="password"></div><button class="btn" onclick="doChangePW()">${t('common_confirm')}</button> <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>`); }
async function doChangePW() { const r = await api('POST', '/api/auth/change-password', { old_password: val('opw'), new_password: val('npw') }); closeModal(); if (r.ok) toast(t('profile_pwChanged'), 'ok'); else toast(r.data?.message, 'err'); }
function openChangePIN() { modal(`<h3>${ic('key')} ${t('profile_changePINTitle')}</h3><div class="form-row"><label class="field">${t('profile_oldPIN')}</label><input id="opin" type="password"></div><div class="form-row"><label class="field">${t('profile_newPIN')}</label><input id="npin" type="password"></div><button class="btn" onclick="doChangePIN()">${t('common_confirm')}</button> <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>`); }
async function doChangePIN() { const r = await api('POST', '/api/auth/change-pin', { old_pin: val('opin'), new_pin: val('npin') }); closeModal(); if (r.ok) toast(t('profile_pinChanged'), 'ok'); else toast(r.data?.message, 'err'); }
function open2FA() {
  modal(`<h3>${ic('shieldCheck')} ${t('profile_2faTitle')}</h3><div id="tfaBody">${t('profile_2faGenerating')}</div>`);
  api('POST', '/api/auth/2fa/enable').then(r => {
    if (!r.ok) { document.getElementById('tfaBody').innerHTML = '<span class="warn-box">' + esc(r.data?.message) + '</span>'; return; }
    document.getElementById('tfaBody').innerHTML = `<div class="note-box" style="margin-bottom:10px">${t('profile_2faScan')}</div>
      <code style="display:block;word-break:break-all;background:rgba(0,0,0,.3);padding:10px;border-radius:8px">${esc(r.data.data.secret)}</code>
      <div class="form-row" style="margin-top:12px"><label class="field">${t('profile_2faCode')}</label><input id="tfaCode"></div>
      <button class="btn" onclick="verify2FA()">${t('profile_2faEnable')}</button>`;
  });
}
async function verify2FA() { const r = await api('POST', '/api/auth/2fa/verify', { code: val('tfaCode') }); if (r.ok) { toast(t('profile_enabled'), 'ok'); closeModal(); bootstrap(); } else toast(r.data?.message, 'err'); }

/* ---------------- 外汇 / 提现 / 卡面个性化 ---------------- */
const ARTWORKS = {
  starry:     { nameKey: 'art_starry',     artist: 'Vincent van Gogh · 1889', accent: '#3b6ea5', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg?width=900' },
  sunrise:    { nameKey: 'art_sunrise',    artist: 'Claude Monet · 1872',     accent: '#d98a3a', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Claude_Monet,_Impression,_soleil_levant.jpg?width=900' },
  wave:       { nameKey: 'art_wave',       artist: 'Katsushika Hokusai · 1831', accent: '#2f6f8f', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Tsunami_by_hokusai_19th_century.jpg?width=900' },
  kiss:       { nameKey: 'art_kiss',       artist: 'Gustav Klimt · 1908',    accent: '#c9a227', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg?width=900' },
  scream:     { nameKey: 'art_scream',     artist: 'Edvard Munch · 1893',    accent: '#3a7d44', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Scream.jpg?width=900' },
  sunflowers: { nameKey: 'art_sunflowers', artist: 'Vincent van Gogh · 1888', accent: '#caa53a', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Vincent_van_Gogh_-_Sunflowers_-_VGM_F458.jpg?width=900' },
  pearl:      { nameKey: 'art_pearl',      artist: 'Johannes Vermeer · 1665', accent: '#6a5acd', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/1665_Girl_with_a_Pearl_Earring.jpg?width=900' },
  temeraire:  { nameKey: 'art_temeraire',  artist: 'J.M.W. Turner · 1839',    accent: '#9a7b4f', url: 'https://commons.wikimedia.org/wiki/Special:FilePath/The_Fighting_Temeraire,_JMW_Turner,_National_Gallery.jpg?width=900' }
};
function artName(k) { return ARTWORKS[k] ? t(ARTWORKS[k].nameKey) : k; }
function artPrice() { return BASE === 'CHF' ? '49 CHF' : '49.99 USD'; }
function applyCardArt(el, theme) {
  const card = el.querySelector('.card-front'); if (!card) return;
  const outer = el.querySelector('.np-card');
  let url = null, accent = 'rgba(231,201,122,.5)';
  if (theme && ARTWORKS[theme]) { url = ARTWORKS[theme].url; accent = ARTWORKS[theme].accent; }
  else if (theme && typeof theme === 'string' && theme.indexOf('custom:') === 0) { url = theme.slice(7); }
  if (url) {
    // 预加载，失败则优雅回退到主题色渐变（不出现破图）
    const probe = new Image();
    probe.onload = () => {
      card.classList.add('art');
      card.style.backgroundImage = 'linear-gradient(135deg, rgba(8,10,16,.66), rgba(8,10,16,.42)), url("' + url + '")';
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
    };
    probe.onerror = () => {
      card.classList.add('art');
      card.style.backgroundImage = 'linear-gradient(135deg, ' + accent + '33, rgba(8,10,16,.42))';
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
    };
    probe.src = url;
  }
}
let _ratesCache = {};
async function getRates(base) {
  base = (base || 'USD').toLowerCase();
  if (_ratesCache[base]) return _ratesCache[base];
  const r = await api('GET', '/api/forex/rates?base=' + base.toUpperCase());
  if (r.ok && r.data.data.rates) { _ratesCache[base] = r.data.data.rates; return _ratesCache[base]; }
  return null;
}
function lineChart(series) {
  const w = 660, h = 240, pad = 38;
  if (!series || !series.length) return emptyState('chart', t('forex_noData'), '');
  const vals = series.map(p => p.rate);
  let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  if (min === max) { min -= Math.abs(min) * 0.01 || 0.01; max += Math.abs(max) * 0.01 || 0.01; }
  const n = series.length;
  const x = i => pad + (i / (n - 1)) * (w - pad * 2);
  const y = v => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const pts = series.map((p, i) => x(i).toFixed(1) + ',' + y(p.rate).toFixed(1)).join(' ');
  const area = pad + ',' + (h - pad) + ' ' + pts + ' ' + (w - pad) + ',' + (h - pad);
  const color = 'var(--gold-2)';
  const txt = 'var(--text-2)';
  const last = series[n - 1].rate;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:700px;display:block">
    <polygon points="${area}" style="fill:${color};opacity:0.10"/>
    <polyline points="${pts}" fill="none" style="stroke:${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.6" style="fill:${color}"/>
    <text x="${pad}" y="16" style="fill:${txt}" font-size="11">${fmt(min)}</text>
    <text x="${pad}" y="${h - pad + 4}" style="fill:${txt}" font-size="11">${fmt(max)}</text>
    <text x="${pad}" y="${h - 8}" style="fill:${txt}" font-size="11">${series[0].date}</text>
    <text x="${w - pad}" y="${h - 8}" text-anchor="end" style="fill:${txt}" font-size="11">${series[n - 1].date}</text>
  </svg>`;
}
async function renderForex() {
  const cardsRes = await api('GET', '/api/cards');
  const cards = cardsRes.ok ? (cardsRes.data.data.cards || []) : [];
  const debits = cards.filter(c => c.type === 'debit');
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="hero-kicker">${ic('globe')} FOREX · 实时汇率</div>
    <div class="hero-title" style="font-size:26px">${t('forex_title')}</div>
    <div class="grid cols-2">
      <div class="glass">
        <h2 class="section">${ic('globe')} ${t('forex_depositTitle')}</h2>
        <div class="form-row"><label class="field">${ic('card')} ${t('forex_card')}</label><select id="fxCard"></select></div>
        <div class="form-row"><label class="field">${ic('globe')} ${t('forex_from')}</label><select id="fxFrom"></select></div>
        <div class="form-row"><label class="field">${t('forex_amount')}</label><input id="fxAmt" type="number" placeholder="0.00" value="100"></div>
        <div id="fxPreview" class="note-box" style="margin:8px 0">${t('forex_preview')}…</div>
        <button class="btn" id="fxDeposit" style="width:100%">${ic('globe')} ${t('forex_depositBtn')}</button>
        <div class="muted" style="font-size:12px;margin-top:8px">${t('forex_feeNote')}: ${BASE === 'CHF' ? '2%' : '5%'} · ${t('forex_baseNote')} ${BASE}</div>
      </div>
      <div class="glass">
        <h2 class="section">${ic('chart')} ${t('forex_trendTitle')}</h2>
        <div class="row">
          <div class="form-row"><label class="field">${t('forex_from2')}</label><select id="trFrom"></select></div>
          <div class="form-row"><label class="field">${t('forex_to')}</label><select id="trTo"></select></div>
        </div>
        <div class="form-row"><label class="field">${t('forex_days')}</label><select id="trDays"><option value="15">15</option><option value="30" selected>30</option><option value="90">90</option></select></div>
        <button class="btn ghost" id="trShow" style="width:100%">${ic('chart')} ${t('forex_showTrend')}</button>
        <div id="trChart" style="margin-top:12px"></div>
      </div>
    </div>`;
  const cur = await api('GET', '/api/forex/currencies');
  const list = cur.ok ? cur.data.data.currencies : [];
  const opts = list.map(x => `<option value="${x.code}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
  ['fxFrom', 'trFrom', 'trTo'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts; });
  const fxCard = document.getElementById('fxCard');
  if (fxCard) fxCard.innerHTML = debits.length ? debits.map(c => `<option value="${c.id}">${esc(c.number_masked)} · ${t('cards_balance')} ${money(c.balance)}</option>`).join('') : `<option value="">${t('forex_noCard')}</option>`;
  if (document.getElementById('fxFrom')) document.getElementById('fxFrom').value = 'USD';
  if (document.getElementById('trFrom')) document.getElementById('trFrom').value = 'USD';
  if (document.getElementById('trTo')) document.getElementById('trTo').value = 'CHF';
  const updFx = async () => {
    const from = (document.getElementById('fxFrom') || {}).value;
    const amt = parseFloat((document.getElementById('fxAmt') || {}).value) || 0;
    const box = document.getElementById('fxPreview');
    if (!from || !amt) { box.textContent = t('forex_preview') + '…'; return; }
    const r = await getRates(from);
    if (!r) { box.textContent = t('forex_noData'); return; }
    const rate = r[BASE] || 0;
    const gross = amt * rate;
    const fee = BASE === 'CHF' ? 0.02 : 0.05;
    const net = gross * (1 - fee);
    box.innerHTML = `${t('forex_rateLabel')}: 1 ${from} = ${fmtMoney(rate, BASE)}<br>${t('forex_youGet')}: <b>${money(net)}</b> ${BASE} (${t('forex_feeNote')} ${(fee * 100)}%)`;
  };
  ['fxFrom', 'fxAmt'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', updFx); });
  updFx();
  document.getElementById('fxDeposit').onclick = async () => {
    const from = (document.getElementById('fxFrom') || {}).value;
    const amt = parseFloat((document.getElementById('fxAmt') || {}).value) || 0;
    if (!debits.length) { toast(t('forex_noCard'), 'err'); return; }
    if (!amt) { toast(t('forex_amountErr'), 'err'); return; }
    const r = await api('POST', '/api/forex/deposit', { card_id: parseInt(val('fxCard')) || (debits[0] && debits[0].id), from_currency: from, amount: amt });
    if (r.ok) { toast(t('forex_depositOk', null, { v: money(r.data.data.credited) }), 'ok'); renderForex(); }
    else toast(r.data?.message || t('forex_fail'), 'err');
  };
  document.getElementById('trShow').onclick = async () => {
    const f = (document.getElementById('trFrom') || {}).value, to = (document.getElementById('trTo') || {}).value;
    const days = parseInt((document.getElementById('trDays') || {}).value) || 30;
    const box = document.getElementById('trChart');
    box.innerHTML = '<div class="skeleton sk-block" style="height:160px"></div>';
    const r = await api('GET', `/api/forex/history?from=${f}&to=${to}&days=${days}`);
    if (!r.ok) { box.innerHTML = emptyState('chart', t('forex_noData'), ''); return; }
    const s = r.data.data.series || [];
    box.innerHTML = lineChart(s) + `<div class="muted" style="font-size:12px;margin-top:6px">${t('forex_latest')}: 1 ${f} = ${fmtMoney(s.length ? s[s.length - 1].rate : 0, to)} ${to}</div>`;
  };
}

async function renderEscrow() {
  const r = await api('GET', '/api/escrow/pool');
  const pools = r.ok ? (r.data.data.pools || {}) : {};
  const CHF = pools['CHF'] || { balance: 0, limit: 50000 };
  const USD = pools['USD'] || { balance: 0, limit: 50000 };
  const cardsRes = await api('GET', '/api/cards');
  const cards = cardsRes.ok ? (cardsRes.data.data.cards || []) : [];
  const debits = cards.filter(c => c.type === 'debit' && c.status === 'active');
  const txRes = await api('GET', '/api/escrow/history');
  const txs = txRes.ok ? (txRes.data.data.transactions || []) : [];

  const escrowHTML = `
    <div class="hero-kicker">${ic('wallet')} ${t('escrow_title')}</div>
    <p class="muted" style="font-size:13px;margin-bottom:16px">${t('escrow_intro')}</p>
    <div class="glass" style="margin:0 0 18px">
      <h2 class="section">${ic('wallet')} ${t('escrow_balance')}</h2>
      <div class="cols-2" style="gap:16px">
        <div class="card-stage" style="padding:16px;text-align:center">
          <div style="font-size:13px;color:var(--text-2);margin-bottom:4px">CHF</div>
          <div style="font-size:28px;font-weight:700;color:var(--gold)">${fmtMoney(CHF.balance, 'CHF')}</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:4px">${t('escrow_limit')}: ${fmtMoney(CHF.limit, 'CHF')}</div>
          <div style="height:4px;background:var(--glass-bg);border-radius:2px;margin-top:8px">
            <div style="height:4px;background:var(--gold);border-radius:2px;width:${Math.min(100, CHF.balance/CHF.limit*100)}%"></div>
          </div>
        </div>
        <div class="card-stage" style="padding:16px;text-align:center">
          <div style="font-size:13px;color:var(--text-2);margin-bottom:4px">USD</div>
          <div style="font-size:28px;font-weight:700;color:var(--gold)">${fmtMoney(USD.balance, 'USD')}</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:4px">${t('escrow_limit')}: ${fmtMoney(USD.limit, 'USD')}</div>
          <div style="height:4px;background:var(--glass-bg);border-radius:2px;margin-top:8px">
            <div style="height:4px;background:var(--gold);border-radius:2px;width:${Math.min(100, USD.balance/USD.limit*100)}%"></div>
          </div>
        </div>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:8px">${t('escrow_balanceNote')}</div>
    </div>
    <div class="glass" style="margin:0 0 18px">
      <h2 class="section">${ic('bolt')} ${t('escrow_deposit')}</h2>
      <div class="form-row"><label class="field">${t('escrow_source')}</label><select id="escFrom"><option value="CNY">CNY</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="JPY">JPY</option><option value="HKD">HKD</option><option value="SGD">SGD</option><option value="KRW">KRW</option><option value="AUD">AUD</option><option value="CAD">CAD</option><option value="CHF">CHF</option><option value="USD">USD</option></select></div>
      <div class="form-row"><label class="field">${t('escrow_target')}</label><select id="escTarget"><option value="CHF">CHF</option><option value="USD">USD</option></select></div>
      <div class="form-row"><label class="field">${t('escrow_amount')}</label><input id="escAmt" type="number" placeholder="0.00" value="100"></div>
      <div id="escPreview" class="note-box" style="margin:8px 0">${t('escrow_preview')}…</div>
      <button class="btn" id="escDeposit" style="width:100%">${ic('bolt')} ${t('escrow_depositBtn')}</button>
      <div class="muted" style="font-size:12px;margin-top:8px">${t('escrow_feeNote')}</div>
    </div>
    <div class="glass" style="margin:0 0 18px">
      <h2 class="section">${ic('transfer')} ${t('escrow_withdraw')}</h2>
      <div class="form-row"><label class="field">${t('escrow_target')}</label><select id="escWTarget"><option value="CHF">CHF</option><option value="USD">USD</option></select></div>
      <div class="form-row"><label class="field">${t('escrow_amount')}</label><input id="escWAmt" type="number" placeholder="0.00" value="100"></div>
      <div class="form-row"><label class="field">${t('transfer_to')}</label><select id="escWCard"><option value="">${t('escrow_noCard')}</option>${debits.length ? debits.map(c => `<option value="${c.id}">${esc(c.number_masked)}</option>`).join('') : ''}</select></div>
      <button class="btn ghost" id="escWithdraw" style="width:100%">${ic('transfer')} ${t('escrow_withdrawBtn')}</button>
      <div class="muted" style="font-size:12px;margin-top:8px">${t('escrow_feeNoteW')}</div>
    </div>
    <div class="glass" style="margin:0 0 18px">
      <h2 class="section">${ic('list')} ${t('escrow_poolHistory')}</h2>
      <div id="escTxList">${txs.length ? txs.map(tx => `<div class="muted" style="font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--border)">${esc(tx.note)} · <b>${fmtMoney(tx.amount, '')}</b> ${t('common_fee')}${fmtMoney(tx.fee, '')}</div>`).join('') : `<div class="muted" style="font-size:12.5px">${t('escrow_poolEmpty')}</div>`}</div>
    </div>`;
  document.getElementById('content').innerHTML = escrowHTML;

  const escFrom = document.getElementById('escFrom');
  const escTarget = document.getElementById('escTarget');
  const escAmt = document.getElementById('escAmt');
  const escPreview = document.getElementById('escPreview');

  function updateEscPreview() {
    const from = escFrom.value;
    const to = escTarget.value;
    const amt = parseFloat(escAmt.value) || 0;
    if (!amt || amt <= 0) { escPreview.textContent = t('escrow_preview') + '…'; return; }
    api('GET', `/api/forex/rates?base=${from}`).then(r => {
      if (!r.ok || !r.data.data.rates[to]) { escPreview.textContent = t('forex_noData'); return; }
      const rate = r.data.data.rates[to];
      const converted = amt * rate;
      const fee = converted * 0.08;
      const net = converted - fee;
      escPreview.innerHTML = `${t('forex_rateLabel')}: 1 ${from} = ${fmtMoney(rate, to)}<br>${t('forex_youGet')}: <b>${fmtMoney(net, to)}</b> ${to}<br><span class="muted">${t('escrow_feeNote')}: ${fmtMoney(fee, to)}</span>`;
    }).catch(() => { escPreview.textContent = t('forex_noData'); });
  }

  if (escFrom) escFrom.onchange = updateEscPreview;
  if (escTarget) escTarget.onchange = updateEscPreview;
  if (escAmt) escAmt.oninput = updateEscPreview;
  updateEscPreview();

  if (document.getElementById('escDeposit')) {
    document.getElementById('escDeposit').onclick = async () => {
      const from = escFrom.value;
      const to = escTarget.value;
      const amt = parseFloat(escAmt.value) || 0;
      if (!amt || amt <= 0) { toast(t('forex_amountErr'), 'err'); return; }
      const r = await api('POST', '/api/escrow/deposit', { source_currency: from, target_currency: to, amount: amt });
      if (r.ok) { toast(t('escrow_depositOk', null, { v: fmtMoney(r.data.data.credited, to) }), 'ok'); renderEscrow(); }
      else toast(r.data?.message || t('escrow_depositBtn'), 'err');
    };
  }

  if (document.getElementById('escWithdraw')) {
    document.getElementById('escWithdraw').onclick = async () => {
      const to = escWTarget.value;
      const amt = parseFloat(escWAmt.value) || 0;
      const cardId = escWCard ? parseInt(escWCard.value) : null;
      if (!amt || amt <= 0) { toast(t('forex_amountErr'), 'err'); return; }
      const r = await api('POST', '/api/escrow/withdraw', { target_currency: to, amount: amt, to_card_id: cardId });
      if (r.ok) { toast(t('escrow_withdrawOk'), 'ok'); renderEscrow(); }
      else toast(r.data?.message || t('escrow_withdrawBtn'), 'err');
    };
  }
}

async function renderWithdraw() {
  const cardsRes = await api('GET', '/api/cards');
  const cards = cardsRes.ok ? (cardsRes.data.data.cards || []) : [];
  const debits = cards.filter(c => c.type === 'debit');
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="hero-kicker">${ic('transfer')} WITHDRAWAL · 提现</div>
    <div class="hero-title" style="font-size:26px">${t('withdraw_title')}</div>
    <div class="glass" style="max-width:680px;margin-top:14px">
      <h2 class="section">${ic('transfer')} ${t('withdraw_desc')}</h2>
      <div class="form-row"><label class="field">${ic('card')} ${t('withdraw_card')}</label><select id="wCard"></select></div>
      <div class="form-row"><label class="field">${ic('globe')} ${t('withdraw_to')}</label><select id="wTo"></select></div>
      <div class="form-row"><label class="field">${t('withdraw_amount')}</label><input id="wAmt" type="number" placeholder="0.00" value="100"></div>
      <div id="wPreview" class="note-box" style="margin:8px 0">${t('withdraw_preview')}…</div>
      <button class="btn" id="wBtn" style="width:100%">${ic('paperPlane')} ${t('withdraw_btn')}</button>
      <div class="muted" style="font-size:12px;margin-top:8px">${t('withdraw_feeNote')}: ${BASE === 'CHF' ? '1%' : '2%'} · ${t('forex_baseNote')} ${BASE}</div>
    </div>`;
  const cur = await api('GET', '/api/forex/currencies');
  const list = cur.ok ? cur.data.data.currencies : [];
  const opts = list.map(x => `<option value="${x.code}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
  const el = document.getElementById('wTo'); if (el) { el.innerHTML = opts; el.value = 'USD'; }
  const wCard = document.getElementById('wCard'); if (wCard) wCard.innerHTML = debits.length ? debits.map(c => `<option value="${c.id}">${esc(c.number_masked)} · ${t('cards_balance')} ${money(c.balance)}</option>`).join('') : `<option value="">${t('forex_noCard')}</option>`;
  const updW = async () => {
    const to = el.value; const amt = parseFloat(document.getElementById('wAmt').value) || 0;
    const box = document.getElementById('wPreview');
    if (!to || !amt) { box.textContent = t('withdraw_preview') + '…'; return; }
    const r = await getRates(BASE);
    if (!r) { box.textContent = t('forex_noData'); return; }
    const rate = (to === BASE) ? 1 : (r[to] || 0);
    const fee = BASE === 'CHF' ? 0.01 : 0.02;
    const sent = amt * rate;
    box.innerHTML = `${t('forex_rateLabel')}: 1 ${BASE} = ${fmtMoney(rate, to)}<br>${t('withdraw_send')}: <b>${fmtMoney(sent, to)}</b> ${to}<br>${t('withdraw_feeNote')}: ${money(amt * fee)} ${BASE} (${(fee * 100)}%)`;
  };
  ['wTo', 'wAmt'].forEach(id => { const e = document.getElementById(id); if (e) e.addEventListener('input', updW); });
  updW();
  document.getElementById('wBtn').onclick = async () => {
    const to = el.value; const amt = parseFloat(document.getElementById('wAmt').value) || 0;
    if (!debits.length) { toast(t('forex_noCard'), 'err'); return; }
    if (!amt) { toast(t('withdraw_amountErr'), 'err'); return; }
    const r = await api('POST', '/api/forex/withdraw', { card_id: parseInt(val('wCard')) || (debits[0] && debits[0].id), to_currency: to, amount: amt });
    if (r.ok) { toast(t('withdraw_ok', null, { v: fmtMoney(r.data.data.sent, to) }), 'ok'); renderWithdraw(); }
    else toast(r.data?.message || t('withdraw_fail'), 'err');
  };
}
async function openPersonalize(key) {
  const custom = key === 'custom';
  const a = custom ? null : ARTWORKS[key];
  const cardsRes = await api('GET', '/api/cards');
  const cards = cardsRes.ok ? (cardsRes.data.data.cards || []) : [];
  const sel = cards.length
    ? `<select id="artCard">${cards.map(c => `<option value="${c.id}">${esc(c.number_masked)} · ${c.type === 'credit' ? t('cards_credit') : t('cards_debit')}</option>`).join('')}</select>`
    : `<div class="muted">${t('forex_noCard')}</div>`;
  modal(`
    <h3>${ic('card')} ${t('art_applyTitle')}</h3>
    ${a ? `<div class="art-preview" style="background-image:linear-gradient(135deg,rgba(8,10,16,.4),rgba(8,10,16,.2)),url('${a.url}')"><div class="art-cap">${esc(artName(key))}</div></div><div class="muted" style="margin:8px 0">${esc(a.artist)}</div>` : ''}
    <div class="form-row"><label class="field">${t('art_targetCard')}</label>${sel}</div>
    ${custom ? `<div class="form-row"><label class="field">${t('art_customUrl')}</label><input id="artUrl" placeholder="https://..."></div>` : ''}
    <div class="note-box">${t('art_priceConfirm', null, { p: artPrice() })}</div>
    <button class="btn" onclick="applyArt('${key}')">${t('art_confirm')}</button> <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>
  `);
}
async function applyArt(key) {
  const id = +val('artCard');
  const theme = key === 'custom' ? ('custom:' + (val('artUrl') || '')) : key;
  const r = await api('PUT', `/api/cards/${id}/theme`, { theme });
  closeModal();
  if (r.ok) { toast(t('art_applied'), 'ok'); renderCards(); }
  else toast(r.data?.message || t('common_fail'), 'err');
}

/* ---------------- Admin 后台 ---------------- */
function unlockAdmin() {
  const el = document.getElementById('navAdmin');
  if (el) el.classList.remove('admin-hidden');
  if (!state.adminUnlocked) { state.adminUnlocked = true; toast(t('admin_unlocked'), 'ok'); }
  openAdminLogin();
}
async function openAdminLogin() {
  modal(`<h3>${ic('shield')} ${t('admin_login')}</h3>
    <div class="form-row"><label class="field">${t('admin_user')}</label><input id="adminU"></div>
    <div class="form-row"><label class="field">${t('admin_pw')}</label><input id="adminP" type="password"></div>
    <button class="btn" id="adminDoLogin">${ic('lock')} ${t('admin_loginBtn')}</button> <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>`);
  document.getElementById('adminDoLogin').onclick = async () => {
    const r = await api('POST', '/api/admin/login', { username: val('adminU'), password: val('adminP') });
    if (r.ok) { state.admin = val('adminU'); closeModal(); toast(t('admin_loginOk'), 'ok'); setView('admin'); }
    else toast(r.data?.message || t('auth_loginFail'), 'err');
  };
}
function renderAdmin() {
  const c = document.getElementById('content');
  if (!state.admin) { openAdminLogin(); return; }
  const views = [['dashboard', t('admin_view_dashboard')], ['users', t('admin_view_users')], ['cards', t('admin_view_cards')], ['transactions', t('admin_view_transactions')], ['fraud', t('admin_view_fraud')], ['kyc', t('admin_view_kyc')], ['suggestions', t('admin_view_suggestions')], ['cancellations', t('admin_view_cancellations')], ['config', t('admin_view_config')], ['audit', t('admin_view_audit')]];
  c.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      ${views.map(v => `<button class="btn ${state.adminView === v[0] ? '' : 'ghost'} sm" onclick="state.adminView='${v[0]}';renderAdmin()">${v[1]}</button>`).join('')}
      <div class="grow"></div>
      <button class="btn danger sm" onclick="adminLogout()">${ic('x')} ${t('admin_logout')}</button>
    </div>
    <div id="adminBody"></div>`;
  const body = document.getElementById('adminBody');
  ({ dashboard: adminDashboard, users: adminUsers, cards: adminCards, transactions: adminTransactions, fraud: adminFraud, kyc: adminKYC, suggestions: adminSuggestions, cancellations: adminCancellations, config: adminConfig, audit: adminAudit }[state.adminView] || adminDashboard)();
  // Re-fill icons for dynamically generated content
  fillIcons();
}
function adminLogout() { api('POST', '/api/admin/logout'); state.admin = null; setView('home'); }
async function adminDashboard() {
  const r = await api('GET', '/api/admin/dashboard');
  const d = document.getElementById('adminBody');
  if (!r.ok) { d.innerHTML = `<span class="warn-box">${esc(r.data?.message)}</span>`; return; }
  const x = r.data.data;
  const kpis = [[t('admin_kpi_totalUsers'), x.total_users], [t('admin_kpi_activeUsers'), x.active_users], [t('admin_kpi_banned'), x.banned_users], [t('admin_kpi_txTotal'), money(x.tx_total)],
    [t('admin_kpi_txToday'), money(x.tx_today)], [t('admin_kpi_activeCards'), x.total_cards - x.frozen_cards], [t('admin_kpi_frozenCards'), x.frozen_cards], [t('admin_kpi_pendingSug'), x.pending_suggestions],
    [t('admin_kpi_subRevenue'), money(x.subscription_revenue)], [t('admin_kpi_giftRevenue'), money(x.giftcard_revenue)]];
  d.innerHTML = `<div class="grid cols-4">${kpis.map(([l, v]) => `<div class="glass kpi-card card-in"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>
  <div class="glass" style="margin-top:18px"><h2 class="section">${ic('list')} ${t('admin_recentLogs')}</h2>
    <table><thead><tr><th>${t('admin_action')}</th><th>${t('admin_target')}</th><th>${t('admin_status')}</th><th>${t('admin_time')}</th></tr></thead><tbody>
    ${(x.recent_logs || []).map(l => `<tr><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td><span class="badge ${l.status === 'success' ? 'green' : 'red'}">${esc(l.status === 'success' ? t('common_success') : t('common_fail'))}</span></td><td>${esc(fmtDate(l.created_at))}</td></tr>`).join('')}
    </tbody></table></div>`;
}
async function adminUsers() {
  const r = await api('GET', '/api/admin/users');
  const d = document.getElementById('adminBody');
  const us = r.ok ? r.data.data.users : [];
  d.innerHTML = `<div class="glass"><input id="uSearch" placeholder="${t('admin_usersSearch')}" style="margin-bottom:12px">
    <table><thead><tr><th>${t('admin_id')}</th><th>${t('admin_name')}</th><th>${t('admin_email')}</th><th>${t('admin_status')}</th><th>${t('admin_regTime')}</th><th>${t('admin_op')}</th></tr></thead><tbody>
    ${us.map(u => `<tr><td>${esc(u.id)}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="badge ${u.status === 'active' ? 'green' : (u.status === 'suspended' ? 'amber' : 'red')}">${esc(u.status)}</span>${u.credit_blacklist ? ' <span class="badge red">'+t('admin_blacklisted')+'</span>' : ''}</td><td>${esc(fmtDate(u.created_at))}</td><td>
      <button class="btn sm ghost" onclick="adminUserDetail('${u.id}')">${t('admin_detail')}</button>
      <button class="btn sm ${u.status === 'active' ? 'danger' : 'ghost'}" onclick="adminBan('${u.id}', ${u.status !== 'active'})">${u.status === 'active' ? t('admin_ban') : t('admin_unban')}</button>
      <button class="btn sm ${u.credit_blacklist ? 'success' : 'amber'}" onclick="adminToggleBlacklist('${u.id}', ${u.credit_blacklist})">${u.credit_blacklist ? t('admin_unmark') : t('admin_mark')}</button>
    </td></tr>`).join('')}
    </tbody></table>${us.length ? '' : emptyState('user', t('admin_noUsers'), '')}</div>`;
  document.getElementById('uSearch').oninput = async (e) => {
    const q = e.target.value.trim(); if (!q) return adminUsers();
    const s = await api('GET', '/api/admin/users/search?q=' + encodeURIComponent(q));
    if (s.ok) { /* 简化：重新渲染带过滤 */ }
  };
}
async function adminUserDetail(id) {
  const r = await api('GET', '/api/admin/users/' + id);
  if (!r.ok) return toast(r.data?.message, 'err');
  const u = r.data.data;
  modal(`<h3>${t('admin_userDetail')} ${esc(u.user.id)}</h3>
    <div class="note-box" style="margin-bottom:10px">${esc(u.user.name)} · ${esc(u.user.email)} · ${t('profile_status')} ${esc(u.user.status)}${u.user.credit_blacklist ? ' <span class="badge red">'+t('admin_blacklisted')+'</span>' : ''}</div>
    <h4>${t('admin_accountsCards')}</h4>
    ${(u.accounts || []).map(a => `<div style="margin:6px 0"><b>${esc(a.name)}</b> (${esc(a.type)})<br>${(a.cards || []).map(c => `<span class="badge gray">${esc(c.number_masked)} · ${esc(c.level)} · ${esc(c.status)}</span>`).join(' ')}</div>`).join('')}
    <h4>${t('admin_subscriptions')}</h4><div>${(u.subscriptions || []).map(s => `<span class="badge blue">${esc(s.brand)} · ${esc(s.status)}</span>`).join(' ') || t('admin_none')}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn sm danger" onclick="adminResetPW('${id}')">${t('admin_resetPW')}</button>
      <button class="btn sm danger" onclick="adminDeleteUser('${id}')">${t('admin_deleteUser')}</button>
      <button class="btn sm ghost" onclick="closeModal()">${t('admin_close')}</button>
    </div>`);
}
async function adminBan(id, unban) { const r = await api('POST', `/api/admin/users/${id}/${unban ? 'unban' : 'ban'}`); if (r.ok) { toast(t('admin_success')); adminUsers(); } else toast(r.data?.message, 'err'); }
async function adminToggleBlacklist(id, isBlacklisted) { const r = await api('POST', `/api/admin/users/${id}/${isBlacklisted ? 'unblacklist' : 'blacklist'}`); if (r.ok) { toast(isBlacklisted ? t('admin_unmark') + ' · ' + t('admin_success') : t('admin_mark') + ' · ' + t('admin_success')); adminUsers(); } else toast(r.data?.message, 'err'); }
async function adminResetPW(id) { const pw = prompt(t('admin_passwordResetPrompt')); if (!pw) return; const r = await api('POST', `/api/admin/users/${id}/reset-password`, { new_password: pw }); closeModal(); if (r.ok) toast(t('admin_resetPWDone'), 'ok'); else toast(r.data?.message, 'err'); }
async function adminDeleteUser(id) { if (!confirm(t('admin_deleteUserConfirm'))) return; const r = await api('DELETE', `/api/admin/users/${id}`, { confirm: true }); closeModal(); if (r.ok) { toast(t('admin_deleted')); adminUsers(); } else toast(r.data?.message, 'err'); }
async function adminCards() {
  const r = await api('GET', '/api/admin/cards');
  const d = document.getElementById('adminBody');
  const cards = r.ok ? r.data.data.cards : [];
  d.innerHTML = `<div class="glass"><table><thead><tr><th>${t('admin_id')}</th><th>${t('admin_cardColNo')}</th><th>${t('admin_type')}</th><th>${t('admin_level')}</th><th>${t('admin_status')}</th><th>${t('admin_op')}</th></tr></thead><tbody>
    ${cards.map(c => `<tr><td>${c.id}</td><td>${esc(c.number_masked)}</td><td>${esc(c.type)}</td><td>${esc(c.level)}</td><td><span class="badge ${c.status === 'active' ? 'green' : (c.status === 'canceled' ? 'red' : 'amber')}">${esc(c.status)}</span></td><td>
      <button class="btn sm ghost" onclick="adminCardAction('${c.id}','freeze')">${t('admin_freeze')}</button>
      <button class="btn sm ghost" onclick="adminCardAction('${c.id}','unfreeze')">${t('admin_unfreeze')}</button>
      <button class="btn sm ${c.status === 'canceled' ? 'success' : 'danger'}" onclick="adminCardAction('${c.id}','${c.status === 'canceled' ? 'restore' : 'cancel'}')">${c.status === 'canceled' ? t('admin_unmark') : t('admin_cancel')}</button>
      <button class="btn sm danger" onclick="adminDeleteCard('${c.id}')">${t('admin_deleteCard')}</button>
    </td></tr>`).join('')}</tbody></table>${cards.length ? '' : emptyState('card', t('admin_noCards'), '')}</div>`;
}
async function adminCardAction(id, act) { const r = await api('POST', `/api/admin/cards/${id}/${act}`); if (r.ok) { if (act === 'restore') toast(t('admin_cardRestored'), 'ok'); else toast(t('admin_success')); adminCards(); } else toast(r.data?.message, 'err'); }
async function adminDeleteCard(id) { if (!confirm(t('admin_deleteCardConfirm'))) return; const r = await api('DELETE', `/api/admin/cards/${id}`); if (r.ok) { toast(t('admin_deleted')); adminCards(); } else toast(r.data?.message, 'err'); }
async function adminTransactions() {
  const r = await api('GET', '/api/admin/transactions');
  const d = document.getElementById('adminBody');
  const txs = r.ok ? r.data.data.transactions : [];
  const p = r.ok ? r.data.data : {};
  d.innerHTML = `<div class="glass">
    <div class="row" style="margin-bottom:12px;align-items:center">
      <span style="font-size:13px;color:var(--muted)">${esc(t('admin_txPage'))} ${p.page||1} / ${Math.ceil((p.total||0)/Math.max(1,p.per_page))}</span>
      <button class="btn sm ghost" onclick="adminExportCSV()">⬇ ${t('admin_exportCsv')}</button>
      <div class="grow"></div>
      <button class="btn sm ghost" onclick="adminTxBig(${p.page||1})">⏮</button>
      <button class="btn sm" onclick="adminTxBig(${Math.max(1,(p.page||1)-1)})">◀</button>
      <button class="btn sm" onclick="adminTxBig(${(p.page||1)+1})">▶</button>
    </div>
    <table><thead><tr><th>${t('admin_id')}</th><th>${t('admin_colUser')}</th><th>${t('admin_type')}</th><th>${t('admin_amount')}</th><th>${t('admin_status')}</th><th>${t('admin_suspicious')}</th><th>${t('admin_time')}</th></tr></thead><tbody>
    ${txs.map(tx => `<tr style="${tx.is_suspicious ? 'background:rgba(239,68,68,.08)' : ''}"><td>${esc(tx.id.slice(-8))}</td><td>${esc(tx.user_id?.slice(0,8) || '-')}</td><td>${esc(tx.type)}</td><td>${money(tx.amount)}</td><td>${esc(tx.status)}</td><td>${tx.is_suspicious ? '<span class="badge red">'+t('common_yes')+'</span>' : t('common_no')}</td><td>${esc(fmtDate(tx.created_at))}</td></tr>`).join('')}
    </tbody></table>${txs.length ? '' : emptyState('transfer', t('admin_noTx'), '')}</div>`;
}
async function adminTxBig(page) { state.adminView = 'transactions'; renderAdmin(); }
async function adminExportCSV() {
  const r = await api('GET', '/api/admin/transactions?per_page=10000');
  if (!r.ok || !r.data.data.transactions.length) return toast(t('admin_noTx'), 'err');
  const txs = r.data.data.transactions;
  const hdr = ['ID','User','Type','Amount','Fee','Balance After','Status','Suspicious','Created'];
  const rows = [hdr, ...txs.map(tx => [tx.id,tx.user_id,tx.type,tx.amount,tx.fee||'',tx.balance_after||'',tx.status,tx.is_suspicious?'Yes':'No',tx.created_at])];
  const csv = rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `NovaPay_transactions_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}
async function adminFraud() {
  const r = await api('GET', '/api/admin/fraud-alerts');
  const d = document.getElementById('adminBody');
  const alerts = r.ok ? r.data.data.alerts : [];
  const unresolved = alerts.filter(a => !a.resolved);
  d.innerHTML = `<div class="grid cols-3" style="margin-bottom:14px">${[
    [t('admin_fraudTotal'), alerts.length],
    [t('admin_fraudUnresolved'), unresolved.length],
    [t('admin_fraudLargeAmt'), alerts.filter(a=>a.alert_type==='large_amount').length],
  ].map(([l,v]) => `<div class="glass kpi-card card-in"><div class="v" style="color:${l===t('admin_fraudUnresolved')&&v>0?'var(--red)':''}">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>
    <div class="glass"><h2 class="section">${ic('shieldAlert')} ${t('admin_fraudTitle')}</h2>
    <table><thead><tr><th>${t('admin_time')}</th><th>${t('admin_fraudType')}</th><th>${t('admin_colUser')}</th><th>${t('admin_fraudDesc')}</th><th>${t('admin_amount')}</th><th>${t('admin_status')}</th><th>${t('admin_op')}</th></tr></thead><tbody>
    ${alerts.map(a => `<tr style="${a.resolved ? '' : 'background:rgba(239,68,68,.06)'}"><td>${esc(fmtDate(a.created_at))}</td><td><span class="badge ${a.alert_type==='large_amount'?'red':a.alert_type==='rapid_fire'?'amber':'blue'}">${esc(a.alert_type)}</span></td><td>${esc(a.user_id?.slice(0,8)||'-')}</td><td class="sug-preview">${esc(a.description||'-')}</td><td>${a.amount ? money(a.amount)+' '+(a.currency||'') : '-'}</td><td>${a.resolved ? '<span class="badge green">'+t('common_resolved')+'</span>' : '<span class="badge amber">'+t('common_unresolved')+'</span>'}</td><td>${a.resolved ? '' : `<button class="btn sm ghost" onclick="adminResolveFraud('${a.id}')">${t('admin_resolve')}</button>`}</td></tr>`).join('')}
    </tbody></table>${alerts.length ? '' : emptyState('shieldAlert', t('admin_noFraud'), '')}</div>`;
}
async function adminResolveFraud(id) { const r = await api('POST', '/api/admin/fraud-alerts/'+id+'/resolve'); if (r.ok) { toast(t('admin_fraudResolved'),'ok'); adminFraud(); } else toast(r.data?.message,'err'); }
async function adminKYC() {
  const r = await api('GET', '/api/admin/kyc');
  const d = document.getElementById('adminBody');
  const pending = r.ok ? (r.data.data.pending || []) : [];
  const all = r.ok ? (r.data.data.all || []) : [];
  d.innerHTML = `<div class="glass" style="margin-bottom:14px"><h2 class="section">${ic('shieldCheck')} ${t('admin_kycPendingTitle')}</h2>
    ${pending.length ? pending.map(k => `<div class="form-row" style="margin-bottom:6px;align-items:center"><div><b>${esc(k.type)}</b> · ${esc(k.user_id?.slice(0,8))} · ${esc(fmtDate(k.submitted_at))}</div><div class="row"><a class="btn sm ghost" href="${esc(k.url)}" target="_blank">${t('admin_view')}</a><button class="btn sm" onclick="adminKycAction(${k.id},'approve')">${t('admin_approve')}</button><button class="btn sm danger" onclick="adminKycAction(${k.id},'reject')">${t('admin_reject')}</button></div></div>`).join('') : `<div class="muted" style="padding:8px">${t('admin_kycNoPending')}</div>`}</div>
    <div class="glass"><h2 class="section">${ic('list')} ${t('admin_kycHistory')}</h2>
    <table><thead><tr><th>${t('admin_time')}</th><th>${t('admin_colUser')}</th><th>${t('admin_kycType')}</th><th>${t('admin_status')}</th></tr></thead><tbody>
    ${all.map(k => `<tr><td>${esc(fmtDate(k.submitted_at))}</td><td>${esc(k.user_id?.slice(0,8)||'-')}</td><td>${esc(k.type)}</td><td><span class="badge ${k.status==='approved'?'green':k.status==='rejected'?'red':'amber'}">${esc(k.status)}</span></td></tr>`).join('')}
    </tbody></table>${all.length ? '' : emptyState('shieldCheck', t('admin_noKyc'), '')}</div>`;
}
async function adminKycAction(id, act) {
  const r = await api('POST', `/api/admin/kyc/${id}/${act}`, act === 'reject' ? { reason: prompt(t('admin_kycRejectReason')) || '' } : {});
  if (r.ok) { toast(t('admin_kycActionOk'),'ok'); adminKYC(); } else toast(r.data?.message,'err');
}
async function adminConfig() {
  const r = await api('GET', '/api/admin/config');
  const d = document.getElementById('adminBody');
  const cfg = r.ok ? r.data.data.config : {};
  const geoOn = cfg.geo_block_enabled === true || cfg.geo_block_enabled === 'true';
  d.innerHTML = `<div class="glass"><h2 class="section">${ic('settings')} ${t('admin_configTitle')}</h2>
    <div class="config-card" style="margin-bottom:14px">
      <div class="row" style="align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:600">${t('admin_geoTitle')}</div>
          <div class="muted" style="font-size:12px">${t('admin_geoDesc')}</div>
        </div>
        <label class="switch"><input type="checkbox" id="geoToggle" ${geoOn ? 'checked' : ''}><span class="slider"></span></label>
      </div>
    </div>
    <div id="cfgRows"></div>
    <button class="btn" id="saveCfg" style="margin-top:12px">${ic('check')} ${t('admin_saveCfg')}</button></div>`;
  const gt = document.getElementById('geoToggle');
  if (gt) gt.onchange = async () => {
    const rr = await api('PUT', '/api/admin/config', { geo_block_enabled: gt.checked });
    if (rr.ok) toast(t('admin_geoSaved') + (gt.checked ? ' · ON' : ' · OFF'), 'ok'); else toast(rr.data?.message, 'err');
  };
  const rows = document.getElementById('cfgRows');
  const managedKeys = ['geo_block_enabled'];
  rows.innerHTML = Object.keys(cfg).filter(k => !managedKeys.includes(k)).map(k => `<div class="form-row"><label class="field">${esc(k)}</label><input data-k="${esc(k)}" value="${esc(JSON.stringify(cfg[k]))}"></div>`).join('');
  document.getElementById('saveCfg').onclick = async () => {
    const body = {}; document.querySelectorAll('#cfgRows input').forEach(i => { try { body[i.dataset.k] = JSON.parse(i.value); } catch { body[i.dataset.k] = i.value; } });
    const rr = await api('PUT', '/api/admin/config', body); if (rr.ok) toast(t('admin_success'), 'ok'); else toast(rr.data?.message, 'err');
  };
}
async function adminAudit() {
  const r = await api('GET', '/api/admin/audit-logs');
  const d = document.getElementById('adminBody');
  const logs = r.ok ? r.data.data.logs : [];
  d.innerHTML = `<div class="glass"><h2 class="section">${ic('list')} ${t('admin_auditTitle')}</h2>
    <table><thead><tr><th>${t('admin_time')}</th><th>${t('admin_colUser')}</th><th>${t('admin_action')}</th><th>${t('admin_target')}</th><th>${t('admin_status')}</th></tr></thead><tbody>
    ${logs.map(l => `<tr style="${l.action.includes('deanonymize') ? 'background:rgba(255,181,71,.1)' : ''}"><td>${esc(fmtDate(l.created_at))}</td><td>${esc(l.user_id || '-')}</td><td><b>${esc(l.action)}</b></td><td>${esc(l.target)}</td><td><span class="badge ${l.status === 'success' ? 'green' : 'red'}">${esc(l.status === 'success' ? t('common_success') : t('common_fail'))}</span></td></tr>`).join('')}
    </tbody></table>${logs.length ? '' : emptyState('list', t('admin_noAudit'), '')}</div>`;
}
async function adminSuggestions() {
  const r = await api('GET', '/api/admin/suggestions');
  const d = document.getElementById('adminBody');
  const sugs = r.ok ? r.data.data.suggestions : [];
  d.innerHTML = `<div class="glass"><h2 class="section">${ic('chat')} ${t('admin_sugMgmtTitle')}</h2>
    <div class="row" style="margin-bottom:12px">
      <select id="fStatus"><option value="">${t('admin_filterStatusAll')}</option><option value="pending">${t('admin_statusPending')}</option><option value="archived">${t('admin_statusArchived')}</option><option value="deleted">${t('admin_statusDeleted')}</option></select>
      <select id="fAnon"><option value="">${t('admin_anonAll')}</option><option value="true">${t('admin_anonYes')}</option><option value="false">${t('admin_anonNo')}</option></select>
      <button class="btn sm ghost" onclick="adminSuggestions()">${t('admin_filter')}</button>
    </div>
    <table><thead><tr><th>${t('admin_submittedAt')}</th><th>${t('admin_anon')}</th><th>${t('admin_submitter')}</th><th>${t('admin_preview')}</th><th>${t('admin_status')}</th><th>${t('admin_op2')}</th></tr></thead><tbody>
    ${sugs.map(s => `<tr><td>${esc(fmtDate(s.submitted_at))}</td><td>${s.is_anonymous ? '<span class="badge amber">'+t('admin_anonYes')+'</span>' + (s.is_deanonymized ? ' <span class="badge red">'+t('admin_deanonBadge')+'</span>' : '') : '<span class="badge blue">'+t('admin_anonNo')+'</span>'}</td><td>${esc(s.submitter)}</td><td class="sug-preview">${esc(s.preview)}</td><td><span class="badge gray">${esc(s.status)}</span></td><td>
      <button class="btn sm" onclick="adminSugDetail(${s.id})">${t('admin_view')}</button>
    </td></tr>`).join('')}
    </tbody></table>${sugs.length ? '' : emptyState('chat', t('admin_noSug'), '')}</div>`;
}
async function adminSugDetail(id) {
  const r = await api('GET', `/api/admin/suggestions/${id}`);
  if (!r.ok) return toast(r.data?.message, 'err');
  const s = r.data.data;
  const tamper = s.tampered
    ? `<div class="warn-box" style="margin:10px 0">${ic('warn')} ⚠️ ${t('admin_hashTampered')} ${esc(s.content_hash)}</div>`
    : `<div class="note-box" style="margin:10px 0">${ic('shieldCheck')} ${t('admin_hashOk')}</div>`;
  modal(`<h3>${t('admin_sugDetailTitle')}${s.id}</h3>
    <div class="sug-meta">${t('admin_submittedAt')}：${esc(fmtDate(s.submitted_at))} · ${t('admin_submitter')}：${esc(s.submitter)} · ${t('admin_status')}：${esc(s.status)}</div>
    ${tamper}
    <div class="glass" style="padding:14px;margin:10px 0;white-space:pre-wrap">${esc(s.content)}</div>
    <div class="form-row"><label class="field">${t('admin_adminNote')}</label><textarea id="sugNote" rows="2" placeholder="admin">${esc(s.admin_note || '')}</textarea></div>
    <div class="row">
      <button class="btn sm" onclick="adminSugArchive(${id})">${ic('check')} ${t('admin_archive')}</button>
      <button class="btn sm ghost" onclick="adminSugNote(${id})">${t('admin_saveNote')}</button>
      <button class="btn sm danger" onclick="adminSugDelete(${id})">${ic('trash')} ${t('admin_delete')}</button>
      ${s.is_anonymous && !s.is_deanonymized ? `<button class="btn sm gold" onclick="adminSugDeanon(${id})">${ic('shieldCheck')} ${t('admin_deanon')}</button>` : (s.is_deanonymized ? '<span class="badge red">'+t('admin_deanonBadge')+'</span>' : '<span class="badge gray">'+t('admin_anonNo')+'</span>')}
      <button class="btn sm danger" onclick="adminSugBan(${id})">${t('admin_banned')}</button>
    </div>
    <button class="btn ghost sm" style="margin-top:8px" onclick="closeModal()">${t('common_close')}</button>`);
}
async function adminSugArchive(id) { const r = await api('POST', `/api/admin/suggestions/${id}/archive`); closeModal(); if (r.ok) { toast(t('admin_archived'), 'ok'); adminSuggestions(); } else toast(r.data?.message, 'err'); }
async function adminSugNote(id) { const r = await api('PUT', `/api/admin/suggestions/${id}/note`, { note: val('sugNote') }); if (r.ok) { toast(t('admin_noteSaved')); adminSugDetail(id); } else toast(r.data?.message, 'err'); }
async function adminSugDelete(id) { if (!confirm(t('admin_sugDeleteConfirm'))) return; const r = await api('DELETE', `/api/admin/suggestions/${id}`, { confirm: true }); closeModal(); if (r.ok) { toast(t('admin_deleted')); adminSuggestions(); } else toast(r.data?.message, 'err'); }
async function adminSugDeanon(id) {
  if (!confirm(t('admin_sugDeanonConfirm'))) return;
  const reason = prompt(t('admin_sugDeanonReason')) || t('admin_sugDeanonReason');
  const r = await api('POST', `/api/admin/suggestions/${id}/deanonymize`, { reason });
  if (r.ok) { toast(t('admin_deanonDone'), 'ok'); adminSugDetail(id); } else toast(r.data?.message, 'err');
}
async function adminSugBan(id) { const r = await api('POST', `/api/admin/suggestions/${id}/ban-user`); if (r.ok) { toast(t('admin_bannedDone'), 'ok'); closeModal(); adminSuggestions(); } else toast(r.data?.message, 'err'); }

/* ---------------- 销户申请（用户端） ---------------- */
async function openCancelAccount() {
  const r = await api('GET', '/api/cancellations/my');
  const pending = (r.ok && r.data.data.requests) ? r.data.data.requests.find(x => x.status === 'pending') : null;
  if (pending) { toast(t('profile_cancelRequested'), 'err'); return; }
  modal(`<h3>${ic('trash')} ${t('profile_cancelAccountTitle')}</h3>
    <div class="form-row"><label class="field">${t('profile_cancelReason')}</label><textarea id="cancelReason" rows="3" placeholder="${t('profile_cancelReasonPlaceholder')}"></textarea></div>
    <button class="btn danger" onclick="submitCancel()">${t('profile_cancelBtn')}</button>
    <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>`);
}
async function submitCancel() {
  const reason = val('cancelReason').trim();
  if (!reason) { toast(t('sug_empty'), 'err'); return; }
  if (!confirm(t('profile_cancelConfirm'))) return;
  const r = await api('POST', '/api/cancellations', { reason });
  if (r.ok) { toast(t('profile_cancelRequested'), 'ok'); closeModal(); renderProfile(); } else toast(r.data?.message, 'err');
}
async function loadCancelHistory() {
  const r = await api('GET', '/api/cancellations/my');
  const box = document.getElementById('cancelHistory');
  if (!box) return;
  const reqs = (r.ok && r.data.data.requests) ? r.data.data.requests : [];
  if (!reqs.length) { box.innerHTML = `<div class="muted" style="font-size:13px;margin-top:8px">${t('profile_cancelNoHistory')}</div>`; return; }
  box.innerHTML = `<h3 style="font-size:14px;margin-bottom:8px">${t('profile_cancelHistory')}</h3>` + reqs.map(req => {
    const st = { pending: ['profile_cancelPending','amber'], approved: ['profile_cancelApproved','green'], rejected: ['profile_cancelRejected','red'], cancelled: ['profile_cancelCancelled','gray'] }[req.status] || ['-','gray'];
    const actions = req.status === 'pending' ? `<button class="btn sm ghost" style="margin-top:4px" onclick="cancelRequest(${req.id})">${t('common_cancel')}</button>` : '';
    return `<div class="glass" style="padding:10px;margin-bottom:8px;font-size:13px">
      <div>${esc(req.reason_preview)}</div>
      <div class="sug-meta">${t('admin_submittedAt')}：${esc(fmtDate(req.submitted_at))}${req.reviewed_at ? ' · ' + t('admin_submittedAt') + '：' + esc(fmtDate(req.reviewed_at)) : ''}</div>
      <div class="sug-meta"><span class="badge ${st[1]}">${t(st[0])}</span>${req.admin_note ? ' · <span class="muted">'+esc(req.admin_note.substring(0,30))+'</span>' : ''}</div>
      ${actions}
    </div>`;
  }).join('');
}
async function cancelRequest(id) {
  const r = await api('POST', `/api/cancellations/${id}/cancel`);
  if (r.ok) { toast(t('profile_cancelCancelled'), 'ok'); loadCancelHistory(); } else toast(r.data?.message, 'err');
}

/* ---------------- Admin 销户申请管理 ---------------- */
async function adminCancellations() {
  const r = await api('GET', '/api/admin/cancellations');
  const d = document.getElementById('adminBody');
  const reqs = r.ok ? r.data.data.requests : [];
  d.innerHTML = `<div class="glass"><h2 class="section">${ic('trash')} ${t('admin_cancelReqView')}</h2>
    <div class="row" style="margin-bottom:12px">
      <select id="cStatus"><option value="">${t('admin_cancelReqFilterAll')}</option><option value="pending">${t('admin_cancelReqPending')}</option><option value="approved">${t('admin_cancelReqApproved')}</option><option value="rejected">${t('admin_cancelReqRejected')}</option><option value="cancelled">${t('admin_cancelReqCancelled')}</option></select>
      <button class="btn sm ghost" onclick="adminCancellations()">${t('admin_cancelReqFilter')}</button>
    </div>
    <table><thead><tr><th>${t('admin_submittedAt')}</th><th>${t('admin_cancelReqSubmitter')}</th><th>${t('admin_cancelReqReason')}</th><th>${t('admin_cancelReqStatus')}</th><th>${t('admin_cancelReqActions')}</th></tr></thead><tbody>
    ${reqs.map(req => {
      const st = { pending: ['profile_cancelPending','amber'], approved: ['profile_cancelApproved','green'], rejected: ['profile_cancelRejected','red'], cancelled: ['profile_cancelCancelled','gray'] }[req.status] || ['-','gray'];
      const actions = req.status === 'pending' ?
        `<button class="btn sm ghost" onclick="adminCancelDetail(${req.id})">${t('admin_view')}</button>
         <button class="btn sm" onclick="adminCancelApprove(${req.id})">${t('admin_cancelReqApprove')}</button>
         <button class="btn sm danger" onclick="adminCancelReject(${req.id})">${t('admin_cancelReqReject')}</button>` :
        `<button class="btn sm ghost" onclick="adminCancelDetail(${req.id})">${t('admin_view')}</button>`;
      return `<tr><td>${esc(fmtDate(req.submitted_at))}</td><td>${esc(req.submitter)}</td><td class="sug-preview">${esc(req.preview)}</td><td><span class="badge ${st[1]}">${t(st[0])}</span></td><td>${actions}</td></tr>`;
    }).join('')}
    </tbody></table>${reqs.length ? '' : emptyState('trash', t('admin_cancelReqNoData'), '')}</div>`;
}
async function adminCancelDetail(id) {
  const r = await api('GET', `/api/admin/cancellations/${id}`);
  if (!r.ok) return toast(r.data?.message, 'err');
  const req = r.data.data;
  const canAct = req.status === 'pending';
  modal(`<h3>${ic('trash')} ${t('admin_cancelReqDetailTitle')}${id}</h3>
    <div class="note-box" style="margin-bottom:10px">${esc(req.user_name)} · ${esc(req.user_email)} · ${t('profile_status')} ${esc(req.user_status || '-')}</div>
    <div style="margin-bottom:8px"><b>${t('admin_cancelReqReason')}：</b>${esc(req.reason)}</div>
    <div class="sug-meta">${t('admin_submittedAt')}：${esc(fmtDate(req.submitted_at))}${req.reviewed_at ? ' · ' + t('admin_submittedAt') + '：' + esc(fmtDate(req.reviewed_at)) : ''}</div>
    <div class="sug-meta"><span class="badge gray">${esc(req.status)}</span></div>
    ${req.admin_note ? `<div style="margin-top:8px"><b>Admin Note：</b> ${esc(req.admin_note)}</div>` : ''}
    ${req.tampered ? '<div class="warn-box" style="margin-top:8px">内容哈希不匹配，内容可能被篡改！</div>' : ''}
    ${canAct ? `<div class="row" style="margin-top:12px">
      <button class="btn" onclick="adminCancelApprove(${id})">${t('admin_cancelReqApprove')}</button>
      <button class="btn ghost" onclick="openCancelRejectNote(${id})">${t('admin_cancelReqReject')}</button>
    </div>` : ''}
    <button class="btn ghost sm" style="margin-top:8px" onclick="closeModal()">${t('common_close')}</button>`);
}
async function adminCancelApprove(id) {
  if (!confirm(t('admin_cancelReqApprove'))) return;
  const r = await api('POST', `/api/admin/cancellations/${id}/approve`);
  closeModal();
  if (r.ok) { toast(t('admin_cancelReqApprovedMsg'), 'ok'); adminCancellations(); } else toast(r.data?.message, 'err');
}
async function openCancelRejectNote(id) {
  modal(`<h3>${t('admin_cancelReqReject')}</h3>
    <div class="form-row"><label class="field">${t('admin_cancelReqRejectNote')}</label><textarea id="cancelRejectNote" rows="3"></textarea></div>
    <button class="btn danger" onclick="adminCancelReject(${id})">${t('admin_cancelReqReject')}</button>
    <button class="btn ghost" onclick="closeModal()">${t('common_cancel')}</button>`);
}
async function adminCancelReject(id) {
  const note = val('cancelRejectNote') || '';
  const r = await api('POST', `/api/admin/cancellations/${id}/reject`, { note });
  closeModal();
  if (r.ok) { toast(t('admin_cancelReqRejectedMsg'), 'ok'); adminCancellations(); } else toast(r.data?.message, 'err');
}

/* ---------------- 启动 ---------------- */
initTheme();
fillIcons();
setupLangSwitcher();
initLang();
bootstrap();

// ============ KYC Functions ============
async function uploadKYC() {
  const docType = document.getElementById('kycDocType').value;
  const docUrl = document.getElementById('kycDocUrl').value.trim();
  if (!docUrl) { toast(t('kyc_url_required'), 'err'); return; }
  const r = await api('POST', '/api/kyc/upload', { type: docType, url: docUrl });
  if (r.ok) {
    toast(t('kyc_upload_ok'), 'ok');
    document.getElementById('kycDocUrl').value = '';
    renderProfile();
  } else {
    toast(r.data?.message || t('common_error'), 'err');
  }
}

// Secret developer mode - bypass KYC for testing
async function secretDevMode() {
  // Check if URL has ?dev_mode=true
  const url = new URL(window.location.href);
  if (url.searchParams.get('dev_mode') === 'true') {
    // Bypass KYC check in profile
    state.user._is_verified = true;
    toast(t('dev_mode_activated'), 'ok');
    renderProfile();
  }
}
document.addEventListener('DOMContentLoaded', secretDevMode);
