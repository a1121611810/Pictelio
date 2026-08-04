# Android 模拟器 E2E（Appium + WebdriverIO）

> issue #104 交付的基建层。父 spec：`docs/specs/android-emulator-e2e-gate.md`；ADR：`docs/adr/ADR-0061-android-emulator-e2e-gate.md`。
> 本目录只包含基建 + 冒烟测试；「切换渲染引擎」完整链路用例在后续 ticket（#105 起）追加到 `specs/`。

## 架构

```
specs/*.spec.ts                      # vitest 用例（冒烟 smoke.spec.ts）
  └─ setup.ts setupAndroidE2e()      # 编排：driver 预检 → AVD → chromedriver → 编译安装 → Appium → session
       ├─ appium.ts                  # Appium server 启动/复用/健康检查、uiautomator2 driver 预检
       ├─ avd.ts                     # AVD 检测、启动（-no-window）、boot 等待、WebView 版本探测
       ├─ chromedriver.ts            # 预置匹配设备 WebView 的 chromedriver（代理下载）
       ├─ build-install.ts           # pnpm build:android → adb install
       └─ driver.ts                  # WebdriverIO standalone 封装：session、context 切换、失败证据收集
env.ts                               # SDK 路径定位、子进程工具、超时档位、显式等待 waitFor
```

## 环境准备（一次性）

```bash
cd packages/app
pnpm install                # 安装 appium + webdriverio
pnpm appium:setup           # 等价于 appium driver install uiautomator2（装到 ~/.appium，需代理）
```

> `appium:setup` 与运行时都通过 `APPIUM_HOME=$HOME/.appium` 指向全局 driver 目录——
> monorepo 内 npm `workspace:` 协议冲突，driver 不能装项目本地（实测 2026-08-04）。

前置条件：

- Android SDK：默认取 `~/Library/Android/sdk`，或设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`。
- 固定 AVD（ADR-0061，不新建/删除）：`pictelio_ui`（android-34，WebView ≥ 85，首选）、`pictelio_low`（android-28，WebView 过老仅验证升级提示页）。
- 代理：chromedriver 下载走 `chromedriver.storage.googleapis.com`，本机直连大文件会超时，必须能访问代理（默认读 `https_proxy` / `http_proxy` env）。
- debug 签名环境无需额外配置；APK 由 `pnpm build:android` 编译。

## 运行

```bash
cd packages/app
pnpm test:android:e2e
```

默认自动选择第一个可用 AVD（pictelio_ui 优先）。冒烟测试会完整走通：
AVD 检测启动 → boot 等待 → chromedriver 预置 → 编译安装 APK → Appium server → session →
断言当前 Activity 为 `io.pictelio.app.MainActivity` → NATIVE_APP ↔ WEBVIEW context 切换。

### 环境变量

| 变量 | 作用 |
| ---- | ---- |
| `ANDROID_E2E_AVD` | 指定 AVD（如 `pictelio_ui`），默认自动选择 |
| `ANDROID_E2E_SKIP_BUILD=1` | 跳过 `pnpm build:android`，直接使用既有 APK（快速迭代） |
| `ANDROID_E2E_APPIUM_PORT` | Appium 端口，默认 4723 |
| `CHROMEDRIVER_EXECUTABLE` | 手动指定 Chromedriver 路径（自动下载失败时的逃生通道） |

## 关键行为说明

- **Appium server**：优先复用 4723 端口上已运行的实例（不会杀别人的 server）；没有才本地启动，测试结束后只停自己启动的实例。
- **模拟器**：检测在线模拟器的 AVD 名，是目标则复用；有其他模拟器在线但不是目标则报错退出（不抢用，避免误测）；没有则以 `-no-window` 启动目标 AVD 并等待 `sys.boot_completed=1`。测试结束不杀模拟器（留给下次复用）。
- **Chromedriver**：`setup.ts` 先探测设备 WebView 主版本，`chromedriver.ts` 确保本地有匹配二进制（`~/.appium/.../appium-chromedriver/chromedriver/mac/`，从 mapping.json 取精确版本，缺失时通过代理 curl 下载解压）。Appium 扫描本地目录即复用，不触发自动下载（Appium 自动下载器不读代理 env，直连 googleapis 必失败——已知坑）。`CHROMEDRIVER_EXECUTABLE` 可手动覆盖。adb/emulator 子进程剥离代理，Appium server 保留代理（`proxyEnv()`）。
- **断言**：使用 WebdriverIO `waitUntil` 显式等待（`driver.waitForActivity`、`driver.switchToWebView`），禁止固定 sleep；session 未建立前（启动早期）允许降级用 adb 轮询系统属性。
- **失败证据**：用例失败自动收集当前 Activity、截屏、logcat 尾部 200 行到 `test-results/android-e2e/`（该目录已 gitignore）。

## 后续 ticket 接入指引

新增用例放 `specs/`，复用同一编排：

```typescript
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";

let ctx: AndroidE2eContext;
beforeAll(async () => { ctx = await setupAndroidE2e(); });
afterAll(async () => { await ctx?.teardown(); });
```

WebView 侧：`await ctx.driver.switchToWebView()` 后用标准 CSS/XPath 选择器；
Lynx 侧：`await ctx.driver.switchToNative()` 后用 accessibility id（`$("~label")`），
前提是 app-lynx 元素已补 `accessibility-element` + `accessibility-label`（#103 范围）。

## 已知坑（实测 2026-08-04）

- `appium driver install` 在 monorepo 内报 `Unsupported URL Type workspace:` —— 用 `APPIUM_HOME=$HOME/.appium` 装全局。
- Appium 3 启用 Chromedriver 自动下载用 server 参数 `--allow-insecure *:chromedriver_autodownload`（不是 capability `chromedriverAutodownload`，feature 名须含 automationName 前缀）。
- 设备 AVD 名在 `ro.boot.qemu.avd_name`（`ro.kernel.qemu.avd_name` 为空）。
- MainActivity 的 WebView 版本不足路径曾跳过 `super.onCreate()` 导致崩溃（已修）——模拟器上 app 起不来先看 logcat 的 SuperNotCalledException。
