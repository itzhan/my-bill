// 11.6 08:00(+08) 之前的历史用量只读查询模块（独立库 sub2api-hist-postgres，与运维中台同口径）
// 仅对主聚合站（PG_HIST_STATION_BASE，默认 RELAY_BASE_URL）生效，绝不写库、不污染其他中转站。
'use strict';

let Pool = null;
try {
  ({ Pool } = require('pg'));
} catch {
  Pool = null;
}

const TZ = process.env.TIMEZONE || 'Asia/Shanghai';
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 10 * 60 * 1000; // 历史库只读不变，缓存 10 分钟

const normBase = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();

const tzPartsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function tzOffsetMs(date) {
  const o = {};
  for (const p of tzPartsFmt.formatToParts(date)) o[p.type] = Number(p.value);
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - date.getTime();
}

// 团队时区某自然日 00:00:00 对应的 UTC Date
function dayStartUtc(ymd) {
  const guess = new Date(`${ymd}T00:00:00Z`);
  let d = new Date(guess.getTime() - tzOffsetMs(guess));
  d = new Date(guess.getTime() - tzOffsetMs(d));
  return d;
}

function dayEndUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return dayStartUtc(next);
}

const HOST = String(process.env.PG_HIST_HOST || '').trim();
const PORT = Number(process.env.PG_HIST_PORT) || 5435;
const USER = String(process.env.PG_HIST_USER || '').trim();
const PASSWORD = process.env.PG_HIST_PASSWORD || '';
const DATABASE = String(process.env.PG_HIST_DB || '').trim();
const UNTIL_RAW = String(process.env.PG_HIST_UNTIL || '2026-11-06T00:00:00.000Z').trim();
const HIST_UNTIL = new Date(UNTIL_RAW);
const STATION_BASE = normBase(process.env.PG_HIST_STATION_BASE || process.env.RELAY_BASE_URL || '');

const enabled = Boolean(Pool && HOST && USER && DATABASE && !Number.isNaN(HIST_UNTIL.getTime()));

const pool = enabled
  ? new Pool({
      host: HOST,
      port: PORT,
      user: USER,
      password: PASSWORD,
      database: DATABASE,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 25_000,
    })
  : null;

if (pool) {
  pool.on('error', (err) => console.error('[relay-hist] pg pool error:', err.message));
}

const cache = new Map();
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k);
  }
  return value;
}

function clearCache() {
  cache.clear();
}

function isEnabled() {
  return enabled;
}

function untilDate() {
  return HIST_UNTIL;
}

// 仅当目标中转站与配置的主站 URL 一致时才叠加历史库
function appliesTo(station, defaultBase = '') {
  if (!enabled) return false;
  const target = normBase(station ? station.base_url : defaultBase);
  if (!STATION_BASE) return true;
  if (!target) return false;
  return target === STATION_BASE;
}

// 某自然日与历史库边界的关系：'hist'（全在历史库） / 'split'（跨边界，需叠加） / 'live'（全在现网）
function dateMode(ymd) {
  if (!enabled || !RE_DATE.test(ymd || '')) return 'live';
  const s = dayStartUtc(ymd);
  const e = dayEndUtc(ymd);
  if (e <= HIST_UNTIL) return 'hist';
  if (s >= HIST_UNTIL) return 'live';
  return 'split';
}

// 将 [startDate, endDate]（闭区间自然日）与 (-Infinity, HIST_UNTIL) 求交集
function histWindow(startDate, endDate) {
  if (!enabled || !RE_DATE.test(startDate || '') || !RE_DATE.test(endDate || '')) return null;
  const s = dayStartUtc(startDate);
  const e = dayEndUtc(endDate);
  if (s >= HIST_UNTIL || e <= s) return null;
  return { start: s, end: e < HIST_UNTIL ? e : HIST_UNTIL };
}

const EMPTY_STATS = {
  total_requests: 0,
  total_actual_cost: 0,
  total_cost: 0,
  total_tokens: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
};

