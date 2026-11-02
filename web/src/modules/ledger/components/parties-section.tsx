"use client";

import { Plus, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { PL, money, relTime, signed } from "../format";
import { useProjectRelay } from "../hooks";
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
  const linked = [...ps.suppliers, ...ps.customers].some((v) => v.relay);
  const relay = useProjectRelay(detail.project.id, linked);
  const daily = ps.daily.slice(0, 14);

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        {linked ? (
          <>
            <span>
              {relay.data
                ? `中转站数据 ${relTime(relay.data.fetched_at)} 更新 · 每 30 秒自动刷新`
                : "中转站数据获取中…"}
              ；合计按人民币折算
            </span>
            <Button variant="outline" size="sm" onClick={() => relay.refetch()} disabled={relay.isFetching}>
              <RefreshCw className={cn(relay.isFetching && "animate-spin")} />
              刷新
            </Button>
          </>
        ) : (
          <span>应付 / 应收只挂账，实付 / 实收同步记入流水；合计按人民币折算</span>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <PartyColumn kind="customer" list={ps.customers} detail={detail} />
        <PartyColumn kind="supplier" list={ps.suppliers} detail={detail} />
      </div>
      {detail.project.ptype === "relay" && detail.forecast ? (
        <Card>
          <CardHeader>
            <CardTitle>往来日报</CardTitle>
            <CardDescription>预估利润 = 客户消耗 × 折扣 − 当天付给供应商的钱</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">付给供应商</TableHead>
                    <TableHead className="text-right">客户消耗 × 折扣</TableHead>
                    <TableHead className="text-right">预估利润</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {detail.forecast.daily.slice(0, 14).map((x) => (
                    <TableRow key={x.date}>
                      <TableCell>{x.date}</TableCell>
                      <TableCell className="text-expense text-right">{x.supplier ? money(x.supplier) : "—"}</TableCell>
                      <TableCell className="text-income text-right">{x.customer ? money(x.customer) : "—"}</TableCell>
                      <TableCell className={cn("text-right font-semibold", x.profit < 0 && "text-expense")}>
                        {signed(x.profit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : daily.length ? (
        <Card>
          <CardHeader>
            <CardTitle>往来日报</CardTitle>
            <CardDescription>最近 {daily.length} 天有记录</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">应收</TableHead>
                    <TableHead className="text-right">实收</TableHead>
                    <TableHead className="text-right">应付</TableHead>
                    <TableHead className="text-right">实付</TableHead>
                    <TableHead className="text-right">笔数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {daily.map((x) => (
                    <TableRow key={x.date}>
                      <TableCell>{x.date}</TableCell>
                      <TableCell className="text-right">{x.receivable ? money(x.receivable) : "—"}</TableCell>
                      <TableCell className="text-income text-right">{x.received ? money(x.received) : "—"}</TableCell>
                      <TableCell className="text-right">{x.payable ? money(x.payable) : "—"}</TableCell>
                      <TableCell className="text-expense text-right">{x.paid ? money(x.paid) : "—"}</TableCell>
                      <TableCell className="text-right">{x.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
