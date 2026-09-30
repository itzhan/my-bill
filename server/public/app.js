(() => {
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const CUR = { CNY: { sym: '¥', name: '人民币' }, USDT: { sym: '₮', name: 'USDT' }, USD: { sym: '$', name: '美元' } };
const ICO = (n) => `<i class="ico ico-${n}"></i>`;

const state = {
  user: null, members: [], rates: { USD: 7.2, USDT: 7.2 },
  projects: [], totals: null, project: null, funds: null,
  filter: 'all', showArchived: false, view: null,
  ai: { configured: false, model: '', auto: true },
  autoExport: { enabled: false, time: '23:30', scope: 'all', range: 'month' },
  relayLive: {},
  exports: [],
  report: { scope: 'all', range: 'month', from: '', to: '', data: null, loading: false, view: 'note' },
};

// ---------------------------------------------------------------- 本地偏好
const DEFAULT_PREFS = { currency: 'CNY', type: 'expense', theme: 'auto', lastProject: null };
const prefs = (() => {
  try { return Object.assign({}, DEFAULT_PREFS, JSON.parse(localStorage.getItem('hz:prefs') || '{}')); }
  catch { return { ...DEFAULT_PREFS }; }
})();
function savePrefs() { try { localStorage.setItem('hz:prefs', JSON.stringify(prefs)); } catch {} }
function applyTheme() {
  if (prefs.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = prefs.theme;
}
applyTheme();

// ---------------------------------------------------------------- 请求
let appBuild = null, reloading = false;
function checkBuild(build) {
  if (!build) return;
  if (appBuild === null) { appBuild = build; return; }
  if (build !== appBuild && !reloading) { reloading = true; toast('系统已更新，正在刷新页面…'); setTimeout(() => location.reload(), 800); }
}
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  checkBuild(res.headers.get('X-App-Build'));
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && state.user) { state.user = null; showAuth(); }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

// ---------------------------------------------------------------- 格式化
const nf = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(Math.abs(Number(n) || 0));
const money = (n, cur = 'CNY') => `${CUR[cur].sym}${fmt(n)}`;
const signed = (n) => `${n < 0 ? '−' : ''}¥${fmt(n)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
function hue(name) { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; }
const avatar = (name, size = '') => `<span class="avatar ${size}" style="--h:${hue(name)}">${esc(String(name).slice(0, 1))}</span>`;
const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function dayLabel(key) {
  const today = new Date(), yest = new Date(); yest.setDate(today.getDate() - 1);
  const [Y, M, D] = key.split('-').map(Number);
  const md = `${M}月${D}日`;
  if (key === dayKey(today)) return `今天 · ${md}`;
  if (key === dayKey(yest)) return `昨天 · ${md}`;
  const wd = '周' + '日一二三四五六'[new Date(Y, M - 1, D).getDay()];
  return `${Y !== today.getFullYear() ? Y + '年' : ''}${md} ${wd}`;
}
function relTime(iso) {
  if (!iso) return '暂无记录';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  const t = new Date(iso);
  return `${t.getMonth() + 1}月${t.getDate()}日`;
}
const breakdown = (t) => ['CNY', 'USDT', 'USD'].filter((c) => t[c]).map((c) => `${CUR[c].sym}${nf0.format(t[c])}<i>${c}</i>`).join('<em>·</em>') || '还没有记录';
const maskPhone = (p) => (p.length > 7 ? p.slice(0, 3) + '****' + p.slice(-4) : p);
function greeting() { const h = new Date().getHours(); return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }
// 金额输入：支持全角数字、千分位、以及简单算式（120+80、300*2）
function parseAmount(raw) {
  let s = String(raw || '').trim().replace(/[，,\s]/g, '')
    .replace(/[０-９．＋－＊／（）]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[×xX]/g, '*').replace(/÷/g, '/');
  if (!s || !/^[\d.+\-*/()]+$/.test(s)) return NaN;
  let v;
  try { v = Function(`"use strict"; return (${s});`)(); } catch { return NaN; }
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg; el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2200);
}
function setLoading(btn, on) { btn.classList.toggle('loading', on); btn.disabled = on; }
function showErr(el, msg) { el.textContent = msg; el.hidden = false; const f = el.closest('form'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }

// ---------------------------------------------------------------- 登录 / 注册
function showAuth() {
  $('#shell').hidden = true; $('#view-auth').hidden = false;
  $$('.sheet.open').forEach(closeSheet);
  setTimeout(() => $('#login-account').focus(), 60);
}
function showShell() { $('#view-auth').hidden = true; $('#shell').hidden = false; }
function setAuthMode(mode) {
  const seg = $('.auth-seg'); seg.dataset.mode = mode;
  $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#form-login').hidden = mode !== 'login';
  $('#form-register').hidden = mode !== 'register';
  $$('.form-error').forEach((e) => { e.hidden = true; });
  (mode === 'login' ? $('#login-account') : $('#reg-username')).focus();
}
$$('.auth-seg button').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));
$$('.pw-eye').forEach((b) => b.addEventListener('click', () => {
  const input = $('#' + b.dataset.eye);
  input.type = input.type === 'password' ? 'text' : 'password';
  b.classList.toggle('on', input.type === 'text');
  input.focus();
}));

async function submitAuth(form, url, body, errEl) {
  const btn = $('button[type=submit]', form);
  errEl.hidden = true; setLoading(btn, true);
  try { enter(await api('POST', url, body)); }
  catch (e) { showErr(errEl, e.message); }
  finally { setLoading(btn, false); }
}
$('#form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  const account = $('#login-account').value.trim(), password = $('#login-password').value;
  if (!account || !password) return showErr($('#login-error'), '请输入账号和密码');
  submitAuth(e.target, '/api/auth/login', { account, password }, $('#login-error'));
});
$('#form-register').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = $('#reg-username').value.trim(), phone = $('#reg-phone').value.trim(), password = $('#reg-password').value;
  const err = $('#reg-error');
  if (!/^[\w一-龥]{2,20}$/.test(username)) return showErr(err, '用户名为 2–20 位中文、字母、数字或下划线');
  if (!/^\+?\d{6,20}$/.test(phone.replace(/[\s-]/g, ''))) return showErr(err, '手机号格式不正确');
  if (password.length < 6) return showErr(err, '密码至少 6 位');
  submitAuth(e.target, '/api/auth/register', { username, phone, password }, err);
});

function enter(d) {
  state.user = d.user; state.members = d.members; state.rates = d.rates; state.ai = d.ai || state.ai; state.autoExport = d.auto_export || state.autoExport; state.tz = d.tz; state.integrationToken = d.integration_token;
  connectEvents(); chatBoot();
  $('#form-login').reset(); $('#form-register').reset();
  showShell(); renderSideUser();
  toast(`${greeting()}，${d.user.username}`);
  route();
  if (state.view !== 'home') loadHome();
}

// ---------------------------------------------------------------- 路由
function route() {
  if (!state.user) return;
  const h = location.hash || '#/';
  const m = h.match(/^#\/p\/(\d+)/);
  if (m) return openProject(Number(m[1]));
  if (h.startsWith('#/me')) { showView('me'); renderMe(); if (!state.projects.length) loadHome().then(() => { if (state.view === 'me') renderMe(); }); return; }
  if (h.startsWith('#/reports')) { openReports(h.split('?')[1] || ''); return; }
  showView('home'); renderHome(); loadHome();
}
function showView(name) {
  const changed = state.view !== name;
  state.view = name;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  if (changed) { const v = $(`#view-${name}`); v.classList.remove('in'); void v.offsetWidth; v.classList.add('in'); window.scrollTo(0, 0); }
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- 总览
async function loadHome() {
  try {
    const d = await api('GET', '/api/projects');
    state.projects = d.projects; state.totals = d.totals; state.rates = d.rates; state.funds = d.funds;
    if (state.view === 'home') renderHome();
    renderSidebar();
  } catch (e) { toast(e.message, 'err'); }
}
function kpis(t) {
  return `<div class="kpis">
    <div class="kpi income"><div class="label">收入</div><div class="num">${money(t.income.base)}</div><div class="sub">${breakdown(t.income)}</div></div>
    <div class="kpi expense"><div class="label">支出</div><div class="num">${money(t.expense.base)}</div><div class="sub">${breakdown(t.expense)}</div></div>
    <div class="kpi profit ${t.profit < 0 ? 'neg' : 'pos'}"><div class="label">利润 = 收入 − 支出</div><div class="num">${signed(t.profit)}</div><div class="sub">${t.count} 笔记录 · 按各笔记账时汇率折算</div></div>
  </div>`;
}
function projectCard(p) {
  const s = p.summary;
  return `<a class="pcard ${p.archived ? 'archived' : ''}" href="#/p/${p.id}">
    <div class="pcard-top"><h3>${esc(p.name)}</h3>${p.archived ? '<span class="tag">已归档</span>' : ''}</div>
    <div class="pcard-profit ${s.profit < 0 ? 'neg' : 'pos'}"><span class="label">利润</span><span class="num">${signed(s.profit)}</span></div>
    <div class="pcard-row"><span class="income">收 ${money(s.income.base)}</span><span class="expense">支 ${money(s.expense.base)}</span></div>
    <div class="pcard-foot"><span>${s.count} 笔</span><span>${relTime(s.last_at)}</span></div>
  </a>`;
}
function renderHome() {
  const el = $('#view-home');
  if (!state.totals) {
    el.innerHTML = `<header class="page-head"><div><p class="eyebrow">${greeting()}，${esc(state.user.username)}</p><h1>总览</h1></div></header>
      <div class="skel"><i style="height:92px"></i><i style="height:120px"></i><i style="height:120px"></i></div>`;
    return;
  }
  const active = state.projects.filter((p) => !p.archived);
  const archived = state.projects.filter((p) => p.archived);
  const shown = state.showArchived ? state.projects : active;
  el.innerHTML = `
    <header class="page-head">
      <div><p class="eyebrow">${greeting()}，${esc(state.user.username)}</p><h1>总览</h1></div>
      <div class="head-actions"><button class="btn primary" id="home-add">${ICO('plus')}记一笔</button></div>
    </header>
    ${kpis(state.totals)}
    <div class="section-head"><h2>项目<span class="count">${active.length}</span></h2><button class="btn ghost" id="home-new-project">${ICO('plus')}新建项目</button></div>
    ${shown.length ? `<div class="pgrid">${shown.map(projectCard).join('')}</div>` : `
      <div class="empty card"><div class="glyph">合</div><h3>还没有项目</h3><p>先建一个项目，团队成员就能在里面分别记录支出与收入，系统自动算出利润。</p><button class="btn primary" id="empty-new-project">新建第一个项目</button></div>`}
    <div id="funds-section">${fundsSection(state, null)}</div>
    ${archived.length ? `<p style="margin-top:14px"><button class="link" id="toggle-archived">${state.showArchived ? '隐藏' : '查看'}已归档项目（${archived.length}）</button></p>` : ''}
  `;
  bindFunds($('#funds-section'), null);
  $('#home-add').addEventListener('click', () => openEntry());
  $('#home-new-project').addEventListener('click', () => openProjectSheet());
  $('#empty-new-project')?.addEventListener('click', () => openProjectSheet());
  $('#toggle-archived')?.addEventListener('click', () => { state.showArchived = !state.showArchived; renderHome(); });
}

// ---------------------------------------------------------------- 侧栏
function renderSidebar() {
  const active = state.projects.filter((p) => !p.archived);
  const cur = state.view === 'project' && state.project ? state.project.project.id : null;
  $('#side-projects').innerHTML = active.length
    ? active.map((p) => `<a href="#/p/${p.id}" class="${p.id === cur ? 'on' : ''}"><span>${esc(p.name)}</span><span class="num ${p.summary.profit < 0 ? 'expense' : ''}">${signed(p.summary.profit)}</span></a>`).join('')
    : '<div class="side-empty">还没有项目</div>';
}
function renderSideUser() {
  const u = state.user;
  $('#side-user').innerHTML = `${avatar(u.username, 'md')}<div class="who"><b>${esc(u.username)}</b><span>${esc(maskPhone(u.phone))}</span></div>`;
}
$('#side-new-project').addEventListener('click', () => openProjectSheet());
$('#side-add').addEventListener('click', () => openEntry());
$('#tab-add').addEventListener('click', () => openEntry());

// ---------------------------------------------------------------- 项目详情
async function openProject(id) {
  showView('project');
  if (!state.project || state.project.project.id !== id) {
    state.project = null;
    $('#view-project').innerHTML = `<header class="page-head"><div><a class="back" href="#/">${ICO('back')}总览</a><h1>&nbsp;</h1></div></header>
      <div class="skel"><i style="height:92px"></i><i style="height:64px"></i><i style="height:220px"></i></div>`;
  }
  try {
    const d = await api('GET', `/api/projects/${id}`);
    if (state.view !== 'project') return;
    state.project = d; prefs.lastProject = id; savePrefs();
    renderProject(); renderSidebar();
  } catch (e) { toast(e.message, 'err'); location.hash = '#/'; }
}
function entryRow(e) {
  const canDel = e.created_by === state.user.id || state.project.project.created_by === state.user.id;
  const isExp = e.type === 'expense';
  const rate = state.project.rates[e.currency];
  return `<div class="entry ${e.type} ${canDel ? 'editable' : ''}" data-id="${e.id}" ${canDel ? 'title="点击修改" role="button" tabindex="0"' : ''}>
    <div class="ic">${isExp ? '−' : '+'}</div>
    <div class="ebody">
      <div class="etitle">${esc(e.note) || (isExp ? '支出' : '收入')}</div>
      <div class="emeta">${avatar(e.handler_name, 'xs')}<span>${esc(e.handler_name)} ${isExp ? '支付' : '收款'}</span><span>·</span><span>${fmtTime(e.created_at)}</span>${e.created_by !== e.handler_id ? `<span>·</span><span>${esc(e.creator_name)} 登记</span>` : ''}</div>
    </div>
    <div class="eright">
      <div class="amt">${isExp ? '−' : '+'}${fmt(e.amount)}<i>${e.currency}</i></div>
      ${e.currency !== 'CNY' ? `<div class="conv">≈ ¥${fmt(e.amount * (e.rate || rate))} <i>@${e.rate || rate}</i></div>` : ''}
    </div>
    <button class="del ${canDel ? '' : 'spacer'}" data-del="${e.id}" title="删除这条记录" aria-label="删除" ${canDel ? '' : 'tabindex="-1"'}>${ICO('trash')}</button>
  </div>`;
}
function renderProject() {
  const { project: p, summary: s, entries, rates } = state.project;
  const list = entries.filter((e) => state.filter === 'all' || e.type === state.filter);
  const groups = new Map();
  for (const e of list) { const k = dayKey(e.created_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const groupHtml = [...groups].map(([k, es]) => {
    const inc = es.filter((e) => e.type === 'income').reduce((a, e) => a + (e.currency === 'CNY' ? e.amount : e.amount * rates[e.currency]), 0);
    const exp = es.filter((e) => e.type === 'expense').reduce((a, e) => a + (e.currency === 'CNY' ? e.amount : e.amount * rates[e.currency]), 0);
    const dsum = [inc ? `<span class="income">+${money(inc)}</span>` : '', exp ? `<span class="expense">−${money(exp)}</span>` : ''].filter(Boolean).join('&nbsp;&nbsp;');
    return `<div class="egroup"><h4><span>${dayLabel(k)}</span><span class="dsum num">${dsum}</span></h4><div class="elist">${es.map(entryRow).join('')}</div></div>`;
  }).join('');
  const fi = state.filter === 'all' ? 0 : state.filter === 'expense' ? 1 : 2;
  $('#view-project').innerHTML = `
    <header class="page-head">
      <div style="min-width:0"><a class="back" href="#/">${ICO('back')}总览</a><h1>${esc(p.name)}</h1>${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}${p.archived ? '<p class="note"><span class="tag">已归档 · 仅可查看</span></p>' : ''}</div>
      <div class="head-actions"><button class="icon-btn" id="proj-chat" title="项目群聊" aria-label="项目群聊">${ICO('spark')}</button><a class="icon-btn" href="#/reports?scope=${p.id}" title="查看报表" aria-label="查看报表">${ICO('chart')}</a><button class="icon-btn" id="proj-edit" title="编辑项目" aria-label="编辑项目">${ICO('edit')}</button>${p.archived ? '' : `<button class="btn primary" id="proj-add">${ICO('plus')}记一笔</button>`}</div>
    </header>
    ${kpis(s)}
    <div id="funds-section">${fundsSection(state.project, p.id)}</div>
    <div id="parties-section">${partiesSection(state.project)}</div>
    <div class="section-head"><h2>流水<span class="count">${entries.length}</span></h2>
      <div class="seg mini n3" id="filter-seg" style="--i:${fi}"><span class="thumb"></span>
        <button type="button" data-f="all" class="${fi === 0 ? 'on' : ''}">全部</button>
        <button type="button" data-f="expense" class="${fi === 1 ? 'on' : ''}">支出</button>
        <button type="button" data-f="income" class="${fi === 2 ? 'on' : ''}">收入</button>
      </div></div>
    ${list.length ? groupHtml : `<div class="empty card"><div class="glyph">＋</div><h3>${entries.length ? '没有符合筛选的记录' : '还没有流水'}</h3><p>${entries.length ? '换个筛选看看。' : '点击"记一笔"，登记谁支付了多少，或者项目收到了多少款。'}</p></div>`}
  `;
  $('#proj-add')?.addEventListener('click', () => openEntry(p.id));
  bindParties($('#parties-section'), p.id);
  bindFunds($('#funds-section'), p.id);
  $('#proj-edit').addEventListener('click', () => openProjectSheet(p));
  $('#proj-chat').addEventListener('click', async () => {
    if (!chat.channels.length) await loadChannels();
    const key = `project:${p.id}`;
    if (chat.channels.some((c) => c.key === key)) openChat(key);
    else createGroup(p.id);
  });
  $$('#filter-seg button').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.f; renderProject(); }));
  $$('[data-del]:not(.spacer)').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); deleteEntry(Number(b.dataset.del), b.closest('.entry')); }));
  $$('.entry.editable').forEach((row) => {
    const open = () => { const e = entries.find((x) => x.id === Number(row.dataset.id)); if (e) openEntryEdit(e); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
  });
}
async function deleteEntry(id, row) {
  if (!confirm('删除这条记录？此操作不可撤销。')) return;
  row.classList.add('removing');
  try {
    await api('DELETE', `/api/entries/${id}`);
    toast('已删除');
    await refresh();
  } catch (e) { row.classList.remove('removing'); toast(e.message, 'err'); }
}
async function refresh() {
  const tasks = [loadHome()];
  if (state.view === 'project' && state.project) tasks.push(openProject(state.project.project.id));
  if (state.view === 'reports') tasks.push(loadReport());
  await Promise.all(tasks);
}

