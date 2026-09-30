"use client";

import { useEffect } from "react";

import { usePathname } from "next/navigation";

import { Bot } from "lucide-react";

import { cn } from "@/lib/utils";

import { useChannels } from "../hooks";
import { useLedger } from "../provider";
import { lsSet } from "../storage";
import { useChat } from "../use-chat";

import { ChatPanel } from "./chat-panel";

// 右下角常驻 AI 助手（同旧版）：悬浮按钮 + 聊天面板，记住开合状态与上次的会话
export function AssistantFab() {
  const {
    chat: { open, tab, setOpen, setTab },
  } = useLedger();
  const pathname = usePathname();
  const onFullPage = pathname.startsWith("/dashboard/ledger/assistant");
  const { data: channels = [] } = useChannels();
  const validKeys = [...channels.map((c) => c.key), "dm"];
  const current = channels.length && !validKeys.includes(tab) ? "group" : tab;
  const visible = open && !onFullPage;
  const chat = useChat(current, visible);

  useEffect(() => lsSet("hz:chat-open", open ? "1" : "0"), [open]);

  // Esc 关闭（有弹窗时先关弹窗）
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog],[role=alertdialog]")) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, setOpen]);

  // 完整的 AI 助手页里不再显示悬浮窗
  if (onFullPage) return null;

  const n = chat.totalUnread;
  return (
    <>
      {visible ? (
        <div
          className={cn(
            "bg-background animate-in fade-in slide-in-from-bottom-4 fixed z-40 flex flex-col overflow-hidden border shadow-2xl duration-200",
            "inset-0 md:inset-auto md:right-6 md:bottom-6 md:h-[min(680px,calc(100dvh-3rem))] md:w-[420px] md:rounded-xl",
          )}
        >
          <ChatPanel
            compact
            current={current}
            setTab={setTab}
            chat={chat}
            onClose={() => setOpen(false)}
            className="flex-1"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="AI 助手"
          className="bg-primary text-primary-foreground fixed right-5 bottom-5 z-40 flex size-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 md:right-6 md:bottom-6"
        >
          <Bot className="size-6" />
          {n ? (
            <span className="bg-destructive absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white">
              {n > 99 ? "99+" : n}
            </span>
          ) : null}
        </button>
      )}
    </>
  );
}
