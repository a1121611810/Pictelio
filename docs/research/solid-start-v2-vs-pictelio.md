# SolidStart v2 与 Pictelio app 的平替/迁移可行性研究

> 调研日期：2026-09-07
> 调研对象：`@solidjs/start` v2（npm `latest` = **2.0.4**）vs `packages/app`（SolidJS 1.9 + `@solidjs/router` 1.0 + Vite 8.2 + vite-plus 0.2.8 + Capacitor 8.5 + UnoCSS 66.7）
> 结论性质：**不推荐迁移**（详见 TL;DR 与红线清单）

---

## TL;DR

**不推荐迁移。** SolidStart v2 的 `solidStart({ ssr: false })` 是官方存在的选项（源码 `SolidStartOptions.ssr?: boolean`，默认 `true`），但它**不产生静态 SPA 产物**——即使 `ssr: false`，`solidStart()` 仍然强制构建 `dist/client` + `dist/server` 两个 Vite environment，HTML 外壳由服务端的 `StartServer`（SPA 变体）在请求时渲染，需要 Nitro 运行时或 `nitro.prerender` 才能落成 `index.html`。这与 Capacitor「把 `dist/` 整包塞进 `assets/public/` 由 WebView 加载」的模型正面冲突：多一层 Nitro static preset 预渲染，且该链路在 2026-08 之前的 `base` 处理上刚修完 bug（`@solidjs/start@2.0.3` + `nitro` PR #4509，issue #2288/#2151）。

其次是**硬约束冲突**：项目的「先渲染后加载」硬约束禁止路由级 `await` 阻塞渲染，而 SolidStart v2 的核心数据模型正是 `route.preload` + `createAsync`；虽然可以不用，但那样迁移只剩「文件路由 + `~` alias」两项收益。而这两项收益的成本是：删掉 `src/router.tsx`（51 行）、重排 16 个 `src/routes/*.tsx`、新增 `src/app.tsx` + `src/entry-client.tsx` + `src/entry-server.tsx` 三个强制入口文件、把 `src/main.tsx`（68 行的 bootstrap 编排：settings 同步 → Fluent 主题 → render → auth 恢复 → feed 缓存恢复）拆进 SolidStart 固定的 `entry-client` 契约里，并且要验证 vite-plus 的 `defineConfig`（含 `lint`/`fmt` 扩展字段 + rolldown `codeSplitting.groups`）与 `solidStart()` 的 Environment API 接管是否共存。

**唯一有条件推荐的场景**：如果未来 Pictelio 需要一个真正的服务端（例如把 `credentials.json5` 里的 A 类凭据从客户端挪到 BFF），SolidStart v2 才成为正解。仅为文件路由迁移是负收益。

---

## Q1：SolidStart v2 在「不需要 SSR」的纯 SPA 场景下还成立吗？

### 结论

`ssr: false` 是**官方支持的 plugin option**（源码有类型定义、有为它修的 bug、有 issue 复现配置），但官方**文档站完全没有描述它**——v2 文档全站（Overview / Getting started / Migrating from v1 / Routing / Data fetching / API routes / CSS / Route pre-rendering / Static assets / Deployment plugins）一次都没有提到 SPA 模式、`ssr: false`、client-only rendering。"我想要文件路由但不要 SSR" 的官方描述**不存在**。而且 `ssr: false` **不等于**「不需要服务器」。

### 证据

**证据 1 — 源码类型定义（一手，唯一权威来源）**
`https://github.com/solidjs/solid-start/blob/main/packages/start/src/config/index.ts`
`SolidStartOptions` 完整 key 列表：

| key | 说明（引自源码注释） |
|---|---|
| `appRoot?: string` | "Path to the root of the application"（默认 `"./src"`） |
| `routeDir?: string` | "Directory containing file-system routes, relative to appRoot"（默认 `"./routes"`） |
| `extensions?: string[]` | "File extensions that should be treated as routes" |
| `ssr?: boolean` | "Enable or disable server-side rendering"（默认 `true`） |
| `devOverlay?: boolean` | "Show the SolidStart development overlay"（默认 `true`） |
| `middleware?: string` | "Path to an optional middleware module" |
| `serialization?: { mode?: "js" \| "json"; plugins?: string }` | |
| `css?: { filter?: { include?, exclude? } }` | |
| `solid?: Partial<SolidOptions>` | |
| `env?: EnvPluginOptions` | |
| `serverFunctions?: Pick<ServerFunctionsOptions,"filter"> & { onError?: string }` | |
| `experimental?: { islands?: false }` | islands 被锁死为 `false` |

接口注释原文："Configuration options for SolidStart. (previously in app.config.ts)"

**证据 2 — `ssr: false` 只做 alias 重映射**（`packages/start/dist/config/index.js`，从 npm tarball `@solidjs/start@2.0.4` 解出，逐字）：

```js
resolve: {
  alias: {
    "@solidjs/start/server/entry": handlers.server,
    ...(!start.ssr
      ? {
          "@solidjs/start/server": "@solidjs/start/server/spa",
          "@solidjs/start/client": "@solidjs/start/client/spa",
        }
      : {}),
  },
  ...
}
```

`package.json` 的 `exports` 确实有 `./server/spa` 和 `./client/spa`（`npm view @solidjs/start@2.0.4`）。

**证据 3 — SPA 模式仍然走服务端渲染 HTML 外壳**（`dist/server/spa/StartServer.jsx`，逐字）：

```jsx
import { NoHydration, getRequestEvent, ssr } from "solid-js/web";
const docType = ssr("<!DOCTYPE html>");
export function StartServer(props) {
  const context = getRequestEvent();
  const nonce = context.nonce;
  useAssets(context.assets, nonce);
  return (<NoHydration>
      {docType}
      <TopErrorBoundary>
        <props.document scripts={<>
              <PatchVirtualDevStyles nonce={nonce}/>
              <script type="module" nonce={nonce} src={getSsrManifest("client").path(import.meta.env.START_CLIENT_ENTRY_URL)}/>
            </>}/>
      </TopErrorBoundary>
    </NoHydration>);
}
```

