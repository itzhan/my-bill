"use client";

import type { ReactNode } from "react";

import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { dayKey, dayLabel, fmt, fmtTime } from "../format";
import type { Entry } from "../types";

import { EntryImageGallery } from "./entry-images";
import { MemberAvatar, ResponsiveDialog } from "./shared";

// 一笔记录的详情：金额、经手人、备注全文和图片；登记人本人或项目创建者可以从这里进入修改
export function EntryDetailDialog({
  entry: e,
  canEdit,
  onOpenChange,
  onEdit,
}: {
  entry: Entry | null;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (e: Entry) => void;
}) {
  const isExp = e?.type === "expense";
  return (
    <ResponsiveDialog open={!!e} onOpenChange={onOpenChange} title={isExp ? "支出详情" : "收入详情"}>
      {e ? (
        <div className="space-y-4">
          <div>
            <div className={cn("text-2xl font-semibold tabular-nums", isExp ? "text-expense" : "text-income")}>
              {isExp ? "−" : "+"}
              {fmt(e.amount)} <span className="text-muted-foreground text-base">{e.currency}</span>
            </div>
            {e.currency !== "CNY" ? (
              <div className="text-muted-foreground text-sm tabular-nums">
                ≈ ¥{fmt(e.base)} · 汇率 {e.rate}
              </div>
            ) : null}
          </div>

          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <Row label="项目">{e.project_name}</Row>
            <Row label={isExp ? "谁付的" : "谁收的"}>
              <span className="inline-flex items-center gap-1.5">
                <MemberAvatar name={e.handler_name} className="size-5 text-[10px]" />
                {e.handler_name}
              </span>
            </Row>
            {e.created_by !== e.handler_id ? <Row label="登记人">{e.creator_name}</Row> : null}
            <Row label="时间">
              {dayLabel(dayKey(e.created_at))} {fmtTime(e.created_at)}
            </Row>
            <Row label="备注">
              <span className="break-all whitespace-pre-wrap">{e.note || "—"}</span>
            </Row>
          </dl>

          <div className="space-y-2">
            <div className="text-muted-foreground text-sm">图片{e.images.length ? `（${e.images.length}）` : ""}</div>
            {e.images.length ? (
              <EntryImageGallery images={e.images} />
            ) : (
              <p className="text-muted-foreground text-xs">没有上传图片{canEdit ? "，可点「修改」补传" : ""}</p>
            )}
          </div>

          {canEdit ? (
            <Button variant="outline" className="w-full" onClick={() => onEdit(e)}>
              <Pencil />
              修改
            </Button>
          ) : null}
        </div>
      ) : null}
    </ResponsiveDialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
