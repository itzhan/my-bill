"use client";

import { useEffect, useState } from "react";

import { usePathname } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { del, get, patch, post } from "../api";
import { CUR, CURRENCIES, fmt, parseAmount, toLocalInput } from "../format";
import { useLedgerRefresh, useMe, useProjects } from "../hooks";
import type { Currency, Entry, EntryType, Party } from "../types";

import { doneIds, EntryImagesInput, type ImageItem } from "./entry-images";
import { FormError, MemberAvatar, ResponsiveDialog, useConfirm } from "./shared";

const PREFS_KEY = "ledger:prefs";
const NO_SUPPLIER = "none";
type Prefs = { currency: Currency; type: EntryType; lastProject: number | null };
function loadPrefs(): Prefs {
  try {
    return {
      currency: "CNY",
      type: "expense",
      lastProject: null,
      ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"),
    };
  } catch {
    return { currency: "CNY", type: "expense", lastProject: null };
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // 忽略：取不到就用默认值
  }
}

export function EntryDialog({
  open,
  onOpenChange,
  projectId,
  entry: editing,
  onNeedProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number;
  entry?: Entry;
  onNeedProject: () => void;
}) {
  const { data: me } = useMe();
  const { data: pd } = useProjects();
  const refresh = useLedgerRefresh();
  const pathname = usePathname();
  const [confirm, confirmEl] = useConfirm();

  const [type, setType] = useState<EntryType>("expense");
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [project, setProject] = useState<number | null>(null);
  const [handler, setHandler] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [supplier, setSupplier] = useState<number | null>(null);
  const [time, setTime] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [defaultTime, setDefaultTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projects = pd?.projects ?? [];
  const active = projects.filter((p) => !p.archived || (editing && p.id === editing.project_id));
  const rates = pd?.rates ?? me?.rates ?? { USD: 7.2, USDT: 7.2 };

  // 充值 / 结算：支出可挂本项目的供应商
  const isExpense = type === "expense";
  const { data: suppliers } = useQuery({
    queryKey: ["ledger", "project-suppliers", project],
    queryFn: () =>
      get<{ suppliers: Party[] }>(`/projects/${project}/parties`).then((d) => d.suppliers.filter((s) => !s.archived)),
    enabled: open && !!project,
  });

  // 每次打开时按「新建 / 编辑」初始化表单
  useEffect(() => {
    if (!open || !me) return;
    setError(null);
    if (editing) {
      setType(editing.type);
      setCurrency(editing.currency);
      setProject(editing.project_id);
      setHandler(editing.handler_id);
      setAmount(String(editing.amount));
      setRate(editing.currency === "CNY" ? "" : String(editing.rate ?? ""));
      setNote(editing.note || "");
      setSupplier(editing.party_id ?? null);
      setTime(toLocalInput(new Date(editing.created_at)));
      setDefaultTime(null);
      setImages(editing.images.map((a) => ({ key: `a${a.id}`, status: "done", attachment: a })));
      return;
    }
    if (pd && !pd.projects.some((p) => !p.archived)) {
      toast("先创建一个项目");
      onNeedProject();
      return;
    }
    const prefs = loadPrefs();
    const fromPath = Number(pathname.match(/\/ledger\/projects\/(\d+)/)?.[1]) || null;
    let pid = projectId ?? fromPath ?? prefs.lastProject;
    const act = (pd?.projects ?? []).filter((p) => !p.archived);
    if (!act.some((p) => p.id === pid)) pid = act[0]?.id ?? null;
    setType(prefs.type);
    setCurrency(prefs.currency);
    setProject(pid);
    setHandler(me.user.id);
    setAmount("");
    setRate(prefs.currency === "CNY" ? "" : String(rates[prefs.currency] ?? ""));
    setNote("");
    setSupplier(null);
    setImages([]);
    const now = toLocalInput(new Date());
    setTime(now);
    setDefaultTime(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changeCurrency = (c: Currency) => {
    setCurrency(c);
    setRate(c === "CNY" ? "" : String(editing && editing.currency === c && editing.rate ? editing.rate : rates[c]));
  };

  const isExp = isExpense;
  const parsed = parseAmount(amount);
  const timeHint = editing
    ? "修改后按新时间统计"
    : defaultTime && time === defaultTime
      ? "自动记录为现在，可修改"
      : "已手动指定时间";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me || !project) return;
    if (!(parsed > 0)) return setError("请输入正确的金额");
    if (images.some((x) => x.status === "uploading")) return setError("图片还在上传，请稍等");
    if (images.some((x) => x.status === "error")) return setError("有图片上传失败，点击图片重试或移除");
    let iso: string | undefined;
    if (time && (editing || time !== defaultTime)) {
      const t = new Date(time);
      if (Number.isNaN(t.getTime())) return setError("时间格式不正确");
      // eslint-disable-next-line react-hooks/purity -- 提交时的事件处理，不在渲染期
      if (t.getTime() > Date.now() + 5 * 60000) return setError("时间不能晚于现在");
      iso = t.toISOString();
    }
    let r: number | undefined;
    if (currency !== "CNY") {
      r = Number(rate);
      if (!(r > 0)) return setError("请填写这笔的汇率");
    }
    setError(null);
    setBusy(true);
    const body = {
      type,
      amount: parsed,
      currency,
      rate: r,
      handler_id: handler,
      note: note.trim(),
      time: iso,
      images: doneIds(images),
      party_id: supplier,
    };
    try {
      if (editing) {
        await patch(`/entries/${editing.id}`, { ...body, project_id: project });
        toast.success("记录已更新");
      } else {
        await post(`/projects/${project}/entries`, body);
        savePrefs({ type, currency, lastProject: project });
        toast.success(`已记录${isExp ? "支出" : "收入"} ${CUR[currency].sym}${fmt(parsed)} ${currency}`);
      }
      onOpenChange(false);
      refresh();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    if (
      !(await confirm({
        title: "删除这条记录？",
        description: "此操作不可撤销。",
        destructive: true,
        confirmText: "删除",
      }))
    )
      return;
    try {
      await del(`/entries/${editing.id}`);
      toast.success("已删除");
      onOpenChange(false);
      refresh();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={editing ? "修改记录" : "记一笔"}>
        <form onSubmit={submit} className="space-y-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={type}
            onValueChange={(v) => v && setType(v as EntryType)}
            className="w-full"
          >
            <ToggleGroupItem value="expense" className="data-[state=on]:text-expense flex-1">
              支出
            </ToggleGroupItem>
            <ToggleGroupItem value="income" className="data-[state=on]:text-income flex-1">
              收入
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="space-y-2">
            <Label htmlFor="entry-amount">金额</Label>
            <InputGroup className="h-12">
              <InputGroupAddon>
                <InputGroupText className="text-lg">{CUR[currency].sym}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="entry-amount"
                autoFocus
                inputMode="decimal"
                placeholder="0.00，支持 120+80"
                className="text-lg tabular-nums"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </InputGroup>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={currency}
              onValueChange={(v) => v && changeCurrency(v as Currency)}
            >
              {CURRENCIES.map((c) => (
                <ToggleGroupItem key={c} value={c} className="px-3">
                  {c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {currency !== "CNY" ? (
            <div className="space-y-2">
              <Label htmlFor="entry-rate">汇率（这笔单独保存）</Label>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>1 {currency} =</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="entry-rate"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>CNY</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>项目</Label>
              <Select
                value={project ? String(project) : ""}
                onValueChange={(v) => {
                  setProject(Number(v));
                  setSupplier(null); // 换项目后清掉供应商（供应商归属项目）
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{isExp ? "谁付的" : "谁收的"}</Label>
              <Select value={handler ? String(handler) : ""} onValueChange={(v) => setHandler(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择成员" />
                </SelectTrigger>
                <SelectContent>
                  {me?.members.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      <MemberAvatar name={m.username} className="size-5 text-[10px]" />
                      {m.username}
                      {m.id === me.user.id ? "（我）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entry-note">备注</Label>
            <Input
              id="entry-note"
              maxLength={200}
              placeholder="用途 / 来源，例如：服务器费"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>供应商（{isExp ? "充值 / 结算" : "退款 / 换钱"}，可选）</Label>
            <Select
              value={supplier ? String(supplier) : NO_SUPPLIER}
              onValueChange={(v) => setSupplier(v === NO_SUPPLIER ? null : Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SUPPLIER}>不挂供应商</SelectItem>
                {(suppliers ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {s.currency !== "CNY" ? `（${s.currency} 结算）` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {isExp
                ? "挂上供应商 = 我们转给他（充值），计入该供应商的「已结算」"
                : "挂上供应商 = 他转给我们（退款 / 换钱），抵减该供应商的「已结算」"}
            </p>
          </div>

          <div className="space-y-2">
            <Label>图片（凭证 / 截图，可选）</Label>
            <EntryImagesInput items={images} onChange={setImages} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="entry-time">时间</Label>
            <div className="flex gap-2">
              <Input id="entry-time" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setTime(toLocalInput(new Date()))}>
                现在
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{timeHint}</p>
          </div>

          <FormError>{error}</FormError>

          <div className="flex gap-2">
            {editing ? (
              <Button type="button" variant="outline" size="icon" onClick={remove} aria-label="删除">
                <Trash2 className="text-destructive" />
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={busy || !project}
              className={cn(
                "flex-1 text-white",
                isExp ? "bg-expense hover:bg-expense/90" : "bg-income hover:bg-income/90",
              )}
            >
              {editing ? "保存" : "记录"}
              {isExp ? "支出" : "收入"}
              {parsed > 0 ? ` · ${CUR[currency].sym}${fmt(parsed)} ${currency}` : ""}
            </Button>
          </div>
        </form>
      </ResponsiveDialog>
      {confirmEl}
    </>
  );
}
