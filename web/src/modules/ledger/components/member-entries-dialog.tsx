"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { get } from "@/modules/ledger/api";
import { Pager, usePaged } from "@/modules/ledger/components/shared";
import { curf, money } from "@/modules/ledger/format";
import type { MemberEntries } from "@/modules/ledger/types";

// 点经手人胶囊弹出：该成员经手的全部流水（跨项目，支出/收入、来源项目、供应商、备注）
export function MemberEntriesDialog({
  member,
  onClose,
}: {
  member: { id: number; name: string } | null;
  onClose: () => void;
}) {
  const open = !!member;
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", "member-entries", member?.id],
    queryFn: () => get<MemberEntries>(`/members/${member!.id}/entries`),
    enabled: open,
  });
  const { rows, pager } = usePaged(data?.entries ?? [], String(member?.id ?? ""));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{member?.name} 的流水</DialogTitle>
          <DialogDescription>
            {data
              ? `共 ${data.totals.count} 笔 · 收入 ${money(data.totals.income)} · 支出 ${money(data.totals.expense)}（折人民币）`
              : "该成员经手的全部流水（跨项目）"}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="bg-background sticky top-0">
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>项目</TableHead>
                    <TableHead>供应商 / 备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length ? (
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
                          className={cn(
                            "text-right tabular-nums",
                            e.type === "income" ? "text-income" : "text-expense",
                          )}
                        >
                          {e.type === "income" ? "+" : "−"}
                          {curf(e.amount, e.currency)}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/dashboard/ledger/projects/${e.project_id}`}
                            onClick={onClose}
                            className="text-primary text-xs hover:underline"
                          >
                            {e.project_name}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs">
                          {e.party_name ? <span className="text-muted-foreground mr-1">[{e.party_name}]</span> : null}
                          {e.note || "—"}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
