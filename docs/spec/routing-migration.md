# Spec: 路由层从 TanStack Router 迁移到 @solidjs/router

## Problem Statement

Pictelio 的用户在 app 启动后（login → home）首先看到白屏，直到 recommended API 请求完成后页面才突然出现。这是 TanStack Router 的 SolidJS 适配器内部架构导致的：

1. `MatchInner` 组件使用 `createResource(loadPromise)` 包装路由组件
2. 即使 home route 的 loader 是同步的，路由切换时 Solid `<Suspense>` 仍然感知到 pending
3. 由于没有设置 `defaultPendingComponent`，Fallback 为 `null` → **整个 Outlet 内容被替换为空白**
4. 直到 transition resolve 后 HomePage 才挂载，此时 `onMount` 中的 API 请求仍在等待
5. 结果：用户看到的是「等待 → 突然内容全出现」，而非「骨架屏可见 → 数据逐步填充」

项目有硬约束「先渲染、后加载」——路由必须在导航后立即渲染组件框架，数据加载在组件挂载后发起。TanStack Router 的 Suspense 架构与此约束冲突。

## Solution

将路由库从 `@tanstack/solid-router` 替换为 `@solidjs/router`。后者：

- 内部使用纯 Signal + `createMemo` 实现路由匹配，**不存在 Suspense / pending 过渡**
- URL 变更后同步渲染新组件，不等待任何异步操作
- 数据加载 seam 完全在组件层（`onMount` 中管理），路由层不参与
- 接口更小：只需 `path + component` 定义，不需要 loader / pending 配置 / 类型注册

迁移后：

```
Login → navigate("/home") → @solidjs/router 同步匹配 → HomePage 立即渲染骨架屏
                                                       → RecommendedFeed.onMount
                                                       → setTimeout(0) → API 请求
                                                       ↑  骨架屏已可见  ↑
```

## User Stories

1. 作为用户，我希望在登录后立即看到首页框架（导航栏、布局骨架），而不需要等待 API 请求完成
2. 作为用户，我希望在不同页面之间切换时，目标页面的框架立即呈现，而不是出现白屏闪烁
3. 作为开发者，我不需要理解路由框架的 pending / Suspense 概念来排查白屏问题
4. 作为开发者，我希望路由定义保持简洁：只需 path + component，不需要额外的 loader/pendingMs 配置
5. 作为开发者，我不需要在每个路由组件上添加 `asRoute()` 类型断言
6. 作为开发者，我希望现有的 TanStack Query 数据管理不受路由更换影响
7. 作为开发者，我希望现有的懒加载路由（`lazy()`）模式继续工作
8. 作为开发者，我希望使用 `useNavigate()` 和 `useParams()` 等 Hook 的地方只需要参数格式调整，不需要结构性重写
9. 作为开发者，我希望返回手势（backGestureService）继续正常工作
10. 作为开发者，我希望滚动恢复功能继续正常工作
11. 作为开发者，我希望现有的 E2E 测试不需要因路由更换而修改

## Implementation Decisions

### 决策 1：依赖变更

- **新增** `@solidjs/router @^1.0.0` 到 `dependencies`
- **移除** `@tanstack/solid-router` 从 `dependencies`
- 不改变 `@tanstack/solid-query` — 数据层完全独立于路由器

### 决策 2：路由定义格式

路由从 TanStack 的 `createRoute()` 工厂函数 API 改为 `@solidjs/router` 的纯配置对象数组：

```typescript
// Before (@tanstack/solid-router)
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "home",
  loader: () => ({}),
  component: asRoute(HomePage),
});
const routeTree = rootRoute.addChildren([homeRoute, ...]);
export const router = createRouter({ routeTree, ... });

// After (@solidjs/router)
export const routes: RouteDefinition[] = [
  {
    path: "/",
    component: RootLayout,
    children: [
      { path: "/home", component: lazy(() => import("@/routes/HomePage")) },
      // ...
    ],
  },
];
```

- 路径语法变化：`$id` → `:id`，`$`（catch-all） → `*all`
- 所有路由定义集中在 `src/router.tsx` 单个文件中
- 使用 `lazy()` 保持按需加载
- 去掉 `asRoute()` 类型断言和 `declare module` 注册
- 去掉 `defaultPreload` / `defaultStaleTime` / `defaultPendingMs` 等路由级配置

### 决策 3：Auth 初始化的渲染阻塞取消

**`src/main.tsx`**：
- 将 `await initializeAuth()` 从渲染前移到渲染后
- 渲染流程：`bootstrap()` 中调用 `render()` 后，再在 React 树外并行调用 `initializeAuth()`
- RootLayout 的 `onMount` 中等待 auth 恢复结果后执行导航

具体流程：
```
main.tsx:
  1. initializeStartupPreferences() → 同步加载主题等偏好
  2. render(<App />) → 立即渲染，不阻塞
  3. void initializeAuth() → 在渲染外并行执行

RootLayout.onMount:
  1. 加载持久化偏好（并行）
  2. markContentReady() → 关闭 Splash Screen
  3. await initializeAuth() → 等待 token 恢复
  4. 根据 auth 结果 navigate("/home") 或 navigate("/login")
```

注意：`initializeAuth()` 内部有 `_authInitialized` 门控，双重调用安全。

### 决策 4：API 映射表

所有路由 Hook API 的迁移映射：

