"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { del, get, post } from "@/modules/ledger/api";
import { money, usdf } from "@/modules/ledger/format";
import type { ProjectDetail, Station } from "@/modules/ledger/types";

import { FormError, ResponsiveDialog, useConfirm } from "./shared";

type RelayKey = {
  id: number;
  party_id: number;
  party_name: string;
  key_name: string;
  group_name: string;
  ratio: number;
  base_url: string;
  has_token: number;
  usd: number;
  cost: number;
};

// 中转制的上游成本：一个上游供应商可以有多个分组、多个 key，每个 key 的消耗就是该账号的消费
export function RelayKeysSection({ detail }: { detail: ProjectDetail }) {
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const [open, setOpen] = useState(false);
  const pid = detail.project.id;
  const { data } = useQuery({
    queryKey: ["ledger", "relay-keys", pid],
    queryFn: () => get<{ keys: RelayKey[] }>(`/projects/${pid}/relay-keys`).then((d) => d.keys),
  });
  const { data: suppliers } = useQuery({
    queryKey: ["ledger", "supplier-options"],
    queryFn: () => get<{ suppliers: { id: number; name: string }[] }>("/suppliers/options").then((d) => d.suppliers),
  });
  const { data: stations } = useQuery({
    queryKey: ["ledger", "stations"],
    queryFn: () => get<{ stations: Station[] }>("/stations").then((d) => d.stations),
  });

  const [form, setForm] = useState({ party_id: "", key_name: "", group_name: "", ratio: "1", base_url: "", token: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((x) => ({ ...x, [k]: v }));

  const relay = (stations ?? []).find((x) => x.id === detail.project.station_id) ?? (stations ?? []).find((x) => x.type === "relay");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relay) return setError("这个项目还没选中转站，先在编辑项目里选");
    if (!form.party_id) return setError("请选择上游供应商");
    if (!form.base_url.trim() || !form.token.trim()) return setError("请填写站点地址和 key 令牌");
    setBusy(true);
    setError(null);
    try {
      await post("/relay-keys", {
        station_id: relay.id,
        project_id: pid,
        party_id: Number(form.party_id),
        key_name: form.key_name.trim(),
        group_name: form.group_name.trim(),
        ratio: Number(form.ratio) || 1,
        base_url: form.base_url.trim(),
        token: form.token.trim(),
      });
      toast.success("已添加，消耗会自动同步");
      setOpen(false);
      setForm({ party_id: "", key_name: "", group_name: "", ratio: "1", base_url: "", token: "" });
      qc.invalidateQueries({ queryKey: ["ledger", "relay-keys", pid] });
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (k: RelayKey) => {
    if (!(await confirm({ title: `删除 key「${k.key_name || k.party_name}」？`, destructive: true, confirmText: "删除" })))
      return;
    await del(`/relay-keys/${k.id}`);
    qc.invalidateQueries({ queryKey: ["ledger", "relay-keys", pid] });
  };

  const total = (data ?? []).reduce((a, k) => a + k.cost, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>上游 key</span>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus />
              添加 key
            </Button>
          </CardTitle>
          <CardDescription>
            一个上游可以有多个分组、多个 key。每个 key 的消耗就是该账号的消费，成本 = 消耗 × 倍率。合计成本{" "}
            <span className="text-foreground font-medium tabular-nums">{money(total)}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data ?? []).length ? (
            data!.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {k.party_name}
                    {k.key_name ? ` · ${k.key_name}` : ""}
                    {k.group_name ? ` · ${k.group_name}` : ""}
                  </div>
                  <div className="text-muted-foreground text-xs tabular-nums">
                    消耗 {usdf(k.usd)} × 倍率 {k.ratio} = 成本 {money(k.cost)}
                    {k.has_token ? "" : " · 还没填令牌，无法同步"}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => remove(k)} aria-label="删除">
                  <Trash2 />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">还没有上游 key。添加后系统会按天同步它的消耗</p>
          )}
        </CardContent>
      </Card>

      <ResponsiveDialog open={open} onOpenChange={setOpen} title="添加上游 key">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>上游供应商</Label>
            <Select value={form.party_id} onValueChange={set("party_id")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择供应商" />
              </SelectTrigger>
              <SelectContent>
                {(suppliers ?? []).map((x) => (
                  <SelectItem key={x.id} value={String(x.id)}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>key 名称</Label>
              <Input value={form.key_name} onChange={(e) => set("key_name")(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>分组</Label>
              <Input value={form.group_name} onChange={(e) => set("group_name")(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>成本倍率（成本 = 消耗美元 × 倍率）</Label>
            <Input inputMode="decimal" value={form.ratio} onChange={(e) => set("ratio")(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>站点地址</Label>
            <Input placeholder="https://" value={form.base_url} onChange={(e) => set("base_url")(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>key 令牌</Label>
            <Input type="password" autoComplete="off" value={form.token} onChange={(e) => set("token")(e.target.value)} />
            <p className="text-muted-foreground text-xs">用来读取这个 key 自己的消耗，只存在服务器上</p>
          </div>
          <FormError>{error}</FormError>
          <Button type="submit" className="w-full" disabled={busy}>
            添加
          </Button>
        </form>
      </ResponsiveDialog>
      {confirmEl}
    </div>
  );
}
