"use client";

import { useState } from "react";

import { AlertCircle, Bot, Check, Download, HelpCircle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { apiUrl } from "../api";
import { fmtTime } from "../format";
import type { Attachment, ChatMessage, Proposal, ToolPart } from "../types";

import { Markdown } from "./markdown";
import { MemberAvatar } from "./shared";

const PROP_STATUS: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  failed: "执行失败",
};

function ToolRow({ t }: { t: ToolPart }) {
  const running = t.status === "start";
  const Icon = running ? Loader2 : t.error ? AlertCircle : t.proposal_id ? HelpCircle : Check;
  return (
    <div
      className={cn(
        "bg-muted/50 flex flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 text-xs",
        t.error && "text-destructive",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", running && "animate-spin")} />
      <span>{running ? `${t.label || t.name}…` : t.summary || t.label || t.name}</span>
      {(t.links || []).map((l) => (
        <a
          key={l.url}
          href={apiUrl(l.url)}
          download
          className="text-primary inline-flex items-center gap-1 hover:underline"
        >
          <Download className="size-3" />
          {l.label}
        </a>
      ))}
    </div>
  );
}

function ProposalCard({
  p,
  onDecide,
}: {
  p: Proposal;
  onDecide: (id: number, a: "approve" | "reject") => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const decided = p.status !== "pending";
  let result: { summary?: string; links?: { url: string; label: string }[] } = {};
  if (p.status === "approved") {
    try {
      result = JSON.parse(p.result || "{}");
    } catch {
      // 忽略：取不到就用默认值
    }
  }
  const act = async (a: "approve" | "reject") => {
    setBusy(a);
    await onDecide(p.id, a);
    setBusy(null);
  };
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3 text-sm",
        p.status === "pending" && "border-primary/40 bg-primary/5",
        p.status === "failed" && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-2">
        <Badge variant={p.status === "pending" ? "default" : "secondary"}>{PROP_STATUS[p.status] || p.status}</Badge>
        <b className="min-w-0 flex-1 truncate">{p.title}</b>
        <span className="text-muted-foreground text-xs">#{p.id}</span>
      </div>
      {p.detail ? <div className="text-muted-foreground text-xs whitespace-pre-wrap">{p.detail}</div> : null}
      <div className="text-muted-foreground text-xs">
        {p.requested_name} 通过 AI 提出 · {fmtTime(p.created_at)}
        {decided && p.decided_at
          ? ` · ${p.decided_name || ""} ${p.status === "rejected" ? "拒绝" : "批准"} · ${fmtTime(p.decided_at)}`
          : ""}
      </div>
      {p.status === "approved" ? (
        <div className="text-income text-xs">
          ✓ {result.summary || "已执行"}{" "}
          {(result.links || []).map((l) => (
            <a key={l.url} href={apiUrl(l.url)} download className="text-primary ml-1 hover:underline">
              {l.label}
            </a>
          ))}
        </div>
      ) : p.status === "failed" ? (
        <div className="text-destructive text-xs">✕ {p.error}</div>
      ) : null}
      {decided ? null : (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => act("approve")} disabled={!!busy}>
            {busy === "approve" ? <Loader2 className="animate-spin" /> : null}
            批准并执行
          </Button>
          <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={!!busy}>
            拒绝
          </Button>
        </div>
      )}
    </div>
  );
}

// 历史消息里附件只存了 id（实时推送的才是完整对象），统一成对象再渲染
function Attachments({ list }: { list: (Attachment | number)[] }) {
  if (!list?.length) return null;
  const items = list.map((a) =>
    typeof a === "number" ? { id: a, name: `附件 #${a}`, url: `/api/attachments/${a}`, image: false, bare: true } : a,
  );
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((a) =>
        a.image ? (
          <a key={a.id} href={apiUrl(a.url)} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={apiUrl(a.url)} alt={a.name} className="max-h-40 max-w-56 rounded-md border object-cover" />
          </a>
        ) : (
          <a
            key={a.id}
            href={apiUrl(a.url)}
            {...("bare" in a ? { target: "_blank", rel: "noopener noreferrer" } : { download: true })}
            className="bg-muted inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs hover:underline"
          >
            <Download className="size-3.5" />
            {a.name}
          </a>
        ),
      )}
    </div>
  );
}

export function ChatBubble({
  m,
  meId,
  isDm,
  onDecide,
  onRecall,
}: {
  m: ChatMessage;
  meId: number;
  isDm: boolean;
  onDecide: (id: number, a: "approve" | "reject") => Promise<void>;
  onRecall: (id: number) => void;
}) {
  const mine = m.user_id === meId;
  if (m.kind === "system")
    return (
      <div className="space-y-2">
        <div className="text-muted-foreground py-1 text-center text-xs">{m.text}</div>
        {/* 系统消息也可能挂着提案（如定期整理知识库），同样要能审批 */}
        {(m.proposals || []).map((p) => (
          <div key={p.id} className="mx-auto max-w-md">
            <ProposalCard p={p} onDecide={onDecide} />
          </div>
        ))}
      </div>
    );
  if (m.kind === "recalled")
    return (
      <div className="text-muted-foreground py-1 text-center text-xs">
        {m.username === "AI 助手" ? "AI 助手的回复已作废" : `${mine ? "你" : m.username} 撤回了一条消息`}
      </div>
    );
  if (m.kind === "user") {
    // eslint-disable-next-line react-hooks/purity -- 5 分钟撤回窗口，随下次渲染刷新即可
    const canRecall = mine && Date.now() - new Date(m.created_at).getTime() < 5 * 60 * 1000;
    return (
      <div className={cn("group flex gap-2", mine && "flex-row-reverse")}>
        {mine ? null : <MemberAvatar name={m.username} className="mt-0.5 size-7 text-xs" />}
        <div className={cn("flex max-w-[80%] flex-col gap-1", mine && "items-end")}>
          {!isDm && !mine ? (
            <div className="text-muted-foreground text-xs">
              {m.username} · {fmtTime(m.created_at)}
            </div>
          ) : null}
          {m.text ? (
            <div
              className={cn(
                "rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap",
                mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm",
              )}
            >
              {m.text}
            </div>
          ) : null}
          <Attachments list={m.attachments} />
          {canRecall ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              onClick={() => onRecall(m.id)}
            >
              撤回
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  const parts = m.parts || [];
  const last = parts[parts.length - 1];
  return (
    <div className="flex gap-2">
      <span className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
        <Bot className="size-4" />
      </span>
      <div className="flex max-w-[85%] min-w-0 flex-col gap-2">
        <div className="text-muted-foreground text-xs">AI 助手 · {fmtTime(m.created_at)}</div>
        {parts.map((p, i) =>
          p.type === "tool" ? (
            <ToolRow key={p.id || i} t={p} />
          ) : (
            <div key={i} className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2">
              <Markdown>{p.text}</Markdown>
              {m.streaming && i === parts.length - 1 ? (
                <span className="bg-foreground ml-0.5 inline-block h-4 w-1.5 animate-pulse align-middle" />
              ) : null}
            </div>
          ),
        )}
        {m.streaming && (!last || last.type === "tool") ? (
          <div className="bg-muted flex w-fit gap-1 rounded-2xl px-3.5 py-3">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        ) : null}
        {(m.proposals || []).map((p) => (
          <ProposalCard key={p.id} p={p} onDecide={onDecide} />
        ))}
      </div>
    </div>
  );
}
