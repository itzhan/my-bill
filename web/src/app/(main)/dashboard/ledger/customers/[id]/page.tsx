"use client";

import { use, useRef, useState } from "react";

import Link from "next/link";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Pencil, Trash2, Upload } from "lucide-react";
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
              <TableHead>登记人</TableHead>
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
                  <TableCell className="text-muted-foreground text-xs">{r.creator_name || "—"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                  还没有往来记录
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
              pick(e.dataTransfer.files?.[0] ?? null);
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
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", "customer-detail", cid],
    queryFn: () => get<CustomerDetail>(`/customers/${cid}/detail`),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return <div className="text-muted-foreground py-10 text-center">加载失败</div>;

  const { customer: c, projects, records, contracts } = data;
  const credit = c.settle_type === "credit";
  const usdRate = data.rates.USD || 7.2;
  const balCny = c.balance_usd != null ? c.balance_usd * usdRate : null;
  const thrCny = c.balance_threshold != null ? c.balance_threshold * usdRate : null;

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
          <Button variant="outline" onClick={() => openParty(cid)}>
            <Pencil />
            编辑客户
          </Button>
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
            消费 × 折扣{c.currency !== "CNY" ? ` · ${c.settle.due.toLocaleString("zh-CN")} ${c.currency}` : ""}
          </CardContent>
        </Card>
        <Card className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardDescription>已收</CardDescription>
            <CardTitle className="text-income text-xl font-semibold tabular-nums">{money(c.settle.paid_cny)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground px-5 text-xs">
            已收款{c.currency !== "CNY" ? ` · ${c.settle.paid.toLocaleString("zh-CN")} ${c.currency}` : ""}
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
            累计消费 − 已收{c.currency !== "CNY" ? ` · ${c.settle.open.toLocaleString("zh-CN")} ${c.currency}` : ""}
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
                  <TableHead className="text-right">累计消费 / 收入</TableHead>
                  <TableHead className="text-right">已收 / 支出</TableHead>
                  <TableHead className="text-right">未收 / 利润</TableHead>
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
                          {money(p.summary?.income.base ?? 0)}
                        </TableCell>
                        <TableCell className="text-expense text-right tabular-nums">
                          {money(p.summary?.expense.base ?? 0)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium tabular-nums",
                            (p.summary?.profit ?? 0) >= 0 ? "text-income" : "text-expense",
                          )}
                        >
                          {money(p.summary?.profit ?? 0)}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right">
                          <Amt cny={p.settle.due_cny} orig={p.settle.due} cur={p.currency} />
                        </TableCell>
                        <TableCell className="text-income text-right">
                          <Amt cny={p.settle.paid_cny} orig={p.settle.paid} cur={p.currency} />
                        </TableCell>
                        <TableCell className={cn("text-right", p.settle.open_cny > 0 && "text-warning")}>
                          <Amt cny={p.settle.open_cny} orig={p.settle.open} cur={p.currency} />
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ContractsCard customerId={cid} contracts={contracts} projects={projects} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">往来交易记录</CardTitle>
          <CardDescription>与该客户的应收 / 实收明细（含中转站自动挂账，折人民币）</CardDescription>
        </CardHeader>
        <CardContent>
          <RecordsTab records={records} />
        </CardContent>
      </Card>
    </div>
  );
}
