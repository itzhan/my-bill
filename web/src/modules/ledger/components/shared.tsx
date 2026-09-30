"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { TrendingDown, TrendingUp } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import { breakdown, hue, kw, money, signed } from "../format";
import type { Summary } from "../types";

// 电脑上是对话框，手机上是底部抽屉
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description ? <DrawerDescription>{description}</DrawerDescription> : null}
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90dvh] overflow-y-auto sm:max-w-lg", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function MemberAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white",
        className,
      )}
      style={{ background: `oklch(0.62 0.12 ${hue(name)})` }}
    >
      {String(name).slice(0, 1)}
    </span>
  );
}

export function FormError({ children }: { children?: string | null }) {
  if (!children) return null;
  return <p className="text-destructive text-sm">{children}</p>;
}

export const tone = (n: number) => (n < 0 ? "text-expense" : "");

// 收入 / 支出 / 利润三张 KPI 卡（shadmin 仪表盘卡片样式）
export function KpiCards({
  summary,
  deltas,
  profitNote,
}: {
  summary: Summary;
  deltas?: { income?: ReactNode; expense?: ReactNode; profit?: ReactNode };
  profitNote?: string;
}) {
  const s = summary;
  const cards = [
    { label: "收入", value: money(s.income.base), sub: breakdown(s.income), cls: "text-income", delta: deltas?.income },
    {
      label: "支出",
      value: money(s.expense.base),
      sub: breakdown(s.expense),
      cls: "text-expense",
      delta: deltas?.expense,
    },
    {
      label: "利润 = 收入 − 支出",
      value: signed(s.profit),
      sub: profitNote ?? `${s.count} 笔记录 · 按各笔记账时汇率折算`,
      cls: s.profit < 0 ? "text-expense" : "",
      delta: deltas?.profit,
    },
  ];
  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label} className="@container/card gap-3">
          <CardHeader>
            <CardDescription>{c.label}</CardDescription>
            <CardTitle className={cn("text-2xl font-semibold tabular-nums @[250px]/card:text-3xl", c.cls)}>
              {c.value}
            </CardTitle>
            {c.delta ? <CardAction>{c.delta}</CardAction> : null}
          </CardHeader>
          <CardFooter className="text-muted-foreground text-xs">{c.sub}</CardFooter>
        </Card>
      ))}
    </div>
  );
}

// 与上期对比的小徽标
export function DeltaBadge({ cur, prev, kind }: { cur: number; prev: number; kind: "pct" | "abs" }) {
  if (!prev && !cur) return <Badge variant="outline">上期无数据</Badge>;
  const diff = Math.round((cur - prev) * 100) / 100;
  const Icon = diff >= 0 ? TrendingUp : TrendingDown;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const text =
    kind === "pct" && prev > 0 ? `${sign}${Math.abs((diff / prev) * 100).toFixed(1)}%` : `${sign}¥${kw(diff)}`;
  return (
    <Badge variant="outline" title="较上期">
      <Icon />
      {text}
    </Badge>
  );
}

type ConfirmOpts = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  destructive?: boolean;
  // 需要手打确认的文字（例如项目名）
  typeToConfirm?: string;
};

// 用 AlertDialog 替代原生 confirm()：const [confirm, confirmEl] = useConfirm()
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOpts) => {
    setTyped("");
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  const blocked = !!opts?.typeToConfirm && typed.trim() !== opts.typeToConfirm;
  const el = (
    <AlertDialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description ? <AlertDialogDescription>{opts.description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {opts?.typeToConfirm ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              确认请输入：<b className="text-foreground">{opts.typeToConfirm}</b>
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={blocked}
            className={cn(opts?.destructive && "bg-destructive hover:bg-destructive/90 text-white")}
            onClick={(e) => {
              e.preventDefault();
              if (!blocked) close(true);
            }}
          >
            {opts?.confirmText ?? "确定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [confirm, el] as const;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <div className="text-muted-foreground text-sm">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
