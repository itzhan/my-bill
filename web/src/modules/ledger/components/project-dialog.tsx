"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { del, patch, post } from "../api";
import { useLedgerRefresh, useMe } from "../hooks";
import type { Project } from "../types";

import { FormError, ResponsiveDialog, useConfirm } from "./shared";

type Removed = { removed?: { entries?: number; records?: number; transfers?: number } };

export function ProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
}) {
  const { data: me } = useMe();
  const router = useRouter();
  const refresh = useLedgerRefresh();
  const [confirm, confirmEl] = useConfirm();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [ptype, setPtype] = useState<"relay" | "short" | "key">("relay");
  const [category, setCategory] = useState<"customer" | "company">("customer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setNote(project?.note ?? "");
    setPtype(project?.ptype ?? "relay");
    setCategory(project?.category === "company" ? "company" : "customer");
    setError(null);
  }, [open, project]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("请填写项目名称");
    setBusy(true);
    setError(null);
    try {
      if (project) {
        await patch(`/projects/${project.id}`, { name: name.trim(), note: note.trim(), ptype, category });
        toast.success("项目已更新");
        onOpenChange(false);
        refresh();
      } else {
        const d = await post<{ project: Project }>("/projects", {
          name: name.trim(),
          note: note.trim(),
          ptype,
          category,
        });
        toast.success(`项目「${d.project.name}」已创建`);
        onOpenChange(false);
        refresh();
        router.push(`/dashboard/ledger/projects/${d.project.id}`);
      }
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    if (!project) return;
    const toArchive = !project.archived;
    if (
      toArchive &&
      !(await confirm({ title: `归档「${project.name}」？`, description: "归档后不能再记账，但数据与统计都会保留。" }))
    )
      return;
    try {
      await patch(`/projects/${project.id}`, { archived: toArchive });
      toast.success(toArchive ? "项目已归档" : "项目已恢复");
      onOpenChange(false);
      refresh();
    } catch (ex) {
      setError((ex as Error).message);
    }
  };

  // 清空 / 删除项目：要手打项目名确认，删掉的数据立刻不再进入任何统计
  const danger = async (action: "clear" | "delete") => {
    if (!project) return;
    const isDelete = action === "delete";
    const ok = await confirm({
      title: isDelete ? `删除项目「${project.name}」` : `清空「${project.name}」的记录`,
      description: isDelete
        ? "它的全部流水、供应商 / 客户、往来记录、成员转账和项目群聊都会被删除，之后所有统计、报表、导出都不再包含这些数据。此操作不可恢复。"
        : "删除它的全部流水、往来记录和成员转账（供应商 / 客户名单保留），之后所有统计都不再包含这些数据。此操作不可恢复。",
      typeToConfirm: project.name,
      destructive: true,
      confirmText: isDelete ? "删除项目" : "清空记录",
    });
    if (!ok) return;
    try {
      const d = isDelete
        ? await del<Removed>(`/projects/${project.id}`)
        : await post<Removed>(`/projects/${project.id}/clear`);
      const r = d.removed || {};
      toast.success(
        `${isDelete ? "已删除项目" : "已清空"}「${project.name}」：流水 ${r.entries || 0} 笔、往来 ${r.records || 0} 笔、转账 ${r.transfers || 0} 笔`,
      );
      onOpenChange(false);
      refresh();
      if (isDelete) router.push("/dashboard/ledger/projects");
    } catch (ex) {
      setError((ex as Error).message);
    }
  };

  const isOwner = !!project && project.created_by === me?.user.id;

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={project ? "编辑项目" : "新建项目"}>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">项目名称</Label>
            <Input id="project-name" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>项目类别</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={category}
              onValueChange={(v) => v && setCategory(v as "customer" | "company")}
              className="w-full"
            >
              <ToggleGroupItem value="customer" className="flex-1 data-[state=on]:font-semibold">
                客户
              </ToggleGroupItem>
              <ToggleGroupItem value="company" className="flex-1 data-[state=on]:font-semibold">
                公司日常
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-muted-foreground text-xs">
              {category === "company"
                ? "公司日常：公司内部开销，可上传合同供团队查看"
                : "客户：对外客户项目，按客户维度结算"}
            </p>
          </div>
          <div className="space-y-2">
            <Label>项目类型</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={ptype}
              onValueChange={(v) => v && setPtype(v as "relay" | "short" | "key")}
              className="w-full"
            >
              <ToggleGroupItem value="relay" className="flex-1 data-[state=on]:font-semibold">
                中转
              </ToggleGroupItem>
              <ToggleGroupItem value="short" className="flex-1 data-[state=on]:font-semibold">
                项目制
              </ToggleGroupItem>
              <ToggleGroupItem value="key" className="flex-1 data-[state=on]:font-semibold">
                上key
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-muted-foreground text-xs">
              {ptype === "relay"
                ? "中转：自动跟踪供应商与客户消耗，计入每日利润报表"
                : ptype === "key"
                  ? "上key：甲方给台子，按供应商前缀跟踪渠道额度，按价格自动算应付 / 应收，计入每日利润报表"
                  : "项目制：按实际记账（收入 − 支出）算利润，不进每日利润报表"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-note">备注（可选）</Label>
            <Textarea
              id="project-note"
              maxLength={200}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <FormError>{error}</FormError>
          <Button type="submit" className="w-full" disabled={busy}>
            {project ? "保存" : "创建项目"}
          </Button>
          {project ? (
            <Button type="button" variant="outline" className="w-full" onClick={toggleArchive}>
              {project.archived ? "恢复项目" : "归档项目"}
            </Button>
          ) : null}
          {isOwner ? (
            <div className="space-y-2">
              <Separator />
              <p className="text-muted-foreground text-xs">危险操作（仅项目创建者）</p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="text-destructive" onClick={() => danger("clear")}>
                  清空记录
                </Button>
                <Button type="button" variant="destructive" onClick={() => danger("delete")}>
                  删除项目
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      </ResponsiveDialog>
      {confirmEl}
    </>
  );
}
