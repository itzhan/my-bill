// 供应商余额：用我们在供应商站点（new-api / sub2api）的 API Key 抓「钱包额度」和「这把 Key 的倍率」。
// - 普通模式：倍率从供应商接口抓取，实际余额 = 钱包额度
// - 自定义倍率：有的供应商倍率永远显示 1、充值时按倍率折算额度（充 9000、3 倍率 → 给 3000 额度），
//   这时倍率由我们手填、不抓取，实际余额 = 钱包额度 × 自定义倍率
// 只对供应商站点发 GET 请求，不产生费用。挂在项目的「供应商」（parties.kind = supplier）下面，一家可绑多个 Key。
'use strict';

const TIMEOUT_MS = 15_000;
const LOOP_MS = 30 * 60_000;
const PLATFORMS = ['newapi', 'sub2api'];

const nowIso = () => new Date().toISOString();
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (n, d = 6) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

// ---------- 抓取 ----------
const baseOf = (u) => String(u || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
const redact = (text, key) => (key && key.length >= 8 ? String(text).split(key).join("<api-key>") : String(text)).slice(0, 200);

// insecure = true 时跳过 TLS 证书校验（有的供应商站点证书链不完整），只对这次请求生效
let insecureAgent = null;
function dispatcherFor(insecure) {
  if (!insecure) return undefined;
  if (!insecureAgent) {
    const { Agent } = require("undici");
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return insecureAgent;
}

async function httpJson(url, { key, method = "GET", body, insecure } = {}) {
  const headers = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher: dispatcherFor(insecure),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const aborted = e?.name === "TimeoutError" || e?.name === "AbortError";
    return { ok: false, status: 0, error: aborted ? "请求超时" : redact(e?.cause?.message || e?.message || e, key) };
  }
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json) {
    const err = json?.error;
    const msg = typeof err === "string" ? err : err?.message || json?.message || (json ? "" : "返回的不是 JSON（地址或平台选错了？）");
    return { ok: false, status: res.status, json, error: redact(`HTTP ${res.status}${msg ? `：${msg}` : ""}`, key) };
  }
  return { ok: true, status: res.status, json };
}

// new-api 用账号密码登录，读账户钱包余额与总消费（用户视角，无限额度 Key 也能看到）。creds = [[user, pass], ...] 逐个试
async function newapiLogin(base, creds, qpu, insecure) {
  const fails = [];
  for (const [user, pass] of creds) {
    if (!user || !pass) continue;
    const r = await httpJson(`${base}/api/user/login`, { method: "POST", body: { username: user, password: pass }, insecure });
    if (r.error) {
      fails.push(`${user}：${r.error}`);
      continue;
    }
    if (!r.json.success) {
      fails.push(`${user}：${r.json.message || "登录失败"}`);
      continue;
    }
    const u = r.json.data?.user;
    if (!u) {
      fails.push(`${user}：需要二次验证（2FA），无法用密码登录`);
      continue;
    }
    return { ok: true, user, pass, wallet: round(num(u.quota) / qpu, 4), used: round(num(u.used_quota) / qpu, 4), group: u.group || "" };
  }
  return { ok: false, error: fails[0] || "没有可用的账号密码", fails };
}

// sub2api：/v1/usage 拿钱包（balance），/v1/sub2api/billing 拿倍率；老版本没有 billing 接口时用 实际扣费 / 标准费用 反推
async function fetchSub2api(base, key, wantRatio, insecure) {
  const u = await httpJson(`${base}/v1/usage`, { key, insecure });
  if (!u.ok) throw new Error(`读取余额失败：${u.status === 401 ? "Key 无效或已禁用" : u.error}`);
  const d = u.json;
  let wallet = null;
  let kind = "";
  if (num(d.balance) !== null) {
    wallet = num(d.balance);
    kind = "wallet";
  } else if (d.subscription) {
    wallet = num(d.remaining) === -1 ? null : num(d.remaining);
    kind = "subscription";
  } else if (d.mode === "quota_limited") {
    wallet = num(d.remaining) ?? num(d.quota?.remaining);
    kind = "quota";
  } else {
    wallet = num(d.remaining);
    kind = "wallet";
  }
  const used = num(d.usage?.total?.actual_cost); // 这把 Key 的累计实际扣费
  if (!wantRatio) return { wallet, kind, used };

  let ratio = null;
  let source = "";
  const b = await httpJson(`${base}/v1/sub2api/billing`, { key, insecure });
  if (b.ok && num(b.json.resolved_rate_multiplier) !== null) {
    ratio = num(b.json.resolved_rate_multiplier);
    source = "billing";
  } else {
    const t = d.usage?.total;
    if (t && num(t.cost) > 0 && num(t.actual_cost) !== null) {
      ratio = round(num(t.actual_cost) / num(t.cost), 4);
      source = "usage";
    } else source = b.status === 403 ? "Key 没有分组，读不到倍率" : "读不到倍率（这把 Key 还没有消费记录）";
  }
  return { wallet, kind, used, ratio, source };
}

