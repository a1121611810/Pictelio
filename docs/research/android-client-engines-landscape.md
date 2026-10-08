# Android Client（UI 渲染引擎/应用容器）选型全景 —— 除 Capacitor 与 Lynx 之外

> 调研日期：2026-09-07（全文时效口径，所有版本号/日期均为此日查证）
> 前置阅读（本仓库已有一手调研，本文复述其结论并标注出处，不重复深挖）：
> - `docs/research/taro-migration-feasibility.md`（Taro = RN 换皮，RN 端边缘维护）
> - `docs/research/tauri-migration-feasibility.md`（Tauri = WebView 壳 + Rust 核，不支持嵌入现有工程）
> - `docs/research/uniapp-x-migration-feasibility.md`（uni-app x = 原生渲染重写，小说排版极高风险）
> - `docs/research/lynx-migration-feasibility.md`（Lynx = Brownfield 一等公民，第二引擎现状）
> - `docs/research/lynx-pure-engine-analysis.md`（纯 Lynx 无工程化交付；Sparkling/Miso 生态）
> - `docs/research/vue-lynx-production-readiness.md`（vue-lynx Pre-Alpha，成熟度 5.5~6/10）
>
> **Pictelio 语境**：「client」= 承载客户端 UI 的渲染引擎/容器。最重资产是 SolidJS SPA（~16.7k 行 TS，20 路由 + 47 组件）+ canvas measureText 小说排版 + Web Worker 图片测量 + `shouldInterceptRequest` 图片代理（Referer 注入刚需）+ ~19.4k 行 Java 原生网关。硬门禁：**GPL 系许可证一票否决**；Google Play 政策下的 OTA 合规路径需单独评估（Pictelio 实际经 GitHub Releases 分发 APK，政策约束弱化，见 §6）。

---

## 1. TL;DR 总表

许可证为硬门禁：🔴 GPL 系直接出局。维护状态版本号为 2026-09-07 查证值（主源见附录）。

| # | 候选 | 渲染方式 | TS/Solid 资产复用 | 动态化(OTA) | 许可证 | 维护状态（2026-09-07） | 一句话裁决 |
|---|------|----------|-------------------|-------------|--------|------------------------|-----------|
| 1 | Android WebView 裸用（自研 shell） | 系统 WebView | ✅ 100%（同现状） | ✅ Web 即 OTA | 无第三方依赖 | 系统组件（随 Play 更新） | 技术无障碍，但等于重造 Capacitor 胶水层，仅适合"去依赖/极致瘦身"诉求 |
| 2 | GeckoView（Mozilla） | Gecko 内核（非 Chromium） | ✅ 100%（浏览器模型） | ✅ 同上 | MPL-2.0 | 🟢 geckoview 155.0（Maven 2026-09-03 构建周更） | 可行但 APK +60~100MB 引擎、Referer 注入成熟度存疑——无必要 |
| 3 | Apache Cordova / Ionic（含 Portals） | 系统 WebView | ✅ 100%（壳层替换） | ✅ 同上 | Apache-2.0 / MIT | 🟢 cordova-android 15.1.0（2026-07-22）、Ionic 9.0.2（2026-09-02）；生态老化 | 相对 Capacitor 无增量收益 + 历史包袱，不推荐 |
| 4 | Tauri v2 mobile（wry） | 系统 WebView（wry） | ✅ 100%（UI 保留） | ✅ 同上 | MIT OR Apache-2.0 | 🟢 tauri 2.11.5（2026-07-01）、wry 0.56.1（2026-08-13） | 复述旧结论：UI 全保留但官方不支持嵌入现有工程，图片代理改 scheme——见旧调研 |
| 5 | Crosswalk | 自带 Chromium | — | — | — | ☠️ 2017-02 停更（末版 23/23.53.589.x） | **死亡确认**，仅存历史名词 |
| 6 | Flutter | 自绘（Impeller） | 🔴 0%（Dart 重写） | ⚠️ 无官方 OTA（第三方 Shorebird 未深查） | BSD-3-Clause | 🟢 stable 3.47.2（2026-08-27） | 需 Dart 全量重写；WebF 因 GPL-3.0 一票否决（复述见 §4.1） |
| 7 | React Native | 原生控件（Fabric；Skia 可选） | 🔴 0%（React 重写） | ✅ JS bundle OTA（Expo Updates/自建；CodePush 已退役） | MIT | 🟢 0.87.1（2026-08-26）；旧架构已于 0.82 移除 | UI 100% 重写为 React；走 RN 路线请直接用 RN（旧结论不变） |
| 8 | KMP + Compose Multiplatform | Android=Jetpack Compose 原生；iOS=Skia 自绘 | 🔴 0%（Kotlin 重写） | ❌ 无合规 OTA 路径（Kotlin 热更=dex 下发） | Apache-2.0 | 🟢 1.12.0（2026-08-25）；iOS 自 1.8.0（2025-05-06）stable | iOS 已 production-ready，但对 Pictelio 是 Kotlin 全量重写 + 动态化最弱 |
| 9 | Lynx（基线参照） | 自研原生渲染（Rust core） | 🔴 0%（React/Vue 重写） | ✅ JS bundle OTA（现状已用） | Apache-2.0 | 🟢 4.0.2（2026-09-04） | 第二引擎现状，详见已有 4 篇 Lynx 调研 |
| 10 | KuiklyUI（腾讯） | 原生控件（core-render-android → aar） | 🔴 0%（Kotlin 重写） | ⚠️ 宣称支持动态产物（Kotlin→dex 下发 + Shiply 平台）→ **Play 政策红线区** | 🟡 自定义 KuiklyUI License（类 BSD 宽松、非 OSI 标准文本） | 🟢 极活跃：2.27.0（2026-09-03）、2.26.0（2026-08-27） | 与旧结论的差异：动态化已于 2025 年开源推进；AOT 仅 ~300KB；但对 Pictelio 是 Kotlin 全量重写 |
| 11 | ArkUI-X（华为） | ArkUI 原生渲染 | 🟡 ArkTS 语法似 TS 但框架不兼容（无 DOM，SolidJS 不可直接跑） | ⚠️ 鸿蒙侧动态化；Android/iOS 端静态 aar/framework | Apache-2.0 | 🟡 6.0（社区口径）；GitHub arkui-x org 最近推送 2026-06；第三方库生态集中在鸿蒙 | 华为主导、Android/iOS 生态薄弱、维护速度慢——不建议 |
| 12 | Kraken（阿里） | 自研 WebView-like（Flutter 底座） | — | — | Apache-2.0 | ☠️ 最后提交 2022-12-30（未归档但死透） | **死亡确认**；团队继任者 WebF 是 GPL，一并出局 |
| 13 | NativeScript | 原生控件（JS 直调平台 API） | 🟡 **唯一官方列有 Solid flavor 的候选**（`@nativescript-community/solid-js`，社区维护），但为 universal renderer，Web 版 SolidJS 代码不可直接用 | ✅ JS bundle 可 OTA | MIT | 🟢 复兴中：9.1.1 npm（V8 14.9、Vite 8、ESM runtime） | 低优先级观察项：心智模型最兼容（TS/Solid 语法），但渲染层仍需按 NS 组件重写且 Solid flavor 成熟度未验证 |
| 14 | .NET MAUI | 原生控件（Handlers） | 🔴 0%（C#/XAML 重写） | ❌ 无 | MIT | 🟢 10.0.100（2026-08-20）；Android 最低 API 24 | 技术栈完全异构，出局（Xamarin 已 2024-05 EOL） |
| 15 | uni-app x（DCloud） | 原生渲染（蒸汽模式） | 🔴 0%（Vue/uvue 重写） | ⚠️ 热更新官方确认**仍在开发中** | 🟡 引擎闭源随 HBuilderX 分发（uni-app 主体 Apache-2.0） | 🟢 HBuilderX 5.24.2026081301（2026-08-13）；蒸汽模式三平台全发布 | 复述旧结论 + 新增减分：OTA 能力尚缺（见 §5 差异节） |
| 16 | Taro（京东） | App 端 = RN 原生渲染 | 🔴 0%（React 重写） | 同 RN | Apache-2.0 | 🟡 v4.2.1（2026-07-17）；RN 端仍边缘维护 | 复述旧结论：RN 换皮无优势，直接用 RN |
| C1 | Skip（skip.tools） | SwiftUI（iOS）/ Jetpack Compose（Android）原生 | 🔴 0%（Swift 重写） | ❌ | MPL-2.0 | 🟢 2026-01 全量开源（GitHub pushed 2026-08-29，3.2k stars） | Swift→Kotlin 转译器，面向 iOS-first Swift 团队，与 Pictelio 无关 |
| C2 | Wails v3 | 系统 WebView（Go core） | ✅ 前端可复用（WebView 模型） | ✅ 同 WebView | MIT | 🟡 v3.0.0-beta.5（2026-08-07），**Android 官方标注 experimental** | 观察项：Android 未到生产级 |
| C3 | Servo / Verso（嵌入式内核） | Servo 自绘引擎 | ✅（若可用则为浏览器模型） | ✅ 同 WebView | MPL-2.0 | 🟢 活跃（pushed 2026-09-06）；Tauri Verso 集成为实验（2025-03 起），桌面先行 | 远期观察项：2026-09 不可用于生产 Android |
| C4 | Sparkling / Miso（Lynx 生态） | 同 Lynx | 同 Lynx | 同 Lynx | Apache-2.0 | Sparkling 2.x（TikTok） | 非新引擎，是 Lynx 上层框架，见 `lynx-pure-engine-analysis.md` |

