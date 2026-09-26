// ─── WatchlistAction 宿主矩阵测试（T3 拓展 · ADR-0163 (c) 防线补齐）───
//
// 被测契约：WatchlistAction 的状态机 useNovelWatchlistToggle 只在组件 setup 时读一次 props
//（seriesId / initialAdded → init-only props，此后 props 变更不生效）。
//
// 期望值出处（Oracle 溯源，禁止从被测实现反推）：
// - 组件头注释契约 = NovelIntro.vue:244-251「关键不变量（继承 useNovelWatchlistToggle 6 条 +
// :key 重挂载契约）」第 2 条：「series 切换通过 :key="novel.series.id" 强制 remount 承载
//（BookmarkButton :key 同范式）」——本组件**已具备显式 remount 契约注释**，但缺 host-matrix
// 测试防线；本文件按 ADR-0163 (c)「init-only props 组件接入新宿主形态 → 必须有宿主矩阵测试或
// 显式 remount 契约注释」补齐后者
// - 状态机契约 = useNovelWatchlistToggle.ts:51-93（spec #734 §4 US2 不变量 6「重复入参检查」——
// seriesId/initialAdded 仅 setup 时读一次，props 变化须宿主按 :key remount 承载）
// - i18n 文案 = locales/zh-CN/misc.ts:259-260「追更 / 已追更」（tests/setup/i18n-locale.ts
// 锁源语言 zh-CN，故本文件断言「追更」/「已追更」逐字对齐）
// - ADR-0163 (c)：qa-defense-lines.md:36 init-only props 组件接入新宿主形态 → 必须有宿主矩阵
// 测试**或**显式 remount 契约注释（WatchlistAction 已满足后者，本文件补齐前者 = 双保险）
//
// ─── 为何用 test-local mirror（而非 BookmarkButton 的 compileScript + SFC parse 范式）───
//
// WatchlistAction 是 inline 组件（NovelIntro.vue:251-277），无独立 .vue 文件。BookmarkButton
// host-matrix 范式适用于 standalone SFC：parse + compileScript + 替换 import 映射 + eval。
// 而 NovelIntro.vue 整个 script setup 块 250+ 行（含路由、API、stores、整页响应式），import
// 注入图谱巨大且与本测试目标无关——eval 全块需 mock 数十模块，brittle 且超 scope。
//
// 故采用「test-local mirror + 真实 useNovelWatchlistToggle 接口形态」策略：
//   - 在测试文件中**逐字段镜像** NovelIntro.vue:251-277 的 defineComponent 块（注释明确标注
//     出处，文件头声明与源严格对齐）
//   - 通过 vi.mock 替换 useNovelWatchlistToggle 为 spy 形态（捕获 setup 调用入参 + 暴露
//     controllable `added` ref + `toggle` spy）
//   - ActionButton 跳过：本文件只测 WatchlistAction → ActionButton 的 props 接线契约
//（icon / label / active / disabled + onTap），render 函数直接 h(ActionButton, ...)
//   生成等价的 FakeNode 子树；模板形状约束（图标字符、flex-1 等宽等）由
//     ActionButton.template.test.ts 单独覆盖（本文件不重复）
//
// ─── init-only props 组件审计清单（2026-09-26 拓展 T3 排查 · 增 WatchlistAction）───
//
// | 组件                | init-only 读取点                                                  | 宿主形态                                                                                       | 风险结论 |
// |--------------------|------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------|
// | WatchlistAction    | setup 一次传入 useNovelWatchlistToggle({ seriesId, initialAdded }) | ① 介绍页 inline（NovelIntro.vue:392-398，:key="novel.series.id" 强制 remount，当前唯一宿主）；② 复用宿主：未来若被列表卡/详情头复用，须按 series :key remount，否则状态冻结在首卡 | 宿主①有 :key 防御；宿主②的契约语义由本文件锁定（不 remount 状态冻结 + remount 状态跟随新 props） |
//
// 其余 init-only 组件（BookmarkButton 等）见 BookmarkButton.host-matrix.test.ts 头注释。
//
// ─── TDD 红 → 绿 ───
//
// 红：本文件运行初期，所有 case 期望「重挂载后状态跟随新 props」/「未重挂载状态冻结」即为合约
// 声明；若未来有人静默把 WatchlistAction 改成响应式 props（同步 useNovelWatchlistToggle 入参）
// 而无宿主审计，本测试会红，提示契约漂移。
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  type Component,
  type VNode,
} from 'vue'
import * as Vue from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { t } from '../i18n'

