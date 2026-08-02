# ADR 0054: 图片流水线统一核心（PixivImageLoader 双 client 共用）

## 状态

已采纳（双 client 真机验证通过）

## 分类

技术决策 / 架构

## 日期

2026-08-02

## 背景

图片加载存在两套潜在实现：webview 的 `MainActivity.interceptImage`（URL 重写 + OkHttp + Referer/UA + 磁盘缓存）与 Lynx 的图片服务（`ILynxImageService`）。若各自实现会重复维护（CDN/UA/缓存策略改动两处）；且 Lynx 引擎自身不下载图片，官方 Fresco 服务不带 Referer（i.pximg.net 403），必须自研。

## 决策

### 1. 公共核心 `PixivImageLoader`（单一实现）

- **URL 重写**：`/pixiv-img/{path}` → `OAuthConfig.IMAGE_CDN_URL + path`，含 `URI.normalize()`（dot-segment 折叠，防同一 URL 双缓存 key）。
- **磁盘缓存**：读/写/淘汰对齐既有约定（`OAuthConfig.CACHE_DIR="pictelio-images"` + Base64 URL-safe no-padding 文件名 + `CACHE_MAX_BYTES` 删最旧）——与 `ImageCachePlugin`/`PixivApiPlugin.prefetchImage` 同规则 → **双 client 共享同一缓存目录**。
- **下载**：复用 `PixivApiPlugin.getSharedClient()`（连接池），注入 Referer/UA；非 2xx / 空 body 抛 IOException 且不写缓存。
- **并发安全**：per-URL 锁 + double-check，同 URL 并发只下载一次（webview 拦截为多线程）。

### 2. 两个薄适配层（不复制逻辑）

- **webview**：`MainActivity.interceptImage` 委托核心（保留 mime 后缀推断、`image_cache_disk/browser` 开关、`Cache-Control immutable` 头）；未命中补全写盘（行为增强）；共享 loader 实例保 per-URL 锁。
- **Lynx**：`PictelioImageService`（`ILynxImageService`）——fetchImage 走核心 → 采样解码（inSampleSize，2048 上限防 OOM）→ `ImageContent(bitmap)` 回调；动画 4 件套返回 false；`canParseUrl` 仅 http(s)/代理路径。

### 3. Lynx 图片必须注册 `<image>` Behavior

**只实现 `ILynxImageService` 接口不够**——lynx 引擎不知道 `<image>` 元素怎么创建（真机骨架屏永久显示）。必须在服务构造时 `LynxEnv.inst().addBehaviors(...)` 注册 `<image>`/`<inline-image>` 的 Behavior（`UIImage`/`FlattenUIImage`/`AutoSizeImage`/`InlineImageShadowNode`，对齐官方 `LynxImageService` 构造）。注册失败防御性 catch（单测 classpath 缺 gson 时跳过）。

## 验证

- 单测：`PixivImageLoaderTest` 17 例（重写/文件名契约/缓存往返/淘汰/失败路径/头契约/并发）+ `PictelioImageServiceTest` 7 例（成功/HTTP 错误/空 body/缓存复用/动画/canParseUrl）
- 真机：`lynx-flow-check.sh` 推荐页/详情大图渲染 PASS；双 client 共享缓存（同一目录）

## 相关

- 提交：`0c04d74`（#57 核心）、`3b0b48d`（#58 webview 迁移）、`1957a8e`（#59 Lynx 服务）
- 研究：`docs/research/lynx-android-brownfield-integration.md` §3
- 术语：`glossary-app-lynx-native.md`
