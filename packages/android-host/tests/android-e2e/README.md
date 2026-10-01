# Android 模拟器 E2E（Appium + WebdriverIO）

> issue #104 交付的基建层。父 spec：`docs/specs/android-emulator-e2e-gate.md`；ADR：`docs/adr/ADR-0061-android-emulator-e2e-gate.md`。
> 本目录含 11 个 spec。「切换渲染引擎」链路用例已随 WebView 客户端删除（ADR-0203 决策 7）——
> 客户端切换与引擎回退两组能力均已下线，测试矩阵不再覆盖跨引擎切换。
>
> `md3-visual-tokens.spec.ts`（#852）是**唯一不做登录、不启 Appium session** 的 spec：
> 只 `ensureEmulator → build → install → 启动 → 截图取样`，且**刻意不 `pm clear`**
> （那会清掉 SecureStorage 里的 refresh_token，而本票不做登录）。
> 代价是依赖设备上已有登录态；未登录时取到的是登录页底色，判据会转红。
> 它**不挂 `@release-gate`、不进 CI**（ADR-0084：发布门是发版前手动门）。

## 架构

```
specs/*.spec.ts                      # vitest 用例（冒烟 smoke.spec.ts）
  └─ setup.ts setupAndroidE2e()      # 编排：driver 预检 → AVD → chromedriver → 编译安装 → Appium → session
       ├─ appium.ts                  # Appium server 启动/复用/健康检查、uiautomator2 driver 预检
       ├─ avd.ts                     # AVD 检测、启动（-no-window）、boot 等待、WebView 版本探测
       ├─ chromedriver.ts            # 预置匹配设备 WebView 的 chromedriver（代理下载）
       ├─ build-install.ts           # pnpm build:android-host → adb install
       └─ driver.ts                  # WebdriverIO standalone 封装：session、context 切换、失败证据收集
pixel.ts                             # 共享像素工具：截屏 / 解码 / 取色 / 亮度 / 对比度 / 连通域 / 稳定帧 / 设备几何
env.ts                               # SDK 路径定位、子进程工具、超时档位、显式等待 waitFor
```

> **像素工具已收敛**（#852）：`transition-matrix` / `fab-hit-testing-regression` /
> `lynx-bookmark-tags` 原先各持一份**逐字同款**的私有副本（截屏、`toPixels`、`pixelAt`、
> `connectedBoxes`、`waitForStableFrame`、`assertDeviceGeometry`），现统一由 `pixel.ts`
> 提供实现，各 spec 只留**一行参数绑定**（绑定自己的 serial / 证据目录 / 稳定区期望值）。
> 收敛纪律是**只搬工具、不改断言**——阈值、步长、容差逐字未动，否则既有 e2e 的覆盖面
> 会在一次「重构」里悄悄变窄。`lynx-bookmark-tags` 原本就只校验分辨率/密度（无稳定区
> 第三项），共享版把该项做成可选参数正是为了不在重构里给它新增断言。

## 环境准备（一次性）

```bash
cd packages/android-host
pnpm install                # 安装 appium + webdriverio
pnpm appium:setup           # 等价于 appium driver install uiautomator2（装到 ~/.appium，需代理）
```

> `appium:setup` 与运行时都通过 `APPIUM_HOME=$HOME/.appium` 指向全局 driver 目录——
> monorepo 内 npm `workspace:` 协议冲突，driver 不能装项目本地（实测 2026-08-04）。

前置条件：

