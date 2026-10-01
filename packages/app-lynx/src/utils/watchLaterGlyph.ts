// 稍后看图标名单一事实源（ADR-0112 起源，ADR-0208 迁移后形态变更）。
//
// 历史：此处曾是 U+23F1 ⏱ + VS15（U+FE0E 强制 text presentation）的裸字形。存这个
// 转义序列是因为 Lynx 原生会把 emoji presentation 字形渲染成彩色 emoji 且 CSS 变色
// 失效（♥︎ 同款问题），漏 VS15 即回退彩色。
//
// ADR-0208 之后「防彩色 emoji」这个约束由**子集字体**整体承担：图标位一律走
// <AppIcon>，字体是构建期定死 FILL=0 的 Outlined 子集，根本不含 emoji 字形，
// 也就没有 presentation 选择问题。故此处改为登记 IconName，字形解析下沉到
// utils/iconMap.iconChar —— 与其余图标位共用同一条链路，同码点不可登记两次的
// 约束也自动适用。
//
// 三处消费统一导入，防止「同一语义、两个图标名」漂移：
//   - pages/WatchLater.vue     <EmptyState :icon="LATER_ICON" />
//   - pages/NovelIntro.vue     <ActionButton :icon="LATER_ICON" />
//   - pages/IllustDetail.vue   <AppIcon :name="LATER_ICON" />
import type { IconName } from './iconMap'

/** 稍后看图标名（Material Symbols `schedule`）。 */
export const LATER_ICON: IconName = 'schedule'
