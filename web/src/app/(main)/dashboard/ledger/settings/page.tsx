"use client";

import { Suspense, useEffect, useState } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useQueryClient } from "@tanstack/react-query";
import { Copy, LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { post, put } from "@/modules/ledger/api";
import { FormError, MemberAvatar, PageHeader, ResponsiveDialog, useConfirm } from "@/modules/ledger/components/shared";
import { RANGES, maskPhone } from "@/modules/ledger/format";
import { qk, useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { AiInfo, AutoExport, Rates } from "@/modules/ledger/types";

type SettingsResp = { rates: Rates; ai: AiInfo; auto_export: AutoExport; integration_token: string };

function useSaveSettings() {
  const qc = useQueryClient();
  return async (body: Record<string, unknown>) => {
    const d = await put<SettingsResp>("/settings", body);
    qc.invalidateQueries({ queryKey: qk.me });
    return d;
  };
}

function AccountTab() {
  const { me } = useLedger();
  const u = me.user;
  const joined = new Date(u.created_at);
  const logout = async () => {
    await post("/auth/logout").catch(() => {});
    window.location.href = "/auth/login";
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>我的账号</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <MemberAvatar name={u.username} className="size-14 text-xl" />
          <div>
            <div className="text-lg font-semibold">{u.username}</div>
            <div className="text-muted-foreground text-sm">
              {u.phone} · {joined.getFullYear()}年{joined.getMonth() + 1}月加入
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex-col items-start gap-2">
          <p className="text-muted-foreground text-xs">
            外观（深浅色、主题色）在右上角的主题按钮里切换，仅影响这台设备。
          </p>
          <Button variant="outline" className="text-destructive" onClick={logout}>
            <LogOut />
            退出登录
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            团队成员 <span className="text-muted-foreground text-sm font-normal">{me.members.length}</span>
          </CardTitle>
          <CardDescription>用同一个网址注册即可加入。</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {me.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-2.5">
              <MemberAvatar name={m.username} className="size-8 text-sm" />
              <span className="flex-1">
                {m.username} {m.id === u.id ? <Badge variant="secondary">我</Badge> : null}
              </span>
              <span className="text-muted-foreground text-sm tabular-nums">{maskPhone(m.phone)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RatesTab() {
  const { me } = useLedger();
  const save = useSaveSettings();
  const [usd, setUsd] = useState(String(me.rates.USD));
  const [usdt, setUsdt] = useState(String(me.rates.USDT));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rates = { USD: Number(usd), USDT: Number(usdt) };
    if (!(rates.USD > 0) || !(rates.USDT > 0)) return setError("汇率必须是大于 0 的数字");
    setBusy(true);
    setError(null);
    try {
      await save({ rates });
      toast.success("汇率已更新");
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>{label} =</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
        <InputGroupAddon align="inline-end">
          <InputGroupText>CNY</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>汇率设置</CardTitle>
        <CardDescription>
          这里是「当前汇率」：记外币账时自动填入，可在记账时单独改。每笔记录都保存自己当时的汇率，之后改这里不影响已记的账。
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          {row("1 USD", usd, setUsd)}
          {row("1 USDT", usdt, setUsdt)}
          <FormError>{error}</FormError>
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" disabled={busy}>
            保存汇率
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function AiTab() {
  const { me } = useLedger();
  const save = useSaveSettings();
  const ai = me.ai;
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState(ai.model);

  const apply = async (body: Record<string, unknown>, ok: (a: AiInfo) => string) => {
    try {
      const d = await save(body);
      toast.success(ok(d.ai));
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  const known = ai.models.some((m) => m.id === ai.model);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>AI</CardTitle>
        <CardDescription>
          {ai.configured ? (
            <>
              已接入 <code>{ai.model}</code>。报表页可一键生成财务分析，并随数据变动自动更新。
            </>
          ) : (
            <>
              未配置 AI 接口：在服务器的 <code>.env</code> 中设置 <code>ANTHROPIC_AUTH_TOKEN</code> 后重启即可启用。
            </>
          )}
          {ai.relay ? (
            <>
              <br />
              中转站已接入：<code>{ai.relay.name}</code>（{ai.relay.base}），在聊天里问「某某客户今天消耗多少 / 现在 RPM
              多少 / 谁消耗最大」即可。
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>AI 模型（助手、财务报表、知识库整理共用）</Label>
          <Select
            disabled={!ai.configured}
            value={ai.model}
            onValueChange={(v) => {
              if (v === "__custom") {
                setCustom(ai.model);
                setCustomOpen(true);
                return;
              }
              apply({ ai_model: v }, (a) => `AI 模型已切换为 ${a.model}`);
            }}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ai.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
              {known ? null : <SelectItem value={ai.model}>{ai.model}（自定义）</SelectItem>}
              <SelectItem value="__custom">自定义模型名…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <Switch
            disabled={!ai.configured}
            checked={ai.auto}
            onCheckedChange={(v) => apply({ ai_auto: v }, (a) => (a.auto ? "已开启自动刷新" : "已关闭自动刷新"))}
          />
          数据变动后自动刷新最近看过的 AI 报表（约 1 分钟内）
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Switch
            disabled={!ai.configured}
            checked={ai.group_mode === "mention"}
            onCheckedChange={(v) =>
              apply({ group_ai: v ? "mention" : "always" }, () => (v ? "群聊仅 @AI 时回复" : "群聊每条都回复"))
            }
          />
          群聊里只有 @AI 或带附件时才回复（关闭则每条消息都回应）
        </label>
      </CardContent>
      <ResponsiveDialog open={customOpen} onOpenChange={setCustomOpen} title="自定义模型名">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!custom.trim()) return;
            setCustomOpen(false);
            apply({ ai_model: custom.trim() }, (a) => `AI 模型已切换为 ${a.model}`);
          }}
        >
          <Input
            autoFocus
            placeholder="例如 claude-opus-5"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button type="submit" className="w-full">
            保存
          </Button>
        </form>
      </ResponsiveDialog>
    </Card>
  );
}

function ExportTab() {
  const { me } = useLedger();
  const { data: pd } = useProjects();
  const save = useSaveSettings();
  const [ae, setAe] = useState<AutoExport>(me.auto_export);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAe(me.auto_export), [me.auto_export]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ae.time) return setError("请选择时间");
    setBusy(true);
    setError(null);
    try {
      const d = await save({ auto_export: ae });
      toast.success(d.auto_export.enabled ? `每天 ${d.auto_export.time} 自动导出` : "已关闭自动导出");
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>每日自动导出</CardTitle>
        <CardDescription>
          到点自动生成 Excel（含 AI 报表）和 Markdown，保存到「导出记录」，团队成员随时下载。
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={ae.enabled} onCheckedChange={(v) => setAe({ ...ae, enabled: v })} />
            开启每日自动导出
          </label>
          <div className="space-y-2">
            <Label htmlFor="ae-time">时间（每天，{me.tz || "Asia/Shanghai"}）</Label>
            <Input
              id="ae-time"
              type="time"
              className="w-40"
              value={ae.time}
              onChange={(e) => setAe({ ...ae, time: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>范围</Label>
              <Select value={String(ae.scope)} onValueChange={(v) => setAe({ ...ae, scope: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部项目</SelectItem>
                  {pd?.projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>区间</Label>
              <Select value={ae.range} onValueChange={(v) => setAe({ ...ae, range: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGES.filter(([k]) => k !== "custom").map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <FormError>{error}</FormError>
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" disabled={busy}>
            保存
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function IntegrationTab() {
  const { me } = useLedger();
  const save = useSaveSettings();
  const [confirm, confirmEl] = useConfirm();
  const token = me.integration_token || "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择");
    }
  };
  const rotate = async () => {
    if (
      !(await confirm({
        title: "重置对外接口令牌？",
        description: "重置后旧令牌立即失效，外部系统需要改用新令牌。",
        destructive: true,
        confirmText: "重置",
      }))
    )
      return;
    try {
      await save({ rotate_token: true });
      toast.success("令牌已重置");
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>对外接口</CardTitle>
        <CardDescription>
          外部系统用这个令牌调用 <code>POST /api/integrations/records</code> 实时同步应收 / 应付（请求头{" "}
          <code>X-API-Key</code>）。详见账单系统 README。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <code className="bg-muted block overflow-x-auto rounded-md px-3 py-2 text-sm">{token}</code>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copy}>
            <Copy />
            复制
          </Button>
          <Button variant="outline" className="text-destructive" onClick={rotate}>
            <RotateCcw />
            重置令牌
          </Button>
        </div>
      </CardContent>
      {confirmEl}
    </Card>
  );
}

function SettingsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab") || "account";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="设置" description="账单系统的团队设置，对所有成员生效（外观除外）" />
      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}
        className="gap-4"
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="account">账户与成员</TabsTrigger>
          <TabsTrigger value="rates">汇率</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="export">自动导出</TabsTrigger>
          <TabsTrigger value="integration">对外接口</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="rates">
          <RatesTab />
        </TabsContent>
        <TabsContent value="ai">
          <AiTab />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
        <TabsContent value="integration">
          <IntegrationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
