# ADR-0108: app-lynx 刷新 FAB 旋转动画（CSS keyframes）

- 状态：accepted
- 日期：2026-08-24
- 关联：ADR-0107（刷新 FAB 入口，本 ADR 闭环其「原生 CSS keyframes 旋转动画」待验证项）、ADR-0076（语义 A：可见刷新过程）、`packages/app-lynx/CONTEXT.md`（刷新旋转 / refresh spin）
- 来源：grill-with-docs 会话，用户确认刷新按钮需动画（先方案后拍板）

## 背景

ADR-0107 的 FAB 刷新入口在刷新进行中仅有 `opacity: 0.6` 弱信号，不构成「可见刷新过程」（ADR-0076 语义 A：用户应看到正在刷新）。需求：点击刷新按钮要有动画。

机制不确定性此前挂账：ADR-0106/0107 待验证项「原生 CSS keyframes 旋转动画」——App.vue shimmer 骨架屏（`@keyframes` + `animation` 生产代码）注释明确"原生 LynxView 的 gradient/animation 支持待 #41 集成后验证"，即 keyframes 在原生是否真的动画此前无实证。

**平台事实（字节码实证 2026-08-24，`lynx-4.0.1.aar`）：**

1. Lynx 原生 SDK 含 CSS keyframes 引擎：`com.lynx.tasm.animation.keyframe.LynxKeyframeAnimator`（+ `LynxAnimationPropertyType` / `KeyframeParsedData`，AAR 内 animation/keyframe 类 49 个）。
2. 引擎支持 transform：`LynxKeyframeAnimator` 引用 `TransformProps` / `TransformOrigin` / `TransformRaw`——`transform: rotate()` 类 keyframes 有原生引擎支撑。
3. 另有 `TransitionAnimationManager`（CSS transition 引擎）与 `LayoutAnimationManager`（布局动画）——Lynx 动画体系完整。
4. web-core bundle 含 keyframes 处理（浏览器原生渲染），shimmer 同机制已 web-core 实测。

## 决策

1. **刷新中 ↻ 图标持续旋转**（CSS keyframes `transform: rotate`，1s/圈 `linear infinite`）作为刷新可见性反馈；旋转启动的瞬间即构成按压反馈，**不另加**第二套按压动画（保持接口/实现最小面）。
2. **承载元素 = 包裹图标的 view**（text 元素 transform 支持性弱）；`refreshing=true` 加动画类，`false` 移除（图标复位 0°，快切可接受，不做回弹过渡）。样式放全局 `<style>`（与 App.vue shimmer 完全同机制，规避 scoped keyframes 在 Lynx 的未验证面）。
3. **保留 `opacity: 0.6`**：旋转 + 变暗双信号，可辨识性冗余但成本零。
4. **否决备选机制**：
   - Lynx Animated API（`lynx.aniamted`）：新机制、新配置面（keyframes + binding 配置）、项目零使用先例，为"图标旋转"引入全新增量面——杀鸡用牛刀。
   - opacity 脉冲动画：不如旋转直观，且同样依赖 keyframes 支持，无优势。
   - JS timer 驱动旋转：每帧 JS↔bridge 通信，违背 ADR-0106 性能结论（原生动画线程零 bridge 是正道）。
   - 图标 swap（↻ → 静态 spinner 字符）：无平滑动画，字符渲染跨字体不可控。
5. **验收 = 单测（结构断言）+ 模拟器实测**：截图连拍确认旋转帧变化 + logcat 无动画错误；通过即闭环 ADR-0107 待验证项（shimmer 原生动画支持顺带确认）。

## 被考虑的方案

- 各备选机制见决策 4。另考虑过"仅按压瞬间动画"（tap 时快转 90°）——单次瞬态动画无法表达刷新全程，刷新中持续旋转已覆盖按压反馈，否决单加。
- 考虑过在 ADR-0107 直接回写而非新 ADR——本 ADR 记录的是独立机制决策 + 平台事实（Lynx 原生 keyframes/transform 引擎），与入口决策分离，后续动画扩展（如书签爱心）可复用该平台事实。新 ADR 合理。

## 后果

- 正面：恢复「可见刷新过程」语义（ADR-0076 语义 A）；零新依赖/新原生面/新 bridge；动画由原生线程驱动（性能）；双端同构（同模板同 keyframes）；闭环两项挂账待验证项。
- 负面：若模拟器实证原生 transform 旋转不生效（引擎存在 ≠ 行为保证），降级为 opacity 脉冲（引擎对 opacity 支持更基础）或 shimmer 同款 background-position 机制，接口不变、成本约 10 行。
- 待验证项（T2'' 模拟器闭环）：原生 `transform: rotate` keyframes 实际帧动画；shimmer 在原生是否真动画（顺带确认，可回写 App.vue 注释）。
