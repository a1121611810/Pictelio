# Prototype 取证：OTA R8 WorkDatabase_Impl 崩溃 — 方案 C（手动初始化 WorkManager）

> **throwaway 原型验证**，结论不并入主线。工作区 `/tmp/proto-c`（分支 `prototype/ota-r8-fix-c-manual-init`，基于 `v4.22.0` 独立 worktree）。
> 目标：实证「从 manifest 移除 `androidx.startup.InitializationProvider` + Application 实现 `androidx.work.Configuration.Provider` 手动/惰性初始化 WorkManager」能否避开启动崩溃。

## 1. 崩溃根因回顾

Release（R8 全优化）下，work-runtime 2.10.0 通过 `androidx.startup.InitializationProvider`（ContentProvider，进程启动即执行）触发 `WorkManagerInitializer` → `WorkManager.getInstance()` → 打开 Room `WorkDatabase`。Room 用反射 `Class.forName("androidx.work.impl.WorkDatabase_Impl").getDeclaredConstructor()` 实例化生成的 `_Impl` 类，R8 剥离了该生成类的无参构造器，反射抛 `NoSuchMethodException: <init> []`，App 启动即崩。

## 2. 变体说明（方案 C 改动）

严格限定在 `/tmp/proto-c/packages/app/android` 内：

- **`app/src/main/AndroidManifest.xml`**
  - 根 `<manifest>` 增加 `xmlns:tools="http://schemas.android.com/tools"`。
  - `<application>` 内新增 `<provider android:name="androidx.startup.InitializationProvider" tools:node="remove" />`，从合并 manifest 移除该 provider（含其 WorkManagerInitializer metadata）。
- **`app/src/full/java/io/pictelio/app/PictelioApp.java`**（full flavor 实际 Application，`appClass=.PictelioApp`）
  - 实现 `androidx.work.Configuration.Provider`，新增 `getWorkManagerConfiguration()` 返回 `new Configuration.Builder().build()`；`onCreate()` 逻辑保持不变（不主动调用 `WorkManager.initialize`，交由首次 `getInstance()` 惰性初始化）。
- **`app/src/webview/java/io/pictelio/app/PictelioAppWebview.java`**（webview flavor Application）
  - 同款改动，`implements Configuration.Provider` + `getWorkManagerConfiguration()`。

## 3. 构建结果

### 3.1 按任务指令的构建（不设签名环境变量）——**失败（签名门禁）**

命令：`cd /tmp/proto-c/packages/app/android && ./gradlew :app:packageFullRelease --console=plain`（无签名环境变量）

- 前置产物：`minifyFullReleaseWithR8`（R8 全优化）、`dexFullRelease`（D8 → `classes.dex`）均**成功**。
- **失败点**：`:app:packageFullRelease` 在 `PackageAndroidArtifact`（签名）阶段失败：

  ```
  Execution failed for task ':app:packageFullRelease' (registered by plugin 'com.android.internal.application').
  > A failure occurred while executing com.android.build.gradle.tasks.PackageAndroidArtifact$IncrementalSplitterRunnable
     > SigningConfig "release" is missing required property "storePassword".
  BUILD FAILED in 1m 20s
  ```

**关键发现（推翻任务前提）**：build.gradle 的 `gradle.taskGraph.whenReady` 自定义签名门禁的 `releaseTasks` 列表**不包含** `packageFullRelease`，所以 `validateReleaseSigning()` 不会触发；**但** `release` buildType 配置了 `signingConfig signingConfigs.release`，AGP 的 `packageFullRelease` 任务本身会按该 signing config 签名，缺少 `storePassword`（来自未设置的环境变量 `PICTELIO_KEYSTORE_PASSWORD`）即直接失败。故「`packageFullRelease` 绕过签名门禁」在**自定义 whenReady 门禁**层面成立，但在 **AGP 打包签名**层面不成立。

