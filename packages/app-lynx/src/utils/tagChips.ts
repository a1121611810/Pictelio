// 标签胶囊行折叠纯函数（Ticket T3 / ADR-0118 决策 4 / spec: docs/specs/app-lynx-recommended-carousel-polish-r2.md §2.4/§3.4）。
// 插画 + 小说统一：输入结构 = { name, translated_name? }，与 api/types.ts 的
// PixivIllustTag / PixivNovel.tags 字段兼容；折叠/前缀逻辑收敛于此（node 可测），
// 组件只做渲染。translated_name 缺失/为空串 → 回落 name 为显式契约（非静默降级）。
// 契约升级（ADR-0133 决策 3）：chips 由 string[] → { text, name }[]——text = 展示文本
// （'#' 前缀、translated_name 非空优先），name = 原始标签（标签点击搜索用，对齐
// webview SearchableTag 用 tag.name 的先例；caveat: text 可能因翻译名折叠出相同文本，
// name 是唯一搜索标识）。

/** 标签最小字段集（PixivIllustTag / PixivNovel.tags 结构兼容） */
export interface TagChipSource {
  name: string
  translated_name?: string
}

/** 单个胶囊：展示文本 + 原始标签名 */
export interface TagChip {
  /** 展示文本：'#' + (translated_name 非空 ? translated_name : name) */
  text: string
  /** 原始标签名（点击触发搜索的关键词） */
  name: string
}

/** 折叠结果：展示 chips + 未展示计数 */
export interface TagChipsResult {
  /** 前 max 个标签，text/name 成对（key 用 name，text 可能折叠重复） */
  chips: TagChip[]
  /** 未展示的标签数 = max(0, tags.length - max) */
  overflow: number
}

/**
 * 解析标签胶囊行：前 max 个标签映射为 `#` 前缀文本（translated_name 非空优先，否则 name），
 * 超出部分折叠为 +N 计数。空数组 → chips 空、overflow 0。
 */
export function resolveTagChips(tags: TagChipSource[], max = 3): TagChipsResult {
  const chips = tags.slice(0, max).map((tag) => ({
    text: `#${tag.translated_name || tag.name}`,
    name: tag.name,
  }))
  return { chips, overflow: Math.max(0, tags.length - max) }
}