// ---------------------------------------------------------------- 成员资金沉淀 + 成员之间的转账
const sheetTransfer = $('#sheet-transfer'), transferPanel = $('#transfer-panel');
const curBits = (cur) => ['USDT', 'USD'].filter((c) => cur[c]).map((c) => `${CUR[c].sym}${fmt(cur[c])} ${c}`).join(' · ');
function fundCard(m) {
  const bits = curBits(m.cur.balance);
  const neg = m.balance < 0;
  // 负数分两种：自己垫了钱（付得比收得多），或者只是把手上的钱转给了别人
  const negLabel = m.expense - m.income > 0 ? '垫付' : '已转出';
  return `<div class="fcard" data-fund="${m.id}" role="button" tabindex="0" title="点这里给他记一笔转账">
    ${avatar(m.name, 'md')}
    <div class="fmain">
      <div class="mname">${esc(m.name)}</div>
      <div class="fnums"><span class="income">收 ${money(m.income)}</span><span class="expense">付 ${money(m.expense)}</span>${m.in ? `<span class="tin">转入 ${money(m.in)}</span>` : ''}${m.out ? `<span class="tout">转出 ${money(m.out)}</span>` : ''}</div>
      ${bits ? `<div class="msub">含外币：${bits}</div>` : ''}
    </div>
    <div class="fbal"><b class="${neg ? 'expense' : 'brass'}">${signed(m.balance)}</b><small>${neg ? negLabel : '沉淀'}</small></div>
  </div>`;
}
function fundsSection(d, projectId) {
  const f = d && d.funds;
  if (!f) return '';
  const t = f.totals;
  const tf = f.transfers.slice(0, 6);
  return `<div class="section-head"><h2>成员资金</h2>
      <div class="head-actions"><span class="muted" style="font-size:12px">沉淀 = 经手收款 − 经手付款 + 转入 − 转出；转账只是成员之间搬钱${projectId ? '' : '（不含已归档项目）'}</span><button class="btn ghost" data-add-transfer="${projectId || ''}">${ICO('plus')}记转账</button></div></div>
    ${f.members.length ? `<div class="fgrid">${f.members.map(fundCard).join('')}</div>
    <div class="party-tot"><span>经手收款 <b>${money(t.income)}</b></span><span>经手付款 <b>${money(t.expense)}</b></span><span>内部调拨 <b>${money(t.in)}</b> <i class="muted">（成员之间搬钱，不计入收支）</i></span><span>沉淀合计 <b class="${t.balance < 0 ? 'expense' : 'brass'}">${signed(t.balance)}</b> <i class="muted">＝${projectId ? '本项目' : ''}利润</i></span></div>` : '<p class="muted" style="font-size:13px">还没有资金记录</p>'}
    ${tf.length ? `<div class="card tlist"><div class="section-head mini"><h3>成员之间的转账<span class="count">${f.transfers.length}</span></h3>${f.transfers.length > tf.length ? '<span class="muted" style="font-size:12px">显示最近 6 笔</span>' : ''}</div>
      ${tf.map((x) => `<div class="trow"><span class="tt">${esc(x.from)} → ${esc(x.to)}</span><span class="tn"><small>${x.time}${x.project && !projectId ? ` · ${esc(x.project)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''} · ${esc(x.creator)} 登记</small></span><span class="ra">${CUR[x.currency].sym}${fmt(x.amount)}${x.currency !== 'CNY' ? ` <small class="muted">≈¥${fmt(x.cny)}</small>` : ''}</span>
        ${x.created_by === state.user.id || (state.project && state.project.project && state.project.project.created_by === state.user.id) ? `<button type="button" class="icon-btn del" data-del-transfer="${x.id}" title="删除">${ICO('trash')}</button>` : '<span class="icon-btn spacer"></span>'}</div>`).join('')}</div>` : ''}`;
}
function bindFunds(root, projectId) {
  $$('[data-add-transfer]', root).forEach((b) => b.addEventListener('click', () => openTransfer(projectId, null)));
  $$('[data-fund]', root).forEach((el) => {
    const open = () => openTransfer(projectId, Number(el.dataset.fund));
    el.addEventListener('click', open);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
  });
  $$('[data-del-transfer]', root).forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!confirm('删除这笔转账？双方的资金沉淀会一起恢复。')) return;
    try { await api('DELETE', `/api/transfers/${b.dataset.delTransfer}`); toast('已删除'); refresh(); } catch (e) { toast(e.message, 'err'); }
  }));
}
function openTransfer(projectId, fromId) {
  const members = state.members;
  if (members.length < 2) { toast('至少要有两名成员才能记转账'); return; }
  const from = fromId || state.user.id;
  const to = members.find((m) => m.id !== from).id;
  const opt = (list, sel) => list.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.username)}</option>`).join('');
  const projects = state.projects.filter((p) => !p.archived);
  transferPanel.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h3>记一笔转账</h3><button type="button" class="icon-btn" data-close aria-label="关闭">${ICO('x')}</button></div>
    <p class="muted" style="font-size:13px">成员之间交钱（谁把手上的钱给了谁），只在成员资金之间搬动，不影响项目收入、支出和利润。</p>
    <form id="form-transfer" class="stack" style="gap:12px">
      <div class="row2"><label class="field"><span>谁转出</span><select id="tf-from" class="ctl select" style="width:100%">${opt(members, from)}</select></label>
        <label class="field"><span>谁收到</span><select id="tf-to" class="ctl select" style="width:100%">${opt(members, to)}</select></label></div>
      <div class="row2"><label class="field"><span>金额</span><input id="tf-amount" class="ctl" inputmode="decimal" placeholder="0.00" required></label>
        <label class="field"><span>币种</span><select id="tf-cur" class="ctl select" style="width:100%">${['CNY', 'USDT', 'USD'].map((c) => `<option value="${c}">${c}${c === 'CNY' ? ' 人民币' : ''}</option>`).join('')}</select></label></div>
      <div class="row2"><label class="field" id="tf-rate-field" hidden><span>汇率（1 外币 = ? CNY）</span><input id="tf-rate" class="ctl" inputmode="decimal"></label>
        <label class="field"><span>时间</span><input id="tf-time" class="ctl" type="datetime-local"></label></div>
      <label class="field"><span>算在哪个项目</span><select id="tf-project" class="ctl select" style="width:100%"><option value="">不挂项目（公司层面）</option>${projects.map((p) => `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span>备注</span><input id="tf-note" class="ctl" maxlength="200" placeholder="例如：交备用金 / 结算货款"></label>
      <p class="form-error" id="tf-error" hidden></p>
      <button class="btn primary big" type="submit"><span>记转账</span></button>
    </form>`;
  $$('[data-close]', transferPanel).forEach((b) => b.addEventListener('click', () => closeSheet(sheetTransfer)));
  $('#tf-time').value = toLocalInput(new Date());
  $('#tf-time').max = toLocalInput(new Date(Date.now() + 5 * 60000));
  const syncCur = () => { const c = $('#tf-cur').value; const f = $('#tf-rate-field'); f.hidden = c === 'CNY'; if (c !== 'CNY' && !$('#tf-rate').value) $('#tf-rate').value = String(state.rates[c] ?? ''); };
  $('#tf-cur').addEventListener('change', syncCur); syncCur();
  const guard = (a, b) => { if ($(a).value === $(b).value) { const other = members.find((m) => String(m.id) !== $(a).value); if (other) $(b).value = String(other.id); } };
  $('#tf-from').addEventListener('change', () => guard('#tf-from', '#tf-to'));
  $('#tf-to').addEventListener('change', () => guard('#tf-to', '#tf-from'));
  $('#form-transfer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target), err = $('#tf-error');
    const amount = Number($('#tf-amount').value);
    if (!(amount > 0)) return showErr(err, '请输入正确的金额');
    err.hidden = true; setLoading(btn, true);
    try {
      await api('POST', '/api/transfers', { project_id: $('#tf-project').value || null, from_id: Number($('#tf-from').value), to_id: Number($('#tf-to').value), amount, currency: $('#tf-cur').value, rate: $('#tf-rate').value || undefined, time: $('#tf-time').value, note: $('#tf-note').value });
      closeSheet(sheetTransfer); toast('已记录转账'); refresh();
    } catch (ex) { showErr(err, ex.message); }
    finally { setLoading(btn, false); }
  });
  openSheet(sheetTransfer);
  $('#tf-amount').focus();
}

// ---------------------------------------------------------------- 往来：供应商（应付 / 实付）与客户（应收 / 实收）
const PL = { supplier: { name: '供应商', due: '应付', paid: '实付', open: '未付', entry: '支出' }, customer: { name: '客户', due: '应收', paid: '实收', open: '未收', entry: '收入' } };
const usdf = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const curf = (n, c) => `${(CUR[c] || CUR.CNY).sym}${fmt(n)}${c === 'CNY' ? '' : ` <i class="cc">${c}</i>`}`;
const SOURCE_TXT = { api: '接口同步', ai: 'AI', relay: '中转站自动' };
function liveLine(v, live) {
  if (!v.relay) return '';
  if (!live) return '<div class="pm live"><span class="ai-dot off"></span>中转站已绑定 · 获取中…</div>';
  if (live.error) return `<div class="pm live"><span class="ai-dot err"></span>${esc(live.error)}</div>`;
  const st = live.settlement, C = st.currency, L = PL[v.kind];
  const ok = v.kind === 'customer' ? (live.user && live.user.status === 'active') : live.account.status === 'active';
  return `<div class="pm live"><span class="ai-dot ${ok ? 'live' : 'warn'}"></span><span>消耗 ${usdf(st.consumption_usd)} × ${st.ratio_label} ${st.ratio} = ${L.due} ${curf(st.consumption_x_ratio, C)} · 今日 ${curf(st.today || 0, C)}${live.live ? ` · ${live.live.rpm_now} RPM` : ''}${v.kind === 'customer' && live.user && live.user.balance_usd !== undefined ? ` · 余额 ${usdf(live.user.balance_usd)}` : ''}</span></div>`;
}
function partyCard(v) {
  const L = PL[v.kind], st = v.settle, C = st.currency;
  const live = (state.relayLive[v.project_id] || {})[v.id];
  const openVal = st.open > 0 ? st.open : -st.credit;
  const openLabel = st.credit > 0 ? (v.kind === 'customer' ? '预收余额' : '待消耗额度') : L.open;
  return `<div class="pty ${v.archived ? 'archived' : ''}" data-party="${v.id}" role="button" tabindex="0">
    <div><div class="pn">${esc(v.name)}${v.relay ? ' <span class="tag">中转站</span>' : ''}${v.archived ? ' <span class="tag">归档</span>' : ''}</div><div class="pm">${L.due} ${curf(st.due, C)} · ${L.paid} ${curf(st.paid, C)}${v.totals.last_at ? ` · ${v.totals.last_at}` : ''}</div>${liveLine(v, live)}</div>
    <div class="po"><b class="${openVal > 0 ? 'open-pos' : openVal < 0 ? 'income' : ''}">${curf(Math.abs(openVal), C)}</b><small>${openLabel}${C !== 'CNY' ? ` · ≈¥${fmt(Math.abs(st.open_cny))}` : ''}</small></div></div>`;
}
function partiesSection(d) {
  const ps = d.parties || { suppliers: [], customers: [], totals: { supplier: { due: 0, paid: 0, open: 0 }, customer: { due: 0, paid: 0, open: 0 } }, daily: [] };
  const col = (kind, list) => { const L = PL[kind], t = ps.totals[kind]; return `<div class="party-col">
    <div class="section-head"><h2>${L.name}<span class="count">${list.length}</span></h2><button class="btn ghost" data-add-party="${kind}">${ICO('plus')}${L.name}</button></div>
    <div class="party-tot"><span>${L.due} <b>${money(t.due)}</b></span><span>${L.paid} <b>${money(t.paid)}</b></span><span>${L.open} <b class="${t.open > 0 ? 'open-pos' : ''}">${money(t.open)}</b></span><span class="muted">合计按人民币折算</span></div>
    ${list.length ? `<div class="party-list">${list.map(partyCard).join('')}</div>` : `<p class="muted" style="font-size:13px">还没有${L.name}。${kind === 'supplier' ? '录入后按天记应付与实付。' : '录入后按天记应收与实收，也可由外部接口自动同步。'}</p>`}</div>`; };
  const daily = ps.daily.slice(0, 14);
  const linked = [...ps.suppliers, ...ps.customers].some((v) => v.relay);
  const fetched = (state.relayLive[d.project.id] || {}).__at;
  return `<div class="section-head"><h2>往来</h2><div class="head-actions">${linked ? `<span class="muted" style="font-size:12px">${fetched ? `中转站数据 ${relTime(fetched)} 更新 · 每 30 秒自动刷新` : '中转站数据获取中…'}</span><button class="btn ghost" id="relay-refresh">刷新</button>` : '<span class="muted" style="font-size:12px">应付 / 应收只挂账，实付 / 实收同步记入流水</span>'}</div></div>
    <div class="parties">${col('supplier', ps.suppliers)}${col('customer', ps.customers)}</div>
    ${daily.length ? `<section class="card party-daily" style="margin-top:12px"><div class="section-head" style="margin:0 0 8px"><h2>往来日报</h2><span class="muted" style="font-size:12px">最近 ${daily.length} 天有记录</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th class="r">应收</th><th class="r">实收</th><th class="r">应付</th><th class="r">实付</th><th class="r">笔数</th></tr></thead><tbody>
      ${daily.map((x) => `<tr><td>${x.date}</td><td class="r">${x.receivable ? money(x.receivable) : '<span class="muted">—</span>'}</td><td class="r income">${x.received ? money(x.received) : '<span class="muted">—</span>'}</td><td class="r">${x.payable ? money(x.payable) : '<span class="muted">—</span>'}</td><td class="r expense">${x.paid ? money(x.paid) : '<span class="muted">—</span>'}</td><td class="r">${x.count}</td></tr>`).join('')}
      </tbody></table></div></section>` : ''}`;
}
function bindParties(root, projectId) {
  $('#relay-refresh')?.addEventListener('click', () => loadRelayLive(projectId, true));
  scheduleRelayLive(projectId);
  $$('[data-add-party]', root).forEach((b) => b.addEventListener('click', () => openPartyNew(projectId, b.dataset.addParty)));
  $$('[data-party]', root).forEach((el) => { const open = () => openParty(Number(el.dataset.party)); el.addEventListener('click', open); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); }); });
}
// 中转站实时数据：项目页每 30 秒轮询，只有绑定过的单位才会请求
let relayTimer = null;
function scheduleRelayLive(projectId) {
  clearInterval(relayTimer); relayTimer = null;
  const ps = state.project && state.project.parties;
  if (!ps || ![...ps.suppliers, ...ps.customers].some((v) => v.relay)) return;
  if (!state.relayLive[projectId] || Date.now() - new Date(state.relayLive[projectId].__at || 0).getTime() > 25000) loadRelayLive(projectId);
  relayTimer = setInterval(() => { if (state.view === 'project' && state.project && state.project.project.id === projectId) loadRelayLive(projectId); else { clearInterval(relayTimer); relayTimer = null; } }, 30000);
}
let relayLoading = false;
async function loadRelayLive(projectId, manual = false) {
  if (relayLoading) return; relayLoading = true;
  const btn = $('#relay-refresh'); if (btn && manual) setLoading(btn, true);
  try {
    const d = await api('GET', `/api/projects/${projectId}/relay`);
    state.relayLive[projectId] = { ...d.parties, __at: d.fetched_at };
    if (state.view === 'project' && state.project && state.project.project.id === projectId) {
      const sec = $('#parties-section'); if (sec) { sec.innerHTML = partiesSection(state.project); bindParties(sec, projectId); }
    }
    if (manual) toast('中转站数据已刷新');
  } catch (e) { if (manual) toast(e.message, 'err'); }
  finally { relayLoading = false; }
}
const sheetParty = $('#sheet-party'), partyPanel = $('#party-panel');
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function openPartyNew(projectId, kind) {
  stopPartyTimer(); partyCtx.id = null; partyCtx.mode = 'new';
  const L = PL[kind];
  partyPanel.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h3>添加${L.name}</h3><button type="button" class="icon-btn" data-close aria-label="关闭">${ICO('x')}</button></div>
    <form id="form-party" class="stack" style="gap:12px">
      <label class="field"><span>${L.name}名称</span><input id="pty-name" class="ctl" maxlength="60" required placeholder="${kind === 'supplier' ? '例如：XX 广告代理' : '例如：XX 科技有限公司'}"></label>
      <div class="party-form" style="background:transparent;padding:0"><div class="row">
        <label class="field"><span>联系方式（可选）</span><input id="pty-contact" class="ctl" maxlength="100"></label>
        <label class="field"><span>结算币种（${L.due} / ${L.paid} 按此币种记）</span><select id="pty-currency" class="ctl select" style="width:100%"><option value="CNY">CNY 人民币</option><option value="USDT">USDT</option><option value="USD">USD 美元</option></select></label></div></div>
      <label class="field"><span>备注（可选）</span><input id="pty-note" class="ctl" maxlength="200"></label>
      ${state.ai.relay ? `<div class="party-form" style="background:transparent;padding:0"><div class="row">
        <label class="field"><span>${kind === 'customer' ? '中转站邮箱（一键获取消耗）' : '中转站账号名称（一键获取消耗）'}</span><input id="pty-relay" class="ctl" maxlength="120" placeholder="${kind === 'customer' ? '客户在中转站的登录邮箱' : '中转站「账号管理」里的账号名'}"></label>
        <label class="field"><span>${kind === 'supplier' ? '倍率（应付 = 消耗 × 倍率）' : '折扣（应收 = 消耗 × 折扣）'}</span><input id="pty-ratio" class="ctl" inputmode="decimal" value="1" placeholder="${kind === 'supplier' ? '例如 0.65' : '例如 0.8'}"></label></div></div>` : ''}
      <label class="field"><span>外部系统编号（可选，接口同步时匹配用）</span><input id="pty-ext" class="ctl" maxlength="100"></label>
      <p class="form-error" id="pty-error" hidden></p>
      <button class="btn primary big" type="submit"><span>添加${state.ai.relay ? '并获取' : ''}</span></button>
    </form>`;
  $$('[data-close]', partyPanel).forEach((b) => b.addEventListener('click', () => closeSheet(sheetParty)));
  $('#form-party').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target), err = $('#pty-error');
    const name = $('#pty-name').value.trim(); if (!name) return showErr(err, '请填写名称');
    err.hidden = true; setLoading(btn, true);
    const ratioEl = $('#pty-ratio'); const ratio = ratioEl ? Number(ratioEl.value) : undefined;
    if (ratioEl && !(ratio > 0)) { setLoading(btn, false); return showErr(err, `${kind === 'customer' ? '折扣' : '倍率'}必须大于 0`); }
    try {
      const d = await api('POST', `/api/projects/${projectId}/parties`, { kind, name, contact: $('#pty-contact').value, note: $('#pty-note').value, currency: $('#pty-currency').value, external_id: $('#pty-ext').value, ratio });
      const relayRef = $('#pty-relay') ? $('#pty-relay').value.trim() : '';
      toast(`已添加${L.name}「${d.party.name}」`);
      if (relayRef) { try { await api('POST', `/api/parties/${d.party.id}/relay-link`, { ref: relayRef }); toast('已绑定中转站，开始自动挂账'); } catch (ex) { toast(`绑定中转站失败：${ex.message}`, 'err'); } }
      openParty(d.party.id); refresh();
    } catch (ex) { showErr(err, ex.message); }
    finally { setLoading(btn, false); }
  });
  openSheet(sheetParty); $('#pty-name').focus();
}
let partyTimer = null;
const partyCtx = { id: null, mode: null }; // 当前弹层里显示的是哪一家、什么模式（view / new / edit）
function stopPartyTimer() { clearInterval(partyTimer); partyTimer = null; }
function relayBlock(v, live, configured) {
  if (!configured) return '';
  const L = PL[v.kind], rl = v.kind === 'customer' ? '折扣' : '倍率';
  const curSel = (id, val) => `<select id="${id}" class="ctl select" style="width:100%">${['CNY', 'USDT', 'USD'].map((c) => `<option value="${c}" ${c === val ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
  if (!v.relay) return `<div class="relay-box"><div class="rb-head"><b>中转站</b><span class="muted">${v.kind === 'customer' ? '填客户在中转站的邮箱；应收 = 消耗 × 折扣，按结算币种自动逐日挂账' : '填中转站「账号管理」里的账号名；应付 = 消耗 × 倍率，按结算币种自动逐日挂账'}</span></div>
    <input id="relay-ref" class="ctl" placeholder="${v.kind === 'customer' ? '邮箱 / 用户名' : '账号名称'}" value="${esc(v.external_id || '')}">
    <div class="row2"><label class="field"><span>${rl}（${L.due} = 消耗 × ${rl}）</span><input id="relay-ratio" class="ctl" inputmode="decimal" value="${v.ratio}"></label><label class="field"><span>结算币种</span>${curSel('relay-cur', v.currency)}</label></div>
    <button type="button" class="btn primary big" id="relay-link">一键获取并开始挂账</button><p class="form-error" id="relay-error" hidden></p></div>`;
  if (!live) return `<div class="relay-box"><div class="rb-head"><b>中转站 · ${esc(v.relay.ref)}</b><span class="muted">获取中…</span></div><div class="skel"><i style="height:48px"></i></div></div>`;
  if (live.error) return `<div class="relay-box"><div class="rb-head"><b>中转站 · ${esc(v.relay.ref)}</b><button type="button" class="link" id="relay-unlink">解除绑定</button></div><p class="form-error">${esc(live.error)}</p><button type="button" class="btn ghost" id="relay-refresh-one">重试</button></div>`;
  const lv = live.live, st = live.settlement, C = st.currency;
  const kv = (label, val, cls = '') => `<div><span>${label}</span><b class="${cls}">${val}</b></div>`;
  const hourly = (live.hourly || []).slice(-12);
  const costOf = (h) => (v.kind === 'customer' ? h.cost_usd : h.std_cost_usd);
  const maxH = Math.max(0.01, ...hourly.map(costOf));
  const bars = hourly.length ? `<div class="hbar-mini">${hourly.map((h) => `<i title="${h.hour} · ${usdf(costOf(h))} · ${h.requests} 次" style="height:${Math.max(2, (costOf(h) / maxH) * 100).toFixed(0)}%"></i>`).join('')}<small>近 ${hourly.length} 小时消耗（$）</small></div>` : '';
  const head = `<div class="rb-head"><b>中转站${v.kind === 'supplier' ? '账号' : ''} · ${esc(v.relay.ref)}</b><span class="muted">${relTime(live.fetched_at)}更新 · 30 秒自动刷新 · <button type="button" class="link" id="relay-refresh-one">刷新</button> · <button type="button" class="link" id="relay-unlink">解绑</button></span></div>`;
  const settle = `<div class="party-kpis four">${kv('中转站累计消耗', usdf(st.consumption_usd))}${kv(`× ${rl} ${st.ratio} = ${L.due}`, curf(st.consumption_x_ratio, C))}${kv(`今日${L.due}`, st.today === null ? '—' : curf(st.today, C))}${kv(`本小时`, st.this_hour === null ? '—' : curf(st.this_hour, C))}</div>`;
  if (v.kind === 'customer') {
    const u = live.user || {};
    return `<div class="relay-box">${head}${settle}
      <div class="party-kpis four">${kv('当前 RPM', lv ? `${lv.rpm_now}<small> / 5分钟均 ${lv.rpm_5m_avg}</small>` : '—')}${kv('当前 TPM', lv ? fmtCompact(lv.tpm_now) : '—')}${kv('今日请求', (live.today.requests || 0).toLocaleString())}${kv('中转站余额', u.balance_usd !== undefined ? usdf(u.balance_usd) : '—', u.balance_usd < 0 ? 'expense' : '')}</div>
      ${bars}<p class="muted" style="font-size:12px">状态 ${esc(u.status || '—')} · 限 ${u.rpm_limit ?? '—'} RPM · 最近请求 ${lv && lv.last_request_at ? lv.last_request_at : '—'}${lv && Object.keys(lv.models_5m || {}).length ? ` · 近 5 分钟模型：${Object.entries(lv.models_5m).map(([m, n]) => `${m}×${n}`).join('、')}` : ''} · 汇率 1 USD = ${st.usd_rate} CNY${C === 'USDT' ? `，1 USDT = ${st.cur_rate} CNY` : ''} · 应收按 ${C} 自动逐日挂账</p></div>`;
  }
  const a = live.account || {};
  return `<div class="relay-box">${head}${settle}
    <div class="party-kpis four">${kv('当前 RPM', lv ? `${lv.rpm_now}<small> / 5分钟均 ${lv.rpm_5m_avg}</small>` : '—')}${kv('今日请求', (live.today.requests ?? 0).toLocaleString())}${kv('并发', `${a.current_concurrency ?? 0}/${a.concurrency_limit ?? '—'}`)}${kv('账号状态', `${esc(a.status || '—')}${a.error ? `<small class="expense"> ${esc(a.error).slice(0, 40)}</small>` : ''}`, a.status === 'active' ? '' : 'expense')}</div>
    ${bars}<p class="muted" style="font-size:12px">平台 ${esc(a.platform || '—')} · 最近使用 ${a.last_used_at || '—'} · 汇率 1 USD = ${st.usd_rate} CNY${C === 'USDT' ? `，1 USDT = ${st.cur_rate} CNY` : ''} · 应付按 ${C} 自动逐日挂账${a.temp_unschedulable ? ` · <span class="expense">暂不可调度：${esc(a.temp_unschedulable).slice(0, 60)}</span>` : ''}</p></div>`;
}
function bindRelayBlock(v) {
  $('#relay-link')?.addEventListener('click', async () => {
    const btn = $('#relay-link'), err = $('#relay-error'); const ref = $('#relay-ref').value.trim();
    if (!ref) return showErr(err, v.kind === 'customer' ? '请填写中转站邮箱' : '请填写中转站账号名称');
    const ratio = Number($('#relay-ratio').value); if (!(ratio > 0)) return showErr(err, `${v.kind === 'customer' ? '折扣' : '倍率'}必须大于 0`);
    err.hidden = true; setLoading(btn, true);
    try { await api('POST', `/api/parties/${v.id}/relay-link`, { ref, ratio, currency: $('#relay-cur').value }); toast('已绑定并开始自动挂账'); delete state.relayLive[v.project_id]; openParty(v.id); refresh(); }
    catch (ex) { showErr(err, ex.message); setLoading(btn, false); }
  });
  $('#relay-unlink')?.addEventListener('click', async () => { if (!confirm('解除与中转站的绑定？停止自动挂账，已自动挂账的记录保留（可手动删除）')) return; try { await api('DELETE', `/api/parties/${v.id}/relay-link`); delete state.relayLive[v.project_id]; openParty(v.id); refresh(); } catch (ex) { toast(ex.message, 'err'); } });
  $('#relay-refresh-one')?.addEventListener('click', () => openParty(v.id, true));
}
async function openParty(id, silent = false) {
  id = Number(id);
  if (!silent) { partyPanel.innerHTML = '<div class="grab"></div><div class="skel"><i style="height:40px"></i><i style="height:120px"></i></div>'; openSheet(sheetParty); }
  stopPartyTimer();
  partyCtx.id = id; partyCtx.mode = 'view';
  try {
    const d = await api('GET', `/api/parties/${id}`);
    let live = null;
    if (d.party.relay) { try { live = (await api('GET', `/api/parties/${id}/relay`)).live; } catch (e) { live = { error: e.message }; } }
    // 加载期间用户已经关掉、或切到了别的单位 / 表单：丢弃这次结果，绝不覆盖当前界面
    if (!sheetParty.classList.contains('open') || partyCtx.id !== id || partyCtx.mode !== 'view') return;
    renderParty(d, live);
    if (d.party.relay) partyTimer = setInterval(() => {
      if (sheetParty.classList.contains('open') && partyCtx.id === id && partyCtx.mode === 'view') openParty(id, true); else stopPartyTimer();
    }, 30000);
  } catch (e) { if (partyCtx.id === id) { toast(e.message, 'err'); closeSheet(sheetParty); } }
}
function renderParty(d, live) {
  const v = d.party, L = PL[v.kind], t = v.totals, st0 = (live && live.settlement) || v.settle;
  const focused = document.activeElement && document.activeElement.id;
  const draft = { amount: $('#rec-amount')?.value, note: $('#rec-note')?.value, date: $('#rec-date')?.value };
  partyPanel.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><div><h3>${esc(v.name)} <span class="tag">${L.name}</span></h3><p class="muted" style="font-size:12px">${esc(v.project_name)}${v.contact ? ` · ${esc(v.contact)}` : ''}${v.note ? ` · ${esc(v.note)}` : ''}</p></div>
      <div class="head-actions"><button type="button" class="icon-btn" id="pty-edit" title="编辑">${ICO('edit')}</button><button type="button" class="icon-btn" data-close aria-label="关闭">${ICO('x')}</button></div></div>
    <div class="party-kpis"><div><span>${L.due}（${st0.currency}）${v.relay ? `<small> · 中转站自动 ${fmt(st0.relay_due)}${st0.manual_due ? ` + 手工 ${fmt(st0.manual_due)}` : ''}</small>` : ''}</span><b>${curf(st0.due, st0.currency)}</b></div><div><span>${L.paid}（${st0.currency}）</span><b>${curf(st0.paid, st0.currency)}</b></div><div><span>${st0.credit > 0 ? (v.kind === 'customer' ? '预收余额' : '待消耗额度') : L.open}（${st0.currency}）${st0.currency !== 'CNY' && (st0.open > 0 || st0.credit > 0) ? `<small> · ≈¥${fmt(Math.abs(st0.open_cny))}</small>` : ''}</span><b class="${st0.open > 0 ? 'open-pos' : st0.credit > 0 ? 'income' : ''}">${curf(st0.open > 0 ? st0.open : st0.credit, st0.currency)}</b></div></div>
    ${relayBlock(v, live, d.relay_configured)}
    ${v.archived ? '<p class="muted" style="font-size:13px">已归档，只能查看</p>' : `<form id="form-rec" class="party-form">
      <div class="seg n2" id="rec-kind" style="--i:0"><span class="thumb"></span><button type="button" data-k="due" class="on">记${L.due}</button><button type="button" data-k="paid">记${L.paid}</button></div>
      <div class="row"><label class="field"><span>金额</span><input id="rec-amount" class="ctl" inputmode="decimal" placeholder="0.00" required></label>
        <label class="field"><span>币种</span><select id="rec-currency" class="ctl select" style="width:100%">${['CNY', 'USDT', 'USD'].map((c) => `<option value="${c}" ${c === v.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <div class="row"><label class="field" id="rec-rate-field" ${v.currency === 'CNY' ? 'hidden' : ''}><span>汇率（1 外币 = ? CNY）</span><input id="rec-rate" class="ctl" inputmode="decimal" value="${v.currency === 'CNY' ? '' : state.rates[v.currency] || ''}"></label>
        <label class="field"><span>日期</span><input id="rec-date" class="ctl" type="date" value="${todayLocal()}"></label></div>
      <label class="field"><span>备注</span><input id="rec-note" class="ctl" maxlength="200" placeholder="${v.kind === 'supplier' ? '例如：9 月服务费' : '例如：第二期款'}"></label>
      <label class="field" id="rec-handler-wrap" hidden><span>经手人（谁${v.kind === 'supplier' ? '付' : '收'}的钱，计入他的资金沉淀）</span><select id="rec-handler" class="ctl select" style="width:100%">${state.members.map((m) => `<option value="${m.id}" ${m.id === state.user.id ? 'selected' : ''}>${esc(m.username)}</option>`).join('')}</select></label>
      <label class="switch" id="rec-link-wrap" hidden><input type="checkbox" id="rec-link" checked><span class="track"></span><span>同时记入项目流水（${L.entry}）</span></label>
      <p class="form-error" id="rec-error" hidden></p>
      <button class="btn primary big" type="submit"><span>记${L.due}</span></button>
    </form>`}
    <div class="section-head" style="margin:4px 0 6px"><h2>往来明细<span class="count">${d.records.length}</span></h2><span class="muted" style="font-size:12px">按日期倒序</span></div>
    ${d.records.length ? `<div class="rec-list">${d.records.map((r) => `<div class="rec"><span class="rd">${r.date}</span><span class="rn"><b>${L[r.kind]}</b>${r.source === 'relay' ? ' <span class="tag">自动</span>' : ''}${r.note ? ` · ${esc(r.note)}` : ''} <small>${r.source === 'relay' ? '中转站自动挂账' : `${r.creator_name ? `${esc(r.creator_name)} ` : ''}${fmtTime(r.created_at)} 登记${SOURCE_TXT[r.source] ? ` · ${SOURCE_TXT[r.source]}` : ''}`}${r.entry_id ? ' · 已入流水' : ''}</small></span><span class="ra ${r.kind === 'paid' ? (v.kind === 'supplier' ? 'expense' : 'income') : ''}">${CUR[r.currency].sym}${fmt(r.amount)}${r.currency !== 'CNY' ? ` <small class="muted">≈¥${fmt(r.cny)}</small>` : ''}</span>${r.source === 'relay' && v.relay ? `<span class="icon-btn" style="opacity:.35;cursor:not-allowed" title="自动挂账记录，绑定期间不能删除">${ICO('trash')}</span>` : `<button type="button" class="icon-btn del" data-del-rec="${r.id}" title="删除">${ICO('trash')}</button>`}</div>`).join('')}</div>` : '<p class="muted" style="font-size:13px">还没有往来记录</p>'}`;
  $$('[data-close]', partyPanel).forEach((b) => b.addEventListener('click', () => closeSheet(sheetParty)));
  $('#pty-edit').addEventListener('click', () => editParty(v));
  bindRelayBlock(v);
  if (draft.amount && $('#rec-amount')) { $('#rec-amount').value = draft.amount; $('#rec-note').value = draft.note || ''; if (draft.date) $('#rec-date').value = draft.date; }
  if (focused && $('#' + focused)) $('#' + focused).focus();
  const form = $('#form-rec');
  if (form) {
    let kind = 'due';
    const syncKind = () => { $('#rec-kind').style.setProperty('--i', kind === 'due' ? 0 : 1); $$('#rec-kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind)); $('#rec-link-wrap').hidden = kind !== 'paid'; $('#rec-handler-wrap').hidden = kind !== 'paid'; $('span', $('button[type=submit]', form)).textContent = `记${L[kind]}`; };
    $$('#rec-kind button').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; syncKind(); }));
    $('#rec-currency').addEventListener('change', () => { const c = $('#rec-currency').value; $('#rec-rate-field').hidden = c === 'CNY'; if (c !== 'CNY') $('#rec-rate').value = state.rates[c] || ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#rec-error'), btn = $('button[type=submit]', form);
      const amount = parseAmount($('#rec-amount').value); if (!(amount > 0)) return showErr(err, '请输入正确的金额');
      const currency = $('#rec-currency').value; const rate = currency === 'CNY' ? undefined : Number($('#rec-rate').value);
      if (currency !== 'CNY' && !(rate > 0)) return showErr(err, '请填写汇率');
      err.hidden = true; setLoading(btn, true);
      try { await api('POST', `/api/parties/${v.id}/records`, { kind, amount, currency, rate, date: $('#rec-date').value, note: $('#rec-note').value.trim(), link_entry: kind === 'paid' ? $('#rec-link').checked : false, handler_id: kind === 'paid' ? Number($('#rec-handler').value) : undefined }); toast(`已记${L[kind]} ${CUR[currency].sym}${fmt(amount)}`); openParty(v.id); refresh(); }
      catch (ex) { showErr(err, ex.message); }
      finally { setLoading(btn, false); }
    });
    $('#rec-amount').focus();
  }
  $$('[data-del-rec]', partyPanel).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('删除这条往来记录？关联的流水也会一并删除。')) return;
    try { await api('DELETE', `/api/party-records/${b.dataset.delRec}`); toast('已删除'); openParty(v.id); refresh(); } catch (ex) { toast(ex.message, 'err'); }
  }));
}
function editParty(v) {
  stopPartyTimer(); partyCtx.id = v.id; partyCtx.mode = 'edit';
  const L = PL[v.kind];
  partyPanel.innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h3>编辑${L.name}</h3><button type="button" class="icon-btn" data-close aria-label="关闭">${ICO('x')}</button></div>
    <form id="form-party-edit" class="stack" style="gap:12px">
      <label class="field"><span>名称</span><input id="pe-name" class="ctl" maxlength="60" value="${esc(v.name)}" required></label>
      <div class="party-form" style="background:transparent;padding:0"><div class="row">
        <label class="field"><span>联系方式</span><input id="pe-contact" class="ctl" maxlength="100" value="${esc(v.contact)}"></label>
        <label class="field"><span>默认结算币种</span><select id="pe-currency" class="ctl select" style="width:100%">${['CNY', 'USDT', 'USD'].map((c) => `<option value="${c}" ${c === v.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div></div>
      <label class="field"><span>备注</span><input id="pe-note" class="ctl" maxlength="200" value="${esc(v.note)}"></label>
      <label class="field"><span>${v.kind === 'supplier' ? '倍率（应付 = 中转站消耗 × 倍率）' : '折扣（应收 = 中转站消耗 × 折扣）'}</span><input id="pe-ratio" class="ctl" inputmode="decimal" value="${v.ratio}"></label>
      <label class="field"><span>外部系统编号</span><input id="pe-ext" class="ctl" maxlength="100" value="${esc(v.external_id)}"></label>
      <p class="form-error" id="pe-error" hidden></p>
      <button class="btn primary big" type="submit"><span>保存</span></button>
      <button class="btn ghost big" type="button" id="pe-archive">${v.archived ? '恢复' : '归档'}</button>
      <button class="btn ghost danger big" type="button" id="pe-delete">删除${L.name}及全部往来记录</button>
    </form>`;
  $$('[data-close]', partyPanel).forEach((b) => b.addEventListener('click', () => closeSheet(sheetParty)));
  $('#form-party-edit').addEventListener('submit', async (e) => {
    e.preventDefault(); const err = $('#pe-error');
    const ratio = $('#pe-ratio') ? Number($('#pe-ratio').value) : undefined;
    if ($('#pe-ratio') && !(ratio > 0)) return showErr(err, '倍率必须大于 0');
    try { await api('PATCH', `/api/parties/${v.id}`, { name: $('#pe-name').value, contact: $('#pe-contact').value, note: $('#pe-note').value, currency: $('#pe-currency').value, external_id: $('#pe-ext').value, ratio }); delete state.relayLive[v.project_id]; toast('已保存'); openParty(v.id); refresh(); } catch (ex) { showErr(err, ex.message); }
  });
  $('#pe-archive').addEventListener('click', async () => { try { await api('PATCH', `/api/parties/${v.id}`, { archived: !v.archived }); toast(v.archived ? '已恢复' : '已归档'); openParty(v.id); refresh(); } catch (ex) { showErr($('#pe-error'), ex.message); } });
  $('#pe-delete').addEventListener('click', async () => { if (!confirm(`删除${L.name}「${v.name}」及其全部往来记录？不可恢复（已入流水的记录不会删除）。`)) return; try { await api('DELETE', `/api/parties/${v.id}`); toast('已删除'); closeSheet(sheetParty); refresh(); } catch (ex) { showErr($('#pe-error'), ex.message); } });
}

// ---------------------------------------------------------------- 我的
function renderMe() {
  const u = state.user, r = state.rates;
  const joined = new Date(u.created_at);
  $('#view-me').innerHTML = `
    <header class="page-head"><div><h1>我的</h1></div></header>
    <div class="stack">
      <div class="card me-card">${avatar(u.username, 'lg')}<div><div class="big">${esc(u.username)}</div><div class="muted" style="font-size:13px">${esc(u.phone)} · ${joined.getFullYear()}年${joined.getMonth() + 1}月加入</div></div></div>
      <section class="card">
        <h2>汇率设置</h2>
        <p class="muted">这里是「当前汇率」：记外币账时自动填入，可在记账时单独改。每笔记录都保存自己当时的汇率，之后改这里不影响已记的账。</p>
        <form id="form-rates" class="rates" novalidate>
          <label class="field"><span>1 USD =</span><div class="inline"><input id="rate-USD" class="ctl" inputmode="decimal" value="${r.USD}"><b>CNY</b></div></label>
          <label class="field"><span>1 USDT =</span><div class="inline"><input id="rate-USDT" class="ctl" inputmode="decimal" value="${r.USDT}"><b>CNY</b></div></label>
          <p class="form-error" id="rates-error" hidden></p>
          <button class="btn primary" type="submit"><span>保存汇率</span></button>
        </form>
      </section>
      <section class="card">
        <h2>AI 财务报表</h2>
        <p class="muted">${state.ai.configured ? `已接入 <code>${esc(state.ai.model)}</code>。报表页可一键生成财务分析，并随数据变动自动更新。` : '未配置 AI 接口：在服务器的 <code>.env</code> 中设置 <code>ANTHROPIC_AUTH_TOKEN</code> 后重启即可启用。'}${state.ai.relay ? `<br>中转站已接入：<code>${esc(state.ai.relay.name)}</code>（${esc(state.ai.relay.base)}），在聊天里问"某某客户今天消耗多少 / 现在 RPM 多少 / 谁消耗最大"即可。` : ''}</p>
        <label class="field" style="margin-bottom:12px"><span>AI 模型（助手、财务报表、知识库整理共用）</span>
          <div class="inline"><select id="ai-model-select" class="ctl select" style="min-width:220px" ${state.ai.configured ? '' : 'disabled'}>${(state.ai.models || []).map((m) => `<option value="${esc(m.id)}" ${m.id === state.ai.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}${(state.ai.models || []).some((m) => m.id === state.ai.model) ? '' : `<option value="${esc(state.ai.model)}" selected>${esc(state.ai.model)}（自定义）</option>`}<option value="__custom">自定义模型名…</option></select></div></label>
        <label class="switch"><input type="checkbox" id="ai-auto-setting" ${state.ai.auto ? 'checked' : ''} ${state.ai.configured ? '' : 'disabled'}><span class="track"></span><span>数据变动后自动刷新最近看过的 AI 报表（约 1 分钟内）</span></label>
        <label class="switch" style="margin-top:10px"><input type="checkbox" id="ai-group-mention" ${state.ai.group_mode === 'mention' ? 'checked' : ''} ${state.ai.configured ? '' : 'disabled'}><span class="track"></span><span>群聊里只有 @AI 或带附件时才回复（关闭则每条消息都回应）</span></label>
      </section>
      <section class="card">
        <h2>每日自动导出</h2>
        <p class="muted">到点自动生成 Excel（含 AI 报表）和 Markdown，保存到报表页的「导出记录」，团队成员随时下载。</p>
        <form id="form-auto-export" class="rates" novalidate>
          <label class="switch"><input type="checkbox" id="ae-enabled" ${state.autoExport.enabled ? 'checked' : ''}><span class="track"></span><span>开启每日自动导出</span></label>
          <label class="field"><span>时间</span><div class="inline"><input id="ae-time" class="ctl" type="time" value="${esc(state.autoExport.time)}" style="width:150px"><b>每天（${esc(state.tz || 'Asia/Shanghai')}）</b></div></label>
          <label class="field"><span>范围</span><select id="ae-scope" class="ctl select"><option value="all" ${state.autoExport.scope === 'all' ? 'selected' : ''}>全部项目</option>${state.projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(state.autoExport.scope) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
          <label class="field"><span>区间</span><select id="ae-range" class="ctl select">${[['month', '本月'], ['last-month', '上月'], ['30d', '近 30 天'], ['all', '全部']].map(([k, l]) => `<option value="${k}" ${state.autoExport.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <p class="form-error" id="ae-error" hidden></p>
          <button class="btn primary" type="submit"><span>保存</span></button>
        </form>
      </section>
      <section class="card">
        <h2>对外接口</h2>
        <p class="muted">外部系统用这个令牌调用 <code>POST /api/integrations/records</code> 实时同步应收 / 应付（请求头 <code>X-API-Key</code>）。详见 README。</p>
        <div class="token-box"><code id="int-token">${esc(state.integrationToken || '')}</code><button class="btn ghost" type="button" id="int-copy">复制</button><button class="btn ghost danger" type="button" id="int-rotate">重置令牌</button></div>
      </section>
      <section class="card">
        <h2>外观</h2>
        <p class="muted">仅影响这台设备。</p>
        <div class="seg n3" id="theme-seg" style="--i:${['auto', 'light', 'dark'].indexOf(prefs.theme)}"><span class="thumb"></span>
          <button type="button" data-t="auto" class="${prefs.theme === 'auto' ? 'on' : ''}">跟随系统</button>
          <button type="button" data-t="light" class="${prefs.theme === 'light' ? 'on' : ''}">浅色</button>
          <button type="button" data-t="dark" class="${prefs.theme === 'dark' ? 'on' : ''}">深色</button>
        </div>
      </section>
      <section class="card">
        <h2>团队成员<span class="count">${state.members.length}</span></h2>
        <p class="muted">用同一个网址注册即可加入。</p>
        <ul class="mlist">${state.members.map((m) => `<li>${avatar(m.username)}<span>${esc(m.username)}${m.id === u.id ? ' <span class="tag">我</span>' : ''}</span><span class="muted">${esc(maskPhone(m.phone))}</span></li>`).join('')}</ul>
      </section>
      <button class="btn ghost danger big" id="logout">退出登录</button>
    </div>`;
  $('#form-rates').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target), err = $('#rates-error');
    const rates = { USD: Number($('#rate-USD').value), USDT: Number($('#rate-USDT').value) };
    if (!(rates.USD > 0) || !(rates.USDT > 0)) return showErr(err, '汇率必须是大于 0 的数字');
    err.hidden = true; setLoading(btn, true);
    try { const d = await api('PUT', '/api/settings', { rates }); state.rates = d.rates; toast('汇率已更新'); loadHome(); }
    catch (ex) { showErr(err, ex.message); }
    finally { setLoading(btn, false); }
  });
  $$('#theme-seg button').forEach((b) => b.addEventListener('click', () => { prefs.theme = b.dataset.t; savePrefs(); applyTheme(); renderMe(); }));
  $('#int-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.integrationToken || ''); toast('已复制'); } catch { toast('复制失败，请手动选择', 'err'); } });
  $('#int-rotate').addEventListener('click', async () => {
    if (!confirm('重置后旧令牌立即失效，外部系统需要改用新令牌。继续？')) return;
    try { const d = await api('PUT', '/api/settings', { rotate_token: true }); state.integrationToken = d.integration_token; renderMe(); toast('令牌已重置'); } catch (ex) { toast(ex.message, 'err'); }
  });
  $('#form-auto-export').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target), err = $('#ae-error');
    const auto_export = { enabled: $('#ae-enabled').checked, time: $('#ae-time').value, scope: $('#ae-scope').value, range: $('#ae-range').value };
    if (!auto_export.time) return showErr(err, '请选择时间');
    err.hidden = true; setLoading(btn, true);
    try { const d = await api('PUT', '/api/settings', { auto_export }); state.autoExport = d.auto_export; toast(d.auto_export.enabled ? `每天 ${d.auto_export.time} 自动导出` : '已关闭自动导出'); }
    catch (ex) { showErr(err, ex.message); }
    finally { setLoading(btn, false); }
  });
  $('#ai-model-select').addEventListener('change', async (e) => {
    let model = e.target.value;
    if (model === '__custom') { model = (prompt('输入模型名，例如 claude-opus-5', state.ai.model) || '').trim(); if (!model) { renderMe(); return; } }
    try { const d = await api('PUT', '/api/settings', { ai_model: model }); state.ai = d.ai; toast(`AI 模型已切换为 ${d.ai.model}`); renderMe(); }
    catch (ex) { toast(ex.message, 'err'); renderMe(); }
  });
  $('#ai-group-mention').addEventListener('change', async (e) => {
    try { const d = await api('PUT', '/api/settings', { group_ai: e.target.checked ? 'mention' : 'always' }); state.ai = d.ai; toast(e.target.checked ? '群聊仅 @AI 时回复' : '群聊每条都回复'); }
    catch (ex) { toast(ex.message, 'err'); e.target.checked = !e.target.checked; }
  });
  $('#ai-auto-setting').addEventListener('change', async (e) => {
    try { const d = await api('PUT', '/api/settings', { ai_auto: e.target.checked }); state.ai = d.ai; toast(d.ai.auto ? '已开启自动刷新' : '已关闭自动刷新'); }
    catch (ex) { toast(ex.message, 'err'); e.target.checked = !e.target.checked; }
  });
  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    disconnectEvents(); chatShutdown();
    state.user = null; state.projects = []; state.totals = null; state.project = null; state.report.data = null;
    location.hash = '#/'; showAuth();
  });
}

// ---------------------------------------------------------------- 弹层
function openSheet(el) { el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); document.body.classList.add('sheet-open'); }
function closeSheet(el) {
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
  if (el.id === 'sheet-party') { stopPartyTimer(); partyCtx.id = null; partyCtx.mode = null; }
  if (!$('.sheet.open')) document.body.classList.remove('sheet-open');
}
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.closest('.sheet'))));

// ---- 记一笔
const sheetEntry = $('#sheet-entry');
const entry = { type: 'expense', currency: 'CNY', project: null, handler: null, editing: null, defaultTime: '' };
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
async function openEntry(projectId) {
  if (!state.projects.length) await loadHome();
  const active = state.projects.filter((p) => !p.archived);
  if (!active.length) { toast('先创建一个项目'); openProjectSheet(); return; }
  entry.editing = null;
  entry.type = prefs.type; entry.currency = prefs.currency;
  entry.project = projectId || (state.view === 'project' && state.project ? state.project.project.id : null) || prefs.lastProject;
  if (!active.some((p) => p.id === entry.project)) entry.project = active[0].id;
  entry.handler = state.user.id;
  $('#amount').value = ''; $('#note').value = ''; $('#entry-error').hidden = true;
  entry.defaultTime = toLocalInput(new Date());
  $('#entry-time').value = entry.defaultTime; $('#entry-time').max = toLocalInput(new Date(Date.now() + 5 * 60000));
  entry.rate = null; $('#entry-rate').value = '';
  $('#entry-sheet-title').textContent = '记一笔';
  $('#entry-delete').hidden = true;
  renderEntryChips(); syncEntry();
  openSheet(sheetEntry);
  $('#amount').focus();
}
function openEntryEdit(e) {
  entry.editing = e;
  entry.type = e.type; entry.currency = e.currency; entry.project = e.project_id; entry.handler = e.handler_id;
  $('#amount').value = String(e.amount); $('#note').value = e.note || ''; $('#entry-error').hidden = true;
  entry.defaultTime = null;
  entry.rate = e.rate; $('#entry-rate').value = e.currency === 'CNY' ? '' : String(e.rate ?? '');
  $('#entry-time').value = toLocalInput(new Date(e.created_at)); $('#entry-time').max = toLocalInput(new Date(Date.now() + 5 * 60000));
  $('#entry-sheet-title').textContent = '修改记录';
  $('#entry-delete').hidden = false;
  renderEntryChips(); syncEntry();
  openSheet(sheetEntry);
}
$('#time-now').addEventListener('click', () => { $('#entry-time').value = toLocalInput(new Date()); $('#time-hint').textContent = '已设为现在'; });
$('#entry-time').addEventListener('input', () => { $('#time-hint').textContent = entry.defaultTime && $('#entry-time').value === entry.defaultTime ? '自动记录为现在，可修改' : '已手动指定时间'; });
$('#entry-delete').addEventListener('click', async () => {
  const e = entry.editing; if (!e) return;
  if (!confirm('删除这条记录？此操作不可撤销。')) return;
  try { await api('DELETE', `/api/entries/${e.id}`); closeSheet(sheetEntry); toast('已删除'); refresh(); }
  catch (ex) { showErr($('#entry-error'), ex.message); }
});
function renderEntryChips() {
  const active = state.projects.filter((p) => !p.archived || (entry.editing && p.id === entry.editing.project_id));
  $('#proj-chips').innerHTML = active.map((p) => `<button type="button" class="chip ${p.id === entry.project ? 'on' : ''}" data-p="${p.id}">${esc(p.name)}</button>`).join('');
  $('#handler-chips').innerHTML = state.members.map((m) => `<button type="button" class="chip ${m.id === entry.handler ? 'on' : ''}" data-h="${m.id}">${avatar(m.username, 'xs')}${esc(m.username)}${m.id === state.user.id ? '（我）' : ''}</button>`).join('');
  $$('#proj-chips .chip').forEach((b) => b.addEventListener('click', () => { entry.project = Number(b.dataset.p); pick('#proj-chips', b); }));
  $$('#handler-chips .chip').forEach((b) => b.addEventListener('click', () => { entry.handler = Number(b.dataset.h); pick('#handler-chips', b); }));
  revealChip($('#proj-chips .chip.on'), false);
}
function pick(container, b) { $$(`${container} .chip`).forEach((c) => c.classList.toggle('on', c === b)); revealChip(b, true); }
// 只滚动芯片所在的横向容器，不触发页面 / 弹层滚动
function revealChip(chip, smooth) {
  if (!chip) return;
  const box = chip.parentElement;
  box.scrollTo({ left: chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
}
function syncEntry() {
  const isExp = entry.type === 'expense';
  $('#type-seg').dataset.type = entry.type;
  $$('#type-seg button').forEach((b) => b.classList.toggle('on', b.dataset.type === entry.type));
  $$('#cur-chips .chip').forEach((b) => b.classList.toggle('on', b.dataset.cur === entry.currency));
  $('#amount-sym').textContent = CUR[entry.currency].sym;
  $('#rate-field').hidden = entry.currency === 'CNY';
  $('#rate-prefix').textContent = `1 ${entry.currency} =`;
  if (entry.currency !== 'CNY' && !$('#entry-rate').value) $('#entry-rate').value = String(entry.editing && entry.editing.currency === entry.currency && entry.editing.rate ? entry.editing.rate : state.rates[entry.currency]);
  $('#handler-label').textContent = isExp ? '谁付的' : '谁收的';
  $('#form-entry').classList.toggle('is-expense', isExp);
  $('#form-entry').classList.toggle('is-income', !isExp);
  const btn = $('#entry-submit');
  btn.classList.toggle('expense-fill', isExp); btn.classList.toggle('income-fill', !isExp);
  const v = parseAmount($('#amount').value);
  $('span', btn).textContent = `${entry.editing ? '保存' : '记录'}${isExp ? '支出' : '收入'}${v > 0 ? ` · ${CUR[entry.currency].sym}${fmt(v)} ${entry.currency}` : ''}`;
  $('#time-hint').textContent = entry.editing ? '修改后按新时间统计' : (entry.defaultTime && $('#entry-time').value === entry.defaultTime ? '自动记录为现在，可修改' : '已手动指定时间');
}
$$('#type-seg button').forEach((b) => b.addEventListener('click', () => { entry.type = b.dataset.type; syncEntry(); }));
$$('#cur-chips .chip').forEach((b) => b.addEventListener('click', () => { entry.currency = b.dataset.cur; $('#entry-rate').value = ''; syncEntry(); $('#amount').focus(); }));
$('#amount').addEventListener('input', syncEntry);
$('#form-entry').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#entry-error'), btn = $('#entry-submit');
  const amount = parseAmount($('#amount').value);
  if (!(amount > 0)) { showErr(err, '请输入正确的金额'); $('#amount').focus(); return; }
  const timeVal = $('#entry-time').value;
  let time;
  if (timeVal && (entry.editing || timeVal !== entry.defaultTime)) {
    const t = new Date(timeVal);
    if (Number.isNaN(t.getTime())) { showErr(err, '时间格式不正确'); return; }
    if (t.getTime() > Date.now() + 5 * 60000) { showErr(err, '时间不能晚于现在'); return; }
    time = t.toISOString();
  }
  let rate;
  if (entry.currency !== 'CNY') { rate = Number($('#entry-rate').value); if (!(rate > 0)) { showErr(err, '请填写这笔的汇率'); $('#entry-rate').focus(); return; } }
  err.hidden = true; setLoading(btn, true);
  const body = { type: entry.type, amount, currency: entry.currency, rate, handler_id: entry.handler, note: $('#note').value.trim(), time };
  try {
    if (entry.editing) {
      await api('PATCH', `/api/entries/${entry.editing.id}`, { ...body, project_id: entry.project });
      closeSheet(sheetEntry); toast('记录已更新');
    } else {
      await api('POST', `/api/projects/${entry.project}/entries`, body);
      prefs.type = entry.type; prefs.currency = entry.currency; prefs.lastProject = entry.project; savePrefs();
      closeSheet(sheetEntry);
      toast(`已记录${entry.type === 'expense' ? '支出' : '收入'} ${CUR[entry.currency].sym}${fmt(amount)} ${entry.currency}`, entry.type);
    }
    refresh();
  } catch (ex) { showErr(err, ex.message); }
  finally { setLoading(btn, false); }
});

// ---- 新建 / 编辑项目
const sheetProject = $('#sheet-project');
let editingProject = null;
function openProjectSheet(p = null) {
  editingProject = p;
  $('#project-sheet-title').textContent = p ? '编辑项目' : '新建项目';
  $('span', $('#project-submit')).textContent = p ? '保存' : '创建项目';
  $('#project-name').value = p ? p.name : '';
  $('#project-note').value = p ? p.note : '';
  $('#project-error').hidden = true;
  const arch = $('#project-archive');
  arch.hidden = !p;
  if (p) arch.textContent = p.archived ? '恢复项目' : '归档项目';
  const danger = $('#project-danger');
  danger.hidden = !p || p.created_by !== state.user.id;
  openSheet(sheetProject);
  $('#project-name').focus();
}
$('#form-project').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#project-error'), btn = $('#project-submit');
  const name = $('#project-name').value.trim(), note = $('#project-note').value.trim();
  if (!name) { showErr(err, '请填写项目名称'); return; }
  err.hidden = true; setLoading(btn, true);
  try {
    if (editingProject) {
      await api('PATCH', `/api/projects/${editingProject.id}`, { name, note });
      closeSheet(sheetProject); toast('项目已更新'); refresh();
    } else {
      const d = await api('POST', '/api/projects', { name, note });
      closeSheet(sheetProject); toast(`项目「${d.project.name}」已创建`);
      await loadHome();
      location.hash = `#/p/${d.project.id}`;
    }
  } catch (ex) { showErr(err, ex.message); }
  finally { setLoading(btn, false); }
});
$('#project-archive').addEventListener('click', async () => {
  if (!editingProject) return;
  const toArchive = !editingProject.archived;
  if (toArchive && !confirm(`归档「${editingProject.name}」？归档后不能再记账，但数据与统计都会保留。`)) return;
  try {
    await api('PATCH', `/api/projects/${editingProject.id}`, { archived: toArchive });
    closeSheet(sheetProject); toast(toArchive ? '项目已归档' : '项目已恢复');
    await loadHome();
    if (toArchive) location.hash = '#/'; else refresh();
  } catch (ex) { showErr($('#project-error'), ex.message); }
});

// 清空 / 删除项目：要手打项目名确认，删掉的数据立刻不再进入任何统计
async function dangerProject(action) {
  const p = editingProject;
  if (!p) return;
  const isDelete = action === 'delete';
  const tip = isDelete
    ? `删除项目「${p.name}」：它的全部流水、供应商 / 客户、往来记录、成员转账和项目群聊都会被删除，之后所有统计、报表、导出都不再包含这些数据。此操作不可恢复。`
    : `清空项目「${p.name}」的记录：删除它的全部流水、往来记录和成员转账（供应商 / 客户名单保留），之后所有统计都不再包含这些数据。此操作不可恢复。`;
  const typed = prompt(`${tip}\n\n确认请输入项目名称：${p.name}`);
  if (typed === null) return;
  if (typed.trim() !== p.name) { toast('名称不匹配，已取消', 'err'); return; }
  try {
    const d = isDelete ? await api('DELETE', `/api/projects/${p.id}`) : await api('POST', `/api/projects/${p.id}/clear`);
    const r = d.removed || {};
    closeSheet(sheetProject);
    toast(`${isDelete ? '已删除项目' : '已清空'}「${p.name}」：流水 ${r.entries || 0} 笔、往来 ${r.records || 0} 笔、转账 ${r.transfers || 0} 笔`);
    await loadHome();
    if (isDelete) { state.project = null; location.hash = '#/'; } else refresh();
  } catch (ex) { showErr($('#project-error'), ex.message); }
}
$('#project-clear').addEventListener('click', () => dangerProject('clear'));
$('#project-delete').addEventListener('click', () => dangerProject('delete'));

// ---------------------------------------------------------------- 实时同步
let es = null, esEverOpened = false, esConnected = false;
function connectEvents() {
  disconnectEvents();
  es = new EventSource('/api/events');
  es.onerror = () => { esConnected = false; };
  es.addEventListener('hello', (ev) => {
    esConnected = true;
    const d = JSON.parse(ev.data);
    checkBuild(d.build);
    if (esEverOpened) { refresh(); if (chat.open && chat.tab !== 'kb') loadChannel(chat.tab, true); } // 断线重连后补拉一次
    esEverOpened = true;
    if (d.running && d.running.includes(currentReportKey())) { state.ai.job = { key: currentReportKey(), content: '' }; renderAiCard(); }
  });
  es.addEventListener('changed', (ev) => {
    const d = JSON.parse(ev.data);
    if (d.byId !== state.user.id && d.text) toast(`${d.by} ${d.text}`);
    refresh();
  });
  es.addEventListener('members', () => api('GET', '/api/me').then((d) => { state.members = d.members; if (state.view === 'me') renderMe(); }).catch(() => {}));
  es.addEventListener('exports', (ev) => {
    const d = JSON.parse(ev.data);
    if (d.source === 'auto' && d.names.length) toast(`已自动导出：${d.names[0]}`);
    if (state.view === 'reports') loadExports();
  });
  for (const name of ['msg', 'ai', 'proposal', 'kb', 'channels']) es.addEventListener(name, (ev) => { const d = JSON.parse(ev.data); if (name === 'ai' && !d.channel) return onAiEvent(d); onChatEvent(name, d); });
  es.addEventListener('settings', (ev) => { const d = JSON.parse(ev.data); if (d.auto_export) { state.autoExport = d.auto_export; if (state.view === 'me') renderMe(); if (state.view === 'reports') renderExportsCard(); } });
}
function disconnectEvents() { if (es) { es.close(); es = null; } esConnected = false; }

// ---------------------------------------------------------------- 报表
const RANGES = [['month', '本月'], ['last-month', '上月'], ['30d', '近 30 天'], ['all', '全部'], ['custom', '自定义']];
const reportQuery = () => {
  const r = state.report;
  const qs = new URLSearchParams({ scope: r.scope, range: r.range });
  if (r.range === 'custom') { qs.set('from', r.from); qs.set('to', r.to); }
  return qs.toString();
};
const currentReportKey = () => { const r = state.report; return `${r.scope}:${r.range}${r.range === 'custom' ? `:${r.from}:${r.to}` : ''}`; };

async function openReports(query) {
  const qs = new URLSearchParams(query);
  const r = state.report;
  if (qs.get('scope')) r.scope = qs.get('scope');
  if (qs.get('range')) r.range = qs.get('range');
  if (qs.get('from')) r.from = qs.get('from');
  if (qs.get('to')) r.to = qs.get('to');
  showView('reports');
  if (!state.projects.length) await loadHome();
  renderReports();
  loadReport();
}
function setReportParams(patch) {
  Object.assign(state.report, patch);
  const r = state.report;
  if (r.range === 'custom' && !(r.from && r.to)) {
    const t = new Date(), y = t.getFullYear(), m = pad(t.getMonth() + 1);
    r.from = r.from || `${y}-${m}-01`; r.to = r.to || `${y}-${m}-${pad(t.getDate())}`;
  }
  history.replaceState(null, '', `#/reports?${reportQuery()}`);
  renderReports();
  loadReport();
}
let reportSeq = 0;
async function loadReport() {
  const r = state.report;
  if (r.range === 'custom' && !(r.from && r.to)) return;
  const seq = ++reportSeq;
  r.loading = true;
  $('#rep-body')?.classList.add('loading');
  try {
    const d = await api('GET', `/api/report?${reportQuery()}`);
    if (seq !== reportSeq) return;
    r.data = d; state.ai.configured = d.ai.configured; state.ai.model = d.ai.model; state.ai.auto = d.ai.auto;
    if (d.ai.status === 'running') state.ai.job = { key: d.ai.key, content: d.ai.content || '' };
    else state.ai.job = null;
    renderReportBody();
  } catch (e) {
    if (seq === reportSeq) { toast(e.message, 'err'); }
  } finally { if (seq === reportSeq) { r.loading = false; $('#rep-body')?.classList.remove('loading'); } }
}

function renderReports() {
  const r = state.report;
  const projects = state.projects;
  const el = $('#view-reports');
  const scopeOpts = [`<option value="all" ${r.scope === 'all' ? 'selected' : ''}>全部项目</option>`]
    .concat(projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(r.scope) ? 'selected' : ''}>${esc(p.name)}${p.archived ? '（已归档）' : ''}</option>`)).join('');
  const ri = RANGES.findIndex(([k]) => k === r.range);
  el.innerHTML = `
    <header class="page-head">
      <div><h1>报表</h1><p class="eyebrow" id="rep-sub">&nbsp;</p></div>
      <div class="head-actions"><a class="btn ghost" id="rep-xlsx" href="/api/export.xlsx?${reportQuery()}" download>${ICO('download')}<span class="hide-sm">导出 </span>Excel</a></div>
    </header>
    <div class="filters">
      <select id="rep-scope" class="ctl select">${scopeOpts}</select>
      <div class="seg mini n5" id="rep-range" style="--i:${ri}"><span class="thumb"></span>${RANGES.map(([k, l]) => `<button type="button" data-r="${k}" class="${k === r.range ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="daterange" id="rep-dates" ${r.range === 'custom' ? '' : 'hidden'}>
        <input type="date" id="rep-from" class="ctl" value="${esc(r.from)}"><span>至</span><input type="date" id="rep-to" class="ctl" value="${esc(r.to)}">
      </div>
    </div>
    <div id="rep-body">${r.data ? '' : '<div class="skel"><i style="height:92px"></i><i style="height:260px"></i><i style="height:200px"></i></div>'}</div>`;
  $('#rep-scope').addEventListener('change', (e) => setReportParams({ scope: e.target.value }));
  $$('#rep-range button').forEach((b) => b.addEventListener('click', () => setReportParams({ range: b.dataset.r })));
  const onDate = () => { const f = $('#rep-from').value, t = $('#rep-to').value; if (f && t) setReportParams({ from: f, to: t }); };
  $('#rep-from').addEventListener('change', onDate);
  $('#rep-to').addEventListener('change', onDate);
  if (r.data) renderReportBody();
}

function deltaPill(cur, prev, kind) {
  if (!prev && !cur) return '<span class="delta flat">上期无数据</span>';
  const diff = r2c(cur - prev);
  if (kind === 'pct' && prev > 0) {
    const pct = (diff / prev) * 100;
    return `<span class="delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}% 较上期</span>`;
  }
  return `<span class="delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}¥${fmt(diff)} 较上期</span>`;
}
const r2c = (n) => Math.round(n * 100) / 100;
function fmtCompact(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(a >= 1e9 ? 0 : 1)}亿`;
  if (a >= 1e4) return `${s}${(a / 1e4).toFixed(a >= 1e5 ? 0 : 1)}万`;
  return `${s}${nf0.format(a)}`;
}
const mdLabel = (key) => { const [, m, d] = key.split('-').map(Number); return `${m}/${d}`; };

function renderReportBody() {
  const d = state.report.data;
  if (!d) return;
  const k = d.kpis, p = d.prev;
  $('#rep-sub').textContent = `${d.project ? d.project.name : '全部项目（含已归档）'} · ${d.from} 至 ${d.to} · ${d.days} 天 · ${d.entryCount} 笔`;
  $('#rep-xlsx').href = `/api/export.xlsx?${reportQuery()}`;
  const activeDays = d.daily.filter((x) => x.count).slice().reverse();
  const last = d.daily[d.daily.length - 1];
  $('#rep-body').innerHTML = `
    <div class="kpis">
      <div class="kpi income"><div class="label">收入</div><div class="num">${money(k.income.base)}</div><div class="sub">${deltaPill(k.income.base, p.income.base, 'pct')}</div></div>
      <div class="kpi expense"><div class="label">支出</div><div class="num">${money(k.expense.base)}</div><div class="sub">${deltaPill(k.expense.base, p.expense.base, 'pct')}</div></div>
      <div class="kpi profit ${k.profit < 0 ? 'neg' : 'pos'}"><div class="label">利润</div><div class="num">${signed(k.profit)}</div><div class="sub">${deltaPill(k.profit, p.profit, 'abs')}</div></div>
    </div>
    <div class="charts">
      <section class="card chart-card">
        <div class="chart-head"><div><h2>利润增长曲线</h2><p class="muted">累计利润（¥），按日</p></div><div class="chart-kpi"><span class="label">期末累计</span><b class="${last && last.cumulative < 0 ? 'expense' : ''}">${last ? signed(last.cumulative) : '—'}</b></div></div>
        <div class="chart-wrap" id="chart-profit"></div>
      </section>
      <section class="card chart-card">
        <div class="chart-head"><div><h2>每日收支</h2><p class="muted">折算为人民币</p></div>
          <div class="legend"><span><i class="sw income"></i>收入</span><span><i class="sw expense"></i>支出</span></div></div>
        <div class="chart-wrap" id="chart-daily"></div>
      </section>
    </div>
    <section class="card tbl-card">
      <div class="section-head" style="margin:0 0 10px"><h2>每日账单<span class="count">${activeDays.length}</span></h2><span class="muted" style="font-size:12px">有记录的日期</span></div>
      ${activeDays.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th class="r">收入</th><th class="r">支出</th><th class="r">利润</th><th class="r">累计利润</th><th class="r">笔数</th></tr></thead><tbody>
        ${activeDays.map((x) => `<tr><td>${x.date}</td><td class="r income">${x.income ? money(x.income) : '<span class="muted">—</span>'}</td><td class="r expense">${x.expense ? money(x.expense) : '<span class="muted">—</span>'}</td><td class="r ${x.profit < 0 ? 'expense' : ''}">${signed(x.profit)}</td><td class="r ${x.cumulative < 0 ? 'expense' : ''}">${signed(x.cumulative)}</td><td class="r">${x.count}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted" style="font-size:13px">这个区间还没有记录</p>'}
    </section>
    <div class="charts">
      ${d.project ? '' : `<section class="card tbl-card"><div class="section-head" style="margin:0 0 10px"><h2>按项目</h2></div>
        ${d.byProject.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>项目</th><th class="r">收入</th><th class="r">支出</th><th class="r">利润</th><th class="r">笔数</th></tr></thead><tbody>
        ${d.byProject.map((x) => `<tr><td><a href="#/reports?scope=${x.id}&range=${d.range}${d.range === 'custom' ? `&from=${d.from}&to=${d.to}` : ''}" class="tlink">${esc(x.name)}</a>${x.archived ? ' <span class="tag">已归档</span>' : ''}</td><td class="r income">${money(x.income)}</td><td class="r expense">${money(x.expense)}</td><td class="r ${x.profit < 0 ? 'expense' : ''}"><b>${signed(x.profit)}</b></td><td class="r">${x.count}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted" style="font-size:13px">暂无数据</p>'}</section>`}
      <section class="card tbl-card"><div class="section-head" style="margin:0 0 10px"><h2>按成员</h2><span class="muted" style="font-size:12px">按经手人</span></div>
        ${d.byMember.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>成员</th><th class="r">支出</th><th class="r">收款</th><th class="r">笔数</th></tr></thead><tbody>
        ${d.byMember.map((x) => `<tr><td><span class="cell-avatar">${avatar(x.name, 'xs')}${esc(x.name)}</span></td><td class="r expense">${x.expense ? money(x.expense) : '<span class="muted">—</span>'}</td><td class="r income">${x.income ? money(x.income) : '<span class="muted">—</span>'}</td><td class="r">${x.count}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted" style="font-size:13px">暂无数据</p>'}</section>
    </div>
    <section class="card" id="analysis-card"></section>
    <section class="card ai-card" id="ai-card"></section>
    <section class="card exports-card" id="exports-card"></section>`;
  renderAnalysis();
  drawProfitChart($('#chart-profit'), d.daily);
  drawDailyChart($('#chart-daily'), d.daily);
  renderAiCard();
  renderExportsCard();
  loadExports();
}
// ---- 项目分析（用途 / 成员 / 币种 / 大额 / 月度）
const ANALYSIS_VIEWS = [['note', '支出用途'], ['member', '成员占比'], ['currency', '币种构成'], ['top', '大额记录'], ['monthly', '月度趋势']];
function hbars(items, { total, cls = '', valueOf, labelOf, subOf }) {
  if (!items.length) return '<p class="muted" style="font-size:13px">暂无数据</p>';
  const max = Math.max(...items.map(valueOf), 1);
  return `<div class="hbars">${items.map((x) => { const v = valueOf(x); return `<div class="hbar ${cls}"><span class="hl" title="${esc(labelOf(x))}">${esc(labelOf(x))}</span><span class="ht"><span class="hf" style="width:${Math.max(1, (v / max) * 100).toFixed(1)}%"></span></span><span class="hv">${money(v)}<small>${total ? `${((v / total) * 100).toFixed(1)}%` : ''}${subOf ? ` · ${esc(subOf(x))}` : ''}</small></span></div>`; }).join('')}</div>`;
}
function renderAnalysis() {
  const card = $('#analysis-card'), d = state.report.data;
  if (!card || !d) return;
  const an = d.analysis || { byNote: { expense: [], income: [] }, byCurrency: [], top: { expense: [], income: [] }, monthly: [] };
  const isProject = !!d.project;
  const views = isProject ? ANALYSIS_VIEWS : ANALYSIS_VIEWS.filter(([k]) => k === 'monthly' || k === 'currency' || k === 'top');
  if (!views.some(([k]) => k === state.report.view)) state.report.view = views[0][0];
  const vi = views.findIndex(([k]) => k === state.report.view);
  const k = d.kpis;
  let body = '';
  switch (state.report.view) {
    case 'note':
      body = `<div class="analysis"><div><h4 class="sub-h">支出用途 Top ${an.byNote.expense.length}<span class="muted"> · 按备注归类，占支出 ${money(k.expense.base)}</span></h4>${hbars(an.byNote.expense, { total: k.expense.base, valueOf: (x) => x.cny, labelOf: (x) => x.note, subOf: (x) => `${x.count} 笔` })}</div>
        ${an.byNote.income.length ? `<div><h4 class="sub-h">收入来源<span class="muted"> · 占收入 ${money(k.income.base)}</span></h4>${hbars(an.byNote.income, { total: k.income.base, cls: 'income', valueOf: (x) => x.cny, labelOf: (x) => x.note, subOf: (x) => `${x.count} 笔` })}</div>` : ''}</div>`;
      break;
    case 'member':
      body = `<div class="analysis"><div><h4 class="sub-h">成员支出占比</h4>${hbars(d.byMember.filter((m) => m.expense), { total: k.expense.base, valueOf: (x) => x.expense, labelOf: (x) => x.name, subOf: (x) => `${x.count} 笔` })}</div>
        <div><h4 class="sub-h">成员收款占比</h4>${hbars(d.byMember.filter((m) => m.income), { total: k.income.base, cls: 'income', valueOf: (x) => x.income, labelOf: (x) => x.name })}</div></div>`;
      break;
    case 'currency':
      body = an.byCurrency.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>币种</th><th class="r">收入（原币）</th><th class="r">折合 ¥</th><th class="r">支出（原币）</th><th class="r">折合 ¥</th><th class="r">笔数</th></tr></thead><tbody>
        ${an.byCurrency.map((c) => `<tr><td><b>${c.currency}</b></td><td class="r income">${c.income ? `${CUR[c.currency].sym}${fmt(c.income)}` : '<span class="muted">—</span>'}</td><td class="r">${c.incomeCny ? money(c.incomeCny) : '<span class="muted">—</span>'}</td><td class="r expense">${c.expense ? `${CUR[c.currency].sym}${fmt(c.expense)}` : '<span class="muted">—</span>'}</td><td class="r">${c.expenseCny ? money(c.expenseCny) : '<span class="muted">—</span>'}</td><td class="r">${c.count}</td></tr>`).join('')}
        </tbody></table></div><p class="muted" style="font-size:12px;margin-top:8px">折合人民币按每笔记账时的汇率</p>` : '<p class="muted" style="font-size:13px">暂无数据</p>';
      break;
    case 'top': {
      const row = (e, cls) => `<tr><td>${e.time}</td>${isProject ? '' : `<td>${esc(e.project)}</td>`}<td class="r ${cls}"><b>${CUR[e.currency].sym}${fmt(e.amount)}</b> <span class="muted" style="font-size:11px">${e.currency}${e.currency !== 'CNY' ? ` @${e.rate}` : ''}</span></td><td class="r">${money(e.cny)}</td><td>${esc(e.handler)}</td><td>${esc(e.note) || '<span class="muted">—</span>'}</td></tr>`;
      const head = `<tr><th>时间</th>${isProject ? '' : '<th>项目</th>'}<th class="r">金额</th><th class="r">折合 ¥</th><th>经手人</th><th>备注</th></tr>`;
      body = `<div class="analysis"><div><h4 class="sub-h">大额支出 Top ${an.top.expense.length}</h4>${an.top.expense.length ? `<div class="tbl-wrap"><table class="tbl"><thead>${head}</thead><tbody>${an.top.expense.map((e) => row(e, 'expense')).join('')}</tbody></table></div>` : '<p class="muted" style="font-size:13px">暂无</p>'}</div>
        ${an.top.income.length ? `<div><h4 class="sub-h">大额收入 Top ${an.top.income.length}</h4><div class="tbl-wrap"><table class="tbl"><thead>${head}</thead><tbody>${an.top.income.map((e) => row(e, 'income')).join('')}</tbody></table></div></div>` : ''}</div>`;
      break;
    }
    case 'monthly':
      body = an.monthly.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>月份</th><th class="r">收入</th><th class="r">支出</th><th class="r">利润</th><th class="r">笔数</th></tr></thead><tbody>
        ${an.monthly.map((m) => `<tr><td>${m.month}</td><td class="r income">${money(m.income)}</td><td class="r expense">${money(m.expense)}</td><td class="r ${m.profit < 0 ? 'expense' : ''}"><b>${signed(m.profit)}</b></td><td class="r">${m.count}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted" style="font-size:13px">暂无数据</p>';
      break;
  }
  card.innerHTML = `<div class="section-head" style="margin:0 0 12px"><h2>${isProject ? `${esc(d.project.name)} · 项目分析` : '分析'}</h2>
    <div class="seg mini n${views.length}" id="analysis-seg" style="--i:${vi}"><span class="thumb"></span>${views.map(([key, l]) => `<button type="button" data-v="${key}" class="${key === state.report.view ? 'on' : ''}">${l}</button>`).join('')}</div></div>${body}`;
  $$('#analysis-seg button').forEach((b) => b.addEventListener('click', () => { state.report.view = b.dataset.v; renderAnalysis(); }));
}
window.addEventListener('resize', (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { if (state.view === 'reports' && state.report.data) { drawProfitChart($('#chart-profit'), state.report.data.daily); drawDailyChart($('#chart-daily'), state.report.data.daily); } }, 150); }; })());

// ---------------------------------------------------------------- 图表（SVG）
function niceTicks(lo, hi, n = 4) {
  if (lo === hi) { hi = lo + 1; }
  const span = hi - lo, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(r2c(v));
  return ticks;
}
// 横轴日期标签：均匀取样，末尾日期尽量保留
function xLabelIndexes(n, width) {
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 70))));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (n > 1 && n - 1 - idx[idx.length - 1] >= step / 2) idx.push(n - 1);
  else if (n > 1) idx[idx.length - 1] = n - 1;
  return idx;
}
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
function chartTip(wrap) {
  let tip = wrap.querySelector('.chart-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; wrap.appendChild(tip); }
  return tip;
}
function showTip(tip, wrap, x, title, rows) {
  const head = document.createElement('div'); head.className = 'tip-title'; head.textContent = title;
  tip.replaceChildren(head, ...rows.map(([label, value, cls]) => {
    const row = document.createElement('div'); row.className = 'tip-row';
    const b = document.createElement('b'); b.textContent = value; if (cls) b.className = cls;
    const s = document.createElement('span'); s.textContent = label;
    row.append(b, s); return row;
  }));
  tip.hidden = false;
  const w = wrap.clientWidth, tw = tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(w - tw, x - tw / 2))}px`;
}

function drawProfitChart(wrap, daily) {
  if (!wrap) return;
  wrap.replaceChildren();
  const W = Math.max(280, wrap.clientWidth), H = 240, L = 52, R = 18, T = 14, B = 28;
  const n = daily.length;
  const vals = daily.map((d) => d.cumulative);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': '累计利润曲线' });
  for (const t of ticks) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? 'grid zero' : 'grid' }));
    const lb = svgEl('text', { x: L - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }); lb.textContent = fmtCompact(t); svg.append(lb);
  }
  for (const i of xLabelIndexes(n, W - L - R)) { const lb = svgEl('text', { x: x(i), y: H - 8, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }); lb.textContent = mdLabel(daily[i].date); svg.append(lb); }
  const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(d.cumulative).toFixed(1)}`);
  if (n > 1) {
    svg.append(svgEl('path', { d: `M${pts.join('L')}L${x(n - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`, class: 'area' }));
    svg.append(svgEl('path', { d: `M${pts.join('L')}`, class: 'line' }));
  }
  const lastI = n - 1;
  svg.append(svgEl('circle', { cx: x(lastI), cy: y(daily[lastI].cumulative), r: 5, class: 'dot end' }));
  const cross = svgEl('line', { x1: 0, x2: 0, y1: T, y2: H - B, class: 'cross' }); cross.style.display = 'none';
  const dot = svgEl('circle', { r: 5, class: 'dot' }); dot.style.display = 'none';
  svg.append(cross, dot);
  const hit = svgEl('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' });
  svg.append(hit);
  wrap.append(svg);
  const tip = chartTip(wrap);
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) * (W / rect.width);
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    const d = daily[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(d.cumulative)); dot.style.display = '';
    showTip(tip, wrap, x(i) * (rect.width / W), d.date, [
      ['累计利润', signed(d.cumulative), d.cumulative < 0 ? 'expense' : ''],
      ...(d.count ? [['当日收入', money(d.income), 'income'], ['当日支出', money(d.expense), 'expense']] : [['当日', '无记录', '']]),
    ]);
  };
  hit.addEventListener('pointermove', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; dot.style.display = 'none'; tip.hidden = true; });
}

