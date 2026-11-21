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
export type EmailReport = {
  enabled: boolean;
  base_url: string;
  email: string;
  account_id: number;
  sender_name: string;
  recipients: string[];
  time: string;
  supplier_threshold: number | null;
  has_password: boolean;
};
export type PartyContract = {
  id: number;
  party_id: number;
  category: "contract" | "invoice";
  all_projects: boolean;
  title: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  image: boolean;
  sign_date: string;
  valid_years: number;
  note: string;
  expiry: string;
  remind_date: string;
  created_at: string;
  creator_name: string;
  project_name?: string;
};

export type Me = {
  user: Member;
  members: Member[];
  rates: Rates;
  ai: AiInfo;
  auto_export: AutoExport;
  email_report: EmailReport;
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
  ptype?: "relay" | "short" | "key";
  category?: "customer" | "company";
  station_id?: number | null;
  // 项目级期初成本（中转制）：各供应商站点只算封存起点之后的新增消耗
  opening_cost?: number | null;
};
export type ProjectWithSummary = Project & {
  summary: Summary;
  customer_open_cny?: number;
  est_profit?: number;
  // 预估利润：中转制 = 分组收费 − 站点累计消费，上 key = 甲方应收 − 供应商应付，项目制 = 记账收入 − 记账支出
  forecast_profit?: number | null;
  receivable?: number | null;
  payable?: number | null;
};
export type Station = {
  id: number;
  name: string;
  type: "relay" | "key";
  base_url: string;
  user_id: string;
  quota_per_usd: number;
  has_credential: boolean;
  projects: { id: number; name: string }[];
};

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
  party_kind?: "supplier" | "customer" | null;
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
  project_id: number | null;
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
  relay: { id: number; ref: string; station_id?: number | null; track_mode?: "user" | "key"; key_id?: number | null; key_name?: string; group_id?: number | null } | null;
  totals: { due: number; paid: number; open: number; count: number; last_at: string | null };
  settle: Settle;
  // 供应商余额汇总（只有绑定了 new-api / sub2api Key 的供应商才有）
  wallet?: { count: number; actual: number | null; used: number | null; errors: number } | null;
  // 供应商统一汇总（人民币）：应付 = 中转累计消费 + 其他项目贡献，实付 = 净付款，结余 = 实付 − 应付
  supplier_totals?: { due: number; paid: number; balance: number; relay_due: number; other_due: number } | null;
  settled_base?: number;
  settle_type?: "prepaid" | "credit";
  // 客户：预付余额阈值（美元）、后付账期天数、起始使用时间
  balance_threshold?: number | null;
  term_days?: number | null;
  start_date?: string;
  // 供应商 / 客户画像（介绍）
  profile?: string;
  // 客户逻辑分组：同名的多个项目往来视为同一个客户
  customer_group?: string;
  // 项目页：只算对本项目的贡献（应付 = 本项目挂账，实付 = 本项目充值 − 退款），人民币
  project_settle?: { due: number; paid: number; open: number };
  // 供应商结算：应付（消费折结算币种）/ 已结算（期初+充值支出）/ 未结算
  recharge?: {
    currency: Currency;
    payable: number;
    balance?: number;
    settled: number;
    settled_base: number;
    from_entries: number;
    paid_out?: number;
    refunded?: number;
    entry_count: number;
    diff?: number;
    unsettled: number;
  } | null;
};

