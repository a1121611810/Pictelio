# Pictelio 浏览上下文

本上下文描述 Pictelio 中作品（插画、小说）的列表浏览与详情阅读之间的导航概念，以及错误处理领域模型。

## 术语

### 浏览导航

**列表页（List）**：
以网格、瀑布流或文本列表形式展示多个作品的页面，例如推荐页、关注页、收藏页。

**详情页（Detail）**：
展示单个作品的完整内容页面，例如插画详情页、小说详情页。

**回顶（Scroll-to-top）**：
将页面滚动到最顶部（scrollY = 0）的操作。列表页与详情页可通过顶栏双击触发；列表页也可通过导航中心钮上滑触发。
_Avoid_ 指术语层面避免使用"双击刷新""双击返回顶部"等表述，统一称"回顶"。

**滚动位置恢复（Scroll restoration）**：
从详情页返回到列表页时，恢复到离开前保存的精确滚动偏移（scrollY），而不是回到页面顶部。

**滚动恢复模式（Scroll restoration mode）**：
`simple` 模式保存 `window.scrollY` 数值，适用于非虚拟滚动的页面；`virtual` 模式保存 TanStack Virtual 的 `ScrollRestoreState`（`VirtualItem[] + offset`），适用于虚拟滚动 Feed 的精确恢复。

**显式恢复（Explicit restoration）**：
virtual 模式下，组件挂载后由代码主动执行 `window.scrollTo` 恢复滚动位置的做法。实现为三层兜底：同步 `scrollTo` → `ResizeObserver` 监听文档生长重试 → 超时放弃。virtual 模式**一律**使用显式恢复。

**隐式恢复（Implicit restoration）**：
依赖 TanStack Virtualizer 构造参数 `initialOffset` 让窗口滚动到目标位置的做法。_Avoid_ 禁止作为恢复机制使用——`initialOffset` 仅决定首帧渲染的虚拟窗口位置，WebView 实测不会触发窗口滚动（见 `docs/adr/0010-explicit-scroll-restoration.md`）。

**虚拟滚动恢复原语（createVirtualScrollRestore）**：
`src/primitives/createVirtualScrollRestore.ts` — virtual 模式滚动恢复的统一实现。所有虚拟滚动 Feed（VirtualFeed、NovelVirtualFeed 及经 VirtualFeed 的 UserWorksFeed）通过它完成显式恢复与卸载保存，状态存储位置（store key / callback props）作为参数注入。

**全局滚动缓存（scrollRestoreGlobal）**：
`src/primitives/createScrollRestore.ts` 导出的模块级单例，提供 `saveSimple/getSimple/setSimple/saveVirtual/getVirtual/remove/clearAll` 方法。所有 store（feedStore、novelStore、bookmarkStore、userIllustsStore）的滚动位置统一通过此单例管理，不再各自维护独立变量。底层使用 LRU 缓存：simple 模式最多 80 条，virtual 模式最多 20 条。

**阅读进度（Reading progress）**：
小说详情中用户当前的阅读位置，滚动停止后持久化。双击回顶后阅读进度同步为开头。

**返回不重载（Back without reload）**：
从详情页返回列表页时，列表不重新加载数据（无重复请求、无骨架屏闪烁、滚动位置保留）。app（SolidJS）通过 feedStore 数据缓存 + 滚动恢复实现；app-lynx（Lynx）通过页面实例缓存（KeepAlive）实现（见 ADR-0049）。

**页面实例缓存（Page instance cache）**：
app-lynx 用 `<KeepAlive>` 缓存已访问的页面组件实例，返回时**组件不重建**（`onMounted` 不重跑），数据、list DOM、滚动位置、图片加载状态全部保留。缓存列表/静态页（recommended/novels/me），**详情页不缓存**——详情按 `:id` 加载，缓存旧 id 实例会显示错误内容（见 ADR-0049）。

**导航历史栈（Navigation history stack）**：
app-lynx 内存路由维护的返回栈：`navigate(path)` 入栈、`goBack()` 出栈回上一页（栈空回 `/recommended`）。登录相关导航用 replace 语义（不入栈）——登录页不应被"返回"（见 ADR-0049）。