function drawDailyChart(wrap, daily) {
  if (!wrap) return;
  wrap.replaceChildren();
  const W = Math.max(280, wrap.clientWidth), H = 220, L = 52, R = 18, T = 14, B = 28;
  const n = daily.length;
  const maxV = Math.max(1, ...daily.map((d) => Math.max(d.income, d.expense)));
  const ticks = niceTicks(0, maxV, 4);
  const hi = ticks[ticks.length - 1];
  const slot = (W - L - R) / n;
  const bw = Math.max(1.5, Math.min(24, (slot - 4) / 2 - 1));
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  const base = y(0);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': '每日收支' });
  for (const t of ticks) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? 'grid zero' : 'grid' }));
    const lb = svgEl('text', { x: L - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }); lb.textContent = fmtCompact(t); svg.append(lb);
  }
  for (const i of xLabelIndexes(n, W - L - R)) { const lb = svgEl('text', { x: L + slot * i + slot / 2, y: H - 8, class: 'tick', 'text-anchor': 'middle' }); lb.textContent = mdLabel(daily[i].date); svg.append(lb); }
  const bar = (cx, v, cls) => {
    const h = base - y(v);
    if (h <= 0) return null;
    const r = Math.min(4, h, bw / 2), x0 = cx - bw / 2;
    const d = `M${x0},${base}V${base - h + r}a${r},${r} 0 0 1 ${r},-${r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${base}Z`;
    return svgEl('path', { d, class: `bar ${cls}` });
  };
  const groups = daily.map((d, i) => {
    const g = svgEl('g', { class: 'day' });
    const cx = L + slot * i + slot / 2;
    const bi = bar(cx - bw / 2 - 1, d.income, 'income'), be = bar(cx + bw / 2 + 1, d.expense, 'expense');
    if (bi) g.append(bi); if (be) g.append(be);
    const hit = svgEl('rect', { x: L + slot * i, y: T, width: slot, height: H - T - B, fill: 'transparent' });
    g.append(hit);
    svg.append(g);
    return { g, hit, cx, d };
  });
  wrap.append(svg);
  const tip = chartTip(wrap);
  for (const { g, hit, cx, d } of groups) {
    hit.addEventListener('pointerenter', () => {
      groups.forEach((o) => o.g.classList.toggle('dim', o.g !== g));
      const rect = svg.getBoundingClientRect();
      showTip(tip, wrap, cx * (rect.width / W), `${d.date} · ${d.count ? `${d.count} 笔` : '无记录'}`, [
        ['收入', money(d.income), 'income'], ['支出', money(d.expense), 'expense'], ['当日利润', signed(d.profit), d.profit < 0 ? 'expense' : ''],
      ]);
    });
  }
  svg.addEventListener('pointerleave', () => { groups.forEach((o) => o.g.classList.remove('dim')); tip.hidden = true; });
}

