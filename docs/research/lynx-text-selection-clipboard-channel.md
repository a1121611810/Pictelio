# Lynx 小说正文「长按选中 + 自绘菜单」前置研究：剪贴板通道 与 搜索跳转通道

- 日期：2026-09-17
- 范围：`packages/app-lynx`（Lynx 客户端，引擎 `org.lynxsdk.lynx:lynx:4.0.1`）+ `packages/app/android`（flavor `lynx`）
- 类型：研究票（只读；不改动任何现有源码）

## 结论（先说结论）

**Lynx 4.0.1（Android）没有任何 JS 可达的剪贴板 API——不在官方文档、不在引擎仓库、不在 SDK jar/so、不在 `@lynx-js/*` 本地包，web-core 0.23.1 也没有**。今天唯一的「复制」是引擎侧的 Android 原生文本选择 ActionMode 菜单项（`AndroidText.performCopy()` → `ClipboardManager.setPrimaryClip`），**只能由用户点系统菜单触发，JS 无法调用、无法复用**。因此「复制」动作必须新增一个 Java 侧 Native Module 薄壳（`@LynxMethod` + `ClipboardManager`），本仓库已有 4 个同构先例（Share / Gallery / Downloader / WebDav），且**只需在 `LynxRuntimeInitializer` 的全局 `registerModule` 列表登记一处**（`LynxActivity` 的 per-view 列表是历史子集，全局注册优先）。好消息是「选中」这一半是引擎自带的：`<text>` 支持 `text-selection` / `custom-context-menu` / `custom-text-selection` 三个属性、`selectionchange` 事件（`bindselectionchange`）、以及 `getSelectedText` / `setTextSelection` 两个 SelectorQuery UI 方法（`UI.invoke`），JS 侧完全够用——缺的只有「写剪贴板」这一个动作。**「搜索选中词」不需要任何新通道**：app-lynx 的搜索是全局弹层（无 `/search` 路由），`useSearchSheetStore().openSearch(keyword)` 已内置预填+自动搜索语义（ADR-0133 决策 2/5，标签点击已在用），选中词直接喂进去即可。

---

## Q1 — Lynx（4.0.1, Android）是否自带 JS 可达的剪贴板 API？

**答案：没有。** 四条独立证据链全部为负，且给出了「唯一的复制路径」的精确位置。

### 1.1 官方文档（lynxjs.org）：`lynx.*` 命名空间无剪贴板 API

- `https://lynxjs.org/api/index.html`（API 总索引）：lynx.* 命名空间列出的条目为 `accessibilityAnnounce / addFont / animate / cancelAnimationFrame / cancelResourcePrefetch / createIntersectionObserver / createSelectorQuery / getElementById / getJSModule / sessionStorage(get/set/subscribe/unsubscribe) / getTextInfo / GlobalProps / performance / queueMicrotask / registerModule / reload / reportError / requestAnimationFrame / resource prefetch(requireModule/requireModuleAsync) / exposure(resume/stop) / setObserverFrameRate`——**无 clipboard / setClipboard / getClipboard**。
- `https://lynxjs.org/api/lynx-api/lynx`（lynx.* 主页面）逐条核对：**无任何剪贴板条目**，也**无 `getSelectedText`**（唯一的文本相关 API 是 `getTextInfo()` 排版度量）。
- `https://lynxjs.org/llms-full.txt`（站点全文语料）grep `clipboard|setClipboard|getClipboard`：**0 命中**。
- 但 `https://lynxjs.org/api/elements/built-in/text` 里 <text> 的选择能力是**文档化的**（见 Q1.4），这与「没有剪贴板 API」并不矛盾：Lynx 给的是「选中/读取选中」，没给「写入剪贴板」。

### 1.2 引擎源码（github.com/lynx-family/lynx）：无剪贴板模块