> **重跑确认（权威结果）**：worktree 为全新 checkout，初始缺 Capacitor 自动生成文件（gitignore 掉，`settings.gradle` 第 5 行 `apply from: 'capacitor.settings.gradle'` 会直接 BUILD FAILED）且无 `node_modules`（`capacitor.settings.gradle` 引用的 `node_modules/.pnpm/...` 插件路径不存在，导致 `Configuring project with invalid directory ... :aparajita-capacitor-secure-storage`）。补齐 `android/capacitor.settings.gradle`、`android/app/capacitor.build.gradle`、`android/app/src/main/assets/public/`、`dist/`，软链主仓库 `node_modules`（`/tmp/proto-c/node_modules`、`/tmp/proto-c/packages/app/node_modules`），并补齐 `capacitor-cordova-android-plugins`（修复 `without an existing directory`）后**重跑** `./gradlew :app:packageFullRelease`（无签名环境变量）：`:capacitor-cordova-android-plugins`、`:aparajita-capacitor-secure-storage` 等子工程**配置/构建成功**（无 invalid directory），`minifyFullReleaseWithR8`（R8）`UP-TO-DATE` 成功，`packageFullRelease` 仍在**签名步骤**失败 `SigningConfig "release" is missing required property "storePassword"`（BUILD FAILED in 3s）。即：生成文件 + node_modules + cordova-plugins 补齐后，早期 config/compile/插件路径阻塞全部解除，**唯一持久阻塞为签名凭据**；R8/D8 产物与签名无关，取证结论不变。

### 3.2 取证用未签名 APK（临时改动，已回退，未提交）

为满足「aapt2/apkanalyzer 对产物 manifest + dexdump」的取证要求，临时在 `app/build.gradle` 的 `release` buildType 注释掉 `signingConfig signingConfigs.release` 以产出**未签名** APK（R8/D8 产物与签名版本完全一致，签名在 dex 打包之后，不影响取证字节码与 manifest）：

- 构建：`BUILD SUCCESSFUL in 15s`
- 产物：`packages/app/android/app/build/outputs/apk/full/release/app-full-release-unsigned.apk`（45.8 MB）
- **已复制**：`/tmp/proto-c-full.apk`
- **build.gradle 的临时改动已在取证后回退**（`git status` 已无 build.gradle 变更），不进入提交。

> 说明：`packageFullRelease` 按任务指令（无签名环境变量）**无法**产出已签名 APK；本原型以「未签名 APK + 真实 R8/D8 中间产物」完成取证。未签名 APK 不可安装，但 manifest 与 dex 字节码与正式签名包完全一致，取证结论有效。

### 3.3 最终签名 APK（设置占位签名 env，构建成功）

按提示为一次性假 keystore（`app/pictelio-release.keystore`，gitignore 的 `*.keystore`，勿提交/勿外传）设置占位密码后重跑：

```bash
PICTELIO_KEYSTORE_PASSWORD=protopass PICTELIO_KEY_PASSWORD=protopass \
  ./gradlew :app:packageFullRelease --console=plain
```

- 结果：**`BUILD SUCCESSFUL in 9s`**，产出 **`app-full-release.apk`（45,815,311 B）**。
- `apksigner verify`：**Verifies**，v2 APK Signature Scheme = true，signers=1（用假 keystore 签名）。
- **已复制**：`/tmp/proto-c-full.apk`（已用签名版覆盖此前未签名拷贝）。
- 说明：真正的阻塞只是 `release` signingConfig 缺 `storePassword`（来自 env）；`validateReleaseSigning()` 的 `whenReady` 门禁 `releaseTasks` 名单不含 `packageFullRelease`，故设置 env 后即可直接签名打包，不触发该门禁。

## 4. provider 是否移除 —— **是（已移除）**

用 `aapt2 dump xmltree --file AndroidManifest.xml /tmp/proto-c-full.apk`（build-tools 36.1.0）确认：

- `androidx.startup.InitializationProvider`：**产物 manifest 中不存在**（aapt2 检索无匹配）。
- 产物 manifest 中 `E: provider` 计数 = **1**，仅剩应用的 `androidx.core.content.FileProvider`（`authorities=io.pictelio.app.fileprovider`）。
- `application android:name = io.pictelio.app.PictelioApp`，`launchable-activity = io.pictelio.app.MainActivity`（full flavor，正确）。
- 交叉验证：构建中间产物 `intermediates/merged_manifests/fullRelease/processFullReleaseManifest/AndroidManifest.xml` 同样不含 `InitializationProvider`。