// new-api：
// - 余额：令牌有额度上限 → 令牌剩余额度（/api/usage/token）；令牌无限额度 → 用户钱包（/v1/dashboard/billing/subscription − usage，
//   站点开着「按令牌统计」时这里拿不到钱包，只能提示）
// - 倍率：最近一条消费日志里的分组倍率（/api/log/token），没有消费记录时退回 /api/pricing 的 default 分组倍率
async function fetchNewapi(base, key, wantRatio, login, insecure) {
  const st = await httpJson(`${base}/api/status`, { insecure });
  const s = st.ok ? st.json.data || {} : {};
  const qpu = num(s.quota_per_unit) || 500000;
  const display = s.quota_display_type || (s.display_in_currency === false ? "TOKENS" : "USD");
  const usdRate = num(s.usd_exchange_rate) || 1;

  // 填了账号密码：登录读账户钱包余额与总消费（用户视角），无限额度 Key 也能看到
  let loginRes = null;
  if (login && login.length) {
    loginRes = await newapiLogin(base, login, qpu, insecure);
  }

  let wallet = null;
  let kind = "";
  let used = null;
  let warning = '';
  const tok = await httpJson(`${base}/api/usage/token/`, { key, insecure });
  const td = tok.ok ? tok.json.data : null;
  if (td && num(td.total_used) !== null) used = num(td.total_used) / qpu; // 这把 Key 的累计已用
  if (tok.ok && tok.json.code === false && !loginRes?.ok) throw new Error(`读取余额失败：${tok.json.message || "Key 无效"}`);
  if (loginRes?.ok) {
    // 账户维度：钱包余额和总消费都是用户在控制台看到的数字
    wallet = loginRes.wallet;
    used = loginRes.used;
    kind = "login";
  } else if (td && !td.unlimited_quota && num(td.total_available) !== null) {
    wallet = num(td.total_available) / qpu;
    kind = "token";
  } else {
    const [sub, use] = await Promise.all([
      httpJson(`${base}/v1/dashboard/billing/subscription`, { key, insecure }),
      httpJson(`${base}/v1/dashboard/billing/usage`, { key, insecure }),
    ]);
    const subErr = !sub.ok
      ? (sub.status === 401 ? "Key 无效、已过期或额度用尽" : sub.error)
      : sub.json.error ? sub.json.error.message || "未知错误" : num(sub.json.hard_limit_usd) === null ? "返回里没有 hard_limit_usd" : "";
    // 钱包接口失败（如 Key 所在分组已无权访问），但令牌信息读得到：照样记录累计消费和倍率
    if (subErr && !td) throw new Error(`读取余额失败：${subErr}`);
    if (subErr) warning = `读不到钱包余额：${subErr}（累计消费和倍率正常）`;
    const hard = subErr ? 0 : num(sub.json.hard_limit_usd);
    // 无限额度的 Key + 站点按令牌统计：读不到钱包，但累计消费和倍率照样能拿到
    if (!subErr && hard >= 1e8 - 1) warning = "这把 Key 是无限额度，而供应商站点按「令牌」统计额度，读不到钱包余额（累计消费和倍率正常）。要看余额，请在供应商站点给这把 Key 设一个额度上限，或换成有额度上限的 Key";
    const usage = (num(use.ok ? use.json.total_usage : 0) || 0) / 100;
    let remaining = hard - usage;
    let spent = usage;
    if (display === "CNY") {
      remaining /= usdRate;
      spent /= usdRate;
    } else if (display === "TOKENS") {
      remaining /= qpu;
      spent /= qpu;
    }
    if (used === null) used = spent;
    if (!warning) {
      wallet = remaining;
      kind = "wallet";
    }
  }
  // 登录成功：钱包和消费以账户为准，清掉 Key 维度读不到钱包的提示；登录失败则记一句
  if (loginRes?.ok) warning = "";
  else if (loginRes) warning = `账号密码登录失败：${loginRes.error}${warning ? `；${warning}` : ""}`;
  const loginUsed = loginRes?.ok ? { user: loginRes.user, pass: loginRes.pass } : null;
  if (!wantRatio) return { wallet, kind, used, warning, loginUsed };

  let ratio = null;
  let source = "";
  // 登录拿到分组时，优先用该分组的倍率
  if (loginRes?.ok && loginRes.group) {
    const p = await httpJson(`${base}/api/pricing`, { key, insecure });
    const gr = p.ok ? p.json.group_ratio : null;
    if (gr && num(gr[loginRes.group]) !== null) {
      ratio = num(gr[loginRes.group]);
      source = `group:${loginRes.group}`;
    }
  }
  const logs = ratio !== null ? { ok: false } : await httpJson(`${base}/api/log/token`, { key, insecure });
  const list = logs.ok && Array.isArray(logs.json.data) ? logs.json.data : Array.isArray(logs.json?.data?.items) ? logs.json.data.items : [];
  for (const l of [...list].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))) {
    let o = l.other;
    if (typeof o === "string") {
      try {
        o = JSON.parse(o);
      } catch {
        o = null;
      }
    }
    const g = num(o?.group_ratio);
    if (g === null) continue;
    const ug = num(o?.user_group_ratio);
    ratio = ug !== null && ug >= 0 ? ug : g;
    source = `log${l.group ? `:${l.group}` : ""}`;
    break;
  }
  if (ratio === null) {
    const p = await httpJson(`${base}/api/pricing`, { insecure });
    const gr = p.ok ? p.json.group_ratio : null;
    if (gr && num(gr.default) !== null) {
      ratio = num(gr.default);
      source = "pricing-default";
    } else source = "读不到倍率（这把 Key 还没有消费记录，且站点没公开分组倍率）";
  }
  return { wallet, kind, used, ratio, source, warning, loginUsed };
}