**全景收敛结论**：把 Crosswalk/Kraken（死亡）、WebF（GPL 否决）排除后，与已有调研的收敛一致——**主要候选仍是 Flutter、React Native、Compose Multiplatform、KuiklyUI 四类非 WebView 方案 + WebView 系内替换（裸 shell/GeckoView/Cordova/Tauri/Wails）**。本轮新增的有效信息是：NativeScript 9.x 复兴且官方列出 Solid flavor、KuiklyUI 动态化已开源推进、RN 旧架构移除、CMP iOS 转正、Skip 全量开源、uni-app x 热更新仍未落地。**没有出现任何"能低成本复用 SolidJS Web 资产的非 WebView 引擎"——这条护城河在 2026-09 依然只有"留在 WebView 系"一条路。**

---

## 2. WebView / 浏览器内核容器类

### 2.1 Android System WebView 裸用（自研 shell，不用 Capacitor）

- **渲染方式**：系统 WebView（Chromium），与现状完全同构。
- **TS 资产**：✅ 100% 复用——SPA 原样加载，`shouldInterceptRequest`、`evaluateJavascript`、`addJavascriptInterface` 全部原生可用（这是 Android 平台 API，不是 Capacitor 的）。
- **动态化/OTA**：✅ Web 资产天然可 OTA（JS/HTML 由自有服务器下发即可）；许可证：无第三方依赖（不适用）。
- **维护状态**：系统组件，Android 5.0+ 起 WebView 可经 Google Play 独立更新（这也正是 Crosswalk 之死的根因，见 §2.5）。
- **裁决**：**技术无障碍但无收益**。自研 shell 意味着把 Capacitor 提供的桥接协议、插件生命周期、WebView 配置（安全基线、Deep Link、Splash 等）自己重写一遍，而现状 Capacitor android 壳 dex 仅 ~0.97MB（实测，见 `uniapp-x-migration-feasibility.md` §9.7.1）——"去 Capacitor 化"换不回有意义的包体。仅当出现"许可证洁癖/供应链极简"诉求时才值得。

### 2.2 GeckoView（Mozilla）

