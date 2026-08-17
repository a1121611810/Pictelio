# ADR 0088: app-lynx 三问题修复——requestRaw 原生网关 / 流内遮罩卡 / 全局 tab 重构

## 状态

已采纳（2026-08-11 落地，四个 commit：c633d9e / 5ae81e0 / 67daa70 / ab90063）

## 分类

技术决策 / app-lynx 迭代 / 渲染与数据层

## 日期

2026-08-11

## 背景

用户报告 app-lynx（vue-lynx 客户端）三个问题：

1. **小说列表 tab 标签向上偏移**——提交 `7eb0f5e`（M3 对齐）把 secondary tabs 从 `py-2.5` 改成 `h-[12.8vw] + flex-col items-center justify-center`，真机 Lynx 对 column flex `justify-content: center` 支持不可靠，内容顶部对齐。
2. **小说点击进入详情 build 后报错**（web dev 正常）——`fetchNovelText` 无条件走裸 fetch：原生模式 access_token 在 Java 堆（JS 零知），`getAccessToken()` 恒空；相对路径 `/pixiv-api/...` 原生环境无法解析。
3. **全局 tab 结构**：推荐/关注/小说/我的 → 推荐/插画/小说/我的；插画页分推荐/关注两个子 tab（同小说页模式）；推荐 tab 改为插画+小说综合推荐。

## 决策

### 决策 1：`apiClient.requestRaw` 双模式原始响应接缝（问题 2）

在 `client.ts` 新增唯一入口 `requestRaw(method, path, params): Promise<string>`，返回原始响应体文本：

- **web 模式**：复用 `rewriteUrl` + `shouldAttachAuth` + `getAccessToken` 构造 headers（User-Agent/Referer/Bearer）后 fetch 并 `res.text()`
- **原生模式**：`NativeModules.PictelioApi.request` 转发 Java（JS 零知 access_token，Java 侧附加 Authorization + 401 刷新），回调 `data` 即原始字符串（`PixivApiCore.executeRequest` 对非 JSON 响应原样返回）
- 401 自动刷新复用 `execWithAuthRetry`；不参与 GET 去重（原始文本响应按调用方语义直接返回）

`fetchNovelText` 收敛为 `requestRaw('GET', '/webview/v2/novel', { id })` + `extractNovelTextFromHtml`。**不把双模式分支散落到调用点**（深模块：双模式行为集中在 client 内部，调用点只学一个方法）。对齐主 app `pictelio-app` 的既有原生分支（`PixivApi.request("/webview/v2/novel")`）。

### 决策 2：列表受限条目改流内遮罩卡（问题 1 的 list item 高度）

真机 Lynx 的 **absolute 子元素会被 single list item 高度测量算进内容高度**，导致受限条目卡被撑满整个内容区（小说推荐页满屏 scrim 遮罩，实测 2026-08-11）。

`RestrictOverlay` 新增 `overlay?: boolean` prop（默认 true 保持详情页 absolute 覆盖语义；`false` = 纯流内徽章块，调用方用 `bg-scrim` 卡包裹并控制尺寸）。列表卡（NovelList / Bookmarks / UserHome / Following / Recommended）的受限条目改为**独立流内遮罩卡**（`v-if="isRestricted(item)"` + `@tap.stop`），不再 absolute 覆盖。

### 决策 3：全局 tab 重构 + `createMixFeed` 混合推荐（问题 3）

- **`navTabs.ts` 单一事实源**：`NAV_TABS` 四 tab（推荐/插画/小说/我的），此前 Recommended/Following/NovelList/Me 四处重复定义收敛；`/following` 保留路由但不在导航可达
- **`/illusts` + `IllustList.vue`**：插画分类页（推荐/关注子 tab + waterfall，同小说页子 tab 模式，tabs 用 row + border-b 指示条——Bookmarks 已验证写法）
- **`createMixFeed` 深模块**（`src/primitives/`）：两路远程分页源按比例交替合并成单一渲染流，接口（items/loading/loadingMore/error/nextUrl/fetchMore/refresh）与单源 feed 同构；隐藏交替合并（默认 4:1 插画:小说）、分批渲染（pageSize=20，规避 web-core 图片风暴）、双防抖（throttle 800ms + cooldown 3s）、翻页优先级（缺哪种先补哪种）、跨源 key 去重、generation 竞态、15s 超时
- 推荐页迁移到 `createMixFeed`（插画推荐 4:1 小说推荐），小说封面卡复用 `PixivNovel.image_urls`

### 决策 4（教训）：模拟器渲染异常不代表真机

排查"Me 页 R18/R18G switch 轨道拉伸"期间做了 7 轮 CSS/结构实验（去 transition / 去 border / 静态背景 / v-if 双静态），全部无效——**最终确认是模拟器（Apple M4 + OpenGL→Metal 翻译层）的渲染环境缺陷**，用户真机（原生 GL 驱动）渲染正常。**全部实验已回滚**（Me.vue 与 HEAD 零差异）。

**约束**：涉及渲染缺陷的排查，先真机确认复现再动手；模拟器（尤其 Apple 芯片 Metal 翻译层）的渲染观察必须标注"待真机确认"。

## 后果

**正面**：

- 小说详情正文在原生模式走 Java 网关，build 版正常渲染（真机验证通过）
- 列表 item 高度恢复正常（每卡约 133px，NavigationBar 回到可点击区域）
- 四 tab 全局导航单一事实源，插画页/混合推荐 feed 真机验证正常
- 260 项单测通过（含 requestRaw 11 项、createMixFeed 14 项接口级测试）

**负面/风险**：

- `requestRaw` 只覆盖 GET/POST 原始文本响应；未来新增 HTML 端点复用同一接缝
- `createMixFeed` 的交替比例（4:1）为常量，未配置化（后续可按需暴露）
- `border-[0.533vw]`（M3 switch 2dp 边框）曾因模拟器误判被移除，回滚后保留原始实现；真机渲染行为以真机为准
- 模拟器（Metal 翻译层）与真机（原生 GL）渲染差异是持续风险，渲染类改动需双端验证

## 关联

- 术语：`docs/adr/glossary-app-lynx-feed-tabs-gateway.md`
- 上下文：`packages/app-lynx/CONTEXT.md`
