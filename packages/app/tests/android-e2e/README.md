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

| 变量                       | 作用                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANDROID_E2E_AVD`          | 指定 AVD（如 `pictelio_ui`），默认自动选择                                                                                                                                                                     |
| `ANDROID_E2E_HTTP_PROXY`   | 可选；设为宿主代理（如 `10.0.2.2:7897`）时为模拟器设全局 HTTP 代理（`settings put global http_proxy`），用于宿主网络直连 pixiv 受限（DNS 污染）的环境；teardown 会清除（`settings delete`）。默认不设、零影响 |
| `ANDROID_E2E_BUILD_MODE`   | 设为 `e2e` 时改跑 `pnpm build:android:e2e`（保留 E2E 钩子），默认普通构建，见「构建模式」                                                                                                                      |
| `ANDROID_E2E_SKIP_BUILD=1` | 跳过 `pnpm build:android`，直接使用既有 APK（快速迭代）                                                                                                                                                        |
| `ANDROID_E2E_APPIUM_PORT`  | Appium 端口，默认 4723                                                                                                                                                                                         |
| `CHROMEDRIVER_EXECUTABLE`  | 手动指定 Chromedriver 路径（自动下载失败时的逃生通道）                                                                                                                                                         |

### 构建模式（ANDROID_E2E_BUILD_MODE）

`build-install.ts` 的 `buildDebugApk()` 默认跑 `pnpm build:android`（普通构建，web 产物**不含**
`window.pictelioE2e` E2E 钩子）；设置 `ANDROID_E2E_BUILD_MODE=e2e` 时改跑
`pnpm build:android:e2e`（web 构建带 `--mode e2e`，define `__E2E__=true` 保留钩子）。

- **依赖 `window.pictelioE2e` 钩子的用例**：`switch-client-oneway` / `switch-client-roundtrip` /
  `switch-client-roundtrip-3x`（经 `/client-switch` 页的钩子触发切换）。用普通构建跑这些用例
  会红在「E2E 钩子应存在」类断言上——先确认 `ANDROID_E2E_BUILD_MODE=e2e`。
- `switch-client-roundtrip-low` 走契约层（`prefs.ts` adb 写 pref + 重启），不依赖钩子，两种构建均可。
- 快速迭代：`ANDROID_E2E_SKIP_BUILD=1` 跳过编译直接复用既有 APK。构建模式随产物本身固化，
  **切换 BUILD_MODE 后必须重新编译**，SKIP_BUILD 复用的旧产物不会因此改变模式。

### AVD 选择（ANDROID_E2E_AVD）

- 默认自动选择：`avd.ts` 按 `KNOWN_AVDS` 顺序（`pictelio_ui` → `pictelio_low`）取第一个存在的，
  即默认落在 `pictelio_ui`（android-34，WebView ≥ 85，可真实运行 App）。
- 以下用例必须在 `pictelio_low`（android-28，WebView < 85）上运行：
  - `switch-client-roundtrip-low`：spec 内已 pin 缺省 `pictelio_low`，并在 setup 连设备之前用
    环境常量做整文件 skip guard（解析到其他 AVD 时跳过，防 ADR-0153「未自动降级」假失败，
    ADR-0159 根因 3）；
  - `fab-hit-testing-regression`：spec 内已 pin 缺省 `pictelio_ui`（阶段 A webview 登录需
    WebView ≥ 85；坐标常量按 1080×2160 / density 480 的 vw 几何推导。显式
    `ANDROID_E2E_AVD=pictelio_low` 会整文件 skip——该 AVD WebView 66 < 85，
    client_kind=webview 重启触发 ADR-0153 自动降级，无 WEBVIEW context）；
  - `webview-only-upgrade`：spec **未** pin AVD，需按其头注释显式
    `ANDROID_E2E_AVD=pictelio_low`（另有 `ANDROID_E2E_FLAVOR=webview` 的 skip guard；
    不显式指定时会被自动选到 pictelio_ui）。
  - pin 缺省不禁止显式覆盖：`ANDROID_E2E_AVD=pictelio_low` 始终有效。
- `ensureEmulator` 的抢用保护：检测到已在线模拟器但不是目标 AVD 时**直接抛错**（提示先关闭
  或设置 `ANDROID_E2E_AVD`），不抢用，避免误测错设备；无在线模拟器时才以 `-no-window` 启动目标 AVD。

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
beforeAll(async () => {
  ctx = await setupAndroidE2e();
});
afterAll(async () => {
  await ctx?.teardown();
});
```

WebView 侧：`await ctx.driver.switchToWebView()` 后用标准 CSS/XPath 选择器；
Lynx 侧：`await ctx.driver.switchToNative()` 后用 accessibility id（`$("~label")`），
前提是 app-lynx 元素已补 `accessibility-element` + `accessibility-label`（#103 范围）。

## 已知坑（实测 2026-08-04）

- `appium driver install` 在 monorepo 内报 `Unsupported URL Type workspace:` —— 用 `APPIUM_HOME=$HOME/.appium` 装全局。
- Appium 3 启用 Chromedriver 自动下载用 server 参数 `--allow-insecure *:chromedriver_autodownload`（不是 capability `chromedriverAutodownload`，feature 名须含 automationName 前缀）。
- 设备 AVD 名在 `ro.boot.qemu.avd_name`（`ro.kernel.qemu.avd_name` 为空）。
- MainActivity 的 WebView 版本不足路径曾跳过 `super.onCreate()` 导致崩溃（已修）——模拟器上 app 起不来先看 logcat 的 SuperNotCalledException。