- `gh search code "clipboard" -R lynx-family/lynx`：命中的 `SetClipboardData` / `clipboard` 全部在 **`clay/`** 目录（Clay 是另一套跨端引擎实现，Windows/macOS/headless/embedder 渲染层）与 `platform/embedder/**`（windowless renderer 的 C API）。**Android 平台侧（`platform/android/**`）唯一命中是 `ILynxSystemInvokeService`**，其 javadoc 为 "Sets the current primary clip on the clipboard. see android.content.ClipboardManager.setPrimaryClip(ClipData) for details"（`platform/android/lynx_android/src/main/java/com/lynx/tasm/service/ILynxSystemInvokeService.java`）——这是一个**由宿主 App 实现的 service 接口**，不是 JS API，也不是引擎自带实现。
- `gh search code "LynxClipboard"` / `"ClipboardModule"`：**lynx-family/lynx 内 0 命中**（唯一 `LynxClipboardModule` 命中来自无关第三方仓库 `ravvi-kumar/lynx-notification`）。
- 上游 `platform/android/lynx_android/src/main/java/com/lynx/tasm/behavior/ui/text/AndroidText.java`（本地已落盘核对，共 1239 行）——**唯一的复制实现，且是私有的**：

  | 行号 | 内容 |
  |------|------|
  | `AndroidText.java:54` | `protected static final String SELECTION_CHANGE_EVENT = "selectionchange";` |
  | `:232` | `public void setEnableTextSelection(boolean enable)` |
  | `:477` | `public void setBindSelectionChange(boolean, int sign)` |
  | `:492` | `public void setCustomContextMenu(boolean enable)` |
  | `:496` | `public void setCustomTextSelection(boolean enable)` |
  | `:510` | `public ArrayList<RectF> setTextSelection(float startX, float startY, float endX, float endY, boolean showStartHandle, boolean showEndHandle)` |
  | `:609-619` | `public String getSelectedText()`（优先 TextService，回退 `mTextLayout` 子串） |
  | `:1127-1140` | `private void performCopy()` → `copyToClipboard(selectedText)` |
  | `:1142-1165` | `private void copyToClipboard(CharSequence)`：`ClipData.newPlainText("Lynx-clipboard", text)` → `ILynxSystemInvokeService.setPrimaryClip()`；**服务未注册（本仓库即如此）则回退 `ClipboardManager.setPrimaryClip()`** |
  | `:1213-1219` | `onCreateActionMode()` 仅 `menu.add(ID_COPY)` + `menu.add(ID_SELECT_ALL)`（系统 ActionMode） |
  | `:1227-1236` | `onActionItemClicked()`：`ID_COPY → performCopy()` |
  | `:859-863` | `showToolbar()`：`if (mEnableCustomContextMenu || !hasTextSelectionContent()) return;`（`custom-context-menu=true` 时**不弹系统菜单**，交给 JS 自绘）；对应 `hideToolbar()` 在 `:870-877` |

- 上游 `.../behavior/ui/text/UIText.java`（542 行）——JS 侧可见面（属性 / UI 方法）：
  - `:256` `@LynxProp(name = "text-selection", defaultBoolean = false)` → `setEnableTextSelection`
  - `:273` `@LynxProp(name = "custom-context-menu", defaultBoolean = false)` → `setCustomContextMenu`
  - `:278` `@LynxProp(name = "custom-text-selection", defaultBoolean = false)` → `setCustomTextSelection`
  - `:283 / :288 / :293` `selection-background-color` / `selection-handle-color` / `selection-handle-size`
  - `:342` `@LynxUIMethod getTextBoundingRect`、`:381` `@LynxUIMethod setTextSelection`、**`:417-427` `@LynxUIMethod getSelectedText` → 回调 `{selectedText: string}`**（即 JS 可通过 `SelectorQuery.select(...).invoke({method:'getSelectedText'})` 拿到选中文本）

### 1.3 本地 SDK 产物（本仓库实际链接的 4.0.1）

- 版本钉死：`packages/app/android/app/build.gradle:240` `lynxImplementation "org.lynxsdk.lynx:lynx:4.0.1"`（`:246/:252` 为 service-http / xelement，`:260-264` 为 full flavor 并集）。
- Gradle 缓存 jar 逐条 unzip 检查（`~/.gradle/caches/9.6.1/transforms/*/transformed/lynx-4.0.1-runtime.jar`，含 `lynx-base` / `lynx-jssdk`）：
  - **无任何 `Clipboard*` 类**；`com/lynx/jsbridge/` 下模块类清单为 `LynxAccessibilityModule / LynxEmbeddedModule / LynxExposureModule / LynxExtensionModule / LynxFetchModule / LynxIntersectionObserverModule / LynxResourceModule / LynxSetModule / LynxTextInfoModule / LynxUIMethodModule`——**没有剪贴板模块**。
  - 全 jar 内含 "Clipboard"/"clipboard" 字面量的类只有两个：`com/lynx/tasm/behavior/ui/text/AndroidText.class` 与 `com/lynx/tasm/service/ILynxSystemInvokeService.class`（后者只有 `void setPrimaryClip(android.content.ClipData)` 声明）。
  - `javap -c AndroidText.copyToClipboard` 反编译可见：`ClipData.newPlainText("Lynx-clipboard", …)` → `LynxServiceCenter.inst().getService(ILynxSystemInvokeService.class)` → `setPrimaryClip`；服务为 null 时 `Context.getSystemService(ClipboardManager.class)`（SDK_INT ≥ 23）并 `setPrimaryClip`。
- **Native 库字符串扫描（最强证据）**：`lynx-4.0.1.aar` → `jni/arm64-v8a/liblynx.so`（6.35 MB）全量可打印串扫描：
  - `clipboard`（大小写不敏感）：**0 命中**（`SetClipboard` / `getClipboard` / `LynxClipboard` 同样 0）。
  - `text-selection`：命中 1 处（属性名）。
  - `navigator`：**仅 1 处**，出现在运行时 prelude 的形参表里：
    `(function(require, module, exports, setTimeout, setInterval, clearInterval, clearTimeout, NativeModules, console, nativeAppId, LynxJSBI, lynx, requestAnimationFrame, cancelAnimationFrame, fetch, window, document, frames, self, location, navigator, localStorage, history, Caches, screen, alert, confirm, prompt, XMLHttpRequest, WebSocket, webkit, Reporter, print, global){ ... })`
    ——即 `navigator` 只是原生注入的一个全局**名字**，而二进制里**不存在任何剪贴板实现字符串**。
  - 同一 aar 内的 `xelement` / `xelement-input`（`xelement-4.0.1.aar` / `xelement-input-4.0.1.aar`，classes.jar 解包扫描）也 **0 处 clipboard**。
