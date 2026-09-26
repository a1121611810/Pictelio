// ─── M3SegmentedButton.vue 结构契约（spec docs/specs/app-lynx-m3-segmented-button.md §4 / ADR-0190） ───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定
//（M3Switch.template.test.ts 同款，本组件测试直接对齐其结构）：
// 本文件锁**外部行为与平台约束**——公开接口边界、状态→类名映射、分隔线 N-1 规则、尺寸/颜色白名单。
//
// 期望值出处（Oracle 溯源）：
// - 视觉基线 = 迁移前 Me.vue 参照组（动图播放 L901 / 详情画质 L931）逐 class 一致（spec §2「零视觉创新」；
//   AI 组 L853 因漏改分隔线不作 oracle）；
// - 段高 h-[10.667vw] = M3 segmented button 40dp（@375 设计稿 1dp=0.267vw，40dp=10.667vw）；
// - 颜色 token = tokens.css M3 色板（secondary-container / surface-container-lowest / secondary-on-container /
//   surface-on / outline；按压 layer-pressed-on-surface）；
//
// 与 M3Switch.template.test.ts 的方向性差（spec §4.2 为依据，注释在对应 it 内写明）：
// - M3Switch 断言「a11y 缺席」（a11y 责任上推父级行）——本组件断言「a11y 在场」（每段独立焦点 + 静态 label，
//   分段控件无法照搬整行单焦点模式，ADR-0190 §决策「哲学对照」）；
// - M3Switch 断言「无 @tap」——本组件段 @tap 是选择事件的唯一入口，属接口责任。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./M3SegmentedButton.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('M3SegmentedButton 公开接口（options + v-model + disabled 三件套）', () => {
  it('SFC 泛型签名 generic="T extends string"（Vue 3.5 官方 SFC 特性，spec §7.5）', () => {
    expect(code).toContain('generic="T extends string"')
  })

  it('v-model 受控：defineModel<T>({ required: true })', () => {
    expect(code).toMatch(/defineModel<T>\(\{\s*required:\s*true\s*\}\)/)
  })

  it('props 导出 options: M3SegmentOption<T>[]（必填）与 disabled?: boolean（默认 false）', () => {
    expect(code).toMatch(/options\s*:\s*M3SegmentOption<T>\[\]/)
    expect(code).toMatch(/disabled\?\s*:\s*boolean/)
    expect(code).toMatch(/withDefaults\([\s\S]{0,200}\{\s*disabled:\s*false/)
    // M3SegmentOption 契约三字段（spec §4.2）
    expect(code).toMatch(/value\s*:\s*T/)
    expect(code).toMatch(/label\s*:\s*string/)
    expect(code).toMatch(/a11yLabel\s*:\s*string/)
  })

  it('不导出 icon / size / variant 等未声明 prop（spec §4.2 YAGNI 清单，防 drift）', () => {
    expect(code).not.toMatch(/\bicon\s*:/)
    expect(code).not.toMatch(/\bsize\s*:/)
    expect(code).not.toMatch(/\bvariant\s*:/)
  })
})

describe('M3SegmentedButton 内部纯函数 segmentClass（私有缝隙——正则提取函数体后真实求值）', () => {
  /** 从组件源码正则提取私有纯函数体并构造可调用函数（在 M3Switch body() 提取之上进一步求值，spec §5.2「测返回值」） */
  function buildFn(name: string): (selected: boolean, index: number) => string {
    const m = code.match(
      new RegExp('function\\s+' + name + '\\s*\\(([^)]*)\\)[^{]*\\{([\\s\\S]*?)\\n\\s*\\}'),
    )
    if (!m) throw new Error('源码中未找到私有纯函数 ' + name)
    // 剥离 TS 类型注解（new Function 只吃 JS：`(selected: boolean, index: number)` → `selected, index`）
    const params = m[1]
      .split(',')
      .map((p) => p.trim().split(':')[0].trim())
      .join(', ')
    // oxlint 放行：测试缝隙需对源码提取的函数体求值
    // eslint-disable-next-line no-new-func
    return new Function(params, m[2]) as (selected: boolean, index: number) => string
  }

  const BASE =
    'flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface'

  it('segmentClass(true, 0) 精确值 = 基础 + bg-secondary-container（选中段 0 无分隔线）', () => {
    expect(buildFn('segmentClass')(true, 0)).toBe(BASE + ' bg-secondary-container')
  })

  it('segmentClass(false, 0) 精确值 = 基础 + bg-surface-container-lowest（未选段 0 无分隔线）', () => {
    expect(buildFn('segmentClass')(false, 0)).toBe(BASE + ' bg-surface-container-lowest')
  })

  it('segmentClass(false, 1) 精确值 = 基础 + border-l border-l-outline + 未选 tone（分隔线在 tone 之前）', () => {
    expect(buildFn('segmentClass')(false, 1)).toBe(
      BASE + ' border-l border-l-outline bg-surface-container-lowest',
    )
  })

  it('segmentClass(true, 2) 精确值 = 基础 + border-l border-l-outline + 选中 tone', () => {
    expect(buildFn('segmentClass')(true, 2)).toBe(
      BASE + ' border-l border-l-outline bg-secondary-container',
    )
  })

  it('分隔线 N-1 规则归纳：n ∈ {2,3} 时段 0 恒无 border-l、段 ≥1 恒有（spec §2 关键机制）', () => {
    const segmentClass = buildFn('segmentClass')
    for (const n of [2, 3]) {
      const dividers = Array.from({ length: n }, (_, i) => segmentClass(false, i)).filter((c) =>
        c.includes('border-l'),
      )
      expect(dividers).toHaveLength(n - 1)
      expect(segmentClass(false, 0)).not.toContain('border-l')
      expect(segmentClass(true, n - 1)).toContain('border-l border-l-outline')
    }
  })
})