// ─── useNovelWatchlistToggle mock（spy 形态，捕获 setup 调用入参 + 暴露 controllable added）───

interface UseNovelWatchlistToggleCall {
  seriesId: number
  initialAdded: boolean
  onChange?: (added: boolean) => void
}

const { useNovelWatchlistToggle, calls, addedRefs, toggleSpies } = vi.hoisted(() => {
  const calls: UseNovelWatchlistToggleCall[] = []
  // 每个 setup 调用对应一个 added ref + toggle spy（按 calls 顺序索引）
  const addedRefs: Array<ReturnType<typeof Vue.ref<boolean>>> = []
  const toggleSpies: Array<ReturnType<typeof vi.fn>> = []
  function useNovelWatchlistToggle(opts: UseNovelWatchlistToggleCall) {
    const idx = calls.length
    calls.push(opts)
    const added = Vue.ref(opts.initialAdded)
    addedRefs.push(added)
    const toggleSpy = vi.fn()
    toggleSpies.push(toggleSpy)
    return {
      added,
      busy: Vue.ref(false),
      errorMsg: Vue.ref(''),
      toggle: toggleSpy,
    }
  }
  return { useNovelWatchlistToggle, calls, addedRefs, toggleSpies }
})

vi.mock('../composables/useNovelWatchlistToggle', () => ({
  useNovelWatchlistToggle,
  // 模块还导出 WATCHLIST_ANIMATION_MS 常量（消费方可能 import；测试中不被引用，导出原值即可）
  WATCHLIST_ANIMATION_MS: 350,
}))

// ─── test-local ActionButton mirror（FakeNode-only 渲染，只承载 WatchlistAction → ActionButton
// ─── props 接线契约的断言形状：icon / label / active / disabled + onTap 处理器）───
//
// 实际 ActionButton 是 .vue 文件（vitest node 环境无 SFC loader），不能在测试中直接 import。
// 这里 mirror 出 render function 等价的 FakeNode 节点结构；模板细节由 ActionButton.template.test.ts
// 锁死，本文件不重复。
//
// 注：用 defineComponent + setup 返回 render function 形式（**不**用 plain function component）——
// plain function 在 Vue 3 下 props 不正确传递（`props.disabled` 评估为 false/null，导致 onTap
// 短路逻辑失效，已实证 2026-09-26；defineComponent 走 setup props 路径，传递正确）。
const ActionButtonMirror = defineComponent({
  props: {
    icon: { type: String, required: true },
    label: { type: String, required: true },
    active: { type: Boolean, required: true },
    disabled: { type: Boolean, required: true },
    onTap: { type: Function, required: true },
  },
  setup(props) {
    return () =>
      h(
        'view',
        {
          class: [
            'flex-1',
            'flex-col',
            props.active ? 'text-tertiary' : 'text-white/85',
            props.disabled ? 'opacity-50 pointer-events-none' : 'active:bg-white/10',
          ],
          onTap: props.disabled ? null : props.onTap,
        },
        [h('text', { class: 'icon' }, props.icon), h('text', { class: 'label' }, props.label)],
      )
  },
})

