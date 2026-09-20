// ─── M3Switch.vue 结构契约（spec docs/specs/app-lynx-m3-switch.md §4 / ADR-0179） ───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定
//（SettingsEndpoint.template.test.ts / BookmarkPanel.template.test.ts 同款）：
// 本文件锁**外部行为与平台约束**——M3 几何尺寸、状态→类映射、动效。
//
// 期望值出处（Oracle 溯源）：
// - 5 个 M3 尺寸常量 = Material Design 3 spec v0.192：track 52×32dp = 13.867×8.533vw（@375 设计稿 1dp=0.267vw，
//   32dp=8×0.267vw=8.533vw → Tailwind `w-8` 字面量等价）、thumb 24dp=6.4vw ON / 16dp=4.267vw OFF / 28dp=7.467vw pressed；
// - 4 个颜色 token = tokens.css §M3 核心色（--md-primary / --md-on-primary / --md-outline / --md-surface-container-highest）；
// - 2 个 motion token = tokens.css §M3 动画（--durationNormal=200ms / --motion-standard=cubic-bezier(0.2,0,0,1)）；
//
// 契约边界（spec §4.2 / ADR-0179 §决策）：
// - M3Switch 是**纯视觉开关控件**，仅承载 M3 几何/颜色/动效。a11y 注入与 `@tap` 翻转事件责任**留在父级
//   `<view>` 行容器**——行级 a11y 注册表 key + `@tap=toggleFn` 统一绑定，避免与 M3Switch 自身 a11y 双暴露
//   导致 TalkBack 双重播报；行级 `@tap` 也保留「点击行内任意位置（含文字标签）触发 toggle」的本仓历史 UX。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./M3Switch.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('M3Switch 公开接口（仅 checked 一个 prop）', () => {
  it('导出 checked: boolean 一个 prop', () => {
    // props 形态：defineProps<{ checked: boolean }>() 或等价声明
    expect(code).toMatch(/checked\s*:\s*boolean/)
  })

  it('不导出 ariaLabel / accessibilityLabel / label 等 a11y 字符串 prop（a11y 责任在父级行）', () => {
    // 防止「给 M3Switch 加 a11y prop 让父级传 label」的 drift，a11y 边界硬定在父级行
    expect(code).not.toMatch(/ariaLabel\s*:\s*string/)
    expect(code).not.toMatch(/accessibilityLabel\s*:\s*string/)
    expect(code).not.toMatch(/label\s*:\s*string/)
  })
})

describe('M3Switch 内部实现（M3 spec v0.192 几何 + 颜色 + 动效）', () => {
  it('轨道尺寸 = M3 spec 52×32dp = 13.867×8.533vw', () => {
    expect(code).toContain('w-[13.867vw]')
    expect(code).toContain('h-[8.533vw]')
    expect(code).toContain('rounded-full')
  })

  it('轨道带 flex-shrink-0（防父行 flex-col 文字容器描述撑爆导致 track 塌陷到 w-8 h-8）', () => {
    // spec §1 实证：行容器含 `<view class="flex flex-col">` + 描述文字（auto-fallback 描述 > 40vw）时，
    // flex 默认 `flex-shrink: 1` 会让 track 被挤塌。`flex-shrink-0` 锁死主轴尺寸。
    expect(code).toContain('flex-shrink-0')
  })

  it('handle-container = 32×32（w-8 h-8，与轨道同高）', () => {
    expect(code).toMatch(/w-8\s+h-8/)
  })

  it('thumb ON = 24dp = 6.4vw + bg-primary-on', () => {
    expect(code).toContain('w-[6.4vw]')
    expect(code).toContain('h-[6.4vw]')
    expect(code).toContain('bg-primary-on')
  })

  it('thumb OFF = 16dp = 4.267vw + bg-outline', () => {
    expect(code).toContain('w-[4.267vw]')
    expect(code).toContain('h-[4.267vw]')
    expect(code).toContain('bg-outline')
  })

  it('thumb 按压态 = 28dp = 7.467vw（active: 前缀）', () => {
    expect(code).toContain('active:w-[7.467vw]')
    expect(code).toContain('active:h-[7.467vw]')
  })

  it('轨道 ON 态 = bg-primary + justify-end', () => {
    expect(code).toMatch(/bg-primary[\s\S]{0,40}justify-end/)
  })

  it('轨道 OFF 态 = bg-surface-container-highest + justify-start + border-outline', () => {
    expect(code).toMatch(/bg-surface-container-highest[\s\S]{0,80}justify-start[\s\S]{0,80}border-outline/)
  })

  it('OFF 轨道带 outline 边框 = 2dp = 0.533vw', () => {
    expect(code).toContain('border-[0.533vw]')
  })

  it('过渡用 motion token（durationNormal + motion-standard）', () => {
    expect(code).toContain('transition-colors')
    expect(code).toContain('duration-[var(--durationNormal)]')
    expect(code).toContain('ease-[var(--motion-standard)]')
  })
})

