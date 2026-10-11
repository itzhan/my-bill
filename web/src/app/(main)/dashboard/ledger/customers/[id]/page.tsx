"use client";

import { use, useRef, useState } from "react";

import Link from "next/link";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiUrl, del, get, post } from "@/modules/ledger/api";
import { Pager, ResponsiveDialog, useConfirm, usePaged } from "@/modules/ledger/components/shared";
import { fmtSize, money } from "@/modules/ledger/format";
import { useLedger } from "@/modules/ledger/provider";
import type { Currency, CustomerDetail, CustomerProject, PartyContract } from "@/modules/ledger/types";

// 人民币为主，美元/USDT 原币作为小字（参考项目流水的汇率展示）
function Amt({ cny, orig, cur }: { cny: number; orig?: number; cur?: Currency }) {
  const sym = cur === "USD" ? "$" : cur === "USDT" ? "₮" : "";
  return (
    <div className="tabular-nums">
      <div>{money(cny)}</div>
      {cur && cur !== "CNY" && orig != null ? (
        <div className="text-muted-foreground text-xs">
          {sym}
          {orig.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} {cur}
        </div>
      ) : null}
    </div>
  );
}

function RecordsTab({ records }: { records: CustomerDetail["records"] }) {
  const { rows, pager } = usePaged(records, "cust-records");
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>方向</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length ? (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">{r.date}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.project_name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        r.kind === "paid" ? "text-income border-income/30" : "text-warning border-warning/30",
                      )}
                    >
                      {r.kind === "paid" ? "实收" : "应收"}
                      {r.source === "relay" ? " · 中转站" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn("text-right", r.kind === "paid" ? "text-income" : "text-warning")}>
                    <Amt cny={r.cny} orig={r.amount} cur={r.currency} />
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{r.note || "—"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                  还没有记录
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pager {...pager} />
    </div>
  );
}

