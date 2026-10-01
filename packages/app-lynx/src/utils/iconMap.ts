// ─── 图标名 ↔ 码点映射（唯一事实源）───
// ADR-0208 决策 2：这份表同时是三件事的源——
//   1. 字体子集的生成输入（scripts/generate-icon-subset.py 直接解析本文件的 ICON_CODEPOINTS）
//   2. 运行时 <AppIcon name="..."> 查码点的依据
//   3. 门禁的 oracle（tests/iconMap.test.ts 断言映射表 ↔ 字体子集 cmap 双向一一对应）
// 码点来源：Material Symbols 官方 codepoints 文件
//   https://github.com/google/material-design-icons/blob/master/variablefont/
//     MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints
// 字体实例：FILL=0（Outlined 变体，ADR-0208 决策 1）/ GRAD=0 / opsz=24 / wght=400。
//   Lynx 的 @font-face 不支持 font-style/weight/variant（Lynx 文档
//   /api/css/at-rule/font-face.md「Difference from W3C」），可变轴必须在子集化时定死。

/** 图标全集：新增图标先在此登记（并重跑 scripts/generate-icon-subset.py），再在模板里用 `<AppIcon>`。 */
export type IconName = keyof typeof ICON_CODEPOINTS

/**
 * name → 码点。
 *
 * ⚠️ 同一码点不可登记两个 name：`favorite` 与 `favorite_border` 在官方 codepoints
 * 文件里同映射 e87e，`star` 与 `star_outline` 同映射 f09a——差别只在可变轴 FILL
 * 实例上。本子集字体固定 FILL=0，两者视觉相同，故只保留 outline 形态，
 * 选中态用 color/label 表达，不靠字形切换。
 */
export const ICON_CODEPOINTS = {
  // ─── 导航（NAV_TABS 四 tab + 全局 FAB 回退）───
  home: 0xe9b2, // ⌂ 推荐
  explore: 0xe87a, // ✦ 插画
  menu_book: 0xea19, // ✎ 小说
  person: 0xf0d3, // ◎ 我的

  // ─── 动作 ──
  search: 0xef7a, // 🔍 全局搜索
  refresh: 0xe5d5, // ↻ 刷新 / 翻译失败重试
  close: 0xe5cd, // ✕ 关闭
  check: 0xe668, // ✓ 已完成 / 已选中
  content_copy: 0xe14d, // 「复制」（TextSelectionToolbar 的 copy 项；取代原手绘描边矩形，
  //                      ADR-0208 决策 5）
  arrow_upward: 0xe5d8, // ↑ 回顶
  file_download: 0xf090, // ↓ 保存 / 下载
  upload: 0xf09b, // ⬆ 导出
  translate: 0xe8e2, // 翻译
  favorite_border: 0xe87e, // ♡ 未收藏（选中态用色，不用 favorite——码点同）

  // ─── 方向 ──
  arrow_back: 0xe5c4, // ‹ 返回
  arrow_forward: 0xe5c8, // › 下一日 / 全部更多
  expand_more: 0xe5cf, // ⌄ 展开（筛选面板）
  expand_less: 0xe5ce, // ⌃ 收起（筛选面板）

  // ─── 空态 / 统计 ──
  notifications: 0xe7f5, // ◇ 通知空态
  grid_view: 0xe9b0, // ▦ 用户主页空态
  leaderboard: 0xf20c, // ▲ 排行空态
  star_outline: 0xf09a, // ★/☆ 收藏数 / 追更（码点同 star，选中态用色）
  visibility: 0xe8f4, // 👁 观看数
  chat_bubble: 0xe0cb, // 💬 评论数
  list: 0xe896, // ≡ 系列目录
  schedule: 0xefd6, // ⏱ 稍后看

  // ─── 作品类型徽标（IllustTypeBadgeRow.vue 的 BADGE_ICONS 表：种类 → 图标名，
  //     图标经 <AppIcon> 渲染；**不随 i18n 文案进字典**——那会把「用哪个图标」的
  //     决定权散进字典，既无法集中审计也无法保证跨设备字形一致）───
  play_arrow: 0xe037, // 动图（ugoira）
  photo_library: 0xe413, // 多页（page_count > 1）
} as const

/** 自定义字体族名（AppIcon 的 font-family）。子集字体文件名与之对应。 */
export const ICON_FONT_FAMILY = 'MaterialSymbolsOutlinedSubset'

/**
 * name → 实际渲染字符（码点经字符串构造，规避源码里直接出现裸字形）。
 * 查表未命中抛错——由 AppIcon 透出 + 门禁拦下，不静默降级为空白（测试硬约束 3）。
 * 错误串用英文：面向开发者的契约错误，非用户可见文案（AGENTS.md「注释/命名」约定）。
 */
export function iconChar(name: string): string {
  const cp = ICON_CODEPOINTS[name as IconName]
  if (cp === undefined) {
    throw new Error(
      `[iconMap] unknown icon name "${name}" — register it in ICON_CODEPOINTS then rerun scripts/generate-icon-subset.py`,
    )
  }
  return String.fromCodePoint(cp)
}
