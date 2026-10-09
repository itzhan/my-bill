'use strict';

const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ExcelJS = require('exceljs');
const Anthropic = require('@anthropic-ai/sdk');
const { setupPartyWallets } = require('./wallets');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TZ = process.env.TIMEZONE || 'Asia/Shanghai';
const COOKIE = 'hz_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CURRENCIES = ['CNY', 'USDT', 'USD'];
const DEFAULT_RATES = { USD: 7.2, USDT: 7.2 };
const AI_AUTO_DELAY_MS = Number(process.env.AI_AUTO_DELAY_MS) || 45 * 1000;
const AI_WARM_HOURS = 24;
const KB_CONSOLIDATE_DAYS = Number(process.env.KB_CONSOLIDATE_DAYS) || 7;

const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const KB_DIR = path.join(DATA_DIR, 'knowledge');
for (const d of [DATA_DIR, EXPORT_DIR, UPLOAD_DIR, path.join(KB_DIR, 'log'), path.join(KB_DIR, 'chat'), path.join(KB_DIR, 'archive')]) fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- AI 接口
const AI = {
  baseURL: process.env.AI_BASE_URL || process.env.ANTHROPIC_BASE_URL || undefined,
  authToken: process.env.AI_AUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || undefined,
  apiKey: process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || undefined,
  model: process.env.AI_MODEL || 'claude-sonnet-5',
};
const anthropic = (AI.authToken || AI.apiKey)
  ? new Anthropic({ baseURL: AI.baseURL, authToken: AI.authToken, apiKey: AI.apiKey, timeout: 180 * 1000, maxRetries: 1 })
  : null;

// ---------------------------------------------------------------- database
const db = new DatabaseSync(path.join(DATA_DIR, 'ledger.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    amount     REAL NOT NULL CHECK (amount > 0),
    currency   TEXT NOT NULL CHECK (currency IN ('CNY', 'USDT', 'USD')),
    handler_id INTEGER NOT NULL REFERENCES users(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id, created_at);
  -- 成员之间的转账（张三把钱交给李四），只在成员之间搬钱，不影响项目利润
  CREATE TABLE IF NOT EXISTS transfers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    from_id    INTEGER NOT NULL REFERENCES users(id),
    to_id      INTEGER NOT NULL REFERENCES users(id),
    amount     REAL NOT NULL CHECK (amount > 0),
    currency   TEXT NOT NULL CHECK (currency IN ('CNY', 'USDT', 'USD')),
    rate       REAL NOT NULL DEFAULT 1,
    note       TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_transfers_project ON transfers(project_id, created_at);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- AI 生成的财务报表缓存：key = 范围 + 区间
  CREATE TABLE IF NOT EXISTS reports (
    key TEXT PRIMARY KEY, scope TEXT NOT NULL, range TEXT NOT NULL, from_date TEXT, to_date TEXT,
    status TEXT NOT NULL DEFAULT 'idle', content TEXT NOT NULL DEFAULT '', data_hash TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', generated_at TEXT, last_viewed_at TEXT
  );
  -- 导出记录（手动 / 自动 / AI 触发），文件保存在 DATA_DIR/exports
  CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, name TEXT NOT NULL, format TEXT NOT NULL,
    scope TEXT NOT NULL, range TEXT NOT NULL, from_date TEXT, to_date TEXT, size INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL
  );
  -- 群聊 / 私聊消息：user 为成员发言，assistant 为 AI 回复（api 存该轮 Anthropic 消息），system 为系统通知
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, kind TEXT NOT NULL,
    user_id INTEGER, username TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
    parts TEXT NOT NULL DEFAULT '[]', api TEXT NOT NULL DEFAULT '[]', attachments TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id);
  -- AI 提出的操作提案，需成员批准后才执行
  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, message_id INTEGER,
    tool TEXT NOT NULL, input TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    requested_by INTEGER NOT NULL, requested_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', decided_by INTEGER, decided_name TEXT, decided_at TEXT,
    result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  -- 往来单位：供应商（应付 / 实付）与客户（应收 / 实收），按项目
  CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('supplier', 'customer')), name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'CNY', external_id TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_parties_project ON parties(project_id, kind);
  -- 往来记录：due = 应付 / 应收 发生额，paid = 实付 / 实收；paid 可关联一条项目流水
  CREATE TABLE IF NOT EXISTS party_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('due', 'paid')), amount REAL NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL, rate REAL NOT NULL DEFAULT 1, date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual', external_ref TEXT NOT NULL DEFAULT '',
    entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL, created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_party_records_party ON party_records(party_id, date);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_party_records_ext ON party_records(external_ref) WHERE external_ref != '';
  -- 项目群聊（团队群 group 与私聊 dm:<uid> 不需要建表）
  CREATE TABLE IF NOT EXISTS channels (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, project_id INTEGER REFERENCES projects(id),
    created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
    size INTEGER NOT NULL, user_id INTEGER, created_at TEXT NOT NULL
  );
`);
// 迁移：每笔记录保存记账时的汇率（1 单位外币 = rate 人民币；人民币为 1）
if (!db.prepare("SELECT 1 FROM pragma_table_info('entries') WHERE name = 'rate'").get()) {
  db.exec('ALTER TABLE entries ADD COLUMN rate REAL');
}
{
  let r = {}; try { r = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'rates'").get() || { value: '{}' }).value); } catch {}
  const usd = Number(r.USD) > 0 ? Number(r.USD) : DEFAULT_RATES.USD, usdt = Number(r.USDT) > 0 ? Number(r.USDT) : DEFAULT_RATES.USDT;
  db.prepare("UPDATE entries SET rate = CASE currency WHEN 'CNY' THEN 1 WHEN 'USD' THEN ? WHEN 'USDT' THEN ? END WHERE rate IS NULL").run(usd, usdt);
}

// 迁移：每笔记录可附图片（存附件 id 的 JSON 数组，文件在 attachments 表 / uploads 目录）
if (!db.prepare("SELECT 1 FROM pragma_table_info('entries') WHERE name = 'images'").get()) {
  db.exec("ALTER TABLE entries ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");
}

for (const [col, ddl] of [['relay_id', 'INTEGER'], ['relay_ref', "TEXT NOT NULL DEFAULT ''"], ['ratio', 'REAL NOT NULL DEFAULT 1']]) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('parties') WHERE name = ?").get(col)) db.exec(`ALTER TABLE parties ADD COLUMN ${col} ${ddl}`);
}

const ENTRY_SELECT = `SELECT e.*, p.name AS project_name, p.archived AS project_archived,
                             h.username AS handler_name, c.username AS creator_name
                      FROM entries e
                      JOIN projects p ON p.id = e.project_id
                      JOIN users h ON h.id = e.handler_id
                      JOIN users c ON c.id = e.created_by`;

const TRANSFER_SELECT = `SELECT t.*, f.username AS from_name, g.username AS to_name, c.username AS creator_name, p.name AS project_name
                         FROM transfers t
                         JOIN users f ON f.id = t.from_id
                         JOIN users g ON g.id = t.to_id
                         JOIN users c ON c.id = t.created_by
                         LEFT JOIN projects p ON p.id = t.project_id`;

const q = {
  userById: db.prepare('SELECT id, username, phone, created_at FROM users WHERE id = ?'),
  userByAccount: db.prepare('SELECT * FROM users WHERE username = ? OR phone = ?'),
  userByName: db.prepare('SELECT 1 FROM users WHERE username = ?'),
  userByPhone: db.prepare('SELECT 1 FROM users WHERE phone = ?'),
  insertUser: db.prepare('INSERT INTO users (username, phone, password_hash, created_at) VALUES (?, ?, ?, ?)'),
  members: db.prepare('SELECT id, username, phone, created_at FROM users ORDER BY id'),

  projects: db.prepare(`SELECT p.*, u.username AS creator_name FROM projects p JOIN users u ON u.id = p.created_by ORDER BY p.id DESC`),
  project: db.prepare(`SELECT p.*, u.username AS creator_name FROM projects p JOIN users u ON u.id = p.created_by WHERE p.id = ?`),
  insertProject: db.prepare('INSERT INTO projects (name, note, created_by, created_at) VALUES (?, ?, ?, ?)'),
  updateProject: db.prepare('UPDATE projects SET name = ?, note = ?, archived = ? WHERE id = ?'),

  allEntries: db.prepare('SELECT project_id, type, amount, currency, rate, created_at FROM entries'),
  projectEntries: db.prepare(`${ENTRY_SELECT} WHERE e.project_id = ? ORDER BY e.created_at DESC, e.id DESC`),
  entry: db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`),
  reportEntriesAll: db.prepare(`${ENTRY_SELECT} WHERE p.archived = 0 ORDER BY e.created_at DESC, e.id DESC`),
  reportEntriesEvery: db.prepare(`${ENTRY_SELECT} ORDER BY e.created_at DESC, e.id DESC`),
  insertEntry: db.prepare(`INSERT INTO entries (project_id, type, amount, currency, rate, handler_id, created_by, note, created_at, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateEntry: db.prepare(`UPDATE entries SET project_id = ?, type = ?, amount = ?, currency = ?, rate = ?, handler_id = ?, note = ?, created_at = ?, images = ? WHERE id = ?`),
  deleteEntry: db.prepare('DELETE FROM entries WHERE id = ?'),

  transfersOfProject: db.prepare(`${TRANSFER_SELECT} WHERE t.project_id = ? ORDER BY t.created_at DESC, t.id DESC`),
  allTransfers: db.prepare(`${TRANSFER_SELECT} ORDER BY t.created_at DESC, t.id DESC`),
  transfer: db.prepare(`${TRANSFER_SELECT} WHERE t.id = ?`),
  insertTransfer: db.prepare('INSERT INTO transfers (project_id, from_id, to_id, amount, currency, rate, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  updateTransfer: db.prepare('UPDATE transfers SET project_id = ?, from_id = ?, to_id = ?, amount = ?, currency = ?, rate = ?, note = ?, created_at = ? WHERE id = ?'),
  deleteTransfer: db.prepare('DELETE FROM transfers WHERE id = ?'),

  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  clearEntriesOfProject: db.prepare('DELETE FROM entries WHERE project_id = ?'),
  clearTransfersOfProject: db.prepare('DELETE FROM transfers WHERE project_id = ?'),
  clearRecordsOfProject: db.prepare('DELETE FROM party_records WHERE party_id IN (SELECT id FROM parties WHERE project_id = ?)'),
  clearPartiesOfProject: db.prepare('DELETE FROM parties WHERE project_id = ?'),
  channelsOfProject: db.prepare('SELECT * FROM channels WHERE project_id = ?'),
  deleteChannel: db.prepare('DELETE FROM channels WHERE key = ?'),
  countEntriesOfProject: db.prepare('SELECT COUNT(*) AS n FROM entries WHERE project_id = ?'),
  countRecordsOfProject: db.prepare('SELECT COUNT(*) AS n FROM party_records WHERE party_id IN (SELECT id FROM parties WHERE project_id = ?)'),
  countTransfersOfProject: db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE project_id = ?'),
  countPartiesOfProject: db.prepare('SELECT COUNT(*) AS n FROM parties WHERE project_id = ?'),
  deleteReportsOfScope: db.prepare('DELETE FROM reports WHERE scope = ?'),
  dropSettingsLike: db.prepare("DELETE FROM settings WHERE key LIKE ?"),

  setting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  putSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),

  report: db.prepare('SELECT * FROM reports WHERE key = ?'),
  touchReport: db.prepare('UPDATE reports SET last_viewed_at = ? WHERE key = ?'),
  saveReport: db.prepare(`INSERT INTO reports (key, scope, range, from_date, to_date, status, content, data_hash, model, error, generated_at, last_viewed_at)
                          VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, '', ?, ?)
                          ON CONFLICT(key) DO UPDATE SET status = 'done', content = excluded.content, data_hash = excluded.data_hash,
                            model = excluded.model, error = '', generated_at = excluded.generated_at, from_date = excluded.from_date, to_date = excluded.to_date`),
  failReport: db.prepare(`INSERT INTO reports (key, scope, range, from_date, to_date, status, error, last_viewed_at) VALUES (?, ?, ?, ?, ?, 'error', ?, ?)
                          ON CONFLICT(key) DO UPDATE SET status = CASE WHEN content = '' THEN 'error' ELSE status END, error = excluded.error`),
  warmReports: db.prepare(`SELECT * FROM reports WHERE status = 'done' AND (last_viewed_at >= ? OR generated_at >= ?)`),

  exportsList: db.prepare(`SELECT x.*, u.username AS creator_name FROM exports x LEFT JOIN users u ON u.id = x.created_by ORDER BY x.id DESC LIMIT 60`),
  exportById: db.prepare('SELECT * FROM exports WHERE id = ?'),
  insertExport: db.prepare(`INSERT INTO exports (file, name, format, scope, range, from_date, to_date, size, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  oldExports: db.prepare('SELECT * FROM exports ORDER BY id DESC LIMIT -1 OFFSET 120'),
  deleteExport: db.prepare('DELETE FROM exports WHERE id = ?'),

  insertMessage: db.prepare(`INSERT INTO messages (channel, kind, user_id, username, text, parts, api, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateMessage: db.prepare('UPDATE messages SET text = ?, parts = ?, api = ? WHERE id = ?'),
  message: db.prepare('SELECT * FROM messages WHERE id = ?'),
  recentMessages: db.prepare('SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?'),
  messagesBefore: db.prepare('SELECT * FROM messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT ?'),
  countMessagesAfter: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel = ? AND id > ? AND kind != ?'),
  clearChannel: db.prepare('DELETE FROM messages WHERE channel = ?'),
  recallMessage: db.prepare("UPDATE messages SET kind = 'recalled', text = '', parts = '[]', api = '[]', attachments = '[]' WHERE id = ?"),
  nextMessages: db.prepare('SELECT * FROM messages WHERE channel = ? AND id > ? ORDER BY id LIMIT 5'),
  cancelProposalsOfMessage: db.prepare("UPDATE proposals SET status = 'rejected', decided_name = '系统（消息已撤回）', decided_at = ? WHERE message_id = ? AND status = 'pending'"),

  insertProposal: db.prepare(`INSERT INTO proposals (channel, message_id, tool, input, title, detail, requested_by, requested_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  proposal: db.prepare('SELECT * FROM proposals WHERE id = ?'),
  decideProposal: db.prepare('UPDATE proposals SET status = ?, decided_by = ?, decided_name = ?, decided_at = ?, result = ?, error = ? WHERE id = ?'),
  pendingProposals: db.prepare("SELECT * FROM proposals WHERE status = 'pending' ORDER BY id DESC LIMIT 50"),
  proposalsByMessage: db.prepare('SELECT * FROM proposals WHERE message_id = ? ORDER BY id'),
  pendingByTool: db.prepare("SELECT * FROM proposals WHERE status = 'pending' AND tool = ? LIMIT 1"),

  partiesOfProject: db.prepare('SELECT * FROM parties WHERE project_id = ? ORDER BY archived, kind, id'),
  party: db.prepare(`SELECT pa.*, p.name AS project_name FROM parties pa JOIN projects p ON p.id = pa.project_id WHERE pa.id = ?`),
  partyByName: db.prepare('SELECT * FROM parties WHERE project_id = ? AND kind = ? AND (name = ? OR (external_id != \'\' AND external_id = ?))'),
  insertParty: db.prepare('INSERT INTO parties (project_id, kind, name, contact, note, currency, external_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  updateParty: db.prepare('UPDATE parties SET name = ?, contact = ?, note = ?, currency = ?, external_id = ?, archived = ?, ratio = ? WHERE id = ?'),
  linkParty: db.prepare('UPDATE parties SET relay_id = ?, relay_ref = ? WHERE id = ?'),
  recordsWithCreator: db.prepare(`SELECT r.*, u.username AS creator_name FROM party_records r LEFT JOIN users u ON u.id = r.created_by WHERE r.party_id = ? ORDER BY r.date DESC, r.id DESC`),
  deleteParty: db.prepare('DELETE FROM parties WHERE id = ?'),
  recordsOfParty: db.prepare('SELECT * FROM party_records WHERE party_id = ? ORDER BY date DESC, id DESC'),
  recordsOfProject: db.prepare(`SELECT r.*, pa.kind AS party_kind, pa.name AS party_name FROM party_records r JOIN parties pa ON pa.id = r.party_id WHERE pa.project_id = ? ORDER BY r.date DESC, r.id DESC`),
  allRecords: db.prepare(`SELECT r.*, pa.kind AS party_kind, pa.name AS party_name, pa.project_id FROM party_records r JOIN parties pa ON pa.id = r.party_id`),
  record: db.prepare(`SELECT r.*, pa.kind AS party_kind, pa.name AS party_name, pa.project_id FROM party_records r JOIN parties pa ON pa.id = r.party_id WHERE r.id = ?`),
  recordByRef: db.prepare('SELECT * FROM party_records WHERE external_ref = ?'),
  insertRecord: db.prepare('INSERT INTO party_records (party_id, kind, amount, currency, rate, date, note, source, external_ref, entry_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  updateRecord: db.prepare('UPDATE party_records SET amount = ?, currency = ?, rate = ?, date = ?, note = ? WHERE id = ?'),
  deleteRecord: db.prepare('DELETE FROM party_records WHERE id = ?'),
  channels: db.prepare(`SELECT c.*, p.name AS project_name, p.archived AS project_archived FROM channels c LEFT JOIN projects p ON p.id = c.project_id ORDER BY c.rowid`),
  channel: db.prepare('SELECT * FROM channels WHERE key = ?'),
  insertChannel: db.prepare('INSERT INTO channels (key, name, project_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)'),
  insertAttachment: db.prepare('INSERT INTO attachments (file, name, mime, size, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  attachment: db.prepare('SELECT * FROM attachments WHERE id = ?'),
};

// ---------------------------------------------------------------- helpers
const now = () => new Date().toISOString();
const r2 = (n) => Math.round(n * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const cny = (n) => `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'session.secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const SECRET = loadSecret();
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function hashPassword(pw) { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; }
function checkPassword(pw, stored) {
  const [salt, hex] = String(stored).split(':');
  if (!salt || !hex) return false;
  const a = crypto.scryptSync(pw, salt, 64), b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return null;
}
function setSession(req, res, uid) {
  res.cookie(COOKIE, sign({ uid, exp: Date.now() + SESSION_MS }), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MS, path: '/' });
}
const fail = (res, status, error) => res.status(status).json({ error });

function getSetting(key, fallback) { const row = q.setting.get(key); return row ? row.value : fallback; }
function getRates() {
  let r = {}; try { r = JSON.parse(getSetting('rates', '{}')); } catch {}
  return { USD: Number(r.USD) > 0 ? Number(r.USD) : DEFAULT_RATES.USD, USDT: Number(r.USDT) > 0 ? Number(r.USDT) : DEFAULT_RATES.USDT };
}
const aiAuto = () => getSetting('ai_auto', '1') === '1';
const AI_MODELS = [
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5（默认，快、便宜）' },
  { id: 'claude-opus-5', name: 'Claude Opus 5（最强，贵）' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5（最快最便宜）' },
];
const aiModel = () => getSetting('ai_model', '') || AI.model;
const groupAiMode = () => (getSetting('group_ai', 'always') === 'mention' ? 'mention' : 'always');
const aiInfo = () => ({ configured: !!anthropic, model: aiModel(), models: AI_MODELS, auto: aiAuto(), group_mode: groupAiMode(), relay: relayConfigured() ? { name: RELAY.name, base: RELAY.base } : null });
function getAutoExport() {
  let a = {}; try { a = JSON.parse(getSetting('auto_export', '{}')); } catch {}
  return { enabled: !!a.enabled, time: a.time || '23:30', scope: a.scope || 'all', range: a.range || 'month' };
}
// 每笔记录按自己记账时的汇率折算；没有汇率的旧数据用当前汇率兜底
const entryBase = (e, rates) => e.currency === 'CNY' ? e.amount : e.amount * (Number(e.rate) > 0 ? Number(e.rate) : (rates || getRates())[e.currency] || 0);
const emptyTotals = () => ({ CNY: 0, USDT: 0, USD: 0, base: 0 });
function summarize(entries, rates) {
  const s = { income: emptyTotals(), expense: emptyTotals(), profit: 0, count: entries.length, last_at: null };
  for (const e of entries) {
    const t = s[e.type];
    t[e.currency] += e.amount;
    t.base += e.base !== undefined ? e.base : entryBase(e, rates);
    if (!s.last_at || e.created_at > s.last_at) s.last_at = e.created_at;
  }
  for (const k of ['income', 'expense']) for (const c of Object.keys(s[k])) s[k][c] = r2(s[k][c]);
  s.profit = r2(s.income.base - s.expense.base);
  return s;
}
function bootstrap(uid) {
  return { user: q.userById.get(uid), members: q.members.all(), rates: getRates(), ai: aiInfo(), auto_export: getAutoExport(), tz: TZ, knowledge: kbInfo(), integration_token: integrationToken() };
}

const attempts = new Map();
function limit(req, res, next) {
  const t = Date.now();
  let a = attempts.get(req.ip);
  if (!a || a.reset < t) { a = { n: 0, reset: t + 10 * 60 * 1000 }; attempts.set(req.ip, a); }
  if (++a.n > 30) return fail(res, 429, '尝试过于频繁，请稍后再试');
  next();
}
function auth(req, res, next) {
  const p = verify(readCookie(req, COOKIE));
  const user = p && q.userById.get(p.uid);
  if (!user) return fail(res, 401, '请先登录');
  req.user = user;
  next();
}
const RE_USERNAME = /^[\w一-龥]{2,20}$/;
const RE_PHONE = /^\+?\d{6,20}$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const normPhone = (s) => String(s || '').replace(/[\s-]/g, '');

// ---- 时间：数据库统一存 UTC ISO；对外展示 / 解析按团队时区 TZ
const tzParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
function inTZ(date = new Date()) {
  const o = {};
  for (const p of tzParts.formatToParts(date)) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}`, weekday: o.weekday, iso: `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}` };
}
function tzOffsetMinutes(date) {
  const o = {};
  for (const p of tzParts.formatToParts(date)) o[p.type] = Number(p.value);
  return (Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - date.getTime()) / 60000;
}
const WEEKDAY_ZH = { Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' };
function fmtTZ(iso) { const t = inTZ(new Date(iso)); return `${t.date} ${t.time}`; }
function parseTime(input) {
  if (input === undefined || input === null || String(input).trim() === '') return null;
  let str = String(input).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T12:00';
  let d;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(str)) d = new Date(str);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(str)) {
    const guess = new Date(`${str}Z`);
    d = new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000);
    d = new Date(guess.getTime() - tzOffsetMinutes(d) * 60000);
  } else d = new Date(str);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, '时间格式不正确，请用 2026-09-21 15:30 这样的格式');
  if (d.getTime() > Date.now() + 10 * 60000) throw new HttpError(400, '记账时间不能晚于现在');
  if (d.getFullYear() < 2000) throw new HttpError(400, '时间不正确');
  return d.toISOString();
}

// ---------------------------------------------------------------- 知识库（Markdown 存档）
// data/knowledge/log/日期.md   每一次数据变动、审批、导出、报表
// data/knowledge/chat/日期.md  群聊与私聊记录
// data/knowledge/summary.md   定期整理出的团队知识摘要（整理需审批），旧版本进 archive/
const SUMMARY_FILE = path.join(KB_DIR, 'summary.md');
function kbAppend(kind, text) {
  const t = inTZ();
  const file = path.join(KB_DIR, kind, `${t.date}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${kind === 'log' ? '操作日志' : '对话记录'} · ${t.date}\n\n`);
  fs.appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}
const kbLog = (text) => kbAppend('log', `- ${inTZ().time} ${text}`);
const channelLabel = (channel) => (channel === 'group' ? '团队群' : channel.startsWith('project:') ? `项目群「${(q.channel.get(channel) || {}).name || channel}」` : '私聊');
const kbChat = (channel, who, text) => { if (text && text.trim()) kbAppend('chat', `### ${inTZ().time} · ${channelLabel(channel)} · ${who}\n${text.trim()}\n\n`); };
const readSummary = () => { try { return fs.readFileSync(SUMMARY_FILE, 'utf8'); } catch { return ''; } };
const readKb = (kind, date) => { if (!RE_DATE.test(date || '')) return ''; try { return fs.readFileSync(path.join(KB_DIR, kind, `${date}.md`), 'utf8'); } catch { return ''; } };
const kbDates = (kind) => fs.readdirSync(path.join(KB_DIR, kind)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort().reverse();
function kbSearch(query, { from, to, limit = 40 } = {}) {
  const needle = String(query || '').toLowerCase().trim();
  if (!needle) return [];
  const hits = [];
  for (const kind of ['log', 'chat']) {
    for (const date of kbDates(kind)) {
      if ((from && date < from) || (to && date > to)) continue;
      for (const line of readKb(kind, date).split('\n')) if (line.toLowerCase().includes(needle)) hits.push({ kind, date, line: line.trim().slice(0, 300) });
      if (hits.length >= limit) return hits.slice(0, limit);
    }
  }
  const s = readSummary();
  if (s.toLowerCase().includes(needle)) for (const line of s.split('\n')) if (line.toLowerCase().includes(needle)) hits.push({ kind: 'summary', date: '', line: line.trim().slice(0, 300) });
  return hits.slice(0, limit);
}
function kbInfo() {
  let stat = null; try { stat = fs.statSync(SUMMARY_FILE); } catch {}
  return { has_summary: !!stat, summary_at: stat ? stat.mtime.toISOString() : null, consolidated_at: getSetting('kb_consolidated_at', null), log_dates: kbDates('log').slice(0, 60), chat_dates: kbDates('chat').slice(0, 60), auto_days: KB_CONSOLIDATE_DAYS };
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…（已截断，可用 read_knowledge / search_knowledge 查看全文）` : s);

// ---------------------------------------------------------------- 实时同步（SSE）
const clients = new Set();
let dataVersion = Date.now();
function broadcast(event, data, uid = null) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (uid === null || c.uid === uid) c.res.write(msg);
}
const channelAudience = (channel) => (channel.startsWith('dm:') ? Number(channel.slice(3)) : null);
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25 * 1000).unref();
// 任何数据变动：通知所有在线成员、写入知识库日志、安排 AI 报表自动刷新
function dataChanged(user, text, logText = text) {
  dataVersion += 1;
  broadcast('changed', { version: dataVersion, byId: user.id, by: user.username, text, at: now() });
  kbLog(`${user.username} ${logText}`);
  scheduleAutoReports();
}

// ---------------------------------------------------------------- 成员资金沉淀
// 沉淀 = 本人经手的收款 − 本人经手的付款 + 别人转给他 − 他转给别人；转账只搬钱，不影响项目利润
const transferBase = (t, rates) => (t.currency === 'CNY' ? t.amount : t.amount * (Number(t.rate) > 0 ? Number(t.rate) : (rates || getRates())[t.currency] || 0));
const transferLine = (t) => `${t.from_name} → ${t.to_name} ${t.amount.toLocaleString('zh-CN')} ${t.currency}${t.currency !== 'CNY' ? `（≈${cny(transferBase(t))}，汇率 ${t.rate}）` : ''}${t.project_name ? ` · ${t.project_name}` : ' · 不挂项目'}${t.note ? ` · ${t.note}` : ''} · ${fmtTZ(t.created_at)} · #${t.id}`;
function memberFunds(projectId = null, { includeZero = false } = {}) {
  const rates = getRates();
  const entries = projectId ? q.projectEntries.all(projectId) : q.reportEntriesAll.all();
  const archived = new Set(q.projects.all().filter((x) => x.archived).map((x) => x.id));
  const transfers = projectId ? q.transfersOfProject.all(projectId) : q.allTransfers.all().filter((t) => !archived.has(t.project_id));
  const blank = () => ({ CNY: 0, USDT: 0, USD: 0 });
  const map = new Map();
  const slot = (id, name) => {
    let m = map.get(id);
    if (!m) { m = { id, name, income: 0, expense: 0, in: 0, out: 0, balance: 0, entry_count: 0, transfer_count: 0, cur: { income: blank(), expense: blank(), in: blank(), out: blank(), balance: blank() }, last_at: null }; map.set(id, m); }
    return m;
  };
  for (const u of q.members.all()) slot(u.id, u.username);
  for (const e of entries) {
    const m = slot(e.handler_id, e.handler_name);
    const base = entryBase(e, rates);
    m[e.type] += base; m.cur[e.type][e.currency] += e.amount;
    m.entry_count += 1;
    if (!m.last_at || e.created_at > m.last_at) m.last_at = e.created_at;
  }
  for (const t of transfers) {
    const base = transferBase(t, rates);
    const out = slot(t.from_id, t.from_name), into = slot(t.to_id, t.to_name);
    out.out += base; out.cur.out[t.currency] += t.amount; out.transfer_count += 1;
    into.in += base; into.cur.in[t.currency] += t.amount; into.transfer_count += 1;
    for (const m of [out, into]) if (!m.last_at || t.created_at > m.last_at) m.last_at = t.created_at;
  }
  // 合计用未取整的原值累加后再取整，保证和 KPI（收入 − 支出 = 利润）分毫不差
  const raw = [...map.values()].reduce((a, m) => ({ income: a.income + m.income, expense: a.expense + m.expense, in: a.in + m.in, out: a.out + m.out }), { income: 0, expense: 0, in: 0, out: 0 });
  const list = [...map.values()].map((m) => {
    for (const c of CURRENCIES) m.cur.balance[c] = r2(m.cur.income[c] - m.cur.expense[c] + m.cur.in[c] - m.cur.out[c]);
    m.balance = r2(m.income - m.expense + m.in - m.out);
    for (const k of ['income', 'expense', 'in', 'out']) { m[k] = r2(m[k]); for (const c of CURRENCIES) m.cur[k][c] = r2(m.cur[k][c]); }
    return m;
  }).filter((m) => includeZero || m.entry_count || m.transfer_count);
  list.sort((a, b) => b.balance - a.balance || b.income - a.income);
  const totals = { income: r2(raw.income), expense: r2(raw.expense), in: r2(raw.in), out: r2(raw.out), balance: r2(raw.income - raw.expense + raw.in - raw.out) };
  return { members: list, totals, transfers: transfers.map(transferView), rates };
}
const transferView = (t) => ({ id: t.id, time: fmtTZ(t.created_at), created_at: t.created_at, project_id: t.project_id, project: t.project_name || '', from_id: t.from_id, from: t.from_name, to_id: t.to_id, to: t.to_name, amount: t.amount, currency: t.currency, rate: t.rate, cny: r2(transferBase(t)), note: t.note, creator: t.creator_name, created_by: t.created_by });

// ---------------------------------------------------------------- 业务操作（页面接口与 AI 工具共用）
const entryLine = (e) => `${e.type === 'income' ? '收入' : '支出'} ${e.amount.toLocaleString('zh-CN')} ${e.currency}${e.currency !== 'CNY' ? `（≈${cny(entryBase(e))}，汇率 ${e.rate}）` : ''} · ${e.project_name} · 经手人 ${e.handler_name}${e.note ? ` · ${e.note}` : ''} · ${fmtTZ(e.created_at)} · #${e.id}`;
const ops = {
  createProject(user, { name, note }, via = '') {
    name = String(name || '').trim(); note = String(note || '').trim().slice(0, 200);
    if (!name || name.length > 40) throw new HttpError(400, '项目名称为 1–40 个字符');
    const r = q.insertProject.run(name, note, user.id, now());
    const project = q.project.get(Number(r.lastInsertRowid));
    dataChanged(user, `${via}创建了项目「${project.name}」`, `${via}创建了项目「${project.name}」${note ? `（${note}）` : ''} · #${project.id}`);
    return project;
  },
  updateProject(user, id, patch, via = '') {
    const p = q.project.get(Number(id));
    if (!p) throw new HttpError(404, '项目不存在');
    const name = patch.name === undefined ? p.name : String(patch.name).trim();
    const note = patch.note === undefined ? p.note : String(patch.note).trim().slice(0, 200);
    const archived = patch.archived === undefined ? p.archived : (patch.archived ? 1 : 0);
    if (!name || name.length > 40) throw new HttpError(400, '项目名称为 1–40 个字符');
    q.updateProject.run(name, note, archived, p.id);
    const what = archived !== p.archived ? `${archived ? '归档' : '恢复'}了项目「${name}」` : `修改了项目「${p.name}」${name !== p.name ? ` → 「${name}」` : ''}${note !== p.note ? `，说明：${note}` : ''}`;
    dataChanged(user, `${via}${what}`);
    return q.project.get(p.id);
  },
  // 校验并规范化一笔记录（新增 / 修改共用），不写库
  normalizeEntry(user, body, base = null) {
    const p = q.project.get(Number(body.project_id ?? (base && base.project_id)));
    if (!p) throw new HttpError(404, '项目不存在');
    if (p.archived && !(base && base.project_id === p.id)) throw new HttpError(400, `项目「${p.name}」已归档，无法记账`);
    const typeRaw = body.type === undefined && base ? base.type : body.type;
    const type = typeRaw === 'income' ? 'income' : typeRaw === 'expense' ? 'expense' : null;
    const amount = body.amount === undefined && base ? base.amount : r2(Number(body.amount));
    const currency = String(body.currency === undefined && base ? base.currency : body.currency || '').toUpperCase();
    const handlerId = body.handler_id !== undefined && body.handler_id !== null ? Number(body.handler_id) : base ? base.handler_id : user.id;
    const note = body.note === undefined && base ? base.note : String(body.note || '').trim().slice(0, 200);
    const at = body.time !== undefined && body.time !== null && body.time !== '' ? parseTime(body.time) : base ? base.created_at : now();
    if (!type) throw new HttpError(400, '请选择支出或收入');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new HttpError(400, '请输入正确的金额');
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, '请选择币种');
    let rate = 1;
    if (currency !== 'CNY') {
      rate = body.rate !== undefined && body.rate !== null && body.rate !== '' ? Number(body.rate) : (base && base.currency === currency ? Number(base.rate) : getRates()[currency]);
      if (!(rate > 0) || rate > 1e6) throw new HttpError(400, '汇率必须是大于 0 的数字');
      rate = Math.round(rate * 10000) / 10000;
    }
    const handler = q.userById.get(handlerId);
    if (!handler) throw new HttpError(400, '经手人不存在');
    let images = base ? base.images || '[]' : '[]';
    if (body.images !== undefined) {
      const ids = [...new Set((Array.isArray(body.images) ? body.images : []).map(Number))];
      if (ids.length > ENTRY_IMAGE_MAX) throw new HttpError(400, `每笔最多 ${ENTRY_IMAGE_MAX} 张图片`);
      for (const id of ids) {
        const a = q.attachment.get(id);
        if (!a || !IMAGE_MIME.test(a.mime)) throw new HttpError(400, '图片不存在或格式不支持（支持 JPG / PNG / WebP / GIF）');
      }
      images = JSON.stringify(ids);
    }
    return { project: p, type, amount, currency, rate, handlerId, handler, note, at, images };
  },
  addEntry(user, body, via = '') {
    const n = ops.normalizeEntry(user, body);
    const r = q.insertEntry.run(n.project.id, n.type, n.amount, n.currency, n.rate, n.handlerId, user.id, n.note, n.at, n.images);
    const entry = q.entry.get(Number(r.lastInsertRowid));
    dataChanged(user, `${via}记了一笔${n.type === 'income' ? '收入' : '支出'} ${n.amount.toLocaleString('zh-CN')} ${n.currency} · ${n.project.name}`, `${via}记了一笔${entryLine(entry)}`);
    return entry;
  },
  // ---- 清空 / 删除项目（删掉的数据不再进入任何统计与报表）
  projectStats(id) {
    const pid = Number(id);
    return { entries: q.countEntriesOfProject.get(pid).n, records: q.countRecordsOfProject.get(pid).n, transfers: q.countTransfersOfProject.get(pid).n, parties: q.countPartiesOfProject.get(pid).n };
  },
  canManageProject(user, p) { return p.created_by === user.id; },
  clearProject(user, id, via = '') {
    const p = q.project.get(Number(id));
    if (!p) throw new HttpError(404, '项目不存在');
    if (!ops.canManageProject(user, p)) throw new HttpError(403, `只有项目创建者（${q.userById.get(p.created_by)?.username || '创建者'}）可以清空这个项目`);
    const st = ops.projectStats(p.id);
    for (const pa of q.partiesOfProject.all(p.id)) q.putSetting.run(`relay_opening:${pa.id}`, '');   // 自动挂账重新来过
    q.clearRecordsOfProject.run(p.id);
    q.clearTransfersOfProject.run(p.id);
    q.clearEntriesOfProject.run(p.id);
    q.deleteReportsOfScope.run(String(p.id));
    q.deleteReportsOfScope.run('all');
    relayCache.clear();
    dataChanged(user, `${via}清空了项目「${p.name}」的全部记录`, `${via}清空了项目「${p.name}」：删除流水 ${st.entries} 笔、往来记录 ${st.records} 笔、成员转账 ${st.transfers} 笔（供应商 / 客户名单保留），这些数据不再计入任何统计`);
    return { project: p, removed: st };
  },
  deleteProject(user, id, via = '') {
    const p = q.project.get(Number(id));
    if (!p) throw new HttpError(404, '项目不存在');
    if (!ops.canManageProject(user, p)) throw new HttpError(403, `只有项目创建者（${q.userById.get(p.created_by)?.username || '创建者'}）可以删除这个项目`);
    const st = ops.projectStats(p.id);
    for (const c of q.channelsOfProject.all(p.id)) { q.clearChannel.run(c.key); q.deleteChannel.run(c.key); }
    for (const pa of q.partiesOfProject.all(p.id)) q.dropSettingsLike.run(`relay_opening:${pa.id}`);
    q.clearRecordsOfProject.run(p.id);
    q.clearPartiesOfProject.run(p.id);
    q.clearTransfersOfProject.run(p.id);
    q.clearEntriesOfProject.run(p.id);
    q.deleteProject.run(p.id);
    q.deleteReportsOfScope.run(String(p.id));
    q.deleteReportsOfScope.run('all');
    relayCache.clear();
    broadcast('channels', {});
    dataChanged(user, `${via}删除了项目「${p.name}」`, `${via}删除了项目「${p.name}」及其全部数据：流水 ${st.entries} 笔、往来单位 ${st.parties} 家、往来记录 ${st.records} 笔、成员转账 ${st.transfers} 笔、项目群聊。删除后这些数据不再计入任何统计与报表`);
    return { project: p, removed: st };
  },
  // ---- 成员之间的转账（不影响项目利润，只在成员资金里搬钱）
  normalizeTransfer(user, body, base = null) {
    const rawPid = body.project_id === undefined && base ? base.project_id : body.project_id;
    let project = null;
    if (rawPid !== null && rawPid !== undefined && rawPid !== '' && String(rawPid) !== 'all') {
      project = q.project.get(Number(rawPid));
      if (!project) throw new HttpError(404, '项目不存在');
    }
    const fromId = Number(body.from_id === undefined && base ? base.from_id : body.from_id);
    const toId = Number(body.to_id === undefined && base ? base.to_id : body.to_id);
    const from = q.userById.get(fromId), to = q.userById.get(toId);
    if (!from) throw new HttpError(400, '转出成员不存在');
    if (!to) throw new HttpError(400, '转入成员不存在');
    if (from.id === to.id) throw new HttpError(400, '转出和转入不能是同一个人');
    const amount = body.amount === undefined && base ? base.amount : r2(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new HttpError(400, '请输入正确的金额');
    const currency = String(body.currency === undefined && base ? base.currency : body.currency || '').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, '请选择币种');
    let rate = 1;
    if (currency !== 'CNY') {
      rate = body.rate !== undefined && body.rate !== null && body.rate !== '' ? Number(body.rate) : (base && base.currency === currency ? Number(base.rate) : getRates()[currency]);
      if (!(rate > 0) || rate > 1e6) throw new HttpError(400, '汇率必须是大于 0 的数字');
      rate = Math.round(rate * 10000) / 10000;
    }
    const note = body.note === undefined && base ? base.note : String(body.note || '').trim().slice(0, 200);
    const at = body.time !== undefined && body.time !== null && body.time !== '' ? parseTime(body.time) : base ? base.created_at : now();
    return { project, from, to, amount, currency, rate, note, at };
  },
  addTransfer(user, body, via = '') {
    const n = ops.normalizeTransfer(user, body);
    const r = q.insertTransfer.run(n.project ? n.project.id : null, n.from.id, n.to.id, n.amount, n.currency, n.rate, n.note, user.id, n.at);
    const t = q.transfer.get(Number(r.lastInsertRowid));
    dataChanged(user, `${via}记了一笔转账：${n.from.username} → ${n.to.username} ${n.amount.toLocaleString('zh-CN')} ${n.currency}${n.project ? ` · ${n.project.name}` : ''}`, `${via}记了一笔成员转账 ${transferLine(t)}`);
    return t;
  },
  updateTransfer(user, id, body, via = '') {
    const t0 = q.transfer.get(Number(id));
    if (!t0) throw new HttpError(404, '转账记录不存在');
    if (!ops.canEditTransfer(user, t0)) throw new HttpError(403, '只能修改自己登记的转账');
    const n = ops.normalizeTransfer(user, body, t0);
    q.updateTransfer.run(n.project ? n.project.id : null, n.from.id, n.to.id, n.amount, n.currency, n.rate, n.note, n.at, t0.id);
    const t = q.transfer.get(t0.id);
    dataChanged(user, `${via}修改了转账 #${t.id}`, `${via}把转账 #${t.id} 改成 ${transferLine(t)}`);
    return t;
  },
  deleteTransfer(user, id, via = '') {
    const t = q.transfer.get(Number(id));
    if (!t) throw new HttpError(404, '转账记录不存在');
    if (!ops.canEditTransfer(user, t)) throw new HttpError(403, '只能删除自己登记的转账');
    q.deleteTransfer.run(t.id);
    dataChanged(user, `${via}删除了转账 #${t.id}`, `${via}删除了转账 ${transferLine(t)}`);
    return t;
  },
  canEditTransfer(user, t) {
    const p = t.project_id ? q.project.get(t.project_id) : null;
    return t.created_by === user.id || (p && p.created_by === user.id);
  },
  canEditEntry(user, entry) {
    const p = q.project.get(entry.project_id);
    return entry.created_by === user.id || (p && p.created_by === user.id);
  },
  updateEntry(user, id, patch, via = '') {
    const e = q.entry.get(Number(id));
    if (!e) throw new HttpError(404, '记录不存在');
    if (!ops.canEditEntry(user, e)) throw new HttpError(403, '只能修改自己登记的记录');
    const n = ops.normalizeEntry(user, patch, e);
    q.updateEntry.run(n.project.id, n.type, n.amount, n.currency, n.rate, n.handlerId, n.note, n.at, n.images, e.id);
    const entry = q.entry.get(e.id);
    dataChanged(user, `${via}修改了一笔${n.type === 'income' ? '收入' : '支出'} ${n.amount.toLocaleString('zh-CN')} ${n.currency} · ${n.project.name}`, `${via}修改了记录 #${e.id}：原「${entryLine(e)}」→ 现「${entryLine(entry)}」`);
    return entry;
  },
  deleteEntry(user, id, via = '') {
    const e = q.entry.get(Number(id));
    if (!e) throw new HttpError(404, '记录不存在');
    if (!ops.canEditEntry(user, e)) throw new HttpError(403, '只能删除自己登记的记录');
    q.deleteEntry.run(e.id);
    dataChanged(user, `${via}删除了一笔${e.type === 'income' ? '收入' : '支出'} ${e.amount.toLocaleString('zh-CN')} ${e.currency} · ${e.project_name}`, `${via}删除了记录：${entryLine(e)}`);
    return e;
  },
  updateSettings(user, body, via = '') {
    const changes = [];
    if (body.rates) {
      const rates = {};
      for (const c of ['USD', 'USDT']) {
        const v = Number(body.rates[c]);
        if (!(v > 0) || v > 1e6) throw new HttpError(400, `${c} 汇率必须是大于 0 的数字`);
        rates[c] = v;
      }
      q.putSetting.run('rates', JSON.stringify(rates));
      changes.push(`汇率：1 USD = ${rates.USD}，1 USDT = ${rates.USDT}（只影响之后的新记录）`);
    }
    if (body.ai_auto !== undefined) { q.putSetting.run('ai_auto', body.ai_auto ? '1' : '0'); changes.push(`AI 报表自动刷新：${body.ai_auto ? '开' : '关'}`); }
    if (body.ai_model !== undefined) {
      const m = String(body.ai_model || '').trim();
      if (m && !/^[\w.:-]{3,80}$/.test(m)) throw new HttpError(400, '模型名不正确');
      q.putSetting.run('ai_model', m); changes.push(`AI 模型：${m || AI.model}`);
    }
    if (body.group_ai !== undefined) { q.putSetting.run('group_ai', body.group_ai === 'mention' ? 'mention' : 'always'); changes.push(`群聊 AI 回复：${body.group_ai === 'mention' ? '仅 @AI 时' : '每条消息'}`); }
    if (body.auto_export !== undefined) {
      const cur = getAutoExport(), a = body.auto_export || {};
      const cfg = { enabled: a.enabled === undefined ? cur.enabled : !!a.enabled, time: a.time === undefined ? cur.time : String(a.time), scope: a.scope === undefined ? cur.scope : String(a.scope), range: a.range === undefined ? cur.range : String(a.range) };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.time)) throw new HttpError(400, '自动导出时间格式为 HH:MM');
      if (!RANGE_LABELS[cfg.range] || cfg.range === 'custom') throw new HttpError(400, '自动导出区间不支持自定义');
      if (cfg.scope !== 'all' && !q.project.get(Number(cfg.scope))) throw new HttpError(400, '自动导出的项目不存在');
      q.putSetting.run('auto_export', JSON.stringify(cfg));
      broadcast('settings', { auto_export: cfg });
      changes.push(`每日自动导出：${cfg.enabled ? `每天 ${cfg.time}` : '关'}`);
    }
    if (changes.length) dataChanged(user, `${via}更新了设置：${changes.join('；')}`);
    return { rates: getRates(), ai: aiInfo(), auto_export: getAutoExport() };
  },
};

