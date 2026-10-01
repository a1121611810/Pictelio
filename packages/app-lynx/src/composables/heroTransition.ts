// ─── 缩略图 → 大图连续性转场（hero transition，双向）───
// 契约：ADR-0211 决策 12。**本文件是该机制的唯一实现处**（页面只接线，不写几何/时序）。
//
// ── 为什么「插值盒子」而不是「插值 transform: scale()」（决策 12 机制 2 的实现口径）───
// 缩略图盒与 hero 盒的**宽高比不同**。若用 `transform: scale(sx, sy)` 做插值，transform 作用于
// 已排版好的子树 ⇒ 非等比缩放会把**已经按 aspectFill 裁好的位图再拉伸一次** = 变形，正是决策 12
// 禁止的形态。正确形态是让**布局盒本身**变形（width/height 逐帧变化），盒内的
// `<image mode="aspectFill">` 每帧重新等比裁切 ⇒ 画面不拉伸、只换裁切窗口。
// ⇒ 比例差由 **`mode="aspectFill"`**（Lynx 对 CSS `object-fit` 的替代，见 CoverImage.vue 头注
//   与 dist/main.lynx.bundle 里实存的 `aspectFill` 字面量）吸收，不是由 object-fit 样式吸收。
//
// ── 动画通道：只过渡 transform / width / height 三条（本仓已实证的通道）───
// 这三条在生产代码里都已被 ADR-0211 决策 1/2 消费并标注「已验证」：
//   · `transform`  → GlassCard.vue:51（跟手回弹，`transition: transform var(--durationNormal) …`）
//   · `width`/`height` → M3Switch.vue:33（`press({property:'width'})` + `press({property:'height'})`）
//   · `opacity`     → RankingEntryCard.vue:164
// 刻意**不**过渡 `left` / `top`：那是定位属性，本仓无任何实证消费点，而 ADR-0210 的纪律是
// 「未验证的路径要么取证后再用、要么不用」。
// ⇒ 覆盖层用**静态 `left/top` 落在起点**（不参与过渡），用 `transform: translate(dx,dy)` 走到终点，
//   同时 width/height 一起变。三条通道全是已验证面。
//
// ── 时序：两拍起手 + 计时器收尾（无 transitionend，ADR-0111）───
// CSS 过渡要求「起点值先被排版一次，终点值后到」才有插值。本栈无 getComputedStyle 可强制回流
// ⇒ 用两拍 rAF（第一拍让 from 态提交，第二拍切 to 态）。from 态恰好盖在被点的缩略图上 ⇒ 多出的
// 一两帧在观感上是**连续的**（同一张图在同一位置），不构成闪帧。
// 收尾用与动画**同源**的计时器（同一个 duration 档的数值镜像），与 routeTransition / useSheetDismiss
// 的两段式协议同款。
//
// ── 逐页能力削减（决策 12 的「KeepAlive 造成的逐页能力差」）───
// 判定**不硬编码** App.vue 的 KeepAlive include 名单（会随名单改动腐化），而是**问 Vue 自己的
// 生命周期**：`onDeactivated` 触发 = 本实例在 push 详情时只是停用、没被销毁 ⇒ 返回方向可用；
// 未触发而实例被重建（新建实例的局部标记恒为 null）⇒ 返回方向降级为普通转场。
// ⇒ 不在 KeepAlive 名单内的流（following / user-home / bookmarks / watchlist / watchLater /
//   tag-neighbors）自动是「前进有连续性、返回退回普通转场」，与决策 12 登记一致。
import { computed, onActivated, onDeactivated, ref, type ComputedRef, type Ref } from 'vue'
import { measureRects, type BoundingRect, type SelectorQuery, type SelectorQueryFactory } from '../primitives/measureRects'
import { MOTION_DURATION, MOTION_DURATION_MS, MOTION_EASING, useMotion, type UseReducedMotionOptions } from './motion'
import { ROUTE_TRANSITION_DURATION, ROUTE_TRANSITION_EASING } from './routeTransition'

// ───────────────────────────────────────────────────────────────────────────
// 元素 id 约定
// ───────────────────────────────────────────────────────────────────────────

