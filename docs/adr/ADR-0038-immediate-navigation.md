# ADR 0038: 即时导航 — 先渲染、后加载数据

## 状态

已接受（2026-08-08）

## 背景

### 用户规则声明

两条硬约束必须同时满足：

1. **即时渲染规则**：用户主动点击进入任何页面/弹窗/详情时，必须**先渲染页面框架 + 骨架屏**，再发起数据请求。不允许卡在请求完成后才渲染。
2. **全局最优规则**：任何方案必须同时满足高可维护性 + 高性能 + 高安全性 + 低内存占用。不允许模糊表述。必须从宏观（全局架构）和微观（单个组件）两个角度验证方案。

### 当前违反情况

Pictelio 当前重度依赖 TanStack Router 的 `loader` 在导航前预取数据。由于 TanStack Router 保证 `loader` resolve 后才渲染组件，每条数据请求都阻塞了页面展示：

```
用户点击链接
  → 路由匹配
  → loader 执行（await 网络请求） ← 阻塞
  → loader resolve
  → 组件挂载
  → 数据从 loader 注入本地 signal（hydration）
  → 渲染
```

受影响的路由覆盖了几乎所有带数据的页面：

| 路由 | Loader 阻塞内容 | 当前等待 |
|------|----------------|---------|
| `/recommended` | `ensureLoaded()` | 通用 spinner |
| `/following` | `ensureLoaded()` | 通用 spinner |
| `/illust/$id` | `loadDetail()` | 通用 spinner |
| `/novel/$id` | `loadNovelEntry()` | 通用 spinner |
| `/me` | `loadProfile()` | 通用 spinner |
| `/user/$id` | `loadProfile()` | 通用 spinner |
| `/user/$id/illusts` | `loadUserIllusts()` + `loadProfile()` | 通用 spinner |
| `/user/$id/following` | `loadFollowList()` | 通用 spinner |
| `/user/$id/followers` | `loadFollowList()` | 通用 spinner |
| `/my/followers` | `loadFollowList()` + `loadProfile()` | 通用 spinner |

### 二次问题：Loader → 组件 hydration 增加复杂度

当前模式产生了两步间接层：

```
Loader 获取数据 → 存入路由状态 → useLoaderData() → createEffect 读取 → setSignal → render
```

`IllustDetail`、`NovelDetail` 都从 `useLoaderData()` 读取数据后再赋值到本地 signal。这套模式增加了理解成本，且组件本身已有能力加载数据，中间的 loader 层成了冗余。

## 决策

### 核心原则

| 原则 | 具体含义 |
|------|---------|
| **先渲染** | 路由 `loader` 不再 await 网络请求。组件在 mount 后立即渲染页面框架 + 骨架屏 |
| **组件内加载** | 数据请求由组件在 `createEffect` 或 TanStack Query 中发起 |
| **缓存优先** | mount 时先检查同步缓存（如 `novelCache.peekEntry()`），命中則跳过骨架屏，零闪烁 |
| **标准化** | 所有路由组件使用统一的数据加载模式，不靠"约定" |

### 新数据流

```
用户点击链接
  → 路由匹配
  → loader 执行（仅设导航状态，无 await） ← 不再阻塞
  → 组件即时挂载
  → 渲染页面 chrome + 骨架屏
  → createEffect / TanStack Query 发起数据请求 ← 并行进行
  → 数据到达 → 骨架屏替换为真实内容
```

关键变化：

- **`loader` 职责缩小**：仅处理轻量导航副作用（如 `setCurrentTab("me")`），返回 route params
- **数据职责转移到组件**：组件通过 TanStack Query 或 `createSignal` + `createEffect` 管理数据生命周期
- **骨架屏即时展示**：页面框架 + shimmer 占位在数据到达前就已显示

### 技术选型

| 维度 | 选择 | 理由 |
|------|------|------|
| 数据管理层 | **TanStack Query** | 项目已有 `queryClient`、query factories；自动去重、缓存、loading/error 状态管理 |
| 骨架屏 | **复用现有骨架组件** | `SkeletonCard` 已存在，feed 瀑布流直接堆叠使用；其他页面需新增 |
| Hover 预取 | **后续迭代** | `defaultPreload: "intent"` 仅预取代码分割。数据预取需额外机制，但不阻塞本决策 |

