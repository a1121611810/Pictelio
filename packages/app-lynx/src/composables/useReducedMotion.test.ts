// ─── 减弱动效偏好统一能力单测（T03 / issue #851；术语 glossary-md3-alignment「动效域」）───
//
// 覆盖票 #851 的两条验收路径：
//   ① composable 自身可测 —— 偏好开 / 关两条路径 + 运行中切换 + 无 matchMedia 降级（注入 matchMedia，
//      node 环境无 window 也不阻塞；「注入点存在」本身就是被测契约，缺了就测不了）；
//   ② 组件接入面 —— 全仓含动画组件是否都走统一能力（不靠 grep 人工核，靠断言钉死）。
//      「全仓」的口径 = **src/ 全树**，不是 monorepo 全体：动画资产只可能落在 .vue 里，
//      而 .vue 只存在于 src 下（android-host / website / scripts 无 .vue 动画资产）。
//      措辞与范围必须同口径（抬头即契约），范围本身由「组件接入面」describe 里的
//      「扫描面证据」用例逐条钉住——不靠这段注释自称。
//
// 期望值出处（Oracle 溯源，禁自证）：
// - 媒体查询串 `(prefers-reduced-motion: reduce)` = W3C Media Queries Level 5 标准媒体特征
//   `prefers-reduced-motion`（值 `reduce` / `no-preference`）；仓内既有实现取同一串
//   （收敛前的 GlobalFab.vue:27），本测试锁其为单一事实源。
// - 降级规则 R1/R2/R3 的形态来自 composable 头注的书面规则 + Material Design 3 motion 指引
//   （reduced motion 下动效应移除或替换为非运动形态，而非仅缩短时长），非从实现反推。
// - 组件清单 = `src/**` 内声明了 animation / transition / @keyframes 的 .vue 文件全集，
//   由扫描器当场枚举（断言非空 + 数量下界，防止正则失效导致全称断言静默恒真）。
import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REDUCED_MOTION_ANIMATION,
  REDUCED_MOTION_MEDIA_QUERY,
  REDUCED_MOTION_TRANSITION,
  useReducedMotion,
  type MediaQueryListLike,
} from './useReducedMotion'

const COMPONENTS_DIR = fileURLToPath(new URL('../components', import.meta.url))
/** 扫描根 = src/ 全树。**不是** components/ —— 见下方「组件接入面」抬头：pages/ 今天恰好零动画
 *  资产，但「恰好」不是契约，未来 pages 出现动画时按 components 口径扫就是静默漏检。 */
const SRC_ROOT = join(COMPONENTS_DIR, '..')

/** 可控的 matchMedia 假实现：记录查询串与 change 监听，供两条偏好路径与切换断言使用 */
function fakeMatchMedia(initial: boolean) {
  const state = { matches: initial }
  const queries: string[] = []
  let listener: (() => void) | undefined
  const mql: MediaQueryListLike = {
    get matches() {
      return state.matches
    },
    addEventListener: (type, fn) => {
      if (type === 'change') listener = fn
    },
    removeEventListener: (type) => {
      if (type === 'change') listener = undefined
    },
  }
  return {
    mql,
    queries,
    /** 模拟用户改系统偏好并派发 change */
    set(next: boolean) {
      state.matches = next
      listener?.()
    },
    get listening() {
      return listener !== undefined
    },
  }
}

describe('useReducedMotion —— 偏好关闭路径（默认动效原样保留）', () => {
  it('matches=false → 降级值全为空串（不覆盖组件原有声明）+ stagger 保持逐项错峰', () => {
    const media = fakeMatchMedia(false)
    const rm = useReducedMotion({ matchMedia: () => media.mql })
    expect(rm.reducedMotion.value).toBe(false)
    expect(rm.transitionStyle.value).toBe('')
    expect(rm.animationStyle.value).toBe('')
    expect(rm.staggerMs(0, 30)).toBe(0)
    expect(rm.staggerMs(3, 30)).toBe(90)
    rm.dispose()
  })

  it('用标准媒体查询串订阅一次（不重抄字面量）', () => {
    const media = fakeMatchMedia(false)
    useReducedMotion({ matchMedia: (q) => (media.queries.push(q), media.mql) }).dispose()
    expect(media.queries).toEqual(['(prefers-reduced-motion: reduce)'])
    expect(media.queries[0]).toBe(REDUCED_MOTION_MEDIA_QUERY)
  })
})

