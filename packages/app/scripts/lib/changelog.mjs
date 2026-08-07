// #174：version.json 的 changelog 截断上限模块
//
// ADR-0068：发布脚本写 version.json 的 changelog 字段时，截断上限从 200 字符放宽到
// 5000 字符，保证常规 release notes（含 commit 链接）完整显示；5000 上限防极端长文案
// 撑大清单文件。上限提取为可测模块常量，避免魔法数字散落在 release.mjs 内。

export const CHANGELOG_MAX_LENGTH = 5000;

export function truncateChangelog(notes) {
  return notes.slice(0, CHANGELOG_MAX_LENGTH);
}
