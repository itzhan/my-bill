"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { del, get, post } from "./api";
import { qk } from "./hooks";
import { useLedger, useLedgerEvents } from "./provider";
import type { ChatMessage, ChatResponse, Proposal, TextPart, ToolPart } from "./types";

export type ChanState = { messages: ChatMessage[]; loaded: boolean; busy: boolean; unread: number };
const empty = (): ChanState => ({ messages: [], loaded: false, busy: false, unread: 0 });

// 会话 key：'group' 团队群、'project:<id>' 项目群、'dm' 私聊（服务器上是 dm:<uid>）
export const chanKey = (channel: string) => (String(channel).startsWith("dm:") ? "dm" : channel);

// 聊天状态：初次加载走 GET /chat，之后靠 SSE 的 msg / ai / proposal / recall 增量更新（逻辑同旧版 onChatEvent）
// visible：聊天面板当前是否展示（悬浮窗关着时新消息记为未读）
export function useChat(tab: string, visible: boolean) {
  const { me, connected } = useLedger();
  const qc = useQueryClient();
  const [chans, setChans] = useState<Record<string, ChanState>>({});
  // 给 SSE 回调 / 轮询读取最新值用
  const chansRef = useRef(chans);
  const tabRef = useRef(tab);
  const visibleRef = useRef(visible);
  useEffect(() => {
    chansRef.current = chans;
    tabRef.current = tab;
    visibleRef.current = visible;
  });

  const update = useCallback((key: string, fn: (s: ChanState) => ChanState) => {
    setChans((all) => ({ ...all, [key]: fn(all[key] ?? empty()) }));
  }, []);

  const loadChannel = useCallback(
    async (key: string, silent = false) => {
      try {
        const d = await get<ChatResponse>(`/chat?channel=${encodeURIComponent(key)}`);
        update(key, (st) => {
          // 合并：保留本地正在流式显示的那条（服务器上它还是空的），其余以服务器为准
          const streaming = st.messages.filter((m) => m.streaming && m.parts?.length);
          const messages = d.messages.map((m) => {
            const local = streaming.find((x) => x.id === m.id);
            return local && !m.parts?.length ? local : m;
          });
          if (d.busy) {
            const last = messages[messages.length - 1];
            if (last && last.kind === "assistant" && !last.parts?.length)
              messages[messages.length - 1] = { ...last, streaming: true };
          }
          return { ...st, messages, loaded: true, busy: d.busy };
        });
        if (d.channels) qc.setQueryData(qk.channels, d.channels);
      } catch (e) {
        if (!silent) toast.error((e as Error).message);
      }
    },
    [qc, update],
  );

  // 切到某个会话：未加载过就加载；面板可见时清掉它的未读
  useEffect(() => {
    if (!chansRef.current[tab]?.loaded) loadChannel(tab);
  }, [tab, loadChannel]);
  useEffect(() => {
    if (visible) update(tab, (st) => (st.unread ? { ...st, unread: 0 } : st));
  }, [tab, visible, update]);

  // 兜底轮询：发出消息后每 3 秒拉一次直到 AI 回复完成；SSE 断开时也定期拉
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const poll = useCallback(
    (key: string) => {
      if (pollTimers.current[key]) return;
      let ticks = 0;
      pollTimers.current[key] = setInterval(async () => {
        ticks += 1;
        await loadChannel(key, true);
        const st = chansRef.current[key];
        const last = st?.messages[st.messages.length - 1];
        const settled = st && !st.busy && !(last && last.kind === "assistant" && !last.parts?.length);
        if (ticks > 60 || settled) {
          clearInterval(pollTimers.current[key]);
          delete pollTimers.current[key];
        }
      }, 3000);
    },
    [loadChannel],
  );
  useEffect(() => {
    const timers = pollTimers.current;
    return () => Object.values(timers).forEach(clearInterval);
  }, []);
  useEffect(() => {
    // SSE 断开时，只在面板打开的情况下定期拉
    if (connected || !visible) return;
    const t = setInterval(() => loadChannel(tabRef.current, true), 8000);
    return () => clearInterval(t);
  }, [connected, visible, loadChannel]);

  const applyProposal = useCallback(
    (p: Proposal) => {
      update(chanKey(p.channel), (st) => ({
        ...st,
        messages: st.messages.map((m) => {
          if (m.id !== p.message_id || !m.proposals) return m;
          const i = m.proposals.findIndex((x) => x.id === p.id);
          const proposals = i >= 0 ? m.proposals.map((x) => (x.id === p.id ? p : x)) : [...m.proposals, p];
          return { ...m, proposals };
        }),
      }));
    },
    [update],
  );

  useLedgerEvents(({ name, data: d }) => {
    if (name === "hello") {
      // 断线重连后补拉当前会话
      if (chansRef.current[tabRef.current]?.loaded) loadChannel(tabRef.current, true);
      return;
    }
    if (name === "recall") {
      const key = chanKey(d.channel);
      update(key, (st) => ({
        ...st,
        busy: st.messages.some((m) => d.ids.includes(m.id) && m.username === "AI 助手") ? false : st.busy,
        messages: st.messages.map((m) =>
          d.ids.includes(m.id) ? { ...m, kind: "recalled", text: "", parts: [], attachments: [], streaming: false } : m,
        ),
      }));
      if (d.byId !== me.user.id && tabRef.current === key) toast(`${d.by} 撤回了一条消息`);
      return;
    }
    if (name === "proposal") {
      applyProposal(d.proposal);
      qc.invalidateQueries({ queryKey: ["ledger", "proposals"] });
      if (d.proposal.status === "pending" && d.proposal.requested_by !== me.user.id)
        toast(`${d.proposal.requested_name} 通过 AI 提出：${d.proposal.title}（待批准）`);
      return;
    }
    if (name !== "msg" && !(name === "ai" && d.channel)) return;
    const key = chanKey(d.channel);
    const viewing = visibleRef.current && tabRef.current === key;
    if (name === "msg") {
      update(key, (st) => {
        if (st.messages.some((m) => m.id === d.message.id)) return st;
        const unread =
          d.message.kind === "user" && d.message.user_id !== me.user.id && !viewing ? st.unread + 1 : st.unread;
        return { ...st, messages: [...st.messages, d.message], unread };
      });
      return;
    }
    update(key, (st) => {
      const messages = [...st.messages];
      const idx = messages.findIndex((x) => x.id === d.id);
      let busy = st.busy;
      let unread = st.unread;
      if (d.status === "start") {
        if (idx < 0)
          messages.push({
            id: d.id,
            channel: d.channel,
            kind: "assistant",
            user_id: null,
            username: "AI 助手",
            text: "",
            parts: [],
            attachments: [],
            proposals: [],
            streaming: true,
            created_at: new Date().toISOString(),
          });
        busy = true;
      } else if (idx < 0) {
        if (d.status === "done") {
          messages.push(d.message);
          busy = false;
        }
      } else {
        const m = { ...messages[idx]!, parts: [...(messages[idx]!.parts || [])] };
        if (d.status === "delta") {
          const last = m.parts[m.parts.length - 1];
          if (last && last.type === "text") m.parts[m.parts.length - 1] = { ...last, text: last.text + d.delta };
          else m.parts.push({ type: "text", text: d.delta });
        } else if (d.status === "reset") {
          m.parts = m.parts.filter((p) => p.type !== "text");
          if (d.text) m.parts.unshift({ type: "text", text: d.text } as TextPart);
        } else if (d.status === "tool") {
          const i = m.parts.findIndex((p) => p.type === "tool" && p.id === d.tool.id);
          if (i >= 0) m.parts[i] = { ...(m.parts[i] as ToolPart), ...d.tool };
          else m.parts.push({ ...d.tool });
        } else if (d.status === "done") {
          Object.assign(m, d.message, { streaming: false });
          busy = false;
          if (!viewing && key !== "dm") unread += 1;
        }
        messages[idx] = m;
      }
      return { ...st, messages, busy, unread };
    });
  });

  const send = useCallback(
    async (text: string, attachments: number[]) => {
      const key = tabRef.current;
      const d = await post<{ message: ChatMessage; reply: boolean }>("/chat", {
        channel: key,
        message: text,
        attachments,
        page: "admin",
        projectId: key.startsWith("project:") ? Number(key.slice(8)) : null,
      });
      update(key, (st) => ({
        ...st,
        busy: d.reply ? true : st.busy,
        messages: st.messages.some((m) => m.id === d.message.id) ? st.messages : [...st.messages, d.message],
      }));
      if (d.reply) poll(key);
      else if (key !== "dm" && me.ai.configured && me.ai.group_mode === "mention")
        toast("群里只有 @AI 或带附件时 AI 才回复（可在「设置 → AI」里改）");
    },
    [me.ai.configured, me.ai.group_mode, poll, update],
  );

  const decide = useCallback(
    async (id: number, action: "approve" | "reject") => {
      try {
        const d = await post<{ proposal: Proposal }>(`/proposals/${id}/${action}`);
        applyProposal(d.proposal);
        qc.invalidateQueries({ queryKey: ["ledger", "proposals"] });
        if (d.proposal.status === "failed") toast.error(`执行失败：${d.proposal.error}`);
        else toast.success(action === "approve" ? "已批准并执行" : "已拒绝");
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [applyProposal, qc],
  );

  const recall = useCallback(async (id: number) => {
    try {
      await post(`/chat/${id}/recall`);
      toast.success("已撤回");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  const clearDm = useCallback(async () => {
    await del("/chat?channel=dm");
    update("dm", (st) => ({ ...st, messages: [] }));
  }, [update]);

  const unreadOf = (key: string) => chans[key]?.unread ?? 0;
  const totalUnread = Object.values(chans).reduce((a, c) => a + c.unread, 0);
  return { state: chans[tab] ?? empty(), unreadOf, totalUnread, send, decide, recall, clearDm };
}
