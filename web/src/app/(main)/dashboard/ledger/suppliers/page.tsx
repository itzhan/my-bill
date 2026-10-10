"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { get, post } from "@/modules/ledger/api";
import { amt } from "@/modules/ledger/components/party-wallets";
import { PageHeader, Pager, usePaged } from "@/modules/ledger/components/shared";
import { curf, money, relTime } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { Party, PartyWallet } from "@/modules/ledger/types";

type SupplierRow = Party & { project_archived: boolean; wallets: PartyWallet[] };

const sum = (list: PartyWallet[], f: (w: PartyWallet) => number | null) =>
  list.filter((w) => w.enabled).reduce((a, w) => a + (f(w) ?? 0), 0);

// 侧栏「供应商」：汇总所有项目的供应商，以及我们在各供应商站点（new-api / sub2api）的余额、倍率、累计消费
export default function SuppliersPage() {
  const { openPartyNew } = useLedger();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: pd } = useProjects();
  const { data } = useQuery({
    queryKey: ["ledger", "suppliers"],
    queryFn: () => get<{ suppliers: SupplierRow[] }>("/suppliers").then((d) => d.suppliers),
  });
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 每个供应商的累计消费（各 Key 的实际消费之和），用于排序
  const usedOf = (s: SupplierRow) =>
    s.wallets.filter((w) => w.enabled).reduce((a, w) => a + (w.last_used_actual ?? 0), 0);
  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (s) =>
          (showArchived || (!s.archived && !s.project_archived)) &&
          (!kw ||
            s.name.toLowerCase().includes(kw) ||
            (s.project_name ?? "").toLowerCase().includes(kw) ||
            s.wallets.some((w) => w.name.toLowerCase().includes(kw) || w.base_url.toLowerCase().includes(kw))),
      )
      .sort((a, b) => usedOf(b) - usedOf(a)); // 累计消费多的在前
  }, [data, q, showArchived]);
  const { rows: pageRows, pager } = usePaged(rows, `${q}|${showArchived}`);

  const active = (data ?? []).filter((s) => !s.archived && !s.project_archived);
  const wallets = active.flatMap((s) => s.wallets).filter((w) => w.enabled);
  const totalActual = active
    .filter((s) => s.settle_type !== "credit")
    .flatMap((s) => s.wallets)
    .filter((w) => w.enabled)
    .reduce((a, w) => a + (w.last_actual ?? 0), 0);
  const totalUsed = sum(wallets, (w) => w.last_used_actual);
  const rates = pd?.rates ?? { USD: 7.2, USDT: 7.2 };
  // 未结算折人民币粗略合计（USD×rates.USD、USDT×rates.USDT、CNY×1）
  const totalUnsettledCny = active.reduce((a, s) => {
    const rc = s.recharge;
    if (!rc) return a;
    const rate = rc.currency === "CNY" ? 1 : rc.currency === "USD" ? rates.USD : rates.USDT;
    return a + Math.max(0, rc.unsettled) * rate;
  }, 0);
  const failed = wallets.filter((w) => w.last_error && w.last_wallet == null && w.last_used == null).length;
  const archivedCount = (data ?? []).length - active.length;

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const r = await post<{ wallets: PartyWallet[] }>("/wallets/refresh");
      const bad = r.wallets.filter((w) => w.last_error).length;
      if (bad) toast.error(`已刷新 ${r.wallets.length} 把 Key，其中 ${bad} 把有提示或失败`);
      else toast.success(`已刷新 ${r.wallets.length} 把 Key`);
      qc.invalidateQueries({ queryKey: ["ledger", "suppliers"] });
      qc.invalidateQueries({ queryKey: ["ledger", "party-wallets"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const stats = [
    {
      label: "实际余额合计",
      value: amt(totalActual),
      sub: "各供应商站点钱包；自定义倍率的按 钱包 × 倍率",
      cls: "text-income",
    },
    { label: "累计消费合计", value: amt(totalUsed), sub: "各 Key 在供应商站点总共用了多少", cls: "text-expense" },
    {
      label: "未结算合计",
      value: money(totalUnsettledCny),
      sub: "应付(消费) − 已结算(充值)，折人民币",
      cls: totalUnsettledCny > 0 ? "text-warning" : "",
    },
    {
      label: "绑定的 Key",
      value: wallets.length,
      sub: failed ? `${failed} 把抓取失败` : `${new Set(wallets.map((w) => w.party_id)).size} 家供应商`,
      cls: failed ? "text-destructive" : "",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="供应商"
        description="所有项目的供应商，以及我们在各供应商站点的余额、倍率与累计消费（每 30 分钟自动刷新）"
        actions={
          <>
            <Button variant="outline" onClick={refreshAll} disabled={refreshing || !wallets.length}>
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              {refreshing ? "抓取中…" : "全部刷新"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus />
                  添加供应商
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                <DropdownMenuLabel>加到哪个项目</DropdownMenuLabel>
                {(pd?.projects ?? [])
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <DropdownMenuItem key={p.id} onClick={() => openPartyNew(p.id, "supplier")}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className={cn("text-2xl font-semibold tabular-nums", s.cls)}>{data ? s.value : "-"}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">{s.sub}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>供应商列表</CardTitle>
            <CardDescription>点一行打开供应商详情：管理 Key、记应付 / 实付</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {archivedCount ? (
              <div className="flex items-center gap-2">
                <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                <Label htmlFor="show-archived" className="text-muted-foreground text-sm font-normal">
                  显示已归档（{archivedCount}）
                </Label>
              </div>
            ) : null}
            <div className="relative w-full sm:w-56">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                placeholder="搜索供应商 / 项目 / Key"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>供应商</TableHead>
                    <TableHead>Key（平台 · 倍率）</TableHead>
                    <TableHead className="text-right">钱包余额</TableHead>
                    <TableHead className="text-right">实际余额</TableHead>
                    <TableHead className="text-right">累计消费</TableHead>
                    <TableHead className="text-right">已结算</TableHead>
                    <TableHead className="text-right">未结算</TableHead>
                    <TableHead>最近抓取</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length ? (
                    pageRows.map((s) => {
                      const ws = s.wallets;
                      const on = ws.filter((w) => w.enabled);
                      const rc = s.recharge;
                      const latest = on
                        .map((w) => w.last_checked_at)
                        .filter(Boolean)
                        .sort()
                        .pop();
                      return (
                        <TableRow
                          key={s.id}
                          className={cn("cursor-pointer align-top", (s.archived || s.project_archived) && "opacity-60")}
                          onClick={() => router.push(`/dashboard/ledger/suppliers/${s.id}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5 font-medium">
                              {s.name}
                              {s.settle_type === "credit" ? <Badge variant="outline">授信</Badge> : null}
                              {s.archived ? <Badge variant="outline">归档</Badge> : null}
                            </div>
                            <Link
                              prefetch={false}
                              href={`/dashboard/ledger/projects/${s.project_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground text-xs hover:underline"
                            >
                              {s.project_name}
                              {s.project_archived ? "（项目已归档）" : ""}
                            </Link>
                          </TableCell>
                          <TableCell>
                            {ws.length ? (
                              <div className="space-y-1">
                                {ws.map((w) => (
                                  <div
                                    key={w.id}
                                    className={cn("flex items-center gap-1.5 text-xs", !w.enabled && "opacity-50")}
                                  >
                                    <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                                      {w.platform === "sub2api" ? "sub2api" : "new-api"}
                                    </Badge>
                                    <span className="max-w-32 truncate" title={w.base_url}>
                                      {w.name}
                                    </span>
                                    <span className="text-muted-foreground tabular-nums">
                                      {w.last_ratio == null ? "×-" : `×${+w.last_ratio.toFixed(4)}`}
                                      {w.custom ? "（自定义）" : ""}
                                    </span>
                                    {w.last_error ? (
                                      <span
                                        title={w.last_error}
                                        className={cn(
                                          "size-1.5 shrink-0 rounded-full",
                                          w.last_wallet == null && w.last_used == null
                                            ? "bg-destructive"
                                            : "bg-warning",
                                        )}
                                      />
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">未绑定 Key</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {ws.map((w) => (
                              <div key={w.id} className={cn(!w.enabled && "opacity-50")}>
                                {amt(w.last_wallet)}
                              </div>
                            ))}
                          </TableCell>
                          <TableCell className="text-income text-right font-semibold tabular-nums">
                            {s.settle_type === "credit" ? (
                              <span className="text-muted-foreground font-normal">授信</span>
                            ) : on.length ? (
                              amt(sum(on, (w) => w.last_actual))
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-expense text-right tabular-nums">
                            {on.length ? amt(sum(on, (w) => w.last_used_actual)) : "-"}
                          </TableCell>
                          <TableCell className="text-income text-right tabular-nums">
                            {rc ? curf(rc.settled, rc.currency) : "-"}
                          </TableCell>
                          <TableCell
                            className={cn("text-right tabular-nums", (rc?.unsettled ?? 0) > 0 && "text-warning")}
                          >
                            {rc ? curf(Math.abs(rc.unsettled), rc.currency) : "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                            {latest ? relTime(latest) : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-muted-foreground py-10 text-center">
                        {data.length ? "没有符合条件的供应商" : "还没有供应商，点右上角「添加供应商」，选个项目开始"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {data ? <Pager {...pager} className="mt-4" /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
