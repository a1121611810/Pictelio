// resolveTagChips 单测（Ticket T3 / spec: docs/specs/app-lynx-recommended-carousel-polish-r2.md §2.4/§3.4 / ADR-0118 决策 4）。
// 期望值出处（oracle）：spec §2.4「最多 3 个，超出折叠为 +N（N = 未展示数）」「translated_name || name 带 # 前缀」；
// ADR-0118 决策 4 同语义；输入结构取自 api/types.ts 的 PixivIllustTag / PixivNovel.tags（{ name, translated_name? } 真实字段）。
// 契约升级（ADR-0133 决策 3）：chips 由 string[] → { text, name }[]——text=展示文本（# 前缀、translated_name 优先），
// name=原始标签（点击搜索用，来源=webview SearchableTag 用 tag.name 的先例）。text 断言与旧的 string[] 语义等价。
import { describe, expect, it } from 'vitest'
import { resolveTagChips } from './tagChips'

describe('resolveTagChips', () => {
  it('空数组 → chips 空、overflow 0', () => {
    expect(resolveTagChips([])).toEqual({ chips: [], overflow: 0 })
  })

  it('≤3 个标签全显示，顺序保持、overflow 0', () => {
    const tags = [
      { name: 'オリジナル' },
      { name: '女の子' },
      { name: '風景' },
    ]
    expect(resolveTagChips(tags)).toEqual({
      chips: [
        { text: '#オリジナル', name: 'オリジナル' },
        { text: '#女の子', name: '女の子' },
        { text: '#風景', name: '風景' },
      ],
      overflow: 0,
    })
  })

  it('单个标签也全显示（1 个 → chips 1、overflow 0）', () => {
    expect(resolveTagChips([{ name: 'オリジナル' }])).toEqual({
      chips: [{ text: '#オリジナル', name: 'オリジナル' }],
      overflow: 0,
    })
  })

  it('>3 个标签折叠：5 个 → chips 恰 3 个、overflow 2（= 总数 - 3）', () => {
    const tags = [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
      { name: 'd' },
      { name: 'e' },
    ]
    const result = resolveTagChips(tags)
    expect(result.chips).toHaveLength(3)
    expect(result.chips).toMatchObject([{ text: '#a' }, { text: '#b' }, { text: '#c' }])
    expect(result.chips.map((c) => c.name)).toEqual(['a', 'b', 'c'])
    expect(result.overflow).toBe(2)
  })

  it('超出部分保留前 3 个的顺序（折叠取前 max 个，非乱序）', () => {
    const tags = [
      { name: '一' },
      { name: '二' },
      { name: '三' },
      { name: '四' },
      { name: '五' },
    ]
    expect(resolveTagChips(tags).chips.map((c) => c.text)).toEqual(['#一', '#二', '#三'])
  })

  it('translated_name 非空 → 优先显示 translated_name（text 变、name 保持原始）', () => {
    const tags = [{ name: 'オリジナル', translated_name: 'Original' }]
    expect(resolveTagChips(tags).chips).toEqual([{ text: '#Original', name: 'オリジナル' }])
  })

  it('translated_name 缺失（undefined）→ 回落 name（text=name，name 同）', () => {
    const tags = [{ name: '女の子' }]
    expect(resolveTagChips(tags).chips).toEqual([{ text: '#女の子', name: '女の子' }])
  })

  it('translated_name 为空串 → 回落 name（显式契约）', () => {
    const tags = [{ name: '風景', translated_name: '' }]
    expect(resolveTagChips(tags).chips).toEqual([{ text: '#風景', name: '風景' }])
  })

  it('混合标签各自取 translated_name 或回落 name，均带 # 前缀且 name 一一对应', () => {
    const tags = [
      { name: 'オリジナル', translated_name: 'Original' },
      { name: '女の子' },
      { name: '風景', translated_name: '' },
    ]
    expect(resolveTagChips(tags)).toEqual({
      chips: [
        { text: '#Original', name: 'オリジナル' },
        { text: '#女の子', name: '女の子' },
        { text: '#風景', name: '風景' },
      ],
      overflow: 0,
    })
  })

  it('显式 max 参数生效：max=1 时 3 个标签 → chips 1、overflow 2', () => {
    const tags = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
    expect(resolveTagChips(tags, 1)).toEqual({
      chips: [{ text: '#a', name: 'a' }],
      overflow: 2,
    })
  })
})