describe('useReducedMotion —— 偏好开启路径（动效真的停掉，不只是改时长）', () => {
  it('matches=true → R1 过渡整条置 none + R2 关键帧整条置 none（覆盖 infinite 循环动画）', () => {
    const media = fakeMatchMedia(true)
    const rm = useReducedMotion({ matchMedia: () => media.mql })
    expect(rm.reducedMotion.value).toBe(true)
    expect(rm.transitionStyle.value).toBe(REDUCED_MOTION_TRANSITION)
    expect(rm.animationStyle.value).toBe(REDUCED_MOTION_ANIMATION)
    // 「停掉」而非「变慢」：降级值是声明级 none，不带任何时长
    expect(rm.transitionStyle.value).not.toMatch(/\d/)
    expect(rm.animationStyle.value).not.toMatch(/\d/)
    rm.dispose()
  })

  it('R3 stagger 延迟归零（错峰本身即运动，降时长无效）', () => {
    const media = fakeMatchMedia(true)
    const rm = useReducedMotion({ matchMedia: () => media.mql })
    expect(rm.staggerMs(0, 30)).toBe(0)
    expect(rm.staggerMs(3, 30)).toBe(0)
    expect(rm.staggerMs(9, 30)).toBe(0)
    rm.dispose()
  })

  it('运行中切换系统偏好：change 事件驱动降级值随之翻转（订阅而非只读一次）', () => {
    const media = fakeMatchMedia(false)
    const rm = useReducedMotion({ matchMedia: () => media.mql })
    expect(media.listening).toBe(true)
    expect(rm.reducedMotion.value).toBe(false)
    media.set(true)
    expect(rm.reducedMotion.value).toBe(true)
    expect(rm.animationStyle.value).toBe(REDUCED_MOTION_ANIMATION)
    media.set(false)
    expect(rm.reducedMotion.value).toBe(false)
    expect(rm.animationStyle.value).toBe('')
    rm.dispose()
  })

  it('dispose 后解除 change 监听（组件卸载不留悬挂订阅）', () => {
    const media = fakeMatchMedia(true)
    const rm = useReducedMotion({ matchMedia: () => media.mql })
    expect(media.listening).toBe(true)
    rm.dispose()
    expect(media.listening).toBe(false)
    // 幂等：重复 dispose 不抛
    rm.dispose()
  })
})

describe('useReducedMotion —— 降级路径必须显式（禁静默降级）', () => {
  it('无 matchMedia：按「未开启」处理并 console.warn（不假装已尊重偏好）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rm = useReducedMotion({ matchMedia: undefined })
    expect(rm.reducedMotion.value).toBe(false)
    expect(rm.animationStyle.value).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    // 消息带模块前缀，便于线上按前缀定位
    expect(String(warn.mock.calls[0]?.[0])).toContain('[useReducedMotion]')
    warn.mockRestore()
  })

  it('MediaQueryList 缺 addEventListener：仍读到当前偏好，但运行中切换不生效并 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rm = useReducedMotion({ matchMedia: () => ({ matches: true }) })
    expect(rm.reducedMotion.value).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('[useReducedMotion]')
    rm.dispose()
    warn.mockRestore()
  })
})

// ─── 组件接入面：全仓含动画组件必须走统一能力 ───────────────────────────────