| TanStack Router | @solidjs/router | 注意事项 |
|----------------|-----------------|---------|
| `navigate({ to: "/path" })` | `navigate("/path")` | 第二个参数为可选 options |
| `navigate({ to: "/path", replace: true })` | `navigate("/path", { replace: true })` | options 移到第二个参数 |
| `location().pathname` | `location.pathname` | TanStack 返回 Signal（需调用），solid-router 返回普通值 |
| `const { params } = useRouteParams()` | `const params = useParams()` | 返回对象，直接访问 `params.id` |
| `const { params } = location()` | `const params = useParams()` | 统一 API |
| `useRouter()` | 无直接对应 | 使用 `useBeforeLeave()` 或 `useLocation()` |
| `router.history.back()` | `navigate(-1)` | 或 `history.back()` 原生 API |
| `<Outlet />` | `props.children` | 子路由自动作为 children 传入 |
| loader | 无对应 | 数据请求移入组件的 `onMount` |
| `defaultPreload: "intent"` | `<A preload>` 按需使用 | 只在需要的链接上启用 |
| `declare module` 注册 | 无对应 | 类型推导基于配置对象结构 |
| `asRoute()` 断言 | 无对应 | `@solidjs/router` 接受标准 `Component` 类型 |

### 决策 5：滚动恢复

- 使用 `@solidjs/router` 内置 `scrollRestoration`，在 `<Router>` 组件上配置 `scrollRestoration` 选项
- 迁移现有的自定义 `scrollRestoreGlobal` 逻辑：保留 scroll position 的持久化（Preferences），但恢复时机由路由管理
- Tab 内 CSS display 切换（home 页面内的 recommended/follow/bookmarks/history）的滚动位置保持现有 `scrollRestoreGlobal.saveSimple()` 模式不变
- 页间导航（/home → /settings 等）的滚动恢复交给 `@solidjs/router`

### 决策 6：`backGestureService`

- 不修改接口 — `BackGestureContext` 结构不变
- `registerBackGesture()` 的调用方（RootLayout）维持不变的调用方式
- RootLayout 中的 `router.history.back()` 改为 `navigate(-1)` 或 `history.back()`

### 决策 7：NavBar 中的 navigation 调用

- `navigate({ to: "/search" })` → `navigate("/search")`
- `navigate({ to: "/home" })` → `navigate("/home")`

## Testing Decisions

### 测试哲学

- 仅测试外部行为，不测试框架内部实现
- 最高 seam：E2E 行为验证。路由迁移的核心收益「骨架屏先于 API 渲染」只能在真实浏览器中验证
- 次高 seam：路由配置结构验证。确保 route definitions 语法正确且 url 映射完整
- 不 mock `@solidjs/router` 的内部——它在组件内无副作用（不参与数据获取）

### Seam 1 — E2E 测试（最高 seam）

在 `tests/agent-browser/specs/` 中新增一个 spec：

- `route-switch-instant.spec.ts`：验证 login → home 过渡后，骨架屏元素（如 `.floating-nav` / `.skeleton-card`）在 API 响应返回前即在 DOM 中
- 使用 Playwright 的 `page.waitForSelector` 而非 `waitForResponse` 来验证先渲染

### Seam 2 — Unit 测试（次高 seam）

重写 `tests/unit/router.test.ts`：

- 删除对 `@tanstack/solid-router` 的 mock
- 验证 `@solidjs/router` 配置对象数组格式正确、所有预期路由存在、无缺失路由
- 测试文件本身在 `happy-dom` 环境中运行，不涉及组件渲染

### 不影响现有测试

以下现有测试不需要修改：
- 所有 store 测试（不依赖具体路由库）
- 所有 service 测试（`backGestureService.test.ts` 通过 `BackGestureContext` 接口测试，不依赖路由实现）
- 所有 api 测试
- 所有 E2E agent-browser specs（因为路由行为不变 — 导航目标路径相同）
- 所有组件测试（在各自测试中 mock 了 `useNavigate`）

## Out of Scope

- **TanStack Query 更换**：不涉及，数据层与路由解耦
- **路由架构重组**（如 flat routes vs nested routes）：保持现有路径结构不变，仅替换库
- **URL 路径结构调整**：保持所有现 URL 路径模式不变（`/home`、`/illust/:id`、`/user/:id` 等）
- **SSR/SSG 支持**：Pictelio 是纯客户端 SPA + Capacitor，不需要服务端路由
- **链接预加载优化**：`@solidjs/router` 的 `<A preload>` 机制可以在后续单独优化，不是本次迁移的必要部分
- **TypeScript strict 配置变更**：不修改 `tsconfig.json`

## Further Notes

- 迁移后 `router.test.ts` 中原有的 `AnyRoute` 类型消失，路由结构测试从遍历 route tree 改为遍历配置对象数组
- `@solidjs/router` 通过 `<Router>` 组件而不是 `<RouterProvider>` 集成到 App 中，`App.tsx` 从 `return (<RouterProvider router={router} />)` 变为 `return (<Router>{routes}</Router>)`
- `rootRoute` 概念消失 — `@solidjs/router` 的顶级路由直接在配置对象数组中用 `path: "/"` 表示
- 迁移完成后验证清单：
  - [ ] dev server 启动无异常
  - [ ] login → home 过渡无白屏
  - [ ] Tab 切换（recommended / follow / bookmarks / history）正常
  - [ ] detail 页导航（/illust/:id、/novel/:id）正常
  - [ ] 返回手势工作正常
  - [ ] 懒加载路由工作正常
  - [ ] 滚动恢复在页间导航正常工作
  - [ ] `pnpm check` 通过
  - [ ] `pnpm test` 通过
- 监控指标：迁移后 login → home 首次骨架屏渲染时间应逼近 0ms（同步渲染）
