# lynx 系统栏现状基线取证（Android 9 / 14 实测 + API 35/36 阻塞记录）

> 票 [#594](https://github.com/a1121611810/Pictelio/issues/594)（父地图 [#591](https://github.com/a1121611810/Pictelio/issues/591)：lynx 系统栏模式选型）。取证日期：2026-09-18。
>
> **被测包**：`apk/full/debug/app-full-debug.apk`（构建于 2026-09-18 01:26，`2adbdeea` 时代产物；系统栏相关代码自该 commit 至报告日零变更——LynxActivity 全程无任何 WindowInsets/statusBar 代码，证据有效）。默认引擎路由按 ADR-0164 落 LynxActivity，实测一致。

---

## 一、Android 14（API 34，AVD `pictelio_ui`，pixel_4 / 1080×2160 / 480dpi）

**截图**：`assets/systembars-baseline/api34-home.png`（推荐页）

| 项 | 实测值 | 来源 |
| --- | --- | --- |
| 状态栏 | `InsetsSource type=statusBars frame=[0,0][1080,72] visible=true`；**黑底白图标**（时钟/电量），外观仅 `LIGHT_NAVIGATION_BARS`、无 LIGHT_STATUS_BARS | `dumpsys window` |
| 导航条 | `InsetsSource type=navigationBars frame=[0,2088][1080,72]`、`flags=SUPPRESS_SCRIM`；白手势条 + **黑色底条** | `dumpsys window` |
| 应用窗口 | configFrame `[0,72][1080,2088]`（上下各让 72px） | `dumpsys window displays` |
| **LynxView 边界** | `0,0 - 1080,2016`（= **1080×2016**，恰好填满双栏之间；即 `getViewportSize` 语义 = 内容区撇除双系统栏） | `dumpsys activity top` |
| 顶栏与状态栏 | **零重叠**：「推荐」标题起于状态栏下方 | 截图 |
| FAB 与手势条 | FAB 在导航条上方内容区内，无压叠 | 截图 |

**定性结论**：API 34 上是**经典模式**——内容不延伸到系统栏下，零遮挡；但黑状态栏/黑底手势条与浅色 App UI 视觉割裂（即选型要打磨的现状）。**未被强制 e2e**（双门控的「设备 ≥15」条件不满足，与 #592 F1.1 一致）。

## 二、Android 9（API 28 = minSdk，AVD `pictelio_low`，pixel_4 / 720×1280 / 320dpi）

**截图**：`assets/systembars-baseline/api28-home.png`（登录页；该 AVD 无登录态）

| 项 | 实测值 | 来源 |
| --- | --- | --- |
| 状态栏 | **灰色独立条 + 深色图标**（48px），内容起于其下 | 截图 |
| 导航条 | **黑色独立条 + 三键导航**（返回/主页/多任务，浅色图标，48px）；`navigation_mode=null`（Android 9 无手势导航） | 截图 + `dumpsys window policy` |
| 应用窗口 | `app=720x1184`（总 insets 96px = 状态 48 + 导航 48） | `dumpsys window displays` |
| **LynxView 边界** | `0,0 - 720,1136`（= 720×1136，双栏之间） | `dumpsys activity top` |
| 顶栏与状态栏 | **零重叠** | 截图 |

**定性结论**：minSdk 级别同样是经典模式、零遮挡；状态栏呈**灰色**（主题缺省色，与黑白双栏构成三种割裂形态）——「着色/统一视觉」诉求在低版本的现实起点。附带验证：引擎降级提示（WebView 过旧 → 改用 Lynx，ADR-0153）在该级别正常展示。

## 三、API 35/36 实证：网络阻塞，留补做指引

**状态**：未完成。`system-images;android-36` 下载失败——`sdkmanager` 报 `Failed to download any source lists / IO exception while downloading manifest`；`dl.google.com` 直连、经本机代理（127.0.0.1:7897，http/https/socks5 三协议）全部失败（curl 000 / TLS exit 35 / http 502）；腾讯/中科大镜像路径 404；本机无其他存活代理端口。

**对结论的影响**：无关键影响——targetSdk 36 × Android 15/16 的强制 e2e 行为由官方文档双重门控锚定（#592 F1.1/F1.2，developer.android.com behavior-changes-15/16 原文），且 Android ≤14 实测已证明「设备 <15 不强制」这半边门控成立。**留待补做的实证**（网络可达 dl.google.com 时，任一会话可执行）：

```bash
# 1. 镜像（≈1.5GB）
sdkmanager "system-images;android-36;google_apis;arm64-v8a"
# 2. 建 AVD（注意：本机 cmdline-tools 12.0 解析不了 SDK XML v4，如报
#    "Package path is not valid" 需先用 Android Studio SDK Manager 装镜像或升级 cmdline-tools）
avdmanager create avd -n pictelio_api36 -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_4
# 3. 启动后装包取证：同 §一 方法（dumpsys window insets + activity top LynxView 边界 + 截图），
#    预期：LynxView 延伸到 0,0-1080,2160（顶栏被状态栏压住、FAB 贴手势条）
```

## 四、对 spec（#596）的输入

1. **insets 数值基线**：pixel_4-class API 34 = 状态 72px / 导航 72px；720p API 28 = 48/48（@320dpi 即 24dp/24dp）——insets 管线的值域参照。
2. **`getViewportSize` 现语义实证**：内容区 = 应用窗口 − 双系统栏（两级别均验证）；e2e 化后该返回值将变为全屏尺寸，ADR-0131 契约迁移是 spec 必答题。
3. **Android ≤14 无潜伏遮挡 bug**：三级别（9/14 + 文档覆盖 10-13）经典模式一致；强制 e2e 的破坏面仅存在于 Android 15+ 设备（文档锚定，待实证补做）。
4. **视觉割裂实证**：黑（API 34 顶）/ 灰（API 28 顶）/ 黑（双端底部）三种系统栏形态与浅色 UI 并存——「基底 e2e + 全屏开关」方案（#595）要消灭的正是这个。