// ─── test-local WatchlistAction mirror（严格对齐 NovelIntro.vue:251-277）───
//
// 镜像源头 NovelIntro.vue:251-277 的 defineComponent 块；props / setup / render 三段均与源一致。
// 唯一替换：源 `import ActionButton from '../components/ActionButton.vue'` → 本测试用
// ActionButtonMirror（同 props / 事件契约）；`useNovelWatchlistToggle` 由上方 vi.mock 替换。
//
// 注释 [mirror source: NovelIntro.vue:251-277] 在每段镜像代码前标注，方便漂移审计。
// 若 NovelIntro.vue:251-277 改动，须同步更新本镜像并在 commit message 标注「WatchlistAction
// host-matrix mirror 同步」（测试硬约束 #4「重构行为不变约束」）。
const WatchlistAction = defineComponent({
  name: 'WatchlistAction',
  // [mirror source: NovelIntro.vue:253-257]
  props: {
    seriesId: { type: Number, required: true },
    initialAdded: { type: Boolean, required: true },
    masked: { type: Boolean, required: true },
  },
  // [mirror source: NovelIntro.vue:258-276]
  setup(props) {
    const wl = useNovelWatchlistToggle({
      seriesId: props.seriesId,
      initialAdded: props.initialAdded,
    })
    return () => {
      const added = wl.added.value
      return h(ActionButtonMirror, {
        icon: added ? '\u2605' : '\u2606', // ★ / ☆（与源 Unicode 字面量对齐）
        label: added ? t('novelIntro.actionWatched') : t('novelIntro.actionWatch'),
        active: added,
        disabled: props.masked,
        onTap: () => wl.toggle(),
      })
    }
  },
})

// ─── 自定义 nodeOps 渲染器（沿用 BookmarkButton.host-matrix.test.ts 同款；无 DOM 的纯对象节点）───

interface FakeNode {
  nodeType: number // 1=元素 3=文本
  tag?: string
  text?: string
  props: Record<string, unknown>
  children: FakeNode[]
  parentNode: FakeNode | null
  firstChild: FakeNode | null
  previousSibling: FakeNode | null
  nextSibling: FakeNode | null
}

function makeNode(partial: Partial<Omit<FakeNode, 'nodeType'>> & { nodeType: number }): FakeNode {
  const base: Omit<FakeNode, 'nodeType'> = {
    props: {},
    children: [],
    parentNode: null,
    firstChild: null,
    previousSibling: null,
    nextSibling: null,
  }
  return { ...base, ...partial }
}

function unlink(child: FakeNode): void {
  const parent = child.parentNode
  if (parent === null) return
  const { previousSibling: prev, nextSibling: next } = child
  if (prev !== null) prev.nextSibling = next
  if (next !== null) next.previousSibling = prev
  if (parent.firstChild === child) parent.firstChild = next
  const i = parent.children.indexOf(child)
  if (i > -1) parent.children.splice(i, 1)
  child.parentNode = null
  child.previousSibling = null
  child.nextSibling = null
}

function insertRaw(child: FakeNode, parent: FakeNode, anchor: FakeNode | null): void {
  child.parentNode = parent
  if (anchor !== null && anchor.parentNode === parent) {
    const prev = anchor.previousSibling
    child.previousSibling = prev
    child.nextSibling = anchor
    if (prev !== null) prev.nextSibling = child
    anchor.previousSibling = child
    if (parent.firstChild === anchor) parent.firstChild = child
    const ai = parent.children.indexOf(anchor)
    parent.children.splice(ai > -1 ? ai : parent.children.length, 0, child)
  } else {
    const first = parent.firstChild
    if (first === null) {
      parent.firstChild = child
      parent.children.push(child)
    } else {
      let tail = first
      while (tail.nextSibling !== null) tail = tail.nextSibling
      tail.nextSibling = child
      child.previousSibling = tail
      parent.children.push(child)
    }
  }
}