### 滚动驱动显隐

**滚动驱动显隐（Scroll-driven visibility）**：
列表页 header 根据滚动行为自动隐藏/显示的机制：向下滑动隐藏，向上滑动显示，滚动停止后重现。

**空闲重现（Idle reappear）**：
滚动停止（最后一次滚动事件后 250ms 无新事件）后 header 自动重新显示。停止判定用 debounce 实现，不用 rAF 轮询。

**方向阈值（Direction threshold）**：
判定滚动方向的最小位移（4px），防止微小抖动误触发显隐切换。

**顶部保护区（Top guard）**：
scrollY 小于 header 高度（48px）时 header 恒显示，不参与隐藏。

**抑制窗口（Suppress window）**：
程序性滚动（滚动位置恢复等）期间暂停方向判定的时间窗，避免瞬时大位移导致 header 闪烁。默认时长 600ms，须覆盖 `createVirtualScrollRestore` 的 500ms 兜底重试窗口——修改任一侧时需同步检查另一侧。

**滚动驱动显隐原语（createScrollDrivenVisibility）**：
`src/primitives/createScrollDrivenVisibility.ts` — 滚动驱动显隐的统一实现，内部组合 `@solid-primitives/scroll` 与 `@solid-primitives/scheduled`。列表页 header 一律通过它实现显隐（见 `docs/adr/0012-scroll-driven-header-visibility.md`）。

**位置阈值原语（createScrolledPast）**：
`src/primitives/createScrolledPast.ts` — 响应式判定 `scrollY > threshold` 的薄原语。纯位置驱动的 UI 显隐（回顶按钮、PersonalCenter header 折叠）一律使用它，不再手写 scroll 监听。

**滚动方向原语（createScrollDirection）**：
`src/primitives/createScrollDirection.ts` — 滚动方向判定原语，输出 `direction: "up" | "down" | null` 与 `reset()`。支持方向阈值、同向累计（accumulate）、跳变忽略（jumpThreshold）。方向驱动的 UI 显隐（NavBar compact、Search compact header、NovelDetail footer）由站点 policy effect 组合它与 `createScrolledPast` 实现（见 `docs/adr/0013-scroll-primitives-unification.md`）。

### 界面控件

**Tab 控件（Tab Control）**：
应用内所有 tab 类切换控件的总称：底部导航胶囊（NavBar：推荐/关注/收藏/历史）、顶栏内容类型切换（插画/小说）、Feed 子标签栏（综合/插画/漫画、公开/非公开）、用户作品分段切换（插画/漫画/小说）。全部 Tab 控件共享同一套「玻璃 Tab 视觉语言」，新增 tab 一律复用统一组件，不自绘样式。

**玻璃 Tab 视觉语言（Glass Tab Visual Language）**：
Tab 控件共享的统一视觉风格：磨砂玻璃容器 + 激活项浮起玻璃胶囊 + 受限动效（仅底部导航胶囊的指针跟随高光）。用于保证全局 tab 外观一致，并守住滚动 Feed 上的渲染性能边界。

**确认对话框（Confirmation Dialog）**：
需要用户确认后才能继续的模态弹窗（清除数据、删除账号、切换渲染引擎、二次确认等）。app 内统一经 `src/components/ui/FluentDialog.tsx` 封装渲染，底层是 `@fluentui/web-components` 的 `<fluent-dialog>`。

**fluent-dialog slot 契约（fluent-dialog slot contract）**：
`@fluentui/web-components@3` 的 `<fluent-dialog>` shadow 内只有一个无名 `<slot>`，**命名 slot 全部在内部的 `<fluent-dialog-body>` 上**。正确用法：内容必须包在 `<fluent-dialog-body>` 中；标题用 `slot="title"`；正文**不写 slot**（进 body 默认 slot，即 `.content`）；按钮用 `slot="action"`（**单数**）。_Avoid_ 禁止 `slot="content"`（不存在）、`slot="actions"`（复数，不存在）、缺 `<fluent-dialog-body>` 包裹——这些错误写法会导致标题/正文/按钮不投影，弹窗退化为全宽横条、无遮罩、按钮不可见（见 ADR-0062）。

