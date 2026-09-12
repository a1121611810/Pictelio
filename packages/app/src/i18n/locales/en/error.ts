// 英文 · 错误域：key 集合与源语言完全一致（satisfies 编译期强制）。
// 文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出。
import type { ErrorKey } from "../zh-CN/error";

const enError = {
  "error.action.checkProxy": "Check proxy settings",
  "error.action.relogin": "Sign in again",
  "error.action.backHome": "Back to home",
  "error.action.retry": "Retry",
  "error.hint.proxy": "Make sure the local proxy 127.0.0.1:10808 is running",
  "error.hint.network": "Check your network connection",
  "error.hint.unauthorized": "Session expired. Sign in again",
  "error.hint.rateLimit": "Too many requests. Try again later",
  "error.hint.server": "Pixiv server is temporarily unavailable. Try again later",
} as const satisfies Record<ErrorKey, string>;

export default enError;
