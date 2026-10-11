"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

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
import { get } from "@/modules/ledger/api";
import { amt } from "@/modules/ledger/components/party-wallets";
import { PageHeader, Pager, usePaged } from "@/modules/ledger/components/shared";
import { money, usdf } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { CustomerGroup, CustomersResponse } from "@/modules/ledger/types";

function CustomerTable({
  title,
  description,
  customers,
  withBalance,
  resetKey,
}: {
  title: string;
  description: string;
  customers: CustomerGroup[];
  withBalance: boolean;
  resetKey: string;
}) {
  const router = useRouter();
  const { rows, pager } = usePaged(customers, resetKey);
  const open = (c: CustomerGroup) => router.push(`/dashboard/ledger/customers/${c.detail_party_id}`);
  const cols = withBalance ? 5 : 4;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>客户</TableHead>
                {withBalance ? <TableHead className="text-right">实际余额</TableHead> : null}
                <TableHead className="text-right">累计消费</TableHead>
                <TableHead className="text-right">已结算</TableHead>
                <TableHead className="text-right">未结算</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length ? (
                rows.map((c) => (
                  <TableRow
                    key={c.key}
                    className={cn("cursor-pointer align-top", c.archived && "opacity-60")}
                    onClick={() => open(c)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">
                        {c.name}
                        <Badge variant="outline" className="font-normal">
                          {c.settle_type === "credit" ? "后付" : "预付"}
                        </Badge>
                        {c.low_balance ? <Badge variant="destructive">余额不足</Badge> : null}
                        {c.overdue ? <Badge variant="destructive">逾期</Badge> : null}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {c.project_count} 个项目：{c.parties.map((p) => p.project_name).join("、")}
                      </div>
                    </TableCell>
                    {withBalance ? (
                      <TableCell className="text-right tabular-nums">
                        {c.settle_type === "credit" ? (
                          <span className="text-muted-foreground">授信</span>
                        ) : c.balance_usd != null ? (
                          <span className={cn("text-income font-semibold", c.low_balance && "text-destructive")}>
                            ${amt(c.balance_usd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-expense text-right tabular-nums">{money(c.due_cny)}</TableCell>
                    <TableCell className="text-income text-right tabular-nums">{money(c.paid_cny)}</TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", c.open_cny > 0 && "text-warning")}
                      title={c.open_cny > 0 ? "他还欠我们" : c.open_cny < 0 ? "预付结余 / 多付" : ""}
                    >
                      {(c.open_cny < 0 ? "−" : "") + money(Math.abs(c.open_cny))}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={cols} className="text-muted-foreground py-8 text-center">
                    暂无
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <Pager {...pager} className="mt-4" />
      </CardContent>
    </Card>
  );
}

export default function CustomersPage() {
  const { openPartyNew } = useLedger();
  const { data: pd } = useProjects();
  const { data } = useQuery({
    queryKey: ["ledger", "customers"],
    queryFn: () => get<CustomersResponse>("/customers"),
  });
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const filter = (list: CustomerGroup[]) => {
    const kw = q.trim().toLowerCase();
    return list
      .filter((c) => showArchived || !c.archived)
      .filter(
        (c) =>
          !kw || c.name.toLowerCase().includes(kw) || c.parties.some((p) => p.project_name.toLowerCase().includes(kw)),
      )
      .sort((a, b) => b.due_cny - a.due_cny);
  };
  const relay = useMemo(() => filter(data?.relay_customers ?? []), [data, q, showArchived]);
  const project = useMemo(() => filter(data?.project_customers ?? []), [data, q, showArchived]);
  const usdRate = data?.usd_rate ?? 7.2;

  const all = [...(data?.relay_customers ?? []), ...(data?.project_customers ?? [])].filter((c) => !c.archived);
  const prepaid = all.filter((c) => c.settle_type !== "credit");
  const totalBalUsd = prepaid.reduce((a, c) => a + (c.balance_usd ?? 0), 0); // 中转余额（美金，不乘汇率）
  const totalBalRevUsd = prepaid.reduce((a, c) => a + (c.bal_rev_usd ?? 0), 0); // 余额 × 折扣（美金）
  const totalDue = all.reduce((a, c) => a + c.due_cny, 0); // 累计消费（应收，人民币）
  const totalPaid = all.reduce((a, c) => a + c.paid_cny, 0);
  const totalUnsettled = totalDue - totalPaid; // 未结算 = 累计消费 − 已结算
  const toUsd = (cny: number) => cny / usdRate; // 折人民币 ÷ 汇率 = 美金 × 折扣
  const archivedCount =
    (data?.relay_customers.filter((c) => c.archived).length ?? 0) +
    (data?.project_customers.filter((c) => c.archived).length ?? 0);

  const stats = [
    {
      label: "客户数",
      value: all.length,
      sub: `中转 ${data?.relay_customers.filter((c) => !c.archived).length ?? 0} · 项目制 ${data?.project_customers.filter((c) => !c.archived).length ?? 0}`,
      cls: "",
    },
    {
      label: "中转余额合计",
      value: usdf(totalBalUsd),
      sub: `折后 ${usdf(totalBalRevUsd)} · 余额 × 折扣`,
      cls: "text-income",
    },
    {
      label: "累计消费合计",
      value: money(totalDue),
      sub: `${usdf(toUsd(totalDue))} · 美金 × 折扣`,
      cls: "text-expense",
    },
    {
      label: "未结算",
      value: money(totalUnsettled),
      sub: `累计消费 − 已结算 · ${usdf(toUsd(totalUnsettled))}`,
      cls: totalUnsettled > 0 ? "text-warning" : "",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="客户"
        description="按客户聚合（一个客户可跨多个项目）。有中转项目的在「中转客户」，只有项目制的在「项目制客户」"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus />
                添加客户
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuLabel>加到哪个项目</DropdownMenuLabel>
              {(pd?.projects ?? [])
                .filter((p) => !p.archived)
                .map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => openPartyNew(p.id, "customer")}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
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

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {archivedCount ? (
          <div className="flex items-center gap-2">
            <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="show-archived" className="text-muted-foreground text-sm font-normal">
              显示已归档（{archivedCount}）
            </Label>
          </div>
        ) : null}
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="搜索客户 / 项目" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>

      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <CustomerTable
            title="中转客户"
            description="有中转项目的客户，自动跟踪中转站余额、消费与应收（折扣 = 中转消耗 × 折扣）"
            customers={relay}
            withBalance
            resetKey={`relay|${q}|${showArchived}`}
          />
          <CustomerTable
            title="项目制客户"
            description="只有项目制项目的客户，按实际记账跟踪应收 / 已结算"
            customers={project}
            withBalance={false}
            resetKey={`proj|${q}|${showArchived}`}
          />
        </>
      )}
    </div>
  );
}
