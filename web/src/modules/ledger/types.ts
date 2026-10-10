export type Currency = "CNY" | "USDT" | "USD";
export type EntryType = "expense" | "income";
export type PartyKind = "supplier" | "customer";

export type Rates = { USD: number; USDT: number };

export type Member = { id: number; username: string; phone: string; created_at: string };

export type AiInfo = {
  configured: boolean;
  model: string;
  models: { id: string; name: string }[];
  auto: boolean;
  group_mode: "mention" | "always";
  relay: { name: string; base: string } | null;
};

export type AutoExport = { enabled: boolean; time: string; scope: string; range: string };

export type Me = {
  user: Member;
  members: Member[];
  rates: Rates;
  ai: AiInfo;
  auto_export: AutoExport;
  tz: string;
  integration_token: string;
};

export type CurAmounts = { CNY: number; USDT: number; USD: number; base: number };
export type Summary = {
  income: CurAmounts;
  expense: CurAmounts;
  profit: number;
  count: number;
  last_at: string | null;
};

export type Project = {
  id: number;
  name: string;
  note: string;
  created_by: number;
  archived: number | boolean;
  created_at: string;
  creator_name: string;
};
export type ProjectWithSummary = Project & { summary: Summary };

type CurTriple = { CNY: number; USDT: number; USD: number };
export type FundMember = {
  id: number;
  name: string;
  income: number;
  expense: number;
  in: number;
  out: number;
  balance: number;
  entry_count: number;
  transfer_count: number;
  cur: { income: CurTriple; expense: CurTriple; in: CurTriple; out: CurTriple; balance: CurTriple };
  last_at: string | null;
};
export type Transfer = {
  id: number;
  time: string;
  created_at: string;
  project_id: number | null;
  project: string | null;
  from_id: number;
  from: string;
  to_id: number;
  to: string;
  amount: number;
  currency: Currency;
  rate: number;
  cny: number;
  note: string;
  creator: string;
  created_by: number;
};
export type Funds = {
  members: FundMember[];
  totals: { income: number; expense: number; in: number; out: number; balance: number };
  transfers: Transfer[];
};

export type ProjectsResponse = {
  projects: ProjectWithSummary[];
  totals: Summary;
  funds: Funds;
  rates: Rates;
};

export type Entry = {
  id: number;
  project_id: number;
  type: EntryType;
  amount: number;
  currency: Currency;
  handler_id: number;
  created_by: number;
  note: string;
  created_at: string;
  rate: number | null;
  project_name: string;
  handler_name: string;
  creator_name: string;
  base: number;
  images: Attachment[];
  party_id: number | null;
  party_name: string;
};

export type Settle = {
  currency: Currency;
  due: number;
  paid: number;
  open: number;
  credit: number;
  due_cny: number;
  paid_cny: number;
  open_cny: number;
  relay_due: number;
  manual_due: number;
};
export type Party = {
  id: number;
  project_id: number;
  project_name?: string;
  kind: PartyKind;
  name: string;
  contact: string;
  note: string;
  currency: Currency;
  external_id: string;
  archived: boolean;
  created_at: string;
  ratio: number;
  relay: { id: number; ref: string } | null;
  totals: { due: number; paid: number; open: number; count: number; last_at: string | null };
  settle: Settle;
  // 供应商余额汇总（只有绑定了 new-api / sub2api Key 的供应商才有）
  wallet?: { count: number; actual: number | null; used: number | null; errors: number } | null;
  settled_base?: number;
  settle_type?: "prepaid" | "credit";
  // 供应商结算：应付（消费折结算币种）/ 已结算（期初+充值支出）/ 未结算
  recharge?: {
    currency: Currency;
    payable: number;
    settled: number;
    settled_base: number;
    from_entries: number;
    paid_out?: number;
    refunded?: number;
    entry_count: number;
    unsettled: number;
  } | null;
};