/** 列表侧缩略图盒的稳定 id 前缀（决策 12 机制 1「图片挂稳定 id」）。 */
const HERO_SOURCE_ID_PREFIX = 'pictelio-hero-source-'

/** 缩略图盒 id：按作品 id 派生 ⇒ 同一张图在列表里位置任意都能被点名测量。 */
export function heroSourceId(illustId: number): string {
  return HERO_SOURCE_ID_PREFIX + illustId
}

/** 页面根 view 的 id：hero 覆盖层的 `absolute` 锚点 + 视口↔页面坐标换算基准。 */
export const HERO_ROOT_ID = 'pictelio-hero-root'

// ───────────────────────────────────────────────────────────────────────────
// 计时参数
//
// ⚠️ 下面的毫秒数**都是超时/截止时间，不是动效时长**（动效时长的唯一入口是 motion.ts）。
//   本仓同型先例：`utils/lynxSelectionEngine.ts` 的 CLEAR_TIMEOUT_MS = 1500。
// ───────────────────────────────────────────────────────────────────────────

/** 单次矩形测量的引擎超时（与 measureRects 自身默认同档）。 */
const HERO_MEASURE_TIMEOUT_MS = 1500

/** 详情页等待「点图时已发起」的那次测量的截止时间。
 *  超时即降级：宁可没有连续性，也不要一个空白矩形在屏幕上放大（决策 12 机制 4）。 */
const HERO_SOURCE_DEADLINE_MS = 400

// ───────────────────────────────────────────────────────────────────────────
// 降级原因（可追溯：每个降级都会带模块前缀落一条日志，禁静默降级）
// ───────────────────────────────────────────────────────────────────────────

export type HeroDegradeReason =
  /** 没有在途的前进测量（深链直达 / 非列表入口 / 上一次已被消费） */
  | 'no-source'
  /** 在途矩形属于另一张作品（守卫重定向、连点后落到别的 id） */
  | 'id-mismatch'
  /** 被更晚的一次点击覆盖（同一 tick 内两次 tap） */
  | 'stale-generation'
  /** 测量失败 / 超时 / 未返回该元素矩形（measureRects 自身已 warn） */
  | 'measure-failed'
  /** 等测量超过截止时间仍未落定 */
  | 'deadline'
  /** 减弱动效开启：R1 = 过渡本身不生成，不是「放慢」 */
  | 'reduced-motion'
  /** 源页不在 KeepAlive 名单内（实例被销毁，返回时原图已不存在） */
  | 'not-cached'
  /** 列表页没有提供缩略图地址解析器（返回方向无从取图） */
  | 'no-source-image'
  /** 矩形非法（尺寸非正 / 非有限 / 起点不在视口内） */
  | 'invalid-rect'
  /** 动画途中被取消（提前返回、再次导航、组件卸载） */
  | 'cancelled'

function degrade(reason: HeroDegradeReason, detail?: string): null {
  // ⚠️ 首个参数必须是**完整单条中文字面量且直接作为 console 实参**：
  // `tests/hardcode-gate.test.ts` 只豁免「字面量的父节点就是 console 调用」这一种形态
  // （同款写法见 useImmersiveSystemBars.ts），中文一旦落进拼接表达式就不在豁免面内。
  // 变化部分（原因码 / 细节）走第二、三实参——它们是变量不是字面量，门禁不扫。
  if (detail === undefined) console.debug('[heroTransition] 降级为普通路由转场', reason)
  else console.debug('[heroTransition] 降级为普通路由转场', reason, detail)
  return null
}

// ───────────────────────────────────────────────────────────────────────────
// 矩形工具
// ───────────────────────────────────────────────────────────────────────────

/** 矩形是否可用于插值：尺寸为正、值有限。
 *  ⚠️ `top < 0` 判为不可用：详情页被用户滚动过之后 hero 盒已在视口上方，
 *    从那里起飞会看到一张图凭空出现在屏幕顶外侧再落回来。 */