### 宏观验证（全局最优规则）

| 维度 | 验证 |
|------|------|
| **高可维护性** | 统一模式：所有路由组件使用 `createQuery` + 骨架屏。不再有"route loader + hydration"两套逻辑 |
| **高性能** | 页面框架即时渲染，感知加载时间 ≈ 0ms。骨架屏替换动画流畅。TanStack Query 缓存避免重复请求 |
| **高安全性** | 数据流没有改变：TanStack Query 通过已有的 API client 发起请求，凭证管理不变。不引入新的安全面 |
| **低内存占用** | SolidJS 组件卸载时自动清理 DOM + effect 订阅。TanStack Query 的 `gcTime` 自动回收 stale cache。骨架屏 DOM 节点轻量（纯 CSS shimmer） |

### 微观验证（单个组件）

每个组件不会产生额外的重复请求：TanStack Query 的 query key factory（`queryKeys.ts`）确保相同数据去重。
不会出现"先渲染 skeleton、0.1s 后数据到达、闪烁"的问题：先检查同步缓存，命中则直接渲染内容。

### 详细设计

#### Router 改造

所有 loader 改为轻量模式：

```typescript
// 改造前
const illustRoute = createRoute({
  path: "illust/$id",
  loader: async ({ params }) => {
    const [err, data] = await tryAsync(loadDetail(Number(params.id)));
    return { illust: data?.illust ?? null, error: err ? toApiError(err) : null };
  },
  component: asRoute(IllustDetail),
});

// 改造后
const illustRoute = createRoute({
  path: "illust/$id",
  // loader 仅返回 params，不发起网络请求
  loader: ({ params }) => ({ id: Number(params.id) }),
  component: asRoute(IllustDetail),
});
```

同理：
- `recommendedRoute` / `followingRoute`: loader 仅 `setCurrentTab` + `return {}`
- `novelRoute`: loader 仅 `return { id: Number(params.id) }`
- `meRoute`: loader 仅 `setCurrentTab("me")` + `return {}`
- `userRoute`: loader 仅 `setCurrentTab("me")` + `return { userId: Number(params.id) }`
- `userIllustsRoute`: loader 仅 `return { id: Number(params.id) }`（profile 和 illusts 由组件加载）
- `userFollowingRoute` / `userFollowersRoute` / `myFollowersRoute`: loader 仅 `resetFollowList()` + `return {}`

#### 组件标准模式

每个数据路由组件遵循以下标准结构：

```typescript
// 1. 导入 TanStack Query hooks
import { createQuery } from "@tanstack/solid-query";
import { illustDetailQuery } from "@/api/queryKeys";

// 2. 组件内部
function RouteComponent() {
  const params = useParams({ from: "/illust/$id" });
  const navigate = useNavigate();

  // 标准 TanStack Query
  const query = createQuery(() => ({
    queryKey: illustDetailQuery(Number(params.id)).queryKey,
    queryFn: ({ signal }) => loadDetail(Number(params.id), signal),
    staleTime: 30_000,
  }));

  return (
    <>
      {/* ① 页面 chrome 始终渲染 */}
      <header>...</header>

      {/* ② 骨架屏 / 内容 二选一 */}
      <Show when={query.isPending} fallback={
        <Show when={query.data}>
          <RealContent data={query.data} />
        </Show>
      }>
        <RouteSkeleton />
      </Show>

      {/* ③ 错误状态 */}
      <Show when={query.isError}>
        <ErrorDisplay error={query.error} onRetry={() => query.refetch()} />
      </Show>
    </>
  );
}
```

例外：
- **NovelDetail**：已通过 `createNovelLoader` + `peekEntry` 实现了缓存优先，但需将 loader 数据源替换为组件内 `loadNovelById()`
- **Feed 路由**：使用已有的 feedStore signals（`illusts()`、`loading()`、`error()`），无需 TanStack Query。TabFeedPage 已有骨架屏接收能力（`VirtualFeed` 的 loading prop）

#### 骨架屏实现

