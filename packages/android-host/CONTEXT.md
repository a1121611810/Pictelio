# Pictelio android-host 上下文

android-host 是 Android **构建宿主**——Gradle 工程、发布脚本、Lynx 原生模块与测试/E2E 编排都在此包。**它不是客户端**：唯一客户端是 `packages/app-lynx`（自 ADR-0203 起；webview 侧源码已删除，机制判定见 `docs/adr/glossary-webview-client-removal.md`）。本上下文记录宿主边界、目录契约、测试分层、发布链与 JS↔原生桥接面的领域语言；精确语义以 ADR 与源码为准。

## 术语

### 宿主包（host package）
把客户端产物装进 APK 并发布的包。与客户端的唯一边界是 Lynx 原生模块桥（见「桥接面」）；业务逻辑一律在 app-lynx，宿主侧只有出网、存储、系统能力。
_Avoid_: 客户端、app 层（「宿主」不含运行客户端之意）

### 原生模块（Lynx native module）
`android/app/src/lynx/java/` 下注册给 Lynx 引擎的 Java 模块，JS 经 `NativeModules.Pictelio*` 调用。按职责记名：

| 模块 | 职责 |
| --- | --- |
| `LynxActivity` | 入口 Activity；`SplashScreen.installSplashScreen()` 必须在 `super.onCreate()` 之前（ADR-0201） |
| `LynxRuntimeInitializer` / `PictelioAppLynx` | 引擎预热与可用性回退；预热与路由**必须**共用 `EngineRouting.resolve`（ADR-0164） |
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
`android/app/src/main/java/` 下与 Lynx 解耦、可跨形态复用的核心：`PixivApiCore`（OAuth + API 协议）、`SecureStorageCompat`（Keystore + 首启迁移）、`ImageHostConfig` / `PixivImageLoader` / `ImageMemoryCache` / `LruCache`（图片三层缓存的 Java 侧）、`PictelioDownloader`、编码器族（`GifEncoder` / `Mp4Encoder` / `NovelDocxEncoder` / `NovelEpubEncoder` / `NovelPdfEncoder` + `NovelExporter` / `NovelExportModel`）、`BackupCrypto`、`GallerySaver`、`OAuthUtils`、`NetDiagProbe`、`ShareHelper`。
_Avoid_: 把共享核心写进 lynx 侧（目录契约：Lynx 相关进 `lynx/java/`，无关进 `main/java/`）

### 图片代理（/pixiv-img/ proxy）
JS 侧永不直连 `i.pximg.net`：统一走 `/pixiv-img/` 路径，真机上由 `PictelioImageService` 拦截 → `PixivImageLoader` 经 `ImageHostConfig` 出网；缓存三层（内存 `LruCache` / 内存盘 `ImageMemoryCache` / Java 磁盘），细节演进史见 ADR-0090。
_Avoid_: `shouldInterceptRequest`（WebView 时代的拦截机制，已随 ADR-0203 删除，不是现行机制）

### 存量存储格式（persisted legacy format）
`capacitor-storage_*` / `CapacitorStorage` 是历史用户数据格式：**一字不改**（ADR-0050）。首启由 `SecureStorageCompat` 迁移进 Keystore 体系。

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

ADR-0050（存量格式）· ADR-0090（图片三层缓存）· ADR-0142（git 引用校验）· ADR-0163（转换矩阵门）· ADR-0164（引擎决策）· ADR-0201（SplashScreen）· ADR-0203（宿主迁移）