- 本仓库**没有注册 `ILynxSystemInvokeService`**（`grep -rn "ILynxSystemInvokeService" packages/app/android/**/*.java` 无命中；`LynxRuntimeInitializer.java:67-69` 只注册 `LynxHttpService` / `LynxLogService` / `PictelioImageService`），所以系统 ActionMode 的 COPY 走的是 SDK 的 `ClipboardManager` 回退分支——**功能可用，但仍然是引擎侧私有实现**。

### 1.4 「唯一的复制路径」判定

- **是。** 今天能在 Lynx 客户端里把文本写进系统剪贴板的路径只有一条：用户长按 → 引擎 `AndroidText` 弹系统 ActionMode → 用户点「复制」→ `performCopy()`（`AndroidText.java:1127`）。这是**引擎侧原生行为**，`performCopy` / `copyToClipboard` 都是 `private`，`onActionItemClicked` 只在系统菜单点击时被调用，**JS 无法程序化触发**（无 JS API、无 UI 方法、无事件）。
- 对比：**「读选中」是 JS 可达的**（`getSelectedText` UI 方法，`UIText.java:417`）+ **「选中变化」是 JS 可监听的**（`selectionchange` / `bindselectionchange`，`UIText.java:123/171`，`AndroidText.java:54/477/482`）+ **「自绘菜单」是引擎支持的**（`custom-context-menu=true` 时 `showToolbar()` 早退不弹系统菜单，`AndroidText.java:860`）。所以自绘菜单方案的缺口**只有「写剪贴板」一个动作**。
- 顺带：webview 客户端不受影响——它的 `<input>` / 正文是 DOM/WebView，`packages/app/src/routes/NetworkCheck.tsx:84` 已在用 `navigator.clipboard.writeText(...)`。

### 1.5 JS 侧本地包 / web-core 检查

- `packages/app-lynx/node_modules/@lynx-js/` 只有三个包：`rspeedy`、`tailwind-preset`、`web-core`（0.23.1）。**`@lynx-js/types` 未安装**（类型靠 `src/rspeedy-env.d.ts` 手写声明）。
- 对整个 `packages/app-lynx/node_modules/`（含依赖树）grep `-i clipboard`（*.js/mjs/cjs/ts/json/d.ts）：**0 命中**。
- `@lynx-js/web-core@0.23.1`（`node_modules/@lynx-js/web-core/package.json` 版本字段）：
  - `dist/` 全量 grep `clipboard`：**0 命中**。
  - 架构证据：应用逻辑跑在 **真正的 Web Worker** 里——`dist/client/mainthread/Background.js:18-19` `function createWebWorker() { return new Worker(...) }`（同文件 15 处 `Worker` 引用，`contextIdToBackgroundWorker` 池化）；另有 `createIFrameRealm.js`（iframe realm 承载主线程侧）。
- 因此 **`navigator.clipboard` 在 web-core 预览里不可用**（Clipboard API 不下发到 Worker，且需 secure context + transient user activation，见 MDN `api.Clipboard` / `api.Clipboard.writeText`：**"Secure context: This feature is available only in secure contexts"**、"Writing to the clipboard can only be done in a secure context"）。
- 原生 LynxView 运行时同理不可依赖：`navigator` 只是 prelude 的注入名（见 Q1.3），二进制无剪贴板实现；仓库自身也已记录该不确定性——`packages/app-lynx/src/i18n/index.ts:16-22` 注释「**LynxView 原生模式下 navigator 可能不存在**（node/worker 环境同）」并用 try/catch 兜底。
- 现有唯一调用点的真实行为（用户描述属实）：`packages/app-lynx/src/pages/NetworkCheck.vue:57-68`
  ```ts
  async function copyReport() {
    if (!input.value) return
    try {
      const nav = globalThis.navigator as
        | { clipboard?: { writeText?: (t: string) => Promise<void> } }
        | undefined
      await nav?.clipboard?.writeText?.(formatReport(input.value))   // 全可选链 → 不存在即静默 no-op
      copied.value = true
    } catch (e) { console.warn('[network-check] 复制失败:', e) }
  }
  ```
  注意：`copied.value = true` 在 no-op 分支**也会置位**（假成功提示）——本次调研顺带发现的既有缺陷，属既有代码，不在本票修改范围。

---

## Q2 — 若要新增剪贴板能力，最小改动面

### 2.1 模块注册：**只需全局一处**（`LynxRuntimeInitializer`）

