"use client";

import { useRef, useState } from "react";

import { Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { apiUrl, del, post } from "@/modules/ledger/api";
import { ResponsiveDialog, useConfirm } from "@/modules/ledger/components/shared";
import { fmtSize } from "@/modules/ledger/format";
import type { CustomerProject, PartyContract } from "@/modules/ledger/types";

// 文件归属：客户（可选具体项目 / 默认全部项目）或公司日常项目（直接挂该项目）
export type FileTarget = { kind: "party"; projects: CustomerProject[] } | { kind: "project"; projectId: number };

// 按 MIME / 后缀识别文件类型，决定预览方式
export function fileKind(c: PartyContract): "image" | "pdf" | "text" | "office" {
  const m = (c.mime || "").toLowerCase();
  const n = (c.name || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.startsWith("text/") || /\.(txt|md|csv|json|log)$/.test(n)) return "text";
  return "office"; // Word / Excel / PPT 等，浏览器无法内嵌渲染
}

// 预览：图片 <img>、PDF / 文本 <iframe>、Office 文档给下载入口
export function FilePreview({ file }: { file: PartyContract }) {
  const src = apiUrl(file.url);
  const kind = fileKind(file);
  if (kind === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={file.title} className="mx-auto max-h-[72vh] w-auto rounded-md" />;
  if (kind === "pdf" || kind === "text")
    return <iframe src={src} title={file.title} className="bg-muted h-[72vh] w-full rounded-md border" />;
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <FileText className="text-muted-foreground size-10" />
      <p className="text-muted-foreground text-sm">
        该格式（Word / Excel / PPT 等）暂不支持在线预览，请下载后用本地软件查看
      </p>
      <Button asChild>
        <a href={`${src}?download=1`}>
          <Download />
          下载查看
        </a>
      </Button>
    </div>
  );
}

function UploadFileDialog({
  open,
  onOpenChange,
  onDone,
  target,
  category,
  label,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  target: FileTarget;
  category: "contract" | "invoice";
  label: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  // 客户：默认 "all"（覆盖全部项目）；项目：无需选择
  const [partyId, setPartyId] = useState<string>("all");
  const [signDate, setSignDate] = useState("");
  const [validYears, setValidYears] = useState("1");
  const [fileNote, setFileNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const expiry =
    category === "contract" && signDate && Number(validYears) > 0
      ? (() => {
          const [y = 0, m = 1, d = 1] = signDate.split("-").map(Number);
          return new Date(Date.UTC(y + Number(validYears), m - 1, d)).toISOString().slice(0, 10);
        })()
      : "";

  const pick = (f: File | null) => {
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError(`请选择${label}文件`);
    if (file.size > 20 * 1024 * 1024) return setError("文件不能超过 20MB");
    // 解析上传地址与归属
    let path: string;
    let allProjects = false;
    if (target.kind === "party") {
      allProjects = partyId === "all";
      const targetId = allProjects ? target.projects[0]?.party_id : Number(partyId);
      if (!targetId) return setError("请选择项目");
      path = `/parties/${targetId}/contracts`;
    } else {
      path = `/projects/${target.projectId}/files`;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await post(path, {
        name: file.name,
        mime: file.type,
        data,
        title: title.trim() || file.name,
        category,
        ...(target.kind === "party" ? { all_projects: allProjects } : {}),
        ...(category === "contract"
          ? { sign_date: signDate, valid_years: Number(validYears) || 0, note: fileNote.trim() }
          : {}),
      });
      toast.success(`${label}已上传`);
      setFile(null);
      setTitle("");
      setFileNote("");
      onOpenChange(false);
      onDone();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`上传${label}`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>{label}文件（PDF / 图片 / Word 等，≤ 20MB）</Label>
          <input ref={fileRef} type="file" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0] ?? null);
            }}
            className={cn(
              "border-input hover:bg-accent/40 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
              dragging && "border-primary bg-primary/5",
            )}
          >
            <Upload className="text-muted-foreground size-5" />
            {file ? (
              <span className="text-sm font-medium">
                {file.name}（{fmtSize(file.size)}）
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">点击选择文件，或把文件拖到这里</span>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ct-title">{label}名称</Label>
          <Input
            id="ct-title"
            maxLength={100}
            placeholder={category === "invoice" ? "如 2026 年 1 月发票" : "如 2026 年度服务合同"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        {target.kind === "party" ? (
          <div className="space-y-2">
            <Label>归属项目</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">默认（覆盖全部项目 · 只归属该客户）</SelectItem>
                {target.projects.map((p) => (
                  <SelectItem key={p.party_id} value={String(p.party_id)}>
                    {p.project_name}
                    {p.relay_ref ? <span className="text-muted-foreground"> · 中转客户 {p.relay_ref}</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {category === "contract" ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ct-sign">签注日期</Label>
                <Input id="ct-sign" type="date" value={signDate} onChange={(e) => setSignDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>有效期</Label>
                <Select value={validYears} onValueChange={setValidYears}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 10].map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y} 年
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {expiry ? (
              <p className="text-muted-foreground text-xs">
                到期日 <span className="text-foreground font-medium">{expiry}</span>
                ，将在到期前一个月起连续三天发邮件提醒
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="ct-note">备注（可选）</Label>
              <Input
                id="ct-note"
                maxLength={500}
                placeholder="如 自动续约 / 每年调价"
                value={fileNote}
                onChange={(e) => setFileNote(e.target.value)}
              />
            </div>
          </>
        ) : null}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "上传中…" : "上传"}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}

export function FilesCard({
  files,
  onReload,
  target,
  category,
  label,
  description,
}: {
  files: PartyContract[];
  onReload: () => void;
  target: FileTarget;
  category: "contract" | "invoice";
  label: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PartyContract | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const todayStr = new Date().toLocaleDateString("sv-SE");
  const delPath = target.kind === "project" ? "/project-files" : "/party-contracts";

  const remove = async (c: PartyContract) => {
    if (!(await confirm({ title: `删除${label}「${c.title}」？`, destructive: true, confirmText: "删除" }))) return;
    try {
      await del(`${delPath}/${c.id}`);
      toast.success("已删除");
      onReload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {label}（{files.length}）
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Upload />
          上传{label}
        </Button>
      </CardHeader>
      <CardContent>
        {files.length ? (
          <div className="divide-y rounded-md border">
            {files.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3">
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <button
                  type="button"
                  onClick={() => setPreview(c)}
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  title="点击预览"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium hover:underline">{c.title}</span>
                    {c.expiry ? (
                      c.expiry < todayStr ? (
                        <Badge variant="outline" className="text-muted-foreground font-normal">
                          已过期
                        </Badge>
                      ) : c.remind_date && todayStr >= c.remind_date ? (
                        <Badge variant="destructive">即将到期</Badge>
                      ) : null
                    ) : null}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {c.all_projects ? "全部项目 · " : c.project_name ? `${c.project_name} · ` : ""}
                    {fmtSize(c.size)} · {c.creator_name} · {new Date(c.created_at).toLocaleDateString("zh-CN")}
                  </div>
                  {c.expiry ? (
                    <div className="text-muted-foreground text-xs">
                      {c.sign_date} 签 · {c.valid_years} 年 · {c.expiry} 到期{c.note ? ` · ${c.note}` : ""}
                    </div>
                  ) : null}
                </button>
                <Button variant="ghost" size="icon-sm" title="预览" onClick={() => setPreview(c)}>
                  <Eye />
                </Button>
                <Button variant="ghost" size="icon-sm" title="下载" asChild>
                  <a href={`${apiUrl(c.url)}?download=1`}>
                    <Download />
                  </a>
                </Button>
                <Button variant="ghost" size="icon-sm" title="删除" onClick={() => remove(c)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            还没有{label}，点「上传{label}」添加
          </p>
        )}
      </CardContent>
      <UploadFileDialog
        open={open}
        onOpenChange={setOpen}
        onDone={onReload}
        target={target}
        category={category}
        label={label}
      />
      <ResponsiveDialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={preview?.title ?? "预览"}
        description={preview ? `${preview.name} · ${fmtSize(preview.size)}` : undefined}
        className="sm:max-w-4xl"
      >
        {preview ? <FilePreview file={preview} /> : null}
      </ResponsiveDialog>
      {confirmEl}
    </Card>
  );
}
