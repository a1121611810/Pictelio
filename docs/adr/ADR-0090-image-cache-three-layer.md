# ADR-0090: 图片缓存三层分离架构

## 状态

已批准

## 日期

2026-07-14

## 背景

图片加载链路中存在三重冗余下载：

1. `<img>` 通过 `shouldInterceptRequest` 从 CDN 下载一次（渲染）
2. `prefetch` / `loadImage()` 通过 `fetch(proxyUrl)` 再从 CDN 下载一次（缓存填充）
3. LRU 内存缓存命中后仍返回代理 URL，`<img>` 再触发一次网络请求

同时在 OPPO R11s (Android 9) 上发现：
- `CapacitorHttp` (OkHttp) 的 TLS 握手挂起，已替换为 WebView 代理路径
- `import("../native/ImageCache")` 动态 import 因 Rolldown 打包的 modulepreload 竞态而挂起，已改为静态 import

原有设置页的"图片缓存限制"（LRU 条目数 100~1000）对渲染速度几乎无影响——`checkImageCache` 命中返回代理 URL，`<img>` 仍然走网络。

## 决策

将图片缓存重构为三个独立的可开关层面，用户可各自控制：

| 层 | 名称 | 默认 | 存储位置 | 命中后效果 |
|----|------|------|---------|-----------|
| A | 磁盘缓存 | 开 | `getCacheDir/pictelio-images/` | `FileInputStream` 直接返回，零网络 |
| B | 浏览器缓存头 | 开 | WebView HTTP 磁盘缓存 | `shouldInterceptRequest` 不被调用，零 Java 开销 |
| C | JS 预取 | 开 | JS 内存(LRU) + ImageCachePlugin(磁盘) | 滚动到新图时 LRU 命中，`loadImage` 零网络 |

### 架构变更

```
改动前:
  SettingsDrawer
    └── slider "图片缓存限制" 100~1000 (仅限 LRU 条目数，对渲染无实际影响)

改动后:
  SettingsDrawer
    └── "图片缓存 →" → /image-cache (新路由)
          ├── [开关 A] 本地磁盘缓存 ── 将图片缓存到手机存储，重启后也能快速加载
          ├── [开关 B] 浏览器缓存头 ── 让浏览器缓存已下载的图片，减少重复请求
          └── [开关 C] 后台预取 ── 提前加载下一页图片，滚动更流畅（消耗更多流量）
```

### 技术实现

**A (Java 磁盘缓存)**: 扩展 `ImageCachePlugin`，增加 `setDiskCacheEnabled` 方法。`MainActivity.interceptImage()` 先检查该标志 + 文件存在性。

**B (浏览器缓存头)**: `MainActivity.interceptImage()` 根据标志决定是否在 `WebResourceResponse` 中加入 `Cache-Control: public, max-age=31536000, immutable` 头。

**C (JS 预取)**: `VirtualFeed.tsx` 的 prefetch `createEffect` 中判断 `imageCachePrefetch` 信号。

**废弃**: `cacheSize` 状态变量保留（避免破坏 resetUiStore），但不再暴露到 UI。`setMaxCacheSize` 调用保留默认值 600。

### 不做的选项

- 不改为 blob URL 方式：blob 生命周期与 LRU 淘汰绑定，缓存淘汰后 `<img>` 引用断裂不可恢复
- 不做 Service Worker 缓存：Capacitor 8 默认无 SW，引入 SW 增加复杂度且与 Capacitor 的本地服务器机制冲突

## 影响

### 正向

- 用户可针对自身场景（流量敏感/存储敏感/性能敏感）精细控制
- 离线场景可用 A 查看已缓存图片
- 三开关独立，改动互不影响
- 废弃无实际作用的"缓存条目数"滑块，减少用户困惑

### 负向

- 新增一个设置页面 + 一个路由
- A 需要扩展 Capacitor 插件（~20 行 Java）
- 三个开关的默认值都需要纳入 `resetUiStore`
