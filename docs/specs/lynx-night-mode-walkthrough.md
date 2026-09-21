# lynx 夜间模式 · 发版前真机走查矩阵（#692）

> 票：[#692](https://github.com/a1121611810/Pictelio/issues/692)；spec [docs/specs/lynx-night-mode.md](./lynx-night-mode.md)（§4.8 原生接线与机器防线）；决策 [ADR-0180](../adr/ADR-0180-lynx-dark-mode.md) D6 / D7。
> 定位：**机器防线的补位，不是重复**——契约测试只证明「读点存在、键名同源、色值同源」（`darkModeJavaContract.test.ts`），证明不了「设备上真的这么显示」：Lynx 样式引擎的复合选择器解析、Android 平台 splash 的持久化语义、厂商 ROM 差异三段都不在单测射程内。
> 环境：开发机 `emulator-5554`（AVD `pictelio_ui`，Android 14 / API 34）为主设备；API 28–30 设备用于 §T3-5 残留记录（minSdk = 28）。
> 前置：debug 构建（`pnpm dev:android` 或 `pnpm build:android` + `pnpm cap:sync`）——`run-as` 直改 prefs 需要 debug 包。

## 0. 记录约定

- **截图命名**：`docs/research/assets/lynx-night-mode-walkthrough/<矩阵>-<场景>.png`
  - T2：`t2-sky-light.png` / `t2-sky-dark.png`（6 主题 × 亮暗 = 12 张）
  - T3：`t3-statusbar-<场景>.png` / `t3-splash-<场景>.png`
  - T4：`t4-viewer-dark.png` / `t4-restrict-dark.png` / `t4-novel-dark.png` / `t4-skeleton-dark.png` / `t4-scrollbar-dark.png`
- **执行结果落档**：新建 `docs/research/lynx-night-mode-walkthrough-acceptance.md`，**仿 [lynx-systembars-t4-acceptance.md](../research/lynx-systembars-t4-acceptance.md) 先例**——环境/分支/commit 头 + 逐项断言表（含「实测」与「判定」列）+ 截图相对路径 + 结论段；**落档后关闭 [#692](https://github.com/a1121611810/Pictelio/issues/692)**。
- **判定列口径**：✅ 通过 / ⚠️ 接受项（记录即可）/ ❌ 失败（当场建 issue 并在结论段引用）。
- **环境记录**（每轮开头一行）：`adb shell getprop ro.build.version.sdk` + `adb shell settings get secure ui_night_mode`（系统侧亮暗：0=亮 / 1=暗 / 2=自动）+ APK 版本与 commit。
- **色值 oracle 只有一份**：期望色一律读 `packages/app-lynx/src/styles/tokens.css` 对应 `.theme-X.dark` 块（**禁止**在本文或落档报告里抄第二份色值——`tests/palettes-drift.test.ts` 已把「产物 ≡ 生成脚本」锁死，文档抄写只会制造漂移源）。

## 1. 命令骨架

```bash
# ── 环境 ──────────────────────────────────────────────────────────────
adb devices                                        # 期望 emulator-5554 在线
adb shell getprop ro.build.version.sdk
adb shell settings get secure ui_night_mode        # 系统侧亮暗

# ── 系统亮暗切换（两条通道，按 API 取用）─────────────────────────────
adb shell cmd uimode night yes|no                  # 多数 ROM API 29+；不支持时用下面一行
adb shell settings put secure ui_night_mode 1|2    # 兜底通道（需重启 app 才生效）

# ── 三态设置键 settings_dark_mode（debug 包）──────────────────────────
# 先经 UI 在「我的 → 外观」切一次（保证键已写入），再直读/直改：
adb shell run-as io.pictelio.app cat shared_prefs/CapacitorStorage.xml | grep -A1 settings_dark_mode
adb shell run-as io.pictelio.app sh -c \
  "sed -i 's/name=\"settings_dark_mode\">[a-z]*/name=\"settings_dark_mode\">dark/' shared_prefs/CapacitorStorage.xml"
# ⚠️ 直改 prefs **绕过 JS 通知路径**（applyDarkModePreference 不会触发）——只用于 §T3-4 的滞后窗口
#    确认；「正常路径」断言一律走 UI 切换。

# ── 冷启动 / 截图 ─────────────────────────────────────────────────────
adb shell am force-stop io.pictelio.app
adb shell am start -n io.pictelio.app/.MainActivity
adb exec-out screencap -p > t3-splash-xxx.png      # splash 首帧窗口 < 1s：需轮询抓帧或录屏
adb shell screenrecord --time-limit 5 /sdcard/splash.mp4 && adb pull /sdcard/splash.mp4

# ── 可选机器佐证（状态栏图标位）───────────────────────────────────────
# isAppearanceLightStatusBars 无稳定的 dumpsys 字段约定：执行时先跑下面这条确认本 ROM 是否打印，
# 打印不出就以截图目检为准（不要以「命令没输出」当作 ❌）。
adb shell dumpsys window | grep -i appearance
```

## 2. T2 矩阵 —— 6 主题 × 亮/暗（复合选择器载重假设）

**本轮头号断言**：`.theme-X.dark` **复合选择器在 Lynx 样式引擎实际生效**（这是 T2 的载重平台假设：CSS 级覆盖靠特异性 (0,2,0) > (0,1,0)，Web 侧成立不等于 Lynx 侧成立）。若某一主题暗色下只有部分角色变暗（primary 变了、surface 没变），即复合类未整体命中 → ❌ 建 issue。

| # | 主题 | 操作 | 期望 | 截图 |
|---|---|---|---|---|
| T2-1 … T2-6 | sky / violet / pink / green / orange / teal | 「我的 → 外观」切至该主题色 → 外观模式切「亮色」→ 截图；再切「暗色」→ 截图 | 亮/暗两态整树换色（顶栏、卡片、FAB、列表底、文本层同步）；**界面无处残留亮色 surface** | `t2-<theme>-light.png` / `t2-<theme>-dark.png` |

- **像素采样（可选但推荐，作为「真是这套色板」的证据）**：`screencap` 取页面大面积区域中心点，与该主题 `.theme-X.dark` 的 `--md-surface` 比对（worked example：`.theme-sky.dark --md-surface = #101418`，其余主题从 `tokens.css` 读）。取色脚本可复用 `scripts/audit-real-interaction/analyze_rec.py` 一族（必要时临时扩一个单图取色入口，不要提交进 main）。
- **交叉项**：每主题暗色下另确认**主题色色块预览**显示的是该主题暗色 primary（`appearanceClasses` 同源，Me 页色块与整树不能分叉）。
- 判定：12 张全 ✅ 才过；任一主题暗色「半吊子」（部分角色未覆盖）→ ❌。

## 3. T3 矩阵 —— 状态栏图标 / splash / plate / 低版本残留

### T3-1 状态栏图标可读性（4 组合）

| # | 外观模式 | 系统亮暗 | 操作 | 期望 | 截图 |
|---|---|---|---|---|---|
| T3-1a | 跟随系统 | 系统亮 | `cmd uimode night no` | 状态栏**深色**图标/时钟，在 surface 底色上可读 | `t3-statusbar-system-light.png` |
| T3-1b | 跟随系统 | 系统暗 | `cmd uimode night yes` | 状态栏**浅色**图标，可读 | `t3-statusbar-system-dark.png` |
| T3-1c | **手动暗** | 系统亮 | UI 切「暗色」（系统保持亮） | 图标**浅色**（手动优先于系统）——这是 #692 接线前必错的一项 | `t3-statusbar-manual-dark.png` |
| T3-1d | **手动亮** | 系统暗 | UI 切「亮色」（系统保持暗） | 图标**深色** | `t3-statusbar-manual-light.png` |

- 即时性：切完不重启即应生效（JS 通知 `applyDarkModePreference` 路径）；`cmd uimode` 切换应由 `onConfigurationChanged` 原地响应、Activity 不重建（配置已声明 `uiMode`）。
- 全屏模式（`settings_fullscreen_mode=true`）下状态栏隐藏 → 跳过外观下发；**退出全屏后**状态栏外观必须立即按当前三态重设（`syncStatusBarHidden` 闩锁修复项，别漏测）。

### T3-2 splash 冷启动（4 组合）

| # | 外观模式 | 系统亮暗 | 操作 | 期望（最早帧底色） | 截图/录屏 |
|---|---|---|---|---|---|
| T3-2a | 跟随系统 | 亮 | force-stop → start | 亮色 splash（`values-night` 主轨未命中 → 亮色资源） | `t3-splash-system-light.png` |
| T3-2b | 跟随系统 | 暗 | force-stop → start | **暗色** splash（面 `#101418`） | `t3-splash-system-dark.png` |
| T3-2c | 手动亮 | 暗（反配置） | UI 切亮 → force-stop → start | **亮色** splash（手动覆盖生效，不再读系统） | `t3-splash-manual-light.png` |
| T3-2d | 手动暗 | 亮（反配置） | UI 切暗 → force-stop → start | **暗色** splash | `t3-splash-manual-dark.png` |

- 反配置两项（T3-2c/d）是 #692 的**验收核心**：接线前这两项必然失败。
- splash 显示窗口短：`screenrecord` 整段后抽帧；若模拟器编码器故障（本仓库有先例，见 `docs/research/real-interaction-audit.md` §pictelio_low），改 `screencap` 轮询（~40ms 间隔）。

### T3-3 plate（图标底板）视觉效果

| # | 场景 | 期望 | 判定口径 |
|---|---|---|---|
| T3-3a | 暗色 splash | launcher 前景图标下的圆盘可见（暗 plate `#1C2024` ≠ 暗面 `#101418`，离底有差） | 目检圆盘边界可辨 |
| T3-3b | 亮色 splash | 圆盘**不可见**（亮 plate == 底色，**有意设计**：前景资产自带白底，同色才无可见边） | 目检无圆盘边 = ✅（不是缺陷） |

- plate 接线依赖父主题 `Theme.SplashScreen.IconBackground`（缺该父链时 plate 色对系统 splash 无效）——本项即该父链的**设备端证据**。
- **T3-3c（已登记差异，走查定夺）**：系统跟随模式（主轨 `AppTheme.NoActionBarLaunch`）的 plate **未接线**——其父保持 `Theme.SplashScreen`。原因：base `Theme.SplashScreen.IconBackground` 附带 `android:windowBackground=compat_splash_screen` 与 `splashScreenIconSize` 覆写，换父会改变 API 28–30 compat 渲染路径（`Theme.SplashScreen.Light/Dark` 两支仅经 API 31+ 平台通道使用，无此影响，故已接线）。走查时对比「manual 暗色 splash（有圆盘）」vs「system 暗色 splash（无圆盘）」差异，决定是否将主轨一并切换（若切换，需补 <31 回归项）。

### T3-4 改设置 → 重启的一次性滞后窗口

| # | 路径 | 操作 | 期望 |
|---|---|---|---|
| T3-4a | **正常路径（UI 切换）** | UI 切「暗色」→ force-stop → 冷启动 | 首次冷启动 splash 即为暗色——**无滞后**（设置变更当场重设持久化主题 + `onResume` 兜底） |
| T3-4b | **绕过 JS 路径（记录项）** | 强杀后 `run-as` 直改 prefs 为 `dark` → 冷启动 #1 → 再冷启动 #2 | #1 仍显旧持久化主题、#2 正确——**一次性滞后确认为平台持久化口径**（`setSplashScreenTheme` 管下一次冷启动）；属接受项，记录即可 |

- T3-4b 的目的不是求修，而是把「滞后窗口的边界」写成可复现的事实：滞后只出现在**设置变更未走 JS 通知路径**的场景（直改 prefs / 变更后进程未再经历 `onResume`）。

### T3-5 API 28–30 残留（接受项）

| # | 场景 | 操作（API 28–30 设备） | 期望 | 判定 |
|---|---|---|---|---|
| T3-5a | 手动暗 + 系统亮 | UI 切暗 → force-stop → 冷启动 | 最早帧按**系统**解析（残留浅色帧）后进入暗色界面 | ⚠️ 接受（平台无 `setSplashScreenTheme` 通道，`minSdk = 28` 内无解） |
| T3-5b | 手动亮 + 系统暗 | UI 切亮 → force-stop → 冷启动 | 最早帧按系统解析（残留深色帧）后进入亮色界面 | ⚠️ 接受 |
| T3-5c | 跟随系统 | 系统亮 / 暗各一次 | 与系统一致（主轨全 API 覆盖） | ✅ 必须通过 |

## 4. T4 矩阵 —— 硬编码浅色值修复的设备端确认（5 项，暗色截图）

| # | 区域 | 落点 | 操作 | 期望 | 截图 |
|---|---|---|---|---|---|
| T4-1 | 图片查看器 | 插画详情多图查看器 | 暗色下打开多图作品 → 逐图翻页 | 查看器底/页码/关闭控件在暗色下均可读；无亮色残留面板 | `t4-viewer-dark.png` |
| T4-2 | R18 遮罩 | 受限卡（列表）+ `RestrictOverlay`（详情） | 暗色下浏览含 R-18 条目的列表 → 进详情 | 遮罩层与文案对比度可读（`--colorOverlayForeground` 路径，T4 迁移项） | `t4-restrict-dark.png` |
| T4-3 | 小说正文 | `NovelDetail` 正文页 | 暗色下打开小说正文 → 滚动若干屏 | 正文/标题/分隔线/翻译面板走暗色 token，无亮色残留 | `t4-novel-dark.png` |
| T4-4 | skeleton | 页级首载骨架（列表/详情 shimmer） | 暗色 + 冷缓存（清数据或首访页面）抓首载瞬间 | 骨架块在暗色 surface 上可见且不刺眼（亮色 shimmer 直接闪白 = ❌） | `t4-skeleton-dark.png` |
| T4-5 | 滚动指示条 | `ScrollIndicator` | 暗色下滚动长列表并抓帧 | 指示条为该主题 `.theme-X.dark` 的 `--md-outline` + 35% alpha（sky ≈ `rgba(140,145,152,0.35)`，其余读 `tokens.css`） | `t4-scrollbar-dark.png` |

- 冷缓存技巧：`adb shell pm clear io.pictelio.app` 会清登录态——优先改用 force-stop + 未缓存页面（例如首访的分类页）或先记录后清理。
- 已知**接受项**（不在本轮修复范围，见 [#693](https://github.com/a1121611810/Pictelio/issues/693)）：暗色下输入框 placeholder 仍为亮色基线值（Lynx 平台属性 `placeholder-color` 不解析 `var()`）——走查时目检记录对比度即可，**不判 ❌**。

## 5. 收口

1. 全部断言逐项落档 `docs/research/lynx-night-mode-walkthrough-acceptance.md`（含 ⚠️ 接受项清单与理由）；
2. ❌ 项当场建 issue 并在报告结论段引用；
3. 关闭 [#692](https://github.com/a1121611810/Pictelio/issues/692)（其「待办 2：splash 全量真机走查」即本矩阵）；
4. 结果与 ADR-0180 状态行的「真机走查 gate」对齐——干净通过则 gate 解除，否则 gate 保持并挂新 issue。