export function isPlausibleHeroRect(rect: BoundingRect | null | undefined): rect is BoundingRect {
  if (!rect) return false
  const nums = [rect.left, rect.top, rect.width, rect.height]
  if (!nums.every((n) => Number.isFinite(n))) return false
  if (rect.width <= 0 || rect.height <= 0) return false
  return rect.top >= 0
}

/** 矩形是否与页面根的横向范围有任何重叠。
 *  横向轮播（CarouselSwiper）的非当前页在屏幕外，`boundingClientRect` 会给出屏外坐标
 *  ⇒ 那不是「用户点的那张图」，用它起飞会让一张图从屏幕外飞入。 */
function overlapsHorizontally(rect: BoundingRect, root: BoundingRect): boolean {
  return rect.left < root.width && rect.left + rect.width > 0
}

/** 全局 lynx 取值（组件内同款写法；web-core 无 createSelectorQuery → undefined ⇒ 降级） */
function defaultQueryFactory(): SelectorQuery | undefined {
  const lynxGlobal = typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  return lynxGlobal?.createSelectorQuery?.() as unknown as SelectorQuery | undefined
}

export interface HeroMeasureOptions {
  /** 查询工厂（默认取全局 lynx；单测注入假实现） */
  createQuery?: SelectorQueryFactory
  /** 引擎超时 */
  timeoutMs?: number
}

/** 单元素测量：成功给矩形，失败给 null（失败路径由 measureRects 自身 warn）。 */
async function measureOne(elementId: string, options: HeroMeasureOptions): Promise<BoundingRect | null> {
  const result = await measureRects(
    [elementId],
    options.createQuery ?? defaultQueryFactory,
    options.timeoutMs ?? HERO_MEASURE_TIMEOUT_MS,
  )
  return result.ok ? (result.rects[elementId] ?? null) : null
}

/** 超时哨兵：与 `null`（测量失败）区分开，两者是不同的降级原因。 */
const DEADLINE = Symbol('hero-deadline')

/** 给在途测量套一个截止时间：跨线程异步测量不能无限期挂住转场。 */
function withDeadline<T>(promise: Promise<T>, deadlineMs: number): Promise<T | typeof DEADLINE> {
  return new Promise<T | typeof DEADLINE>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(DEADLINE)
    }, deadlineMs)
    void promise.then((value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    })
  })
}

// ───────────────────────────────────────────────────────────────────────────
// 模块级在途状态（列表侧写、详情页读；返回方向反过来）
// ───────────────────────────────────────────────────────────────────────────

interface PendingMeasure {
  illustId: number
  /** 每次发起自增：用于识别「已被更晚一次点击覆盖」 */
  generation: number
  promise: Promise<BoundingRect | null>
}

let _source: PendingMeasure | null = null
/** 详情页活着时存下的 hero 盒（settled 位置）：返回方向的插值起点，**同步**可取 */
let _settledHero: { illustId: number; rect: BoundingRect } | null = null
/** 返回意图已就位（armed）：由详情页返回守卫在历史栈 pop **之前**置位 */
let _armed: { illustId: number; rect: BoundingRect } | null = null
let _generation = 0

/**
 * 列表侧发起（**不 await**，调用方紧接着导航——决策 12 机制 1「不给导航加可见延迟」）。
 *
 * 竞态说明：测量跨线程异步（ADR-0149），导航一定先于结果落定。这里把 promise 存进模块级
 * 在途态，由详情页在挂载时消费；`generation` 保证「后一次点击覆盖前一次」不会让先到的
 * 详情页拿到一张不属于它的图。
 */
export function beginHeroSource(illustId: number, options: HeroMeasureOptions = {}): void {
  const generation = ++_generation
  _source = { illustId, generation, promise: measureOne(heroSourceId(illustId), options) }
}

/**
 * 详情页**活着时**存下自己的 hero 盒（返回方向的插值起点）。
 *
 * ⚠️ 为什么是「活着时存」而不是「返回前再测」——真机实测（2026-10-02，emulator-5554）：
 * 返回那一刻发起 `measureRects`，回调**不会**在导航后 240ms 内落定（详情页正在被销毁，
 * UI 线程的结果回来得太晚）⇒ 前进正常、返回永远等不到起点。
 * 而 hero 盒的位置在数据落定后就是确定的（本页自己已经为前进方向测过一次），
 * 存下来即可 ⇒ **返回路径零等待、零跨线程依赖**。
 * 详情页被用户滚动过时不再保证这个位置仍对应屏幕上的那张图，由调用方决定是否放弃（见 IllustDetail）。
 */
