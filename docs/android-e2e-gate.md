# Android 模拟器 E2E 门禁（切换渲染引擎链路）

> ADR：[ADR-0061-android-emulator-e2e-gate.md](./adr/ADR-0061-android-emulator-e2e-gate.md)
> 术语表：[glossary-android-emulator-e2e.md](./adr/glossary-android-emulator-e2e.md)
> 基建 README：`packages/app/tests/android-e2e/README.md`

「切换渲染引擎」（WebView ↔ Lynx）链路横跨 WebView JS → Capacitor 桥 → SharedPreferences → MainActivity 入口路由 → LynxActivity，纯 Web 测试无法覆盖原生段。本门禁通过 Android 模拟器真实跑通完整链路，纳入质量关卡。

## 一键运行

```bash
# 完整 E2E（pictelio_ui 上 4 个 spec + 失败证据收集）
pnpm test:android:e2e

# 仅运行双向闭环（最核心）
cd packages/app && APPIUM_HOME=$HOME/.appium ANDROID_E2E_AVD=pictelio_ui ANDROID_E2E_BUILD_MODE=e2e npx vitest run -c tests/android-e2e/vitest.config.ts specs/switch-client-roundtrip.spec.ts
```

> **必须**设置 `ANDROID_E2E_BUILD_MODE=e2e`：门禁依赖 `--mode e2e` 构建（含
> `window.pictelioE2e` 钩子绕过 dialog 交互限制；production 构建无钩子，安全）。
> 需真实 `PIXIV_REFRESH_TOKEN`（`~/.zshrc`）与代理（chromedriver 下载）。

### 双 AVD

| AVD | 系统 | 用途 |
|-----|------|------|
| `pictelio_ui` | android-34 | 完整双向闭环（WebView 113） |
| `pictelio_low` | android-28 | 降级路径验证（Lynx 可达 + 切回自动降级进 Lynx，WebView 66）；加 `ANDROID_E2E_FLAVOR=webview` 验证单引擎包仍停升级页（ADR-0153） |

两个 AVD 不能同时在线（`ensureEmulator` 检测到非目标在线即报错）。分别运行：
```bash
# pictelio_ui 全量
ANDROID_E2E_AVD=pictelio_ui ANDROID_E2E_BUILD_MODE=e2e pnpm test:android:e2e
# pictelio_low 降级（full 包：切回自动降级进 Lynx，ADR-0153）
ANDROID_E2E_AVD=pictelio_low ANDROID_E2E_BUILD_MODE=e2e pnpm test:android:e2e -- specs/switch-client-roundtrip-low.spec.ts
# pictelio_low 单引擎 webview 包：仍停升级页（ADR-0153 回归）
ANDROID_E2E_AVD=pictelio_low ANDROID_E2E_FLAVOR=webview ANDROID_E2E_BUILD_MODE=e2e pnpm test:android:e2e -- specs/webview-only-upgrade.spec.ts
# 引擎降级取证矩阵 M1–M4（ADR-0164，发版前转换矩阵门手动跑；两个 AVD 各跑一轮）
ANDROID_E2E_AVD=pictelio_ui ANDROID_E2E_BUILD_MODE=e2e pnpm test:android:e2e -- specs/engine-fallback-matrix.spec.ts
ANDROID_E2E_AVD=pictelio_low ANDROID_E2E_BUILD_MODE=e2e pnpm test:android:e2e -- specs/engine-fallback-matrix.spec.ts
```

> 缺省引擎翻转（ADR-0164）后，`setup.ts` 在 `pm clear` 后显式播种 `pictelio_client_kind=webview`
> 基线（把「全新安装=webview」的隐式前提显式化）；引擎降级取证依赖 DEBUG-only 覆盖键
> `pictelio_debug_force_lynx_unavailable`（release 构建该分支被 R8 死代码消除，生产包无此键）。

## 门禁触发：路径 + PR 标签双通道

### 通道 1：路径触发（改动以下文件时必须本地跑通）

```text
packages/app/src/components/settings/SettingsDialogs.tsx
packages/app/src/components/settings/SettingsImage.tsx
packages/app/src/components/settings/SettingsTranslate.tsx
packages/app/src/components/AgeGate.tsx
packages/app/src/routes/NovelDetail.tsx        # 仅 fluent-dialog 相关段
packages/app/src/routes/Settings.tsx           # E2E 钩子 + 切换确认
packages/app/src/utils/clientSwitch.ts
packages/app/src/components/settings/SettingsClient.tsx
packages/app/src/components/EngineFallbackBanner.tsx
packages/app/src/routes/ClientSwitch.tsx
packages/app/src/routes/__root.tsx             # 引擎降级提示条挂载（仅相关段）
packages/app/android/app/src/main/java/io/pictelio/app/MainActivity.java
packages/app/android/app/src/main/java/io/pictelio/app/LynxActivity.java
packages/app/android/app/src/main/java/io/pictelio/app/engine/  # 引擎决策模块（ADR-0164）
packages/app/android/app/src/full/java/io/pictelio/app/PictelioApp.java
packages/app/android/app/src/full/java/io/pictelio/app/FullEngineProbe.java
packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java
packages/app/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java
packages/app/android/app/src/webview/java/io/pictelio/app/ClientInfoPlugin.java
packages/app/android/app/src/webview/java/io/pictelio/app/MainActivityWebview.java
packages/app-lynx/src/pages/Me.vue
packages/app-lynx/src/pages/Login.vue
packages/app-lynx/src/pages/Recommended.vue
packages/app-lynx/src/stores/settingsStore.ts  # autoFallbackEngine 设备级键
packages/app-lynx/src/utils/engineState.ts
packages/app-lynx/src/utils/accessibility.ts
packages/app/tests/android-e2e/setup.ts        # E2E 基线播种（ADR-0164）
```

### 通道 2：PR 标签 `needs-android-e2e`

任何涉及以下主题的 PR，打 `needs-android-e2e` 标签：

- SharedPreferences / Capacitor Preferences 存储契约
- 原生桥 / Native Module（AuthPlugin、PictelioHttp、ImageCache）
- Activity 入口路由 / 分发
- Lynx 渲染 / accessibility 标注

**reviewer 职责**：带此标签的 PR 必须附模拟器 E2E 通过证据（日志/截图/命令输出），否则不予合入。

## 失败证据

测试失败时自动收集到 `packages/app/test-results/android-e2e/`（已 gitignore）：

```
01-<label>/
├── activity.txt        # 当前 Activity 名
├── screenshot.png      # 截屏
└── logcat-tail.txt     # logcat 尾部 200 行
```

解读指引：

- `activity.txt` 是 **MainActivity** → 分发未触发（查 prefs / 钩子 / 弹窗阻塞）
- `activity.txt` 是 **GrantPermissionsActivity** → 系统权限弹窗阻塞（TalkBack 通知权限，见 README 已知坑）
- `logcat-tail.txt` 有 `FATAL` / `SuperNotCalledException` → app 崩溃（查 MainActivity onCreate）
- `screenshot.png` 全黑 → Lynx 渲染未完成（android-28 需更长等待）

## 运行前置

```bash
cd packages/app
pnpm install          # appium + webdriverio
pnpm appium:setup     # 安装 uiautomator2 driver 到 ~/.appium（需代理）
```

详见 `packages/app/tests/android-e2e/README.md` 的完整环境准备与已知坑。
