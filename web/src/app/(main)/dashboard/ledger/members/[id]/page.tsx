"use client";

import { use } from "react";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { get } from "@/modules/ledger/api";
import { MemberAvatar, Pager, usePaged } from "@/modules/ledger/components/shared";
import { CUR, curf, fmt, money, signed } from "@/modules/ledger/format";
import type { MemberDetail, MemberEntry } from "@/modules/ledger/types";

function EntriesTab({ entries }: { entries: MemberEntry[] }) {
  const { rows, pager } = usePaged(entries, "m-entries");
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>类型</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>供应商 / 备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length ? (
              rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{e.time}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        e.type === "income" ? "text-income border-income/30" : "text-expense border-expense/30",
                      )}
                    >
                      {e.type === "income" ? "收入" : "支出"}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", e.type === "income" ? "text-income" : "text-expense")}
                  >
                    {e.type === "income" ? "+" : "−"}
                    {curf(e.amount, e.currency)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/ledger/projects/${e.project_id}`}
                      className="text-primary text-xs hover:underline"
                    >
                      {e.project_name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-sm truncate text-xs">
                    {e.party_name ? (
                      <Badge variant="secondary" className="mr-1.5 font-normal">
                        {e.party_name}
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground">{e.note || "—"}</span>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                  这个成员还没有经手过流水
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pager {...pager} />
    </div>
  );
}

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const mid = Number(id);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", "member-detail", mid],
    queryFn: () => get<MemberDetail>(`/members/${mid}/detail`),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return <div className="text-muted-foreground py-10 text-center">加载失败</div>;

  const { member, fund, entries, transfers } = data;
  const neg = fund.balance < 0;

  const kpis = [
    {
      label: "总收（经手收款）",
      value: money(fund.income),
      sub: `${entries.filter((e) => e.type === "income").length} 笔收入`,
      cls: "text-income",
    },
    {
      label: "总付（经手付款）",
      value: money(fund.expense),
      sub: `${entries.filter((e) => e.type === "expense").length} 笔支出`,
      cls: "text-expense",
    },
    {
      label: "内部转账",
      value: `转入 ${money(fund.in)} · 转出 ${money(fund.out)}`,
      sub: "成员之间搬钱，不计入收支",
      cls: "",
    },
    {
      label: "沉淀资金",
      value: signed(fund.balance),
      sub: "收 − 付 + 转入 − 转出",
      cls: neg ? "text-expense" : "text-income",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/ledger/members"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> 返回成员列表
        </Link>
        <div className="flex items-center gap-3">
          <MemberAvatar name={member.name} className="size-11 text-base" />
          <h1 className="text-2xl font-semibold">{member.name}</h1>
        </div>
      </div>

      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className={cn("text-xl font-semibold tabular-nums", k.cls)}>{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">{k.sub}</CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">流水（{entries.length}）</TabsTrigger>
          <TabsTrigger value="transfers">转账往来（{transfers.length}）</TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="mt-4">
          <EntriesTab entries={entries} />
        </TabsContent>

        <TabsContent value="transfers" className="mt-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>项目</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.length ? (
                  transfers.map((x) => {
                    const isOut = x.from_id === mid;
                    return (
                      <TableRow key={x.id}>
                        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{x.time}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-sm">
                            <Link
                              href={`/dashboard/ledger/members/${x.from_id}`}
                              className={cn("hover:underline", isOut && "font-medium")}
                            >
                              {x.from}
                            </Link>
                            <ArrowRight className="text-muted-foreground size-3" />
                            <Link
                              href={`/dashboard/ledger/members/${x.to_id}`}
                              className={cn("hover:underline", !isOut && "font-medium")}
                            >
                              {x.to}
                            </Link>
                          </span>
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", isOut ? "text-expense" : "text-income")}>
                          {isOut ? "−" : "+"}
                          {CUR[x.currency].sym}
                          {fmt(x.amount)}
                        </TableCell>
                        <TableCell>
                          {x.project_id ? (
                            <Link
                              href={`/dashboard/ledger/projects/${x.project_id}`}
                              className="text-primary text-xs hover:underline"
                            >
                              {x.project}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-xs">不挂项目</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                          {x.note || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                      还没有转账往来
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
