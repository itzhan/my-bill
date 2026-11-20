"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { get, post } from "@/modules/ledger/api";
import { FormError, PageHeader, Pager, ResponsiveDialog, usePaged } from "@/modules/ledger/components/shared";
import { money } from "@/modules/ledger/format";
import { useLedgerRefresh } from "@/modules/ledger/hooks";
import type { CustomerGroup, CustomersResponse } from "@/modules/ledger/types";

function AddCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const refresh = useLedgerRefresh();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setContact("");
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("请填写客户名称");
    setBusy(true);
    setError(null);
    try {
      await post("/customers", { name: name.trim(), contact: contact.trim() });
      toast.success(`已添加客户「${name.trim()}」`);
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
      title="添加客户"
      description="全局建档后，可在任意项目的「往来」中直接关联该客户"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cust-name">客户名称 *</Label>
          <Input
            id="cust-name"
            autoFocus
            maxLength={60}
            placeholder="例如：闪马"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cust-contact">联系方式（可选）</Label>
          <Input
            id="cust-contact"
            maxLength={100}
            placeholder="微信 / 飞书 / 电话"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </div>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "保存中…" : "添加客户"}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

export default function CustomersPage() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["ledger", "customers"],
    queryFn: () => get<CustomersResponse>("/customers"),
  });
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const listAll = useMemo(
    () => data?.customers ?? [...(data?.relay_customers ?? []), ...(data?.project_customers ?? [])],
    [data],
  );

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return listAll
      .filter((c) => showArchived || !c.archived)
      .filter(
        (c) =>
          !kw ||
          c.name.toLowerCase().includes(kw) ||
          (c.project_names ?? c.parties.map((p) => p.project_name)).some((n) => n.toLowerCase().includes(kw)),
      )
      .sort((a, b) => b.due_cny - a.due_cny);
  }, [listAll, q, showArchived]);
  const { rows, pager } = usePaged(filtered, `${q}|${showArchived}`);

  const active = listAll.filter((c) => !c.archived);
  const totalDue = active.reduce((a, c) => a + c.due_cny, 0);
  const totalPaid = active.reduce((a, c) => a + c.paid_cny, 0);
  const totalUnpaid = totalDue - totalPaid;
  const archivedCount = listAll.length - active.length;

  const stats = [
    {
      label: "客户数",
      value: active.length,
      sub: archivedCount ? `另有 ${archivedCount} 家已归档` : "全部活跃客户",
      cls: "",
    },
    {
      label: "应支付合计",
      value: money(totalDue),
      sub: "所有项目中客户累计消费（应收）",
      cls: "text-expense",
    },
    {
      label: "已支付合计",
      value: money(totalPaid),
      sub: "所有项目中客户已付金额（实收）",
      cls: "text-income",
    },
    {
      label: "未支付合计",
      value: (totalUnpaid < 0 ? "−" : "") + money(Math.abs(totalUnpaid)),
      sub: "应支付 − 已支付（正=待收款，负=预收结余）",
      cls: totalUnpaid > 0 ? "text-warning" : "text-income",
    },
  ];

  const projectsOf = (c: CustomerGroup) =>
    c.project_names?.length
      ? c.project_names
      : [...new Set(c.parties.map((p) => p.project_name).filter(Boolean))];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="客户"
        description="统一管理全部客户，汇总每个客户在所有项目的应支付、已支付与未支付"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            添加客户
          </Button>
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
            <CardTitle>客户列表</CardTitle>
            <CardDescription>点击进入客户详情，查看各项目明细、合同发票与收款记录</CardDescription>
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
            <div className="relative w-full sm:w-64">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input placeholder="搜索客户 / 项目" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>客户</TableHead>
                    <TableHead className="text-right">应支付</TableHead>
                    <TableHead className="text-right">已支付</TableHead>
                    <TableHead className="text-right">未支付</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length ? (
                    rows.map((c) => {
                      const pnames = projectsOf(c);
                      return (
                        <TableRow
                          key={c.key}
                          className={cn("cursor-pointer align-top", c.archived && "opacity-60")}
                          onClick={() => router.push(`/dashboard/ledger/customers/${c.detail_party_id}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5 font-medium">
                              {c.name}
                              {c.archived ? <Badge variant="outline">归档</Badge> : null}
                              {c.overdue ? <Badge variant="destructive">逾期</Badge> : null}
                            </div>
                            <div className="text-muted-foreground mt-0.5 text-xs">
                              {pnames.length ? pnames.join("、") : "暂无关联项目"}
                            </div>
                          </TableCell>
                          <TableCell className="text-expense text-right tabular-nums">{money(c.due_cny)}</TableCell>
                          <TableCell className="text-income text-right tabular-nums">{money(c.paid_cny)}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-medium tabular-nums",
                              c.open_cny > 0 ? "text-warning" : c.open_cny < 0 ? "text-income" : "text-muted-foreground",
                            )}
                            title={c.open_cny > 0 ? "客户还欠我们" : c.open_cny < 0 ? "预付结余 / 多付" : "已结清"}
                          >
                            {(c.open_cny < 0 ? "−" : "") + money(Math.abs(c.open_cny))}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground py-10 text-center">
                        {listAll.length ? "没有符合条件的客户" : "还没有客户，点右上角「添加客户」开始"}
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

      <AddCustomerDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
