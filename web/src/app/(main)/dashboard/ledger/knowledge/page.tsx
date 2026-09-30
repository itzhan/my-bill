"use client";

import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { Download, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiUrl, post } from "@/modules/ledger/api";
import { Markdown } from "@/modules/ledger/components/markdown";
import { PageHeader, useConfirm } from "@/modules/ledger/components/shared";
import { qk, useKnowledge } from "@/modules/ledger/hooks";
import { useLedger } from "@/modules/ledger/provider";

function DateLinks({ kind, dates }: { kind: "log" | "chat"; dates: string[] }) {
  if (!dates.length) return <span className="text-muted-foreground text-sm">暂无</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {dates.map((d) => (
        <Badge key={d} variant="outline" asChild>
          <a
            href={apiUrl(`/api/knowledge/file?kind=${kind}&date=${d}`)}
            download
            className="tabular-nums hover:underline"
          >
            {d}
          </a>
        </Badge>
      ))}
    </div>
  );
}

export default function KnowledgePage() {
  const { me } = useLedger();
  const { data: k } = useKnowledge();
  const qc = useQueryClient();
  const [confirm, confirmEl] = useConfirm();
  const [busy, setBusy] = useState(false);

  const consolidate = async () => {
    if (
      !(await confirm({
        title: "现在整理知识库？",
        description: "AI 会把近期日志与对话归纳进摘要，旧摘要自动存档。",
        confirmText: "开始整理",
      }))
    )
      return;
    setBusy(true);
    try {
      await post("/knowledge/consolidate");
      toast.success("知识库已整理");
      qc.invalidateQueries({ queryKey: qk.knowledge });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="知识库"
        description="所有操作与对话按天存档；AI 回答时会带上知识摘要与最近日志"
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={apiUrl("/api/knowledge/summary.md")} download>
                <Download />
                摘要
              </a>
            </Button>
            <Button onClick={consolidate} disabled={!me.ai.configured || busy}>
              <Sparkles />
              {busy ? "整理中…" : "整理知识库"}
            </Button>
          </>
        }
      />
      {!k ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>知识摘要</CardTitle>
              <CardDescription>
                {k.consolidated_at
                  ? `上次整理：${new Date(k.consolidated_at).toLocaleString("zh-CN", { hour12: false })}`
                  : "还没有整理过"}{" "}
                · 每 {k.auto_days} 天到期后 AI 会在团队群提议整理（需批准）
              </CardDescription>
            </CardHeader>
            <CardContent>
              {k.summary ? (
                <Markdown>{k.summary}</Markdown>
              ) : (
                <p className="text-muted-foreground text-sm">
                  知识摘要会把操作日志和对话归纳成团队记忆：谁在什么时候做了什么、各项目状况、约定与待办。点「整理知识库」生成第一版。
                </p>
              )}
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>操作日志</CardTitle>
                <CardDescription>每一次记账、修改、审批、导出都会按天写入 Markdown</CardDescription>
                <CardAction>
                  <Badge variant="secondary">{k.log_dates.length}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <DateLinks kind="log" dates={k.log_dates} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>对话记录</CardTitle>
                <CardDescription>团队群、项目群与私聊按天存档</CardDescription>
                <CardAction>
                  <Badge variant="secondary">{k.chat_dates.length}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <DateLinks kind="chat" dates={k.chat_dates} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      {confirmEl}
    </div>
  );
}
