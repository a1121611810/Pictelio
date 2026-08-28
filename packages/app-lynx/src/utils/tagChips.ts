// 标签胶囊行折叠纯函数（Ticket T3 / ADR-0118 决策 4 / spec: docs/specs/app-lynx-recommended-carousel-polish-r2.md §2.4/§3.4）。
// 插画 + 小说统一：输入结构 = { name, translated_name? }，与 api/types.ts 的
// PixivIllustTag / PixivNovel.tags 字段兼容；折叠/前缀逻辑收敛于此（node 可测），
// 组件只做渲染。translated_name 缺失/为空串 → 回落 name 为显式契约（非静默降级）。

/** 标签最小字段集（PixivIllustTag / PixivNovel.tags 结构兼容） */
export interface TagChipSource {
  name: string
  translated_name?: string
}

/** 折叠结果：展示 chips + 未展示计数 */
export interface TagChipsResult {
  /** 前 max 个标签，文本 = '#' + (translated_name 非空 ? translated_name : name) */
  chips: string[]
  /** 未展示的标签数 = max(0, tags.length - max) */
  overflow: number
}

/**
 * 解析标签胶囊行：前 max 个标签映射为 `#` 前缀文本（translated_name 非空优先，否则 name），
 * 超出部分折叠为 +N 计数。空数组 → chips 空、overflow 0。
 */
export function resolveTagChips(tags: TagChipSource[], max = 3): TagChipsResult {
  const chips = tags.slice(0, max).map((tag) => `#${tag.translated_name || tag.name}`)
  return { chips, overflow: Math.max(0, tags.length - max) }
}