// ---------------------------------------------------------------- Markdown（够用的小渲染器）
function md(src) {
  const lines = String(src || '').split(/\r?\n/);
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" ${u.startsWith('/') ? 'download' : 'target="_blank" rel="noopener"'}>${t}</a>`);
  const isList = (l) => /^\s*([-*•]|\d+[.、])\s+/.test(l);
  let html = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { const n = Math.min(h[1].length + 1, 4); html += `<h${n}>${inline(h[2])}</h${n}>`; i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(1).filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map(cells);
      const numeric = (c) => !c || c === '—' || c === '-' || /^[−\-+]?[¥$₮]?[\d,]+(\.\d+)?%?$/.test(c.replace(/\s/g, ''));
      const numCol = head.map((_, ci) => body.length > 0 && body.every((r) => numeric(r[ci] || '')) && body.some((r) => /\d/.test(r[ci] || '')));
      html += `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((c, ci) => `<th class="${numCol[ci] ? 'r' : ''}">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, ci) => `<td class="${numCol[ci] ? 'r' : ''}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if (isList(l)) {
      const ordered = /^\s*\d+[.、]/.test(l); const items = [];
      while (i < lines.length && isList(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.、])\s+/, ''));
      html += `<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(l)) { html += '<hr>'; i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,4}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !isList(lines[i])) para.push(lines[i++]);
    html += `<p>${inline(para.join(' '))}</p>`;
  }
  return html;
}