### 错误处理

**代理错误（Proxy Error）**：
Vite 开发代理无法连接上游 Pixiv 服务器时产生的错误。代理层返回统一 JSON 载荷：

```json
{ "error": "proxy_error", "message": "代理连接失败，请检查网络或代理状态" }
```

`client.ts` 将其分类为 `ApiErrorType.PROXY`。

**ApiErrorType**：
`api/types.ts` 中定义的错误分类枚举。当前值：

- `NETWORK` — 网络不可用（`TypeError`：fetch 完全不可达）
- `UNAUTHORIZED` — HTTP 401，登录过期
- `FORBIDDEN` — HTTP 403，无权限
- `RATE_LIMIT` — HTTP 429，请求频繁
- `SERVER` — HTTP 5xx，服务器错误
- `PROXY` — 本地代理连接失败
- `UNKNOWN` — 无法归类的错误

**OAuth Token 400 错误（OAuth Token 400 Error）**：
Pixiv OAuth 端点在 refresh_token 已过期/无效时返回 HTTP 400 而非 401，
响应体格式为 `{ error: { message: "...OAuth...invalid_request..." } }`。
`client.ts` 中 `isOAuthTokenErrorResponse()` 检测此模式，将其视为 token 失效错误，
`classifyError()` 将其分类为 `ApiErrorType.UNAUTHORIZED` 并返回友好提示
"登录凭证已失效，请重新登录"；`executeRequest()` 在抛出前先触发 `onUnauthorized()`
清理流程（调用 `logout()` 清除 token 状态），确保用户被引导到登录页而非卡在重试循环中。

**可操作错误指引（Actionable Error Guidance）**：
错误 UI 中根据 `ApiError.type` 渲染的、告诉用户具体该做什么的提示文字和按钮组合。例如：

- `PROXY` → "请检查本地代理 127.0.0.1:10808 是否运行"
- `NETWORK` → "请检查网络连接"
- `UNAUTHORIZED` → "请重新登录"

**统一错误展示组件（ErrorDisplay）**：
`src/components/ErrorDisplay.tsx` — 所有页面共享的错误展示组件。接收 `ApiError` 对象，按类型渲染不同操作指引 + 重试按钮。替代各页面各自为政的 `setState("error", msg)`。

### 错误处理模式

**错误元组模式（Error Tuple Pattern）**：
用 `[err, data]` 两元素元组替代 throw/try-catch 的错误传递方式。第一个元素为错误对象（成功时为 `null`），第二个元素为正常数据（失败时为 `undefined`）。优先于 try-catch 使用。

**tryAsync**：
`src/utils/tryAsync.ts` 导出的异步错误包装函数。接收 `Promise<T>`，返回 `Promise<[Error, undefined] | [null, T]>`。用于替代 `try { await ... } catch` 模式。与 try-catch 相比，不阻止 V8 对调用函数的全量优化，且无需 finally 清理。

**trySync**：
`src/utils/tryAsync.ts` 导出的同步错误包装函数。接收工厂函数 `() => T`，返回 `[Error, undefined] | [null, T]`。用于替代 `try { JSON.parse(...) } catch` 等同步操作的 try-catch。工厂函数形式确保可能抛出的同步代码惰性执行，不影响调用函数的 V8 优化。

**统一清理模式（Unified Cleanup Pattern）**：
配合 tryAsync 的 finally 替代方案。try-catch-finally 中的清理逻辑移至 tryAsync 调用之后、err 判断之前执行。`loading.set(false)`、`clearTimeout()` 等清理操作只写一次，不再因 try-catch 的 finally 块而拆分为两个分支。每个 tryAsync 调用对应一条清理线。

**自动导入（Auto-import）**：
通过 `unplugin-auto-import` 在构建时自动向所有源文件注入 `tryAsync` 和 `trySync` 的 import 语句，无需在源码中显式书写 `import { tryAsync, trySync } from '@/utils/tryAsync'`。自动生成的 `auto-imports.d.ts` 文件加入 `.gitignore`，由 `pnpm dev` 首次运行生成。

### 浏览历史（Browsing History）

