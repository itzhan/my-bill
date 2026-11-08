"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { del, get, patch, post } from "@/modules/ledger/api";
import { FormError, PageHeader, ResponsiveDialog, useConfirm } from "@/modules/ledger/components/shared";
import type { Station } from "@/modules/ledger/types";

type Draft = { name: string; type: "relay" | "key"; base_url: string; credential: string; user_id: string; quota_per_usd: string };

const empty = (): Draft => ({ name: "", type: "relay", base_url: "", credential: "", user_id: "", quota_per_usd: "500000" });

function StationDialog({
  open,
  onOpenChange,
  station,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  station?: Station;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(empty());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setD(
      station
        ? {
            name: station.name,
            type: station.type,
            base_url: station.base_url,
            credential: "",
            user_id: station.user_id,
            quota_per_usd: String(station.quota_per_usd),
          }
        : empty(),
    );
    setError(null);
  };

  const set = (k: keyof Draft) => (v: string) => setD((x) => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.name.trim()) return setError("请填写台子名称");
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: d.name.trim(),
        type: d.type,
        base_url: d.base_url.trim(),
        credential: d.credential.trim(),
        user_id: d.user_id.trim(),
        quota_per_usd: Number(d.quota_per_usd) || 500000,
      };
      if (station) await patch(`/stations/${station.id}`, body);
      else await post("/stations", body);
      toast.success(station ? "台子已更新" : "台子已添加");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["ledger", "stations"] });
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
        if (o) reset();
        onOpenChange(o);
      }}
      title={station ? "编辑台子" : "新增台子"}
    >
      <form onSubmit={submit} className="space-y-4">
        {!station ? (
          <div className="space-y-2">
            <Label>类型</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={d.type}
              onValueChange={(v) => v && set("type")(v)}
              className="w-full"
            >
              <ToggleGroupItem value="relay" className="flex-1 data-[state=on]:font-semibold">
                中转站
              </ToggleGroupItem>
              <ToggleGroupItem value="key" className="flex-1 data-[state=on]:font-semibold">
                上 key 台子
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label>名称</Label>
          <Input maxLength={60} value={d.name} onChange={(e) => set("name")(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>站点地址</Label>
          <Input placeholder="https://" value={d.base_url} onChange={(e) => set("base_url")(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{d.type === "relay" ? "管理密钥" : "凭证（Cookie 或系统访问令牌）"}</Label>
          <Input
            type="password"
            autoComplete="off"
            placeholder={station?.has_credential ? "留空表示不修改" : ""}
            value={d.credential}
            onChange={(e) => set("credential")(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">只存在服务器上，保存后不会再显示</p>
        </div>
        {d.type === "key" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>用户 ID</Label>
              <Input value={d.user_id} onChange={(e) => set("user_id")(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>每美元额度</Label>
              <Input value={d.quota_per_usd} onChange={(e) => set("quota_per_usd")(e.target.value)} />
            </div>
          </div>
        ) : null}
        <FormError>{error}</FormError>
        <Button type="submit" className="w-full" disabled={busy}>
          {station ? "保存" : "添加"}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}

export default function StationsPage() {
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const { data } = useQuery({
    queryKey: ["ledger", "stations"],
    queryFn: () => get<{ stations: Station[] }>("/stations").then((d) => d.stations),
  });
  const [editing, setEditing] = useState<Station | null | undefined>(undefined);

  const remove = async (s: Station) => {
    if (!(await confirm({ title: `删除台子「${s.name}」？`, destructive: true, confirmText: "删除" }))) return;
    try {
      await del(`/stations/${s.id}`);
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: ["ledger", "stations"] });
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="台子管理"
        description="上 key 台子和中转站统一在这里管理，项目里按类型选择所属台子"
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus />
            新增台子
          </Button>
        }
      />
      {!data ? (
        <Skeleton className="h-40" />
      ) : data.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="truncate">{s.name}</span>
                  <Badge variant="secondary">{s.type === "relay" ? "中转站" : "上 key"}</Badge>
                </CardTitle>
                <CardDescription className="truncate">{s.base_url || "未填地址"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-muted-foreground text-xs">
                  {s.has_credential ? "凭证已配置" : "还没填凭证"}
                  {s.type === "key" && s.user_id ? ` · 用户 ${s.user_id}` : ""}
                  {s.projects.length ? ` · ${s.projects.length} 个项目在用` : " · 没有项目在用"}
                </div>
                {s.projects.length ? (
                  <div className="text-muted-foreground truncate text-xs">{s.projects.map((p) => p.name).join("、")}</div>
                ) : null}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
                    <Pencil />
                    编辑
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive" onClick={() => remove(s)}>
                    <Trash2 />
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">还没有台子</p>
      )}
      <StationDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} station={editing ?? undefined} />
      {confirmEl}
    </div>
  );
}
