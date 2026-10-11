"use client";

import { useRouter } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MemberAvatar, PageHeader } from "@/modules/ledger/components/shared";
import { money, signed } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";

// 侧栏「成员」：全体团队成员的总收 / 总付 / 沉淀资金，点进去看该成员的详细流水
export default function MembersPage() {
  const { data } = useProjects();
  const router = useRouter();
  const funds = data?.funds;

  const t = funds?.totals;
  const stats = [
    { label: "成员数", value: funds ? funds.members.length : "-", sub: "有资金记录的成员", cls: "" },
    { label: "经手收款合计", value: t ? money(t.income) : "-", sub: "全体成员经手的收入", cls: "text-income" },
    { label: "经手付款合计", value: t ? money(t.expense) : "-", sub: "全体成员经手的支出", cls: "text-expense" },
    {
      label: "沉淀合计",
      value: t ? signed(t.balance) : "-",
      sub: "= 利润（不含已归档项目）",
      cls: t && t.balance < 0 ? "text-expense" : "text-income",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="成员" description="全体团队成员的总收 / 总付 / 沉淀资金，点一行查看该成员的详细流水与往来" />

      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className={cn("text-2xl font-semibold tabular-nums", s.cls)}>{s.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">{s.sub}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>成员列表</CardTitle>
          <CardDescription>沉淀 = 经手收款 − 经手付款 + 转入 − 转出</CardDescription>
        </CardHeader>
        <CardContent>
          {!funds ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>成员</TableHead>
                    <TableHead className="text-right">总收</TableHead>
                    <TableHead className="text-right">总付</TableHead>
                    <TableHead className="text-right">转入</TableHead>
                    <TableHead className="text-right">转出</TableHead>
                    <TableHead className="text-right">沉淀资金</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {funds.members.length ? (
                    funds.members.map((m) => (
                      <TableRow
                        key={m.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/dashboard/ledger/members/${m.id}`)}
                      >
                        <TableCell>
                          <span className="inline-flex items-center gap-2 font-medium">
                            <MemberAvatar name={m.name} className="size-7 text-xs" />
                            {m.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-income text-right tabular-nums">{money(m.income)}</TableCell>
                        <TableCell className="text-expense text-right tabular-nums">{money(m.expense)}</TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {m.in ? money(m.in) : "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {m.out ? money(m.out) : "-"}
                        </TableCell>
                        <TableCell
                          className={cn("text-right font-semibold tabular-nums", m.balance < 0 && "text-expense")}
                        >
                          {signed(m.balance)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                        还没有资金记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