// ---- 往来（供应商应付 / 实付，客户应收 / 实收）
const PARTY_LABEL = { supplier: { name: '供应商', due: '应付', paid: '实付', open: '未付' }, customer: { name: '客户', due: '应收', paid: '实收', open: '未收' } };
const recBase = (r) => r.currency === 'CNY' ? r.amount : r.amount * (Number(r.rate) > 0 ? Number(r.rate) : getRates()[r.currency] || 0);
function partyTotals(records) {
  const t = { due: 0, paid: 0, dueCny: 0, paidCny: 0, count: records.length, last_at: null, by: {} };
  for (const r of records) {
    t[r.kind] += r.amount; t[`${r.kind}Cny`] += recBase(r);
    const b = t.by[r.currency] || (t.by[r.currency] = { due: 0, paid: 0 }); b[r.kind] += r.amount;
    if (!t.last_at || r.date > t.last_at) t.last_at = r.date;
  }
  return { due: r2(t.dueCny), paid: r2(t.paidCny), open: r2(t.dueCny - t.paidCny), count: t.count, last_at: t.last_at, by: Object.fromEntries(Object.entries(t.by).map(([c, v]) => [c, { due: r2(v.due), paid: r2(v.paid), open: r2(v.due - v.paid) }])) };
}
// 按单位的结算币种汇总：同币种直接加，其他币种按记录汇率折成人民币再按当前汇率换算
const cnyToCur = (cny, cur, rates) => (cur === 'CNY' ? cny : cny / ((rates || getRates())[cur] || 1));
const usdToCur = (usd, cur, rates) => { const r = rates || getRates(); return cur === 'USD' ? usd : cur === 'CNY' ? usd * r.USD : (usd * r.USD) / (r[cur] || 1); };
function partySettle(records, cur) {
  const rates = getRates();
  const t = { due: 0, paid: 0, dueCny: 0, paidCny: 0, relayDue: 0, manualDue: 0 };
  for (const r of records) {
    const cny = recBase(r);
    const inCur = r.currency === cur ? r.amount : cnyToCur(cny, cur, rates);
    t[r.kind] += inCur; t[`${r.kind}Cny`] += cny;
    if (r.kind === 'due') { if (r.source === 'relay') t.relayDue += inCur; else t.manualDue += inCur; }
  }
  const open = r2(t.due - t.paid);
  return { currency: cur, due: r2(t.due), paid: r2(t.paid), open: open > 0 ? open : 0, credit: open < 0 ? -open : 0, due_cny: r2(t.dueCny), paid_cny: r2(t.paidCny), open_cny: r2(t.dueCny - t.paidCny), relay_due: r2(t.relayDue), manual_due: r2(t.manualDue) };
}
// 供应商余额（new-api / sub2api 钱包额度 + 倍率），见 wallets.js；路由注册后才可用
let partyWallets = null;
const partyView = (p, records) => ({ wallet: p.kind === 'supplier' && partyWallets ? partyWallets.summaryOf(p.id) : null, id: p.id, project_id: p.project_id, project_name: p.project_name, kind: p.kind, name: p.name, contact: p.contact, note: p.note, currency: p.currency, external_id: p.external_id, archived: !!p.archived, created_at: p.created_at, ratio: Number(p.ratio) > 0 ? Number(p.ratio) : 1, relay: p.relay_id ? { id: p.relay_id, ref: p.relay_ref } : null, totals: partyTotals(records || q.recordsOfParty.all(p.id)), settle: partySettle(records || q.recordsOfParty.all(p.id), p.currency || 'CNY') });
const recordView = (r) => ({ id: r.id, party_id: r.party_id, kind: r.kind, amount: r.amount, currency: r.currency, rate: r.rate, cny: r2(recBase(r)), date: r.date, note: r.note, source: r.source, external_ref: r.external_ref, entry_id: r.entry_id, created_at: r.created_at, creator_name: r.creator_name || '' });
function projectPartiesSummary(projectId) {
  const parties = q.partiesOfProject.all(projectId);
  const records = q.recordsOfProject.all(projectId);
  const byParty = new Map();
  for (const r of records) { if (!byParty.has(r.party_id)) byParty.set(r.party_id, []); byParty.get(r.party_id).push(r); }
  const suppliers = [], customers = [];
  for (const p of parties) (p.kind === 'supplier' ? suppliers : customers).push(partyView(p, byParty.get(p.id) || []));
  const sum = (list) => list.reduce((a, x) => ({ due: r2(a.due + x.totals.due), paid: r2(a.paid + x.totals.paid), open: r2(a.open + x.totals.open) }), { due: 0, paid: 0, open: 0 });
  const dailyMap = new Map();
  for (const r of records) {
    const d = dailyMap.get(r.date) || { date: r.date, payable: 0, paid: 0, receivable: 0, received: 0, count: 0 };
    const base = recBase(r);
    if (r.party_kind === 'supplier') d[r.kind === 'due' ? 'payable' : 'paid'] += base; else d[r.kind === 'due' ? 'receivable' : 'received'] += base;
    d.count += 1; dailyMap.set(r.date, d);
  }
  const daily = [...dailyMap.values()].sort((a, b) => b.date.localeCompare(a.date)).map((d) => ({ ...d, payable: r2(d.payable), paid: r2(d.paid), receivable: r2(d.receivable), received: r2(d.received) }));
  return { suppliers, customers, totals: { supplier: sum(suppliers), customer: sum(customers) }, daily };
}
Object.assign(ops, {
  addParty(user, projectId, body, via = '') {
    const p = q.project.get(Number(projectId));
    if (!p) throw new HttpError(404, '项目不存在');
    const kind = body.kind === 'customer' ? 'customer' : body.kind === 'supplier' ? 'supplier' : null;
    if (!kind) throw new HttpError(400, '类型只能是供应商或客户');
    const name = String(body.name || '').trim();
    if (!name || name.length > 60) throw new HttpError(400, '名称为 1–60 个字符');
    const currency = String(body.currency || 'CNY').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, '币种不正确');
    const existing = q.partyByName.get(p.id, kind, name, String(body.external_id || '') || '\u0000');
    if (existing) throw new HttpError(409, `该项目已有${PARTY_LABEL[kind].name}「${existing.name}」`);
    const r = q.insertParty.run(p.id, kind, name, String(body.contact || '').trim().slice(0, 100), String(body.note || '').trim().slice(0, 200), currency, String(body.external_id || '').trim().slice(0, 100), user.id, now());
    const party = q.party.get(Number(r.lastInsertRowid));
    if (body.ratio !== undefined && body.ratio !== null && body.ratio !== '') { const ratio = Number(body.ratio); if (ratio > 0 && ratio <= 100) db.prepare('UPDATE parties SET ratio = ? WHERE id = ?').run(Math.round(ratio * 10000) / 10000, party.id); }
    dataChanged(user, `${via}在「${p.name}」添加了${PARTY_LABEL[kind].name}「${name}」`);
    return party;
  },
  updateParty(user, id, patch, via = '') {
    const pa = q.party.get(Number(id));
    if (!pa) throw new HttpError(404, '往来单位不存在');
    const name = patch.name === undefined ? pa.name : String(patch.name).trim();
    if (!name || name.length > 60) throw new HttpError(400, '名称为 1–60 个字符');
    const currency = patch.currency === undefined ? pa.currency : String(patch.currency).toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, '币种不正确');
    let ratio = patch.ratio === undefined ? pa.ratio : Number(patch.ratio);
    if (!(ratio > 0) || ratio > 100) throw new HttpError(400, '倍率必须是 0–100 之间的数字');
    ratio = Math.round(ratio * 10000) / 10000;
    q.updateParty.run(name, patch.contact === undefined ? pa.contact : String(patch.contact).trim().slice(0, 100), patch.note === undefined ? pa.note : String(patch.note).trim().slice(0, 200), currency, patch.external_id === undefined ? pa.external_id : String(patch.external_id).trim().slice(0, 100), patch.archived === undefined ? pa.archived : (patch.archived ? 1 : 0), ratio, pa.id);
    if (pa.relay_id && (ratio !== Number(pa.ratio) || currency !== pa.currency)) resetRelayAccrual(pa.id);
    dataChanged(user, `${via}修改了${PARTY_LABEL[pa.kind].name}「${pa.name}」${name !== pa.name ? ` → 「${name}」` : ''}${patch.ratio !== undefined && ratio !== pa.ratio ? `（倍率 ${pa.ratio} → ${ratio}）` : ''}${patch.archived !== undefined ? (patch.archived ? '（归档）' : '（恢复）') : ''} · ${pa.project_name}`);
    return q.party.get(pa.id);
  },
  deleteParty(user, id, via = '') {
    const pa = q.party.get(Number(id));
    if (!pa) throw new HttpError(404, '往来单位不存在');
    const n = q.recordsOfParty.all(pa.id).length;
    q.deleteParty.run(pa.id);
    dataChanged(user, `${via}删除了${PARTY_LABEL[pa.kind].name}「${pa.name}」及其 ${n} 条往来记录 · ${pa.project_name}`);
    return pa;
  },
  // 记一条应付 / 应收（due）或实付 / 实收（paid）；实付 / 实收 默认同时记入项目流水
  addPartyRecord(user, partyId, body, via = '') {
    const pa = q.party.get(Number(partyId));
    if (!pa) throw new HttpError(404, '往来单位不存在');
    if (pa.archived) throw new HttpError(400, `${PARTY_LABEL[pa.kind].name}「${pa.name}」已归档`);
    const kind = body.kind === 'paid' ? 'paid' : body.kind === 'due' ? 'due' : null;
    if (!kind) throw new HttpError(400, `类型只能是 due（${PARTY_LABEL[pa.kind].due}）或 paid（${PARTY_LABEL[pa.kind].paid}）`);
    const amount = r2(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new HttpError(400, '请输入正确的金额');
    const currency = String(body.currency || pa.currency || 'CNY').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, '币种不正确');
    let rate = 1;
    if (currency !== 'CNY') { rate = body.rate !== undefined && body.rate !== null && body.rate !== '' ? Number(body.rate) : getRates()[currency]; if (!(rate > 0)) throw new HttpError(400, '汇率必须大于 0'); rate = Math.round(rate * 10000) / 10000; }
    let date = String(body.date || '').trim();
    if (!date) date = todayKey();
    if (!RE_DATE.test(date)) throw new HttpError(400, '日期格式为 YYYY-MM-DD');
    if (date > addDays(todayKey(), 1)) throw new HttpError(400, '日期不能晚于明天');
    const note = String(body.note || '').trim().slice(0, 200);
    const source = ['manual', 'api', 'ai', 'relay'].includes(body.source) ? body.source : 'manual';
    const ref = String(body.external_ref || '').trim().slice(0, 120);
    if (ref) { const dup = q.recordByRef.get(ref); if (dup) return { record: q.record.get(dup.id), duplicate: true }; }
    let entryId = null;
    const linkEntry = kind === 'paid' && body.link_entry !== false && body.link_entry !== 0 && body.link_entry !== '0';
    if (linkEntry) {
      const timeIso = body.time ? parseTime(body.time) : (date === todayKey() ? now() : parseTime(`${date}T12:00`));
      const e = ops.addEntry(user, { project_id: pa.project_id, type: pa.kind === 'supplier' ? 'expense' : 'income', amount, currency, rate, handler_id: body.handler_id || user.id, note: note || (pa.kind === 'supplier' ? `付款给供应商 ${pa.name}` : `客户 ${pa.name} 回款`), time: timeIso }, via);
      entryId = e.id;
    }
    const r = q.insertRecord.run(pa.id, kind, amount, currency, rate, date, note, source, ref, entryId, user.id, now());
    const rec = q.record.get(Number(r.lastInsertRowid));
    const L = PARTY_LABEL[pa.kind];
    dataChanged(user, `${via}记了${L.name}「${pa.name}」${L[kind]} ${amount.toLocaleString('zh-CN')} ${currency}（${date}）· ${pa.project_name}`, `${via}记了${L.name}「${pa.name}」${L[kind]} ${amount.toLocaleString('zh-CN')} ${currency}${currency !== 'CNY' ? `（汇率 ${rate}）` : ''} · 日期 ${date}${note ? ` · ${note}` : ''}${entryId ? ` · 已同步记入流水 #${entryId}` : ''} · ${pa.project_name} · 来源 ${source}`);
    return { record: rec, duplicate: false };
  },
  deletePartyRecord(user, id, via = '') {
    const rec = q.record.get(Number(id));
    if (!rec) throw new HttpError(404, '记录不存在');
    const pa = q.party.get(rec.party_id);
    // 绑定期间的自动挂账记录由中转站消耗决定，删了下次刷新还会补回来；要改就改倍率 / 折扣或解绑
    if (rec.source === 'relay' && pa.relay_id) throw new HttpError(400, '这是中转站自动挂账记录，绑定期间不能手动删除；可调整倍率 / 折扣重算，或解绑后再删除');
    q.deleteRecord.run(rec.id);
    if (rec.entry_id) { const e = q.entry.get(rec.entry_id); if (e) { try { ops.deleteEntry(user, e.id, via); } catch {} } }
    const L = PARTY_LABEL[pa.kind];
    dataChanged(user, `${via}删除了${L.name}「${pa.name}」的${L[rec.kind]}记录 ${rec.amount.toLocaleString('zh-CN')} ${rec.currency}（${rec.date}）· ${pa.project_name}`);
    return rec;
  },
});
// 外部系统对接的 API 令牌（用于实时同步应收等）
function integrationToken() {
  let t = getSetting('integration_token', '');
  if (!t) { t = `yq_${crypto.randomBytes(24).toString('hex')}`; q.putSetting.run('integration_token', t); }
  return t;
}
const maskToken = (t) => (t ? `${t.slice(0, 7)}…${t.slice(-4)}` : '');

