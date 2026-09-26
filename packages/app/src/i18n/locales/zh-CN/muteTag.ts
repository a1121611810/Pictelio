// muteTag 域（源语言）—— 标签静音（ADR-0187 / spec docs/specs/tag-mute.md）。
// 覆盖：MuteTagSheet 管理界面、设置入口行、长按静音轻提示。
const zhMuteTag = {
  // ── MuteTagSheet（复刻 BlocklistSheet 形态）──
  "muteTag.sheet.title": "静音标签",
  "muteTag.sheet.closeAria": "关闭",
  "muteTag.sheet.empty": "暂无静音标签",
  "muteTag.sheet.unmute": "取消静音",
  "muteTag.sheet.unmuteAria": "取消静音标签 {{name}}",
  "muteTag.sheet.hint": "长按作品标签即可静音；含该标签的作品将不再出现在推荐、关注与排行榜中",

  // ── 设置「内容」组入口行 ──
  "muteTag.settingsRow.title": "管理静音标签",
  "muteTag.settingsRow.desc": "维护按标签隐藏作品的词表",

  // ── 长按静音成功轻提示 ──
  "muteTag.mutedToast": "已静音标签「{{name}}」",
} as const;

export default zhMuteTag;
export type ZhMuteTagKey = keyof typeof zhMuteTag;
