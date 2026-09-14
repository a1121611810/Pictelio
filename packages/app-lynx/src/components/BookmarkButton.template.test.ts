// ─── BookmarkButton.vue 双轨接线契约（T5 #534 / spec docs/specs/bookmark-tags.md D3 + ADR-0160 D4）───
// 仓库无 vue-lynx 渲染器（node 环境）——沿用「模板源码断言」约定（SearchSheet / NovelExportSheet
// 同款）：本文件锁**双轨接线形状**（快速收藏路径不变、长按通道、注入路径、动效重播出口），
// 计时与吞 tap 的行为语义由 useLongPress.test.ts 覆盖。
//
// 期望值出处（Oracle 溯源）：
// - 单击 = 快速收藏（乐观触发 + 爆发动效 + busy 锁）不变 = ADR-0112 + 本文件所在分支的
//   既有实现（下方断言即既有语句的逐字锚定，属 characterization 防线）；
// - 长按 500ms 唤出面板、同一次手势不得再走快速收藏 = spec D3 + webview
//   packages/app/src/routes/IllustDetail.tsx onBookmarkPointerDown/Up（独立第二来源）；
// - 面板保存的爆发动效 = webview handleBookmarkSaved（仅「新收藏」播，覆盖式编辑不播）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LONG_PRESS_MS } from '../composables/useLongPress'

const src = readFileSync(fileURLToPath(new URL('./BookmarkButton.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明会提到目标串，断言须落在代码本文上） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('BookmarkButton 快速收藏路径保持不变（ADR-0112）', () => {
  it('单击仍走 toggle + 爆发动效，且 busy 期间 no-op', () => {
    expect(code).toContain('if (bm.busy.value) return')
    expect(code).toContain('void bm.toggle()')
    expect(code).toContain('startBurst(target)')
    expect(code).toContain('const target = !bm.bookmarked.value')
  })

  it('爆发动效仍以快照驱动（失败静息回滚不播反向动画）', () => {
    expect(code).toContain("mode: target ? 'out' : 'in'")
    expect(code).toContain('lastTarget.value = target')
    expect(code).toContain('BOOKMARK_ANIMATION_MS')
  })
})

describe('BookmarkButton 长按通道（spec D3：长按开面板、吞掉同手势 tap）', () => {
  it('长按时长口径 = useLongPress 的 500ms 常量（与 webview 一致，不散写字面量）', () => {
    expect(LONG_PRESS_MS).toBe(500)
    expect(code).toContain("useLongPress({ onTrigger: () => emit('longPress') })")
  })

  it('吞 tap 判定在 toggle 之前（长按已开面板时同手势不得再快速收藏）', () => {
    const consumeAt = code.indexOf('longPress.consumeLongPress()')
    const toggleAt = code.indexOf('void bm.toggle()')
    expect(consumeAt).toBeGreaterThan(-1)
    expect(toggleAt).toBeGreaterThan(-1)
    expect(consumeAt).toBeLessThan(toggleAt)
  })

  it('触摸三件套按 enableLongPress 门控（列表卡片不启用手势面）', () => {
    expect(code).toContain('@touchstart="onTouchStart"')
    expect(code).toContain('@touchmove="onTouchMove"')
    expect(code).toContain('@touchend="onTouchEnd"')
    const guards = code.match(/if \(!props\.enableLongPress\) return/g) ?? []
    expect(guards).toHaveLength(3)
  })

  it('卸载时取消在途计时（组件销毁不留悬挂长按）', () => {
    expect(code).toContain('onBeforeUnmount(() => {')
    expect(code).toContain('longPress.cancel()')
  })
})

describe('BookmarkButton 状态机注入（T5：心形与面板共用一份状态）', () => {
  it('缺省自建实例（列表卡片路径零变化）——注入时用外部实例', () => {
    expect(code).toContain('props.mutation ??')
    expect(code).toContain('useBookmarkMutation({')
    expect(code).toContain('onChange: (bookmarked) => emit(\'change\', bookmarked)')
  })

  it('动效重播出口暴露给宿主（面板保存成功后经模板 ref 调用）', () => {
    expect(code).toContain('defineExpose({ playBurst })')
    expect(code).toContain('function playBurst(): void {')
    expect(code).toContain('startBurst(true)')
  })
})