- 全局列表：`packages/app/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java:73-82`（10 个）：

  ```
  73: registerModule("PictelioSecureStorage", PictelioSecureStorageModule.class)
  74: registerModule("PictelioApp", PictelioAppModule.class)
  75: registerModule("PictelioAuth", PictelioAuthModule.class)
  76: registerModule("PictelioApi", PictelioApiModule.class)
  77: registerModule("PictelioPrefs", PictelioPrefsModule.class)
  78: registerModule("PictelioGallery", PictelioGalleryModule.class)
  79: registerModule("PictelioDownloader", PictelioDownloaderModule.class)
  80: registerModule("PictelioShare", PictelioShareModule.class)
  81: registerModule("NetDiag", NetDiagModule.class)
  82: registerModule("PictelioWebDav", PictelioWebDavModule.class)
  ```

- per-view 列表：`LynxActivity.java:117-128`（**6 个**，`:121` 注释「per-view 注册（与 PictelioApp 全局注册并存；LynxEnv 全局优先）」）：

  ```
  122: PictelioSecureStorage  123: PictelioApp  124: PictelioAuth
  125: PictelioApi  126: PictelioPrefs  127: NetDiag
  ```

- **新模块不必两处都加**，证据：
  1. `PictelioGallery` / `PictelioDownloader` / `PictelioShare` / `PictelioWebDav` **只出现在全局列表**，`LynxActivity` 的 per-view 列表里没有——但它们在生产可用：`git show --stat ea49e205`（`feat(android): 新增下载器、ugoira 多格式导出与分享原生模块`）显示该 commit 只改了 `LynxRuntimeInitializer.java`（+2 行）与 `full/java/.../MainActivity.java`（+2 行），**未触碰 `LynxActivity.java`**。
  2. 端到端实证：`packages/app/tests/android-e2e/specs/webdav-backup-lynx.spec.ts:1-20` 在模拟器上跑通 `LynxActivity → runStartupAutoBackup → PictelioWebDavModule → OkHttp → 真实 WebDAV`，其 oracle 为「服务器快照 engine 字段 = "lynx" + 真实 appVersion」——`PictelioWebDavModule` 正是只在全局列表登记的模块。
- 结论：**新增 `PictelioClipboard` 只需在 `LynxRuntimeInitializer.java` 的 `:73-82` 列表追加一行**；若为一致性也补 `LynxActivity.java:122-127`（可选，非必需，且会引入「两份列表持续漂移」的维护负担）。

### 2.2 方法形状（两种并存约定，推荐「值+错误串」型）

- 模板 A（`PictelioShareModule.java:21-47`，lynx flavor）：

  ```java
  public class PictelioShareModule extends LynxModule {
    private static final String TAG = "PictelioShareModule";
    public PictelioShareModule(Context context) { super(context); }

    @LynxMethod
    public void share(String urisJson, String mime, Callback callback) {
      final Context app = ((LynxContext) mContext).getContext();
      try {
        ... ; app.startActivity(chooser);
        callback.invoke("1", "");                     // 成功：占位值 + 空错误串
      } catch (Throwable e) {
        Log.w(TAG, "share 失败", e);
        callback.invoke("", e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
      }
    }
  }
  ```

- 模板 B（`PictelioGalleryModule.java:61-80`，同族但契约更明确）：

  ```java
  @LynxMethod
  public void saveImage(String url, String fileName, Callback callback) {
    if (url == null || url.isEmpty() || ...) { callback.invoke("", "url 和 fileName 不能为空"); return; }
    final Context appContext = appContext();
    SAVE_EXECUTOR.execute(() -> {                       // 阻塞 IO 出调用线程
      try { ...; callback.invoke(r.uri.toString(), ""); }
      catch (Throwable e) { callback.invoke("", msg); }
    });
  }
  ```

  同文件 `:21-23` 有**必须遵守的硬约束注释**：「回调契约（Callback.invoke；**无 null——真机 CallbackImpl 对 null 崩溃**）」。

- 模板 C（对照，`PictelioAppModule.java:74-94 / 96-112`）：**另一套**约定——成功 `callback.invoke()`（无参）、失败 `callback.invoke(String.valueOf(e.getMessage()))`（单参错误串）。两套约定在仓库内并存，但 `CallbackImpl` 对 null 敏感（B 注释）→ **新模块建议采用 A/B 的「值 + 错误串」双参约定**，并在 JSDoc 与 `*.d.ts` 处写明。
- 注解与基类：`com.lynx.jsbridge.LynxMethod`（`javap` 证实是**无成员的空注解**，即**没有 uiThread 之类的线程开关**）、`com.lynx.jsbridge.LynxModule`（`mContext` 字段 + `setExtraData/destroy`）、回调类型 `com.lynx.react.bridge.Callback`（`invoke(Object...)`，一次性）、上下文转换 `((LynxContext) mContext).getContext()`（取 Application/Activity 级 Context）。

### 2.3 TS 侧：新模块如何被类型化与访问

