"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { get } from "@/modules/ledger/api";
import { PageHeader, Pager, usePaged } from "@/modules/ledger/components/shared";
import { money, signed } from "@/modules/ledger/format";
import type { ProfitDaily } from "@/modules/ledger/types";

const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());

// 底部：按日期汇总（全部项目），分页
function DailySummary({ data }: { data: ProfitDaily }) {
  const { rows, pager } = usePaged(data.daily, "profit-daily", 15);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">按日期汇总（全部项目）</CardTitle>
        <CardDescription>每天所有项目合计的客户消耗、供应商消耗与利润</CardDescription>
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
                <TableRow key={d.date}>
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
    </Card>
  );
}

export default function ProfitPage() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ledger", "profit-daily"],
    queryFn: () => get<ProfitDaily>("/profit/daily"),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const today = todayStr();
  // 今日各项目利润（有今天消耗的项目）
  const todayRows = (data?.projects ?? [])
    .map((p) => ({ project_id: p.project_id, project_name: p.project_name, day: p.days.find((d) => d.date === today) }))
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
        description="每日利润 = 客户消耗（中转站实时消耗 × 折扣，折人民币）− 供应商消耗（钱包实际消费）。只列有消耗的项目"
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
            {isFetching ? "抓取中…" : "刷新"}
          </Button>
        }
      />

      {isLoading ? (
        <>
          <p className="text-muted-foreground text-sm">正在抓取各供应商站点的每日消耗，请稍候…</p>
          <Skeleton className="h-48" />
        </>
      ) : !data ? (
        <div className="text-muted-foreground py-10 text-center">加载失败</div>
      ) : (
        <>
          {/* 今日利润（重点） */}
          <Card className="from-primary/5 to-card border-primary/20 bg-gradient-to-br">
            <CardHeader className="gap-1">
              <CardDescription>今日利润 · {today}</CardDescription>
              <CardTitle className={cn("text-4xl font-bold tabular-nums", todayTotal.profit < 0 && "text-expense")}>
                {signed(todayTotal.profit)}
              </CardTitle>
              <div className="text-muted-foreground text-sm">
                客户消耗 <span className="text-income font-medium">{money(todayTotal.customer)}</span> − 供应商消耗{" "}
                <span className="text-expense font-medium">{money(todayTotal.supplier)}</span>
              </div>
            </CardHeader>
            <CardContent>
              {todayRows.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {todayRows.map((x) => (
                    <Link
                      key={x.project_id}
                      href={`/dashboard/ledger/projects/${x.project_id}`}
                      className="bg-background hover:border-primary/40 flex flex-col gap-1 rounded-lg border p-3 transition-colors"
                    >
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
                    </Link>
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

          {/* 底部：按日期汇总，分页 */}
          {data.daily.length ? <DailySummary data={data} /> : null}
        </>
      )}
    </div>
  );
}