## WebDAV 备份链路（spec docs/specs/webdav-backup.md，默认跳过）

`specs/webdav-backup.spec.ts` 覆盖 WebDAV 备份的真实原生链路（唯一需要外部 WebDAV 服务器的用例），
默认跳过（`WEBDAV_E2E_ENABLED=1` 才运行），避免无服务器环境 CI 失败。

前置与运行：

```bash
# 1) 本地最小 WebDAV 服务器（或任意 WebDAV 服务器；DAV_PORT / WEBDAV_E2E_URL 可配）
node /tmp/pictelio-dav-server.cjs          # 监听 0.0.0.0:8081，根 /tmp/pictelio-dav

# 2) 模拟器回环 → 宿主（debug 网络安全配置仅放行 127.0.0.1/localhost cleartext）
adb reverse tcp:8081 tcp:8081

# 3) 本机无直连外网时，让模拟器走宿主代理（否则登录不可达）
adb shell settings put global http_proxy 10.0.2.2:7897

# 4) 运行（复用已构建 APK；PIXIV_REFRESH_TOKEN 由 packages/app/.env 提供）
cd packages/app && set -a && . ./.env && set +a
WEBDAV_E2E_ENABLED=1 ANDROID_E2E_SKIP_BUILD=1 ANDROID_E2E_AVD=pictelio_ui \
  pnpm vitest run -c tests/android-e2e/vitest.config.ts specs/webdav-backup.spec.ts
```

断言 oracle（独立于实现）：服务器磁盘上的真实备份文件（可解析为 spec §3.2 快照）、
spec §8 密码红线（快照不含任何 password 键）、§5/§6 流程文案。

> 实测坑：WebDriver `execute` 的脚本体必须显式 `return`（IIFE 返回值会被丢弃 → 恒 null）；
> WebView 的 `innerText` 返回 null，断言用 `textContent`。

`specs/webdav-backup-lynx.spec.ts`（同一开关）覆盖 **lynx 引擎的原生链路**：
因 Lynx 4.0.1 accessibility 树不暴露内容节点、lynx UI 自动化不可行，改为「写 prefs
（`pictelio_client_kind=lynx` + webdav 配置）→ 启动 → LynxActivity →
router.loadSettings → runStartupAutoBackup → PictelioWebDavModule → 真实服务器」，
断言服务器落盘快照的 `engine=lynx`、真实 `appVersion`、以及 `last_backup` 回写
真实 SharedPreferences。全程无需 UI 点击。

> 真机发现：Lynx JS runtime **没有 `TextEncoder`/`TextDecoder`**，快照序列化处抛错会让
> lynx 自动备份在调用桥之前就失败（node/jsdom 单测覆盖不到）；现改用纯 JS UTF-8 实现
> （`backupCore.utf8Encode/utf8Decode`），两侧单测含字节序列对照 oracle。

## benchNav 深链（lynx 手势/交互类验收首选通道）

- **深链优先**：需要「进入某页面」的 lynx 验收一律首选 benchNav 深链（`am start --es benchNav <target>`），
  不要退回坐标点击 + 像素定位（作者行这类整行可点区域曾致坐标偏移静默误命中，#542）。
  详情页直达：`--es benchNav illust-detail --es benchNavIllustId <id>`——illust_id 经
  **数值事件载荷**下发（最初判断 lynx 4.0.1 载荷通道仅数值存活；`GlobalEventEmitter.emit`
  的到达可在 logcat `js_app.cc` 行确认，JS 侧缺载荷会显式 warn）。
  正文页直达：`--es benchNav novel-detail --es benchNavNovelId <id>`。
- **载荷类型的后续实测修正（2026-09-20）**：`sendGlobalEvent` 的**字符串载荷是可达的** ——
  小说翻译的帧交付正是以 JSON 字符串走该通道（`pictelioTranslateFrame`），并在模拟器端到端
  验收中确认 JS 侧收到后完成了译文渲染（证据与探针见
  `docs/verification/app-lynx-translation-emulator.md`、ADR-0170「交付通道实测」）。
  因此上一条的「字符串不可用」应读作：**未验证前不要假定字符串载荷可用**；新用途请自备
  JS 侧到达探针（`console.warn` 落 logcat，见下条）再下结论。
- **构建链必须全程 `BENCH_NAV=1`**：`pnpm build:android` 内部会**重跑 lynx bundle 构建**
  （不带该 env 即注入 `__BENCH_NAV__=false`，整块钩子被 tree-shake）——只对
  `build:app-lynx` 单独注入会被随后的整链构建覆盖回无钩子版本（#542 实测坑）。
  正确姿势：`BENCH_NAV=1 pnpm build:android`；出货构建不注入，天然零钩子。
- **console 探针**：lynx JS 的 console.warn/log 落 logcat（tag `lynx`，`lynx_console.cc`），
  可作为无 UI 信号的事件到达/分支判定探针。
