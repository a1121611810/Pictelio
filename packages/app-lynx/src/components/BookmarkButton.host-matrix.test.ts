// ─── BookmarkButton 宿主矩阵测试（T3，spec docs/specs/qa-defense-lines.md §3.T3 + §0 术语「宿主矩阵」「init-only props」）───
//
// 被测契约：BookmarkButton 的状态机 useBookmarkMutation 只在组件 setup 时读一次 props
// （illustId / initialBookmarked / bookmarkCount → init-only props，此后 props 变更不生效）。
//
// 期望值出处（Oracle 溯源，禁止从被测实现反推）：
// - 「宿主必须按作品 :key remount」契约 = ADR-0163（qa-defense-lines）+ spec §3.T3.2；
// - 真实缺陷 = commit 44ee6401：推荐页单卡轮播宿主（Recommended.vue / CarouselSwiper 槽位）
//   中 BookmarkButton 绑定 currentItem 且无 :key，实例跨 slide 持久 → 收藏数恒显示首卡值
//   （用户观察恒 135），且点任意卡的 ♥ 实际收藏的是首卡（illustId 冻结）；
//   修复 = :key="currentItem.key"（feed 跨 kind 唯一键 `i-<id>` / `n-<id>`，2026-09-21 票 #707 起；
//   旧值 currentItem.data.id 在插画/小说 id 数值相同时会让 Vue 跨 kind 复用同一实例）每卡强制重挂载
//   （Recommended.vue [lynx:fix] 注释）；
// - 快速收藏载荷 restrict=public = spec docs/specs/bookmark-tags.md D3（与
//   useBookmarkMutation.test.ts 同口径）。
//
// ─── init-only props 组件审计（spec §3.T3.1；grep 口径：`initial[A-Z]` 命中 + 「defineProps
// ─── 后 setup 时把 props 一次性传入 composable/store 构造」模式，全量排查
// ─── packages/app-lynx/src/**/*.vue，2026-09-16）─────────────────────────────
//
// | 组件                | init-only 读取点                                        | 宿主形态                                                                     | 风险结论 |
// |--------------------|--------------------------------------------------------|-----------------------------------------------------------------------------|---------|
// | BookmarkButton.vue | setup 一次传入 useBookmarkMutation({ illustId, initialBookmarked, initialCount }) | ① 列表宿主：IllustList / Following / Bookmarks / UserHome（v-for / list-item 每卡独立实例）；② 复用宿主：Recommended.vue 轮播槽位（实例跨 slide 持久，分「插画滑页」与「小说滑页 targetKind=novel」两种形态——见本文件 (c)）；③ 详情单实例：IllustDetail.vue（注入页面级 mutation） | ①③ 无风险；② 曾发生状态冻结（44ee6401 真实缺陷），已 :key remount 修复，本文件锁死该契约 |
// | IllustDetail.vue   | setup 一次传入 useBookmarkMutation({ illustId: illust.id, initialBookmarked: false, initialCount: 0 }) | 单作品页面级实例（路由切换即重建页面）                                        | 无风险（不存在同一实例跨作品复用） |
// | BookmarkPanel.vue  | useBookmarkPanel({ getIllustId: () => props.illustId, ... }) —— getter 形态 | 详情页弹层（v-if 挂载）                                                  | 无风险（响应式 getter，非 init-only；是 init-only 的正确替代写法对照） |
// | CarouselSwiper.vue | spec 点名的「嫌疑宿主侧」：自身实例跨 slide 持久，但 slides 数组为响应式、无 init-only 的 per-item props | 唯一宿主 = Recommended.vue                                              | 组件本身无 init-only 风险；风险在其槽位内容（即 BookmarkButton，见上），宿主侧由 :key="refreshEpoch"（swiper 本体）+ :key="currentItem.key"（BookmarkButton）双保险 |
//
// 其余 defineProps 组件（RestrictOverlay / CoverImage / TagChipRow / GlassCard 等）均把 props
// 用于模板内响应式绑定或 getter 透传，无「setup 一次性消费 props 构造状态」的形态，无 init-only 风险。
//
// ─── 为何编译真实 SFC 挂载（而非沿用 *.template.test.ts 的源码断言）──────────────
// 「同一实例 props 变更后状态冻结」是运行时行为语义，源码断言无法覆盖；仓库无 vue-lynx 渲染器
// （BookmarkButton.template.test.ts 头注）且未声明 @vue/test-utils 依赖。故本文件在测试期用
// vue/compiler-sfc 编译真实 BookmarkButton.vue + node:module stripTypeScriptTypes 剥离类型 +
// createRenderer 自定义 nodeOps 渲染器挂载——自定义渲染器只承载 Vue patch 语义（类绑定 /
// 文本 / 事件 / 同实例 patch），不承载 Lynx 原生 view/text 语义（模板形状仍由
// BookmarkButton.template.test.ts 锁定）。若 SFC 未来新增 import，模块映射表会显式抛错提示补表。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import {
  compileScript,
  parse,
} from 'vue/compiler-sfc'
import {
  createRenderer,
  h,
  nextTick,
  reactive,
  type Component,
  type VNode,
} from 'vue'
import * as Vue from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import * as bookmarkMutationMod from '../composables/useBookmarkMutation'
import * as longPressMod from '../composables/useLongPress'
import { apiClient } from '../api/client'

