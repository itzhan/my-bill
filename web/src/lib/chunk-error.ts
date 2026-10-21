// 前端 chunk 加载失败（网络抖动 / 重新部署后旧页面引用了已不存在的 chunk）时整页刷新一次。
// 10 秒内只刷新一次，避免 chunk 确实缺失时无限刷新；刷新后仍失败就交给错误页展示。
const KEY = "chunk-error-reload-at";

export function reloadOnChunkError(error: Error): boolean {
  const isChunkError =
    error.name === "ChunkLoadError" || /Failed to load chunk|Loading chunk .* failed/.test(error.message);
  if (!isChunkError) return false;

  const last = Number(sessionStorage.getItem(KEY) ?? 0);
  if (Date.now() - last < 10_000) return false;

  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
  return true;
}