// ---------------------------------------------------------------- 报表数据
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (iso) => dayFmt.format(new Date(iso));
const todayKey = () => dayFmt.format(new Date());
function addDays(key, n) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
const RANGE_LABELS = { month: '本月', 'last-month': '上月', '30d': '近 30 天', all: '全部', custom: '自定义' };
function resolveRange(range, from, to, firstDay) {
  const today = todayKey();
  const [Y, M] = today.split('-').map(Number);
  switch (range) {
    case 'month': return { from: `${Y}-${pad2(M)}-01`, to: today };
    case 'last-month': { const y = M === 1 ? Y - 1 : Y, m = M === 1 ? 12 : M - 1; const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(last)}` }; }
    case '30d': return { from: addDays(today, -29), to: today };
    case 'custom': {
      if (!RE_DATE.test(from || '') || !RE_DATE.test(to || '')) throw new HttpError(400, '自定义区间需要有效的起止日期');
      if (from > to) [from, to] = [to, from];
      if (daysBetween(from, to) > 366 * 3) throw new HttpError(400, '自定义区间最长 3 年');
      return { from, to };
    }
    default: return { from: firstDay && firstDay < today ? firstDay : today, to: today };
  }
}
function normalizeReportParams(src) {
  const scope = !src.scope || src.scope === 'all' ? 'all' : String(Number(src.scope));
  if (scope !== 'all' && !(Number(scope) > 0)) throw new HttpError(400, '项目参数不正确');
  const range = RANGE_LABELS[src.range] ? src.range : 'month';
  return { scope, range, from: range === 'custom' ? src.from : null, to: range === 'custom' ? src.to : null };
}
const reportKey = (p) => `${p.scope}:${p.range}${p.range === 'custom' ? `:${p.from}:${p.to}` : ''}`;
function groupSum(entries, keyOf, seed) {
  const map = new Map();
  for (const e of entries) {
    const k = keyOf(e);
    let g = map.get(k);
    if (!g) { g = { ...seed(e), income: 0, expense: 0, count: 0, last_at: null }; map.set(k, g); }
    g[e.type] += e.base; g.count += 1;
    if (!g.last_at || e.created_at > g.last_at) g.last_at = e.created_at;
  }
  return [...map.values()].map((g) => ({ ...g, income: r2(g.income), expense: r2(g.expense), profit: r2(g.income - g.expense) }));
}
function buildReport(params) {
  const rates = getRates();
  const project = params.scope === 'all' ? null : q.project.get(Number(params.scope));
  if (params.scope !== 'all' && !project) throw new HttpError(404, '项目不存在');
  const all = (project ? q.projectEntries.all(project.id) : q.reportEntriesAll.all()).map((e) => ({ ...e, day: dayKey(e.created_at), base: r2(entryBase(e, rates)) }));
  const firstDay = all.length ? all.reduce((m, e) => (e.day < m ? e.day : m), all[0].day) : null;
  const rng = resolveRange(params.range, params.from, params.to, firstDay);
  const entries = all.filter((e) => e.day >= rng.from && e.day <= rng.to);
  const days = daysBetween(rng.from, rng.to) + 1;
  const prevFrom = addDays(rng.from, -days), prevTo = addDays(rng.from, -1);
  const prevEntries = all.filter((e) => e.day >= prevFrom && e.day <= prevTo);
  const byDay = new Map();
  for (const e of entries) { let d = byDay.get(e.day); if (!d) { d = { date: e.day, income: 0, expense: 0, count: 0 }; byDay.set(e.day, d); } d[e.type] += e.base; d.count += 1; }
  const daily = []; let cumulative = 0;
  for (let k = rng.from; k <= rng.to; k = addDays(k, 1)) {
    const d = byDay.get(k) || { date: k, income: 0, expense: 0, count: 0 };
    d.income = r2(d.income); d.expense = r2(d.expense); d.profit = r2(d.income - d.expense);
    cumulative = r2(cumulative + d.profit); d.cumulative = cumulative;
    daily.push(d);
  }
  const byProject = groupSum(entries, (e) => e.project_id, (e) => ({ id: e.project_id, name: e.project_name, archived: e.project_archived })).sort((a, b) => b.profit - a.profit);
  const byMember = groupSum(entries, (e) => e.handler_id, (e) => ({ id: e.handler_id, name: e.handler_name })).sort((a, b) => b.expense - a.expense || b.income - a.income);
  const analysis = analyzeEntries(entries);
  return { analysis,
    scope: params.scope, range: params.range, label: RANGE_LABELS[params.range],
    project: project && { id: project.id, name: project.name, note: project.note, archived: project.archived },
    from: rng.from, to: rng.to, days, prevFrom, prevTo, tz: TZ, rates,
    kpis: summarize(entries, rates), prev: summarize(prevEntries, rates), daily, byProject, byMember, entries, generated_at: now(),
  };
}
// 项目分析：用途分布、币种构成、大额记录、月度趋势
function analyzeEntries(entries) {
  const noteKey = (e) => (e.note || '').trim() || '未备注';
  const grp = (list) => {
    const m = new Map();
    for (const e of list) { const k = noteKey(e); const g = m.get(k) || { note: k, cny: 0, count: 0 }; g.cny += e.base; g.count += 1; m.set(k, g); }
    return [...m.values()].map((g) => ({ ...g, cny: r2(g.cny) })).sort((a, b) => b.cny - a.cny);
  };
  const exp = entries.filter((e) => e.type === 'expense'), inc = entries.filter((e) => e.type === 'income');
  const byCurrency = CURRENCIES.map((c) => {
    const ei = inc.filter((e) => e.currency === c), ee = exp.filter((e) => e.currency === c);
    return { currency: c, income: r2(ei.reduce((a, e) => a + e.amount, 0)), incomeCny: r2(ei.reduce((a, e) => a + e.base, 0)), expense: r2(ee.reduce((a, e) => a + e.amount, 0)), expenseCny: r2(ee.reduce((a, e) => a + e.base, 0)), count: ei.length + ee.length };
  }).filter((x) => x.count);
  const brief = (e) => ({ id: e.id, time: fmtTZ(e.created_at), amount: e.amount, currency: e.currency, rate: e.rate, cny: e.base, handler: e.handler_name, project: e.project_name, note: e.note });
  const top = { expense: [...exp].sort((a, b) => b.base - a.base).slice(0, 10).map(brief), income: [...inc].sort((a, b) => b.base - a.base).slice(0, 5).map(brief) };
  const mm = new Map();
  for (const e of entries) { const k = e.day.slice(0, 7); const g = mm.get(k) || { month: k, income: 0, expense: 0, count: 0 }; g[e.type] += e.base; g.count += 1; mm.set(k, g); }
  const monthly = [...mm.values()].map((g) => ({ ...g, income: r2(g.income), expense: r2(g.expense), profit: r2(g.income - g.expense) })).sort((a, b) => a.month.localeCompare(b.month));
  return { byNote: { expense: grp(exp).slice(0, 12), income: grp(inc).slice(0, 12) }, byCurrency, top, monthly };
}
function dataHash(report) {
  const core = { from: report.from, to: report.to, kpis: report.kpis, daily: report.daily.filter((d) => d.count), byProject: report.byProject, byMember: report.byMember };
  return crypto.createHash('sha1').update(JSON.stringify(core)).digest('hex');
}
function reportStatus(params, report) {
  const key = reportKey(params);
  const row = q.report.get(key);
  if (row) q.touchReport.run(now(), key);
  const hash = dataHash(report);
  const job = running.get(key);
  return { key, status: job ? 'running' : row ? row.status : 'none', content: job ? job.content : row ? row.content : '', generated_at: row ? row.generated_at : null, model: row ? row.model : '', error: row ? row.error : '', stale: !!row && row.status === 'done' && row.data_hash !== hash };
}

// ---------------------------------------------------------------- AI 财务报表
const SYSTEM_PROMPT = `你是「元启智能账单系统」的财务分析助理。根据给定的记账数据，撰写一份简洁、专业、可直接发给团队看的财务报表，使用 Markdown。

规则：
- 所有金额以人民币（¥）为准，数据已按每笔记账时的汇率折算；原币种（USDT / USD）可作补充说明。
- 只使用数据中出现的数字，不要臆造；数据不足时直接说明。
- 金额保留两位小数并加千分位；百分比保留一位小数。
- 不要输出代码块，不要重复数据里的原始 JSON。
- 语气克制精炼，总长度 600–1200 字。

固定结构：
# 财务报表 · {范围}
## 一、核心结论
3–5 条要点（列表）。
## 二、收支概览
Markdown 表格：收入 / 支出 / 利润 / 笔数，并与上一周期对比（金额与变化幅度）。
## 三、趋势分析
结合每日数据说明走势、高峰日、累计利润的变化。
## 四、项目分析
若为全部项目：各项目收入 / 支出 / 利润的表格与说明；若为单个项目：用 analysis 里的数据分析该项目——支出用途分布（byNote，占比）、币种构成与汇率影响（byCurrency）、大额记录（top）、月度走势（monthly），指出主要成本项与异常。
## 五、成员支出
谁经手了主要支出与收款，占比说明。
## 六、风险与建议
3–5 条可执行的建议（列表）。`;
function buildUserPrompt(report) {
  const { entries, ...rest } = report;
  const compactEntries = entries.slice(0, 200).map((e) => ({ date: e.day, time: e.created_at.slice(11, 16), type: e.type, amount: e.amount, currency: e.currency, rate: e.rate, cny: e.base, project: e.project_name, handler: e.handler_name, note: e.note }));
  const data = { ...rest, daily: rest.daily.filter((d) => d.count), entries: compactEntries, entries_truncated: entries.length > 200 ? entries.length - 200 : 0, note: '金额字段 base/cny 为按记账时汇率折算的人民币；kpis 为本期，prev 为上一周期（prevFrom–prevTo）；analysis 含用途分布 byNote、币种构成 byCurrency、大额记录 top、月度 monthly。' };
  return `报表范围：${report.project ? `项目「${report.project.name}」` : '全部项目'}，${report.label}（${report.from} 至 ${report.to}，时区 ${report.tz}）。\n\n数据（JSON）：\n${JSON.stringify(data)}`;
}
const running = new Map();
// 中转站偶发抽风（某个上游分组不可用 / 502 / 限流 / 空回复）：同一轮自动重试，不惊动用户
const TRANSIENT_RE = /dispatch|group|upstream|overload|temporar|timeout|timed out|socket|ECONN|fetch failed|模型没有返回内容|回答被截断/i;
// 不设人为上限：直接给到模型的最大输出长度（接口要求必须带这个参数，所以取各模型上限）
const MODEL_MAX_TOKENS = { 'claude-haiku-4-5-20251001': 32000 };
const DEFAULT_MAX_TOKENS = 64000;
const maxTokensFor = (model) => Number(process.env.CHAT_MAX_TOKENS) > 0 ? Number(process.env.CHAT_MAX_TOKENS) : (MODEL_MAX_TOKENS[model] || DEFAULT_MAX_TOKENS);
function isTransientAi(e) {
  if (e instanceof HttpError) return false;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError && !TRANSIENT_RE.test(e.message || '')) return false;
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.APIConnectionTimeoutError) return true;
  if (e instanceof Anthropic.RateLimitError) return true;
  if (e instanceof Anthropic.APIError) { const st = e.status || 0; return st >= 500 || st === 408 || st === 409 || (st === 403 && TRANSIENT_RE.test(e.message || '')); }
  return TRANSIENT_RE.test(e.message || '');
}
const AI_RETRIES = Number(process.env.AI_RETRIES) > 0 ? Number(process.env.AI_RETRIES) : 2;
async function withAiRetry(label, fn) {
  let last;
  for (let i = 0; i <= AI_RETRIES; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (!isTransientAi(e) || i === AI_RETRIES) break;
      console.error(`[ai] ${label} 第 ${i + 1} 次失败（${e.message || e}），${(i + 1) * 1.5} 秒后重试`);
      await new Promise((r) => setTimeout(r, (i + 1) * 1500));
    }
  }
  throw last;
}
function aiErrorMessage(e) {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'AI 接口鉴权失败，请检查密钥';
  if (e instanceof Anthropic.RateLimitError) return 'AI 接口请求过于频繁，请稍后再试';
  if (e instanceof Anthropic.APIError) {
    // 中转站上游抽风：说人话，别把原始 JSON 甩给用户
    if (isTransientAi(e)) return `中转站暂时没接通（${e.status || '网络'}），已自动重试 ${AI_RETRIES} 次仍失败，请稍后再发一次；如果一直这样，去中转站看看上游账号 / 分组是否可用`;
    return `AI 接口错误 ${e.status || ''}：${e.message}`.trim();
  }
  if (isTransientAi(e)) return `中转站暂时没接通，已自动重试 ${AI_RETRIES} 次仍失败，请稍后再发一次`;
  return e.message || 'AI 生成失败';
}
function generateReport(params, { force = false, by = '系统' } = {}) {
  const key = reportKey(params);
  if (!anthropic) throw new HttpError(400, '未配置 AI 接口：请在 .env 中设置 ANTHROPIC_AUTH_TOKEN 后重启');
  if (running.has(key)) return running.get(key);
  const report = buildReport(params);
  const hash = dataHash(report);
  const existing = q.report.get(key);
  if (!force && existing && existing.status === 'done' && existing.data_hash === hash) return { key, fresh: true, done: Promise.resolve() };
  const job = { key, content: '', started_at: now() };
  job.done = (async () => {
    try {
      broadcast('ai', { key, status: 'running' });
      const model = aiModel();
      const content = await withAiRetry(`报表 ${key}`, async () => {
        job.content = '';
        broadcast('ai', { key, status: 'running', reset: true });
        const stream = anthropic.messages.stream({ model, max_tokens: maxTokensFor(model), system: SYSTEM_PROMPT, messages: [{ role: 'user', content: buildUserPrompt(report) }] });
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { job.content += ev.delta.text; broadcast('ai', { key, status: 'running', delta: ev.delta.text }); }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') throw new Error('模型拒绝了本次请求');
        const out = job.content.trim();
        if (!out) throw new Error('模型没有返回内容');
        return out;
      });
      const at = now();
      q.saveReport.run(key, params.scope, params.range, report.from, report.to, content, hash, model, at, at);
      kbLog(`${by} 生成了 AI 财务报表：${report.project ? report.project.name : '全部项目'} ${report.label}（${report.from} 至 ${report.to}）`);
      broadcast('ai', { key, status: 'done', content, generated_at: at, model });
    } catch (e) {
      const msg = aiErrorMessage(e);
      console.error(`[ai] ${key} 生成失败：`, e.message);
      q.failReport.run(key, params.scope, params.range, report.from, report.to, msg, now());
      broadcast('ai', { key, status: 'error', error: msg });
    } finally { running.delete(key); }
  })();
  running.set(key, job);
  return job;
}
let autoTimer = null;
function scheduleAutoReports() {
  if (!anthropic || !aiAuto()) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(runAutoReports, AI_AUTO_DELAY_MS);
  autoTimer.unref();
}
async function runAutoReports() {
  const since = new Date(Date.now() - AI_WARM_HOURS * 3600e3).toISOString();
  for (const row of q.warmReports.all(since, since)) {
    try { await generateReport({ scope: row.scope, range: row.range, from: row.from_date, to: row.to_date }, { by: '系统（自动刷新）' }).done; } catch (e) { console.error('[ai] 自动刷新失败：', e.message); }
  }
}

// ---------------------------------------------------------------- Excel 导出（带排版）
const XC = { navy: 'FF1E2F52', white: 'FFFFFFFF', soft: 'FFEEF1F5', stripe: 'FFF7F8FA', line: 'FFDCE1E8', income: 'FF178A57', incomeSoft: 'FFE1F4EA', expense: 'FFD2452F', expenseSoft: 'FFFBE9E5', muted: 'FF7B8594', ink: 'FF131A26', brass: 'FFB8862B', brassSoft: 'FFF6EEDC' };
const MONEY = '#,##0.00;[Red]-#,##0.00';
const MONEY_SIGN = '+#,##0.00;[Red]-#,##0.00;0.00';
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const border = (argb = XC.line) => ({ top: { style: 'thin', color: { argb } }, bottom: { style: 'thin', color: { argb } }, left: { style: 'thin', color: { argb } }, right: { style: 'thin', color: { argb } } });
const FONT = '微软雅黑';
function sheetBase(ws) { ws.properties.defaultRowHeight = 20; ws.views = [{ showGridLines: false }]; }
function titleBlock(ws, title, subtitle, span) {
  ws.mergeCells(1, 1, 1, span); ws.mergeCells(2, 1, 2, span);
  const t = ws.getCell(1, 1); t.value = title; t.font = { name: FONT, size: 18, bold: true, color: { argb: XC.navy } }; t.alignment = { vertical: 'middle' };
  const s = ws.getCell(2, 1); s.value = subtitle; s.font = { name: FONT, size: 10, color: { argb: XC.muted } }; s.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 34; ws.getRow(2).height = 18; ws.getRow(3).height = 8;
}
function sectionTitle(ws, row, text, span) {
  ws.mergeCells(row, 1, row, span);
  const c = ws.getCell(row, 1); c.value = text; c.font = { name: FONT, size: 12, bold: true, color: { argb: XC.ink } };
  c.border = { bottom: { style: 'medium', color: { argb: XC.brass } } }; ws.getRow(row).height = 26; c.alignment = { vertical: 'bottom' };
}
// 表格：表头深色、斑马纹、细边框、数字右对齐、冻结表头、自动筛选
function styledTable(ws, startRow, columns, rows, { totals = null, zebra = true, freeze = true, filter = true } = {}) {
  const hr = ws.getRow(startRow);
  columns.forEach((col, i) => {
    const c = hr.getCell(i + 1); c.value = col.header;
    c.fill = solid(XC.navy); c.font = { name: FONT, bold: true, color: { argb: XC.white }, size: 10.5 };
    c.alignment = { vertical: 'middle', horizontal: col.align || (col.fmt ? 'right' : 'left') }; c.border = border(XC.navy);
    if (col.width) ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width || 0, col.width);
  });
  hr.height = 24;
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    columns.forEach((col, i) => {
      const c = row.getCell(i + 1);
      c.value = typeof col.value === 'function' ? col.value(r) : r[col.key];
      c.font = { name: FONT, size: 10.5, color: { argb: (col.color && col.color(r)) || XC.ink }, bold: !!(col.bold && col.bold(r)) };
      c.alignment = { vertical: 'middle', horizontal: col.align || (col.fmt ? 'right' : 'left'), wrapText: !!col.wrap };
      if (col.fmt) c.numFmt = col.fmt;
      c.border = border();
      if (zebra && ri % 2 === 1) c.fill = solid(XC.stripe);
    });
    row.height = 20;
  });
  let last = startRow + rows.length;
  if (totals && rows.length) {
    last += 1;
    const row = ws.getRow(last);
    columns.forEach((col, i) => {
      const c = row.getCell(i + 1);
      const L = ws.getColumn(i + 1).letter;
      if (i === 0) c.value = totals.label || '合计';
      else if (col.sum) c.value = { formula: `SUM(${L}${startRow + 1}:${L}${startRow + rows.length})` };
      c.font = { name: FONT, bold: true, size: 10.5, color: { argb: XC.ink } }; c.fill = solid(XC.soft); c.border = border();
      c.alignment = { vertical: 'middle', horizontal: col.align || (col.fmt ? 'right' : 'left') };
      if (col.fmt) c.numFmt = col.fmt;
    });
    row.height = 22;
  }
  if (freeze) ws.views = [{ state: 'frozen', ySplit: startRow, showGridLines: false }];
  if (filter && rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: columns.length } };
  return last;
}
function kpiBlock(ws, row, col, label, value, sub, color) {
  const lc = ws.getCell(row, col), vc = ws.getCell(row + 1, col), sc = ws.getCell(row + 2, col);
  ws.mergeCells(row, col, row, col + 1); ws.mergeCells(row + 1, col, row + 1, col + 1); ws.mergeCells(row + 2, col, row + 2, col + 1);
  lc.value = label; lc.font = { name: FONT, size: 10, color: { argb: XC.muted } }; lc.fill = solid(XC.soft); lc.alignment = { vertical: 'middle', indent: 1 };
  vc.value = value; vc.numFmt = MONEY; vc.font = { name: FONT, size: 16, bold: true, color: { argb: color } }; vc.fill = solid(XC.soft); vc.alignment = { vertical: 'middle', indent: 1 };
  sc.value = sub; sc.font = { name: FONT, size: 9, color: { argb: XC.muted } }; sc.fill = solid(XC.soft); sc.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  for (const c of [lc, vc, sc]) c.border = { left: { style: 'medium', color: { argb: color } } };
  ws.getRow(row).height = 18; ws.getRow(row + 1).height = 28; ws.getRow(row + 2).height = 18;
}
const curLine = (t) => ['CNY', 'USDT', 'USD'].filter((c) => t[c]).map((c) => `${c} ${t[c].toLocaleString('zh-CN')}`).join(' · ') || '—';
// Markdown（AI 报表）→ 有排版的单元格
function mdToSheet(ws, content, span = 6) {
  let row = 4;
  const lines = String(content || '').split(/\r?\n/);
  let i = 0;
  const para = (text, opts = {}) => {
    ws.mergeCells(row, 1, row, span);
    const c = ws.getCell(row, 1); c.value = text; c.alignment = { wrapText: true, vertical: 'top', indent: opts.indent || 0 };
    c.font = { name: FONT, size: opts.size || 10.5, bold: !!opts.bold, color: { argb: opts.color || XC.ink } };
    if (opts.fill) c.fill = solid(opts.fill);
    if (opts.border) c.border = { bottom: { style: 'medium', color: { argb: XC.brass } } };
    ws.getRow(row).height = opts.height || Math.max(18, Math.ceil(text.length / 60) * 16 + 4);
    row += 1;
  };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i += 1; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { const lvl = h[1].length; para(h[2].replace(/\*\*/g, ''), { bold: true, size: lvl === 1 ? 15 : lvl === 2 ? 12.5 : 11, color: lvl === 1 ? XC.navy : XC.ink, border: lvl === 2, height: lvl === 1 ? 30 : 24 }); if (lvl === 1) row += 1; i += 1; continue; }
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*/g, ''));
      const head = cells(rows[0]); const body = rows.slice(1).filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map(cells);
      const num = (v) => { const m = String(v).replace(/[¥$₮,\s]/g, ''); return /^[−\-+]?\d+(\.\d+)?%?$/.test(m) ? (m.endsWith('%') ? m : Number(m.replace('−', '-'))) : v; };
      const cols = head.map((hd, ci) => ({ header: hd, value: (r) => num(r[ci] ?? ''), fmt: body.every((r) => typeof num(r[ci] ?? '') === 'number') ? MONEY : null, width: 18, wrap: true }));
      row = styledTable(ws, row, cols, body, { freeze: false, filter: false }) + 1;
      continue;
    }
    if (/^\s*([-*•]|\d+[.、])\s+/.test(l)) {
      while (i < lines.length && /^\s*([-*•]|\d+[.、])\s+/.test(lines[i])) { const t = lines[i].replace(/^\s*([-*•])\s+/, '• ').replace(/\*\*/g, ''); para(t, { indent: 1 }); i += 1; }
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(l)) { row += 1; i += 1; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^#{1,4}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^\s*([-*•]|\d+[.、])\s+/.test(lines[i])) buf.push(lines[i++]);
    para(buf.join(' ').replace(/\*\*/g, ''));
  }
  return row;
}

async function buildWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '元启智能账单系统'; wb.created = new Date();
  const scopeName = report.project ? report.project.name : '全部项目';
  const exportedAt = new Date().toLocaleString('zh-CN', { timeZone: report.tz, hour12: false });
  const sub = `${scopeName} · ${report.label}（${report.from} 至 ${report.to}，共 ${report.days} 天）· 上期 ${report.prevFrom} 至 ${report.prevTo} · 导出于 ${exportedAt} · 金额按每笔记账时汇率折算为人民币`;
  const k = report.kpis, p = report.prev, an = report.analysis;
  const pct = (a, b) => (b > 0 ? `${a - b >= 0 ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%` : '—');

  // ---- 概览
  const ov = wb.addWorksheet('概览', { properties: { tabColor: { argb: XC.navy } } });
  sheetBase(ov);
  [22, 16, 4, 22, 16, 4, 22, 16].forEach((w, i) => { ov.getColumn(i + 1).width = w; });
  titleBlock(ov, `${scopeName} · 财务报表`, sub, 8);
  kpiBlock(ov, 4, 1, '收入', k.income.base, curLine(k.income), XC.income);
  kpiBlock(ov, 4, 4, '支出', k.expense.base, curLine(k.expense), XC.expense);
  kpiBlock(ov, 4, 7, '利润 = 收入 − 支出', k.profit, `${k.count} 笔记录 · 较上期 ${pct(k.profit, p.profit)}`, k.profit < 0 ? XC.expense : XC.brass);
  ov.getRow(7).height = 10;
  sectionTitle(ov, 8, '与上期对比', 8);
  let r = styledTable(ov, 9, [
    { header: '指标', key: 'name', width: 22 }, { header: '本期（¥）', key: 'cur', fmt: MONEY, width: 16 }, { header: '', key: 'gap', width: 4 },
    { header: '上期（¥）', key: 'prev', fmt: MONEY, width: 22 }, { header: '变化（¥）', key: 'diff', fmt: MONEY_SIGN, width: 16, color: (x) => (x.diff > 0 ? XC.income : x.diff < 0 ? XC.expense : XC.ink) }, { header: '', key: 'gap2', width: 4 },
    { header: '变化率', key: 'rate', align: 'right', width: 22 }, { header: '说明', key: 'note', width: 16 },
  ], [
    { name: '收入', cur: k.income.base, prev: p.income.base, diff: r2(k.income.base - p.income.base), rate: pct(k.income.base, p.income.base), note: '' },
    { name: '支出', cur: k.expense.base, prev: p.expense.base, diff: r2(k.expense.base - p.expense.base), rate: pct(k.expense.base, p.expense.base), note: '' },
    { name: '利润', cur: k.profit, prev: p.profit, diff: r2(k.profit - p.profit), rate: pct(k.profit, p.profit), note: '收入 − 支出' },
    { name: '笔数', cur: k.count, prev: p.count, diff: k.count - p.count, rate: pct(k.count, p.count), note: '' },
  ], { freeze: false, filter: false });
  for (const [c, f] of [[2, '0'], [4, '0'], [5, '+0;-0;0']]) ov.getCell(r, c).numFmt = f;
  r += 2;
  if (!report.project) {
    sectionTitle(ov, r, '按项目', 8); r += 1;
    r = styledTable(ov, r, [
      { header: '项目', key: 'name', width: 22 }, { header: '收入（¥）', key: 'income', fmt: MONEY, width: 16, color: () => XC.income }, { header: '', key: 'g', width: 4 },
      { header: '支出（¥）', key: 'expense', fmt: MONEY, width: 22, color: () => XC.expense }, { header: '利润（¥）', key: 'profit', fmt: MONEY, width: 16, bold: () => true, color: (x) => (x.profit < 0 ? XC.expense : XC.ink) }, { header: '', key: 'g2', width: 4 },
      { header: '笔数', key: 'count', align: 'right', width: 22 }, { header: '状态', key: 'status', width: 16 },
    ], report.byProject.map((x) => ({ ...x, status: x.archived ? '已归档' : '进行中' })), { freeze: false, filter: false, totals: { label: '合计' } });
    for (const c of [2, 4, 5]) ov.getCell(r, c).value = { formula: `SUM(${ov.getColumn(c).letter}${r - report.byProject.length}:${ov.getColumn(c).letter}${r - 1})` };
    r += 2;
  } else {
    sectionTitle(ov, r, '支出用途 Top', 8); r += 1;
    const totalExp = k.expense.base || 1;
    r = styledTable(ov, r, [
      { header: '用途（备注）', key: 'note', width: 22 }, { header: '金额（¥）', key: 'cny', fmt: MONEY, width: 16, color: () => XC.expense }, { header: '', key: 'g', width: 4 },
      { header: '占支出比例', key: 'share', align: 'right', width: 22 }, { header: '笔数', key: 'count', align: 'right', width: 16 },
    ], an.byNote.expense.slice(0, 10).map((x) => ({ ...x, share: `${((x.cny / totalExp) * 100).toFixed(1)}%` })), { freeze: false, filter: false });
    r += 2;
  }
  sectionTitle(ov, r, '按成员（经手人）', 8); r += 1;
  r = styledTable(ov, r, [
    { header: '成员', key: 'name', width: 22 }, { header: '支出（¥）', key: 'expense', fmt: MONEY, width: 16, color: () => XC.expense }, { header: '', key: 'g', width: 4 },
    { header: '收款（¥）', key: 'income', fmt: MONEY, width: 22, color: () => XC.income }, { header: '笔数', key: 'count', align: 'right', width: 16 },
  ], report.byMember, { freeze: false, filter: false });
  r += 2;
  sectionTitle(ov, r, '币种构成', 8); r += 1;
  r = styledTable(ov, r, [
    { header: '币种', key: 'currency', width: 22 }, { header: '收入（原币）', key: 'income', fmt: '#,##0.00', width: 16 }, { header: '', key: 'g', width: 4 },
    { header: '收入折合（¥）', key: 'incomeCny', fmt: MONEY, width: 22, color: () => XC.income }, { header: '支出（原币）', key: 'expense', fmt: '#,##0.00', width: 16 }, { header: '', key: 'g2', width: 4 },
    { header: '支出折合（¥）', key: 'expenseCny', fmt: MONEY, width: 22, color: () => XC.expense }, { header: '笔数', key: 'count', align: 'right', width: 16 },
  ], an.byCurrency, { freeze: false, filter: false });
  ov.views = [{ showGridLines: false }];

  // ---- 每日账单
  const dl = wb.addWorksheet('每日账单', { properties: { tabColor: { argb: XC.brass } } });
  sheetBase(dl);
  titleBlock(dl, '每日账单', `${scopeName} · ${report.from} 至 ${report.to} · 仅列出有记录的日期`, 6);
  const dailyRows = report.daily.filter((d) => d.count);
  styledTable(dl, 4, [
    { header: '日期', key: 'date', width: 14 }, { header: '收入（¥）', key: 'income', fmt: MONEY, width: 16, color: () => XC.income, sum: true },
    { header: '支出（¥）', key: 'expense', fmt: MONEY, width: 16, color: () => XC.expense, sum: true }, { header: '利润（¥）', key: 'profit', fmt: MONEY, width: 16, bold: () => true, color: (x) => (x.profit < 0 ? XC.expense : XC.ink), sum: true },
    { header: '累计利润（¥）', key: 'cumulative', fmt: MONEY, width: 18, color: (x) => (x.cumulative < 0 ? XC.expense : XC.ink) }, { header: '笔数', key: 'count', align: 'right', width: 8, sum: true },
  ], dailyRows, { totals: { label: '合计' } });

// ---- 流水明细
  const el = wb.addWorksheet('流水明细', { properties: { tabColor: { argb: XC.income } } });
  sheetBase(el);
  titleBlock(el, '流水明细', `${scopeName} · ${report.from} 至 ${report.to} · 共 ${report.entries.length} 笔 · 折合人民币按每笔记账时的汇率`, 11);
  styledTable(el, 4, [
    { header: '时间', key: 'time', width: 17 }, { header: '项目', key: 'project', width: 18 }, { header: '类型', key: 'type', width: 7, align: 'center', color: (x) => (x.type === '收入' ? XC.income : XC.expense), bold: () => true },
    { header: '金额', key: 'amount', fmt: '#,##0.00', width: 13 }, { header: '币种', key: 'currency', width: 7, align: 'center' }, { header: '记账汇率', key: 'rate', fmt: '0.00##', width: 9 },
    { header: '折合人民币（¥）', key: 'base', fmt: MONEY_SIGN, width: 17, color: (x) => (x.base < 0 ? XC.expense : XC.income), sum: true },
    { header: '经手人', key: 'handler', width: 11 }, { header: '登记人', key: 'creator', width: 11 }, { header: '备注', key: 'note', width: 32, wrap: true }, { header: '记录号', key: 'id', align: 'right', width: 8 },
  ], report.entries.map((e) => ({ time: fmtTZ(e.created_at), project: e.project_name, type: e.type === 'income' ? '收入' : '支出', amount: e.amount, currency: e.currency, rate: e.rate, base: e.type === 'income' ? e.base : -e.base, handler: e.handler_name, creator: e.creator_name, note: e.note, id: e.id })), { totals: { label: '净额' } });

  // ---- 项目分析（单项目）/ 月度趋势
  const anws = wb.addWorksheet(report.project ? '项目分析' : '月度趋势', { properties: { tabColor: { argb: XC.muted } } });
  sheetBase(anws);
  titleBlock(anws, report.project ? `${scopeName} · 项目分析` : '月度趋势', sub, 8);
  let ar = 4;
  sectionTitle(anws, ar, '月度趋势', 8); ar += 1;
  ar = styledTable(anws, ar, [
    { header: '月份', key: 'month', width: 12 }, { header: '收入（¥）', key: 'income', fmt: MONEY, width: 16, color: () => XC.income, sum: true }, { header: '支出（¥）', key: 'expense', fmt: MONEY, width: 16, color: () => XC.expense, sum: true },
    { header: '利润（¥）', key: 'profit', fmt: MONEY, width: 16, bold: () => true, color: (x) => (x.profit < 0 ? XC.expense : XC.ink), sum: true }, { header: '笔数', key: 'count', align: 'right', width: 8, sum: true },
  ], an.monthly, { freeze: false, filter: false, totals: { label: '合计' } }) + 2;
  if (report.project) {
    sectionTitle(anws, ar, '支出用途分布', 8); ar += 1;
    const totalExp = k.expense.base || 1;
    ar = styledTable(anws, ar, [
      { header: '用途（备注）', key: 'note', width: 26 }, { header: '金额（¥）', key: 'cny', fmt: MONEY, width: 16, color: () => XC.expense, sum: true }, { header: '占比', key: 'share', align: 'right', width: 10 }, { header: '笔数', key: 'count', align: 'right', width: 8, sum: true },
    ], an.byNote.expense.map((x) => ({ ...x, share: `${((x.cny / totalExp) * 100).toFixed(1)}%` })), { freeze: false, filter: false, totals: { label: '合计' } }) + 2;
    if (an.byNote.income.length) {
      sectionTitle(anws, ar, '收入来源分布', 8); ar += 1;
      const totalInc = k.income.base || 1;
      ar = styledTable(anws, ar, [
        { header: '来源（备注）', key: 'note', width: 26 }, { header: '金额（¥）', key: 'cny', fmt: MONEY, width: 16, color: () => XC.income, sum: true }, { header: '占比', key: 'share', align: 'right', width: 10 }, { header: '笔数', key: 'count', align: 'right', width: 8, sum: true },
      ], an.byNote.income.map((x) => ({ ...x, share: `${((x.cny / totalInc) * 100).toFixed(1)}%` })), { freeze: false, filter: false, totals: { label: '合计' } }) + 2;
    }
    sectionTitle(anws, ar, '大额支出 Top 10', 8); ar += 1;
    ar = styledTable(anws, ar, [
      { header: '时间', key: 'time', width: 17 }, { header: '金额', key: 'amount', fmt: '#,##0.00', width: 13 }, { header: '币种', key: 'currency', width: 7, align: 'center' }, { header: '折合（¥）', key: 'cny', fmt: MONEY, width: 15, color: () => XC.expense },
      { header: '经手人', key: 'handler', width: 11 }, { header: '备注', key: 'note', width: 30, wrap: true }, { header: '记录号', key: 'id', align: 'right', width: 8 },
    ], an.top.expense, { freeze: false, filter: false }) + 2;
  }
  anws.views = [{ showGridLines: false }];

  // ---- 往来（单项目）
  if (report.project) {
    const sm = projectPartiesSummary(report.project.id);
    if (sm.suppliers.length || sm.customers.length) {
      const pw = wb.addWorksheet('往来', { properties: { tabColor: { argb: XC.expense } } });
      sheetBase(pw);
      titleBlock(pw, `${scopeName} · 供应商与客户往来`, `应付 ${cny(sm.totals.supplier.due)} / 实付 ${cny(sm.totals.supplier.paid)} / 未付 ${cny(sm.totals.supplier.open)} · 应收 ${cny(sm.totals.customer.due)} / 实收 ${cny(sm.totals.customer.paid)} / 未收 ${cny(sm.totals.customer.open)} · 折合人民币`, 7);
      let pr = 4;
      for (const [kind, list] of [['supplier', sm.suppliers], ['customer', sm.customers]]) {
        if (!list.length) continue;
        const L = PARTY_LABEL[kind];
        sectionTitle(pw, pr, `${L.name}（${list.length}）`, 7); pr += 1;
        pr = styledTable(pw, pr, [
          { header: L.name, key: 'name', width: 22 }, { header: '币种', key: 'cur', width: 7, align: 'center' }, { header: kind === 'customer' ? '折扣' : '倍率', key: 'ratio', width: 7, align: 'right' },
          { header: `${L.due}（结算币种）`, key: 'due', fmt: '#,##0.00', width: 16 }, { header: `${L.paid}（结算币种）`, key: 'paid', fmt: '#,##0.00', width: 16, color: () => (kind === 'supplier' ? XC.expense : XC.income) },
          { header: `${L.open}（结算币种）`, key: 'open', fmt: '#,##0.00', width: 16, bold: () => true, color: (x) => (x.open > 0 ? XC.brass : XC.ink) }, { header: `${L.open}折合（¥）`, key: 'open_cny', fmt: MONEY, width: 16, sum: true },
          { header: '最近日期', key: 'last', width: 12 }, { header: '备注', key: 'note', width: 24, wrap: true },
        ], list.map((v) => ({ name: v.name + (v.archived ? '（归档）' : '') + (v.relay ? '（中转站）' : ''), cur: v.currency, ratio: v.ratio, due: v.settle.due, paid: v.settle.paid, open: v.settle.open - v.settle.credit, open_cny: v.settle.open_cny, last: v.totals.last_at || '', note: [v.contact, v.note].filter(Boolean).join(' · ') })), { freeze: false, filter: false, totals: { label: '合计' } }) + 2;
      }
      sectionTitle(pw, pr, '往来日报', 7); pr += 1;
      pr = styledTable(pw, pr, [
        { header: '日期', key: 'date', width: 14 }, { header: '应收（¥）', key: 'receivable', fmt: MONEY, width: 16, sum: true }, { header: '实收（¥）', key: 'received', fmt: MONEY, width: 16, sum: true, color: () => XC.income },
        { header: '应付（¥）', key: 'payable', fmt: MONEY, width: 16, sum: true }, { header: '实付（¥）', key: 'paid', fmt: MONEY, width: 16, sum: true, color: () => XC.expense }, { header: '笔数', key: 'count', align: 'right', width: 8 },
      ], sm.daily, { freeze: false, filter: false, totals: { label: '合计' } }) + 2;
      const recs = q.recordsOfProject.all(report.project.id);
      sectionTitle(pw, pr, '往来明细', 7); pr += 1;
      styledTable(pw, pr, [
        { header: '日期', key: 'date', width: 14 }, { header: '对象', key: 'party', width: 22 }, { header: '类型', key: 'type', width: 8, align: 'center' }, { header: '金额', key: 'amount', fmt: '#,##0.00', width: 14 },
        { header: '币种', key: 'currency', width: 7, align: 'center' }, { header: '折合（¥）', key: 'cny', fmt: MONEY, width: 15 }, { header: '备注 / 来源', key: 'note', width: 30, wrap: true },
      ], recs.map((r) => ({ date: r.date, party: `${r.party_name}（${PARTY_LABEL[r.party_kind].name}）`, type: PARTY_LABEL[r.party_kind][r.kind], amount: r.amount, currency: r.currency, cny: r2(recBase(r)), note: [r.note, r.source === 'api' ? '接口同步' : r.source === 'ai' ? 'AI' : r.source === 'relay' ? '中转站自动' : ''].filter(Boolean).join(' · ') })), { freeze: false, filter: false });
      pw.views = [{ showGridLines: false }];
    }
  }

  // ---- 成员资金沉淀
  {
    const fd = memberFunds(report.project ? report.project.id : null);
    if (fd.members.length) {
      const fw = wb.addWorksheet('成员资金', { properties: { tabColor: { argb: XC.brass } } });
      sheetBase(fw);
      titleBlock(fw, `${scopeName} · 成员资金沉淀`, `沉淀 = 经手收款 − 经手付款 + 转入 − 转出；合计 ${cny(fd.totals.balance)}（收款 ${cny(fd.totals.income)} / 付款 ${cny(fd.totals.expense)} / 成员间转账 ${cny(fd.totals.in)}）`, 8);
      let fr = 4;
      fr = styledTable(fw, fr, [
        { header: '成员', key: 'name', width: 14 },
        { header: '经手收款（¥）', key: 'income', fmt: MONEY, width: 16, sum: true, color: () => XC.income },
        { header: '经手付款（¥）', key: 'expense', fmt: MONEY, width: 16, sum: true, color: () => XC.expense },
        { header: '转入（¥）', key: 'in', fmt: MONEY, width: 14, sum: true },
        { header: '转出（¥）', key: 'out', fmt: MONEY, width: 14, sum: true },
        { header: '沉淀（¥）', key: 'balance', fmt: MONEY, width: 16, sum: true, bold: () => true, color: (x) => (x.balance >= 0 ? XC.brass : XC.expense) },
        { header: '其中 USDT', key: 'usdt', fmt: '#,##0.00', width: 13 },
        { header: '其中 USD', key: 'usd', fmt: '#,##0.00', width: 13 },
      ], fd.members.map((m) => ({ name: m.name, income: m.income, expense: m.expense, in: m.in, out: m.out, balance: m.balance, usdt: m.cur.balance.USDT, usd: m.cur.balance.USD })), { freeze: false, filter: false, totals: { label: '合计' } }) + 2;
      if (fd.transfers.length) {
        sectionTitle(fw, fr, `成员之间的转账（${fd.transfers.length}）`, 8); fr += 1;
        styledTable(fw, fr, [
          { header: '时间', key: 'time', width: 17 }, { header: '转出', key: 'from', width: 12 }, { header: '转入', key: 'to', width: 12 },
          { header: '金额', key: 'amount', fmt: '#,##0.00', width: 14 }, { header: '币种', key: 'currency', width: 7, align: 'center' },
          { header: '折合（¥）', key: 'cny', fmt: MONEY, width: 15, sum: true }, { header: '项目', key: 'project', width: 16 }, { header: '备注', key: 'note', width: 26, wrap: true },
        ], fd.transfers.map((t) => ({ ...t, project: t.project || '不挂项目' })), { freeze: false, filter: false });
      }
      fw.views = [{ showGridLines: false }];
    }
  }

  // ---- AI 财务报表
  const row = q.report.get(reportKey(report));
  if (row && row.content) {
    const ai = wb.addWorksheet('AI 财务报表', { properties: { tabColor: { argb: XC.brass } } });
    sheetBase(ai);
    [26, 18, 18, 18, 18, 18].forEach((w, i) => { ai.getColumn(i + 1).width = w; });
    titleBlock(ai, 'AI 财务报表', `由 ${row.model} 生成于 ${fmtTZ(row.generated_at)} · ${scopeName} · ${report.from} 至 ${report.to}`, 6);
    mdToSheet(ai, row.content, 6);
    ai.views = [{ showGridLines: false }];
  }
  return wb;
}

// ---------------------------------------------------------------- 导出记录（手动 / 自动 / AI 触发）
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
async function runExport(params, { source = 'manual', user = null, format = 'xlsx' } = {}) {
  params = normalizeReportParams(params);
  if (anthropic) { try { await generateReport(params, { by: user ? user.username : '系统' }).done; } catch (e) { console.error('[export] AI 报表刷新失败：', e.message); } }
  const report = buildReport(params);
  const scopeName = report.project ? report.project.name : '全部项目';
  const stamp = inTZ().iso.replace(/[-:]/g, '').replace('T', '-');
  const rows = [];
  for (const f of (format === 'both' ? ['xlsx', 'md'] : [format])) {
    let buf, name;
    if (f === 'xlsx') { buf = Buffer.from(await (await buildWorkbook(report)).xlsx.writeBuffer()); name = `元启-${scopeName}-${report.from}~${report.to}.xlsx`; }
    else {
      const row = q.report.get(reportKey(params));
      if (!row || !row.content) { if (format === 'md') throw new HttpError(404, '还没有生成这个范围的 AI 报表'); continue; }
      buf = Buffer.from(`${row.content}\n\n---\n由 ${row.model} 生成于 ${fmtTZ(row.generated_at)}\n`, 'utf8'); name = `元启-AI财务报表-${scopeName}-${report.from}~${report.to}.md`;
    }
    const file = `${stamp}-${safeName(scopeName)}-${report.from}_${report.to}.${f}`;
    fs.writeFileSync(path.join(EXPORT_DIR, file), buf);
    const r = q.insertExport.run(file, name, f, params.scope, params.range, report.from, report.to, buf.length, source, user ? user.id : null, now());
    rows.push({ ...q.exportById.get(Number(r.lastInsertRowid)), url: `/api/exports/${Number(r.lastInsertRowid)}/download` });
  }
  for (const old of q.oldExports.all()) { try { fs.unlinkSync(path.join(EXPORT_DIR, old.file)); } catch {} q.deleteExport.run(old.id); }
  kbLog(`${user ? user.username : '系统'} 导出了报表（${{ manual: '手动', auto: '自动', ai: 'AI 助手' }[source] || source}）：${rows.map((r) => r.name).join('、')}`);
  broadcast('exports', { source, by: user ? user.username : '系统', names: rows.map((r) => r.name) });
  return rows;
}
async function checkAutoExport() {
  const cfg = getAutoExport();
  if (!cfg.enabled) return;
  const t = inTZ();
  if (t.time !== cfg.time || getSetting('auto_export_last', '') === t.date) return;
  q.putSetting.run('auto_export_last', t.date);
  try { await runExport({ scope: cfg.scope, range: cfg.range }, { source: 'auto', format: 'both' }); console.log(`[export] 自动导出完成 ${t.date} ${t.time}`); }
  catch (e) { console.error('[export] 自动导出失败：', e.message); }
}
setInterval(checkAutoExport, 60 * 1000).unref();

// ---------------------------------------------------------------- 附件（图片 / 表格 / PDF / 文本 → 模型可读内容）
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/;
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', tsv: 'text/tab-separated-values' };
const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ');
  if (typeof v === 'object') { if (v.richText) return v.richText.map((t) => t.text).join(''); if (v.text !== undefined) return String(v.text); if (v.result !== undefined) return cellText(v.result); if (v.error) return String(v.error); return JSON.stringify(v); }
  return String(v);
};
async function xlsxToText(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = [];
  let sheets = 0;
  wb.eachSheet((ws) => {
    if (++sheets > 5) return;
    out.push(`## 工作表「${ws.name}」（${ws.rowCount} 行）`);
    let rows = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (++rows > 400) return;
      const vals = row.values.slice(1).map(cellText);
      if (vals.some((v) => v !== '')) out.push(`| ${vals.join(' | ')} |`);
    });
    if (rows > 400) out.push(`…（还有 ${rows - 400} 行未显示）`);
  });
  return out.join('\n');
}
const ENTRY_IMAGE_MAX = 9;
// 记录上的图片：附件 id 数组 → 前端可直接显示的附件信息（已被删的跳过）
function entryImages(e) {
  let ids = []; try { ids = JSON.parse(e.images || '[]'); } catch {}
  return ids.map((id) => q.attachment.get(Number(id))).filter(Boolean).map(attachmentView);
}
function attachmentView(a) { return { id: a.id, name: a.name, mime: a.mime, size: a.size, url: `/api/attachments/${a.id}`, image: IMAGE_MIME.test(a.mime) }; }
// full = 当前这轮（图片 / PDF 原文喂给模型）；历史轮次只保留文字占位或已解析的表格文本
async function attachmentBlocks(a, full) {
  const file = path.join(UPLOAD_DIR, path.basename(a.file));
  if (!fs.existsSync(file)) return [{ type: 'text', text: `[附件 ${a.name} 已不存在]` }];
  if (IMAGE_MIME.test(a.mime)) {
    if (!full) return [{ type: 'text', text: `[图片附件：${a.name}（已在当时查看）]` }];
    const data = fs.readFileSync(file);
    if (data.length > 5 * 1024 * 1024) return [{ type: 'text', text: `[图片 ${a.name} 超过 5MB，未能读取]` }];
    return [{ type: 'text', text: `[图片附件：${a.name}]` }, { type: 'image', source: { type: 'base64', media_type: a.mime, data: data.toString('base64') } }];
  }
  if (a.mime === 'application/pdf') {
    if (!full) return [{ type: 'text', text: `[PDF 附件：${a.name}（已在当时阅读）]` }];
    const data = fs.readFileSync(file);
    if (data.length > 20 * 1024 * 1024) return [{ type: 'text', text: `[PDF ${a.name} 超过 20MB，未能读取]` }];
    return [{ type: 'text', text: `[PDF 附件：${a.name}]` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } }];
  }
  if (a.mime === MIME_BY_EXT.xlsx || /\.xlsx$/i.test(a.name)) {
    try { return [{ type: 'text', text: `[表格附件 ${a.name} 内容如下（每行一条，| 分隔）]\n${(await xlsxToText(file)).slice(0, 60000)}` }]; }
    catch (e) { return [{ type: 'text', text: `[表格附件 ${a.name} 解析失败：${e.message}]` }]; }
  }
  if (/^text\/|json$/.test(a.mime) || /\.(csv|txt|md|json|tsv)$/i.test(a.name)) {
    return [{ type: 'text', text: `[文件附件 ${a.name} 内容如下]\n${fs.readFileSync(file, 'utf8').slice(0, 60000)}` }];
  }
  return [{ type: 'text', text: `[附件 ${a.name}（${a.mime}）暂不支持解析，请转成图片、Excel、CSV 或 PDF]` }];
}