async function queryStats({ userId = null, apiKeyId = null, startDate, endDate }) {
  const win = histWindow(startDate, endDate);
  if (!win) return { ...EMPTY_STATS };
  const uid = userId != null && Number(userId) > 0 ? Number(userId) : null;
  const kid = apiKeyId != null && Number(apiKeyId) > 0 ? Number(apiKeyId) : null;
  const ck = `stats:${uid || ''}:${kid || ''}:${win.start.toISOString()}:${win.end.toISOString()}`;
  return cached(ck, async () => {
    const args = [win.start, win.end];
    const conds = ['created_at >= $1', 'created_at < $2'];
    if (uid) {
      args.push(uid);
      conds.push(`user_id = $${args.length}`);
    }
    if (kid) {
      args.push(kid);
      conds.push(`api_key_id = $${args.length}`);
    }
    const { rows } = await pool.query(
      `SELECT count(*)::bigint AS total_requests,
              coalesce(sum(actual_cost), 0)::float8 AS total_actual_cost,
              coalesce(sum(total_cost), 0)::float8 AS total_cost,
              coalesce(sum(input_tokens), 0)::bigint AS total_input_tokens,
              coalesce(sum(output_tokens), 0)::bigint AS total_output_tokens,
              coalesce(sum(cache_creation_tokens), 0)::bigint AS total_cache_creation_tokens,
              coalesce(sum(cache_read_tokens), 0)::bigint AS total_cache_read_tokens
         FROM usage_logs
        WHERE ${conds.join(' AND ')}`,
      args,
    );
    const r = rows[0] || {};
    const inp = Number(r.total_input_tokens || 0);
    const out = Number(r.total_output_tokens || 0);
    const cw = Number(r.total_cache_creation_tokens || 0);
    const cr = Number(r.total_cache_read_tokens || 0);
    return {
      total_requests: Number(r.total_requests || 0),
      total_actual_cost: Number(r.total_actual_cost || 0),
      total_cost: Number(r.total_cost || 0),
      total_tokens: inp + out + cw + cr,
      total_input_tokens: inp,
      total_output_tokens: out,
      total_cache_creation_tokens: cw,
      total_cache_read_tokens: cr,
    };
  });
}

async function queryDaily({ userId = null, apiKeyId = null, startDate, endDate }) {
  const win = histWindow(startDate, endDate);
  if (!win) return [];
  const uid = userId != null && Number(userId) > 0 ? Number(userId) : null;
  const kid = apiKeyId != null && Number(apiKeyId) > 0 ? Number(apiKeyId) : null;
  const ck = `daily:${uid || ''}:${kid || ''}:${win.start.toISOString()}:${win.end.toISOString()}`;
  return cached(ck, async () => {
    const args = [win.start, win.end, TZ];
    const conds = ['created_at >= $1', 'created_at < $2'];
    if (uid) {
      args.push(uid);
      conds.push(`user_id = $${args.length}`);
    }
    if (kid) {
      args.push(kid);
      conds.push(`api_key_id = $${args.length}`);
    }
    const { rows } = await pool.query(
      `SELECT to_char((created_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS date,
              count(*)::bigint AS requests,
              coalesce(sum(actual_cost), 0)::float8 AS actual_cost,
              coalesce(sum(total_cost), 0)::float8 AS cost,
              (coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0)
               + coalesce(sum(cache_creation_tokens), 0) + coalesce(sum(cache_read_tokens), 0))::bigint AS total_tokens
         FROM usage_logs
        WHERE ${conds.join(' AND ')}
        GROUP BY 1
        ORDER BY 1`,
      args,
    );
    return rows.map((r) => ({
      date: r.date,
      requests: Number(r.requests || 0),
      actual_cost: Number(r.actual_cost || 0),
      cost: Number(r.cost || 0),
      total_tokens: Number(r.total_tokens || 0),
    }));
  });
}

