# 详情页多图加载术语表

| 术语 | 定义 |
|------|------|
| **detailQuality** | 用户设置的详情页图片质量偏好（medium/large/original），存储在 `settingsStore.ts` 中。控制详情页使用的图片分辨率。 |
| **LazyDetailImage** | 详情页多图懒加载组件，通过 `visiblePage` 信号驱动可见性。`pageIndex <= visiblePage + 3` 的图片触发预加载。 |
| **preloaded** | `createMemo` 信号，判断当前 `pageIndex` 是否在可见窗口 + 预加载范围内（`pageIndex <= visiblePage + 3`）。为 `true` 时触发 `loadImage()` 下载。 |
| **canDisplayImage** | `createMemo` 信号，组合 `cacheReady && shouldLoad`。为 `true` 时才渲染 PixivImage 组件，确保缓存就绪后才显示图片。 |
| **cacheReady** | `createSignal(false)`，在 `loadImage().finally()` 中设为 `true`。表示图片已下载到 Java 磁盘缓存（L3），`shouldInterceptRequest` 可直接命中。 |
| **loadImage** | `imageLoader.ts` 中的异步函数，检查 L1 缓存 → Native 模式调用 `PixivApi.prefetchImage()` → 写入磁盘缓存 → 登记 L1 标记。返回 `{ url, cleanup }`。 |
| **PixivApi.prefetchImage** | Java 侧（`PixivApiPlugin`）的 Capacitor 插件方法，使用 **OkHttp**（连接池化）将 `i.pximg.net` 图片下载到应用缓存目录 `pictelio-images`。 |
| **interceptImage** | `MainActivity.java` 中的方法，在 `shouldInterceptRequest` 中拦截 `/pixiv-img/` 请求。先检查 Java 磁盘缓存，未命中时回退到 `HttpURLConnection`（无连接池）。 |
| **shouldInterceptRequest** | Android WebViewClient 的回调，在 WebView 发起资源请求时触发。Pictelio 重写此方法拦截 `/pixiv-img/` 路径并代理到 `i.pximg.net`。 |
| **prefetch window** | `preloaded` 计算中的预加载范围宽度，当前为 `+3`（同时预加载当前可见页 + 后面 3 页）。限制并发下载数在 4 以内，避免触发 Pixiv CDN 限流。 |
