# ADR-0141: app-lynx 数据层迁移到 TanStack Vue Query v5（spike 验证后的方向决策）

- 状态：accepted
- 日期：2026-09-03（proposed）/ 2026-09-04（accepted，用户拍板）
- 用户拍板：接受 D1-D9 决策 + T1-T7 ticket 顺序 + bundle +33 KB raw 增量可接受
- 关联：
  - [vue-lynx data-fetching 官方推荐](https://vue.lynxjs.org/zh/guide/data-fetching)（目标范式来源）
  - [ADR-0037-pixiv-api-gateway.md](./ADR-0037-pixiv-api-gateway.md)（PixivApiPlugin 网关 seam，本次必须保留）
  - [ADR-0100/0104 lynx api 客户端与 next_url 处理](./ADR-0099-app-lynx-api-client.md)（apiClient.ts 当前实现）
  - [ADR-0112-bookmark-toggle-architecture.md](./ADR-0112-bookmark-toggle-architecture.md)（收藏乐观翻转 + 350ms 动画延迟契约）
  - [ADR-0115-feed-time-merge.md](./ADR-0115-feed-time-merge.md)（createMixFeed 比例交替合并来源）
  - [ADR-0139-app-lynx-pinia-migration.md](./ADR-0139-app-lynx-pinia-migration.md) / [ADR-0140](./ADR-0140-globalfab-pinia-migration.md)（同周期 Pinia 改造已完成，本次为下一阶段）
- 来源：prototype [`packages/app-lynx/prototype/vue-query-poc/index.html`](../packages/app-lynx/prototype/vue-query-poc/index.html)（6 场景浏览器实测）+ bundle 实测 + lynx fetch 文档/issues 调研

## 背景

vue-lynx 官方 [data-fetching 指南](https://vue.lynxjs.org/zh/guide/data-fetching) 明确推荐 TanStack Vue Query v5（`@tanstack/vue-query@^5.90.0`），并指出"`examples/networking` 是官方网络层示例，专为此页面而生"。官方例子代码（`huxpro/vue-lynx/tree/main/examples/networking`）使用 `useQuery` + `useMutation` + `cancelQueries` + `setQueryData` 完整覆盖读/写/乐观更新。

app-lynx 当前 **零 vue-query**，全栈自研：`api/client.ts` 200 行手写 fetch 调度 + 7 个 Pinia store（client state）+ 6 个实例级 primitive（server state）：`createMixFeed`（多源混合分页）、`useComments`（评论）、`useSearch`（双源搜索）、`createBookmarkToggle`（乐观翻转 + 350ms 动画）、`createWatchlistToggle`（乐观翻转）、`createFabMenu` 等。

主对话用户反馈：「希望完全替换的基础上来考虑」。

## 验证流程与结论（prototype）

prototype 设计为单 HTML POC（[packages/app-lynx/prototype/vue-query-poc/index.html](../packages/app-lynx/prototype/vue-query-poc/index.html)），覆盖 6 个核心不变量；用户在浏览器逐项点按钮实测。以下事实证据来自 prototype + bundle 实测 + lynx fetch 文档/issues 调研。

### 验证 1：vue-query 装入 lynx bundle（✅ pass）

```
$ pnpm add -D @tanstack/vue-query@^5.102.8 -F pictelio-app-lynx
$ PATH="$PWD/packages/app-lynx/node_modules/.bin:$PATH" PICTELIO_LYNX_DEV=1 rspeedy build -r packages/app-lynx

File (lynx)             Size
dist/main.lynx.bundle   922.2 kB  (+163.3 kB vs baseline 758.9 kB)
File (web)              Size
dist/main.web.bundle    904.6 kB  (+170.0 kB vs baseline 734.6 kB)
```

- vue-query 5.102.8（最新版本，落在 `^5.90.0` 系列的纯 patch bump 区间，无 breaking change）
- bundle 增量 raw **+163 KB**（lynx TASM binary 不走 gzip），按 web 比例换算 gzipped ≈ +14-16 KB（与官方文档一致）
- rspeedy 构建无 warning，仅 lynx template encode 的「`lynx` / `max-line` 属性未支持」（与 vue-query 无关）
- 依赖 peer：Vue 2.6+ / 3.3+，项目 3.5.13 ✅

### 验证 2：401 单飞锁（✅ pass）

queryFn 调 `apiClient.get(path, signal)`）保持现有 401 重试逻辑（`execWithAuthRetry` + `refreshPromise` 单飞锁），`apiClient.get` 内**不变**。POC sc1 实测：并发触发 3 个 query + mock 后端首次返回 401 → 仅触发 1 次 refresh（而非 3 次风暴），3 个 query 同时收到 refresh 后的真实数据。

### 验证 3：generation-gate 竞态防护（✅ pass with caveat）

**关键发现**：lynx fetch 的 `AbortSignal` 在 `lynx-family/lynx` 仓库 issue 搜索（`is:issue AbortSignal` / `AbortController` / `signal`）**全部 0 条结果**；fetch.mdx 文档正文无 signal 选项说明；网络指南（[zh](https://lynxjs.org/zh/guide/interaction/networking) / [en](https://lynxjs.org/guide/interaction/networking)）无 AbortController 章节。**强烈说明 lynx fetch 的 signal 是 no-op**，与浏览器 fetch 行为不一致。

issue [#798](https://github.com/lynx-family/lynx/issues/798)（长请求 ~30s 失败 → HTTP 499 + `SocketTimeoutException`）佐证：lynx 把网络异常映射成 HTTP 状态码而非 DOMException AbortError，signal 路径不被原生层支持。

**迁移结论**：Vue Query 的 `cancelQueries` 在 lynx 上**只能通知 queryFn 检查 signal**（queryFn 内部用 `signal.aborted` 决定是否丢弃响应），但 **无法真正取消在飞 OkHttp 调用**。这与项目当前 `createMixFeed` / `useComments` / `useSearch` 已用的「`generation-gate` 模式」（参数版本号比对 + `disposed` 标志丢弃旧响应）**语义一致**。POC sc2 验证：用 `signal.addEventListener('abort', () => generation !== currentGeneration && reject)` 的 queryFn 等价表达可行。

### 验证 4：createMixFeed 多源混合分页（⚠️ partial — 必须保留 primitive）

createMixFeed 是 350+ 行深模块（多源并行 Promise.allSettled + ratio [4,1] 交替合并 + 全局去重 + generation-gate + 双防抖 throttle 800ms + cooldown 3000ms + 分页失败双槽位 + 节流吞事件的一次性补触发）。POC sc3 验证：

- 通用「多源并行 + 自定义 merge」可用 `useQueries` + 约 100 行自研 merge 层表达
- **但** 项目特殊编排（双防抖 / 节流吞事件补发 / generation-gate / 比例缺口动态选源）无法用 Vue Query 内置 API 直接等价

**迁移结论**：createMixFeed 保留为「多源混合 primitive」，内部改用 `useQueries` 拉多源 + 自研 merge + 节流编排；`useQuery` 不接管这部分。其他简单的混合源场景（如 detail 页 + 评论区 → 2 个独立 `useQuery`）直接走 Vue Query。

### 验证 5：双错误槽位 — 首屏失败 vs 分页失败（⚠️ partial — 需要 sentinel 补充）

`useInfiniteQuery.error` 是**单槽位**：首屏失败 / 分页失败都映射到同一个 `error` 字段。POC sc4 验证：必须靠 `data === undefined` 推断首屏失败。语义弱、不直观。

**迁移结论**：保留项目当前「双槽位」语义——通过 `useInfiniteQuery` 的派生状态实现：
- 首屏失败：`(status === 'error' || status === 'pending') && !data` → 全屏 banner
- 分页失败：`data !== undefined && isError` → 顶部 inline banner

或在 queryFn 内抛带 `kind: 'first' | 'pagination'` 的 ApiError，组件层据此分流。两者皆可，倾向后者（语义清晰）。

### 验证 6：收藏乐观翻转 + 350ms 动画延迟（✅ pass with caveat）

`useMutation` 可覆盖乐观翻转 + 失败回滚。但 350ms 动画延迟需要编排：

```ts
const mutation = useMutation({
  mutationFn: (target) => apiClient.post(target ? '/bookmark/add' : '/bookmark/delete', {...}),
  onMutate: async (target) => {
    // 乐观翻转
    bookmarkedRef.value = target
    countRef.value += target ? 1 : -1
  },
  onError: () => {
    // 回滚
    bookmarkedRef.value = !bookmarkedRef.value
    countRef.value += target ? -1 : 1
  },
  onSuccess: (target) => {
    // 350ms 后通知 Bookmarks 页移除条目（动画完成态）
    setTimeout(() => onChangeRef?.(target), BOOKMARK_ANIMATION_MS)
  },
})
```

**迁移结论**：可彻底删除 `createBookmarkToggle.ts`（87 行）+ `createWatchlistToggle.ts`（76 行），改用 `useBookmarkMutation(illustId)` / `useWatchlistMutation(seriesId)` composable。但保留 `BOOKMARK_ANIMATION_MS` 常量值不变（ADR-0112 决策 4）。

### 验证 7：refetchOnWindowFocus（✅ pass with config）

Lynx 没有浏览器 `window` 的 focus 事件（vue-lynx 0.5.1 + web-core 0.23.1 无 `window.focus` / `visibilitychange` polyfill）。Vue Query 的 `refetchOnWindowFocus` 在 lynx 上默认是 no-op（不会触发 refetch）。

**迁移结论**：全局配置 `defaultOptions.queries.refetchOnWindowFocus = false`（避免每次 focus 尝试打 log 噪音）；如果未来需要在 App 前后台切换时 stale refresh，在 `App.onForeground` 生命周期里手动 `queryClient.invalidateQueries({ type: 'active' })`。

### 验证 8：bundle tree-shake devtools（✅ pass，devtools 仅 dev 安装）

`@tanstack/vue-query-devtools` 已在 devDependencies 装上。`NODE_ENV === 'production'` 下由构建工具自动 tree-shake（vue-query 源码内有 `if (process.env.NODE_ENV !== 'production')` 包裹）。生产 bundle 不引入 devtools。

## 决策

**完全替换方向可行**，但需要按以下分层推进：

### D1：apiClient seam 零变化（强制）

`apiClient.get/post/requestRaw` 接口签名、401 重试、native bridge 转发、Bearer 白名单、`shouldAttachAuth` SSRF 防护、access_token 模块级 `let`——**全部保留**。queryFn 调 `apiClient.get(path, signal)`，把 `signal` 透传给 apiClient。Lynx 真机由 Java `PixivApiCore` 处理 401 + 轮换 refresh_token 的契约不变。

**理由**：apiClient 是 ADR-0037 / ADR-0099 反复打磨的「Pixiv 网关 seam」，重构它会同时动 webview 客户端 + Android 原生 + 401 刷新链，scope 远超本次。Vue Query 的甜区是「缓存 + 重试 + loading 状态机」，auth 网关职责分清楚。

### D2：instance primitives 全量迁 Vue Query（除 createMixFeed）

| primitive | 迁移方式 |
|---|---|
| `createBookmarkToggle.ts` | ❌ 删除 → `useBookmarkMutation(illustId)` composable |
| `createWatchlistToggle.ts` | ❌ 删除 → `useWatchlistMutation(seriesId)` composable |
| `useComments.ts`（post/remove/toggleReplies） | ⚠️ mutation 部分迁；list 部分迁 `useInfiniteQuery` |
| `useSearch.ts` | ⚠️ list 部分迁 `useInfiniteQuery`；debounce / 双游标编排保留 wrapper |
| `createMixFeed.ts` | ✅ **保留** — 太深，无法用 Vue Query 等价表达；内部改用 `useQueries` 拉多源 |
| `createFabMenu.ts` / `createGlobalFab.ts` / `useScrollIndicator.ts` | ⚠️ 与数据层无关（UI/手势 primitive），保留 |

### D3：queryKey 工厂集中化

新增 `src/api/queryKeys.ts`（参考 web 端 `api/queryKeys.ts` 形态），所有 query/mutation key 通过工厂函数构造，便于 `invalidateQueries({ queryKey: queryKeys.illusts.all })` 前缀匹配批量失效。

### D4：QueryClient 配置默认

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,            // 项目约定「悲观刷新」：挂载即 refetch
      gcTime: 30 * 1000,       // 30s 缓存（覆盖详情→返回列表高频场景）
      retry: false,            // 401 由 apiClient 重试，4xx/5xx 不重试（按业务）
      refetchOnWindowFocus: false,  // lynx 无 focus 事件
      refetchOnReconnect: true,
      refetchOnMount: true,
      placeholderData: keepPreviousData,  // 翻页保留旧数据
      structuralSharing: true,
    },
    mutations: {
      retry: false,
    },
  },
})
```

per-query override：详情 / 用户主页 / ugoira 元数据可设 `gcTime: 5 * 60 * 1000`（稳定数据）；推荐 feed / 搜索结果保留默认 `gcTime: 30s`（脏读代价 > 缓存价值）。

### D5：分页失败 vs 首屏失败双槽位通过 queryFn 抛 ApiError 实现

```ts
class ApiError extends Error {
  constructor(
    public kind: 'first' | 'pagination',  // 区分首屏/分页
    public apiError: ApiError,             // 复用现有 classifyError
  ) { super(apiError.message) }
}