即：`ssr: false` 的含义是「不 SSR 你的路由组件」（`dataOnly: !start.ssr`），**不是**「不需要服务端」。HTML 文档本身依然由 `getRequestEvent()` 驱动的服务端渲染产出。

**证据 4 — build 永远产出两个 environment**（同文件，逐字）：

```js
builder: {
  sharedPlugins: true,
  async buildApp(builder) {
    const client = builder.environments[VITE_ENVIRONMENTS.client];
    const server = builder.environments[VITE_ENVIRONMENTS.server];
    if (!client) throw new Error("Client environment not found");
    if (!server) throw new Error("SSR environment not found");
    if (!client.isBuilt) await builder.build(client);
    if (!server.isBuilt) await builder.build(server);
  },
},
```

`outDir` 分别是 `dist/client` 和 `dist/server`。没有任何 `index.html` 生成分支（`grep -rn "index.html" dist/config/*.js` 无命中）。

**证据 5 — `ssr: false` 有真实 bug 记录，证明被当作合法配置维护**
- Issue #2058 "[v2] text/html is not set when `ssr` is `false`"（https://github.com/solidjs/solid-start/issues/2058，2026-01-29 开，2026-02-07 closed as completed，0 comments），复现配置逐字：
  ```ts
  plugins: [ solidStart({ ssr: false }) ],
  ```
  由 PR #2059 修复（改 `packages/start/src/server/handler.ts`，加 `event.response.headers.set("content-type", "text/html");`）。

**证据 6 — 官方文档静默**
逐页抓取确认无 SPA/`ssr:false` 描述：
- https://docs.solidjs.com/solid-start/v2/getting-started
- https://docs.solidjs.com/solid-start/v2/migrating-from-v1
- https://docs.solidjs.com/solid-start/v2/building-your-application/routing
- https://docs.solidjs.com/solid-start/v2/building-your-application/data-fetching
- https://docs.solidjs.com/solid-start/v2/building-your-application/api-routes
- https://docs.solidjs.com/solid-start/v2/building-your-application/css-and-styling
- https://docs.solidjs.com/solid-start/v2/building-your-application/route-prerendering
- https://docs.solidjs.com/solid-start/v2/building-your-application/static-assets
- https://docs.solidjs.com/solid-start/v2/guides/deployment-plugins

**「官方未明确」**：v2 文档站从未描述 SPA 模式的完整使用方式。要用 `ssr: false` 只能读源码 + 抄 issue 里的配置。

### 对 Pictelio 的影响

Capacitor 需要一个可直接 `file://`（实际是 `https://localhost` scheme，见 `capacitor.config.ts` 的 `androidScheme: "https"`）加载的静态 `index.html` + 资源目录。SolidStart v2 给不出这个产物，必须额外挂 `nitro({ preset: "static" })` + `prerender` 把 `/` 预渲染成 HTML。这在当前 `pnpm build:android` 链路（`vp build` → `cap:sync` 复制 `webDir: "dist"`）里意味着：产物路径从 `dist/` 变成 `.output/public/`，`capacitor.config.ts` 的 `webDir` 要改，且 `cap:sync` 前多一步 Nitro 预渲染。

---

## Q2：文件系统路由 vs 当前手写 `@solidjs/router` 的差量

### 结论

v2 文件路由的路径语义与当前 `src/router.tsx` **一一对应，无表达力缺口**。真正的差量在于：v2 的 `FileRoutes` 是编译期生成的，**没有文档化的「手写路由」逃生舱**，且强制引入 `src/app.tsx` / `src/entry-client.tsx` / `src/entry-server.tsx` 三个入口文件契约。

### 证据

**路径映射规则**（https://docs.solidjs.com/solid-start/v2/building-your-application/routing，逐字）：
- `src/routes/users/[id].tsx` → `/users/:id`
- `src/routes/users/[[id]].tsx` → `/users/:id?`（optional param）
- `src/routes/docs/[...slug].tsx` → `/docs/*slug`（catch-all）
- "Files with a default export become UI routes."
- "Files that export HTTP method names such as GET or POST become API routes."
- "The filesystem router also looks for an exported `route` object alongside a page component."

**注意**：该页**未记载** layout 文件约定和 route group `(group)` 语法（抓取确认 "Not mentioned on this page"）。当前项目的 `__root.tsx`（RootLayout 包住所有子路由）在 v2 文档里找不到对应的官方约定描述，需要另查 Solid Router 的嵌套 `<Route>` 或 v1 的 layout 惯例——**这是本报告证据最弱的一点**。

**`FileRoutes` 实现**（`dist/router.jsx`，逐字）：
```js
import { pageRoutes as routeConfigs } from "./server/routes.js";
export const FileRoutes = isServer
    ? () => getRequestEvent().routes
    : () => routes || (routes = createRoutes());
```
`pageRoutes` 来自虚拟模块（由 `fsRoutes()` plugin 注入），不是用户可替换的数据源。

**强制入口文件**（`dist/config/index.js`，逐字）：
```js
const appEntryPath = globSync(join(root, start.appRoot, "app.{j,t}sx"))[0];
if (!appEntryPath) {
    throw new Error(`Could not find an app jsx/tsx entry in ${start.appRoot}.`);
}
const entryExtension = extname(appEntryPath);
const handlers = {
    client: `${start.appRoot}/entry-client${entryExtension}`,
    server: `${start.appRoot}/entry-server${entryExtension}`,
};
```
`src/app.tsx` 缺失直接 **throw**。`entry-client`/`entry-server` 路径写死，代码里**没有** `existsSync` 兜底或模板自动生成（`grep -rn "existsSync|writeFile" dist/config/index.js` 无命中）。

