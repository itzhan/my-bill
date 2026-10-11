"use client";

import { use, useRef, useState } from "react";

import Link from "next/link";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiUrl, del, get, post } from "@/modules/ledger/api";
import { Pager, useConfirm, usePaged } from "@/modules/ledger/components/shared";
import { curf, fmtSize, usdf } from "@/modules/ledger/format";
import type { CustomerDetail, PartyContract } from "@/modules/ledger/types";

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
                  <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap">{r.date}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.project_name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(r.kind === "paid" ? "text-income border-income/30" : "text-warning border-warning/30")}
                    >
                      {r.kind === "paid" ? "实收" : "应收"}
                      {r.source === "relay" ? " · 中转站" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", r.kind === "paid" ? "text-income" : "text-warning")}
                  >
                    {curf(r.amount, r.currency)}
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

function ContractsCard({ customerId, contracts }: { customerId: number; contracts: PartyContract[] }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const reload = () => qc.invalidateQueries({ queryKey: ["ledger", "customer-detail", customerId] });

  const upload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) return toast.error("文件不能超过 20MB");
    setBusy(true);
    try {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await post(`/parties/${customerId}/contracts`, { name: file.name, mime: file.type, data, title: file.name });
      toast.success("合同已上传");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
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
          <CardDescription>与该客户的所有电子合同 · PDF / 图片 / Word 等，最大 20MB</CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className={cn(busy && "animate-pulse")} />
          {busy ? "上传中…" : "上传合同"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
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
      {confirmEl}
    </Card>
  );
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cid = Number(id);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", "customer-detail", cid],
    queryFn: () => get<CustomerDetail>(`/customers/${cid}/detail`),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return <div className="text-muted-foreground py-10 text-center">加载失败</div>;

  const { customer: c, projects, records, contracts } = data;
  const credit = c.settle_type === "credit";

  const kpis = credit
    ? [
        { label: "累计消费", value: curf(c.settle.due, c.currency), sub: "消费 × 折扣", cls: "" },
        { label: "已收", value: curf(c.settle.paid, c.currency), sub: "已收款", cls: "text-income" },
        {
          label: "欠费",
          value: curf(c.settle.open, c.currency),
          sub: "累计消费 − 已收",
          cls: c.settle.open > 0 ? "text-warning" : "",
        },
        {
          label: c.term?.overdue ? "已逾期" : "账期",
          value: c.term ? `${c.term.days_to_due} 天` : "—",
          sub: c.term ? `${c.term_days} 天一期 · 到期 ${c.term.due_date}` : "未设账期",
          cls: c.term?.overdue ? "text-destructive" : "",
        },
      ]
    : [
        {
          label: "当前余额",
          value: c.balance_usd != null ? usdf(c.balance_usd) : "—",
          sub: c.balance_threshold != null ? `阈值 ${usdf(c.balance_threshold)}` : "中转站余额",
          cls: c.balance_usd != null && c.balance_threshold != null && c.balance_usd < c.balance_threshold ? "text-destructive" : "text-income",
        },
        { label: "累计消费", value: curf(c.settle.due, c.currency), sub: "消费 × 折扣", cls: "text-expense" },
        { label: "已收", value: curf(c.settle.paid, c.currency), sub: "已收款", cls: "text-income" },
        { label: "未收", value: curf(c.settle.open, c.currency), sub: "累计消费 − 已收", cls: c.settle.open > 0 ? "text-warning" : "" },
      ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/ledger/customers"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> 返回客户列表
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <Badge variant="outline">{credit ? "后付" : "预付"}</Badge>
          {c.archived ? <Badge variant="outline">归档</Badge> : null}
          <span className="text-muted-foreground text-sm">折扣 {+c.ratio.toFixed(4)}</span>
        </div>
      </div>

      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className={cn("text-xl font-semibold tabular-nums", k.cls)}>{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground px-5 text-xs">{k.sub}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">合作项目（{projects.length}）</CardTitle>
          <CardDescription>该客户在各项目的消费与结算</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目</TableHead>
                  <TableHead>类型</TableHead>
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
                      <Badge variant="outline">{p.project_type === "short" ? "短期" : "中转"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{+p.ratio.toFixed(4)}</TableCell>
                    <TableCell className="text-right tabular-nums">{curf(p.settle.due, p.currency)}</TableCell>
                    <TableCell className="text-income text-right tabular-nums">{curf(p.settle.paid, p.currency)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", p.settle.open > 0 && "text-warning")}>
                      {curf(p.settle.open, p.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">往来交易记录</CardTitle>
          <CardDescription>与该客户的应收 / 实收明细（含中转站自动挂账）</CardDescription>
        </CardHeader>
        <CardContent>
          <RecordsTab records={records} />
        </CardContent>
      </Card>

      <ContractsCard customerId={cid} contracts={contracts} />
    </div>
  );
}
