"use client";

import { useEffect, useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { post } from "../api";
import { CURRENCIES, parseAmount, toLocalInput } from "../format";
import { useLedgerRefresh, useMe, useProjects } from "../hooks";
import type { Currency } from "../types";

import { FormError, ResponsiveDialog } from "./shared";

const NO_PROJECT = "none";

export function TransferDialog({
  open,
  onOpenChange,
  projectId,
  fromId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number | null;
  fromId?: number;
}) {
  const { data: me } = useMe();
  const { data: pd } = useProjects();
  const refresh = useLedgerRefresh();
  const members = me?.members ?? [];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [rate, setRate] = useState("");
  const [time, setTime] = useState("");
  const [project, setProject] = useState(NO_PROJECT);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !me) return;
    if (me.members.length < 2) {
      toast("至少要有两名成员才能记转账");
      onOpenChange(false);
      return;
    }
    const f = fromId ?? me.user.id;
    setFrom(String(f));
    setTo(String(me.members.find((m) => m.id !== f)?.id ?? ""));
    setAmount("");
    setCurrency("CNY");
    setRate("");
    setTime(toLocalInput(new Date()));
    setProject(projectId ? String(projectId) : NO_PROJECT);
    setNote("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 转出和收到不能是同一个人：选了同一人时自动换掉另一边
  const pick = (side: "from" | "to", v: string) => {
    const other = members.find((m) => String(m.id) !== v);
    if (side === "from") {
      setFrom(v);
      if (v === to && other) setTo(String(other.id));
    } else {
      setTo(v);
      if (v === from && other) setFrom(String(other.id));
    }
  };

  const changeCurrency = (c: Currency) => {
    setCurrency(c);
    setRate(c === "CNY" ? "" : String(me?.rates[c] ?? ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = parseAmount(amount);
    if (!(a > 0)) return setError("请输入正确的金额");
    setBusy(true);
    setError(null);
    try {
      await post("/transfers", {
        project_id: project === NO_PROJECT ? null : project,
        from_id: Number(from),
        to_id: Number(to),
        amount: a,
        currency,
        rate: rate || undefined,
        time,
        note,
      });
      toast.success("已记录转账");
      onOpenChange(false);
      refresh();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const projects = (pd?.projects ?? []).filter((p) => !p.archived);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="记一笔转账"
      description="成员之间交钱（谁把手上的钱给了谁），只在成员资金之间搬动，不影响项目收入、支出和利润。"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>谁转出</Label>
            <Select value={from} onValueChange={(v) => pick("from", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>谁收到</Label>
            <Select value={to} onValueChange={(v) => pick("to", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="tf-amount">金额</Label>
            <Input
              id="tf-amount"
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>币种</Label>
            <Select value={currency} onValueChange={(v) => changeCurrency(v as Currency)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                    {c === "CNY" ? " 人民币" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {currency !== "CNY" ? (
            <div className="space-y-2">
              <Label htmlFor="tf-rate">汇率（1 外币 = ? CNY）</Label>
              <Input id="tf-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="tf-time">时间</Label>
            <Input id="tf-time" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>算在哪个项目</Label>
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>不挂项目（公司层面）</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tf-note">备注</Label>
          <Input
            id="tf-note"
            maxLength={200}
            placeholder="例如：交备用金 / 结算货款"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <FormError>{error}</FormError>
        <Button type="submit" className="w-full" disabled={busy}>
          记转账
        </Button>
      </form>
    </ResponsiveDialog>
  );
}