### 双向转换可行性

| 方向 | 可行性 | 说明 |
|---|---|---|
| 当前 `RouteDefinition[]` → v2 文件路由 | ✅ 机械可做 | 见下表逐条映射 |
| v2 文件路由 → `RouteDefinition[]` | ✅ 但需自己实现 | `FileRoutes` 返回的就是 `RouteDefinition[]`，理论上能拿来喂给裸 `<Router>`；但那样就不需要 SolidStart 了 |

**逐条映射（16 个路由 / 15 个组件文件）**：

| 当前 `src/router.tsx` | v2 文件路径 |
|---|---|
| `/login` | `src/routes/login.tsx` |
| `/home` | `src/routes/home.tsx` |
| `/illust/:id` | `src/routes/illust/[id].tsx` |
| `/debug` | `src/routes/debug.tsx` |
| `/novel/:id` | `src/routes/novel/[id].tsx` |
| `/search` | `src/routes/search.tsx` |
| `/me` | `src/routes/me.tsx` |
| `/about` | `src/routes/about.tsx` |
| `/image-host` | `src/routes/image-host.tsx` |
| `/image-cache` | `src/routes/image-cache.tsx` |
| `/settings` | `src/routes/settings.tsx` |
| `/client-switch` | `src/routes/client-switch.tsx` |
| `/scroll-restoration-confirm` | `src/routes/scroll-restoration-confirm.tsx` |
| `/user/:id` | `src/routes/user/[id]/index.tsx` |
| `/user/:id/illusts` | `src/routes/user/[id]/illusts.tsx` |
| `/user/:id/following` | `src/routes/user/[id]/following.tsx` |
| `/user/:id/followers` | `src/routes/user/[id]/followers.tsx` |
| `/my/followers` | `src/routes/my/followers.tsx` |
| `/*all` → `HomePage` | `src/routes/[...all].tsx` |
| `component: RootLayout`（`__root.tsx`） | **约定未文档化**（见上） |

### 对 Pictelio 的影响

**工程量化**：
- 删 1 个文件：`src/router.tsx`（51 行）
- 移动/重命名 15 个路由组件到 `src/routes/` 新目录结构，其中 4 个需拆分（`PersonalCenter.tsx` 服务 `/me` + `/user/:id` 两条路由；`FollowListPage.tsx` 服务 3 条路由并带 `mode` prop；`HomePage.tsx` 服务 `/home` + catch-all）
- 新增 3 个入口文件：`src/app.tsx`、`src/entry-client.tsx`、`src/entry-server.tsx`
- 改造 `src/App.tsx`（11 行，`QueryClientProvider` + `<Router>` 要挪进 `app.tsx`）
- `src/main.tsx`（68 行 bootstrap 编排）需拆入 `entry-client.tsx`

`/user/:id/following` 当前是内联箭头函数 `() => <FollowListPage mode="following" />`，文件路由下每条都得是独立文件 + 独立 default export，多出 4 个薄包装文件。

---

## Q3：路由数据加载（loader）vs「先渲染后加载」硬约束

### 结论

v2 的数据模型是 `query()` + `createAsync()` + `route.preload`。**loader 完全可选**——不导出 `route` 对象就没有 preload，`createAsync` 也可以不用。所以硬约束不会被框架强制破坏。但反过来说：放弃了 loader，SolidStart 在数据层就没有任何东西可给 Pictelio（项目已用 TanStack Query）。

### 证据

**API 形态**（https://docs.solidjs.com/solid-start/v2/building-your-application/data-fetching，逐字）：

```tsx
import { createAsync, query } from "@solidjs/router";
const getPosts = query(async () => {
  const response = await fetch("https://example.com/api/posts");
  return response.json() as Promise<Array<{ id: number; title: string }>>;
}, "posts");
export default function PostsPage() {
  const posts = createAsync(() => getPosts());
  return <For each={posts()}>{(post) => <li>{post.title}</li>}</For>;
}
```

关键点：**`query` / `createAsync` 都来自 `@solidjs/router`，不是 `@solidjs/start`**。项目当前依赖 `@solidjs/router@^1.0.0` 已经有这套 API，SolidStart 在此不提供额外能力。

**preload 是显式 opt-in**（同页，逐字）：
```tsx
export const route = {
  preload: ({ params }) => getPost(params.id),
} satisfies RouteDefinition;
```
文档原文："To warm the query before rendering the page, export a `route.preload` function from the route module." —— 不导出即不 preload。

**纯客户端 fetch 被明确支持**（同页）：基础示例用 `https://example.com/api/posts` 且**没有** `"use server"`，说明 "Client-side fetching: Supported out of the box (no `use server` needed for public APIs)"。

**缓存语义归 Solid Router**（同页，逐字）："Cache invalidation and advanced query behavior are handled by Solid Router, so use the Solid Router references when you need lower-level cache semantics."

### 对 Pictelio 的影响

**兼容，但零收益。** 项目已用 `@tanstack/solid-query` 5.101（ADR-0093）+ 自建 `queryKeys.ts` 工厂 + `queryClient.ts` 单例 + `feedQueryPersist` 持久化 hydrate。SolidStart 的 `query()` 缓存层与 TanStack Query 功能重叠且更弱（无 persist、无 infinite query、无 devtools）。

「先渲染后加载」硬约束（AGENTS.md）明确禁止路由级 `await` 阻塞。v2 不会强制违反它——只要不写 `route.preload`。但这意味着 v2 数据层能力对本项目**完全空转**，等于为了文件路由付全部迁移成本。

---

## Q4：Vite 配置接管 vs vite-plus 封装

### 结论