- Android SDK：默认取 `~/Library/Android/sdk`，或设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`。
- 固定 AVD（ADR-0061，不新建/删除）：`pictelio_ui`（android-34，WebView ≥ 85，首选）、`pictelio_low`（android-28，WebView 过老仅验证升级提示页）。
- 代理：chromedriver 下载走 `chromedriver.storage.googleapis.com`，本机直连大文件会超时，必须能访问代理（默认读 `https_proxy` / `http_proxy` env）。
- debug 签名环境无需额外配置；APK 由 `pnpm build:android-host` 编译。

## 运行

```bash
# 仓库根目录（ADR-0204：宿主动作一律 :android-host 显式命名，不占用裸名）
pnpm test:android-host:e2e
# 跑单个 spec
pnpm test:android-host:e2e -- specs/smoke.spec.ts
```

默认自动选择第一个可用 AVD（pictelio_ui 优先）。冒烟测试会完整走通：
AVD 检测启动 → boot 等待 → chromedriver 预置 → 编译安装 APK → Appium server → session →
断言当前 Activity 为 `io.pictelio.app.LynxActivity`（单引擎唯一入口；`MainActivity` /
`MainActivityWebview` 已随 #610 去 Capacitor 删除，故不再有 NATIVE_APP ↔ WEBVIEW context 切换）。

### 环境变量

| 变量                       | 作用                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANDROID_E2E_AVD`          | 指定 AVD（如 `pictelio_ui`），默认自动选择                                                                                                                                                                    |
| `ANDROID_E2E_HTTP_PROXY`   | 可选；设为宿主代理（如 `10.0.2.2:7897`）时为模拟器设全局 HTTP 代理（`settings put global http_proxy`），用于宿主网络直连 pixiv 受限（DNS 污染）的环境；teardown 会清除（`settings delete`）。默认不设、零影响 |
| `ANDROID_E2E_FLAVOR`       | 本分支只支持 `single`（缺省）。build.gradle 已无 productFlavors，显式设成 `full`/`webview` 会**立刻抛错**并指向正确指令（env.ts 收口，不静默 skip）                                              |
| `ANDROID_E2E_SKIP_BUILD=1` | 跳过 `pnpm build:android-host`，直接使用既有 APK（快速迭代）                                                                                                                                                 |
| `ANDROID_E2E_APPIUM_PORT`  | Appium 端口，默认 4723                                                                                                                                                                                        |
| `CHROMEDRIVER_EXECUTABLE`  | 手动指定 Chromedriver 路径（自动下载失败时的逃生通道）                                                                                                                                                        |

### E2E 钩子：靠 `BENCH_NAV=1` 注入，没有独立的「构建模式」

`build-install.ts` 的 `buildDebugApk()` 只有**一条**路径：跑 `pnpm build:android-host`。

- **不存在 `build:android:e2e` 这个脚本**，`ANDROID_E2E_BUILD_MODE` 在代码里也已 0 命中。
  这条分支随 WebView 客户端删除后已无存在依据，历史上它一旦置位就必然 `Missing script`。
  由 ADR-0203 决策 7 删除的 `switch-client-*` 系列正是依赖旧 E2E 钩子的那批用例。
- 现在唯一需要钩子的通道是 **benchNav 深链**，注入方式是**编译期环境变量**：
  `BENCH_NAV=1 pnpm build:android-host`（见末节「benchNav 深链」）。
  不注入则 `__BENCH_NAV__=false`，整块钩子被 tree-shake 掉。
- 快速迭代：`ANDROID_E2E_SKIP_BUILD=1` 跳过编译直接复用既有 APK。钩子随产物本身固化，
  **加了 / 去掉 `BENCH_NAV=1` 后必须重新编译**，SKIP_BUILD 复用的旧产物不会因此改变。

### AVD 选择（ANDROID_E2E_AVD）

- 默认自动选择：`avd.ts` 按 `KNOWN_AVDS` 顺序（`pictelio_ui` → `pictelio_low`）取第一个存在的，
  即默认落在 `pictelio_ui`（android-34，可真实运行 App）。
- 以下用例必须 pin AVD：
  - `fab-hit-testing-regression`：spec 内已 pin 缺省 `pictelio_ui`（坐标常量按 1080×2160 /
    density 480 的**稳定区 2016px** vw 几何推导——#819 订正，全屏 2160 口径已废弃，
    差 144px 会让点击落到手势条上）。显式 `ANDROID_E2E_AVD=pictelio_low` 会整文件 skip。
  - `transition-matrix`：同样 pin `pictelio_ui`，同一套坐标常量理由。
  - `md3-visual-tokens`：同样 pin `pictelio_ui`，采样窗与 CTA 扫描域按 1080×2160 /
    density 480 校准（并在 `beforeAll` 硬校验稳定区高度）。
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

