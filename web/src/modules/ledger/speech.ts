// 语音输入：浏览器普通话识别，中文数字自动转阿拉伯数字（从旧版 app.js 原样移植）
const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  贰: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};
const CN_UNIT: Record<string, number> = {
  十: 10,
  拾: 10,
  百: 100,
  佰: 100,
  千: 1000,
  仟: 1000,
  万: 10000,
  亿: 100000000,
};

function cnToNumber(s: string): number | null {
  let total = 0;
  let section = 0;
  let num = 0;
  let seen = false;
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch]!;
      seen = true;
    } else if (ch === "十" || ch === "拾") {
      section += (num || 1) * 10;
      num = 0;
      seen = true;
    } else if (ch === "百" || ch === "佰" || ch === "千" || ch === "仟") {
      section += (num || 1) * CN_UNIT[ch]!;
      num = 0;
      seen = true;
    } else if (ch === "万" || ch === "亿") {
      total = (total + section + num) * CN_UNIT[ch]!;
      section = 0;
      num = 0;
      seen = true;
    } else if (ch === "点") break;
  }
  return seen ? total + section + num : null;
}

// 「三百U」→「300 USDT」，「一千二百五十块」→「1250块」，「两万」→「20000」，「三点五万」→「35000」
export function normalizeSpeech(t: string) {
  return String(t)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(
      /([零〇一二两三四五六七八九壹贰叁肆伍陆柒捌玖]+)点([零〇一二两三四五六七八九壹贰叁肆伍陆柒捌玖]+)(万|亿)?/g,
      (m, a: string, b: string, u?: string) => {
        const ai = cnToNumber(a);
        const bi = [...b].map((c) => CN_DIGIT[c]).join("");
        if (ai === null || !bi) return m;
        const v = Number(`${ai}.${bi}`) * (u ? CN_UNIT[u]! : 1);
        return String(Math.round(v * 100) / 100);
      },
    )
    .replace(
      /[零〇一二两三四五六七八九壹贰叁肆伍陆柒捌玖十拾百佰千仟万亿]{2,}|[十拾][零〇一二两三四五六七八九]?|[一二两三四五六七八九][十拾百佰千仟万亿]/g,
      (m) => {
        const v = cnToNumber(m);
        return v === null || (v < 10 && !/[十拾百佰千仟万亿]/.test(m)) ? m : String(v);
      },
    )
    .replace(/(\d)\s+(?=[a-zA-Z¥$%])/g, "$1")
    .replace(/([一-龥])\s+(?=[一-龥\d])/g, "$1")
    .replace(/(\d)\s+(?=[一-龥])/g, "$1")
    .replace(/\b(\d+)\s*(u|U|usdt|USDT)\b/g, "$1 USDT")
    .replace(/(\d+)\s*(美金|美元|刀)/g, "$1 美元")
    .trim();
}

export function joinText(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return /[，。！？、,.!?:：]$/.test(a) ? a + b : a + (/^[一-龥]/.test(b) && /[一-龥\d]$/.test(a) ? "，" : " ") + b;
}

// 图片先在浏览器里压成 JPEG（最长边 2048、质量 0.85）：手机原图 / 截图 / HEIC 都能变小变通用，AI 也读得动
function loadImageEl(file: File) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      res(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("decode"));
    };
    img.src = url;
  });
}

export async function prepareImage(file: File): Promise<File> {
  const isImg = /^image\//.test(file.type) || /\.(heic|heif|png|jpe?g|webp|gif|bmp)$/i.test(file.name);
  if (!isImg || file.type === "image/gif") return file;
  if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size < 1.2 * 1024 * 1024) return file;
  try {
    let src: ImageBitmap | HTMLImageElement;
    try {
      src = await createImageBitmap(file);
    } catch {
      src = await loadImageEl(file);
    }
    const w = "naturalWidth" in src ? src.naturalWidth : src.width;
    const h = "naturalHeight" in src ? src.naturalHeight : src.height;
    const scale = Math.min(1, 2048 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
    if ("close" in src) src.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export const readB64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(new Error("读取文件失败"));
    r.readAsDataURL(f);
  });