export function cacheHeroRect(illustId: number, rect: BoundingRect): void {
  if (!isPlausibleHeroRect(rect)) {
    degrade('invalid-rect', 'cache')
    return
  }
  _settledHero = { illustId, rect }
}

/**
 * 返回意图置位（详情页返回守卫调用，**同步**，不测量）。
 * 存下的矩形与当前作品对不上（深链直达 / 换作品 / 从未存过）⇒ 不置位，返回方向自然降级。
 */
export function armHeroBack(illustId: number): void {
  if (_settledHero === null || _settledHero.illustId !== illustId) {
    degrade('no-source', 'back')
    return
  }
  _armed = { illustId, rect: _settledHero.rect }
  // 代号自增：正在等待的前进测量据此判定「用户提前返回了」，不让过期动画继续（决策 12 机制 4）
  _generation++
}

/** 在途前进测量的作品 id（供 `useHeroSource` 的 onDeactivated 判定「这次 push 我活下来了」）。 */
export function currentHeroSourceIllustId(): number | null {
  return _source?.illustId ?? null
}

/** 只读测试/诊断口：重置模块级在途态（单测之间隔离用；生产不调用）。
 *  同款形态见 routeTransition 的 resetRouteTransitionForTest。 */
export function resetHeroTransitionForTest(): void {
  _source = null
  _settledHero = null
  _armed = null
  _generation = 0
}

/** 一次性消费在途测量：id / 代 / 截止时间三道门任一不过即降级。 */
async function consume(
  pending: PendingMeasure | null,
  illustId: number,
  deadlineMs: number,
): Promise<BoundingRect | null> {
  if (pending === null) return degrade('no-source', 'source')
  // 无论结论如何都清掉在途态：一次性消费，且不留下会误触发后续页面的陈旧矩形
  _source = null
  if (pending.illustId !== illustId) return degrade('id-mismatch', 'source id=' + pending.illustId)
  const rect = await withDeadline(pending.promise, deadlineMs)
  if (rect === DEADLINE) return degrade('deadline', 'source')
  if (rect === null) return degrade('measure-failed', 'source')
  // ⚠️ 代号校验**必须在 await 之后**：它的语义是「等结果的这段时间里又发生了一次
  // 发起/返回意图」，而不是「我拿到的是不是发起时那条」。
  // 覆盖两种真实竞态：① 等测量期间用户又点了一次（连点）→ 这次矩形已不是最新意图的；
  // ② 等测量期间用户按了返回（armHeroBack 自增代号）→ 决策 12 机制 4 明列的
  // 「用户快速连点/提前返回」降级，不让一次已过期的连续性动画在错误的页面上继续。
  if (pending.generation !== _generation) return degrade('stale-generation', 'source')
  if (!isPlausibleHeroRect(rect)) return degrade('invalid-rect', 'source')
  return rect
}

/** 详情页消费前进矩形（缩略图盒，视口坐标）。拿不到即降级（返回 null）。 */
export function takeHeroSource(illustId: number, options: HeroMeasureOptions = {}): Promise<BoundingRect | null> {
  return consume(_source, illustId, options.timeoutMs ?? HERO_SOURCE_DEADLINE_MS)
}

/**
 * 列表页消费返回矩形（详情页 hero 盒，视口坐标）。
 * **同步可取**（起点在详情页活着时就已存下）⇒ 没有跨线程等待，也就没有「等不到起点」这条路。
 */
export async function takeHeroTarget(illustId: number): Promise<BoundingRect | null> {
  const armed = _armed
  _armed = null
  if (armed === null) return degrade('no-source', 'target')
  if (armed.illustId !== illustId) return degrade('id-mismatch', 'target id=' + armed.illustId)
  if (!isPlausibleHeroRect(armed.rect)) return degrade('invalid-rect', 'target')
  return armed.rect
}

