"use client";

import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";

import { get } from "../api";
import type { ProfitDaily } from "../types";

import { ForecastChart } from "./report-charts";

// 总览趋势：每日预估利润（客户消耗 − 供应商消耗），后台缓存，打开即显示
export function OverviewTrends() {
  const { data } = useQuery({
    queryKey: ["ledger", "profit-daily"],
    queryFn: () => get<ProfitDaily>("/profit/daily"),
  });
  const daily = data ? [...data.daily].reverse() : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">每日预估利润</h2>
        <p className="text-muted-foreground text-sm">中转和上 key 项目，按客户消耗 − 供应商消耗</p>
      </div>
      {data ? <ForecastChart daily={daily} /> : <Skeleton className="h-80" />}
    </div>
  );
}

