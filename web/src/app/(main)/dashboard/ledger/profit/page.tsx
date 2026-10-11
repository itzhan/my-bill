"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { get } from "@/modules/ledger/api";
import { PageHeader, Pager, ResponsiveDialog, usePaged } from "@/modules/ledger/components/shared";
import { money, relTime, signed } from "@/modules/ledger/format";
import type { ProfitCustomer, ProfitDaily } from "@/modules/ledger/types";

const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());

function CustomerList({ customers }: { customers?: ProfitCustomer[] }) {
  if (!customers?.length) return null;
  return (
    <div className="mt-1 space-y-1 border-t pt-2">
      <div className="text-muted-foreground text-xs">各用户消耗</div>
      {customers.map((c) => (
        <div key={c.name} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate">{c.name}</span>
          <span className="text-income shrink-0 tabular-nums">{money(c.cny)}</span>
        </div>
      ))}
    </div>
  );
}

// 某一天的详细：各项目的客户/供应商/利润 + 各用户消耗
function DayDetailDialog({ date, data, onClose }: { date: string | null; data: ProfitDaily; onClose: () => void }) {
  const rows = date
    ? data.projects
        .map((p) => ({ project_name: p.project_name, project_id: p.project_id, day: p.days.find((d) => d.date === date) }))
        .filter((x) => x.day)
        .map((x) => ({ ...x, day: x.day! }))
        .sort((a, b) => b.day.profit - a.day.profit)
    : [];
  return (
    <ResponsiveDialog open={!!date} onOpenChange={(o) => !o && onClose()} title={`${date ?? ""} 利润详情`}>
      <div className="space-y-3">
        {rows.map((x) => (
          <div key={x.project_id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{x.project_name}</span>
              <span className={cn("font-semibold tabular-nums", x.day.profit < 0 ? "text-expense" : "text-income")}>
                {signed(x.day.profit)}
              </span>
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs tabular-nums">
              客 {money(x.day.customer)} · 供 {money(x.day.supplier)}
            </div>
            <CustomerList customers={x.day.customers} />
          </div>
        ))}
      </div>
    </ResponsiveDialog>
  );
}

function DailySummary({ data }: { data: ProfitDaily }) {
  const { rows, pager } = usePaged(data.daily, "profit-daily", 15);
  const [detailDate, setDetailDate] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">按日期汇总（全部项目）</CardTitle>
        <CardDescription>每天所有项目合计；点一行看当天各项目、各用户的明细</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead className="text-right">客户消耗</TableHead>
                <TableHead className="text-right">供应商消耗</TableHead>
                <TableHead className="text-right">利润</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow
                  key={d.date}
                  className="cursor-pointer"
                  onClick={() => setDetailDate(d.date)}
                  title="点击查看当天明细"
                >
                  <TableCell className="text-muted-foreground tabular-nums">{d.date}</TableCell>
                  <TableCell className="text-income text-right tabular-nums">{money(d.customer)}</TableCell>
                  <TableCell className="text-expense text-right tabular-nums">{money(d.supplier)}</TableCell>
                  <TableCell className={cn("text-right font-semibold tabular-nums", d.profit < 0 && "text-expense")}>
                    {signed(d.profit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Pager {...pager} className="mt-4" />
      </CardContent>
      <DayDetailDialog date={detailDate} data={data} onClose={() => setDetailDate(null)} />
    </Card>
  );
}

export default function ProfitPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", "profit-daily"],
    queryFn: () => get<ProfitDaily>("/profit/daily"),
    staleTime: Infinity, // 历史不变，进页面直接用缓存，不重新抓取
    refetchOnWindowFocus: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  // 只有点刷新才重算（服务端重新抓各供应商站点）
  const refresh = async () => {
    setRefreshing(true);
    try {
      const d = await get<ProfitDaily>("/profit/daily?refresh=1");
      qc.setQueryData(["ledger", "profit-daily"], d);
    } finally {
      setRefreshing(false);
    }
  };

  const today = todayStr();
  const todayRows = (data?.projects ?? [])
    .map((p) => ({
      project_id: p.project_id,
      project_name: p.project_name,
      day: p.days.find((d) => d.date === today),
      customers: p.today_customers,
    }))
    .filter((x) => x.day)
    .map((x) => ({ ...x, day: x.day! }))
    .sort((a, b) => b.day.profit - a.day.profit);
  const todayTotal = todayRows.reduce(
    (a, x) => ({
      customer: a.customer + x.day.customer,
      supplier: a.supplier + x.day.supplier,
      profit: a.profit + x.day.profit,
    }),
    { customer: 0, supplier: 0, profit: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="每日利润"
        description="每日利润 = 客户消耗（中转站消耗 × 折扣，折人民币）− 供应商消耗（钱包实际消费）。只列有消耗的项目"
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing || isLoading}>
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            {refreshing ? "抓取中…" : "刷新数据"}
          </Button>
        }
      />

      {isLoading ? (
        <>
          <p className="text-muted-foreground text-sm">首次加载，正在抓取各供应商站点的每日消耗…</p>
          <Skeleton className="h-48" />
        </>
      ) : !data ? (
        <div className="text-muted-foreground py-10 text-center">加载失败</div>
      ) : (
        <>
          <Card className="from-primary/5 to-card border-primary/20 bg-gradient-to-br">
            <CardHeader className="gap-1">
              <CardDescription>今日利润 · {today}</CardDescription>
              <CardTitle className={cn("text-4xl font-bold tabular-nums", todayTotal.profit < 0 && "text-expense")}>
                {signed(todayTotal.profit)}
              </CardTitle>
              <div className="text-muted-foreground text-sm">
                客户消耗 <span className="text-income font-medium">{money(todayTotal.customer)}</span> − 供应商消耗{" "}
                <span className="text-expense font-medium">{money(todayTotal.supplier)}</span>
                {data.cached_at ? <span className="ml-2">· 数据 {relTime(data.cached_at)}更新，点右上角刷新</span> : null}
              </div>
            </CardHeader>
            <CardContent>
              {todayRows.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {todayRows.map((x) => (
                    <div key={x.project_id} className="bg-background flex flex-col gap-2 rounded-lg border p-3">
                      <div className="truncate font-medium">{x.project_name}</div>
                      <div
                        className={cn(
                          "text-2xl font-semibold tabular-nums",
                          x.day.profit < 0 ? "text-expense" : "text-income",
                        )}
                      >
                        {signed(x.day.profit)}
                      </div>
                      <div className="text-muted-foreground text-xs tabular-nums">
                        客 {money(x.day.customer)} · 供 {money(x.day.supplier)}
                      </div>
                      <CustomerList customers={x.customers} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">今天还没有有消耗的项目</p>
              )}
            </CardContent>
          </Card>

          {data.errors.length ? (
            <Alert variant="destructive">
              <AlertTitle>部分供应商消耗未抓到</AlertTitle>
              <AlertDescription>{data.errors.join("；")}</AlertDescription>
            </Alert>
          ) : null}

          {data.daily.length ? <DailySummary data={data} /> : null}
        </>
      )}
    </div>
  );
}
