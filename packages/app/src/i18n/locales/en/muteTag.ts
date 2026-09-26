// muteTag 域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// R9：占位符与 zh 完全一致。
import type { ZhMuteTagKey } from "../zh-CN/muteTag";

const enMuteTag = {
  // ── MuteTagSheet ──
  "muteTag.sheet.title": "Muted tags",
  "muteTag.sheet.closeAria": "Close",
  "muteTag.sheet.empty": "No muted tags",
  "muteTag.sheet.unmute": "Unmute",
  "muteTag.sheet.unmuteAria": "Unmute tag {{name}}",
  "muteTag.sheet.hint":
    "Long-press a work tag to mute it; works with that tag will no longer appear in feeds, follows, or rankings",

  // ── Settings content row ──
  "muteTag.settingsRow.title": "Manage muted tags",
  "muteTag.settingsRow.desc": "Maintain your tag-level word list for hiding works",

  // ── Long-press mute toast ──
  "muteTag.mutedToast": 'Muted tag "{{name}}"',
} as const satisfies Record<ZhMuteTagKey, string>;

export default enMuteTag;
