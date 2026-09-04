# Spec: app-lynx 数据层迁移到 TanStack Vue Query v5

- 关联：[ADR-0141-app-lynx-vue-query-migration.md](../adr/ADR-0141-app-lynx-vue-query-migration.md)（决策依据，accepted）
- 状态：accepted
- 日期：2026-09-03（ready-for-agent）/ 2026-09-04（accepted，用户拍板 D1-D9 + T1-T7 顺序 + bundle +33 KB 可接受）
- 目标包：`packages/app-lynx`

## Problem Statement

vue-lynx 官方 [data-fetching 指南](https://vue.lynxjs.org/zh/guide/data-fetching) 推荐 TanStack Vue Query v5，官方 `examples/networking` 与 hackernews 端口均落地使用。app-lynx 当前零 vue-query（验证 #1），全栈自研：

- `api/client.ts` 200 行手写 fetch 调度（GET 去重 / 401 重试 / 原生桥转发）
- 6 个 instance primitives（`createMixFeed` / `useComments` / `useSearch` / `createBookmarkToggle` / `createWatchlistToggle` / `createFabMenu` 等）

完全替换方向（用户拍板）已被 prototype 验证可行，但需保留：

1. **apiClient seam**（ADR-0037 / ADR-0099 反复打磨的 Pixiv 网关）—— 401 单飞锁 / 原生桥转发 / `shouldAttachAuth` SSRF 防护
2. **generation-gate 模式**（项目所有 instance primitive 通用 pattern）—— lynx fetch 的 AbortSignal 是 no-op（调研结论），Vue Query 的 `cancelQueries` 在 lynx 上不够
3. **createMixFeed 多源混合编排**（350+ 行深模块）—— 比例交替合并 + 双防抖 + 节流吞事件补触发 + 全局去重无法用 Vue Query 内置 API 等价

约束条件：

- lynx fetch 的 `AbortSignal` 调研结论是 no-op（issue #798 + 文档无 signal 选项说明 + 社区 0 条 issue）
- lynx 无 `window.focus` 事件，`refetchOnWindowFocus` 在 lynx 上默认 no-op
- bundle 增量 +163 KB raw（与 web +170 KB 一致，按比例 gzipped 约 +14-16 KB）

## Solution

按 ADR-0141 决策 D1-D7 推进：

### 1. 基础设施层（foundation）

新增 `src/api/queryKeys.ts`（queryKey 工厂）+ `src/api/queryClient.ts`（全局 QueryClient 单例 + 默认配置）+ `src/primitives/useGenerationGate.ts`（signal → disposed 标志 helper）+ `src/primitives/useApiQuery.ts`（queryFn 调 apiClient + generation-gate 包装薄封装）。

新增 `src/composables/useBookmarkMutation.ts` / `src/composables/useWatchlistMutation.ts` —— 删除 `createBookmarkToggle.ts`（87 行）+ `createWatchlistToggle.ts`（76 行）。

### 2. 通用读场景迁 Vue Query

`useComments` list + replies 迁 `useInfiniteQuery`（根评论）+ `useQuery`（楼层缓存）。`useSearch` 双游标 / debounce 编排保留 wrapper，list 部分迁 `useInfiniteQuery`。

「设置页 - 更新检查」先做（最简无 mutation 场景），验证 QueryClient + queryKeys 工厂 + 测试 pattern 三件套。

### 3. 通用写场景迁 useMutation

收藏 / 追更 / 关注 / 评论发布 / 评论删除全部迁 `useMutation`。乐观翻转 + 失败回滚 + 350ms 动画延迟通过 `onMutate` / `onError` / `onSuccess` 编排。

### 4. createMixFeed 保留 + 内部简化

外部 API 零变化（消费方不感知）。内部多源拉取改用 `useQueries`（取消手写 `Promise.all` + AbortController + signal 透传），merge / 防抖 / 补触发 / generation-gate 等编排保留为模块内部逻辑。

### 5. bench 兜底

最后一步真机（pictelio_ui 模拟器）跑滚动态跟手性 map #304 bench，确认无回归。

## User Stories

1. 作为 app-lynx 开发者，我希望 `src/api/queryKeys.ts` 集中定义所有 query key（避免散落 string literal），以便 `invalidateQueries({ queryKey: queryKeys.illusts.all })` 前缀匹配批量失效且类型安全
2. 作为 app-lynx 开发者，我希望 `src/api/queryClient.ts` 导出全局单例 QueryClient 并配置默认值（`refetchOnWindowFocus: false` / `gcTime: 30s` / `retry: false`），以便所有 useQuery 自动继承而无需每处重复配
3. 作为 app-lynx 开发者，我希望 `useApiQuery(queryKey, queryFn, options)` 薄封装自动包装 generation-gate（signal → disposed 标志 → 旧响应丢弃），以便 queryFn 内部不需要关心竞态防护
4. 作为 app-lynx 开发者，我希望 `createBookmarkToggle` / `createWatchlistToggle` 删除后由 `useBookmarkMutation(illustId)` / `useWatchlistMutation(seriesId)` 替代，以便 Bookmarks 页 / 追更页的乐观翻转 + 失败回滚 + 350ms 动画延迟契约由 Vue Query 内置 API 编排
5. 作为 app-lynx 开发者，我希望 `useComments` list 部分迁 Vue Query 后 mutation（发布 / 删除 / 楼层展开）也统一用 `useMutation`，以便评论模块与项目其他写场景一致使用 `isPending` / `mutate` / `mutateAsync` API
6. 作为 app-lynx 开发者，我希望 `createMixFeed` 外部 API（`items()` / `loading()` / `error()` / `fetchMore()` / `refresh()` / `dispose()`）零变化，以便 Recommended / NovelList 页面与现有 6 个 `createMixFeed.test.ts` 单测 0 修改
7. 作为 app-lynx 维护者，我希望 `apiClient` 接口与 `src/api/client.ts` 行为零变化，以便 webview 客户端 + Android 原生 401 刷新契约不被破坏（ADR-0037 网关 seam）
8. 作为 app-lynx 维护者，我希望 Vue Query devtools 仅 dev 安装（`@tanstack/vue-query-devtools` 已在 devDependencies）并在 production 构建自动 tree-shake，以便生产 bundle 不增加体积
9. 作为 app-lynx E2E 验证人员，我希望 collection / watchlist / comments / search 操作（toggle / 翻页 / 发布）在 Android 模拟器端到端验证无回归，以便 ADR-0112 决策 4 的 350ms 动画延迟契约、ADR-0104 的双错误槽位、ADR-0115 的多源合并语义全部守约
10. 作为 app-lynx 真机 bench 人员，我希望滚动态跟手性 map #304 在迁移前后 bench 数据无显著漂移（ABBA 残差 ≤ 1pp），以确认 Vue Query 内部 observer 订阅不会引入额外渲染开销
11. 作为项目维护者，我希望 ADR-0139 / ADR-0140 的 Pinia 改造不受本次迁移影响（client state 仍走 Pinia / server state 走 Vue Query），以便两套状态管理边界清晰
12. 作为项目维护者，我希望原型 POC `packages/app-lynx/prototype/vue-query-poc/index.html` 在主分支保留（throwaway branch 归档），以便后续维护者按按钮复现 6 个核心不变量的验证结论

## Implementation Decisions

### 文件结构

新增：

- `src/api/queryKeys.ts` — queryKey 工厂（参照 web 端 `api/queryKeys.ts` 形态）
- `src/api/queryClient.ts` — 全局 QueryClient 单例 + `VueQueryPlugin` 配置
- `src/composables/useApiQuery.ts` — useQuery + generation-gate 薄封装
- `src/composables/useApiInfiniteQuery.ts` — useInfiniteQuery + generation-gate 薄封装（带 `kind: 'first' | 'pagination'` ApiError）
- `src/composables/useBookmarkMutation.ts` — useMutation + 乐观翻转 + 350ms 动画延迟（替代 createBookmarkToggle）
- `src/composables/useWatchlistMutation.ts` — useMutation + 乐观翻转（替代 createWatchlistToggle）
- `src/composables/useFollowMutation.ts` — useMutation + 关注/取关
- `src/api/__tests__/queryKeys.test.ts` — queryKey 工厂测试
- `src/api/__tests__/queryClient.test.ts` — QueryClient 默认配置测试
- `src/composables/__tests__/useApiQuery.test.ts` — generation-gate 薄封装测试
- `src/composables/__tests__/useBookmarkMutation.test.ts` — 替代 createBookmarkToggle.test.ts 的新测试

修改：

- `src/index.ts` — 挂载 `VueQueryPlugin`
- `src/api/illust.ts` / `novel.ts` / `user.ts` / `search.ts` / `comment.ts` / `auth.ts` — 不动接口签名（queryFn 调 apiClient）
- `src/primitives/createMixFeed.ts` — 内部多源拉取改 useQueries（**R3 实际路径**：factory 形态 vs useQueries 矛盾，改用 AbortController + signal 透传，外部 API 不变；详见 ADR-0141 R2 注记）
- `src/primitives/useComments.ts` — 内部 list 部分改 useInfiniteQuery（**R3 范围收窄**：业务编排与 useInfiniteQuery 抽象能力不兼容，consumer 未迁，useApiCommentsQuery composable 工具层仅就位）
- `src/primitives/useSearch.ts` — 内部 list 部分改 useInfiniteQuery（**R3 范围收窄**：debounce / scope/sort 切 / 双游标 / merge 编排保留，consumer 未迁）
- 各页面组件 — 从「`primitive.state.comments`」改为「`useApiInfiniteQuery(...)` 返回值 + `storeToRefs`」**（R3 未实施 — 详见 R4 决策）**

删除：

- `src/primitives/createBookmarkToggle.ts`（87 行）— **R4 决策：保留**（composable 形态不适配 Watchlist.vue list 工厂 per-item 场景；5 个原测试保护不变量）
- `src/primitives/createWatchlistToggle.ts`（76 行）— **R4 决策：保留**（同 createBookmarkToggle 理由）
- `src/primitives/createBookmarkToggle.test.ts`（被 useBookmarkMutation.test.ts 替代）— **R4 决策：保留**（createBookmarkToggle 保留故测试也保留）
- `src/primitives/createWatchlistToggle.test.ts`（被 useWatchlistMutation.test.ts 替代）— **R4 决策：保留**（同 createWatchlistToggle 保留理由）
- `src/composables/useWatchlistMutation.ts`（69 行）— **R4 决策：已删**（composable 形态不适配 list 工厂；commit 304d5f07 删除）

### R4（2026-09-04 修订）— spec 字面 vs 实际 diff 偏离决策记录

按 ADR-0141 R3 hard rule「spec 字面要求 vs 实际 diff 偏离时必须在 commit message 显式记录范围收窄决策」补全 R4 决策表。code-review 双轴 F9 阻塞 finding「spec 字面要求与实际 diff 多处偏离未拍板」全清单：

| # | spec 字面承诺 | 实际 diff | R4 决策 | 阻塞 finding | 跟踪 |
|---|---|---|---|---|---|
| 1 | src/composables/useApiQuery.ts | 实现在 src/primitives/useApiQuery.ts | **保留 primitives/**（vue-query 5.x composable hook helper 与原始 useComments/useSearch 等 factory primitive 同目录语义；非 composable mutation/infinite query 形态） | 路径漂移 | 已 commit + R4 文档化 |
| 2 | src/composables/useApiInfiniteQuery.ts | 实现在 src/primitives/useApiInfiniteQuery.ts | 同 #1 | 同 #1 | 同 #1 |
| 3 | useComments 内部 list 改 useInfiniteQuery | 实际未迁 | **R4 决策：范围收窄**——useApiCommentsQuery composable 工具层就位，consumer 迁移独立 ticket | F5（Oracle 阻塞）| T8（独立 effort） |
| 4 | useSearch 内部 list 改 useInfiniteQuery | 实际未迁 | **R4 决策：范围收窄**——useSearch 业务编排更深（debounce / scope/sort / 双游标 / merge），超 useInfiniteQuery 抽象能力 | F6 | T9（独立 effort） |
| 5 | 删除 createBookmarkToggle.ts | 实际未删 | **R4 决策：保留**（factory 形态，composable 不适配 list 工厂 per-item） | F10 (R3 deferred) | T10（独立 effort 评估迁移路径） |
| 6 | 删除 createWatchlistToggle.ts | 实际未删 | 同 #5 | F10 | T10 |
| 7 | useFollowMutation composable | 实际未存在 | **R4 决策：推迟**——关注/取关不是 spec T4 关键路径，watchlistStore / bookmark store 已迁移 | 阻塞 finding F6 子项 | T11（独立 effort） |
| 8 | createMixFeed 改 useQueries | 实际改 AbortController + signal 透传 | **R4 决策：路径偏离**（factory vs useQueries 形态对立；用 AbortController + signal 达到同样目的） | 阻塞 finding 路径偏离 | 已在 ADR-0141 R2 commit 585f5c0c 自承 |
| 9 | __tests__/ 目录测试 | 实际 colocate 测 | **R4 决策：保留 colocate**（vitest 约定跟随源码；非 spec 强约束） | 路径漂移 | — |

### R4 TDD oracle 补强记录

code-review F7/F8 修复后，13 个新测试（useApiQuery.test.ts 11 + useApiInfiniteQuery.test.ts 7）部分 oracle 提升：
- useApiQuery 写真 apiClient + globalThis.fetch 集成（spyOn 第三参验证 signal 透传）
- createMixFeed 写真首载 path signal + refresh 路径旧 controller abort + 新 signal 隔离
- useApiInfiniteQuery 类型 bug 修复（TData 默认 = InfiniteData<TQueryFnData>）

仍待补 oracle：
- useApiCommentsQuery 派生层端到端测试（vue-query 5.x hooks 需 setup() 上下文 + 真 component mount，仓库无 @vue/test-utils 依赖；端到端由 useApiInfiniteQuery.test.ts 7 个 wrap 测试 + T7 真机 bench 兜底）

### R4 真机 bench 兜底（ADR-0141 R2 + commit 304d5f07）

- benchNav=illust → 推荐 sub-tab + 4 卡渲染（M3 FAB + 标签 + 心数）
- benchNav=illust-follow → 关注 sub-tab + T6 双错槽位 first banner（HTTP 500 中文文案）
- bookmark toggle → useBookmarkMutation 触发 + M3 动画（bookmark-pop-add + bookmark-ring-out）320ms + 失败回滚契约保留
- T6 fix 后 0 errors / 0 warnings
- bundle 939.6 KB（baseline 758.9 → +180.7 KB）

### 默认 QueryClient 配置（来自 ADR-0141 D4）

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 30 * 1000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      placeholderData: keepPreviousData,
      structuralSharing: true,
    },
    mutations: { retry: false },
  },
})
```

### queryKey 工厂（参考 web 端 `api/queryKeys.ts`）

```ts
export const queryKeys = {
  all: ['pictelio'] as const,
  illusts: {
    all: ['pictelio', 'illusts'] as const,
    detail: (id: number) => ['pictelio', 'illusts', id] as const,
    recommended: () => ['pictelio', 'illusts', 'recommended'] as const,
    comments: (id: number) => ['pictelio', 'illusts', id, 'comments'] as const,
  },
  novels: {
    all: ['pictelio', 'novels'] as const,
    detail: (id: number) => ['pictelio', 'novels', id] as const,
    recommended: () => ['pictelio', 'novels', 'recommended'] as const,
  },
  users: {
    all: ['pictelio', 'users'] as const,
    detail: (id: number) => ['pictelio', 'users', id] as const,
    illusts: (id: number) => ['pictelio', 'users', id, 'illusts'] as const,
  },
  search: {
    all: ['pictelio', 'search'] as const,
    illust: (q: string) => ['pictelio', 'search', 'illust', q] as const,
    novel: (q: string) => ['pictelio', 'search', 'novel', q] as const,
  },
  watchlist: {
    all: ['pictelio', 'watchlist'] as const,
  },
  settings: {
    all: ['pictelio', 'settings'] as const,
    updateCheck: () => ['pictelio', 'settings', 'update-check'] as const,
  },
} as const
```

### useApiQuery helper（来自 ADR-0141 D6）

```ts
export function useApiQuery<T>(opts: {
  queryKey: QueryKey
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>
}) {
  const client = useQueryClient()
  return useQuery({
    ...opts,
    queryFn: async (ctx) => {
      let disposed = false
      ctx.signal.addEventListener('abort', () => { disposed = true })
      try {
        const data = await opts.queryFn(ctx)
        if (disposed) throw new Error('stale')
        return data
      } catch (e) {
        if (disposed) throw new Error('stale')
        throw e
      }
    },
  })
}
```

### useBookmarkMutation（替代 createBookmarkToggle）

```ts
const BOOKMARK_ANIMATION_MS = 350

export function useBookmarkMutation(
  illustId: number,
  initialBookmarked: Ref<boolean>,
  initialCount: Ref<number>,
  onChange?: (bookmarked: boolean) => void,
) {
  const bookmarked = ref(initialBookmarked.value)
  const count = ref(initialCount.value)
  return useMutation({
    mutationFn: (target: boolean) =>
      apiClient.post(target ? '/v2/illust/bookmark/add' : '/v1/illust/bookmark/delete', {
        illust_id: String(illustId),
      }),
    onMutate: (target) => {
      bookmarked.value = target
      count.value = Math.max(0, count.value + (target ? 1 : -1))
    },
    onError: (_e, target) => {
      bookmarked.value = !target
      count.value = Math.max(0, count.value + (target ? -1 : 1))
    },
    onSuccess: (target) => {
      setTimeout(() => onChange?.(target), BOOKMARK_ANIMATION_MS)
    },
  })
}
```

### useApiInfiniteQuery helper（带 first/pagination 双错误槽位）

```ts
class QueryApiError extends Error {
  constructor(public kind: 'first' | 'pagination', public cause: ApiError) {
    super(cause.message)
  }
}

export function useApiInfiniteQuery<T>(opts: {
  queryKey: QueryKey
  queryFn: (ctx: { signal: AbortSignal; pageParam: unknown }) => Promise<{ items: T[]; nextUrl: string | null }>,
  initialPageParam: unknown,
  getNextPageParam: (last: { items: T[]; nextUrl: string | null }) => unknown,
}) {
  return useInfiniteQuery({
    ...opts,
    queryFn: async (ctx) => {
      try {
        return await opts.queryFn(ctx)
      } catch (e) {
        if (ctx.pageParam == null) throw new QueryApiError('first', e as ApiError)
        throw new QueryApiError('pagination', e as ApiError)
      }
    },
  })
}
```

组件层派生：

```ts
const firstError = computed(() => query.error.value?.kind === 'first' ? query.error.value.cause : null)
const pageError = computed(() => query.error.value?.kind === 'pagination' ? query.error.value.cause : null)
```

## 测试策略

### 单元测试

- queryKey 工厂：每个 key 序列化稳定（用 `queryKeyHashFn` 验证）
- useApiQuery：signal abort → disposed → 旧响应不写回缓存
- useApiInfiniteQuery：first error vs pagination error 双 kind
- useBookmarkMutation：乐观翻转 / 失败回滚 / 350ms onChange / busy 锁（mutateAsync 期间二次 mutate 静默忽略）
- createMixFeed 外部 API：`items()` / `loading()` / `error()` / `fetchMore()` / `refresh()` / `dispose()` 6 个测试不变

### 集成测试

- apiClient 不动 → 现有 `api/client.test.ts`（13 个 IO 边界用例）零回归
- 401 重试：mock fetch 首次返回 401 → 仅触发一次 refresh

### 真机 bench

T7 ticket 跑滚动态 map #304 bench（ABBA 残差 ≤ 1pp）。

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| bundle +163 KB raw 影响 OTA 升级流量 | T7 bench 后用户拍板是否可接受；如不可接受回滚到 Pinia-only 状态（删除 vue-query 即可） |
| 页面渲染回归（useQuery 内部 observer 订阅导致 re-render 频率变化） | T7 真机 bench + 推荐页 bench 重点关注 |
| createMixFeed 内部改 useQueries 引入意外 behavior | T6 ticket 跑 `createMixFeed.test.ts` 全量用例 + Recommended 页 bench |
| 350ms 动画延迟契约被破坏 | T4 ticket 用单测断言 `setTimeout(onChange, 350)` 顺序与时机 |
| 双错误槽位（first/pagination）回归 | T5 ticket 用单测断言 `error.kind === 'first'` 时 banner 全屏，`'pagination'` 时 inline |

## 反决策（暂不动）

- apiClient seam（ADR-0037）
- createMixFeed 外部 API
- watchlistStore（ADR-0139 决策 8 排除）
- 7 个 client-state Pinia store
- 401 单飞锁迁移到 vue-query（破坏 Java 侧 PixivApiCore.synchronized 契约）

## 修订注记

### R1（2026-09-03 真机实测）

详见 [ADR-0141 修订注记](../adr/ADR-0141-app-lynx-vue-query-migration.md#r1修订注记)。要点：

- lynx fetch `AbortSignal` 真的能取消（117ms，`AbortError`）—— D6 generation-gate 仍必要但理由从「signal no-op」改为「旧响应晚于新 query」
- lynx fetch **DNS 失败 resolve 而非 reject** —— queryFn 必须用 `res.ok === false` 判 HTTP 错误，不能依赖 try/catch
- `cancelQueries` 不取消 fetch —— queryFn 必须 `signal.addEventListener('abort')` 主动丢弃响应
- `fetchQuery` 不复用缓存 —— 生产代码统一 `useQuery`
- bundle 实际增量 **+33 KB raw**（tree-shake 后，远小于调研估算的 +163 KB）—— 大幅优于预期

## 待办（待用户拍板）

- [ ] 用户对 ADR-0141 + spec + R1 修订注记拍板：接受 D1-D7 + D8-D9
- [ ] 决定 T1-T7 ticket 顺序是否微调
- [ ] 决定 bundle 增量 +33 KB raw 是否可接受（实测）

## Ticket 拆分（提交到 GitHub Issues）

> ticket 号将在 `gh issue create` 后回填；当前用 T1-T7 标识。

| # | 标题 | 内容 | 前置依赖 | 风险 | 估时 |
|---|---|---|---|---|---|
| **T1** | spike：dev 模式注入最小 useQuery 看实际 console 行为 | 在 `__proto_fetch_probe.ts`（已存在原型）基础上：① 最小 `useQuery` 跑通 ② console 0 errors / 0 warnings ③ HMR 工作 | — | 0 | 1 天 |
| **T2** | foundation：装入 vue-query + QueryClient + VueQueryPlugin + queryKeys 工厂 + useApiQuery helper | 新增 `src/api/queryKeys.ts` / `src/api/queryClient.ts` / `src/composables/useApiQuery.ts` / `useApiInfiniteQuery.ts` / `useGenerationGate.ts`；在 `src/index.ts` 挂 `VueQueryPlugin`；新增对应测试 | T1 | 低 | 2 天 |
| **T3** | settings-update：设置页「更新检查」迁 `useQuery`（最简场景） | 把 `updateStore.runStartupUpdateCheck` 内部实现改用 `useQuery`，验证 QueryClient + queryKeys 工厂 + 测试 pattern 三件套 | T2 | 低 | 1 天 |
| **T4** | mutations：createBookmarkToggle / createWatchlistToggle → useBookmarkMutation / useWatchlistMutation | 删除 2 个 primitive（共 163 行），新增 2 个 composable + 测试；Bookmarks 页 / 追更页消费方切换；保留 `BOOKMARK_ANIMATION_MS = 350` 常量值不变 | T2 | 中 | 2 天 |
| **T5** | lists：useComments / useSearch list 部分迁 `useInfiniteQuery` | mutation 部分用 `useMutation`；list 部分用 `useApiInfiniteQuery`（带 `kind: 'first' \| 'pagination'` ApiError 双槽位）；组件层派生 firstError / pageError | T2 | 中 | 3 天 |
| **T6** | mixfeed-refactor：createMixFeed 内部改 useQueries + 自研 merge（外部 API 不变） | 内部多源拉取改 `useQueries`（取消手写 `Promise.all` + AbortController）；merge / 防抖 / 补触发 / generation-gate 编排保留；外部 6 个 getter + 3 个 action 签名不变；现有 `createMixFeed.test.ts` 单测 0 修改 | T2 | 中 | 3 天 |
| **T7** | bench：真机（pictelio_ui 模拟器）跑滚动态 map #304 bench + 收藏/追更/评论交互回归 | 推荐页滚动态跟手性 ABBA 残差 ≤ 1pp；bookmark toggle / watchlist toggle / comments 全部 interaction 0 回归；T6 mixfeed 内部改 useQueries 后无 behavior 漂移 | T3-T6 | 0 | 2 天 |

**T1 spike 先做**（验证本组合可用性）→ **T2 foundation 做底座**（后续 ticket 共享基座）→ **T3 settings-update 验证基础**（最低风险替换）→ **T4-T6 并行展开，每个 ticket 都要 code-review 双轴门禁把关**（mutation / list / mixfeed 三个独立模块）→ **T7 bench 兜底**。

每个 ticket 提交时遵守：
- 关闭前必须 `pnpm check:app-lynx` + `pnpm test:app-lynx` + bundle size 检查
- 涉及字段名 / 常量 / 配置值变化必须同步更新对应契约测试
- 乐观更新 / 错误处理路径必须有 `console.warn` 或显式暴露错误状态（AGENTS.md 测试硬约束 §3）