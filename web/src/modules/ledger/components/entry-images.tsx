"use client";

import { useRef, useState } from "react";

import { ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { apiUrl, post } from "../api";
import { prepareImage, readB64 } from "../speech";
import type { Attachment } from "../types";

export const ENTRY_IMAGE_MAX = 9;

// 记账时的图片：已上传的显示缩略图，上传中 / 失败的单独显示
export type ImageItem =
  | { key: string; status: "done"; attachment: Attachment }
  | { key: string; status: "uploading" | "error"; file: File; preview: string; error?: string };

export const doneIds = (items: ImageItem[]) => items.flatMap((x) => (x.status === "done" ? [x.attachment.id] : []));

// 拖拽 / 点选（手机上可选相册或拍照）/ 粘贴截图，选完立即上传
export function EntryImagesInput({
  items,
  onChange,
}: {
  items: ImageItem[];
  onChange: (fn: (items: ImageItem[]) => ImageItem[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const patchItem = (key: string, next: ImageItem) => onChange((l) => l.map((x) => (x.key === key ? next : x)));

  const upload = async (key: string, file: File, preview: string) => {
    patchItem(key, { key, status: "uploading", file, preview });
    try {
      const f = await prepareImage(file);
      if (f.size > 20 * 1024 * 1024) throw new Error("超过 20MB");
      const d = await post<{ attachment: Attachment }>("/attachments", {
        name: f.name,
        mime: f.type,
        data: await readB64(f),
      });
      if (!d.attachment.image) throw new Error("不支持这种图片格式");
      URL.revokeObjectURL(preview);
      patchItem(key, { key, status: "done", attachment: d.attachment });
    } catch (e) {
      patchItem(key, { key, status: "error", file, preview, error: (e as Error).message || "上传失败" });
    }
  };

  const addFiles = (files: File[]) => {
    const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (!imgs.length) return files.length ? toast("只能上传图片") : undefined;
    const room = ENTRY_IMAGE_MAX - items.length;
    if (room <= 0) return toast(`每笔最多 ${ENTRY_IMAGE_MAX} 张图片`);
    if (imgs.length > room) toast(`每笔最多 ${ENTRY_IMAGE_MAX} 张，只添加了前 ${room} 张`);
    const added = imgs.slice(0, room).map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: "uploading" as const,
      file,
      preview: URL.createObjectURL(file),
    }));
    onChange((l) => [...l, ...added]);
    for (const it of added) void upload(it.key, it.file, it.preview);
  };

  const remove = (it: ImageItem) => {
    if (it.status !== "done") URL.revokeObjectURL(it.preview);
    onChange((l) => l.filter((x) => x.key !== it.key));
  };

  return (
    <div
      className={cn("rounded-md border border-dashed p-2 transition-colors", over && "border-primary bg-primary/5")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length) {
          e.preventDefault();
          addFiles(files);
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const src = it.status === "done" ? apiUrl(it.attachment.url) : it.preview;
          return (
            <div key={it.key} className="relative size-16 shrink-0">
              <button
                type="button"
                className="size-full overflow-hidden rounded-md border"
                onClick={() => (it.status === "error" ? upload(it.key, it.file, it.preview) : setViewing(src))}
                title={it.status === "error" ? `${it.error}，点击重试` : "点击查看大图"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="size-full object-cover" />
              </button>
              {it.status !== "done" ? (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 flex items-center justify-center rounded-md",
                    it.status === "error" ? "bg-destructive/60" : "bg-black/40",
                  )}
                >
                  {it.status === "error" ? (
                    <RotateCw className="size-4 text-white" />
                  ) : (
                    <Loader2 className="size-4 animate-spin text-white" />
                  )}
                </div>
              ) : null}
              <button
                type="button"
                className="bg-background absolute -top-1.5 -right-1.5 rounded-full border p-0.5 shadow-sm"
                onClick={() => remove(it)}
                aria-label="移除图片"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        {items.length < ENTRY_IMAGE_MAX ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex h-16 min-w-16 flex-1 items-center justify-center gap-2 rounded-md px-3 text-xs"
          >
            <ImagePlus className="size-5 shrink-0" />
            <span className="text-left">
              {items.length ? "继续添加" : "拖拽、粘贴截图，或点击从相册选择"}
              <span className="block opacity-70">
                最多 {ENTRY_IMAGE_MAX} 张{items.length ? `，已添加 ${items.length} 张` : ""}
              </span>
            </span>
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <ImageViewer src={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

// 查看记录时的图片：缩略图，点击看大图
export function EntryImageGallery({ images, className }: { images: Attachment[]; className?: string }) {
  const [viewing, setViewing] = useState<string | null>(null);
  if (!images.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {images.map((a) => (
        <button
          key={a.id}
          type="button"
          className="size-20 overflow-hidden rounded-md border"
          onClick={() => setViewing(apiUrl(a.url))}
          title="点击查看大图"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={apiUrl(a.url)} alt={a.name} loading="lazy" className="size-full object-cover" />
        </button>
      ))}
      <ImageViewer src={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function ImageViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!src} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[95dvh] w-auto max-w-[95vw] min-w-72 items-center justify-center p-8 sm:max-w-[90vw]">
        <DialogTitle className="sr-only">查看图片</DialogTitle>
        {src ? (
          <a href={src} target="_blank" rel="noreferrer" title="在新标签页打开原图">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="max-h-[88dvh] max-w-full rounded object-contain" />
          </a>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
