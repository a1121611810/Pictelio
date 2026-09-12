// 英文字典：key 集合必须与源语言完全一致（satisfies Dict 编译期强制）。
import type { Dict } from "./zh-CN";

const en = {
  "error.action.checkProxy": "Check proxy settings",
  "error.action.relogin": "Sign in again",
  "error.action.backHome": "Back to home",
  "error.action.retry": "Retry",
  "error.hint.proxy": "Make sure the local proxy 127.0.0.1:10808 is running",
  "error.hint.network": "Check your network connection",
  "error.hint.unauthorized": "Session expired. Sign in again",
  "error.hint.rateLimit": "Too many requests. Try again later",
  "error.hint.server": "Pixiv server is temporarily unavailable. Try again later",
  "settings.appearance.sectionTitle": "Display & Interaction",
  "settings.appearance.theme": "Theme",
  "settings.appearance.detailStairs": "Detail page stair navigation",
  "settings.appearance.detailStairsDesc":
    "Show a page-number rail on multi-page works for quick navigation",
  "settings.appearance.autoHideNav": "Auto-hide navigation bar",
  "settings.appearance.autoHideNavDesc":
    "Collapse the nav bar when scrolling down on profile and follow lists. Scroll up to reveal",
  "settings.appearance.persistScroll": "Persistent scroll restoration",
  "settings.appearance.persistScrollDesc":
    "Off: reopen at the top of lists (default). On: restore your last position.",
  "settings.appearance.language": "Language",
  "settings.appearance.languageDesc": "Change the interface language. Applies immediately.",
} as const satisfies Dict;

export default en;