// 供应商余额：我们在供应商站点（new-api / sub2api）的 Key 对应的钱包额度与倍率
export type PartyWallet = {
  id: number;
  party_id: number;
  name: string;
  platform: "newapi" | "sub2api";
  base_url: string;
  custom: boolean;
  custom_ratio: number | null;
  enabled: boolean;
  has_key: boolean;
  key_masked: string;
  last_wallet: number | null;
  last_wallet_kind: "" | "wallet" | "token" | "quota" | "subscription" | "login";
  login_user: string;
  has_login?: boolean;
  token_user_id: string;
  has_token?: boolean;
  auth_mode?: "token" | "login" | "key";
  insecure: boolean;
  last_ratio: number | null;
  last_ratio_source: string;
  last_actual: number | null;
  // 这把 Key 在供应商站点的累计消费；自定义倍率时 last_used_actual = 累计消费 × 倍率
  last_used: number | null;
  last_used_actual: number | null;
  last_error: string;
  last_checked_at: string | null;
};
// 供应商详情：资金往来（双向）+ 每把 Key 在站点的分组 / 每组消耗 / 每日消耗
export type FundEntry = {
  id: number;
  time: string;
  type: EntryType;
  amount: number;
  currency: Currency;
  rate: number | null;
  cny: number;
  in_cur: number;
  project_id: number;
  project_name: string;
  note: string;
  handler: string;
};
export type WalletGroup = { name: string; ratio: number | null; desc: string; model_count: number; types: string[] };
export type ConsumePoint = { date: string; usd: number; count: number };
export type ConsumeGroup = { group: string; usd: number; count: number; tokens: number };
export type ConsumeModel = { model: string; usd: number; count: number; tokens: number };
export type WalletDetail = {
  id: number;
  name: string;
  platform: "newapi" | "sub2api";
  base_url: string;
  custom: boolean;
  ratio: number | null;
  last_wallet: number | null;
  last_used: number | null;
  last_used_actual: number | null;
  last_actual: number | null;
  has_token: boolean;
  ok: boolean;
  error?: string;
  groups?: WalletGroup[];
  byGroup?: ConsumeGroup[];
  byModel?: ConsumeModel[];
  daily?: ConsumePoint[];
  groupDaily?: Record<string, ConsumePoint[]>;
  period_days?: number | null;
  period_used?: number | null;
  note?: string;
};
export type SupplierDetail = {
  party: Party;
  funds: { currency: Currency; out: number; income: number; net: number; entries: FundEntry[] };
  wallets: WalletDetail[];
  rates: Rates;
};

export type PartiesSummary = {
  suppliers: Party[];
  customers: Party[];
  totals: Record<PartyKind, { due: number; paid: number; open: number }>;
  daily: { date: string; payable: number; paid: number; receivable: number; received: number; count: number }[];
};

export type ProjectDetail = {
  project: Project;
  summary: Summary;
  members: { id: number; name: string; expense: number; income: number; count: number }[];
  entries: Entry[];
  rates: Rates;
  parties: PartiesSummary;
  funds: Funds;
};

export type PartyRecord = {
  id: number;
  party_id: number;
  kind: "due" | "paid";
  amount: number;
  currency: Currency;
  rate: number;
  cny: number;
  date: string;
  note: string;
  source: string;
  external_ref: string | null;
  entry_id: number | null;
  created_at: string;
  creator_name: string;
};
export type PartyDetail = {
  party: Party;
  records: PartyRecord[];
  labels: { name: string; due: string; paid: string; open: string };
  relay_configured: boolean;
};

export type Settlement = Settle & {
  ratio: number;
  ratio_label: string;
  consumption_usd: number;
  consumption_x_ratio: number;
  today: number | null;
  this_hour: number | null;
  usd_rate: number;
  cur_rate: number;
};
export type RelayLive = {
  party_id: number;
  linked: boolean;
  error?: string;
  fetched_at?: string;
  settlement: Settlement;
  user?: { status?: string; balance_usd?: number; rpm_limit?: number };
  account?: {
    status?: string;
    error?: string;
    current_concurrency?: number;
    concurrency_limit?: number;
    platform?: string;
    last_used_at?: string;
    temp_unschedulable?: string;
  };
  today?: { requests?: number | null };
  hourly?: { hour: string; requests: number; cost_usd: number; std_cost_usd: number }[];
  live?: {
    rpm_now: number;
    rpm_5m_avg: number;
    tpm_now: number;
    last_request_at: string | null;
    models_5m: Record<string, number>;
  } | null;
};
export type ProjectRelay = { fetched_at: string; relay: { name: string } | null; parties: Record<string, RelayLive> };

