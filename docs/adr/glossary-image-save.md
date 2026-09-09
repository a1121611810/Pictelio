# 作品图片保存（单图保存 / 多图选页 / 批量下载）— 术语表

> 范围：`pictelio-app`（webview 客户端）与 `app-lynx`（Lynx 客户端）双端共有的作品图片保存能力、原生落盘深模块、保存桥契约与选页编排概念。配套：[ADR-0145-image-save-download.md](./ADR-0145-image-save-download.md)、[spec image-save-download](../specs/image-save-download.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **保存到相册（Gallery save）** | 把一张作品图片的字节写入**用户空间**（系统相册 MediaStore / 应用专属外部目录），区别于应用内部的三级图片缓存（L1/L2/L3，只服务渲染、用户不可见、可被淘汰）。 |
| **保存落盘深模块（GallerySaver）** | Java 深模块 `src/main/.../GallerySaver.java`，双引擎共享：字节获取复用 `PixivImageLoader.loadFile`（缓存优先 + 图床语义不复制），落盘按 API 级别分流（MediaStore / 回退目录）。文件名清洗、ext/mime 推断的唯一实现。 |
| **媒体库两段式（IS_PENDING two-phase）** | API 29+ 的 MediaStore 写入纪律：insert 时 `IS_PENDING=1` → 写字节 → `IS_PENDING=0` 对图库可见；写失败删除 pending 记录（防 0 字节占位残留图库）。 |
| **API 28 回退目录（Fallback dir）** | minSdk 28 段的无权限落盘路径：`getExternalFilesDir(Pictures)/Pictelio/` + `MediaScannerConnection.scanFile` 尽力入库。图库可见性为尽力而为（spec §3 D1 已申报）；不给系统弹 `WRITE_EXTERNAL_STORAGE`。 |
| **保存桥（GallerySaver bridge）** | JS → 原生的薄壳对：webview 侧 `GallerySaverPlugin`（Capacitor `@CapacitorPlugin("GallerySaver")`），lynx 侧 `PictelioGalleryModule`（`NativeModules.PictelioGallery`，Callback 无 null 契约）。契约同形：`{ url, fileName } → { uri }` / `cb(uri, "")`·`cb("", errMsg)`。 |
| **保存文件名（Save file name）** | `Pictelio_<illustId>.<ext>`（单页）/ `Pictelio_<illustId>_p<N>.<ext>`（多页）。**N 为 0-based 页号**，对齐 Pixiv 原始文件 `_p0` 命名。**单一事实源在 JS**（`buildSaveFileName`），Java 侧只做防御性清洗（路径分隔符/控制字符 → `_`，清洗后为空 = 可读失败）。 |
| **保存编排器（`saveIllustPages`）** | 双端同源复制的纯函数编排层（`utils/galleryDownload.ts`）：顺序逐张（1 并发）、单张失败不中断批次、逐张进度回调、失败聚合 + `console.warn` 明细（无静默降级）；`saveOne` 为注入的 IO seam，node 可测。 |
| **原图 URL 列表（`originalPageUrls`）** | 保存恒为原图档（spec A4）：多页取 `meta_pages[].image_urls.original ?? large`，单页取 `meta_single_page.original_image_url ?? large`。与全屏查看器的取图语义同源（app 端路由已改为复用本函数）。 |
| **选页面板（Page picker sheet）** | 多页作品的保存选页弹层（app 端 `PagePickerSheet.tsx` + FluentDialog；lynx 端 `PagePickerSheet.vue` + 底部弹层/CommentOverlay 挂载契约）：打开默认**全选**（批量语义默认值）、全选/清除、确认上抛**升序 0-based 页号数组**。 |
| **作品级批量（Work-level batch）** | 本能力的「批量下载」口径 = **单个多页作品的全部页批量保存**（由选页面板全选承担）。列表级跨作品多选批量**不在范围内**（spec §2，需独立立项）。 |
| **web 保存回退（Web fallback）** | webview 包在浏览器环境的保存路径：代理 URL fetch blob → `<a download>` 点击下载（开发便利，非产品路径）。lynx 的 web-core **无回退**：显式拒绝「当前环境不支持保存到相册」+ warn（无静默）。 |
| **回调引号还原（`unquoteNativeString`）** | Lynx `Callback.invoke(String)` 把字符串参数 JSON 序列化（首尾带引号）——lynx 保存桥的 uri/errMsg 统一经 `tokenStorage.unquoteNativeString` 还原后消费。 |

## 双端对称契约速查

| 能力 | webview 侧（pictelio-app） | lynx 侧（app-lynx） |
|------|---------------------------|---------------------|
| 原生薄壳 | `GallerySaverPlugin`（Capacitor，双 MainActivity 注册） | `PictelioGalleryModule`（`LynxRuntimeInitializer` 全局注册） |
| JS 桥 | `native/GallerySaver.ts`（registerPlugin + web 回退类） | `utils/gallerySaver.ts`（NativeModules 探测，web-core 显式拒绝） |
| 编排器 / 文件名 / 原图列表 | `utils/galleryDownload.ts` | `utils/galleryDownload.ts`（同源复制，同规格测试） |
| 保存入口 | 底部操作条「保存」+ 查看器右上保存当前页 | 详情操作行「↓ 保存」（ugoira 不渲染） |
| 选页面板 | `PagePickerSheet.tsx`（FluentDialog） | `PagePickerSheet.vue`（底部弹层 + modalStack） |
| 进度/结果反馈 | 固定 message-bar（查看器内为按钮内联 ✓/✗） | 操作行下方内联状态文本 |
| 落盘 | GallerySaver（共享，MediaStore ≥29 / 回退目录 28） | 同左 |

## 易混淆概念辨析

- **「保存到相册」≠「图片缓存」**：缓存（`pictelio-images/`）是渲染性能层，键为官方 URL、LRU 淘汰、用户不可管理；保存是用户资产写入（Pictures/Pictelio），用户可在相册/文件管理器中管理。保存优先复用缓存命中（零下载），但落盘目标完全不同。
- **「批量下载」口径**：本能力 = 作品级（一个作品全部页）；不是列表级跨作品多选下载。
- **页号 N**：文件名与选页面板、编排器统一使用 **0-based**（`_p0` = 第 1 页），UI 展示给用户的页码为 **1-based**（`P1` / 第 1 页）。