### ⚠️ 坐标系陷阱：看图坐标 ≠ 设备像素（2026-09-30 实测踩坑）

`adb exec-out screencap -p` 取回的帧缓冲是**物理像素 1080×2160**（pictelio_ui）；
但**任何看图工具**返回给你的都是**显示尺寸**（约 1000×2000），并附一句
`Multiply coordinates by 1.08 to map to original image`。

⇒ **把看图得到的坐标喂回 `adb input tap/swipe` 前必须先 ×1.08**。
2026-09-30 实测：直接按显示坐标点按钮，**点击没触发**，排查半天才发现点在控件外侧
（FAB 圆心显示坐标 (883,1750) vs 实际 (953,1889)）。

本目录内的坐标一律是**物理像素**，来源只有两个：`dumpsys window displays` 的几何，
或 `transition-geometry.ts` 按 vw 的推导——**不经过看图工具**。
另注：全屏 2160 / app 2088 / **稳定区 2016** 三种高度口径差 144px（= 状态栏 72 +
手势条 72），坐标推导必须用**稳定区**口径（`CONTENT_BOTTOM`），换 ROM 或切换导航模式
（gestural ↔ threebutton）后要重新校准——三个 pin 住 pictelio_ui 的 spec 都在
`beforeAll` 里用 `assertDeviceGeometry` 硬校验这一项。

## 机器断言覆盖面（#852 引入，显式声明边界）

这一节存在的唯一目的：**别让读者误以为「有 e2e 兜底」**。

### 覆盖面上限是引擎定的，不是没做

- **Lynx 4.0.1 不暴露无障碍树节点**：全仓 199 处 `accessibility-element` 标注也不出节点，
  `uiautomator dump` 在 pictelio_ui 上必被 SIGKILL（exit 137），`getCSSValue` 对非 DOM 的
  Lynx 同样无效 ⇒ **拿不到元素边界框**。
- 因此「触控目标尺寸 / 圆角半径 / 对比度 / 状态层 alpha」**无法**用结构化查询断言。
  它们理论上可用像素测量，但**本仓从未实测过、容差无依据** ⇒ #852 **一律不塞**。
  （这不是「暂时没排期」，是排期前要先有实测基线。）

### `md3-visual-tokens.spec.ts` 逐条能证 / 不能证

| 断言                 | 能证                                                                                                        | **证不了**                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A1 浅色页面底色      | 底色落在 `surface` 令牌的 ±6/通道邻域内（实测逐位精确，偏差 0）；判据不是「非黑即非白」——换成暗色令牌必判否 | 是否**所有**页面的底色都对；只验了推荐页一条路径                                                                            |
| A2 暗色页面底色      | 暗色态底色命中暗色 `surface` 令牌，且 L\* 比亮色低 ≥40（实测 Δ92.1）                                        | 暗色下**每个组件**的配色；`auto` 跟随系统的解析链路（本票只播种显式 `light`/`dark`）                                        |
| A3 主题色可切        | 切到 violet 后主 CTA 色带命中 violet 色板；且切换前/后的实测色**互不命中对方令牌**                          | 7 套色板只验了 1 组（sky→violet）；色板生成脚本（`generate-theme-palettes.mjs`）的正确性                                    |
| A4 主 CTA 可见包围盒 | FAB 的**可见**包围盒 ≥ 48dp 且 ≤ 屏宽 80%（实测 162×162px = 54dp）；裁半注入的失败态必红                    | 其它控件的触控目标；**可点击性**本身（Lynx hit-testing 的问题归 `fab-hit-testing-regression` 管）；命中区是否真与视觉盒一致 |

**每条 A 类断言都配了负向对照**（注入失败态 / 用对方令牌判否 / 裁半扫描域），
用来证「这条判据会红」——没有负向对照的断言可能是恒真的假绿。

### 必须人眼兜底、机器判不了的

- **排版节奏**：字号档位（15 档语义档位）有没有真的按 M3 type scale 落地、
  行高 / 字距观感 —— 数值可查 Tailwind 配置，但**观感不可判**。