| 页面 | 骨架屏 | 实现方式 |
|------|--------|---------|
| IllustDetail | `IllustDetailSkeleton` | 顶部栏 shimmer + 16:9 图片灰块 + 2 行文字 shimmer + 底部按钮占位 |
| NovelDetail | `NovelDetailSkeleton` | 封面占位灰块 + 5-6 行文字 shimmer（类似阅读器段落高度） |
| PersonalCenter | `ProfileSkeleton` | 圆形头像占位 + 菜单列表（菜单项文字 shimmer，固定 6 项匹配功能列表） |
| TabFeedPage | `FeedSkeleton` | `SkeletonCard` × 6，两列瀑布流布局（现有组件堆叠） |
| UserIllusts | `GridSkeleton` | 二级路由复用 PersonalCenter 的布局 chrome，内容区网格灰块（3 列） |
| FollowListPage | `ListSkeleton` | 10 行列表骨架，每行圆形头像 + 名称文字 shimmer |

骨架屏使用 Fluent Design tokens：
- 背景色：`var(--colorNeutralBackground1)`（或轻微更浅）
- shimmer 高光：`var(--colorNeutralStroke2)` 透明度渐变
- 圆角：`var(--borderRadiusMedium)`（卡片）、`var(--borderRadiusCircular)`（头像）
- 动画：`var(--durationGentle)` + `var(--curveEasyEase)`

#### FollowListPage 特殊处理

`FollowListPage` 和 `UserIllusts` 是 `PersonalCenter` 的子路由（通过 `<Outlet />`），当前的 `loader` 在两个路由层级各自触发。改造后：

1. `userRoute.loader`: 仅 `setCurrentTab` + `return { userId }`
2. `userFollowingRoute.loader`: 仅 `resetFollowList()`，数据在 `FollowListPage` 组件内通过 `createEffect` + `loadFollowList` 加载
3. `userIllustsRoute.loader`: 仅 `return {}`，数据在 `UserIllusts` 组件内加载

由于子路由和父路由共享同一个页面 chrome（PersonalCenter 的 `<Show when={profileState.isRootUserPage()} fallback={<Outlet />}>`），子路由组件挂载时父路由的 profile 可能还未加载完成。这需要设计好加载状态：

- ProfileSkeleton 包含完整的菜单列表（功能菜单项固定渲染），不影响用户交互
- 子路由内容区独立管理自己的 loading 状态

#### Feed 路由特殊处理

`recommendedRoute` 和 `followingRoute` 较为特殊：

当前 `makeFeedLoader` 同时做了两件事：
1. `setCurrentTab(tab)` — 轻量
2. `await ensureLoaded(signal)` — 可能等待网络

改造后 loader 只做 `setCurrentTab`。`TabFeedPage` 组件 mount 时：

- 有缓存（`isFeedCached`）：从 cache 读取，不显示骨架屏
- 无缓存：显示 `FeedSkeleton`（6 个 `SkeletonCard`）
- 两种情况下都通过 `onMount` 或 `createEffect` 调用 `ensureLoaded()`（TanStack Query 已内置在 feedStore 中）

已缓存的 Feed 无需骨架屏。这与当前的 `skipAnimation={cached}` 逻辑一致。

## 实施路线图

### Phase 1：新骨架屏组件（可并行）

1. 创建 `IllustDetailSkeleton` (`src/components/skeletons/IllustDetailSkeleton.tsx`)
2. 创建 `NovelDetailSkeleton` (`src/components/skeletons/NovelDetailSkeleton.tsx`)
3. 创建 `ProfileSkeleton` (`src/components/skeletons/ProfileSkeleton.tsx`)
4. 创建 `FeedSkeleton`（复用 `SkeletonCard` 的组合组件，`src/components/skeletons/FeedSkeleton.tsx`）
5. 创建 `ListSkeleton` (`src/components/skeletons/ListSkeleton.tsx`)
6. 创建 `GridSkeleton` (`src/components/skeletons/GridSkeleton.tsx`)

### Phase 2：路由改造（按复杂度递增）

顺序：从风险最低的页面开始，逐步推进到复杂页面

