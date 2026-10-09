"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";

import { LEDGER_API } from "./api";
import { EntryDialog } from "./components/entry-dialog";
import { PartySheet, type PartySheetState } from "./components/party-sheet";
import { ProjectDialog } from "./components/project-dialog";
import { TransferDialog } from "./components/transfer-dialog";
import { qk, useMe } from "./hooks";
import { lsGet, lsSet } from "./storage";
import type { Entry, Me, PartyKind, Project } from "./types";

// SSE 里交给页面自己处理的事件（报表 AI 流、聊天流等）
export type LedgerEvent = { name: string; data: any };
type Listener = (e: LedgerEvent) => void;

type LedgerCtx = {
  me: Me;
  connected: boolean;
  subscribe: (fn: Listener) => () => void;
  openEntry: (opts?: { projectId?: number; entry?: Entry }) => void;
  openProject: (project?: Project) => void;
  openTransfer: (opts?: { projectId?: number | null; fromId?: number }) => void;
  openParty: (id: number) => void;
  openPartyNew: (projectId: number, kind: PartyKind) => void;
  // 打开右下角 AI 助手，可指定会话（group / dm / project:<id>）
  openChat: (channel?: string) => void;
  chat: { open: boolean; tab: string; setOpen: (open: boolean) => void; setTab: (key: string) => void };
};

const Ctx = createContext<LedgerCtx | null>(null);

export function useLedger() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLedger 必须在 LedgerProvider 内使用");
  return c;
}

export function useLedgerEvents(fn: Listener) {
  const { subscribe } = useLedger();
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <LedgerInner>{children}</LedgerInner>
    </QueryClientProvider>
  );
}

function LedgerInner({ children }: { children: ReactNode }) {
  const meQuery = useMe();
  if (!meQuery.data) {
    return (
      <div className="text-muted-foreground flex h-[60vh] items-center justify-center gap-2 text-sm">
        <Spinner /> {meQuery.isError ? "正在跳转登录…" : "加载中…"}
      </div>
    );
  }
  return <LedgerReady me={meQuery.data}>{children}</LedgerReady>;
}

function LedgerReady({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  const [entryState, setEntryState] = useState<{ open: boolean; projectId?: number; entry?: Entry }>({ open: false });
  const [projectState, setProjectState] = useState<{ open: boolean; project?: Project }>({ open: false });
  const [transferState, setTransferState] = useState<{ open: boolean; projectId?: number | null; fromId?: number }>({
    open: false,
  });
  const [partyState, setPartyState] = useState<PartySheetState>({ open: false });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTab, setChatTabState] = useState("group");
  // 恢复上次的开合状态与会话
  useEffect(() => {
    setChatOpen(lsGet("hz:chat-open") === "1");
    setChatTabState(lsGet("hz:chat-tab") || "group");
  }, []);
  const setChatTab = useCallback((key: string) => {
    setChatTabState(key);
    lsSet("hz:chat-tab", key);
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  // 实时同步：所有成员的改动经 SSE 推送，刷新对应数据
  useEffect(() => {
    const es = new EventSource(`${LEDGER_API}/events`);
    let everOpened = false;
    const emit = (name: string, data: unknown) => listeners.current.forEach((fn) => fn({ name, data }));
    const parse = (ev: MessageEvent) => {
      try {
        return JSON.parse(ev.data);
      } catch {
        return {};
      }
    };
    const refreshData = () => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: ["ledger", "project"] });
      qc.invalidateQueries({ queryKey: ["ledger", "party"] });
      qc.invalidateQueries({ queryKey: ["ledger", "report"] });
      qc.invalidateQueries({ queryKey: ["ledger", "suppliers"] });
    };
    es.onerror = () => setConnected(false);
    es.addEventListener("hello", (ev) => {
      setConnected(true);
      // 断线重连后补拉一次
      if (everOpened) {
        qc.invalidateQueries({ queryKey: ["ledger"] });
      }
      everOpened = true;
      emit("hello", parse(ev));
    });
    es.addEventListener("changed", (ev) => {
      const d = parse(ev);
      if (d.byId !== me.user.id && d.text) toast(`${d.by} ${d.text}`);
      refreshData();
    });
    es.addEventListener("members", () => qc.invalidateQueries({ queryKey: qk.me }));
    es.addEventListener("settings", () => qc.invalidateQueries({ queryKey: qk.me }));
    es.addEventListener("exports", (ev) => {
      const d = parse(ev);
      if (d.source === "auto" && d.names?.length) toast(`已自动导出：${d.names[0]}`);
      qc.invalidateQueries({ queryKey: qk.exports });
    });
    es.addEventListener("channels", (ev) => {
      const d = parse(ev);
      if (d.channels) qc.setQueryData(qk.channels, d.channels);
      if (d.created && d.by !== me.user.username) toast(`${d.by} 新建了项目群`);
      emit("channels", d);
    });
    es.addEventListener("kb", (ev) => {
      qc.invalidateQueries({ queryKey: qk.knowledge });
      emit("kb", parse(ev));
    });
    es.addEventListener("proposal", () => qc.invalidateQueries({ queryKey: qk.proposals }));
    for (const name of ["ai", "msg", "proposal", "recall"]) {
      es.addEventListener(name, (ev) => emit(name, parse(ev)));
    }
    return () => es.close();
  }, [qc, me.user.id, me.user.username]);

  // 桌面快捷键：N 记一笔
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setEntryState({ open: true });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<LedgerCtx>(
    () => ({
      me,
      connected,
      subscribe,
      openEntry: (opts) => setEntryState({ open: true, ...opts }),
      openProject: (project) => setProjectState({ open: true, project }),
      openTransfer: (opts) => setTransferState({ open: true, ...opts }),
      openParty: (id) => setPartyState({ open: true, mode: "view", id }),
      openPartyNew: (projectId, kind) => setPartyState({ open: true, mode: "new", projectId, kind }),
      openChat: (channel) => {
        if (channel) setChatTab(channel);
        setChatOpen(true);
      },
      chat: { open: chatOpen, tab: chatTab, setOpen: setChatOpen, setTab: setChatTab },
    }),
    [me, connected, subscribe, setChatTab, chatOpen, chatTab],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <EntryDialog
        {...entryState}
        onOpenChange={(open) => setEntryState((s) => ({ ...s, open }))}
        onNeedProject={() => {
          setEntryState({ open: false });
          setProjectState({ open: true });
        }}
      />
      <ProjectDialog {...projectState} onOpenChange={(open) => setProjectState((s) => ({ ...s, open }))} />
      <TransferDialog {...transferState} onOpenChange={(open) => setTransferState((s) => ({ ...s, open }))} />
      <PartySheet state={partyState} setState={setPartyState} />
    </Ctx.Provider>
  );
}
