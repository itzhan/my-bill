"use client";

import { useMemo, useState } from "react";

import Link from "next/link";

import type { ColumnDef } from "@tanstack/react-table";
import { FolderPlus, Search } from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDataTableInstance } from "@/hooks/use-data-table-instance";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/modules/ledger/components/shared";
import { money, relTime, signed } from "@/modules/ledger/format";
import { useProjects } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { ProjectWithSummary } from "@/modules/ledger/types";

type Row = ProjectWithSummary & { income: number; expense: number; profit: number; count: number; last: number };

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="项目" />,
    cell: ({ row }) => (
      <Link
        prefetch={false}
        href={`/dashboard/ledger/projects/${row.original.id}`}
        className="flex items-center gap-2 font-medium hover:underline"
      >
        <span className="max-w-72 truncate">{row.original.name}</span>
        {row.original.archived ? <Badge variant="outline">已归档</Badge> : null}
      </Link>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "income",
    header: ({ column }) => <DataTableColumnHeader column={column} title="收入" />,
    cell: ({ row }) => <span className="text-income tabular-nums">{money(row.original.income)}</span>,
  },
  {
    accessorKey: "expense",
    header: ({ column }) => <DataTableColumnHeader column={column} title="支出" />,
    cell: ({ row }) => <span className="text-expense tabular-nums">{money(row.original.expense)}</span>,
  },
  {
    accessorKey: "profit",
    header: ({ column }) => <DataTableColumnHeader column={column} title="利润" />,
    cell: ({ row }) => (
      <b className={cn("tabular-nums", row.original.profit < 0 && "text-expense")}>{signed(row.original.profit)}</b>
    ),
  },
  {
    accessorKey: "count",
    header: ({ column }) => <DataTableColumnHeader column={column} title="笔数" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.count}</span>,
  },
  {
    accessorKey: "last",
    header: ({ column }) => <DataTableColumnHeader column={column} title="最近记账" />,
    cell: ({ row }) => <span className="text-muted-foreground">{relTime(row.original.summary.last_at)}</span>,
  },
  {
    accessorKey: "creator_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="创建者" />,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.creator_name}</span>,
  },
];

export default function ProjectsPage() {
  const { openProject } = useLedger();
  const { data } = useProjects();
  const [status, setStatus] = useState("active");

  const rows = useMemo<Row[]>(
    () =>
      (data?.projects ?? [])
        .filter((p) => (status === "all" ? true : status === "archived" ? !!p.archived : !p.archived))
        .map((p) => ({
          ...p,
          income: p.summary.income.base,
          expense: p.summary.expense.base,
          profit: p.summary.profit,
          count: p.summary.count,
          last: p.summary.last_at ? new Date(p.summary.last_at).getTime() : 0,
        })),
    [data, status],
  );

  const table = useDataTableInstance({ data: rows, columns, enableRowSelection: false });
  const archivedCount = data?.projects.filter((p) => p.archived).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="项目"
        description="按项目分别记录支出与收入；归档项目不计入总览、报表和导出"
        actions={
          <Button onClick={() => openProject()}>
            <FolderPlus />
            新建项目
          </Button>
        }
      />
      <Card>
        <CardHeader className="flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>项目列表</CardTitle>
            <CardDescription>点击项目名查看流水、往来和成员资金</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={status}
              onValueChange={(v) => v && setStatus(v)}
            >
              <ToggleGroupItem value="active" className="px-3">
                进行中
              </ToggleGroupItem>
              <ToggleGroupItem value="archived" className="px-3">
                已归档 {archivedCount ? archivedCount : ""}
              </ToggleGroupItem>
              <ToggleGroupItem value="all" className="px-3">
                全部
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="relative w-full sm:w-[200px]">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="搜索项目…"
                value={String(table.getColumn("name")?.getFilterValue() ?? "")}
                onChange={(e) => table.getColumn("name")?.setFilterValue(e.target.value)}
                className="w-full pl-9"
              />
            </div>
            <DataTableViewOptions table={table} />
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
            <Skeleton className="h-64" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
