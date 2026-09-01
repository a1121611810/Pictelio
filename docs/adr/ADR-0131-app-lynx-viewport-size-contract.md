# ADR-0131: app-lynx 内容区尺寸契约——以内容区尺寸计算底部几何

- 状态：accepted
- 日期：2026-09-01
- 关联：ADR-0120（放射导航 FAB）、ADR-0123（定位锚点/零尺寸盒）、ADR-0108（vw 几何）、`packages/app-lynx/src/components/GlobalFab.vue`、`packages/app/android/app/src/lynx/java/io/pictelio/app/{LynxActivity,PictelioAppModule}.java`
- 来源：用户报告「放射 FAB 位置太低显示不全」→ 模拟器复现 + 像素取证 + 原生日志取证 → 原型验证通过（`prototype/fab-viewport-fix` 分支 8971e37）→ 用户确认方案 1（内容区契约）

## 背景

放射导航 FAB（ADR-0120）按**全屏物理尺寸**计算底部几何：`screenHeightVw()` 用 `SystemInfo`（`pixelWidth/pixelHeight/pixelRatio`）把屏高换算成「按屏宽的 vw 数」，FAB 圆心 = 屏高 − 边距 − 半径。

模拟器（Android 14 / 720×1280 / pr=2）实测矛盾点：`SystemInfo` 给出 `vw=177.78`，但 LynxView 渲染区域只有 **720×1184（vw=164.44）**——内容区比全屏矮 **96px（48dp，手势导航条 inset）**。像素分析证实：FAB 亮像素行 1191→1231 截止（在内容区外被裁），整颗 FAB 只剩顶部一条圆弧，点击命中区也随之外移失效。

## 决策

1. **新增内容区尺寸契约**：`LynxActivity` 通过 `OnLayoutChangeListener` 记录 LynxView 实际内容区尺寸（px），`PictelioAppModule.getViewportSize(cb(w, h))` 回传；未布局完成 `cb(-1, -1)`（JS 侧回退 `SystemInfo`）。
2. **JS 侧以内容区为准**：`GlobalFab` 挂载后查询一次；`screenHeightVw()` 优先级 = 内容区尺寸 > `SystemInfo` > web-core 兜底（216.4vw）。几何（FAB 圆心 / 遮罩 / 外环 / 内环）由顶层常量改为 `computed`，回调到达自动重算。web-core 无 `NativeModules` 时走 `SystemInfo`/兜底，双端行为不变。
3. **几何纯函数提取**：`screenHeightVw` 的派生逻辑（内容区/SystemInfo/兜底三路径）提取为纯函数模块（node 单测可测，同 `utils/coverImage.ts` 模式），组件只做薄接线。
4. **不做的事**：不估 inset 经验常数（设备差异大，JS 侧估不可靠）；不做 edge-to-edge 全局改造（影响面远超本问题）；不恢复 `right/bottom` 定位（ADR-0123 已证原生锚点语义不可用）。

## 被考虑的方案

- **C. JS 经验常数**（如「屏高 − 48dp」）：模拟器上恰好可用，但真机 OPPO R11s 3 键导航 inset 更大、各机型不同——治标，否决。
- **B. LynxView edge-to-edge 全屏**：让内容区 = 全屏，`SystemInfo` 自动正确。但所有页面底部（导航/列表垫底/exitHint）都要重新吃 inset，波及面与回归成本远超本问题范围，否决；作为后续独立议题保留。
- **A'（原型即失败路径）.`bottom` 定位**：ADR-0123 已证原生把「最近 view 祖先」当定位锚点，`right/bottom` 在零尺寸盒/非全屏父盒下解析错误，不引入。

## 后果

**正面**：
- 放射 FAB 折叠/展开/环项在任意设备（手势导航 / 3 键导航 / 刘海）几何正确——以实际内容区为基准，不依赖机型推算；
- 双端一致：web-core 走 `SystemInfo`（浏览器无系统条，语义本就正确），原生走内容区契约；
- 契约极小（1 方法 + 1 回调，无新状态、无推送通道）。

**风险/验证项**：
- **契约难逆**（跨端约定）：`getViewportSize` 签名与回退语义（`-1,-1`）进入 `rspeedy-env.d.ts` 类型，任何改动需双端同步；
- 时序：`OnLayoutChangeListener` 首次布局早于 bundle 渲染（setContentView 先行），`getViewportSize` 几乎必然命中有效值；未布局时 JS 侧回退 `SystemInfo` 仍可能短暂错位（验证过程中未观测到，常规可接受）；若未来观测到首帧闪跳，升级为「布局变化时主动推送」（事件通道，本 ADR 不预建）；
- 模拟器（Android 14 手势导航）已验证折叠/展开完整；**真机 OPPO R11s（3 键导航，inset 更大）回归待执行**；
- 测试：纯函数三路径单测（内容区 / SystemInfo / 兜底）+ 契约测试（`getViewportSize` 调用与回退沿）——遵循「IO 边界测试强制覆盖」硬约束。