- `packages/app-lynx/src/rspeedy-env.d.ts:81-124` 是 `NativeModules` 的唯一声明点，当前覆盖 `PictelioSecureStorage / PictelioApp / PictelioAuth / PictelioApi / PictelioPrefs / PictelioGallery`（`:121-123`），**不含 `PictelioShare` / `PictelioDownloader`**。
- `packages/app-lynx/src/api/client.ts:206-218` 的 `getNativeModules()` 返回类型把这些模块列为 `unknown`（`:207-214`，含 `PictelioShare?: unknown`、`PictelioDownloader?: unknown`），实现为「裸 `NativeModules` ?? `globalThis.NativeModules`」双通道（`:216-217`）；原生判定见 `:197-203 isNativeMode()`。
- **既有先例（新模块可直接照抄）**：模块**不写进 d.ts**，而是在使用处**自带本地 interface + 断言 + 缺失时 `console.warn`**：
  - `packages/app-lynx/src/utils/downloadSharer.ts:4-11`
    ```ts
    const mod = getNativeModules()?.PictelioShare as LynxShareNative | undefined
    if (mod) setDownloadSharer(createLynxSharer(mod))
    else console.warn('[downloadSharer] 无原生 PictelioShare（web-core 预览不支持系统分享）')
    ```
  - 接口声明在纯注入工厂里：`utils/lynxShare.ts:5-7`
    ```ts
    export interface LynxShareNative { share(urisJson: string, mime: string, cb: (ok: string, err: string) => void): void }
    ```
  - 同构：`utils/downloadExecutor.ts:7-12` + `utils/lynxDownloadExecutor.ts:7-20`（拉模式进度 + `unquoteNativeString` 解析错误串）。
- 即：**最小 TS 面 = 一个 `utils/lynxClipboard.ts` 纯注入工厂（接口 + 可测逻辑）+ 一个接线文件（缺失即 warn）**；是否补进 `rspeedy-env.d.ts` 与 `getNativeModules()` 的 `unknown` 清单，是风格选择而非必需（PictelioShare 的既有先例就是不补）。

### 2.4 Android 侧具体实现要点

- **写系统剪贴板的 API**（Android 官方文档，`developer.android.com/develop/ui/views/touch-and-input/copy-paste`）：
  `ClipboardManager cm = getSystemService(Context.CLIPBOARD_SERVICE)`（或 API 23+ 的 `getSystemService(ClipboardManager.class)`）→ `ClipData clip = ClipData.newPlainText(label, text)` → `cm.setPrimaryClip(clip)`。**文档未规定线程要求**（原文无主线程约束、无 Looper 说明）。SDK 自己在 `AndroidText.java:1157-1160` 就是「≥ M 用 class 版、否则用字符串常量版」。
- **API 级别约束**：本仓库 `packages/app/android/variables.gradle:2-4` → `minSdkVersion = 28`、`compileSdkVersion = 36`、`targetSdkVersion = 36`。minSdk 28 > 23，class 版 `getSystemService` 恒可用；compileSdk 36 ≥ 33，`ClipDescription.EXTRA_IS_SENSITIVE` 常量可直接引用（无需字符串字面量回退）。
- **Android 13+ 系统剪贴板预览**（同上文档）：「Starting in Android 13, the system displays a standard visual confirmation when content is added to the clipboard」（自动，无需 App 做任何声明）；并明确「To avoid duplicate displays of information, we strongly recommend removing toasts or snackbars shown after an in-app copy for Android 13 and higher」→ **自绘菜单的「复制」成功后不应再弹自研 toast**（API ≤ 32 才需要）。若要**抑制预览**（选中词可能含敏感内容时）：在 `setPrimaryClip` 前给 `ClipData.getDescription().setExtras(PersistableBundle)` 放 `ClipDescription.EXTRA_IS_SENSITIVE=true`。
- **无需任何 manifest 声明/权限**：Android 不存在剪贴板权限；本仓库 `packages/app/android/app/src/main/AndroidManifest.xml:62-64` 只有 `INTERNET` / `ACCESS_NETWORK_STATE`，且官方文档本页未提出任何 manifest/manifest-placeholder 要求。
- **放哪个 source set**（`packages/app/android/app/build.gradle:54-69`）：`lynx` flavor 含 `src/lynx/java`，`webview` flavor 含 `src/webview/java`，`full` = 两者 + `src/full/java`；`src/main/java` 全 flavor 共享。既有分布印证（同一能力、两份薄壳、一份深模块）：
  - `main/java/io/pictelio/app/ShareHelper.java`（共享逻辑）+ `lynx/.../PictelioShareModule.java` + `webview/.../PictelioSharePlugin.java`（`:21` `@CapacitorPlugin` + `:25` `@PluginMethod share`）；
  - 同构：`GallerySaver.java`(main) + `PictelioGalleryModule.java`(lynx) + `GallerySaverPlugin.java`(webview)。
  - 因此：**lynx 薄壳放 `src/lynx/java`（同时被 lynx/full 两个 flavor 编入）；纯逻辑（若有，例如 ClipData 组装）放 `src/main/java` 可测**。webview 侧**不需要新增对应物**（WebView 客户端的复制走浏览器/`navigator.clipboard`，见 Q1.4 末段）。
