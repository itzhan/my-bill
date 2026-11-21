"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { get, post } from "@/modules/ledger/api";
import { FormError, PageHeader, Pager, ResponsiveDialog, usePaged } from "@/modules/ledger/components/shared";
import { money, signed } from "@/modules/ledger/format";
import { useLedgerRefresh } from "@/modules/ledger/hooks";
import type { Party, PartyWallet, SupplierSite } from "@/modules/ledger/types";

type SupplierRow = Party & { wallets: PartyWallet[]; sites?: SupplierSite[] };

type SiteFormItem = {
  id: string;
  platform: "newapi" | "sub2api";
  base_url: string;
  note: string;
  access_token: string;
  token_user_id: string;
  login_user: string;
  login_pass: string;
  custom: boolean;
  custom_ratio: string;
  consume_ratio: string;
};

let siteSeq = 0;
const newSiteItem = (): SiteFormItem => ({
  id: `s-${++siteSeq}`,
  platform: "newapi",
  base_url: "",
  note: "",
  access_token: "",
  token_user_id: "",
  login_user: "",
  login_pass: "",
  custom: false,
  custom_ratio: "",
  consume_ratio: "",
});

function AddSupplierDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const refresh = useLedgerRefresh();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [sites, setSites] = useState<SiteFormItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setContact("");
    setSites([]);
    setError(null);
  };

  const updateSite = (id: string, patch: Partial<SiteFormItem>) =>
    setSites((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSite = (id: string) => setSites((list) => list.filter((s) => s.id !== id));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("请填写供应商名称");
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (!s) continue;
      if (!/^https?:\/\//i.test(s.base_url.trim())) return setError(`站点 ${i + 1} 的地址需以 http:// 或 https:// 开头`);
      if (s.platform === "newapi" && !s.access_token.trim()) return setError(`站点 ${i + 1} 请填写访问令牌`);
      if (s.platform === "sub2api" && !s.access_token.trim() && !(s.login_user.trim() && s.login_pass.trim())) {
        return setError(`站点 ${i + 1} 请填写访问令牌或站点登录邮箱密码`);
      }
      if (s.custom && !(Number(s.custom_ratio) > 0)) return setError(`站点 ${i + 1} 的自定义倍率必须大于 0`);
      if (s.custom && s.consume_ratio.trim() && !(Number(s.consume_ratio) > 0)) {
        return setError(`站点 ${i + 1} 的消耗倍率必须大于 0`);
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ supplier: SupplierRow; site_errors: string[] }>("/suppliers", {
        name: name.trim(),
        contact: contact.trim(),
        sites: sites.map((s) => ({
          platform: s.platform,
          base_url: s.base_url.trim(),
          note: s.note.trim(),
          access_token: s.access_token.trim(),
          token_user_id: s.token_user_id.trim(),
          login_user: s.login_user.trim(),
          login_pass: s.login_pass.trim(),
          custom: s.custom,
          custom_ratio: s.custom ? Number(s.custom_ratio) : null,
          consume_ratio: s.custom
            ? Number(s.consume_ratio) > 0
              ? Number(s.consume_ratio)
              : Number(s.custom_ratio)
            : null,
        })),
      });
      if (res.site_errors?.length) {
        toast.warning(`已添加供应商「${res.supplier.name}」，部分站点抓取提示：${res.site_errors[0]}`);
      } else {
        toast.success(`已添加供应商「${res.supplier.name}」${sites.length ? `（${sites.length} 个站点）` : ""}`);
      }
      reset();
      onOpenChange(false);
      refresh();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="添加供应商"
      description="供应商全局建档，可同时服务中转、上 key 与项目制项目"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sup-name">名字 *</Label>
            <Input
              id="sup-name"
              autoFocus
              maxLength={60}
              placeholder="例如：爱马仕"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-contact">联系方式（可选）</Label>
            <Input
              id="sup-contact"
              maxLength={100}
              placeholder="微信 / 飞书 / 电话"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>站点（可选，可添加多个）</Label>
              <p className="text-muted-foreground text-xs">
                有中转站点时填写，自动追踪站点余额与消费；后续可在项目里直接关联该站点的 Key
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSites((list) => [...list, newSiteItem()])}
            >
              <Plus />
              添加站点
            </Button>
          </div>

          {sites.map((s, idx) => (
            <div key={s.id} className="bg-muted/30 space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">站点 {idx + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeSite(s.id)}
                  title="删除站点"
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[8.5rem_1fr]">
                <div className="space-y-1.5">
                  <Label>平台 *</Label>
                  <Select
                    value={s.platform}
                    onValueChange={(v) => updateSite(s.id, { platform: v as "newapi" | "sub2api" })}
                  >
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
                  <Input
                    placeholder="https://api.example.com"
                    value={s.base_url}
                    onChange={(e) => updateSite(s.id, { base_url: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>备注（可选）</Label>
                <Input
                  maxLength={200}
                  placeholder="例如：awsb 主站 / fable 渠道 / 备用池"
                  value={s.note}
                  onChange={(e) => updateSite(s.id, { note: e.target.value })}
                />
              </div>
              {s.platform === "newapi" ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                  <div className="space-y-1.5">
                    <Label>访问令牌 *</Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="系统访问令牌"
                      value={s.access_token}
                      onChange={(e) => updateSite(s.id, { access_token: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>用户 ID（选填）</Label>
                    <Input
                      inputMode="numeric"
                      placeholder="老版本需要"
                      value={s.token_user_id}
                      onChange={(e) => updateSite(s.id, { token_user_id: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label>访问令牌（或填下方登录账号密码）</Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="访问令牌（JWT）"
                      value={s.access_token}
                      onChange={(e) => updateSite(s.id, { access_token: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      placeholder="或登录邮箱"
                      value={s.login_user}
                      onChange={(e) => updateSite(s.id, { login_user: e.target.value })}
                    />
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="登录密码"
                      value={s.login_pass}
                      onChange={(e) => updateSite(s.id, { login_pass: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2 rounded-md border bg-background/60 p-2.5">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">自定义倍率</span>
                    <span className="text-muted-foreground block text-xs">
                      需要追踪自定义倍率时开启；关联到项目时自动继承计算
                    </span>
                  </span>
                  <Switch checked={s.custom} onCheckedChange={(x) => updateSite(s.id, { custom: x })} />
                </label>
                {s.custom ? (
                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">自定义倍率（充值）*</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="如 3.6"
                        value={s.custom_ratio}
                        onChange={(e) => updateSite(s.id, { custom_ratio: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">消耗倍率（默认同左）</Label>
                      <Input
                        inputMode="decimal"
                        placeholder={s.custom_ratio || "如 3.6"}
                        value={s.consume_ratio}
                        onChange={(e) => updateSite(s.id, { consume_ratio: e.target.value })}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "保存中…" : "添加供应商"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

// 侧栏「供应商」：汇总所有供应商的应付（中转累计消费 + 其他项目贡献）、实付、结余
export default function SuppliersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ledger", "suppliers"],
    queryFn: () => get<{ suppliers: SupplierRow[] }>("/suppliers").then((d) => d.suppliers),
  });
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const dueOf = (s: SupplierRow) => s.supplier_totals?.due ?? 0;
  const paidOf = (s: SupplierRow) => s.supplier_totals?.paid ?? 0;
  const balOf = (s: SupplierRow) => s.supplier_totals?.balance ?? 0;

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (s) =>
          (showArchived || !s.archived) &&
          (!kw ||
            s.name.toLowerCase().includes(kw) ||
            s.wallets.some((w) => w.name.toLowerCase().includes(kw) || w.base_url.toLowerCase().includes(kw))),
      )
      .sort((a, b) => dueOf(b) - dueOf(a));
  }, [data, q, showArchived]);
  const { rows: pageRows, pager } = usePaged(rows, `${q}|${showArchived}`);

  const active = (data ?? []).filter((s) => !s.archived);
  const wallets = active.flatMap((s) => s.wallets).filter((w) => w.enabled);
  const totalDue = active.reduce((a, s) => a + dueOf(s), 0);
  const totalPaid = active.reduce((a, s) => a + paidOf(s), 0);
  const totalBal = totalPaid - totalDue;
  const totalOwed = active.reduce((a, s) => a + Math.max(0, -balOf(s)), 0);
  const archivedCount = (data ?? []).length - active.length;

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const r = await post<{ wallets: PartyWallet[] }>("/wallets/refresh");
      const bad = r.wallets.filter((w) => w.last_error).length;
      if (bad) toast.error(`已刷新 ${r.wallets.length} 个站点监控，其中 ${bad} 个有提示或失败`);
      else toast.success(`已刷新 ${r.wallets.length} 个站点监控`);
      qc.invalidateQueries({ queryKey: ["ledger", "suppliers"] });
      qc.invalidateQueries({ queryKey: ["ledger", "party-wallets"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const stats = [
    {
      label: "应付合计",
      value: money(totalDue),
      sub: "中转累计消费 + 上 key / 项目制贡献",
      cls: "text-expense",
    },
    {
      label: "实付合计",
      value: money(totalPaid),
      sub: "已实际支付给供应商（扣除退款）",
      cls: "text-income",
    },
    {
      label: "净结余",
      value: signed(totalBal),
      sub: totalOwed > 0 ? `实付 − 应付 · 其中欠付 ${money(totalOwed)}` : "实付 − 应付（正=预付结余，负=我们还欠）",
      cls: totalBal < 0 ? "text-warning" : "text-income",
    },
    {
      label: "供应商数",
      value: active.length,
      sub: `${new Set(wallets.map((w) => w.base_url.replace(/\/+$/, ""))).size} 个活跃站点`,
      cls: "",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="供应商"
        description="供应商全局统一管理，应付汇总中转累计消费与其他项目贡献"
        actions={
          <>
            <Button variant="outline" onClick={refreshAll} disabled={refreshing || !wallets.length}>
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              {refreshing ? "抓取中…" : "全部刷新"}
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus />
              添加供应商
            </Button>
          </>
        }
      />

      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className={cn("text-2xl font-semibold tabular-nums", s.cls)}>{data ? s.value : "-"}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">{s.sub}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>供应商列表</CardTitle>
            <CardDescription>点击进入供应商详情，查看站点消费与余额、资金往来</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {archivedCount ? (
              <div className="flex items-center gap-2">
                <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                <Label htmlFor="show-archived" className="text-muted-foreground text-sm font-normal">
                  显示已归档（{archivedCount}）
                </Label>
              </div>
            ) : null}
            <div className="relative w-full sm:w-56">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                placeholder="搜索供应商 / 站点"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>供应商</TableHead>
                    <TableHead className="text-right">应付</TableHead>
                    <TableHead className="text-right">实付</TableHead>
                    <TableHead className="text-right">结余</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length ? (
                    pageRows.map((s) => {
                      const due = dueOf(s);
                      const paid = paidOf(s);
                      const bal = balOf(s);
                      return (
                        <TableRow
                          key={s.id}
                          className={cn("cursor-pointer", s.archived && "opacity-60")}
                          onClick={() => router.push(`/dashboard/ledger/suppliers/${s.id}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5 font-medium">
                              {s.name}
                              {s.archived ? <Badge variant="outline">归档</Badge> : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-expense text-right tabular-nums">{money(due)}</TableCell>
                          <TableCell className="text-income text-right tabular-nums">{money(paid)}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-medium tabular-nums",
                              bal < 0 ? "text-warning" : bal > 0 ? "text-income" : "text-muted-foreground",
                            )}
                            title={bal < 0 ? "我们还欠供应商" : bal > 0 ? "预付结余 / 多付" : "已结清"}
                          >
                            {signed(bal)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground py-10 text-center">
                        {data.length ? "没有符合条件的供应商" : "还没有供应商，点右上角「添加供应商」开始"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {data ? <Pager {...pager} className="mt-4" /> : null}
        </CardContent>
      </Card>

      <AddSupplierDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
