"use client";

import { use, useEffect } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  ChartColumn,
  MessagesSquare,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { get, patch, post } from "@/modules/ledger/api";
import { EntriesTable } from "@/modules/ledger/components/entries-table";
import { FilesCard } from "@/modules/ledger/components/files-panel";
import { FundsSection } from "@/modules/ledger/components/funds-section";
import { KeySection } from "@/modules/ledger/components/key-section";
import { PartiesSection } from "@/modules/ledger/components/parties-section";
import { KpiCards, PageHeader, useConfirm } from "@/modules/ledger/components/shared";
import { useProject } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import type { PartyContract } from "@/modules/ledger/types";
import { useTabTitle } from "@/stores/tabs/tab-store-provider";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const router = useRouter();
  const { openEntry, openProject, openTransfer, openChat } = useLedger();
  const qc = useQueryClient();
  const { data, error } = useProject(id);
  const [confirm, confirmEl] = useConfirm();
  useTabTitle(data?.project.name);
  // 公司日常项目：加载合同 / 发票
  const isCompany = data?.project.category === "company";
  const { data: filesData } = useQuery({
    queryKey: ["ledger", "project-files", id],
    queryFn: () => get<{ files: PartyContract[] }>(`/projects/${id}/files`),
    enabled: isCompany,
  });
  const reloadFiles = () => qc.invalidateQueries({ queryKey: ["ledger", "project-files", id] });

  useEffect(() => {
    if (error) {
      toast.error(error.message);
      router.replace("/dashboard/ledger/projects");
    }
  }, [error, router]);

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const p = data.project;
  const partyCount = data.parties.suppliers.length + data.parties.customers.length;

  // 项目群：已有就直接进，没有就先建
  const openGroup = async () => {
    try {
      const d = await post<{ channel: string; existed: boolean }>("/channels", { project_id: p.id });
      if (!d.existed) toast.success("项目群已创建");
      openChat(d.channel);
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  // 归档 = 只读（不能再记账），成员资金沉淀、报表、利润、上 key 同步照常统计；可随时重新开放
  const setArchived = async (archived: boolean) => {
    if (
      archived &&
      !(await confirm({
        title: `归档「${p.name}」？`,
        description: "归档后不能再记账，成员资金沉淀、报表、利润等统计照常包含这个项目；之后可以随时重新开放。",
        confirmText: "归档",
      }))
    )
      return;
    try {
      await patch(`/projects/${p.id}`, { archived });
      toast.success(archived ? "项目已归档" : "项目已重新开放");
      qc.invalidateQueries({ queryKey: ["ledger"] });
    } catch (ex) {
      toast.error((ex as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        prefetch={false}
        href="/dashboard/ledger/projects"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        项目
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {p.name}
            {p.category === "company" ? <Badge variant="secondary">公司日常</Badge> : null}
            {p.ptype === "key" ? <Badge variant="secondary">上key</Badge> : null}
            {p.archived ? <Badge variant="outline">已归档 · 仅可查看</Badge> : null}
          </span>
        }
        description={p.note || `${p.creator_name} 创建`}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={openGroup} title="项目群聊">
              <MessagesSquare />
            </Button>
            <Button variant="outline" size="icon" asChild title="查看报表">
              <Link prefetch={false} href={`/dashboard/ledger/reports?scope=${p.id}`}>
                <ChartColumn />
              </Link>
            </Button>
            <Button variant="outline" size="icon" onClick={() => openProject(p)} title="编辑项目">
              <Pencil />
            </Button>
            <Button variant="outline" onClick={() => openTransfer({ projectId: p.id })}>
              <ArrowLeftRight />
              记转账
            </Button>
            {p.archived ? null : (
              <Button variant="outline" onClick={() => setArchived(true)}>
                <Archive />
                归档
              </Button>
            )}
            {p.archived ? (
              <Button onClick={() => setArchived(false)}>
                <ArchiveRestore />
                重新开放
              </Button>
            ) : (
              <Button onClick={() => openEntry({ projectId: p.id })}>
                <Plus />
                记一笔
              </Button>
            )}
          </>
        }
      />

      <KpiCards summary={data.summary} />

      <Tabs defaultValue={p.ptype === "key" ? "key" : "entries"} className="gap-4">
        <TabsList>
          {p.ptype === "key" ? <TabsTrigger value="key">上key</TabsTrigger> : null}
          <TabsTrigger value="entries">流水 {data.entries.length}</TabsTrigger>
          <TabsTrigger value="parties">往来 {partyCount || ""}</TabsTrigger>
          <TabsTrigger value="funds">成员资金</TabsTrigger>
        </TabsList>
        {p.ptype === "key" ? (
          <TabsContent value="key">
            <KeySection detail={data} />
          </TabsContent>
        ) : null}
        <TabsContent value="entries">
          <EntriesTable detail={data} />
        </TabsContent>
        <TabsContent value="parties">
          <PartiesSection detail={data} />
        </TabsContent>
        <TabsContent value="funds">
          <FundsSection funds={data.funds} projectId={p.id} projectOwner={p.created_by} />
        </TabsContent>
      </Tabs>

      {isCompany ? (
        <>
          <FilesCard
            files={(filesData?.files ?? []).filter((f) => f.category !== "invoice")}
            onReload={reloadFiles}
            target={{ kind: "project", projectId: p.id }}
            category="contract"
            label="电子合同"
            description="公司日常合同，团队可上传 / 预览 / 下载；到期前一个月起连续三天邮件提醒"
          />
          <FilesCard
            files={(filesData?.files ?? []).filter((f) => f.category === "invoice")}
            onReload={reloadFiles}
            target={{ kind: "project", projectId: p.id }}
            category="invoice"
            label="发票"
            description="公司日常发票，团队可上传 / 预览 / 下载"
          />
        </>
      ) : null}
      {confirmEl}
    </div>
  );
}
