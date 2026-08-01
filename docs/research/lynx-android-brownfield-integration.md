# Lynx Android Brownfield 集成研究（#41）

> 日期：2026-08（基于 lynxjs.org 4.0 官方文档、lynx-family/lynx 与 integrating-lynx-demo-projects 源码、Maven Central 实测核对；本地代码对照 `packages/app/android`、`packages/app-lynx`、`docs/adr/ADR-0050`）
>
> 任务：为已有 Capacitor 8 Android 应用（`io.pictelio.app`，MainActivity 继承 `BridgeActivity`）新增第二个 client（app-lynx / vue-lynx 前端，bundle = `packages/app-lynx/dist/main.lynx.bundle`），产出"精确到可写实现 ticket"的集成方案。
>
> 方法：官方文档优先（lynxjs.org/4.0 + GitHub 源码），每个结论标注 URL 或 file:line；本地代码亲自读过。与既有研究 `docs/research/lynx-migration-feasibility.md`（2026-07）结论互相印证，本文件补足**可写实现**层面的细节。

---

## 1. 依赖与版本

### 1.1 官方推荐的 Android Brownfield 集成形态

官方把"嵌入现有原生应用"（Brownfield）作为一等公民："Use Lynx as a high-performance, cross-platform UI rendering engine you can embed anywhere inside your existing application. This **Brownfield** approach offers the maximum flexibility… commonly used for large-scale applications in production."（[integrate-with-existing-apps](https://lynxjs.org/4.0/guide/start/integrate-with-existing-apps.html)）。`LynxView` 是普通原生 `View`（`extends UIBodyView extends View`），可 `setContentView(lynxView)`（[Android 集成文档](https://raw.githubusercontent.com/lynx-family/lynx-website/main/docs/en/guide/start/fragments/android/integrating-lynx-with-existing-app-android.mdx)）。

### 1.2 Maven 坐标（官方文档 + demo 项目实测）

groupId 是 **`org.lynxsdk.lynx`**（不是 `com.lynx:*`；`com.lynx.*` 只是 Java 包名）。官方文档与 [JavaEmptyProject/app/build.gradle](https://raw.githubusercontent.com/lynx-family/integrating-lynx-demo-projects/release/4.0/android/JavaEmptyProject/app/build.gradle) 给出 4.0.0 全套依赖：

```groovy
// 引擎核心（必选）
implementation "org.lynxsdk.lynx:lynx:4.0.0"        // aar ≈ 12.2MB（实测 repo1 上 lynx-4.0.0.aar = 12,779,218 bytes）
implementation "org.lynxsdk.lynx:lynx-jssdk:4.0.0"
implementation "org.lynxsdk.lynx:lynx-trace:4.0.0"
implementation "org.lynxsdk.lynx:primjs:4.0.0"      // JS runtime（quickjs，含 .so）
// 服务模块（按需）
implementation "org.lynxsdk.lynx:lynx-service-image:4.0.0"  // 默认 Fresco 图片服务（可自定义后移除）
implementation "org.lynxsdk.lynx:lynx-service-log:4.0.0"
implementation "org.lynxsdk.lynx:lynx-service-http:4.0.0"   // lynx.fetch 用
// 调试期
implementation "org.lynxsdk.lynx:lynx-devtool:4.0.0"
implementation "org.lynxsdk.lynx:lynx-service-devtool:4.0.0"
// 可选扩展元素（本项目 MVP 不需要，勿装以减少体积）
// implementation "org.lynxsdk.lynx:xelement:4.0.0" 等
```

- 版本号来源：官方 version.json `LYNX_VERSION=4.0.0, PRIMJS_VERSION=4.0.0`（[version.json](https://raw.githubusercontent.com/lynx-family/lynx-website/main/docs/public/version.json)）。
- Maven Central 实测：`org.lynxsdk.lynx:lynx` 已有 **4.0.0 / 4.0.1** 稳定版及 4.1.0-nightly（[maven-metadata.xml](https://repo1.maven.org/maven2/org/lynxsdk/lynx/lynx/maven-metadata.xml)）；当前文档基线是 4.0。
- **推荐锁定 `4.0.1`**（比 4.0.0 修复更靠后），见 §6.2 版本对应。

### 1.3 与本地工程兼容性（file:line）

| 项 | 本地现状 | Lynx 要求 | 结论 |
|---|---|---|---|
| minSdk | 28（`variables.gradle:2`） | 库声明 minSdk 16（lynx_android/build.gradle）；官方 demo minSdk 24 | ✅ 兼容 |
| compileSdk/targetSdk | 36（`variables.gradle:3-4`） | demo 用 34 | ✅ 兼容 |
| AGP | 9.2.1（`android/build.gradle:18`） | 消费 aar 不依赖宿主 AGP 版本 | ✅ 兼容（lint/AGP9 警告风险见 §6） |
| Gradle | 9.6.1 | 同上 | ✅ |
| Java | 21（`app/build.gradle:29-30`） | lynx aar target Java 8 | ✅ 兼容 |
| okhttp | 4.12.0（`app/build.gradle:81`） | 官方 demo 用 4.9.0；若不用 Fresco 则无此依赖冲突 | ✅ |
| ProGuard | release `minifyEnabled true`（`app/build.gradle:42`） | 官方提供完整 keep 规则（见下） | ⚠️ 必须合并 |
| androidx | 已启用（Capacitor 依赖） | Fresco 需 `android.useAndroidX=true` | ✅（本地已是 AndroidX 工程） |

**ProGuard 规则**：官方文档给了完整 LYNX keep 块（`@Keep`、`@CalledByNative`、`@LynxMethod`、`@LynxProp`、`LynxModule` 子类等），见 [Android 集成文档](https://raw.githubusercontent.com/lynx-family/lynx-website/main/docs/en/guide/start/fragments/android/integrating-lynx-with-existing-app-android.mdx) 的 "Configure obfuscation rules" 一节；本地需合并进 `app/proguard-rules.pro`。

**multiDex**：minSdk 28 ≥ 21，Android 5.0+ 原生支持 multidex，无需手动开启；但 lynx+Fresco 方法数多，注意 APK 体积与 64K 方法数（见 §6.3）。

### 1.4 需要新增到 `app/build.gradle` 的最小依赖集

```groovy
implementation "org.lynxsdk.lynx:lynx:4.0.1"
implementation "org.lynxsdk.lynx:lynx-jssdk:4.0.1"
implementation "org.lynxsdk.lynx:lynx-trace:4.0.1"
implementation "org.lynxsdk.lynx:primjs:4.0.1"
implementation "org.lynxsdk.lynx:lynx-service-log:4.0.1"
// lynx-service-image + Fresco 只在"使用官方图片服务"时必需；
// 本项目自研 ILynxImageService（§3），可跳过 Fresco 全家桶（省 ~2MB 与依赖冲突面）。
implementation "org.lynxsdk.lynx:lynx-service-http:4.0.1"   // 若 lynx.fetch 需要；API 走 NativeModule 则可省略
// debugImplementation 可选：lynx-devtool / lynx-service-devtool
```

---

## 2. LynxView 创建与生命周期

### 2.1 创建（官方 demo + explorer 源码为准）

```java
LynxViewBuilder viewBuilder = new LynxViewBuilder();
viewBuilder.setTemplateProvider(new PictelioTemplateProvider(this)); // 读 assets/main.lynx.bundle
viewBuilder.setScreenSize(w, h);          // 或 setPresetMeasuredSpec(EXACTLY, EXACTLY)
// per-view 注册 Native Modules（§4）
viewBuilder.registerModule("PictelioSecureStorage", SecureStorageModule.class);
LynxView lynxView = viewBuilder.build(this);
setContentView(lynxView);
lynxView.renderTemplateUrl("main.lynx.bundle", "");   // 或 renderTemplateWithBaseUrl(bytes, initData, baseUrl)
```

- `LynxViewBuilder` 方法清单（源码核实）：`setTemplateProvider`、`setPresetMeasuredSpec`、`setScreenSize`、`setFontScale`、`setColorScheme`、`registerModule(name, Class)`/`registerModule(name, Class, param)`、`registerModuleAuthValidator`、`setThreadStrategyForRendering`、`setLynxBackgroundRuntime`、`setGenericResourceFetcher`/`setTemplateResourceFetcher`/`setMediaResourceFetcher`、`setImageFetcher`、`setEnableJSRuntime`、`addBehaviors`、`build(Context)`（[LynxViewBuilder.java](https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_android/src/main/java/com/lynx/tasm/LynxViewBuilder.java)）。
- bundle 加载 API：`renderTemplateUrl(url, initData)`（远程/相对 asset 名）、`renderTemplateWithBaseUrl(byte[] bundle, Object initData, String baseUrl)`（本地字节，explorer 用此路径读 asset）、4.0 新 API `loadTemplate(LynxLoadMeta)`（[use-data-from-host-platform](https://lynxjs.org/4.0/guide/use-data-from-host-platform.html)）。官方 demo `MainActivity` 直接 `lynxView.renderTemplateUrl("main.lynx.bundle", "")` 配合 asset `AbsTemplateProvider`。
- bundle 放 `src/main/assets/main.lynx.bundle`（本地产物已存在：`packages/app-lynx/dist/main.lynx.bundle` ≈ 973KB）。**构建接入**：把 `pnpm --dir packages/app-lynx build` 产物拷贝到 assets（ticket 需定义拷贝脚本与产物 hash 校验）。
- 尺寸约束：全屏场景无需特殊处理；`setPresetMeasuredSpec` 用于"预布局加速"（[embed-lynx-to-native](https://lynxjs.org/4.0/guide/embed-lynx-to-native.html)）。

### 2.2 生命周期转发（LynxView 无 onResume/onPause，需显式转发）

`LynxView` 提供的生命周期钩子（[LynxView.java](https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_android/src/main/java/com/lynx/tasm/LynxView.java)）：

| Activity 回调 | LynxView 调用 |
|---|---|
| `onResume` | `lynxView.onEnterForeground()` |
| `onPause` | `lynxView.onEnterBackground()` |
| `onDestroy` | `lynxView.destroy()`（explorer `LynxViewShellActivity.onDestroy` 官方写法，[源码](https://raw.githubusercontent.com/lynx-family/lynx/develop/explorer/android/lynx_explorer/src/main/java/com/lynx/explorer/LynxViewShellActivity.java)） |

### 2.3 与 Capacitor BridgeActivity 并存的两个选项 → 结论

**选项 (a)：继续继承 BridgeActivity、按 client_type 跳过 bridge 初始化改为创建 LynxView —— 不可行。**
证据：本地 `BridgeActivity.onCreate`（`packages/app/node_modules/@capacitor/android/.../BridgeActivity.java:22-52`）无条件执行 `setContentView(R.layout.capacitor_bridge_layout_main)` + `load()` 创建 bridge/WebView，无开关可跳。lynx 分支若仍调用 `super.onCreate` 必然初始化 Capacitor WebView（浪费资源、且 WebView 会盖在 LynxView 下）。
（注：BridgeActivity 所有生命周期回调都有 `if (bridge != null)` 保护，bridge 为 null 不会崩，但无法阻止 onCreate 内部创建 bridge，故不可行。）

**选项 (b)：抽公共基类 + 条件初始化 —— 可行但侵入大。**
MainActivity 当前承载 SplashScreen、WebView 拦截、插件注册三块逻辑；抽基类需把 SplashScreen 逻辑下沉为公共工具，改动面大，且 Capacitor 插件注册（`registerPlugin`×4）仍只能在 BridgeActivity 分支。

**推荐（第三种，改动最小）：入口路由 —— 双 Activity 分发。**
- `MainActivity`（保持继承 `BridgeActivity`、保持全部 Capacitor 逻辑不动）`onCreate` 最开头读 `SharedPreferences("CapacitorStorage")` 的 `pictelio_client_kind`：
  - `"lynx"` → `startActivity(LynxActivity)` + `finish()` + `return`（**不初始化 Capacitor bridge、不注册插件、不做 WebView 版本检查**）；
  - 其他（`"webview"`/未设置）→ 原逻辑照旧。
- 新增 `LynxActivity extends AppCompatActivity`：纯 LynxView 全屏（§2.1 + §2.2 生命周期 + §5 返回键）。
- 理由：Capacitor 分支零改动、Lynx 分支是干净 Activity（无 Capacitor 参与，回避同 Activity 共存风险）；切换 client 时 `App.restart()` 重启进程重新走分发，天然干净。manifest 仍指向 `MainActivity`（LAUNCHER 不变）。

---

## 3. ILynxImageService

### 3.1 接口定义（确切签名）

- 接口 FQN：**`com.lynx.tasm.service.ILynxImageService`**（位于 `service_api` 模块，`extends IServiceProvider`；源码核实 [ILynxImageService.java](https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/service_api/src/main/java/com/lynx/tasm/service/ILynxImageService.java)）。
- 核心方法（完整签名见证据 URL，ticket 实现需实现这些）：

```java
public interface ILynxImageService extends IServiceProvider {
  void fetchImage(@NonNull ImageRequestInfo imageRequestInfo,
      @NonNull ImageLoadListener loadListener, @Nullable AnimationListener animationListener,
      @NonNull Context context);                       // 图片加载主入口
  void prefetchImage(@NonNull String uri, @Nullable Object callerContext, @Nullable Map<String,Object> params);
  void prefetchImage(@NonNull String uri, @Nullable Object callerContext, @Nullable Map<String,Object> params,
      @Nullable ImageLoadListener loadListener);
  boolean canParseUrl(@NonNull String url);            // 返回 true 表示本服务可直接处理该 URL
  void decodeImage(@NonNull ImageRequestInfo imageRequestInfo, @NonNull ImageLoadListener listener);
  void releaseImage(@NonNull ImageRequestInfo imageRequestInfo);
  void releaseAnimDrawable(@NonNull Drawable drawable);
  // 动画控制 4 件套（静态图实现可返回 false）
  boolean startAnimation(@NonNull Drawable animatable);
  boolean resumeAnimation(@NonNull Drawable animatable);
  boolean pauseAnimation(@NonNull Drawable animatable);
  boolean stopAnimation(@NonNull Drawable animatable);
  // 其余为 deprecated / Fresco 专用，默认或空实现即可
}
```

- `ImageRequestInfo` / `ImageLoadListener` / `AnimationListener` 位于 `com.lynx.tasm.image.model`；`ImageLoadListener` 有 `onSuccess(ImageContent, ImageRequestInfo, ImageInfo)` 与 `onFailure(int, Throwable)`。`ImageContent` 构造可包 `BitmapDrawable`/`Drawable`（参照默认实现 `com.lynx.service.image.LynxImageService`，[LynxImageService.java](https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_service/lynx_service_image/src/main/java/com/lynx/service/image/LynxImageService.java)）。

### 3.2 注册方式

全局注册（Application 启动时，`LynxServiceCenter.inst().registerService(impl)`），官方 Application 范例（[YourApplication.java](https://raw.githubusercontent.com/lynx-family/integrating-lynx-demo-projects/release/4.0/android/JavaEmptyProject/app/src/main/java/com/lynx/javaemptyproject/YourApplication.java) 与 explorer 的 `ExplorerApplication`）：

```java
LynxServiceCenter.inst().registerService(LynxImageServiceImpl.getInstance()); // 自定义实现
LynxServiceCenter.inst().registerService(LynxLogService.INSTANCE);
LynxServiceCenter.inst().registerService(LynxHttpService.INSTANCE);
LynxEnv.inst().init(this, null, null, null);  // 必须早于任何 LynxView 创建
```

本地已有自定义 Application：`PictelioApp`（`packages/app/android/.../PictelioApp.java:21`，manifest `android:name=".PictelioApp"`）——Lynx service/env 初始化放这里最合适（官方明确要求 Application#onCreate）。

### 3.3 注入 Referer/User-Agent 下载 i.pximg.net —— 必须自研，官方 Fresco 实现不带 header

- 官方 `<image>` 元素**无 header 属性**；官方默认实现 `LynxImageService`（Fresco）的 `fetchImage → ImageUtils.getFrescoImageRequest(...)` **不把 customParam 作为 HTTP header 传给 Fresco**（既有研究已在 [lynx-migration-feasibility.md:96](docs/research/lynx-migration-feasibility.md) 与 [vue-lynx-masonry-feasibility.md:109](docs/research/vue-lynx-masonry-feasibility.md) 确认）。
- 官方文档明示可自定义 image-service 并移除 Fresco："if the host APP needs to use other image libraries, you can customize the image-service and remove this dependency"（[Android 集成文档](https://raw.githubusercontent.com/lynx-family/lynx-website/main/docs/en/guide/start/fragments/android/integrating-lynx-with-existing-app-android.mdx)）。

**推荐实现（`PictelioImageService implements ILynxImageService`）**：
1. `fetchImage`：取 `imageRequestInfo.getUrl()`；若为 `/pixiv-img/{path}` 相对路径，重写为 `OAuthConfig.IMAGE_CDN_URL + "/" + path`（`OAuthConfig.java:24` `https://i.pximg.net`）；用 **`PixivApiPlugin.getSharedClient()`**（`PixivApiPlugin.java:81`，package-private static，同包 `io.pictelio.app` 可直接访问）发 OkHttp 请求，注入 `Referer=OAuthConfig.REFERER`、`User-Agent=OAuthConfig.USER_AGENT`（`OAuthConfig.java:28,17`）——与 `MainActivity.interceptImage`（`MainActivity.java:143-197`）逻辑同源。
2. 成功 → `BitmapFactory.decodeStream(body.byteStream())` → `loadListener.onSuccess(new ImageContent(new BitmapDrawable(res, bitmap)), ...)`；失败 → `loadListener.onFailure(code, throwable)`。
3. 磁盘缓存：复用现有磁盘缓存约定（`MainActivity.java:157-165` 的 Base64 文件名 + `getCacheDir()/pictelio-images`）；`prefetchImage` 可复用 `ImageCachePlugin`/`PixivApiPlugin.prefetchImage` 已有下载逻辑。
4. `canParseUrl`：返回 `true` 交由本服务处理（静态 jpg/png/gif/webp 即可；本项目无 ugoira 动图需求，GIF 如需动效再用 `GifDrawable`/`AnimatedImageDrawable` 扩展）。

**可行性结论**：复用 `PixivApiPlugin.getSharedClient()`（OkHttp 连接池）**可行且推荐**——同包可见、连接池/并发配置已就绪（`PixivApiPlugin.java:62-73`，maxRequestsPerHost=10）。唯一注意：`getClient()` 是 `private static`，但 `getSharedClient()` 已是同包静态访问点；图片服务并发会占用同一 dispatcher 配额，可按需为图片建独立 OkHttpClient（各配 `Dispatcher`）避免与 API 请求互相饥饿。

> 备选（不推荐）：保留 Fresco + 自定义 `OkHttpNetworkFetcher` 注入 headers。需引入 `com.facebook.fresco:fresco:2.3.0` 全家桶 + okhttp 集成，且 Fresco 与 okhttp 4.12 的兼容组合需额外验证——为注入两个 header 不值得。

---

## 4. Native Module 清单（含登录存储 AES/GCM 步骤）

### 4.1 定义与注册方式（官方 4.0 写法）

- 定义：`public class XxxModule extends com.lynx.jsbridge.LynxModule`，构造 `(Context)`，导出方法加 `@com.lynx.jsbridge.LynxMethod`，异步回调参数用 `com.lynx.react.bridge.Callback`（[官方 Native Modules 文档 Android 示例](https://lynxjs.org/4.0/guide/use-native-modules.html)）。
- 类型映射：`string→String`、`number→double`、`boolean→boolean`、`object→ReadableMap`、`array→ReadableArray`、`function→Callback`（官方 Type Mapping Table）。
- 注册：全局 `LynxEnv.inst().registerModule("Name", Module.class)`（explorer `LynxModuleAdapter.Init` [源码](https://raw.githubusercontent.com/lynx-family/lynx/develop/explorer/android/lynx_explorer/src/main/java/com/lynx/explorer/modules/LynxModuleAdapter.java)），或 per-view `LynxViewBuilder.registerModule(name, cls)`。
- JS 侧：`NativeModules.Name.method(...)`（Lynx 运行时全局对象），需在 app-lynx `src/typing.d.ts` 声明接口。
- 注意：NativeModule 调用发生在 **background thread**（Lynx 双线程架构），耗时的加解密/网络须确保不卡 JS 主线程，线程安全由实现负责。

### 4.2 模块清单与职责（可写 ticket 的方法签名草案）

**M1. `PictelioSecureStorageModule`**（登录态共享，对齐 ADR-0050 规格）
```java
@LynxMethod public void getItem(String key, Callback cb)      // cb.invoke(value 或 null)
@LynxMethod public void setItem(String key, String value)
@LynxMethod public void removeItem(String key)
```
存储规格（逐字段对齐 @aparajita/capacitor-secure-storage，契约见 `docs/adr/ADR-0050-lynx-login-persistence.md:39-50`，本文件只复述）：
- SharedPreferences 文件：`"WSSecureStorageSharedPreferences"`（MODE_PRIVATE）
- 存储 key：`"capacitor-storage_" + key` → 本项目固定 `"capacitor-storage_refresh_token"`
- 算法：`AES/GCM/NoPadding`（GCM 128-bit tag）
- 密钥：AndroidKeyStore，alias = prefixedKey（每 key 独立 AES 密钥，`KeyProperties.PURPOSE_ENCRYPT | PURPOSE_DECRYPT`）
- 密文格式：`Base64(ciphertext) + "\u0010" + Base64(iv)`（Base64 `NO_PADDING | NO_WRAP`）
- 备份完整性 marker：key `"capacitor-storage___pictelio_backup_marker"`（写/读时检查，语义同主项目）

AES/GCM 加解密步骤（ticket 内实现清单）：
1. **取/建密钥**：`KeyStore.getInstance("AndroidKeyStore").load(null)`；alias 不存在则 `KeyGenerator.getInstance("AES", "AndroidKeyStore")` 初始化 `KeyGenParameterSpec.Builder(alias, PURPOSE_ENCRYPT|PURPOSE_DECRYPT).setBlockModes(GCM).setEncryptionPaddings(NONE).build()` 并生成。
2. **加密（setItem）**：`Cipher.getInstance("AES/GCM/NoPadding")` → `init(Cipher.ENCRYPT_MODE, secretKey)`（框架自动生成随机 IV）→ `ciphertext = doFinal(plain.getBytes(UTF_8))` → 存 `Base64.encodeToString(ciphertext, Base64.NO_WRAP) + "\u0010" + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)` → `prefs.edit().putString("capacitor-storage_"+key, value).apply()`。
3. **解密（getItem）**：读字符串 → `split("\u0010", -1)` 拆出 cipher 段与 iv 段 → `Base64.decode(seg, Base64.NO_WRAP)` → `cipher.init(DECRYPT_MODE, key, new GCMParameterSpec(128, iv))` → `new String(doFinal(...), UTF_8)`。
4. 解密失败（密钥失效/数据损坏，如 `AEADBadTagException`）→ 清理该 key 并返回 null，JS 侧走重新登录。
5. `removeItem`：`prefs.edit().remove(...).apply()`（保留 marker 语义，与主项目一致）。

**M2. `PictelioAuthModule`**（access_token Java 堆隔离，JS 零知）
```java
@LynxMethod public void setAccessToken(String token)          // 只进不出（JS 只 push，不 pull）
@LynxMethod public void setRefreshToken(String token)         // 可选：用于 Native 侧自刷新（与 PixivApiPlugin 内存态对齐）
@LynxMethod public void refreshAccessToken(Callback cb)       // Native 内部用堆 token 调 OAuth 端点，成功后 cb.invoke(true)，失败 cb.invoke(false)
```
- 约束（背景前提）：access_token **只允许存在于 Java 堆内存**（static 字段，复用 `PixivApiPlugin` 的 `accessToken` 语义 `PixivApiPlugin.java:51`），**禁止任何 getter 暴露给 JS**。401 刷新在原生侧完成，JS 只感知成功/失败。

**M3. `PictelioApiModule`**（Pixiv API 转发，替代原生模式下不可用的 fetch）
```java
@LynxMethod public void request(String method, String path, ReadableMap params, String body, Callback cb)
```
- 内部复用 `PixivApiPlugin.executeRequest` 同款逻辑（`PixivApiPlugin.java:123-166`：OkHttp + `Authorization: Bearer` + Referer/UA + 401 静默刷新重试一次），返回 `{status, data}`。
- app-lynx 侧：`src/api/client.ts` 的 `requestFetch`（`fetchWrapper.ts:5-15` 已预留 fallback 链）在原生模式下改调 `NativeModules.PictelioApiModule.request`；`accessToken` 不再进 JS（`client.ts:15-21` 的 `setAccessToken/getAccessToken` 内存态在原生模式下改为 no-op / 由 Native 持有）。

**M4. `PictelioAppModule`**（client 切换重启）
```java
@LynxMethod public void setClientKind(String kind)   // 写 SharedPreferences("CapacitorStorage").putString("pictelio_client_kind", kind)
@LynxMethod public void restart()                    // 重启应用（清 task 栈重建 MainActivity，重新走 client 分发）
```
- 对应 app-lynx `clientSwitchStore.ts:35-48` 的 `__lynxRestartClient` 全局函数预留位。
- `setClientKind` 落盘文件必须是 **`"CapacitorStorage"`**：`@capacitor/preferences` 的默认 group 实测为此文件（本地 `PreferencesConfiguration.java:9` `DEFAULTS.group = "CapacitorStorage"`；`Preferences.java:17` `getSharedPreferences(configuration.group)`），与 `MainActivity.java:151` 读的同一文件，保证 webview 侧 `@capacitor/preferences` 能读到同一开关。

**M5. `PictelioClientConfigModule`（可选）**：`getClientKind()`、`getImageBaseUrl()` 等，把凭证之外的非敏感配置注入 JS（对齐 `lynx.config.ts:21-28` 的 `__PUBLIC_CONFIG__` 占位策略，原生模式不内联凭证）。

---

## 5. 双 client 启动分支方案

### 5.1 MainActivity 改造最小方案（入口路由）

```java
@Override
protected void onCreate(Bundle savedInstanceState) {
    // ① 先读 client 开关（放在 Splash/WebView 检查之前）
    String clientKind = getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
            .getString("pictelio_client_kind", "webview");
    if ("lynx".equals(clientKind)) {
        startActivity(new Intent(this, LynxActivity.class));
        finish();
        return;                       // ② 不初始化 Capacitor bridge/插件/WebViewClient
    }
    // ③ 以下为现有 webview 逻辑（MainActivity.java:44-78 原样保留）
    ...
}
```

- ③ 现有逻辑全部保留（SplashScreen install、`isWebViewVersionOk`、`registerPlugin`×4、`super.onCreate`）。
- **lynx 分支跳过**：SplashScreen 交给 LynxActivity 自己处理（§5.3）；WebView 版本检查**可跳过**（lynx 不依赖 WebView）；Capacitor 插件注册不执行。
- `PictelioApp.onCreate` 的 `warmUpWebView()`（`PictelioApp.java:29-38`）在 lynx 模式下浪费 50-300ms，可加同样的 client 判断跳过（低优先级优化）。

### 5.2 LynxActivity 骨架（新增）

```java
public class LynxActivity extends AppCompatActivity {
    private LynxView lynxView;
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        SplashScreen splash = SplashScreen.installSplashScreen(this);   // 见 §5.3
        LynxViewBuilder b = new LynxViewBuilder();
        b.setTemplateProvider(new PictelioTemplateProvider(this));      // asset: main.lynx.bundle
        b.registerModule("PictelioSecureStorage", PictelioSecureStorageModule.class);
        b.registerModule("PictelioAuth", PictelioAuthModule.class);
        b.registerModule("PictelioApi", PictelioApiModule.class);
        b.registerModule("PictelioApp", PictelioAppModule.class);
        lynxView = b.build(this);
        setContentView(lynxView);
        lynxView.renderTemplateUrl("main.lynx.bundle", initData);
    }
    @Override protected void onResume() { super.onResume(); if (lynxView != null) lynxView.onEnterForeground(); }
    @Override protected void onPause()  { super.onPause();  if (lynxView != null) lynxView.onEnterBackground(); }
    @Override protected void onDestroy(){ if (lynxView != null) lynxView.destroy(); super.onDestroy(); }
}
```

### 5.3 返回键 / 生命周期 / Splash 细节

- **返回键**：Capacitor 的 `backButton` 事件（`bridge.backButton`）在 lynx 分支不存在。LynxView 内置键盘/返回事件处理（`LynxView.getKeyboardEvent()`，源码见 [LynxView.java](https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_android/src/main/java/com/lynx/tasm/LynxView.java)）；Android 侧最小实现：`onBackPressed` 先尝试把事件交给 lynx 前端（通过 `triggerEventBus`/NativeModule 通知 JS），前端不消费则 `finish()`。
- **预测性返回**：manifest `android:enableOnBackInvokedCallback="true"`（`AndroidManifest.xml:14`）在 Android 13+ 会绕过传统 `onBackPressed`——lynx 分支需注册 `OnBackInvokedCallback`（或对 LynxActivity 禁用 predictive back）。**列为实现期验证项**。
- **SplashScreen 兼容**：`LynxViewClient.onLoadSuccess`（`lynxView.addLynxViewClient(...)`）时调 `SplashScreen` 退出逻辑，替代现有 `AuthPlugin.hideSplash()` 桥；保留现有 `keepSplashVisible` 机制（`MainActivity.java:35-40`）可抽成静态工具复用。
- **client_type 存储的唯一事实源**：SharedPreferences 文件 `"CapacitorStorage"` + key `"pictelio_client_kind"`（webview 侧 `@capacitor/preferences` 同文件；lynx 侧 `PictelioAppModule.setClientKind`）。注意 app-lynx 的 `clientSwitchStore.ts` 现在用 `globalThis.localStorage`（Worker 环境 no-op，ADR-0050:23 已确认），原生模式下必须改走 NativeModule。

### 5.4 构建接线

- `packages/app-lynx` 构建产物 `dist/main.lynx.bundle` 需拷贝进 `packages/app/android/app/src/main/assets/`（ticket：新增 `pnpm sync:lynx-bundle` 脚本或 Gradle task，含内容校验）。
- Gradle：`app/build.gradle` 增加 §1.4 依赖 + §1.3 ProGuard 规则；如需 ABi 裁剪（lynx `.so` 支持 armeabi-v7a/arm64-v8a/x86），默认打 arm64-v8a + armeabi-v7a 即可。

---

## 6. 风险与开放问题

### 6.1 Capacitor 与 Lynx 同 Activity 共存
- **结论：通过入口路由（双 Activity）规避**，两个 client 不共享 Activity，无 WebView/LynxView 同屏冲突、无 bridge 初始化干扰。若未来要"同屏嵌入"（LynxView 作为 Capacitor 页面内子视图），需普通 Activity 手动创建 Capacitor `Bridge`（`Bridge.Builder` 非 BridgeActivity 用法），工作量大——本期不做。
- Capacitor 插件（`PixivApiPlugin` 等）在 lynx 分支不注册，但 **Java 静态状态（`PixivApiPlugin.getSharedClient()`/accessToken）在 lynx 进程内依然可用**（同进程），这是自研 image service / api module 复用其逻辑的前提。注意：webview 与 lynx 是**同一 Activity 先后出现**（经 restart），静态 state 不共享跨进程，但重启即重建，无污染问题。

### 6.2 lynx SDK 版本 ↔ vue-lynx/@lynx-js 版本对应
- 本地 `packages/app-lynx/package.json`：`vue-lynx@0.5.1`、`@lynx-js/rspeedy@0.13.6`、`@lynx-js/web-core@0.23.1`（无 `@lynx-js/react` 直接依赖；vue-lynx 传递依赖 `@lynx-js/react@^0.116.5`）。
- 既有研究结论（`docs/research/vue-lynx-deep-dive.md:148`）：**建议 Lynx Engine 3.8.1+；vue-lynx 0.5.1 对应 @lynx-js/react ^0.116（4.x 时代）**。
- 官方兼容规则：bundle 内嵌 `engineVersion`，**bundle engineVersion > 引擎版本则报 Fatal 10204 无法运行**；bundle engineVersion ≤ 引擎版本可运行（[compatibility](https://lynxjs.org/4.0/guide/compatibility.html)）。
- 时间线推断：rspeedy 0.13.6 于 2026-03、lynx SDK 4.0.0 于 2026-05/07 发布，当前 `main.lynx.bundle` 的 engineVersion 大概率 ≤ 4.0 → **Lynx SDK 4.0.x 可运行现有 bundle（向后兼容）**。**实现期必验**：编译/集成后真机加载 `main.lynx.bundle`，确认无 10204；若报错则 `lynx.config.ts` 显式 `engineVersion` 或用 SDK 3.8/3.9 兜底。

### 6.3 体积与方法数
- `lynx-4.0.0.aar` ≈ **12.2MB**（Maven 实测 12,779,218 bytes）+ `lynx-jssdk`/`lynx-trace`/`primjs`（含 .so）→ APK 增量估算 **+15~20MB**（arm64+armeabi-v7a 双 ABI）。不引入 Fresco/XElement 可再省 ~2MB。
- 方法数：lynx+Fresco 超 64K 风险低（minSdk 28 原生 multidex，无需配置），但 release R8 压缩需 ProGuard 规则正确（§1.3），否则 `@LynxMethod`/`@CalledByNative` 被裁剪导致运行时 NativeModule 缺失。
- `minSdk`：本地 28 vs lynx 库 minSdk 16、官方 demo 24 → 无冲突。

### 6.4 图片 URL 策略（lynx 前端配合改动）
- 原生模式无 dev proxy：app-lynx `<image>` 的 `/pixiv-img/...` 相对 URL 在原生不可直载。两条路二选一（ticket 决策点）：
  - (A) 原生 `PictelioImageService` 内做 `/pixiv-img/` → `https://i.pximg.net/` 重写（推荐，前端零改动，与 webview 分支行为一致）；
  - (B) lynx 前端按模式输出绝对 `i.pximg.net` URL。
- 推荐 (A)；API 请求同理：`client.ts` 的 fetch 路径在原生模式切换为 `PictelioApiModule.request`（Native 内做 URL 规范化）。

### 6.5 其他开放问题（实现期验证清单）
1. LynxView 返回事件消费链路（§5.3）在 Android 13+ predictive back 下的行为。
2. `main.lynx.bundle` 的 `engineVersion` 实测（§6.2）。
3. NativeModule 后台线程执行 AES-GCM / OkHttp 的 ANR 风险（耗时操作放子线程 + Callback 回调时机）。
4. `lynx-service-http` 是否必需（若 API 全走 NativeModule 可不引入）。
5. AGP 9.2.1 消费 lynx aar 的 lint/transform 告警（如 `compileSdk` 校验、`.so` 压缩参数 `useLegacyPackaging`）。
6. `renderTemplateUrl`（相对 asset 名）与 `loadTemplate(LynxLoadMeta)` 新 API 在 4.0.1 上的行为差异，以 4.0.1 实际 API 为准。

---

## 推荐集成方案（≤20 行小结）

1. **依赖**：`org.lynxsdk.lynx:lynx(+jssdk+trace)+primjs` 锁 `4.0.1`，另加 `lynx-service-log`（可选 http/debug 服务）；**不引 Fresco**，自研图片服务。合并官方 ProGuard keep 规则。本地 AGP 9.2.1 / Gradle 9.6.1 / minSdk 28 / Java 21 全部兼容。
2. **启动分支**：MainActivity 保持继承 BridgeActivity 不动；onCreate 最前读 `SharedPreferences("CapacitorStorage").getString("pictelio_client_kind","webview")`，`"lynx"` 时 `startActivity(LynxActivity)+finish()+return`，否则走原 Capacitor 流程（BridgeActivity 无法跳过 bridge 初始化，故不可同 Activity）。
3. **LynxActivity**（新，AppCompatActivity）：LynxViewBuilder + asset `main.lynx.bundle`（`renderTemplateUrl`），`onResume/onPause/onDestroy` 转发 `onEnterForeground/onEnterBackground/destroy()`；Splash 由 `LynxViewClient.onLoadSuccess` 退出。
4. **图片**：自研 `PictelioImageService implements com.lynx.tasm.service.ILynxImageService`，全局注册进 `LynxServiceCenter`（在 PictelioApp.onCreate，同时初始化 `LynxEnv`）；OkHttp 复用 `PixivApiPlugin.getSharedClient()`，`/pixiv-img/`→`i.pximg.net` 重写 + Referer/UA 注入 + 磁盘缓存（逻辑同 `MainActivity.interceptImage`）。
5. **Native Modules**：`PictelioSecureStorage`（getItem/setItem/removeItem，AES/GCM/NoPadding + AndroidKeyStore + `"WSSecureStorageSharedPreferences"` + `"capacitor-storage_"` 前缀 + `Base64(cipher)+"\u0010"+Base64(iv)`，对齐 ADR-0050）、`PictelioAuth`（access_token 只进不出，Java 堆隔离）、`PictelioApi`（API 转发 + 401 原生刷新）、`PictelioApp`（setClientKind/restart，落盘 `"CapacitorStorage"` 文件供 webview 共享）。
6. **接线**：app-lynx `dist/main.lynx.bundle` 拷贝进 Android assets（构建脚本）；`clientSwitchStore`/`fetchWrapper` 原生模式切 NativeModule；实现期验证 bundle engineVersion、返回键、AGP9 告警。

## 证据索引（URL / file:line 列表）

**官方文档**
- Integrate with Existing Apps（Brownfield 定位、依赖、LynxEnv/Service 初始化、LynxView 构造、ProGuard、Fresco 依赖）：https://lynxjs.org/4.0/guide/start/integrate-with-existing-apps.html ；Android fragment（mdx）：https://raw.githubusercontent.com/lynx-family/lynx-website/main/docs/en/guide/start/fragments/android/integrating-lynx-with-existing-app-android.mdx
- Native Modules（LynxModule/@LynxMethod/Callback/类型映射/注册）：https://lynxjs.org/4.0/guide/use-native-modules.html
- Embed LynxView（尺寸约束/LynxViewBuilder#setPresetMeasuredSpec）：https://lynxjs.org/4.0/guide/embed-lynx-to-native.html
- 版本兼容规则（engineVersion ≤ 引擎版本，10204）：https://lynxjs.org/4.0/guide/compatibility.html
- Use Data from Host Platform（initData / LynxLoadMeta）：https://lynxjs.org/4.0/guide/use-data-from-host-platform.html
- 官方版本号：https://raw.githubusercontent.com/lynx-family/lynx-website/main/docs/public/version.json （LYNX_VERSION=4.0.0, PRIMJS=4.0.0）

**官方源码**
- ILynxImageService 接口定义（FQN `com.lynx.tasm.service.ILynxImageService`，全部方法签名）：https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/service_api/src/main/java/com/lynx/tasm/service/ILynxImageService.java
- 默认 Fresco 实现（确认不传 header、回调形态）：https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_service/lynx_service_image/src/main/java/com/lynx/service/image/LynxImageService.java
- LynxView 生命周期 API（onEnterForeground/onEnterBackground/destroy）：https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_android/src/main/java/com/lynx/tasm/LynxView.java
- LynxViewBuilder 方法清单（registerModule/setTemplateProvider/build 等）：https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_android/src/main/java/com/lynx/tasm/LynxViewBuilder.java
- explorer 生命周期/渲染范例（onDestroy→destroy）：https://raw.githubusercontent.com/lynx-family/lynx/develop/explorer/android/lynx_explorer/src/main/java/com/lynx/explorer/LynxViewShellActivity.java
- explorer Application（LynxEnv.init + LynxServiceCenter.registerService + Fresco 初始化）：https://raw.githubusercontent.com/lynx-family/lynx/develop/explorer/android/lynx_explorer/src/main/java/com/lynx/explorer/ExplorerApplication.java
- 模块注册范例（LynxEnv.inst().registerModule）：https://raw.githubusercontent.com/lynx-family/lynx/develop/explorer/android/lynx_explorer/src/main/java/com/lynx/explorer/modules/LynxModuleAdapter.java
- lynx_android minSdk 16 / 构建配置：https://raw.githubusercontent.com/lynx-family/lynx/develop/platform/android/lynx_android/build.gradle

**官方 demo（release/4.0，Java）**
- 完整依赖清单：https://raw.githubusercontent.com/lynx-family/integrating-lynx-demo-projects/release/4.0/android/JavaEmptyProject/app/build.gradle
- Application 初始化（LynxEnv/service/Fresco）：https://raw.githubusercontent.com/lynx-family/integrating-lynx-demo-projects/release/4.0/android/JavaEmptyProject/app/src/main/java/com/lynx/javaemptyproject/YourApplication.java
- MainActivity（LynxViewBuilder + renderTemplateUrl("main.lynx.bundle")）：https://raw.githubusercontent.com/lynx-family/integrating-lynx-demo-projects/release/4.0/android/JavaEmptyProject/app/src/main/java/com/lynx/javaemptyproject/MainActivity.java
- DemoTemplateProvider（asset AbsTemplateProvider）：https://raw.githubusercontent.com/lynx-family/integrating-lynx-demo-projects/release/4.0/android/JavaEmptyProject/app/src/main/java/com/lynx/javaemptyproject/DemoTemplateProvider.java

**Maven Central（实测）**
- lynx 版本列表：https://repo1.maven.org/maven2/org/lynxsdk/lynx/lynx/maven-metadata.xml （4.0.0/4.0.1 稳定；4.1.0-nightly 最新）
- lynx-4.0.0.aar = 12,779,218 bytes（≈12.2MB）+ sources.jar 存在：https://repo1.maven.org/maven2/org/lynxsdk/lynx/lynx/4.0.0/

**本地代码（file:line）**
- MainActivity（入口/Splash/WebView 拦截/共享 OkHttp 调用点）：`packages/app/android/app/src/main/java/io/pictelio/app/MainActivity.java:43-78`（onCreate）、`:143-197`（interceptImage）、`:151`（CapacitorStorage prefs）
- PixivApiPlugin（getSharedClient/executeRequest/accessToken 内存态）：`packages/app/android/app/src/main/java/io/pictelio/app/PixivApiPlugin.java:50-83`、`:123-166`、`:179-207`
- OAuthConfig（REFERER/USER_AGENT/IMAGE_CDN_URL 等）：`packages/app/android/app/src/main/java/io/pictelio/app/config/OAuthConfig.java:17-28`
- PictelioApp（自定义 Application，Lynx 初始化落点）：`packages/app/android/app/src/main/java/io/pictelio/app/PictelioApp.java:21-38`
- AndroidManifest（`.PictelioApp`、predictive back）：`packages/app/android/app/src/main/AndroidManifest.xml:5,14`
- 构建配置（AGP 9.2.1/Gradle 9.6.1/minSdk 28/Java 21/okhttp 4.12）：`packages/app/android/build.gradle:18`、`packages/app/android/variables.gradle:2`、`packages/app/android/app/build.gradle:29-31,81`
- BridgeActivity.onCreate 不可跳过 bridge（选型证据）：`packages/app/node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java:22-52`
- Capacitor Preferences 存储文件 = "CapacitorStorage"：`packages/app/node_modules/@capacitor/preferences/android/src/main/java/com/capacitorjs/plugins/preferences/PreferencesConfiguration.java:9`、`Preferences.java:17`
- app-lynx 侧：`packages/app-lynx/package.json`（vue-lynx 0.5.1 / rspeedy 0.13.6 / web-core 0.23.1）、`packages/app-lynx/src/stores/clientSwitchStore.ts:35-48`（__lynxRestartClient 预留）、`packages/app-lynx/src/utils/tokenStorage.ts`、`packages/app-lynx/src/utils/fetchWrapper.ts:5-15`（原生 fallback 预留）、`packages/app-lynx/dist/main.lynx.bundle`（≈973KB 原生 bundle 产物）
- ADR-0050 登录存储规格契约：`docs/adr/ADR-0050-lynx-login-persistence.md:39-50`
- 既有结论交叉印证：`docs/research/lynx-migration-feasibility.md:18,50-52,96-97`（aar 12.2MB、minSdk、Fresco 不传 header）、`docs/research/vue-lynx-deep-dive.md:148`（Engine 3.8.1+ 基线）

**未获取（注明）**：`@aparajita/capacitor-secure-storage` 的 `SecureStorage.java` 本地未安装（`packages/app/node_modules` 下 glob 无匹配），ADR-0050 的规格表已作为契约；若实现时需逐行对齐源码，先从 `packages/app` 安装该依赖或取 GitHub 源码核对。