describe('M3SegmentedButton 内部纯函数 textClass（选中/未选文字色映射）', () => {
  it('textClass(true) = text-secondary-on-container；textClass(false) = text-surface-on', () => {
    const m = code.match(
      /function\s+textClass\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s*\}/,
    )
    if (!m) throw new Error('源码中未找到私有纯函数 textClass')
    // oxlint 放行：测试缝隙需对源码提取的函数体求值
    // eslint-disable-next-line no-new-func
    const textClass = new Function('selected', m[1]) as (selected: boolean) => string
    expect(textClass(true)).toBe('text-secondary-on-container')
    expect(textClass(false)).toBe('text-surface-on')
  })
})

describe('M3SegmentedButton 视觉基线字面量（迁移前参照组逐 class 一致，spec §2 零视觉创新）', () => {
  it('容器 4 class：flex flex-row gap-0 + 全圆角 + outline 描边 + overflow-hidden', () => {
    expect(code).toContain('flex flex-row gap-0')
    expect(code).toContain('rounded-[var(--md-shape-full)]')
    expect(code).toContain('border border-outline')
    expect(code).toContain('overflow-hidden')
  })

  it('段高 40dp = h-[10.667vw]，段文字 text-label-large', () => {
    expect(code).toContain('h-[10.667vw]')
    expect(code).toContain('text-label-large')
  })

  it('disabled 容器置灰 opacity-50', () => {
    expect(code).toContain('opacity-50')
  })

  it('色 token 全集：secondary-container / surface-container-lowest / secondary-on-container / surface-on / border-l-outline', () => {
    expect(code).toContain('bg-secondary-container')
    expect(code).toContain('bg-surface-container-lowest')
    expect(code).toContain('text-secondary-on-container')
    expect(code).toContain('text-surface-on')
    expect(code).toContain('border-l-outline')
  })
})

describe('M3SegmentedButton 段级 a11y 自持（与 M3Switch 相反——正向断言，spec §4.2 为依据）', () => {
  // M3Switch 是纯视觉控件（a11y 上推父级行，整行一个焦点）；分段控件每段是独立可聚焦元素、
  // label 各不相同、点击目标在段内——a11y 与选择事件只能组件自持（ADR-0190 §决策「哲学对照」）。
  it('每段绑 accessibility-element 常量（段级独立焦点）', () => {
    expect(code).toContain(':accessibility-element="A11Y_ELEMENT_ENABLED"')
    expect(code).toMatch(/import\s+\{\s*A11Y_ELEMENT_ENABLED\s*\}\s+from\s+'\.\.\/utils\/accessibility'/)
  })

  it('每段绑静态 a11y label（option.a11yLabel，注册表 value 原样透传）', () => {
    expect(code).toContain(':accessibility-label="option.a11yLabel"')
  })

  it('选择事件组件自持：段 @tap 调 select(value)，select 内 disabled 短路 + 写回 modelValue', () => {
    expect(code).toContain('@tap="select(option.value)"')
    expect(code).toMatch(/function\s+select\s*\(\s*value:\s*T\s*\)/)
    expect(code).toMatch(/props\.disabled\s*\|\|\s*value\s*===\s*modelValue\.value/)
    expect(code).toMatch(/modelValue\.value\s*=\s*value/)
  })
})

describe('M3SegmentedButton 禁手写 scoped CSS / 尺寸颜色白名单（防 characterization 漂移，spec §5.2）', () => {
  it('组件无 <style> 块（app-lynx Tailwind utility 硬性约定）', () => {
    expect(code).not.toContain('<style')
  })

  it('尺寸白名单：w-/h- 仅允许 10.667vw（段高 40dp）出现', () => {
    const sizes = Array.from(code.matchAll(/(?:w|h)-\[?(\d+(?:\.\d+)?(?:vw)?)\]?/g)).map(
      (m) => m[1],
    )
    const allowed = new Set(['10.667vw'])
    const unexpected = sizes.filter((s) => !allowed.has(s))
    expect(unexpected, `未预期的尺寸：${unexpected.join(',')}`).toEqual([])
  })

  it('颜色白名单：bg-/text-/border- 仅允许 M3 token 集出现（含按压态与 label-large 排版）', () => {
    const colors = Array.from(code.matchAll(/(?:bg|text|border)-([a-z-]+)/g)).map((m) => m[1])
    const allowed = new Set([
      'secondary-container',
      'surface-container-lowest',
      'secondary-on-container',
      'surface-on',
      'outline',
      'l', // border-l（border-l-outline 简写前缀，类串中带空格出现）
      'l-outline',
      'layer-pressed-on-surface',
      'label-large',
    ])
    const unexpected = colors.filter((s) => !allowed.has(s))
    expect(unexpected, `未预期的颜色/排版类：${unexpected.join(',')}`).toEqual([])
  })
})
