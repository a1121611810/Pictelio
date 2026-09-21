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

describe('BookmarkButton chip 容器与配色（spec docs/specs/bookmark-color.md §E「Dark Glass」）', () => {
  it('外层 view 加 chip 容器类 + 圆角全圆 + 状态绑定修饰类', () => {
    // 最外层 view 用 bookmark-chip 类 + rounded-full；状态路由用 is-bookmarked 修饰
    expect(code).toContain('bookmark-chip ')
    expect(code).toContain('rounded-full')
    expect(code).toContain("bm.bookmarked.value ? 'is-bookmarked' : ''")
  })

  it('chip 容器必须 hug content（self-start 挡 column flex 父容器的横向拉伸）', () => {
    // 真因与 oracle（2026-09-21 web-core 实测 evidence，非推测）：
    //  - Lynx 的 view 默认 display:flex / flex-direction:column / align-items:normal(≈stretch)
    //    → chip 作为 flex item 被横向 stretch（实测 chip 宽 1116px == 父 `mt-5` 宽 1116px）；
    //  - display: inline-flex 无效：flex item 的 display 被 blockify 成 flex（CSS Flexbox §4.1），
    //    实测 computed display === "flex"、宽不变 → 该声明不可能修好拉伸（前一轮误修坑）；
    //  - self-start = align-self: flex-start（@lynx-js/tailwind-preset 的 alignSelf 插件提供，
    //    构建产物 .self-start { align-self: flex-start } 实证）→ 实测 150px = 内容宽；
    //  - 同款先例：NovelIntro.vue:187 AI 徽章用 self-start 挡 scrim 内拉伸。
    expect(code).toMatch(/bookmark-chip[\s"][^"]*\bself-start\b/)
    // 反向锁 1：preset 不提供 .inline-flex utility —— 加这个类名等于空类
    expect(code).not.toMatch(/bookmark-chip[\s"][^"]*\binline-flex\b/)
    // 反向锁 2：.bookmark-chip 规则里不得再出现任何 display 声明（inline-flex 兜底已被证伪）
    expect(code).not.toMatch(/\.bookmark-chip\s*\{[^}]*display:/)
  })

  it('未收藏主心走 inverse-on-surface（chip 上的前景色，非 outline 灰）', () => {
    expect(code).toContain("bm.bookmarked.value ? 'text-tertiary-on' : 'text-inverse-on-surface'")
  })

  it('未收藏计数走 inverse-on-surface（与心形同调，保证 chip 内可读）', () => {
    expect(code).toContain("bm.bookmarked.value ? 'text-tertiary-container' : 'text-inverse-on-surface'")
  })

  it('严禁再使用 error 色表达「已收藏」（语义错位 = 「危险」而非「喜欢」）', () => {
    // 原 text-error / border-error 表达收藏色被 chip 化取代；保留只在错误文案位置
    // 断言：主心与环上不再出现 text-error/border-error（仅错误文案出现 text-error，该行单独走）
    const heartColorClasses = code.match(/'text-[a-z-]+'/g) ?? []
    // 主心 heart 必须从 {text-tertiary-on, text-inverse-on-surface} 中选，禁出现 text-error
    expect(heartColorClasses).not.toContain("'text-error'")
    // ring 类同名断言：不再出现 border-error
    expect(code).not.toMatch(/['"]border-error['"]/)
  })

  it('ring 颜色不靠内联 class 绑定，靠 chip 状态 cascade 控制（避免开关错位）', () => {
    // ring view 只绑动画类 bookmark-ring-out/in；颜色交给 <style> 里的 .bookmark-chip[.is-bookmarked] .bookmark-ring-*
    expect(code).toContain("r.mode === 'out' ? 'bookmark-ring-out' : 'bookmark-ring-in'")
    // 不出现 ring 内联 border-color 类
    expect(code).not.toMatch(/'border-(on-tertiary|inverse-on-surface|error|outline)'/)
  })

  it('ring 颜色引用真实存在的 M3 token（--md-inverse-on-surface；禁自造名静默失效）', () => {
    // 真实缺陷（2026-09-21 code-review Standards F1）：曾写成 var(--md-on-inverse-surface) ——
    // 该名字全仓未定义（tokens.css 定义的是 --md-inverse-on-surface）→ 无 fallback 的 var() 在
    // computed-value 阶段失效，border-color 退为 currentColor，环色错误但单测全绿。
    expect(code).toContain('border-color: var(--md-inverse-on-surface)')
    expect(code).not.toContain('var(--md-on-inverse-surface)')
  })

  it('chip 背景走 M3 token 实色（避开 lynx backdrop-filter platform fact）', () => {
    // CSS 规则 .bookmark-chip 用 var(--md-inverse-surface)、is-bookmarked 用 var(--md-tertiary)
    expect(code).toContain('.bookmark-chip {')
    expect(code).toContain('background-color: var(--md-inverse-surface)')
    expect(code).toContain('.bookmark-chip.is-bookmarked {')
    expect(code).toContain('background-color: var(--md-tertiary)')
  })

  it('chip 背景严禁使用 rgba + backdrop-filter（lynx 原生不支持 backdrop-filter，C8 platform fact）', () => {
    // 检测代码本体中的「使用 backdrop-filter 为 chip 设置背景」的形态。
    // 这种形态 web-core 预览可见，但原生 lynx 会表现为透明（platform fact）。
    // 只检 CSS 生产代码本体（去注释后的 code），避开本页注释误命中。
    expect(code).not.toMatch(/\.[\w-]+\s*\{[^}]*backdrop-filter[^}]*\}/)
    expect(code).not.toMatch(/backdrop-filter:\s*blur/)
  })
})