- **线程约束**（仓库既有约定，非 SDK 强制）：
  - `@LynxMethod` 是空注解，无 uiThread 开关（`javap` 已证）。
  - 仓库注释反复警示调用线程不可阻塞：`PictelioGalleryModule.java:29-30`「保存为阻塞 IO（下载 + 写媒体库，原图可达数十 MB），**不能占用 Lynx 调用线程**」+ `SAVE_EXECUTOR`；`PictelioAppModule.java:42`、`PictelioApiModule.java:54/65`、`PictelioWebDavModule.java:35`、`NetDiagModule.java:21` 同款措辞。SDK 侧对应实体是 `com.lynx.tasm.LynxBackgroundRuntime` / `DefaultLogicExecutor`（jar 中存在）。
  - 写剪贴板是**内存级瞬时操作**（与 `PictelioShareModule.share` 内联 `startActivity` 同级），**无需线程池**；只有把「读大文本/写盘」之类并入同一模块时才需要 `ExecutorService`（既有模块的一贯做法是模块内自建线程池，不使用共享池）。

### 2.5 「复制」最小骨架（供 spec/ticket 直接引用）

```java
// packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioClipboardModule.java（新建）
public class PictelioClipboardModule extends LynxModule {
  private static final String TAG = "PictelioClipboardModule";
  public PictelioClipboardModule(Context context) { super(context); }

  @LynxMethod
  public void setText(String text, Callback callback) {
    try {
      Context app = ((LynxContext) mContext).getContext();
      if (text == null) { callback.invoke("", "text 不能为空"); return; }
      ClipData clip = ClipData.newPlainText("Pictelio", text);
      ClipboardManager cm = (ClipboardManager) app.getSystemService(Context.CLIPBOARD_SERVICE);
      cm.setPrimaryClip(clip);
      callback.invoke("1", "");            // 与 PictelioGallery/Share 同族；禁止传 null
    } catch (Throwable e) {
      Log.w(TAG, "setText 失败", e);
      callback.invoke("", e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
    }
  }
}
```
+ `LynxRuntimeInitializer.java:82` 之后一行 `registerModule("PictelioClipboard", PictelioClipboardModule.class)`。
+ TS：`utils/lynxClipboard.ts`（接口 `setText(text: string, cb: (ok: string, err: string) => void): void`）+ 接线处缺失时 `console.warn`（照抄 `utils/downloadSharer.ts:4-11`）。

---

## Q3 —「搜索选中词」的搜索跳转通道

### 3.1 现状：**没有搜索路由，搜索是全局弹层 + store 单例**

- 路由表 `packages/app-lynx/src/router.ts:68-91` 共 17 条，**没有 `/search`**（有 `/illusts`、`/novels`、`/ranking`、`/downloads`、`/network-check`、`/platform-check` 等）；历史为 `createMemoryHistory`（`router.ts:93-96`，`history: createMemoryHistory()` 在 `:94`），无 URL/deep-link 通道。
- 弹层单例：`App.vue:76` 全 App 只挂一份 `<SearchSheet v-if="searchSheet.isOpen" />`（`App.vue:6/9/18` import + store 接线）。
- 状态与入口 API：`stores/searchSheetStore.ts`
  - `:15-17` `useSearchSheetStore = defineStore("searchSheet", …)`，内部 `_isOpen` / `_prefillKeyword`
  - `:23-30` **`openSearch(initialKeyword?: string)`**：有参写入 `_prefillKeyword`；`:29` 同时 `useModalStack().registerModal(closeSearch)`（返回键关闭开箱即得）
  - `:37-42` `closeSearch()`：清 `_prefillKeyword`（防残留）
  - `:44-49` `consumePrefillKeyword()`：**读取即清**（一次性消费）
- 消费点：`components/SearchSheet.vue:310-324`
  ```ts
  onMounted(() => {
    void searchHistory.loadHistory()
    const prefill = searchSheet.consumePrefillKeyword()
    if (prefill) { keyword.value = prefill; controller.search(prefill) }   // 预填 + 立即搜索
    focusTimer = setTimeout(() => inputRef.value?.focus?.(), 50)
  })
  ```
  同处 `:313-315` 注释：「预填词（ADR-0133 决策 2/5）：标签点击进入——一次性消费（读取即清）… **不写搜索历史**（程序化唤起 ≠ 提交点）」。

### 3.2 已有「程序化注入关键词」的调用先例（正是本需求要的形态）

- `pages/Recommended.vue:170-174`
  ```ts
  // 点击标签 → 全局搜索弹层（ADR-0133）：…页面层接线 openSearch
  function onTagTap(name: string) { useSearchSheetStore().openSearch(name) }
  ```