// ---------------------------------------------------------------- 中转站（Sub2API 管理接口）：客户消耗 / 余额 / 实时 RPM
const RELAY = { base: (process.env.RELAY_BASE_URL || '').replace(/\/+$/, ''), key: process.env.RELAY_ADMIN_KEY || '', name: process.env.RELAY_NAME || '中转站' };
const relayConfigured = () => !!(RELAY.base && RELAY.key);
async function relayCall(method, path, { params = null, body = null } = {}) {
  if (!relayConfigured()) throw new HttpError(400, '未配置中转站接口（RELAY_BASE_URL / RELAY_ADMIN_KEY）');
  const url = new URL(`${RELAY.base}/api/v1${path}`);
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) { // 网络抖动时重试两次
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25 * 1000);
    try {
      const res = await fetch(url, { method, headers: { 'X-API-Key': RELAY.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { throw new HttpError(502, `中转站返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 80)}`); }
      if (res.status === 401 || res.status === 403) throw new HttpError(502, '中转站管理密钥无效或已过期');
      if (!res.ok || (data && data.code !== 0 && data.code !== undefined)) throw new HttpError(502, `中转站接口错误：${data.message || data.code || res.status}`);
      return data.data;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    } finally { clearTimeout(timer); }
  }
  throw new HttpError(502, `连不上中转站：${lastErr && lastErr.name === 'AbortError' ? '超时' : (lastErr && lastErr.message) || '网络错误'}`);
}
const relayGet = (path, params) => relayCall('GET', path, { params });
const relayPost = (path, body) => relayCall('POST', path, { body });
const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function relayRange(range, from, to) {
  const today = todayKey();
  switch (range || 'today') {
    case 'yesterday': return { start_date: addDays(today, -1), end_date: addDays(today, -1), label: '昨天' };
    case '7d': return { start_date: addDays(today, -6), end_date: today, label: '近 7 天' };
    case '30d': return { start_date: addDays(today, -29), end_date: today, label: '近 30 天' };
    case 'month': return { start_date: `${today.slice(0, 7)}-01`, end_date: today, label: '本月' };
    case 'custom': if (!RE_DATE.test(from || '') || !RE_DATE.test(to || '')) throw new HttpError(400, '自定义区间需要 from / to（YYYY-MM-DD）'); return { start_date: from, end_date: to, label: `${from} 至 ${to}` };
    default: return { start_date: today, end_date: today, label: '今天' };
  }
}
const relayUserView = (u) => ({ id: u.id, email: u.email, username: u.username || '', status: u.status, balance_usd: Number(u.balance || 0), frozen_balance_usd: Number(u.frozen_balance || 0), total_recharged_usd: Number(u.total_recharged || 0), rpm_limit: u.rpm_limit, concurrency_limit: u.concurrency, current_concurrency: u.current_concurrency, last_active_at: u.last_active_at ? fmtTZ(u.last_active_at) : null, last_used_at: u.last_used_at ? fmtTZ(u.last_used_at) : null, notes: u.notes || '' });
// 按邮箱 / 用户名 / id 找中转站用户（客户）
async function relayFindUser(ref) {
  const str = String(ref ?? '').trim();
  if (!str) throw new HttpError(400, '请说明客户（中转站的邮箱、用户名或 id）');
  if (/^\d+$/.test(str)) {
    const d = await relayGet('/admin/users', { page: 1, page_size: 50, search: str });
    const hit = (d.items || []).find((u) => String(u.id) === str);
    if (hit) return hit;
  }
  const d = await relayGet('/admin/users', { page: 1, page_size: 20, search: str });
  const items = d.items || [];
  if (!items.length) throw new HttpError(404, `中转站没有匹配「${str}」的客户`);
  const lower = str.toLowerCase();
  return items.find((u) => (u.email || '').toLowerCase() === lower || (u.username || '').toLowerCase() === lower) || items[0];
}
// 实时速率：拉最近的请求日志，统计最近 1 分钟 / 5 分钟
async function relayLiveRate(userId) {
  const now = Date.now();
  let items = [];
  for (let page = 1; page <= 5; page++) {
    const d = await relayGet('/admin/usage', { page, page_size: 200, user_id: userId });
    const batch = d.items || [];
    items = items.concat(batch);
    if (batch.length < 200) break;
    const oldest = new Date(batch[batch.length - 1].created_at).getTime();
    if (now - oldest > 5 * 60 * 1000) break;
  }
  const within = (ms) => items.filter((x) => now - new Date(x.created_at).getTime() <= ms);
  const m1 = within(60 * 1000), m5 = within(5 * 60 * 1000);
  const tok = (list) => list.reduce((a, x) => a + (Number(x.input_tokens) || 0) + (Number(x.output_tokens) || 0) + (Number(x.cache_creation_tokens) || 0) + (Number(x.cache_read_tokens) || 0), 0);
  const models = {};
  for (const x of m5) models[x.model] = (models[x.model] || 0) + 1;
  return { rpm_now: m1.length, tpm_now: tok(m1), rpm_5m_avg: Math.round((m5.length / 5) * 10) / 10, cost_5m_usd: r2(m5.reduce((a, x) => a + (Number(x.actual_cost ?? x.total_cost) || 0), 0)), last_request_at: items[0] ? fmtTZ(items[0].created_at) : null, models_5m: models, sampled: items.length };
}
async function runRelayTool(name, input) {
  switch (name) {
    case 'relay_overview': {
      const [s, rt] = await Promise.all([relayGet('/admin/dashboard/stats'), relayGet('/admin/dashboard/realtime').catch(() => null)]);
      const out = { site: RELAY.name, updated_at: s.stats_updated_at ? fmtTZ(s.stats_updated_at) : null, rpm_now: s.rpm, realtime: rt, today: { requests: s.today_requests, cost_usd: r2(s.today_actual_cost), tokens: s.today_tokens, input_tokens: s.today_input_tokens, output_tokens: s.today_output_tokens, new_users: s.today_new_users }, users: { total: s.total_users, active: s.active_users, hourly_active: s.hourly_active_users, api_keys_active: s.active_api_keys }, upstream_accounts: { total: s.total_accounts, normal: s.normal_accounts, error: s.error_accounts, ratelimit: s.ratelimit_accounts, overload: s.overload_accounts }, all_time: { requests: s.total_requests, cost_usd: r2(s.total_actual_cost), tokens: s.total_tokens }, average_duration_ms: Math.round(s.average_duration_ms || 0) };
      return { ...out, summary: `${RELAY.name}：当前 ${s.rpm} RPM，今日 ${s.today_requests} 次请求 / ${usd(s.today_actual_cost)}，活跃用户 ${s.active_users}/${s.total_users}，上游账号正常 ${s.normal_accounts} 异常 ${s.error_accounts}` };
    }
    case 'relay_find_users': {
      const d = await relayGet('/admin/users', { page: 1, page_size: Math.min(50, Number(input.limit) || 20), search: input.keyword || '' });
      const users = (d.items || []).map(relayUserView);
      return { total: d.total, users, summary: `找到 ${d.total} 个客户，返回 ${users.length} 个` };
    }
    case 'relay_user_usage': {
      const u = await relayFindUser(input.user);
      const rng = relayRange(input.range, input.from, input.to);
      const [stats, usage, live, bd] = await Promise.all([
        relayGet('/admin/usage/stats', { user_id: u.id, start_date: rng.start_date, end_date: rng.end_date }),
        relayPost('/admin/dashboard/users-usage', { user_ids: [u.id] }).catch(() => null),
        input.live === false ? null : relayLiveRate(u.id),
        relayGet('/admin/dashboard/user-breakdown', { user_id: u.id, start_date: rng.start_date, end_date: rng.end_date }).catch(() => null),
      ]);
      const uu = usage && usage.stats ? usage.stats[String(u.id)] : null;
      const out = { user: relayUserView(u), range: rng, usage: { requests: stats.total_requests, cost_usd: r2(stats.total_actual_cost ?? stats.total_cost), billed_cost_usd: r2(stats.total_cost), tokens: stats.total_tokens, input_tokens: stats.total_input_tokens, output_tokens: stats.total_output_tokens, cache_read_tokens: stats.total_cache_read_tokens, cache_creation_tokens: stats.total_cache_creation_tokens, average_duration_ms: Math.round(stats.average_duration_ms || 0), endpoints: stats.endpoints || [] }, today_cost_usd: uu ? r2(uu.today_actual_cost) : null, all_time_cost_usd: uu ? r2(uu.total_actual_cost) : null, by_platform: uu ? uu.by_platform : null, breakdown: bd ? bd.users : null, live };
      return { ...out, summary: `${u.email || u.username}（id ${u.id}）${rng.label}：${stats.total_requests} 次请求，消耗 ${usd(stats.total_actual_cost ?? stats.total_cost)}，${(stats.total_tokens || 0).toLocaleString()} tokens；余额 ${usd(u.balance)}${live ? `；当前 ${live.rpm_now} RPM（近 5 分钟均 ${live.rpm_5m_avg}），${live.tpm_now.toLocaleString()} TPM，上限 ${u.rpm_limit} RPM` : ''}` };
    }
    case 'relay_ranking': {
      const rng = relayRange(input.range, input.from, input.to);
      const d = await relayGet('/admin/dashboard/users-ranking', { start_date: rng.start_date, end_date: rng.end_date, limit: Math.min(50, Number(input.limit) || 10) });
      const ranking = (d.ranking || []).map((x, i) => ({ rank: i + 1, user_id: x.user_id, email: x.email, username: x.username, cost_usd: r2(x.actual_cost), requests: x.requests, tokens: x.tokens }));
      return { range: rng, total_cost_usd: r2(d.total_actual_cost), ranking, summary: `${rng.label}消耗前 ${ranking.length}：${ranking.slice(0, 5).map((x) => `${x.email || x.username} ${usd(x.cost_usd)}`).join('，')}` };
    }
    case 'relay_models': {
      const rng = relayRange(input.range, input.from, input.to);
      const d = await relayGet('/admin/dashboard/models', { start_date: rng.start_date, end_date: rng.end_date, user_id: input.user ? (await relayFindUser(input.user)).id : undefined });
      const models = (d.models || []).map((m) => ({ model: m.model, requests: m.requests, cost_usd: r2(m.actual_cost ?? m.cost), tokens: m.total_tokens })).sort((a, b) => b.cost_usd - a.cost_usd);
      return { range: rng, models, summary: `${rng.label}按模型：${models.slice(0, 5).map((m) => `${m.model} ${usd(m.cost_usd)}`).join('，')}` };
    }
    case 'relay_trend': {
      const d = await relayGet('/admin/dashboard/trend', { days: Math.min(90, Number(input.days) || 7) });
      const trend = (d.trend || []).map((x) => ({ date: x.date, requests: x.requests, cost_usd: r2(x.actual_cost ?? x.cost), tokens: x.total_tokens }));
      return { trend, summary: `近 ${trend.length} 天：${trend.map((x) => `${x.date.slice(5)} ${usd(x.cost_usd)}`).join('，')}` };
    }
    case 'relay_user_keys': {
      const u = await relayFindUser(input.user);
      const d = await relayGet(`/admin/users/${u.id}/api-keys`);
      const keys = (d.items || []).map((k) => ({ id: k.id, name: k.name, key_masked: k.key ? `${k.key.slice(0, 7)}…${k.key.slice(-4)}` : '', status: k.status, group_id: k.group_id, last_used_at: k.last_used_at ? fmtTZ(k.last_used_at) : null, created_at: k.created_at ? fmtTZ(k.created_at) : null }));
      return { user: relayUserView(u), keys, summary: `${u.email || u.username} 有 ${keys.length} 个 API Key` };
    }
    default: return { error: `未知工具 ${name}` };
  }
}
// ---- 中转站实时数据：客户（用户账号）与供应商（上游账号）；带 20 秒缓存
const relayCache = new Map();
function relayCached(key, ttlMs, fn) {
  const hit = relayCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = fn().catch((e) => { relayCache.delete(key); throw e; });
  relayCache.set(key, { at: Date.now(), value });
  if (relayCache.size > 500) for (const [k, v] of relayCache) { if (Date.now() - v.at > 120000) relayCache.delete(k); }
  return value;
}
const ALL_TIME = '2020-01-01';
const hourKeyTZ = () => { const t = inTZ(); return `${t.date} ${t.time.slice(0, 2)}:00`; };
async function relayResolveAccount(ref) {
  const str = String(ref ?? '').trim();
  if (!str) throw new HttpError(400, '请填写中转站账号名称或 id');
  const d = await relayGet('/admin/accounts', { page: 1, page_size: 100, search: /^\d+$/.test(str) ? '' : str });
  const items = d.items || [];
  const lower = str.toLowerCase();
  const hit = (/^\d+$/.test(str) && items.find((a) => String(a.id) === str)) || items.find((a) => (a.name || '').toLowerCase() === lower) || items.filter((a) => (a.name || '').toLowerCase().includes(lower));
  if (hit && !Array.isArray(hit)) return hit;
  if (Array.isArray(hit) && hit.length === 1) return hit[0];
  if (Array.isArray(hit) && hit.length > 1) throw new HttpError(400, `中转站有多个账号匹配「${str}」：${hit.slice(0, 8).map((a) => a.name).join('、')}，请填完整名称`);
  throw new HttpError(404, `中转站没有名为「${str}」的账号`);
}
const relayAccountView = (a) => ({ id: a.id, name: a.name, platform: a.platform, type: a.type, status: a.status, error: a.error_message || '', rate_multiplier: a.rate_multiplier, concurrency_limit: a.concurrency, current_concurrency: a.current_concurrency, last_used_at: a.last_used_at ? fmtTZ(a.last_used_at) : null, groups: (a.groups || []).map((g) => g.name), temp_unschedulable: a.temp_unschedulable_until && new Date(a.temp_unschedulable_until) > new Date() ? a.temp_unschedulable_reason || '暂不可调度' : '' });
async function relayLiveRateBy(filter) {
  const now = Date.now();
  let items = [];
  for (let page = 1; page <= 4; page++) {
    const d = await relayGet('/admin/usage', { page, page_size: 200, ...filter });
    const batch = d.items || [];
    items = items.concat(batch);
    if (batch.length < 200 || now - new Date(batch[batch.length - 1].created_at).getTime() > 5 * 60 * 1000) break;
  }
  const within = (ms) => items.filter((x) => now - new Date(x.created_at).getTime() <= ms);
  const m1 = within(60 * 1000), m5 = within(5 * 60 * 1000);
  const tok = (list) => list.reduce((a, x) => a + (Number(x.input_tokens) || 0) + (Number(x.output_tokens) || 0) + (Number(x.cache_creation_tokens) || 0) + (Number(x.cache_read_tokens) || 0), 0);
  const models = {};
  for (const x of m5) models[x.model] = (models[x.model] || 0) + 1;
  return { rpm_now: m1.length, tpm_now: tok(m1), rpm_5m_avg: Math.round((m5.length / 5) * 10) / 10, tpm_5m_avg: Math.round(tok(m5) / 5), cost_5m_usd: r2(m5.reduce((a, x) => a + (Number(x.actual_cost ?? x.total_cost) || 0), 0)), last_request_at: items[0] ? fmtTZ(items[0].created_at) : null, models_5m: models };
}
function hourlySeries(trend) {
  const list = (trend || []).slice(-24).map((x) => ({ hour: x.date, requests: x.requests, cost_usd: r2(x.actual_cost ?? x.cost), std_cost_usd: r2(x.cost), tokens: x.total_tokens }));
  const hk = hourKeyTZ();
  const cur = list.find((x) => x.hour === hk);
  return { hourly: list, this_hour: cur || { hour: hk, requests: 0, cost_usd: 0, std_cost_usd: 0, tokens: 0 } };
}
const daySeries = (trend) => (trend || []).map((x) => ({ date: String(x.date).slice(0, 10), cost_usd: r2(x.actual_cost ?? x.cost), std_cost_usd: r2(x.cost), requests: x.requests })).filter((x) => RE_DATE.test(x.date));
// 客户：累计 / 今日 / 本小时消耗、余额、实时 RPM / TPM、近 3 天每日消耗
function relayCustomerLive(userId, ref) {
  return relayCached(`cust:${userId}`, 20000, async () => {
    const today = todayKey();
    const [users, allTime, todayStats, trend, live, days] = await Promise.all([
      relayGet('/admin/users', { page: 1, page_size: 20, search: ref || String(userId) }).catch(() => ({ items: [] })),
      relayGet('/admin/usage/stats', { user_id: userId, start_date: ALL_TIME, end_date: today }),
      relayGet('/admin/usage/stats', { user_id: userId, start_date: today, end_date: today }),
      relayGet('/admin/dashboard/trend', { granularity: 'hour', days: 1, user_id: userId }).catch(() => ({ trend: [] })),
      relayLiveRateBy({ user_id: userId }).catch(() => null),
      relayGet('/admin/dashboard/trend', { granularity: 'day', days: 3, user_id: userId }).catch(() => ({ trend: [] })),
    ]);
    const u = (users.items || []).find((x) => x.id === Number(userId)) || null;
    const h = hourlySeries(trend.trend);
    return { kind: 'customer', fetched_at: now(), user: u ? relayUserView(u) : { id: userId, email: ref }, total: { requests: allTime.total_requests, cost_usd: r2(allTime.total_actual_cost), tokens: allTime.total_tokens }, today: { requests: todayStats.total_requests, cost_usd: r2(todayStats.total_actual_cost), tokens: todayStats.total_tokens, input_tokens: todayStats.total_input_tokens, output_tokens: todayStats.total_output_tokens }, this_hour: h.this_hour, hourly: h.hourly, daily: daySeries(days.trend).slice(-3), live };
  });
}
// 供应商：上游账号状态、累计 / 今日 / 本小时消耗（标准价）、近 3 天每日消耗
function relaySupplierLive(accountId) {
  return relayCached(`acct:${accountId}`, 20000, async () => {
    const today = todayKey();
    const [accounts, allTime, todayStats, trend, live, days] = await Promise.all([
      relayGet('/admin/accounts', { page: 1, page_size: 100 }).catch(() => ({ items: [] })),
      relayGet('/admin/usage/stats', { account_id: accountId, start_date: ALL_TIME, end_date: today }),
      relayPost('/admin/accounts/today-stats/batch', { account_ids: [Number(accountId)] }).catch(() => null),
      relayGet('/admin/dashboard/trend', { granularity: 'hour', days: 1, account_id: accountId }).catch(() => ({ trend: [] })),
      relayLiveRateBy({ account_id: accountId }).catch(() => null),
      relayGet('/admin/dashboard/trend', { granularity: 'day', days: 3, account_id: accountId }).catch(() => ({ trend: [] })),
    ]);
    const a = (accounts.items || []).find((x) => x.id === Number(accountId)) || null;
    const ts = todayStats && todayStats.stats ? todayStats.stats[String(accountId)] : null;
    const h = hourlySeries(trend.trend);
    return { kind: 'supplier', fetched_at: now(), account: a ? relayAccountView(a) : { id: accountId }, total: { requests: allTime.total_requests, std_cost_usd: r2(allTime.total_account_cost ?? allTime.total_cost), cost_usd: r2(allTime.total_actual_cost), tokens: allTime.total_tokens }, today: { requests: ts ? ts.requests : todayStats ? 0 : null, std_cost_usd: ts ? r2(ts.standard_cost ?? ts.cost) : null, tokens: ts ? ts.tokens : null }, this_hour: h.this_hour, hourly: h.hourly, daily: daySeries(days.trend).slice(-3), live };
  });
}
// 自动挂账：把中转站每日消耗 × 倍率（供应商）/ 折扣（客户）按单位的结算币种写成应付 / 应收记录（source=relay，幂等）
// 首次绑定时把绑定前的累计消耗写成一条「期初」记录，之后每天一条，随消耗增长自动更新
const relayCostOf = (pa, x) => (pa.kind === 'customer' ? x.cost_usd : x.std_cost_usd);
const qRelayRec = { byRef: () => q.recordByRef, upd: db.prepare('UPDATE party_records SET amount = ?, currency = ?, rate = ?, note = ? WHERE id = ?') };
function syncRelayAccrual(pa, live) {
  if (!pa.relay_id || pa.archived || !live || live.error) return;
  const ratio = Number(pa.ratio) > 0 ? Number(pa.ratio) : 1;
  const cur = pa.currency || 'CNY';
  const rates = getRates();
  const rate = cur === 'CNY' ? 1 : rates[cur];
  const label = pa.kind === 'customer' ? '折扣' : '倍率';
  const daily = live.daily || [];
  const upsert = (ref, date, usd, note) => {
    const amount = r2(usdToCur(usd * ratio, cur, rates));
    if (amount <= 0) return;
    const ex = q.recordByRef.get(ref);
    if (ex) { if (Math.abs(ex.amount - amount) >= 0.01 || ex.currency !== cur) qRelayRec.upd.run(amount, cur, rate, note, ex.id); return; }
    q.insertRecord.run(pa.id, 'due', amount, cur, rate, date, note, 'relay', ref, null, null, now());
    kbLog(`中转站自动挂账：${PARTY_LABEL[pa.kind].name}「${pa.name}」${PARTY_LABEL[pa.kind].due} ${amount.toLocaleString('zh-CN')} ${cur}（${date}，消耗 $${usd.toFixed(2)} × ${label} ${ratio}）· ${pa.project_name || ''}`);
    changed = true;
  };
  let changed = false;
  const total = pa.kind === 'customer' ? live.total.cost_usd : live.total.std_cost_usd;
  const inWindow = daily.reduce((a, x) => a + relayCostOf(pa, x), 0);
  const openingRef = `relay:${pa.id}:opening`;
  if (getSetting(`relay_opening:${pa.id}`, '') !== '1') {
    const before = r2(total - inWindow);
    const openDate = daily.length ? addDays(daily.reduce((a, x) => (x.date < a ? x.date : a), daily[0].date), -1) : todayKey();
    if (before > 0.005) upsert(openingRef, openDate, before, `期初（${openDate} 及以前）累计消耗 $${before.toFixed(2)} × ${label} ${ratio}`);
    q.putSetting.run(`relay_opening:${pa.id}`, '1');
  }
  for (const x of daily) upsert(`relay:${pa.id}:${x.date}`, x.date, relayCostOf(pa, x), `中转站消耗 $${relayCostOf(pa, x).toFixed(2)} × ${label} ${ratio}`);
  // 新增了挂账记录：通知在线页面刷新（金额随消耗微调时不刷，避免每 30 秒闪一次）
  if (changed) { dataVersion += 1; broadcast('changed', { version: dataVersion, byId: 0, by: '中转站', text: '', at: now() }); }
}
// 倍率 / 折扣 / 币种变了或重新绑定：清掉自动挂账记录，下次刷新按新参数重算（期初 + 近 3 天）
const qRelayRecs = db.prepare("SELECT id FROM party_records WHERE party_id = ? AND source = 'relay'");
function resetRelayAccrual(partyId) {
  for (const r of qRelayRecs.all(partyId)) q.deleteRecord.run(r.id);
  q.putSetting.run(`relay_opening:${partyId}`, '');
  relayCache.clear();
}
// 结算视图：以单位结算币种为主，人民币为辅
function settlementView(pa, live) {
  const records = q.recordsOfParty.all(pa.id);
  const st = partySettle(records, pa.currency || 'CNY');
  const rates = getRates(), cur = pa.currency || 'CNY', ratio = Number(pa.ratio) > 0 ? Number(pa.ratio) : 1;
  const total = live ? (pa.kind === 'customer' ? live.total.cost_usd : live.total.std_cost_usd) : 0;
  const todayUsd = live ? (pa.kind === 'customer' ? live.today.cost_usd : live.today.std_cost_usd) : null;
  const hourUsd = live && live.this_hour ? (pa.kind === 'customer' ? live.this_hour.cost_usd : live.this_hour.std_cost_usd) : null;
  const computed = r2(usdToCur(total * ratio, cur, rates));
  const xRatio = live && st.relay_due > 0 && Math.abs(computed - st.relay_due) < 1 ? st.relay_due : computed;
  return { ...st, ratio, ratio_label: pa.kind === 'customer' ? '折扣' : '倍率', consumption_usd: r2(total), consumption_x_ratio: xRatio, today: todayUsd === null ? null : r2(usdToCur(todayUsd * ratio, cur, rates)), this_hour: hourUsd === null ? null : r2(usdToCur(hourUsd * ratio, cur, rates)), usd_rate: rates.USD, cur_rate: cur === 'CNY' ? 1 : rates[cur] };
}
async function partyLive(pa) {
  if (!pa.relay_id) return { party_id: pa.id, linked: false, settlement: settlementView(pa, null) };
  try {
    const live = pa.kind === 'customer' ? await relayCustomerLive(pa.relay_id, pa.relay_ref) : await relaySupplierLive(pa.relay_id);
    try { syncRelayAccrual(pa, live); } catch (e) { console.error('[relay] 自动挂账失败：', e.message); }
    return { party_id: pa.id, linked: true, ...live, settlement: settlementView(pa, live) };
  } catch (e) { return { party_id: pa.id, linked: true, error: e instanceof HttpError ? e.message : (e.message || '获取失败'), settlement: settlementView(pa, null) }; }
}
// 后台定时同步：没人打开页面也按日补齐自动挂账（每 15 分钟，逐家串行，失败只记日志）
const qLinkedParties = db.prepare('SELECT pa.*, p.name AS project_name FROM parties pa JOIN projects p ON p.id = pa.project_id WHERE pa.relay_id IS NOT NULL AND pa.archived = 0');
let relaySyncing = false;
async function relayAccrualSweep() {
  if (!relayConfigured() || relaySyncing) return;
  relaySyncing = true;
  try {
    const list = qLinkedParties.all(); let ok = 0;
    for (const pa of list) {
      const r = await partyLive(pa);
      if (r.error) console.error(`[relay] 定时同步 ${pa.name} 失败：${r.error}`); else ok += 1;
    }
    if (list.length) console.log(`[relay] 定时同步完成：${ok}/${list.length} 家已按日挂账`);
  } catch (e) { console.error('[relay] 定时同步异常：', e.message); }
  finally { relaySyncing = false; }
}
setTimeout(relayAccrualSweep, 20 * 1000).unref();
setInterval(relayAccrualSweep, 15 * 60 * 1000).unref();
async function projectRelayLive(projectId) {
  const parties = q.partiesOfProject.all(projectId).filter((p) => p.relay_id && !p.archived);
  const out = {};
  const queue = [...parties];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => { while (queue.length) { const pa = queue.shift(); out[pa.id] = await partyLive(pa); } }));
  return { fetched_at: now(), relay: relayConfigured() ? { name: RELAY.name } : null, parties: out };
}
async function linkPartyRelay(user, partyId, ref, opts = {}) {
  const pa0 = q.party.get(Number(partyId));
  if (!pa0) throw new HttpError(404, '往来单位不存在');
  // 中转站绑定只用于客户；供应商改为在「余额」里绑定供应商站点（new-api / sub2api）的 Key 抓余额与倍率
  if (pa0.kind === 'supplier') throw new HttpError(400, '供应商不再绑定中转站账号：请在供应商详情的「余额」里填供应商站点的 Key');
  // 绑定时可一并指定倍率 / 折扣与结算币种
  if (opts.ratio !== undefined || opts.currency !== undefined) ops.updateParty(user, pa0.id, { ratio: opts.ratio, currency: opts.currency }, '');
  const pa = q.party.get(pa0.id);
  const target = String(ref || pa.relay_ref || pa.external_id || pa.name).trim();
  if (pa.kind === 'customer') {
    const u = await relayFindUser(target);
    q.linkParty.run(u.id, u.email || u.username || target, pa.id);
    dataChanged(user, `把客户「${pa.name}」绑定到中转站用户 ${u.email || u.username}（id ${u.id}）· ${pa.project_name}`);
  } else {
    const a = await relayResolveAccount(target);
    q.linkParty.run(a.id, a.name, pa.id);
    dataChanged(user, `把供应商「${pa.name}」绑定到中转站账号「${a.name}」（id ${a.id}）· ${pa.project_name}`);
  }
  resetRelayAccrual(pa.id);
  return partyLive(q.party.get(pa.id));
}

