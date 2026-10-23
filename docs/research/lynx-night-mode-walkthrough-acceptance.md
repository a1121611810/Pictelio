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

## Round-3 · #1018 常驻弹层（SearchSheet）实时切暗定性（2026-10-23）

**挂账来源**：Round-2 挂账「切换**时已打开**的常驻弹层（SearchSheet 等，不经 RouterView，样式冻结同机制未定性）」→ [#1018](https://github.com/a1121611810/Pictelio/issues/1018)。

**结论：冻结未复现 —— 弹层在系统 uiMode 实时翻转时跟随换色（双向）。** 原假设（#1016 同机制：根 `<page>` 类翻转不重算已创建元素的 CSS 变量）**不适用于**根级常驻弹层。

**环境**：模拟器 `emulator-5556`（1080×2160@480dpi / Android 14 API 34）· 已装 debug 包 `io.pictelio.app`（versionName 6.10.0，lastUpdateTime 2026-10-22 12:17，**含 #1016 的 epoch 键修复**）· 外观三态 = 缺省 = `system`（跟随系统）· 系统侧 uiMode 由 `night no` 切到 `night yes` 再切回。
（⚠️ 本轮取证发生在 **ADR-0227 落地之前** ⇒ 当时的 debug 包名仍是 `io.pictelio.app`；#1037 之后 debug 变体的 applicationId 改为 `io.pictelio.app.debug`，release 仍是 `io.pictelio.app`。本节结论只依赖「同一棵原生子树就地重绘」，与包名无关。）

**方法**：首页 → FAB 放射菜单 → 搜索项打开全局搜索弹层（SearchSheet：根 `<page>` 直下的 `v-if` 单例，**不经 RouterView**）→ `adb shell cmd uimode night yes` → 取帧 → `night no` → 再取帧。
**进程 pid 前后一致（31413）** ⇒ 未经 Activity 重建（manifest `configChanges` 含 `uiMode`）⇒ 观测的是「同一棵原生子树就地重绘」，不是重建后的新页面。

**实测像素**（同一坐标点，1080×2160 原图）：

| 采样点 | 亮态（弹层开） | 切暗后 | 切回亮 |
|---|---|---|---|
| 弹层上部背景 | (230,232,238) | **(39,42,47)** | (230,232,238) |
| 弹层输入行 | (255,255,255) | **(11,15,18)** | (255,255,255) |
| 弹层标题区 | (255,255,255) | **(11,15,18)** | (255,255,255) |
| 页面顶部栏 | (124,125,128) | (8,10,12) | (124,125,128) |

两帧里弹层**都保持打开**（「搜索」标题 + 输入框 + scope/sort chips 可见），其令牌面随明暗**双向**切换 ⇒ 无样式冻结。

**帧**：`t2-livesheet-round3-light.png` / `t2-livesheet-round3-dark.png` / `t2-livesheet-round3-relight.png`

**与 #1016 的机制差异（定性）**：#1016 冻结的是 **KeepAlive 复用的页面原生子树**（页面级底色冻结、组件级绑定正常）；本轮观测的常驻弹层**不在 KeepAlive 内**，其元素在根类翻转时重新解析了 CSS 变量 ⇒ 「同机制」假设不成立。冻结条件只出现在 KeepAlive 缓存页上，而那类页面**已由 #1016 的 epoch 键覆盖**。

**GlobalFab 反例的回扣（#1018 验收条件第 2 条要求「反例被确认或被解释掉」）**：Round-2 挂账已记「GlobalFab 已实证会更新」——即 GlobalFab 这一侧**同样不冻结**，与本轮 SearchSheet 的实测**同向**。两者共同支持同一结论：**根级常驻元素（FAB / 弹层）随根类翻转重算样式，冻结只发生在 KeepAlive 缓存页上**。

**触发路径可达性（补充实测）**：SearchSheet 是**底 sheet**（顶缘 ~y=432px，其余盖住底部导航）⇒ 打开期间**无法**切到「我的 → 外观」⇒ 原票面假设的「在设置页切暗、弹层仍开着」路径**不可达**；唯一可达触发是**系统 uiMode 翻转**（外观三态 = `system` 时），本轮已实测通过。

**残留（未取证项，不建票）**：`exitHint`（再按一次退出）与 `muteTagHint`（标签静音轻提示）两条**根级瞬态提示**未单独取帧——二者是 2s 自动消失的 snackbar，主题翻转后无法在同一会话内取到第二帧；且用 inverse 令牌（`bg-inverse-surface` / `text-inverse-on-surface`），影响面 = 2 秒内看到一次旧色 snackbar。

**CI 防线（本轮定性结论要求把「弹层跨翻转跟随」钉成机器防线，不止于设备取证）**：
Round-3 结论落在「If correct」分支（弹层跟随翻转），故该性质**不能只靠设备取证**，已补源级门禁
`packages/app-lynx/tests/dialogThemeFlipContract.test.ts`（9 例）钉住这条级联的每一环：

1. **位置**——`<SearchSheet>` 必须是根 `<page>` 的**直接子节点**，不在 `<RouterView>`/`<KeepAlive>` 内
   （否则它会落进 #1016 的 epoch-key 重建语义，性质随之改变）；
2. **不快照主题**——SearchSheet 不读 `resolvedDark` / `themeColor`、不自带 `appearanceClasses(...)`
   （主题一律从根 `<page>` 的 CSS 变量继承）；
3. **触发器**——根 `<page>` 的类绑定仍由 `appearanceClasses(theme, resolvedDark)` 驱动，且该纯函数在
   light/dark 下必产出不同类 ⇒ 翻转必然改根类。

门禁有牙（变异验证）：把 `<SearchSheet>` 挪进 `<RouterView>` 子树 ⇒ 该门禁转红（1 failed / 8 passed）；
另有两条**阳性对照**（合成源码：弹层在 RouterView 内 / 在 KeepAlive 内 ⇒ 抽取器必须判负）。
**已知失效面**（门禁自述）：源级断言只看接线、不渲染不取像素 ⇒ 像素结论仍以本节设备取证为准；
`exitHint` / `muteTagHint` 两条瞬态 snackbar **已于 2026-10-23 以源级守卫纳入门禁面**
（`tests/dialogThemeFlipContract.test.ts` 的「#1018 ④ 瞬态轻提示配色必须走令牌」组，
3 条断言）—— 不是取帧（瞬态 2 秒，取第二帧时序不可行），而是钉住「不得退化成静态色值」
这条不变量。变异验证：把 `exitHint` 底色改成 `bg-[#2e3136]` ⇒ 2 red ⇒ 门禁有牙。
取证与结论见 [`issue-1018-and-755-residual-findings-2026-10.md`](./issue-1018-and-755-residual-findings-2026-10.md)。

**门禁规模登记（规模线 30%，Standards 轴 2026-10-23 复核）**：`tests/dialogThemeFlipContract.test.ts`
- **233 行**（本轮 +82 行 = 新增「④ 瞬态轻提示配色必须走令牌」组 3 条断言 + 抽取器 + 注释；原 151 行）；
  按**最保守的单一被测对象**口径（`src/App.vue` **442 行**）= **52.7%**（超线），
  按多被测对象读法（App.vue + SearchSheet.vue = 1416 行）= 16.5%。此处按最保守口径登记为 **52.7%**。
- **本轮超线增量已登记**：151 → 233 行（+82），最保守口径 34.2% → **52.7%**。
  处置：④ 组 3 条断言各钉一个独立分支（提示存在 / 用 inverse 令牌 / 无字面量颜色），
  删任一条都留一个无人钉的分支 ⇒ **不删**；但**本组已抵「后续若再扩测点须先拆文件」的红线**
  ⇒ **下轮扩测前必须先拆**，不得继续加码。
- 原 9 条断言（位置 / 不快照 / 触发器 + 两条阳性对照）本轮**逐字未动**。

## 结论

1. ~~gate 保持~~ → **gate 解除（2026-10-16，第 1 轮 + round-2 同日）**：唯一 ❌ 项 #1016 已修复并设备复验；其余全部 ✅ 或 ⚠️ 接受项（判定列口径：⚠️ = 记录即可）。
2. **[#1016](https://github.com/a1121611810/Pictelio/issues/1016) 关闭**（修复 + 复验证据如上）；**[#1014](https://github.com/a1121611810/Pictelio/issues/1014) 关闭**（解除判据逐条达成：矩阵全勾 + 落档存在 + ADR 对齐 + checklist 勾选）。
3. 非阻断遗留：[#1017](https://github.com/a1121611810/Pictelio/issues/1017)（矩阵文本订正）——不影响发版；**[#1018](https://github.com/a1121611810/Pictelio/issues/1018) 已于 2026-10-23 定性完成并关闭**（Round-3：弹层跟随重绘，冻结未复现）。
4. ADR-0180 状态行改为「真机走查 gate 已执行并解除」；release-checklist 第 6 条已勾。
