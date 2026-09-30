"use client";

import { useState } from "react";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { RANGES, money, signed } from "../format";
import { useReport } from "../hooks";
import type { Report } from "../types";

import { DailyChart, ProfitChart } from "./report-charts";

const OVERVIEW_RANGES = RANGES.filter(([k]) => k !== "custom");

function Num({ v, tone }: { v: number; tone?: "income" | "expense" | "profit" }) {
  const cls = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : v < 0 ? "text-expense" : "";
  return (
    <TableCell className={cn("text-right tabular-nums", cls, tone === "profit" && "font-semibold")}>
      {tone === "profit" ? signed(v) : v ? money(v) : "—"}
    </TableCell>
  );
}

function MonthlyTable({ d }: { d: Report }) {
  const rows = [...d.analysis.monthly].reverse();
  if (!rows.length) return <p className="text-muted-foreground text-sm">这个区间还没有记录</p>;
  const sum = rows.reduce(
    (a, m) => ({
      income: a.income + m.income,
      expense: a.expense + m.expense,
      profit: a.profit + m.profit,
      count: a.count + m.count,
    }),
    { income: 0, expense: 0, profit: 0, count: 0 },
  );
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>月份</TableHead>
            <TableHead className="text-right">收入</TableHead>
            <TableHead className="text-right">成本（支出）</TableHead>
            <TableHead className="text-right">利润</TableHead>
            <TableHead className="text-right">利润率</TableHead>
            <TableHead className="text-right">笔数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => (
            <TableRow key={m.month}>
              <TableCell className="tabular-nums">{m.month}</TableCell>
              <Num v={m.income} tone="income" />
              <Num v={m.expense} tone="expense" />
              <Num v={m.profit} tone="profit" />
              <TableCell className="text-muted-foreground text-right tabular-nums">
                {m.income ? `${((m.profit / m.income) * 100).toFixed(1)}%` : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{m.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>合计</TableCell>
            <Num v={sum.income} tone="income" />
            <Num v={sum.expense} tone="expense" />
            <Num v={sum.profit} tone="profit" />
            <TableCell className="text-right tabular-nums">
              {sum.income ? `${((sum.profit / sum.income) * 100).toFixed(1)}%` : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">{sum.count}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function ProjectTable({ d, range }: { d: Report; range: string }) {
  const rows = [...d.byProject].sort((a, b) => b.profit - a.profit);
  if (!rows.length) return <p className="text-muted-foreground text-sm">这个区间还没有记录</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>项目</TableHead>
            <TableHead className="text-right">收入</TableHead>
            <TableHead className="text-right">成本（支出）</TableHead>
            <TableHead className="text-right">利润</TableHead>
            <TableHead className="text-right">笔数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((x) => (
            <TableRow key={x.id}>
              <TableCell>
                <Link
                  prefetch={false}
                  href={`/dashboard/ledger/reports?scope=${x.id}&range=${range}`}
                  className="hover:underline"
                >
                  {x.name}
                </Link>
                {x.archived ? (
                  <Badge variant="outline" className="ml-1">
                    已归档
                  </Badge>
                ) : null}
              </TableCell>
              <Num v={x.income} tone="income" />
              <Num v={x.expense} tone="expense" />
              <Num v={x.profit} tone="profit" />
              <TableCell className="text-right tabular-nums">{x.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// 总览里的趋势：利润曲线、每日收支、按月 / 按项目的收支表（数据来自报表接口）
export function OverviewTrends() {
  const [range, setRange] = useState("month");
  const { data: d, isFetching } = useReport(`scope=all&range=${range}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">收支趋势</h2>
          <p className="text-muted-foreground text-sm">
            {d ? `${d.from} 至 ${d.to} · ${d.entryCount} 笔 · 全部项目（含已归档），按各笔记账时汇率折算` : " "}
          </p>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v)}>
          {OVERVIEW_RANGES.map(([k, l]) => (
            <ToggleGroupItem key={k} value={k} className="px-3">
              {l}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {!d ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className={cn("space-y-4 transition-opacity", isFetching && "opacity-60")}>
          <div className="grid gap-4 xl:grid-cols-2">
            <ProfitChart daily={d.daily} />
            <DailyChart daily={d.daily} />
          </div>
          <Card>
            <Tabs defaultValue="monthly" className="gap-0">
              <CardHeader>
                <CardTitle>收入 / 成本 / 利润</CardTitle>
                <CardDescription>成本即支出</CardDescription>
                <CardAction>
                  <TabsList>
                    <TabsTrigger value="monthly">按月</TabsTrigger>
                    <TabsTrigger value="project">按项目</TabsTrigger>
                  </TabsList>
                </CardAction>
              </CardHeader>
              <CardContent className="pt-4">
                <TabsContent value="monthly">
                  <MonthlyTable d={d} />
                </TabsContent>
                <TabsContent value="project">
                  <ProjectTable d={d} range={range} />
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      )}
    </div>
  );
}
