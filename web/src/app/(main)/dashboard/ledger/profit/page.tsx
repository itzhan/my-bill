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
import { PageHeader } from "@/modules/ledger/components/shared";
import { money, signed } from "@/modules/ledger/format";
import type { ProfitDaily, ProfitDay } from "@/modules/ledger/types";

function DayTable({ days }: { days: ProfitDay[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
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
          {days.map((d) => (
            <TableRow key={d.date}>
              <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap">{d.date}</TableCell>
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
  );
}

export default function ProfitPage() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ledger", "profit-daily"],
    queryFn: () => get<ProfitDaily>("/profit/daily"),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const stats = [
    { label: "客户消耗合计", value: data ? money(data.totals.customer) : "-", cls: "text-income" },
    { label: "供应商消耗合计", value: data ? money(data.totals.supplier) : "-", cls: "text-expense" },
    {
      label: "利润合计",
      value: data ? signed(data.totals.profit) : "-",
      cls: data && data.totals.profit < 0 ? "text-expense" : "text-income",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="每日利润"
        description="按项目的每日利润 = 客户消耗（中转站实时消耗 × 折扣，折人民币）− 供应商消耗（钱包实际消费）。只列当天有消耗的项目"
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
          <Skeleton className="h-40" />
        </>
      ) : !data ? (
        <div className="text-muted-foreground py-10 text-center">加载失败</div>
      ) : (
        <>
          <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs sm:grid-cols-3">
            {stats.map((s) => (
              <Card key={s.label} className="gap-2 py-5">
                <CardHeader className="px-5">
                  <CardDescription>{s.label}</CardDescription>
                  <CardTitle className={cn("text-2xl font-semibold tabular-nums", s.cls)}>{s.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>

          {data.errors.length ? (
            <Alert variant="destructive">
              <AlertTitle>部分供应商消耗未抓到</AlertTitle>
              <AlertDescription>{data.errors.join("；")}</AlertDescription>
            </Alert>
          ) : null}

          {data.daily.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">按日期汇总（全部项目）</CardTitle>
              </CardHeader>
              <CardContent>
                <DayTable days={data.daily} />
              </CardContent>
            </Card>
          ) : null}

          {data.projects.length ? (
            data.projects.map((p) => (
              <Card key={p.project_id}>
                <CardHeader className="flex-col gap-1 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base">
                      <Link href={`/dashboard/ledger/projects/${p.project_id}`} className="hover:underline">
                        {p.project_name}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      客户 {money(p.customer)} − 供应商 {money(p.supplier)} ={" "}
                      <span className={cn("font-semibold", p.profit < 0 ? "text-expense" : "text-income")}>
                        利润 {signed(p.profit)}
                      </span>
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <DayTable days={p.days} />
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="text-muted-foreground py-10 text-center">近期没有有消耗的项目</div>
          )}
        </>
      )}
    </div>
  );
}