// ---------------------------------------------------------------- AI 财务报表卡片
let aiRenderPending = false;
function onAiEvent(d) {
  const key = currentReportKey();
  if (d.key !== key) return;
  if (d.status === 'running') {
    if (!state.ai.job || state.ai.job.key !== key) state.ai.job = { key, content: '' };
    if (d.delta) state.ai.job.content += d.delta;
    if (!aiRenderPending) { aiRenderPending = true; requestAnimationFrame(() => { aiRenderPending = false; renderAiCard(true); }); }
  } else if (d.status === 'done') {
    state.ai.job = null;
    if (state.report.data) Object.assign(state.report.data.ai, { status: 'done', content: d.content, generated_at: d.generated_at, model: d.model, stale: false, error: '' });
    renderAiCard();
    if (state.view === 'reports') toast('AI 财务报表已更新');
  } else if (d.status === 'error') {
    state.ai.job = null;
    if (state.report.data) Object.assign(state.report.data.ai, { status: state.report.data.ai.content ? state.report.data.ai.status : 'error', error: d.error });
    renderAiCard();
  }
}
function renderAiCard(streaming = false) {
  const card = $('#ai-card');
  const d = state.report.data;
  if (!card || !d) return;
  const ai = d.ai, job = state.ai.job && state.ai.job.key === ai.key ? state.ai.job : null;
  const configured = state.ai.configured;
  const content = job ? job.content : ai.content;
  let status = '';
  if (!configured) status = '<span class="ai-dot off"></span>未配置 AI 接口（在服务器 .env 中设置 ANTHROPIC_AUTH_TOKEN 后重启）';
  else if (job) status = '<span class="ai-dot live"></span>AI 正在撰写报表…';
  else if (ai.status === 'done' && ai.stale) status = `<span class="ai-dot warn"></span>数据已变化 · ${state.ai.auto ? '约 1 分钟内自动刷新' : '点击"重新生成"'}`;
  else if (ai.status === 'done') status = `<span class="ai-dot ok"></span>基于当前数据 · 生成于 ${new Date(ai.generated_at).toLocaleString('zh-CN', { hour12: false })}`;
  else if (ai.status === 'error') status = `<span class="ai-dot err"></span>${esc(ai.error || '生成失败')}`;
  else status = '<span class="ai-dot off"></span>还没有生成过这个范围的报表';
  if (streaming && card.dataset.ready === '1') {
    $('.ai-status', card).innerHTML = status;
    $('.ai-body', card).innerHTML = md(content) + '<span class="caret"></span>';
    return;
  }
  card.dataset.ready = '1';
  card.innerHTML = `
    <div class="section-head" style="margin:0 0 6px">
      <h2>AI 财务报表 ${configured ? `<span class="tag">${esc(state.ai.model)}</span>` : ''}</h2>
      <div class="head-actions">
        ${ai.status === 'done' && ai.content ? `<a class="btn ghost" href="/api/report/ai.md?${reportQuery()}" download>${ICO('download')}<span class="hide-sm">导出 </span>Markdown</a>` : ''}
        ${configured ? `<button class="btn ${ai.status === 'done' && !ai.stale ? 'ghost' : 'primary'}" id="ai-gen" ${job ? 'disabled' : ''}>${job ? '生成中…' : ai.status === 'done' ? '重新生成' : '生成报表'}</button>` : ''}
      </div>
    </div>
    <p class="ai-status">${status}</p>
    ${content ? `<div class="ai-body md">${md(content)}${job ? '<span class="caret"></span>' : ''}</div>` : (configured ? '<p class="muted ai-empty">点击"生成报表"，AI 会根据当前区间的收支、趋势、项目与成员数据撰写一份财务分析；数据变动后可自动更新，也可一键导出。</p>' : '')}`;
  $('#ai-gen')?.addEventListener('click', async () => {
    const btn = $('#ai-gen'); setLoading(btn, true);
    try {
      const r = await api('POST', '/api/report/ai', { scope: state.report.scope, range: state.report.range, from: state.report.from, to: state.report.to, force: ai.status === 'done' && !ai.stale });
      if (r.status === 'done') { toast('报表已是最新'); loadReport(); }
      else { state.ai.job = { key: ai.key, content: '' }; renderAiCard(); }
    } catch (e) { toast(e.message, 'err'); setLoading(btn, false); }
  });
}