export type DailyPoint = {
  date: string;
  income: number;
  expense: number;
  count: number;
  profit: number;
  cumulative: number;
};
export type TopEntry = {
  id: number;
  time: string;
  amount: number;
  currency: Currency;
  rate: number;
  cny: number;
  handler: string;
  project: string;
  note: string;
};
export type ReportAi = {
  key: string;
  status: "none" | "running" | "done" | "error";
  content: string;
  generated_at: string | null;
  model: string;
  error: string;
  stale: boolean;
  configured: boolean;
  auto: boolean;
};
export type Report = {
  scope: string;
  range: string;
  label: string;
  project: { id: number; name: string; note: string; archived: number } | null;
  from: string;
  to: string;
  days: number;
  prevFrom: string;
  prevTo: string;
  kpis: Summary;
  prev: Summary;
  daily: DailyPoint[];
  byProject: {
    id: number;
    name: string;
    archived: number;
    income: number;
    expense: number;
    count: number;
    profit: number;
  }[];
  byMember: { id: number; name: string; income: number; expense: number; count: number; profit: number }[];
  entryCount: number;
  analysis: {
    byNote: {
      expense: { note: string; cny: number; count: number }[];
      income: { note: string; cny: number; count: number }[];
    };
    byCurrency: {
      currency: Currency;
      income: number;
      incomeCny: number;
      expense: number;
      expenseCny: number;
      count: number;
    }[];
    top: { expense: TopEntry[]; income: TopEntry[] };
    monthly: { month: string; income: number; expense: number; count: number; profit: number }[];
  };
  ai: ReportAi;
};

export type ExportItem = {
  id: number;
  name: string;
  format: "xlsx" | "md";
  scope: string;
  range: string;
  from_date: string;
  to_date: string;
  size: number;
  source: string;
  created_by: number;
  created_at: string;
  creator_name: string;
  url: string;
};

export type Channel = {
  key: string;
  name: string;
  kind: "team" | "project";
  project_id?: number;
  archived?: boolean;
};

export type ToolPart = {
  type: "tool";
  id: string;
  name: string;
  label?: string;
  status: string;
  summary?: string;
  error?: boolean | string;
  proposal_id?: number;
  links?: { url: string; label: string }[];
};
export type TextPart = { type: "text"; text: string };
export type Proposal = {
  id: number;
  channel: string;
  message_id: number;
  tool: string;
  title: string;
  detail: string;
  requested_by: number;
  requested_name: string;
  status: "pending" | "approved" | "rejected" | "failed";
  decided_name: string | null;
  decided_at: string | null;
  result: string;
  error: string;
  created_at: string;
};
export type Attachment = { id: number; name: string; url: string; image?: boolean };
export type ChatMessage = {
  id: number;
  channel: string;
  kind: "user" | "assistant" | "system" | "recalled";
  user_id: number | null;
  username: string;
  text: string;
  parts: (ToolPart | TextPart)[];
  attachments: (Attachment | number)[];
  proposals: Proposal[];
  created_at: string;
  streaming?: boolean;
};
export type ChatResponse = {
  channel: string;
  messages: ChatMessage[];
  busy: boolean;
  ai: AiInfo;
  pending: Proposal[];
  channels: Channel[];
};

export type Knowledge = {
  has_summary: boolean;
  summary_at: string | null;
  consolidated_at: string | null;
  log_dates: string[];
  chat_dates: string[];
  auto_days: number;
  summary: string;
};