async function fetchWallet(w) {
  const base = baseOf(w.base_url);
  const wantRatio = !w.custom;
  const insecure = !!w.insecure;
  // 账号密码：优先用这把 Key 自己填的；没填时把传进来的候选组合都试一遍（批量导入用）
  const login = w.login_user && w.login_pass ? [[w.login_user, w.login_pass]] : Array.isArray(w.login_candidates) ? w.login_candidates : [];
  const r =
    w.platform === "sub2api"
      ? await fetchSub2api(base, w.api_key, wantRatio, insecure)
      : await fetchNewapi(base, w.api_key, wantRatio, login, insecure);
  const ratio = w.custom ? num(w.custom_ratio) : r.ratio ?? null;
  const wallet = r.wallet === null ? null : round(r.wallet, 4);
  // 自定义倍率：实际余额 = 钱包 × 倍率；普通模式：实际余额 = 钱包
  const actual = wallet === null ? null : w.custom ? (ratio === null ? null : round(wallet * ratio, 4)) : wallet;
  const used = r.used === null || r.used === undefined ? null : round(r.used, 4);
  const usedActual = used === null ? null : w.custom ? (ratio === null ? null : round(used * ratio, 4)) : used;
  return { wallet, kind: r.kind, ratio, source: w.custom ? "custom" : r.source || "", actual, used, usedActual, warning: r.warning || "", loginUsed: r.loginUsed || null };
}