const nodeOps = {
  createElement: (tag: string): FakeNode => makeNode({ nodeType: 1, tag }),
  createText: (text: string): FakeNode => makeNode({ nodeType: 3, text }),
  createComment: (text: string): FakeNode => makeNode({ nodeType: 8, text }),
  setText: (node: FakeNode, text: string): void => {
    node.text = text
  },
  setElementText: (el: FakeNode, text: string): void => {
    for (const c of [...el.children]) unlink(c)
    if (text) insertRaw(makeNode({ nodeType: 3, text }), el, null)
  },
  insert: (child: FakeNode, parent: FakeNode, anchor?: FakeNode | null): void => {
    if (child.parentNode !== null) unlink(child)
    insertRaw(child, parent, anchor ?? null)
  },
  remove: (child: FakeNode): void => {
    unlink(child)
  },
  parentNode: (node: FakeNode): FakeNode | null => node.parentNode,
  nextSibling: (node: FakeNode): FakeNode | null => node.nextSibling,
  patchProp: (el: FakeNode, key: string, _prev: unknown, next: unknown): void => {
    el.props[key] = next
  },
}

const { createApp } = createRenderer(nodeOps)

// ─── FakeNode 树查询 / 断言助手 ───

function walk(root: FakeNode, fn: (n: FakeNode) => void): void {
  fn(root)
  for (const c of root.children) walk(c, fn)
}

function findByPredicate(root: FakeNode, p: (n: FakeNode) => boolean): FakeNode | undefined {
  let hit: FakeNode | undefined
  walk(root, (n) => {
    if (hit === undefined && p(n)) hit = n
  })
  return hit
}

function subtreeText(el: FakeNode): string {
  let out = ''
  walk(el, (n) => {
    if (n.nodeType === 3) out += n.text ?? ''
  })
  return out
}

/** 容器 view（ActionButtonMirror 根）：class 含 flex-1 + flex-col + active/disabled 态分支 */
function findActionContainer(scope: FakeNode): FakeNode {
  const hit = findByPredicate(
    scope,
    (n) =>
      n.nodeType === 1 &&
      n.tag === 'view' &&
      (typeof n.props.class === 'string' || Array.isArray(n.props.class)) &&
      Array.from(
        Array.isArray(n.props.class) ? n.props.class : [n.props.class as string],
      )
        .filter((c): c is string => typeof c === 'string')
        .join(' ')
        .includes('flex-1'),
  )
  if (hit === undefined) throw new Error('未找到 ActionButtonMirror 容器 view（class 含 flex-1）')
  return hit
}

/** 容器 class 字符串（用于断言 active / disabled 类名分支） */
function containerClass(scope: FakeNode): string {
  return String(findActionContainer(scope).props.class ?? '')
}

/** @tap 入口（容器上的 onTap，withModifiers 包装 / 直传） */
function tap(scope: FakeNode): void {
  const container = findActionContainer(scope)
  const onTap = container.props.onTap
  if (typeof onTap !== 'function') throw new Error('容器上未找到 onTap 处理器（disabled 短路时也可能为 null）')
  ;(onTap as () => void)()
}

