"use client";

import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { del } from "../api";
import { CUR, CURRENCIES, fmt, money, signed } from "../format";
import { useLedgerRefresh } from "../hooks";
import { useLedger } from "../provider";
import type { FundMember, Funds } from "../types";

import { MemberAvatar, useConfirm } from "./shared";

function FundCard({ m, onClick }: { m: FundMember; onClick: () => void }) {
  const bits = CURRENCIES.filter((c) => c !== "CNY" && m.cur.balance[c])
    .map((c) => `${CUR[c].sym}${fmt(m.cur.balance[c])} ${c}`)
    .join(" · ");
  const neg = m.balance < 0;
  // 负数分两种：自己垫了钱（付得比收得多），或者只是把手上的钱转给了别人
  const negLabel = m.expense - m.income > 0 ? "垫付" : "已转出";
  return (
    <button
      type="button"
      onClick={onClick}
      title="点这里给他记一笔转账"
      className="hover:bg-accent/50 flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
    >
      <MemberAvatar name={m.name} className="size-9 text-sm" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium">{m.name}</div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs tabular-nums">
          <span className="text-income">收 {money(m.income)}</span>
          <span className="text-expense">付 {money(m.expense)}</span>
          {m.in ? <span>转入 {money(m.in)}</span> : null}
          {m.out ? <span>转出 {money(m.out)}</span> : null}
        </div>
        {bits ? <div className="text-muted-foreground text-xs">含外币：{bits}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        <div className={cn("font-semibold tabular-nums", neg && "text-expense")}>{signed(m.balance)}</div>
        <div className="text-muted-foreground text-xs">{neg ? negLabel : "沉淀"}</div>
      </div>
    </button>
  );
}

export function FundsSection({
  funds,
  projectId,
  projectOwner,
}: {
  funds: Funds;
  projectId: number | null;
  projectOwner?: number;
}) {
  const { me, openTransfer } = useLedger();
  const refresh = useLedgerRefresh();
  const [confirm, confirmEl] = useConfirm();
  const t = funds.totals;

  const removeTransfer = async (id: number) => {
    if (
      !(await confirm({
        title: "删除这笔转账？",
        description: "双方的资金沉淀会一起恢复。",
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    try {
      await del(`/transfers/${id}`);
      toast.success("已删除");
      refresh();
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>成员资金</CardTitle>
          <CardDescription>
            沉淀 = 经手收款 − 经手付款 + 转入 − 转出；转账只是成员之间搬钱{projectId ? "" : "（不含已归档项目）"}
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => openTransfer({ projectId })}>
              <Plus />
              记转账
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {funds.members.length ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {funds.members.map((m) => (
                  <FundCard key={m.id} m={m} onClick={() => openTransfer({ projectId, fromId: m.id })} />
                ))}
              </div>
              <div className="bg-muted/40 text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 rounded-lg px-3 py-2 text-xs">
                <span>
                  经手收款 <b className="text-foreground">{money(t.income)}</b>
                </span>
                <span>
                  经手付款 <b className="text-foreground">{money(t.expense)}</b>
                </span>
                <span>
                  内部调拨 <b className="text-foreground">{money(t.in)}</b>（成员之间搬钱，不计入收支）
                </span>
                <span>
                  沉淀合计 <b className={cn("text-foreground", t.balance < 0 && "text-expense")}>{signed(t.balance)}</b>
                  ＝{projectId ? "本项目" : ""}利润
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">还没有资金记录</p>
          )}
        </CardContent>
      </Card>

      {funds.transfers.length ? (
        <Card>
          <CardHeader>
            <CardTitle>成员之间的转账</CardTitle>
            <CardDescription>{funds.transfers.length} 笔</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>转账</TableHead>
                    <TableHead className="hidden md:table-cell">说明</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {funds.transfers.map((x) => {
                    const canDel = x.created_by === me.user.id || projectOwner === me.user.id;
                    return (
                      <TableRow key={x.id}>
                        <TableCell className="text-muted-foreground tabular-nums">{x.time}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            {x.from} <ArrowRight className="size-3" /> {x.to}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden max-w-64 truncate md:table-cell">
                          {[x.project && !projectId ? x.project : "", x.note, `${x.creator} 登记`]
                            .filter(Boolean)
                            .join(" · ")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {CUR[x.currency].sym}
                          {fmt(x.amount)}
                          {x.currency !== "CNY" ? (
                            <div className="text-muted-foreground text-xs">≈¥{fmt(x.cny)}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {canDel ? (
                            <Button variant="ghost" size="icon-sm" onClick={() => removeTransfer(x.id)} title="删除">
                              <Trash2 />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {confirmEl}
    </div>
  );
}
