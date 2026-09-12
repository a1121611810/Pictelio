// 英文 · 设置域：文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出。
import type { SettingsKey } from "../zh-CN/settings";

const enSettings = {
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
} as const satisfies Record<SettingsKey, string>;

export default enSettings;