// 上传合同：弹窗里命名 + 选项目（一个客户可有多个项目）
function UploadContractDialog({
  open,
  onOpenChange,
  projects,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projects: CustomerProject[];
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [partyId, setPartyId] = useState<string>(String(projects[0]?.party_id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (f: File | null) => {
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError("请选择合同文件");
    if (!partyId) return setError("请选择项目");
    if (file.size > 20 * 1024 * 1024) return setError("文件不能超过 20MB");
    setBusy(true);
    setError(null);
    try {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await post(`/parties/${partyId}/contracts`, {
        name: file.name,
        mime: file.type,
        data,
        title: title.trim() || file.name,
      });
      toast.success("合同已上传");
      setFile(null);
      setTitle("");
      onOpenChange(false);
      onDone();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="上传电子合同">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>合同文件（PDF / 图片 / Word 等，≤ 20MB）</Label>
          <input ref={fileRef} type="file" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0] ?? null);
            }}
            className={cn(
              "border-input hover:bg-accent/40 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
              dragging && "border-primary bg-primary/5",
            )}
          >
            <Upload className="text-muted-foreground size-5" />
            {file ? (
              <span className="text-sm font-medium">
                {file.name}（{fmtSize(file.size)}）
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">点击选择文件，或把文件拖到这里</span>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ct-title">合同名称</Label>
          <Input
            id="ct-title"
            maxLength={100}
            placeholder="如 2026 年度服务合同"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>归属项目</Label>
          <Select value={partyId} onValueChange={setPartyId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.party_id} value={String(p.party_id)}>
                  {p.project_name}
                  {p.relay_ref ? <span className="text-muted-foreground"> · 中转客户 {p.relay_ref}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "上传中…" : "上传"}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}

// 记一笔往来：给某个项目记应收 / 实收（实收会同步计入项目收入流水）
function RecordDialog({
  open,
  onOpenChange,
  projects,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projects: CustomerProject[];
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"paid" | "due">("paid");
  const [partyId, setPartyId] = useState<string>(String(projects[0]?.party_id ?? ""));
  const [amount, setAmount] = useState("");
  const defaultCur: Currency = projects.find((p) => String(p.party_id) === partyId)?.currency ?? "CNY";
  const [currency, setCurrency] = useState<Currency>(defaultCur);
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!partyId) return setError("请选择项目");
    if (!(amt > 0)) return setError("请输入正确的金额");
    setBusy(true);
    setError(null);
    try {
      await post(`/parties/${partyId}/records`, { kind, amount: amt, currency, date, note: note.trim() });
      toast.success(kind === "paid" ? "已记实收" : "已记应收");
      setAmount("");
      setNote("");
      onOpenChange(false);
      onDone();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="记一笔往来">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>类型</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "paid" | "due")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paid">实收（收到客户款，计入项目收入）</SelectItem>
              <SelectItem value="due">应收（手动补一笔应收）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>归属项目</Label>
          <Select
            value={partyId}
            onValueChange={(v) => {
              setPartyId(v);
              const cur = projects.find((p) => String(p.party_id) === v)?.currency;
              if (cur) setCurrency(cur);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.party_id} value={String(p.party_id)}>
                  {p.project_name}
                  {p.relay_ref ? <span className="text-muted-foreground"> · 中转客户 {p.relay_ref}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="rec-amount">金额</Label>
            <Input
              id="rec-amount"
              inputMode="decimal"
              placeholder="如 5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>币种</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CNY">CNY 人民币</SelectItem>
                <SelectItem value="USD">USD 美元</SelectItem>
                <SelectItem value="USDT">USDT</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-date">日期</Label>
          <Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-note">备注（可选）</Label>
          <Input
            id="rec-note"
            maxLength={200}
            placeholder="如 小米单子结清"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}

function ContractsCard({
  customerId,
  contracts,
  projects,
}: {
  customerId: number;
  contracts: PartyContract[];
  projects: CustomerProject[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const reload = () => qc.invalidateQueries({ queryKey: ["ledger", "customer-detail", customerId] });

  const remove = async (c: PartyContract) => {
    if (!(await confirm({ title: `删除合同「${c.title}」？`, destructive: true, confirmText: "删除" }))) return;
    try {
      await del(`/party-contracts/${c.id}`);
      toast.success("已删除");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">电子合同（{contracts.length}）</CardTitle>
          <CardDescription>与该客户所有项目的电子合同 · 可命名并归属到具体项目</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Upload />
          上传合同
        </Button>
      </CardHeader>
      <CardContent>
        {contracts.length ? (
          <div className="divide-y rounded-md border">
            {contracts.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3">
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {c.project_name ? `${c.project_name} · ` : ""}
                    {fmtSize(c.size)} · {c.creator_name} · {new Date(c.created_at).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" title="查看 / 下载" asChild>
                  <a href={apiUrl(c.url)} target="_blank" rel="noreferrer">
                    <ExternalLink />
                  </a>
                </Button>
                <Button variant="ghost" size="icon-sm" title="删除" onClick={() => remove(c)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">还没有合同，点「上传合同」添加</p>
        )}
      </CardContent>
      <UploadContractDialog open={open} onOpenChange={setOpen} projects={projects} onDone={reload} />
      {confirmEl}
    </Card>
  );
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cid = Number(id);
  const { openParty } = useLedger();
  const qc = useQueryClient();
  const [recOpen, setRecOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", "customer-detail", cid],
    queryFn: () => get<CustomerDetail>(`/customers/${cid}/detail`),
  });
  const reloadDetail = () => qc.invalidateQueries({ queryKey: ["ledger", "customer-detail", cid] });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return <div className="text-muted-foreground py-10 text-center">加载失败</div>;

  const { customer: c, projects, records, contracts } = data;
  const credit = c.settle_type === "credit";
  const usdRate = data.rates.USD || 7.2;
  const balCny = c.balance_usd != null ? c.balance_usd * usdRate : null;
  const thrCny = c.balance_threshold != null ? c.balance_threshold * usdRate : null;
  // 金额换算说明用：标准消耗美金（应收 ÷ 折扣 ÷ 汇率，各中转项目相加）、已收/未收折美金
  const usd = (n: number) => `$${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  const consUsd = projects
    .filter((p) => p.project_type !== "short")
    .reduce((a, p) => {
      const dueUsd = p.currency === "USD" ? p.settle.due : p.settle.due_cny / usdRate;
      return a + (p.ratio > 0 ? dueUsd / p.ratio : dueUsd);
    }, 0);
  const paidUsd = c.settle.paid_cny / usdRate;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/ledger/customers"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> 返回客户列表
        </Link>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{c.name}</h1>
            <Badge variant="outline">{credit ? "后付" : "预付"}</Badge>
            {c.archived ? <Badge variant="outline">归档</Badge> : null}
            <span className="text-muted-foreground text-sm">折扣 {+c.ratio.toFixed(4)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setRecOpen(true)}>
              <Plus />
              记一笔
            </Button>
            <Button variant="outline" onClick={() => openParty(cid)}>
              <Pencil />
              编辑客户
            </Button>
          </div>
        </div>
        {c.profile ? <p className="text-muted-foreground max-w-3xl text-sm">{c.profile}</p> : null}
      </div>

      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {!credit ? (
          <Card className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>当前余额</CardDescription>
              <CardTitle
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  thrCny != null && balCny != null && balCny < thrCny ? "text-destructive" : "text-income",
                )}
              >
                {balCny != null ? money(balCny) : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">
              {c.balance_usd != null
                ? `中转站余额 $${c.balance_usd.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`
                : "中转站余额"}
              {c.balance_threshold != null ? ` · 阈值 $${c.balance_threshold}` : ""}
            </CardContent>
          </Card>
        ) : null}
        <Card className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardDescription>累计消费</CardDescription>
            <CardTitle className="text-expense text-xl font-semibold tabular-nums">{money(c.settle.due_cny)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground px-5 text-xs">
            标准消耗 {usd(consUsd)} × 折扣 × 汇率 {usdRate}
          </CardContent>
        </Card>
        <Card className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardDescription>已收</CardDescription>
            <CardTitle className="text-income text-xl font-semibold tabular-nums">{money(c.settle.paid_cny)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground px-5 text-xs">
            已收款 {usd(paidUsd)} × 汇率 {usdRate}
          </CardContent>
        </Card>
        <Card className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardDescription>{credit ? "欠费" : "未收"}</CardDescription>
            <CardTitle className={cn("text-xl font-semibold tabular-nums", c.settle.open_cny > 0 && "text-warning")}>
              {money(c.settle.open_cny)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground px-5 text-xs">
            累计消费 − 已收 · {usd(c.settle.open_cny / usdRate)}
          </CardContent>
        </Card>
        {credit ? (
          <Card className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{c.term?.overdue ? "已逾期" : "账期"}</CardDescription>
              <CardTitle className={cn("text-xl font-semibold tabular-nums", c.term?.overdue && "text-destructive")}>
                {c.term ? `${c.term.days_to_due} 天` : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">
              {c.term ? `${c.term_days} 天一期 · 到期 ${c.term.due_date}` : "未设账期"}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">合作项目（{projects.length}）</CardTitle>
          <CardDescription>中转项目按消费 / 结算；项目制项目按项目实际收入 − 支出（折人民币）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>中转客户</TableHead>
                  <TableHead className="text-right">折扣</TableHead>
                  <TableHead className="text-right">累计消费</TableHead>
                  <TableHead className="text-right">已收</TableHead>
                  <TableHead className="text-right">未收</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.party_id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/ledger/projects/${p.project_id}`}
                        className="text-primary hover:underline"
                      >
                        {p.project_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.project_type === "short" ? "项目制" : "中转"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.relay_ref ? p.relay_ref : "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {p.project_type === "short" ? "—" : +p.ratio.toFixed(4)}
                    </TableCell>
                    {p.project_type === "short" ? (
                      <>
                        <TableCell className="text-income text-right tabular-nums">
                          <div>{money(p.summary?.income.base ?? 0)}</div>
                          <div className="text-muted-foreground text-xs">项目收入</div>
                        </TableCell>
                        <TableCell className="text-expense text-right tabular-nums">
                          <div>{money(p.summary?.expense.base ?? 0)}</div>
                          <div className="text-muted-foreground text-xs">项目支出</div>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium tabular-nums",
                            (p.summary?.profit ?? 0) >= 0 ? "text-income" : "text-expense",
                          )}
                        >
                          <div>{money(p.summary?.profit ?? 0)}</div>
                          <div className="text-muted-foreground text-xs font-normal">收入 − 支出</div>
                        </TableCell>
                      </>
                    ) : (
                      (() => {
                        const dueUsd = p.currency === "USD" ? p.settle.due : p.settle.due_cny / usdRate;
                        const consUsdP = p.ratio > 0 ? dueUsd / p.ratio : dueUsd;
                        return (
                          <>
                            <TableCell className="text-expense text-right tabular-nums">
                              <div>{money(p.settle.due_cny)}</div>
                              <div className="text-muted-foreground text-xs">
                                {usd(consUsdP)} × {+p.ratio.toFixed(4)} × {usdRate}
                              </div>
                            </TableCell>
                            <TableCell className="text-income text-right tabular-nums">
                              <div>{money(p.settle.paid_cny)}</div>
                              <div className="text-muted-foreground text-xs">
                                {usd(p.settle.paid_cny / usdRate)} × {usdRate}
                              </div>
                            </TableCell>
                            <TableCell
                              className={cn("text-right tabular-nums", p.settle.open_cny > 0 && "text-warning")}
                            >
                              <div>{money(p.settle.open_cny)}</div>
                              <div className="text-muted-foreground text-xs font-normal">累计消费 − 已收</div>
                            </TableCell>
                          </>
                        );
                      })()
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <RecordDialog open={recOpen} onOpenChange={setRecOpen} projects={projects} onDone={reloadDetail} />

      <ContractsCard customerId={cid} contracts={contracts} projects={projects} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">中转消耗记录</CardTitle>
          <CardDescription>中转站按日自动挂账的消耗（应收）与实收明细，折人民币</CardDescription>
        </CardHeader>
        <CardContent>
          <RecordsTab records={records} />
        </CardContent>
      </Card>
    </div>
  );
}
