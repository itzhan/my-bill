"use client";

import { useEffect, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { del, get, patch, post } from "../api";
import { relTime } from "../format";
import { useLedgerRefresh } from "../hooks";
import type { Party, PartyWallet } from "../types";

import { FormError, ResponsiveDialog, useConfirm } from "./shared";

const PLATFORMS: [PartyWallet["platform"], string][] = [
  ["newapi", "new-api"],
  ["sub2api", "sub2api"],
];
const KIND_LABEL: Record<string, string> = {
  wallet: "钱包余额",
  token: "Key 剩余额度",
  quota: "Key 限额剩余",
  subscription: "订阅剩余",
};

// 额度数字：两位小数、千分位，不带币种（供应商站点的额度单位，一般是 $）
export const amt = (v: number | null | undefined) =>
  v == null ? "-" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ratioSource(w: PartyWallet) {
  const s = w.last_ratio_source;
  if (w.custom) return "自定义";
  if (s === "billing") return "Key 计费接口";
  if (s === "usage") return "按消费记录反推";
  if (s.startsWith("log")) return `最近消费日志${s.includes(":") ? `（${s.split(":")[1]} 分组）` : ""}`;
  if (s === "pricing-default") return "站点 default 分组（估计）";
  return s;
}

const walletsKey = (partyId: number) => ["ledger", "party-wallets", partyId] as const;

export type WalletDraft = {
  name: string;
  platform: PartyWallet["platform"];
  base_url: string;
  api_key: string;
  custom: boolean;
  custom_ratio: string;
};
export const EMPTY_WALLET: WalletDraft = {
  name: "",
  platform: "newapi",
  base_url: "",
  api_key: "",
  custom: false,
  custom_ratio: "",
};

// 校验：返回错误文案，没问题返回 null
export function walletDraftError(v: WalletDraft, requireKey: boolean) {
  if (!/^https?:\/\//i.test(v.base_url.trim())) return "站点地址需以 http:// 或 https:// 开头";
  if (requireKey && !v.api_key.trim()) return "API Key 必填";
  if (v.custom && !(Number(v.custom_ratio) > 0)) return "自定义倍率必须大于 0";
  return null;
}
export const walletBody = (v: WalletDraft) => ({
  name: v.name,
  platform: v.platform,
  base_url: v.base_url.trim(),
  custom: v.custom,
  custom_ratio: v.custom ? Number(v.custom_ratio) : null,
  ...(v.api_key.trim() ? { api_key: v.api_key.trim() } : {}),
});

// 平台 + 站点地址 + Key + 自定义倍率（添加供应商表单和「余额」弹窗共用）
export function WalletFields({
  v,
  setV,
  keyHint,
}: {
  v: WalletDraft;
  setV: (v: WalletDraft) => void;
  keyHint?: string;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
        <div className="space-y-2">
          <Label>平台 *</Label>
          <Select value={v.platform} onValueChange={(x) => setV({ ...v, platform: x as PartyWallet["platform"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>站点地址 *</Label>
          <Input
            placeholder="https://api.example.com"
            value={v.base_url}
            onChange={(e) => setV({ ...v, base_url: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>API Key {keyHint ?? "*"}</Label>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="sk-..."
          value={v.api_key}
          onChange={(e) => setV({ ...v, api_key: e.target.value })}
        />
      </div>
      <div className="bg-muted/40 space-y-3 rounded-lg border p-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">自定义倍率</span>
            <span className="text-muted-foreground block text-xs">
              供应商倍率始终显示 1、充值时按倍率折算额度（如充 9000、3 倍率 → 给 3000 额度）时打开：不抓倍率，实际余额 =
              钱包额度 × 自定义倍率
            </span>
          </span>
          <Switch checked={v.custom} onCheckedChange={(x) => setV({ ...v, custom: x })} />
        </label>
        {v.custom ? (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">倍率</Label>
            <Input
              inputMode="decimal"
              className="w-28"
              placeholder="如 3"
              value={v.custom_ratio}
              onChange={(e) => setV({ ...v, custom_ratio: e.target.value })}
            />
            {Number(v.custom_ratio) > 0 ? (
              <span className="text-muted-foreground text-xs">
                钱包 3,000 → 实际余额 {amt(3000 * Number(v.custom_ratio))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

// 新增 / 编辑：平台 + 站点地址 + Key，可选自定义倍率
function WalletDialog({
  open,
  onOpenChange,
  party,
  wallet,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  party: Party;
  wallet: PartyWallet | null;
  onSaved: () => void;
}) {
  const [v, setV] = useState<WalletDraft>(EMPTY_WALLET);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setV(
      wallet
        ? {
            name: wallet.name,
            platform: wallet.platform,
            base_url: wallet.base_url,
            api_key: "",
            custom: wallet.custom,
            custom_ratio: wallet.custom_ratio == null ? "" : String(wallet.custom_ratio),
          }
        : EMPTY_WALLET,
    );
  }, [open, wallet]);

  const save = async () => {
    const err = walletDraftError(v, !wallet);
    if (err) return setError(err);
    setSaving(true);
    setError(null);
    const body = walletBody(v);
    try {
      const { wallet: r } = wallet
        ? await patch<{ wallet: PartyWallet }>(`/party-wallets/${wallet.id}`, body)
        : await post<{ wallet: PartyWallet }>(`/parties/${party.id}/wallets`, body);
      if (r.last_error) toast.error(`已保存，但抓取失败：${r.last_error}`);
      else toast.success(`已保存 · 实际余额 ${amt(r.last_actual)}`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={wallet ? "编辑余额监控" : `给「${party.name}」添加余额监控`}
      description="用我们在供应商站点的 API Key 抓钱包额度和这把 Key 的倍率。只发查询请求，不产生费用。"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>名称</Label>
          <Input
            placeholder="如 Claude 号池 / 主 Key"
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </div>
        <WalletFields
          v={v}
          setV={setV}
          keyHint={wallet ? (wallet.has_key ? `（当前 ${wallet.key_masked}，留空 = 不修改）` : "") : undefined}
        />
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "保存并抓取中…" : "保存并抓取"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

// 供应商详情里的「余额」区块：每把 Key 一行，钱包额度 / 倍率（来源）/ 实际余额
export function PartyWallets({ party }: { party: Party }) {
  const qc = useQueryClient();
  const refreshLedger = useLedgerRefresh();
  const [confirm, confirmEl] = useConfirm();
  const [editing, setEditing] = useState<PartyWallet | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const { data } = useQuery({
    queryKey: walletsKey(party.id),
    queryFn: () => get<{ wallets: PartyWallet[] }>(`/parties/${party.id}/wallets`).then((d) => d.wallets),
  });
  const changed = () => {
    qc.invalidateQueries({ queryKey: walletsKey(party.id) });
    refreshLedger(); // 卡片上的余额汇总
  };

  const refresh = async (w: PartyWallet) => {
    setBusy((s) => new Set(s).add(w.id));
    try {
      const { wallet: r } = await post<{ wallet: PartyWallet }>(`/party-wallets/${w.id}/refresh`);
      if (r.last_error) toast.error(`${r.name}：${r.last_error}`);
      else toast.success(`${r.name}：实际余额 ${amt(r.last_actual)}`);
      changed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(w.id);
        return n;
      });
    }
  };
  const remove = async (w: PartyWallet) => {
    if (!(await confirm({ title: `删除余额监控「${w.name}」？`, destructive: true, confirmText: "删除" }))) return;
    try {
      await del(`/party-wallets/${w.id}`);
      toast.success("已删除");
      changed();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const toggle = async (w: PartyWallet, on: boolean) => {
    try {
      await patch(`/party-wallets/${w.id}`, { enabled: on });
      changed();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const list = data ?? [];
  const total = list.filter((w) => w.enabled).reduce((a, w) => a + (w.last_actual ?? 0), 0);
  const totalUsed = list.filter((w) => w.enabled).reduce((a, w) => a + (w.last_used_actual ?? 0), 0);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <b className="text-sm">余额</b>
          <p className="text-muted-foreground text-xs">
            在供应商站点（new-api / sub2api）的 Key 对应的钱包额度、倍率与累计消费，每 30 分钟自动刷新
            {list.length ? ` · 实际余额合计 ${amt(total)} · 累计消费合计 ${amt(totalUsed)}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus />
          添加
        </Button>
      </div>
      {list.length ? (
        <div className="divide-y rounded-md border">
          {list.map((w) => (
            <div key={w.id} className={cn("space-y-2 p-3", !w.enabled && "opacity-60")}>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-medium">{w.name}</span>
                <Badge variant="outline">{w.platform === "sub2api" ? "sub2api" : "new-api"}</Badge>
                {w.custom ? <Badge variant="secondary">自定义倍率</Badge> : null}
                <span className="ml-auto flex items-center gap-0.5">
                  <Switch checked={w.enabled} onCheckedChange={(x) => toggle(w, x)} className="mr-1 scale-90" />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="刷新"
                    disabled={busy.has(w.id)}
                    onClick={() => refresh(w)}
                  >
                    <RefreshCw className={cn(busy.has(w.id) && "animate-spin")} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="编辑"
                    onClick={() => {
                      setEditing(w);
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="删除" onClick={() => remove(w)}>
                    <Trash2 />
                  </Button>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="bg-muted/50 rounded-md p-2">
                  <div className="text-muted-foreground text-xs">{KIND_LABEL[w.last_wallet_kind] ?? "钱包额度"}</div>
                  <div className="font-semibold tabular-nums">{amt(w.last_wallet)}</div>
                </div>
                <div className="bg-muted/50 rounded-md p-2">
                  <div className="text-muted-foreground truncate text-xs" title={ratioSource(w)}>
                    倍率 · {ratioSource(w) || "-"}
                  </div>
                  <div className="font-semibold tabular-nums">
                    {w.last_ratio == null ? "-" : `× ${+w.last_ratio.toFixed(4)}`}
                  </div>
                </div>
                <div className="bg-muted/50 rounded-md p-2">
                  <div className="text-muted-foreground text-xs">实际余额{w.custom ? "（钱包 × 倍率）" : ""}</div>
                  <div className="text-income font-semibold tabular-nums">{amt(w.last_actual)}</div>
                </div>
                <div className="bg-muted/50 rounded-md p-2">
                  <div className="text-muted-foreground text-xs">累计消费{w.custom ? "（× 倍率）" : ""}</div>
                  <div className="text-expense font-semibold tabular-nums">{amt(w.last_used_actual)}</div>
                  {w.custom && w.last_used != null ? (
                    <div className="text-muted-foreground text-xs tabular-nums">站点额度 {amt(w.last_used)}</div>
                  ) : null}
                </div>
              </div>
              <div className="text-muted-foreground truncate font-mono text-xs" title={w.base_url}>
                {w.base_url} · {w.key_masked} · {w.last_checked_at ? `${relTime(w.last_checked_at)}抓取` : "未抓取"}
              </div>
              {w.last_error ? (
                <p className={cn("text-xs", w.last_used != null ? "text-warning" : "text-destructive")}>
                  {w.last_error}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          还没有绑定 Key。点「添加」选平台（new-api / sub2api）并填 Key，就能自动抓钱包额度和倍率。
        </p>
      )}
      <WalletDialog open={open} onOpenChange={setOpen} party={party} wallet={editing} onSaved={changed} />
      {confirmEl}
    </div>
  );
}
