"use client";

import { Suspense } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Archive, Download } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { apiUrl, post } from "@/modules/ledger/api";
import { AiReportCard } from "@/modules/ledger/components/ai-report-card";
import { ExportsPanel } from "@/modules/ledger/components/exports-panel";
import { ReportAnalysis } from "@/modules/ledger/components/report-analysis";
import { DailyChart, ProfitChart } from "@/modules/ledger/components/report-charts";
import { DeltaBadge, KpiCards, MemberAvatar, PageHeader } from "@/modules/ledger/components/shared";
import { RANGES, money, pad, signed } from "@/modules/ledger/format";
import { useProjects, useReport } from "@/modules/ledger/hooks";
import type { Report } from "@/modules/ledger/types";

function monthStart() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-01`;
}
function today() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

function DetailTables({ d, qsFor }: { d: Report; qsFor: (scope: string) => string }) {
  const activeDays = d.daily
    .filter((x) => x.count)
    .slice()
    .reverse();
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>每日账单</CardTitle>
          <CardDescription>有记录的日期 · {activeDays.length} 天</CardDescription>
        </CardHeader>
        <CardContent>
          {activeDays.length ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">收入</TableHead>
                    <TableHead className="text-right">支出</TableHead>
                    <TableHead className="text-right">利润</TableHead>
                    <TableHead className="text-right">累计利润</TableHead>
                    <TableHead className="text-right">笔数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {activeDays.map((x) => (
                    <TableRow key={x.date}>
                      <TableCell>{x.date}</TableCell>
                      <TableCell className="text-income text-right">{x.income ? money(x.income) : "—"}</TableCell>
                      <TableCell className="text-expense text-right">{x.expense ? money(x.expense) : "—"}</TableCell>
                      <TableCell className={cn("text-right", x.profit < 0 && "text-expense")}>
                        {signed(x.profit)}
                      </TableCell>
                      <TableCell className={cn("text-right", x.cumulative < 0 && "text-expense")}>
                        {signed(x.cumulative)}
                      </TableCell>
                      <TableCell className="text-right">{x.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">这个区间还没有记录</p>
          )}
        </CardContent>
      </Card>
      <div className={cn("grid gap-4", !d.project && "xl:grid-cols-2")}>
        {d.project ? null : (
          <Card>
            <CardHeader>
              <CardTitle>按项目</CardTitle>
            </CardHeader>
            <CardContent>
              {d.byProject.length ? (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>项目</TableHead>
                        <TableHead className="text-right">收入</TableHead>
                        <TableHead className="text-right">支出</TableHead>
                        <TableHead className="text-right">利润</TableHead>
                        <TableHead className="text-right">笔数</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="tabular-nums">
                      {d.byProject.map((x) => (
                        <TableRow key={x.id}>
                          <TableCell>
                            <Link prefetch={false} href={`?${qsFor(String(x.id))}`} className="hover:underline">
                              {x.name}
                            </Link>
                            {x.archived ? (
                              <Badge variant="outline" className="ml-1">
                                已归档
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-income text-right">{money(x.income)}</TableCell>
                          <TableCell className="text-expense text-right">{money(x.expense)}</TableCell>
                          <TableCell className={cn("text-right font-semibold", x.profit < 0 && "text-expense")}>
                            {signed(x.profit)}
                          </TableCell>
                          <TableCell className="text-right">{x.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">暂无数据</p>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>按成员</CardTitle>
            <CardDescription>按经手人</CardDescription>
          </CardHeader>
          <CardContent>
            {d.byMember.length ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>成员</TableHead>
                      <TableHead className="text-right">支出</TableHead>
                      <TableHead className="text-right">收款</TableHead>
                      <TableHead className="text-right">笔数</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="tabular-nums">
                    {d.byMember.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell>
                          <span className="inline-flex items-center gap-2">
                            <MemberAvatar name={x.name} className="size-5 text-[10px]" />
                            {x.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-expense text-right">{x.expense ? money(x.expense) : "—"}</TableCell>
                        <TableCell className="text-income text-right">{x.income ? money(x.income) : "—"}</TableCell>
                        <TableCell className="text-right">{x.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">暂无数据</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReportsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: pd } = useProjects();

  const scope = sp.get("scope") || "all";
  const range = sp.get("range") || "month";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const tab = sp.get("tab") || "overview";

  const build = (patch: Record<string, string>) => {
    const next = { scope, range, from, to, tab, ...patch };
    if (next.range === "custom") {
      next.from = next.from || monthStart();
      next.to = next.to || today();
    }
    const qs = new URLSearchParams({ scope: next.scope, range: next.range, tab: next.tab });
    if (next.range === "custom") {
      qs.set("from", next.from);
      qs.set("to", next.to);
    }
    return qs.toString();
  };
  const set = (patch: Record<string, string>) => router.replace(`${pathname}?${build(patch)}`, { scroll: false });

  // 发给后端的查询串（不含 tab）
  const apiQs = (() => {
    const qs = new URLSearchParams({ scope, range });
    if (range === "custom") {
      qs.set("from", from);
      qs.set("to", to);
    }
    return qs.toString();
  })();
  const ready = range !== "custom" || (!!from && !!to);
  const { data: d, isFetching } = useReport(apiQs, ready);

  const archiveExport = async () => {
    try {
      await post("/exports", { scope, range, from, to, format: "both" });
      toast.success("已保存到导出记录");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="报表"
        description={
          d
            ? `${d.project ? d.project.name : "全部项目（含已归档）"} · ${d.from} 至 ${d.to} · ${d.days} 天 · ${d.entryCount} 笔`
            : " "
        }
        actions={
          <>
            <Button variant="outline" onClick={archiveExport}>
              <Archive />
              存一份到导出记录
            </Button>
            <Button asChild>
              <a href={apiUrl(`/api/export.xlsx?${apiQs}`)} download>
                <Download />
                导出 Excel
              </a>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Select value={scope} onValueChange={(v) => set({ scope: v })}>
          <SelectTrigger className="w-full lg:w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部项目</SelectItem>
            {pd?.projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
                {p.archived ? "（已归档）" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          variant="outline"
          value={range}
          onValueChange={(v) => v && set({ range: v })}
          className="flex-wrap"
        >
          {RANGES.map(([k, l]) => (
            <ToggleGroupItem key={k} value={k} className="px-3">
              {l}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {range === "custom" ? (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="w-40"
              value={from}
              onChange={(e) => e.target.value && set({ from: e.target.value })}
            />
            <span className="text-muted-foreground text-sm">至</span>
            <Input
              type="date"
              className="w-40"
              value={to}
              onChange={(e) => e.target.value && set({ to: e.target.value })}
            />
          </div>
        ) : null}
      </div>

      {!d ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className={cn("transition-opacity", isFetching && "opacity-60")}>
          <Tabs value={tab} onValueChange={(v) => set({ tab: v })} className="gap-4">
            <TabsList>
              <TabsTrigger value="overview">概览</TabsTrigger>
              <TabsTrigger value="detail">明细</TabsTrigger>
              <TabsTrigger value="analysis">{d.project ? "项目分析" : "分析"}</TabsTrigger>
              <TabsTrigger value="ai">AI 报表</TabsTrigger>
              <TabsTrigger value="exports">导出记录</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-4">
              <KpiCards
                summary={d.kpis}
                profitNote={`${d.kpis.count} 笔 · 上期 ${d.prevFrom} 至 ${d.prevTo}`}
                deltas={{
                  income: <DeltaBadge cur={d.kpis.income.base} prev={d.prev.income.base} kind="pct" />,
                  expense: <DeltaBadge cur={d.kpis.expense.base} prev={d.prev.expense.base} kind="pct" />,
                  profit: <DeltaBadge cur={d.kpis.profit} prev={d.prev.profit} kind="abs" />,
                }}
              />
              <div className="grid gap-4 xl:grid-cols-2">
                <ProfitChart daily={d.daily} />
                <DailyChart daily={d.daily} />
              </div>
            </TabsContent>
            <TabsContent value="detail">
              <DetailTables d={d} qsFor={(s) => build({ scope: s })} />
            </TabsContent>
            <TabsContent value="analysis">
              <ReportAnalysis key={d.scope} d={d} />
            </TabsContent>
            <TabsContent value="exports">
              <ExportsPanel />
            </TabsContent>
            <TabsContent value="ai">
              <AiReportCard d={d} params={{ scope, range, from, to }} qs={apiQs} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsInner />
    </Suspense>
  );
}
