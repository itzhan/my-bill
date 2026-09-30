"use client";

// 导出记录：留档的导出文件列表（放在报表页的「导出记录」Tab 里）

import { useMemo, useState } from "react";

import Link from "next/link";

import type { ColumnDef } from "@tanstack/react-table";
import { FilePlus2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDataTableInstance } from "@/hooks/use-data-table-instance";
import { cn } from "@/lib/utils";

import { apiUrl, del, post } from "../api";
import { RANGES, fmtSize, relTime } from "../format";
import { useExports, useProjects } from "../hooks";
import type { ExportItem } from "../types";

import { FormError, ResponsiveDialog, useConfirm } from "./shared";

const SOURCE_LABEL: Record<string, string> = { manual: "手动", auto: "自动", ai: "AI 助手" };
const rangeName = (k: string) => RANGES.find(([r]) => r === k)?.[1] ?? k;

function NewExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: pd } = useProjects();
  const [scope, setScope] = useState("all");
  const [range, setRange] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState("both");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (range === "custom" && !(from && to)) return setError("请选择起止日期");
    setBusy(true);
    setError(null);
    try {
      await post("/exports", { scope, range, from, to, format });
      toast.success("已保存到导出记录");
      onOpenChange(false);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="存一份导出"
      description="生成 Excel（含 AI 报表）和 / 或 Markdown，保存到导出记录，团队成员随时下载。"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>范围</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部项目</SelectItem>
              {pd?.projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>区间</Label>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {range === "custom" ? (
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label>格式</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Excel + Markdown</SelectItem>
              <SelectItem value="xlsx">仅 Excel</SelectItem>
              <SelectItem value="md">仅 AI 报表 Markdown</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FormError>{error}</FormError>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "生成中…" : "生成并保存"}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}

export function ExportsPanel() {
  const { data } = useExports();
  const { data: pd } = useProjects();
  const [confirm, confirmEl] = useConfirm();
  const [open, setOpen] = useState(false);

  const remove = async (id: number) => {
    if (!(await confirm({ title: "删除这个导出文件？", destructive: true, confirmText: "删除" }))) return;
    try {
      await del(`/exports/${id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const columns = useMemo<ColumnDef<ExportItem>[]>(
    () => [
      {
        accessorKey: "format",
        header: "格式",
        cell: ({ row }) => (
          <Badge variant={row.original.format === "md" ? "secondary" : "outline"}>
            {row.original.format === "md" ? "MD" : "XLS"}
          </Badge>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="文件" />,
        cell: ({ row }) => (
          <a href={apiUrl(row.original.url)} download className="block max-w-96 truncate font-medium hover:underline">
            {row.original.name}
          </a>
        ),
        enableHiding: false,
      },
      {
        accessorKey: "source",
        header: "来源",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {SOURCE_LABEL[row.original.source] || row.original.source}
            {row.original.creator_name ? ` · ${row.original.creator_name}` : ""}
          </span>
        ),
      },
      {
        accessorKey: "size",
        header: ({ column }) => <DataTableColumnHeader column={column} title="大小" />,
        cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{fmtSize(row.original.size)}</span>,
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="时间" />,
        cell: ({ row }) => <span className="text-muted-foreground">{relTime(row.original.created_at)}</span>,
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <Button variant="ghost" size="icon-sm" onClick={() => remove(row.original.id)} title="删除">
            <Trash2 />
          </Button>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const table = useDataTableInstance({ data: data?.exports ?? [], columns, enableRowSelection: false });
  const a = data?.auto_export;
  const scopeName =
    a?.scope === "all"
      ? "全部项目"
      : (pd?.projects.find((p) => String(p.id) === String(a?.scope))?.name ?? `项目 ${a?.scope}`);

  return (
    <>
      <Card>
        <CardHeader className="flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>导出记录</CardTitle>
            <CardDescription>右上角「导出 Excel」是直接下载；这里是留档文件，也可以让 AI 助手帮你导出</CardDescription>
            <CardDescription className="flex items-center gap-2">
              <span
                className={cn("inline-block size-2 rounded-full", a?.enabled ? "bg-income" : "bg-muted-foreground/40")}
              />
              {a?.enabled
                ? `每天 ${a.time} 自动导出「${scopeName} · ${rangeName(a.range)}」的 Excel 与 AI 报表`
                : "未开启自动导出"}
              <Link
                prefetch={false}
                href="/dashboard/ledger/settings?tab=export"
                className="text-primary hover:underline"
              >
                去设置
              </Link>
            </CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <div className="relative w-full sm:w-[220px]">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="搜索文件…"
                value={String(table.getColumn("name")?.getFilterValue() ?? "")}
                onChange={(e) => table.getColumn("name")?.setFilterValue(e.target.value)}
                className="w-full pl-9"
              />
            </div>
            <Button onClick={() => setOpen(true)}>
              <FilePlus2 />
              存一份导出
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data ? (
            <>
              <div className="overflow-hidden rounded-md border">
                <DataTable table={table} columns={columns} />
              </div>
              <DataTablePagination table={table} />
            </>
          ) : (
            <Skeleton className="h-48" />
          )}
        </CardContent>
      </Card>
      <NewExportDialog open={open} onOpenChange={setOpen} />
      {confirmEl}
    </>
  );
}
