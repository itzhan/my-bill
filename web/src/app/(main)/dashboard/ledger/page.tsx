"use client";

import { useState } from "react";

import Link from "next/link";

import { FolderPlus, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FundsSection } from "@/modules/ledger/components/funds-section";
import { OverviewTrends } from "@/modules/ledger/components/overview-trends";
import { KpiCards, PageHeader } from "@/modules/ledger/components/shared";
import { greeting, money, relTime, signed } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { ProjectWithSummary } from "@/modules/ledger/types";

function ProjectCard({ p }: { p: ProjectWithSummary }) {
  const s = p.summary;
  return (
    <Link href={`/dashboard/ledger/projects/${p.id}`} prefetch={false}>
      <Card className={cn("hover:border-primary/40 h-full gap-3 transition-colors", p.archived && "opacity-60")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 truncate">
            <span className="truncate">{p.name}</span>
            {p.archived ? <Badge variant="outline">已归档</Badge> : null}
          </CardTitle>
          <CardDescription>利润</CardDescription>
          <div className={cn("text-2xl font-semibold tabular-nums", s.profit < 0 && "text-expense")}>
            {signed(s.profit)}
          </div>
        </CardHeader>
        <CardContent className="flex gap-4 text-sm tabular-nums">
          <span className="text-income">收 {money(s.income.base)}</span>
          <span className="text-expense">支 {money(s.expense.base)}</span>
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
  const [showArchived, setShowArchived] = useState(false);

  const active = data?.projects.filter((p) => !p.archived) ?? [];
  const archived = data?.projects.filter((p) => p.archived) ?? [];
  const shown = showArchived ? (data?.projects ?? []) : active;

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
        <KpiCards summary={data.totals} />
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
            项目 <span className="text-muted-foreground text-sm font-normal">{active.length}</span>
          </h2>
          {archived.length ? (
            <div className="flex items-center gap-2">
              <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
              <Label htmlFor="show-archived" className="text-muted-foreground text-sm font-normal">
                显示已归档（{archived.length}）
              </Label>
            </div>
          ) : null}
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
