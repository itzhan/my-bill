"use client";

import { useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { Download, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { apiUrl, post } from "../api";
import { useLedgerEvents } from "../provider";
import type { Report } from "../types";

import { Markdown } from "./markdown";

type Params = { scope: string; range: string; from: string; to: string };

// AI 财务报表：生成过程经 SSE 的 ai 事件（不带 channel）流式推送
export function AiReportCard({ d, params, qs }: { d: Report; params: Params; qs: string }) {
  const qc = useQueryClient();
  const ai = d.ai;
  const [job, setJob] = useState<{ key: string; content: string } | null>(
    ai.status === "running" ? { key: ai.key, content: ai.content || "" } : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setJob(ai.status === "running" ? { key: ai.key, content: ai.content || "" } : null);
  }, [ai.key, ai.status, ai.content]);

  useLedgerEvents(({ name, data }) => {
    if (name === "hello" && data.running?.includes(ai.key)) setJob((j) => j ?? { key: ai.key, content: "" });
    if (name !== "ai" || data.channel || data.key !== ai.key) return;
    if (data.status === "running") {
      setJob((j) => ({ key: ai.key, content: (j?.key === ai.key ? j.content : "") + (data.delta || "") }));
    } else if (data.status === "done") {
      setJob(null);
      qc.invalidateQueries({ queryKey: ["ledger", "report"] });
      toast.success("AI 财务报表已更新");
    } else if (data.status === "error") {
      setJob(null);
      qc.invalidateQueries({ queryKey: ["ledger", "report"] });
    }
  });

  const generate = async () => {
    setBusy(true);
    try {
      const r = await post<{ status: string }>("/report/ai", { ...params, force: ai.status === "done" && !ai.stale });
      if (r.status === "done") {
        toast("报表已是最新");
        qc.invalidateQueries({ queryKey: ["ledger", "report"] });
      } else setJob({ key: ai.key, content: "" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const content = job ? job.content : ai.content;
  const dot = (cls: string) => <span className={cn("inline-block size-2 rounded-full", cls)} />;
  let status: React.ReactNode;
  if (!ai.configured)
    status = <>{dot("bg-muted-foreground/40")}未配置 AI 接口（在服务器 .env 中设置 ANTHROPIC_AUTH_TOKEN 后重启）</>;
  else if (job) status = <>{dot("bg-primary animate-pulse")}AI 正在撰写报表…</>;
  else if (ai.status === "done" && ai.stale)
    status = (
      <>
        {dot("bg-warning")}数据已变化 · {ai.auto ? "约 1 分钟内自动刷新" : "点击「重新生成」"}
      </>
    );
  else if (ai.status === "done")
    status = (
      <>
        {dot("bg-income")}基于当前数据 · 生成于 {new Date(ai.generated_at!).toLocaleString("zh-CN", { hour12: false })}
      </>
    );
  else if (ai.status === "error")
    status = (
      <>
        {dot("bg-destructive")}
        {ai.error || "生成失败"}
      </>
    );
  else status = <>{dot("bg-muted-foreground/40")}还没有生成过这个范围的报表</>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          AI 财务报表 {ai.configured ? <Badge variant="secondary">{ai.model}</Badge> : null}
        </CardTitle>
        <CardDescription className="flex items-center gap-2">{status}</CardDescription>
        <CardAction className="flex gap-2">
          {ai.status === "done" && ai.content ? (
            <Button variant="outline" size="sm" asChild>
              <a href={apiUrl(`/api/report/ai.md?${qs}`)} download>
                <Download />
                Markdown
              </a>
            </Button>
          ) : null}
          {ai.configured ? (
            <Button
              size="sm"
              variant={ai.status === "done" && !ai.stale ? "outline" : "default"}
              onClick={generate}
              disabled={!!job || busy}
            >
              <Sparkles />
              {job ? "生成中…" : ai.status === "done" ? "重新生成" : "生成报表"}
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent>
        {content ? (
          <Markdown>{content}</Markdown>
        ) : ai.configured ? (
          <p className="text-muted-foreground text-sm">
            点击「生成报表」，AI
            会根据当前区间的收支、趋势、项目与成员数据撰写一份财务分析；数据变动后可自动更新，也可一键导出。
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
