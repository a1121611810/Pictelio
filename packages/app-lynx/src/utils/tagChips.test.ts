// resolveTagChips 单测（Ticket T3 / spec: docs/specs/app-lynx-recommended-carousel-polish-r2.md §2.4/§3.4 / ADR-0118 决策 4）。
// 期望值出处（oracle）：spec §2.4「最多 3 个，超出折叠为 +N（N = 未展示数）」「translated_name || name 带 # 前缀」；
// ADR-0118 决策 4 同语义；输入结构取自 api/types.ts 的 PixivIllustTag / PixivNovel.tags（{ name, translated_name? } 真实字段）。
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
      chips: ['#オリジナル', '#女の子', '#風景'],
      overflow: 0,
    })
  })

  it('单个标签也全显示（1 个 → chips 1、overflow 0）', () => {
    expect(resolveTagChips([{ name: 'オリジナル' }])).toEqual({
      chips: ['#オリジナル'],
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
    expect(result.chips).toEqual(['#a', '#b', '#c'])
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
    expect(resolveTagChips(tags).chips).toEqual(['#一', '#二', '#三'])
  })

  it('translated_name 非空 → 优先显示 translated_name', () => {
    const tags = [{ name: 'オリジナル', translated_name: 'Original' }]
    expect(resolveTagChips(tags).chips).toEqual(['#Original'])
  })

  it('translated_name 缺失（undefined）→ 回落 name', () => {
    const tags = [{ name: '女の子' }]
    expect(resolveTagChips(tags).chips).toEqual(['#女の子'])
  })

  it('translated_name 为空串 → 回落 name（显式契约）', () => {
    const tags = [{ name: '風景', translated_name: '' }]
    expect(resolveTagChips(tags).chips).toEqual(['#風景'])
  })

  it('混合标签各自取 translated_name 或回落 name，均带 # 前缀', () => {
    const tags = [
      { name: 'オリジナル', translated_name: 'Original' },
      { name: '女の子' },
      { name: '風景', translated_name: '' },
    ]
    expect(resolveTagChips(tags)).toEqual({
      chips: ['#Original', '#女の子', '#風景'],
      overflow: 0,
    })
  })

  it('显式 max 参数生效：max=1 时 3 个标签 → chips 1、overflow 2', () => {
    const tags = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
    expect(resolveTagChips(tags, 1)).toEqual({ chips: ['#a'], overflow: 2 })
  })
})