- **渲染方式**：Gecko 内核（非 Chromium），**引擎打包进 APK**（不像系统 WebView 借用系统组件）。
- **TS 资产**：✅ 100% 复用（仍是完整浏览器：DOM、canvas measureText、Web Worker 全在）。
- **许可证**：MPL-2.0（宽松，通过硬门禁）。
- **维护状态**：🟢 活跃——Maven `org.mozilla.geckoview:geckoview` 最新 **155.0**（构建号 20260903215306，即 2026-09-03，随 Firefox 四周发布节奏周更）（[Maven metadata](https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview/maven-metadata.xml)，查证于 2026-09-07）。注意：旧仓库 `mozilla-mobile/firefox-android` 已归档（GitHub API：archived=true，最后推送 2024-06-17，查证于 2026-09-07），Mozilla 移动端开发已并入 Firefox 主仓库体系；GeckoView 产物持续发布不受影响。
- **Android 最低支持**：API 21+（官方口径 Android 5.0+；部分下游集成方报告新版需要 Android 8+，嵌入式场景需实测）。
- **代价与风险**：
  1. **包体**：Gecko 引擎 + JIT 全量打包，经验量级 APK +60~100MB（Firefox Android 本体即此量级）——对 1.8M 的 Pictelio 是 30~50 倍膨胀；
  2. **图片 Referer 注入**：WebView 的 `shouldInterceptRequest` 在 GeckoView 无 1:1 等价物；GeckoView 走 WebExtension 的 webRequest API 可拦截/改写请求，但成熟度与文档完整度远低于 WebView 路径（**本报告未逐一验证，标注为需 PoC**）；
  3. 内存占用高于系统 WebView（独立渲染栈）。
- **裁决**：**可行但无必要**。它换来的只有"引擎自主可控（不受系统 WebView 85+ 碎片化约束）"，代价是包体/内存/生态三重损失。

### 2.3 Apache Cordova / Ionic（含 Ionic Portals）

