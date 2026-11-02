"use client";

import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { PL, money, signed } from "../format";
import { useLedger } from "../provider";
import type { Party, PartyKind, ProjectDetail } from "../types";

// 只看对本项目的贡献，人民币。供应商用 project_settle（挂账 / 充值减退款），客户用 settle
function rowOf(v: Party) {
  if (v.kind === "supplier" && v.project_settle) return v.project_settle;
  return { due: v.settle.due_cny, paid: v.settle.paid_cny, open: v.settle.open_cny };
}

function PartyColumn({ kind, list, detail }: { kind: PartyKind; list: Party[]; detail: ProjectDetail }) {
  const { openParty, openPartyNew } = useLedger();
  const L = PL[kind];
  const sorted = [...list].sort((a, b) => rowOf(b).due - rowOf(a).due);
  const sum = sorted.reduce((a, v) => { const r = rowOf(v); return { due: a.due + r.due, paid: a.paid + r.paid, open: a.open + r.open }; }, { due: 0, paid: 0, open: 0 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kind === "customer" ? "甲方" : L.name} <span className="text-muted-foreground text-sm font-normal">{list.length}</span>
        </CardTitle>
        <CardDescription>只统计对本项目的贡献</CardDescription>
        {detail.project.archived ? null : (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (kind === "supplier" ? openPartyNew(0, "supplier") : openPartyNew(detail.project.id, kind))}
            >
              <Plus />
              {L.name}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {sorted.length ? (
        <CardContent>
        <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead className="text-right">{L.due}</TableHead>
              <TableHead className="text-right">{L.paid}</TableHead>
              <TableHead className="text-right">{L.open}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {sorted.map((v) => {
              const r = rowOf(v);
              return (
                <TableRow key={v.id} className="cursor-pointer" onClick={() => openParty(v.id)}>
                  <TableCell className="font-medium">
                    {v.name}
                    {v.archived ? <Badge variant="outline" className="ml-1.5">归档</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right">{money(r.due)}</TableCell>
                  <TableCell className="text-right">{money(r.paid)}</TableCell>
                  <TableCell className={cn("text-right", r.open > 0 && "text-warning")}>{signed(r.open)}</TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell className="font-medium">合计</TableCell>
              <TableCell className="text-right font-medium">{money(sum.due)}</TableCell>
              <TableCell className="text-right font-medium">{money(sum.paid)}</TableCell>
              <TableCell className={cn("text-right font-medium", sum.open > 0 && "text-warning")}>{signed(sum.open)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        </div>
        </CardContent>
      ) : (
        <CardContent><p className="text-muted-foreground text-sm">还没有{kind === "customer" ? "甲方" : L.name}。</p></CardContent>
      )}
    </Card>
  );
}

export function PartiesSection({ detail }: { detail: ProjectDetail }) {
  const ps = detail.parties;

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground text-xs">
        <span>后台每 5 分钟更新，这里显示的是上次算好的结果；合计按人民币折算</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <PartyColumn kind="customer" list={ps.customers} detail={detail} />
        <PartyColumn kind="supplier" list={ps.suppliers} detail={detail} />
      </div>
    </div>
  );
}