// ---------------------------------------------------------------- 导出记录
async function loadExports() {
  try { const d = await api('GET', '/api/exports'); state.exports = d.exports; state.autoExport = d.auto_export; renderExportsCard(); }
  catch {}
}
const SOURCE_LABEL = { manual: '手动', auto: '自动', ai: 'AI 助手' };
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function renderExportsCard() {
  const card = $('#exports-card');
  if (!card) return;
  const a = state.autoExport;
  const scopeName = a.scope === 'all' ? '全部项目' : (state.projects.find((p) => String(p.id) === String(a.scope)) || {}).name || `项目 ${a.scope}`;
  card.innerHTML = `
    <div class="section-head" style="margin:0 0 6px"><h2>导出记录<span class="count">${state.exports.length}</span></h2>
      <div class="head-actions"><button class="btn ghost" id="exp-archive">${ICO('download')}存一份到记录</button></div></div>
    <p class="ai-status"><span class="ai-dot ${a.enabled ? 'ok' : 'off'}"></span>${a.enabled ? `每天 ${esc(a.time)} 自动导出「${esc(scopeName)} · ${RANGES.find(([k]) => k === a.range)?.[1] || a.range}」的 Excel 与 AI 报表` : '未开启自动导出'} · <a href="#/me" class="tlink">去设置</a></p>
    ${state.exports.length ? `<ul class="exp-list">${state.exports.map((x) => `<li>
      <span class="exp-fmt ${x.format}">${x.format === 'md' ? 'MD' : 'XLS'}</span>
      <a class="exp-name" href="${x.url}" download>${esc(x.name)}</a>
      <span class="exp-meta">${SOURCE_LABEL[x.source] || x.source}${x.creator_name ? ` · ${esc(x.creator_name)}` : ''} · ${relTime(x.created_at)} · ${fmtSize(x.size)}</span>
      <button class="icon-btn exp-del" data-exp="${x.id}" title="删除" aria-label="删除">${ICO('trash')}</button></li>`).join('')}</ul>`
      : '<p class="muted" style="font-size:13px">还没有导出记录。右上角「导出 Excel」是直接下载；这里保存的是留档文件，也可以让 AI 助手帮你导出。</p>'}`;
  $('#exp-archive').addEventListener('click', async () => {
    const btn = $('#exp-archive'); setLoading(btn, true);
    try { await api('POST', '/api/exports', { scope: state.report.scope, range: state.report.range, from: state.report.from, to: state.report.to, format: 'both' }); toast('已保存到导出记录'); }
    catch (e) { toast(e.message, 'err'); }
    finally { setLoading(btn, false); }
  });
  $$('.exp-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('删除这个导出文件？')) return;
    try { await api('DELETE', `/api/exports/${b.dataset.exp}`); } catch (e) { toast(e.message, 'err'); }
  }));
}

