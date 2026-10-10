"use client";

import { use } from "react";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, ExternalLink, Pencil, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { get } from "@/modules/ledger/api";
import { amt } from "@/modules/ledger/components/party-wallets";
import { Pager, usePaged } from "@/modules/ledger/components/shared";
import { curf, fmt0, usdf } from "@/modules/ledger/format";
import { useLedger } from "@/modules/ledger/provider";
import type { ConsumePoint, SupplierDetail, WalletDetail } from "@/modules/ledger/types";

// 分组类型配色
const TYPE_CLS: Record<string, string> = {
  Claude: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  Gemini: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  GPT: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Grok: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  DeepSeek: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  Qwen: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};
const TypeBadge = ({ t }: { t: string }) => (
  <span
    className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", TYPE_CLS[t] ?? "bg-muted text-muted-foreground")}
  >
    {t}
  </span>
);

// 每日消耗迷你柱状图（近 30 天），纯 CSS，无额外依赖
function DailyBars({ data }: { data: ConsumePoint[] }) {
  if (!data.length) return <div className="text-muted-foreground py-6 text-center text-sm">近 30 天没有消耗</div>;
  const max = Math.max(...data.map((d) => d.usd), 0.0001);
  return (
    <div className="flex h-28 items-end gap-0.5">
      {data.map((d) => (
        <div
          key={d.date}
          className="bg-expense/70 hover:bg-expense min-w-0 flex-1 rounded-t-sm transition-colors"
          style={{ height: `${Math.max(2, (d.usd / max) * 100)}%` }}
          title={`${d.date} · ${usdf(d.usd)} · ${fmt0(d.count)} 次`}
        />
      ))}
    </div>
  );
}

