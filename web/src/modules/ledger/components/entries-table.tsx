"use client";

import { Fragment, useState } from "react";

import { ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { del } from "../api";
import { dayKey, dayLabel, fmt, fmtTime, money } from "../format";
import { useLedgerRefresh } from "../hooks";
import { useLedger } from "../provider";
import type { Entry, ProjectDetail } from "../types";

import { EntryDetailDialog } from "./entry-detail";
import { MemberAvatar, useConfirm } from "./shared";

// 流水：按日期分组，点击看详情（含图片）；登记人本人或项目创建者可修改 / 删除
export function EntriesTable({ detail }: { detail: ProjectDetail }) {
  const { me, openEntry } = useLedger();
  const refresh = useLedgerRefresh();
  const [confirm, confirmEl] = useConfirm();
  const [filter, setFilter] = useState("all");
  const [viewing, setViewing] = useState<Entry | null>(null);
  const { project: p, entries, rates } = detail;
  const list = entries.filter((e) => filter === "all" || e.type === filter);

  const groups = new Map<string, typeof list>();
  for (const e of list) {
    const k = dayKey(e.created_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const toCny = (e: (typeof list)[number]) => (e.currency === "CNY" ? e.amount : e.amount * (rates[e.currency] ?? 1));

  const remove = async (id: number) => {
    if (
      !(await confirm({
        title: "删除这条记录？",
        description: "此操作不可撤销。",
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    try {
      await del(`/entries/${id}`);
      toast.success("已删除");
      refresh();
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>流水</CardTitle>
        <CardDescription>{entries.length} 笔 · 点击记录查看详情和图片</CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={(v) => v && setFilter(v)}
          >
            <ToggleGroupItem value="all" className="px-3">
              全部
            </ToggleGroupItem>
            <ToggleGroupItem value="expense" className="px-3">
              支出
            </ToggleGroupItem>
            <ToggleGroupItem value="income" className="px-3">
              收入
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {list.length ? (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>内容</TableHead>
                  <TableHead className="hidden sm:table-cell">经手人</TableHead>
                  <TableHead className="hidden md:table-cell">时间</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...groups].map(([k, es]) => {
                  const inc = es.filter((e) => e.type === "income").reduce((a, e) => a + toCny(e), 0);
                  const exp = es.filter((e) => e.type === "expense").reduce((a, e) => a + toCny(e), 0);
                  return (
                    <Fragment key={k}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={5} className="py-1.5 text-xs font-medium">
                          <div className="flex justify-between">
                            <span>{dayLabel(k)}</span>
                            <span className="space-x-3 tabular-nums">
                              {inc ? <span className="text-income">+{money(inc)}</span> : null}
                              {exp ? <span className="text-expense">−{money(exp)}</span> : null}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {es.map((e) => {
                        const canEdit = e.created_by === me.user.id || p.created_by === me.user.id;
                        const isExp = e.type === "expense";
                        const rate = e.rate || rates[e.currency as "USD" | "USDT"];
                        return (
                          <TableRow
                            key={e.id}
                            className="cursor-pointer"
                            onClick={() => setViewing(e)}
                            title="点击查看详情"
                          >
                            <TableCell className="max-w-72">
                              <div className="flex items-center gap-1.5 font-medium">
                                <span className="truncate">{e.note || (isExp ? "支出" : "收入")}</span>
                                {e.images.length ? (
                                  <span
                                    className="text-muted-foreground inline-flex shrink-0 items-center gap-0.5 text-xs font-normal"
                                    title={`${e.images.length} 张图片`}
                                  >
                                    <ImageIcon className="size-3.5" />
                                    {e.images.length > 1 ? e.images.length : null}
                                  </span>
                                ) : null}
                                {e.party_name ? (
                                  <Badge
                                    variant="secondary"
                                    className="shrink-0 font-normal"
                                    title={`充值 / 结算：${e.party_name}`}
                                  >
                                    充值 · {e.party_name}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="text-muted-foreground text-xs sm:hidden">
                                {e.handler_name} {isExp ? "支付" : "收款"} · {fmtTime(e.created_at)}
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <span className="inline-flex items-center gap-1.5">
                                <MemberAvatar name={e.handler_name} className="size-5 text-[10px]" />
                                {e.handler_name} {isExp ? "支付" : "收款"}
                                {e.created_by !== e.handler_id ? (
                                  <span className="text-muted-foreground text-xs">· {e.creator_name} 登记</span>
                                ) : null}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground hidden tabular-nums md:table-cell">
                              {fmtTime(e.created_at)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className={cn("font-medium", isExp ? "text-expense" : "text-income")}>
                                {isExp ? "−" : "+"}
                                {fmt(e.amount)} <span className="text-muted-foreground text-xs">{e.currency}</span>
                              </span>
                              {e.currency !== "CNY" ? (
                                <div className="text-muted-foreground text-xs">
                                  ≈ ¥{fmt(e.amount * rate)} @{rate}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {canEdit ? (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title="删除这条记录"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    remove(e.id);
                                  }}
                                >
                                  <Trash2 />
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>{entries.length ? "没有符合筛选的记录" : "还没有流水"}</EmptyTitle>
              <EmptyDescription>
                {entries.length ? "换个筛选看看。" : "点击「记一笔」，登记谁支付了多少，或者项目收到了多少款。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      <EntryDetailDialog
        entry={viewing}
        canEdit={!!viewing && (viewing.created_by === me.user.id || p.created_by === me.user.id)}
        onOpenChange={(o) => !o && setViewing(null)}
        onEdit={(e) => {
          setViewing(null);
          openEntry({ entry: e });
        }}
      />
      {confirmEl}
    </Card>
  );
}
