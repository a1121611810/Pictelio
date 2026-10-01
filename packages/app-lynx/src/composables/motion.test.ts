// ─── 动效唯一入口单测（issue #876；契约见 ADR-0211 决策 1 / 2 / 9）───
//
// 本文件只测**外部行为**：预设返回什么、减弱动效开启时返回什么。
// 不测内部实现（不 import 私有函数、不检查中间变量）。
//
// ── Oracle 溯源（禁自证：期望值不抄 motion.ts，一律现场解析或引用独立来源）───
//
// 1. **时长/曲线档位值** = 现场解析 `src/styles/tokens.css` 的 `--duration*` / `--motion-*`
//    定义，不在本文件抄数字。若 motion.ts 的档位引用了不存在的令牌 → 转红。
// 2. **`MOTION_DURATION_MS` 数值镜像** = 现场解析 tokens.css 的 `NNNms` 再取 N。
//    这条是关键：CSS 令牌在 Lynx 侧拿不到计算值（无 getComputedStyle），
//    故 JS 计时器必须有一份数字；它若与令牌漂移，**退场计时器会与动画不同源**
//    （ADR-0211 决策 3 要求二者同源），故必须逐档比对。
// 3. **档位选型**（谁用 fast / 谁用 medium / 退场用 accelerate）：
//    - 按压 fast+standard ← ADR-0211 决策 2 映射表第 1/2 行逐字规定
//    - 退场 fast+accelerate ← 决策 3「退场期间占位且不响应滚动，窗口越短代价越小」
//      + 曲线 accelerate = 加速离场（tokens.css 的 --motion-emphasized-accelerate）
//    - 入场 medium+decelerate ← 与既有 RefreshableList 的 item-rise 同档（迁移不换观感）
// 4. **R1/R2/R3 的降级形态** = `useReducedMotion` 头注的书面规则 + ADR-0211 决策 9 表：
//    R1 整条 transition 置 none（Tailwind 侧 = 不挂类）；R2 整条 animation 置 none；
//    R3 动效本身不生成、stagger 恒 0。**非从 motion.ts 的实现反推**。
// 5. **错峰步长 60ms** = 无 M3 官方值（M3 duration scale 无「延迟」档），
//    沿用既有实现值（RefreshableList 的 item-rise-2 延迟 60ms），属时序编排量。
// 6. **错峰上限** = ADR-0211 决策 5「只对首屏可见的前 N 项施加错峰」。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MOTION_CLASS,
  MOTION_DURATION,
  MOTION_DURATION_MS,
  MOTION_EASING,
  STAGGER_MAX_ITEMS,
  STAGGER_STEP_MS,
  enter,
  enterClass,
  exit,
  press,
  pressTransform,
  stagger,
  staggerDelay,
  useMotion,
  type MotionDurationKey,
} from './motion'
import type { MediaQueryListLike } from './useReducedMotion'

const TOKENS_CSS = readFileSync(
  fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
  'utf8',
)

/** tokens.css 里某 CSS 变量的定义值原文（oracle：现场解析，不抄） */
function tokenValue(name: string): string {
  return TOKENS_CSS.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? ''
}

/** 可控的 matchMedia 假实现：覆盖偏好开 / 关两条路径（与 useReducedMotion.test.ts 同款） */
function fakeMatchMedia(initial: boolean) {
  const state = { matches: initial }
  let listener: (() => void) | undefined
  const mql: MediaQueryListLike = {
    get matches() {
      return state.matches
    },
    addEventListener: (type: 'change', fn: () => void) => {
      if (type === 'change') listener = fn
    },
    removeEventListener: (type: 'change') => {
      if (type === 'change') listener = undefined
    },
  }
  return {
    mql,
    set(next: boolean) {
      state.matches = next
      listener?.()
    },
  }
}

