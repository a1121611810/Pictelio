# 图片加载流水线文档

> **⚠️ 存档文档（archive）**：本文描述的是**已下线**的形态。WebView 客户端的运行时已随
> [#610](https://github.com/a1121611810/Pictelio/issues/610) 下线，其**源码、构建配置、依赖与专属测试**
> 已随 [ADR-0203](adr/ADR-0203-webview-client-source-removal.md) 整包删除。
> 本文正文**一字未改**，保留供决策史参考；其中的路径、命令与文件清单**均已失效**，勿照抄执行。
> 当前形态见 [glossary-webview-client-removal](adr/glossary-webview-client-removal.md)。

> 本文档追踪一张 Pixiv 插图从 API 请求到屏幕渲染的完整路径，
> 涵盖数据流、渲染链、缓存层、代理层四个维度。
> 每步标注文件:行号、耗时估算（R11s 低端设备典型值）、优化空间。

---

## 目录

1. [Feed 数据初始化](#1-feed-数据初始化)
2. [虚拟滚动与可见性计算](#2-虚拟滚动与可见性计算)
3. [图片 URL 解析](#3-图片-url-解析)
4. [PixivImage 组件渲染](#4-pixivimage-组件渲染)
5. [WebView 代理层 (shouldInterceptRequest)](#5-webview-代理层-shouldinterceptrequest)
6. [后台缓存填充 (prefetch + loadImage)](#6-后台缓存填充-prefetch--loadimage)
7. [LRU 内存缓存](#7-lru-内存缓存)
8. [ImageCachePlugin 磁盘缓存](#8-imagecacheplugin-磁盘缓存)
9. [磁盘预热 (warmCacheFromDisk)](#9-磁盘预热-warmcachefromdisk)
10. [分页 (Paginator)](#10-分页-paginator)
11. [完整时序图](#11-完整时序图)
12. [优化矩阵](#12-优化矩阵)

---

## 1. Feed 数据初始化

### 1.1 触发入口

**文件**: `packages/app/src/routes/TabFeedPage.tsx:63-66`

用户打开「推荐」或「关注」Tab 时触发：

```typescript
onMount(() => {
  setCurrentTab(props.tab);           // 告诉 feedStore 当前是哪个 tab
  abortController = new AbortController();
  void ensureLoaded(abortController.signal);  // 异步加载，不阻塞渲染
});
```

- `setCurrentTab(props.tab)` → 设置 `uiStore.state.currentTab`，后续 `feedStore` 按此决定从哪个数据源读取
- `ensureLoaded()` 返回 Promise 但不 await，避免阻塞组件挂载

### 1.2 ensureLoaded 分支逻辑

**文件**: `packages/app/src/stores/feedStore.ts:192-293`

```typescript
async function ensureLoaded(signal?: AbortSignal) {
  // 如果该 tab 已缓存过数据且非过期（无 refresh），直接返回
  if (tabLoaded[sourceKey] && !state.refreshing) return;

  // 按 tab 类型分流
  if (props.tab === "follow") {
    await fetchFollow();                    // 同时拉取 public + private
  } else if (currentSubTab === "mixed") {
    await fetchMixed();                     // 同时拉取 illust + manga
  } else if (currentSubTab === "illust") {
    await fetchRecommended("illust");
  } else if (currentSubTab === "manga") {
    await fetchRecommended("manga");
  }
}
```

三个分流函数内部都调用同一个底层 API 方法：

| Tab | 函数 | API 路径 |
|-----|------|----------|
| follow | `fetchFollow()` | `GET /v2/illust/follow?restrict={public\|private}` |
| recommended/illust | `fetchRecommended("illust")` | `GET /v1/illust/recommended?content_type=illust` |
| recommended/manga | `fetchRecommended("manga")` | `GET /v1/illust/recommended?content_type=manga` |
| recommended/mixed | `fetchMixed()` | 以上两个并行 |

**耗时**: `200ms～2s`（取决于网络和 Pixiv API 响应速度）

### 1.3 API 客户端调用

**文件**: `packages/app/src/api/illust.ts:10-22`

```typescript
export async function loadRecommended(contentType: string, signal?: AbortSignal) {
  const resp = await apiClient.get<ApiResponse<PixivIllust[]>>("/v1/illust/recommended", {
    params: { content_type: contentType, filter: "for_ios" },
    signal,
  });
  return resp.body;
}
```

**文件**: `packages/app/src/api/client.ts:132-244`

`executeRequest()` 执行以下操作：

```
① rewriteUrl()        : 按平台重写 URL
   Web    → https://app-api.pixiv.net  → /pixiv-api/...
   Native → 不变（直连）

② 拼装 headers
   Authorization: Bearer <access_token>
   User-Agent: PixivIOSApp/7.18.3
   Referer: https://app-api.pixiv.net/

③ 发送请求
   Web    → fetch() 经过 Vite dev server proxy
   Native → PictelioHttpPlugin (OkHttp + DoH DNS)
            → cloudflare-dns.com 解析 app-api.pixiv.net 真实 IP
            → 直连服务器，绕过 GFW DNS 污染

④ 状态码处理
   200 → 返回 body
   401 → 自动 refresh_token → 重试 1 次（防死循环: isRetryingAfter401）
   429 → 指数退避重试（最多 3 次）
```

**耗时**: `200ms～1.5s`（包括 DNS、TLS、数据传输）

### 1.4 数据写回 store

**文件**: `packages/app/src/stores/feedStore.ts`

```typescript
// 接口返回后：
setState("illusts", resp.illusts);                       // 当前显示的列表（响应式）
setState("tabIllusts", tabKey, resp.illusts);            // tab 独立缓存
setState("tabNextUrl", tabKey, resp.next_url);           // 分页游标
setState("tabLoaded", tabKey, true);                     // 标记已加载
setState("loading", false);
setState("nextUrl", resp.next_url);
```

`state.illusts` 是 SolidJS 响应式数组，VirtualFeed 的 `props.illusts` 绑定到这个数组。一旦数组变化，VirtualFeed 重新渲染。

---

## 2. 虚拟滚动与可见性计算

### 2.1 VirtualFeed 布局引擎

**文件**: `packages/app/src/components/VirtualFeed.tsx:34-41`

```typescript
const COLUMNS = { waterfall: 2, single: 1, grid: 3 };
const GAP = 12;
const VERTICAL_GAP = 12;
```

| 布局模式 | 列数 | 用途 |
|----------|------|------|
| `waterfall` | 2 | 默认瀑布流 |
| `single` | 1 | 单列模式 |
| `grid` | 3 | 网格模式 |

**文件**: `packages/app/src/components/LayoutEngine.tsx:37-125`

布局计算使用 `createMemo`（SolidJS 响应式缓存），仅在依赖变化时重算：

```typescript
const syncLayout = createMemo(() => {
  if (layoutMode() === "waterfall") {
    return computeLayout(illusts(), columnWidth(), columnCount(), layoutGap(), verticalGap());
  }
  // grid/single 布局
});
```

对于 `waterfall` 模式 + 数据量 ≥ 10 条，通过 Web Worker 异步计算：

**文件**: `packages/app/src/primitives/computeMasonryLayout.ts`

```
computeMasonryLayout(illusts, columnWidth, columnCount, gap, verticalGap, TOP_OFFSET)
  → 返回 MasonryLayout = { columns, positions, totalHeight, columnHeights }
    → columns[] { items[], height }
      → positions[idx] = { x, y, width, height }
```

**耗时**: `5～50ms`（Worker 并行，不阻塞主线程）

### 2.2 可见窗口计算

**文件**: `packages/app/src/primitives/createVirtualScroll.ts:40`

```typescript
const overscan = opts.overscan ?? 400;  // 上下各扩展 400px
```

滚动监听器（无 rAF 节流，SolidJS 信号合并批量更新）：

```typescript
window.addEventListener("scroll", () => {
  setScrollTop(window.scrollY);        // 每次滚动事件都触发
}, { passive: true });
```

可见窗口 = `[scrollTop - 400, scrollTop + viewportHeight + 400]`

在这个窗口范围内的 items 才会渲染 DOM 节点。每个 card 高度约 `280～500px`，在 ~800px 视口下同时渲染约 **6～12 个卡片**。

### 2.3 LazyImageCard 延迟渲染

**文件**: `packages/app/src/components/LazyImageCard.tsx:38-45`

```typescript
const visible = createViewportLazy({ rootMargin: "100px" });
// 距视口 100px 范围内 → 渲染 <ImageCard>
// 范围外          → 渲染 <SkeletonCard>（骨架屏）
```

**文件**: `packages/app/src/primitives/useViewportLazy.ts`

使用 `IntersectionObserver`，一旦进入范围就**永久激活**（不取消观察）：

```
优点: 用户回滚时卡片仍在，无闪白
缺点: 离屏卡片仍保留 DOM，回收由虚拟滚动控制
```

### 2.4 前 4 张直接渲染

**文件**: `packages/app/src/components/VirtualFeed.tsx:285-289`

```typescript
{realIndex < 4 ? (
  <ImageCard illust={illust} onClick={props.onIllustClick} />
) : (
  <LazyImageCard illust={illust} onClick={props.onIllustClick} />
)}
```

前 4 张卡片不经过 `LazyImageCard` 延迟渲染，直接显示 `ImageCard`，确保首屏最快出图。

---

## 3. 图片 URL 解析

### 3.1 listQuality 质量选择

**文件**: `packages/app/src/components/ImageCard.tsx:9-15`

```typescript
function resolveUrl(illust: PixivIllust): string {
  const q = listQuality();              // 从 uiStore 读取用户设置
  if (q === "medium") return illust.image_urls.medium;
  if (q === "large") return illust.image_urls.large;
  // "original" 模式
  return illust.meta_single_page?.original_image_url ?? illust.image_urls.large;
}
```

**文件**: `packages/app/src/stores/uiStore.ts:94`

| 质量 | 默认? | CDN 路径示例 | 典型尺寸 |
|------|-------|-------------|----------|
| `medium` | ✅ 默认 | `c/540x540_70/img-master/..._master1200.jpg` | 50～150KB |
| `large` | ❌ | `c/600x1200_90/img-master/..._master1200.jpg` | 100～300KB |
| `original` | ❌ | `img-original/img/..._p0.png`（无 `/c/` 前缀） | 1～10MB |

**Pixiv CDN URL 格式**: `https://i.pximg.net/{裁剪}/{尺寸}_{质量}/{类型}/...{文件名}`

| 段 | 含义 | 示例 |
|----|------|------|
| `c/540x540_70` | 裁剪到 540px 边长，JPEG 质量 70 | 预览图 |
| `c/250x250_80` | 250px 方形裁剪，质量 80 | 头像/缩略图 |
| `c/600x1200_90` | 600x1200 裁剪，质量 90 | 大图 |
| `img-master` | 主图格式（带尺寸） | `_master1200.jpg` |
| `img-original` | 原始格式（无裁剪） | `_p0.png` |

### 3.2 resolveImageUrl 代理转换

**文件**: `packages/app/src/utils/imageLoader.ts:131-140`

```typescript
export function resolveImageUrl(originalUrl: string): string {
  if (!originalUrl) return "";
  if (originalUrl.startsWith("/pixiv-img/")) return originalUrl;  // 已是代理路径
  if (originalUrl.startsWith("https://s.pximg.net/")) return originalUrl;  // 静态资源免代理

  const parts = originalUrl.split("/");
  const path = parts.slice(3).join("/");    // 去掉 "https:", "", "i.pximg.net"
  return `/pixiv-img/${path}`;
}
```

**转换示例**:

```
输入: https://i.pximg.net/c/540x540_70/img-master/img/2026/01/01/00/00/00/12345678_p0_master1200.jpg
输出: /pixiv-img/c/540x540_70/img-master/img/2026/01/01/00/00/00/12345678_p0_master1200.jpg

输入: https://s.pximg.net/common/images/logo.png
输出: https://s.pximg.net/common/images/logo.png  （不变）
```

`s.pximg.net` 是 Pixiv 静态资源 CDN（头像、图标等），不需要 Referer 验证，可直接访问。

---

## 4. PixivImage 组件渲染

### 4.1 同步缓存检查与 URL 决策

**文件**: `packages/app/src/components/PixivImage.tsx:18-29`

```typescript
// 组件初始化时（同步，不涉及网络）
let syncBlobUrl: string | null = null;
if (props.src) {
  const cachedUrl = checkImageCache(props.src);      // LRU 缓存查询
  if (cachedUrl) {
    syncBlobUrl = cachedUrl;                           // 缓存命中 → 代理 URL
  }
}

// displayUrl 初始值（决定 <img> 的 src）
const [displayUrl, setDisplayUrl] = createSignal(
  syncBlobUrl || (props.src ? resolveImageUrl(props.src) : "")
);
```

**决策逻辑**:

| 条件 | displayUrl | 实际效果 |
|------|-----------|----------|
| LRU 缓存有 | `resolveImageUrl(src)` → `/pixiv-img/...` | `<img>` 通过代理渲染 |
| LRU 缓存无 | `resolveImageUrl(src)` → `/pixiv-img/...` | 同上（均为代理 URL） |
| `props.src` 为空 | `""` | 显示 "加载中..." 骨架屏 |

**关键**: LRU 缓存命中和未命中都返回**代理 URL**（`/pixiv-img/...`），不会返回 `blob:` URL。这意味着每次 `displayUrl` 变化都走 WebView 代理请求。

### 4.2 blur 占位图 → 过渡动画

**文件**: `packages/app/src/components/ImageCard.tsx:96-127`

```typescript
<div class="relative overflow-hidden rounded-[var(--borderRadiusMedium)]">
  {/* Blur-up placeholder: square_medium */}
  <img
    src={resolveImageUrl(props.illust.image_urls.square_medium)}
    class="absolute inset-0 w-full h-full object-cover blur-lg scale-110 pointer-events-none
           transition-opacity duration-500"
    classList={{ "opacity-0": mainLoaded() }}       // mainLoaded=true 时淡出
  />

  {/* Main image */}
  <PixivImage
    src={img()}                                       // medium/large/original
    onLoad={() => setMainLoaded(true)}                // 加载完成 → 占位图淡出
    loading="lazy"
  />
</div>
```

**过渡时序**:

```
时间线 →
┌─────────────────────────────────────────────┐
│ blur 占位 (square_medium, opacity:1)         │
│  ↓                                            │
│ blur 占位 + 主图开始下载 (background)          │
│  ↓                                            │
│ 主图 onLoad 触发 → setMainLoaded(true)         │
│  ↓                                            │
│ blur 占位 opacity:0 (CSS transition 500ms)    │
│ 主图完全可见                                   │
└─────────────────────────────────────────────┘
```

- blur 占位图是 **250×250 方形裁剪**，放大 + `blur-lg` 模糊 + `scale(1.1)` 铺满卡片
- `loading="lazy"` 让浏览器按优先级延迟加载（不是立即）
- CSS `transition-opacity duration-500` = 500ms 淡出占位图（Fluent durationSlow）

### 4.3 handleError 降级

**文件**: `packages/app/src/components/PixivImage.tsx:35-38`

```typescript
function handleError(e: Event) {
  console.error(`[PixivImage] <img> onError: ${img.src}`);
  setFailed(true);
}
```

`failed()` 为 true 时显示 "⚠ 加载失败" 占位（保持卡片宽高比）：

```typescript
{displayUrl() && !failed() ? (
  <img src={displayUrl()} ... />
) : failed() ? (
  <div>⚠ 加载失败</div>
) : (
  <div class="shimmer">加载中...</div>
)}
```

---

## 5. WebView 代理层 (shouldInterceptRequest)

### 5.1 拦截注册

**文件**: `packages/app/android/app/src/main/java/io/pictelio/app/MainActivity.java:46-103`

在 `onStart()` 中，用自定义 `WebViewClient` 包装 Capacitor 原有的 WebViewClient：

```java
webView.setWebViewClient(new WebViewClient() {
    @Override
    public WebResourceResponse shouldInterceptRequest(
            WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        WebResourceResponse custom = interceptImage(url);  // 拦截 /pixiv-img/
        if (custom != null) return custom;                  // 命中 → 返回代理响应
        if (originalClient != null)
            return originalClient.shouldInterceptRequest(view, request);  // 放行
        return super.shouldInterceptRequest(view, request);
    }
});
```

两层 `shouldInterceptRequest` 重载（新式 + 弃用式）覆盖所有 WebView 版本。

### 5.2 interceptImage 代理实现

**文件**: `packages/app/android/app/src/main/java/io/pictelio/app/MainActivity.java:105-131`

```java
private WebResourceResponse interceptImage(String url) {
    if (url == null || !url.contains("/pixiv-img/")) return null;  // 非图片 → 放行

    try {
        // 1. 提取路径: "/pixiv-img/c/540x540_70/..." → "c/540x540_70/..."
        String path = url.substring(
            url.indexOf("/pixiv-img/") + "/pixiv-img/".length());

        // 2. 拼回 pixiv CDN URL
        String pixivUrl = new URI("https://i.pximg.net/" + path).normalize().toString();

        // 3. 创建 HTTP 连接
        HttpURLConnection conn = (HttpURLConnection) new URL(pixivUrl).openConnection();

        // 4. 注入必需请求头（pixiv CDN 校验来源）
        conn.setRequestProperty("Referer", "https://app-api.pixiv.net/");
        conn.setRequestProperty("User-Agent",
            "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)");
        conn.setConnectTimeout(10000);     // 连接超时 10s
        conn.setReadTimeout(15000);        // 读取超时 15s

        // 5. 获取 MIME 类型
        String mime = conn.getContentType();
        if (mime == null) mime = "image/jpeg";

        // 6. 返回流式响应（WebView 边读边渲染）
        return new WebResourceResponse(
            mime,
            conn.getContentEncoding(),     // 可能为 null（JPEG 无编码）
            conn.getInputStream()          // 输入流 → WebView 逐步解析
        );
    } catch (Exception e) {
        e.printStackTrace();
        return null;  // 异常 → 让 Capacitor 默认处理
    }
}
```

**关键细节**:

| 步骤 | 说明 |
|------|------|
| **Referer 头** | Pixiv CDN 必需的防盗链。值必须是 `https://app-api.pixiv.net/` |
| **User-Agent** | 模拟 Pixiv iOS App，避免 CDN 返回 403 |
| **HttpURLConnection** | Android 系统原生 HTTP 库。**不支持连接池**，每个请求新建 TCP+TLS 连接 |
| **InputStream 流式返回** | `WebResourceResponse` 接受 InputStream，WebView 逐步解码边下边显示 |
| **超时** | connect=10s, read=15s。`i.pximg.net` 国际 CDN，网络不好时易超时 |
| **异常处理** | 任何异常打印后返回 null → Capacitor 默认处理（可能会 404） |

**耗时**: `500ms～5s`（TLS 握手 + 数据传输，取决于网络）

### 5.3 为什么不用 OkHttp

原代码 `fetchSingleNative()` 用 `CapacitorHttp.request()`（底层 OkHttp）直连 `i.pximg.net`。在 Android 9 OPPO R11s 上，OkHttp 的 TLS 握手挂起——`Promise` 既不 resolve 也不 reject，导致图片永远不渲染。

改用 `HttpURLConnection`（系统内置）后握手正常。原因：

| 客户端 | Android 9 TLS 行为 | 结论 |
|--------|-------------------|------|
| OkHttp 4.12 | 使用自己的 TLS 实现 + cipher suite 偏好 | ❌ 握手挂起 |
| `HttpURLConnection` | 使用 `Conscrypt`（系统 TLS 提供者） | ✅ 正常 |

---

## 6. 后台缓存填充 (prefetch + loadImage)

### 6.1 VirtualFeed 预取触发

**文件**: `packages/app/src/components/VirtualFeed.tsx:173-193`

```typescript
createEffect(() => {
  const range = vs.visibleRange();
  if (range.endIndex < 0) return;
  if (isImageHostEnabled()) return;                     // 自定义图床模式 → 跳过

  const illustsList = props.illusts;
  const preloadEnd = Math.min(range.endIndex + 10, illustsList.length);  // 预取 10 张

  for (let i = range.endIndex + 1; i < preloadEnd; i++) {
    const ill = illustsList[i];
    if (!ill) break;
    const url = ill.image_urls.medium || ill.image_urls.large;
    if (url) {
      if (!checkImageCache(url)) {                       // LRU 缓存未命中才预取
        loadImage(url).catch(() => {});                   // 下载 + 缓存
      }
    }
  }
});
```

**触发条件**:

| 条件 | true | false |
|------|------|-------|
| `visibleRange.endIndex >= 0` | ✅ 继续 | ❌ 跳过 |
| `isImageHostEnabled()` | ❌ 跳过（图床模式下不预取） | ✅ 继续 |
| `checkImageCache(url)` 为真 | ❌ 跳过（已有缓存） | ✅ 预取 |

**注**: `isImageHostEnabled()` 默认为 false（未启用自定义图床），所以预取默认开启。

### 6.2 loadImage → loadImageInner 完整路径

**文件**: `packages/app/src/utils/imageLoader.ts:182-262`

```
loadImage(originalUrl: string)
  │
  ├─ 1. originalUrl 为空? → { url: "", cleanup: () => {} }
  │
  ├─ 2. LRU 缓存命中?    → { url: resolveImageUrl(originalUrl) }
  │                         ← 返回代理 URL（非 blob URL）
  │
  ├─ 3. 飞行中去重命中?   → 复用已有 Promise
  │
  └─ 4. loadImageInner(originalUrl)
       │
       ├─ targetUrl = isImageHostEnabled() ? getEffectiveImageUrl(originalUrl)
       │                                    : originalUrl
       │
       ├─ isNative = Capacitor.isNativePlatform()
       │
       ├─ [isNative = true] → 磁盘缓存检查
       │   │
       │   ├─ getImageCache() → ImageCachePlugin
       │   │   └─ 返回 ImageCachePlugin 实例（同步，无超时）
       │   │
       │   ├─ cache.getImage({ key: originalUrl })
       │   │   ├─ 磁盘有 → base64 → decode → cacheSet(LRU)
       │   │   │            → { url: resolveImageUrl(originalUrl) }
       │   │   └─ 磁盘无 → catch → 继续到网络下载
       │   │
       │   └─ fetchNative(targetUrl, originalUrl)
       │       └─ toWebProxyUrl(targetUrl)
       │           → fetchSingleWeb("/pixiv-img/...")
       │             → fetch("/pixiv-img/...")
       │               → shouldInterceptRequest
       │                 → HttpURLConnection → i.pximg.net
       │                   ← blob
       │
       └─ [isNative = false] → fetchWeb(targetUrl, originalUrl)
           └─ toWebProxyUrl(targetUrl)
             → fetchSingleWeb("/pixiv-img/...")
               → fetch("/pixiv-img/...")
                 → Vite dev proxy
                   → i.pximg.net
                     ← blob
                      │
                      ↓
               cacheSet(originalUrl, blob)    ← LRU 内存缓存
               cache.saveImage({key, base64})  ← Android 磁盘缓存（native only）
                 → ImageCachePlugin 写文件
                      │
                      ↓
               return { url: resolveImageUrl(originalUrl) }
```

### 6.3 磁盘缓存检查

**文件**: `packages/app/src/utils/imageLoader.ts:217-229`

```typescript
const imageCache = getImageCache();    // 同步，立即返回
try {
  const cached = await imageCache.getImage({ key: originalUrl });  // bridge 调用
  if (cached?.base64) {
    const decoded = await base64ToBlob(cached.base64);  // 同步解码
    cacheSet(originalUrl, decoded);                      // 存入 LRU
    return { url: resolveImageUrl(originalUrl) };         // 返回代理 URL
  }
} catch (e) {
  // 磁盘缓存不可用 → 降级到网络下载
  console.warn("[ImageCache] Disk cache check failed, falling back to network", e);
}
```

**耗时**:

| 步骤 | 耗时 | 说明 |
|------|------|------|
| `getImageCache()` | < 0.01ms | 同步函数，直接返回已缓存的引用 |
| `cache.getImage({key})` | 5～100ms | Capacitor bridge 序列化 + Java 读文件 + 反序列化 |
| `base64ToBlob(base64)` | 2～50ms | atob + Uint8Array + Blob 构造 |
| `cacheSet(originalUrl, decoded)` | < 0.1ms | Map 插入 + 可能的淘汰 |

**磁盘命中率**: 冷启动时 ≈ 0%（预热前），使用一段时间后 ≈ 30～60%（取决于用户浏览量）

### 6.4 fetchNative → fetchSingleWeb (网络下载)

**文件**: `packages/app/src/utils/imageLoader.ts:394-404`

```typescript
async function fetchNative(targetUrl: string, originalUrl: string): Promise<Blob> {
  const urls = getRaceCandidateUrls(targetUrl);
  if (urls.length > 1) {
    const proxyUrls = urls.map(toWebProxyUrl);
    return raceFetch(proxyUrls, fetchSingleWeb, toWebProxyUrl(originalUrl));
  }
  return fetchSingleWeb(toWebProxyUrl(targetUrl));
}
```

`raceFetch` 用 `Promise.any` 并发请求多个候选 URL，取最快成功的。

**文件**: `packages/app/src/utils/imageLoader.ts:386-392`

```typescript
async function fetchSingleWeb(url: string): Promise<Blob> {
  const resp = await fetch(url);              // fetch 代理 URL
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  if (blob.size === 0) throw new Error("Empty response");
  return blob;
}
```

**耗时**: `500ms～5s`（fetch + shouldInterceptRequest + HttpURLConnection）

### 6.5 缓存写入

```typescript
// LRU 内存缓存
cacheSet(originalUrl, blob);
// → URL.createObjectURL(blob) 创建 blob: URL
// → 存入 Map（最多 600 条目或 200MB）
// → 超限时 evictOldest() 释放

// Android 磁盘缓存（仅 native）
imageCache.saveImage({ key: originalUrl, base64 })
// → base64 编码 → Java FileOutputStream 写入
// → enforceCacheLimit() 删除最旧文件（最多 300MB）
```

**保存到磁盘的时机**: 网络下载完成后异步执行，异常不阻塞主流程。

---

## 7. LRU 内存缓存

### 7.1 数据结构

**文件**: `packages/app/src/utils/imageLoader.ts:28-39`

```typescript
interface CacheEntry {
  blob: Blob;                // 图片原始数据
  blobUrl: string;           // URL.createObjectURL(blob) 创建的持久 URL
  lastAccess: number;        // 最近访问时间戳（用于淘汰）
  byteSize: number;          // blob.size 快照（避免频繁访问 getter）
}

let maxCacheSize = 600;       // 最大条目数
const MAX_CACHE_BYTES = 200 * 1024 * 1024;  // 最大字节数 200MB
let totalBytes = 0;
const cache = new Map<string, CacheEntry>();  // key = pixiv CDN URL
```

### 7.2 淘汰策略

**文件**: `packages/app/src/utils/imageLoader.ts:35-58`

```typescript
function evictOldest() {
  // 扫描所有条目，找 lastAccess 最小的
  let oldestKey = "";
  let oldestTime = Infinity;
  for (const [k, v] of cache) {
    if (v.lastAccess < oldestTime) {
      oldestTime = v.lastAccess;
      oldestKey = k;
    }
  }
  if (!oldestKey) return;
  const old = cache.get(oldestKey);
  if (old) {
    totalBytes -= old.byteSize;
    URL.revokeObjectURL(old.blobUrl);  // 释放 blob: URL
    cache.delete(oldestKey);
  }
}
```

**淘汰触发条件**（任一满足）：

```
cache.size >= maxCacheSize (600)
  || totalBytes + 新 blob.size > MAX_CACHE_BYTES (200MB)
```

淘汰线性扫描 O(n)，n ≤ 600。4GB RAM 设备上 200MB 缓存可能过高，但本次优化未调整此值。

### 7.3 对外暴露的函数

| 函数 | 返回 | 用途 |
|------|------|------|
| `checkImageCache(url)` | `resolveImageUrl(url)` 或 `undefined` | 判断是否命中，返回代理 URL |
| `loadImage(url)` | `Promise<{url, cleanup}>` | 下载 + 缓存，返回代理 URL |
| `injectCacheEntry(key, blob)` | void | 直接注入 LRU（预热用） |
| `clearImageCache()` | void | 清空缓存（设置面板"清除缓存"按钮） |
| `getCacheSize()` | number | 当前条目数（调试用） |
| `setMaxCacheSize(n)` | void | 调整上限，立即淘汰超限条目 |

### 7.4 blob URL vs 代理 URL

**当前实现**: `checkImageCache()` 返回 `resolveImageUrl(originalUrl)`（代理 URL），**不是** `blob:` URL。

```
checkImageCache命中 → 代理 URL → <img src="/pixiv-img/...">
                                  → shouldInterceptRequest → HttpURLConnection
                                    → 又一次网络请求！
```

这意味着 **LRU 缓存命中仍触发一次代理 HTTP 请求**。缓存只是 `loadImage()` 调用不再下载，但 `<img>` 渲染仍然走网络。

如果改为返回 `blob:` URL：

```
checkImageCache命中 → blob: URL → <img src="blob:...">
                                  → URL.createObjectURL 的直接引用
                                    → 零网络，立即显示
```

但 blob URL 生命周期与 LRU 淘汰绑定——如果缓存淘汰后 <img> 仍引用该 blob，图片会断裂。

---

## 8. ImageCachePlugin 磁盘缓存

### 8.1 插件注册

**文件**: `packages/app/src/native/ImageCache.ts:14`

```typescript
export const ImageCache = registerPlugin<ImageCachePlugin>("ImageCache");
```

**文件**: `packages/app/android/app/src/main/java/io/pictelio/app/MainActivity.java:35`

```java
registerPlugin(ImageCachePlugin.class);  // 在 super.onCreate() 之前
```

### 8.2 存储结构

```
缓存目录: context.getCacheDir()/pictelio-images/
          ↓
文件命名: Base64URL-safe(key)   // key = 图片原始 URL
          ↓
示例: /data/data/io.pictelio.app/cache/pictelio-images/aHR0cHM6Ly9pLnB4aW1nLm5ldC9jLzU0...
```

### 8.3 saveImage 写入

**文件**: `packages/app/android/app/src/main/java/io/pictelio/app/ImageCachePlugin.java:54-80`

```java
@PluginMethod
public void saveImage(PluginCall call) {
    String key = call.getString("key");         // 图片原始 URL
    String base64 = call.getString("base64");    // Base64 编码的图片数据

    byte[] data = Base64.decode(base64, Base64.DEFAULT);

    // 写入文件
    File file = new File(getCacheDir(), keyToFilename(key));
    try (FileOutputStream fos = new FileOutputStream(file)) {
        fos.write(data);
    }

    // 淘汰超限缓存
    enforceCacheLimit();  // 总大小 > 300MB → 删除最旧文件

    JSObject ret = new JSObject();
    ret.put("path", file.getAbsolutePath());
    call.resolve(ret);
}
```

### 8.4 getImage 读取

**文件**: `packages/app/android/app/src/main/java/io/pictelio/app/ImageCachePlugin.java:83-117`

```java
@PluginMethod
public void getImage(PluginCall call) {
    String key = call.getString("key");

    File file = new File(getCacheDir(), keyToFilename(key));
    if (!file.exists()) {
        call.resolve(new JSObject());       // 未命中 → 返回空对象
        return;
    }

    file.setLastModified(System.currentTimeMillis());  // 更新访问时间

    // 读取文件到 byte[]
    try (FileInputStream fis = new FileInputStream(file);
         ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
        byte[] buf = new byte[8192];
        int read;
        while ((read = fis.read(buf)) != -1) {
            bos.write(buf, 0, read);
        }
        // Base64 编码后返回
        String base64 = Base64.encodeToString(bos.toByteArray(), Base64.DEFAULT);
        JSObject ret = new JSObject();
        ret.put("base64", base64);
        call.resolve(ret);
    }
}
```

### 8.5 写入粒度

```
每张图: 1 次 saveImage bridge 调用
  → Java: base64 解码 (3MB → 2MB raw)
  → 文件写入 (write + flush)
  → 可能的淘汰扫描 (listFiles + sort + delete)
```

大图片（original 模式，数 MB）的 base64 解码和文件写入会在主线程执行，可能卡 Java UI 线程 100～500ms。

---

## 9. 磁盘预热 (warmCacheFromDisk)

### 9.1 调用位置

**文件**: `packages/app/src/App.tsx:135-137`

```typescript
// 在应用启动时调用（fire-and-forget，不阻塞渲染）
warmCacheFromDisk().catch(() => {});
```

### 9.2 实现

**文件**: `packages/app/src/utils/imageLoader.ts:471-497`

```typescript
export async function warmCacheFromDisk(): Promise<void> {
  if (!isNative) return;             // Web 模式不适用

  try {
    const cache = getImageCache();              // 同步获取 ImageCachePlugin
    const { keys } = await cache.getCachedKeys(); // 获取所有已缓存 key 列表
    if (!keys || keys.length === 0) return;

    const recentKeys = keys.slice(-50);          // 最多预热最近 50 张
    const results = await Promise.allSettled(
      recentKeys.map(async (key: string) => {
        const cached = await cache.getImage({ key });
        if (cached?.base64) {
          const blob = await base64ToBlob(cached.base64);
          injectCacheEntry(key, blob);            // 注入 LRU 缓存
        }
      }),
    );

    const loaded = results.filter((r) => r.status === "fulfilled").length;
    console.log(`[ImageCache] Warmup: loaded ${loaded}/${recentKeys.length} entries`);
  } catch (e) {
    console.warn("[ImageCache] Warmup failed", e);  // 预热失败不阻塞启动
  }
}
```

**耗时**: `0.5～5s`（并行加载 50 张，每张 bridge 调用 5～100ms + 解码 2～50ms）

预热成功时，用户首次浏览的图片可能直接从 LRU 缓存闪现。

---

## 10. 分页 (Paginator)

### 10.1 Sentinel 哨兵元素

**文件**: `packages/app/src/primitives/createSentinelPaginator.ts:55-84`

**文件**: `packages/app/src/components/VirtualFeed.tsx:44-48`

```typescript
const { attach: sentinelAttach } = createSentinelPaginator({
  rootMargin: "0px 0px 30% 0px",    // 哨兵距视口底部 30% 时触发
  enabled: () => props.hasMore && !props.loading,
  onTrigger: () => props.onLoadMore(),
});
```

```typescript
// VirtualFeed 底部放置 1px 高的哨兵
<div ref={sentinelAttach} class="h-1" />
```

### 10.2 IntersectionObserver 行为

```typescript
// createSentinelPaginator 内部：
const observer = new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting && enabled()) {
    onTrigger();          // → feedStore.fetchMore()
  }
}, { rootMargin: "0px 0px 30% 0px" });

observer.observe(sentinelElement);
```

- `rootMargin: "0px 0px 30% 0px"` → 哨兵距视口底部还有 30% 视口高度时就触发
- **不断开观察**，每次触发后检查 `enabled()` 防止并发加载

### 10.3 fetchMore 分页逻辑

**文件**: `packages/app/src/stores/feedStore.ts:562-681`

```
哨兵触发 → feedStore.fetchMore()
  │
  ├─ 非 follow tab:
  │   loadNext(state.nextUrl)
  │   → apiClient.get(next_url)
  │   → 返回 { illusts, next_url }
  │   → setState("illusts", [...prev, ...illusts])
  │   → setState("nextUrl", next_url)
  │
  └─ follow tab:
      ├─ restrict=public  → loadNext(followPublicNextUrl)
      ├─ restrict=private → loadNext(followPrivateNextUrl)
      └─ restrict=all      → 对比两条源的 create_date，加载较旧的一条
```

每次加载返回约 20～30 张 new illusts，最多可无限滚动。

---

## 11. 完整时序图

```
时间 →
┌─────────────────────────────────────────────────────────────────┐
│ 用户打开推荐 Tab                                                  │
│  ↓                                                              │
│ TabFeedPage.onMount()                                           │
│  ↓                                                              │
│ feedStore.ensureLoaded()                                        │
│  ↓                                                              │
│ api/illust.loadRecommended()   ─── GET /v1/illust/recommended   │
│  ↓                                                              │
│ PictelioHttpPlugin (OkHttp + DoH) → app-api.pixiv.net           │
│  ↓                                                              │
│ ← 返回 PixivIllust[20]  { image_urls, width, height }            │
│  ↓                                                              │
│ feedStore.state.illusts = response                              │
│  ↓                                                              │
│ VirtualFeed receives new illusts                                │
│  ↓                                                              │
│ LayoutEngine.computeMasonryLayout()  (Worker 或主线程)            │
│  ↓                                                              │
│ createVirtualScroll → visibleRange = [0, 8]                     │
│  ↓                                                              │
│ 渲染前 4 张: <ImageCard>                                         │
│ 渲染 5~8 张: <LazyImageCard → viewport 内 → <ImageCard>          │
│  ↓                                                              │
│ 对于每张 ImageCard:                                              │
│   ImageCard.resolveUrl(illust) → "medium" URL                   │
│     ↓                                                           │
│   PixivImage(props.src=medium_url)                             │
│     ↓                                                           │
│   ① blur 占位: <img src="/pixiv-img/square_medium">             │
│        → shouldInterceptRequest → HttpURLConnection             │
│          → i.pximg.net/c/250x250_80/... → 250px 图片             │
│            ↓                                                    │
│            blur 显示（模糊放大 + scale(1.1)）                      │
│                                                                  │
│   ② 主图: <img src="/pixiv-img/medium">                         │
│        → shouldInterceptRequest → HttpURLConnection             │
│          → i.pximg.net/c/540x540_70/... → 540px 图片              │
│            ↓                                                    │
│            onLoad → setMainLoaded(true)                         │
│              ↓                                                  │
│            blur opacity-0 (500ms transition)                    │
│              → 主图完全显示                                       │
│                                                                  │
│   ③ 后台 (VirtualFeed prefetch):                                │
│      loadImage(next 10 items)                                   │
│      → fetchNative → fetchSingleWeb(proxyUrl)                  │
│        → fetch("/pixiv-img/...")                                │
│          → shouldInterceptRequest → HttpURLConnection           │
│            ← blob → cacheSet(LRU)                               │
│                    → ImageCachePlugin.saveImage(磁盘)             │
│                                                                  │
│ 用户滚动 ↓                                                       │
│  ↓                                                              │
│ createVirtualScroll recomputes visibleRange                     │
│  → 新 item 进入视口 → 同 ①②③                                    │
│                                                                  │
│ 用户滚动到底部                                                    │
│  ↓                                                              │
│ 哨兵进入 IntersectionObserver 触发区                              │
│  → feedStore.fetchMore()                                        │
│    → api/illust.loadNext(nextUrl)                               │
│      → 追加 20 张 illust → 同 ①②③                               │
└─────────────────────────────────────────────────────────────────┘
```

**图中可见的双重下载**:

```
每张新增图片:
  ① <img src="proxy"> → shouldInterceptRequest → HttpURLConnection → CDN ← 渲染用
  ② prefetch loadImage → fetch(proxy) → shouldInterceptRequest → HttpURLConnection → CDN ← 缓存用
```

① 和 ② 是完全独立的 HTTP 请求，各自建立 TLS 连接、传输完整图片数据。

---

## 12. 优化矩阵

| 编号 | 优化点 | 改动位置 | 影响面 | 风险 | 预估收益 |
|------|--------|----------|--------|------|----------|
| **P1** | 预取不触发 `loadImage`（仅标记缓存状态），用户滚动到该图时 `<img>` 自然加载 | `VirtualFeed.tsx:188` | 中 | 低——移除功能 | 减少 50% 后台 CDN 请求 |
| **P2** | `checkImageCache()` 返回 `blob:` URL 而非代理 URL | `imageLoader.ts:58-61` | 中 | 中——blob 生命周期管理 | LRU 命中时零网络 |
| **P3** | `shouldInterceptRequest` 中 `HttpURLConnection` 加 `keep-alive` 头 | `MainActivity.java:116` | 小 | 低 | 减少 TLS 握手次数 |
| **P4** | `LazyImageCard` `rootMargin` 从 `100px` 降到 `50px` | `LazyImageCard.tsx:39` | 小 | 低 | 减少过早加载的图片数 |
| **P5** | preload 数量从 10 降到 3～5 | `VirtualFeed.tsx:181` | 小 | 低 | 减少后台流量 |
| **P6** | 在 `loadWithProgressWeb` 中使用 `fetch(proxyUrl, {signal})` 支持取消 | `imageLoader.ts` `loadWithProgressWeb` | 小 | 低 | 组件卸载时取消下载 |
| **P7** | LRU 上限从 200MB 降到 50MB（4GB 设备） | `imageLoader.ts:37` | 小 | 低 | 降低内存压力 |
| **P8** | `interceptImage` 返回 `WebResourceResponse` 指定 `contentLength` 头 | `MainActivity.java:126` | 小 | 低 | 浏览器进度显示更准确 |