**这是最高风险项。** v2 通过 Vite 8 Environment API 接管构建（自定义 `environments.client` / `environments.server` + 自定义 `builder.buildApp`），而 vite-plus 用自己的 `defineConfig` 包了 Vite 并在同一个 config 对象里塞了 `lint` / `fmt` 扩展字段和 rolldown `codeSplitting.groups`。二者是否共存**官方未明确，也无社区案例**，只能实测。

### 证据

**v2 要求的 config 形态**（https://docs.solidjs.com/solid-start/v2/migrating-from-v1，逐字）：
```ts
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
export default defineConfig({
  plugins: [solidStart(), nitro()],
});
```
注意 `defineConfig` 来自 **`vite`**，而当前项目用的是 `vite-plus` 的 `defineConfig`（`packages/app/vite.config.ts:1`）。

**v2 接管 environments/builder**（`dist/config/index.js`，逐字，见 Q1 证据 4）：`environments.client.build.outDir = "dist/client"`、`environments.server.build.outDir = "dist/server"`、自定义 `builder.buildApp`。当前项目的 `build.rolldownOptions.output.codeSplitting.groups`（4 组：fluent-vendor / tanstack-vendor / vendor / common，`vite.config.ts:243-274`）位于顶层 `build`，与 v2 的 per-environment `rolldownOptions.input` 是否合并未验证。

**peerDependencies 兼容**（`npm view @solidjs/start@2.0.4`）：
```json
{ "@solidjs/router": ">=0.16.0 <2.0.0-0", "vite": "^8 || ^9" }
```
项目 `vite@^8.2.1` ✅、`@solidjs/router@^1.0.0` ✅。

**Node 版本**（https://docs.solidjs.com/solid-start/v2/getting-started，逐字）："SolidStart v2 requires Node.js 24 or newer."
`engines: { node: ">=24" }`（npm registry 确认）。项目 `.node-version` 与 AGENTS.md 记载为 **Node 22.22.2+** —— **硬冲突，必须先升 Node 24**。

**devOverlay**（同页，逐字）："During development, SolidStart adds a toolbar for inspecting application errors and server function calls. The toolbar is not included in production builds." 可用 `solidStart({ devOverlay: false })` 关闭。项目当前无自建 dev overlay，**无冲突**；且生产构建不含，Capacitor 打包不受影响。

### 对 Pictelio 的影响

需要实测的冲突点（均**无官方文档或社区先例**）：

1. `vite-plus` 的 `defineConfig` 是否透传 `environments` / `builder` 字段给底层 Vite
2. `solidStart()` 的 `buildApp` 覆写会不会绕开 vite-plus 的 `vp build` 编排
3. 顶层 `build.rolldownOptions.output.codeSplitting.groups` 在 environment 拆分后是否仍生效（当前分包策略是冷启动优化的一部分）
4. `vp test` / `vp lint` / `vp fmt` 是否会被 `solidStart()` 注入的虚拟模块（`solid-start:app`、server-fn manifest）打断
5. 当前 `vite.config.ts` 已因类型递归深度问题整体 `as any`（`vite.config.ts:53, 388` 注释说明），叠加 SolidStart 类型后类型安全进一步退化

另有**已确认冲突**：当前 vite dev server 配置了 7 条代理规则（`/pixiv-img` `/pixiv-re` `/pixiv-nl` `/pixiv-api` `/pixiv-oauth` `/github-api` `/pixiv-www`，共约 145 行，`vite.config.ts:95-241`）。这些是 Web 开发模式的生命线。SolidStart v2 dev 走 Nitro dev server，`server.proxy` 是否仍被消费**官方未明确**。

**Q4 是本报告第二弱的证据点**——所有冲突判断都是从源码结构推断的，没有实测。

---

## Q5：Server Functions / API Routes 在 Capacitor 包内的死路

### 结论

API Routes 在 Capacitor WebView 里**必然 404**——包内没有 server。Server functions 在 `ssr: false` 下是否被完全 tree-shake，**官方未明确**，源码显示 server-fn plugin 无条件注册。

### 证据

**API Routes 需要 handler 导出**（https://docs.solidjs.com/solid-start/v2/building-your-application/api-routes，逐字）：
- "A file becomes an API route when it exports one or more HTTP method names such as GET, POST, PATCH, or DELETE."
- `src/routes/api/users.ts` → `/api/users`
- `APIEvent` 来自 `@solidjs/start/server`，暴露 "nativeEvent for the underlying H3 event"

该页**未明确**声明 static/SPA 部署下 API routes 不可用（抓取确认："The page does not explicitly state that API routes are unsupported on static or SPA-only deployments"）。但 H3 event 只存在于 Nitro 运行时，逻辑推论成立：Capacitor 的 `androidScheme: "https"` + `webDir: "dist"` 是 WebViewAssetLoader 读本地文件，`/api/*` 请求命中不到任何 handler。

**Server functions plugin 无条件注册**（`dist/config/index.js`，逐字）：
```js
return [
    // Must be placed after fsRoutes, as treeShake will remove the
    // server fn exports added in by this plugin
    serverFunctionsPlugin({
        manifest: VIRTUAL_MODULES.serverFnManifest,
        runtime: {
            server: "@solidjs/start/fns/server",
            ...
```
无 `if (start.ssr)` 分支。`exports` 也确认有 `./fns/server` 和 `./fns/client`。

client build 侧有 `treeshake: true` 和 `preserveEntrySignatures: "exports-only"`：
```js
[VITE_ENVIRONMENTS.client]: {
  consumer: "client",
  build: {
    write: true, manifest: true, outDir: "dist/client",
    rolldownOptions: { input: clientInput, treeshake: true, preserveEntrySignatures: "exports-only" },
  },
},
```
`"use server"` 函数体在 client bundle 里会被替换成 RPC stub（这是 server-fn 的标准语义），**stub 本身仍在**——即会残留调用 `/_server` 端点的死代码，只是不含服务端逻辑。**官方未明确**在 `ssr: false` + static preset 下这些 stub 是否被完全移除。

