// 英文 · 错误域：key 集合与源语言完全一致（satisfies 编译期强制）。
// 文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出。
import type { ErrorKey } from "../zh-CN/error";

const enError = {
  "error.hint.unauthorized": "Sign in again",
  "error.hint.network": "Check your network connection",
  "error.hint.proxy": "Check that the local proxy is running",
  "error.hint.server": "Pixiv server is temporarily unavailable. Try again later",
  "error.fallback.loadFailed": "Failed to load",
  "error.fallback.sessionExpired": "Session expired",
  "error.hintSeparator": ". ",
} as const satisfies Record<ErrorKey, string>;

export default enError;