describe('M3Switch 不绑 a11y / 不发 tap event（防回归——责任在父级行）', () => {
  it('组件内部不绑 accessibility-element（避免与父级行双暴露）', () => {
    expect(code).not.toMatch(/accessibility-element=/)
  })

  it('组件内部不绑 :accessibility-label（避免与父级行双暴露）', () => {
    expect(code).not.toMatch(/accessibility-label=/)
  })

  it('组件内部无 @tap 绑定（@tap 责任在父级行，控件本身不消费）', () => {
    expect(code).not.toMatch(/@tap=/)
  })

  it('组件内部不导入 A11Y_ELEMENT_ENABLED 常量（无 a11y 责任）', () => {
    expect(code).not.toMatch(/A11Y_ELEMENT_ENABLED/)
  })

  it('组件内部无 defineEmits 调用（无 emit）', () => {
    expect(code).not.toMatch(/defineEmits/)
  })
})

describe('M3Switch 内部纯函数（私有缝隙——组件自测，不进公开接口）', () => {
  /** 抽私有纯函数体（剥离首尾外层括号/return 关键字，便于精确字符串断言） */
  function body(name: string): string {
    const m = code.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\s*\\}`))
    return m ? m[1] : ''
  }

  it('trackClass(true) 精确返回 "bg-primary justify-end"（独立 oracle：M3 spec ON 态）', () => {
    // spec §4.3 给出函数体原文可作为 oracle
    expect(body('trackClass')).toContain("'bg-primary justify-end'")
  })

  it('trackClass(false) 精确返回 "bg-surface-container-highest justify-start border-[0.533vw] border-outline"', () => {
    expect(body('trackClass')).toContain(
      "'bg-surface-container-highest justify-start border-[0.533vw] border-outline'",
    )
  })

  it('thumbClass(true) 精确返回 "w-[6.4vw] h-[6.4vw] bg-primary-on"（独立 oracle：M3 spec thumb ON 24dp）', () => {
    expect(body('thumbClass')).toContain("'w-[6.4vw] h-[6.4vw] bg-primary-on'")
  })

  it('thumbClass(false) 精确返回 "w-[4.267vw] h-[4.267vw] bg-outline"（独立 oracle：M3 spec thumb OFF 16dp）', () => {
    expect(body('thumbClass')).toContain("'w-[4.267vw] h-[4.267vw] bg-outline'")
  })
})

describe('M3Switch 禁止 inline 漂移（防回归）', () => {
  it('组件内部不存在 w-[13.867vw] 之外的「同尺寸不同值」（禁手抖改尺寸）', () => {
    // 把所有 w-[xxx] 与 h-[xxx] 拎出来集合，必须只含 13.867vw / 8.533vw / 6.4vw / 4.267vw / 7.467vw / 8 (=8.533vw)
    const sizes = Array.from(code.matchAll(/(?:w|h)-\[?(\d+(?:\.\d+)?(?:vw)?)\]?/g)).map((m) => m[1])
    const allowed = new Set(['13.867vw', '8.533vw', '6.4vw', '4.267vw', '7.467vw', '8'])
    const unexpected = sizes.filter((s) => !allowed.has(s))
    expect(unexpected, `未预期的尺寸：${unexpected.join(',')}`).toEqual([])
  })
})
