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
  "error.api.proxy":
    "Local proxy connection failed (127.0.0.1:10808). Check that the proxy app is running.",
  "error.api.network": "Network unavailable. Check your connection.",
  "error.api.unauthorized": "Session expired (HTTP {{status}}){{detail}}",
  "error.api.forbidden": "Access denied (HTTP {{status}}){{detail}}",
  "error.api.rateLimit": "Too many requests. Try again later (HTTP 429)",
  "error.api.invalidGrant": "Your login credentials have expired. Sign in again",
  "error.api.server": "Server error (HTTP {{status}}){{detail}}",
  "error.api.unknownStatus": "Request failed (HTTP {{status}}){{detail}}",
  "error.api.unknown": "Unknown error{{detail}}",
  "error.fallback.loadFailed": "Failed to load",
} as const satisfies Record<ErrorKey, string>;

export default enError;