// ---------------------------------------------------------------- AI 助手：团队群 / 项目群 / 私聊 / 知识库
// 会话 key：'group' 团队群、'project:<id>' 项目群、'dm' 私聊、'kb' 知识库
const chat = { open: false, tab: 'group', ch: {}, channels: [], pending: [], kb: null, uploading: 0 };
const chatEl = $('#chat'), chatBody = $('#chat-body'), chatInput = $('#chat-input'), chatFab = $('#ai-fab'), chanSel = $('#chat-channel');
const chanKey = (channel) => (String(channel).startsWith('dm:') ? 'dm' : channel);
const chanState = (key) => (chat.ch[key] = chat.ch[key] || { messages: [], loaded: false, busy: false, unread: 0 });
const chanName = (key) => (key === 'group' ? '团队群' : key === 'dm' ? '私聊' : key === 'kb' ? '知识库' : (chat.channels.find((c) => c.key === key) || {}).name || '项目群');
function chatBoot() {
  chatFab.hidden = false;
  chat.ch = {}; chat.channels = []; chat.pending = [];
  try { chat.tab = localStorage.getItem('hz:chat-tab') || 'group'; } catch {}
  loadChannels().then(() => { if (!chat.open) loadChannel('group', true); });
}
function chatShutdown() { closeChat(); chatFab.hidden = true; stopVoice({ discard: true }); }
function totalUnread() { return Object.values(chat.ch).reduce((a, c) => a + (c.unread || 0), 0); }
function renderBadge() { const n = totalUnread(); const b = $('#ai-badge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); }
async function loadChannels() {
  try { const d = await api('GET', '/api/channels'); chat.channels = d.channels; } catch { chat.channels = chat.channels.length ? chat.channels : [{ key: 'group', name: '团队群', kind: 'team' }]; }
  renderChannelSelect();
}
function renderChannelSelect() {
  const keys = [...chat.channels.map((c) => c.key), 'dm', 'kb'];
  if (!keys.includes(chat.tab)) chat.tab = 'group';
  const opt = (key, label) => { const n = (chat.ch[key] || {}).unread || 0; return `<option value="${key}" ${key === chat.tab ? 'selected' : ''}>${esc(label)}${n ? `（${n}）` : ''}</option>`; };
  const projects = chat.channels.filter((c) => c.kind === 'project');
  chanSel.innerHTML = `<optgroup label="团队">${opt('group', '团队群')}${opt('dm', '与 AI 私聊')}</optgroup>`
    + (projects.length ? `<optgroup label="项目群">${projects.map((c) => opt(c.key, `${c.name}${c.archived ? '（已归档）' : ''}`)).join('')}</optgroup>` : '')
    + `<optgroup label="资料">${opt('kb', '知识库')}</optgroup>`;
}
chanSel.addEventListener('change', () => setTab(chanSel.value));
async function openChat(tab) {
  chat.open = true; chatEl.hidden = false; chatFab.classList.add('hide');
  requestAnimationFrame(() => chatEl.classList.add('open'));
  try { localStorage.setItem('hz:chat-open', '1'); } catch {}
  if (!chat.channels.length) await loadChannels();
  setTab(tab || chat.tab, true);
}
function closeChat() {
  chat.open = false; chatEl.classList.remove('open'); chatFab.classList.remove('hide');
  try { localStorage.setItem('hz:chat-open', '0'); } catch {}
  stopVoice({ discard: true });
  setTimeout(() => { if (!chat.open) chatEl.hidden = true; }, 220);
}
chatFab.addEventListener('click', () => openChat());
// 手机键盘弹出时，把面板压缩到可视区域内，输入框始终在键盘上方
if (window.visualViewport) {
  const fit = () => {
    if (!chat.open || window.innerWidth >= 900) { chatEl.style.height = ''; chatEl.style.bottom = ''; return; }
    const vv = window.visualViewport;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    chatEl.style.bottom = `${kb}px`;
    chatEl.style.height = kb > 80 ? `${Math.max(260, vv.height - 8)}px` : '';
    if (kb > 80) requestAnimationFrame(() => { chatBody.scrollTop = chatBody.scrollHeight; });
  };
  window.visualViewport.addEventListener('resize', fit);
  window.visualViewport.addEventListener('scroll', fit);
  chatInput.addEventListener('focus', () => setTimeout(fit, 300));
  chatInput.addEventListener('blur', () => setTimeout(fit, 100));
}
$('#chat-close').addEventListener('click', closeChat);
function setTab(tab, force = false) {
  if (chat.tab === tab && !force) return;
  stopVoice({ discard: true });
  chat.tab = tab;
  try { localStorage.setItem('hz:chat-tab', tab); } catch {}
  const isKb = tab === 'kb';
  $('#chat-form').hidden = isKb; $('#chat-suggest').hidden = isKb; $('#chat-attach').hidden = isKb || !chat.pending.length;
  const proj = chat.channels.find((c) => c.key === tab && c.kind === 'project');
  chatInput.placeholder = tab === 'group' ? '团队群 · 说一句或按住麦克风' : tab === 'dm' ? '私聊 · 例如：我付了 300U 广告费' : `「${proj ? proj.name : '项目'}」群 · 只管本项目`;
  if (!isKb) { const st = chanState(tab); st.unread = 0; renderBadge(); }
  renderChannelSelect();
  if (isKb) { renderKb(); loadKb(); return; }
  if (!chanState(tab).loaded) loadChannel(tab); else renderChat();
  renderSuggest();
  if (window.innerWidth >= 900) chatInput.focus();
}
// 兜底轮询：发出消息后每 3 秒拉一次，直到 AI 回复完成；SSE 断开时也定期拉，保证没有实时推送也能看到回复
const pollTimers = {};
function pollChannel(tab, reason = 'busy') {
  if (pollTimers[tab]) return;
  let ticks = 0;
  pollTimers[tab] = setInterval(async () => {
    ticks += 1;
    if (ticks > 60 || chat.tab !== tab && reason === 'sse') { clearInterval(pollTimers[tab]); delete pollTimers[tab]; return; }
    await loadChannel(tab, true);
    const st = chanState(tab);
    const last = st.messages[st.messages.length - 1];
    const settled = !st.busy && !(last && last.kind === 'assistant' && !(last.parts || []).length);
    if (reason === 'busy' && settled) { clearInterval(pollTimers[tab]); delete pollTimers[tab]; }
  }, reason === 'busy' ? 3000 : 8000);
}
setInterval(() => { if (chat.open && chat.tab !== 'kb' && !esConnected && state.user) pollChannel(chat.tab, 'sse'); }, 8000);
async function loadChannel(tab, silent = false) {
  const st = chanState(tab);
  try {
    const d = await api('GET', `/api/chat?channel=${encodeURIComponent(tab)}`);
    // 合并：保留本地正在流式显示的那条（服务器上它还是空的），其余以服务器为准
    const streaming = st.messages.filter((m) => m.streaming && m.parts && m.parts.length);
    st.messages = d.messages.map((m) => { const local = streaming.find((x) => x.id === m.id); return local && !(m.parts || []).length ? local : m; });
    if (d.busy) { const last = st.messages[st.messages.length - 1]; if (last && last.kind === 'assistant' && !(last.parts || []).length) last.streaming = true; }
    st.loaded = true; st.busy = d.busy;
    if (d.channels) { chat.channels = d.channels; renderChannelSelect(); }
    if (d.ai) { state.ai.configured = d.ai.configured; state.ai.model = d.ai.model; }
  } catch (e) { if (!silent) toast(e.message, 'err'); }
  if (chat.tab === tab) { renderChat(); renderSuggest(); }
}
// ---- 菜单：发送方式 / 清屏 / 清空私聊
const chatMenu = $('#chat-menu');
const sendModeKey = 'hz:sendmode';
function sendMode() { try { return localStorage.getItem(sendModeKey) === 'ctrl' ? 'ctrl' : 'enter'; } catch { return 'enter'; } }
function syncMenu() {
  $$('#chat-menu input[name=sendmode]').forEach((r) => { r.checked = r.value === sendMode(); });
  const isDm = chat.tab === 'dm';
  $('#cm-clear-dm').hidden = !isDm; $('#cm-clear-screen').hidden = isDm || chat.tab === 'kb';
  $('#cm-show-all').hidden = chat.tab === 'kb' || isDm || !hiddenBefore(chat.tab);
}
$('#chat-menu-btn').addEventListener('click', (e) => { e.stopPropagation(); syncMenu(); chatMenu.hidden = !chatMenu.hidden; });
document.addEventListener('click', (e) => { if (!chatMenu.hidden && !chatMenu.contains(e.target)) chatMenu.hidden = true; });
$$('#chat-menu input[name=sendmode]').forEach((r) => r.addEventListener('change', () => { try { localStorage.setItem(sendModeKey, r.value); } catch {} toast(r.value === 'ctrl' ? 'Ctrl / ⌘ + Enter 发送' : 'Enter 发送'); }));
const hiddenBefore = (tab) => { try { return Number(localStorage.getItem(`hz:clear:${tab}`) || 0); } catch { return 0; } };
$('#cm-clear-screen').addEventListener('click', () => {
  const st = chanState(chat.tab); const last = st.messages[st.messages.length - 1];
  if (!last) { chatMenu.hidden = true; return; }
  try { localStorage.setItem(`hz:clear:${chat.tab}`, String(last.id)); } catch {}
  chatMenu.hidden = true; renderChat(); toast('已清屏（只在这台设备上隐藏）');
});
$('#cm-show-all').addEventListener('click', () => { try { localStorage.removeItem(`hz:clear:${chat.tab}`); } catch {} chatMenu.hidden = true; renderChat(); });
$('#cm-clear-dm').addEventListener('click', async () => {
  chatMenu.hidden = true;
  if (chat.tab !== 'dm' || chanState('dm').busy) return;
  if (chanState('dm').messages.length && !confirm('清空你与 AI 的私聊记录？账目数据和知识库存档不受影响。')) return;
  try { await api('DELETE', '/api/chat?channel=dm'); chanState('dm').messages = []; renderChat(); renderSuggest(); } catch (e) { toast(e.message, 'err'); }
});
// ---- 撤回
async function recallMsg(id) {
  try { await api('POST', `/api/chat/${id}/recall`); toast('已撤回'); }
  catch (e) { toast(e.message, 'err'); }
}
const canRecall = (m) => m.kind === 'user' && m.user_id === state.user.id && Date.now() - new Date(m.created_at).getTime() < 5 * 60 * 1000;

// ---- 新建项目群
const sheetGroup = $('#sheet-group');
$('#chat-new-group').addEventListener('click', () => openGroupSheet());
async function openGroupSheet(projectId) {
  if (!state.projects.length) await loadHome();
  if (!chat.channels.length) await loadChannels();
  if (projectId) return createGroup(projectId);
  const have = new Set(chat.channels.filter((c) => c.kind === 'project').map((c) => c.project_id));
  const candidates = state.projects.filter((p) => !have.has(p.id));
  $('#group-error').hidden = true;
  $('#group-project-chips').innerHTML = candidates.length
    ? candidates.map((p) => `<button type="button" class="chip" data-gp="${p.id}">${esc(p.name)}${p.archived ? '（已归档）' : ''}</button>`).join('')
    : '<span class="muted" style="font-size:13px">所有项目都已经有群了</span>';
  $$('#group-project-chips .chip').forEach((b) => b.addEventListener('click', () => createGroup(Number(b.dataset.gp))));
  openSheet(sheetGroup);
}
async function createGroup(projectId) {
  try {
    const d = await api('POST', '/api/channels', { project_id: projectId });
    closeSheet(sheetGroup);
    await loadChannels();
    if (!chat.open) await openChat(d.channel); else setTab(d.channel, true);
    if (!d.existed) toast('项目群已创建');
  } catch (e) { const err = $('#group-error'); if (sheetGroup.classList.contains('open')) showErr(err, e.message); else toast(e.message, 'err'); }
}

// ---- 渲染
function renderSuggest() {
  const el = $('#chat-suggest');
  if (chat.tab === 'kb') { el.hidden = true; return; }
  const st = chanState(chat.tab);
  if (st.busy || st.messages.some((m) => m.kind === 'user')) { el.innerHTML = ''; el.hidden = true; return; }
  const proj = chat.channels.find((c) => c.key === chat.tab && c.kind === 'project');
  const p = proj ? { name: proj.name } : (state.view === 'project' && state.project ? state.project.project : null);
  const items = p
    ? [`我付了 200 元服务器费`, `「${p.name}」本月利润多少？`, `导出「${p.name}」本月的 Excel`, `「${p.name}」最近都花在哪了？`]
    : ['我付了 300U 广告费', '本月各项目利润排名', '导出本月报表 Excel', '我们最近都做了什么？'];
  el.hidden = false;
  el.innerHTML = items.map((t) => `<button type="button" class="chip">${esc(t)}</button>`).join('');
  $$('.chip', el).forEach((b) => b.addEventListener('click', () => { chatInput.value = b.textContent; sendChat(); }));
}
function toolRow(t) {
  const links = (t.links || []).map((l) => `<a href="${esc(l.url)}" download>${ICO('download')}${esc(l.label)}</a>`).join('');
  return `<div class="chat-tool ${t.status === 'start' ? 'running' : ''} ${t.error ? 'error' : ''} ${t.proposal_id ? 'proposal' : ''}"><span class="ct-ic">${t.status === 'start' ? '' : t.error ? '!' : t.proposal_id ? '?' : '✓'}</span><span class="ct-text">${esc(t.status === 'start' ? `${t.label || t.name}…` : (t.summary || t.label || t.name))}</span>${links}</div>`;
}
const PROP_STATUS = { pending: '待审批', approved: '已批准', rejected: '已拒绝', failed: '执行失败' };
function proposalCard(p) {
  const decided = p.status !== 'pending';
  let res = '';
  if (p.status === 'approved') { let r = {}; try { r = JSON.parse(p.result || '{}'); } catch {} res = r.summary || '已执行'; if (r.links && r.links.length) res += ' ' + r.links.map((l) => `<a href="${esc(l.url)}" download>${esc(l.label)}</a>`).join(' '); }
  return `<div class="prop ${p.status}" data-prop="${p.id}">
    <div class="prop-head"><span class="prop-tag">${PROP_STATUS[p.status] || p.status}</span><b>${esc(p.title)}</b><span class="prop-id">#${p.id}</span></div>
    ${p.detail ? `<div class="prop-detail">${esc(p.detail)}</div>` : ''}
    <div class="prop-meta">${esc(p.requested_name)} 通过 AI 提出 · ${fmtTime(p.created_at)}${decided ? ` · ${esc(p.decided_name || '')} ${p.status === 'rejected' ? '拒绝' : '批准'} · ${fmtTime(p.decided_at)}` : ''}</div>
    ${p.status === 'approved' ? `<div class="prop-result">✓ ${res}</div>` : p.status === 'failed' ? `<div class="prop-result err">✕ ${esc(p.error)}</div>` : ''}
    ${decided ? '' : `<div class="prop-actions"><button type="button" class="btn primary" data-approve="${p.id}">批准并执行</button><button type="button" class="btn ghost" data-reject="${p.id}">拒绝</button></div>`}
  </div>`;
}
function attachmentHtml(list) {
  if (!list || !list.length) return '';
  return `<div class="att-list">${list.map((a) => a.image ? `<a class="att-img" href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name)}"></a>` : `<a class="att-file" href="${esc(a.url)}" download>${ICO('download')}${esc(a.name)}</a>`).join('')}</div>`;
}
function bubble(m) {
  const mine = m.user_id === state.user.id;
  if (m.kind === 'system') return `<div class="msg sys"><span>${esc(m.text)}</span></div>`;
  if (m.kind === 'recalled') return `<div class="msg recalled"><span>${m.username === 'AI 助手' ? 'AI 助手的回复已作废' : `${mine ? '你' : esc(m.username)} 撤回了一条消息`}</span></div>`;
  if (m.kind === 'user') {
    const who = chat.tab !== 'dm' && !mine ? `<div class="who">${avatar(m.username, 'xs')}${esc(m.username)}<i>${fmtTime(m.created_at)}</i></div>` : '';
    const recall = canRecall(m) ? `<button type="button" class="recall" data-recall="${m.id}">撤回</button>` : '';
    return `<div class="msg user ${mine ? 'mine' : 'other'}" data-mid="${m.id}">${who}${m.text ? `<div class="bub">${esc(m.text)}</div>` : ''}${attachmentHtml(m.attachments)}${recall}</div>`;
  }
  const parts = m.parts || [];
  const last = parts[parts.length - 1];
  const html = parts.map((p, i) => p.type === 'tool' ? toolRow(p) : `<div class="bub md">${md(p.text)}${m.streaming && i === parts.length - 1 ? '<span class="caret"></span>' : ''}</div>`).join('');
  const typing = m.streaming && (!last || last.type === 'tool') ? '<div class="bub typing"><i></i><i></i><i></i></div>' : '';
  const props = (m.proposals || []).map(proposalCard).join('');
  return `<div class="msg assistant"><div class="who ai"><i class="ico ico-spark"></i>AI 助手<i>${fmtTime(m.created_at)}</i></div>${html}${typing}${props}</div>`;
}
function renderChat() {
  if (chat.tab === 'kb') return;
  const st = chanState(chat.tab);
  const proj = chat.channels.find((c) => c.key === chat.tab && c.kind === 'project');
  const near = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 120;
  const empty = chat.tab === 'group' ? ['团队群聊', '成员和 AI 都在这里。谁说话 AI 都认得，记账、查账、发截图 / 表格让 AI 整理都可以；AI 的每个操作都要有人点「批准」才会执行。']
    : chat.tab === 'dm' ? ['与 AI 私聊', '只有你和 AI 看得到。记账、查账、改记录、出报表都行；AI 提出的操作由你自己批准。']
      : [`「${proj ? proj.name : '项目'}」群`, '这个群的 AI 只负责本项目：记账不用说项目名，统计、报表、导出都只针对本项目。'];
  const cut = hiddenBefore(chat.tab);
  const visible = cut ? st.messages.filter((m) => m.id > cut) : st.messages;
  const hiddenNote = cut && st.messages.length > visible.length ? `<div class="chat-hidden-note">已清屏 ${st.messages.length - visible.length} 条 · <button type="button" id="show-hidden">显示</button></div>` : '';
  chatBody.innerHTML = hiddenNote + (visible.length ? visible.map(bubble).join('')
    : `<div class="chat-empty"><i class="ico ico-spark"></i><b>${esc(empty[0])}</b><p>${esc(empty[1])}</p></div>`);
  $('#show-hidden')?.addEventListener('click', () => { try { localStorage.removeItem(`hz:clear:${chat.tab}`); } catch {} renderChat(); });
  $$('[data-recall]', chatBody).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('撤回这条消息？AI 对它的回复也会作废。')) recallMsg(Number(b.dataset.recall)); }));
  $$('.msg.user.mine', chatBody).forEach((el) => {
    let t; const show = () => { $$('.msg.show-actions', chatBody).forEach((x) => x.classList.remove('show-actions')); el.classList.add('show-actions'); };
    el.addEventListener('pointerdown', () => { t = setTimeout(show, 450); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(t)));
  });
  $$('[data-approve]', chatBody).forEach((b) => b.addEventListener('click', () => decide(b.dataset.approve, 'approve', b)));
  $$('[data-reject]', chatBody).forEach((b) => b.addEventListener('click', () => decide(b.dataset.reject, 'reject', b)));
  if (near || st.busy) chatBody.scrollTop = chatBody.scrollHeight;
}
let chatRaf = false;
function renderChatSoon() { if (chatRaf) return; chatRaf = true; requestAnimationFrame(() => { chatRaf = false; renderChat(); }); }
async function decide(id, action, btn) {
  const card = btn.closest('.prop'); $$('button', card).forEach((b) => { b.disabled = true; });
  setLoading(btn, true);
  try { const d = await api('POST', `/api/proposals/${id}/${action}`); applyProposal(d.proposal); toast(action === 'approve' ? (d.proposal.status === 'failed' ? `执行失败：${d.proposal.error}` : '已批准并执行') : '已拒绝', d.proposal.status === 'failed' ? 'err' : ''); }
  catch (e) { toast(e.message, 'err'); $$('button', card).forEach((b) => { b.disabled = false; }); setLoading(btn, false); }
}
function applyProposal(p) {
  const key = chanKey(p.channel);
  for (const m of chanState(key).messages) {
    if (m.id !== p.message_id || !m.proposals) continue;
    const i = m.proposals.findIndex((x) => x.id === p.id);
    if (i >= 0) m.proposals[i] = p; else m.proposals.push(p);
  }
  if (chat.tab === key) renderChatSoon();
}

// ---- 事件（来自 SSE）
function onChatEvent(name, d) {
  if (name === 'channels') { chat.channels = d.channels; renderChannelSelect(); if (d.created && d.by !== state.user.username) toast(`${d.by} 新建了项目群「${chanName(d.created)}」`); return; }
  if (name === 'kb') { if (chat.open && chat.tab === 'kb') loadKb(); return; }
  if (name === 'recall') {
    const st = chanState(chanKey(d.channel));
    for (const m of st.messages) if (d.ids.includes(m.id)) { m.kind = 'recalled'; m.text = ''; m.parts = []; m.attachments = []; m.streaming = false; if (m.username === 'AI 助手') st.busy = false; }
    if (d.byId !== state.user.id && chat.open && chat.tab === chanKey(d.channel)) toast(`${d.by} 撤回了一条消息`);
    if (chat.open && chat.tab === chanKey(d.channel)) renderChatSoon();
    return;
  }
  if (name === 'proposal') { applyProposal(d.proposal); if (d.proposal.status === 'pending' && d.proposal.requested_by !== state.user.id) toast(`${d.proposal.requested_name} 通过 AI 提出：${d.proposal.title}（待批准）`); return; }
  const key = chanKey(d.channel);
  const st = chanState(key);
  const viewing = chat.open && chat.tab === key;
  if (name === 'msg') {
    if (st.messages.some((m) => m.id === d.message.id)) return;
    st.messages.push(d.message);
    if (d.message.kind === 'user' && d.message.user_id !== state.user.id && !viewing) { st.unread += 1; renderBadge(); renderChannelSelect(); }
    if (viewing) renderChatSoon();
  } else if (name === 'ai') {
    let m = st.messages.find((x) => x.id === d.id);
    if (d.status === 'start') { if (!m) { m = { id: d.id, kind: 'assistant', username: 'AI 助手', parts: [], proposals: [], streaming: true, created_at: new Date().toISOString() }; st.messages.push(m); } st.busy = true; }
    else if (!m) { if (d.status === 'done') { st.messages.push(d.message); st.busy = false; } }
    else if (d.status === 'delta') { const last = m.parts[m.parts.length - 1]; if (last && last.type === 'text') last.text += d.delta; else m.parts.push({ type: 'text', text: d.delta }); }
    else if (d.status === 'reset') { m.parts = m.parts.filter((p) => p.type !== 'text'); if (d.text) m.parts.unshift({ type: 'text', text: d.text }); }
    else if (d.status === 'tool') { const i = m.parts.findIndex((p) => p.type === 'tool' && p.id === d.tool.id); if (i >= 0) m.parts[i] = { ...m.parts[i], ...d.tool }; else m.parts.push({ ...d.tool }); }
    else if (d.status === 'done') { Object.assign(m, d.message, { streaming: false }); st.busy = false; if (!viewing && key !== 'dm') { st.unread += 1; renderBadge(); renderChannelSelect(); } }
    if (viewing) { renderChatSoon(); if (d.status === 'done') renderSuggest(); }
  }
}