/** 递归列出 src 下 .vue / .ts（跳过测试文件与 .d.ts：负向断言允许出现目标字面量） */
function listSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...listSources(p))
    else if (/\.(vue|ts)$/.test(entry) && !/\.test\.ts$/.test(entry) && !entry.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** 源码去注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 扫描面 = 门禁实际枚举的 .vue 候选集（**过滤动画之前**）。
 *  单独具名，是因为「扫描范围」这个契约必须有一条断言直接钉住，而今天**钉不住的是 pages/**：
 *  pages 下 24 个 .vue、含动画资产 0 个（实测 2026-09-30），过滤后的名单天然不含 pages，
 *  于是三个名字锚点全落在 components/ 与 src 根上——把扫描根改回 components/ 再单独补上
 *  App.vue，这几个锚点照样全绿，而抬头仍写着「含 pages/」⇒ pages 静默退回盲区。
 *  候选面（过滤前）才是「范围」的直接可观测物：它随扫描根变化，与动画资产有无无关。 */
function animationCandidates(): Array<{ name: string; file: string }> {
  return listSources(SRC_ROOT)
    .filter((p) => p.endsWith('.vue'))
    // 名字统一用 `/` 分隔：`pages/` 前缀断言不能依赖运行平台的路径分隔符
    .map((p) => ({ name: relative(SRC_ROOT, p).split(sep).join('/'), file: p }))
}

/** 声明了动画资产的 .vue 文件（animation 声明 / transition 声明 / @keyframes 定义）。
 *  扫描面 = **src/ 全树**（经 animationCandidates，与「扫描面证据」用例同一个根），
 *  名字相对 SRC_ROOT 给出——`components/` 只是 src 下的一个子目录，收窄到它就是 fail-open：
 *  src 根的 App.vue 与 pages/** 全部落进盲区。 */
function animationComponents(): Array<{ name: string; file: string; code: string }> {
  return animationCandidates()
    .map((c) => ({ ...c, code: stripComments(readFileSync(c.file, 'utf8')) }))
    .filter((c) => /@keyframes\s|\banimation\s*:|\banimation-|transition\s*:|transition-[a-z]/.test(c.code))
}

/** 从某个 .vue 所在目录指向 useReducedMotion 的相对说明符。
 *  按**实际相对路径**算（而不是写死 `../composables/…`）：扫描面扩到 src 全树后，
 *  `src/App.vue` 在 src 根、说明符是 `./composables/…`，写死一种形态即漏检另一种。 */
function useReducedMotionSpecifierFor(file: string): string {
  const rel = relative(dirname(file), join(SRC_ROOT, 'composables', 'useReducedMotion'))
    .split(sep)
    .join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** 该组件是否接上了统一能力（import 说明符按上式逐文件推导） */
function isWired(c: { file: string; code: string }): boolean {
  return c.code.includes(`from '${useReducedMotionSpecifierFor(c.file)}'`)
}

describe('组件接入面：src/ 全树（含 pages/ 与 src 根 App.vue）的含动画组件走统一能力（单一事实源）', () => {
  it('抽取器非空 + 覆盖 src 根：确实扫到含动画的组件（下界与点名锚点防正则失效/范围收窄）', () => {
    const found = animationComponents()
    const names = found.map((c) => c.name)
    expect(found.length, `扫到的含动画组件：${names.join(', ')}`).toBeGreaterThanOrEqual(4)
    expect(names).toContain('components/GlobalFab.vue')
    expect(names).toContain('components/BookmarkButton.vue')
    // 范围锚点：App.vue 在 src 根、**不在 components/**。断言点名它 ⇒ 扫描面一旦收窄回
    // components/ 就当场转红（否则「全树」只存在于抬头里）。
    expect(names, '扫描面没覆盖 src 根（抬头声称 src/ 全树，实际只扫 components/）').toContain(
      'App.vue',
    )
  })

  it('扫描面证据：候选面覆盖 src 根与 pages/**（名字锚点钉不到 pages，只能钉过滤前的候选面）', () => {
    const names = animationCandidates().map((c) => c.name)
    // src 根：App.vue 与 composables/ 同层，不在 components/ 下（这一条纯收窄也能抓到）
    expect(names, '扫描面枚举不到 src 根').toContain('App.vue')
    // pages/：今天 24 个 .vue、含动画 0 个（实测 2026-09-30）⇒「pages 里有几个动画」这条
    // 判据当前为空集，**范围契约只能钉在过滤前的候选面**上。故意不写文件数下界：
    // 下界的职责是防正则失效（见上一条），范围防收窄靠「枚举得到」本身 + 点名锚点。
    expect(names, '扫描面枚举不到 pages/**（pages 退回盲区，抬头的「含 pages/」即失真）').toContain(
      'pages/Recommended.vue',
    )
    expect(names, '扫描面枚举不到 pages/**').toContain('pages/IllustDetail.vue')
    // 反向自查：pages 下的 .vue 确实在候选面里成批存在（不是碰巧命中一个名字）
    const pagesCount = names.filter((n) => n.startsWith('pages/')).length
    expect(pagesCount, `候选面里的 pages 文件数：${pagesCount}`).toBeGreaterThanOrEqual(2)
  })

  it('每个含动画组件都 import useReducedMotion（不允许再有自建 matchMedia 的第二份实现）', () => {
    const unwired = animationComponents()
      .filter((c) => !isWired(c))
      .map((c) => c.name)
    // 零豁免：差距分析 §2 #15 点名的 3 个未处理组件已全部接入（BookmarkButton / RefreshableList /
    // App.vue，三者的 import 说明符由 useReducedMotionSpecifierFor 各自推导）。
    // 曾存在的 RefreshableList.vue / App.vue 豁免名单已删除——豁免名单正是本票验收 2
    // 「只完成 1 个」长期不被发现的根因。
    expect(unwired, `未接入统一能力的含动画组件：${unwired.join(', ')}`).toEqual([])
  })

  it('已接入组件不得自建 matchMedia / 重抄媒体查询串（收敛为单一事实源）', () => {
    const selfBuilt = animationComponents()
      .filter(isWired)
      .filter((c) => /matchMedia\(|\(prefers-reduced-motion/.test(c.code))
      .map((c) => c.name)
    expect(selfBuilt, `仍在自建 matchMedia 的组件：${selfBuilt.join(', ')}`).toEqual([])
  })

  it('全仓 reduced-motion 媒体查询串只出现在 composable 一处（其余 matchMedia 用途不归本票）', () => {
    const holders = listSources(SRC_ROOT)
      .filter((p) => !/\.test\.ts$/.test(p))
      .filter((p) => readFileSync(p, 'utf8').includes('(prefers-reduced-motion'))
      .map((p) => relative(SRC_ROOT, p))
    // utils/darkMode.ts 的 matchMedia 是 prefers-color-scheme（暗色），不属本票
    expect(holders, `仍持有 reduced-motion 查询串的文件：${holders.join(', ')}`).toEqual([
      'composables/useReducedMotion.ts',
    ])
  })

  it('组件层零 matchMedia 调用（偏好只能经 composable 读取，不得绕过统一能力）', () => {
    // 口径披露：这一条**刻意留在 components/**，不随上方几条扩到 src 全树。
    // 因为 utils/darkMode.ts 在 src 根且调 matchMedia（prefers-color-scheme，合法且不属本票），
    // 扩到全树会立刻误报红。src 根与 pages/ 的等价保证由上一条（reduced-motion 查询串只在
    // composable 一处）承担——那是**全 src** 口径，不受本条范围限制。
    const callers = listSources(COMPONENTS_DIR)
      .filter((p) => /\.(vue|ts)$/.test(p) && !/\.test\.ts$/.test(p))
      .filter((p) => !p.endsWith('useReducedMotion.ts'))
      .filter((p) => /\.matchMedia\(/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(COMPONENTS_DIR, p))
    expect(callers, `组件层绕过 composable 直接调 matchMedia：${callers.join(', ')}`).toEqual([])
  })
})

describe('组件接入面：接入形态必须真的停掉动效（逐组件钉死，删接入即红）', () => {
  it('GlobalFab：环项 animation / 遮罩 animation / 展开 transition 三处走降级值 + 循环转圈受控', () => {
    const code = stripComments(readFileSync(join(COMPONENTS_DIR, 'GlobalFab.vue'), 'utf8'))
    expect(code).toMatch(/animation:\s*animationStyle\.value\s*\|\|/)
    expect(code).toContain('transition: transitionStyle.value ||')
    expect(code).toContain('staggerMs(i, 30)')
    // 忙态 infinite 转圈（fab-ring-spin）此前未被任何降级覆盖。
    // 图标位迁到 <AppIcon>（ADR-0208）后，主 FAB 只能带一个 :class，配色与旋转类必须
    // 合并，故门控从模板内联表达式移进脚本侧 fabIconClass computed——<script setup>
    // 内 ref 不自动解包，写法随之带 .value。语义不变：busy + 未展开 + 非减弱动效才转。
    expect(code).toMatch(
      /const fabIconClass = computed\([\s\S]*?view\.value\.isBusy && !view\.value\.isOpen && !reducedMotion\.value[\s\S]*?\}\)/
    )
    // 旋转类只挂在 spin 分支（未开启减弱动效时），关闭分支不得携带 fab-ring-spin
    expect(code).toContain("spin ? 'text-primary-on-container fab-ring-spin' : 'text-primary-on-container'")
    // 被门控的 infinite 动画本体确实存在于本组件（否则上面的门控无对象）
    expect(code).toMatch(/@keyframes fab-ring-spin/)
    // 时长已令牌化到 --durationExtraLong4（ADR-0209 决策 1 的取数纪律：MD3 时长走令牌），
    // 断言认的是「声明存在 + 时长走令牌」而非钉死 `1s` 字面量 —— 钉字面量会在令牌化
    // 后变成陈旧断言（它守的是「有对象」，不是「恰好 1 秒」）。
    // ⚠️ 期望值溯源：令牌名取自 tokens.css 的 --durationExtraLong4 定义，不在此处抄数值。
    expect(code).toMatch(
      /\.fab-ring-spin \{[\s\S]*?animation: fab-ring-spin var\(--durationExtraLong4\) linear infinite;/,
    )
    // 反向护栏：不得退回裸时长字面量（否则 MD3 时长档位纪律被绕过）
    expect(code).not.toMatch(/\.fab-ring-spin \{[\s\S]*?animation: fab-ring-spin \d/)
    // 旧的本地 matchMedia 实现已删除（不保留两份）
    expect(code).not.toContain('MediaQueryList')
  })

  it('BookmarkButton：偏好开启时不生成 state-layer 环节点（弹性动效不发生）', () => {
    const code = stripComments(readFileSync(join(COMPONENTS_DIR, 'BookmarkButton.vue'), 'utf8'))
    const startBurst = code.match(/function startBurst[\s\S]*?\n\}/)?.[0] ?? ''
    expect(startBurst).not.toBe('')
    // 环节点 push 之前先被 reducedMotion 门控（不是「生成后再藏起来」）
    const guardAt = startBurst.indexOf('if (reducedMotion.value) return')
    const pushAt = startBurst.indexOf('rings.value.push(')
    expect(guardAt).toBeGreaterThan(-1)
    expect(pushAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(pushAt)
    // 主心 spring pop 类同样门控（<script setup> 模板内 ref 自动解包，故无 .value）
    expect(code).toContain('animSeq > 0 && !reducedMotion ?')
  })

  it('M3Switch：整组 transition 类按偏好挂载（R1 = 时长归零 = 不挂）', () => {
    const code = stripComments(readFileSync(join(COMPONENTS_DIR, 'M3Switch.vue'), 'utf8'))
    expect(code).toMatch(/:class="\[reducedMotion \? '' : TRACK_MOTION_CLASS, trackClass\(checked\)\]"/)
    const motion = code.match(/const TRACK_MOTION_CLASS\s*=\s*\n?\s*'([^']+)'/)?.[1] ?? ''
    expect(motion).toBe(
      'transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]',
    )
  })

  it('GlassCard：偏好开启时弹性总闸断开（跟手位移本身不发生，不只是回弹过渡）', () => {
    const code = stripComments(readFileSync(join(COMPONENTS_DIR, 'GlassCard.vue'), 'utf8'))
    expect(code).toContain('const elasticOn = computed(() => props.elastic && !reducedMotion.value)')
    // 三个触摸入口全部走 elasticOn，props.elastic 不再被直接读
    const guards = code.match(/if \(!elasticOn\.value/g) ?? []
    expect(guards).toHaveLength(3)
    expect(code).not.toMatch(/if \(!props\.elastic/)
    expect(code).toContain('transitionStyle.value')
  })
})

// ─── T03 补齐的两家（#851 验收 2 的第 2/3 家 + 验收 6 反事实）────────────────────────
// 判据形态：源码断言（仓库无 vue-lynx 渲染器，node 环境只能读源码；沿用既有约定），
// 但断言对象是**接入链路本身**（统一能力 → 降级值 → 落到 CSS 的通道），
// 而不是 composable 自身——只测 composable 等于没测接入（#851 验收 6 明写）。
//
// 期望值出处（Oracle 溯源，非从实现反推）：
// - R2 降级形态 = composable 头注的书面规则（整条 animation 置 none，含 infinite 循环）
//   + Material Design 3 motion 指引（reduced motion 下移除/替换运动，而非缩短时长）；
// - 组件清单（RefreshableList 5 处 / App.vue 1 处）= 差距分析 §2 #15 逐个点名的资产数，
//   且两者都含 **infinite 循环**（fab-spin / shimmer）——循环动画对前庭障碍影响最大，
//   正是漏接风险最高的两处。
const REFRESHABLE_LIST_SRC = readFileSync(join(COMPONENTS_DIR, 'RefreshableList.vue'), 'utf8')
const APP_VUE_SRC = readFileSync(join(SRC_ROOT, 'App.vue'), 'utf8')

/** RefreshableList 未接上统一能力的原因清单（空 = 已接入）。判据只落在代码本文上。 */
function refreshableListUnwired(src: string): string[] {
  const code = stripComments(src)
  const out: string[] = []
  if (!/from '\.\.\/composables\/useReducedMotion'/.test(code)) out.push('未 import 统一能力')
  if (!/const \{ animationStyle \} = useReducedMotion\(\)/.test(code)) out.push('未取 R2 降级值 animationStyle')
  if (!/animationStyle\.value \? \{ animation: animationStyle\.value \} : \{\}/.test(code)) {
    out.push('motionStyle 未由 animationStyle 驱动（降级值到不了 CSS）')
  }
  // 5 个动画宿主：scrim / 刷新项 / 回顶项 / 扩展项 / fab-spin 承载 view
  const hosts = code.match(/:style="motionStyle"/g) ?? []
  if (hosts.length !== 5) {
    out.push(`:style="motionStyle" 绑定点 ${hosts.length} 处（应为 5：scrim / 刷新项 / 回顶项 / 扩展项 / fab-spin 承载 view）`)
  }
  return out
}

/** App.vue 骨架屏闸门未接上（或链路断开）的原因清单（空 = 已接入）。 */
function appShimmerUnwired(src: string): string[] {
  const code = stripComments(src)
  const out: string[] = []
  if (!/from '\.\/composables\/useReducedMotion'/.test(code)) out.push('未 import 统一能力')
  if (!/const \{ animationStyle \} = useReducedMotion\(\)/.test(code)) out.push('未取 R2 降级值 animationStyle')
  const varName = code.match(/const SHIMMER_MOTION_VAR = '([^']+)'/)?.[1] ?? ''
  if (!varName) out.push('闸门变量名常量缺失')
  // 降级值 → 根 <page> 内联变量（通道必须闭合，否则偏好开了也照播）
  if (!/const rootStyle = computed[\s\S]*?animationStyle\.value \? \{ \[SHIMMER_MOTION_VAR\]: animationStyle\.value \} : \{\}/.test(code)) {
    out.push('rootStyle 未按偏好注入闸门变量')
  }
  const pageTag = code.match(/<page[\s\S]*?>/)?.[0] ?? ''
  if (!/:style="rootStyle"/.test(pageTag)) out.push('根 <page> 未绑 :style="rootStyle"')
  // 根内联变量 → .shimmer 的 animation 声明（.shimmer 是全局类，15+ 处消费方无法就地降级）
  const decl = code.match(/\.shimmer \{[^}]*animation: ([^;]+);/)?.[1] ?? ''
  if (!decl) out.push('.shimmer 规则缺 animation 声明')
  if (decl && !/infinite/.test(decl)) out.push('.shimmer 动画已非 infinite 循环（资产形状变了，须重新评估 R2 目标）')
  if (varName && decl && !decl.includes(`var(${varName},`)) out.push(`.shimmer 未消费闸门变量 ${varName}`)
  return out
}

describe('RefreshableList 接入：5 处动画（含 infinite 循环 fab-spin）全部经统一能力降级', () => {
  it('链路闭合：import → animationStyle → motionStyle → 5 个动画宿主', () => {
    expect(refreshableListUnwired(REFRESHABLE_LIST_SRC)).toEqual([])
  })

  it('资产存在性：被门控的 5 个动画确实在本组件（否则门控无对象 = 假绿）', () => {
    const code = stripComments(REFRESHABLE_LIST_SRC)
    // ① infinite 循环（R2 的首要目标）：下拉刷新转圈
    expect(code).toMatch(/@keyframes fab-spin/)
    expect(code).toMatch(/\.fab-spin \{[^}]*animation: fab-spin var\(--durationExtraLong4\) linear infinite;/)
    // ② 遮罩淡入（该类还被 GlobalFab 复用 → 本组件是定义方）
    expect(code).toMatch(/@keyframes scrim-in/)
    expect(code).toMatch(/\.scrim-in \{[^}]*animation: scrim-in /)
    // ③ 菜单项浮出 ×3（item-rise 同一条 keyframes，三个错峰类）
    expect(code).toMatch(/@keyframes item-rise/)
    for (const cls of ['item-rise-1', 'item-rise-2', 'item-rise-extra']) {
      expect(code).toMatch(new RegExp(`\\.${cls} \\{[^}]*animation: item-rise `))
    }
    // 宿主元素确实带上了绑定（5 处，与 motionStyle 判据同数）
    expect(code.match(/:style="motionStyle"/g) ?? []).toHaveLength(5)
  })

  it('不得自建第二份偏好读取（收敛为单一事实源）', () => {
    const code = stripComments(REFRESHABLE_LIST_SRC)
    expect(code).not.toMatch(/matchMedia\(|\(prefers-reduced-motion/)
  })

  it('反事实：抽掉接入（去 import / 去动画宿主绑定）→ 判据当场转红', () => {
    const noImport = REFRESHABLE_LIST_SRC.replace(
      /import \{ useReducedMotion \} from '\.\.\/composables\/useReducedMotion'\n/,
      '',
    )
    expect(noImport, '改动没落到源码上，反事实无效').not.toBe(REFRESHABLE_LIST_SRC)
    expect(refreshableListUnwired(noImport)).toContain('未 import 统一能力')
    // 改回即恢复（防「判据恒红」的自欺）
    expect(refreshableListUnwired(REFRESHABLE_LIST_SRC)).toEqual([])

    const noHosts = REFRESHABLE_LIST_SRC.replace(/:style="motionStyle"/g, '')
    expect(noHosts, '改动没落到源码上，反事实无效').not.toBe(REFRESHABLE_LIST_SRC)
    expect(refreshableListUnwired(noHosts).join('|')).toContain('应为 5')
    expect(refreshableListUnwired(REFRESHABLE_LIST_SRC)).toEqual([])
  })
})

describe('App.vue 接入：骨架屏 shimmer（infinite 循环）经根 <page> 闸门降级', () => {
  it('链路闭合：import → animationStyle → 根 page 内联变量 → .shimmer 的 animation 声明', () => {
    expect(appShimmerUnwired(APP_VUE_SRC)).toEqual([])
  })

  it('.shimmer 的默认形态逐字保留在 var() 回退里（门闸失效 = fail-open，不让骨架屏集体失去动效）', () => {
    const code = stripComments(APP_VUE_SRC)
    expect(code).toMatch(/animation: var\(--shimmer-motion, shimmer 1\.5s linear infinite\);/)
    // 背景层（渐变 + background-size）不受门闸影响，骨架屏仍是可见的占位灰块
    expect(code).toMatch(/\.shimmer \{[\s\S]*?background: linear-gradient\(/)
    expect(code).toMatch(/background-size: 200% 100%;/)
  })

  it('反事实：抽掉接入（去 import / 断开根 page 注入 / .shimmer 不消费变量）→ 判据当场转红', () => {
    const noImport = APP_VUE_SRC.replace(
      /import \{ useReducedMotion \} from '\.\/composables\/useReducedMotion'\n/,
      '',
    )
    expect(noImport, '改动没落到源码上，反事实无效').not.toBe(APP_VUE_SRC)
    expect(appShimmerUnwired(noImport)).toContain('未 import 统一能力')
    expect(appShimmerUnwired(APP_VUE_SRC)).toEqual([])

    // 断开「根 page 注入」：偏好开了也到不了 .shimmer
    const noInject = APP_VUE_SRC.replace(
      "...(animationStyle.value ? { [SHIMMER_MOTION_VAR]: animationStyle.value } : {}),",
      '',
    )
    expect(noInject, '改动没落到源码上，反事实无效').not.toBe(APP_VUE_SRC)
    expect(appShimmerUnwired(noInject).join('|')).toContain('rootStyle 未按偏好注入闸门变量')
    expect(appShimmerUnwired(APP_VUE_SRC)).toEqual([])

    // .shimmer 不再消费闸门变量 = 形同未接入
    const noVar = APP_VUE_SRC.replace(
      'animation: var(--shimmer-motion, shimmer 1.5s linear infinite);',
      'animation: shimmer 1.5s linear infinite;',
    )
    expect(noVar, '改动没落到源码上，反事实无效').not.toBe(APP_VUE_SRC)
    expect(appShimmerUnwired(noVar).join('|')).toContain('未消费闸门变量')
    expect(appShimmerUnwired(APP_VUE_SRC)).toEqual([])
  })
})

