"use client";

import { useEffect, useRef, useState } from "react";

import { FileText, Loader2, Mic, Paperclip, RotateCcw, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { post } from "../api";
import { joinText, normalizeSpeech, prepareImage, readB64 } from "../speech";
import type { Attachment } from "../types";

type Pending = {
  id: string;
  file: File;
  name: string;
  status: "uploading" | "done" | "error";
  preview: string;
  error?: string;
  attachment?: Attachment;
};

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // 忽略：取不到就用默认值
  }
};

export const sendModeKey = "hz:sendmode";

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

export function ChatComposer({
  placeholder,
  onSend,
  aiConfigured,
  resetKey,
  prefill,
}: {
  placeholder: string;
  onSend: (text: string, attachments: number[]) => Promise<void>;
  aiConfigured: boolean;
  resetKey: string;
  prefill?: { text: string; n: number };
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 给语音识别回调 / 异步发送读取最新值用
  const textRef = useRef(text);
  const pendingRef = useRef(pending);
  useEffect(() => {
    textRef.current = text;
    pendingRef.current = pending;
  });
  const sendWhenReady = useRef(false);
  const composing = useRef({ on: false, endedAt: 0 });
  const voice = useRef<{ session: any; pressTimer?: ReturnType<typeof setTimeout>; holding: boolean }>({
    session: null,
    holding: false,
  });

  useEffect(() => setAutoSend(lsGet("hz:voice-auto") === "1"), []);

  // 点快捷建议：填入并直接发送
  useEffect(() => {
    if (prefill?.text) void doSend(prefill.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.n]);

  // 切换会话：停掉语音，丢弃迟到的识别结果
  useEffect(() => {
    stopVoice(true);
  }, [resetKey]);

  const uploading = pending.filter((x) => x.status === "uploading").length;

  const uploadOne = async (item: Pending) => {
    setPending((l) => l.map((x) => (x.id === item.id ? { ...x, status: "uploading", error: "" } : x)));
    let next: Partial<Pending>;
    try {
      const f = await prepareImage(item.file);
      if (f.size > 20 * 1024 * 1024) throw new Error("超过 20MB");
      const data = await readB64(f);
      const d = await post<{ attachment: Attachment }>("/attachments", { name: f.name, mime: f.type, data });
      next = { status: "done", attachment: d.attachment };
    } catch (e) {
      next = { status: "error", error: (e as Error).message || "上传失败" };
    }
    setPending((l) => l.map((x) => (x.id === item.id ? { ...x, ...next } : x)));
  };

  // 附件都传完后，如果之前点过发送就自动发
  useEffect(() => {
    if (!uploading && sendWhenReady.current) {
      sendWhenReady.current = false;
      if (!pending.some((x) => x.status === "error")) void doSend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading]);

  const uploadFiles = (files: File[]) => {
    const list = files.slice(0, 10 - pendingRef.current.length);
    if (!list.length) return toast("最多同时发送 10 个附件");
    const items: Pending[] = list.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      status: "uploading",
      preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : "",
    }));
    setPending((l) => [...l, ...items]);
    (async () => {
      for (const it of items) await uploadOne(it);
    })();
  };

  const removePending = (id: string) =>
    setPending((l) => {
      const it = l.find((x) => x.id === id);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      return l.filter((x) => x.id !== id);
    });

  async function doSend(override?: string) {
    const t = (override ?? textRef.current).trim();
    const list = pendingRef.current;
    if (list.some((x) => x.status === "uploading")) {
      sendWhenReady.current = true;
      toast("附件上传完会自动发送");
      return;
    }
    if (list.some((x) => x.status === "error")) return toast.error("有附件上传失败，请重试或移除后再发送");
    const ready = list.filter((x) => x.status === "done" && x.attachment);
    if (!t && !ready.length) return;
    stopVoice(true);
    if (!aiConfigured) toast("未配置 AI 接口，消息会保存但 AI 不会回复");
    setSending(true);
    if (override === undefined) setText("");
    setPending([]);
    try {
      await onSend(
        t,
        ready.map((a) => a.attachment!.id),
      );
      list.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    } catch (e) {
      toast.error((e as Error).message);
      if (override === undefined) setText(t);
      setPending(list);
    } finally {
      setSending(false);
      if (window.innerWidth >= 900) inputRef.current?.focus();
    }
  }

  // ---- 语音输入
  function startVoice() {
    const W = window as any;
    const Rec: SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Rec) return toast.error("当前浏览器不支持语音识别，请使用 Chrome、Edge 或 Safari");
    if (!window.isSecureContext) return toast.error("语音输入需要 HTTPS（或 localhost）环境");
    const v = voice.current;
    if (v.session?.active) return;
    if (v.session) v.session.discard = true;
    const rec = new Rec();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const ses = {
      rec,
      active: true,
      discard: false,
      base: textRef.current.trim(),
      final: "",
      restarts: 0,
      gotAny: false,
    };
    v.session = ses;
    setListening(true);
    setVoiceHint("正在听…请说普通话，说完点麦克风停止");
    rec.onresult = (e: any) => {
      if (ses.discard) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (!t) continue;
        if (e.results[i].isFinal) ses.final = joinText(ses.final, normalizeSpeech(t));
        else interim += t;
      }
      ses.gotAny = true;
      setText(
        joinText(ses.base, ses.final) + (interim ? (ses.final || ses.base ? "，" : "") + normalizeSpeech(interim) : ""),
      );
      if (ses.active) setVoiceHint(interim ? "正在识别…" : "已识别，继续说或点麦克风停止");
    };
    rec.onerror = (e: any) => {
      if (ses.discard) return;
      const msgs: Record<string, string> = {
        "not-allowed": "请允许浏览器使用麦克风",
        "service-not-allowed": "语音服务不可用",
        network: "连不上语音服务（Chrome 需要能访问 Google，可改用 Safari 或 Edge）",
        "no-speech": "没听到声音，再试一次",
        "audio-capture": "没有检测到麦克风",
        aborted: "",
      };
      const m = msgs[e.error] ?? `语音识别出错：${e.error}`;
      if (e.error === "no-speech") {
        if (ses.active) setVoiceHint(m);
        return;
      }
      if (m) toast.error(m);
      ses.active = false;
      setListening(false);
    };
    rec.onend = () => {
      const auto = lsGet("hz:voice-auto") === "1";
      // 用户没主动停、也不是自动发送模式：Chrome 会因静音自动结束，续上
      if (ses.active && !ses.discard && !auto && !v.holding && ses.restarts < 8) {
        ses.restarts += 1;
        try {
          rec.start();
          return;
        } catch {
          // 忽略：取不到就用默认值
        }
      }
      ses.active = false;
      setListening(false);
      if (v.session === ses) v.session = null;
      if (auto && !ses.discard && ses.gotAny && textRef.current.trim()) void doSend();
    };
    try {
      rec.start();
    } catch {
      toast.error("无法启动语音识别");
      ses.active = false;
      setListening(false);
      v.session = null;
    }
  }
  function stopVoice(discard = false) {
    const ses = voice.current.session;
    if (!ses) return;
    ses.active = false;
    if (discard) ses.discard = true;
    setListening(false);
    try {
      ses.rec.stop();
    } catch {
      // 忽略：取不到就用默认值
    }
  }
  const releaseMic = () => {
    clearTimeout(voice.current.pressTimer);
    if (voice.current.holding) {
      stopVoice();
      setTimeout(() => {
        voice.current.holding = false;
      }, 50);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    // 输入法安全：拼音没打完时的 Enter 绝不发送
    const c = composing.current;
    if (e.nativeEvent.isComposing || e.keyCode === 229 || c.on || Date.now() - c.endedAt < 120) return;
    const mode = lsGet(sendModeKey) === "ctrl" ? "ctrl" : "enter";
    const want = mode === "ctrl" ? e.ctrlKey || e.metaKey : !(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey);
    if (want) {
      e.preventDefault();
      void doSend();
    }
  };

  return (
    <div
      className="space-y-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        uploadFiles(Array.from(e.dataTransfer.files || []));
      }}
    >
      {pending.length ? (
        <div className="space-y-1.5">
          <div className="text-muted-foreground text-xs">
            {uploading
              ? `上传中 ${uploading} 个…`
              : pending.some((x) => x.status === "error")
                ? "有附件上传失败，可重试或移除"
                : `已添加 ${pending.length} 个附件，输入文字后一起发送`}
          </div>
          <div className="flex flex-wrap gap-2">
            {pending.map((a) => (
              <span
                key={a.id}
                className={cn(
                  "bg-muted inline-flex max-w-56 items-center gap-1.5 rounded-md py-1 pr-1 pl-1.5 text-xs",
                  a.status === "error" && "text-destructive",
                )}
              >
                {a.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.preview} alt="" className="size-6 rounded object-cover" />
                ) : (
                  <FileText className="size-4" />
                )}
                <span className="truncate" title={a.name}>
                  {a.name}
                </span>
                {a.status === "uploading" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {a.status === "error" ? (
                  <button type="button" title={a.error} onClick={() => uploadOne(a)}>
                    <RotateCcw className="size-3.5" />
                  </button>
                ) : null}
                <button type="button" onClick={() => removePending(a.id)} aria-label="移除">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {listening ? (
        <div className="bg-primary/5 text-muted-foreground flex items-center justify-between rounded-md px-3 py-1.5 text-xs">
          <span className="flex items-center gap-2">
            <span className="bg-destructive size-2 animate-pulse rounded-full" />
            {voiceHint}
          </span>
          <label className="flex items-center gap-1.5">
            <Checkbox
              checked={autoSend}
              onCheckedChange={(v) => {
                setAutoSend(!!v);
                lsSet("hz:voice-auto", v ? "1" : "0");
              }}
            />
            停顿后自动发送
          </label>
        </div>
      ) : null}
      <div className="bg-background focus-within:ring-ring/50 flex items-end gap-1 rounded-xl border p-1.5 focus-within:ring-[3px]">
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept="image/*,.pdf,.xlsx,.xls,.csv,.txt,.md,.json,.tsv"
          onChange={(e) => {
            uploadFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => fileRef.current?.click()}
          title="添加图片 / 文件"
        >
          <Paperclip />
        </Button>
        <Textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (!(e.nativeEvent as InputEvent).isComposing) composing.current.on = false;
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => (composing.current.on = true)}
          onCompositionEnd={() => (composing.current = { on: false, endedAt: Date.now() })}
          onBlur={() => (composing.current.on = false)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length) {
              e.preventDefault();
              uploadFiles(files);
            }
          }}
          className={cn(
            "max-h-32 min-h-8 flex-1 resize-none border-0 px-1.5 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent",
            listening && "text-primary",
          )}
        />
        <Button
          type="button"
          variant={listening ? "destructive" : "ghost"}
          size="icon-sm"
          title="点一下开始 / 再点停止，长按为按住说话"
          onClick={() => {
            if (voice.current.holding) return;
            if (voice.current.session?.active) stopVoice();
            else startVoice();
          }}
          onPointerDown={() => {
            voice.current.pressTimer = setTimeout(() => {
              voice.current.holding = true;
              startVoice();
              setVoiceHint("按住说话，松开结束");
            }, 450);
          }}
          onPointerUp={releaseMic}
          onPointerLeave={releaseMic}
          onPointerCancel={releaseMic}
        >
          <Mic />
        </Button>
        <Button type="button" size="icon-sm" onClick={() => doSend()} disabled={sending} title="发送">
          <SendHorizontal />
        </Button>
      </div>
    </div>
  );
}