/** 测本页根矩形：覆盖层 `absolute` 锚点 + 视口↔页面坐标换算基准。 */
export async function measureHeroRoot(options: HeroMeasureOptions = {}): Promise<BoundingRect | null> {
  const rect = await withDeadline(measureOne(HERO_ROOT_ID, options), options.timeoutMs ?? HERO_MEASURE_TIMEOUT_MS)
  if (rect === DEADLINE) return degrade('deadline', 'root')
  if (rect === null) return degrade('measure-failed', 'root')
  if (!rect.width || !rect.height) return degrade('invalid-rect', 'root')
  return rect
}

export interface HeroListRects {
  root: BoundingRect
  /** 缩略图盒（视口坐标） */
  source: BoundingRect
}

/** 列表侧一次性测「页面根 + 某作品的缩略图盒」：返回方向需要（覆盖层落点 + 终点）。 */
export async function measureHeroList(illustId: number, options: HeroMeasureOptions = {}): Promise<HeroListRects | null> {
  return measureHeroPair(heroSourceId(illustId), 'list source', options)
}

export interface HeroDetailRects {
  root: BoundingRect
  /** 详情页 hero 盒（视口坐标） */
  hero: BoundingRect
}

/** 详情侧一次性测「页面根 + hero 盒」：前进方向需要（覆盖层落点 + 终点）。 */
export async function measureHeroDetail(heroElementId: string, options: HeroMeasureOptions = {}): Promise<HeroDetailRects | null> {
  const pair = await measureHeroPair(heroElementId, 'detail hero', options)
  return pair === null ? null : { root: pair.root, hero: pair.source }
}

/** 同批测「页面根 + 另一个盒子」：两个 id 一次查询（逐 id select，ADR-0149 平台约束）。 */
async function measureHeroPair(
  elementId: string,
  label: string,
  options: HeroMeasureOptions,
): Promise<HeroListRects | null> {
  const rootId = HERO_ROOT_ID
  const result = await measureRects(
    [rootId, elementId],
    options.createQuery ?? defaultQueryFactory,
    options.timeoutMs ?? HERO_MEASURE_TIMEOUT_MS,
  )
  const root = result.rects[rootId]
  const source = result.rects[elementId]
  if (!result.ok || !root || !source) return degrade('measure-failed', label)
  if (!isPlausibleHeroRect(source)) return degrade('invalid-rect', label)
  if (!root.width || !root.height) return degrade('invalid-rect', label + ' root')
  return { root, source }
}

// ───────────────────────────────────────────────────────────────────────────
// 覆盖层时序（两个方向共用同一台状态机，只是 from/to 互换）
// ───────────────────────────────────────────────────────────────────────────

export type HeroPhase =
  /** 覆盖层不渲染（静息 / 降级 / 已收尾） */
  | 'idle'
  /** 已落在起点（等待下一拍切终点，使过渡有插值起点） */
  | 'from'
  /** 过渡播放中 */
  | 'to'
  /** 已收尾（覆盖层应卸载） */
  | 'done'

/**
 * 过渡声明：只列 transform / width / height 三条**已实证**通道（理由见文件头）。
 * 时长与曲线取自 motion.ts 的档位表；不出现任何时长/曲线字面量。
 */
export function heroTransitionValue(): string {
  const duration = MOTION_DURATION[ROUTE_TRANSITION_DURATION]
  const easing = MOTION_EASING[ROUTE_TRANSITION_EASING]
  return `transform ${duration} ${easing}, width ${duration} ${easing}, height ${duration} ${easing}`
}

/** 收尾计时器时长（ms）：与过渡同一个 duration 档的数值镜像（决策 3「令牌同源计时器」）。 */
export const HERO_HOLD_MS: number = MOTION_DURATION_MS[ROUTE_TRANSITION_DURATION]

export interface HeroPlayInput {
  /** 插值起点（视口坐标） */
  from: BoundingRect
  /** 插值终点（视口坐标） */
  to: BoundingRect
  /** 本页页面根的视口矩形（坐标换算基准） */
  root: BoundingRect
  /** 覆盖层图片地址：调用方给，本模块不猜 URL（图片档位/代理策略是页面的事） */
  src: string
}

