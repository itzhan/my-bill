"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { del, get, patch, post, put } from "../api";
import { money, relTime, signed, usdf } from "../format";
import { qk } from "../hooks";
import type { ProjectDetail } from "../types";

import { FormError, ResponsiveDialog, useConfirm } from "./shared";

type PriceMode = "discount" | "cny";
type Price = { grp: string; mode: PriceMode; value: number; label: string };
type GroupPrice = { mode: PriceMode; value: number; label: string } | null;
type Settle = { due_cny: number; paid_cny: number; open_cny: number; credit_cny: number };
type KeyView = {
  site: {
    base_url: string;
    effective_base: string;
    user_id: string;
    quota_per_usd: number;
    customer_party_id: number | null;
    has_cookie: boolean;
    cookie_from_env: boolean;
    cookie_masked: string;
    last_sync_at: string | null;
    last_error: string;
    interval_min: number;
  };
  usd_rate: number;
  groups_seen: string[];
  prefixes: {
    id: number;
    prefix: string;
    party_id: number;
    party_name: string;
    note: string;
    channels: number;
    active: number;
    missing: number;
    prices: Price[];
    groups: { grp: string; usd: number; today_usd: number; payable: number; price: GroupPrice }[];
    usd: number;
    today_usd: number;
    payable: number;
    unpriced: boolean;
  }[];
  customer: {
    party_id: number | null;
    prices: Price[];
    groups: { grp: string; usd: number; today_usd: number; receivable: number; price: GroupPrice }[];
    settle: Settle | null;
  };
  suppliers: { party_id: number; name: string; prefixes: string[]; settle: Settle }[];
  totals: { usd: number; today_usd: number; payable: number; receivable: number; profit: number };
  daily: { date: string; opening: boolean; usd: number; payable: number; receivable: number; profit: number }[];
};

const grpName = (g: string) => g || "（无分组）";

