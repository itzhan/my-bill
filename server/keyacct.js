// 上 key 项目：甲方给一个 new-api 台子，各供应商把 key 上成渠道，渠道名以供应商的前缀开头（如 ls-xo-1019-148）。
// 定时按前缀抓台子渠道的累计 used_quota（只读 GET），按渠道存快照、做差得到每日消耗：
// - 供应商应付 = Σ 消耗 × 前缀价格（可按分组覆盖）
// - 甲方应收   = Σ 消耗 × 分组价格
// 价格两种：discount 折扣（美金 × 折扣 × 汇率）/ cny 人民币单价（美金 × 每刀多少元）。
// 结果按天写成往来记录（party_records，source = 'key'，幂等），实付 / 实收沿用往来里的记录。
'use strict';

const TIMEOUT_MS = 30_000;
const LOOP_MS = 5 * 60_000;
const PAGE_SIZE = 100;
const DEFAULT_BASE = 'https://ethanplum.com';
const DEFAULT_QPU = 500000; // new-api 默认 500000 额度 = $1

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

function setupKeyAccounting({ app, db, auth, HttpError, getRates, todayKey, dayOf, addDays, onChanged, onAccrued }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS key_sites (
      project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      base_url TEXT NOT NULL DEFAULT '', cookie TEXT NOT NULL DEFAULT '', user_id TEXT NOT NULL DEFAULT '2',
      quota_per_usd REAL NOT NULL DEFAULT ${DEFAULT_QPU}, customer_party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
      last_sync_at TEXT, last_error TEXT NOT NULL DEFAULT ''
    );
    -- 供应商前缀；initialized = 已抓过一次（之后新出现的渠道算当天新增，否则算期初）
    CREATE TABLE IF NOT EXISTS key_prefixes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE, prefix TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      initialized INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE (project_id, prefix)
    );
    -- 价格：prefix_id = 0 为甲方分组价；grp = '' 为该前缀 / 甲方的默认价（没有单独设分组价时用）
    CREATE TABLE IF NOT EXISTS key_prices (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, prefix_id INTEGER NOT NULL, grp TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('discount', 'cny')), value REAL NOT NULL, PRIMARY KEY (project_id, prefix_id, grp)
    );
    -- 渠道快照：台子上删掉的渠道照样保留，已跑的额度不丢
    CREATE TABLE IF NOT EXISTS key_channels (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, channel_id INTEGER NOT NULL,
      name TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '', status INTEGER, used_quota INTEGER NOT NULL DEFAULT 0,
      opening_quota INTEGER NOT NULL DEFAULT 0, opening_date TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY (project_id, channel_id)
    );
    -- 每个渠道每天新增的额度
    CREATE TABLE IF NOT EXISTS key_usage (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, channel_id INTEGER NOT NULL,
      date TEXT NOT NULL, quota INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (project_id, channel_id, date)
    );
    -- 每天折算用的美元汇率（第一次挂账时定下，之后改汇率不影响历史）
    CREATE TABLE IF NOT EXISTS key_day_rates (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, date TEXT NOT NULL, usd_rate REAL NOT NULL,
      PRIMARY KEY (project_id, date)
    );
  `);

  // 梯度价：tiers = [{ from: 美金门槛, value }]，同一价格行内累计消耗超过门槛的部分按该档计价（计价方式同基础价）
  try { db.exec("ALTER TABLE key_prices ADD COLUMN tiers TEXT NOT NULL DEFAULT ''"); } catch { /* 已有该列 */ }
  // 只统计哪些分组（逗号分隔，空 = 全部）；按开头匹配，azure 也包含 azure_eus 等。用于 Azure / Vertex 项目各算各的
  try { db.exec("ALTER TABLE key_sites ADD COLUMN groups TEXT NOT NULL DEFAULT ''"); } catch { /* 已有该列 */ }

  const q = {
    project: db.prepare('SELECT * FROM projects WHERE id = ?'),
    site: db.prepare('SELECT * FROM key_sites WHERE project_id = ?'),
    ensureSite: db.prepare('INSERT OR IGNORE INTO key_sites (project_id) VALUES (?)'),
    // 已归档的上 key 项目照常同步（归档只是不能再记账）
    keyProjects: db.prepare("SELECT id FROM projects WHERE ptype = 'key' ORDER BY id"),
    prefixes: db.prepare('SELECT k.*, pa.name AS party_name FROM key_prefixes k JOIN parties pa ON pa.id = k.party_id WHERE k.project_id = ? ORDER BY k.prefix'),
    prefix: db.prepare('SELECT * FROM key_prefixes WHERE id = ?'),
    prices: db.prepare('SELECT * FROM key_prices WHERE project_id = ?'),
    putPrice: db.prepare('INSERT INTO key_prices (project_id, prefix_id, grp, mode, value, tiers) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, prefix_id, grp) DO UPDATE SET mode = excluded.mode, value = excluded.value, tiers = excluded.tiers'),
    delPrice: db.prepare('DELETE FROM key_prices WHERE project_id = ? AND prefix_id = ? AND grp = ?'),
    channels: db.prepare('SELECT * FROM key_channels WHERE project_id = ?'),
    channel: db.prepare('SELECT * FROM key_channels WHERE project_id = ? AND channel_id = ?'),
    insChannel: db.prepare('INSERT INTO key_channels (project_id, channel_id, name, grp, status, used_quota, opening_quota, opening_date, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updChannel: db.prepare('UPDATE key_channels SET name = ?, grp = ?, status = ?, used_quota = ?, last_seen = ? WHERE project_id = ? AND channel_id = ?'),
    addUsage: db.prepare('INSERT INTO key_usage (project_id, channel_id, date, quota) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, channel_id, date) DO UPDATE SET quota = quota + excluded.quota'),
    usage: db.prepare('SELECT * FROM key_usage WHERE project_id = ?'),
    dayRates: db.prepare('SELECT * FROM key_day_rates WHERE project_id = ?'),
    putDayRate: db.prepare('INSERT OR IGNORE INTO key_day_rates (project_id, date, usd_rate) VALUES (?, ?, ?)'),
    keyRecords: db.prepare("SELECT r.* FROM party_records r JOIN parties pa ON pa.id = r.party_id WHERE pa.project_id = ? AND r.source = 'key'"),
    recordsOfParty: db.prepare('SELECT * FROM party_records WHERE party_id = ?'),
    party: db.prepare('SELECT * FROM parties WHERE id = ?'),
    insRecord: db.prepare("INSERT INTO party_records (party_id, kind, amount, currency, rate, date, note, source, external_ref, created_at) VALUES (?, 'due', ?, ?, ?, ?, ?, 'key', ?, ?)"),
    updRecord: db.prepare('UPDATE party_records SET amount = ?, currency = ?, rate = ?, date = ?, note = ? WHERE id = ?'),
    delRecord: db.prepare('DELETE FROM party_records WHERE id = ?'),
  };

  const custOfProject = db.prepare("SELECT id FROM parties WHERE project_id = ? AND kind = 'customer' AND archived = 0");
  const siteOf = (projectId) => {
    q.ensureSite.run(projectId);
    const s = q.site.get(projectId);
    // 还没选甲方、项目里正好只有一个客户：直接认定为甲方
    if (!s.customer_party_id) {
      const cs = custOfProject.all(projectId);
      if (cs.length === 1) { db.prepare('UPDATE key_sites SET customer_party_id = ? WHERE project_id = ?').run(cs[0].id, projectId); s.customer_party_id = cs[0].id; accrue(projectId); }
    }
    return s;
  };
  const cookieOf = (s) => s.cookie || process.env.KEY_NEWAPI_COOKIE || '';
  const baseOf = (s) => (s.base_url || process.env.KEY_NEWAPI_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const qpuOf = (s) => (Number(s.quota_per_usd) > 0 ? Number(s.quota_per_usd) : DEFAULT_QPU);
  const keyProject = (id) => {
    const p = q.project.get(Number(id));
    if (!p) throw new HttpError(404, '项目不存在');
    if (p.ptype !== 'key') throw new HttpError(400, '不是上 key 项目');
    return p;
  };

  // ---------- 抓取 ----------
  async function searchChannels(s, keyword) {
    const cookie = cookieOf(s);
    if (!cookie) throw new Error('未配置台子 Cookie');
    const out = [];
    for (let p = 1; p <= 200; p++) {
      const url = `${baseOf(s)}/api/channel/search?keyword=${encodeURIComponent(keyword)}&group=&model=&id_sort=false&tag_mode=false&p=${p}&page_size=${PAGE_SIZE}`;
      const res = await fetch(url, { headers: { Accept: 'application/json', 'New-Api-User': s.user_id || '2', Cookie: cookie, 'Cache-Control': 'no-store' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let d; try { d = JSON.parse(text); } catch { throw new Error(`台子返回 ${res.status}：${text.slice(0, 80)}`); }
      if (!d.success) throw new Error(`台子返回失败：${str(d.message, 120) || res.status}（Cookie 可能已过期）`);
      const items = (d.data && d.data.items) || [];
      out.push(...items);
      if (!items.length || out.length >= Number(d.data.total || 0)) break;
    }
    return out;
  }

  // 渠道名归到最长匹配的前缀（ls-xo-m-… 归 ls-xo-m，不会算进 ls-xo）
  const matchPrefix = (name, prefixes) => {
    let best = null;
    for (const k of prefixes) if (name.startsWith(k.prefix) && (!best || k.prefix.length > best.prefix.length)) best = k;
    return best;
  };

  const syncing = new Set();
  // day：这次增量记到哪天。定时同步对齐整 5 分钟，传「本轮开始前 1 秒」所在日期——
  // 00:00 那轮收的是 23:55–00:00 的量，记前一天；之后各轮记当天。即 今日消耗 = 现在累计 − 0 点快照
  async function syncProject(projectId, day = todayKey()) {
    if (syncing.has(projectId)) return;
    syncing.add(projectId);
    const s = siteOf(projectId);
    const stamp = new Date().toISOString();
    try {
      const prefixes = q.prefixes.all(projectId);
      const fetched = new Map(); // channel_id -> { item, prefix }（按前缀搜，名称再精确过滤）
      for (const k of prefixes) {
        for (const it of await searchChannels(s, k.prefix)) {
          // 台子上有的渠道名带首尾空格（如 " ls-0xma"），先去掉再匹配
          it.name = String(it.name || '').trim();
          if (!it.name.startsWith(k.prefix)) continue;
          const best = matchPrefix(it.name, prefixes);
          // 前缀添加前就存在的渠道是历史存量（期初）；之后才创建的是新上的 key，额度记到当天
          const fresh = !!best && !!best.initialized && Number(it.created_time) * 1000 >= Date.parse(best.created_at);
          if (best && !fetched.has(it.id)) fetched.set(it.id, { it, initialized: fresh });
        }
      }
      const today = day;
      const openingDate = addDays(todayKey(), -1);
      db.exec('BEGIN');
      try {
        for (const [id, { it, initialized }] of fetched) {
          const used = Math.max(0, Math.round(Number(it.used_quota) || 0));
          const ex = q.channel.get(projectId, id);
          if (!ex) {
            // 新渠道：历史存量记期初，新上的 key 记当天
            if (initialized) { q.insChannel.run(projectId, id, it.name, str(it.group, 100), it.status ?? null, used, 0, '', stamp, stamp); if (used > 0) q.addUsage.run(projectId, id, today, used); }
            else q.insChannel.run(projectId, id, it.name, str(it.group, 100), it.status ?? null, used, used, used > 0 ? openingDate : '', stamp, stamp);
          } else {
            const delta = used - ex.used_quota;
            if (delta > 0) q.addUsage.run(projectId, id, today, delta);
            q.updChannel.run(it.name, str(it.group, 100), it.status ?? null, used, stamp, projectId, id);
          }
        }
        for (const k of prefixes) if (!k.initialized) db.prepare('UPDATE key_prefixes SET initialized = 1 WHERE id = ?').run(k.id);
        db.prepare("UPDATE key_sites SET last_sync_at = ?, last_error = '' WHERE project_id = ?").run(stamp, projectId);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      accrue(projectId);
    } catch (e) {
      db.prepare('UPDATE key_sites SET last_sync_at = ?, last_error = ? WHERE project_id = ?').run(stamp, str(e.message, 300), projectId);
      console.error(`[key] 项目 #${projectId} 同步失败：${e.message}`);
    } finally { syncing.delete(projectId); }
  }

  // ---------- 计价 ----------
  function priceBook(projectId) {
    const m = new Map();
    for (const p of q.prices.all(projectId)) m.set(`${p.prefix_id}|${p.grp}`, { ...p, tiers: tiersOf(p) });
    // 先找该分组的价，没有再用默认价（grp = ''）
    return (prefixId, grp) => m.get(`${prefixId}|${grp}`) || m.get(`${prefixId}|`) || null;
  }
  const tiersOf = (p) => { try { const t = JSON.parse(p.tiers || '[]'); return Array.isArray(t) ? t : []; } catch { return []; } };
  const toCny = (usd, price, usdRate) => (!price ? 0 : price.mode === 'cny' ? usd * price.value : usd * price.value * usdRate);
  const unitLabel = (mode, v) => (mode === 'cny' ? `¥${v}/刀` : `折扣 ×${v}`);
  const priceLabel = (p) => (!p ? '未定价' : [unitLabel(p.mode, p.value), ...tiersOf(p).map((t) => `$${t.from.toLocaleString('en-US')} 起 ${unitLabel(p.mode, t.value)}`)].join('；'));
  // 梯度计价：这一笔 usd 之前该价格行已累计 before 美金，按各档区间拆开计价
  function tieredCny(usd, price, usdRate, before) {
    const steps = [{ from: 0, value: price.value }, ...price.tiers];
    let cny = 0;
    for (let i = 0; i < steps.length; i++) {
      const lo = Math.max(steps[i].from, before);
      const hi = Math.min(i + 1 < steps.length ? steps[i + 1].from : Infinity, before + usd);
      if (hi > lo) cny += toCny(hi - lo, { mode: price.mode, value: steps[i].value }, usdRate);
    }
    return cny;
  }
  // 供应商应付：按时间顺序（期初在前）逐桶累计，每个价格行（前缀 + 分组 / 默认）单独计梯度。返回 桶 → 人民币
  function supplierCosts(bs, price, rateOf) {
    const used = new Map();
    const out = new Map();
    const order = [...bs].sort((a, b) => (a.opening !== b.opening ? (a.opening ? -1 : 1) : a.date.localeCompare(b.date)));
    for (const b of order) {
      const pr = price(b.prefix.id, b.grp);
      if (!pr) { out.set(b, 0); continue; }
      const k = `${b.prefix.id}|${pr.grp}`;
      const before = used.get(k) || 0;
      out.set(b, tieredCny(b.usd, pr, rateOf(b.date), before));
      used.set(k, before + b.usd);
    }
    return out;
  }

  const groupsOf = (s) => String(s.groups || '').split(',').map((g) => g.trim()).filter(Boolean);
  // 本项目统计范围内的渠道（设了分组范围时，其他分组的渠道不计入）
  const scopedChannels = (s) => {
    const gs = groupsOf(s);
    const all = q.channels.all(s.project_id);
    return gs.length ? all.filter((c) => gs.some((g) => c.grp.startsWith(g))) : all;
  };
  // 汇总成 桶 = (日期, 是否期初, 前缀, 分组) → 美金
  function buckets(projectId) {
    const s = siteOf(projectId);
    const qpu = qpuOf(s);
    const prefixes = q.prefixes.all(projectId);
    const chans = new Map(scopedChannels(s).map((c) => [c.channel_id, c]));
    const out = new Map();
    const add = (date, opening, ch, quota) => {
      const k = matchPrefix(ch.name, prefixes);
      if (!k || quota <= 0) return;
      const key = `${date}|${opening ? 1 : 0}|${k.id}|${ch.grp}`;
      const b = out.get(key) || { date, opening, prefix: k, grp: ch.grp, usd: 0 };
      b.usd += quota / qpu;
      out.set(key, b);
    };
    for (const c of chans.values()) if (c.opening_quota > 0) add(c.opening_date || c.first_seen.slice(0, 10), true, c, c.opening_quota);
    for (const u of q.usage.all(projectId)) { const c = chans.get(u.channel_id); if (c) add(u.date, false, c, u.quota); }
    return [...out.values()];
  }

  // 由快照重算该项目全部自动挂账（价格改了也会跟着变；每天的汇率固定为当天第一次挂账时的汇率）
  function accrue(projectId) {
    const s = siteOf(projectId);
    const price = priceBook(projectId);
    const rates = getRates();
    const dayRate = new Map(q.dayRates.all(projectId).map((r) => [r.date, r.usd_rate]));
    const rateOf = (date) => { if (!dayRate.has(date)) { q.putDayRate.run(projectId, date, rates.USD); dayRate.set(date, rates.USD); } return dayRate.get(date); };
    const want = new Map(); // ref -> { party_id, date, cny, usd, note parts }
    const put = (ref, partyId, date, cny, usd, opening) => {
      const w = want.get(ref) || { partyId, date, cny: 0, usd: 0, opening };
      w.cny += cny; w.usd += usd; want.set(ref, w);
    };
    const cust = s.customer_party_id ? q.party.get(s.customer_party_id) : null;
    const bs = buckets(projectId);
    const cost = supplierCosts(bs, price, rateOf);
    for (const b of bs) {
      const tag = b.opening ? `opening:${b.date}` : b.date;
      const ur = rateOf(b.date);
      put(`key:${projectId}:${b.prefix.party_id}:${tag}`, b.prefix.party_id, b.date, cost.get(b), b.usd, b.opening);
      if (cust) put(`key:${projectId}:${cust.id}:${tag}`, cust.id, b.date, toCny(b.usd, price(0, b.grp), ur), b.usd, b.opening);
    }
    let changed = false;
    db.exec('BEGIN');
    try {
      const existing = new Map(q.keyRecords.all(projectId).map((r) => [r.external_ref, r]));
      for (const [ref, w] of want) {
        const pa = q.party.get(w.partyId);
        if (!pa) continue;
        const cur = pa.currency || 'CNY';
        const rate = cur === 'CNY' ? 1 : (cur === 'USD' ? rateOf(w.date) : rates[cur]);
        const amount = r2(cur === 'CNY' ? w.cny : w.cny / rate);
        const note = `${w.opening ? `期初（${w.date} 及以前）` : '台子'}消耗 $${w.usd.toFixed(2)}`;
        const ex = existing.get(ref);
        existing.delete(ref);
        if (amount <= 0) { if (ex) { q.delRecord.run(ex.id); changed = true; } continue; }
        if (!ex) { q.insRecord.run(pa.id, amount, cur, rate, w.date, note, ref, new Date().toISOString()); changed = true; }
        else if (Math.abs(ex.amount - amount) >= 0.01 || ex.currency !== cur || ex.note !== note) q.updRecord.run(amount, cur, rate, w.date, note, ex.id);
      }
      // 前缀删了 / 换了供应商 / 去掉了价格：多出来的旧挂账删掉
      for (const ex of existing.values()) { q.delRecord.run(ex.id); changed = true; }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    if (changed) onAccrued();
  }

  // ---------- 视图 ----------
  function settleOf(partyId) {
    const rows = q.recordsOfParty.all(partyId);
    const base = (r) => (r.currency === 'CNY' ? r.amount : r.amount * (Number(r.rate) || 0));
    let due = 0, paid = 0;
    for (const r of rows) { if (r.kind === 'due') due += base(r); else paid += base(r); }
    const open = r2(due - paid);
    return { due_cny: r2(due), paid_cny: r2(paid), open_cny: open > 0 ? open : 0, credit_cny: open < 0 ? -open : 0 };
  }
  function view(projectId) {
    const p = keyProject(projectId);
    const s = siteOf(p.id);
    const price = priceBook(p.id);
    const prefixes = q.prefixes.all(p.id);
    const today = todayKey();
    const dayRate = new Map(q.dayRates.all(p.id).map((r) => [r.date, r.usd_rate]));
    const usdRate = getRates().USD;
    const rateOf = (d) => dayRate.get(d) ?? usdRate;
    const chans = scopedChannels(s);
    const perPrefix = new Map(prefixes.map((k) => [k.id, { channels: 0, active: 0, missing: 0, groups: new Map() }]));
    for (const c of chans) {
      const k = matchPrefix(c.name, prefixes);
      if (!k) continue;
      const x = perPrefix.get(k.id);
      x.channels += 1;
      if (c.status === 1) x.active += 1;
      if (s.last_sync_at && c.last_seen < s.last_sync_at && !s.last_error) x.missing += 1;
    }
    const groupSet = new Set(chans.map((c) => c.grp));
    const groups = new Map(); // 甲方分组
    const daily = new Map();
    const totals = { usd: 0, today_usd: 0, payable: 0, receivable: 0 };
    const bs = buckets(p.id);
    const cost = supplierCosts(bs, price, rateOf);
    for (const b of bs) {
      const ur = rateOf(b.date);
      const pay = cost.get(b);
      const rec = s.customer_party_id ? toCny(b.usd, price(0, b.grp), ur) : 0;
      const isToday = !b.opening && b.date === today;
      const pg = perPrefix.get(b.prefix.id).groups;
      const g1 = pg.get(b.grp) || { grp: b.grp, usd: 0, today_usd: 0, payable: 0 };
      g1.usd += b.usd; g1.payable += pay; if (isToday) g1.today_usd += b.usd; pg.set(b.grp, g1);
      const g2 = groups.get(b.grp) || { grp: b.grp, usd: 0, today_usd: 0, receivable: 0 };
      g2.usd += b.usd; g2.receivable += rec; if (isToday) g2.today_usd += b.usd; groups.set(b.grp, g2);
      totals.usd += b.usd; totals.payable += pay; totals.receivable += rec; if (isToday) totals.today_usd += b.usd;
      const dk = b.opening ? `期初 ${b.date}` : b.date;
      const d = daily.get(dk) || { date: dk, opening: b.opening, usd: 0, payable: 0, receivable: 0 };
      d.usd += b.usd; d.payable += pay; d.receivable += rec; daily.set(dk, d);
    }
    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? (k.endsWith('usd') ? r4(v) : r2(v)) : v]));
    const supplierIds = [...new Set(prefixes.map((k) => k.party_id))];
    const priceView = (pr) => (pr ? { mode: pr.mode, value: pr.value, tiers: tiersOf(pr), label: priceLabel(pr) } : null);
    const cookie = cookieOf(s);
    return {
      site: {
        base_url: s.base_url, effective_base: baseOf(s), user_id: s.user_id, quota_per_usd: qpuOf(s), customer_party_id: s.customer_party_id, groups: s.groups || '',
        has_cookie: !!s.cookie, cookie_from_env: !s.cookie && !!cookie, cookie_masked: cookie ? `${cookie.slice(0, 10)}…（${cookie.length} 字符）` : '',
        last_sync_at: s.last_sync_at, last_error: s.last_error, interval_min: LOOP_MS / 60000,
      },
      usd_rate: usdRate,
      groups_seen: [...groupSet].sort(),
      prefixes: prefixes.map((k) => {
        const x = perPrefix.get(k.id);
        const own = q.prices.all(p.id).filter((pr) => pr.prefix_id === k.id).map((pr) => ({ grp: pr.grp, ...priceView(pr) }));
        const gs = [...x.groups.values()].map((g) => ({ ...round(g), price: priceView(price(k.id, g.grp)) })).sort((a, b) => b.usd - a.usd);
        return { id: k.id, prefix: k.prefix, party_id: k.party_id, party_name: k.party_name, note: k.note, channels: x.channels, active: x.active, missing: x.missing, prices: own, groups: gs, usd: r4(gs.reduce((a, g) => a + g.usd, 0)), today_usd: r4(gs.reduce((a, g) => a + g.today_usd, 0)), payable: r2(gs.reduce((a, g) => a + g.payable, 0)), unpriced: gs.some((g) => !g.price && g.usd > 0) };
      }),
      customer: {
        party_id: s.customer_party_id,
        prices: q.prices.all(p.id).filter((pr) => pr.prefix_id === 0).map((pr) => ({ grp: pr.grp, ...priceView(pr) })),
        groups: [...groups.values()].map((g) => ({ ...round(g), price: priceView(price(0, g.grp)) })).sort((a, b) => b.usd - a.usd),
        settle: s.customer_party_id ? settleOf(s.customer_party_id) : null,
      },
      suppliers: supplierIds.map((id) => { const pa = q.party.get(id); return { party_id: id, name: pa ? pa.name : '', prefixes: prefixes.filter((k) => k.party_id === id).map((k) => k.prefix), settle: settleOf(id) }; }),
      totals: { ...round(totals), profit: r2(totals.receivable - totals.payable) },
      daily: [...daily.values()].map((d) => ({ ...round(d), profit: r2(d.receivable - d.payable) })).sort((a, b) => (a.opening !== b.opening ? (a.opening ? 1 : -1) : b.date.localeCompare(a.date))),
    };
  }

  // ---------- 路由 ----------
  const nameOf = (projectId) => q.project.get(projectId)?.name || '';
  app.get('/api/projects/:id/key', auth, (req, res) => res.json(view(req.params.id)));
  app.put('/api/projects/:id/key/site', auth, (req, res) => {
    const p = keyProject(req.params.id);
    const b = req.body || {};
    const s = siteOf(p.id);
    const base = b.base_url === undefined ? s.base_url : str(b.base_url, 200).replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) throw new HttpError(400, '台子地址需以 http(s):// 开头');
    const qpu = b.quota_per_usd === undefined ? s.quota_per_usd : Number(b.quota_per_usd);
    if (!(qpu > 0)) throw new HttpError(400, '额度换算必须大于 0');
    let cust = s.customer_party_id;
    if (b.customer_party_id !== undefined) {
      cust = b.customer_party_id ? Number(b.customer_party_id) : null;
      const pa = cust && q.party.get(cust);
      if (cust && (!pa || pa.project_id !== p.id || pa.kind !== 'customer')) throw new HttpError(400, '甲方必须是本项目的客户');
    }
    const groups = b.groups === undefined ? s.groups : str(b.groups, 200).split(/[,，\s]+/).filter(Boolean).join(',');
    db.prepare('UPDATE key_sites SET base_url = ?, cookie = ?, user_id = ?, quota_per_usd = ?, customer_party_id = ?, groups = ? WHERE project_id = ?')
      .run(base, b.cookie === undefined ? s.cookie : str(b.cookie, 4000), b.user_id === undefined ? s.user_id : str(b.user_id, 20) || '2', qpu, cust, groups, p.id);
    accrue(p.id);
    onChanged(req.user, `修改了上 key 项目「${p.name}」的台子设置`);
    res.json(view(p.id));
  });
  app.post('/api/projects/:id/key/prefixes', auth, async (req, res) => {
    const p = keyProject(req.params.id);
    const b = req.body || {};
    const prefix = str(b.prefix, 60);
    if (!prefix) throw new HttpError(400, '请填写前缀');
    const pa = q.party.get(Number(b.party_id));
    if (!pa || pa.project_id !== p.id || pa.kind !== 'supplier') throw new HttpError(400, '请选择本项目的供应商');
    if (db.prepare('SELECT 1 FROM key_prefixes WHERE project_id = ? AND prefix = ?').get(p.id, prefix)) throw new HttpError(409, `前缀「${prefix}」已存在`);
    db.prepare('INSERT INTO key_prefixes (project_id, party_id, prefix, note, created_at) VALUES (?, ?, ?, ?, ?)').run(p.id, pa.id, prefix, str(b.note, 200), new Date().toISOString());
    onChanged(req.user, `在上 key 项目「${p.name}」给供应商「${pa.name}」添加了前缀 ${prefix}`);
    await syncProject(p.id);
    res.json(view(p.id));
  });
  app.patch('/api/key-prefixes/:id', auth, (req, res) => {
    const k = q.prefix.get(Number(req.params.id));
    if (!k) throw new HttpError(404, '前缀不存在');
    const b = req.body || {};
    let partyId = k.party_id;
    if (b.party_id !== undefined) {
      const pa = q.party.get(Number(b.party_id));
      if (!pa || pa.project_id !== k.project_id || pa.kind !== 'supplier') throw new HttpError(400, '请选择本项目的供应商');
      partyId = pa.id;
    }
    db.prepare('UPDATE key_prefixes SET party_id = ?, note = ? WHERE id = ?').run(partyId, b.note === undefined ? k.note : str(b.note, 200), k.id);
    accrue(k.project_id);
    onChanged(req.user, `修改了上 key 项目「${nameOf(k.project_id)}」的前缀 ${k.prefix}`);
    res.json(view(k.project_id));
  });
  app.delete('/api/key-prefixes/:id', auth, (req, res) => {
    const k = q.prefix.get(Number(req.params.id));
    if (!k) throw new HttpError(404, '前缀不存在');
    db.prepare('DELETE FROM key_prefixes WHERE id = ?').run(k.id);
    db.prepare('DELETE FROM key_prices WHERE project_id = ? AND prefix_id = ?').run(k.project_id, k.id);
    accrue(k.project_id);
    onChanged(req.user, `删除了上 key 项目「${nameOf(k.project_id)}」的前缀 ${k.prefix}`);
    res.json(view(k.project_id));
  });
  // 设价格：prefix_id = 0 为甲方；grp 留空为默认价；value 为空删除该价格
  app.put('/api/projects/:id/key/prices', auth, (req, res) => {
    const p = keyProject(req.params.id);
    const b = req.body || {};
    const prefixId = Number(b.prefix_id) || 0;
    if (prefixId) { const k = q.prefix.get(prefixId); if (!k || k.project_id !== p.id) throw new HttpError(400, '前缀不存在'); }
    const grp = str(b.grp, 100);
    if (b.value === null || b.value === '' || b.value === undefined) q.delPrice.run(p.id, prefixId, grp);
    else {
      const mode = b.mode === 'cny' ? 'cny' : 'discount';
      const value = Number(b.value);
      if (!(value > 0) || value > 100) throw new HttpError(400, '价格必须是 0–100 之间的数字');
      // 梯度：门槛（美金）递增、各档价格同样 0–100；不传或空数组即无梯度
      const tiers = (Array.isArray(b.tiers) ? b.tiers : []).map((t) => ({ from: Math.round(Number(t.from) * 100) / 100, value: r4(Number(t.value)) }));
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i];
        if (!(t.from > 0) || (i && t.from <= tiers[i - 1].from)) throw new HttpError(400, '梯度门槛必须大于 0 且逐档递增');
        if (!(t.value > 0) || t.value > 100) throw new HttpError(400, '梯度价格必须是 0–100 之间的数字');
      }
      q.putPrice.run(p.id, prefixId, grp, mode, r4(value), tiers.length ? JSON.stringify(tiers) : '');
    }
    accrue(p.id);
    const who = prefixId ? `前缀 ${q.prefix.get(prefixId).prefix}` : '甲方';
    onChanged(req.user, `修改了上 key 项目「${p.name}」${who}${grp ? ` 分组 ${grp}` : ' 默认'}的价格`);
    res.json(view(p.id));
  });
  app.post('/api/projects/:id/key/sync', auth, async (req, res) => {
    const p = keyProject(req.params.id);
    await syncProject(p.id);
    res.json(view(p.id));
  });

  // 定时同步：对齐整 5 分钟（00:00、00:05…，上海时区与 UTC 差整小时，同样对齐）把所有进行中的上 key 项目抓一遍
  const untilTick = () => LOOP_MS - (Date.now() % LOOP_MS);
  const loop = async () => {
    const tick = Math.round(Date.now() / LOOP_MS) * LOOP_MS;
    const day = dayOf(new Date(tick - 1000));
    for (const { id } of q.keyProjects.all()) await syncProject(id, day).catch((e) => console.error('[key]', e.message));
    setTimeout(loop, untilTick()).unref();
  };
  setTimeout(loop, untilTick()).unref();

  return { syncProject };
}

module.exports = { setupKeyAccounting };