describe('motion · 档位表（ADR-0211 决策 1：唯一入口取令牌，不自造数值）', () => {
  it('每个时长档引用的令牌都在 tokens.css 里有定义', () => {
    for (const [key, ref] of Object.entries(MOTION_DURATION)) {
      const name = ref.replace(/^var\(--(.*)\)$/, '$1')
      expect(name, `${key} 的引用 ${ref} 不是 var(--x) 形态`).not.toBe(ref)
      // Oracle = tokens.css 现场解析；令牌不存在则此处为空串 ⇒ 转红
      expect(tokenValue(name), `tokens.css 缺 --${name}（motion.ts 的 ${key} 档引用了它）`).not.toBe('')
    }
  })

  it('每个缓动档引用的令牌都在 tokens.css 里有定义', () => {
    for (const [key, ref] of Object.entries(MOTION_EASING)) {
      const name = ref.replace(/^var\(--(.*)\)$/, '$1')
      expect(name, `${key} 的引用 ${ref} 不是 var(--x) 形态`).not.toBe(ref)
      expect(tokenValue(name), `tokens.css 缺 --${name}（motion.ts 的 ${key} 档引用了它）`).not.toBe('')
    }
  })

  it('MS 数值镜像逐档等于 tokens.css 的同名令牌（退场计时器与动画必须同源）', () => {
    // 决策 3 的硬要求：两段式计时器时长「与退场动画同源」。同源 = 同一个令牌的数值。
    // 这条若漂移 ⇒ 计时器比动画长（遮罩滞留）或短（动画被截断），且无构建期信号。
    for (const [key, ms] of Object.entries(MOTION_DURATION_MS)) {
      const ref = MOTION_DURATION[key as MotionDurationKey]
      const tokenName = ref.replace(/^var\(--(.*)\)$/, '$1')
      const declared = tokenValue(tokenName)
      const parsed = Number(declared.replace(/ms$/, ''))
      expect(declared, `--${tokenName} 的值 ${declared} 不是 NNNms 形态，无法解析`).toMatch(/^\d+ms$/)
      expect(ms, `${key} 档的 MS 镜像应等于 --${tokenName}(${declared})`).toBe(parsed)
    }
  })

  it('档位集合无重复引用（防止两档指向同一令牌却各自登记 MS，掩盖改名）', () => {
    expect(new Set(Object.values(MOTION_DURATION)).size).toBe(Object.keys(MOTION_DURATION).length)
    expect(new Set(Object.values(MOTION_EASING)).size).toBe(Object.keys(MOTION_EASING).length)
  })
})

describe('motion · 预设一 入场（ADR-0211 决策 4 / 5）', () => {
  it('入场动画简写 = 动画名 + 时长令牌 + 曲线令牌 + both（走 var() 引用，不落数字）', () => {
    const preset = enter({ animationName: 'sheet-enter' })
    expect(preset.animation).toBe(
      'sheet-enter var(--durationMedium1) var(--motion-emphasized-decelerate) both',
    )
  })

  it('入场档位 = medium(250ms) + decelerate，与既有 item-rise 同档（迁移不换观感）', () => {
    // Oracle = tokens.css：medium 档 = --durationMedium1，decelerate = --motion-emphasized-decelerate
    expect(tokenValue('durationMedium1')).toBe('250ms')
    expect(tokenValue('motion-emphasized-decelerate')).toBe('cubic-bezier(0.05, 0.7, 0.1, 1)')
    const preset = enter({ animationName: 'sheet-enter' })
    expect(preset.animation).toContain(MOTION_DURATION.medium)
    expect(preset.animation).toContain(MOTION_EASING.decelerate)
  })

  it('类形态给的是字面量表里的整段类名（非拼接产物）', () => {
    expect(enterClass('enterSheet').className).toBe(MOTION_CLASS.enterSheet)
    expect(enterClass('enterListItem').className).toBe(MOTION_CLASS.enterListItem)
  })

  it('R2 降级：animation 整条置 none（含 infinite 循环，决策 9 表第 2 行）', () => {
    const preset = enter({ animationName: 'sheet-enter', reduced: true })
    expect(preset.animation).toBe('none')
  })

  it('R1 降级：类形态为空串（不挂类 = 挂 0ms 时长的同义反复）', () => {
    expect(enterClass('enterSheet', true).className).toBe('')
  })
})