// ─── 编译真实 SFC → 可挂载组件定义 ───

interface ImportBinding {
  spec: string
  pairs: Array<{ imported: string; local: string }>
  def?: string
}

/** SFC 编译产物的 import 模块映射表：键 = 源码中的 import 说明符 */
function resolveModule(spec: string): Record<string, unknown> {
  if (spec === 'vue') return Vue
  if (spec === '../composables/useBookmarkMutation') return bookmarkMutationMod
  if (spec === '../composables/useLongPress') return longPressMod
  throw new Error(`未映射的 SFC import：${spec}（BookmarkButton.vue 新增依赖时请在此补表）`)
}

let cachedComponent: Component | null = null

/** 编译并求值 BookmarkButton.vue（同文件只编译一次） */
function loadBookmarkButton(): Component {
  if (cachedComponent) return cachedComponent
  const path = fileURLToPath(new URL('./BookmarkButton.vue', import.meta.url))
  const { descriptor, errors } = parse(readFileSync(path, 'utf8'), { filename: path })
  if (errors.length > 0) throw new Error(`SFC parse 失败：${JSON.stringify(errors)}`)
  // inlineTemplate：模板渲染函数内联进 setup 产物，单模块可直接求值
  const compiled = compileScript(descriptor, { id: 'bookmark-button-host-matrix', inlineTemplate: true })
  // compileScript 产物仍含 TS（interface / 泛型 / 注解），用 Node 内置剥离（仓库 Node ≥ 22.22）。
  // strip 模式即可覆盖本 SFC 的可擦除语法（无 enum / namespace / 参数属性）。
  const js = stripTypeScriptTypes(compiled.content, { mode: 'strip' })

  const bindings: ImportBinding[] = []
  const importRe =
    /import\s+(?:([\w$]+)\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?|import\s+([\w$]+)\s+from\s*['"]([^'"]+)['"];?/g
  let code = js.replace(
    importRe,
    (_m: string, defA?: string, named?: string, specA?: string, defB?: string, specB?: string) => {
      const spec = (specA ?? specB) as string
      const def = defA ?? defB
      // 「X as Y」别名 + inline「type X」修饰（type 标识符在运行时无绑定，剥除）
      const pairs = (named ?? '')
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, ''))
        .filter((s) => s.length > 0 && !s.startsWith('type '))
        .map((s) => {
          const alias = s.match(/^(.+?)\s+as\s+(.+)$/)
          return alias
            ? { imported: alias[1]!.trim(), local: alias[2]!.trim() }
            : { imported: s, local: s }
        })
      bindings.push({ spec, pairs, def })
      const idx = bindings.length - 1
      let stmt = `const __m${idx} = __mods[${idx}];`
      if (def) stmt += ` const ${def} = __m${idx}.default ?? __m${idx};`
      for (const p of pairs) {
        stmt += ` const ${p.local} = __m${idx}[${JSON.stringify(p.imported)}];`
      }
      return stmt
    },
  )
  const exportCount = code.match(/export default/g)?.length ?? 0
  if (exportCount !== 1) throw new Error(`编译产物应恰有一个 export default，实际 ${exportCount} 个`)
  code = code.replace(/export default/g, 'return')

  const registry = bindings.map((b) => resolveModule(b.spec))
  const factory = new Function('__mods', `'use strict';\n${code}`)
  cachedComponent = factory(registry) as Component
  return cachedComponent
}