// 单把 Key 的消耗明细（每日曲线 + 按模型 + 按分组）
function WalletConsume({ w }: { w: WalletDetail }) {
  if (!w.ok) return <div className="text-destructive text-sm">抓取失败：{w.error}</div>;
  const byModel = w.byModel ?? [];
  const byGroup = (w.byGroup ?? []).filter((g) => g.usd > 0);
  const splitByGroup = byGroup.length > 1; // 站点标了分组才拆得开
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-xs">
          近 {w.period_days ?? 30} 天消耗 · 合计{" "}
          <span className="text-expense font-semibold">{usdf(w.period_used)}</span>
        </span>
      </div>
      <DailyBars data={w.daily ?? []} />
      {w.note ? <p className="text-muted-foreground text-xs">{w.note}</p> : null}
      <div className={cn("grid gap-4", splitByGroup && "lg:grid-cols-2")}>
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-medium">按模型</div>
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模型</TableHead>
                  <TableHead className="text-right">消耗</TableHead>
                  <TableHead className="text-right">请求</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byModel.length ? (
                  byModel.slice(0, 20).map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="font-mono text-xs">{m.model || "—"}</TableCell>
                      <TableCell className="text-expense text-right tabular-nums">{usdf(m.usd)}</TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                        {fmt0(m.count)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground py-6 text-center text-sm">
                      近 30 天无消耗
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        {splitByGroup ? (
          <div>
            <div className="text-muted-foreground mb-2 text-xs font-medium">按分组</div>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>分组</TableHead>
                    <TableHead className="text-right">消耗</TableHead>
                    <TableHead className="text-right">请求</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byGroup.map((g) => (
                    <TableRow key={g.group}>
                      <TableCell className="text-xs">{g.group}</TableCell>
                      <TableCell className="text-expense text-right tabular-nums">{usdf(g.usd)}</TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                        {fmt0(g.count)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sid = Number(id);
  const { openParty } = useLedger();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ledger", "supplier-detail", sid],
    queryFn: () => get<SupplierDetail>(`/suppliers/${sid}/detail`),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return <div className="text-muted-foreground py-10 text-center">加载失败</div>;

  const { party, wallets } = data;
  const okWallets = wallets.filter((w) => w.id);
  const sites = [...new Set(wallets.map((w) => w.base_url).filter(Boolean))];
  const credit = party.settle_type === "credit";

  // 实际口径（含自定义倍率）合计
  const totalActual = wallets.reduce((a, w) => a + (w.last_actual ?? 0), 0);
  const totalUsed = wallets.reduce((a, w) => a + (w.last_used_actual ?? 0), 0);
  const topup = totalActual + totalUsed; // 充值总额度 ≈ 当前余额 + 累计消耗
  const rc = party.recharge;

  const kpis = [
    { label: "充值总额度", value: amt(topup), sub: "站点累计充入 ≈ 当前余额 + 累计消耗", cls: "" },
    { label: "消耗总额度", value: amt(totalUsed), sub: "各 Key 在站点的累计消费", cls: "text-expense" },
    {
      label: credit ? "结算方式" : "当前实际余额",
      value: credit ? "授信" : amt(totalActual),
      sub: credit ? "先用后付，不看余额" : "各站点钱包；自定义倍率按 钱包 × 倍率",
      cls: credit ? "text-muted-foreground" : "text-income",
    },
    {
      label: "未结算",
      value: rc ? curf(Math.abs(rc.unsettled), rc.currency) : "-",
      sub: "应付(消费) − 已结算(净充值)",
      cls: rc && rc.unsettled > 0 ? "text-warning" : "",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */}
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/ledger/suppliers"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> 返回供应商列表
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{party.name}</h1>
              {credit ? <Badge variant="outline">授信</Badge> : <Badge variant="outline">预付</Badge>}
              {party.archived ? <Badge variant="outline">归档</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Link
                href={`/dashboard/ledger/projects/${party.project_id}`}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {party.project_name}
              </Link>
              {sites.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  {u.replace(/^https?:\/\//, "")}
                </a>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn(isFetching && "animate-spin")} />
              刷新
            </Button>
            <Button variant="outline" onClick={() => openParty(sid)}>
              <Pencil />
              管理 Key / 记账
            </Button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className={cn("text-2xl font-semibold tabular-nums", k.cls)}>{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">{k.sub}</CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="funds">
        <TabsList>
          <TabsTrigger value="funds">资金往来</TabsTrigger>
          <TabsTrigger value="groups">分组</TabsTrigger>
          <TabsTrigger value="consume">消耗明细</TabsTrigger>
        </TabsList>

        <TabsContent value="funds" className="mt-4">
          <FundsTab detail={data} />
        </TabsContent>

        <TabsContent value="groups" className="mt-4 space-y-4">
          {okWallets.map((w) => (
            <Card key={w.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {w.name}
                  <Badge variant="outline" className="ml-2 font-normal">
                    {w.platform === "sub2api" ? "sub2api" : "new-api"}
                  </Badge>
                </CardTitle>
                <CardDescription>{w.base_url.replace(/^https?:\/\//, "")}</CardDescription>
              </CardHeader>
              <CardContent>
                {!w.ok ? (
                  <div className="text-destructive text-sm">抓取失败：{w.error}</div>
                ) : !(w.groups ?? []).length ? (
                  <div className="text-muted-foreground text-sm">{w.note || "没有分组信息"}</div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>分组</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead className="text-right">倍率</TableHead>
                          <TableHead className="text-right">模型数</TableHead>
                          <TableHead>介绍</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(w.groups ?? []).map((g) => (
                          <TableRow key={g.name}>
                            <TableCell className="font-medium">{g.name}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {g.types.length ? g.types.map((t) => <TypeBadge key={t} t={t} />) : "—"}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {g.ratio == null ? "—" : `×${+g.ratio.toFixed(4)}`}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-right tabular-nums">
                              {g.model_count}
                            </TableCell>
                            <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                              {g.desc || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="consume" className="mt-4 space-y-4">
          {okWallets.map((w) => (
            <Card key={w.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {w.name}
                  <Badge variant="outline" className="ml-2 font-normal">
                    {w.platform === "sub2api" ? "sub2api" : "new-api"}
                  </Badge>
                </CardTitle>
                <CardDescription>{w.base_url.replace(/^https?:\/\//, "")}</CardDescription>
              </CardHeader>
              <CardContent>
                <WalletConsume w={w} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// 资金往来：转给他 / 他转回 / 净 + 明细（项目可跳转）
function FundsTab({ detail }: { detail: SupplierDetail }) {
  const { funds } = detail;
  const { rows, pager } = usePaged(funds.entries, "funds");
  const cards = [
    { label: "我们转给他", value: curf(funds.out, funds.currency), icon: ArrowUpRight, cls: "text-expense" },
    { label: "他转给我们", value: curf(funds.income, funds.currency), icon: ArrowDownLeft, cls: "text-income" },
    { label: "净充值", value: curf(funds.net, funds.currency), icon: null, cls: "" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription className="flex items-center gap-1.5">
                {c.icon ? <c.icon className={cn("size-3.5", c.cls)} /> : null}
                {c.label}
              </CardDescription>
              <CardTitle className={cn("text-xl font-semibold tabular-nums", c.cls)}>{c.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">往来明细</CardTitle>
          <CardDescription>挂在这个供应商名下的充值 / 结算（支出）与退款 / 换钱（收入）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>项目</TableHead>
                  <TableHead>经手人</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funds.entries.length ? (
                  rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{e.time}</TableCell>
                      <TableCell>
                        {e.type === "income" ? (
                          <Badge variant="outline" className="text-income border-income/30">
                            他转回
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-expense border-expense/30">
                            转给他
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn("text-right tabular-nums", e.type === "income" ? "text-income" : "text-expense")}
                      >
                        {curf(e.amount, e.currency)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/ledger/projects/${e.project_id}`}
                          className="text-primary text-xs hover:underline"
                        >
                          {e.project_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{e.handler}</TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{e.note || "—"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                      还没有和这个供应商的资金往来。记支出时选上他 = 充值；记收入时选上他 = 他退款 / 换钱
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pager {...pager} className="mt-4" />
        </CardContent>
      </Card>
    </div>
  );
}
