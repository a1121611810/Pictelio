// 英文字典：key 集合必须与源语言完全一致（satisfies Dict 编译期强制）。
import type { Dict } from "./zh-CN";

const en = {
  "error.hint.unauthorized": "Sign in again",
  "error.hint.network": "Check your network connection",
  "error.hint.proxy": "Check that the local proxy is running",
  "error.hint.server": "Pixiv server is temporarily unavailable. Try again later",
  "error.fallback.loadFailed": "Failed to load",
  "error.fallback.sessionExpired": "Session expired",
  "error.hintSeparator": ". ",
} as const satisfies Dict;

export default en;
