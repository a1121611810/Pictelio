# Pictelio android-host 术语表

android-host 是 Android **构建宿主**——Gradle 工程、发布脚本、Lynx 原生模块与测试/E2E 编排都在此包。**它不是客户端**：唯一客户端是 `packages/app-lynx`（自 ADR-0203 起；webview 侧源码已删除，机制判定见 `docs/adr/glossary-webview-client-removal.md`）。本上下文记录宿主边界、目录契约、测试分层、发布链与 JS↔原生桥接面的领域语言；精确语义以 ADR 与源码为准。（本文件原名 `CONTEXT.md`，**2026-10-20** 改名以对齐上游 `mattpocock/skills` 的领域文档约定，见 ADR-0224；词汇内容未改。）

## 术语

### 宿主包（host package）
把客户端产物装进 APK 并发布的包。与客户端的唯一边界是 Lynx 原生模块桥（见「桥接面」）；业务逻辑一律在 app-lynx，宿主侧只有出网、存储、系统能力。
_Avoid_: 客户端、app 层（「宿主」不含运行客户端之意）

### 原生模块（Lynx native module）
`android/app/src/lynx/java/` 下注册给 Lynx 引擎的 Java 模块，JS 经 `NativeModules.Pictelio*` 调用。按职责记名：

| 模块 | 职责 |
| --- | --- |
| `LynxActivity` | 入口 Activity；`SplashScreen.installSplashScreen()` 必须在 `super.onCreate()` 之前（ADR-0201） |
| `LynxRuntimeInitializer` / `PictelioAppLynx` | Lynx runtime 初始化单点与 Application 入口：`ensureInitialized` 幂等，`PictelioAppLynx.onCreate` 与 `LynxActivity` 进程复用兜底共用；单引擎下无引擎探测/回退决策（`EngineRouting` 随 #610、`isAvailable()` 随 #1043 删除） |
| `PictelioApiModule` | Pixiv API 出网唯一通道 → `PixivApiCore`（401 自动刷新 + 防死循环） |
| `PictelioImageService` | `/pixiv-img/` 图片代理服务（见「图片代理」） |
| `PictelioSecureStorageModule` | refresh_token 存取 → `SecureStorageCompat`（Keystore） |
| `PictelioDownloaderModule` / `PictelioGalleryModule` | 下载与落相册（→ `PictelioDownloader` / `GallerySaver`） |
| `PictelioTranslateModule` / `PictelioTranslateCacheModule` | 翻译端点与缓存 |
| `PictelioNotificationModule` / `NotificationTapActivity` | 通知发布与点按回跳（触达探测链路，ADR-0220） |
| `PictelioWebDavModule` | WebDAV 备份桥 |
| `PictelioAuthModule` / `PictelioClipboardModule` / `PictelioShareModule` / `PictelioPrefsModule` | 登录态辅助 / 剪贴板 / 分享 / 偏好 |
| `NetDiagModule` | 网络自检桥（→ `NetDiagProbe`，`/network-check` 页消费） |
| `UgoiraStreamEngine` | 动图流播放 |
| `PictelioTemplateProvider` | 错误页等模板供给 |

### 共享核心（shared core）
`android/app/src/main/java/` 下与 Lynx 解耦、可跨形态复用的核心：`PixivApiCore`（OAuth + API 协议）、`SecureStorageCompat`（Keystore + 首启迁移）、`ImageHostConfig` / `PixivImageLoader` / `ImageMemoryCache` / `LruCache`（图片**两层缓存**的 Java 侧；`LruCache` 是 `ImageMemoryCache` 的内部容器，**与它同属内存层**、不另算一层）、`PictelioDownloader`、编码器族（`GifEncoder` / `Mp4Encoder` / `NovelDocxEncoder` / `NovelEpubEncoder` / `NovelPdfEncoder` + `NovelExporter` / `NovelExportModel`）、`BackupCrypto`、`GallerySaver`、`OAuthUtils`、`NetDiagProbe`、`ShareHelper`。
_Avoid_: 把共享核心写进 lynx 侧（目录契约：Lynx 相关进 `lynx/java/`，无关进 `main/java/`）

### 图片代理（/pixiv-img/ proxy）
JS 侧永不直连 `i.pximg.net`：统一走 `/pixiv-img/` 路径，真机上由 `PictelioImageService` 拦截 → `PixivImageLoader` 经 `ImageHostConfig` 出网；缓存**两层**（内存层 `ImageMemoryCache` / 磁盘层 `PixivImageLoader` 的 `getCacheDir()`），按「是否需要一次 IO 才能拿到数据」划分；现行编号见 ADR-0222。⚠️ **ADR-0090 标题里的「三层」（磁盘 / 浏览器缓存头 / JS 预取）是历史编号**，其中浏览器缓存头层随 ADR-0203 整体删除、在 Lynx 下已无载体，**不得**当作现行层数。
_Avoid_: 把 `LruCache`（容器）与 `ImageMemoryCache`（容器的使用者）各算作一层；照搬 ADR-0090 的「三层」；用 `shouldInterceptRequest`（WebView 时代的拦截机制，已随 ADR-0203 删除，不是现行机制）

