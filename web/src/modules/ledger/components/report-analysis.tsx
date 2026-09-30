"use client";

import { useState } from "react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { CUR, fmt, money, signed } from "../format";
import type { Report, TopEntry } from "../types";

const VIEWS: [string, string][] = [
  ["note", "支出用途"],
  ["member", "成员占比"],
  ["currency", "币种构成"],
  ["top", "大额记录"],
  ["monthly", "月度趋势"],
];

const Muted = ({ children = "暂无数据" }: { children?: string }) => (
  <p className="text-muted-foreground text-sm">{children}</p>
);

function HBars<T>({
  items,
  total,
  tone,
  valueOf,
  labelOf,
  subOf,
}: {
  items: T[];
  total: number;
  tone: "income" | "expense";
  valueOf: (x: T) => number;
  labelOf: (x: T) => string;
  subOf?: (x: T) => string;
}) {
  if (!items.length) return <Muted />;
  const max = Math.max(...items.map(valueOf), 1);
  return (
    <div className="space-y-2">
      {items.map((x, i) => {
        const v = valueOf(x);
        return (
          <div key={i} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate" title={labelOf(x)}>
              {labelOf(x)}
            </span>
            <span className="bg-muted h-2 overflow-hidden rounded-full">
              <span
                className={cn("block h-full rounded-full", tone === "income" ? "bg-income" : "bg-expense")}
                style={{ width: `${Math.max(1, (v / max) * 100).toFixed(1)}%` }}
              />
            </span>
            <span className="text-right tabular-nums">
              {money(v)}
              <span className="text-muted-foreground ml-1 text-xs">
                {total ? `${((v / total) * 100).toFixed(1)}%` : ""}
                {subOf ? ` · ${subOf(x)}` : ""}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TopTable({ rows, tone, isProject }: { rows: TopEntry[]; tone: "income" | "expense"; isProject: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            {isProject ? null : <TableHead>项目</TableHead>}
            <TableHead className="text-right">金额</TableHead>
            <TableHead className="text-right">折合 ¥</TableHead>
            <TableHead>经手人</TableHead>
            <TableHead>备注</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-muted-foreground">{e.time}</TableCell>
              {isProject ? null : <TableCell>{e.project}</TableCell>}
              <TableCell className={cn("text-right", tone === "income" ? "text-income" : "text-expense")}>
                <b>
                  {CUR[e.currency].sym}
                  {fmt(e.amount)}
                </b>{" "}
                <span className="text-muted-foreground text-xs">
                  {e.currency}
                  {e.currency !== "CNY" ? ` @${e.rate}` : ""}
                </span>
              </TableCell>
              <TableCell className="text-right">{money(e.cny)}</TableCell>
              <TableCell>{e.handler}</TableCell>
              <TableCell className="max-w-64 truncate">{e.note || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// 项目分析：选中单个项目时有全部 5 个视图；全部项目只看币种 / 大额 / 月度
export function ReportAnalysis({ d }: { d: Report }) {
  const an = d.analysis;
  const isProject = !!d.project;
  const views = isProject ? VIEWS : VIEWS.filter(([k]) => ["currency", "top", "monthly"].includes(k));
  const [view, setView] = useState(views[0]![0]);
  const cur = views.some(([k]) => k === view) ? view : views[0]![0];
  const k = d.kpis;

  let body: React.ReactNode = null;
  switch (cur) {
    case "note":
      body = (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h4 className="text-sm font-medium">
              支出用途 Top {an.byNote.expense.length}
              <span className="text-muted-foreground font-normal"> · 按备注归类，占支出 {money(k.expense.base)}</span>
            </h4>
            <HBars
              items={an.byNote.expense}
              total={k.expense.base}
              tone="expense"
              valueOf={(x) => x.cny}
              labelOf={(x) => x.note}
              subOf={(x) => `${x.count} 笔`}
            />
          </div>
          {an.byNote.income.length ? (
            <div className="space-y-3">
              <h4 className="text-sm font-medium">
                收入来源<span className="text-muted-foreground font-normal"> · 占收入 {money(k.income.base)}</span>
              </h4>
              <HBars
                items={an.byNote.income}
                total={k.income.base}
                tone="income"
                valueOf={(x) => x.cny}
                labelOf={(x) => x.note}
                subOf={(x) => `${x.count} 笔`}
              />
            </div>
          ) : null}
        </div>
      );
      break;
    case "member":
      body = (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h4 className="text-sm font-medium">成员支出占比</h4>
            <HBars
              items={d.byMember.filter((m) => m.expense)}
              total={k.expense.base}
              tone="expense"
              valueOf={(x) => x.expense}
              labelOf={(x) => x.name}
              subOf={(x) => `${x.count} 笔`}
            />
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-medium">成员收款占比</h4>
            <HBars
              items={d.byMember.filter((m) => m.income)}
              total={k.income.base}
              tone="income"
              valueOf={(x) => x.income}
              labelOf={(x) => x.name}
            />
          </div>
        </div>
      );
      break;
    case "currency":
      body = an.byCurrency.length ? (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>币种</TableHead>
                  <TableHead className="text-right">收入（原币）</TableHead>
                  <TableHead className="text-right">折合 ¥</TableHead>
                  <TableHead className="text-right">支出（原币）</TableHead>
                  <TableHead className="text-right">折合 ¥</TableHead>
                  <TableHead className="text-right">笔数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {an.byCurrency.map((c) => (
                  <TableRow key={c.currency}>
                    <TableCell className="font-medium">{c.currency}</TableCell>
                    <TableCell className="text-income text-right">
                      {c.income ? `${CUR[c.currency].sym}${fmt(c.income)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{c.incomeCny ? money(c.incomeCny) : "—"}</TableCell>
                    <TableCell className="text-expense text-right">
                      {c.expense ? `${CUR[c.currency].sym}${fmt(c.expense)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{c.expenseCny ? money(c.expenseCny) : "—"}</TableCell>
                    <TableCell className="text-right">{c.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-xs">折合人民币按每笔记账时的汇率</p>
        </div>
      ) : (
        <Muted />
      );
      break;
    case "top":
      body = (
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-medium">大额支出 Top {an.top.expense.length}</h4>
            {an.top.expense.length ? (
              <TopTable rows={an.top.expense} tone="expense" isProject={isProject} />
            ) : (
              <Muted>暂无</Muted>
            )}
          </div>
          {an.top.income.length ? (
            <div className="space-y-3">
              <h4 className="text-sm font-medium">大额收入 Top {an.top.income.length}</h4>
              <TopTable rows={an.top.income} tone="income" isProject={isProject} />
            </div>
          ) : null}
        </div>
      );
      break;
    case "monthly":
      body = an.monthly.length ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>月份</TableHead>
                <TableHead className="text-right">收入</TableHead>
                <TableHead className="text-right">支出</TableHead>
                <TableHead className="text-right">利润</TableHead>
                <TableHead className="text-right">笔数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {an.monthly.map((m) => (
                <TableRow key={m.month}>
                  <TableCell>{m.month}</TableCell>
                  <TableCell className="text-income text-right">{money(m.income)}</TableCell>
                  <TableCell className="text-expense text-right">{money(m.expense)}</TableCell>
                  <TableCell className={cn("text-right font-semibold", m.profit < 0 && "text-expense")}>
                    {signed(m.profit)}
                  </TableCell>
                  <TableCell className="text-right">{m.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Muted />
      );
      break;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isProject ? `${d.project!.name} · 项目分析` : "分析"}</CardTitle>
        <CardAction>
          <ToggleGroup type="single" variant="outline" size="sm" value={cur} onValueChange={(v) => v && setView(v)}>
            {views.map(([key, label]) => (
              <ToggleGroupItem key={key} value={key} className="px-2.5">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
