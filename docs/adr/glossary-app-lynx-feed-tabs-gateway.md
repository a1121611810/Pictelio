# app-lynx Feed / Tab / 网关 — 术语表

> 范围：`packages/app-lynx` 本次迭代引入的数据层、导航与渲染术语。配套 ADR：[ADR-0088-app-lynx-feed-tabs-gateway.md](./ADR-0088-app-lynx-feed-tabs-gateway.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **原始响应接缝（requestRaw）** | `apiClient.requestRaw(method, path, params): Promise<string>`——返回原始响应体文本的双模式入口（web = fetch + 代理 + Bearer；原生 = `PictelioApi.request` 转发 Java，JS 零知 access_token）。用于 `/webview/v2/novel` 等返回 HTML 而非 JSON 的端点。 |
| **混合推荐 feed（Mixed recommendation feed）** | 插画推荐（4:1）与小说推荐按比例交替合并的单一渲染流，由 `createMixFeed` 深模块承载。 |
| **feed 组合器（createMixFeed）** | `src/primitives/createMixFeed.ts`——两路远程分页源合并的深模块，接口（items/loading/loadingMore/error/nextUrl/fetchMore/refresh）与单源 feed 同构；隐藏交替合并、分批渲染、双防抖、翻页优先级、去重、竞态、超时。 |
| **流内遮罩卡（Inline restricted card）** | 列表（single list / waterfall）中受限条目（R18/R18G 且开关关闭）的独立流内卡：`bg-scrim` 背景 + `RestrictOverlay :overlay="false"` 徽章。区别于详情页的 absolute 覆盖遮罩。根因：真机 Lynx 把 absolute 子元素算进 list item 高度导致整卡撑满。 |
| **导航 tab 单一事实源（NAV_TABS）** | `src/components/navTabs.ts` 的共享四 tab 定义（推荐/插画/小说/我的），各顶层页统一接入，消除四处重复定义。 |
| **插画分类页（IllustList）** | `/illusts` 路由页：推荐/关注两个子 tab + waterfall 双列插画卡（同小说页子 tab 模式）。 |
| **小说封面卡（Novel cover card）** | 混合 feed 中小说条目的瀑布流卡片：封面（`PixivNovel.image_urls`）+ 标题（2 行）+ 作者 + 字数，无 BookmarkButton（区别于插画卡）。 |

## 术语关系

```
NAV_TABS（四 tab 单一事实源）
 ├─ 推荐 → /recommended → 综合推荐页（createMixFeed 混合 feed）
 ├─ 插画 → /illusts    → 插画分类页（推荐/关注子 tab）
 ├─ 小说 → /novels     → 小说列表（推荐/关注子 tab）
 └─ 我的 → /me         → 个人中心

apiClient.requestRaw（原始响应接缝）
 └─ fetchNovelText → /webview/v2/novel（HTML）→ extractNovelTextFromHtml

受限条目渲染
 ├─ 列表（single list / waterfall）：流内遮罩卡（RestrictOverlay overlay=false）
 └─ 详情页正文：absolute 覆盖遮罩（RestrictOverlay 默认 overlay=true）
```

## 相关既有术语

- **受限条目（Restricted item）**：因 R18/R18G 开关处于隐藏态的条目（见 `packages/app-lynx/CONTEXT.md`）
- **web-core**：Lynx 的 Web 模拟渲染层（见 [glossary-lynx-units.md](./glossary-lynx-units.md)）
- **双防抖**：loadMore 的 800ms 节流 + 3s 加载完成冷却（[lynx:fix] 防 web-core list 高频 scrolltolower）
