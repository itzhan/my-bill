"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { EllipsisVertical, MessagesSquare, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { post } from "../api";
import { useChannels, useProjects } from "../hooks";
import { useLedger } from "../provider";
import { lsGet, lsSet } from "../storage";
import type { Channel } from "../types";
import type { useChat } from "../use-chat";

import { ChatComposer, sendModeKey } from "./chat-composer";
import { ChatBubble } from "./chat-message";
import { ResponsiveDialog, useConfirm } from "./shared";

export function NewGroupDialog({
  open,
  onOpenChange,
  channels,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  channels: Channel[];
  onCreated: (key: string) => void;
}) {
  const { data: pd } = useProjects();
  const have = new Set(channels.filter((c) => c.kind === "project").map((c) => c.project_id));
  const candidates = (pd?.projects ?? []).filter((p) => !have.has(p.id));
  const create = async (id: number) => {
    try {
      const d = await post<{ channel: string; existed: boolean }>("/channels", { project_id: id });
      if (!d.existed) toast.success("项目群已创建");
      onOpenChange(false);
      onCreated(d.channel);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建项目群"
      description="项目群里的 AI 只负责这个项目：记账不用说项目名，统计、报表、导出都只针对本项目。"
    >
      <div className="flex flex-wrap gap-2">
        {candidates.length ? (
          candidates.map((p) => (
            <Button key={p.id} variant="outline" size="sm" onClick={() => create(p.id)}>
              {p.name}
              {p.archived ? "（已归档）" : ""}
            </Button>
          ))
        ) : (
          <span className="text-muted-foreground text-sm">所有项目都已经有群了</span>
        )}
      </div>
    </ResponsiveDialog>
  );
}

// 聊天面板：完整的 AI 助手页和右下角悬浮窗共用（compact = 悬浮窗样式）
export function ChatPanel({
  current,
  setTab,
  chat,
  compact = false,
  onClose,
  className,
}: {
  current: string;
  setTab: (key: string) => void;
  chat: ReturnType<typeof useChat>;
  compact?: boolean;
  onClose?: () => void;
  className?: string;
}) {
  const { me } = useLedger();
  const { data: channels = [] } = useChannels();
  const [confirm, confirmEl] = useConfirm();
  const [groupOpen, setGroupOpen] = useState(false);
  const [sendMode, setSendMode] = useState("enter");
  const [cutVersion, setCutVersion] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; n: number }>({ text: "", n: 0 });

  useEffect(() => setSendMode(lsGet(sendModeKey) === "ctrl" ? "ctrl" : "enter"), []);

  const { state, unreadOf, send, decide, recall, clearDm } = chat;
  const isDm = current === "dm";
  const proj = channels.find((c) => c.key === current && c.kind === "project");
  const title = current === "group" ? "团队群" : isDm ? "与 AI 私聊" : (proj?.name ?? "项目群");

  // 清屏：只在本机隐藏某条消息之前的内容
  const cut = (() => {
    void cutVersion;
    return Number(lsGet(`hz:clear:${current}`) || 0);
  })();
  const visible = cut ? state.messages.filter((m) => m.id > cut) : state.messages;

  // 新消息时贴底滚动
  const bodyRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && (nearBottom.current || state.busy)) el.scrollTop = el.scrollHeight;
  }, [visible, state.busy]);
  useEffect(() => {
    nearBottom.current = true;
  }, [current]);

  const empty =
    current === "group"
      ? [
          "团队群聊",
          "成员和 AI 都在这里。谁说话 AI 都认得，记账、查账、发截图 / 表格让 AI 整理都可以；AI 的每个操作都要有人点「批准」才会执行。",
        ]
      : isDm
        ? ["与 AI 私聊", "只有你和 AI 看得到。记账、查账、改记录、出报表都行；AI 提出的操作由你自己批准。"]
        : [
            `「${proj?.name ?? "项目"}」群`,
            "这个群的 AI 只负责本项目：记账不用说项目名，统计、报表、导出都只针对本项目。",
          ];

  const showSuggest = !state.busy && state.loaded && !state.messages.some((m) => m.kind === "user");
  const suggestions = proj
    ? [
        "我付了 200 元服务器费",
        `「${proj.name}」本月利润多少？`,
        `导出「${proj.name}」本月的 Excel`,
        `「${proj.name}」最近都花在哪了？`,
      ]
    : ["我付了 300U 广告费", "本月各项目利润排名", "导出本月报表 Excel", "我们最近都做了什么？"];

  const onRecall = async (id: number) => {
    if (await confirm({ title: "撤回这条消息？", description: "AI 对它的回复也会作废。", confirmText: "撤回" }))
      recall(id);
  };

  const projectChannels = channels.filter((c) => c.kind === "project");

  return (
    <>
      <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <div className="min-w-0 flex-1">
            {compact ? null : <div className="hidden truncate font-semibold md:block">{title}</div>}
            <Select value={current} onValueChange={setTab}>
              <SelectTrigger className={cn("w-full", !compact && "md:hidden")} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>团队</SelectLabel>
                  <SelectItem value="group">团队群{unreadOf("group") ? `（${unreadOf("group")}）` : ""}</SelectItem>
                  <SelectItem value="dm">与 AI 私聊</SelectItem>
                </SelectGroup>
                {projectChannels.length ? (
                  <SelectGroup>
                    <SelectLabel>项目群</SelectLabel>
                    {projectChannels.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.name}
                        {unreadOf(c.key) ? `（${unreadOf(c.key)}）` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(!compact && "md:hidden")}
            onClick={() => setGroupOpen(true)}
            title="新建项目群"
          >
            <Plus />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>发送方式</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sendMode}
                onValueChange={(v) => {
                  setSendMode(v);
                  lsSet(sendModeKey, v);
                  toast(v === "ctrl" ? "Ctrl / ⌘ + Enter 发送" : "Enter 发送");
                }}
              >
                <DropdownMenuRadioItem value="enter">Enter 发送</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ctrl">Ctrl / ⌘ + Enter 发送</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {isDm ? (
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={state.busy}
                  onClick={async () => {
                    if (
                      state.messages.length &&
                      !(await confirm({
                        title: "清空你与 AI 的私聊记录？",
                        description: "账目数据和知识库存档不受影响。",
                        destructive: true,
                        confirmText: "清空",
                      }))
                    )
                      return;
                    clearDm().catch((e) => toast.error((e as Error).message));
                  }}
                >
                  清空私聊记录
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      const last = state.messages[state.messages.length - 1];
                      if (!last) return;
                      lsSet(`hz:clear:${current}`, String(last.id));
                      setCutVersion((v) => v + 1);
                      toast("已清屏（只在这台设备上隐藏）");
                    }}
                  >
                    清屏
                  </DropdownMenuItem>
                  {cut ? (
                    <DropdownMenuItem
                      onClick={() => {
                        lsSet(`hz:clear:${current}`, null);
                        setCutVersion((v) => v + 1);
                      }}
                    >
                      显示全部消息
                    </DropdownMenuItem>
                  ) : null}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {onClose ? (
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="关闭（Esc）">
              <X />
            </Button>
          ) : null}
        </div>

        <div
          ref={bodyRef}
          className={cn("flex-1 space-y-4 overflow-y-auto px-3 py-4", !compact && "md:px-5")}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {cut && state.messages.length > visible.length ? (
            <div className="text-muted-foreground text-center text-xs">
              已清屏 {state.messages.length - visible.length} 条 ·{" "}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  lsSet(`hz:clear:${current}`, null);
                  setCutVersion((v) => v + 1);
                }}
              >
                显示
              </button>
            </div>
          ) : null}
          {visible.length ? (
            visible.map((m) => (
              <ChatBubble key={m.id} m={m} meId={me.user.id} isDm={isDm} onDecide={decide} onRecall={onRecall} />
            ))
          ) : state.loaded ? (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <MessagesSquare className="size-8" />
              <b className="text-foreground">{empty[0]}</b>
              <p className="max-w-md text-sm">{empty[1]}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t p-3">
          {showSuggest ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((t) => (
                <Button
                  key={t}
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full text-xs"
                  onClick={() => setPrefill((p) => ({ text: t, n: p.n + 1 }))}
                >
                  {t}
                </Button>
              ))}
            </div>
          ) : null}
          <ChatComposer
            resetKey={current}
            prefill={prefill}
            aiConfigured={me.ai.configured}
            placeholder={
              current === "group"
                ? "团队群 · 说一句，或点麦克风说话"
                : isDm
                  ? "私聊 · 例如：我付了 300U 广告费"
                  : `「${proj?.name ?? "项目"}」群 · 只管本项目`
            }
            onSend={send}
          />
        </div>
      </div>

      <NewGroupDialog open={groupOpen} onOpenChange={setGroupOpen} channels={channels} onCreated={setTab} />
      {confirmEl}
    </>
  );
}