### 存量存储格式（persisted legacy format）
`capacitor-storage_*` / `CapacitorStorage` 是历史用户数据格式：**一字不改**（ADR-0050）。首启由 `SecureStorageCompat` 迁移进 Keystore 体系。

### 运行时 UI 树观测通道（runtime UI tree dump）
**第三条观测通道**：绕开「a11y 树不暴露节点」与「`uiautomator dump` 被 SIGKILL」两条既有死路，直接从引擎拿运行时 UI 节点树。宿主侧承载类是 `UiTreeDump`（`src/lynx/java/io/pictelio/app/`），诊断脚本是 `scripts/dump-ui-tree.mjs`，纯逻辑在 `scripts/lib/ui-tree-dump-core.mjs`，**e2e 消费侧**共享模块是 `tests/android-e2e/ui-tree.ts`（触发 → 等落齐 → `adb pull` → 解析 → 按 class / 文本定位；#1047），其**两道 CI 内单测**是 `tests/android-e2e/unit/ui-tree.test.ts`（纯查询层）与 `tests/android-e2e/unit/ui-tree.io.test.ts`（设备侧 IO 边界的成功/失败双路径）。
- **触发**：intent extra `uiTreeDump=1`（非空串即触发）；两个采样点——冷启动 `onLoadSuccess`（`cold`）、热启动 `onNewIntent`（`hot`）；一次触发**连拍三档**（0 / 1500 / 4000ms）。
- **产物**：应用专属外部目录 `ui-tree/`，文件名 `ui-tree-<采样点>-<档位>ms-<序号>-<时间戳>.json`，引擎原始 JSON **不加工**落盘（摘要由脚本现算）。
- **门禁**：`BuildConfig.DEBUG` 作为**判定函数的入参**（非埋在分支里）⇒ release 变体下为恒 false 死代码、被 R8 移除。
- **能力边界**：**拿不到源码位置**——官方 UI source map 的构建期打标（`enableUiSourceMap`）是 React-only，vue-lynx 侧无 producer（ADR-0223 §2.1）。**「拿不到源码位置」≠「拿不到组件身份」**：树里带 Tailwind `class` / 语义 `id` / `accessibility-label` / `vue-ref` / 事件 / 两套坐标系。⚠️ 组件身份是**反推**出来的（靠 `class` / 语义 `id` 人工推断）——**树里没有组件名 / 文件名字段**，别写成「直接看出是哪个组件」。
- **跨端协议**：触发键、目录名、产物名前后缀、采样档位、采样点标识**同时存在于 Java 与 Node 两侧且无共享代码** ⇒ 由 `UiTreeDumpProtocolContractTest` 做逐字比对（含行为面）。
_Avoid_: 「UI source map / 源码反解」（Vue 侧无 producer，判死）·「树能给出颜色 / 圆角 / alpha」（树只给**布局盒与结构**，颜色类量一律留像素）· 把本通道说成「能定位到源码行」

### 测试分层
- `tests/unit/`（vitest，随 CI `test:all`）：契约测试（`agentsMd.contract` / `webviewRemovalInvariants` / `e2eContractSuiteCollected`）+ `scripts/` 发布链与 git 校验测试。
- `android/app/src/test/`（JVM + Robolectric，随 CI）：`PixivApiCore` / 存储 / 下载 / 翻译事件契约等 Java 单测。
- `tests/android-e2e/`（12 spec，**手动发布门，不进 CI**，ADR-0084）：`transition-matrix.spec.ts` 是发版前的转换矩阵门（ADR-0163）；失败截图落 `evidence/`。
_Avoid_: 「E2E 进 CI」（防线职责划分见 `docs/testing/conventions.md`）

### 发布链（release chain）
版本单源 = `packages/app-lynx/package.json` → `scripts/sync-android-version.mjs` 回写 Gradle → `sync-credentials.mjs`（凭据注入）→ rspeedy 生产构建 → `sync-android-assets.mjs` → `gradlew assembleRelease`（签名环境变量见 `docs/release-signing.md`）。发布前校验：`release-preflight` / `release-branch` / `release-build-steps` 单测 + pre-push 三域校验（`scripts/check-push-refs.mjs`，分叉报错文案见 ADR-0142）。

## 桥接面（JS ↔ 原生）

- **出网**：JS 一律经 `PictelioApiModule` → `PixivApiCore`；401 自动刷新 + 防死循环在 Java 侧闭环。
- **安全**：refresh_token 走 Keystore、不出 Java 堆；access_token Java 堆隔离。
- **时序**：safe area 等首帧值是 subscribe-then-pull（首次分发早于 JS 订阅，纯推丢首帧；实现见 `packages/app-lynx/src/utils/safeArea.ts`，原理同 app-lynx 侧注释）。

## 相关 ADR

ADR-0050（存量格式）· ADR-0090（图片缓存·**历史编号**，现行层数见 0222）· ADR-0142（git 引用校验）· ADR-0163（转换矩阵门）· ADR-0164（引擎决策）· ADR-0201（SplashScreen）· ADR-0203（宿主迁移）· ADR-0222（图片缓存重设计决策与两层词汇基线）· ADR-0223（运行时 UI 树观测通道）