### 对 Pictelio 的影响

**零影响，也零价值。** 项目所有 API 走两条既有路径：
- Native：`src/native/PixivApi.ts` → Capacitor bridge → `PixivApiPlugin.java` → OkHttp（access_token 只在 Java 堆，ADR-0037）
- Web dev：`vite.config.ts` 的 7 条 `server.proxy` 规则

SolidStart 的 server functions / API routes 在这个架构里没有任何落点。反而带来风险：只要有人误写一个 `"use server"`，Android 包里就多一段永远 404 的 RPC stub，且失败路径静默（违反项目「禁止静默降级」测试硬约束）。

---

## Q6：UnoCSS 在 v2 下的兼容性

### 结论

**大概率兼容，但插件顺序有硬性要求且当前项目顺序已经是错的**（虽未致命）。UnoCSS 官方无 SolidStart 专章。

### 证据

**UnoCSS 官方 Solid 集成要求**（https://unocss.dev/integrations/vite，逐字）：
> "You need to add the vite-plugin-solid plugin **after** UnoCSS's plugin."

示例：
```ts
plugins: [
  UnoCSS({ /* options */ }),
  solidPlugin(),
]
```

**当前项目顺序相反**（`packages/app/vite.config.ts:64-85`）：
```ts
plugins: [
  AutoImport({...}),
  solid(),          // ← solid 在前
  UnoCSS({ configFile: resolve(_root, "uno.config.ts") }),   // ← UnoCSS 在后
],
```
即当前已违反 UnoCSS 文档建议（目前工作正常，说明该建议主要针对 `preset-attributify`，项目用的是 shortcuts + preflights）。

**UnoCSS 页面无 SolidStart 专章**（抓取确认："There is no separate SolidStart section in the provided content"），也**未说明**支持的 Vite 版本范围。

**v2 的 CSS 管线**（https://docs.solidjs.com/solid-start/v2/building-your-application/css-and-styling，逐字）：
- "SolidStart v2 introduces a completely revamped CSS rendering mechanism"
- "HMR of route CSS is now directly managed by Vite instead of SolidStart."
- "Client-side navigation now mounts new CSS directly via Vite instead of SolidStart."
- "Client-side navigation no longer unmounts old CSS, more closely following Vite's native behaviour."
- 全局 CSS：`import "./Card.css"` —— "Styles imported as such, are globally mounted in your app."

v2 把 CSS 交还给 Vite 是**利好**：`virtual:uno.css` 是标准 Vite 虚拟模块，管线由 Vite 处理即意味着 UnoCSS 走常规路径。

`solidStart()` 另有 `css.filter.{include,exclude}` 选项（源码），但 v2 文档站**未记载**（抓取确认 "The page does not mention a `css.filter` option"）。

### 对 Pictelio 的影响

`main.tsx` 的 5 层 CSS 顺序导入（`reset.css` → `tokens.css` → `base.css` → `virtual:uno.css` → `novel-reader.css`）要挪到 `entry-client.tsx` 或 `app.tsx`。CSS 顺序是 Fluent 令牌覆盖链的基础，**必须验证 v2 的 CSS 挂载时机不改变层叠顺序**——尤其 "Client-side navigation no longer unmounts old CSS" 这条行为变更。

`uno.config.ts` 的 preflights 定义了流体 `clamp(rem + vw)` 字号令牌（AGENTS.md 记载），这些经 `virtual:uno.css` 注入，不受影响。

---

## Q7：Capacitor + SolidStart 的官方/社区案例

### 结论

**零案例。** 全网检索无一条 SolidStart + Capacitor 的 issue、讨论或模板。

### 证据

**GitHub issue 全局检索**（`gh search issues "solidstart capacitor"`）：返回 `[]`（空数组）。

**GitHub 网页检索**（https://github.com/search?q=solidstart+capacitor&type=issues）：9 条结果，**无一相关**——全是切词误命中：
1. ionic-team/capacitor-remix-templates#4（Remix，非 Solid）
2. kujian/githubTrending#2781（趋势榜）
3. enegalan/runspace#62（语言支持 meta-issue）
4. getsentry/sentry-docs#11859
5. mqyqingfeng/Blog#391
6. better-auth/better-auth#824
7. getsentry/sentry-docs#10938
8. jianyuan/terraform-provider-sentry#618
9. jianyuan/terraform-provider-sentry#502

**solid-start 仓库内检索**：`electron` → 仅 #1545（Windows starter 损坏，无关）；`tauri` / `file protocol` / `base ./ relative` → 无命中。

**最接近的一手证据是静态构建 bug 链**（这是 Capacitor 场景必经的路径）：

**Issue #2288**（https://github.com/solidjs/solid-start/issues/2288，2026-08-11 开 → 2026-08-20 closed as completed，3 comments）标题："Official Nitro v3 static builds fail after prerendering and ignore Vite base in emitted asset URLs"
- 配置：`solidStart({ ssr: false })` + `nitro({ preset: "static", baseURL: "/foo/" })` + `base: "/foo/"`
- 症状 1：`.output/public/index.html` 里的资源 URL 忽略 `base`，输出 `<link href="/_build/assets/entry-client-....css">`
- 症状 2：构建失败 `rolldownOptions.input should not be an html file when building for SSR.`
- 关键：报告者注明 "The static-build failure occurs regardless of `ssr: false` vs SSR enabled"，且 "The `node-server` preset succeeds; only `static` fails"

