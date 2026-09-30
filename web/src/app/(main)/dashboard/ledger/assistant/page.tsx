"use client";

import { Suspense, useEffect, useState } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Bot, Hash, Lock, Plus, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChatPanel, NewGroupDialog } from "@/modules/ledger/components/chat-panel";
import { useChannels } from "@/modules/ledger/hooks";
import { lsGet, lsSet } from "@/modules/ledger/storage";
import { useChat } from "@/modules/ledger/use-chat";

function AssistantInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: channels = [] } = useChannels();
  const [groupOpen, setGroupOpen] = useState(false);

  const urlTab = sp.get("c");
  const [tab, setTabState] = useState(() => urlTab || lsGet("hz:chat-tab") || "group");
  const validKeys = [...channels.map((c) => c.key), "dm"];
  const current = channels.length && !validKeys.includes(tab) ? "group" : tab;
  const setTab = (key: string) => {
    setTabState(key);
    lsSet("hz:chat-tab", key);
    router.replace(`${pathname}?c=${encodeURIComponent(key)}`, { scroll: false });
  };
  useEffect(() => {
    if (urlTab && urlTab !== tab) setTabState(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  const chat = useChat(current, true);
  const projectChannels = channels.filter((c) => c.kind === "project");

  const chanItem = (key: string, label: string, Icon: typeof Users, extra?: string) => {
    const n = chat.unreadOf(key);
    return (
      <button
        key={key}
        type="button"
        onClick={() => setTab(key)}
        className={cn(
          "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
          current === key && "bg-accent font-medium",
        )}
      >
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <span className="flex-1 truncate">
          {label}
          {extra ? <span className="text-muted-foreground text-xs">{extra}</span> : null}
        </span>
        {n ? <Badge className="h-5 min-w-5 px-1.5">{n > 99 ? "99+" : n}</Badge> : null}
      </button>
    );
  };

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[480px] gap-4">
      {/* 会话列表（电脑） */}
      <Card className="hidden w-60 shrink-0 gap-0 overflow-hidden p-0 md:flex md:flex-col">
        <div className="flex items-center justify-between border-b px-3 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <Bot className="size-4" />
            AI 助手
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setGroupOpen(true)} title="新建项目群">
            <Plus />
          </Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-2">
          <div className="space-y-0.5">
            <div className="text-muted-foreground px-2.5 py-1 text-xs">团队</div>
            {chanItem("group", "团队群", Users)}
            {chanItem("dm", "与 AI 私聊", Lock)}
          </div>
          <div className="space-y-0.5">
            <div className="text-muted-foreground px-2.5 py-1 text-xs">项目群</div>
            {projectChannels.length ? (
              projectChannels.map((c) => chanItem(c.key, c.name, Hash, c.archived ? "（已归档）" : ""))
            ) : (
              <p className="text-muted-foreground px-2.5 text-xs">还没有项目群</p>
            )}
          </div>
        </div>
      </Card>

      <Card className="flex min-w-0 flex-1 flex-col gap-0 overflow-hidden p-0">
        <ChatPanel current={current} setTab={setTab} chat={chat} className="flex-1" />
      </Card>

      <NewGroupDialog open={groupOpen} onOpenChange={setGroupOpen} channels={channels} onCreated={setTab} />
    </div>
  );
}

export default function AssistantPage() {
  return (
    <Suspense>
      <AssistantInner />
    </Suspense>
  );
}