// ---------- 存储与路由 ----------
function setupPartyWallets({ app, db, auth, HttpError, onChanged }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS party_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '默认',
      platform TEXT NOT NULL DEFAULT 'newapi',
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      custom INTEGER NOT NULL DEFAULT 0,
      custom_ratio REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_wallet REAL,
      last_wallet_kind TEXT NOT NULL DEFAULT '',
      last_ratio REAL,
      last_ratio_source TEXT NOT NULL DEFAULT '',
      last_actual REAL,
      last_error TEXT NOT NULL DEFAULT '',
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_party_wallets_party ON party_wallets(party_id);
  `);
  // 迁移：累计消费（这把 Key 在供应商站点总共用了多少；自定义倍率时另存 × 倍率后的实际消费）
  for (const col of ['last_used', 'last_used_actual']) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('party_wallets') WHERE name = ?").get(col)) db.exec(`ALTER TABLE party_wallets ADD COLUMN ${col} REAL`);
  }
  // 迁移：new-api 账号密码登录（读账户钱包与总消费，用户视角）、跳过证书校验
  for (const [col, ddl] of [['login_user', "TEXT NOT NULL DEFAULT ''"], ['login_pass', "TEXT NOT NULL DEFAULT ''"], ['insecure', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('party_wallets') WHERE name = ?").get(col)) db.exec(`ALTER TABLE party_wallets ADD COLUMN ${col} ${ddl}`);
  }
  const getOne = db.prepare('SELECT * FROM party_wallets WHERE id = ?');
  const ofParty = db.prepare('SELECT * FROM party_wallets WHERE party_id = ? ORDER BY id');
  const party = db.prepare("SELECT * FROM parties WHERE id = ? AND kind = 'supplier'");

  // Key / 密码不回传，只给脱敏信息
  const view = (w) => {
    const { api_key, login_pass, ...rest } = w;
    return {
      ...rest,
      custom: !!w.custom,
      enabled: !!w.enabled,
      insecure: !!w.insecure,
      has_key: !!api_key,
      key_masked: api_key ? `${api_key.slice(0, 5)}…${api_key.slice(-4)}` : '',
      has_login: !!(w.login_user && login_pass),
    };
  };

  function input(b, partial) {
    const out = {};
    if (!partial || 'name' in b) out.name = str(b.name, 60) || '默认';
    if (!partial || 'platform' in b) {
      if (!PLATFORMS.includes(b.platform)) throw new HttpError(400, '平台只能是 new-api 或 sub2api');
      out.platform = b.platform;
    }
    if (!partial || 'base_url' in b) {
      out.base_url = str(b.base_url, 300).replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(out.base_url)) throw new HttpError(400, '站点地址需以 http:// 或 https:// 开头');
    }
    if (!partial || 'custom' in b) out.custom = b.custom ? 1 : 0;
    if (!partial || 'custom_ratio' in b) out.custom_ratio = num(b.custom_ratio);
    if (!partial || 'enabled' in b) out.enabled = b.enabled === false ? 0 : 1;
    if (!partial || 'insecure' in b) out.insecure = b.insecure ? 1 : 0;
    if (!partial || 'login_user' in b) out.login_user = str(b.login_user, 120);
    // 清空登录：login_user 传空串时一并清掉密码；否则密码留空 = 保持原值
    if ('login_user' in b && !str(b.login_user, 120)) out.login_pass = '';
    else if (str(b.login_pass, 200)) out.login_pass = str(b.login_pass, 200);
    if (str(b.api_key, 500)) out.api_key = str(b.api_key, 500); // 留空 = 保持原值
    return out;
  }
  const checkCustom = (w) => { if (w.custom && !(num(w.custom_ratio) > 0)) throw new HttpError(400, '自定义倍率必须大于 0'); };

  async function refresh(id) {
    const w = getOne.get(id);
    if (!w) throw new HttpError(404, '余额监控不存在');
    const t = nowIso();
    try {
      if (!w.api_key) throw new Error('还没有填 API Key');
      const r = await fetchWallet(w);
      db.prepare("UPDATE party_wallets SET last_wallet = ?, last_wallet_kind = ?, last_ratio = ?, last_ratio_source = ?, last_actual = ?, last_used = ?, last_used_actual = ?, last_error = ?, last_checked_at = ? WHERE id = ?")
        .run(r.wallet, r.kind, r.ratio, r.source, r.actual, r.used, r.usedActual, r.warning, t, id);
      // 批量试出来的账号密码存下来，以后自动刷新直接用
      if (r.loginUsed && (r.loginUsed.user !== w.login_user || r.loginUsed.pass !== w.login_pass)) {
        db.prepare('UPDATE party_wallets SET login_user = ?, login_pass = ? WHERE id = ?').run(r.loginUsed.user, r.loginUsed.pass, id);
      }
    } catch (e) {
      db.prepare('UPDATE party_wallets SET last_error = ?, last_checked_at = ? WHERE id = ?').run(redact(e.message, w.api_key), t, id);
    }
    return view(getOne.get(id));
  }

  app.get('/api/parties/:id/wallets', auth, (req, res) => res.json({ wallets: ofParty.all(Number(req.params.id)).map(view) }));
  app.post('/api/parties/:id/wallets', auth, async (req, res) => {
    const pa = party.get(Number(req.params.id));
    if (!pa) throw new HttpError(404, '供应商不存在（只有供应商可以绑定余额）');
    const v = input(req.body || {}, false);
    if (!v.api_key) throw new HttpError(400, 'API Key 必填');
    checkCustom(v);
    const t = nowIso();
    const cols = { party_id: pa.id, ...v, created_at: t, updated_at: t };
    const keys = Object.keys(cols);
    const r = db.prepare(`INSERT INTO party_wallets (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
    const w = await refresh(Number(r.lastInsertRowid)); // 加完立即抓一次
    onChanged(req.user, `给供应商「${pa.name}」添加了余额监控「${w.name}」`);
    res.json({ wallet: w });
  });
  app.patch('/api/party-wallets/:id', auth, async (req, res) => {
    const w = getOne.get(Number(req.params.id));
    if (!w) throw new HttpError(404, '余额监控不存在');
    const v = input(req.body || {}, true);
    checkCustom({ ...w, ...v });
    const keys = Object.keys(v);
    if (keys.length) db.prepare(`UPDATE party_wallets SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => v[k]), nowIso(), w.id);
    const out = await refresh(w.id); // 改了平台 / Key / 倍率后按新参数重抓
    onChanged(req.user, `修改了余额监控「${out.name}」`);
    res.json({ wallet: out });
  });
  app.delete('/api/party-wallets/:id', auth, (req, res) => {
    const w = getOne.get(Number(req.params.id));
    if (!w) throw new HttpError(404, '余额监控不存在');
    db.prepare('DELETE FROM party_wallets WHERE id = ?').run(w.id);
    onChanged(req.user, `删除了余额监控「${w.name}」`);
    res.json({ ok: true });
  });
  app.post('/api/party-wallets/:id/refresh', auth, async (req, res) => res.json({ wallet: await refresh(Number(req.params.id)) }));
  // 刷新全部（侧栏「供应商」页的「全部刷新」）
  app.post('/api/wallets/refresh', auth, async (req, res) => {
    const ids = db.prepare('SELECT w.id FROM party_wallets w JOIN parties p ON p.id = w.party_id WHERE w.enabled = 1 AND p.archived = 0 ORDER BY w.id').all().map((r) => r.id);
    const out = [];
    for (const id of ids) out.push(await refresh(id));
    res.json({ wallets: out });
  });
  // 刷新一个项目下所有供应商的余额
  app.post('/api/projects/:id/wallets/refresh', auth, async (req, res) => {
    const ids = db.prepare('SELECT w.id FROM party_wallets w JOIN parties p ON p.id = w.party_id WHERE p.project_id = ? AND w.enabled = 1 ORDER BY w.id').all(Number(req.params.id)).map((r) => r.id);
    const out = [];
    for (const id of ids) out.push(await refresh(id));
    res.json({ wallets: out });
  });

  // 定时刷新：每 30 分钟串行抓一遍（启用的、未归档的供应商）
  const loop = async () => {
    const ids = db.prepare('SELECT w.id FROM party_wallets w JOIN parties p ON p.id = w.party_id WHERE w.enabled = 1 AND p.archived = 0 ORDER BY w.id').all().map((r) => r.id);
    for (const id of ids) await refresh(id).catch((e) => console.error('[party-wallet]', e.message));
    setTimeout(loop, LOOP_MS).unref();
  };
  setTimeout(loop, 30_000).unref();

  // 往来单位卡片用：每家供应商的余额汇总
  const sumStmt = db.prepare("SELECT count(*) AS n, sum(last_actual) AS actual, sum(last_used_actual) AS used, sum(CASE WHEN last_error != '' THEN 1 ELSE 0 END) AS errors FROM party_wallets WHERE party_id = ? AND enabled = 1");
  return {
    listOf: (partyId) => ofParty.all(partyId).map(view),
    summaryOf(partyId) {
      const r = sumStmt.get(partyId);
      return r && r.n ? { count: r.n, actual: r.actual === null ? null : round(r.actual, 4), used: r.used === null ? null : round(r.used, 4), errors: r.errors } : null;
    },
  };
}

module.exports = { setupPartyWallets, fetchWallet, PLATFORMS };
