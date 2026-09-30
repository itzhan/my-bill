"use client";

import { use, useEffect } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft, ArrowLeftRight, ChartColumn, MessagesSquare, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { post } from "@/modules/ledger/api";
import { EntriesTable } from "@/modules/ledger/components/entries-table";
import { FundsSection } from "@/modules/ledger/components/funds-section";
import { PartiesSection } from "@/modules/ledger/components/parties-section";
import { KpiCards, PageHeader } from "@/modules/ledger/components/shared";
import { useProject } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";
import { useTabTitle } from "@/stores/tabs/tab-store-provider";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const router = useRouter();
  const { openEntry, openProject, openTransfer, openChat } = useLedger();
  const { data, error } = useProject(id);
  useTabTitle(data?.project.name);

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
              <Button onClick={() => openEntry({ projectId: p.id })}>
                <Plus />
                记一笔
              </Button>
            )}
          </>
        }
      />

      <KpiCards summary={data.summary} />

      <Tabs defaultValue="entries" className="gap-4">
        <TabsList>
          <TabsTrigger value="entries">流水 {data.entries.length}</TabsTrigger>
          <TabsTrigger value="parties">往来 {partyCount || ""}</TabsTrigger>
          <TabsTrigger value="funds">成员资金</TabsTrigger>
        </TabsList>
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
    </div>
  );
}