- `pages/NovelList.vue:143-146`：同款 `onTagTap(name) { useSearchSheetStore().openSearch(name) }`
- 组件侧只发事件不引 store：`components/TagChipRow.vue:50` / `components/AdaptiveTagRow.vue:133,167` `@tap.stop="emit('tag-tap', chip.name)"`。
- 决策依据：`docs/adr/ADR-0133-app-lynx-tag-tap-search.md`（决策 1「入口 = 标签点击 → 搜索弹层（非路由页跳转）…**不新建路由**、不复制弹层状态」；决策 2「预填机制 = `openSearch(initialKeyword?)` 扩展」；决策 5「预填路径不写搜索历史」）；配套 `docs/adr/glossary-app-lynx-global-search.md`、`docs/adr/ADR-0132-app-lynx-global-search.md`。
- **CodeGraph 交叉验证（blast radius）**：`codegraph_explore "openSearch useSearchSheetStore consumePrefillKeyword SearchSheet tag-tap onTagTap"` 报告 `openSearch`（`searchSheetStore.ts:23`）**恰好 2 个调用点**（`NovelList.vue` / `Recommended.vue`），与人工 grep 一致；并确认 webview 对照实现走**路由**而非 store——`packages/app/src/components/SearchableTag.tsx:23-26` `navigate(\`/search?word=${encodeURIComponent(props.name)}\`)`（双端语义对齐、载体不同，ADR-0133 已记录该差异）。

### 3.3 结论：能否程序化注入关键词 + 自然插入点

- **能，且是既有的官方通道**：`useSearchSheetStore().openSearch(<选中词>)` 一条调用即完成「打开弹层 + 预填 + 自动搜索 + 返回键接管 + 不污染历史」。
- **自然插入点**：自绘菜单的「搜索选中词」项处理器内直接调用（与 `onTagTap` 完全同构）：
  ```ts
  // 例：packages/app-lynx/src/pages/NovelDetail.vue 的自绘菜单 handler
  useSearchSheetStore().openSearch(selectedText)
  ```
  正文 `<text>` 的落点：`pages/NovelDetail.vue:318`（`v-for="(p, idx) in paragraphs"` 内的正文段落 `<text class="text-body-large leading-[44rpx] text-surface-on">{{ p }}</text>`）——列表在 `:312-320`。当前该页**没有任何文本选择/长按处理**（`grep -n "selection" NovelDetail.vue` 无命中），是干净的新增面。
- 若选中词需要「先取词再跳转」，取词侧同样是既有能力：`getSelectedText` UI 方法（`UIText.java:417`）或 `selectionchange` 事件（`AndroidText.java:54/482` + `UIText.java:123/171`）把 `selectedText` 交给上述 store 调用。
- 需注意（既有语义差异，非阻塞）：
  - `openSearch` **幂等**：`if (_isOpen.value) return`（`searchSheetStore.ts:24`）——若弹层已打开，带词的调用会**被吞掉**（预填不会生效）。自绘菜单触发器通常在弹层未打开时，但 spec 应显式钉住该边界。
  - 预填路径**不写搜索历史**（`SearchSheet.vue:313-315`），符合「搜索选中词」语义（与 webview `SearchableTag` 对齐）。

---

## 无法验证（明确的未知项）

1. **原生 LynxView 运行时 `navigator` 对象的实际形态**：只在 `liblynx.so` prelude 形参表里见到该名字，未能确认它是否存在、是否有任何属性。可确定的是**它不可能有可用的 `clipboard`**（二进制无任何剪贴板实现串）——但「`navigator` 是什么」本身未验证。
2. **`getSelectedText` / `setTextSelection` UI 方法与 `selectionchange` 事件在 4.0.1 的实机可用性**：SDK 字节码与上游源码、官方文档三处一致存在，但本仓库无任何调用点/测试/真机记录；`SelectorQuery.invoke` 的既有先例只覆盖 `boundingClientRect`（`rspeedy-env.d.ts:50-61`，ADR-0149 记录了 invoke/exec 的坑）。
3. **`custom-context-menu` 在 4.0.1 真机上是否真正抑制系统 ActionMode**：字节码显示 `showToolbar()/hideToolbar()` 会早退（`AndroidText.java:859-863 / 870-877`），但未在设备上验证；同时**长按原始 `<text>` 是否会进入选择态**也未验证（官方文档要求 `text-selection` 生效需同时 `flatten={false}`，而 `NovelDetail.vue:318` 目前是普通 `<text>`）。
4. **web-core 预览（vue-lynx dev）对选择能力的支持**：`@lynx-js/web-core@0.23.1` 全量 grep 无 `selection`/`clipboard` 相关实现（未做穷尽式核对），故 dev 预览下的行为未知——预计需降级（与 `GlobalFab`/NativeModules 一致的「web-core 降级」模式）。
5. **`@lynx-js/types` 缺失带来的类型落差**：该包未安装（`packages/app-lynx/node_modules/@lynx-js/` 只有 3 个包），新属性/新 UI 方法只能靠手写 `d.ts`（`rspeedy-env.d.ts` / `shims-vue.d.ts`）声明，官方类型无法校验。
6. **未评估 iOS**（app 仅 Android）。
7. **未实测 Android 13+ 剪贴板预览的视觉表现**（仅据官方文档判断「自动出现、无需声明、建议 API ≥ 33 不再自弹 toast」）。

