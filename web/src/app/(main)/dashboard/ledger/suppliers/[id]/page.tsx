"use client";

import { use, useEffect, useState } from "react";

import Link from "next/link";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, ExternalLink, Globe, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { del, get, patch, post } from "@/modules/ledger/api";
import { amt, amtFull } from "@/modules/ledger/components/party-wallets";
import { FormError, Pager, ResponsiveDialog, useConfirm, usePaged } from "@/modules/ledger/components/shared";
import { curf, fmt0, money, relTime, signed } from "@/modules/ledger/format";
import { useLedgerRefresh } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { ConsumePoint, SupplierDetail, SupplierSite, WalletDetail, WalletGroup } from "@/modules/ledger/types";

// 分组类型配色
const TYPE_CLS: Record<string, string> = {
  Claude: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  Gemini: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  GPT: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Grok: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  DeepSeek: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  Qwen: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};
const TypeBadge = ({ t }: { t: string }) => (
  <span
    className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", TYPE_CLS[t] ?? "bg-muted text-muted-foreground")}
  >
    {t}
  </span>
);

const TYPE_ORDER = ["Claude", "Gemini", "GPT", "Grok", "DeepSeek", "Qwen", "其他", "未分类"];

function GroupsByType({ groups }: { groups: WalletGroup[] }) {
  const byType = new Map<string, WalletGroup[]>();
  for (const g of groups) {
    for (const t of g.types.length ? g.types : ["未分类"]) {
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(g);
    }
  }
  const types = [...byType.keys()].sort(
    (a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99),
  );
  return (
    <div className="space-y-4">
      {types.map((t) => {
        const gs = byType
          .get(t)!
          .slice()
          .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
        return (
          <div key={t}>
            <div className="mb-2 flex items-center gap-2">
              <TypeBadge t={t} />
              <span className="text-muted-foreground text-xs">{gs.length} 个分组</span>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>分组</TableHead>
                    <TableHead className="text-right">倍率</TableHead>
                    <TableHead className="text-right">模型数</TableHead>
                    <TableHead>介绍</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gs.map((g) => (
                    <TableRow key={g.name}>
                      <TableCell className="font-medium">{g.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.ratio == null ? "—" : `×${+g.ratio.toFixed(4)}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{g.model_count}</TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{g.desc || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyBars({ data }: { data: ConsumePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div className="text-muted-foreground py-6 text-center text-sm">近 30 天没有消耗</div>;
  const max = Math.max(...data.map((d) => d.usd), 0.0001);
  const hd = hover != null ? data[hover] : null;
  return (
    <div>
      <div className="mb-1 h-5 text-xs">
        {hd ? (
          <>
            <span className="font-medium">{hd.date}</span>{" "}
            <span className="text-expense font-semibold">{money(hd.usd)}</span>{" "}
            <span className="text-muted-foreground">· {fmt0(hd.count)} 次</span>
          </>
        ) : (
          <span className="text-muted-foreground">鼠标悬浮查看当日消耗</span>
        )}
      </div>
      <div className="flex h-28 items-end gap-0.5">
        {data.map((d, i) => (
          <div
            key={d.date}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            className={cn(
              "min-w-0 flex-1 rounded-t-sm transition-colors",
              hover === i ? "bg-expense" : "bg-expense/70",
            )}
            style={{ height: `${Math.max(2, (d.usd / max) * 100)}%` }}
            title={`${d.date} · ${money(d.usd)} · ${fmt0(d.count)} 次`}
          />
        ))}
      </div>
      <div className="text-muted-foreground mt-1 flex justify-between text-[10px] tabular-nums">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function WalletConsume({ w }: { w: WalletDetail }) {
  if (!w.ok) return <div className="text-destructive text-sm">抓取失败：{w.error}</div>;
  const byModel = w.byModel ?? [];
  const byGroup = (w.byGroup ?? []).filter((g) => g.usd > 0);
  const splitByGroup = byGroup.length > 1;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-xs">
          近 {w.period_days ?? 30} 天消耗 · 合计{" "}
          <span className="text-expense font-semibold">{money(w.period_used ?? 0)}</span>
        </span>
      </div>
      <DailyBars data={w.daily ?? []} />
      {w.note ? <p className="text-muted-foreground text-xs">{w.note}</p> : null}
      <div className={cn("grid gap-4", splitByGroup && "lg:grid-cols-2")}>
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-medium">按模型</div>
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模型</TableHead>
                  <TableHead className="text-right">消耗</TableHead>
                  <TableHead className="text-right">请求</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byModel.length ? (
                  byModel.slice(0, 20).map((m) => (
                    <TableRow key={m.model}>
                      <TableCell className="font-mono text-xs">{m.model || "—"}</TableCell>
                      <TableCell className="text-expense text-right tabular-nums">{money(m.usd)}</TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                        {fmt0(m.count)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground py-6 text-center text-sm">
                      近 30 天无消耗
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        {splitByGroup ? (
          <div>
            <div className="text-muted-foreground mb-2 text-xs font-medium">按分组</div>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>分组</TableHead>
                    <TableHead className="text-right">消耗</TableHead>
                    <TableHead className="text-right">请求</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byGroup.map((g) => (
                    <TableRow key={g.group}>
                      <TableCell className="text-xs">{g.group}</TableCell>
                      <TableCell className="text-expense text-right tabular-nums">{money(g.usd)}</TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                        {fmt0(g.count)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// 添加 / 编辑供应商站点：平台 + 地址 + 访问令牌 + 自定义倍率（含按日期分段倍率）；编辑时自动同步到同站点所有绑定 Key
function SiteFormDialog({
  supplierId,
  supplierName,
  site,
  open,
  onOpenChange,
  onDone,
}: {
  supplierId: number;
  supplierName: string;
  site: SupplierSite | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [confirm, confirmEl] = useConfirm();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [platform, setPlatform] = useState<"newapi" | "sub2api">("newapi");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [tokenUserId, setTokenUserId] = useState("");
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [custom, setCustom] = useState(false);
  const [customRatio, setCustomRatio] = useState("");
  const [consumeRatio, setConsumeRatio] = useState("");
  const [consumeRates, setConsumeRates] = useState<{ from_date: string; custom_ratio: string; ratio: string }[]>([]);
  const [usedAdjust, setUsedAdjust] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (site) {
      const tpl = site.wallets.find((w) => w.id === site.template_wallet_id);
      setName(site.name);
      setNote(site.note || "");
      setPlatform(site.platform);
      setBaseUrl(site.base_url);
      setAccessToken("");
      setTokenUserId(site.token_user_id || "");
      setLoginUser(site.login_user || "");
      setLoginPass("");
      setCustom(site.custom);
      setCustomRatio(site.custom_ratio == null ? "" : String(site.custom_ratio));
      setConsumeRatio(site.consume_ratio == null ? "" : String(site.consume_ratio));
      setConsumeRates(
        (site.consume_rates ?? []).map((r) => ({
          from_date: r.from_date,
          custom_ratio: r.custom_ratio != null ? String(r.custom_ratio) : site.custom_ratio != null ? String(site.custom_ratio) : "",
          ratio: String(r.ratio),
        })),
      );
      setUsedAdjust(tpl?.used_adjust ? String(tpl.used_adjust) : "");
      setInsecure(site.insecure);
    } else {
      setName("");
      setNote("");
      setPlatform("newapi");
      setBaseUrl("");
      setAccessToken("");
      setTokenUserId("");
      setLoginUser("");
      setLoginPass("");
      setCustom(false);
      setCustomRatio("");
      setConsumeRatio("");
      setConsumeRates([]);
      setUsedAdjust("");
      setInsecure(false);
    }
  }, [open, site]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^https?:\/\//i.test(baseUrl.trim())) return setError("地址需以 http:// 或 https:// 开头");
    if (!site) {
      if (platform === "newapi" && !accessToken.trim()) return setError("请填写访问令牌");
      if (platform === "sub2api" && !accessToken.trim() && !(loginUser.trim() && loginPass.trim())) {
        return setError("请填写访问令牌或站点登录邮箱密码");
      }
    }
    if (custom && !(Number(customRatio) > 0)) return setError("自定义倍率必须大于 0");
    if (custom && consumeRatio.trim() && !(Number(consumeRatio) > 0)) return setError("消耗倍率必须大于 0");
    if (custom) {
      for (const row of consumeRates) {
        if (!row.from_date && !row.ratio.trim() && !row.custom_ratio.trim()) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.from_date)) return setError("分段日期需为 YYYY-MM-DD");
        if (!(Number(row.custom_ratio) > 0) || !(Number(row.ratio) > 0)) return setError("分段充值与消耗倍率必须大于 0");
      }
    }
    setBusy(true);
    setError(null);
    try {
      let host = baseUrl.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      try {
        host = new URL(baseUrl.trim()).host;
      } catch {}
      const ratesPayload = custom
        ? consumeRates
            .filter((r) => r.from_date && Number(r.custom_ratio) > 0 && Number(r.ratio) > 0)
            .map((r) => ({ from_date: r.from_date, custom_ratio: Number(r.custom_ratio), ratio: Number(r.ratio) }))
        : [];
      const payload: Record<string, unknown> = {
        name: name.trim() || host,
        note: note.trim(),
        platform,
        base_url: baseUrl.trim(),
        token_user_id: tokenUserId.trim(),
        login_user: loginUser.trim(),
        custom,
        custom_ratio: custom ? Number(customRatio) : null,
        consume_ratio: custom ? (Number(consumeRatio) > 0 ? Number(consumeRatio) : Number(customRatio)) : null,
        consume_rates: ratesPayload,
        used_adjust: Number(usedAdjust) > 0 ? Number(usedAdjust) : 0,
        insecure,
      };
      if (accessToken.trim()) payload.access_token = accessToken.trim();
      if (loginPass.trim()) payload.login_pass = loginPass.trim();

      const { wallet } = site
        ? await patch<{ wallet: { last_error: string } }>(`/party-wallets/${site.template_wallet_id}`, {
            ...payload,
            sync_site: true,
          })
        : await post<{ wallet: { last_error: string } }>(`/parties/${supplierId}/wallets`, {
            ...payload,
            cost_mode: "account",
          });
      if (wallet.last_error) toast.warning(`站点已保存，抓取提示：${wallet.last_error}`);
      else toast.success(site ? "站点已更新并重新抓取" : "站点已添加并抓取成功");
      onOpenChange(false);
      onDone();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeSite = async () => {
    if (!site) return;
    if (
      !(await confirm({
        title: `删除站点「${site.name}」？`,
        description: `将删除该站点（${site.host}）及其名下全部 ${site.wallets.length} 条监控记录，不可恢复。`,
        destructive: true,
        confirmText: "删除站点",
      }))
    )
      return;
    setBusy(true);
    try {
      await del(`/party-wallets/${site.template_wallet_id}?site=1`);
      toast.success("站点已删除");
      onOpenChange(false);
      onDone();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={site ? `编辑站点「${site.name}」` : `给「${supplierName}」添加站点`}
      description={site ? "修改凭据或自定义倍率后，将自动同步到该站点下所有已关联项目的 Key" : undefined}
    >
      <form onSubmit={submit} className="space-y-4">
        {site ? (
          <div className="space-y-1.5">
            <Label>站点名称</Label>
            <Input maxLength={60} placeholder={site.host} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[8.5rem_1fr]">
          <div className="space-y-1.5">
            <Label>平台 *</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as "newapi" | "sub2api")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newapi">new-api</SelectItem>
                <SelectItem value="sub2api">sub2api</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>地址 *</Label>
            <Input placeholder="https://api.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>备注（可选）</Label>
          <Input
            maxLength={200}
            placeholder="例如：awsb 主站 / fable 渠道 / 备用池"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {platform === "newapi" ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label>访问令牌 {site?.has_token ? "（留空不修改）" : "*"}</Label>
              <Input
                type="password"
                autoComplete="off"
                placeholder={site?.has_token ? "已配置，留空保持不变" : "系统访问令牌"}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>用户 ID（选填）</Label>
              <Input
                inputMode="numeric"
                placeholder="老版本需要"
                value={tokenUserId}
                onChange={(e) => setTokenUserId(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label>访问令牌 {site?.has_token ? "（留空不修改）" : "（或填下方登录账号密码）"}</Label>
              <Input
                type="password"
                autoComplete="off"
                placeholder={site?.has_token ? "已配置，留空保持不变" : "访问令牌（JWT）"}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="或登录邮箱" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={site?.has_login ? "登录密码（留空不修改）" : "登录密码"}
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="bg-muted/30 space-y-3 rounded-lg border p-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">自定义倍率</span>
              <span className="text-muted-foreground block text-xs">关联到项目时自动继承，无需重复设置</span>
            </span>
            <Switch checked={custom} onCheckedChange={setCustom} />
          </label>
          {custom ? (
            <div className="space-y-3 pt-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">自定义倍率（充值）*</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="如 3.6"
                    value={customRatio}
                    onChange={(e) => setCustomRatio(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">消耗倍率（默认同左）</Label>
                  <Input
                    inputMode="decimal"
                    placeholder={customRatio || "如 3.6"}
                    value={consumeRatio}
                    onChange={(e) => setConsumeRatio(e.target.value)}
                  />
                </div>
              </div>
              {site ? (
                <div className="space-y-2 border-t pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">按日期调价（某日起用新倍率）</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() =>
                        setConsumeRates((rows) => [
                          ...rows,
                          { from_date: "", custom_ratio: customRatio, ratio: consumeRatio || customRatio },
                        ])
                      }
                    >
                      <Plus className="size-3.5" />
                      添加分段
                    </Button>
                  </div>
                  {consumeRates.map((row, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2">
                      <Input
                        type="date"
                        className="h-8 w-36"
                        value={row.from_date}
                        onChange={(e) =>
                          setConsumeRates((rows) =>
                            rows.map((x, j) => (j === idx ? { ...x, from_date: e.target.value } : x)),
                          )
                        }
                      />
                      <span className="text-muted-foreground text-xs">起 充</span>
                      <Input
                        inputMode="decimal"
                        className="h-8 w-16"
                        value={row.custom_ratio}
                        onChange={(e) =>
                          setConsumeRates((rows) =>
                            rows.map((x, j) => (j === idx ? { ...x, custom_ratio: e.target.value } : x)),
                          )
                        }
                      />
                      <span className="text-muted-foreground text-xs">耗</span>
                      <Input
                        inputMode="decimal"
                        className="h-8 w-16"
                        value={row.ratio}
                        onChange={(e) =>
                          setConsumeRates((rows) =>
                            rows.map((x, j) => (j === idx ? { ...x, ratio: e.target.value } : x)),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setConsumeRates((rows) => rows.filter((_, j) => j !== idx))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {site ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="w-20 shrink-0 text-xs">扣减多算</Label>
              <Input
                inputMode="decimal"
                className="w-28"
                placeholder="0"
                value={usedAdjust}
                onChange={(e) => setUsedAdjust(e.target.value)}
              />
              <span className="text-muted-foreground text-xs">扣减站点多计的金额</span>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">跳过证书校验</span>
                <span className="text-muted-foreground block text-xs">IP 站或证书不匹配时打开</span>
              </span>
              <Switch checked={insecure} onCheckedChange={setInsecure} />
            </label>
          </div>
        ) : null}
        <FormError>{error}</FormError>
        <div className="flex items-center justify-between gap-2">
          {site ? (
            <Button type="button" variant="outline" className="text-destructive" onClick={removeSite} disabled={busy}>
              <Trash2 />
              删除站点
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "保存并抓取中…" : site ? "保存修改" : "添加站点"}
            </Button>
          </div>
        </div>
      </form>
      {confirmEl}
    </ResponsiveDialog>
  );
}

// 站点卡片：展示单个站点的平台、地址、自定义倍率、累计消费、当前余额以及在该站点绑定的项目 Key；点击卡片可编辑站点
function SiteCard({
  site,
  busy,
  onRefresh,
  onEdit,
}: {
  site: SupplierSite;
  busy: boolean;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const keyRows = site.wallets.filter((w) => w.cost_mode === "key" || w.project_name);
  return (
    <Card
      onClick={onEdit}
      className="hover:border-primary/40 flex cursor-pointer flex-col justify-between gap-3 py-5 transition-colors"
    >
      <CardHeader className="px-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Globe className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate">{site.name}</span>
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-1.5">
              <a
                href={site.base_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-primary inline-flex max-w-full items-center gap-1 hover:underline"
              >
                <span className="truncate font-mono text-xs">{site.host}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            </CardDescription>
            {site.note ? (
              <p className="text-muted-foreground line-clamp-2 text-xs" title={site.note}>
                {site.note}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title="编辑站点"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              disabled={busy}
              title="刷新该站点"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Badge variant="outline" className="font-normal">
            {site.platform === "sub2api" ? "sub2api" : "new-api"}
          </Badge>
          {site.custom ? (
            <Badge variant="secondary" className="font-normal">
              自定义倍率 充×{site.custom_ratio ?? "-"} / 耗×{site.consume_ratio ?? site.custom_ratio ?? 1}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground text-xs">累计消费</div>
            <div className="text-expense mt-1 text-lg font-semibold tabular-nums" title={amtFull(site.used)}>
              {amt(site.used)}
            </div>
            {site.today != null ? (
              <div className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">今日 {amt(site.today)}</div>
            ) : null}
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-muted-foreground text-xs">当前余额</div>
            <div className="text-income mt-1 text-lg font-semibold tabular-nums" title={amtFull(site.actual)}>
              {amt(site.actual)}
            </div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              {site.last_checked_at ? `${relTime(site.last_checked_at)}更新` : "未抓取"}
            </div>
          </div>
        </div>

        {keyRows.length ? (
          <div className="space-y-1.5 border-t pt-2.5">
            <div className="text-muted-foreground flex items-center gap-1 text-xs">
              <KeyRound className="size-3" />
              <span>已关联项目 Key（{keyRows.length}）</span>
            </div>
            <div className="space-y-1">
              {keyRows.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{w.name}</span>
                    {w.project_name ? (
                      <Link
                        href={`/dashboard/ledger/projects/${w.project_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary ml-1.5 hover:underline"
                      >
                        {w.project_name}
                      </Link>
                    ) : null}
                  </span>
                  <span className="text-expense shrink-0 tabular-nums">{amt(w.billed_used ?? w.last_used_actual)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {site.last_error ? <p className="text-warning text-xs">{site.last_error}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sid = Number(id);
  const { openParty } = useLedger();
  const qc = useQueryClient();
  const refreshLedger = useLedgerRefresh();
  const [siteModal, setSiteModal] = useState<{ open: boolean; site: SupplierSite | null }>({ open: false, site: null });
  const [refreshingSite, setRefreshingSite] = useState<string | null>(null);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ledger", "supplier-detail", sid],
    queryFn: () => get<SupplierDetail>(`/suppliers/${sid}/detail`),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return <div className="text-muted-foreground py-10 text-center">加载失败</div>;

  const { party, wallets, sites = [], project_contributions = [] } = data;
  const okWallets = wallets.filter((w) => w && w.id);
  const st = party.supplier_totals ?? { due: 0, paid: 0, balance: 0, relay_due: 0, other_due: 0 };
  const totalActual = sites.reduce((a, s) => a + (s.actual ?? 0), 0);

  const reloadAll = () => {
    qc.invalidateQueries({ queryKey: ["ledger", "supplier-detail", sid] });
    refreshLedger();
  };

  const refreshSite = async (site: SupplierSite) => {
    setRefreshingSite(site.base_url);
    try {
      for (const w of site.wallets.filter((x) => x.enabled)) {
        await post(`/party-wallets/${w.id}/refresh`);
      }
      toast.success(`已刷新站点 ${site.host}`);
      reloadAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshingSite(null);
    }
  };

  const kpis = [
    {
      label: "应付合计",
      value: money(st.due),
      sub:
        st.relay_due && st.other_due
          ? `中转 ${money(st.relay_due)} + 其他项目 ${money(st.other_due)}`
          : st.other_due
            ? "来自上 key / 项目制贡献"
            : "来自中转站点累计消费",
      cls: "text-expense",
    },
    {
      label: "实付合计",
      value: money(st.paid),
      sub: "已实际支付给该供应商（扣除退款）",
      cls: "text-income",
    },
    {
      label: st.balance < 0 ? "结余（我们还欠）" : "结余（预付余款）",
      value: signed(st.balance),
      sub: "实付 − 应付（正=预付结余，负=我们还欠）",
      cls: st.balance < 0 ? "text-warning" : "text-income",
    },
    {
      label: "站点余额合计",
      value: sites.length ? amt(totalActual) : "—",
      sub: sites.length ? `共 ${sites.length} 个站点；自定义倍率已自动折算` : "尚未配置中转站点",
      cls: "text-income",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */}
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/ledger/suppliers"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> 返回供应商列表
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{party.name}</h1>
              {party.archived ? <Badge variant="outline">归档</Badge> : null}
            </div>
            {party.contact ? <p className="text-muted-foreground text-sm">联系方式：{party.contact}</p> : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn(isFetching && "animate-spin")} />
              刷新
            </Button>
            <Button variant="outline" onClick={() => openParty(sid)}>
              <Pencil />
              管理 / 记账
            </Button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className={cn("text-2xl font-semibold tabular-nums", k.cls)}>{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">{k.sub}</CardContent>
          </Card>
        ))}
      </div>

      {/* 站点卡片区 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">站点情况（{sites.length}）</h2>
            <p className="text-muted-foreground text-xs">展示该供应商的所有站点消费与余额，点击卡片可编辑站点配置</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSiteModal({ open: true, site: null })}>
            <Plus />
            添加站点
          </Button>
        </div>
        {sites.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sites.map((site) => (
              <SiteCard
                key={site.base_url}
                site={site}
                busy={refreshingSite === site.base_url}
                onRefresh={() => refreshSite(site)}
                onEdit={() => setSiteModal({ open: true, site })}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              该供应商暂未配置中转站点，点右上角「添加站点」即可追踪站点消费与余额
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="funds">
        <TabsList>
          <TabsTrigger value="funds">资金往来</TabsTrigger>
          {project_contributions.length ? (
            <TabsTrigger value="contrib">其他项目贡献（{project_contributions.length}）</TabsTrigger>
          ) : null}
          {okWallets.length ? <TabsTrigger value="groups">分组</TabsTrigger> : null}
          {okWallets.length ? <TabsTrigger value="consume">消耗明细</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="funds" className="mt-4">
          <FundsTab detail={data} />
        </TabsContent>

        {project_contributions.length ? (
          <TabsContent value="contrib" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">其他项目贡献</CardTitle>
                <CardDescription>该供应商在上 key / 项目制等项目中的应付挂账汇总</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>项目</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead className="text-right">记录数</TableHead>
                        <TableHead className="text-right">应付金额</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {project_contributions.map((c) => (
                        <TableRow key={c.project_id}>
                          <TableCell className="font-medium">
                            {c.project_id ? (
                              <Link
                                href={`/dashboard/ledger/projects/${c.project_id}`}
                                className="text-primary hover:underline"
                              >
                                {c.project_name}
                              </Link>
                            ) : (
                              c.project_name
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {c.ptype === "key" ? "上key" : c.ptype === "relay" ? "中转" : "项目制"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-right tabular-nums">{c.count}</TableCell>
                          <TableCell className="text-expense text-right font-medium tabular-nums">
                            {money(c.due_cny)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {okWallets.length ? (
          <TabsContent value="groups" className="mt-4 space-y-4">
            {okWallets.map((w) => (
              <Card key={w.id}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {w.name}
                    <Badge variant="outline" className="ml-2 font-normal">
                      {w.platform === "sub2api" ? "sub2api" : "new-api"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{w.base_url.replace(/^https?:\/\//, "")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {!w.ok ? (
                    <div className="text-destructive text-sm">抓取失败：{w.error}</div>
                  ) : !(w.groups ?? []).length ? (
                    <div className="text-muted-foreground text-sm">{w.note || "没有分组信息"}</div>
                  ) : (
                    <GroupsByType groups={w.groups ?? []} />
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        ) : null}

        {okWallets.length ? (
          <TabsContent value="consume" className="mt-4 space-y-4">
            {okWallets.map((w) => (
              <Card key={w.id}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {w.name}
                    <Badge variant="outline" className="ml-2 font-normal">
                      {w.platform === "sub2api" ? "sub2api" : "new-api"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{w.base_url.replace(/^https?:\/\//, "")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <WalletConsume w={w} />
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        ) : null}
      </Tabs>

      <SiteFormDialog
        supplierId={sid}
        supplierName={party.name}
        site={siteModal.site}
        open={siteModal.open}
        onOpenChange={(o) => setSiteModal((s) => ({ ...s, open: o }))}
        onDone={reloadAll}
      />
    </div>
  );
}

function FundsTab({ detail }: { detail: SupplierDetail }) {
  const { funds } = detail;
  const { rows, pager } = usePaged(funds.entries, "funds");
  const cards = [
    { label: "我们转给他", value: curf(funds.out, funds.currency), icon: ArrowUpRight, cls: "text-expense" },
    { label: "他转给我们", value: curf(funds.income, funds.currency), icon: ArrowDownLeft, cls: "text-income" },
    { label: "净充值", value: curf(funds.net, funds.currency), icon: null, cls: "" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription className="flex items-center gap-1.5">
                {c.icon ? <c.icon className={cn("size-3.5", c.cls)} /> : null}
                {c.label}
              </CardDescription>
              <CardTitle className={cn("text-xl font-semibold tabular-nums", c.cls)}>{c.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">往来明细</CardTitle>
          <CardDescription>挂在这个供应商名下的充值 / 结算（支出）与退款 / 换钱（收入）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>经手人</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>项目</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funds.entries.length ? (
                  rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{e.time}</TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/ledger/members/${e.handler_id}`}
                          className="bg-secondary text-secondary-foreground hover:bg-secondary/70 inline-flex items-center rounded-full px-2 py-0.5 text-xs transition-colors"
                          title="查看该成员的详细流水"
                        >
                          {e.handler}
                        </Link>
                      </TableCell>
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
                        className={cn("text-right tabular-nums", e.type === "income" ? "text-income" : "text-expense")}
                      >
                        {curf(e.amount, e.currency)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/ledger/projects/${e.project_id}`}
                          className="text-primary text-xs hover:underline"
                        >
                          {e.project_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{e.note || "—"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                      还没有和这个供应商的资金往来。记支出时选上他 = 充值；记收入时选上他 = 他退款 / 换钱
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pager {...pager} className="mt-4" />
        </CardContent>
      </Card>
    </div>
  );
}
