# @solidjs/router — 完整深度研究报告

> **来源**: [github.com/solidjs/solid-router](https://github.com/solidjs/solid-router) （627 commits, MIT）  
> **版本**: v1.0.0 (2026-01-10)  
> **包名**: `@solidjs/router` → npm  
> **作者**: Ryan Carniato, Ryan Turnquist  
> **依赖**: `solid-js ^1.8.6` (peer)  
> **构建**: Rollup + TypeScript, pnpm monorepo with Changesets

---

## 目录

- [一、项目定位与哲学](#一项目定位与哲学)
- [二、源码架构全览](#二源码架构全览)
- [三、核心数据结构（types.ts）](#三核心数据结构typests)
- [四、路由引擎（routing.ts）](#四路由引擎routingts)
- [五、工具函数层（utils.ts）](#五工具函数层utilsts)
- [六、四种路由器实现](#六四种路由器实现)
- [七、事件系统与链接拦截（events.ts）](#七事件系统与链接拦截eventsts)
- [八、导航生命周期（lifecycle.ts）](#八导航生命周期lifecyclests)
- [九、滚动恢复（scrollRestoration.ts）](#九滚动恢复scrollrestorationts)
- [十、Data APIs 层](#十data-apis层)
- [十一、测试架构分析](#十一测试架构分析)
- [十二、版本历史与迁移](#十二版本历史与迁移)
- [十三、TypeScript 类型系统深度分析](#十三typescript-类型系统深度分析)
- [十四、响应式设计模式](#十四响应式设计模式)
- [十五、关键数据流与竞态处理](#十五关键数据流与竞态处理)
- [十六、Tree-Shaking 与体积](#十六tree-shaking-与体积)
- [十七、总结与评价](#十七总结与评价)

---

## 一、项目定位与哲学

`@solidjs/router` 是 SolidJS 官方路由方案，受 Ember Router 和 React Router 启发，但完全遵循 SolidJS 的细粒度响应式哲学。

### 核心设计原则

1. **Signal 驱动一切**：路由状态（location、params、search params）都是 Signal，消费端按需订阅
2. **render-as-you-fetch**：通过 `preload` 机制在导航确认前并行开始数据加载
3. **声明式路由定义**：支持 JSX 组件式和纯配置对象两种定义方式
4. **通用渲染**：一套 API 同时支持客户端 SPA 和 SSR
5. **不可变路径匹配**：纯函数匹配器，无副作用

### 与 React Router 的关键区别

| 维度 | React Router v6+ | @solidjs/router |
|------|-------------------|-----------------|
| 状态管理 | React Context + useReducer | Signal + Context |
| `<Outlet>` | 显式 `<Outlet/>` | 自动通过 `props.children` |
| 数据加载 | `loader` / `useLoaderData` | `preload` / `query` / `createAsync` |
| 细粒度更新 | 组件级重渲染 | Signal 级更新 |
| 路由过渡 | `useNavigation` | `useIsRouting()`（Signal） |

---

## 二、源码架构全览

```
src/
├── index.tsx                    # 公共 API 导出入口 (915B)
├── components.tsx               # <A> + <Navigate> 组件 (2.5KB)
├── routing.ts                   # ★ 核心路由引擎 (21.9KB, 最核心模块)
├── types.ts                     # 全部 TypeScript 类型定义 (7.2KB)
├── utils.ts                     # 路径解析/匹配器/工具函数 (7KB)
├── lifecycle.ts                 # beforeLeave 生命周期 (2.3KB)
├── routers/                     # 四种路由器 + 路由组件
│   ├── components.tsx           # createRouterComponent + Route (6.4KB)
│   ├── createRouter.ts          # 路由集成层工厂 (1.9KB)
│   ├── Router.ts                # History-based 路由器
│   ├── HashRouter.ts            # Hash 模式路由器 (2KB)
│   ├── MemoryRouter.ts          # 内存模式路由器 (2.2KB)
│   ├── StaticRouter.ts          # SSR 静态路由器 (617B)
│   ├── scrollRestoration.ts     # 滚动恢复 (4KB)
│   └── index.ts                 # 路由导出
└── data/                        # Data APIs (完整数据层)
    ├── index.ts                 # 导出
    ├── createAsync.ts           # createAsync / createAsyncStore (4.5KB)
    ├── query.ts                 # query / cache / revalidate (8.4KB)
    ├── action.ts                # action / useAction / useSubmission (7.3KB)
    ├── response.ts              # redirect / reload / json (1.6KB)
    └── events.ts                # 事件系统（链接拦截、表单提交）(5.4KB)
```

### 包构建产物

```json
{
  "exports": {
    ".": {
      "solid": "./dist/index.jsx",   // SolidJS 编译器保留 JSX
      "default": "./dist/index.js"    // 标准 ESM
    }
  },
  "sideEffects": false,
  "files": ["dist"]
}
```

双出口策略：`.jsx` 出口保留 JSX 语法供 Solid 编译器优化，`.js` 出口为纯 JS。

---

## 三、核心数据结构（types.ts）

### 3.1 类型体系总览

types.ts 定义了约 30 个类型/接口，构成完整的类型系统：

#### 路由定义层

```typescript
// 路由定义（用户配置）
interface RouteDefinition<S, T> {
  path?: S | S[];
  matchFilters?: MatchFilters<S>;
  preload?: RoutePreloadFunc<T>;
  children?: RouteDefinition | RouteDefinition[];
  component?: RouteSectionComponent<T>;
  info?: Record<string, any>;
}

// 编译后的路由描述（内部表示）
interface RouteDescription {
  key: unknown;
  originalPath: string;
  pattern: string;
  component?: Component<RouteSectionProps>;
  preload?: RoutePreloadFunc;
  matcher: (location: string) => PathMatch | null;  // ← 匹配函数
  info?: Record<string, any>;
}

// 分支（从根到叶的一条完整路径）
interface Branch {
  routes: RouteDescription[];  // 按嵌套深度排列
  score: number;               // 匹配优先级评分
  matcher: (location: string) => RouteMatch[] | null;
}
```

#### 路由器上下文

```typescript
interface RouterContext {
  base: RouteContext;
  location: Location;
  params: Params;
  navigatorFactory: NavigatorFactory;
  isRouting: () => boolean;
  readonly pendingTarget?: LocationChange;  // 正在进行的导航目标
  matches: () => RouteMatch[];
  renderPath: (path: string) => string;
  parsePath: (str: string) => string;
  beforeLeave: BeforeLeaveLifecycle;
  preloadRoute: (url: URL, preloadData?: boolean) => void;
  singleFlight: boolean;
  submissions: Signal<Submission<any, any>[]>;
}
```

#### Location 系统

```typescript
interface Location<S = unknown> extends Path {
  query: SearchParams;                    // 响应式代理对象
  state: Readonly<Partial<S>> | null;
  key: string;
}

interface Path {
  pathname: string;
  search: string;
  hash: string;
}

interface LocationChange<S = unknown> {
  value: string;     // URL path
  replace?: boolean;
  scroll?: boolean;
  state?: S;
}
```

#### 路由上下文（每个嵌套层级）

```typescript
interface RouteContext {
  parent?: RouteContext;
  child?: RouteContext;
  pattern: string;
  path: () => string;          // Accessor（响应式）
  outlet: () => JSX.Element;   // 渲染出口
  resolvePath(to: string): string | undefined;
}
```

### 3.2 关键设计决策

- **`RouteDefinition<T>` 的泛型默认 `any`**（#454）：在 `const routes: RouteDefinition[]` 标注场景下没有推断位点，所以不能默认 `unknown`
- **`RouteSectionComponent` 三态联合**（#347）：同时接受 `RouteSectionProps` 组件、无 `children` 的组件、以及 `VoidComponent`
- **`SubmissionStub`**：提供空实现防止 `useSubmission` 无匹配时崩溃
- **`RequestEvent` 模块合并**：扩展 `solid-js/web` 的 `RequestEvent` 接口以支持路由缓存序列化

---

## 四、路由引擎（routing.ts）

这是整个路由器最核心的文件（21.9KB），包含全部响应式原语和路由状态管理。

### 4.1 上下文体系

```typescript
// 两个 Context，不使用 SolidJS Provider 嵌套
export const RouterContextObj = createContext<RouterContext>();
export const RouteContextObj = createContext<RouteContext>();
```

**`useRoute()` 的 fallback 链**:
1. `TempRoute` — 供 `createRouteContext` 临时设置
2. `useContext(RouteContextObj)` — 正常嵌套路由
3. `useRouter().base` — 回退到根路由

### 4.2 `createRouterContext()` — 核心工厂

这是路由器的"大脑"，约 300 行，负责：

1. **Location 创建** (`createLocation`)：将 source Signal 转为响应式 Location 对象
2. **路径匹配** (`matches`)：Memo 缓存，根据 branches 和 location 实时计算
3. **参数构建** (`params`)：通过 `createMemoObject` 实现的惰性代理
4. **导航过渡** (`transition`)：`startTransition` 包装，防并发竞态

```typescript
// 关键状态
const [reference, setReference] = createSignal(source().value);  // 当前 URL
const [state, setState] = createSignal(source().state);          // history state
const [isRouting, setIsRouting] = createSignal(false);           // 过渡状态
let lastTransitionTarget: LocationChange | undefined;            // 并发防护
const referrers: LocationChange[] = [];                          // 重定向栈（最多 100 层）
```

#### 导航过渡流程

```
navigate(path)
  → navigateFromRoute(route, to, options)
    → beforeLeave.confirm()           // 安全检查
    → referrers.push(current)         // 保存回退位置
    → transition("navigate", target)  // 开始过渡
      → isRouting = true
      → startTransition(() => {
          setReference(target.value)  // 更新 Signal
          resetErrorBoundaries()
        }).finally(() => {
          isRouting = false           // 过渡结束
          navigateEnd()               // 通知集成层
        })
```

**竞态防护**: `lastTransitionTarget` 比较确保只有最新的 transition 生效。

**重定向保护**: `referrers.length >= 100` 抛出 "Too many redirects"。

### 4.3 `createRoutes()` — 路由编译

将 `RouteDefinition` 编译为 `RouteDescription[]`:

```typescript
function createRoutes(routeDef: RouteDefinition, base: string): RouteDescription[]
```

关键处理：
- `path` 可能为字符串数组，展开为多个路由
- 可选段展开 (`expandOptionals`)
- 叶子节点保留 `/*` 通配符，非叶子节点只匹配精确前缀
- 静态段编码：`encodeSegment` 保留 RFC 3986 pchar 字符（`+` `@` `:` `$` `&` `,` `;` `=`）

### 4.4 `createBranches()` — 分支生成

递归将路由嵌套树拍平为 Branch 数组：

```typescript
function createBranches(routeDef, base, stack, branches): Branch[]
```

- 深度优先遍历路由树
- 每一条从根到叶子的路径生成一个 Branch
- 按 `score` 降序排序（高优先级在前）

### 4.5 响应式原语实现

所有 `use*` 原语都直接读取 `RouterContext` 上的属性，借助 SolidJS 的细粒度响应性自动跟踪依赖。

**`useSearchParams` 的特殊处理**：
```typescript
const setSearchParams = (params, options) => {
  const pending = router.pendingTarget && new URL(router.pendingTarget.value, mockBase);
  const pathname = pending ? pending.pathname : location.pathname;
  const search = pending ? pending.search : location.search;
  // 合并到进行中的导航目标，而非已提交的 location
  navigate(pathname + mergeSearchString(search, params) + hash, { scroll: false, resolve: false, ...options });
};
```

**重要设计**：连续的 `setSearchParams` 调用会合并到正在进行的导航目标（`pendingTarget`），防止覆盖（fix #547）。

### 4.6 `createRouteContext()` — 每路由上下文

当路由匹配时，为每个匹配层级创建 RouteContext：

```typescript
function createRouteContext(router, parent, outlet, match): RouteContext
```

- 触发 `component.preload()`（如果组件有静态 preload 方法）
- 调用 `route.preload()` 获取 data
- 构造 outlet：通过 `createComponent` 渲染路由组件，`children` 自动传入嵌套路由出口

---

## 五、工具函数层（utils.ts）

### 5.1 路径处理

```typescript
const hasSchemeRegex = /^(?:[a-z0-9]+:)?\/\//i;  // 检测协议相对路径
const trimPathRegex = /^\/+|(\/)\/+$/g;           // 去除冗余斜杠
export const mockBase = "http://sr";               // 虚拟 base URL
```

- **`normalizePath`**: 标准化路径，去除多余斜杠，保证以 `/` 开头
- **`resolvePath`**: 解析相对路径，检测 scheme 则返回 undefined（跨协议不匹配）
- **`joinPaths`**: 连接两个路径段（去除 base 的通配符后缀）

### 5.2 `createMatcher()` — 路径匹配器

编译时生成匹配函数，返回 `PathMatch | null`：

```typescript
function createMatcher<S extends string>(path: S, partial?: boolean, matchFilters?: MatchFilters<S>) {
  // 编译阶段：
  const [pattern, splat] = path.split("/*", 2);  // 分离通配符
  const segments = pattern.split("/").filter(Boolean);
  const len = segments.length;

  // 运行时：
  return (location: string): PathMatch | null => {
    // 1. 去除首尾斜杠
    // 2. 拒绝空段（/foo//bar 不匹配 /foo/bar, fix #567）
    // 3. 长度检查
    // 4. 逐段匹配（动态段 :param vs 静态段）
    // 5. 通配符段匹配
    
    // matchFilter 支持 string | RegExp | function | string[]
    // 动态段匹配：matchSegment(locSegment, matchFilter(key))
  };
}
```

**`matchFilter` 类型支持**：
```typescript
export type MatchFilter = readonly string[] | RegExp | ((s: string) => boolean);
```

### 5.3 `scoreRoute()` — 路由评分

```typescript
function scoreRoute(route: RouteDescription): number {
  const [pattern, splat] = route.pattern.split("/*", 2);
  const segments = pattern.split("/").filter(Boolean);
  return segments.reduce(
    (score, segment) => score + (segment.startsWith(":") ? 2 : 3),
    segments.length - (splat === undefined ? 0 : 1)
  );
}
```

- 静态段得 3 分，动态段得 2 分
- 有通配符的减 1 分
- 得分高的分支优先匹配

### 5.4 `createMemoObject()` — 惰性代理

将普通对象的每个属性包装为独立的 `createMemo`：

```typescript
function createMemoObject<T>(fn: () => T): T {
  // Proxy 拦截 get，按需创建 Memo
  // 只有访问到的属性才订阅响应性
}
```

**关键设计**：这是 SolidJS 细粒度响应式的关键 — 即使 `useParams()` 返回对象包含多个参数，组件只订阅实际使用的参数。

### 5.5 `expandOptionals()` — 可选段展开

```typescript
function expandOptionals(pattern: string): string[]
```

将 `/:a?/:b?/:c` 展开为：
- `/` 
- `/:a`
- `/:a/:b`
- `/:a/:b/:c`

**注意**：不生成 `/:b` 或 `/:c` 等中间排列 — 早期参数优先级更高。

### 5.6 `mergeSearchString()`

将 `SetSearchParams` 合并到现有 search string 中：
- `null` / `undefined` / `""` 值删除该 key
- 数组值追加多个同名参数
- 返回格式 `?key=value&...`

---

## 六、四种路由器实现

### 6.1 架构分层

所有路由器通过 `createRouter` 工厂与 `createRouterComponent` 桥接：

```
[HashRouter/MemoryRouter/Router/StaticRouter]
  → createRouter(config)            // 创建集成信号
    → createRouterComponent(props)  // 创建组件 + 关联 router context
      → createRouterContext(...)    // 核心路由引擎
```

### 6.2 `createRouter()`（1.9KB）

把各路由器的 source/sink 封装为统一的 `Signal<LocationChange>`：

```typescript
function createRouter(config: {
  get: () => string | LocationChange,        // 读取当前位置
  set: (next: LocationChange) => void,       // 更新位置
  init?: (notify) => () => void,             // 初始化监听
  create?: (router: RouterContext) => void,  // 创建后回调
  utils?: Partial<RouterUtils>
}) {
  // 拦截器模式（intercept），set 时调用 config.set
  const signal = intercept<LocationChange>(
    createSignal(wrap(config.get()), { equals: (a, b) => a.value === b.value && a.state === b.state }),
    undefined,
    next => { config.set(next); return next; }
  );
  // init 设置事件监听
  config.init && onCleanup(config.init(notify));
  // 委托给 createRouterComponent
  return createRouterComponent({ signal, create: config.create, utils: config.utils });
}
```

**intercept 模式**：对 `createSignal` 的 set 函数进行包装，在每次状态更新时同步调用路由器的实际写入操作。

### 6.3 `<Router>`（History-based）

```typescript
// src/routers/Router.ts
export function Router(props) {
  const beforeLeave = createBeforeLeave();
  return createRouter({
    get: () => window.location.pathname + window.location.search + window.location.hash,
    set: ({ value, replace, scroll, state }) => {
      replace ? history.replaceState(...) : history.pushState(...);
      scrollToHash(hash, scroll);
    },
    init: notify => bindEvent(window, "popstate", notifyIfNotBlocked(
      notify, delta => !beforeLeave.confirm(delta && delta < 0 ? delta : getSource())
    )),
    create: setupNativeEvents({ preload, explicitLinks }),
    utils: { go: delta => history.go(delta), ... }
  })(props);
}
```

- 通过 `popstate` 事件监听浏览器前进/后退
- 使用 `notifyIfNotBlocked` 处理 beforeLeave 拦截的回退导航

### 6.4 `<HashRouter>`（2KB）

```typescript
export function HashRouter(props) {
  return createRouter({
    get: () => window.location.hash.slice(1),
    set: ({ value, replace, scroll, state }) => {
      if (replace) history.replaceState(keepDepth(state), "", "#" + value);
      else history.pushState(state, "", "#" + value);
      scrollToHash(hash, scroll);
    },
    init: notify => bindEvent(window, "hashchange", notifyIfNotBlocked(notify, ...)),
    create: setupNativeEvents({ ... }),
    utils: {
      renderPath: path => `#${path}`,  // 渲染时加 #
      parsePath: hashParser,           // 解析时去 #
    }
  })(props);
}
```

**`hashParser`** 特殊处理纯 hash 链接（`#foo`）：将其解析为当前路径 + hash，而非根路径 + hash，使页内锚点正常工作。

### 6.5 `<MemoryRouter>`（2.2KB）

```typescript
export function createMemoryHistory() {
  const entries = ["/"];
  let index = 0;
  // go(n): 修改索引，通知监听器
  // set({ value, replace }): 替换/追加条目，通知监听器
  // listen(listener): 注册通知回调
  return { get, set, go, back, forward, listen };
}
```

- 提供 `createMemoryHistory()` 供外部测试使用
- 支持注入自定义 `history` 对象

### 6.6 `<StaticRouter>`（617B）

SSR 路由，最简单：

```typescript
export function StaticRouter(props) {
  const obj = {
    value: props.url || getRequestEvent()?.request.url || "",
  };
  return createRouterComponent({
    signal: [() => obj, next => Object.assign(obj, next)]
  })(props);
}
```

- 无事件监听，纯静态信号
- 服务端通过 `getRequestEvent()` 获取当前请求 URL

### 6.7 `createRouterComponent()`（6.4KB）

路由组件创建的核心：

```typescript
export const createRouterComponent = (router: RouterIntegration) => (props: BaseRouterProps) => {
  // 1. 将 JSX children 转为 RouteDefinition
  const routeDefs = children(() => props.children);
  // 2. 编译路由树为 branches（Memo 缓存，响应式）
  const branches = createMemo(() => createBranches(routeDefs(), props.base || ""));
  // 3. 创建 router context
  const routerState = createRouterContext(router, branches, () => context, { base, ... });
  // 4. 注入 context + 渲染
  return (
    <RouterContextObj.Provider value={routerState}>
      <Root routerState={routerState} root={props.root} preload={...}>
        {(context = getOwner()!) && null}  // ← 捕获 owner
        <Routes routerState={routerState} branches={branches()} />
      </Root>
    </RouterContextObj.Provider>
  );
};
```

**关键设计**：`Routes` 组件内部使用 `createRoot` 为每个匹配的路由层级创建独立的响应式根，在路由变化时精确控制销毁和重建。通过 `disposers` 数组追踪每个层级，确保 unmount 时正确清理（fix #451）。

### 6.8 scrollRestoration（修复 #577）

浏览器原生同文档滚动恢复在 suspense 驱动的渲染中不可靠（目标路由在文档还短时强制布局会丢失保存的偏移量）。该模块通过 `history.scrollRestoration = "manual"` 接管：

```
scroll 事件 → 按 _depth 记录 position → sessionStorage 持久化
popstate → pending = depth()
isRouting 变 false → restore() → scrollTo(y)
```

**v1.0 变更**：移除了 `ResizeObserver` 重试。过渡提交后单次恢复，不追逐还在增长的文档，与 SvelteKit/TanStack Router/React Router 策略一致。

---

## 七、事件系统与链接拦截（events.ts）

### 7.1 `setupNativeEvents()`

在路由器创建后被调用，挂载全局 DOM 事件监听：

```typescript
function setupNativeEvents(config) {
  return (router: RouterContext) => {
    document.addEventListener("click", handleAnchorClick);      // 链接点击
    document.addEventListener("mousemove", handleAnchorPreload); // 链接悬停预加载
    document.addEventListener("focusin", handleAnchorPreload);   // 焦点预加载
    document.addEventListener("touchstart", handleAnchorPreload);// 触摸预加载
    document.addEventListener("submit", handleFormSubmit);       // 表单提交
  };
}
```

### 7.2 链接点击拦截流程

```
handleAnchorClick(evt)
  → 安全检查（button !== 0, meta/alt/ctrl/shift 不拦截）
  → composedPath() 查找 <a> 元素
  → 过滤：explicitLinks 模式只拦截 link 属性、忽略 download/external
  → new URL(href) 解析
  → 跨域检查（origin 需匹配，basePath 需匹配）
  → router.parsePath(pathname + search + hash)
  → navigateFromRoute(to, { resolve: false, replace, scroll, state })
```

### 7.3 预加载流程（20ms 防抖）

```
mousemove → handleAnchorMove
  → clearTimeout preloadTimeout
  → 20ms 防抖 → router.preloadRoute(url, preloadData)
    → getRouteMatches(branches, url.pathname)
    → 触发每个匹配路由的 component.preload()
    → 触发 route.preload({ params, location, intent: "preload" })
```

- 20ms 防抖避免大量悬停触发
- `lastElement` 去重，同一元素不重复预加载

### 7.4 表单提交拦截

```typescript
handleFormSubmit(evt) {
  // 仅拦截 action 以 actionBase（默认 /_server）开头的表单
  // 仅支持 POST
  // 查找 actions 注册表获取 handler
  // 支持 multipart/form-data 和 URLSearchParams
}
```

- 用 `delegateEvents` 确保在 SolidJS 事件委托后执行
- 通过 `actions` Map 查找注册的 action handler

---

## 八、导航生命周期（lifecycle.ts）

### 8.1 `createBeforeLeave()`

```typescript
function createBeforeLeave(): BeforeLeaveLifecycle {
  let listeners = new Set<BeforeLeaveListener>();
  let ignore = false;

  function confirm(to, options?) {
    if (ignore) return !(ignore = false);  // 单次跳过
    
    const e = { defaultPrevented: false, preventDefault() { ... } };
    for (const l of listeners) {
      l.listener({ to, options, defaultPrevented: e.defaultPrevented, preventDefault, from, retry });
    }
    return !e.defaultPrevented;
  }
  return { subscribe, confirm };
}
```

**`retry(force?)` 机制**：
- `force = true`：设置 `ignore = true`，跳过所有 leave handlers
- `force = false` 或未传：重新运行所有 leave handlers

### 8.2 浏览器前进/后退拦截

```typescript
// 保存当前 depth
let depth: number;
function saveCurrentDepth() {
  // 在 history.state 中记录 _depth = history.length - 1
}

// popstate 时对比 depth 变化
function notifyIfNotBlocked(notify, block) {
  return () => {
    const delta = depth - new_delta;  // 正 = 前进，负 = 后退
    if (delta && block(delta)) {
      // 被拦截：调用 history.go(-delta) 回退
    } else {
      notify();  // 正常导航
    }
  };
}
```

---

## 九、Data APIs 层

### 9.1 `createAsync(fn, options?)`（`createAsync.ts`）

Solid 2.0 原语的预演版本，基于 `createResource` 封装：

```typescript
function createAsync<T>(fn: (prev: T | undefined) => Promise<T>, options?) {
  const [resource] = createResource(
    () => subFetch(fn, catchError(() => untrack(prev), () => undefined)),
    v => v,
    options
  );
  // 添加 .latest 属性
  const resultAccessor: AccessorWithLatest<T> = () => resource();
  Object.defineProperty(resultAccessor, "latest", {
    get() { return resource.latest; }
  });
  return resultAccessor;
}
```

**`subFetch`**：水合期间用 `MockPromise` 替换全局 `fetch` 和 `Promise`，防止嵌套 Promise 导致重复请求。

**`createAsyncStore`**：类似但使用 `createStore` + `reconcile` 实现深层响应。

### 9.2 `query(fn, name)`（`query.ts`）

声明式缓存数据查询（8.4KB，最复杂的 data 文件）：

```typescript
function query<T>(fn: T, name: string): CachedFunction<T> {
  // 优先使用 .GET 方法（如果存在）
  // 缓存键 = name + hashKey(args)
  
  const cachedFn = (...args) => {
    // 1. 检查缓存
    // 2. 判断是否可用（未过期、preload 期间、有追踪者等）
    // 3. 响应式追踪：getListener() 存在时增加引用计数
    // 4. 服务端序列化到 sharedConfig
    // 5. handleResponse 处理 Response 对象
  };
  
  cachedFn.keyFor = (...args) => name + hashKey(args);
  cachedFn.key = name;
}
```

**缓存过期策略**：

| 条件 | 行为 |
|------|------|
| 缓存未命中 | 执行函数，缓存结果 |
| 有追踪者（渲染中） | 复用缓存 |
| preload 后 5 秒内 | 复用缓存（PRELOAD_TIMEOUT） |
| `intent === "native"`（前进/后退） | 复用缓存 |
| 已过期且无追踪者 | 重新请求 |
| 每 5 分钟清理过期条目（300秒间隔） | 清理超过 3 分钟未使用的缓存 |

**服务端响应式处理**：`cacheKeyOp` 和 `revalidate` 配合 `startTransition` 触发信号更新。

**`query.set` / `query.get` / `query.delete` / `query.clear`**：提供手动缓存操作。

### 9.3 `action(fn, options?)`（`action.ts`）

服务端/客户端变异操作：

```typescript
function action(fn, options) {
  // 1. 生成 action URL（hash 或自定义 name）
  // 2. 注册到全局 actions Map
  // 3. 返回 with() 支持偏函数应用
  
  const mutate = function(this: { r: RouterContext, f?: HTMLFormElement }, ...variables) {
    // 创建 Submission 条目
    // 单次飞行模式（singleFlight）优先级
    // 完成后 handleResponse → 处理 redirect/revalidate
  };
  
  return toAction(mutate, url);
}
```

**`Action<T, U, V>` 类型**：可调用函数 + `.with()` 方法（偏函数应用）+ `.url` 属性。

**Submission 生命周期**：
```
action() 调用
  → submission.pending = true
  → 异步完成
    → 成功：submission.result = data
    → 失败：submission.error = error
  → 触发 revalidate
  → 导航（如果 response 有 Location）
```

### 9.4 响应式工具（`response.ts`）

```typescript
redirect(url, init?)     → Response (302) + Location header
reload(init?)            → Response (200) + X-Revalidate header
json(data, init?)        → Response (200) + JSON body + X-Revalidate
```

**典型用法**（throw 方式用于 query/action 中提前返回）：
```typescript
const getUser = query(() => {
  const user = await api.getCurrentUser();
  if (!user) throw redirect("/login");
  return user;
});
```

---

## 十、测试架构分析

测试目录 `test/` 包含 20+ 测试文件：

```
test/
├── setup.ts               # 测试环境初始化
├── helpers.ts             # 测试辅助函数
├── router.spec.ts         # Router context 单元测试 (14KB, 最详细)
├── route.spec.ts          # 路由匹配测试
├── integration.spec.ts    # 集成测试
├── utils.spec.ts          # 工具函数测试 (14.7KB)
├── types.spec.ts          # 类型测试
├── lifecycle.spec.ts      # beforeLeave 测试
├── search-params.spec.tsx # search params 测试
├── scroll-restoration.spec.tsx
├── routes-disposal.spec.tsx  # 路由销毁测试 (fix #451)
├── cached-error.spec.tsx  # 缓存错误处理
├── data.spec.tsx          # data API 集成测试
└── data/                  # Data APIs 专项测试
    ├── action.spec.ts     # action 测试 (12.5KB)
    ├── createAsync.spec.ts # createAsync 测试
    ├── events.spec.ts     # 事件系统测试 (19.5KB, 最大的测试文件)
    ├── query.spec.ts      # query 测试
    └── response.spec.ts   # response 测试
```

### 10.1 测试工具（`helpers.ts`）

```typescript
export function createAsyncRoot(resolve) {
  // 在 createRoot 内执行异步测试
}

export function waitFor(condition, timeout = 1000) {
  // 轮询直到条件为真，用于测试响应式更新
}

export function createCounter(fn) {
  // 跟踪函数调用次数，验证响应式精确度
  // createCounter(() => location.pathname) 应返回 0 当只有 search 变化时
}
```

### 10.2 测试模式案例

**细粒度响应性测试**:
```typescript
test("ignore the queryString part of the integration signal", () => {
  const count = createCounter(() => location.pathname);
  signal[1]({ value: "/foo/bar?fizz=buzz" });  // 只改 search
  expect(count()).toBe(0);  // pathname 的 Memo 不重新计算
});
```

**并发导航测试**:
```typescript
test("be able to be called many times before it updates", () => {
  navigate("/foo/1");
  navigate("/foo/2");
  navigate("/foo/3");
  navigate("/foo/4");
  navigate("/foo/5");
  // 只有最后一个生效（通过 lastTransitionTarget 防护）
  waitFor(() => signal[0]().value === "/foo/5");
});
```

---

## 十一、版本历史与迁移

### v1.0.0（当前稳定版）

**本质是版本对齐**：代码与 0.16.x 相同，但 `^1.0.0` 获得正常的 caret 语义（0.x 被解析器锁定副版本）。

### 重大变更时间线

| 版本 | 变更 |
|------|------|
| **0.11.0** | 引入 Changesets，Data APIs 实验性发布 |
| **0.12.0** | `createAsyncStore` 替代 store in cache |
| **0.13.0** | Action 错误支持 |
| **0.14.0** | `load` → `preload` 重命名，Response helpers 返回 Response |
| **0.15.0** | `cache` → `query` 重命名 |
| **0.16.0** | 移除 `<Outlet>` / `<Routes>` / `useRouteData` / `element` prop |
| **1.0.0** | 版本对齐，移除 ResizeObserver 滚动恢复 |

### 从 v0.9.x 迁移到 v1.0

| 旧 API | 新方案 |
|--------|--------|
| `<Outlet>` | `props.children`（由路由自动传入） |
| `<Routes>` | 路由直接作为 `<Router>` 的子节点 |
| `useRoutes()` | 配置式路由或 JSX |
| `element` prop | `component` prop |
| `data` + `useRouteData` | `preload` 函数 + Context |
| `route.metadata` | `route.info` |
| `rootLoad` | `rootPreload` |

---

## 十二、TypeScript 类型系统深度分析

### 12.1 路径参数推导

```typescript
// 从路径字符串提取参数名
export type PathParams<P extends string | readonly string[]> =
  P extends `${infer Head}/${infer Tail}`
    ? [...PathParams<Head>, ...PathParams<Tail>]
    : P extends `:${infer S}?`
    ? [S]
    : P extends `:${infer S}`
    ? [S]
    : P extends `*${infer S}`
    ? [S]
    : [];

// MatchFilters 自动推导
export type MatchFilters<P extends string | readonly string[]> = P extends string
  ? { [K in PathParams<P>[number]]?: MatchFilter }
  : Record<string, MatchFilter>;
```

### 12.2 缓存函数类型

```typescript
export type CachedFunction<T extends (...args: any) => any> = T extends (...args: infer A) => infer R
  ? ((...args: A) => R extends Promise<infer P> ? Promise<NarrowResponse<P>> : NarrowResponse<R>)
    & { keyFor: (...args: A) => string; key: string }
  : never;
```

`NarrowResponse<T>` 从 `CustomResponse<T>` 中提取 `T`，否则排除 Response 类型。

### 12.3 模块合并

```typescript
declare module "solid-js/web" {
  interface RequestEvent {
    response: { status?: number; ... headers: Headers };
    router?: { matches?: OutputMatch[]; cache?: Map<string, CacheEntry>; ... };
  }
}

declare module "solid-js" {
  namespace JSX {
    interface AnchorHTMLAttributes<T> {
      state?: string;    // 扩展 <a> 标签支持 state
      noScroll?: boolean;
      replace?: boolean;
      preload?: boolean;
      link?: boolean;
    }
  }
}
```

---

## 十三、响应式设计模式

### 13.1 核心响应式链条

```
<Signal<LocationChange>>  ← 集成层
  → createMemo(location)     ← createLocation()
    → createMemo(matches)    ← getRouteMatches()
      → createMemo(params)   ← createMemoObject()
      → jsx: <Route>         ← 自动追踪使用的属性
```

### 13.2 createMemoObject 代理

```typescript
function createMemoObject<T>(fn: () => T): T {
  return new Proxy({}, {
    get(_, property) {
      if (!map.has(property)) {
        runWithOwner(owner, () =>
          map.set(property, createMemo(() => fn()[property]))
        );
      }
      return map.get(property)();
    }
  });
}
```

**效果**：`useParams()` 返回的代理对象，每个属性都是独立的 Memo。组件只追踪其实际使用的参数，修改未使用的参数不会触发重渲染。

### 13.3 路由销毁与重建

在 `createRouterComponent` 的 `Routes` 组件中，每个匹配层级用 `createRoot` 隔离：

```typescript
// 创建新的根
createRoot(dispose => {
  disposers[i] = dispose;
  next[i] = createRouteContext(...);
});
// 销毁旧根
disposers.splice(nextMatches.length).forEach(dispose => dispose());
```

`onCleanup` 确保整个路由树卸载时清理所有 disposers（fix #451）。

---

## 十四、关键数据流与竞态处理

### 14.1 导航竞态防护

```typescript
let lastTransitionTarget: LocationChange | undefined;

const transition = (newIntent, newTarget) => {
  if (newTarget.value === reference() && newTarget.state === state()) return;
  lastTransitionTarget = newTarget;
  
  startTransition(() => {
    if (lastTransitionTarget !== newTarget) return;  // ← 竞态防护
    setReference(lastTransitionTarget.value);
    setState(lastTransitionTarget.state);
  }).finally(() => {
    if (lastTransitionTarget !== newTarget) return;  // ← 竞态防护
    isRouting = false;
    lastTransitionTarget = undefined;
  });
};
```

### 14.2 setSearchParams 合成

连续的 `setSearchParams` 调用会合并到 `pendingTarget`，而不是已提交的 location：

```
setSearchParams({ page: 1 })
setSearchParams({ sort: "new" })
  → 结果：?page=1&sort=new（两个都生效）
```

### 14.3 Action 并行防护

`singleFlight` 标志控制：如果为 true，action 发起时 header 携带 `X-Single-Flight`，服务端应取消正在处理的相同请求。

### 14.4 100 层重定向保护

```typescript
const MAX_REDIRECTS = 100;
if (referrers.length >= MAX_REDIRECTS) {
  throw new Error("Too many redirects");
}
```

---

## 十五、Tree-Shaking 与体积

项目维护 `.shake-check/` 目录持续监控构建体积：

| 入口 | v0.16 min | v1.0 min | 说明 |
|------|-----------|----------|------|
| full | 19.4KB | 23.2KB | 全部导出 |
| router-only | 12.7KB | 16.2KB | 仅路由功能 |
| typical | 14.6KB | 17.5KB | 路由 + 部分 Data APIs |

v1.0 体积增加主要来自 Data APIs（action/query/response/events）。

### 体积优化策略

- `sideEffects: false` 声明
- `/* #__PURE__ */` 标注纯函数（如 `actions` Map）
- CSB（Code Splitting Bundle）设计：Data APIs 按需导入

---

## 十六、总结与评价

### 优势

| 维度 | 评价 |
|------|------|
| **响应式集成** | 完全借用 SolidJS Signal 体系，实现精确到属性的订阅更新 |
| **类型安全** | 路径参数推导、matchFilters 类型约束、query 响应类型自动窄化 |
| **测试质量** | 20+ 测试文件覆盖核心路径、边界条件和历史 Bug 回归 |
| **数据层** | query/action/response 完整的 "请求-缓存-变异" 循环 |
| **SSR 支持** | StaticRouter + 服务端缓存序列化 + 水合恢复 |
| **Tree-shaking** | 持续监控体积，Data APIs 可独立导入 |

### 设计权衡

| 决策 | 收益 | 成本 |
|------|------|------|
| 移除 `<Outlet>` | 简化嵌套路由，避免跨岛屿边界使用 Context | 违反常见路由模式直觉 |
| preload 替代 data | 支持链接悬停预加载，不污染响应式 | 需要手动 Context 传递数据 |
| `createMemoObject` 代理 | 细粒度响应性 | 需通过 Proxy，不支持老环境 |
| Single-flight mutations | 避免重复请求 | 需服务端配合 |

### 适用场景

- ✅ 任何 SolidJS SPA 项目
- ✅ SolidStart（SolidJS 元框架）及其 SSR/SSG 应用
- ✅ 需要细粒度路由响应的高性能应用
- ✅ 需要服务端数据预加载的 SSR 项目
- ⚠️ 大批量静态路由（类型推导可能较慢，提供 `.type-bench/` 监控）

### 与项目（Pictelio）的关系

Pictelio/pixivizer 当前使用 `@tanstack/solid-router`。如果考虑迁移到 `@solidjs/router`：

- **路由定义方式类似**：都支持配置式路由
- **`preload` vs TanStack loader**：`@solidjs/router` 的 preload 更轻量，无 loader 独立概念
- **无 TanStack Query 集成**：`query()` API 更简单但功能不如 TanStack Query 丰富
- **社区标准**：SolidJS 官方推荐，在 SolidStart 生态中是默认选择

---

## 十七、参考链接

- 官方文档: https://docs.solidjs.com/solid-router
- GitHub: https://github.com/solidjs/solid-router
- npm: https://npmjs.com/package/@solidjs/router
- SolidJS Discord: https://discord.com/invite/solidjs
- SolidStart: https://start.solidjs.com