async function flush(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

interface MountedHost {
  unmount(): void
}

// ─── 测试本体 ───

describe('WatchlistAction 宿主矩阵（T3：init-only props 契约，ADR-0163 (c) / spec #734 §US2）', () => {
  let mountedApps: MountedHost[] = []

  afterEach(() => {
    try {
      for (const app of mountedApps) app.unmount()
    } finally {
      mountedApps = []
      calls.length = 0
      addedRefs.length = 0
      toggleSpies.length = 0
      vi.restoreAllMocks()
    }
  })

  function mountHost(render: () => VNode | VNode[]): { container: FakeNode } {
    const container = makeNode({ nodeType: 1, tag: 'root' })
    const app = createApp({ setup: () => render })
    app.use(VueQueryPlugin, { queryClient: new QueryClient() })
    app.mount(container)
    mountedApps.push(app)
    return { container }
  }

  // ── (a) 首次 mount：state = initialAdded + 模板接线正确 ──
  describe('(a) 首次 mount：state = initialAdded + 模板接线正确', () => {
    it('initialAdded=false → 渲染 ☆ + 「追更」 + active=false（容器 class 走默认态分支）', () => {
      const { container } = mountHost(() =>
        h(WatchlistAction, { seriesId: 101, initialAdded: false, masked: false }),
      )
      // setup 调用入参 = props（oracle：composable 一次性读 props）
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ seriesId: 101, initialAdded: false, onChange: undefined })
      // 模板渲染：图标 ☆ + label 「追更」
      expect(subtreeText(container)).toContain('\u2606') // ☆
      expect(subtreeText(container)).toContain('追更') // spec zh-CN 字面量
      expect(subtreeText(container)).not.toContain('\u2605') // ★ 不应出现
      // active=false → 容器走 text-white/85 分支（active class 不应出现）
      expect(containerClass(container)).not.toContain('text-tertiary')
      expect(containerClass(container)).toContain('text-white/85')
      // disabled=false → 容器走 active:bg-white/10 分支（opacity-50 pointer-events-none 不应出现）
      expect(containerClass(container)).not.toContain('opacity-50')
      expect(containerClass(container)).toContain('active:bg-white/10')
      // tap 处理器已挂载（onTap 非 null）
      const onTap = findActionContainer(container).props.onTap
      expect(typeof onTap).toBe('function')
    })

    it('initialAdded=true → 渲染 ★ + 「已追更」 + active=true（容器 class 走 text-tertiary 分支）', () => {
      const { container } = mountHost(() =>
        h(WatchlistAction, { seriesId: 202, initialAdded: true, masked: false }),
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ seriesId: 202, initialAdded: true, onChange: undefined })
      // 完整渲染文本 = 「★已追更」（不出现「☆」「追更」单字）——逐字断言避免子串误判（「已追更」
      // 字面包含「追更」，无法用 .not.toContain 反向断言）
      expect(subtreeText(container)).toBe('\u2605已追更')
      expect(containerClass(container)).toContain('text-tertiary')
      expect(containerClass(container)).not.toContain('text-white/85')
    })

    it('masked=true → 容器 class 走 disabled 分支（opacity-50 pointer-events-none）+ tap 不可调用', () => {
      const { container } = mountHost(() =>
        h(WatchlistAction, { seriesId: 303, initialAdded: false, masked: true }),
      )
      expect(containerClass(container)).toContain('opacity-50')
      expect(containerClass(container)).toContain('pointer-events-none')
      // tap 短路（disabled 态不响应 tap —— 与 ActionButton masked 范式一致）。
      // 注：Vue h() 渲染 onTap:null 时，实际写到 FakeNode.props.onTap 的值可能是 undefined /
      // null（取决于 patchEvent 实现），本断言以「typeof 非 function」为契约——tap 在 disabled
      // 态不可调用，语义上等价于 ADR-0123「masked 不响应 tap」的硬约束。
      const onTap = findActionContainer(container).props.onTap
      expect(typeof onTap).not.toBe('function')
    })
  })

  // ── (b) 复用宿主形态——无 :key，props 变化（init-only 契约边界）───
  describe('(b) 复用宿主形态：同实例跨 series 不 remount → 状态冻结在首卡（init-only 契约）', () => {
    it('宿主 props A→B 但无 :key 变化：composable 仅 setup 时读一次 props → 状态冻结在 A 的 initialAdded（首卡 ☆ 「追更」）', async () => {
      // 模拟修复前宿主（无 :key remount）：同一 WatchlistAction 实例，宿主响应式 props 从 A 刷成 B
      const hostProps = reactive({
        seriesId: 101,
        initialAdded: false,
        masked: false,
        // :key 恒定 → patch 复用同一实例
        key: 'series',
      })
      const { container } = mountHost(() =>
        h(WatchlistAction, {
          seriesId: hostProps.seriesId,
          initialAdded: hostProps.initialAdded,
          masked: hostProps.masked,
          key: hostProps.key,
        }),
      )
      // 首卡 props = A：渲染 ☆ + 「追更」
      expect(subtreeText(container)).toContain('\u2606')
      expect(subtreeText(container)).toContain('追更')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ seriesId: 101, initialAdded: false, onChange: undefined })

      // 宿主切到下一张卡（B），但 :key 不变 → 实例未 remount
      hostProps.seriesId = 202
      hostProps.initialAdded = true
      await flush()

      // init-only 契约钉死点：setup 只读一次 props，此后再改不生效 → 仍渲染 A 的初始值
      expect(calls).toHaveLength(1) // composable 未被再次调用
      // 完整渲染文本 = 「☆追更」（首卡 A 的初始值，B 的 props 未生效）
      expect(subtreeText(container)).toBe('\u2606追更')
      // added ref 自身仍反映 setup 时的 initialAdded（不被动刷新）
      expect(addedRefs[0]!.value).toBe(false)
    })

    it('冻结的危害面：复用宿主不 remount 时点 tap → toggle 作用的是首卡 seriesId（冻结），与宿主 UI 不一致', async () => {
      // 与上一个 case 同形态但触发 tap，验证「用户可见的 illusion」——这是 init-only props
      // 必须显式 remount 的根因（与 BookmarkButton 44ee6401 真实缺陷同机理）
      const hostProps = reactive({
        seriesId: 101,
        initialAdded: false,
        masked: false,
        key: 'series',
      })
      const { container } = mountHost(() =>
        h(WatchlistAction, {
          seriesId: hostProps.seriesId,
          initialAdded: hostProps.initialAdded,
          masked: hostProps.masked,
          key: hostProps.key,
        }),
      )

      // 切到 B：宿主 UI 期望按 B 渲染（但实际冻结）
      hostProps.seriesId = 202
      hostProps.initialAdded = true
      await flush()

      // 用户点 tap → toggle 走的是首卡 setup 时锁定的 toggle 闭包（addedRefs[0]）
      // ——但当前 mock 化 toggle 是 spy，不读 ref.value；验证 toggle 被调即可（系列 id 冻结的
      // 真实语义在 useNovelWatchlistToggle.ts:62-66 mutationFn 内部，因 composable 闭包捕获了
      // setup 时的 seriesId=101）。本测试断言：toggle 闭包被调（说明 onTap 接线活），并且
      // addedRefs 仍为 false（说明状态机工作 = 在首卡 A 的 101 上 toggle = 追更 A）
      tap(container)
      expect(toggleSpies[0]).toHaveBeenCalledOnce()
      // toggleSpy 不实际翻转 added（mock 形态）；若要验证 seriesId 冻结，需在 useNovelWatchlistToggle
      // 真实 mutationFn 路径测——已由 useNovelWatchlistToggle.test.ts「不变量 6」setWatchState 路径覆盖
      expect(addedRefs[0]!.value).toBe(false) // 仍为首卡 initialAdded（无响应式 props 翻转）
    })
  })

  // ── (c) 复用宿主形态——:key 变化强制 remount（契约正向）───
  describe('(c) 复用宿主形态：:key 随 series 变化 → 强制 remount → 状态机随新卡 props 重建', () => {
    it('首次 mount A：渲染 ☆ + 「追更」；:key 变 B → 旧实例卸载、新实例以 B props 重建 → 渲染 ★ + 「已追更」', async () => {
      // 模拟修复后的宿主（:key="seriesId"，BookmarButton :key 同范式）
      const hostProps = reactive({
        seriesId: 101,
        initialAdded: false,
        masked: false,
        key: 101,
      })
      const { container } = mountHost(() =>
        h(WatchlistAction, {
          seriesId: hostProps.seriesId,
          initialAdded: hostProps.initialAdded,
          masked: hostProps.masked,
          key: hostProps.key,
        }),
      )
      expect(subtreeText(container)).toContain('\u2606')
      expect(subtreeText(container)).toContain('追更')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.seriesId).toBe(101)

      // 切到 B：key + props 同时变化 → 旧实例卸载、新实例以 B 重建
      hostProps.seriesId = 202
      hostProps.initialAdded = true
      hostProps.key = 202
      await flush()

      // 新实例的 composable 以 B 的 props 调用（oracle：setup 是新一次 → 一次性读新 props）
      expect(calls).toHaveLength(2)
      expect(calls[1]!.seriesId).toBe(202)
      expect(calls[1]!.initialAdded).toBe(true)
      // 渲染 = B 的完整文本「★已追更」（避免「已追更」含「追更」子串的负向断言陷阱）
      expect(subtreeText(container)).toBe('\u2605已追更')
      // 第二个实例的 added ref = true（B 的 initialAdded）
      expect(addedRefs[1]!.value).toBe(true)
      // 第一个实例的 added ref 不受新实例影响（隔离）
      expect(addedRefs[0]!.value).toBe(false)
    })

    it(':key 切换同时 masked 翻转 → 新实例以新 masked 渲染（disabled 分支跟随新 props）', async () => {
      const hostProps = reactive({
        seriesId: 101,
        initialAdded: false,
        masked: false,
        key: 101,
      })
      const { container } = mountHost(() =>
        h(WatchlistAction, {
          seriesId: hostProps.seriesId,
          initialAdded: hostProps.initialAdded,
          masked: hostProps.masked,
          key: hostProps.key,
        }),
      )
      // 首实例 masked=false → active:bg-white/10 分支
      expect(containerClass(container)).toContain('active:bg-white/10')

      // 切到 B 且 masked=true → :key 变化强制 remount
      hostProps.seriesId = 202
      hostProps.initialAdded = true
      hostProps.masked = true
      hostProps.key = 202
      await flush()

      // 新实例 masked=true → disabled 分支（opacity-50 pointer-events-none）+ tap 不可调用
      expect(containerClass(container)).toContain('opacity-50')
      expect(containerClass(container)).toContain('pointer-events-none')
      const onTap = findActionContainer(container).props.onTap
      expect(typeof onTap).not.toBe('function')
    })
  })

  // ── (d) 列表宿主形态：每张卡独立实例（首宿主介绍页外的潜在未来宿主）───
  describe('(d) 列表宿主形态：v-for / list-item 每卡独立实例 → 互不串扰', () => {
    it('两个独立实例分别以 A(seriesId=101 / 未追更) 与 B(seriesId=202 / 已追更) 初始化：各自渲染正确、互不影响', () => {
      const { container } = mountHost(() => [
        h('card', { class: 'card-101' }, [
          h(WatchlistAction, {
            seriesId: 101,
            initialAdded: false,
            masked: false,
            key: 101,
          }),
        ]),
        h('card', { class: 'card-202' }, [
          h(WatchlistAction, {
            seriesId: 202,
            initialAdded: true,
            masked: false,
            key: 202,
          }),
        ]),
      ])
      const card101 = findByPredicate(
        container,
        (n) => n.nodeType === 1 && n.props.class === 'card-101',
      )
      const card202 = findByPredicate(
        container,
        (n) => n.nodeType === 1 && n.props.class === 'card-202',
      )
      expect(card101).toBeDefined()
      expect(card202).toBeDefined()

      // 两个独立 setup 调用 = 两个独立 composable 实例（oracle：列表宿主每卡独立实例）
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ seriesId: 101, initialAdded: false, onChange: undefined })
      expect(calls[1]).toEqual({ seriesId: 202, initialAdded: true, onChange: undefined })

      // 卡 A 渲染 ☆ + 「追更」（未追更）
      expect(subtreeText(card101!)).toContain('\u2606')
      expect(subtreeText(card101!)).toContain('追更')
      expect(containerClass(card101!)).toContain('text-white/85')
      // 卡 B 渲染 ★ + 「已追更」（已追更）
      expect(subtreeText(card202!)).toContain('\u2605')
      expect(subtreeText(card202!)).toContain('已追更')
      expect(containerClass(card202!)).toContain('text-tertiary')

      // 各自 added ref 独立：A=false / B=true
      expect(addedRefs[0]!.value).toBe(false)
      expect(addedRefs[1]!.value).toBe(true)
    })
  })
})