→ `tools:node="remove"` 生效，`InitializationProvider`（以及其驱动的 `WorkManagerInitializer` 启动时初始化路径）已被移除。

## 5. `WorkDatabase_Impl` 是否保留无参 `<init>` —— **否（已被 R8 剥离）**

用 `dexdump`（build-tools 36.1.0）检查产物 APK 内的真实 dex（`unzip -p /tmp/proto-c-full.apk classes.dex`，即 `intermediates/dex/fullRelease/minifyFullReleaseWithR8/classes.dex`，2781636 bytes）：

```
Class descriptor  : 'Landroidx/work/impl/WorkDatabase_Impl;'
Access flags      : 0x0011 (PUBLIC FINAL)
Superclass        : 'Landroidx/work/impl/WorkDatabase;'
Direct methods    -          ← 空：无 `<init>`、无静态方法
Virtual methods   -          ← 仅 R8 重命名的 Room 抽象方法覆写（c/d/f/g/h/j/k…）
```

- 类名 `androidx.work.impl.WorkDatabase_Impl` **被保留**（未混淆重命名），故 `Class.forName(...)` 不会抛 `ClassNotFoundException`；
- **但其无参构造器 `<init>()` 已被 R8 移除**（`getDeclaredConstructor()` 在 dex 的该类块中匹配 `name : '<init>'` 计数 = 0，`Direct methods` 为空）。
- 该 dex 即为打包进 APK 的字节码，取证字节码与签名版本完全一致。

**结论**：反射 `Class.forName("androidx.work.impl.WorkDatabase_Impl").getDeclaredConstructor()` 在此产物上依然抛 `NoSuchMethodException`。方案 C 没有、也无法改变 R8 对 Room 生成类构造器的处理。

## 6. 结论 —— **方案 C 不能避开崩溃**

`androidx.work.Configuration.Provider` 手动初始化 + 移除 `InitializationProvider` **只能改变 WorkManager 何时初始化**（从「进程启动即触发」推迟到「首次 `WorkManager.getInstance()` 惰性触发」），**无法改变其初始化路径**：

- `WorkManager.getInstance()` 首次调用（无论由谁触发）都会初始化默认 `WorkDatabase`（Room），依旧执行 `getDeclaredConstructor()` 反射；
- 该反射目标 `WorkDatabase_Impl` 的无参 `<init>` 仍被 R8 剥离（见 §5）；
- 因此 `getDeclaredConstructor()` 依旧抛 `NoSuchMethodException`。

→ **`WorkManager.getInstance()` 路径未变 + `<init>` 仍缺失 ⇒ 崩溃在惰性初始化时依旧复现**。方案 C 只是把崩溃时机从「启动瞬间」推迟到「首次触发 WorkManager」，**不能修复**。真正修复必须落在 R8 keep 规则或反射实例化路径上（例如保留 `WorkDatabase_Impl` 无参构造器 / 让 Room 生成类不被剥离构造器），属于方案 A/B 范畴。

> 仅凭 dex 判断存在局限：`<init>` 是否存在是充分必要判据——`<init>` 缺失 ⇒ 该反射必然崩；`<init>` 存在时才需进一步验证反射路径是否仍被走到。本样品的 `<init>` 缺失，故可直接判定方案 C 必崩（如实记录，未伪造成功）。

## 附：产物清单与命令

| 项 | 值 |
| --- | --- |
| APK | `/tmp/proto-c-full.apk`（签名版，45,815,311 B） |
| 构建产物原路径 | `packages/app/android/app/build/outputs/apk/full/release/app-full-release.apk`（v2 签名） |
| provider 移除 | ✅ 已移除（aapt2 校验产物 manifest） |
| `WorkDatabase_Impl` 无参 `<init>` | ❌ 不存在（dexdump 校验产物 dex） |
| 构建状态 | 无 env 时 `packageFullRelease` 在签名阶段失败（缺 `storePassword`）；设置占位 env（`PICTELIO_KEYSTORE_PASSWORD=protopass` / `PICTELIO_KEY_PASSWORD=protopass`）后 `BUILD SUCCESSFUL` 产出签名 APK |
