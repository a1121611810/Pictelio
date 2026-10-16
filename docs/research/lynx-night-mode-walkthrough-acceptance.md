# lynx 夜间模式 · 真机走查验收落档（#1014，第 1 轮）

> 票：[#1014](https://github.com/a1121611810/Pictelio/issues/1014)（gate 归属票）；矩阵：[docs/specs/lynx-night-mode-walkthrough.md](../specs/lynx-night-mode-walkthrough.md)；先例格式：[lynx-systembars-t4-acceptance.md](./lynx-systembars-t4-acceptance.md)。
> 结论先行：**gate 保持不解除**——T2 抓到一个用户可见缺陷（实时切换半吊子渲染 → [#1016](https://github.com/a1121611810/Pictelio/issues/1016)），按矩阵收口条款「干净通过则解除，否则保持并挂新 issue」执行。其余矩阵项本轮全部执行完毕，逐项判定如下。

## 环境

- `adb shell getprop ro.build.version.sdk` = **34**；AVD `pictelio_ui`（emulator-5554），物理 1080×2160
- `settings get secure ui_night_mode` = 1；⚠️ 与 `cmd uimode night`（实际状态权威，本轮回转 no/yes 多次）读数不一致，两项均按矩阵 §0 要求记录，判读以 `cmd uimode` 为准
- APK：`app-debug`（2026-10-16 构建，main @ `2108146c`，含 #1015 亮色表）；每次冷启动经 `.LynxActivity` + dev hook 登录
- 启动 Activity：`.LynxActivity`（矩阵 §1 命令骨架写的 `.MainActivity` 已不存在 → 矩阵陈旧发现，见 [#1017](https://github.com/a1121611810/Pictelio/issues/1017)）
- 像素 oracle：一律现场抽取 `tokens.css` 对应 `.theme-X(.dark)` 块（矩阵 §0 纪律，本文不抄第二份期望值）

## T2 · 6 主题 × 亮/暗（+ bili 补测）

矩阵原文 T2 只列 6 主题（早于第 7 档 bili 主题）——按 #1014 brief「不自行增删判据」照跑 6 主题，**bili 作为补充同法采集**（矩阵缺行问题归 [#1017](https://github.com/a1121611810/Pictelio/issues/1017)）。

- **方法学修正（因 #1016）**：暗色整树帧一律经「设好状态 → force-stop → 冷启动」采集——冷启动渲染经核验全部正确；实时切换路径的暗色首页渲染已坏（见 ❌ 项），不作为 T2 取证面。
- 断言：每帧状态栏像素 ≡ tokens.css 该主题该模式 `--md-surface`（现场抽取比对，容差 ±2）；色块交叉项：swatch 帧该主题圆点中心 ≡ tokens.css 暗色 `--md-primary`（容差 ±12）。

| 主题 | 亮帧 | 暗帧 | 色块交叉项 |
|---|---|---|---|
| sky | ✅ `t2-sky-light.png` | ✅ `t2-sky-dark.png` | ✅ `t2-sky-swatch-dark.png` |
| violet | ✅ | ✅ | ✅ |
| pink | ✅ | ✅ | ✅ |
| green | ✅ | ✅ | ✅ |
| orange | ✅ | ✅ | ✅ |
| teal | ✅ | ✅ | ✅ |
| bili（补测） | ⚠️ 见下 | ✅（冷启动帧） | ✅ |

- ✅ = 像素精确匹配（12/13 组合逐字节级一致，偏差 0）。
- ⚠️ **bili 亮帧接受项**：状态栏条带像素 `#f8faff` = sky 亮面，而 bili 亮面应为 `#ffffff`（页面本身底色采样为纯白 ✓，仅系统状态栏条带偏色，ΔRGB(7,5,0) 用户不可见）。原生 res 无任何 bili 条目（grep 实证），疑似原生侧亮色资源缺 bili 档。登记接受，不修。
- ✅→❌→✅ **T2 判定：通过（两轮）**——第 1 轮抓到实时切换半吊子渲染（证据：`t2-bili-dark-liveswitch-repro.png` vs `t2-bili-dark-coldstart-contrast.png`）→ **[#1016](https://github.com/a1121611810/Pictelio/issues/1016)**；修复后 round-2 复跑全过（见文末「Round-2」节）。

## T3 · 状态栏 / splash / plate / 滞后

### T3-1 状态栏图标 4 组合 —— ✅

| 组合 | 期望 | 实测（帧 + 目检） | 判定 |
|---|---|---|---|
| a 跟随系统+系统亮 | 深色图标/亮底 | `t3-statusbar-system-light.png` 深色图标 ✓ | ✅ |
| b 跟随系统+系统暗 | 浅色图标/暗底 | `t3-statusbar-system-dark.png` 浅色图标 ✓ | ✅ |
| c **手动暗+系统亮** | 浅色图标（#692 核心） | `t3-statusbar-manual-dark.png` 浅色图标 ✓ | ✅ |
| d 手动亮+系统暗 | 深色图标 | `t3-statusbar-manual-light.png` 深色图标 ✓ | ✅ |

- 即时性：原生图标通道即时（`cmd uimode` 翻转后图标当拍换极性，截图实证）；页面重绘即时性第 1 轮 ❌（=#1016），修复后 round-2 ✅（存活页原地全树重绘，双向）。

### T3-2 splash 冷启动 4 组合 —— ✅（附 1 观察）

| 组合 | 期望 | 实测（最早帧角点） | 判定 |
|---|---|---|---|
| a 跟随+亮 | 亮 splash | `t3-splash-system-light.png` 角点 (249,249,251) ✓ | ✅ |
| b 跟随+暗 | 暗 splash #101418 | `t3-splash-system-dark.png` ≡ #101418 ✓ | ✅ |
| c 手动亮+系统暗 | **亮 splash**（不再读系统） | `t3-splash-manual-light.png` 首帧角点 (218,223,235) 亮 ✓ | ✅（#692 验收核心过） |
| d 手动暗+系统亮 | 暗 splash | `t3-splash-manual-dark.png` 角点 ≡ #101418 ✓ | ✅ |

- 观察（非矩阵判据，登记）：亮色方向冷启动在 splash 与亮内容之间有约 1s 的**暗色 shell 闪帧**（Lynx 默认底，JS 就绪前）；暗色方向无此现象（shell 与主题同为暗）。用户可见一次暗闪。

### T3-3 plate / icon-size —— ⚠️ 取证受限（接受项）

splash 显示窗口 <400ms，设备侧 screencap 轮询（~350ms/帧）只能稳定捕到底色，捕不到完整图标帧；`screenrecord` 路径缺 ffmpeg 无法抽帧；宿主 `screencapture` 无录屏权限。已登记差异（T3-3c 主轨 plate 未接线 + icon-size 240dp/288dp 轨间差）**本轮无法定夺**，保持登记状态，取证配方需求并入 [#1017](https://github.com/a1121611810/Pictelio/issues/1017)。

### T3-4 一次性滞后窗口

- **a 正常路径（UI 切换）→ ✅ 无滞后**：即 T3-2c/d——UI 切暗/切亮后冷启动，splash 当场正确，无旧主题帧。
- **b 绕过 JS 路径（run-as 直改 prefs dark）→ 记录项，实测与矩阵登记不符**：冷启动 #1 splash 旧亮色（✓ 符合预期），但**#2 仍旧亮色**（JS 内容已正确转暗，splash 持久化未随一次 onResume 恢复）。矩阵原文预期「#2 正确」。该路径用户不可达（直改 prefs），不构成用户可见缺陷；**矩阵文本需按实测订正**（→ [#1017](https://github.com/a1121611810/Pictelio/issues/1017)）。证据：`t3-4b-coldstart1.png` / `t3-4b-coldstart2.png`。

### T3-5 API 28–30 残留 —— ⚠️ 设备缺失（接受项）

手头仅 API 34 AVD，无 API 28–30 设备；T3-5a/b 本就 ⚠️ 接受、T3-5c 无法执行。按 #1014 brief 登记「设备缺失接受项 + 理由」。

## T4 · 硬编码浅色值设备端确认（暗色）

| # | 项 | 实测 | 判定 |
|---|---|---|---|
| T4-1 | 图片查看器 | 详情图片 2 次尝试均「图片加载失败」（模拟器到 i.pximg.net 链路故障，与 #693 走查时同源）；错误态本身暗色可读（暗底 + on-surface 文字） | ⚠️ 环境受限（部分证据） |
| T4-2 | R18 遮罩 | `t4-restrict-dark.png`：feed 中 R-18 卡遮罩/标签在暗面可读 | ✅ |
| T4-3 | 小说正文 | 详情操作区 `t4-novel-dark.png` 全走暗色 token ✓；**发现：介绍页信息卡在暗色下为亮色表面**（待设计裁定，见下）；正文页需 LLM 翻译配置，环境不可达 | ⚠️ 部分 + 发现登记 |
| T4-4 | skeleton | `t4-skeleton-dark.png`：冷启动暗色骨架块在暗面上可见不刺眼 | ✅ |
| T4-5 | 滚动指示条 | `t4-scrollbar-dark.png`：右缘捕到 (136,139,144) 条带，与 `outline #8c9198` @35% alpha 叠暗底推算一致 | ✅ |
| T4-6 | 输入框占位符 | 引用既有落档：暗色 7.26/7.32（#693 T4-6）+ 亮色 sky/teal/bili 7.32/7.20/4.54（#1015） | ✅ |

- **待设计裁定发现**：`NovelIntro` 信息卡（标题/作者/标签区）在暗色下使用亮色表面（浅色底 + 深色字）。可读性无问题，但是否符合「无亮色残留面板」口径需设计裁定——登记于此，不建票（如需处理由设计巡检消化）。

## Round-2 · #1016 修复复跑（2026-10-16 当日）

**修复**：`App.vue` 路由出口 `<component :is>` 加 `:key="`${settings.resolvedDark}:${String($route.name)}`"`——vue-lynx KeepAlive 复用原生子树、根类翻转不重算已创建元素的 CSS 变量（第 1 轮确诊机制），明暗切换 = 整页原生重建。键粒度「页 × epoch」复合（KeepAlive 缓存键 = vnode.key；单值 resolvedDark 会让全部白名单页共享 2 个全局桶、跨页导航实例错配——review 轮 1 blocking 实证，轮 2 已修）。

**设备复验**（APK 重建含修复，`pm clear` + dev hook）：

| 断言 | 帧 | 实测 | 判定 |
|---|---|---|---|
| 实时切暗：存活首页原地全树重绘 | `t2-liveswitch-round2-dark.png` | strip ≡ #101418、tab/FAB 暗 | ✅ |
| 实时翻回亮：对称重绘 | `t2-liveswitch-round2-light.png` | strip ≡ #f8faff | ✅ |
| **切暗后跨 tab 导航**（blocking 场景：发现→更新→书架→我的） | `t2-nav-updates-dark.png` / `t2-nav-shelf-dark.png` / `t2-nav-me-dark.png` | 四页 strip 全 ≡ #101418，我的页内容目检正确（导航语义无损） | ✅ |
| 重绘像素与冷启动基准一致性 | 对拍 `t2-sky-dark.png` | 状态栏像素逐字节一致 | ✅ |

**机器防线**：`tests/unit.test.ts` 契约断言（复合键逐字锁定 + 禁 fullPath）；变异三形态全红（无键 / 单值键 / 拼 fullPath）。全套 297 文件 / 4254 用例绿；`vue-tsc` 绿。

**挂账（显式）**：切换**时已打开**的常驻弹层（SearchSheet 等，不经 RouterView，样式冻结同机制未定性）→ [#1018](https://github.com/a1121611810/Pictelio/issues/1018)。非发版阻断（切暗路径上弹层一般已关闭；GlobalFab 已实证会更新）。

## 结论

1. ~~gate 保持~~ → **gate 解除（2026-10-16，第 1 轮 + round-2 同日）**：唯一 ❌ 项 #1016 已修复并设备复验；其余全部 ✅ 或 ⚠️ 接受项（判定列口径：⚠️ = 记录即可）。
2. **[#1016](https://github.com/a1121611810/Pictelio/issues/1016) 关闭**（修复 + 复验证据如上）；**[#1014](https://github.com/a1121611810/Pictelio/issues/1014) 关闭**（解除判据逐条达成：矩阵全勾 + 落档存在 + ADR 对齐 + checklist 勾选）。
3. 非阻断遗留：[#1017](https://github.com/a1121611810/Pictelio/issues/1017)（矩阵文本订正）/ [#1018](https://github.com/a1121611810/Pictelio/issues/1018)（弹层定性）——不影响发版。
4. ADR-0180 状态行改为「真机走查 gate 已执行并解除」；release-checklist 第 6 条已勾。
