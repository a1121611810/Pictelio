// Ranking.vue 模板硬约束守卫（ticket #517 / spec docs/specs/ranking.md §5.6/§6.3）。
// 期望值出处（Oracle 溯源）：ticket AC + spec §6.3 既有约束 + ADR-0048（轴间距 :style 绑定）、
// ADR-0049（KeepAlive include↔name）、issue #140（图片显式高度）、ADR-0150（三态单链）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./Ranking.vue', import.meta.url)), 'utf8')
const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')

describe('Ranking.vue 模板硬约束（#517）', () => {
  it('首载三态互斥单链（ADR-0150：deriveFirstLoadView）', () => {
    expect(src).toContain('deriveFirstLoadView')
    expect(src).toContain("view === 'skeleton'")
    expect(src).toContain("view === 'error'")
    expect(src).toContain("view === 'empty'")
  })

  it('list-item 图片显式高度（原生 LynxView issue #140）', () => {
    expect(src).toMatch(/<SkeletonImage[^>]*height="14vw"/)
  })

  it('间距走 list 轴间距属性（spec §6.3 / ADR-0048；不得只用 item margin）', () => {
    expect(src).toContain('listMainAxisGap')
    expect(src).toContain('listCrossAxisGap')
  })

  it('KeepAlive include 与组件 name 配对（ADR-0049）', () => {
    expect(src).toContain("name: 'ranking'")
    expect(app).toContain("'ranking'")
  })

  it('受限条目保留并盖遮罩、不可点入（spec §5.6）', () => {
    expect(src).toContain('RestrictOverlay')
    expect(src).toContain('isAiRestricted')
    expect(src).toContain('onRowTap')
  })
})