const RELAY_TOOLS = [
  { name: 'relay_overview', description: '中转站总览：当前 RPM、今日请求数 / 消耗（美元）/ tokens、活跃用户、上游账号健康、历史累计。', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'relay_find_users', description: '按邮箱 / 用户名关键词查找中转站客户，返回余额、状态、RPM 上限、并发、最近活跃时间。', input_schema: { type: 'object', properties: { keyword: { type: 'string' }, limit: { type: 'integer' } }, additionalProperties: false } },
  { name: 'relay_user_usage', description: '某个客户的消耗：指定区间的请求数 / 消耗（美元）/ tokens / 接口分布，今日与累计消耗，余额，以及实时速率（当前 RPM、TPM、近 5 分钟均值、最近一次请求时间、在用模型）。', input_schema: { type: 'object', properties: { user: { type: 'string', description: '客户的邮箱、用户名或中转站 id' }, range: { type: 'string', enum: ['today', 'yesterday', '7d', '30d', 'month', 'custom'], description: '默认 today' }, from: { type: 'string' }, to: { type: 'string' }, live: { type: 'boolean', description: '是否计算实时 RPM / TPM，默认 true' } }, required: ['user'], additionalProperties: false } },
  { name: 'relay_ranking', description: '客户消耗排行（按美元），可选区间。', input_schema: { type: 'object', properties: { range: { type: 'string', enum: ['today', 'yesterday', '7d', '30d', 'month', 'custom'] }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer' } }, additionalProperties: false } },
  { name: 'relay_models', description: '按模型的请求数 / 消耗 / tokens，可按客户过滤。', input_schema: { type: 'object', properties: { range: { type: 'string', enum: ['today', 'yesterday', '7d', '30d', 'month', 'custom'] }, from: { type: 'string' }, to: { type: 'string' }, user: { type: 'string' } }, additionalProperties: false } },
  { name: 'relay_trend', description: '中转站近 N 天每日请求数 / 消耗趋势。', input_schema: { type: 'object', properties: { days: { type: 'integer', description: '默认 7，最多 90' } }, additionalProperties: false } },
  { name: 'relay_user_keys', description: '某个客户的 API Key 列表（脱敏），含名称、状态、最近使用时间。', input_schema: { type: 'object', properties: { user: { type: 'string' } }, required: ['user'], additionalProperties: false } },
];
const RELAY_TOOL_NAMES = new Set(RELAY_TOOLS.map((t) => t.name));

// ---------------------------------------------------------------- AI 助手：工具定义
const CHAT_TOOLS = [
  { name: 'list_projects', description: '列出全部项目及其收入 / 支出 / 利润（人民币）、笔数、最近记录时间、是否归档。', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_entries', description: '查询流水（最近优先），用于查看、核对，或找到要修改 / 删除的记录 id。', input_schema: { type: 'object', properties: { project: { type: 'string', description: '项目 id 或名称，不传为全部' }, type: { type: 'string', enum: ['expense', 'income'] }, handler: { type: 'string', description: '经手人名或 id' }, keyword: { type: 'string', description: '备注关键词' }, from: { type: 'string', description: '起始日期 YYYY-MM-DD' }, to: { type: 'string', description: '结束日期 YYYY-MM-DD' }, limit: { type: 'integer', description: '最多条数，默认 20，最大 50' } }, additionalProperties: false } },
  { name: 'get_report', description: '统计任意范围与区间的收入 / 支出 / 利润（人民币，按记账时汇率折算）、与上期对比、每日明细、按项目、按成员。', input_schema: { type: 'object', properties: { scope: { type: 'string', description: 'all 或项目 id / 名称，默认 all' }, range: { type: 'string', enum: ['month', 'last-month', '30d', 'all', 'custom'], description: '默认 month' }, from: { type: 'string', description: 'custom 时必填 YYYY-MM-DD' }, to: { type: 'string', description: 'custom 时必填 YYYY-MM-DD' } }, additionalProperties: false } },
  { name: 'get_ai_report', description: '读取已生成的 AI 财务报表内容。', input_schema: { type: 'object', properties: { scope: { type: 'string' }, range: { type: 'string', enum: ['month', 'last-month', '30d', 'all', 'custom'] }, from: { type: 'string' }, to: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_settings', description: '查看汇率、AI 自动刷新、群聊回复模式、每日自动导出设置。', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_members', description: '列出团队成员。', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'clear_project', description: '【需审批】清空一个项目的全部流水、往来记录和成员转账（供应商 / 客户名单保留）。清空后这些数据不再计入任何统计与报表，不可恢复。', input_schema: { type: 'object', properties: { project: { type: 'string', description: '项目 id 或名称' } }, required: ['project'], additionalProperties: false } },
  { name: 'delete_project', description: '【需审批】删除整个项目及其全部数据（流水、供应商 / 客户、往来记录、成员转账、项目群聊）。删除后不再计入任何统计与报表，不可恢复。只有项目创建者能删。', input_schema: { type: 'object', properties: { project: { type: 'string', description: '项目 id 或名称' } }, required: ['project'], additionalProperties: false } },
  { name: 'member_funds', description: '查看成员的个人资金沉淀：每个人经手的收款、付款、成员间转入转出，以及手上还压着多少钱（沉淀 = 收款 − 付款 + 转入 − 转出）。可只看某个项目。', input_schema: { type: 'object', properties: { project: { type: 'string', description: '项目 id 或名称；不传 = 全部项目合计；项目群里默认本项目' }, member: { type: 'string', description: '只看某个成员' } }, additionalProperties: false } },
  { name: 'list_transfers', description: '查看成员之间的转账记录（谁转给谁、多少、什么时候）。', input_schema: { type: 'object', properties: { project: { type: 'string' }, member: { type: 'string', description: '只看与某人相关的转账' }, limit: { type: 'integer', description: '默认 30' } }, additionalProperties: false } },
  { name: 'add_transfer', description: '【需审批】记一笔成员之间的转账（例如「张贺给秋明转了 2 万」）。只在成员资金之间搬钱，不影响项目利润。', input_schema: { type: 'object', properties: { project: { type: 'string', description: '算在哪个项目下；不传 = 不挂项目（公司层面）' }, from: { type: 'string', description: '转出成员姓名' }, to: { type: 'string', description: '转入成员姓名' }, amount: { type: 'number' }, currency: { type: 'string', enum: ['CNY', 'USDT', 'USD'] }, rate: { type: 'number', description: '非人民币时的汇率，不传用当前汇率' }, time: { type: 'string', description: '转账时间，不传 = 现在' }, note: { type: 'string' } }, required: ['from', 'to', 'amount'], additionalProperties: false } },
  { name: 'delete_transfer', description: '【需审批】删除一笔成员转账记录。', input_schema: { type: 'object', properties: { transfer_id: { type: 'integer' } }, required: ['transfer_id'], additionalProperties: false } },
  { name: 'list_proposals', description: '列出待审批的操作提案。', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_exports', description: '查看「导出记录」（手动 / 自动 / AI 导出过的 Excel 与 Markdown 文件，含下载链接）以及每日自动导出设置。', input_schema: { type: 'object', properties: { limit: { type: 'integer' } }, additionalProperties: false } },
  { name: 'search_knowledge', description: '在知识库（操作日志、对话记录、知识摘要）里按关键词检索历史，用于回答"我们之前做过什么"。', input_schema: { type: 'object', properties: { query: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['query'], additionalProperties: false } },
  { name: 'read_knowledge', description: '读取知识库文件：summary（知识摘要）、log（某日操作日志）、chat（某日对话记录）。', input_schema: { type: 'object', properties: { what: { type: 'string', enum: ['summary', 'log', 'chat'] }, date: { type: 'string', description: 'log / chat 需要，YYYY-MM-DD' } }, required: ['what'], additionalProperties: false } },
  { name: 'list_parties', description: '查看项目的供应商（应付 / 实付 / 未付）与客户（应收 / 实收 / 未收）汇总，以及按日的往来汇总。', input_schema: { type: 'object', properties: { project: { type: 'string', description: '项目 id 或名称；项目群里可不传' }, kind: { type: 'string', enum: ['supplier', 'customer'] } }, additionalProperties: false } },
  { name: 'party_live', description: '某个供应商 / 客户的中转站实时数据：客户 → 累计 / 今日 / 本小时消耗、余额、当前 RPM / TPM；供应商 → 上游账号状态、累计 / 今日消耗、×倍率后的应付、已付、未付或待消耗额度。', input_schema: { type: 'object', properties: { project: { type: 'string' }, party: { type: 'string', description: '供应商 / 客户名称或 id' } }, required: ['party'], additionalProperties: false } },
  { name: 'party_statement', description: '查看某个供应商 / 客户的往来明细（每条应付应收 / 实付实收，含日期）。', input_schema: { type: 'object', properties: { project: { type: 'string' }, party: { type: 'string', description: '供应商 / 客户名称或 id' } }, required: ['party'], additionalProperties: false } },
  // ---- 以下为需成员审批的操作：调用后只会生成提案，成员点击批准后才执行
  { name: 'add_entry', description: '【需审批】记一笔支出或收入。时间不传则为现在；外币不传汇率则用当前设置。', input_schema: { type: 'object', properties: { project: { type: 'string', description: '项目 id 或名称（可模糊）；不传则用当前页面项目或唯一进行中的项目' }, type: { type: 'string', enum: ['expense', 'income'] }, amount: { type: 'number' }, currency: { type: 'string', enum: ['CNY', 'USDT', 'USD'] }, rate: { type: 'number', description: '外币当时的汇率（1 单位 = ? 人民币），用户提到时才传' }, handler: { type: 'string', description: '经手人成员名或 id；不传为发言人本人' }, note: { type: 'string' }, time: { type: 'string', description: '带时区的 ISO 8601，如 2026-09-20T15:00:00+08:00' } }, required: ['type', 'amount', 'currency'], additionalProperties: false } },
  { name: 'add_entries_batch', description: '【需审批】一次记多笔（从图片 / 表格 / 文件整理出的账目）。每行的 handler 写表格里出现的人名，系统会自动匹配成员；匹配不到的会标记出来。', input_schema: { type: 'object', properties: { entries: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', properties: { project: { type: 'string' }, type: { type: 'string', enum: ['expense', 'income'] }, amount: { type: 'number' }, currency: { type: 'string', enum: ['CNY', 'USDT', 'USD'] }, rate: { type: 'number' }, handler: { type: 'string' }, note: { type: 'string' }, time: { type: 'string' } }, required: ['type', 'amount', 'currency'], additionalProperties: false } }, source: { type: 'string', description: '来源说明，如"小王上传的 9 月报销表.xlsx"' } }, required: ['entries'], additionalProperties: false } },
  { name: 'update_entry', description: '【需审批】修改一笔记录（金额、币种、汇率、类型、备注、经手人、项目、时间）。', input_schema: { type: 'object', properties: { entry_id: { type: 'integer' }, project: { type: 'string' }, type: { type: 'string', enum: ['expense', 'income'] }, amount: { type: 'number' }, currency: { type: 'string', enum: ['CNY', 'USDT', 'USD'] }, rate: { type: 'number' }, handler: { type: 'string' }, note: { type: 'string' }, time: { type: 'string' } }, required: ['entry_id'], additionalProperties: false } },
  { name: 'delete_entry', description: '【需审批】删除一笔记录。', input_schema: { type: 'object', properties: { entry_id: { type: 'integer' } }, required: ['entry_id'], additionalProperties: false } },
  { name: 'create_project', description: '【需审批】新建项目；create_group=true 时同时创建该项目的专属群聊。', input_schema: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' }, create_group: { type: 'boolean' } }, required: ['name'], additionalProperties: false } },
  { name: 'update_project', description: '【需审批】修改项目名称 / 说明，或归档 / 恢复。', input_schema: { type: 'object', properties: { project: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' }, archived: { type: 'boolean' } }, required: ['project'], additionalProperties: false } },
  { name: 'update_settings', description: '【需审批】修改汇率、AI 报表自动刷新、群聊回复模式、AI 模型、每日自动导出。', input_schema: { type: 'object', properties: { rates: { type: 'object', properties: { USD: { type: 'number' }, USDT: { type: 'number' } }, additionalProperties: false }, ai_auto: { type: 'boolean' }, group_ai: { type: 'string', enum: ['always', 'mention'] }, ai_model: { type: 'string', description: '如 claude-sonnet-5 / claude-opus-5' }, auto_export: { type: 'object', properties: { enabled: { type: 'boolean' }, time: { type: 'string' }, scope: { type: 'string' }, range: { type: 'string', enum: ['month', 'last-month', '30d', 'all'] } }, additionalProperties: false } }, additionalProperties: false } },
  { name: 'generate_ai_report', description: '【需审批】生成或刷新某范围 / 区间的 AI 财务报表。', input_schema: { type: 'object', properties: { scope: { type: 'string' }, range: { type: 'string', enum: ['month', 'last-month', '30d', 'all', 'custom'] }, from: { type: 'string' }, to: { type: 'string' }, force: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'export_report', description: '【需审批】导出报表文件（Excel / Markdown），批准后生成下载链接并进入「导出记录」。', input_schema: { type: 'object', properties: { scope: { type: 'string' }, range: { type: 'string', enum: ['month', 'last-month', '30d', 'all', 'custom'] }, from: { type: 'string' }, to: { type: 'string' }, format: { type: 'string', enum: ['xlsx', 'md', 'both'] } }, additionalProperties: false } },
  { name: 'add_party', description: '【需审批】给项目添加供应商或客户；可同时绑定中转站（客户填邮箱，供应商填上游账号名）并设置倍率 / 折扣与结算币种，绑定后按结算币种自动逐日挂账。', input_schema: { type: 'object', properties: { project: { type: 'string' }, kind: { type: 'string', enum: ['supplier', 'customer'] }, name: { type: 'string' }, contact: { type: 'string' }, note: { type: 'string' }, currency: { type: 'string', enum: ['CNY', 'USDT', 'USD'], description: '结算币种（应收 / 应付按此币种记）' }, relay_ref: { type: 'string', description: '中转站邮箱（客户）或账号名（供应商）' }, ratio: { type: 'number', description: '供应商倍率 / 客户折扣（应收或应付 = 中转站消耗 × 此值），默认 1' } }, required: ['kind', 'name'], additionalProperties: false } },
  { name: 'add_party_record', description: '【需审批】记一条往来：供应商的应付（due）/ 实付（paid），或客户的应收（due）/ 实收（paid）。实付 / 实收默认同时记入项目流水。', input_schema: { type: 'object', properties: { project: { type: 'string' }, party: { type: 'string', description: '供应商 / 客户名称或 id' }, kind: { type: 'string', enum: ['due', 'paid'] }, amount: { type: 'number' }, currency: { type: 'string', enum: ['CNY', 'USDT', 'USD'] }, rate: { type: 'number' }, date: { type: 'string', description: '业务日期 YYYY-MM-DD，默认今天' }, note: { type: 'string' }, handler: { type: 'string', description: '实付 / 实收的经手人姓名（谁真的付的 / 收的钱，计入他的资金沉淀），不传就是当前用户' }, link_entry: { type: 'boolean', description: '实付 / 实收是否同时记入流水，默认 true' } }, required: ['party', 'kind', 'amount'], additionalProperties: false } },
  { name: 'update_party', description: '【需审批】修改供应商 / 客户：名称、联系方式、备注、结算币种、外部编号、倍率（供应商）/ 折扣（客户）、归档 / 恢复，或绑定 / 解绑中转站（relay_ref 填邮箱或账号名，unlink_relay=true 解绑）。改倍率 / 折扣 / 币种后自动挂账会按新参数重算。', input_schema: { type: 'object', properties: { project: { type: 'string' }, party: { type: 'string', description: '供应商 / 客户名称或 id' }, name: { type: 'string' }, contact: { type: 'string' }, note: { type: 'string' }, currency: { type: 'string', enum: ['CNY', 'USDT', 'USD'] }, external_id: { type: 'string' }, ratio: { type: 'number' }, archived: { type: 'boolean' }, relay_ref: { type: 'string' }, unlink_relay: { type: 'boolean' } }, required: ['party'], additionalProperties: false } },
  { name: 'delete_party', description: '【需审批】删除供应商 / 客户及其全部往来记录（已入流水的记录保留）。', input_schema: { type: 'object', properties: { project: { type: 'string' }, party: { type: 'string' } }, required: ['party'], additionalProperties: false } },
  { name: 'create_project_group', description: '【需审批】为某个项目创建专属群聊（群里的 AI 只负责该项目）。', input_schema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'], additionalProperties: false } },
  { name: 'delete_party_record', description: '【需审批】删除一条往来记录（关联的流水一并删除）。', input_schema: { type: 'object', properties: { record_id: { type: 'integer' } }, required: ['record_id'], additionalProperties: false } },
  { name: 'consolidate_knowledge', description: '【需审批】整理知识库：把最近的操作日志与对话归纳进知识摘要 summary.md（旧版本自动存档）。', input_schema: { type: 'object', properties: { reason: { type: 'string' } }, additionalProperties: false } },
];
const ALL_TOOLS = () => (relayConfigured() ? CHAT_TOOLS.concat(RELAY_TOOLS) : CHAT_TOOLS);
const GATED = new Set(['add_entry', 'add_entries_batch', 'update_entry', 'delete_entry', 'create_project', 'update_project', 'update_settings', 'generate_ai_report', 'export_report', 'consolidate_knowledge', 'add_party', 'add_party_record', 'delete_party_record', 'update_party', 'delete_party', 'create_project_group', 'add_transfer', 'delete_transfer', 'clear_project', 'delete_project']);
const TOOL_LABEL = { list_projects: '查看项目', list_entries: '查询流水', get_report: '统计数据', get_ai_report: '读取 AI 报表', get_settings: '查看设置', list_members: '查看成员', list_proposals: '查看待审批', search_knowledge: '检索知识库', read_knowledge: '读取知识库', add_entry: '记账', add_entries_batch: '批量记账', update_entry: '修改记录', delete_entry: '删除记录', create_project: '新建项目', update_project: '修改项目', update_settings: '修改设置', generate_ai_report: '生成 AI 报表', export_report: '导出报表', consolidate_knowledge: '整理知识库', list_parties: '查看往来', party_statement: '往来明细', party_live: '往来实时数据', relay_overview: '中转站总览', relay_find_users: '查找中转站客户', relay_user_usage: '客户消耗', relay_ranking: '消耗排行', relay_models: '模型消耗', relay_trend: '消耗趋势', relay_user_keys: '客户 API Key', add_party: '添加供应商/客户', add_party_record: '记往来', delete_party_record: '删除往来记录', update_party: '修改供应商/客户', delete_party: '删除供应商/客户', create_project_group: '新建项目群', list_exports: '导出记录', member_funds: '成员资金', list_transfers: '转账记录', add_transfer: '记转账', delete_transfer: '删除转账', clear_project: '清空项目', delete_project: '删除项目' };

function resolveProject(ref, ctx, { allowNone = false } = {}) {
  const projects = q.projects.all();
  if (ctx.lockedProject) {
    const locked = projects.find((x) => x.id === Number(ctx.lockedProject));
    if (!locked) throw new HttpError(404, '本群对应的项目不存在');
    if (ref !== undefined && ref !== null && String(ref).trim() !== '') {
      const str = String(ref).trim().toLowerCase();
      const same = str === String(locked.id) || locked.name.toLowerCase() === str || locked.name.toLowerCase().includes(str) || str.includes(locked.name.toLowerCase());
      if (!same) throw new HttpError(400, `本群只负责项目「${locked.name}」的账目，「${String(ref).trim()}」请到团队群或对应的项目群处理`);
    }
    return locked;
  }
  if (ref !== undefined && ref !== null && String(ref).trim() !== '') {
    const str = String(ref).trim();
    if (allowNone && /^(all|全部|全部项目|所有项目|不挂项目|无)$/i.test(str)) return null;   // 明确要「全部 / 不挂项目」
    if (/^\d+$/.test(str)) { const p = projects.find((x) => x.id === Number(str)); if (p) return p; }
    const lower = str.toLowerCase();
    const exact = projects.find((x) => x.name.toLowerCase() === lower);
    if (exact) return exact;
    const fuzzy = projects.filter((x) => x.name.toLowerCase().includes(lower) || lower.includes(x.name.toLowerCase()));
    if (fuzzy.length === 1) return fuzzy[0];
    if (fuzzy.length > 1) throw new HttpError(400, `有多个项目匹配「${str}」：${fuzzy.map((x) => x.name).join('、')}，请说明是哪一个`);
    throw new HttpError(404, `没有找到项目「${str}」。现有项目：${projects.map((x) => x.name).join('、') || '（无）'}`);
  }
  if (ctx.projectId) { const p = projects.find((x) => x.id === Number(ctx.projectId)); if (p) return p; }
  const active = projects.filter((x) => !x.archived);
  if (active.length === 1) return active[0];
  if (allowNone) return null;
  throw new HttpError(400, active.length ? `请说明记到哪个项目：${active.map((x) => x.name).join('、')}` : '还没有项目，请先创建一个项目');
}
function findMember(ref) {
  const str = String(ref ?? '').trim();
  if (!str) return null;
  const members = q.members.all();
  if (/^\d+$/.test(str)) return members.find((x) => x.id === Number(str)) || null;
  const lower = str.toLowerCase().replace(/[\s（(].*$/, '');
  return members.find((x) => x.username.toLowerCase() === lower)
    || members.find((x) => x.username.toLowerCase().includes(lower) || lower.includes(x.username.toLowerCase()))
    || null;
}
function resolveMember(ref, user) {
  if (ref === undefined || ref === null || String(ref).trim() === '') return user;
  if (['我', '本人', '自己', 'me'].includes(String(ref).trim().toLowerCase())) return user;
  const m = findMember(ref);
  if (!m) throw new HttpError(404, `没有找到成员「${String(ref).trim()}」。团队成员：${q.members.all().map((x) => x.username).join('、')}`);
  return m;
}
const entryView = (e, user) => ({ id: e.id, time: fmtTZ(e.created_at), project: e.project_name, type: e.type, amount: e.amount, currency: e.currency, rate: e.rate, cny: r2(entryBase(e)), handler: e.handler_name, creator: e.creator_name, note: e.note, can_edit: ops.canEditEntry(user, e) });
function reportParamsFrom(input, ctx) {
  let scope = 'all';
  if (ctx.lockedProject) {
    if (input.scope === 'all') throw new HttpError(400, '本群只负责本项目，全部项目的报表请到团队群');
    scope = String(resolveProject(input.scope, ctx).id);
  } else if (input.scope && input.scope !== 'all') scope = String(resolveProject(input.scope, ctx).id);
  return normalizeReportParams({ scope, range: input.range || 'month', from: input.from, to: input.to });
}
const describeEntry = (n) => `${n.type === 'income' ? '收入' : '支出'} ${n.amount.toLocaleString('zh-CN')} ${n.currency}${n.currency !== 'CNY' ? `（汇率 ${n.rate}，≈${cny(n.amount * n.rate)}）` : ''} · ${n.project.name} · 经手人 ${n.handler.username}${n.note ? ` · ${n.note}` : ''} · ${fmtTZ(n.at)}`;

function resolveParty(ref, project, kindHint) {
  const str = String(ref ?? '').trim();
  const list = q.partiesOfProject.all(project.id).filter((x) => !kindHint || x.kind === kindHint);
  if (!str) throw new HttpError(400, '请说明是哪个供应商 / 客户');
  if (/^\d+$/.test(str)) { const p = list.find((x) => x.id === Number(str)); if (p) return p; }
  const lower = str.toLowerCase();
  const hit = list.find((x) => x.name.toLowerCase() === lower) || list.filter((x) => x.name.toLowerCase().includes(lower) || lower.includes(x.name.toLowerCase()));
  if (hit && !Array.isArray(hit)) return hit;
  if (Array.isArray(hit) && hit.length === 1) return hit[0];
  if (Array.isArray(hit) && hit.length > 1) throw new HttpError(400, `有多个匹配「${str}」：${hit.map((x) => x.name).join('、')}`);
  throw new HttpError(404, `项目「${project.name}」里没有叫「${str}」的${kindHint ? PARTY_LABEL[kindHint].name : '供应商 / 客户'}；现有：${list.map((x) => `${x.name}（${PARTY_LABEL[x.kind].name}）`).join('、') || '无'}`);
}
// 没说项目时，在所有项目里按名称找供应商 / 客户；唯一匹配就直接用，多个匹配让用户选
function resolvePartyAnywhere(input, ctx, kindHint) {
  if (input.project || ctx.lockedProject) { const p = resolveProject(input.project, ctx); return { project: p, party: resolveParty(input.party, p, kindHint) }; }
  const str = String(input.party ?? '').trim();
  if (!str) throw new HttpError(400, '请说明是哪个供应商 / 客户');
  const lower = str.toLowerCase();
  const all = q.projects.all().flatMap((p) => q.partiesOfProject.all(p.id).filter((x) => !kindHint || x.kind === kindHint).map((x) => ({ ...x, project: p })));
  let hits = all.filter((x) => (/^\d+$/.test(str) && x.id === Number(str)) || x.name.toLowerCase() === lower);
  if (!hits.length) hits = all.filter((x) => x.name.toLowerCase().includes(lower) || lower.includes(x.name.toLowerCase()));
  const active = hits.filter((x) => !x.archived);
  if (active.length === 1) return { project: active[0].project, party: active[0] };
  if (hits.length === 1) return { project: hits[0].project, party: hits[0] };
  if (hits.length > 1) throw new HttpError(400, `有多个匹配「${str}」：${hits.map((x) => `${x.name}（${x.project.name}）`).join('、')}，请说明项目`);
  const active2 = q.projects.all().filter((p) => !p.archived);
  if (active2.length === 1) { const p = active2[0]; return { project: p, party: resolveParty(str, p, kindHint) }; }
  throw new HttpError(404, `没有找到叫「${str}」的${kindHint ? PARTY_LABEL[kindHint].name : '供应商 / 客户'}；现有：${all.map((x) => `${x.name}（${PARTY_LABEL[x.kind].name}·${x.project.name}）`).join('、') || '无'}`);
}
const partyBrief = (v) => ({ id: v.id, kind: v.kind, name: v.name, contact: v.contact, note: v.note, currency: v.currency, archived: v.archived, [v.kind === 'customer' ? '折扣' : '倍率']: v.ratio, [`${PARTY_LABEL[v.kind].due}_${v.currency}`]: v.settle.due, [`${PARTY_LABEL[v.kind].paid}_${v.currency}`]: v.settle.paid, [`${PARTY_LABEL[v.kind].open}_${v.currency}`]: v.settle.open, [v.kind === 'customer' ? '预收余额' : '待消耗额度']: v.settle.credit, relay: v.relay ? `已绑定中转站 ${v.relay.ref}（用 party_live 查实时消耗与结算）` : '未绑定中转站', [PARTY_LABEL[v.kind].due]: v.totals.due, [PARTY_LABEL[v.kind].paid]: v.totals.paid, [PARTY_LABEL[v.kind].open]: v.totals.open, count: v.totals.count, last_date: v.totals.last_at });
// 只读工具：直接执行
async function runReadTool(name, input, ctx) {
  const { user } = ctx;
  switch (name) {
    case 'list_projects': {
      const rates = getRates(); const byProject = new Map();
      for (const e of q.allEntries.all()) { if (!byProject.has(e.project_id)) byProject.set(e.project_id, []); byProject.get(e.project_id).push(e); }
      const projects = q.projects.all().filter((p) => !ctx.lockedProject || p.id === Number(ctx.lockedProject)).map((p) => { const s = summarize(byProject.get(p.id) || [], rates); return { id: p.id, name: p.name, note: p.note, archived: !!p.archived, income: s.income.base, expense: s.expense.base, profit: s.profit, count: s.count, last_at: s.last_at ? fmtTZ(s.last_at) : null }; });
      return { projects, summary: `共 ${projects.length} 个项目` };
    }
    case 'list_entries': {
      const p = input.project || ctx.lockedProject ? resolveProject(input.project, ctx) : null;
      const h = input.handler ? resolveMember(input.handler, user) : null;
      const lim = Math.min(50, Math.max(1, Number(input.limit) || 20));
      const kw = input.keyword ? String(input.keyword).toLowerCase() : '';
      const list = (p ? q.projectEntries.all(p.id) : q.reportEntriesAll.all()).filter((e) => (!input.type || e.type === input.type) && (!h || e.handler_id === h.id) && (!kw || e.note.toLowerCase().includes(kw)) && (!input.from || dayKey(e.created_at) >= input.from) && (!input.to || dayKey(e.created_at) <= input.to));
      return { total: list.length, entries: list.slice(0, lim).map((e) => entryView(e, user)), summary: `共 ${list.length} 条，返回 ${Math.min(lim, list.length)} 条` };
    }
    case 'get_report': {
      const r = buildReport(reportParamsFrom(input, ctx));
      const active = r.daily.filter((d) => d.count);
      return { scope: r.project ? r.project.name : '全部项目', label: r.label, from: r.from, to: r.to, days: r.days, kpis: r.kpis, prev: { ...r.prev, from: r.prevFrom, to: r.prevTo }, daily: active.slice(-60), daily_truncated: Math.max(0, active.length - 60), byProject: r.byProject, byMember: r.byMember, analysis: r.analysis, entryCount: r.entries.length, summary: `${r.project ? r.project.name : '全部项目'} ${r.label}：收入 ${cny(r.kpis.income.base)}，支出 ${cny(r.kpis.expense.base)}，利润 ${cny(r.kpis.profit)}` };
    }
    case 'get_ai_report': {
      const row = q.report.get(reportKey(reportParamsFrom(input, ctx)));
      if (!row || !row.content) return { error: '还没有生成这个范围的 AI 报表，可提议 generate_ai_report' };
      return { generated_at: fmtTZ(row.generated_at), model: row.model, content: row.content, summary: `AI 报表生成于 ${fmtTZ(row.generated_at)}` };
    }
    case 'get_settings': { const a = getAutoExport(), r = getRates(); return { rates: r, ai: aiInfo(), auto_export: a, timezone: TZ, summary: `汇率 1 USD = ${r.USD}，1 USDT = ${r.USDT}；AI 自动刷新${aiAuto() ? '开' : '关'}；群聊回复：${groupAiMode() === 'mention' ? '仅 @AI' : '每条'}；自动导出${a.enabled ? `每天 ${a.time}` : '关'}` }; }
    case 'member_funds': {
      const p = resolveProject(input.project, ctx, { allowNone: true });
      const d = memberFunds(p ? p.id : null);
      const scope = p ? p.name : '全部项目';
      const one = input.member ? resolveMember(input.member, ctx.user) : null;
      const list = one ? d.members.filter((m) => m.id === one.id) : d.members;
      const fmtOne = (m) => `${m.name}：沉淀 ${cny(m.balance)}（收款 ${cny(m.income)} − 付款 ${cny(m.expense)} + 转入 ${cny(m.in)} − 转出 ${cny(m.out)}）${CURRENCIES.filter((c) => c !== 'CNY' && m.cur.balance[c]).map((c) => `，${c} ${m.cur.balance[c].toLocaleString('zh-CN')}`).join('')}`;
      return { scope, members: list, totals: d.totals, 说明: '沉淀 = 本人经手收款 − 本人经手付款 + 转入 − 转出；为负说明他垫了钱', summary: list.length ? `${scope} 成员资金沉淀：${list.map(fmtOne).join('；')}` : `${scope} 还没有资金记录` };
    }
    case 'list_transfers': {
      const p = resolveProject(input.project, ctx, { allowNone: true });
      const one = input.member ? resolveMember(input.member, ctx.user) : null;
      let rows = (p ? q.transfersOfProject.all(p.id) : q.allTransfers.all()).map(transferView);
      if (one) rows = rows.filter((t) => t.from_id === one.id || t.to_id === one.id);
      const limit = Math.min(200, Math.max(1, Number(input.limit) || 30));
      const shown = rows.slice(0, limit);
      return { scope: p ? p.name : '全部项目', transfers: shown, total: rows.length, summary: shown.length ? `共 ${rows.length} 笔转账，最近 ${shown.length} 笔：${shown.map((t) => `${t.from} → ${t.to} ${t.amount.toLocaleString('zh-CN')} ${t.currency}（${t.time}${t.note ? ` · ${t.note}` : ''}）`).join('；')}` : '还没有转账记录' };
    }
    case 'list_members': { const members = q.members.all().map((m) => ({ id: m.id, name: m.username, joined: fmtTZ(m.created_at) })); return { members, summary: `团队 ${members.length} 人：${members.map((m) => m.name).join('、')}` }; }
    case 'list_exports': {
      const list = q.exportsList.all().slice(0, Math.min(50, Number(input.limit) || 20)).map((x) => ({ id: x.id, name: x.name, format: x.format, source: { manual: '手动', auto: '自动', ai: 'AI' }[x.source] || x.source, by: x.creator_name || '系统', at: fmtTZ(x.created_at), size_kb: Math.round(x.size / 1024), url: `/api/exports/${x.id}/download` }));
      const a = getAutoExport();
      return { exports: list, auto_export: a, links: list.slice(0, 5).map((x) => ({ label: x.name, url: x.url })), summary: `共 ${q.exportsList.all().length} 条导出记录；自动导出${a.enabled ? `每天 ${a.time}（${a.scope === 'all' ? '全部项目' : `项目 ${a.scope}`} · ${RANGE_LABELS[a.range]}）` : '未开启'}` };
    }
    case 'list_proposals': { const list = q.pendingProposals.all().map((p) => ({ id: p.id, title: p.title, requested_by: p.requested_name, at: fmtTZ(p.created_at) })); return { proposals: list, summary: list.length ? `${list.length} 个提案待审批` : '没有待审批的提案' }; }
    case 'list_parties': {
      const p = resolveProject(input.project, ctx);
      const sm = projectPartiesSummary(p.id);
      const out = { project: p.name, totals: { 供应商: { 应付: sm.totals.supplier.due, 实付: sm.totals.supplier.paid, 未付: sm.totals.supplier.open }, 客户: { 应收: sm.totals.customer.due, 实收: sm.totals.customer.paid, 未收: sm.totals.customer.open } }, daily: sm.daily.slice(0, 30) };
      if (input.kind !== 'customer') out.suppliers = sm.suppliers.map(partyBrief);
      if (input.kind !== 'supplier') out.customers = sm.customers.map(partyBrief);
      // 绑定了中转站的单位：附上实时结算 / 消耗（最多 8 家，20 秒缓存）
      const linked = [...(out.suppliers || []), ...(out.customers || [])].filter((x) => x.relay && x.relay.startsWith('已绑定')).slice(0, 8);
      await Promise.all(linked.map(async (b) => {
        const pa = q.party.get(b.id); const live = await partyLive(pa);
        if (!live.linked || live.error) { b.relay_live = live.error || '获取失败'; return; }
        const st = live.settlement, C = st.currency, L2 = PARTY_LABEL[pa.kind];
        b.relay_live = { 结算币种: C, [pa.kind === 'customer' ? '折扣' : '倍率']: st.ratio, 中转站累计消耗_usd: st.consumption_usd, [`${L2.due}合计`]: st.due, [`其中中转站自动挂账`]: st.relay_due, [`${L2.paid}合计`]: st.paid, [L2.open]: st.open, [pa.kind === 'customer' ? '预收余额' : '待消耗额度']: st.credit, 今日消耗折算: st.today, 当前RPM: live.live ? live.live.rpm_now : null, ...(pa.kind === 'customer' ? { 中转站余额_usd: live.user ? live.user.balance_usd : null } : { 账号状态: live.account.status }), 说明: `${L2.due} = 中转站消耗 × ${pa.kind === 'customer' ? '折扣' : '倍率'}，按结算币种 ${C} 自动逐日挂账；${L2.open} = ${L2.due} − ${L2.paid}` };
      }));
      return { ...out, summary: `${p.name}：应付 ${cny(sm.totals.supplier.due)} / 实付 ${cny(sm.totals.supplier.paid)} / 未付 ${cny(sm.totals.supplier.open)}；应收 ${cny(sm.totals.customer.due)} / 实收 ${cny(sm.totals.customer.paid)} / 未收 ${cny(sm.totals.customer.open)}` };
    }
    case 'party_statement': {
      const { party: pa } = resolvePartyAnywhere(input, ctx);
      const records = q.recordsOfParty.all(pa.id);
      const v = partyView(pa, records), L = PARTY_LABEL[pa.kind];
      return { party: partyBrief(v), records: records.slice(0, 100).map((r) => ({ id: r.id, date: r.date, type: L[r.kind], amount: r.amount, currency: r.currency, rate: r.rate, cny: r2(recBase(r)), note: r.note, source: r.source, entry_id: r.entry_id })), settle: v.settle, summary: `${L.name}「${pa.name}」（结算币种 ${v.settle.currency}）：${L.due} ${v.settle.due.toLocaleString('zh-CN')} ${v.settle.currency}${v.relay ? `（其中中转站自动 ${v.settle.relay_due.toLocaleString('zh-CN')}）` : ''}，${L.paid} ${v.settle.paid.toLocaleString('zh-CN')} ${v.settle.currency}，${v.settle.open > 0 ? `${L.open} ${v.settle.open.toLocaleString('zh-CN')}` : `${pa.kind === 'customer' ? '预收余额' : '待消耗额度'} ${v.settle.credit.toLocaleString('zh-CN')}`} ${v.settle.currency}（折合 ${cny(v.settle.open_cny)}），共 ${records.length} 条` };
    }
    case 'search_knowledge': { const hits = kbSearch(input.query, { from: input.from, to: input.to }); return { hits, summary: `找到 ${hits.length} 条` }; }
    case 'read_knowledge': {
      if (input.what === 'summary') { const s = readSummary(); return { content: s.slice(0, 20000) || '（知识摘要还没有整理过）', summary: '已读取知识摘要' }; }
      const c = readKb(input.what, input.date);
      return c ? { content: c.slice(0, 30000), summary: `已读取 ${input.date} 的${input.what === 'log' ? '操作日志' : '对话记录'}` } : { error: `${input.date || '（未指定日期）'} 没有${input.what === 'log' ? '操作日志' : '对话记录'}，可用日期：${kbDates(input.what).slice(0, 15).join('、') || '无'}` };
    }
    default: return { error: `未知工具 ${name}` };
  }
}

// 需审批工具：prepare 解析并校验参数生成提案；execute 在批准后执行
const GATED_IMPL = {
  add_entry: {
    prepare(input, ctx) {
      const p = resolveProject(input.project, ctx), h = resolveMember(input.handler, ctx.user);
      const body = { project_id: p.id, type: input.type, amount: input.amount, currency: input.currency, rate: input.rate, handler_id: h.id, note: input.note, time: input.time };
      const n = ops.normalizeEntry(ctx.user, body);
      return { resolved: body, title: `记一笔${n.type === 'income' ? '收入' : '支出'}`, detail: describeEntry(n) };
    },
    execute(resolved, ctx) { const e = ops.addEntry(ctx.user, resolved, ctx.via); return { entry: entryView(e, ctx.user), summary: `已记录：${entryLine(e)}` }; },
  },
  add_entries_batch: {
    prepare(input, ctx) {
      const rows = Array.isArray(input.entries) ? input.entries.slice(0, 200) : [];
      if (!rows.length) throw new HttpError(400, 'entries 不能为空');
      const resolved = [], lines = [], warnings = [];
      rows.forEach((r, i) => {
        const p = resolveProject(r.project, ctx);
        let h = r.handler ? findMember(r.handler) : null;
        if (r.handler && !h) { warnings.push(`第 ${i + 1} 行经手人「${r.handler}」不在团队里，按 ${ctx.user.username} 记录`); }
        h = h || (r.handler ? ctx.user : resolveMember(r.handler, ctx.user));
        const body = { project_id: p.id, type: r.type, amount: r.amount, currency: r.currency, rate: r.rate, handler_id: h.id, note: r.note || '', time: r.time };
        const n = ops.normalizeEntry(ctx.user, body);
        resolved.push(body); lines.push(`${i + 1}. ${describeEntry(n)}`);
      });
      return { resolved: { entries: resolved, source: input.source || '' }, title: `批量记账 ${resolved.length} 笔${input.source ? `（${input.source}）` : ''}`, detail: [...lines, ...warnings.map((w) => `⚠️ ${w}`)].join('\n') };
    },
    execute(resolved, ctx) {
      const ok = [], failed = [];
      for (const body of resolved.entries) { try { ok.push(ops.addEntry(ctx.user, body, ctx.via)); } catch (e) { failed.push(e.message); } }
      return { added: ok.map((e) => entryView(e, ctx.user)), failed, summary: `已记录 ${ok.length} 笔${failed.length ? `，${failed.length} 笔失败：${failed.join('；')}` : ''}` };
    },
  },
  update_entry: {
    prepare(input, ctx) {
      const e = q.entry.get(Number(input.entry_id));
      if (!e) throw new HttpError(404, `记录 #${input.entry_id} 不存在`);
      if (!ops.canEditEntry(ctx.user, e)) throw new HttpError(403, `记录 #${e.id} 是 ${e.creator_name} 登记的，${ctx.user.username} 无权修改`);
      const patch = {};
      if (input.project !== undefined) patch.project_id = resolveProject(input.project, ctx).id;
      if (input.handler !== undefined) patch.handler_id = resolveMember(input.handler, ctx.user).id;
      for (const k of ['type', 'amount', 'currency', 'rate', 'note', 'time']) if (input[k] !== undefined) patch[k] = input[k];
      const n = ops.normalizeEntry(ctx.user, patch, e);
      return { resolved: { entry_id: e.id, patch }, title: `修改记录 #${e.id}`, detail: `原：${entryLine(e)}\n改为：${describeEntry(n)}` };
    },
    execute(resolved, ctx) { const e = ops.updateEntry(ctx.user, resolved.entry_id, resolved.patch, ctx.via); return { entry: entryView(e, ctx.user), summary: `已修改：${entryLine(e)}` }; },
  },
  delete_entry: {
    prepare(input, ctx) {
      const e = q.entry.get(Number(input.entry_id));
      if (!e) throw new HttpError(404, `记录 #${input.entry_id} 不存在`);
      if (!ops.canEditEntry(ctx.user, e)) throw new HttpError(403, `记录 #${e.id} 是 ${e.creator_name} 登记的，${ctx.user.username} 无权删除`);
      return { resolved: { entry_id: e.id }, title: `删除记录 #${e.id}`, detail: entryLine(e) };
    },
    execute(resolved, ctx) { const e = ops.deleteEntry(ctx.user, resolved.entry_id, ctx.via); return { deleted: e.id, summary: `已删除：${entryLine(e)}` }; },
  },
  create_project: {
    prepare(input) { const name = String(input.name || '').trim(); if (!name || name.length > 40) throw new HttpError(400, '项目名称为 1–40 个字符'); return { resolved: { name, note: input.note || '', create_group: !!input.create_group }, title: `新建项目「${name}」${input.create_group ? '并建群' : ''}`, detail: [input.note ? `说明：${input.note}` : '', input.create_group ? '同时创建项目专属群聊' : ''].filter(Boolean).join(' · ') }; },
    execute(resolved, ctx) {
      const p = ops.createProject(ctx.user, resolved, ctx.via);
      if (resolved.create_group) { const key = `project:${p.id}`; q.insertChannel.run(key, p.name, p.id, ctx.user.id, now()); kbLog(`${ctx.via}新建了项目群「${p.name}」`); postSystemMessage(key, `${ctx.user.username} 通过 AI 创建了项目「${p.name}」及其群聊。这里的 AI 只负责本项目的账目。`); broadcast('channels', { channels: channelList(), by: ctx.user.username, created: key }); }
      return { project: { id: p.id, name: p.name }, summary: `已创建项目「${p.name}」${resolved.create_group ? '并建好了项目群' : ''}` };
    },
  },
  update_project: {
    prepare(input, ctx) {
      const p = resolveProject(input.project, ctx);
      const changes = [];
      if (input.name !== undefined) changes.push(`名称 → 「${input.name}」`);
      if (input.note !== undefined) changes.push(`说明 → ${input.note}`);
      if (input.archived !== undefined) changes.push(input.archived ? '归档' : '恢复');
      if (!changes.length) throw new HttpError(400, '没有要修改的内容');
      return { resolved: { project_id: p.id, name: input.name, note: input.note, archived: input.archived }, title: `修改项目「${p.name}」`, detail: changes.join('；') };
    },
    execute(resolved, ctx) { const u = ops.updateProject(ctx.user, resolved.project_id, resolved, ctx.via); return { project: { id: u.id, name: u.name, archived: !!u.archived }, summary: `已更新项目「${u.name}」` }; },
  },
  update_settings: {
    prepare(input, ctx) {
      const body = JSON.parse(JSON.stringify(input));
      if (body.auto_export && body.auto_export.scope && body.auto_export.scope !== 'all') body.auto_export.scope = String(resolveProject(body.auto_export.scope, ctx).id);
      const parts = [];
      if (body.rates) parts.push(`汇率 1 USD = ${body.rates.USD ?? '不变'}，1 USDT = ${body.rates.USDT ?? '不变'}`);
      if (body.ai_auto !== undefined) parts.push(`AI 自动刷新 ${body.ai_auto ? '开' : '关'}`);
      if (body.group_ai !== undefined) parts.push(`群聊回复 ${body.group_ai === 'mention' ? '仅 @AI' : '每条'}`);
      if (body.ai_model !== undefined) parts.push(`AI 模型 → ${body.ai_model}`);
      if (body.auto_export) parts.push(`自动导出 ${JSON.stringify(body.auto_export)}`);
      if (!parts.length) throw new HttpError(400, '没有要修改的设置');
      if (body.rates) for (const c of ['USD', 'USDT']) if (body.rates[c] === undefined) body.rates[c] = getRates()[c];
      return { resolved: body, title: '修改设置', detail: parts.join('；') };
    },
    execute(resolved, ctx) { ops.updateSettings(ctx.user, resolved, ctx.via); return { summary: '设置已更新' }; },
  },
  generate_ai_report: {
    prepare(input, ctx) { const params = reportParamsFrom(input, ctx); const p = params.scope === 'all' ? null : q.project.get(Number(params.scope)); return { resolved: { ...params, force: !!input.force }, title: `生成 AI 财务报表`, detail: `${p ? p.name : '全部项目'} · ${RANGE_LABELS[params.range]}${params.range === 'custom' ? ` ${params.from} 至 ${params.to}` : ''}` }; },
    execute(resolved, ctx) { const job = generateReport(resolved, { force: resolved.force, by: ctx.user.username }); return { status: job.fresh ? 'done' : 'running', summary: job.fresh ? 'AI 报表已是最新，无需重新生成' : 'AI 报表开始生成，报表页会实时显示' }; },
  },
  export_report: {
    prepare(input, ctx) { const params = reportParamsFrom(input, ctx); const p = params.scope === 'all' ? null : q.project.get(Number(params.scope)); return { resolved: { ...params, format: input.format || 'xlsx' }, title: `导出报表（${input.format === 'both' ? 'Excel + Markdown' : input.format === 'md' ? 'Markdown' : 'Excel'}）`, detail: `${p ? p.name : '全部项目'} · ${RANGE_LABELS[params.range]}${params.range === 'custom' ? ` ${params.from} 至 ${params.to}` : ''}` }; },
    async execute(resolved, ctx) { const rows = await runExport(resolved, { source: 'ai', user: ctx.user, format: resolved.format }); return { files: rows.map((r) => ({ name: r.name, url: r.url })), links: rows.map((r) => ({ label: r.name, url: r.url })), summary: `已导出：${rows.map((r) => r.name).join('、')}` }; },
  },
  add_party: {
    prepare(input, ctx) {
      const p = resolveProject(input.project, ctx);
      const kind = input.kind === 'customer' ? 'customer' : 'supplier';
      const name = String(input.name || '').trim();
      if (!name) throw new HttpError(400, '请提供名称');
      if (q.partyByName.get(p.id, kind, name, '\u0000')) throw new HttpError(409, `项目「${p.name}」已有${PARTY_LABEL[kind].name}「${name}」`);
      return { resolved: { project_id: p.id, kind, name, contact: input.contact || '', note: input.note || '', currency: input.currency || 'CNY', ratio: input.ratio, relay_ref: input.relay_ref || '' }, title: `添加${PARTY_LABEL[kind].name}「${name}」`, detail: `项目 ${p.name}${input.contact ? ` · 联系方式 ${input.contact}` : ''}${input.note ? ` · ${input.note}` : ''} · 结算币种 ${input.currency || 'CNY'}${input.ratio ? ` · 倍率 ${input.ratio}` : ''}${input.relay_ref ? ` · 绑定中转站 ${input.relay_ref}` : ''}` };
    },
    async execute(resolved, ctx) {
      const pa = ops.addParty(ctx.user, resolved.project_id, resolved, ctx.via);
      let extra = '';
      if (resolved.relay_ref) { try { await linkPartyRelay(ctx.user, pa.id, resolved.relay_ref); extra = '，已绑定中转站'; } catch (e) { extra = `，但绑定中转站失败：${e.message}`; } }
      return { party: { id: pa.id, name: pa.name, kind: pa.kind }, summary: `已添加${PARTY_LABEL[pa.kind].name}「${pa.name}」${extra}` };
    },
  },
  clear_project: {
    prepare(input, ctx) {
      const p = resolveProject(input.project, ctx);
      const st = ops.projectStats(p.id);
      if (!st.entries && !st.records && !st.transfers) throw new HttpError(400, `项目「${p.name}」本来就没有记录`);
      return { resolved: { project_id: p.id }, title: `清空项目「${p.name}」的记录`, detail: `将删除流水 ${st.entries} 笔、往来记录 ${st.records} 笔、成员转账 ${st.transfers} 笔（供应商 / 客户名单保留）。清空后这些数据不再计入任何统计与报表，且不可恢复。` };
    },
    execute(resolved, ctx) { const r = ops.clearProject(ctx.user, resolved.project_id, ctx.via); return { ...r.removed, summary: `已清空项目「${r.project.name}」：流水 ${r.removed.entries} 笔、往来记录 ${r.removed.records} 笔、成员转账 ${r.removed.transfers} 笔` }; },
  },
  delete_project: {
    prepare(input, ctx) {
      const p = resolveProject(input.project, ctx);
      const st = ops.projectStats(p.id);
      return { resolved: { project_id: p.id }, title: `删除项目「${p.name}」`, detail: `将删除整个项目及其流水 ${st.entries} 笔、往来单位 ${st.parties} 家、往来记录 ${st.records} 笔、成员转账 ${st.transfers} 笔和项目群聊。删除后不再计入任何统计与报表，且不可恢复。` };
    },
    execute(resolved, ctx) { const r = ops.deleteProject(ctx.user, resolved.project_id, ctx.via); return { ...r.removed, summary: `已删除项目「${r.project.name}」及其全部数据` }; },
  },
  add_transfer: {
    prepare(input, ctx) {
      const p = resolveProject(input.project, ctx, { allowNone: true });
      const from = resolveMember(input.from, ctx.user), to = resolveMember(input.to, ctx.user);
      const body = { project_id: p ? p.id : null, from_id: from.id, to_id: to.id, amount: input.amount, currency: input.currency || 'CNY', rate: input.rate, time: input.time, note: input.note || '' };
      const n = ops.normalizeTransfer(ctx.user, body);   // 先校验，报错就不会生成提案
      return { resolved: { ...body, time: n.at }, title: `记转账：${n.from.username} → ${n.to.username}`, detail: `${n.amount.toLocaleString('zh-CN')} ${n.currency}${n.currency !== 'CNY' ? `（汇率 ${n.rate}，≈${cny(n.amount * n.rate)}）` : ''} · ${n.project ? n.project.name : '不挂项目'} · ${fmtTZ(n.at)}${n.note ? ` · ${n.note}` : ''}（只在成员资金之间搬钱，不影响利润）` };
    },
    execute(resolved, ctx) { const t = ops.addTransfer(ctx.user, resolved, ctx.via); return { transfer: transferView(t), summary: `已记录转账 ${t.from_name} → ${t.to_name} ${t.amount.toLocaleString('zh-CN')} ${t.currency}` }; },
  },
  delete_transfer: {
    prepare(input) {
      const t = q.transfer.get(Number(input.transfer_id));
      if (!t) throw new HttpError(404, `转账记录 #${input.transfer_id} 不存在`);
      return { resolved: { transfer_id: t.id }, title: `删除转账 #${t.id}`, detail: transferLine(t) };
    },
    execute(resolved, ctx) { const t = ops.deleteTransfer(ctx.user, resolved.transfer_id, ctx.via); return { deleted: t.id, summary: `已删除转账 #${t.id}` }; },
  },
  add_party_record: {
    prepare(input, ctx) {
      const { project: p, party: pa } = resolvePartyAnywhere(input, ctx);
      const L = PARTY_LABEL[pa.kind];
      const kind = input.kind === 'paid' ? 'paid' : 'due';
      const amount = r2(Number(input.amount));
      if (!(amount > 0)) throw new HttpError(400, '金额必须大于 0');
      const currency = String(input.currency || pa.currency || 'CNY').toUpperCase();
      const rate = currency === 'CNY' ? 1 : (input.rate > 0 ? Number(input.rate) : getRates()[currency]);
      const date = input.date || todayKey();
      if (!RE_DATE.test(date)) throw new HttpError(400, '日期格式为 YYYY-MM-DD');
      const link = kind === 'paid' && input.link_entry !== false;
      const handler = kind === 'paid' ? resolveMember(input.handler, ctx.user) : null;
      return { resolved: { party_id: pa.id, kind, amount, currency, rate, date, note: input.note || '', link_entry: link, handler_id: handler ? handler.id : undefined, source: 'ai' }, title: `记${L.name}「${pa.name}」${L[kind]}`, detail: `${kind === 'paid' ? `经手人 ${resolveMember(input.handler, ctx.user).username} · ` : ''}${L[kind]} ${amount.toLocaleString('zh-CN')} ${currency}${currency !== 'CNY' ? `（汇率 ${rate}，≈${cny(amount * rate)}）` : ''} · 日期 ${date}${input.note ? ` · ${input.note}` : ''} · 项目 ${p.name}${link ? ` · 同时记入项目流水（${pa.kind === 'supplier' ? '支出' : '收入'}）` : ''}` };
    },
    execute(resolved, ctx) { const r = ops.addPartyRecord(ctx.user, resolved.party_id, resolved, ctx.via); const pa = q.party.get(resolved.party_id); const L = PARTY_LABEL[pa.kind]; return { record: recordView(r.record), summary: `已记录${L.name}「${pa.name}」${L[resolved.kind]} ${resolved.amount.toLocaleString('zh-CN')} ${resolved.currency}（${resolved.date}）${r.record.entry_id ? '，已同步记入流水' : ''}` }; },
  },
  update_party: {
    prepare(input, ctx) {
      const { party: pa } = resolvePartyAnywhere(input, ctx);
      const L = PARTY_LABEL[pa.kind];
      const changes = [];
      const patch = {};
      for (const k of ['name', 'contact', 'note', 'currency', 'external_id', 'archived']) if (input[k] !== undefined) { patch[k] = input[k]; changes.push(k === 'archived' ? (input[k] ? '归档' : '恢复') : `${{ name: '名称', contact: '联系方式', note: '备注', currency: '结算币种', external_id: '外部编号' }[k]} → ${input[k]}`); }
      if (input.ratio !== undefined) { if (!(Number(input.ratio) > 0)) throw new HttpError(400, '倍率 / 折扣必须大于 0'); patch.ratio = Number(input.ratio); changes.push(`${pa.kind === 'customer' ? '折扣' : '倍率'} ${pa.ratio} → ${input.ratio}`); }
      if (input.relay_ref) changes.push(`绑定中转站 ${input.relay_ref}`);
      if (input.unlink_relay) changes.push('解绑中转站');
      if (!changes.length) throw new HttpError(400, '没有要修改的内容');
      return { resolved: { party_id: pa.id, patch, relay_ref: input.relay_ref || '', unlink_relay: !!input.unlink_relay }, title: `修改${L.name}「${pa.name}」`, detail: changes.join('；') };
    },
    async execute(resolved, ctx) {
      let pa = q.party.get(resolved.party_id);
      if (Object.keys(resolved.patch).length) pa = ops.updateParty(ctx.user, resolved.party_id, resolved.patch, ctx.via);
      let extra = '';
      if (resolved.unlink_relay) { q.linkParty.run(null, '', pa.id); dataChanged(ctx.user, `${ctx.via}解除了${PARTY_LABEL[pa.kind].name}「${pa.name}」与中转站的绑定`); extra = '，已解绑中转站'; }
      else if (resolved.relay_ref) { try { await linkPartyRelay(ctx.user, pa.id, resolved.relay_ref); extra = '，已绑定中转站'; } catch (e) { extra = `，但绑定中转站失败：${e.message}`; } }
      return { party: { id: pa.id, name: pa.name }, summary: `已修改${PARTY_LABEL[pa.kind].name}「${pa.name}」${extra}` };
    },
  },
  delete_party: {
    prepare(input, ctx) { const { project: p, party: pa } = resolvePartyAnywhere(input, ctx); const n = q.recordsOfParty.all(pa.id).length; return { resolved: { party_id: pa.id }, title: `删除${PARTY_LABEL[pa.kind].name}「${pa.name}」`, detail: `项目 ${p.name} · 将同时删除其 ${n} 条往来记录（已入流水的记录保留）` }; },
    execute(resolved, ctx) { const pa = ops.deleteParty(ctx.user, resolved.party_id, ctx.via); return { deleted: pa.id, summary: `已删除${PARTY_LABEL[pa.kind].name}「${pa.name}」` }; },
  },
  create_project_group: {
    prepare(input, ctx) { const p = resolveProject(input.project, ctx); if (q.channel.get(`project:${p.id}`)) throw new HttpError(409, `项目「${p.name}」已经有群了`); return { resolved: { project_id: p.id }, title: `新建项目群「${p.name}」`, detail: '群里的 AI 只负责该项目的账目、统计与报表' }; },
    execute(resolved, ctx) {
      const p = q.project.get(resolved.project_id); const key = `project:${p.id}`;
      if (!q.channel.get(key)) { q.insertChannel.run(key, p.name, p.id, ctx.user.id, now()); kbLog(`${ctx.via}新建了项目群「${p.name}」`); postSystemMessage(key, `${ctx.user.username} 通过 AI 创建了项目「${p.name}」的群聊。这里的 AI 只负责本项目的账目。`); broadcast('channels', { channels: channelList(), by: ctx.user.username, created: key }); }
      return { channel: key, summary: `已创建项目群「${p.name}」，在聊天面板的会话下拉里可以切换过去` };
    },
  },
  delete_party_record: {
    prepare(input) {
      const rec = q.record.get(Number(input.record_id));
      if (!rec) throw new HttpError(404, `往来记录 #${input.record_id} 不存在`);
      if (rec.source === 'relay' && q.party.get(rec.party_id)?.relay_id) throw new HttpError(400, `往来记录 #${rec.id} 是中转站自动挂账，绑定期间不能删除；要调整请改倍率 / 折扣（update_party），或先解绑`);
      const L = PARTY_LABEL[rec.party_kind];
      return { resolved: { record_id: rec.id }, title: `删除往来记录 #${rec.id}`, detail: `${L.name}「${rec.party_name}」${L[rec.kind]} ${rec.amount.toLocaleString('zh-CN')} ${rec.currency}（${rec.date}）${rec.entry_id ? ` · 关联流水 #${rec.entry_id} 一并删除` : ''}` };
    },
    execute(resolved, ctx) { const rec = ops.deletePartyRecord(ctx.user, resolved.record_id, ctx.via); return { deleted: rec.id, summary: `已删除往来记录 #${rec.id}` }; },
  },
  consolidate_knowledge: {
    prepare(input) { return { resolved: { reason: input.reason || '' }, title: '整理知识库', detail: `把最近的操作日志与对话归纳进知识摘要${input.reason ? `：${input.reason}` : ''}` }; },
    async execute(resolved, ctx) { const r = await consolidateKnowledge(ctx.user, ctx.via); return { summary: r.summary }; },
  },
};

// ---------------------------------------------------------------- 提案（审批）
const proposalView = (p) => ({ id: p.id, channel: p.channel, message_id: p.message_id, tool: p.tool, label: TOOL_LABEL[p.tool] || p.tool, title: p.title, detail: p.detail, requested_by: p.requested_by, requested_name: p.requested_name, status: p.status, decided_name: p.decided_name, decided_at: p.decided_at, result: p.result, error: p.error, created_at: p.created_at });
function createProposal(channel, messageId, tool, prepared, user) {
  const r = q.insertProposal.run(channel, messageId, tool, JSON.stringify(prepared.resolved), prepared.title, prepared.detail, user.id, user.username, now());
  const p = q.proposal.get(Number(r.lastInsertRowid));
  kbLog(`AI 助手提议（待 ${channel === 'group' ? '成员' : user.username} 审批）#${p.id}：${p.title} — ${p.detail.replace(/\n/g, '；')}`);
  broadcast('proposal', { proposal: proposalView(p) }, channelAudience(channel));
  return p;
}
async function decideProposal(id, user, approve) {
  const p = q.proposal.get(Number(id));
  if (!p) throw new HttpError(404, '提案不存在');
  if (p.status !== 'pending') throw new HttpError(400, `提案已${p.status === 'approved' ? '批准' : p.status === 'rejected' ? '拒绝' : '处理'}`);
  const requester = q.userById.get(p.requested_by) || user;
  let status = approve ? 'approved' : 'rejected', result = '', error = '';
  if (approve) {
    const via = `AI 助手（${requester.username} 提出，${user.username} 批准）：`;
    try { const out = await GATED_IMPL[p.tool].execute(JSON.parse(p.input), { user: requester, via }); result = JSON.stringify(out); }
    catch (e) { status = 'failed'; error = e instanceof HttpError ? e.message : (e.message || '执行失败'); if (!(e instanceof HttpError)) console.error('[proposal]', e); }
  }
  q.decideProposal.run(status, user.id, user.username, now(), result, error, p.id);
  const updated = q.proposal.get(p.id);
  const text = status === 'approved' ? `${user.username} 批准了提案 #${p.id}「${p.title}」，已执行：${(JSON.parse(result || '{}').summary || '完成')}`
    : status === 'rejected' ? `${user.username} 拒绝了提案 #${p.id}「${p.title}」`
      : `${user.username} 批准了提案 #${p.id}「${p.title}」，但执行失败：${error}`;
  kbLog(text);
  postSystemMessage(p.channel, text, { proposal_id: p.id });
  broadcast('proposal', { proposal: proposalView(updated) }, channelAudience(p.channel));
  return updated;
}

// ---------------------------------------------------------------- 知识库整理（需审批 / 页面手动）
async function consolidateKnowledge(user, via = '') {
  if (!anthropic) throw new HttpError(400, '未配置 AI 接口');
  const since = getSetting('kb_consolidated_at', null);
  const sinceDate = since ? dayKey(since) : '0000-00-00';
  const logs = kbDates('log').filter((d) => d >= sinceDate).slice(0, 30).reverse().map((d) => readKb('log', d)).join('\n\n');
  const chats = kbDates('chat').filter((d) => d >= sinceDate).slice(0, 14).reverse().map((d) => readKb('chat', d)).join('\n\n');
  const stats = await runReadTool('get_report', { range: 'all' }, { user });
  const prev = readSummary();
  const t = inTZ();
  const prompt = `你是「元启智能账单系统」的知识库管理员。请把下面的资料整理成一份新的团队知识摘要（Markdown），供 AI 助手今后回答"我们做过什么"时使用。

要求：
- 保留旧摘要里仍然有效的信息，合并新的内容，去重、压缩，不要丢失具体事实（谁、什么时候、哪个项目、多少钱、为什么）。
- 结构固定：
  # 团队知识摘要（整理于 ${t.date} ${t.time}）
  ## 团队与项目概况（成员、各项目用途与状态、累计收支利润）
  ## 大事记（按日期倒序的要点列表，每条带日期）
  ## 记账习惯与约定（币种、汇率、谁负责什么、常见备注含义）
  ## 待办与未决事项（待审批、待确认、异常记录）
  ## 其他值得记住的信息
- 数字直接引用资料，不要臆造；控制在 1500 字以内。

【旧摘要】
${prev.slice(0, 20000) || '（无）'}

【当前统计（全部时间）】
${JSON.stringify({ kpis: stats.kpis, byProject: stats.byProject, byMember: stats.byMember }).slice(0, 6000)}

【${since ? `自 ${fmtTZ(since)} 以来的` : '全部'}操作日志】
${logs.slice(0, 40000) || '（无）'}

【${since ? `自 ${fmtTZ(since)} 以来的` : '全部'}对话记录】
${chats.slice(0, 40000) || '（无）'}`;
  const text = await withAiRetry('知识库整理', async () => {
    const stream = anthropic.messages.stream({ model: aiModel(), max_tokens: maxTokensFor(aiModel()), messages: [{ role: 'user', content: prompt }] });
    const final = await stream.finalMessage();
    const t = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!t) throw new Error('模型没有返回内容');
    return t;
  });
  if (prev) fs.writeFileSync(path.join(KB_DIR, 'archive', `summary-${t.iso.replace(/[:]/g, '')}.md`), prev);
  fs.writeFileSync(SUMMARY_FILE, `${text}\n`);
  const at = now();
  q.putSetting.run('kb_consolidated_at', at);
  kbLog(`${via || `${user.username}：`}整理了知识库（summary.md 已更新，旧版本已存档）`);
  broadcast('kb', { consolidated_at: at, by: user.username });
  return { summary: `知识库已整理（${text.length} 字），旧摘要已存档`, content: text };
}
// 到期自动提议整理（在群聊里生成待审批提案）
function checkKnowledgeSchedule() {
  if (!anthropic || KB_CONSOLIDATE_DAYS <= 0) return;
  const t = inTZ();
  if (t.time !== '21:00') return;
  const last = getSetting('kb_consolidated_at', null) || getSetting('kb_first_seen', null);
  if (!last) { q.putSetting.run('kb_first_seen', now()); return; }
  if ((Date.now() - new Date(last).getTime()) < KB_CONSOLIDATE_DAYS * 864e5) return;
  if (q.pendingByTool.get('consolidate_knowledge')) return;
  if (getSetting('kb_proposed_on', '') === t.date) return;
  q.putSetting.run('kb_proposed_on', t.date);
  const sys = q.userById.get(1) || q.members.all()[0];
  if (!sys) return;
  const msg = postSystemMessage('group', `距离上次整理知识库已超过 ${KB_CONSOLIDATE_DAYS} 天，AI 助手提议整理一次，请成员批准。`);
  createProposal('group', msg.id, 'consolidate_knowledge', { resolved: { reason: '定期整理' }, title: '整理知识库（定期）', detail: `把最近 ${KB_CONSOLIDATE_DAYS} 天的操作日志与对话归纳进知识摘要` }, { id: sys.id, username: 'AI 助手' });
}
setInterval(checkKnowledgeSchedule, 60 * 1000).unref();

// ---------------------------------------------------------------- 群聊 / 私聊
const CHAT_HISTORY = 40;
const CHAT_MAX_TURNS = 8;
const dmChannel = (uid) => `dm:${uid}`;
function channelFor(raw, user) {
  raw = String(raw || 'group');
  if (raw === 'group') return 'group';
  if (raw.startsWith('project:')) { if (!q.channel.get(raw)) throw new HttpError(404, '该项目还没有群聊，请先新建'); return raw; }
  return dmChannel(user.id);
}
const channelProject = (channel) => (channel.startsWith('project:') ? Number(channel.slice(8)) : null);
function channelList() {
  return [{ key: 'group', name: '团队群', kind: 'team' }, ...q.channels.all().map((c) => ({ key: c.key, name: c.project_name || c.name, kind: 'project', project_id: c.project_id, archived: !!c.project_archived, created_at: c.created_at }))];
}
function messageView(r) {
  let parts = [], attachments = [];
  try { parts = JSON.parse(r.parts); } catch {}
  try { attachments = JSON.parse(r.attachments); } catch {}
  const proposals = q.proposalsByMessage.all(r.id).map(proposalView);
  return { id: r.id, channel: r.channel, kind: r.kind, user_id: r.user_id, username: r.username, text: r.text, parts, attachments, proposals, created_at: r.created_at };
}
function insertMessage(channel, kind, user, text, { parts = [], api = [], attachments = [] } = {}) {
  const r = q.insertMessage.run(channel, kind, user ? user.id : null, user ? user.username : (kind === 'assistant' ? 'AI 助手' : '系统'), text, JSON.stringify(parts), JSON.stringify(api), JSON.stringify(attachments), now());
  return q.message.get(Number(r.lastInsertRowid));
}
function postSystemMessage(channel, text, extra = {}) {
  const row = insertMessage(channel, 'system', null, text, { parts: [{ type: 'text', text }], api: [] });
  broadcast('msg', { channel, message: { ...messageView(row), ...extra } }, channelAudience(channel));
  return row;
}
const speakerTag = (r) => `[${r.username} · ${fmtTZ(r.created_at)}]`;
// 把某条成员消息变成模型输入（full：本轮，附件原文；否则历史占位）
async function userContent(row, full) {
  let attachments = []; try { attachments = JSON.parse(row.attachments); } catch {}
  const blocks = [{ type: 'text', text: `${speakerTag(row)} ${row.text || '（发送了附件）'}` }];
  for (const id of attachments) { const a = q.attachment.get(Number(id)); if (a) blocks.push(...await attachmentBlocks(a, full)); }
  return blocks;
}
// 清洗要发给模型的历史：空内容块、空消息、落单的 tool_use / tool_result 都会让接口报错或返回空回复
function sanitizeHistory(list) {
  const kept = [];
  for (const m of list) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    if (typeof m.content === 'string') { if (m.content.trim()) kept.push({ role: m.role, content: m.content }); continue; }
    if (!Array.isArray(m.content)) continue;
    const blocks = m.content.filter((b) => b && b.type && !(b.type === 'text' && !(typeof b.text === 'string' && b.text.trim())));
    if (blocks.length) kept.push({ role: m.role, content: blocks });
  }
  const out = [];
  for (let i = 0; i < kept.length; i++) {
    const m = kept[i];
    if (typeof m.content === 'string') { out.push(m); continue; }
    let blocks = m.content;
    if (m.role === 'assistant') {
      const next = kept[i + 1];
      const answered = new Set(next && next.role === 'user' && Array.isArray(next.content) ? next.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : []);
      blocks = blocks.filter((b) => b.type !== 'tool_use' || answered.has(b.id));
    } else {
      const prev = out[out.length - 1];
      const asked = new Set(prev && prev.role === 'assistant' && Array.isArray(prev.content) ? prev.content.filter((b) => b.type === 'tool_use').map((b) => b.id) : []);
      blocks = blocks.filter((b) => b.type !== 'tool_result' || asked.has(b.tool_use_id));
    }
    if (blocks.length) out.push({ role: m.role, content: blocks });
  }
  return out;
}
async function buildHistory(channel, currentId) {
  const rows = q.recentMessages.all(channel, CHAT_HISTORY).reverse();
  const msgs = [];
  // 最近 15 分钟内带附件的消息也把原图 / 原文喂给模型（最多 4 条），避免"上一条发的图 AI 看不到"
  const recentIds = new Set(rows.filter((r) => r.kind === 'user' && r.attachments !== '[]' && Date.now() - new Date(r.created_at).getTime() < 15 * 60 * 1000).slice(-4).map((r) => r.id));
  for (const r of rows) {
    if (r.kind === 'recalled') continue;
    if (r.kind === 'user') msgs.push({ role: 'user', content: await userContent(r, r.id === currentId || recentIds.has(r.id)) });
    else if (r.kind === 'system') msgs.push({ role: 'user', content: `[系统 · ${fmtTZ(r.created_at)}] ${r.text}` });
    else { let api = []; try { api = JSON.parse(r.api); } catch {} msgs.push(...api); }
  }
  const clean = sanitizeHistory(msgs);
  while (clean.length && !(clean[0].role === 'user' && (typeof clean[0].content === 'string' || clean[0].content.some((b) => b.type === 'text' || b.type === 'image' || b.type === 'document')))) clean.shift();
  return clean;
}
const stripThinking = (content) => content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');

const CHAT_SYSTEM = `你是「元启智能账单系统」内置的 AI 助手，服务于团队群聊、各项目群聊和每位成员的私聊。你的职责：帮团队记账、查账、管理往来（供应商 / 客户）、出报表、导出、查中转站消耗，并且永远清楚团队做过什么。

## 系统概况（你要完整了解）
- 团队成员共用一个账本；按「项目」分别记录支出与收入；币种 CNY / USDT / USD。每笔非人民币记录都保存了记账当时的汇率，统计时按各自汇率折算为人民币：利润 = 收入 − 支出。「我的 → 汇率」是当前汇率，只影响之后的新记录。
- 每笔记录：项目、类型（expense 支出 / income 收入）、金额、币种、汇率、经手人（谁付的 / 谁收的）、备注、登记人、时间（系统自动记录，也可指定或事后修改）。成员也可在项目页点击自己登记的流水直接修改 / 删除。
- 每位成员还有「资金沉淀」：沉淀 = 本人经手的收款 − 本人经手的付款 + 别人转给他 − 他转给别人。谁收的款记在谁头上（记账时的「经手人」），所以沉淀就是这个人手上还压着多少公司的钱；为负说明他自己垫了钱。成员之间的转账（张三把钱交给李四）用 add_transfer 记，只在成员之间搬钱，不影响项目收入 / 支出 / 利润。查用 member_funds（可按项目或全部）、list_transfers。
- 每个项目还有「往来」：供应商（应付 due / 实付 paid，未付 = 应付 − 实付）与客户（应收 due / 实收 paid，未收 = 应收 − 实收），按日期记录，每日更新；实付 / 实收默认同时记入项目流水（支出 / 收入），应付 / 应收只是挂账不影响利润。外部系统可通过对外接口（X-API-Key，令牌在「我的 → 对外接口」）实时推送应收 / 应付，来源标记为 api。
- 客户可绑定中转站用户（邮箱）并设置「折扣」，供应商可绑定中转站上游账号（账号名）并设置「倍率」；绑定后系统按单位的结算币种（CNY / USDT / USD）自动逐日挂账：应收（客户）= 中转站消耗 × 折扣，应付（供应商）= 中转站消耗 × 倍率（绑定前的累计消耗记为一条「期初」），未收 / 未付 = 应收 / 应付 − 实收 / 实付，付多了就是「预收余额 / 待消耗额度」。项目页实时显示消耗、RPM、余额与结算（30 秒自动刷新）。改折扣 / 倍率 / 币种后自动挂账按新参数重算。
- 报表页：范围（全部 / 单项目）× 区间（本月 / 上月 / 近 30 天 / 全部 / 自定义），有 KPI（含上期对比）、利润增长曲线、每日收支、每日账单、按项目、按成员、项目分析（支出用途 / 成员占比 / 币种构成 / 大额记录 / 月度趋势）、AI 财务报表（按范围缓存，数据变动后可自动刷新）、导出记录。导出 Excel 含概览 / 每日账单 / 流水明细 / 项目分析或月度趋势 / 往来 / AI 报表，排版好的；也可导出 AI 报表 Markdown；「我的」可设每日定时自动导出。
- 聊天面板：会话下拉切换团队群 / 私聊 / 各项目群 / 知识库；「＋」新建项目群；「⋯」菜单可改发送方式（Enter 或 Ctrl+Enter）、清屏（仅本机）、清空私聊；自己发的消息 5 分钟内可撤回（撤回会作废你的回复与提案）；麦克风可语音输入（需 HTTPS）；可发图片 / Excel / CSV / PDF / 文本让你整理成账目。
- 「我的」页：汇率、AI 模型（Sonnet 5 / Opus 5 等可切换）、AI 报表自动刷新、群聊回复模式、每日自动导出、对外接口令牌、外观、成员列表。
- 范围 scope：all 或项目 id；区间 range：month / last-month / 30d / all / custom（from、to，YYYY-MM-DD）。
- 权限：只能修改 / 删除自己登记的记录；项目创建者可管理该项目下所有记录。其余（建项目、往来、设置、报表、导出）所有成员都可以。注册新成员只能由本人在登录页完成，你无法代办；成员也无法被删除。

## 审批制（最重要的规则）
- 你没有直接改动数据的权力。所有写操作工具（带【需审批】：记账、批量记账、改 / 删记录、建 / 改项目、新建项目群、往来单位与往来记录的增改删、改设置、生成 AI 报表、导出、整理知识库）调用后只会生成一份「提案」，必须由成员在界面上点击批准后才会真正执行（群里任何成员都能批准，私聊里由本人批准）；系统会以 [系统] 消息告诉你结果。
- 因此调用这些工具时，参数要一次给全、给准；调用后用一句话说明"已提交提案，等待批准"，列出关键内容（金额、币种、项目、经手人、时间），不要说"已记录"。
- 收到 [系统] 消息说提案已批准并执行，才可以说"已完成"；被拒绝就不要再重复提交，除非用户要求。
- 只读工具可直接使用，不需要审批：list_projects、list_entries、get_report、get_ai_report、get_settings、list_members、list_proposals、list_exports、list_parties、party_statement、party_live、search_knowledge、read_knowledge、relay_*。
- 绝不臆造数据，绝不绕过审批。你能做的事就用工具做，做不到的（注册 / 删除成员、批准提案、改别人的记录）明确告诉用户在哪里操作。

## 群聊
- 群聊里每条成员消息都带 [姓名 · 时间] 前缀，注意区分是谁在说话，用对方的名字称呼，按说话人的身份处理请求（经手人默认是说话人本人，权限也按说话人算）。
- 多人同时提需求时分别回应，逐条处理；与你无关的闲聊可以简短回应或不回应。
- 项目群里只处理该项目（环境里会标注）。

## 记账规则
- 「小王付了 300U 广告费」→ 支出 300 USDT，经手人小王，备注「广告费」；「收到客户回款 2000 美金」→ 收入 2000 USD，备注「客户回款」。
- 币种：U / u / USDT / 泰达 = USDT；刀 / 美金 / 美元 / $ = USD；块 / 元 / ¥ / RMB = CNY；未说明默认 CNY。
- 汇率：外币默认用当前设置的汇率；用户说了"按 7.1 算"之类才传 rate。
- 项目：用户没说时，若当前页面正在看某个项目就用它；否则若只有一个进行中的项目就用它；否则先问是哪个项目。项目名允许模糊匹配。
- 时间：默认不传 time（系统记为现在）；用户提到时间时，按下面给出的当前时间换算为带时区的 ISO 8601（如 2026-09-20T15:00:00+08:00），不能晚于现在。
- 金额里的算式先算好再传数字。改 / 删记录前不确定是哪条就先 list_entries 查，把候选列出。
- 付给供应商的钱、收到客户的钱：优先用 add_party_record（kind=paid，会自动同步记入流水并算未付 / 未收）；用户明确只想记流水时才用 add_entry。

## 清空与删除项目
- 「把某个项目删了 / 清空」→ delete_project / clear_project（都需审批）。删除或清空后，那个项目的数据立刻从所有统计、报表、导出和成员资金里消失。执行前先用 list_entries 或 get_report 告诉用户这个项目里有多少数据，确认是他要删的那个。
- 「全部项目」的统计口径 = 未归档项目；归档项目不计入总览 KPI、报表和成员资金，只能在它自己的项目页里查看。

## 成员资金
- 「张贺现在手上还有多少钱 / 沉淀多少」→ member_funds；「张贺给秋明转了 2 万」→ add_transfer（需审批），转出方 from、转入方 to 别搞反；「谁欠谁的 / 转账记录」→ list_transfers。
- 沉淀是按记账时的「经手人」算的，所以帮人记账时一定要把经手人写对（谁真的收的钱 / 谁真的付的钱），否则资金会记到错的人头上。
- 回答金额时人民币折算为主，如果某人手上还有外币（USDT / USD），一并说明各币种余额。

## 往来与中转站
- 记实付 / 实收时一定要问清楚「谁付的 / 谁收的」并传 handler，这笔钱会计入那个人的资金沉淀；应付 / 应收（due）只是挂账，不涉及经手人。
- 「给供应商 X 记今天应付 5000」= add_party_record kind=due；「付给 X 3000」= kind=paid；「客户 Y 今天应收 2 万」= 客户 due；「Y 打款 1 万」= 客户 paid。
- 中转站（Sub2API）的「客户」= 中转站用户账号（邮箱），通过 API Key 调用模型产生「消耗」（美元）；「供应商」= 中转站上游账号。问消耗 / RPM / 余额 / 排行 / 模型 / 趋势 → relay_* 工具；问账本里某家供应商 / 客户的实时数据 → party_live。
- 结算规则：供应商应付 = 上游账号累计标准消耗（美元）× 倍率；客户应收 = 客户累计消耗（美元）× 折扣；按该单位的结算币种（CNY / USDT / USD，用当时汇率换算）自动逐日挂账（往来记录来源 relay，「期初」一条是绑定时以前的累计），每次刷新实时数据都会补齐。未付 / 未收 = 应付 / 应收 − 实付 / 实收；负数就是「待消耗额度 / 预收余额」。回答金额时用该单位的结算币种（如 500.00 USDT），可附人民币折算，不要只给人民币。问"X 还欠多少 / 还剩多少额度"用 party_live 或 list_parties 里的 relay_live。
- 改倍率 / 折扣 / 结算币种（update_party，需审批）会把自动挂账记录按新参数整体重算；自动挂账记录在绑定期间不能删，删了也会补回来。手工记的应付 / 应收（如固定服务费）与自动挂账并存，合计里分开列出。
- 中转站数据是实时的：凡涉及消耗、RPM、余额、供应商未付 / 待消耗额度的问题，每次都重新调用工具取最新数据，不要沿用上一轮的结果。数字如实汇报：消耗用美元（$），tokens 用千分位，实时速率写"当前 X RPM（近 5 分钟均 Y），TPM Z，上限 N"。
- 找不到中转站客户时先用 relay_find_users 按关键词搜，列出候选让用户确认。中转站数据只能查看，不能修改；绑定 / 解绑 / 改倍率用 update_party（需审批）。

## 图片与文件
- 成员发来账单截图、转账记录、Excel / CSV / PDF 报销表时，先逐条读出：时间、项目、类型、金额、币种、经手人（表格里的姓名）、备注。
- 用 add_entries_batch 一次提交全部，每行 handler 写表格里出现的人名（系统自动匹配成员，匹配不到会标记）；看不清或有歧义的行先问，不要猜。
- 提交前用简短表格把识别结果列给用户核对。

## 知识库
- 你有一份由团队资料整理成的知识摘要，以及逐日的操作日志和对话记录（下面会给出最近内容）。回答"我们之前做了什么 / 上次是谁付的 / 那个项目怎么回事"这类问题时，先看给出的摘要与日志，不够就用 search_knowledge / read_knowledge 查，不要凭印象回答。
- 知识库定期需要整理，你可以在合适时机（如成员要求、或系统提示到期）提议 consolidate_knowledge，同样需要审批。

## 回答风格
- 中文、简洁、直接；金额写成 ¥1,234.56、300 USDT；多条数据用 Markdown 表格或列表；不要复述工具返回的 JSON。
- 导出成功的下载链接写成 Markdown 链接。工具报错时用一句话说明并给出下一步。
- 用户问"你能做什么"时，按上面的能力分类简要列出，并说明写操作需要审批。`;

function chatContext(user, ctx) {
  const t = inTZ();
  const projects = q.projects.all().map((p) => `${p.id}｜${p.name}${p.archived ? '（已归档）' : ''}`);
  const members = q.members.all().map((m) => `${m.id}｜${m.username}`);
  const rates = getRates();
  const page = ctx.projectId ? `项目页「${(q.project.get(Number(ctx.projectId)) || {}).name || ''}」（项目 id ${ctx.projectId}）` : ctx.page === 'reports' ? '报表页' : ctx.page === 'me' ? '我的' : '总览';
  const pending = q.pendingProposals.all().map((p) => `#${p.id} ${p.title}（${p.requested_name} 提出）`);
  const off = tzOffsetMinutes(new Date());
  const summary = readSummary();
  const today = readKb('log', t.date), yesterday = readKb('log', addDays(t.date, -1));
  const lockedName = ctx.lockedProject ? (q.project.get(Number(ctx.lockedProject)) || {}).name : '';
  return `## 当前环境
- 对话类型：${ctx.channel === 'group' ? '团队群聊（所有成员可见）' : ctx.lockedProject ? `项目「${lockedName}」的专属群聊（所有成员可见）` : `与 ${user.username} 的私聊`}${ctx.lockedProject ? `
- ⚠️ 本群规则：你只负责项目「${lockedName}」（id ${ctx.lockedProject}）的账目、统计、报表与导出。记账不用问项目，默认就是它；成员提到别的项目时，告诉他们去团队群或对应项目群。查流水、统计、生成 / 导出报表都只针对本项目。` : ''}
- 本轮说话人：${user.username}（id ${user.id}）
- 当前时间：${t.date} ${t.time} ${WEEKDAY_ZH[t.weekday] || t.weekday}，时区 ${TZ}（UTC${off >= 0 ? '+' : '-'}${pad2(Math.abs(off) / 60)}:00）
- 当前汇率：1 USD = ${rates.USD} CNY，1 USDT = ${rates.USDT} CNY
- 说话人正在看的页面：${page}
- 项目（id｜名称）：${projects.join('；') || '（还没有项目）'}
- 成员（id｜名称）：${members.join('；')}
- 待审批提案：${pending.join('；') || '无'}
- 中转站接口：${relayConfigured() ? `已接入（${RELAY.name} ${RELAY.base}），可用 relay_* 工具查客户消耗与实时 RPM` : '未配置，无法查询中转站数据'}

## 知识摘要（summary.md）
${clip(summary, 8000) || '（尚未整理过，可提议 consolidate_knowledge）'}

## 最近操作日志
${clip([yesterday, today].filter(Boolean).join('\n\n'), 6000) || '（最近两天没有操作）'}`;
}

const turnState = new Map();
function shouldReply(channel, text, hasAttachments = false) {
  if (channel !== 'group' || groupAiMode() === 'always') return true;
  return hasAttachments || /@\s*(ai|助手|元启)/i.test(text);
}
function triggerAiTurn(channel, sender, ctx) {
  const st = turnState.get(channel) || { running: false, pending: null, stream: null, triggerId: null, assistantId: null, aborted: false };
  if (st.running) { st.pending = { sender, ctx }; turnState.set(channel, st); return; }
  st.running = true; st.aborted = false; st.stream = null; turnState.set(channel, st);
  aiTurn(channel, sender, ctx, st).catch((e) => console.error('[chat]', e)).finally(() => {
    st.running = false; st.stream = null; st.triggerId = null; st.assistantId = null;
    if (st.pending) { const p = st.pending; st.pending = null; triggerAiTurn(channel, p.sender, p.ctx); }
  });
}
// 撤回：本人 5 分钟内可撤回自己的消息；正在回复中的 AI 会被打断，已生成的回复与提案一并作废
function recallMessage(user, id) {
  const m = q.message.get(Number(id));
  if (!m) throw new HttpError(404, '消息不存在');
  if (m.kind !== 'user' || m.user_id !== user.id) throw new HttpError(403, '只能撤回自己发的消息');
  if (Date.now() - new Date(m.created_at).getTime() > 5 * 60 * 1000) throw new HttpError(400, '发出超过 5 分钟的消息不能撤回');
  const audience = channelAudience(m.channel);
  const cancelled = [];
  q.recallMessage.run(m.id);
  const st = turnState.get(m.channel);
  if (st && st.running && st.triggerId === m.id) {
    st.aborted = true;
    if (st.stream) { try { st.stream.abort(); } catch {} }
  } else {
    for (const n of q.nextMessages.all(m.channel, m.id)) {
      if (n.kind === 'user') break;
      if (n.kind === 'assistant') { q.cancelProposalsOfMessage.run(now(), n.id); q.recallMessage.run(n.id); cancelled.push(n.id); break; }
    }
  }
  kbChat(m.channel, user.username, `（撤回了一条消息${cancelled.length ? '，AI 的回复一并作废' : ''}）`);
  broadcast('recall', { channel: m.channel, ids: [m.id, ...cancelled], by: user.username, byId: user.id }, audience);
  for (const cid of cancelled) for (const p of q.proposalsByMessage.all(cid)) broadcast('proposal', { proposal: proposalView(p) }, audience);
  return { ids: [m.id, ...cancelled] };
}
async function aiTurn(channel, sender, ctx, st) {
  const audience = channelAudience(channel);
  const row = insertMessage(channel, 'assistant', null, '', { parts: [], api: [] });
  st.assistantId = row.id;
  broadcast('ai', { channel, id: row.id, status: 'start' }, audience);
  const parts = [], api = [];
  let emitted = 0; // 本轮已经流式吐给页面的字符数（重试时要撤回）
  const addText = (t) => { const last = parts[parts.length - 1]; if (last && last.type === 'text') last.text += t; else parts.push({ type: 'text', text: t }); };
  const rollbackText = (n) => { let left = n; for (let i = parts.length - 1; i >= 0 && left > 0; i--) { const p = parts[i]; if (p.type !== 'text') break; const cut = Math.min(left, p.text.length); p.text = p.text.slice(0, p.text.length - cut); left -= cut; if (!p.text) parts.splice(i, 1); } };
  const finish = () => {
    if (st.aborted) {
      q.cancelProposalsOfMessage.run(now(), row.id);
      q.recallMessage.run(row.id);
      for (const p of q.proposalsByMessage.all(row.id)) broadcast('proposal', { proposal: proposalView(p) }, audience);
      broadcast('ai', { channel, id: row.id, status: 'done', message: messageView(q.message.get(row.id)) }, audience);
      return;
    }
    const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    q.updateMessage.run(text, JSON.stringify(parts), JSON.stringify(sanitizeHistory(api)), row.id);
    kbChat(channel, 'AI 助手', [text, ...parts.filter((p) => p.type === 'tool').map((p) => `（${p.error ? '失败' : '动作'}：${p.summary}）`)].filter(Boolean).join('\n'));
    broadcast('ai', { channel, id: row.id, status: 'done', message: messageView(q.message.get(row.id)) }, audience);
  };
  try {
    if (!anthropic) throw new HttpError(400, '未配置 AI 接口');
    const lastUser = q.recentMessages.all(channel, 5).find((m) => m.kind === 'user' && m.user_id === sender.id);
    st.triggerId = lastUser ? lastUser.id : null;
    const messages = await buildHistory(channel, lastUser ? lastUser.id : -1);
    if (!messages.length) throw new HttpError(400, '没有可回复的消息');
    const lockedProject = channelProject(channel);
    const system = `${CHAT_SYSTEM}\n\n${chatContext(sender, { ...ctx, channel, lockedProject, projectId: lockedProject || ctx.projectId })}`;
    for (let turn = 0; turn < CHAT_MAX_TURNS; turn++) {
      if (st.aborted) break;
      const msg = await withAiRetry('对话', async (attempt) => {
        // 重试前把上一次流里已经吐出来的半截文字撤掉，避免重复
        if (attempt > 0 && emitted) { rollbackText(emitted); emitted = 0; broadcast('ai', { channel, id: row.id, status: 'reset', text: parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n') }, audience); }
        const stream = anthropic.messages.stream({ model: aiModel(), max_tokens: maxTokensFor(aiModel()), system, tools: ALL_TOOLS(), messages });
        st.stream = stream;
        stream.on('text', (delta) => { emitted += delta.length; addText(delta); broadcast('ai', { channel, id: row.id, status: 'delta', delta }, audience); });
        const m = await stream.finalMessage();
        if (st.aborted) return m;
        // 空回复（中转站上游抽风时会这样）也当成可重试的故障
        const blocks = stripThinking(m.content);
        // 思考占满了额度、一个字都没吐出来：换更大的长度上限重试
        if (!blocks.some((b) => (b.type === 'text' && b.text.trim()) || b.type === 'tool_use') && m.stop_reason !== 'refusal') throw new Error(m.stop_reason === 'max_tokens' ? '回答被截断（长度上限）' : '模型没有返回内容');
        return m;
      });
      if (st.aborted) break;
      const content = stripThinking(msg.content);
      if (msg.content.length) messages.push({ role: 'assistant', content: msg.content });
      if (content.length) api.push({ role: 'assistant', content });
      if (msg.stop_reason === 'refusal') { addText('\n（模型拒绝了这个请求）'); break; }
      if (msg.stop_reason === 'max_tokens') { addText('\n\n（回答太长被截断了，可以让我分几次说，或者说「接着上面继续」）'); break; }
      const uses = content.filter((b) => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !uses.length) break;
      const results = [];
      for (const u of uses) {
        if (st.aborted) break;
        const part = { type: 'tool', id: u.id, name: u.name, label: TOOL_LABEL[u.name] || u.name, status: 'start' };
        parts.push(part);
        broadcast('ai', { channel, id: row.id, status: 'tool', tool: part }, audience);
        let out;
        try {
          const tctx = { user: sender, channel, page: ctx.page, projectId: lockedProject || ctx.projectId, lockedProject };
          if (GATED.has(u.name)) {
            const prepared = GATED_IMPL[u.name].prepare(u.input || {}, tctx);
            const p = createProposal(channel, row.id, u.name, prepared, sender);
            out = { pending: true, proposal_id: p.id, title: p.title, detail: p.detail, summary: `已生成提案 #${p.id}「${p.title}」，等待成员批准后执行` };
            part.proposal_id = p.id;
          } else if (RELAY_TOOL_NAMES.has(u.name)) out = await runRelayTool(u.name, u.input || {});
          else if (u.name === 'party_live') {
            const { party: pa } = resolvePartyAnywhere(u.input || {}, tctx);
            const live = await partyLive(pa); const L = PARTY_LABEL[pa.kind];
            const st = live.settlement, C = st.currency;
            const money = (n) => `${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${C}`;
            out = !live.linked ? { error: `${L.name}「${pa.name}」还没有绑定中转站（在项目页打开它点「一键获取」）` } : live.error ? { error: live.error } : { ...live, summary: pa.kind === 'customer'
              ? `客户「${pa.name}」：中转站累计消耗 ${usd(st.consumption_usd)} × 折扣 ${st.ratio} = 应收 ${money(st.consumption_x_ratio)}（记录合计应收 ${money(st.due)}），实收 ${money(st.paid)}，${st.open > 0 ? `未收 ${money(st.open)}` : `预收余额 ${money(st.credit)}`}；今日消耗 ${usd(live.today.cost_usd)}${live.live ? `，当前 ${live.live.rpm_now} RPM / ${live.live.tpm_now.toLocaleString()} TPM` : ''}${live.user && live.user.balance_usd !== undefined ? `，中转站余额 ${usd(live.user.balance_usd)}` : ''}`
              : `供应商「${pa.name}」：中转站累计消耗 ${usd(st.consumption_usd)} × 倍率 ${st.ratio} = 应付 ${money(st.consumption_x_ratio)}（记录合计应付 ${money(st.due)}），已付 ${money(st.paid)}，${st.open > 0 ? `未付 ${money(st.open)}` : `待消耗额度 ${money(st.credit)}`}；今日消耗 ${live.today.std_cost_usd !== null ? usd(live.today.std_cost_usd) : '未知'}${live.live ? `，当前 ${live.live.rpm_now} RPM` : ''}，账号状态 ${live.account.status || '未知'}` };
          } else out = await runReadTool(u.name, u.input || {}, tctx);
        } catch (e) { out = { error: e instanceof HttpError ? e.message : (e.message || '操作失败') }; if (!(e instanceof HttpError)) console.error('[chat tool]', u.name, e); }
        Object.assign(part, { status: 'done', summary: out.error || out.summary || '完成', error: !!out.error, links: out.links || [] });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), is_error: !!out.error });
        broadcast('ai', { channel, id: row.id, status: 'tool', tool: part }, audience);
      }
      messages.push({ role: 'user', content: results });
      api.push({ role: 'user', content: results });
    }
  } catch (e) {
    if (st.aborted) { finish(); return; }
    const msg = aiErrorMessage(e);
    console.error('[chat]', e.message || e);
    // 去掉结尾没有拿到工具结果的 assistant 消息，避免历史格式不合法
    while (api.length && api[api.length - 1].role === 'assistant' && api[api.length - 1].content.some((b) => b.type === 'tool_use')) api.pop();
    addText(`\n⚠️ ${msg}`);
  }
  finish();
}

// ---------------------------------------------------------------- app
const BUILD_ID = (() => { try { return String(Math.max(...fs.readdirSync(PUBLIC_DIR).map((f) => Math.floor(fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs)))); } catch { return String(Date.now()); } })();
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.setHeader('X-App-Build', BUILD_ID); next(); });
app.set('trust proxy', process.env.TRUST_PROXY === '0' ? false : 1);
app.use(express.json({ limit: '60mb' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- 认证
app.post('/api/auth/register', limit, (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const phone = normPhone(body.phone);
  const password = String(body.password || '');
  if (!RE_USERNAME.test(username)) return fail(res, 400, '用户名为 2–20 位中文、字母、数字或下划线');
  if (!RE_PHONE.test(phone)) return fail(res, 400, '手机号格式不正确');
  if (password.length < 6 || password.length > 72) return fail(res, 400, '密码至少 6 位');
  if (q.userByName.get(username)) return fail(res, 409, '用户名已被使用');
  if (q.userByPhone.get(phone)) return fail(res, 409, '手机号已注册');
  const r = q.insertUser.run(username, phone, hashPassword(password), now());
  const uid = Number(r.lastInsertRowid);
  setSession(req, res, uid);
  kbLog(`${username} 注册加入团队`);
  broadcast('members', { version: ++dataVersion });
  postSystemMessage('group', `${username} 加入了团队`);
  res.json(bootstrap(uid));
});
app.post('/api/auth/login', limit, (req, res) => {
  const body = req.body || {};
  const account = String(body.account || '').trim();
  const password = String(body.password || '');
  const user = account && q.userByAccount.get(account, normPhone(account));
  if (!user || !checkPassword(password, user.password_hash)) return fail(res, 401, '账号或密码不正确');
  setSession(req, res, user.id);
  res.json(bootstrap(user.id));
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(bootstrap(req.user.id)));

// ---- 实时事件流
app.get('/api/events', auth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ version: dataVersion, running: [...running.keys()], build: BUILD_ID })}\n\n`);
  const client = { res, uid: req.user.id };
  clients.add(client);
  req.on('close', () => clients.delete(client));
});

// ---- 设置
app.get('/api/settings', auth, (req, res) => res.json({ rates: getRates(), ai: aiInfo(), auto_export: getAutoExport(), integration_token: integrationToken() }));
app.put('/api/settings', auth, (req, res) => {
  const body = req.body || {};
  const out = ops.updateSettings(req.user, body);
  if (body.rotate_token) { const t = `yq_${crypto.randomBytes(24).toString('hex')}`; q.putSetting.run('integration_token', t); kbLog(`${req.user.username} 重置了对外接口令牌`); }
  res.json({ ...out, integration_token: integrationToken() });
});

// ---- 项目
app.get('/api/projects', auth, (req, res) => {
  const rates = getRates();
  const byProject = new Map();
  for (const e of q.allEntries.all()) { if (!byProject.has(e.project_id)) byProject.set(e.project_id, []); byProject.get(e.project_id).push(e); }
  const list = q.projects.all().map((p) => ({ ...p, summary: summarize(byProject.get(p.id) || [], rates) }));
  list.sort((a, b) => (a.archived - b.archived) || String(b.summary.last_at || b.created_at).localeCompare(String(a.summary.last_at || a.created_at)));
  const activeEntries = list.filter((p) => !p.archived).flatMap((p) => byProject.get(p.id) || []);
  res.json({ projects: list, totals: summarize(activeEntries, rates), funds: memberFunds(null), rates, version: dataVersion });
});
app.post('/api/projects', auth, (req, res) => res.json({ project: ops.createProject(req.user, req.body || {}) }));
app.patch('/api/projects/:id', auth, (req, res) => res.json({ project: ops.updateProject(req.user, req.params.id, req.body || {}) }));
app.get('/api/projects/:id', auth, (req, res) => {
  const p = q.project.get(Number(req.params.id));
  if (!p) return fail(res, 404, '项目不存在');
  const rates = getRates();
  const entries = q.projectEntries.all(p.id).map((e) => ({ ...e, base: r2(entryBase(e, rates)), images: entryImages(e) }));
  const byMember = new Map();
  for (const e of entries) {
    let m = byMember.get(e.handler_id);
    if (!m) { m = { id: e.handler_id, name: e.handler_name, expense: 0, income: 0, count: 0 }; byMember.set(e.handler_id, m); }
    m[e.type] += e.base; m.count += 1;
  }
  const members = [...byMember.values()].map((m) => ({ ...m, expense: r2(m.expense), income: r2(m.income) })).sort((a, b) => b.expense - a.expense || b.income - a.income);
  res.json({ project: p, summary: summarize(q.projectEntries.all(p.id), rates), members, entries, rates, parties: projectPartiesSummary(p.id), funds: memberFunds(p.id), version: dataVersion });
});

app.delete('/api/projects/:id', auth, (req, res) => res.json(ops.deleteProject(req.user, req.params.id)));
app.post('/api/projects/:id/clear', auth, (req, res) => res.json(ops.clearProject(req.user, req.params.id)));

// ---- 流水
app.post('/api/projects/:id/entries', auth, (req, res) => res.json({ entry: ops.addEntry(req.user, { ...(req.body || {}), project_id: req.params.id }) }));
app.patch('/api/entries/:id', auth, (req, res) => res.json({ entry: ops.updateEntry(req.user, req.params.id, req.body || {}) }));
app.delete('/api/entries/:id', auth, (req, res) => { ops.deleteEntry(req.user, req.params.id); res.json({ ok: true }); });

// ---- 成员资金沉淀与成员间转账
app.get('/api/funds', auth, (req, res) => {
  const scope = !req.query.project || req.query.project === 'all' ? null : Number(req.query.project);
  if (scope !== null && !q.project.get(scope)) return fail(res, 404, '项目不存在');
  const d = memberFunds(scope, { includeZero: req.query.all === '1' });
  res.json({ scope: scope || 'all', project: scope ? q.project.get(scope) : null, ...d, version: dataVersion });
});
app.post('/api/transfers', auth, (req, res) => res.json({ transfer: transferView(ops.addTransfer(req.user, req.body || {})) }));
app.patch('/api/transfers/:id', auth, (req, res) => res.json({ transfer: transferView(ops.updateTransfer(req.user, req.params.id, req.body || {})) }));
app.delete('/api/transfers/:id', auth, (req, res) => { ops.deleteTransfer(req.user, req.params.id); res.json({ ok: true }); });

// ---- 往来：供应商 / 客户
app.get('/api/projects/:id/parties', auth, (req, res) => {
  if (!q.project.get(Number(req.params.id))) return fail(res, 404, '项目不存在');
  res.json(projectPartiesSummary(Number(req.params.id)));
});
app.post('/api/projects/:id/parties', auth, (req, res) => res.json({ party: partyView(ops.addParty(req.user, req.params.id, req.body || {})) }));
app.get('/api/parties/:id', auth, (req, res) => {
  const pa = q.party.get(Number(req.params.id));
  if (!pa) return fail(res, 404, '往来单位不存在');
  const records = q.recordsWithCreator.all(pa.id);
  res.json({ party: partyView(pa, records), records: records.map(recordView), labels: PARTY_LABEL[pa.kind], relay_configured: relayConfigured() });
});
app.patch('/api/parties/:id', auth, (req, res) => res.json({ party: partyView(ops.updateParty(req.user, req.params.id, req.body || {})) }));
app.post('/api/parties/:id/relay-link', auth, async (req, res, next) => { try { const b = req.body || {}; res.json({ live: await linkPartyRelay(req.user, req.params.id, b.ref, { ratio: b.ratio, currency: b.currency }) }); } catch (e) { next(e); } });
app.delete('/api/parties/:id/relay-link', auth, (req, res) => {
  const pa = q.party.get(Number(req.params.id));
  if (!pa) return fail(res, 404, '往来单位不存在');
  q.linkParty.run(null, '', pa.id);
  dataChanged(req.user, `解除了${PARTY_LABEL[pa.kind].name}「${pa.name}」与中转站的绑定 · ${pa.project_name}`);
  res.json({ ok: true });
});
app.get('/api/parties/:id/relay', auth, async (req, res, next) => {
  try { const pa = q.party.get(Number(req.params.id)); if (!pa) return fail(res, 404, '往来单位不存在'); res.json({ live: await partyLive(pa) }); } catch (e) { next(e); }
});
app.get('/api/projects/:id/relay', auth, async (req, res, next) => {
  try { if (!q.project.get(Number(req.params.id))) return fail(res, 404, '项目不存在'); res.json(await projectRelayLive(Number(req.params.id))); } catch (e) { next(e); }
});
app.get('/api/relay/search', auth, async (req, res, next) => {
  try {
    if (!relayConfigured()) return fail(res, 400, '未配置中转站接口');
    const qs = String(req.query.q || '').trim();
    if (req.query.kind === 'supplier') { const d = await relayGet('/admin/accounts', { page: 1, page_size: 50, search: qs }); return res.json({ items: (d.items || []).map(relayAccountView) }); }
    const d = await relayGet('/admin/users', { page: 1, page_size: 20, search: qs });
    res.json({ items: (d.items || []).map(relayUserView) });
  } catch (e) { next(e); }
});
app.delete('/api/parties/:id', auth, (req, res) => { ops.deleteParty(req.user, req.params.id); res.json({ ok: true }); });
app.post('/api/parties/:id/records', auth, (req, res) => { const r = ops.addPartyRecord(req.user, req.params.id, req.body || {}); res.json({ record: recordView(r.record), duplicate: r.duplicate }); });
partyWallets = setupPartyWallets({ app, db, auth, HttpError, onChanged: (user, text) => dataChanged(user, text) });
app.delete('/api/party-records/:id', auth, (req, res) => { ops.deletePartyRecord(req.user, req.params.id); res.json({ ok: true }); });

// ---- 对外接口（外部系统实时同步应收 / 应付），用 X-API-Key 鉴权
function integrationAuth(req, res, next) {
  const key = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = getSetting('integration_token', '');
  if (!token || !key || key.length !== token.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(token))) return fail(res, 401, 'API 令牌无效');
  req.user = q.userById.get(1) || q.members.all()[0];
  if (!req.user) return fail(res, 500, '系统还没有成员');
  req.user = { ...req.user, username: '外部接口' };
  next();
}
app.get('/api/integrations/parties', integrationAuth, (req, res) => {
  const p = req.query.project ? resolveProject(req.query.project, {}) : null;
  const projects = p ? [p] : q.projects.all();
  res.json({ projects: projects.map((x) => ({ id: x.id, name: x.name, ...projectPartiesSummary(x.id) })) });
});
// 单条或数组：{ project, party 或 customer / supplier, kind: due|paid, amount, currency?, rate?, date?, note?, external_ref? , link_entry? }
app.post('/api/integrations/records', integrationAuth, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body || {}];
  if (!items.length || items.length > 500) return fail(res, 400, '一次 1–500 条');
  const results = [];
  for (const it of items) {
    try {
      const p = resolveProject(it.project, {});
      const kind = it.supplier ? 'supplier' : it.customer ? 'customer' : (it.party_kind === 'supplier' ? 'supplier' : 'customer');
      const nameRef = String(it.supplier || it.customer || it.party || '').trim();
      if (!nameRef) throw new HttpError(400, '缺少 customer / supplier 名称');
      let pa = q.partyByName.get(p.id, kind, nameRef, nameRef);
      if (!pa) pa = q.party.get(ops.addParty(req.user, p.id, { kind, name: nameRef, external_id: it.external_id || '', currency: it.currency || 'CNY' }, '外部接口：').id);
      const r = ops.addPartyRecord(req.user, pa.id, { ...it, source: 'api' }, '外部接口：');
      results.push({ ok: true, duplicate: r.duplicate, record: recordView(r.record), party: { id: pa.id, name: pa.name, kind } });
    } catch (e) { results.push({ ok: false, error: e instanceof HttpError ? e.message : (e.message || '失败'), input: it }); }
  }
  res.json({ results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

// ---- 报表 / 导出
app.get('/api/report', auth, (req, res) => {
  const params = normalizeReportParams(req.query);
  const report = buildReport(params);
  const ai = reportStatus(params, report);
  const { entries, ...rest } = report;
  res.json({ ...rest, entryCount: entries.length, ai: { ...ai, configured: !!anthropic, model: aiModel(), auto: aiAuto() }, version: dataVersion });
});
app.post('/api/report/ai', auth, (req, res) => {
  const params = normalizeReportParams(req.body || {});
  const job = generateReport(params, { force: !!(req.body || {}).force, by: req.user.username });
  res.json({ key: job.key, status: job.fresh ? 'done' : 'running' });
});
app.get('/api/report/ai.md', auth, (req, res) => {
  const params = normalizeReportParams(req.query);
  const row = q.report.get(reportKey(params));
  if (!row || !row.content) return fail(res, 404, '还没有生成这个范围的 AI 报表');
  const name = `元启-AI财务报表-${params.scope === 'all' ? '全部项目' : `项目${params.scope}`}-${row.from_date}~${row.to_date}.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="report.md"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(`${row.content}\n\n---\n由 ${row.model} 生成于 ${fmtTZ(row.generated_at)}\n`);
});
app.get('/api/export.xlsx', auth, async (req, res, next) => {
  try {
    const report = buildReport(normalizeReportParams(req.query));
    const buf = await (await buildWorkbook(report)).xlsx.writeBuffer();
    const name = `元启-${report.project ? report.project.name : '全部项目'}-${report.from}~${report.to}.xlsx`;
    kbLog(`${req.user.username} 下载了 Excel：${name}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(buf));
  } catch (e) { next(e); }
});
app.get('/api/exports', auth, (req, res) => res.json({ exports: q.exportsList.all().map((x) => ({ ...x, url: `/api/exports/${x.id}/download` })), auto_export: getAutoExport() }));
app.post('/api/exports', auth, async (req, res, next) => {
  try { res.json({ exports: await runExport(req.body || {}, { source: 'manual', user: req.user, format: (req.body || {}).format || 'xlsx' }) }); } catch (e) { next(e); }
});
app.get('/api/exports/:id/download', auth, (req, res) => {
  const x = q.exportById.get(Number(req.params.id));
  if (!x) return fail(res, 404, '导出文件不存在');
  const file = path.join(EXPORT_DIR, path.basename(x.file));
  if (!fs.existsSync(file)) return fail(res, 404, '文件已被清理');
  res.setHeader('Content-Type', x.format === 'md' ? 'text/markdown; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="export.${x.format}"; filename*=UTF-8''${encodeURIComponent(x.name)}`);
  res.sendFile(file);
});
app.delete('/api/exports/:id', auth, (req, res) => {
  const x = q.exportById.get(Number(req.params.id));
  if (!x) return fail(res, 404, '导出文件不存在');
  try { fs.unlinkSync(path.join(EXPORT_DIR, path.basename(x.file))); } catch {}
  q.deleteExport.run(x.id);
  kbLog(`${req.user.username} 删除了导出文件：${x.name}`);
  broadcast('exports', { source: 'delete', by: req.user.username, names: [] });
  res.json({ ok: true });
});

// ---- 知识库
app.get('/api/knowledge', auth, (req, res) => res.json({ ...kbInfo(), summary: readSummary() }));
app.get('/api/knowledge/file', auth, (req, res) => {
  const kind = req.query.kind === 'chat' ? 'chat' : 'log';
  const content = readKb(kind, req.query.date);
  if (!content) return fail(res, 404, '没有这一天的记录');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-${req.query.date}.md"`);
  res.send(content);
});
app.get('/api/knowledge/summary.md', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="summary.md"; filename*=UTF-8''${encodeURIComponent('元启-知识摘要.md')}`);
  res.send(readSummary() || '（尚未整理）');
});
app.post('/api/knowledge/consolidate', auth, async (req, res, next) => {
  try { res.json(await consolidateKnowledge(req.user, `${req.user.username}（页面手动）：`)); }
  catch (e) { next(e instanceof HttpError ? e : new HttpError(502, aiErrorMessage(e))); }
});

// ---- 附件
app.post('/api/attachments', auth, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || 'file').replace(/[\\/]/g, '_').slice(0, 120);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mime = String(body.mime || MIME_BY_EXT[ext] || 'application/octet-stream');
  const data = Buffer.from(String(body.data || ''), 'base64');
  if (!data.length) return fail(res, 400, '文件为空');
  if (data.length > 20 * 1024 * 1024) return fail(res, 400, '文件不能超过 20MB');
  const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName(name)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), data);
  const r = q.insertAttachment.run(file, name, mime, data.length, req.user.id, now());
  res.json({ attachment: attachmentView(q.attachment.get(Number(r.lastInsertRowid))) });
});
app.get('/api/attachments/:id', auth, (req, res) => {
  const a = q.attachment.get(Number(req.params.id));
  if (!a) return fail(res, 404, '附件不存在');
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `${IMAGE_MIME.test(a.mime) ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  res.sendFile(path.join(UPLOAD_DIR, path.basename(a.file)));
});

// ---- 群聊 / 私聊
app.get('/api/chat', auth, (req, res) => {
  const channel = channelFor(req.query.channel, req.user);
  const before = Number(req.query.before) || 0;
  const rows = (before ? q.messagesBefore.all(channel, before, 50) : q.recentMessages.all(channel, 50)).reverse();
  const st = turnState.get(channel);
  res.json({ channel, messages: rows.map(messageView), busy: !!(st && st.running), ai: aiInfo(), pending: q.pendingProposals.all().filter((p) => p.channel === channel).map(proposalView), channels: channelList() });
});
app.post('/api/chat', auth, (req, res) => {
  const body = req.body || {};
  const channel = channelFor(body.channel, req.user);
  const text = String(body.message || '').trim().slice(0, 4000);
  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).map(Number).filter((id) => q.attachment.get(id)).slice(0, 10);
  if (!text && !attachments.length) return fail(res, 400, '请输入内容或添加附件');
  const row = insertMessage(channel, 'user', req.user, text, { attachments });
  const view = { ...messageView(row), attachments: attachments.map((id) => attachmentView(q.attachment.get(id))) };
  kbChat(channel, req.user.username, `${text}${attachments.length ? `\n（附件：${view.attachments.map((a) => a.name).join('、')}）` : ''}`);
  broadcast('msg', { channel, message: view }, channelAudience(channel));
  const reply = !!anthropic && shouldReply(channel, text, attachments.length > 0);
  if (reply) triggerAiTurn(channel, req.user, { page: String(body.page || ''), projectId: body.projectId ? Number(body.projectId) : null });
  res.json({ message: view, reply });
});
app.post('/api/chat/:id/recall', auth, (req, res) => res.json(recallMessage(req.user, req.params.id)));
app.delete('/api/chat', auth, (req, res) => {
  const channel = channelFor(req.query.channel, req.user);
  if (!channel.startsWith('dm:')) return fail(res, 403, '群聊记录是团队共同的存档，不能清空（知识库里也有备份）');
  q.clearChannel.run(channel);
  res.json({ ok: true });
});
app.get('/api/channels', auth, (req, res) => res.json({ channels: channelList() }));
app.post('/api/channels', auth, (req, res) => {
  const p = q.project.get(Number((req.body || {}).project_id));
  if (!p) return fail(res, 404, '项目不存在');
  const key = `project:${p.id}`;
  if (q.channel.get(key)) return res.json({ channel: key, existed: true });
  q.insertChannel.run(key, p.name, p.id, req.user.id, now());
  kbLog(`${req.user.username} 新建了项目群「${p.name}」`);
  postSystemMessage(key, `${req.user.username} 创建了项目「${p.name}」的群聊。这里的 AI 只负责本项目的账目。`);
  broadcast('channels', { channels: channelList(), by: req.user.username, created: key });
  res.json({ channel: key, existed: false });
});
app.get('/api/proposals', auth, (req, res) => res.json({ proposals: q.pendingProposals.all().map(proposalView) }));
app.post('/api/proposals/:id/:action', auth, async (req, res, next) => {
  try {
    if (!['approve', 'reject'].includes(req.params.action)) return fail(res, 400, '未知操作');
    res.json({ proposal: proposalView(await decideProposal(req.params.id, req.user, req.params.action === 'approve')) });
  } catch (e) { next(e); }
});

// ---- 前端入口（单页应用）
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return fail(res, 404, '接口不存在');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return fail(res, err.status, err.message);
  if (err.type === 'entity.parse.failed') return fail(res, 400, '请求格式错误');
  if (err.type === 'entity.too.large') return fail(res, 413, '文件太大');
  console.error(err);
  fail(res, err.status || 500, '服务器开小差了，请稍后再试');
});

app.listen(PORT, () => {
  console.log(`元启智能账单系统已启动  http://localhost:${PORT}   数据目录 ${DATA_DIR}`);
  console.log(anthropic ? `AI 已接入：${aiModel()} @ ${AI.baseURL || 'api.anthropic.com'}` : 'AI 未配置（在 .env 中设置 ANTHROPIC_AUTH_TOKEN 后启用）');
  console.log(relayConfigured() ? `中转站已接入：${RELAY.name} @ ${RELAY.base}` : '中转站未配置（RELAY_BASE_URL / RELAY_ADMIN_KEY）');
});
