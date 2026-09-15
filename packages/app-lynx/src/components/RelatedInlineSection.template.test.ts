// RelatedInlineSection.vue 卡内展开段 源级防线（spec docs/specs/related-injection.md §5.2 v2 / ADR-0162）。
// 期望值出处（Oracle 溯源）：ADR-0162 决策（渲染缝从列表条目交织下沉为卡内条件段；
// 哑组件 props 进 emits 出，store 接线归宿主）；布局 = 头行（相关作品/收起）+ loading 骨架 /
// 2×2 网格（RELATED_GRID_SIZE=4，列宽 48.4vw 内 20vw 缩略图）。
// 防线性质：源级守卫——防「段内自读 store（破坏哑组件边界）/ 丢失 loading 骨架 / 直连 CDN URL」回归。
// 行为正确性由模拟器 / 真机闭环（T0 spike S1/S2 已过，2026-09-16）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  fileURLToPath(new URL('./RelatedInlineSection.vue', import.meta.url)),
  'utf8',
)
/** 去注释后的代码本文（负向断言对象；注释本身会提到旧写法——需剥离） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('RelatedInlineSection.vue 卡内展开段（ADR-0162）', () => {
  it('哑组件边界：row 经 props 注入，不自读 store', () => {
    expect(code).toMatch(/defineProps<\{[^]*?row: RelatedRow[^]*?\}>/)
    expect(code).not.toContain('useRelatedInjectionStore')
    expect(code).not.toContain('useSettingsStore')
  })

  it('loading 骨架与网格互斥双分支（骨架防卡高跳动）', () => {
    expect(code).toContain('v-if="row.loading"')
    expect(code).toMatch(/v-else class="flex flex-row flex-wrap gap-2 mt-2"/)
  })

  it('网格 = RELATED_GRID_SIZE 截断 + thumbUrl 代理路径（禁直连 CDN）', () => {
    expect(code).toContain('row.items.slice(0, RELATED_GRID_SIZE)')
    expect(code).toContain('thumbUrl(rel.image_urls)')
    expect(code).not.toMatch(/i\.pximg\.net/)
  })

  it('事件面：collapse / open(id) 上抛，无导航副作用', () => {
    expect(code).toContain("emit('collapse')")
    expect(code).toContain("emit('open', rel.id)")
    expect(code).not.toContain('navigate(')
    expect(code).not.toContain('recordAnchor')
  })
})