// 上 key 项目：台子设置 + 供应商前缀与价格 + 甲方分组价格 + 结算 + 每日明细
export function KeySection({ detail }: { detail: ProjectDetail }) {
  const id = detail.project.id;
  const qc = useQueryClient();
  const key = ["ledger", "project-key", id];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => get<KeyView>(`/projects/${id}/key`),
    refetchInterval: 60_000,
  });
  const [confirm, confirmEl] = useConfirm();
  const [syncing, setSyncing] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [priceFor, setPriceFor] = useState<{ prefixId: number; title: string; prices: Price[] } | null>(null);

  // 改了设置 / 价格：接口直接返回最新视图；往来记录也随之变了，刷新项目详情
  const apply = (v: KeyView) => {
    qc.setQueryData(key, v);
    qc.invalidateQueries({ queryKey: qk.project(id) });
  };
  const run = async (fn: () => Promise<KeyView>, ok?: string) => {
    try {
      apply(await fn());
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  if (!data) return <Skeleton className="h-80" />;
  const s = data.site;
  const suppliers = detail.parties.suppliers.filter((p) => !p.archived);
  const customers = detail.parties.customers.filter((p) => !p.archived);
  const custName = customers.find((c) => c.id === s.customer_party_id)?.name;

  const sync = async () => {
    setSyncing(true);
    await run(() => post<KeyView>(`/projects/${id}/key/sync`), "已同步");
    setSyncing(false);
  };
  const removePrefix = async (p: KeyView["prefixes"][number]) => {
    const ok = await confirm({
      title: `删除前缀 ${p.prefix}？`,
      description: "该前缀的自动应付挂账会一并删除，渠道快照保留（重新添加前缀即可恢复）。",
      destructive: true,
      confirmText: "删除",
    });
    if (ok) await run(() => del<KeyView>(`/key-prefixes/${p.id}`), "已删除");
  };

  const t = data.totals;
  const cs = data.customer.settle;
  const supSum = data.suppliers.reduce(
    (a, x) => ({
      due: a.due + x.settle.due_cny,
      paid: a.paid + x.settle.paid_cny,
      open: a.open + x.settle.open_cny,
      credit: a.credit + x.settle.credit_cny,
    }),
    { due: 0, paid: 0, open: 0, credit: 0 },
  );
  const kpis = [
    { label: "累计消耗", value: usdf(t.usd), sub: `今日 ${usdf(t.today_usd)} · 汇率 ${data.usd_rate}` },
    {
      label: "甲方应收",
      value: money(t.receivable),
      sub: cs ? `已收 ${money(cs.paid_cny)} · 还欠 ${money(cs.open_cny)}` : "未设置甲方",
      cls: "text-income",
    },
    {
      label: "供应商应付",
      value: money(t.payable),
      sub: `已付 ${money(supSum.paid)} · 未结 ${money(supSum.open)}${supSum.credit ? ` · 预付 ${money(supSum.credit)}` : ""}`,
      cls: "text-expense",
    },
    {
      label: "利润 = 应收 − 应付",
      value: signed(t.profit),
      sub: "按当前价格实时计算",
      cls: t.profit < 0 ? "text-expense" : "",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 台子 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            台子 {s.effective_base}
            {s.last_error ? <Badge variant="destructive">同步失败</Badge> : null}
          </CardTitle>
          <CardDescription>
            {s.last_sync_at ? `上次同步 ${relTime(s.last_sync_at)}` : "尚未同步"} · 每 {s.interval_min} 分钟自动同步 ·
            甲方 {custName ?? <span className="text-expense">未设置</span>}
            {s.cookie_from_env ? " · Cookie 用服务器默认值" : s.has_cookie ? "" : " · 未配置 Cookie"}
            {s.last_error ? <span className="text-expense block">{s.last_error}</span> : null}
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => setSiteOpen(true)} title="台子设置">
              <Settings />
            </Button>
            <Button variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={cn(syncing && "animate-spin")} />
              立即同步
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-2">
            <CardHeader>
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className={cn("text-2xl font-semibold tabular-nums", k.cls)}>{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">{k.sub}</CardContent>
          </Card>
        ))}
      </div>

      {/* 供应商前缀 */}
      <Card>
        <CardHeader>
          <CardTitle>供应商前缀</CardTitle>
          <CardDescription>
            渠道名以前缀开头即算该前缀的 key，多个前缀都匹配时取最长的（ls-xo-m-… 归 ls-xo-m）。应付 = 消耗 × 价格
          </CardDescription>
          <CardAction>
            <Button
              onClick={() => setPrefixOpen(true)}
              disabled={!suppliers.length}
              title={suppliers.length ? "" : "先在「往来」里添加供应商"}
            >
              <Plus />
              添加前缀
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>前缀</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead className="text-right">渠道（启用 / 全部）</TableHead>
                <TableHead>分组 · 价格</TableHead>
                <TableHead className="text-right">累计消耗</TableHead>
                <TableHead className="text-right">今日</TableHead>
                <TableHead className="text-right">应付</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.prefixes.length ? (
                data.prefixes.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium">{p.prefix}</TableCell>
                    <TableCell>
                      <Select
                        value={String(p.party_id)}
                        onValueChange={(v) =>
                          run(() => patch<KeyView>(`/key-prefixes/${p.id}`, { party_id: Number(v) }), "已更换供应商")
                        }
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((x) => (
                            <SelectItem key={x.id} value={String(x.id)}>
                              {x.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.active} / {p.channels}
                      {p.missing ? <div className="text-muted-foreground text-xs">台子已删 {p.missing}</div> : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.groups.length ? (
                        p.groups.map((g) => (
                          <div key={g.grp}>
                            {grpName(g.grp)} ·{" "}
                            <span className={cn(!g.price && "text-expense")}>{g.price?.label ?? "未定价"}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">
                          {p.prices.map((x) => x.label).join(" / ") || "未定价"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usdf(p.usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{usdf(p.today_usd)}</TableCell>
                    <TableCell className="text-expense text-right tabular-nums">{money(p.payable)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="设置价格"
                        onClick={() =>
                          setPriceFor({
                            prefixId: p.id,
                            title: `前缀 ${p.prefix} 的价格（${p.party_name}）`,
                            prices: p.prices,
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" title="删除前缀" onClick={() => removePrefix(p)}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
                    还没有前缀。先在「往来」里添加供应商，再在这里给供应商添加前缀
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 甲方分组价格 */}
      <Card>
        <CardHeader>
          <CardTitle>甲方分组价格</CardTitle>
          <CardDescription>应收 = 各分组消耗 × 甲方给的价格。只统计我们供应商前缀下的渠道</CardDescription>
          <CardAction>
            <Button
              variant="outline"
              disabled={!s.customer_party_id}
              title={s.customer_party_id ? "" : "先在台子设置里选择甲方"}
              onClick={() =>
                setPriceFor({
                  prefixId: 0,
                  title: `甲方${custName ? `「${custName}」` : ""}分组价格`,
                  prices: data.customer.prices,
                })
              }
            >
              <Pencil />
              设置价格
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>分组</TableHead>
                <TableHead>甲方价格</TableHead>
                <TableHead className="text-right">累计消耗</TableHead>
                <TableHead className="text-right">今日</TableHead>
                <TableHead className="text-right">应收</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.customer.groups.length ? (
                data.customer.groups.map((g) => (
                  <TableRow key={g.grp}>
                    <TableCell className="font-medium">{grpName(g.grp)}</TableCell>
                    <TableCell className={cn(!g.price && "text-expense")}>{g.price?.label ?? "未定价"}</TableCell>
                    <TableCell className="text-right tabular-nums">{usdf(g.usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{usdf(g.today_usd)}</TableCell>
                    <TableCell className="text-income text-right tabular-nums">{money(g.receivable)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                    同步到渠道后会列出各分组
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 结算 */}
      <Card>
        <CardHeader>
          <CardTitle>结算</CardTitle>
          <CardDescription>应付 / 应收由消耗自动按天挂账；付款、回款在「往来」里记实付 / 实收</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>对象</TableHead>
                <TableHead>前缀</TableHead>
                <TableHead className="text-right">应付 / 应收</TableHead>
                <TableHead className="text-right">已付 / 已收</TableHead>
                <TableHead className="text-right">未结</TableHead>
                <TableHead className="text-right">预付 / 多收</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cs ? (
                <TableRow>
                  <TableCell className="font-medium">
                    甲方 {custName} <Badge variant="outline">客户</Badge>
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{money(cs.due_cny)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(cs.paid_cny)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", cs.open_cny > 0 && "text-income font-medium")}>
                    {money(cs.open_cny)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cs.credit_cny ? money(cs.credit_cny) : "-"}
                  </TableCell>
                </TableRow>
              ) : null}
              {data.suppliers.map((x) => (
                <TableRow key={x.party_id}>
                  <TableCell className="font-medium">
                    {x.name} <Badge variant="outline">供应商</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{x.prefixes.join(", ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(x.settle.due_cny)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(x.settle.paid_cny)}</TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", x.settle.open_cny > 0 && "text-expense font-medium")}
                  >
                    {money(x.settle.open_cny)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {x.settle.credit_cny ? money(x.settle.credit_cny) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 每日 */}
      <Card>
        <CardHeader>
          <CardTitle>每日明细</CardTitle>
          <CardDescription>期初 = 第一次同步时渠道已有的累计额度；之后按每次同步的增量记到当天</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead className="text-right">消耗</TableHead>
                <TableHead className="text-right">应收</TableHead>
                <TableHead className="text-right">应付</TableHead>
                <TableHead className="text-right">利润</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.daily.map((d) => (
                <TableRow key={d.date}>
                  <TableCell>{d.date}</TableCell>
                  <TableCell className="text-right tabular-nums">{usdf(d.usd)}</TableCell>
                  <TableCell className="text-income text-right tabular-nums">{money(d.receivable)}</TableCell>
                  <TableCell className="text-expense text-right tabular-nums">{money(d.payable)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", d.profit < 0 && "text-expense")}>
                    {signed(d.profit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SiteDialog
        open={siteOpen}
        onOpenChange={setSiteOpen}
        site={s}
        customers={customers}
        onSave={(body) => run(() => put<KeyView>(`/projects/${id}/key/site`, body), "已保存")}
      />
      <PrefixDialog
        open={prefixOpen}
        onOpenChange={setPrefixOpen}
        suppliers={suppliers}
        onSave={(body) => run(() => post<KeyView>(`/projects/${id}/key/prefixes`, body), "已添加并同步")}
      />
      <PriceDialog
        target={priceFor}
        groups={data.groups_seen}
        onClose={() => setPriceFor(null)}
        onSave={(body) =>
          run(() => put<KeyView>(`/projects/${id}/key/prices`, { ...body, prefix_id: priceFor?.prefixId ?? 0 }))
        }
      />
      {confirmEl}
    </div>
  );
}

type SaveFn = (body: Record<string, unknown>) => Promise<boolean>;

// 各表单随对话框挂载，初值只取一次（后台定时刷新数据不会冲掉正在输入的内容）
function SiteDialog({
  open,
  onOpenChange,
  site,
  customers,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  site: KeyView["site"];
  customers: { id: number; name: string }[];
  onSave: SaveFn;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="台子设置"
      description="只读访问台子的渠道列表（GET），不会改动台子"
    >
      <SiteForm site={site} customers={customers} onSave={onSave} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function SiteForm({
  site,
  customers,
  onSave,
  onDone,
}: {
  site: KeyView["site"];
  customers: { id: number; name: string }[];
  onSave: SaveFn;
  onDone: () => void;
}) {
  const [base, setBase] = useState(site.base_url);
  const [cookie, setCookie] = useState("");
  const [user, setUser] = useState(site.user_id);
  const [qpu, setQpu] = useState(String(site.quota_per_usd));
  const [cust, setCust] = useState(site.customer_party_id ? String(site.customer_party_id) : "");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      base_url: base,
      user_id: user,
      quota_per_usd: Number(qpu),
      customer_party_id: cust ? Number(cust) : null,
    };
    if (cookie.trim()) body.cookie = cookie.trim();
    if (await onSave(body)) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>甲方（本项目的客户）</Label>
        <Select value={cust} onValueChange={setCust}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={customers.length ? "选择甲方" : "先在「往来」里添加客户"} />
          </SelectTrigger>
          <SelectContent>
            {customers.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>台子地址</Label>
        <Input value={base} onChange={(e) => setBase(e.target.value)} placeholder={site.effective_base} />
      </div>
      <div className="space-y-2">
        <Label>Cookie</Label>
        <Input
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder={site.cookie_masked ? `当前：${site.cookie_masked}，留空不改` : "session=…"}
        />
        <p className="text-muted-foreground text-xs">
          从浏览器登录台子后复制请求里的 Cookie；过期后同步会失败，重新粘贴即可
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>New-Api-User</Label>
          <Input value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>额度 / $1</Label>
          <Input inputMode="numeric" value={qpu} onChange={(e) => setQpu(e.target.value)} />
        </div>
      </div>
      <Button type="submit" className="w-full">
        保存
      </Button>
    </form>
  );
}

function PrefixDialog({
  open,
  onOpenChange,
  suppliers,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  suppliers: { id: number; name: string }[];
  onSave: SaveFn;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加前缀"
      description="添加后立即同步一次，现有渠道的累计额度记为期初"
    >
      <PrefixForm suppliers={suppliers} onSave={onSave} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function PrefixForm({
  suppliers,
  onSave,
  onDone,
}: {
  suppliers: { id: number; name: string }[];
  onSave: SaveFn;
  onDone: () => void;
}) {
  const [party, setParty] = useState(suppliers.length === 1 ? String(suppliers[0]?.id) : "");
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave({ party_id: Number(party), prefix: prefix.trim() });
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>供应商</Label>
        <Select value={party} onValueChange={setParty}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择供应商" />
          </SelectTrigger>
          <SelectContent>
            {suppliers.map((x) => (
              <SelectItem key={x.id} value={String(x.id)}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>前缀</Label>
        <Input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="例如 ls-xo"
          className="font-mono"
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy || !party || !prefix.trim()}>
        {busy ? "同步中…" : "添加"}
      </Button>
    </form>
  );
}

type PriceTarget = { prefixId: number; title: string; prices: Price[] };
type PriceBody = { grp: string; mode: PriceMode; value: number | null };
// 价格：默认价（grp 为空，适用于没单独设价的分组）+ 各分组单独价；值留空即删除
function PriceDialog({
  target,
  groups,
  onClose,
  onSave,
}: {
  target: PriceTarget | null;
  groups: string[];
  onClose: () => void;
  onSave: (body: PriceBody) => Promise<boolean>;
}) {
  return (
    <ResponsiveDialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target?.title ?? ""}
      description="折扣：美金 × 折扣 × 汇率；人民币：美金 × 每刀单价。改价后历史挂账按新价重算，值留空即删除"
    >
      {target ? <PriceForm target={target} groups={groups} onSave={onSave} onDone={onClose} /> : null}
    </ResponsiveDialog>
  );
}

type PriceRow = { grp: string; mode: PriceMode; value: string };
function PriceForm({
  target,
  groups,
  onSave,
  onDone,
}: {
  target: PriceTarget;
  groups: string[];
  onSave: (body: PriceBody) => Promise<boolean>;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<PriceRow[]>(() =>
    ["", ...new Set([...groups, ...target.prices.map((p) => p.grp)].filter(Boolean))].map((g) => {
      const p = target.prices.find((x) => x.grp === g);
      return { grp: g, mode: p?.mode ?? "discount", value: p ? String(p.value) : "" };
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<PriceRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const changed = rows.filter((r) => {
      const p = target.prices.find((x) => x.grp === r.grp);
      return p ? p.mode !== r.mode || String(p.value) !== r.value.trim() : r.value.trim() !== "";
    });
    const bad = changed.find((r) => r.value.trim() && !(Number(r.value) > 0));
    if (bad) return setError(`「${bad.grp || "默认"}」的价格要大于 0`);
    setBusy(true);
    for (const r of changed) {
      const v = r.value.trim();
      if (!(await onSave({ grp: r.grp, mode: r.mode, value: v ? Number(v) : null }))) return setBusy(false);
    }
    setBusy(false);
    toast.success(changed.length ? "价格已保存，挂账已重算" : "没有改动");
    onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.grp} className="grid grid-cols-[1fr_7rem_6rem] items-center gap-2">
          <span className="truncate text-sm">
            {r.grp ? r.grp : <span className="text-muted-foreground">默认（其余分组）</span>}
          </span>
          <Select value={r.mode} onValueChange={(v) => set(i, { mode: v as PriceMode })}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="discount">折扣 ×</SelectItem>
              <SelectItem value="cny">¥ / 刀</SelectItem>
            </SelectContent>
          </Select>
          <Input
            inputMode="decimal"
            className="h-8"
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={r.mode === "cny" ? "如 0.5" : "如 0.1"}
          />
        </div>
      ))}
      <FormError>{error}</FormError>
      <Button type="submit" className="w-full" disabled={busy}>
        保存
      </Button>
    </form>
  );
}
