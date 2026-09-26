// 稍后看时钟字形单一事实源（ADR-0112）：U+23F1 ⏱ + VS15（U+FE0E 强制 text presentation）。
// 平台事实：Lynx 原生把 emoji presentation 字形渲染为彩色 emoji 且 CSS 变色失效
// （♥\uFE0E 同款修复）。三处消费（IllustDetail / NovelIntro / WatchLater）统一导入，
// 防各自手写字形漂移（漏 VS15 即回退彩色 emoji）。
export const LATER_ICON = '\u23F1\uFE0E'
