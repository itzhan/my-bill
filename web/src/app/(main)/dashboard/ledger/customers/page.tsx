"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { get } from "@/modules/ledger/api";
import { PageHeader, Pager, usePaged } from "@/modules/ledger/components/shared";
import { curf, money, usdf } from "@/modules/ledger/format";
import type { CustomerRow } from "@/modules/ledger/types";

export default function CustomersPage() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["ledger", "customers"],
    queryFn: () => get<{ customers: CustomerRow[] }>("/customers").then((d) => d.customers),
  });
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const usedOf = (c: CustomerRow) => c.settle.due;
  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (c) =>
          (showArchived || (!c.archived && !c.project_archived)) &&
          (!kw || c.name.toLowerCase().includes(kw) || (c.project_name ?? "").toLowerCase().includes(kw)),
      )
      .sort((a, b) => usedOf(b) - usedOf(a));
  }, [data, q, showArchived]);
  const { rows: pageRows, pager } = usePaged(rows, `${q}|${showArchived}`);

  const active = (data ?? []).filter((c) => !c.archived && !c.project_archived);
  const prepaid = active.filter((c) => c.settle_type === "prepaid");
  const credit = active.filter((c) => c.settle_type === "credit");
  const totalBalance = prepaid.reduce((a, c) => a + (c.balance_usd ?? 0), 0);
  const totalArrears = credit.reduce((a, c) => a + Math.max(0, c.settle.open_cny), 0);
  const lowCount = active.filter((c) => c.low_balance).length;
  const overdueCount = active.filter((c) => c.term?.overdue).length;
  const archivedCount = (data ?? []).length - active.length;

  const stats = [
    { label: "客户数", value: active.length, sub: `预付 ${prepaid.length} · 后付 ${credit.length}`, cls: "" },
    { label: "预付余额合计", value: usdf(totalBalance), sub: "各预付客户中转站余额（美元）", cls: "text-income" },
    { label: "后付欠费合计", value: money(totalArrears), sub: "各后付客户未收款，折人民币", cls: totalArrears > 0 ? "text-warning" : "" },
    {
      label: "预警",
      value: lowCount + overdueCount,
      sub: `${lowCount} 个余额不足 · ${overdueCount} 个逾期`,
      cls: lowCount + overdueCount > 0 ? "text-destructive" : "",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="客户" description="所有项目的客户、消费与结算情况。预付看中转站余额，后付看账期与欠费" />

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
            <CardTitle>客户列表</CardTitle>
            <CardDescription>点一行查看客户详情：合作项目、往来记录、中转站实时</CardDescription>
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
              <Input placeholder="搜索客户 / 项目" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
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
                    <TableHead>客户</TableHead>
                    <TableHead>结算</TableHead>
                    <TableHead className="text-right">余额 / 欠费</TableHead>
                    <TableHead className="text-right">累计消费</TableHead>
                    <TableHead className="text-right">折扣</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length ? (
                    pageRows.map((c) => (
                      <TableRow
                        key={c.id}
                        className={cn("cursor-pointer align-top", (c.archived || c.project_archived) && "opacity-60")}
                        onClick={() => router.push(`/dashboard/ledger/customers/${c.id}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5 font-medium">
                            {c.name}
                            {c.archived ? <Badge variant="outline">归档</Badge> : null}
                          </div>
                          <Link
                            href={`/dashboard/ledger/projects/${c.project_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground text-xs hover:underline"
                          >
                            {c.project_name}
                            {c.project_type === "short" ? "（短期）" : ""}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{c.settle_type === "credit" ? "后付" : "预付"}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.settle_type === "credit" ? (
                            <span className={cn((c.settle.open ?? 0) > 0 && "text-warning")}>
                              {curf(c.settle.open, c.currency)}
                            </span>
                          ) : c.balance_usd != null ? (
                            <span className={cn(c.low_balance && "text-destructive font-semibold")}>
                              {usdf(c.balance_usd)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{curf(c.settle.due, c.currency)}</TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {+c.ratio.toFixed(4)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {c.low_balance ? <Badge variant="destructive">余额不足</Badge> : null}
                            {c.term?.overdue ? <Badge variant="destructive">逾期</Badge> : null}
                            {c.settle_type === "credit" && c.term && !c.term.overdue ? (
                              <span className="text-muted-foreground text-xs">{c.term.days_to_due} 天到期</span>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                        {data.length ? "没有符合条件的客户" : "还没有客户"}
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
