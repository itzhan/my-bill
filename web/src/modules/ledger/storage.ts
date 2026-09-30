// 本机偏好（会话、开合状态、清屏位置等）；隐私模式下读写可能失败，失败就当没有
export const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const lsSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // 忽略
  }
};