describe('motion · 预设二 退场（ADR-0211 决策 3：两段式显隐）', () => {
  it('退场动画简写 = 动画名 + fast 令牌 + accelerate 令牌 + both', () => {
    const preset = exit({ animationName: 'sheet-exit' })
    expect(preset.animation).toBe(
      'sheet-exit var(--durationFast) var(--motion-emphasized-accelerate) both',
    )
  })

  it('退场时长取 fast 档（决策 3：退场期间占位且不响应滚动，窗口越短代价越小）', () => {
    const preset = exit({ animationName: 'sheet-exit' })
    expect(preset.animation).toContain(MOTION_DURATION.fast)
    expect(tokenValue('durationFast')).toBe('150ms')
  })

  it('两段式计时器与退场动画同源：holdMs === 该时长档的数值镜像', () => {
    // 决策 3 的核心断言。计时器从令牌取，不写独立字面量。
    for (const key of ['fast', 'normal', 'medium'] as const) {
      const preset = exit({ animationName: 'x', duration: key })
      expect(preset.holdMs, `duration=${key} 时 holdMs 应等于 MOTION_DURATION_MS.${key}`).toBe(
        MOTION_DURATION_MS[key],
      )
    }
  })

  it('R1 降级：holdMs 归零（否则关弹层卡住一段空窗期 —— 决策 3 点名的失效形态）', () => {
    // Oracle = 决策 3 原文「计时器时长必须从令牌读：降级开启时退场瞬间完成」
    const preset = exit({ animationName: 'sheet-exit', reduced: true })
    expect(preset.holdMs).toBe(0)
    expect(preset.animation).toBe('none')
    expect(preset.className).toBe('')
  })

  it('holdMs 覆盖值优先于档位默认值（消费方可显式指定更短的两段式窗口）', () => {
    expect(exit({ animationName: 'x', holdMs: 40 }).holdMs).toBe(40)
  })
})

describe('motion · 预设三 按压（ADR-0211 决策 2 映射表）', () => {
  it('颜色状态层：fast(150ms) + standard —— 决策 2 表第 1 行逐字规定', () => {
    const preset = press()
    expect(preset.className).toBe(
      'transition-colors duration-[var(--durationFast)] ease-[var(--motion-standard)]',
    )
    expect(preset.className).toContain(MOTION_DURATION.fast)
    expect(preset.className).toContain(MOTION_EASING.standard)
    expect(tokenValue('durationFast')).toBe('150ms')
  })

  it('alpha 档与预计算实色档同档：className 只有一个取值（决策 2 表第 2 行「分档属凭感觉」）', () => {
    // 决策 2 明确「与 alpha 档同档」⇒ 不允许出现第二个按压类名档位
    const pressClasses = Object.entries(MOTION_CLASS)
      .filter(([k]) => k.includes('press'))
      .map(([, v]) => v)
    expect(pressClasses).toHaveLength(1)
  })

  it('非颜色属性走 inline transition（`.transition-colors` 不含 opacity，挂类是静默失效）', () => {
    // 决策 2 表第 3 行：opacity 不在 .transition-colors 覆盖内 ⇒ 必须 inline
    const preset = press({ property: 'opacity' })
    expect(preset.transition).toBe('opacity var(--durationFast) var(--motion-standard)')
  })

  it('尺寸变化同样走 inline（决策 2 表末行，2 处 w/h）', () => {
    expect(press({ property: 'width' }).transition).toBe(
      'width var(--durationFast) var(--motion-standard)',
    )
    expect(press({ property: 'height' }).transition).toBe(
      'height var(--durationFast) var(--motion-standard)',
    )
  })

  it('未指定 property 时给颜色版（background-color 在 .transition-colors 覆盖内）', () => {
    expect(press().transition).toBe(
      'background-color var(--durationFast) var(--motion-standard)',
    )
  })

  it('R1 降级：类空串 + transition 置 none', () => {
    const preset = press({ reduced: true })
    expect(preset.className).toBe('')
    expect(preset.transition).toBe('none')
  })

  it('跟手 transform 走 inline 值；R3 下不生成（决策 9 的 R3 增量第 2 条）', () => {
    expect(pressTransform(0.96)).toBe('scale(0.96)')
    // R3：动效**本身**不生成，不是「不加过渡」——前庭反应与位移量成正比
    expect(pressTransform(0.96, true)).toBe('none')
  })
})

