// 账单后端（yuanqi-ledger）经 next.config.mjs 的 rewrites 同源代理在 /ledger/api 下
export const LEDGER_API = "/ledger/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// 后端返回的下载 / 附件链接都是 /api/... ，转成代理后的地址
export function apiUrl(url: string): string {
  return url.startsWith("/api/") ? `${LEDGER_API}${url.slice(4)}` : url;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${LEDGER_API}${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // 忽略：取不到就用默认值
  }
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
    window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (!res.ok) throw new ApiError(String(data.error || `请求失败 (${res.status})`), res.status);
  return data as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const put = <T>(path: string, body: unknown) => api<T>("PUT", path, body);
export const del = <T>(path: string) => api<T>("DELETE", path);