// ─── 自定义 nodeOps 渲染器（无 DOM 的纯对象节点；只承载 Vue patch 语义）───

interface FakeNode {
  nodeType: number // 1=元素 3=文本 8=注释
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

/** 从父链中摘除节点（兄弟链与 children 数组两套结构同步维护） */
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

/** 低层插入（假定 child 已从旧父摘除）。兄弟链必须真实维护——Vue 的 Fragment 卸载
 * （removeFragment）沿 nextSibling 链遍历到 anchor，断链会在 unmount/remount 时以
 * null.nextSibling 崩溃（本测试首批运行的真实教训，宿主矩阵 (b) remount 场景必经此路径） */
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

/** 心形元素：直接持有 ♥（U+2665）文本子节点的元素（模板里类绑定 text-tertiary-on / text-inverse-on-surface 之所在 —— chip 容器配色（spec §E「Dark Glass」）：未收藏 = inverse-surface 上的前景色，已收藏 = tertiary 上的 on-tertiary，对应心形色类名） */
function findHeart(scope: FakeNode): FakeNode {
  const hit = findByPredicate(
    scope,
    (n) =>
      n.nodeType === 1 &&
      n.children.some((c) => c.nodeType === 3 && (c.text ?? '').includes('\u2665')),
  )
  if (hit === undefined) throw new Error('未找到心形元素（模板 ♥ 文本节点）')
  return hit
}

function heartClass(scope: FakeNode): string {
  return String(findHeart(scope).props.class ?? '')
}

/** 按钮 tap 入口：模板根 view 的 @tap.stop 处理器（withModifiers 包装） */
function tap(scope: FakeNode): void {
  const hit = findByPredicate(scope, (n) => typeof n.props.onTap === 'function')
  if (hit === undefined) throw new Error('未找到 @tap 处理器')
  ;(hit.props.onTap as (e: { stopPropagation(): void }) => void)({ stopPropagation() {} })
}

/** 微任务 + 宏任务双冲刷：等待 toggle 的 mutateAsync 结算与响应式渲染 */
async function flush(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

interface MountedHost {
  unmount(): void
}

// ─── 测试本体 ───

describe('BookmarkButton 宿主矩阵（T3：init-only props 契约，ADR-0163 / commit 44ee6401）', () => {
  let mountedApps: MountedHost[] = []

  afterEach(() => {
    // try/finally：即使 unmount 抛错也必须恢复 mock，否则 spy 泄漏进后续测试（首批运行真实教训）
    try {
      for (const app of mountedApps) app.unmount()
    } finally {
      mountedApps = []
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

  function spyPost(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(apiClient, 'post').mockResolvedValue(undefined as never)
  }

  // ── (a) 列表宿主形态 ──
  describe('(a) 列表宿主形态：v-for / list-item 每卡独立实例（IllustList / Following / Bookmarks / UserHome）', () => {
    it('两个独立实例分别以 props A(illustId 101 / count 10 / 未收藏) 与 B(illustId 202 / count 20 / 已收藏) 初始化：各自渲染正确、互不影响', async () => {
      const postSpy = spyPost()
      const BookmarkButton = loadBookmarkButton()
      const { container } = mountHost(() => [
        // 模拟列表宿主：每张卡一个独立组件实例（key 仅作 v-for 身份，对应宿主 list-item item-key）
        h('card', { class: 'card-101' }, [
          h(BookmarkButton, { illustId: 101, initialBookmarked: false, bookmarkCount: 10, key: 101 }),
        ]),
        h('card', { class: 'card-202' }, [
          h(BookmarkButton, { illustId: 202, initialBookmarked: true, bookmarkCount: 20, key: 202 }),
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

      // 各自初始渲染 = 各自 props（oracle：props 在 setup 一次性建状态机，列表每卡独立实例 → 互不串）
      expect(subtreeText(card101!)).toContain('10')
      expect(subtreeText(card101!)).not.toContain('20')
      expect(heartClass(card101!)).toContain('text-inverse-on-surface') // 未收藏
      expect(heartClass(card101!)).not.toContain('text-tertiary-on')
      expect(subtreeText(card202!)).toContain('20')
      expect(heartClass(card202!)).toContain('text-tertiary-on') // 已收藏
      expect(heartClass(card202!)).not.toContain('text-inverse-on-surface')
      expect(postSpy).not.toHaveBeenCalled()

      // 点第一张卡的 ♥：只影响实例 A（乐观 +1、收藏向），实例 B 不动
      tap(card101!)
      await flush()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v2/illust/bookmark/add', {
        illust_id: '101', // 收藏目标是各自实例的 illustId（101，非 202）
        restrict: 'public', // spec D3 恒公开
      })
      expect(subtreeText(card101!)).toContain('11') // 乐观 +1
      expect(heartClass(card101!)).toContain('text-tertiary-on')
      // 互不影响：B 卡计数与收藏态纹丝不动
      expect(subtreeText(card202!)).toContain('20')
      expect(heartClass(card202!)).toContain('text-tertiary-on')
    })
  })

  // ── (b) 复用宿主形态（契约边界锁定）──
  describe('(b) 复用宿主形态：同一实例跨卡片切换（Recommended.vue 轮播槽位，commit 44ee6401 修复前形态）', () => {
    it('同一实例 props A→B 不 remount：状态机冻结在 A 的初始值（init-only 契约）——这正是宿主必须 :key remount 的原因（ADR-0163）；此测试锁定契约语义，防止未来被静默更改为响应式 props 而无宿主审计', async () => {
      const postSpy = spyPost()
      const BookmarkButton = loadBookmarkButton()
      // 模拟修复前的轮播宿主：同一组件实例，宿主响应式 props 从卡片 A 刷成卡片 B（key 恒定 → patch 复用实例）
      const hostProps = reactive({ illustId: 101, initialBookmarked: false, bookmarkCount: 10, key: 'slide' })
      const { container } = mountHost(() =>
        h(BookmarkButton, {
          illustId: hostProps.illustId,
          initialBookmarked: hostProps.initialBookmarked,
          bookmarkCount: hostProps.bookmarkCount,
          key: hostProps.key,
        }),
      )
      expect(subtreeText(container)).toContain('10')
      expect(heartClass(container)).toContain('text-inverse-on-surface')

      // 宿主切到下一张卡（props A→B），但实例未 remount
      hostProps.illustId = 202
      hostProps.initialBookmarked = true
      hostProps.bookmarkCount = 20
      await flush()

      // init-only 契约：setup 只读一次 props，此后 props 变更不生效 → 渲染仍是 A 的初始值
      expect(subtreeText(container)).toContain('10')
      expect(subtreeText(container)).not.toContain('20')
      expect(heartClass(container)).toContain('text-inverse-on-surface')
      expect(heartClass(container)).not.toContain('text-tertiary-on')

      // 冻结的危害面（44ee6401 用户可见缺陷机理）：此刻点 ♥ 实际收藏的是首卡 101 而非当前卡 202
      tap(container)
      await flush()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v2/illust/bookmark/add', {
        illust_id: '101', // illustId 冻结在首卡 —— 「点任意卡的 ♥ 收藏到错误作品」
        restrict: 'public',
      })
      expect(
        postSpy.mock.calls.every(([, body]: unknown[]) => (body as { illust_id: string }).illust_id === '101'),
      ).toBe(true)
      // 状态机本身仍在以 A 为基准工作：乐观 +1（10→11）+ 收藏向翻转
      expect(subtreeText(container)).toContain('11')
      expect(heartClass(container)).toContain('text-tertiary-on')
    })

    it('复用宿主的修复形态：:key 随作品变化 → 强制 remount → 状态机随新卡 props 重建（回归 commit 44ee6401 修复语义）', async () => {
      spyPost()
      const BookmarkButton = loadBookmarkButton()
      // 模拟修复后的宿主：key 绑定 feed 跨 kind 唯一键（Recommended.vue :key="currentItem.key"）
      const hostProps = reactive({ illustId: 101, initialBookmarked: false, bookmarkCount: 10, key: 101 })
      const { container } = mountHost(() =>
        h(BookmarkButton, {
          illustId: hostProps.illustId,
          initialBookmarked: hostProps.initialBookmarked,
          bookmarkCount: hostProps.bookmarkCount,
          key: hostProps.key,
        }),
      )
      expect(subtreeText(container)).toContain('10')
      expect(heartClass(container)).toContain('text-inverse-on-surface')

      // 切到下一张卡：key 与 props 同时变化 → 旧实例卸载、新实例以 B 的 props 重建
      hostProps.illustId = 202
      hostProps.initialBookmarked = true
      hostProps.bookmarkCount = 20
      hostProps.key = 202
      await flush()

      expect(subtreeText(container)).toContain('20')
      expect(heartClass(container)).toContain('text-tertiary-on')
      expect(heartClass(container)).not.toContain('text-inverse-on-surface')
    })
  })

  // ── (c) 轮播小说宿主形态（Recommended.vue 小说滑页 · spec docs/specs/app-lynx-recommended-novel-bookmark.md）──
  describe('(c) 轮播小说宿主形态：targetKind="novel"（推荐页小说滑页，票 #707）', () => {
    it('novel 形态：init-only props 正确初始化；单击走 novel 端点（add=v2 恒 restrict=public、delete=v1）且收藏态与计数翻转', async () => {
      const postSpy = spyPost()
      const BookmarkButton = loadBookmarkButton()
      const { container } = mountHost(() =>
        // 模拟 Recommended.vue 小说滑页：key 取 feed 的跨 kind 唯一键（n-<id>）而非裸 id
        h(BookmarkButton, {
          key: 'n-901',
          targetKind: 'novel',
          illustId: 901,
          initialBookmarked: false,
          bookmarkCount: 7,
        }),
      )
      // 初始渲染 = props（oracle：useBookmarkMutation 在 setup 一次性读 props，novel 形态共用同一状态机）
      expect(subtreeText(container)).toContain('7')
      expect(heartClass(container)).toContain('text-inverse-on-surface')

      // 单击 → 收藏小说：端点/载荷逐字对齐既有契约 tests/novel-detail-api.test.ts（oracle = Pixiv-Shaft）
      tap(container)
      await flush()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v2/novel/bookmark/add', {
        novel_id: '901',
        restrict: 'public',
      })
      expect(subtreeText(container)).toContain('8') // 乐观 +1
      expect(heartClass(container)).toContain('text-tertiary-on')

      // 再单击 → 取消收藏（add=v2 / delete=v1 的不对称是既有事实，非笔误）
      tap(container)
      await flush()
      expect(postSpy).toHaveBeenLastCalledWith('/v1/novel/bookmark/delete', { novel_id: '901' })
      expect(subtreeText(container)).toContain('7')
      expect(heartClass(container)).toContain('text-inverse-on-surface')
    })

    it('小说滑页换卡：:key 随作品变化 → 强制 remount → 状态机随新小说重建（ADR-0163；跨 kind 唯一键避免插画/小说 id 撞车复用）', async () => {
      const postSpy = spyPost()
      const BookmarkButton = loadBookmarkButton()
      const hostProps = reactive({
        key: 'n-901',
        illustId: 901,
        initialBookmarked: false,
        bookmarkCount: 7,
      })
      const { container } = mountHost(() =>
        h(BookmarkButton, {
          key: hostProps.key,
          targetKind: 'novel',
          illustId: hostProps.illustId,
          initialBookmarked: hostProps.initialBookmarked,
          bookmarkCount: hostProps.bookmarkCount,
        }),
      )
      expect(subtreeText(container)).toContain('7')
      expect(heartClass(container)).toContain('text-inverse-on-surface')

      // 滑到下一本小说：key 与 props 同时变化 → 旧实例卸载、新实例以 B 的 props 重建
      hostProps.key = 'n-902'
      hostProps.illustId = 902
      hostProps.initialBookmarked = true
      hostProps.bookmarkCount = 42
      await flush()

      expect(subtreeText(container)).toContain('42')
      expect(heartClass(container)).toContain('text-tertiary-on')
      expect(heartClass(container)).not.toContain('text-inverse-on-surface')

      // 冻结的危害面（44ee6401 机理）：换卡后点 ♥ 必须作用于**新**小说（902），不得仍是首卡 901
      // （novel B 初始态 = 已收藏 → 点击方向为取消收藏，断言 delete 路径）
      tap(container)
      await flush()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v1/novel/bookmark/delete', { novel_id: '902' })
    })
  })
})