// 供应商余额：我们在供应商站点（new-api / sub2api）的 Key 对应的钱包额度与倍率
export type PartyWallet = {
  id: number;
  party_id: number;
  project_id: number | null;
  name: string;
  note?: string;
  platform: "newapi" | "sub2api";
  base_url: string;
  custom: boolean;
  custom_ratio: number | null;
  consume_ratio: number | null;
  consume_rates?: { from_date: string; ratio: number; custom_ratio?: number | null }[];
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
  used_adjust?: number;
  // 成本口径：account = 账户总消费（原样）；key = 只算绑定的这把 Key 的实际消耗
  cost_mode?: "account" | "key";
  // 期初成本（人民币）。空 = 按站点累计计费；有值时 billed_used = 期初 + 起点之后的新增消耗
  opening_cost?: number | null;
  opening_used?: number | null;
  billed_used?: number | null;
  // 今日消费（自定义倍率时 last_today_actual = 今日消费 × 倍率）
  last_today: number | null;
  last_today_actual: number | null;
  last_error: string;
  last_checked_at: string | null;
};
// 供应商详情：资金往来（双向完整流水）+ 每把 Key 在站点的分组 / 每组消耗 / 每日消耗
export type FundEntry = Entry & {
  time: string;
  cny: number;
  in_cur: number;
  handler: string;
};
// 成员详情：资金汇总 + 经手的完整流水（跨项目）+ 转账
export type MemberDetail = {
  member: { id: number; name: string };
  fund: FundMember;
  entries: Entry[];
  transfers: Transfer[];
  rates: Rates;
};
export type WalletGroup = { name: string; ratio: number | null; desc: string; model_count: number; types: string[] };
// 站点上读到的 API Key（供应商站点 key 列表，绑定后按它的实际消耗算成本）
export type RemoteStationKey = {
  id: string;
  name: string;
  key_masked: string;
  used: number | null;
  remain: number | null;
  status: string;
  last_used_at: string | null;
};
// 中转站客户的 Key（按 Key 追踪用）：id 为站点数字 id，group_name 为该 Key 在站点上绑定的分组名
export type RelayUserKey = {
  id: number;
  name: string;
  key_masked: string;
  status: number;
  group_id: number | null;
  group_name: string;
};
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
  opening_cost?: number | null;
  opening_used?: number | null;
  billed_used?: number | null;
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
export type SupplierSite = {
  base_url: string;
  host: string;
  name: string;
  note?: string;
  platform: "newapi" | "sub2api";
  template_wallet_id: number;
  custom: boolean;
  custom_ratio: number | null;
  consume_ratio: number | null;
  consume_rates?: { from_date: string; ratio: number; custom_ratio?: number | null }[];
  has_token: boolean;
  has_login: boolean;
  login_user: string;
  token_user_id: string;
  insecure: boolean;
  actual: number | null;
  used: number | null;
  today: number | null;
  last_checked_at: string | null;
  last_error: string;
  wallets: (PartyWallet & { project_name?: string })[];
};
export type SupplierContribution = {
  project_id: number;
  project_name: string;
  ptype: "relay" | "short" | "key";
  due_cny: number;
  count: number;
};
export type SupplierDetail = {
  party: Party;
  funds: { currency: Currency; out: number; income: number; net: number; entries: FundEntry[] };
  sites: SupplierSite[];
  project_contributions: SupplierContribution[];
  wallets: WalletDetail[];
  rates: Rates;
};
export type CustomerOption = {
  key: string;
  name: string;
  group: string;
  contact: string;
  id: number;
};
export type RelayStationUser = {
  id: number;
  email: string;
  username: string;
  status: string;
  balance_usd: number;
  notes?: string;
};

// 每日利润明细（按项目）：客户每日消耗 − 供应商每日消耗
export type ProfitCustomer = { name: string; cny: number };
export type ProfitDay = {
  date: string;
  customer: number;
  supplier: number;
  profit: number;
  forecast?: number;
  customers?: ProfitCustomer[];
};
export type ProfitProject = {
  project_id: number;
  project_name: string;
  days: ProfitDay[];
  customer: number;
  supplier: number;
  profit: number;
  forecast?: number | null;
  today_customers: ProfitCustomer[];
};
export type ProfitDaily = {
  projects: ProfitProject[];
  daily: ProfitDay[];
  totals: { customer: number; supplier: number; profit: number };
  errors: string[];
  rates: Rates;
  cached_at?: string;
};

