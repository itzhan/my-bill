"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { del, get, patch, post } from "../api";
import { CUR, CURRENCIES, PL, curf, fmt, fmtCompact, fmtTime, parseAmount, relTime, todayLocal, usdf } from "../format";
import { qk, useLedgerRefresh, useMe, useParty } from "../hooks";
import type { Currency, Party, PartyKind, PartyWallet, RelayLive } from "../types";

import {
  EMPTY_WALLET,
  PartyWallets,
  WalletFields,
  amt,
  walletBody,
  walletDraftError,
  type WalletDraft,
} from "./party-wallets";
import { FormError, useConfirm } from "./shared";

export type PartySheetState =
  | { open: false }
  | { open: true; mode: "view"; id: number }
  | { open: true; mode: "edit"; id: number }
  | { open: true; mode: "new"; projectId: number; kind: PartyKind };

const SOURCE_TXT: Record<string, string> = { api: "接口同步", ai: "AI", relay: "中转站自动" };

function CurrencySelect({ value, onChange, id }: { value: Currency; onChange: (c: Currency) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Currency)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
            {c === "CNY" ? " 人民币" : c === "USD" ? " 美元" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PartySheet({
  state,
  setState,
}: {
  state: PartySheetState;
  setState: Dispatch<SetStateAction<PartySheetState>>;
}) {
  const close = () => setState({ open: false });
  let title = "往来单位";
  if (state.open && state.mode === "new") title = `添加${PL[state.kind].name}`;
  return (
    <Sheet open={state.open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {state.open && state.mode === "new" ? (
          <>
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-6">
              <NewPartyForm
                projectId={state.projectId}
                kind={state.kind}
                onDone={(id) => setState({ open: true, mode: "view", id })}
              />
            </div>
          </>
        ) : null}
        {state.open && state.mode !== "new" ? (
          <PartyDetailView
            id={state.id}
            editing={state.mode === "edit"}
            setMode={(mode) => setState({ open: true, mode, id: state.id })}
            onDeleted={close}
          />
        ) : null}
        {!state.open ? (
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function NewPartyForm({
  projectId,
  kind,
  onDone,
}: {
  projectId: number;
  kind: PartyKind;
  onDone: (id: number) => void;
}) {
  const { data: me } = useMe();
  const refresh = useLedgerRefresh();
  const L = PL[kind];
  // 中转站绑定（一键获取消耗、自动挂账）只用于客户；供应商改用下面的「抓取供应商余额」
  const relayOn = !!me?.ai.relay && kind === "customer";
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [note, setNote] = useState("");
  const [relayRef, setRelayRef] = useState("");
  const [ratio, setRatio] = useState("1");
  const [ext, setExt] = useState("");
  // 供应商余额：绑定我们在供应商站点（new-api / sub2api）的 Key，添加后立即抓钱包额度和倍率
  const [walletOn, setWalletOn] = useState(false);
  const [wallet, setWallet] = useState<WalletDraft>(EMPTY_WALLET);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("请填写名称");
    if (kind === "supplier" && walletOn) {
      const werr = walletDraftError(wallet, true);
      if (werr) return setError(werr);
    }
    const r = relayOn ? Number(ratio) : undefined;
    if (relayOn && !(Number(r) > 0)) return setError(`${kind === "customer" ? "折扣" : "倍率"}必须大于 0`);
    setBusy(true);
    setError(null);
    try {
      const d = await post<{ party: Party }>(`/projects/${projectId}/parties`, {
        kind,
        name: name.trim(),
        contact,
        note,
        currency,
        external_id: ext,
        ratio: r,
      });
      toast.success(`已添加${L.name}「${d.party.name}」`);
      if (relayRef.trim()) {
        try {
          await post(`/parties/${d.party.id}/relay-link`, { ref: relayRef.trim() });
          toast.success("已绑定中转站，开始自动挂账");
        } catch (ex) {
          toast.error(`绑定中转站失败：${(ex as Error).message}`);
        }
      }
      if (kind === "supplier" && walletOn) {
        try {
          const { wallet: w } = await post<{ wallet: { last_error: string; last_actual: number | null } }>(
            `/parties/${d.party.id}/wallets`,
            walletBody(wallet),
          );
          if (w.last_error) toast.error(`已绑定 Key，但抓取失败：${w.last_error}`);
          else toast.success(`已抓取供应商余额：实际余额 ${amt(w.last_actual)}`);
        } catch (ex) {
          toast.error(`绑定 Key 失败：${(ex as Error).message}`);
        }
      }
      refresh();
      onDone(d.party.id);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pty-name">{L.name}名称</Label>
        <Input
          id="pty-name"
          autoFocus
          maxLength={60}
          placeholder={kind === "supplier" ? "例如：XX 广告代理" : "例如：XX 科技有限公司"}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pty-contact">联系方式（可选）</Label>
          <Input id="pty-contact" maxLength={100} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>
            结算币种（{L.due} / {L.paid} 按此币种记）
          </Label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pty-note">备注（可选）</Label>
        <Input id="pty-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {relayOn ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pty-relay">中转站邮箱（一键获取消耗）</Label>
            <Input
              id="pty-relay"
              maxLength={120}
              placeholder="客户在中转站的登录邮箱"
              value={relayRef}
              onChange={(e) => setRelayRef(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pty-ratio">折扣（应收 = 消耗 × 折扣）</Label>
            <Input id="pty-ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} />
          </div>
        </div>
      ) : null}
      {kind === "supplier" ? (
        <div className="space-y-4 rounded-lg border p-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">抓取供应商余额（new-api / sub2api）</span>
              <span className="text-muted-foreground block text-xs">
                填我们在供应商站点的 API Key，自动抓钱包额度和倍率；以后也可以在供应商详情的「余额」里添加多把 Key
              </span>
            </span>
            <Switch checked={walletOn} onCheckedChange={setWalletOn} />
          </label>
          {walletOn ? <WalletFields v={wallet} setV={setWallet} /> : null}
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="pty-ext">外部系统编号（可选，接口同步时匹配用）</Label>
        <Input id="pty-ext" maxLength={100} value={ext} onChange={(e) => setExt(e.target.value)} />
      </div>
      <FormError>{error}</FormError>
      <Button type="submit" className="w-full" disabled={busy}>
        添加{relayOn || (kind === "supplier" && walletOn) ? "并获取" : ""}
      </Button>
    </form>
  );
}

function Kv({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn("mt-1 font-semibold tabular-nums", className)}>{value}</div>
    </div>
  );
}

function PartyDetailView({
  id,
  editing,
  setMode,
  onDeleted,
}: {
  id: number;
  editing: boolean;
  setMode: (m: "view" | "edit") => void;
  onDeleted: () => void;
}) {
  const { data, isLoading, error } = useParty(id);
  const hasRelay = !!data?.party.relay;
  const live = useQuery({
    queryKey: qk.partyRelay(id),
    queryFn: () => get<{ live: RelayLive }>(`/parties/${id}/relay`).then((d) => d.live),
    enabled: hasRelay && !editing,
    refetchInterval: 30_000,
  });
  // 供应商的各站点地址（去重），放在名字下面方便点击（去拿访问令牌）。与「余额」区块共用这份缓存
  const isSupplier = data?.party.kind === "supplier";
  const walletsQ = useQuery({
    queryKey: ["ledger", "party-wallets", id] as const,
    queryFn: () => get<{ wallets: PartyWallet[] }>(`/parties/${id}/wallets`).then((d) => d.wallets),
    enabled: !editing && isSupplier,
  });
  const siteUrls = [...new Set((walletsQ.data ?? []).map((w) => w.base_url).filter(Boolean))];

  if (isLoading || !data) {
    return (
      <div className="space-y-3 p-4">
        <SheetHeader className="p-0">
          <SheetTitle>往来单位</SheetTitle>
        </SheetHeader>
        {error ? <FormError>{error.message}</FormError> : null}
        <Skeleton className="h-10" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  const v = data.party;
  const L = PL[v.kind];
  if (editing) return <EditPartyForm party={v} onBack={() => setMode("view")} onDeleted={onDeleted} />;

  const liveData = live.data ?? (live.error ? ({ error: live.error.message } as RelayLive) : undefined);
  const st0 = liveData?.settlement ?? v.settle;
  const openLabel = st0.credit > 0 ? (v.kind === "customer" ? "预收余额" : "待消耗额度") : L.open;

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-2 pr-8">
          <div className="min-w-0">
            <SheetTitle className="flex items-center gap-2">
              {v.name} <Badge variant="secondary">{L.name}</Badge>
              {v.archived ? <Badge variant="outline">归档</Badge> : null}
            </SheetTitle>
            <SheetDescription>{[v.project_name, v.contact, v.note].filter(Boolean).join(" · ")}</SheetDescription>
            {siteUrls.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {siteUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="打开站点（去拿访问令牌）"
                    className="text-primary bg-primary/5 hover:bg-primary/10 inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => setMode("edit")} aria-label="编辑">
            <Pencil />
          </Button>
        </div>
      </SheetHeader>
      <div className="space-y-5 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Kv
            label={
              <>
                {L.due}（{st0.currency}）
                {v.relay ? (
                  <span className="block">
                    自动 {fmt(st0.relay_due)}
                    {st0.manual_due ? ` + 手工 ${fmt(st0.manual_due)}` : ""}
                  </span>
                ) : null}
              </>
            }
            value={curf(st0.due, st0.currency)}
          />
          <Kv label={`${L.paid}（${st0.currency}）`} value={curf(st0.paid, st0.currency)} />
          <Kv
            label={
              <>
                {openLabel}（{st0.currency}）
                {st0.currency !== "CNY" && (st0.open > 0 || st0.credit > 0) ? (
                  <span className="block">≈¥{fmt(Math.abs(st0.open_cny))}</span>
                ) : null}
              </>
            }
            value={curf(st0.open > 0 ? st0.open : st0.credit, st0.currency)}
            className={st0.open > 0 ? "text-warning" : st0.credit > 0 ? "text-income" : ""}
          />
        </div>

        {v.kind === "supplier" ? <PartyWallets party={v} /> : null}

        {data.relay_configured && v.kind === "customer" ? (
          <RelayBlock party={v} live={liveData} loading={live.isFetching} onRefresh={() => live.refetch()} />
        ) : null}

        {v.archived ? <p className="text-muted-foreground text-sm">已归档，只能查看</p> : <RecordForm party={v} />}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">
              往来明细 <span className="text-muted-foreground text-sm">{data.records.length}</span>
            </h3>
            <span className="text-muted-foreground text-xs">按日期倒序</span>
          </div>
          {data.records.length ? (
            <RecordList party={v} records={data.records} />
          ) : (
            <p className="text-muted-foreground text-sm">还没有往来记录</p>
          )}
        </div>
      </div>
    </>
  );
}

function RelayBlock({
  party: v,
  live,
  loading,
  onRefresh,
}: {
  party: Party;
  live?: RelayLive;
  loading: boolean;
  onRefresh: () => void;
}) {
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const L = PL[v.kind];
  const rl = v.kind === "customer" ? "折扣" : "倍率";
  const [ref, setRef] = useState(v.external_id || "");
  const [ratio, setRatio] = useState(String(v.ratio));
  const [cur, setCur] = useState<Currency>(v.currency);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    qc.invalidateQueries({ queryKey: qk.party(v.id) });
    qc.invalidateQueries({ queryKey: qk.partyRelay(v.id) });
    refresh();
  };

  const link = async () => {
    if (!ref.trim()) return setError(v.kind === "customer" ? "请填写中转站邮箱" : "请填写中转站账号名称");
    const r = Number(ratio);
    if (!(r > 0)) return setError(`${rl}必须大于 0`);
    setBusy(true);
    setError(null);
    try {
      await post(`/parties/${v.id}/relay-link`, { ref: ref.trim(), ratio: r, currency: cur });
      toast.success("已绑定并开始自动挂账");
      reload();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    if (
      !(await confirm({
        title: "解除与中转站的绑定？",
        description: "停止自动挂账，已自动挂账的记录保留（可手动删除）。",
        confirmText: "解除绑定",
      }))
    )
      return;
    try {
      await del(`/parties/${v.id}/relay-link`);
      reload();
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  const box = "space-y-3 rounded-lg border p-4";
  if (!v.relay) {
    return (
      <div className={box}>
        <div>
          <b className="text-sm">中转站</b>
          <p className="text-muted-foreground text-xs">
            {v.kind === "customer"
              ? "填客户在中转站的邮箱；应收 = 消耗 × 折扣，按结算币种自动逐日挂账"
              : "填中转站「账号管理」里的账号名；应付 = 消耗 × 倍率，按结算币种自动逐日挂账"}
          </p>
        </div>
        <Input
          placeholder={v.kind === "customer" ? "邮箱 / 用户名" : "账号名称"}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>
              {rl}（{L.due} = 消耗 × {rl}）
            </Label>
            <Input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>结算币种</Label>
            <CurrencySelect value={cur} onChange={setCur} />
          </div>
        </div>
        <FormError>{error}</FormError>
        <Button className="w-full" onClick={link} disabled={busy}>
          一键获取并开始挂账
        </Button>
        {confirmEl}
      </div>
    );
  }

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <b className="text-sm">
        中转站{v.kind === "supplier" ? "账号" : ""} · {v.relay.ref}
      </b>
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        {live?.fetched_at ? `${relTime(live.fetched_at)}更新 · 30 秒自动刷新` : "获取中…"}
        <Button variant="ghost" size="icon-sm" onClick={onRefresh} disabled={loading} aria-label="刷新">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
        <Button variant="link" size="sm" className="h-auto px-1" onClick={unlink}>
          解绑
        </Button>
      </div>
    </div>
  );
  if (!live) {
    return (
      <div className={box}>
        {head}
        <Skeleton className="h-12" />
        {confirmEl}
      </div>
    );
  }
  if (live.error) {
    return (
      <div className={box}>
        {head}
        <FormError>{live.error}</FormError>
        {confirmEl}
      </div>
    );
  }
  const lv = live.live;
  const st = live.settlement;
  const C = st.currency;
  const hourly = (live.hourly || []).slice(-12);
  const costOf = (h: { cost_usd: number; std_cost_usd: number }) =>
    v.kind === "customer" ? h.cost_usd : h.std_cost_usd;
  const maxH = Math.max(0.01, ...hourly.map(costOf));
  const u = live.user || {};
  const a = live.account || {};
  return (
    <div className={box}>
      {head}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kv label="中转站累计消耗" value={usdf(st.consumption_usd)} />
        <Kv label={`× ${rl} ${st.ratio} = ${L.due}`} value={curf(st.consumption_x_ratio, C)} />
        <Kv label={`今日${L.due}`} value={st.today === null ? "—" : curf(st.today, C)} />
        <Kv label="本小时" value={st.this_hour === null ? "—" : curf(st.this_hour, C)} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kv label="当前 RPM" value={lv ? `${lv.rpm_now} / 5分钟均 ${lv.rpm_5m_avg}` : "—"} />
        {v.kind === "customer" ? (
          <>
            <Kv label="当前 TPM" value={lv ? fmtCompact(lv.tpm_now) : "—"} />
            <Kv label="今日请求" value={(live.today?.requests || 0).toLocaleString()} />
            <Kv
              label="中转站余额"
              value={u.balance_usd !== undefined ? usdf(u.balance_usd) : "—"}
              className={(u.balance_usd ?? 0) < 0 ? "text-expense" : ""}
            />
          </>
        ) : (
          <>
            <Kv label="今日请求" value={(live.today?.requests ?? 0).toLocaleString()} />
            <Kv label="并发" value={`${a.current_concurrency ?? 0}/${a.concurrency_limit ?? "—"}`} />
            <Kv label="账号状态" value={a.status || "—"} className={a.status === "active" ? "" : "text-expense"} />
          </>
        )}
      </div>
      {hourly.length ? (
        <div>
          <div className="flex h-16 items-end gap-1">
            {hourly.map((h) => (
              <div
                key={h.hour}
                title={`${h.hour} · ${usdf(costOf(h))} · ${h.requests} 次`}
                className="bg-primary/70 flex-1 rounded-t-sm"
                style={{ height: `${Math.max(2, (costOf(h) / maxH) * 100).toFixed(0)}%` }}
              />
            ))}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">近 {hourly.length} 小时消耗（$）</p>
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {v.kind === "customer"
          ? `状态 ${u.status || "—"} · 限 ${u.rpm_limit ?? "—"} RPM · 最近请求 ${lv?.last_request_at || "—"}${
              lv && Object.keys(lv.models_5m || {}).length
                ? ` · 近 5 分钟模型：${Object.entries(lv.models_5m)
                    .map(([m, n]) => `${m}×${n}`)
                    .join("、")}`
                : ""
            }`
          : `平台 ${a.platform || "—"} · 最近使用 ${a.last_used_at || "—"}${a.error ? ` · ${a.error.slice(0, 40)}` : ""}${
              a.temp_unschedulable ? ` · 暂不可调度：${a.temp_unschedulable.slice(0, 60)}` : ""
            }`}
        {` · 汇率 1 USD = ${st.usd_rate} CNY${C === "USDT" ? `，1 USDT = ${st.cur_rate} CNY` : ""} · ${L.due}按 ${C} 自动逐日挂账`}
      </p>
      {confirmEl}
    </div>
  );
}

function RecordForm({ party: v }: { party: Party }) {
  const { data: me } = useMe();
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const L = PL[v.kind];
  const [kind, setKind] = useState<"due" | "paid">("due");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(v.currency);
  const [rate, setRate] = useState(v.currency === "CNY" ? "" : String(me?.rates[v.currency] ?? ""));
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [handler, setHandler] = useState(String(me?.user.id ?? ""));
  const [linkEntry, setLinkEntry] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const changeCurrency = (c: Currency) => {
    setCurrency(c);
    setRate(c === "CNY" ? "" : String(me?.rates[c] ?? ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = parseAmount(amount);
    if (!(a > 0)) return setError("请输入正确的金额");
    const r = currency === "CNY" ? undefined : Number(rate);
    if (currency !== "CNY" && !(Number(r) > 0)) return setError("请填写汇率");
    setBusy(true);
    setError(null);
    try {
      await post(`/parties/${v.id}/records`, {
        kind,
        amount: a,
        currency,
        rate: r,
        date,
        note: note.trim(),
        link_entry: kind === "paid" ? linkEntry : false,
        handler_id: kind === "paid" ? Number(handler) : undefined,
      });
      toast.success(`已记${L[kind]} ${CUR[currency].sym}${fmt(a)}`);
      setAmount("");
      setNote("");
      qc.invalidateQueries({ queryKey: qk.party(v.id) });
      refresh();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-muted/30 space-y-3 rounded-lg border p-4">
      <ToggleGroup
        type="single"
        variant="outline"
        className="w-full"
        value={kind}
        onValueChange={(k) => k && setKind(k as "due" | "paid")}
      >
        <ToggleGroupItem value="due" className="flex-1">
          记{L.due}
        </ToggleGroupItem>
        <ToggleGroupItem value="paid" className="flex-1">
          记{L.paid}
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="rec-amount">金额</Label>
          <Input
            id="rec-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>币种</Label>
          <CurrencySelect value={currency} onChange={changeCurrency} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {currency !== "CNY" ? (
          <div className="space-y-2">
            <Label htmlFor="rec-rate">汇率（1 外币 = ? CNY）</Label>
            <Input id="rec-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="rec-date">日期</Label>
          <Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rec-note">备注</Label>
        <Input
          id="rec-note"
          maxLength={200}
          placeholder={v.kind === "supplier" ? "例如：9 月服务费" : "例如：第二期款"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {kind === "paid" ? (
        <>
          <div className="space-y-2">
            <Label>经手人（谁{v.kind === "supplier" ? "付" : "收"}的钱，计入他的资金沉淀）</Label>
            <Select value={handler} onValueChange={setHandler}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {me?.members.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={linkEntry} onCheckedChange={setLinkEntry} />
            同时记入项目流水（{L.entry}）
          </label>
        </>
      ) : null}
      <FormError>{error}</FormError>
      <Button type="submit" className="w-full" disabled={busy}>
        记{L[kind]}
      </Button>
    </form>
  );
}

function RecordList({ party: v, records }: { party: Party; records: import("../types").PartyRecord[] }) {
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const L = PL[v.kind];
  const remove = async (id: number) => {
    if (
      !(await confirm({
        title: "删除这条往来记录？",
        description: "关联的流水也会一并删除。",
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    try {
      await del(`/party-records/${id}`);
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: qk.party(v.id) });
      refresh();
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };
  return (
    <div className="divide-y rounded-lg border">
      {records.map((r) => {
        const locked = r.source === "relay" && !!v.relay;
        return (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{r.date}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <b>{L[r.kind]}</b>
                {r.source === "relay" ? (
                  <Badge variant="secondary" className="ml-1">
                    自动
                  </Badge>
                ) : null}
                {r.note ? ` · ${r.note}` : ""}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {r.source === "relay"
                  ? "中转站自动挂账"
                  : `${r.creator_name ? `${r.creator_name} ` : ""}${fmtTime(r.created_at)} 登记${SOURCE_TXT[r.source] ? ` · ${SOURCE_TXT[r.source]}` : ""}`}
                {r.entry_id ? " · 已入流水" : ""}
              </div>
            </div>
            <div
              className={cn(
                "shrink-0 text-right tabular-nums",
                r.kind === "paid" && (v.kind === "supplier" ? "text-expense" : "text-income"),
              )}
            >
              {CUR[r.currency].sym}
              {fmt(r.amount)}
              {r.currency !== "CNY" ? <div className="text-muted-foreground text-xs">≈¥{fmt(r.cny)}</div> : null}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={locked}
              title={locked ? "自动挂账记录，绑定期间不能删除" : "删除"}
              onClick={() => remove(r.id)}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      {confirmEl}
    </div>
  );
}

function EditPartyForm({ party: v, onBack, onDeleted }: { party: Party; onBack: () => void; onDeleted: () => void }) {
  const refresh = useLedgerRefresh();
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const L = PL[v.kind];
  const [name, setName] = useState(v.name);
  const [contact, setContact] = useState(v.contact);
  const [currency, setCurrency] = useState<Currency>(v.currency);
  const [note, setNote] = useState(v.note);
  const [ratio, setRatio] = useState(String(v.ratio));
  const [ext, setExt] = useState(v.external_id);
  const [settledBase, setSettledBase] = useState(v.kind === "supplier" ? String(v.settled_base ?? 0) : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [v.id]);

  const reload = () => {
    qc.invalidateQueries({ queryKey: qk.party(v.id) });
    qc.invalidateQueries({ queryKey: qk.partyRelay(v.id) });
    refresh();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = Number(ratio);
    if (!(r > 0)) return setError("倍率必须大于 0");
    try {
      await patch(`/parties/${v.id}`, {
        name,
        contact,
        note,
        currency,
        external_id: ext,
        ratio: r,
        ...(v.kind === "supplier" ? { settled_base: Number(settledBase) || 0 } : {}),
      });
      toast.success("已保存");
      reload();
      onBack();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };
  const archive = async () => {
    try {
      await patch(`/parties/${v.id}`, { archived: !v.archived });
      toast.success(v.archived ? "已恢复" : "已归档");
      reload();
      onBack();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: `删除${L.name}「${v.name}」？`,
        description: "连同全部往来记录一起删除，不可恢复（已入流水的记录不会删除）。",
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    try {
      await del(`/parties/${v.id}`);
      toast.success("已删除");
      refresh();
      onDeleted();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>编辑{L.name}</SheetTitle>
      </SheetHeader>
      <form onSubmit={save} className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="pe-name">名称</Label>
          <Input id="pe-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pe-contact">联系方式</Label>
            <Input id="pe-contact" maxLength={100} value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>默认结算币种</Label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pe-note">备注</Label>
          <Input id="pe-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {v.kind === "customer" ? (
          <div className="space-y-2">
            <Label htmlFor="pe-ratio">折扣（应收 = 中转站消耗 × 折扣）</Label>
            <Input id="pe-ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="pe-ext">外部系统编号</Label>
          <Input id="pe-ext" maxLength={100} value={ext} onChange={(e) => setExt(e.target.value)} />
        </div>
        {v.kind === "supplier" ? (
          <div className="space-y-2">
            <Label htmlFor="pe-settled">期初已结算（{currency}）</Label>
            <Input
              id="pe-settled"
              inputMode="decimal"
              placeholder="0"
              value={settledBase}
              onChange={(e) => setSettledBase(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              用这套系统之前已经充值 / 结算过的金额，按结算币种填；之后记账选这个供应商的支出会自动累加
            </p>
          </div>
        ) : null}
        <FormError>{error}</FormError>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            返回
          </Button>
          <Button type="submit">保存</Button>
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={archive}>
          {v.archived ? "恢复" : "归档"}
        </Button>
        <Button type="button" variant="outline" className="text-destructive w-full" onClick={remove}>
          删除{L.name}及全部往来记录
        </Button>
      </form>
      {confirmEl}
    </>
  );
}