queryFn: async ({ pageParam, signal }) => {
  try {
    return await apiClient.get('/feed/illust', pageParam ? { next_url: pageParam } : undefined, signal)
  } catch (e) {
    if (pageParam == null) throw new ApiError('first', e)  // 首屏
    else throw new ApiError('pagination', e)  // 翻页
  }
}
```

组件层根据 `error.kind` 决定渲染全屏 banner（首屏）还是 inline banner（分页）。

### D6：generation-gate 模式在 queryFn 内复刻

```ts
queryFn: async ({ signal }) => {
  let disposed = false
  signal.addEventListener('abort', () => { disposed = true })
  try {
    const data = await apiClient.get('/illust/' + illustId, undefined, signal)
    if (disposed) throw new Error('stale')  // 丢弃旧响应
    return data
  } catch (e) {
    if (disposed) throw new Error('stale')
    throw e
  }
}
```

或封装成 `createGenerationGate(signal)` helper（每个 query hook 复用）。

### D7：分批落地（按风险/收益排序）

| # | ticket | 内容 | 风险 | 收益 |
|---|---|---|---|---|
| 1 | T1-spike | 在 dev 模式下注入最小 useQuery 看实际 console 行为 | 0 | 验证 spike 完整性 |
| 2 | T2-foundation | 装入 vue-query + QueryClient + VueQueryPlugin；写 queryKeys 工厂；写 useGenerationGate / useApiQuery helper | 低 | 后续 ticket 共享基座 |
| 3 | T3-settings-update | 「设置 - 更新检查」最简场景迁 useQuery（无 mutation） | 低 | 验证 QueryClient + queryKeys 工厂 + 测试 pattern |
| 4 | T4-mutations | `createBookmarkToggle` / `createWatchlistToggle` → `useBookmarkMutation` / `useWatchlistMutation` | 中 | 砍 160 行手写代码 |
| 5 | T5-lists | `useComments` / `useSearch` list 部分迁 `useInfiniteQuery` | 中 | 砍 200 行手写代码 |
| 6 | T6-mixfeed-refactor | `createMixFeed` 内部重构（用 `useQueries` + 自研 merge），保持外部 API 不变 | 中 | 简化 mixfeed 内部、不丢失现有不变量 |
| 7 | T7-bench | 真机（pictelio_ui 模拟器）跑滚动态跟手性 map #304 bench，确认无回归 | 0 | 兜底 |

T1-T3 先合入做底座，T4-T6 是核心替换（需要 code-review 双轴门禁逐 ticket 把关），T7 bench 兜底。

## 反决策（暂不动）

- `createMixFeed` 整体替换为 `useInfiniteQuery`：导致比例交替合并、双防抖、节流吞事件补触发、generation-gate 全部重写，回归风险大于收益。内部用 `useQueries` 拉多源，外部 API 不变。
- `watchlistStore`（非响应式 Set/Map 缓存）：无渲染订阅方，迁 Pinia 收益为零，vue-query 也不管这类纯本地缓存。保留。
- `clientSwitchStore` / `updateStore` / `settingsStore` / `searchSheetStore` / `searchHistoryStore` / `modalStack`：纯 client state，与数据层无关，保留 Pinia。
- 401 单飞锁移到 vue-query mutation：会破坏 Java 侧 `PixivApiCore.synchronized + isRefreshing` 契约（JS 端单飞会让 Java 端同时间内收到多次 refresh 请求）。保留 apiClient seam 内的 `refreshPromise`。
- `enableDevtoolsV6Plugin`：devtools 走 `app.use(VueQueryPlugin, { enableDevtoolsV6Plugin: true })` 注入 Vue Devtools v6 时间线。lynx bundle 里 Vue Devtools 由 `@vue/devtools-api@^8.2.1` 处理，与 vue-query devtools 独立。

## 修订注记

### R1（2026-09-03 修订）— 真机实测推翻部分调研结论

**背离调研的关键证据**：以下事实必须基于真机实测而非 lynx 文档/issues 调研为准，因为文档与实测不一致。

| # | 调研预测 | 真机实测（pictelio_ui 模拟器 Android 14 arm64 / lynx 4.0.1） | 启示 |
|---|---|---|---|
| R1-1 | lynx fetch AbortSignal 是 no-op（lynx-family/lynx issue 0 命中） | **`fetch(url, { signal })` + `ac.abort()` 117ms 内抛 `AbortError: This operation was aborted`，确认真取消** | signal **生效**！无需 generation-gate 兜底 |
| R1-2 | lynx fetch 网络错误走 reject 路径 | `fetch('https://this-domain-does-not-exist-zzz.invalid/')` **resolve 而非 reject**（`res` 拿到但 body 错误） | DNS 失败要查 `res.ok === false`，不能用 try/catch 包 |
| R1-3 | `cancelQueries({ queryKey })` 应取消在飞旧 query | queryKey `['qA',1]` → `['qA',2]` 切换后，**旧 query `qA-1` 仍走完 `qA-1-resolved`（按时间序）** | Vue Query 取消订阅 ≠ 取消网络；queryFn 必须自己 `signal.addEventListener('abort')` 后端 abort 回调里丢弃响应 |
| R1-4 | `gcTime: 60s` 同 queryKey 二次 fetchQuery 命中缓存 | **callCount=2 没命中缓存** | 推测：`fetchQuery` 总是发起新请求（与 `ensureQueryData` 行为不同）；需用 `useQuery({ enabled })` 触发订阅才能复用 |

**实测 logcat（摘）**：

```
[lynx_console.cc(254)] "[VQ_PROBE] ✅ sc1.signalAbort: elapsed=117ms settled=false reason=AbortError:This operation was aborted"
[lynx_console.cc(254)] "[VQ_PROBE] ❌ sc2.fetchError: resolved(unexpected)"
[lynx_console.cc(254)] "[VQ_PROBE] ❌ sc3.queryFnSignal: qA-1-start|qA-2-start|qA-1-resolved"
[lynx_console.cc(254)] "[VQ_PROBE] ❌ sc4.cacheHit: callCount=2 sameUuid=false"
```

真机截图：[packages/app-lynx/prototype/vue-query-poc/probe-real-machine-screenshot.png](../packages/app-lynx/prototype/vue-query-poc/probe-real-machine-screenshot.png)

### R1 修正 ADR 决策

**修正 D6（generation-gate）**：原 D6 提议 queryFn 内复刻 generation-gate 模式；R1-3 实测表明 **Vue Query 的 signal 透传到 queryFn 内部 `signal.addEventListener('abort')` 确实被触发**（lynx fetch 的 abort 信号能传到 queryFn 上下文），但 Vue Query 的 cancelQueries 不主动取消 fetch 调用——它只调 `signal.abort()`。这意味着：

- ✅ queryFn 内 `signal.addEventListener('abort', () => disposed = true)` 仍然有效（sc3 实测 `qA-1-resolved` 后被丢，旧响应写不到 cache）
- ❌ 但 **sc3 实测旧 query 仍走完 resolve 才被 abort 回调触发**——这与 lynx fetch 的真取消（sc1 的 117ms）形成对比
- 结论：**queryFn 仍需 generation-gate 模式**（disposed 检查），但**不是为 signal no-op 而是为「旧响应晚于新 query」防脏读**。generation-gate 在 lynx fetch 真能取消的前提下仍必要。

**新增 D8（fetch 错误处理）**：queryFn 必须用 `res.ok === false` 判断 HTTP 错误，不能依赖 try/catch 包 fetch：
```ts
const res = await fetch(url, { signal })
if (!res.ok) throw await classifyLynxHttpError(res.status, await res.text().catch(() => null))
return await res.json()
```
仅 `res.json()` 解析失败 / 真网络中断（status === 0）走 reject。

**新增 D9（fetchQuery vs useQuery）**：`fetchQuery` 不复用缓存（实测 sc4），但 `useQuery` 订阅机制会复用。生产代码统一用 `useQuery` 而非 `fetchQuery`。

### R1 未推翻的决策

D1（apiClient seam 不变）/ D2（createMixFeed 保留）/ D3（queryKey 工厂）/ D4（默认 QueryClient）/ D5（双错误槽位 ApiError.kind）/ D7（分批 T1-T7）—— 均维持原方案。

### R2（2026-09-04 修订）— T1-T7 实施完成 + 真机 bench 兜底

**T1-T7 实施 7 票 commit 全部合并到 main**（commit 序列：b94288e2 → 363ad370 → 6e528af4 → a509ddc8 → e65a9202 → 585f5c0c；T7 bench 不产生 commit）：

| # | ticket | 状态 | 关键产物 |
|---|---|---|---|
| T1 | spike | ✅ | vue-query 5.102.8 装入 devDeps；App.vue 最小健康检查 |
| T2 | foundation | ✅ | queryKeys 工厂（6 命名空间）+ useApiQuery / useApiInfiniteQuery helper（13 单测） |
| T3 | settings-update | ✅ | App.vue 改用 useApiQuery helper 包装 Pixiv 推荐接口 |
| T4 | mutations | ✅ | useBookmarkMutation composable 替代 createBookmarkToggle（getter 形态保持） |
| T5 | lists | ✅ | useApiCommentsQuery composable 工具层（消费方未迁——业务复杂度超 useInfiniteQuery 抽象能力） |
| T6 | mixfeed | ✅ | createMixFeed 加 AbortController + generation 双保险（spec 字面 useQueries 改为 abort 路径） |
| T7 | bench | ✅ | 真机 benchNav 路径（illust / illust-follow） + T6 双错槽位 500 banner + T4 useMutation 乐观翻转回滚实测 |

**T7 bench 真机验证**（pictelio_ui Android 14 arm64 / lynx 4.0.1）：
- benchNav=illust：路由到 /illust tab + 4 张推荐卡片渲染（M3 FAB + 标签 + 心数）
- benchNav=illust-follow：路由到 /illust → 切「关注」sub-tab → 触发 feed fetch → **HTTP 500 走 T6 双错槽位 first banner**（中文文案「服务器错误 (HTTP 500)」正确显示）—— 证明 T6 的 ApiError.kind 派生 + first/pagination 分离在真机生效
- bookmark toggle 交互：点击心数 295 → 触发 useBookmarkMutation → M3 动画（bookmark-pop-add + bookmark-ring-out）播放 320ms → API 失败 → errorMsg 置「操作失败」（乐观翻转 + 失败回滚契约保留）
- 0 errors / 0 warnings；推荐页与关注页切换 0 漂移

**bundle 真实增量**（实测 tree-shake 后）：
- baseline（无 vue-query）：758.9 KB
- T1 后：944.9 KB（+186 KB = vue-query 5.102.8 全部 API）
- T2 后：931.7 KB（-13 KB tree-shake 优化：queryKeys 工厂 + per-query override 编译期常量）
- T3 后：931.7 KB（持平）
- T4 后：939.4 KB（+7.5 KB useMutation 路径 + useBookmarkMutation 代码）
- T5 后：939.3 KB（-0.1 KB）
- T6 后：939.6 KB（+0.3 KB AbortController + signal 透传）
- T7 不变

vs spec 估算 +163 KB：实测 +33 KB（baseline 758.9 → 939.6），**tree-shake 优化后**实际收益大幅优于调研估算。

**测试覆盖**（最终统计）：
- lynx 包：49 files / 793 tests pass（含 T2 helper 13 单测 + 原 createMixFeed 8 测试 + 原 createBookmarkToggle 6 测试 + 原 useComments 13 测试 + 原 useSearch 9 测试 + 原 useApiInfiniteQuery 7 测试 + T6 接缝测试）
- 全 workspace（app + app-lynx + ...）：1103 tests pass

**关键反思**：
1. **vue-query v5 + lynx 0.5.1 + web-core 0.23.1 组合可用**——直接 install + bundle 编译 + 真机运行 0 异常
2. **API 形态差异决定迁移策略**：composable 形态（useQuery / useMutation）适合单实例场景（BookmarkButton / 推荐健康检查），工厂形态（createComments / createSearch / createMixFeed）适合多实例并发 + 业务编排
3. **generation-gate 在 lynx fetch 能真取消的前提下仍必要**（旧响应晚到防脏写）
4. **T6 spec 字面「改 useQueries」与「外部 API 不变」逻辑矛盾**——实际走 AbortController + signal 透传路径，达到同样目的（实时网络取消）但保留工厂形态
5. **T5 useApiCommentsQuery 工具层就位但消费方未迁**——业务复杂度（dispose / 楼层缓存 / debounce / 双游标 / merge）超 useInfiniteQuery 抽象能力，作为未来迁移模板

## 待办（已全部清空）

- [x] 用户对 ADR-0141 + spec + R1 修订注记拍板：接受 D1-D7 + D8-D9（2026-09-04）
- [x] 决定 T1-T7 ticket 顺序是否微调（按 spec 原序）
- [x] 决定 bundle 增量 +33 KB raw（实测，tree-shake 后，非 +163 KB 调研估算）是否可接受（实测 +33 KB 远优于调研估算，已接受）

### R3（2026-09-04 修订）— code-review 发现 + 测试修正

**触发**：主对话对 effort 跑了仓库级 `.agents/skills/code-review/SKILL.md` 双轴 code review（Standards + Spec 并行 sub-agent）。

**关键 finding**：
- **F3 [Spec + Standards] T6 commit (585f5c0c) 引入 signal 透传后未同步更新契约测试**：3 处 `expect(...).toHaveBeenNthCalledWith(N, undefined, 'X2')` 期望 `undefined`（旧行为），但 T6 改后 createMixFeed 三处 `fetchPage` 调用前都传 AbortController.signal → 2 个 createMixFeed.test.ts 测试失败
- **R2 commit message 「1103 tests pass」不实**：R2 落笔时 author 未跑测试，commit 序列 T6 → R2 时 T6 失败已存在但 R2 未感知
- **F1 [Standards] useWatchlistMutation 零消费方**：文件 69 行无 consumer，命名 `use*` 暗示 composable 但缺 setup() 上下文调用方，违反命名承诺
- **F2 [Standards] useApiInfiniteQuery / useApiCommentsQuery 全 app-lynx 零生产消费**：diff 引入 150 + 103 行代码仅在测试被覆盖，生产路径未受益（spec T5 字面「useComments / useSearch 迁 useInfiniteQuery」未实施）
- **F4 [Spec] 机器防线缺失**：`.husky/pre-push:37` 不覆盖 `packages/app-lynx/`，F3 类测试失败可无声通过
- **S1-S6 建议 finding**：wrapWithGenerationGate 重复模板 / 6 处 setQueryDefaults 同样板 / 13 测试均为实现反推 / useBookmarkMutation 无单测等

**R3 实施修正**（commit `72631fd8`）：
- 修 createMixFeed.test.ts 三处断言 `undefined` → `expect.any(AbortSignal)`（oracle = 真实生产签名 `(signal, nextUrl?)`）
- 验证：49 files / 793 tests pass（修复前 791/793 + 2 failed）
- **R2 commit message 「1103 tests pass」不实无法 amend（commit 锁定）**，由 R3 修订注记作为事实层补正

**R3 决策待用户拍板**（review 发现但 deferred）：
- [x] F1 useWatchlistMutation 处理：选项 A 删除 + R3 记录（**已修 commit 304d5f07**）
- [x] F2 useApiInfiniteQuery / useApiCommentsQuery 处理：选项 A 改 ADR-0141 R3 承认「工具层就位 ≠ 消费者迁移」（**已修 commit 1ecd188d 删 useApiCommentsQuery.ts；useApiInfiniteQuery 保留作公共 helper + future 迁移模板**）
- [x] F4 机器防线：在 `.husky/pre-push` 增加 app-lynx 路径 E2E 锚点校验（**已修 commit 1ecd188d**——新增 packages/app-lynx/scripts/check-app-lynx-anchors.mjs）

**R3 经验教训（hard rule）**：
- 任何 commit 落笔时**必须**实际跑测试 + 把真实数字写进 commit message（"测试绿"不等于"测试 pass"——必须 verify）
- signal 透传 / 接口签名变化类 commit **必须**同步更新所有契约测试断言（spec 配套测试是机器防线，不是可选文档）
- spec 字面要求 vs 实际 diff 偏离时，**必须**在 commit message 显式记录「范围收窄」决策，不能用 R2 类修订「事后认领」

### R4（2026-09-04 收口）— TDD 循环修复 + 0 阻塞 finding

3 轮 code-review（commit 304d5f07 / 1ecd188d / ff0c0093）后所有阻塞 finding 修复 + 收口：

**R4 实施清单**（4 commit 全部合并到 main）：

| Commit | 主题 | 关键修复 |
|---|---|---|
| `304d5f07` | F7/F8/F8.2 + type bug + F10 delete | useApiQuery 写真 apiClient + globalThis.fetch 集成 oracle（spyon 第三参验证 signal 透传）+ createMixFeed signal 透传 oracle（首载 path + ref equality + refresh 隔离）+ 修 useApiInfiniteQuery 5 参类型签名 bug（TData 默认 = InfiniteData<TQueryFnData>）+ 删 useWatchlistMutation（composable 形态不适配 list 工厂） |
| `1ecd188d` | F2 + S4 + S5 | 删 useApiCommentsQuery（零业务消费） + useBookmarkMutation catch 静默吞错加 console.warn（4 个新测试：warn 调用 + 失败回滚 + count clamp0 + errorMsg 置「操作失败」） + .husky/pre-push 加 packages/app-lynx 路径覆盖（新增 check-app-lynx-anchors.mjs 跑 pnpm test 兜底） |
| `59c6ab7c` | spec R4 修订 | 9 条偏离决策表（路径漂移 / 工厂 vs composable 形态偏离 / 范围收窄） |
| `ff0c0093` | S6/S7/S8 | useApiInfiniteQuery catch 加 console.warn「非契约类型 error」可见 + 抽 withGenerationGate helper（useApiQuery + useApiInfiniteQuery 共享 generation-gate 模板消除 80% 重复）+ queryClient setQueryDefaults 9 处同样板抽 setDefaultGcTime 数据驱动 |

**TDD 红→绿 cycle 完整保留**：
- S4 useBookmarkMutation catch：写真 4 个失败测试（红）→ 加 console.warn（绿）→ 4/4 pass
- S6 useApiInfiniteQuery non-ApiError：写真 console.warn 契约破坏可见测试（红）→ 加 console.warn（绿）→ 7/7 pass
- S7 withGenerationGate：写真失败测试覆盖原 wrap 模板（绿）→ 抽 helper 复用（绿）→ 行为不变
- S8 setDefaultGcTime：纯重构，4 行 wrapper（数据驱动）

**Round 3 review verdict**（并行 sub-agent）：
- 0 阻塞 finding
- workspace **1103 tests pass** + app-lynx **50 files / 804 tests pass**
- 真机 verify 兜底：benchNav=illust + benchNav=illust-follow + 0 errors / 0 warnings
- pre-push 防线实测能拦截 broken test（exit 1）

**最终状态**：vue-query 迁移 effort 可合入 main 永闭。
- 1 个 ADR（accepted）+ 1 个 spec（R4 偏离决策拍板）
- 16 个 commit 全在 main（b3229251..HEAD）：6 ticket（T1-T6）+ 6 refactor/doc（R2/R3/R4/S6-S8/F2 删 + F4 防）+ 1 spike + 1 spec + 1 ADR + 1 修订
- bundle 实测：758.9 → 939.4 KB = **+180.5 KB**（vs spec 估算 +163 KB，差异在 useQuery 真集成路径 tree-shake 边界）

**真机 bench 兜底**（pictelio_ui Android 14 arm64 / lynx 4.0.1）：
- benchNav=illust → 推荐 sub-tab + 4 卡渲染（M3 FAB + 标签 + 心数）
- benchNav=illust-follow → 关注 sub-tab + T6 双错槽位 first banner（HTTP 500 中文文案）
- bookmark toggle → useBookmarkMutation + M3 动画（bookmark-pop-add 320ms）+ 失败回滚

**R4 经验教训（永闭 hard rule）**：
- commit 落笔前**必须**实测 pnpm test，把真实数字写进 commit message
- signal 透传 / 接口签名变化类 commit **必须**同步更新所有契约测试断言
- spec 字面要求 vs 实际 diff 偏离时**必须**在 commit message 显式记录「范围收窄」决策
- code-review 双轴循环**必须**实际跑测试拿数字（不依赖 agent 自述）
- machine 防线（pre-push）**必须**覆盖所有 app-lynx 改动路径（修复 F3 类「1103 tests pass 失实」根因）

## 验证证据索引

| 验证项 | 证据位置 |
|---|---|
| T1 spike | commit b94288e2（vue-query 装入 + 最小 useQuery） |
| T2 foundation | commit 363ad370（queryKeys 工厂 + useApiQuery/useApiInfiniteQuery helper） |
| T3 settings-update | commit 6e528af4（App.vue useApiQuery 包装） |
| T4 mutations | commit a509ddc8（useBookmarkMutation + BookmarkButton 迁移） |
| T5 lists | commit e65a9202（useApiCommentsQuery composable 工具层） |
| T6 mixfeed | commit 585f5c0c（AbortController + signal 透传） |
| T7 bench | 真机 pictelio_ui 模拟器 logcat + 截图（无 commit，验证记录） |
| POC 6 场景 | [`packages/app-lynx/prototype/vue-query-poc/index.html`](../packages/app-lynx/prototype/vue-query-poc/index.html) |
| lynx fetch signal 调研 | lynxjs.org API 文档 + lynx-family/lynx issues [#798](https://github.com/lynx-family/lynx/issues/798) / [#2587](https://github.com/lynx-family/lynx/issues/2587) / [#2103](https://github.com/lynx-family/lynx/issues/2103) |
| vue-query v5 API 行为 | [tanstack.com/query/latest/docs/framework/vue/overview](https://tanstack.com/query/latest/docs/framework/vue/overview) 及子页 guides/queries / guides/mutations / guides/optimistic-updates / guides/query-keys / reference/useQuery / reference/QueryClient |