- **elevation 观感**：MD3 的层级主手段是表面色调（`surface-container-*` 五档），
  box-shadow 只是辅；「看起来有没有浮起来」判不了。且 Lynx 对多层 box-shadow
  的支持度**未真机验证**（tokens.css 注释已登记）。
- **图标观感**：Material Symbols 的字形/基线/光学尺寸是否对齐 —— 像素度量能给数值，
  给不了「像不像」。
- **整体贴合度**：新页面与既有页面的调性是否一致、7 套色板是否都好看。
- **状态层四态（hover/focus/pressed/dragged）的 alpha 是否真的合成到屏上**：
  纯触屏下 hover 按 ADR-0205 决策 4 判为「不适用」，`focus-visible` 在 Lynx 的
  支持度待真机验证 ⇒ 本仓**没有**对它的机器防线。

> 结论：**色值落地、明暗、主题切换、CTA 尺寸**这四类现在有机器防线；
> 其余观感类仍**完全依赖人眼 review**，不要因为 §机器断言覆盖面 这一节存在
> 就以为视觉回归已被自动拦住。

## WebDAV 备份链路（spec docs/specs/webdav-backup.md，默认跳过）

单引擎化后 WebDAV 备份 E2E **只剩 lynx 一条**：`specs/webdav-backup.spec.ts`（webview 侧，
经 WebView 设置页填连接配置 + DOM 点击）已随 webview 客户端删除。
现存的是 `specs/webdav-backup-lynx.spec.ts`，默认跳过（`WEBDAV_E2E_ENABLED=1` 才运行），
避免无服务器环境 CI 失败。

前置与运行：

```bash
# 1) 本地最小 WebDAV 服务器（或任意 WebDAV 服务器；DAV_PORT / WEBDAV_E2E_URL 可配）
node /tmp/pictelio-dav-server.cjs          # 监听 0.0.0.0:8081，根 /tmp/pictelio-dav

# 2) 模拟器回环 → 宿主（debug 网络安全配置仅放行 127.0.0.1/localhost cleartext）
adb reverse tcp:8081 tcp:8081

# 3) 本机无直连外网时，让模拟器走宿主代理（否则登录不可达）
adb shell settings put global http_proxy 10.0.2.2:7897

# 4) 运行（复用已构建 APK；PIXIV_REFRESH_TOKEN 由 packages/app-lynx/.env 提供）
cd packages/android-host && set -a && . ../app-lynx/.env && set +a
WEBDAV_E2E_ENABLED=1 ANDROID_E2E_SKIP_BUILD=1 ANDROID_E2E_AVD=pictelio_ui \
  pnpm vitest run -c tests/android-e2e/vitest.config.ts specs/webdav-backup-lynx.spec.ts
```

断言 oracle（独立于实现）：服务器磁盘上的真实备份文件（可解析为 spec §3.2 快照）、
spec §8 密码红线（快照不含任何 password 键）、§5/§6 流程文案。

`specs/webdav-backup-lynx.spec.ts` 覆盖 lynx 引擎的原生链路：
因 Lynx 4.0.1 accessibility 树不暴露内容节点、lynx UI 自动化不可行，改为「写 prefs
（webdav 配置）→ 启动 → LynxActivity → router.loadSettings → runStartupAutoBackup →
PictelioWebDavModule → 真实服务器」，断言服务器落盘快照的 `engine=lynx`、真实
`appVersion`、以及 `last_backup` 回写真实 SharedPreferences。全程无需 UI 点击。

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
- **构建链必须全程 `BENCH_NAV=1`**：`pnpm build:android-host` 内部会**重跑 lynx bundle 构建**
  （不带该 env 即注入 `__BENCH_NAV__=false`，整块钩子被 tree-shake）——只对
  `build:app-lynx` 单独注入会被随后的整链构建覆盖回无钩子版本（#542 实测坑）。
  正确姿势：`BENCH_NAV=1 pnpm build:android-host`；出货构建不注入，天然零钩子。
- **console 探针**：lynx JS 的 console.warn/log 落 logcat（tag `lynx`，`lynx_console.cc`），
  可作为无 UI 信号的事件到达/分支判定探针。