// 客户：按逻辑客户聚合（一个客户可跨多个项目）
export type TermStatus = { due_date: string; days_to_due: number; arrears: number; overdue: boolean };
export type CustomerPartyRow = {
  party_id: number;
  name: string;
  project_id: number;
  project_name: string;
  project_type: "relay" | "short";
  project_archived: boolean;
  settle_type: "prepaid" | "credit";
  relay_id: number | null;
  balance_usd: number | null;
  due_cny: number;
  paid_cny: number;
  open_cny: number;
  ratio: number;
  archived: boolean;
  low_balance: boolean;
  term: TermStatus | null;
  balance_threshold: number | null;
};
export type CustomerGroup = {
  key: string;
  group: string;
  detail_party_id: number;
  name: string;
  parties: CustomerPartyRow[];
  project_names?: string[];
  has_relay: boolean;
  settle_type: "prepaid" | "credit";
  balance_usd: number | null;
  bal_rev_usd: number | null;
  due_cny: number;
  paid_cny: number;
  open_cny: number;
  low_balance: boolean;
  overdue: boolean;
  archived: boolean;
  project_count: number;
  ratios: number[];
};
export type CustomersResponse = {
  customers: CustomerGroup[];
  relay_customers: CustomerGroup[];
  project_customers: CustomerGroup[];
  usd_rate: number;
  rates: Rates;
  fetched_at: string;
};
export type CustomerProject = {
  party_id: number;
  project_id: number;
  project_name: string;
  project_type: "relay" | "short";
  settle_type?: "prepaid" | "credit";
  relay_id?: number | null;
  relay_ref?: string;
  balance_usd?: number | null;
  ratio: number;
  currency: Currency;
  settle: Settle;
  groups?: { group_name: string; price: number; price_mode?: string }[];
  // 项目制项目：直接按项目流水的收入 / 支出 / 利润统计（不走中转挂账）
  summary?: { income: { base: number }; expense: { base: number }; profit: number } | null;
};
export type CustomerLive = {
  user?: { balance_usd?: number; status?: string };
  total?: { cost_usd?: number; requests?: number };
  today?: { cost_usd?: number; requests?: number };
  daily?: { date: string; cost_usd: number; requests: number }[];
} | null;
export type CustomerDetail = {
  customer: Party & { balance_usd: number | null; term: TermStatus | null };
  projects: CustomerProject[];
  records: (PartyRecord & { project_name: string })[];
  contracts: PartyContract[];
  live: CustomerLive;
  rates: Rates;
};

export type PartiesSummary = {
  suppliers: Party[];
  customers: Party[];
  totals: Record<PartyKind, { due: number; paid: number; open: number }>;
  daily: { date: string; payable: number; paid: number; receivable: number; received: number; count: number }[];
};

// 中转制预估利润：客户分组收费 − 付给供应商的钱，按天
export type RelayForecastDay = { date: string; customer: number; supplier: number; profit: number };
export type RelayForecast = { customer: number; supplier: number; profit: number; daily: RelayForecastDay[] };
export type ProjectDetail = {
  project: Project;
  summary: Summary;
  members: { id: number; name: string; expense: number; income: number; count: number }[];
  entries: Entry[];
  rates: Rates;
  parties: PartiesSummary;
  funds: Funds;
  forecast?: RelayForecast | null;
  // 按消耗算的应收 / 应付。项目制没有
  estimate?: { receivable: number; payable: number; profit: number; note: string } | null;
  stations?: ProjectStations;
};
// 项目「台子」tab
export type ProjectStations = {
  relay: { id: number; name: string; base_url: string } | null;
  suppliers: { id: number; name: string; sites: string[]; prefixes: string[]; due: number; paid: number }[];
  customers: { id: number; name: string; station: string; groups: { group_name: string; price: number; price_mode?: string }[]; due: number; paid: number }[];
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
  grouped?: boolean;
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