describe('motion · 预设四 错峰（ADR-0211 决策 5）', () => {
  it('步长默认 60ms（无 M3 官方值，沿用既有 item-rise-2 的延迟量）', () => {
    // Oracle = 既有实现 RefreshableList 的 `.item-rise-2` 延迟 60ms（时序编排量，非 MD3 值）
    expect(stagger().stepMs).toBe(60)
    expect(STAGGER_STEP_MS).toBe(60)
  })

  it('逐项延迟 = index × 步长', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(1)).toBe(60)
    expect(staggerDelay(2)).toBe(120)
  })

  it('超过错峰上限的项直接 0ms（决策 5：防长列表末项入场时间线性漂移）', () => {
    expect(STAGGER_MAX_ITEMS).toBeGreaterThan(0)
    expect(staggerDelay(STAGGER_MAX_ITEMS)).toBe(0)
    expect(staggerDelay(STAGGER_MAX_ITEMS + 5)).toBe(0)
    // 上限之内仍是逐项递增（证明上限不是「一律归零」）
    expect(staggerDelay(STAGGER_MAX_ITEMS - 1)).toBe((STAGGER_MAX_ITEMS - 1) * STAGGER_STEP_MS)
  })

  it('R3 降级：步长与逐项延迟恒 0（错峰本身即「运动」，只降时长无效）', () => {
    expect(stagger({ reduced: true }).stepMs).toBe(0)
    expect(staggerDelay(3, { reduced: true })).toBe(0)
  })

  it('步长可覆盖（消费方自定节拍）', () => {
    expect(stagger({ stepMs: 25 }).stepMs).toBe(25)
    expect(staggerDelay(4, { stepMs: 25 })).toBe(100)
  })
})

describe('motion · useMotion 组合入口（ADR-0211 决策 9：全量接入既有偏好）', () => {
  it('偏好关闭：四类预设全部给出完整形态', () => {
    const mm = fakeMatchMedia(false)
    const motion = useMotion({ matchMedia: () => mm.mql })
    expect(motion.reduced.value).toBe(false)
    expect(motion.pressColor.value.className).not.toBe('')
    expect(motion.pressColor.value.transition).not.toBe('none')
    expect(motion.enterSheet.value.animation).not.toBe('none')
    expect(motion.exitSheet.value.holdMs).toBeGreaterThan(0)
    expect(motion.staggerStepMs.value.stepMs).toBeGreaterThan(0)
    motion.dispose()
  })

  it('偏好开启：R1/R2/R3 三条规则各自落到对应预设', () => {
    const mm = fakeMatchMedia(true)
    const motion = useMotion({ matchMedia: () => mm.mql })
    expect(motion.reduced.value).toBe(true)
    // R1 过渡：状态层不挂类
    expect(motion.pressColor.value.className).toBe('')
    // R2 关键帧：整条 animation 置 none
    expect(motion.enterSheet.value.animation).toBe('none')
    expect(motion.enterListItem.value.animation).toBe('none')
    // R1 侧增量：退场计时器同步归零（决策 9 增量第 1 条）
    expect(motion.exitSheet.value.holdMs).toBe(0)
    // R3 弹性与错峰：步长恒 0
    expect(motion.staggerStepMs.value.stepMs).toBe(0)
    expect(motion.staggerDelay(2)).toBe(0)
    motion.dispose()
  })

  it('运行中切换系统偏好：预设随偏好更新（computed 而非 setup 期快照）', () => {
    // Oracle = useReducedMotion 头注「监听 change 运行中切换生效」；
    // 若 useMotion 在 setup 期求值快照，这条会转红 ⇒ 正是它要防的回归。
    const mm = fakeMatchMedia(false)
    const motion = useMotion({ matchMedia: () => mm.mql })
    expect(motion.exitSheet.value.holdMs).toBeGreaterThan(0)
    mm.set(true)
    expect(motion.exitSheet.value.holdMs).toBe(0)
    expect(motion.pressColor.value.className).toBe('')
    mm.set(false)
    expect(motion.exitSheet.value.holdMs).toBeGreaterThan(0)
    expect(motion.pressColor.value.className).not.toBe('')
    motion.dispose()
  })

  it('opacity / 尺寸两档走 inline，不复用颜色档的类名载体', () => {
    // 决策 2 的分载体要求：判据须查载体而非「有没有 transition」
    const mm = fakeMatchMedia(false)
    const motion = useMotion({ matchMedia: () => mm.mql })
    expect(motion.pressOpacity.value.transition.startsWith('opacity ')).toBe(true)
    expect(motion.pressSize.value.transition.startsWith('width ')).toBe(true)
    expect(motion.pressColor.value.transition.startsWith('background-color ')).toBe(true)
    motion.dispose()
  })
})