1. **`/about`, `/settings`, `/image-host`, `/image-cache`** — 无数据加载，仅验证结构
2. **`/recommended`, `/following`** — Feed 路由
3. **`/illust/$id`** — IllustDetail
4. **`/me`, `/user/$id`** — PersonalCenter
5. **`/user/$id/illusts`** — UserIllusts
6. **`/user/$id/following`, `/user/$id/followers`, `/my/followers`** — FollowListPage
7. **`/novel/$id`** — NovelDetail（最复杂，缓存层级多）

### Phase 3：收尾

1. 删除不必要的 `useLoaderData()` / `routeApi` 定义
2. 检查 skeleton CSS 动画启用 `prefers-reduced-motion`
3. 回退测试：无 skeleton 时的 fallback 渲染（error boundary）

## 注意事项

### NovelDetail 特殊说明

`NovelDetail` 已具备独立于 loader 的数据加载能力（`loadNovelById` + `createNovelLoader`）。但 loader 仍然作为初始数据的来源，通过 `createEffect` 读取 `data()` 并 applyEntry。改造后：

1. Loader 仅返回 `id`
2. `onMount` / `createEffect` 中调用 `loadNovelById(id)`（已含缓存优先逻辑）
3. 移除 `createEffect` 中从 `data()` hydration 的代码
4. 系列内切换（`switchNovel`）不受影响

### Feed 的 ensureLoaded 调用

Feed 的 `ensureLoaded()` 是 TanStack Query 的 `.refetch()` 封装。它本身可以在组件 mount 后调用。但要注意避免双重请求：

- `onMount` 中调用 `ensureLoaded()`
- 需确保 `onMount` 执行之前已经检查过 isFeedCached，避免不必要的请求

### FollowListPage 的 resetFollowList

当前 `makeFollowLoader` 中调用了 `resetFollowList()`。这个调用必须在导航到该路由时执行（而不是等到组件 mount），因为后续的 `loadFollowList` 如果不清空旧数据，可能导致新旧数据混合。

改造方案：`loader` 保留 `resetFollowList()` 调用，但不再 await `loadFollowList`。

### TanStack Query 的 staleTime

建议为不同页面设置不同的 `staleTime`：

- `illustDetail`: 30s（用户不太可能在 30s 内重复看同一作品）
- `novelDetail`: 30s
- `userProfile`: 60s（用户信息变化频率低）
- `feed`: 0（feed 需要最新数据）
- `followList`: 10s

### 测试策略

- 单元测试：验证每个 skeleton 组件正确渲染、骨架屏在数据到达后被替换
- 属性测试：验证所有路由在 `loading=true` / `error` / `data` 三种状态下的渲染结果
- E2E：验证从链接点击到内容可见的时间曲线，确保不再有"等待数据才渲染"的阻塞

## 相关文件

- `packages/app/src/router.tsx` — 路由定义，loader 改造目标
- `packages/app/src/routes/IllustDetail.tsx` — 需要 Template Query 化
- `packages/app/src/routes/NovelDetail.tsx` — 需要移除 loader data hydration
- `packages/app/src/routes/PersonalCenter.tsx` — 需要 profile 加载移入组件
- `packages/app/src/routes/TabFeedPage.tsx` — 需要 ensureLoaded 移入组件的 onMount
- `packages/app/src/routes/UserIllusts.tsx` — 需要数据移入组件
- `packages/app/src/routes/FollowListPage.tsx` — 需要列表加载移入组件
- `packages/app/src/routes/Feed.tsx` — 已接近目标的模式，调整较轻
- `packages/app/src/components/SkeletonCard.tsx` — 现有骨架屏组件，复用基础
- `packages/app/src/stores/feedStore.ts` — ensureLoaded 可组件内调用
- `packages/app/src/api/queryKeys.ts` — TanStack Query query key factory
- `packages/app/src/api/queryClient.ts` — queryClient 实例

## 不实施范围

- Hover 数据预取：本项目不实现。体积比收益大。
- `<PendingComponent>` 路由级 pending 组件：数据加载移入组件后，TanStack Router 的 pending 组件不再需要，可设为 `undefined`
- SSR/SSG：本项目是纯 SPA + Capacitor，不涉及
