// NovelDetail 正文选中接线的源级守卫（spec docs/specs/app-lynx-novel-text-selection.md §Testing Decisions）。
// oracle：① 设备实证坑 1——`custom-context-menu` 等三条属性**必须静态字面量**，动态布尔绑定会被
// vue-lynx 吞掉（docs/research/lynx-text-selection-device-probe.md，FF2 vs GG 对照）；
// ② 索引即身份（spec 不变式 1）→ 节点 id 必须来自会话的 paragraphId；
// ③ 滚动收起走 BT 信号（MT 信号本构建不派发）→ list 必须 :scroll-event-throttle="0" + @scroll；
// ④ 工具栏在 root 内、list 之后（DOM 顺序即层序，ADR-0123 不铺全屏层）。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, 'NovelDetail.vue'), 'utf-8')
/** 去 HTML 注释与行注释后的代码本文（负向断言对象：约束说明本身会提到目标串） */
const code = source.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('NovelDetail · 正文选中引擎契约', () => {
  it('三条选中属性是静态字面量', () => {
    expect(code).toContain('text-selection="true"')
    expect(code).toContain('flatten="false"')
    expect(code).toContain('custom-context-menu="true"')
  })

  it('不得出现动态绑定形式（vue-lynx 会吞掉 → 引擎菜单不被替换）', () => {
    expect(code).not.toMatch(/:custom-context-menu=/u)
    expect(code).not.toMatch(/:text-selection=/u)
    expect(code).not.toMatch(/:flatten=/u)
  })

  it('节点 id 与选中事件都来自会话（索引即身份，禁手写模板串）', () => {
    expect(code).toContain(':id="selection.paragraphId(idx)"')
    expect(code).toContain(':bindselectionchange="selection.onSelectionChange"')
    expect(code).not.toMatch(/:item-key="`p-/u)
  })

  it('列表带 BT 滚动信号（throttle 0）供菜单收起', () => {
    expect(code).toContain(':scroll-event-throttle="0"')
    expect(code).toContain('@scroll="selection.onScroll"')
  })

  it('根 view 带 rootId（vw 校准基准 + 定位锚点双职责）', () => {
    expect(code).toContain(':id="selection.rootId"')
  })

  it('工具栏挂在 list 之后（DOM 顺序即层序）且不铺全屏层', () => {
    const listEnd = code.indexOf('</list>')
    const toolbar = code.indexOf('<TextSelectionToolbar')
    expect(listEnd).toBeGreaterThan(-1)
    expect(toolbar).toBeGreaterThan(listEnd)
    expect(code).not.toMatch(/<view v-if="selection\.view\.visible"[^>]*inset-0/u)
  })
})
