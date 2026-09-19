# T4 验收报告：lynx 系统栏策略（e2e 基底 + 全屏开关）

> 票 [#616](https://github.com/a1121611810/Pictelio/issues/616)（spec [docs/specs/lynx-systembars.md](../specs/lynx-systembars.md) §6）。验收日期：2026-09-19。
> 被测包：full debug APK（分支 feat/lynx-systembars @ 3f6fc6fd，bundle 经 `pnpm build:app-lynx` + `sync:app-lynx-bundle` 重建）。
> 方法 = #594 基线同款（`dumpsys window` insets + `dumpsys activity top` LynxView 边界 + screencap），截图见 `assets/systembars-t4/`。

## 一、Android 14（API 34，1080×2160）

| 断言 | 基线（#594） | 本验收 | 判定 |
| --- | --- | --- | --- |
| LynxView 边界 | 0,0-1080,**2016**（经典模式） | 0,0-1080,**2160**（全屏铺满） | ✅ e2e 生效（D1） |
| 状态栏区域视觉 | 黑色独立条 | **App surface 染色**，深色时钟/图标绘于其上（截图 `api34-e2e-home.png`） | ✅ D4 + Root padding |
| 导航条区域视觉 | 黑条 + 手势条 | surface 染色 + 手势条绘于其上 | ✅ |
| 顶栏遮挡 | 无（内容起于状态栏下） | 无（「推荐」标题让出安全区） | ✅ 零遮挡 |
| FAB 位置 | 抬离手势区 | 同基线（贴底但抬离）——D3 契约保持的视觉佐证 | ✅ |

## 二、全屏模式开关（API 34，D5）

| 场景 | 操作 | 结果 | 判定 |
| --- | --- | --- | --- |
| 冷启动重设 | `settings_fullscreen_mode=true` 写入 CapacitorStorage（run-as）→ force-stop → 重启 | `statusBars visible=false` + `navigationBars visible=false`；截图 `api34-fullscreen-clean.png`（无系统栏，轮播全 bleed） | ✅ onCreate 读键重设 |
| transient 唤出 | 顶部边缘下滑 | `statusBars visible=true` → 约 3s 后自动 `visible=false` | ✅ BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE |
| 关闭路径恢复 | 键改回 `false` → 重启 | `statusBars visible=true` 恢复 | ✅ |
| UI 拨动即时性 | store→native 调用链单测覆盖（settingsStore 92 例含 cb 失败回滚/模块缺失 warn）；Me 页实机拨动交真机批次 | 单测 + 冷启动实证组合覆盖 | ✅（残余：真机批次） |

系统在首次 immersive 时弹出「目前处于全屏模式」标准提示（transient 行为的官方佐证，截图 `api34-fullscreen-on.png` 于 #616 票）。

## 三、Android 9（API 28 = minSdk，720×1280，三键导航）

| 断言 | 基线（#594） | 本验收 | 判定 |
| --- | --- | --- | --- |
| LynxView 边界 | 0,0-720,**1136** | 0,0-720,**1280**（全屏） | ✅ compat 层 minSdk 生效 |
| 状态栏形态 | 灰色独立条 | surface 染色 + 深色图标（D4） | ✅ |
| 三键导航形态 | 黑色独立条 | surface 染色 + 深色三键图标，**可读无遮挡**（D6 缺省形态；截图 `api28-e2e-home.png`） | ✅ |
| 内容遮挡 | 无 | 无（登录卡完整可见） | ✅ |

## 四、API 36（Android 16）——已补测（2026-09-19，ALL PASS）

本地 dl.google.com 不可达，改经 GitHub Actions runner（外网无障碍 + KVM）跑断言式验收 workflow（`.github/workflows/sysbars-acceptance.yml`，手动触发；run 35416169153，约 7 分钟）。**五组断言全绿**：

| 断言 | 实测 | 判定 |
| --- | --- | --- |
| A1 LynxView 铺满全屏 | 0,0-1080,**2280**（pixel_4 API 36 全屏） | ✅ |
| A2 系统栏 inset 源可见（e2e 基底） | statusBars [0,0][1080,66] + navigationBars [0,2214][1080,66]，SUPPRESS_SCRIM | ✅ |
| A3 全屏冷启动 | 双系统栏 `visible=false`（4/4 行） | ✅ |
| A4 transient 唤出 | 边缘下滑 `visible=true` → ~3s 自动 `visible=false` | ✅ |
| A5 关闭恢复 | 键改 false 重启 → 双系统栏 `visible=true` | ✅ |

截图：`shot1-e2e-home.png`（e2e 基底）、`shot2-fullscreen.png`（全屏模式）。**Android 16 强制边到边 + 主动开启 + 全屏开关在最高目标级别全部实证**。workflow 成为常驻 QA 工具（#594 §三 挂账的永久补做通道）。

## 五、API 35/36 挂账之外的说明与预览

- **web-core 预览**：safeArea 恒 0（单测 4 例）→ 布局与历史形态等价；契约测试钉住消费面。

## 六、结论

T1-T3 交付在 Android 14 / Android 9 / **Android 16** 三级别全部验收通过：e2e 基底生效（LynxView 全屏）、系统栏区域染 surface 色（着色诉求达成）、零遮挡、FAB/几何契约不变（D3）、全屏开关冷启动 + transient + 恢复全链可用。**ADR-0168 转 Accepted**。残余：Me 页 UI 拨动的实机手指验收（模拟器输入注入对 scroll-view 滚动不生效——同真机 tap 失效家族；功能链路已由单测 + 冷启动实证 + 模板/契约测试三通道覆盖），随下次真机批次收口。