- **渲染方式**：系统 WebView（与 Capacitor 同构；Capacitor 本就是 Ionic 团队对 Cordova 的替代品）。
- **TS 资产**：✅ 100% 复用（壳层替换）；Ionic Framework 组件库支持 Angular/React/Vue + Web Components，**无官方 Solid 支持**（可直接用其 Web Components）。
- **许可证**：Cordova Apache-2.0；Ionic Framework MIT；**Ionic Portals 为 Ionic 商业产品**（需向 Ionic 申请 license key，npm `@ionic/portals` latest 0.13.0，查证于 2026-09-07）。
- **维护状态**：🟢 活着但老化——`cordova-android` **15.1.0**（2026-07-22，[官方 release](https://cordova.apache.org/announcements/2026/07/22/cordova-android-15.1.0.html)）、Cordova CLI npm latest **13.0.0**；Ionic Framework **v9.0.2**（2026-09-02）（GitHub releases，查证于 2026-09-07）。
- **裁决**：**相对 Capacitor 无增量收益**。Cordova 的插件模型正是 Capacitor 所替代的旧一代（`cordova-plugin-*` 生态质量差、WebView 配置粗糙）；Ionic 组件库是 Material/IOS 风格，与 Fluent Design 硬约束冲突。Portals 的"原生 App 内嵌多个 Web 迷你应用"卖点对 Pictelio 的单 SPA 架构无用。不推荐。

### 2.4 Tauri v2 mobile（wry + 系统 WebView + Rust core）

- **复述旧结论**（`tauri-migration-feasibility.md`，2026-07）：与 Capacitor 同类（WebView 壳），UI/SolidJS/pretext/Worker **全部保留**；但 `gen/android` 是独立完整工程，`MainActivity` 固定继承 `TauriActivity`，**官方不支持嵌入现有原生工程**；`shouldInterceptRequest` 被 wry 内部占用，图片代理需改自定义 scheme 协议（`pixiv://` + reqwest）或 fork 维护 `RustWebViewClient`；包体估算 ~2.5~5M。
- **2026-09 时效更新**：
  - tauri 最新 release **tauri-v2.11.5**（2026-07-01，[GitHub releases](https://github.com/tauri-apps/tauri/releases)，查证于 2026-09-07）；wry **0.56.1**（2026-08-13）；npm `@tauri-apps/cli` 2.11.4；
  - 许可证：MIT OR Apache-2.0（GitHub 主标 Apache-2.0）；
  - 移动端成熟度延续 2024-2025 以来"可用但生态偏桌面"的状态；
  - **新动向（内核层）**：Tauri 于 2025-03 公开与 **Verso（Servo 内核浏览器）的实验性集成**（[官方博客 tauri-verso-integration](https://v2.tauri.app/blog/tauri-verso-integration/)，[NLnet 资助项目](https://nlnet.nl/project/Tauri-Servo/)），目标是以 Rust 内核替代"依赖系统 WebView"，桌面先行，移动端是长期目标（见 §3.2）。
- **裁决**：同旧结论——**若未来要换壳且想保留全部 Web 资产，Tauri 是 Capacitor 的"安全升级版"选项**；"只换 Client 保留现有 Activity"依旧不可行。

### 2.5 Crosswalk（确认死亡）

- Intel 赞助的自带 Chromium 内核 WebView，为解决 Android 4.x 时代 WebView 不可独立更新而生；Android 5.0+ 的 WebView 改为经 Google Play 可更新后，其存在价值消失。
- **死亡确认**：2017-02 停止发布，末版 **Crosswalk 23（23.53.589.x）**（查证于 2026-09-07，来源：Crosswalk 项目存档与社区迁移文档）。
- **裁决**：仅存历史名词，出局。

---

## 3. 补充：WebView 系新增观察项（2025–2026）

### 3.1 Wails v3（Go + 系统 WebView）

- v3 处于 **beta**（desktop API stable），**Android/iOS 官方标注 experimental、不阻塞 desktop beta**；v3.0.0-beta.5（2026-08-07）（[v3.wails.io](https://v3.wails.io/)、[roadmap](https://v3.wails.io/status/)，查证于 2026-09-07）。前端任意（WebView 模型，TS 可复用），core 为 Go（编译进 APK）。
- **裁决**：观察项。Android 未到生产级，且相对 Capacitor/Tauri 无差异化能力（Go 生态的移动插件少于 Capacitor/Rust）。

### 3.2 Servo / Verso（嵌入式替代内核）

- Servo：Rust 编写的浏览器引擎，MPL-2.0，由 Linux Foundation 托管，**活跃**（GitHub pushed 2026-09-06，37.9k stars，查证于 2026-09-07）；发布节奏为月度构建（GitHub releases 混合多组件 tag，未按统一版本号发布）。
- Verso：基于 Servo 的浏览器/可嵌入 webview 组件；与 Tauri 的集成实验自 2025-03 公开（见 §2.4），**桌面先行，Android 嵌入仍在成熟中**。
- **裁决**：**远期观察项**。2026-09 时点 Servo 的 Android 嵌入 API、DOM/CSS 兼容度、性能都不足以承载 Pictelio（SPA 对 DOM 兼容性要求高）。若 2027 年 Servo 嵌入成熟，它将是"带自研内核的 WebView 系"新选项——届时 Pictelio 可"零 UI 重写"迁移，值得保持关注。

---

## 4. 动态化 / 跨端渲染引擎类

### 4.1 Flutter（含 WebF 复述）

- **渲染方式**：自绘（Impeller，Skia 后继），非 WebView、非原生控件。
- **TS 资产**：🔴 0%——Dart + Flutter widget 全量重写（20 路由 + 47 组件 + 小说排版 + 虚拟滚动全部重建）。
- **动态化/OTA**：⚠️ 官方无代码推送方案（Google Play 政策下 Dart AOT 补丁属灰色地带；第三方 Shorebird 服务存在，本报告未深查）。
- **许可证**：BSD-3-Clause（通过硬门禁）。
- **维护状态**：🟢 stable **3.47.2**（2026-08-27，[Flutter releases 官方 JSON](https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json)，查证于 2026-09-07）。
- **WebF 复述（先验裁决，出处：任务前置说明 + 本节查证）**：WebF（Flutter 上的 W3C 兼容渲染引擎，理念上"让 Web 前端跑在 Flutter 里"）曾在候选评估中因 **GPL-3.0 许可证一票否决**。**2026-09-07 复核：GPL-3.0 仍为现行许可证**（GitHub `openwebf/webf`，license 字段 GPL-3.0，2512 stars，最新 release 0.24.19（2026-03-20），最后推送 2026-06-24，查证于 2026-09-07）——**否决维持**。WebF 同时是 Kraken（§4.8）的团队继任项目（WebF 由原 Kraken 核心团队延续开发）。
- **裁决**：需 Dart 全量重写 + 动态化无官方路径；性能上限高但 Pictelio 已有 Lynx 承担"原生渲染"诉求。**不推荐作为第三引擎。**

### 4.2 React Native（New Architecture / Skia 现状）

- **渲染方式**：原生控件（Fabric 渲染器 + Yoga 布局）；可选 Skia 自绘（react-native-skia）。
- **TS 资产**：🔴 0%——React 全量重写（RN 无 DOM；pretext、Worker、DOM 高亮全部失效，与 Taro 评估同构）。
- **New Architecture 时间线（2026-09 口径）**：0.76（2024-10）默认启用 → ~0.80（2025-06）旧架构冻结 → **0.82（2025-10）起旧架构彻底移除、不可关闭**（[官方博客](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here)、[0.82 博客](https://reactnative.dev/blog/2025/10/08/react-native-0.82)，查证于 2026-09-07）。0.85 继续完成桥移除。
- **维护状态**：🟢 **v0.87.1**（2026-08-26，GitHub releases，查证于 2026-09-07）。注意仓库已迁移至 `react/react-native`（原 `facebook/react-native` 301 重定向），MIT。
- **动态化/OTA**：✅ JS bundle OTA 是业界惯例（interpreter 例外覆盖，见 §6）；但 Microsoft App Center **CodePush 已于 2025-03-31 随 App Center 退役**（[Microsoft Learn](https://learn.microsoft.com/en-us/appcenter/retirement)），现路径 = Expo Updates / 自建服务 / 社区独立 CodePush server（微软开源了服务端代码）。
- **裁决**：**UI 100% 重写为 React；若决定走 RN 路线，直接用 RN（旧结论不变，Taro 只是 RN 换皮且 RN 端边缘维护）**。相对 Lynx：同为 JS 逻辑层 + 原生渲染，但 Lynx 官方 Brownfield 嵌入更顺、启动更快（官方口径 2~4×）；RN 生态规模数倍于 Lynx。Pictelio 已有 Lynx，第三引擎再引入 RN 无增量。

### 4.3 Kotlin Multiplatform + Compose Multiplatform（iOS 支持稳定度）

- **渲染方式**：Android 端 = Jetpack Compose 原生控件渲染；iOS/桌面 = Skia 自绘。
- **TS 资产**：🔴 0%——UI 以 Kotlin + Compose DSL 重写。
- **iOS 支持稳定度（本轮重点核实项）**：**Compose Multiplatform 1.8.0（2025-05-06）宣布 iOS Stable / production-ready**（[JetBrains 官方博客](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/)，查证于 2026-09-07）。当前版本 **1.12.0**（2026-08-25，GitHub releases）。Apache-2.0。
- **动态化/OTA**：❌ 最弱项——Compose 产物是编译进 APK 的 Kotlin 字节码，无官方热更；Kotlin 层热更需 dex 动态下发，撞 Google Play 红线（§6）。
- **Android 最低支持**：跟随 Jetpack Compose（API 21+）。
- **裁决**：**工程素质最高的"纯原生"路线（iOS 已转正、JetBrains+Google 双背书），但对 Pictelio 是 Kotlin 全量重写且动态化为零**——与 KuiklyUI 同类但无动态化；作为第三引擎不成立。

### 4.4 Lynx（基线参照，不深挖）

- 🟢 **4.0.2**（2026-09-04，GitHub releases，查证于 2026-09-07）；Apache-2.0；仓库 pushed 2026-09-06。
- 基线结论沿用已有 4 篇调研：Brownfield 一等公民（LynxView=原生 View）、ReactLynx 生产级 / vue-lynx Pre-Alpha（成熟度 5.5~6/10）、引擎 aar ≈12.2MB、图片 Referer 需自研 `ILynxImageService`、小说测量需自建原生模块、JS bundle OTA（Pictelio 第二引擎已在用）。

### 4.5 KuiklyUI（腾讯）—— 重点核实

**2026-09-07 查证结果（全部主源）：**

- **仓库与活跃度**：`Tencent-TDS/KuiklyUI`（注意已从 Tencent 组织迁移至 Tencent-TDS 组织），**最新 release 2.27.0（2026-09-03）、2.26.0（2026-08-27）、2.25.0（2026-08-07）**——月/周级发版，3.4k stars，最后推送 2026-09-03（GitHub API，查证于 2026-09-07）。另有 `Tencent-TDS/KuiklyUI-AI`（2026-08 创建，AI 辅助工具）与 `KuiklyUI-third-party`。
- **渲染方式**：**原生控件**——`core`（KMP 共享响应式/布局/Bridge）+ `core-render-android`（输出 aar）/`core-render-ios`/`core-render-ohos`；README 口径 SDK 极轻：**AOT 模式 Android ~300KB / iOS ~1.2MB**。
- **技术栈演进（与旧认知的重要差异）**：Kuikly 2.x 新增 **Compose DSL**——仓库内 `compose/` 模块直接基于 **JetBrains Compose Multiplatform 1.7.3 源码改造**，包名由 `androidx.compose` 改为 `com.tencent.kuikly.compose`（README 明示，查证于 2026-09-07）；1.x 时代的自研 DSL 仍可用（"声明式 + 响应式多范式，自研 DSL 与 Compose DSL"）。Kotlin 2.1.21。
- **开源范围与动态化（先验结论"动态化能力未开源"需要修正）**：
  - 2024-04 首次开源时仅静态（AOT）部分；动态化承诺逐步开源；
  - **2025-04 前后官方推进全面开源**：[Kuikly Roadmap 2025 存档页](https://kuikly.tds.qq.com/Blog/roadmap2025.html)确认鸿蒙（含 Kotlin/Native 适配工具链）、H5、小程序（beta）均已开源，Compose DSL 在内部落地后持续优化（查证于 2026-09-07）；
  - **现行 README（英文+中文）明确列出"Dynamic capability: Supports compilation into dynamic deliverables / 动态化：支持编译成动态化产物"**（查证于 2026-09-07）；
  - 但动态化**产物的分发管控依赖腾讯 Shiply 平台**（Android 端 Kotlin→dex 动态下发，iOS 有对应方案；社区拆解与官方案例页口径一致：应用宝等业务在高性能动态化运营场景落地）——即 **SDK/引擎开源，动态化分发平台是腾讯云服务**。
- **许可证**：🟡 **自定义 "KuiklyUI License"**（LICENSE 文件：Copyright 2025 Tencent，正文为类 BSD/MIT 的宽松授权条款但非 OSI 标准文本，GitHub license 识别为 NOASSERTION）——**非 GPL，不触发硬门禁**，但企业引入前建议法务过一遍自定义条款。
- **Android 最低支持**：Android 5.0+（README System Requirements，查证于 2026-09-07）。
- **UI 层语言与 TS 资产**：🔴 **Kotlin**（DSL/Compose DSL），TS/Solid 资产 0% 复用；小说排版（无 DOM/canvas measureText）、图片 Referer 注入（需原生图片加载器接管）与 uni-app x 同构的高危区。
- **裁决**：**作为 Pictelio 第三引擎不成立**——Kotlin 全量重写 + 动态化撞 Play 红线（§6）+ 生态腾讯内部向。相对 CMP 的唯一差异化是"动态化产物能力 + 超轻 SDK"，而这两点对 Pictelio 要么无用（已有 Lynx OTA）要么有害（Play 合规）。**但需要修正旧裁决：其动态化能力现已开源推进，"未开源"的旧结论在 2025-04 后不再准确。**

### 4.6 ArkUI-X（华为）

- **渲染方式**：ArkUI 声明式框架的原生渲染延伸至 Android/iOS（aar/framework）。
- **UI 语言**：ArkTS——**语法上是 TypeScript 的严格子集**（这是它对 Pictelio 唯一的"亲和性"），但运行时无 DOM/无 Web API，SolidJS 代码**不可直接运行**，只是迁移时的语法学习成本低。
- **维护状态**：🟡 弱——GitHub `arkui-x` 组织（arkui_for_android 等）最近推送 2026-06-12~13，star 数个位数~29（主开发在 Gitee/OpenHarmony 社区）；社区口径最新 **ArkUI-X 6.0**（随 HarmonyOS 6.0 节奏），但"维护推进速度比较慢、很多 ArkUI API 在跨平台框架上还不支持、第三方库集中在纯鸿蒙端"（华为云社区/知乎多方口径，查证于 2026-09-07）。Apache-2.0。
- **动态化**：鸿蒙生态有动态化能力，**Android/iOS 端产物为静态 aar/framework**（跨平台部分随包发布）。
- **裁决**：**不建议**。华为主导、为鸿蒙扩张服务，Android/iOS 是二等目标；生态与文档完整度不足以承载 Pixiv 客户端这种重度 Feed + 图片应用。

### 4.7 NativeScript（9.x 复兴）—— 本轮新增的意外观察项

- **渲染方式**：原生控件——JS/TS 通过运行时**直调平台 API**（无桥序列化），UI 用 XML/CSS 或框架组件声明。
- **TS 资产**：🟡 **候选中唯一官方列出 Solid flavor 的**：官方文档 flavors 列表含 **`@nativescript-community/solid-js`**（另有 Angular/Vue/React/Svelte）（[docs.nativescript.org](https://docs.nativescript.org/)，查证于 2026-09-07）。**但必须澄清**：NS 的 Solid flavor 是 solid Universal Renderer（渲染到原生视图树），**Pictelio 的 Web 版 SolidJS 组件（DOM 版）不能直接复用**——能复用的是 TS 业务逻辑、solid primitives 心智模型与部分无 DOM 依赖的算法。渲染层仍需按 NS 组件全量重写。
- **维护状态**：🟢 **2026 年是 NS 近年最活跃期**：npm `@nativescript/core` **9.1.1**；NativeScript 9.0（原生 ESM runtime、iOS 多窗口）→ 9.1（**V8 14.9、成熟模块系统、Vite 8 热更新无需重启进程、Node-API 支持**）；GitHub releases 高频发 `8.0.x-vite` 工具链 tag（[9.0 公告](https://blog.nativescript.org/nativescript-9-announcement/)、[9.1 公告](https://blog.nativescript.org/nativescript-9-1-announcement/)，查证于 2026-09-07）。MIT，OpenJS Foundation 治理（nStudio 主导维护）。
- **动态化/OTA**：✅ JS bundle 同样落入 interpreter 例外（§6）。
- **Android 最低支持**：API 17+（历史口径）/ 现代 runtime 实际建议 21+（**未在官方首页核实到精确值，标注存疑**）。
- **裁决**：**低优先级观察项**。它是唯一在"TS + Solid 语法"维度与 Pictelio 资产对口的非 WebView 方案，若未来必须脱离 WebView，NS 值得排在 Flutter/RN 之后做一次 `@nativescript-community/solid-js` 的成熟度专项评估（该 flavor 由社区组织维护，成熟度**未验证**，预计远低于 React/Angular flavors）。当前不构成第三引擎候选。

### 4.8 Kraken（阿里）—— 确认死亡

- **死亡确认**：`openkraken/kraken` 最后提交 **2022-12-30**（GitHub API pushed_at，查证于 2026-09-07；未正式归档但 3 年半无提交），Apache-2.0，4.9k stars。
- 团队继任：核心成员转向 **WebF**（openwebf/webf，见 §4.1）——而 WebF 是 GPL-3.0，一并出局。
- **裁决**：死亡 + 继任者 GPL，**双重出局**。

### 4.9 .NET MAUI

- **渲染方式**：原生控件（Handler 架构映射平台控件）。
- **TS 资产**：🔴 0%（C#/XAML 全量重写）。
- **维护状态**：🟢 **10.0.100**（2026-08-20，GitHub releases，查证于 2026-09-07），MIT；**Android 最低要求已抬升至 API 24 / Android 7.0**（[.NET MAUI 10 supported platforms](https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms?view=net-maui-10.0)）。前代 Xamarin 已 2024-05 EOL。
- **动态化**：❌ 无。
- **长尾同族**：Avalonia（MIT，11.x，Android 支持存在但非主战场）、Qt Quick（LGPLv3/商业双授权，Android 支持成熟但引入 C++/QML 技术栈与体积）——均与 Pictelio 资产零交集，不展开（Qt 未做 2026-09 版本号核实，仅给定性）。
- **裁决**：**出局**（技术栈完全异构；即便不考虑重写，MAUI 的 Android 渲染品质与社区口碑也不支撑重度 Feed 应用）。

### 4.10 uni-app x（DCloud）—— 只补时效

- **复述旧结论**（`uniapp-x-migration-feasibility.md`，2026-07）：可行但 = 全量重写（uvue/Vue）；蒸汽模式性能卖点强但原生 SDK 混合嵌入仅支持 VDOM；小说排版极高危、图片流水线改统一下载器。
- **2026-09 时效**：
  - **蒸汽模式三 App 平台已全部发布**：鸿蒙 HBuilderX 5.0+、iOS 5.11+、Android 5.21+（[官方蒸汽模式文档](https://doc.dcloud.net.cn/uni-app-x/app-vapor.html)、[官方公告](https://ask.dcloud.net.cn/article/42377)，查证于 2026-09-07）——与旧调研口径一致；
  - 当前版本线 **HBuilderX 5.24.2026081301**（2026-08-13）；
  - **新减分项：uni-app x 的热更新（动态化）官方确认仍在开发中、后续版本提供**（DCloud 官方问答区口径，2026-07 5.21 正式版时代，查证于 2026-09-07）——旧文档未覆盖此点，对看重 OTA 的 Pictelio 是新增减分。
- **裁决**：不变（重写成本 + 引擎闭源随 HBuilderX 分发），**OTA 缺失使它在"第三引擎"竞赛中进一步落后于 Lynx**。

### 4.11 Taro（京东）—— 只补时效

- **复述旧结论**（`taro-migration-feasibility.md`，2026-07）：App 端 = React Native 换皮（RN 0.73 锁死、React 18、taro-components-rn 适配层），RN 端边缘维护（官方重心转鸿蒙），无技术优势。
- **2026-09 时效**：最新 release **v4.2.1**（2026-07-17；v4.2.0 2026-04-13，GitHub releases，查证于 2026-09-07）——4.2 线有维护推进，但**无任何证据表明 RN 端重新成为官方主线**（blog 仍以鸿蒙主题为主）。
- **裁决**：不变——**要走 React/RN 路线直接用 RN**。

---

## 5. 2025–2026 新出现候选（主动扫描结果）

| 候选 | 性质 | 状态（2026-09-07） | 与 Pictelio 的关系 |
|------|------|--------------------|--------------------|
| **Skip**（skip.tools/skiptools） | Swift→Kotlin 转译器：SwiftUI 代码转译为 Kotlin + Jetpack Compose，两端都渲染原生控件 | **2026-01 全量开源**（[InfoQ 报道](https://www.infoq.com/news/2026/01/swift-skip-open-sourced/)），许可证 **MPL-2.0**（GitHub API 查证），3.2k stars，pushed 2026-08-29 | 面向 iOS-first 的 Swift 团队；TS 资产 0% 复用；Android 端=Compose 原生。**与 Pictelio 技术栈无交集，仅记录在案** |
| **Wails v3** | Go + 系统 WebView（Electron/Tauri 同类） | v3.0.0-beta.5（2026-08-07），Android experimental（§3.1） | WebView 系观察项 |
| **Servo / Verso** | Rust 浏览器引擎 / 可嵌入内核 | 活跃；Tauri 集成实验（§3.4） | 远期"WebView 替代内核"期权 |
| **KuiklyUI-AI** | KuiklyUI 官方 AI 辅助工具仓库 | 2026-08 创建（Tencent-TDS） | 非引擎；反映 KuiklyUI 官方仍在加码 |
| **Sparkling / Miso** | Lynx 上层 App 框架（TikTok）/ Haskell flavor（社区） | 已在 `lynx-pure-engine-analysis.md` §7 覆盖 | 非新引擎，Lynx 生态内部选项 |
| **Shorebird**（Flutter Dart 补丁 OTA） | 第三方 Flutter 热更新服务 | **本报告未深查，仅记录存在** | 若未来走 Flutter 才相关 |

**扫描结论**：2025–2026 没有出现"全新范式"的 Android 动态化引擎；行业格局是存量玩家（RN/Flutter/CMP/Lynx/Kuikly/uni-app x）的成熟化竞赛 + WebView 系的安全/内核升级（Tauri+Verso、Servo 复兴）。对"低成本复用 Web/SolidJS 资产"这一 Pictelio 核心诉求，**没有新解法**。

---

## 6. OTA / 动态化合规专节（Google Play 政策口径）

**政策原文**（Google Play Developer Program Policy「设备与网络滥用」）：应用不得在审核完成后从 Google Play 以外来源下载可执行代码（dex/native so），**但"在虚拟机或解释器中运行、且经由其间接访问 Android API 的代码"不受此限**（如 WebView/浏览器中的 JavaScript）。（[政策页](https://support.google.com/googleplay/android-developer/answer/17517561)、[Device and Network Abuse 条款](https://support.google.com/googleplay/android-developer/answer/16559646)，查证于 2026-09-07）

由此推导各候选的 OTA 合规分级：

| 动态化形态 | 代表 | Play 合规判定 |
|-----------|------|---------------|
| JS bundle 下发（JS 引擎解释执行） | Capacitor/WebView SPA、Lynx（PrimJS）、RN（Hermes）、NativeScript（V8）、uni-app（vue2 老 js 版） | ✅ **interpreter 例外明确覆盖**，业界惯例（RN 热更新生态）；注意 CodePush 托管服务已退役（2025-03-31，[Microsoft Learn](https://learn.microsoft.com/en-us/appcenter/retirement)），需自建/Expo Updates |
| Dart AOT 补丁（Shorebird 类） | Flutter | ⚠️ 灰色：依赖"解释器/VM"例外对 Dart VM 快照的适用性解释，无 Google 明文背书 |
| Kotlin→dex / so 动态下发 | **KuiklyUI 动态化**（Shiply 平台）、ArkUI-X 鸿蒙式动态发布 | 🔴 **不落入例外，属政策红线**；腾讯内部经 Shiply 使用的合规前提（自有分发/审核通道）与第三方 Play 上架应用不同 |
| 无动态化 | CMP/MAUI/Kuikly AOT/Skip | ✅（无此能力即无此风险，但也失去 OTA） |

**Pictelio 特殊性**：实际经 GitHub Releases 分发 APK（不经 Google Play 审核），上述约束弱化为"自担安全责任"。但若未来上架 Play，**当前 Lynx TS bundle OTA 路径在例外覆盖内，而任何 dex 级动态化（Kuikly/ArkUI-X 模式）将不可用**——这直接影响第三引擎筛选。

---

## 7. 与旧调研的差异 / 更新汇总

| # | 旧结论（出处） | 2026-09-07 复核结果 | 判定 |
|---|----------------|---------------------|------|
| 1 | WebF 因 GPL-3.0 一票否决（先验裁决） | `openwebf/webf` 现行 LICENSE 仍为 GPL-3.0（0.24.19，2026-03-20） | **否决维持** |
| 2 | KuiklyUI（腾讯）纯原生控件渲染，但动态化能力未开源（先验裁决） | 动态化已于 2025 年随全面开源推进：现行 README 明示"支持编译成动态化产物"；但分发管控依赖 Shiply 平台，且 dex 下发模式撞 Play 红线；许可证为自定义宽松协议（非 OSI 标准文本） | **结论需更新**：能力已开源，但合规与生态判定不变（不适合 Pictelio） |
| 3 | 主要候选收敛为 Flutter / RN / Compose Multiplatform（+WebView 系/Lynx）（先验裁决） | 收敛成立；本轮补充第四类：**KuiklyUI（动态化原生）与 ArkUI-X（华为系）**，及 WebView 系的 Wails/Verso 观察项 | **收敛维持并扩充** |
| 4 | Taro RN 端边缘维护（taro 调研 §4.2） | v4.2.1（2026-07-17）有版本推进，RN 端仍非主线 | 不变 |
| 5 | uni-app x 蒸汽模式 Android 需 HBuilderX 5.21+（uniapp-x 调研 §3.1） | 三平台蒸汽已全发布（鸿蒙 5.0+/iOS 5.11+/Android 5.21+），当前 5.24（2026-08-13）；**热更新仍在开发中**（新增减分） | 更新（OTA 维度） |
| 6 | Tauri v2 移动端 2024-2025 才稳定（tauri 调研 §6.3） | tauri 2.11.5 / wry 0.56.1；新增 Verso(Servo) 实验后端动向 | 更新（内核期权） |
| 7 | RN 需按 New Architecture 评估（taro 调研 §6.1 桥成本） | 0.82（2025-10）起旧架构不可用，0.87 现行——该评估维度已无意义 | 更新（收敛为既成事实） |
| 8 | （旧调研未覆盖）NativeScript、Skip、Wails、Servo、ArkUI-X 版本线 | NS 9.x 复兴且官方列 Solid flavor；Skip 2026-01 全开源（MPL-2.0）；ArkUI-X 6.0 但生态弱 | 新增 |
| 9 | （先验背景）Crosswalk / Kraken 生存状态 | Crosswalk 2017-02 停更（末版 23）；Kraken 最后提交 2022-12-30 | 死亡确认 |

---

## 8. 结论：Pictelio 第三引擎视角下的全景排序

1. **继续不可行区**：WebF/Web 挂 Flutter（GPL）、Crosswalk/Kraken（死亡）。
2. **技术上可行但零收益区**：Cordova/Ionic、裸 WebView 自研 shell、GeckoView（包体代价）、MAUI/Qt/Avalonia（异构栈）。
3. **"重写 UI 换原生渲染"区**（Pictelio 已有 Lynx 承担此诉求，第三引擎再入无增量）：Flutter（Dart）、RN（React）、CMP（Kotlin）、KuiklyUI（Kotlin+Play 红线）、ArkUI-X（生态弱）、uni-app x（OTA 缺）、Taro（RN 换皮）。
4. **WebView 系内升级区**（UI 100% 保留）：Tauri v2（安全升级但不可嵌入现有工程）、Wails v3（Android 未熟）。
5. **观察区**：NativeScript 9.x（唯一 Solid flavor，成熟度未验证）、Servo/Verso（嵌入式内核期权）、Skip（无关但记录）。

**一句话**：截至 2026-09-07，除 Capacitor 与 Lynx 之外，**不存在第三个"能以合理成本承载 Pictelio 现有 SolidJS 资产 + Referer 图片代理 + JS bundle OTA"的 Android client 方案**；若未来被迫二选一，WebView 系内选 Tauri（保资产换安全），非 WebView 系里排序为 RN > CMP/Kuikly > Flutter（重写成本与 OTA 合规综合），NativeScript 作为唯一的 Solid 语法亲和项保持低频观察。

---

## 附录：信息来源（全部查证于 2026-09-07）

**GitHub API（gh CLI，仓库元数据/releases）**
- react/react-native（v0.87.1，2026-08-26，MIT）；flutter/flutter（pushed 2026-09-06，BSD-3-Clause）；JetBrains/compose-multiplatform（v1.12.0，2026-08-25，Apache-2.0）；dotnet/maui（10.0.100，2026-08-20，MIT）；ionic-team/capacitor（8.5.1，2026-08-31，MIT）；apache/cordova-android（rel/15.1.0，2026-07-22，Apache-2.0）；apache/cordova-cli（pushed 2026-09-03，Apache-2.0）；ionic-team/ionic-framework（v9.0.2，2026-09-02，MIT）；tauri-apps/tauri（tauri-v2.11.5，2026-07-01，Apache-2.0）；tauri-apps/wry（wry-v0.56.1，2026-08-13）；NativeScript/NativeScript（MIT，pushed 2026-09-05）；NervJS/taro（v4.2.1，2026-07-17）；lynx-family/lynx（4.0.2，2026-09-04，Apache-2.0）；openkraken/kraken（最后提交 2022-12-30）；openwebf/webf（GPL-3.0，0.24.19，2026-03-20）；Tencent-TDS/KuiklyUI（2.27.0，2026-09-03，NOASSERTION 自定义许可）；arkui-x/*（最近推送 2026-06，Apache-2.0）；skiptools/skip（MPL-2.0，pushed 2026-08-29）；servo/servo（MPL-2.0，pushed 2026-09-06）；mozilla-mobile/firefox-android（archived=true，最后推送 2024-06-17，MPL-2.0）

**官方版本渠道**
- Flutter stable：https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json（stable 3.47.2，2026-08-27）
- GeckoView：https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview/maven-metadata.xml（155.0.20260903215306）
- npm：cordova@13.0.0；@ionic/portals@0.13.0；@nativescript/core@9.1.1；@tauri-apps/cli@2.11.4；@dcloudio/uni-app 2.0.2-5020420260813001（2026-08-13 构建）

**官方文档/博客/政策**
- Google Play 政策：https://support.google.com/googleplay/android-developer/answer/17517561 ；https://support.google.com/googleplay/android-developer/answer/16559646
- RN New Architecture：https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here ；https://reactnative.dev/blog/2025/10/08/react-native-0.82
- CMP iOS stable：https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/
- MAUI 平台要求：https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms?view=net-maui-10.0 ；https://learn.microsoft.com/en-us/dotnet/core/compatibility/maui/11/android-minimum-api-level
- App Center/CodePush 退役：https://learn.microsoft.com/en-us/appcenter/retirement
- cordova-android 15.1.0 公告：https://cordova.apache.org/announcements/2026/07/22/cordova-android-15.1.0.html
- NativeScript 9.0/9.1：https://blog.nativescript.org/nativescript-9-announcement/ ；https://blog.nativescript.org/nativescript-9-1-announcement/ ；flavors（含 Solid）：https://docs.nativescript.org/
- KuiklyUI：README/LICENSE（Tencent-TDS/KuiklyUI，main 分支）；Roadmap 2025 存档：https://kuikly.tds.qq.com/Blog/roadmap2025.html ；官网 https://kuikly.tds.qq.com/
- uni-app x 蒸汽模式：https://doc.dcloud.net.cn/uni-app-x/app-vapor.html ；https://ask.dcloud.net.cn/article/42377
- Tauri↔Verso：https://v2.tauri.app/blog/tauri-verso-integration/ ；NLnet：https://nlnet.nl/project/Tauri-Servo/
- Wails v3：https://v3.wails.io/ ；https://v3.wails.io/status/
- Skip 全开源报道：https://www.infoq.com/news/2026/01/swift-skip-open-sourced/
- Crosswalk 死亡口径：项目 2017 年停止发布（末版 23/23.53.589.x），多方社区文档交叉确认

**本仓库既有调研（复述结论出处）**
- `docs/research/taro-migration-feasibility.md`、`docs/research/tauri-migration-feasibility.md`、`docs/research/uniapp-x-migration-feasibility.md`、`docs/research/lynx-migration-feasibility.md`、`docs/research/lynx-pure-engine-analysis.md`、`docs/research/vue-lynx-production-readiness.md`

**未能核实/存疑项（明示）**
- GeckoView 嵌入下 webRequest 改写请求头承载图片 Referer 的实际成熟度（需 PoC）
- NativeScript Android 精确最低 API（官方首页未列，正文已标注）
- Shorebird（Flutter OTA）2026 现状（未深查，仅记录存在）
- Qt 6 当前版本线（未做 2026-09 核实，正文仅定性）
