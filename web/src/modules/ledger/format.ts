// 从旧版 public/app.js 移植的格式化与解析工具，口径保持一致
import type { Currency, PartyKind } from "./types";

export const CUR: Record<Currency, { sym: string; name: string }> = {
  CNY: { sym: "¥", name: "人民币" },
  USDT: { sym: "₮", name: "USDT" },
  USD: { sym: "$", name: "美元" },
};
export const CURRENCIES: Currency[] = ["CNY", "USDT", "USD"];

export const PL: Record<PartyKind, { name: string; due: string; paid: string; open: string; entry: string }> = {
  supplier: { name: "供应商", due: "应付", paid: "实付", open: "未付", entry: "支出" },
  customer: { name: "客户", due: "应收", paid: "实收", open: "未收", entry: "收入" },
};

export const RANGES: [string, string][] = [
  ["month", "本月"],
  ["last-month", "上月"],
  ["30d", "近 30 天"],
  ["all", "全部"],
  ["custom", "自定义"],
];

const nf = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

// 金额单位：不足 1000 显示元（两位小数），满 1000 用 k，满 1 万用 w；w 是最大单位（1 亿 = 10,000w）
export function kw(n: number | null | undefined) {
  const a = Math.abs(Number(n) || 0);
  if (a >= 1e4) return `${nf0.format(a / 1e4)}w`;
  if (a >= 1e3) return `${nf0.format(a / 1e3)}k`;
  return nf.format(a);
}

export const fmt = (n: number | null | undefined) => kw(n);
export const fmt0 = (n: number) => nf0.format(n);
export const money = (n: number, cur: Currency = "CNY") => `${CUR[cur].sym}${fmt(n)}`;
export const signed = (n: number) => `${n < 0 ? "−" : ""}¥${fmt(n)}`;
export const curf = (n: number, c: Currency) => `${(CUR[c] ?? CUR.CNY).sym}${fmt(n)}${c === "CNY" ? "" : ` ${c}`}`;
export const usdf = (n: number | null | undefined) => `$${kw(n)}`;

export const pad = (n: number) => String(n).padStart(2, "0");
export const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const dayKey = (v: string | Date) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const todayLocal = () => dayKey(new Date());
export const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function dayLabel(key: string) {
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const [Y = 0, M = 1, D = 1] = key.split("-").map(Number);
  const md = `${M}月${D}日`;
  if (key === dayKey(today)) return `今天 · ${md}`;
  if (key === dayKey(yest)) return `昨天 · ${md}`;
  const wd = "周" + "日一二三四五六"[new Date(Y, M - 1, D).getDay()];
  return `${Y !== today.getFullYear() ? Y + "年" : ""}${md} ${wd}`;
}

export function relTime(iso: string | null | undefined) {
  if (!iso) return "暂无记录";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  const t = new Date(iso);
  return `${t.getMonth() + 1}月${t.getDate()}日`;
}

export const breakdown = (t: { CNY: number; USDT: number; USD: number }) =>
  CURRENCIES.filter((c) => t[c])
    .map((c) => `${CUR[c].sym}${kw(t[c])} ${c}`)
    .join(" · ") || "还没有记录";

export const maskPhone = (p: string) => (p.length > 7 ? p.slice(0, 3) + "****" + p.slice(-4) : p);

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

export function fmtCompact(n: number) {
  // 图表坐标轴用：同样的 k / w 单位，整数不带小数
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e3) return `${s}${kw(a)}`;
  return `${s}${nf0.format(a)}`;
}

export const fmtSize = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// 金额输入：支持全角数字、千分位、以及简单算式（120+80、300*2）
export function parseAmount(raw: string): number {
  const s = String(raw || "")
    .trim()
    .replace(/[，,\s]/g, "")
    .replace(/[０-９．＋－＊／（）]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[×xX]/g, "*")
    .replace(/÷/g, "/");
  if (!s || !/^[\d.+\-*/()]+$/.test(s)) return NaN;
  let v: unknown;
  try {
    // 输入已被正则限制为数字与四则运算符

    v = Function(`"use strict"; return (${s});`)();
  } catch {
    return NaN;
  }
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}

export function hue(name: string) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}
