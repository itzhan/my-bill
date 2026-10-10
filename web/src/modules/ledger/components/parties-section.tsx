"use client";

import { Plus, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { PL, curf, fmt, money, relTime, usdf } from "../format";
import { useProjectRelay } from "../hooks";
import { useLedger } from "../provider";
import type { Party, PartyKind, ProjectDetail, RelayLive } from "../types";

import { amt } from "./party-wallets";
import { Pager, usePaged } from "./shared";

function LiveLine({ v, live }: { v: Party; live?: RelayLive }) {
  if (!v.relay) return null;
  const dot = (cls: string) => <span className={cn("inline-block size-1.5 shrink-0 rounded-full", cls)} />;
  if (!live)
    return (
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {dot("bg-muted-foreground/40")}中转站已绑定 · 获取中…
      </div>
    );
  if (live.error)
    return (
      <div className="text-destructive flex items-center gap-1.5 text-xs">
        {dot("bg-destructive")}
        {live.error}
      </div>
    );
  const st = live.settlement;
  const C = st.currency;
  const L = PL[v.kind];
  const ok = v.kind === "customer" ? live.user?.status === "active" : live.account?.status === "active";
  return (
    <div className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <span className="mt-1.5">{dot(ok ? "bg-income" : "bg-warning")}</span>
      <span>
        消耗 {usdf(st.consumption_usd)} × {st.ratio_label} {st.ratio} = {L.due} {curf(st.consumption_x_ratio, C)} · 今日{" "}
        {curf(st.today || 0, C)}
        {live.live ? ` · ${live.live.rpm_now} RPM` : ""}
        {v.kind === "customer" && live.user?.balance_usd !== undefined ? ` · 余额 ${usdf(live.user.balance_usd)}` : ""}
      </span>
    </div>
  );
}

function PartyCard({ v, live, onOpen }: { v: Party; live?: RelayLive; onOpen: () => void }) {
  const L = PL[v.kind];
  const st = v.settle;
  const C = st.currency;
  const openVal = st.open > 0 ? st.open : -st.credit;
  const openLabel = st.credit > 0 ? (v.kind === "customer" ? "预收余额" : "待消耗额度") : L.open;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "hover:bg-accent/50 flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
        v.archived && "opacity-60",
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{v.name}</span>
          {v.relay ? <Badge variant="secondary">中转站</Badge> : null}
          {v.archived ? <Badge variant="outline">归档</Badge> : null}
        </div>
        <div className="text-muted-foreground text-xs">
          {L.due} {curf(st.due, C)} · {L.paid} {curf(st.paid, C)}
          {v.totals.last_at ? ` · ${v.totals.last_at}` : ""}
        </div>
        <LiveLine v={v} live={live} />
        {v.wallet ? (
          <div className="text-muted-foreground text-xs">
            供应商余额 <span className="text-foreground font-medium tabular-nums">{amt(v.wallet.actual)}</span> ·
            累计消费 <span className="text-foreground font-medium tabular-nums">{amt(v.wallet.used)}</span> ·{" "}
            {v.wallet.count} 个 Key
            {v.wallet.errors ? <span className="text-destructive"> · {v.wallet.errors} 个抓取失败</span> : null}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <div
          className={cn("font-semibold tabular-nums", openVal > 0 ? "text-warning" : openVal < 0 ? "text-income" : "")}
        >
          {curf(Math.abs(openVal), C)}
        </div>
        <div className="text-muted-foreground text-xs">
          {openLabel}
          {C !== "CNY" ? ` · ≈¥${fmt(Math.abs(st.open_cny))}` : ""}
        </div>
      </div>
    </button>
  );
}

function PartyColumn({
  kind,
  list,
  detail,
  live,
}: {
  kind: PartyKind;
  list: Party[];
  detail: ProjectDetail;
  live?: Record<string, RelayLive>;
}) {
  const { openParty, openPartyNew } = useLedger();
  const L = PL[kind];
  const t = detail.parties.totals[kind];
  // 排序：供应商按累计消费多的在前；客户按应收多的在前
  const sorted = [...list].sort((a, b) =>
    kind === "supplier" ? (b.wallet?.used ?? 0) - (a.wallet?.used ?? 0) : b.settle.due - a.settle.due,
  );
  const { rows, pager } = usePaged(sorted, list.length);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {L.name} <span className="text-muted-foreground text-sm font-normal">{list.length}</span>
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-3 tabular-nums">
          <span>
            {L.due} {money(t.due)}
          </span>
          <span>
            {L.paid} {money(t.paid)}
          </span>
          <span className={cn(t.open > 0 && "text-warning")}>
            {L.open} {money(t.open)}
          </span>
        </CardDescription>
        {detail.project.archived ? null : (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => openPartyNew(detail.project.id, kind)}>
              <Plus />
              {L.name}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length ? (
          <>
            {rows.map((v) => (
              <PartyCard key={v.id} v={v} live={live?.[v.id]} onOpen={() => openParty(v.id)} />
            ))}
            <Pager {...pager} className="pt-2" />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            还没有{L.name}。
            {kind === "supplier" ? "录入后按天记应付与实付。" : "录入后按天记应收与实收，也可由外部接口自动同步。"}
          </p>
        )}
      </CardContent>
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
        <PartyColumn kind="supplier" list={ps.suppliers} detail={detail} live={relay.data?.parties} />
        <PartyColumn kind="customer" list={ps.customers} detail={detail} live={relay.data?.parties} />
      </div>
      {daily.length ? (
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