**浏览历史记录（HistoryEntry）**：
用户打开作品详情页时自动记录访问的条目。链路：详情页 data loaded → `collection.insert/update` → TanStack DB localStorage 持久化。

**历史时间线（History Timeline）**：
历史页面的展示形式——按日期分组的一维拍平数组，单实例 `Virtualizer`（`lanes: 1`）。数据源为 TanStack DB `localStorageCollectionOptions` collection 通过 `useLiveQuery` 获取。

**条目主键（Entry Key）**：
复合字符串 `"${userId}_${type}_${id}"`。`id` 不可单独做主键（illust 和 novel ID 空间不重叠但数值可撞），`type` 加上后保证跨类型唯一。

**用户隔离（User Isolation）**：
`userId` 字段嵌入每个 HistoryEntry，复合 key 天然隔离。登录/切换用户时对应刷新 L1 hot cache。登出不清空数据。

**1 个月过期（30-day Expiry）**：
浏览记录的自动淘汰窗口。写入时懒清除 `visitedAt < Date.now() - 30天` 的条目。不设条数硬上限。

**本地优先（Local-first）**：
浏览历史纯本地存储，不同步 Pixiv 服务端。使用 `@tanstack/solid-db` 的 `localStorageCollectionOptions` 持久化。

### 搜索

**搜索范围（Search Scope）**：
搜索前选择的资源类型，决定 API 调用的目标端点。可选值：`全部`（调用 illust + novel 两个端点并合流）、`插画·漫画`（仅 `/v1/search/illust`）、`小说`（仅 `/v1/search/novel`）。搜索范围作为搜索请求参数的一部分，在搜索执行前设定。

**搜索关键词（Search Query）**：
用户输入的搜索文本，即 Pixiv API 的 `word` 参数。支持标签名、标题、画师名等。搜索历史以关键词为单位持久化。

**搜索排序（Search Sort）**：
搜索结果的时间/热门度排序方式。对应 Pixiv API 的 `sort` 参数：`date_desc`（按时间降序）、`date_asc`（按时间升序）、`popular_desc`（按热门度降序）。

**搜索目标（Search Target）**：
关键词匹配的作品字段。对应 Pixiv API 的 `search_target` 参数（目前已归档确认，暂不排除后续对用户暴露）。取值包括 `partial_match_for_tags`（标签部分匹配，默认）、`exact_match_for_tags`（标签精确匹配）、`title_and_caption`（标题和说明文）。

**搜索建议（Search Autocomplete）**：
用户输入过程中，从 Pixiv `/v1/search/autocomplete` 接口拉取的标签补全建议列表。仅作为建议展示，用户可选择补全到搜索框。

**搜索历史（Search History）**：
用户曾经搜索过的关键词列表，本地持久化。历史以倒序展示，支持点击快速复用和单条删除。不设置过期时间，但条数有上限（最近 50 条）。

**搜索结果混排（Mixed Search Results）**：
当搜索范围为「全部」时，同时调用 `search/illust` 和 `search/novel` 两个 API，将返回的 `PixivIllust[]` 和 `PixivNovel[]` 按 `create_date` 降序合流为单一时间线。用户可通过 filter chip 筛选只查看某一类型。

**结果类型筛选（Type Filter Chip）**：
搜索结果显示后，在结果列表顶部提供的一组 filter chip，用于在混排结果中筛选类型：「全部 / 插画·漫画 / 小说」。筛选不影响 API 请求，仅客户端过滤已加载的结果。

**导航中心钮（Nav Center Button）**：
NavBar 胶囊中央的圆形按钮，是搜索页的主入口，仅存在于列表类页面。它不承担导航胶囊的收起/展开职责。

**标签导航（Tag Navigation）**：
在作品详情页（插画/小说）的标签区域，点击标签直接导航到搜索页，以该标签名作为搜索关键词，默认搜索范围设为「全部」。

**搜索合流（Search Merge）**：
客户端将 `search/illust` 和 `search/novel` 的响应合并为统一列表的过程。以 `create_date` 为主排序键，同类型内部保持 API 返回的相对顺序。合流后的每一项具有统一结构（`SearchResultItem`），包含类型标记、作品实体和排序时间戳。