---

## 推荐方案（含成本对比）

### 方案 A（推荐）：新增 Java 薄壳 Native Module + 复用引擎自带选择能力

- **组成**：引擎侧 `<text text-selection custom-context-menu>`（+ 按文档要求 `flatten={false}`）+ `bindselectionchange` 监听 + `UI.invoke({method:'getSelectedText'})` 取词 + 自绘菜单 + 新增 `PictelioClipboard` 模块（`@LynxMethod setText`）+ 搜词复用 `useSearchSheetStore().openSearch(selectedText)`。
- **改动面**：Java 新增 1 个文件（约 30 行）+ `LynxRuntimeInitializer.java` 追加 1 行；TS 新增 1 个纯注入工厂 + 1 个接线文件 + `NovelDetail.vue` 的模板/交互改动 + 菜单 UI 组件 + 手写类型声明若干。
- **成本**：**中**（Java 侧小、TS/UI 侧是主要工作量）；风险集中在「引擎选择能力在 4.0.1 真机可用性」（未知项 2/3）与「自绘菜单的定位/生命周期」（需 `getTextBoundingRect` 或 `setTextSelection` 回传的 `boxes/handles` 做锚定）。
- **收益**：与仓库既有架构完全同构（可复用 Share/Gallery 的注册、回调、warn 降级、Java 单测模式），无新范式、无跨端契约风险。

### 方案 B：依赖系统 ActionMode 复制（零改动）

- **组成**：只加 `text-selection` 属性，用户长按走系统菜单「复制」。
- **成本**：**极低**（1 个属性）。但**无法满足需求**：不能自绘菜单、不能加「搜索选中词」、复制动作 JS 不可知（无回调、无成功/失败语义、无埋点），且选中态样式/菜单文案不可控。

### 方案 C：web-core `navigator.clipboard` 兜底 / `document.execCommand('copy')`

- **成本**：**低**但**无效**——原生 LynxView 运行时无 DOM（仓库既有结论：`docs/research/lynx-migration-feasibility.md:136` 「无 DOM/window（用 `lynx` 全局对象）」），`navigator.clipboard` 无实现（Q1.3/Q1.5），web-core 又跑在 Worker 里。只能作为 **web-core 预览下的降级分支**（照抄 `NetworkCheck.vue:57-68` 的可选链 + `console.warn`），**不能**作为生产通道。

**结论**：走 **方案 A**。其中「复制」必须新建模块（唯一可行），「搜索选中词」零新通道（复用 `openSearch`），「选中/读词/自绘菜单」优先复用引擎自带能力——把未知项 2/3 作为 spec 的第一个验证 spike（真机 `text-selection` + `bindselectionchange` + `getSelectedText` 连通性），失败再退到「JS 侧按字符索引自绘选择层」（成本高，需自研手势与命中，`createNovelSearch` 已有字符索引基础设施可借力）。

## 证据索引（关键路径）

- 引擎版本：`packages/app/android/app/build.gradle:240`（4.0.1）、`:54-69`（sourceSets / flavor 源码目录）
- SDK 产物：`~/.gradle/caches/9.6.1/transforms/*/transformed/lynx-4.0.1-runtime.jar`、`.../org.lynxsdk.lynx/lynx/4.0.1/*/lynx-4.0.1.aar`（`jni/arm64-v8a/liblynx.so`）
- 注册点：`packages/app/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java:67-83`、`.../LynxActivity.java:117-128`
- 模块模板：`.../PictelioShareModule.java:21-47`、`.../PictelioGalleryModule.java:21-80`、`.../PictelioAppModule.java:74-94`、`main/java/io/pictelio/app/ShareHelper.java`
- TS 桥：`packages/app-lynx/src/rspeedy-env.d.ts:81-124`、`src/api/client.ts:197-218`、`src/utils/downloadSharer.ts:4-11`、`src/utils/lynxShare.ts:5-7`
- 搜索通道：`src/stores/searchSheetStore.ts:15-52`、`src/components/SearchSheet.vue:310-324`、`src/pages/Recommended.vue:170-174`、`src/pages/NovelList.vue:143-146`、`src/router.ts:68-95`、`docs/adr/ADR-0133-app-lynx-tag-tap-search.md`
- 正文落点：`packages/app-lynx/src/pages/NovelDetail.vue:312-320`（`:318` 为正文 `<text>`）
- 官方文档：`https://lynxjs.org/api/lynx-api/lynx`、`https://lynxjs.org/api/elements/built-in/text`、`https://developer.android.com/develop/ui/views/touch-and-input/copy-paste`、MDN `api.Clipboard` / `api.Clipboard.writeText`
- 上游源码：`github.com/lynx-family/lynx` → `platform/android/lynx_android/src/main/java/com/lynx/tasm/behavior/ui/text/{AndroidText,UIText}.java`、`.../service/ILynxSystemInvokeService.java`