async function queryGroupsByDay({ userId, startDate, endDate }) {
  const win = histWindow(startDate, endDate);
  const uid = Number(userId);
  if (!win || !(uid > 0)) return [];
  const ck = `groups:${uid}:${win.start.toISOString()}:${win.end.toISOString()}`;
  return cached(ck, async () => {
    const { rows } = await pool.query(
      `SELECT to_char((created_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS date,
              group_id,
              count(*)::bigint AS requests,
              coalesce(sum(actual_cost), 0)::float8 AS actual_cost,
              coalesce(sum(total_cost), 0)::float8 AS cost
         FROM usage_logs
        WHERE user_id = $1 AND created_at >= $2 AND created_at < $3 AND group_id IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [uid, win.start, win.end, TZ],
    );
    return rows.map((r) => ({
      date: r.date,
      group_id: Number(r.group_id),
      requests: Number(r.requests || 0),
      actual_cost: Number(r.actual_cost || 0),
      cost: Number(r.cost || 0),
    }));
  });
}

async function queryUserGroupIds(userId) {
  const uid = Number(userId);
  if (!enabled || !(uid > 0)) return [];
  return cached(`ugids:${uid}`, async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT group_id
         FROM usage_logs
        WHERE user_id = $1 AND created_at < $2 AND group_id IS NOT NULL`,
      [uid, HIST_UNTIL],
    );
    return rows.map((r) => Number(r.group_id)).filter((x) => x > 0);
  });
}

async function queryModels({ userId = null, startDate, endDate }) {
  const win = histWindow(startDate, endDate);
  if (!win) return [];
  const uid = userId != null && Number(userId) > 0 ? Number(userId) : null;
  const ck = `models:${uid || ''}:${win.start.toISOString()}:${win.end.toISOString()}`;
  return cached(ck, async () => {
    const args = [win.start, win.end];
    const conds = ['created_at >= $1', 'created_at < $2'];
    if (uid) {
      args.push(uid);
      conds.push(`user_id = $${args.length}`);
    }
    const { rows } = await pool.query(
      `SELECT model,
              count(*)::bigint AS requests,
              coalesce(sum(actual_cost), 0)::float8 AS actual_cost,
              coalesce(sum(total_cost), 0)::float8 AS cost,
              (coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0)
               + coalesce(sum(cache_creation_tokens), 0) + coalesce(sum(cache_read_tokens), 0))::bigint AS total_tokens
         FROM usage_logs
        WHERE ${conds.join(' AND ')}
        GROUP BY model`,
      args,
    );
    return rows.map((r) => ({
      model: r.model,
      requests: Number(r.requests || 0),
      actual_cost: Number(r.actual_cost || 0),
      cost: Number(r.cost || 0),
      total_tokens: Number(r.total_tokens || 0),
    }));
  });
}

async function queryRanking({ startDate, endDate, limit = 50 }) {
  const win = histWindow(startDate, endDate);
  if (!win) return [];
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const ck = `rank:${lim}:${win.start.toISOString()}:${win.end.toISOString()}`;
  return cached(ck, async () => {
    const { rows } = await pool.query(
      `SELECT user_id,
              count(*)::bigint AS requests,
              coalesce(sum(actual_cost), 0)::float8 AS actual_cost,
              (coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0)
               + coalesce(sum(cache_creation_tokens), 0) + coalesce(sum(cache_read_tokens), 0))::bigint AS total_tokens
         FROM usage_logs
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY user_id
        ORDER BY actual_cost DESC
        LIMIT $3`,
      [win.start, win.end, lim],
    );
    return rows.map((r) => ({
      user_id: Number(r.user_id),
      requests: Number(r.requests || 0),
      actual_cost: Number(r.actual_cost || 0),
      total_tokens: Number(r.total_tokens || 0),
    }));
  });
}

async function healthCheck() {
  if (!enabled) return { enabled: false };
  const { rows } = await pool.query('SELECT 1 AS ok');
  return { enabled: true, ok: rows[0]?.ok === 1, until: HIST_UNTIL.toISOString(), station_base: STATION_BASE };
}

module.exports = {
  isEnabled,
  untilDate,
  appliesTo,
  dateMode,
  histWindow,
  queryStats,
  queryDaily,
  queryGroupsByDay,
  queryUserGroupIds,
  queryModels,
  queryRanking,
  clearCache,
  healthCheck,
};
