"use client";

import Link from "next/link";

import { FolderPlus, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FundsSection } from "@/modules/ledger/components/funds-section";
import { OverviewTrends } from "@/modules/ledger/components/overview-trends";
import { EstimateCards, KpiCards, PageHeader } from "@/modules/ledger/components/shared";
import { greeting, money, relTime, signed } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { ProjectWithSummary } from "@/modules/ledger/types";

// 总览顶部：全部项目，含已归档。中转和上 key 用消耗口径，项目制用记账收入当应收、记账支出当应付
function OverviewCards({ projects, totals }: { projects: ProjectWithSummary[]; totals: ProjectWithSummary["summary"] }) {
  const receivable = projects.reduce((a, p) => a + (p.receivable ?? p.summary.income.base), 0);
  const payable = projects.reduce((a, p) => a + (p.payable ?? p.summary.expense.base), 0);
  const profit = projects.reduce((a, p) => a + (p.forecast_profit ?? p.summary.profit), 0);
  return (
    <EstimateCards
      estimate={{ receivable, payable, profit, note: `全部 ${projects.length} 个项目，含已归档。项目制按实际收支计` }}
      cash={totals.profit}
    />
  );
}

function ProjectCard({ p }: { p: ProjectWithSummary }) {
  const s = p.summary;
  const forecast = p.ptype === "short" ? null : p.forecast_profit;
  return (
    <Link href={`/dashboard/ledger/projects/${p.id}`} prefetch={false}>
      <Card className="hover:border-primary/40 h-full gap-3 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 truncate">
            <span className="truncate">{p.name}</span>
            {p.archived ? <Badge variant="outline">已归档</Badge> : null}
          </CardTitle>
          <CardDescription>{forecast == null ? "利润" : "预估利润"}</CardDescription>
          <div className={cn("text-2xl font-semibold tabular-nums", (forecast ?? s.profit) < 0 && "text-expense")}>
            {signed(forecast ?? s.profit)}
          </div>
          <div className="text-muted-foreground text-xs tabular-nums">
            目前流水 <span className={cn("text-foreground font-medium", s.profit < 0 && "text-expense")}>{signed(s.profit)}</span>
          </div>
        </CardHeader>
        <CardContent className="flex gap-4 text-sm tabular-nums">
          {forecast == null ? (
            <>
              <span className="text-income">收 {money(s.income.base)}</span>
              <span className="text-expense">支 {money(s.expense.base)}</span>
            </>
          ) : (
            <>
              <span className="text-income">应收 {money(p.receivable || 0)}</span>
              <span className="text-expense">应付 {money(p.payable || 0)}</span>
            </>
          )}
        </CardContent>
        <CardFooter className="text-muted-foreground flex justify-between text-xs">
          <span>{s.count} 笔</span>
          <span>{relTime(s.last_at)}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}

export default function LedgerOverviewPage() {
  const { me, openEntry, openProject } = useLedger();
  const { data } = useProjects();
  const shown = data?.projects ?? [];

  return (
    <div className="@container/main flex flex-col gap-6">
      <PageHeader
        title="总览"
        description={`${greeting()}，${me.user.username}`}
        actions={
          <>
            <Button variant="outline" onClick={() => openProject()}>
              <FolderPlus />
              新建项目
            </Button>
            <Button onClick={() => openEntry()}>
              <Plus />
              记一笔
            </Button>
          </>
        }
      />

      {data ? (
        <>
          <OverviewCards projects={data.projects} totals={data.totals} />
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}

      <OverviewTrends />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            项目 <span className="text-muted-foreground text-sm font-normal">{shown.length}</span>
          </h2>
        </div>
        {!data ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : shown.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {shown.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>还没有项目</EmptyTitle>
              <EmptyDescription>
                先建一个项目，团队成员就能在里面分别记录支出与收入，系统自动算出利润。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => openProject()}>新建第一个项目</Button>
            </EmptyContent>
          </Empty>
        )}
      </div>

      {data ? <FundsSection funds={data.funds} projectId={null} /> : null}
    </div>
  );
}