**维护者 birkskyum 的结案评论**（`gh api`，逐字）：
> "Confirmed: both symptoms reported here are now resolved:
> - The Nitro static-preset build failure was fixed by [nitrojs/nitro#4509](https://github.com/nitrojs/nitro/pull/4509) and is available in `nitro-nightly@3.0.1-20260820-204949-2b3f1011`.
> - SolidStart's base-aware asset URLs were fixed by [solidjs/solid-start#2305](https://github.com/solidjs/solid-start/pull/2305) and released in `@solidjs/start@2.0.3`."

**Issue #2151**（https://github.com/solidjs/solid-start/issues/2151，2026-05-31 → 2026-08-20 closed）"SolidStart 2.0 (alpha) ignores Vite `base` for prerendered/SSR script and asset URLs"，同一根因。报告者 tanukihee 的复现配置逐字：
```ts
export default defineConfig({
  plugins: [
    solidStart({ ssr: false }),
    nitro({ preset: "static", baseURL: "/foo/" }),
  ],
  base: "/foo/",
});
```

**修复后的代码**（`@solidjs/start@2.0.4` tarball，`dist/server/manifest/prod-ssr-manifest.js`）：
```js
return join(import.meta.env.BASE_URL, viteManifestEntry.file);
```
`BASE_URL` 已接入。但注意：**Nitro 侧的修复只在 `nitro-nightly`**，正式 `nitro` 包尚未发布该版本（维护者原话："`nitro` will eventually publish a new release"）。

### 对 Pictelio 的影响

三重风险叠加：
1. **零先例**——遇到问题无人踩过坑，全靠自查源码
2. **Nitro static preset 依赖 nightly**——生产构建链路依赖未正式发布的包
3. **`base` 处理刚修完 3 周**（2026-08-20 → 今天 2026-09-07）——项目还需要 `BASE_PATH=/pixivizer/` 支持 GitHub Pages 部署（`vite.config.ts:58`），正好踩在这条刚修好的路径上

另外注意 #2288 提到 Capacitor 场景特有的一点：客户端路由前缀还需 `<Router base={...}>` 配合（维护者评论末尾），而项目 `App.tsx` 当前 `<Router scrollRestoration>` 无 `base`。

---

## Q8：迁移成本 vs 收益的实证

### 结论

**不值得。** 收益只有「文件路由 + `~` alias」，而 `~` alias 项目已有等价物（`@/` → `src/`）。成本是三入口文件契约 + bootstrap 拆解 + 构建链路重排 + Node 24 升级 + 依赖 nightly 包。项目内**没有**任何 SolidStart 相关提案（ADR / issue 均为零）。

### 证据

**项目内零提案**：
- `grep -rn "solid-start|solidstart|SolidStart" docs/adr/*.md docs/research/*.md` → 3 条命中，全在 `docs/research/solidjs-solid-router.md`（2026-07-30），且都是顺带提及：
  - `:1109` "✅ SolidStart（SolidJS 元框架）及其 SSR/SSG 应用"
  - `:1121` "**社区标准**：SolidJS 官方推荐，在 SolidStart 生态中是默认选择"
  - `:1131` "SolidStart: https://start.solidjs.com"
- `docs/adr/` 最新到 **ADR-0099**（`ADR-0099-local-openwiki-disable.md`），ADR-0096 是 `virtual-scroll-migration`，附近 ADR（0093 TanStack Query、0094 TanStack DB、0095 split-illust-detail、0096 virtual-scroll、0097 agent-skill、0098 cross-engine、0099 openwiki）**无一涉及框架层迁移**
- `gh search issues --repo a1121611810/Pictelio "SolidStart"` → `[]`
- `gh search issues --repo a1121611810/Pictelio "router"` → 15 条，全是**已完成**的迁移历史：#5 "Spec: 路由层从 TanStack Router 迁移到 @solidjs/router"、#6 "T1: 依赖安装 & 路由定义重构"、#7 "T2: App.tsx + main.tsx 修改"，以及 app-lynx 的 vue-router 迁移（#329-#335）

**关键历史事实**：issue #5 显示项目**已经做过一次路由框架迁移**（TanStack Router → `@solidjs/router`），当前 `src/router.tsx` 的手写形态是那次迁移的产物，是有意选择而非历史包袱。

**`~` alias 已有等价物**（https://docs.solidjs.com/solid-start/v2/getting-started，逐字）："`~` alias for the application root" — e.g. `~/lib/db` → `src/lib/db`。
项目已有 `"@": resolve(__dirname, "src")`（`vite.config.ts:59-63` + tsconfig paths），功能完全等价。**此项收益为零。**

### 工程量化

**必须改动的文件（下限）**：

| 类别 | 数量 | 说明 |
|---|---|---|
| 删除 | 1 个文件 / 51 行 | `src/router.tsx` |
| 新增 | 3 个文件 | `src/app.tsx`、`src/entry-client.tsx`、`src/entry-server.tsx`（缺 `app.tsx` 直接 throw） |
| 新增（薄包装） | 4 个文件 | `/user/:id/following`、`/user/:id/followers`、`/my/followers`、catch-all 的独立 default export |
| 移动 + 改名 | 15 个路由组件 | `src/routes/*.tsx` → 文件路由层级（含 `PersonalCenter` / `FollowListPage` / `HomePage` 的一对多拆分） |
| 重写 | `src/main.tsx` 68 行 | bootstrap 编排（settings 同步 → Fluent 主题 setTheme + MutationObserver → render → `initializeAuth()` → `restoreFeedCache()`）拆入 `entry-client.tsx` |
| 重写 | `src/App.tsx` 11 行 | `QueryClientProvider` + `<Router>` 挪入 `app.tsx` |
| 改造 | `vite.config.ts` 389 行 | `defineConfig` 来源切换 + `solidStart()` + `nitro()` 插入 + 7 条 proxy 规则（145 行）验证 + `codeSplitting.groups`（32 行）验证 |
| 改造 | `capacitor.config.ts` | `webDir: "dist"` → `.output/public` |
| 改造 | `package.json` build 链路 | `build:android` / `build:android:release` / `build:android:e2e`（3 条脚本）产物路径 |
| 受影响 | 14 个文件 | 引用 `@solidjs/router` 的源文件（`grep -rl` 计数）；API 本身不变，但 `useParams` 等经 `unplugin-auto-import` 自动导入，需验证与 SolidStart 虚拟模块共存 |
| 受影响 | 91 个测试文件 | `tests/unit/` 全量（含 `tests/unit/router.test.ts`、`routes/NovelDetail`、`routes/ClientSwitch`）+ 12 个 E2E spec |
| 环境 | Node 22.22.2 → 24 | `.node-version` + CI + 本地；ADR-0080 刚为 jsdom 30 从 20.19 抬到 22.22 |

`src/` 共 **215 个 `.ts`/`.tsx` 文件**，直接改动面约 24 个文件，间接验证面（测试）约 100 个。

**收益清单**：

| 收益 | 实际价值 |
|---|---|
| 文件路由 | 中——省掉 51 行手写路由表，换来 22 个文件的目录约定 |
| `~` alias | **零**——已有 `@/` |
| dev toolbar | 低——项目已有 chrome://inspect 排障链路（`capacitor.config.ts` 注释） |
| server functions / API routes | **负**——见 Q5，只增死代码风险 |
| `query`/`createAsync` | **零**——来自 `@solidjs/router`，已有；且项目用 TanStack Query |
| SSR/预渲染 | **负**——Capacitor 场景是负担 |

---

## 红线清单：动手前必须全部满足

以下任一未满足，**禁止启动迁移**：

1. **Node 24 已在本地 + CI + 所有开发者机器落地**
   依据：`engines: { node: ">=24" }`（npm registry `@solidjs/start@2.0.4`）+ 文档 "SolidStart v2 requires Node.js 24 or newer"。当前 `.node-version` 为 22.22.2，ADR-0080 刚做过一次 Node 抬升。

2. **`nitro` 正式包（非 nightly）已发布含 PR #4509 的版本**
   依据：维护者 birkskyum 在 #2288 原话——static preset 修复"is available in `nitro-nightly@3.0.1-20260820-204949-2b3f1011`"，正式包 "will eventually publish a new release"。生产 Android 构建链路依赖 nightly 包不可接受。

3. **已在 spike 分支实测通过：`solidStart({ ssr: false })` + `nitro({ preset: "static" })` 能产出可被 Capacitor 直接消费的静态目录**
   验收：`.output/public/index.html` + 资源，`BASE_PATH` 与 `base: "/"` 两种模式都正确，`cap:sync` 后 APK 能冷启动到首页。
   依据：Q1 证据 4（build 只产出 `dist/client` + `dist/server`，无 `index.html` 生成分支）。

4. **已实测 vite-plus `defineConfig` 与 `solidStart()` 的 Environment API / `builder.buildApp` 覆写共存**
   验收：`vp build` / `vp test` / `vp lint` / `vp fmt` 四条命令全部正常，`codeSplitting.groups` 4 组分包仍生效（对比冷启动 bundle 数量）。
   依据：Q4，此项**无任何官方文档或社区先例**。

5. **已实测 7 条 dev proxy 规则（`/pixiv-img` `/pixiv-re` `/pixiv-nl` `/pixiv-api` `/pixiv-oauth` `/github-api` `/pixiv-www`）在 SolidStart dev server 下仍生效**
   依据：v2 dev 走 Nitro dev server，`server.proxy` 消费情况**官方未明确**。这 7 条是 Web 开发模式的生命线（`vite.config.ts:95-241`，145 行）。

6. **`__root.tsx` 的 RootLayout 在文件路由下有明确对应约定并实测通过**
   依据：v2 routing 文档**未记载** layout 文件约定（抓取确认）。RootLayout 承载 NavBar、页面过渡、主题/年龄确认恢复、全局监听——不能降级。

7. **CSS 五层顺序（`reset` → `tokens` → `base` → `virtual:uno.css` → `novel-reader`）在 v2 CSS 管线下层叠顺序不变**
   依据：Q6，v2 "Client-side navigation no longer unmounts old CSS" 是行为变更；Fluent 令牌覆盖链依赖此顺序。

8. **有一条 lint/CI 规则禁止 `"use server"` 出现在 `packages/app/src/**`**
   依据：Q5，Android 包内 server functions 必然 404 且失败静默，违反项目「禁止静默降级」测试硬约束。

---

## 「如果只想要 X」——可选改造清单（按价值/成本比排序）

不迁移 SolidStart 的前提下，逐项拿到想要的能力。

### 1. 想要「路由表不用手写」 — 成本极低，价值中

用 Vite 的 `import.meta.glob` 在 `src/router.tsx` 里自建约定式路由，输出仍是 `RouteDefinition[]` 喂给现有 `<Router>`。

- 改动：仅 `src/router.tsx`（51 行 → 约 30 行 glob + 路径转换）
- 保留：`__root.tsx` 布局、`@/` alias、vite-plus、Capacitor 链路、全部测试
- 风险：需自己实现 `[id]` → `:id` 转换；`FollowListPage` 的 `mode` prop 仍需薄包装文件
- 判断：**如果只为文件路由，这是唯一理性选择**

### 2. 想要「dev 期错误面板」 — 成本极低，价值低

现有链路已够：`chrome://inspect`（`capacitor.config.ts` 注释说明 `webContentsDebuggingEnabled` 在 debug 构建默认开启）+ Vite 自带 error overlay。无需改动。

### 3. 想要「`~` alias」 — 成本为零

已有 `@/`（`vite.config.ts:59-63`）。**不做。**

### 4. 想要「更好的代码分割 / 路由级懒加载」 — 成本低，价值中

现有 `codeSplitting.groups`（4 组）已在做 vendor 分包。路由级懒加载可用 `solid-js` 的 `lazy()` 直接包 `src/router.tsx` 里的组件导入：

```ts
const IllustDetail = lazy(() => import("@/routes/IllustDetail"));
```
- 改动：`src/router.tsx` 15 行 import 改写
- 与「即时导航硬约束」的关系：`lazy()` 有 Suspense 边界，需确认不违反「先渲染后加载」——建议先量化冷启动收益再决定

### 5. 想要「服务端能力（BFF / 凭据下沉）」 — 成本高，价值高（**此时才该考虑 SolidStart**）

当前 `credentials.json5` 的 A 类凭据（`clientId`/`clientSecret`/`hashSecret`）通过 Vite `define` 注入（`vite.config.ts:19-24` 已做了 `__PUBLIC_CONFIG__` 剥离以避免进 bundle）。如果要真正下沉到服务端，SolidStart v2 的 server functions + API routes 是对口方案。

但注意：Pictelio 是**离线优先的原生 App**，引入 BFF 意味着自建服务器 + 可用性依赖 + 成本。这是产品决策而非技术决策，需先走 Grill → to-spec 流程（AGENTS.md 工作流强制规范）。

### 6. 迁移 SolidStart v2 — **不推荐**

见红线清单 8 条。即使全部满足，净收益仍为负（Q8 收益清单里 4 项为零或负）。

---

## 证据强度自评

| 问题 | 证据强度 | 说明 |
|---|---|---|
| Q1 | **强** | 源码类型定义 + dist 逐字代码 + issue #2058 复现配置。唯一弱点：官方文档零覆盖，所有结论来自源码而非文档 |
| Q2 | **中** | 路径映射有官方文档逐字；**但 layout / route group 约定官方未记载**，`__root.tsx` 的对应方案无据可依 |
| Q3 | **强** | 官方文档逐字 + API 归属（`@solidjs/router` 而非 `@solidjs/start`）已从文档确认 |
| Q4 | **弱** | 全部为源码结构推断，**零实测、零官方说明、零社区先例**。vite-plus × solidStart 共存性是纯未知数 |
| Q5 | **中** | server-fn plugin 无条件注册有 dist 代码为证；但 `ssr: false` 下 stub 是否被完全 tree-shake **官方未明确**，未实测 |
| Q6 | **中** | UnoCSS 官方顺序要求 + v2 CSS 文档均逐字；但 UnoCSS 无 SolidStart 专章，`css.filter` 选项文档缺失 |
| Q7 | **强（负面结论）** | 两路检索均确认零案例；#2288/#2151 的静态构建 bug 链有维护者逐字结案评论 |
| Q8 | **强** | 项目内 ADR/issue 检索为零；文件计数、行数均实测 |

**最需要补查的是 Q4**（vite-plus 与 solidStart 共存），其次 **Q2 的 layout 约定**。两者都只能靠 spike 分支实测，无法通过文档解决。

---

## 附：一手来源索引

**官方文档（全部经 WebFetch 实抓）**
- https://docs.solidjs.com/solid-start/v2/getting-started
- https://docs.solidjs.com/solid-start/v2/migrating-from-v1
- https://docs.solidjs.com/solid-start/v2/building-your-application/routing
- https://docs.solidjs.com/solid-start/v2/building-your-application/data-fetching
- https://docs.solidjs.com/solid-start/v2/building-your-application/api-routes
- https://docs.solidjs.com/solid-start/v2/building-your-application/css-and-styling
- https://docs.solidjs.com/solid-start/v2/building-your-application/route-prerendering
- https://docs.solidjs.com/solid-start/v2/building-your-application/static-assets
- https://docs.solidjs.com/solid-start/v2/guides/deployment-plugins
- https://unocss.dev/integrations/vite

> 注：`https://docs.solidjs.com/solid-start/v2/`（Overview 首页）抓取超时未取得，其余全站页面均已覆盖。

**源码 / 包（一手）**
- https://github.com/solidjs/solid-start/blob/main/packages/start/src/config/index.ts（`SolidStartOptions` 类型）
- `@solidjs/start@2.0.4` npm tarball：`dist/config/index.js`、`dist/router.jsx`、`dist/server/spa/{StartServer.jsx,handler.js}`、`dist/client/spa/index.jsx`、`dist/client/StartClient.jsx`、`dist/server/manifest/prod-ssr-manifest.js`
- npm registry `@solidjs/start`：dist-tags `{alpha: 2.0.0-alpha.3, beta: 2.0.0-beta.10, rc: 2.0.0-rc.10, latest: 2.0.4}`、`engines`、`peerDependencies`、`exports`

**GitHub issues / PRs（经 `gh api` 或 WebFetch 实抓）**
- https://github.com/solidjs/solid-start/issues/2058（`ssr:false` text/html，closed 2026-02-07）
- https://github.com/solidjs/solid-start/pull/2059（修复）
- https://github.com/solidjs/solid-start/issues/2151（base 忽略，closed 2026-08-20，3 comments）
- https://github.com/solidjs/solid-start/issues/2288（Nitro static 构建失败，closed 2026-08-20，3 comments）
- https://github.com/solidjs/solid-start/pull/2305（base-aware assets，released in 2.0.3）
- https://github.com/nitrojs/nitro/pull/4509（static preset 修复，仅 nightly）
- https://github.com/search?q=solidstart+capacitor&type=issues（9 条，零相关）

**项目内（实读）**
- `packages/app/vite.config.ts`（389 行）
- `packages/app/src/router.tsx`（51 行）
- `packages/app/src/App.tsx`（11 行）
- `packages/app/src/main.tsx`（68 行）
- `packages/app/index.html`
- `packages/app/capacitor.config.ts`
- `packages/app/package.json`
- `docs/adr/`（ADR-0080 ~ ADR-0099）
- `docs/research/solidjs-solid-router.md`
- GitHub issues `a1121611810/Pictelio`（#5、#6、#7、#329-#335）
