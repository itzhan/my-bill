"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import { fmtCompact, money, signed } from "../format";
import type { DailyPoint } from "../types";

const mdLabel = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}`;
};

const profitConfig = {
  cumulative: { label: "累计利润", color: "var(--primary)" },
} satisfies ChartConfig;

const dailyConfig = {
  income: { label: "收入", color: "var(--income)" },
  expense: { label: "支出", color: "var(--expense)" },
} satisfies ChartConfig;

export function ProfitChart({ daily }: { daily: DailyPoint[] }) {
  const last = daily[daily.length - 1];
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>利润增长曲线</CardTitle>
        <CardDescription>累计利润（¥），按日</CardDescription>
        <CardAction className="text-right">
          <div className="text-muted-foreground text-xs">期末累计</div>
          <div className={cn("text-lg font-semibold tabular-nums", last && last.cumulative < 0 && "text-expense")}>
            {last ? signed(last.cumulative) : "—"}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={profitConfig} className="aspect-auto h-[240px] w-full">
          <AreaChart data={daily} margin={{ left: 4, right: 8 }}>
            <defs>
              <linearGradient id="fillProfit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-cumulative)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-cumulative)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              tickFormatter={mdLabel}
            />
            <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtCompact(Number(v))} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="line"
                  formatter={(value, _name, item) => {
                    const d = item.payload as DailyPoint;
                    return (
                      <div className="grid w-full gap-1">
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">累计利润</span>
                          <b className={cn("tabular-nums", Number(value) < 0 && "text-expense")}>
                            {signed(Number(value))}
                          </b>
                        </div>
                        {d.count ? (
                          <>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">当日收入</span>
                              <span className="text-income tabular-nums">{money(d.income)}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">当日支出</span>
                              <span className="text-expense tabular-nums">{money(d.expense)}</span>
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">当日无记录</span>
                        )}
                      </div>
                    );
                  }}
                />
              }
            />
            <Area
              dataKey="cumulative"
              type="monotone"
              fill="url(#fillProfit)"
              stroke="var(--color-cumulative)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function DailyChart({ daily }: { daily: DailyPoint[] }) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>每日收支</CardTitle>
        <CardDescription>折算为人民币</CardDescription>
        <CardAction className="text-muted-foreground flex gap-3 text-xs">
          <span className="flex items-center gap-1">
            <i className="bg-income size-2 rounded-sm" />
            收入
          </span>
          <span className="flex items-center gap-1">
            <i className="bg-expense size-2 rounded-sm" />
            支出
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={dailyConfig} className="aspect-auto h-[240px] w-full">
          <BarChart data={daily} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              tickFormatter={mdLabel}
            />
            <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtCompact(Number(v))} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_l, payload) => {
                    const d = payload?.[0]?.payload as DailyPoint | undefined;
                    return d ? `${d.date} · ${d.count ? `${d.count} 笔` : "无记录"}` : "";
                  }}
                  formatter={(value, name) => (
                    <div className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">{name === "income" ? "收入" : "支出"}</span>
                      <span className={cn("tabular-nums", name === "income" ? "text-income" : "text-expense")}>
                        {money(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="income" fill="var(--color-income)" radius={[3, 3, 0, 0]} maxBarSize={24} />
            <Bar dataKey="expense" fill="var(--color-expense)" radius={[3, 3, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