// ---- 发送 / 附件
async function sendChat() {
  const text = chatInput.value.trim();
  if (chat.tab === 'kb') return;
  if (chat.uploading) { chat.sendWhenReady = true; toast('附件上传完会自动发送'); return; }
  chat.sendWhenReady = false;
  const ready = chat.pending.filter((x) => x.status === 'done' && x.attachment);
  if (chat.pending.some((x) => x.status === 'error')) { toast('有附件上传失败，请重试或移除后再发送', 'err'); return; }
  if (!text && !ready.length) return;
  stopVoice({ discard: true });
  if (!state.ai.configured) toast('未配置 AI 接口，消息会保存但 AI 不会回复');
  const tab = chat.tab;
  const pendingAtt = chat.pending;
  chatInput.value = ''; chatInput.style.height = ''; autoGrow();
  const attachments = ready.map((a) => a.attachment.id); chat.pending = []; chat.uploading = 0; renderPending();
  $('#chat-send').disabled = true;
  try {
    const d = await api('POST', '/api/chat', { channel: tab, message: text, attachments, page: state.view, projectId: state.view === 'project' && state.project ? state.project.project.id : null });
    const st = chanState(tab);
    if (!st.messages.some((m) => m.id === d.message.id)) st.messages.push(d.message);
    if (d.reply) { st.busy = true; pollChannel(tab, 'busy'); }
    else if (tab !== 'dm' && state.ai.configured && state.ai.group_mode === 'mention') toast('群里只有 @AI 或带附件时 AI 才回复（可在「我的」里改）');
    renderChat(); chatBody.scrollTop = chatBody.scrollHeight; renderSuggest();
  } catch (e) { toast(e.message, 'err'); chatInput.value = text; chat.pending = pendingAtt; chat.uploading = 0; renderPending(); autoGrow(); }
  finally {
    pendingAtt.forEach((a) => { if (a.preview && !chat.pending.includes(a)) URL.revokeObjectURL(a.preview); });
    $('#chat-send').disabled = false; if (window.innerWidth >= 900) chatInput.focus();
  }
}
$('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
// 输入法安全：拼音没打完时的 Enter（isComposing / keyCode 229 / 刚结束合成）绝不发送
let composing = false, compositionEndedAt = 0;
chatInput.addEventListener('compositionstart', () => { composing = true; });
chatInput.addEventListener('compositionend', () => { composing = false; compositionEndedAt = Date.now(); });
// 兜底：某些输入法 / 失焦时收不到 compositionend，避免"合成中"状态卡住导致 Enter 永远发不出去
chatInput.addEventListener('input', (e) => { if (!e.isComposing) composing = false; });
chatInput.addEventListener('blur', () => { composing = false; });
chatInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.isComposing || e.keyCode === 229 || composing || Date.now() - compositionEndedAt < 120) return;
  const mode = sendMode();
  const wantSend = mode === 'ctrl' ? (e.ctrlKey || e.metaKey) : !(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey);
  if (wantSend) { e.preventDefault(); sendChat(); }
});
function autoGrow() { chatInput.style.height = 'auto'; chatInput.style.height = `${Math.min(120, chatInput.scrollHeight)}px`; }
chatInput.addEventListener('input', autoGrow);
$('#chat-file').addEventListener('click', () => $('#chat-file-input').click());
$('#chat-file-input').addEventListener('change', (e) => { uploadFiles(Array.from(e.target.files)); e.target.value = ''; });
chatInput.addEventListener('paste', (e) => { const files = Array.from(e.clipboardData?.files || []); if (files.length) { e.preventDefault(); uploadFiles(files); } });
chatEl.addEventListener('dragover', (e) => { e.preventDefault(); chatEl.classList.add('drag'); });
chatEl.addEventListener('dragleave', () => chatEl.classList.remove('drag'));
chatEl.addEventListener('drop', (e) => { e.preventDefault(); chatEl.classList.remove('drag'); if (chat.tab !== 'kb') uploadFiles(Array.from(e.dataTransfer.files || [])); });
// 图片先在浏览器里压成 JPEG（最长边 2048、质量 0.85）：手机原图 / 截图 / HEIC 都能变小变通用，AI 也读得动
function loadImageEl(file) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { res(img); URL.revokeObjectURL(url); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); }; img.src = url; });
}
async function prepareImage(file) {
  const isImg = /^image\//.test(file.type) || /\.(heic|heif|png|jpe?g|webp|gif|bmp)$/i.test(file.name);
  if (!isImg || file.type === 'image/gif') return file;
  if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size < 1.2 * 1024 * 1024) return file;
  try {
    let src; try { src = await createImageBitmap(file); } catch { src = await loadImageEl(file); }
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const scale = Math.min(1, 2048 / Math.max(w, h));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    if (src.close) src.close();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
const readB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('读取文件失败')); r.readAsDataURL(f); });
async function uploadOne(item) {
  item.status = 'uploading'; item.error = ''; renderPending();
  try {
    const f = await prepareImage(item.file);
    if (f.size > 20 * 1024 * 1024) throw new Error('超过 20MB');
    const data = await readB64(f);
    const d = await api('POST', '/api/attachments', { name: f.name, mime: f.type, data });
    item.attachment = d.attachment; item.status = 'done';
  } catch (e) { item.status = 'error'; item.error = e.message || '上传失败'; }
  chat.uploading = chat.pending.filter((x) => x.status === 'uploading').length;
  renderPending();
  if (!chat.uploading && chat.sendWhenReady) { chat.sendWhenReady = false; if (!chat.pending.some((x) => x.status === 'error')) sendChat(); }
}
async function uploadFiles(files) {
  const list = files.slice(0, 10 - chat.pending.length);
  if (!list.length) { toast('最多同时发送 10 个附件'); return; }
  for (const file of list) {
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, name: file.name, status: 'uploading', preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' };
    chat.pending.push(item);
  }
  chat.uploading = chat.pending.filter((x) => x.status === 'uploading').length;
  renderPending();
  for (const item of chat.pending.filter((x) => x.status === 'uploading' && !x.attachment)) await uploadOne(item);
}
function renderPending() {
  const el = $('#chat-attach');
  el.hidden = chat.tab === 'kb' || !chat.pending.length;
  const done = chat.pending.filter((x) => x.status === 'done').length;
  el.innerHTML = `<div class="att-hint">${chat.uploading ? `上传中 ${chat.uploading} 个…` : chat.pending.some((x) => x.status === 'error') ? '有附件上传失败，可重试或移除' : `已添加 ${done} 个附件，输入文字后一起发送`}</div>`
    + chat.pending.map((a, i) => `<span class="att-chip ${a.status}">${a.preview ? `<img src="${esc(a.preview)}" alt="">` : ICO('download')}<span title="${esc(a.name)}">${esc(a.name)}</span>${a.status === 'uploading' ? '<i class="att-spin"></i>' : a.status === 'error' ? `<button type="button" class="att-retry" data-retry="${i}" title="${esc(a.error)}">重试</button>` : ''}<button type="button" data-rm="${i}" aria-label="移除">${ICO('x')}</button></span>`).join('');
  $$('[data-rm]', el).forEach((b) => b.addEventListener('click', () => { const it = chat.pending.splice(Number(b.dataset.rm), 1)[0]; if (it && it.preview) URL.revokeObjectURL(it.preview); chat.uploading = chat.pending.filter((x) => x.status === 'uploading').length; renderPending(); }));
  $$('[data-retry]', el).forEach((b) => b.addEventListener('click', () => uploadOne(chat.pending[Number(b.dataset.retry)])));
}

// ---- 语音输入（浏览器普通话识别，边说边出字，中文数字自动转阿拉伯数字）
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
// 每次识别一个 session：停止后仍接收最后的识别结果，直到 onend；一旦发送 / 切换会话就 discard，之后的结果全部丢弃
const voice = { session: null, pressTimer: null, holding: false };
const micBtn = $('#chat-mic'), voiceBar = $('#voice-bar'), voiceText = $('#voice-text'), voiceAuto = $('#voice-autosend');
try { voiceAuto.checked = localStorage.getItem('hz:voice-auto') === '1'; } catch {}
voiceAuto.addEventListener('change', () => { try { localStorage.setItem('hz:voice-auto', voiceAuto.checked ? '1' : '0'); } catch {} });
if (!SR) micBtn.title = '当前浏览器不支持语音识别，请使用 Chrome、Edge 或 Safari';
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 两: 2, 贰: 2, 三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
const CN_UNIT = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000, 亿: 100000000 };
function cnToNumber(s) {
  let total = 0, section = 0, num = 0, seen = false;
  for (const ch of s) {
    if (ch in CN_DIGIT) { num = CN_DIGIT[ch]; seen = true; }
    else if (ch === '十' || ch === '拾') { section += (num || 1) * 10; num = 0; seen = true; }
    else if (ch === '百' || ch === '佰' || ch === '千' || ch === '仟') { section += (num || 1) * CN_UNIT[ch]; num = 0; seen = true; }
    else if (ch === '万' || ch === '亿') { total = (total + section + num) * CN_UNIT[ch]; section = 0; num = 0; seen = true; }
    else if (ch === '点') break;
  }
  return seen ? total + section + num : null;
}
// 「三百U」→「300 USDT」，「一千二百五十块」→「1250块」，「两万」→「20000」，「三点五万」→「35000」
function normalizeSpeech(t) {
  return String(t)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/([零〇一二两三四五六七八九壹贰叁肆伍陆柒捌玖]+)点([零〇一二两三四五六七八九壹贰叁肆伍陆柒捌玖]+)(万|亿)?/g, (m, a, b, u) => { const ai = cnToNumber(a), bi = [...b].map((c) => CN_DIGIT[c]).join(''); if (ai === null || !bi) return m; const v = Number(`${ai}.${bi}`) * (u ? CN_UNIT[u] : 1); return String(Math.round(v * 100) / 100); })
    .replace(/[零〇一二两三四五六七八九壹贰叁肆伍陆柒捌玖十拾百佰千仟万亿]{2,}|[十拾][零〇一二两三四五六七八九]?|[一二两三四五六七八九][十拾百佰千仟万亿]/g, (m) => { const v = cnToNumber(m); return v === null || (v < 10 && !/[十拾百佰千仟万亿]/.test(m)) ? m : String(v); })
    .replace(/(\d)\s+(?=[a-zA-Z¥$%])/g, '$1').replace(/([一-龥])\s+(?=[一-龥\d])/g, '$1').replace(/(\d)\s+(?=[一-龥])/g, '$1')
    .replace(/\b(\d+)\s*(u|U|usdt|USDT)\b/g, '$1 USDT').replace(/(\d+)\s*(美金|美元|刀)/g, '$1 美元').trim();
}
function joinText(a, b) { if (!a) return b; if (!b) return a; return /[，。！？、,.!?:：]$/.test(a) ? a + b : a + (/^[一-龥]/.test(b) && /[一-龥\d]$/.test(a) ? '，' : ' ') + b; }
function voiceUI(on, text) {
  micBtn.classList.toggle('on', on); voiceBar.hidden = !on; chatInput.classList.toggle('listening', on);
  if (text) voiceText.textContent = text;
}
function startVoice() {
  if (!SR) { toast('当前浏览器不支持语音识别，请使用 Chrome、Edge 或 Safari', 'err'); return; }
  if (!window.isSecureContext) { toast('语音输入需要 HTTPS（或 localhost）环境，请通过 https 域名访问', 'err'); return; }
  if (voice.session && voice.session.active) return;
  if (voice.session) voice.session.discard = true;
  const rec = new SR();
  rec.lang = 'zh-CN'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  const ses = { rec, active: true, discard: false, base: chatInput.value.trim(), final: '', restarts: 0, gotAny: false };
  voice.session = ses;
  voiceUI(true, '正在听…请说普通话，说完点麦克风停止');
  rec.onresult = (e) => {
    if (ses.discard) return; // 已发送 / 已切换会话：丢弃迟到的结果，不再往输入框写
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript.trim(); if (!t) continue; if (e.results[i].isFinal) ses.final = joinText(ses.final, normalizeSpeech(t)); else interim += t; }
    ses.gotAny = true;
    chatInput.value = joinText(ses.base, ses.final) + (interim ? ((ses.final || ses.base) ? '，' : '') + normalizeSpeech(interim) : '');
    autoGrow(); chatInput.scrollTop = chatInput.scrollHeight;
    if (ses.active) voiceText.textContent = interim ? '正在识别…' : '已识别，继续说或点麦克风停止';
  };
  rec.onerror = (e) => {
    if (ses.discard) return;
    const msgs = { 'not-allowed': '请允许浏览器使用麦克风', 'service-not-allowed': '语音服务不可用', network: '连不上语音服务（Chrome 需要能访问 Google，可改用 Safari 或 Edge）', 'no-speech': '没听到声音，再试一次', 'audio-capture': '没有检测到麦克风', aborted: '' };
    const m = msgs[e.error] ?? `语音识别出错：${e.error}`;
    if (e.error === 'no-speech') { if (ses.active) voiceText.textContent = m; return; }
    if (m) toast(m, 'err');
    ses.active = false; voiceUI(false);
  };
  rec.onend = () => {
    // 用户没主动停、也不是自动发送模式：Chrome 会因静音自动结束，续上
    if (ses.active && !ses.discard && !voiceAuto.checked && !voice.holding && ses.restarts < 8) { ses.restarts += 1; try { rec.start(); return; } catch {} }
    ses.active = false; voiceUI(false);
    if (voice.session === ses) voice.session = null;
    // 勾了"自动发送"：不管是停顿结束、点停止还是松开按钮，只要识别到了内容就直接发
    if (voiceAuto.checked && !ses.discard && ses.gotAny && chatInput.value.trim()) sendChat();
  };
  try { rec.start(); } catch (e) { toast('无法启动语音识别', 'err'); ses.active = false; voiceUI(false); voice.session = null; }
}
// 停止：立刻还原按钮状态，但保留 session 直到 onend，以便收下最后一句的最终结果
function stopVoice({ discard = false } = {}) {
  const ses = voice.session;
  if (!ses) return;
  ses.active = false;
  if (discard) ses.discard = true;
  voiceUI(false);
  try { ses.rec.stop(); } catch {}
}
micBtn.addEventListener('click', () => { if (voice.holding) return; if (voice.session && voice.session.active) stopVoice(); else startVoice(); });
// 长按 = 按住说话，松开即停（配合"自动发送"就是对讲机）
micBtn.addEventListener('pointerdown', () => { voice.pressTimer = setTimeout(() => { voice.holding = true; startVoice(); voiceText.textContent = '按住说话，松开结束'; }, 450); });
const releaseMic = () => { clearTimeout(voice.pressTimer); if (voice.holding) { stopVoice(); setTimeout(() => { voice.holding = false; }, 50); } };
micBtn.addEventListener('pointerup', releaseMic); micBtn.addEventListener('pointerleave', releaseMic); micBtn.addEventListener('pointercancel', releaseMic);

// ---- 知识库
async function loadKb() { try { chat.kb = await api('GET', '/api/knowledge'); } catch (e) { toast(e.message, 'err'); } renderKb(); }
function renderKb() {
  const k = chat.kb;
  if (!k) { chatBody.innerHTML = '<div class="skel" style="padding:14px"><i style="height:60px"></i><i style="height:160px"></i></div>'; return; }
  const when = k.consolidated_at ? `上次整理：${new Date(k.consolidated_at).toLocaleString('zh-CN', { hour12: false })}` : '还没有整理过';
  chatBody.innerHTML = `<div class="kb">
    <div class="kb-head"><div><b>知识摘要</b><p class="muted">${when} · 每 ${k.auto_days} 天到期后 AI 会在团队群提议整理（需批准）</p></div>
      <div class="head-actions"><a class="btn ghost" href="/api/knowledge/summary.md" download>${ICO('download')}摘要</a><button type="button" class="btn primary" id="kb-consolidate" ${state.ai.configured ? '' : 'disabled'}>整理知识库</button></div></div>
    <div class="md kb-summary">${k.summary ? md(k.summary) : '<p class="muted">知识摘要会把操作日志和对话归纳成团队记忆：谁在什么时候做了什么、各项目状况、约定与待办。点「整理知识库」生成第一版。</p>'}</div>
    <div class="kb-files"><b>操作日志</b><p class="muted">每一次记账、修改、审批、导出都会按天写入 Markdown</p><div class="kb-dates">${k.log_dates.length ? k.log_dates.map((d) => `<a href="/api/knowledge/file?kind=log&date=${d}" download>${d}</a>`).join('') : '<span class="muted">暂无</span>'}</div></div>
    <div class="kb-files"><b>对话记录</b><p class="muted">团队群、项目群与私聊按天存档</p><div class="kb-dates">${k.chat_dates.length ? k.chat_dates.map((d) => `<a href="/api/knowledge/file?kind=chat&date=${d}" download>${d}</a>`).join('') : '<span class="muted">暂无</span>'}</div></div>
  </div>`;
  $('#kb-consolidate')?.addEventListener('click', async () => {
    if (!confirm('现在整理知识库？AI 会把近期日志与对话归纳进摘要，旧摘要自动存档。')) return;
    const btn = $('#kb-consolidate'); setLoading(btn, true);
    try { await api('POST', '/api/knowledge/consolidate'); toast('知识库已整理'); await loadKb(); }
    catch (e) { toast(e.message, 'err'); setLoading(btn, false); }
  });
}

// ---------------------------------------------------------------- 快捷键
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const open = $$('.sheet.open'); if (open.length) open.forEach(closeSheet); else if (chat.open) closeChat(); return; }
  if (!state.user || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openEntry(); }
});

// ---------------------------------------------------------------- 启动
(async () => {
  try {
    const d = await api('GET', '/api/me');
    state.user = d.user; state.members = d.members; state.rates = d.rates; state.ai = d.ai || state.ai; state.autoExport = d.auto_export || state.autoExport; state.tz = d.tz; state.integrationToken = d.integration_token;
    connectEvents(); chatBoot();
    showShell(); renderSideUser(); route();
    if (state.view !== 'home') loadHome();
  } catch { showAuth(); }
})();
})();