/** 静息态的 `:style` 值：**空对象** = 元素上不挂任何过渡声明（R1 的最强形态）。 */
const EMPTY_STYLE: Record<string, string> = {}

export interface HeroOverlay {
  phase: Ref<HeroPhase>
  /** 覆盖层图片地址 */
  src: Ref<string>
  /** 绑覆盖层 `:style`（几何 + 过渡声明） */
  style: ComputedRef<Record<string, string>>
  /** 覆盖层是否该挂载（idle / done 都为 false） */
  visible: ComputedRef<boolean>
  /** 起手：from 态落位 → 下一拍切 to 态 → HERO_HOLD_MS 后收尾 */
  play(input: HeroPlayInput): void
  /** 取消（提前返回 / 再次导航 / 卸载），带原因落痕 */
  cancel(reason: HeroDegradeReason): void
  dispose(): void
}

/**
 * 覆盖层状态机（两个方向共用）。
 *
 * 坐标口径：全部矩形都是**视口坐标**（measureRects 的原生口径），覆盖层用 `absolute` 挂在页面根内，
 * 故 `left/top` = 视口坐标 − 页面根视口原点。换算基准由调用方一并传入 ⇒ 不假设任何安全区/padding。
 */
export function useHeroOverlay(options: UseReducedMotionOptions = {}): HeroOverlay {
  const motion = useMotion(options)
  const phase = ref<HeroPhase>('idle')
  const src = ref('')
  const from = ref<BoundingRect | null>(null)
  const to = ref<BoundingRect | null>(null)
  const root = ref<BoundingRect | null>(null)
  let rafId: number | null = null
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  /** 无 rAF 时的「下一拍」退路（单独持一支，与收尾计时器区分） */
  let tickTimer: ReturnType<typeof setTimeout> | undefined

  function clearTimers(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (holdTimer !== undefined) {
      clearTimeout(holdTimer)
      holdTimer = undefined
    }
    if (tickTimer !== undefined) {
      clearTimeout(tickTimer)
      tickTimer = undefined
    }
  }

  const style = computed<Record<string, string>>(() => {
    const f = from.value
    const t = to.value
    const r = root.value
    if (phase.value !== 'from' && phase.value !== 'to') return EMPTY_STYLE
    if (!f || !t || !r) return EMPTY_STYLE
    // 起点用静态 left/top 落位（定位属性不参与过渡，见文件头）
    const left = f.left - r.left
    const top = f.top - r.top
    if (phase.value === 'from') {
      return {
        left: `${left}px`,
        top: `${top}px`,
        width: `${f.width}px`,
        height: `${f.height}px`,
        transform: 'translate(0px, 0px)',
      }
    }
    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${t.width}px`,
      height: `${t.height}px`,
      transform: `translate(${t.left - f.left}px, ${t.top - f.top}px)`,
      transition: heroTransitionValue(),
    }
  })

  function play(input: HeroPlayInput): void {
    clearTimers()
    // R1/R2：减弱动效下**过渡本身不生成**（不是挂 0ms）
    if (motion.reduced.value) {
      degrade('reduced-motion')
      phase.value = 'idle'
      return
    }
    if (!isPlausibleHeroRect(input.from) || !isPlausibleHeroRect(input.to)) {
      degrade('invalid-rect')
      phase.value = 'idle'
      return
    }
    if (!input.root || !Number.isFinite(input.root.width) || !Number.isFinite(input.root.height)) {
      degrade('invalid-rect', 'root')
      phase.value = 'idle'
      return
    }
    if (!overlapsHorizontally(input.from, input.root) || !overlapsHorizontally(input.to, input.root)) {
      degrade('invalid-rect', 'off-screen')
      phase.value = 'idle'
      return
    }
    if (!input.src) {
      degrade('no-source-image')
      phase.value = 'idle'
      return
    }
    from.value = input.from
    to.value = input.to
    root.value = input.root
    src.value = input.src
    phase.value = 'from'
    // 两拍起手：from 必须先被排版一次，transition 才有插值起点（无 transitionend / 无强制回流 API）
    const advance = (): void => {
      rafId = null
      if (phase.value !== 'from') return
      phase.value = 'to'
    }
    if (typeof requestAnimationFrame !== 'function') {
      // 引擎不提供 rAF 时退到宏任务：仍保证 from 态先提交（退化为一帧延迟，不是同步塌缩）
      tickTimer = setTimeout(advance, 0)
    } else {
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(advance)
      })
    }
    // 收尾计时器与过渡同源（同一个 duration 档）⇒ 「动画停」与「覆盖层撤下」同刻
    holdTimer = setTimeout(() => {
      holdTimer = undefined
      phase.value = 'done'
    }, HERO_HOLD_MS)
  }

  function cancel(reason: HeroDegradeReason = 'cancelled'): void {
    if (phase.value === 'idle' || phase.value === 'done') return
    clearTimers()
    degrade(reason)
    phase.value = 'idle'
  }

  return {
    phase,
    src,
    style,
    visible: computed(() => phase.value === 'from' || phase.value === 'to'),
    play,
    cancel,
    dispose() {
      clearTimers()
      motion.dispose()
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 列表侧接线（每个「点图进详情」的流调用一次）
// ───────────────────────────────────────────────────────────────────────────

export interface HeroSourceOptions extends UseReducedMotionOptions, HeroMeasureOptions {
  /** 返回方向需要覆盖层显示同一张图；地址由页面按自己的档位/代理策略给。
   *  不提供 ⇒ 返回方向降级（其余 6 个非 KeepAlive 流本来就没有返回方向，故不传）。 */
  resolveSrc?: (illustId: number) => string
}

export interface HeroSourceApi {
  /** 绑到页面根 view 的 `:id` */
  rootId: string
  /** 绑到缩略图盒的 `:id`（决策 12 机制 1） */
  sourceId(illustId: number): string
  /** 点图时调用：**发起测量但不等待**，调用方紧接着 `navigate()` */
  begin(illustId: number): void
  /** 覆盖层（返回方向）：绑 `visible` / `src` / `style` 即可 */
  overlay: HeroOverlay
}

/**
 * 列表侧接线。
 *
 * @tap 里只调 `begin()`（同步、不阻塞），导航由调用点自己发起 —— 这样「测量的跨线程异步」
 * 不会给导航加可见延迟，同时不产生 `heroTransition → router` 的循环依赖。
 */
export function useHeroSource(options: HeroSourceOptions = {}): HeroSourceApi {
  const overlay = useHeroOverlay(options)
  const resolveSrc = options.resolveSrc
  /** 本实例在「这次 push」中活下来了（onDeactivated 触发）⇒ 返回方向可用。
   *  实例被销毁时这个局部标记随之消失 ⇒ 重建的实例恒为 null ⇒ 自动降级为前进单向。 */
  let survivedPushIllustId: number | null = null

  onDeactivated(() => {
    const illustId = currentHeroSourceIllustId()
    if (illustId !== null) survivedPushIllustId = illustId
  })

  async function playBack(illustId: number): Promise<void> {
    // 返回起点 = 详情页活着时存下的 hero 盒（同步可取）；拿不到（没置位 / 换作品 / 滚动过）即降级
    const from = await takeHeroTarget(illustId)
    if (from === null) return
    if (!resolveSrc) {
      degrade('no-source-image', 'back')
      return
    }
    const list = await measureHeroList(illustId, options)
    if (list === null) return
    overlay.play({ from, to: list.source, root: list.root, src: resolveSrc(illustId) })
  }

  onActivated(() => {
    // 首挂也会触发 onActivated，此时 survivedPushIllustId 恒为 null ⇒ 无副作用
    const illustId = survivedPushIllustId
    if (illustId === null) return
    survivedPushIllustId = null
    void playBack(illustId)
  })

  return {
    rootId: HERO_ROOT_ID,
    sourceId: heroSourceId,
    begin: (illustId: number) => beginHeroSource(illustId, options),
    overlay,
  }
}
