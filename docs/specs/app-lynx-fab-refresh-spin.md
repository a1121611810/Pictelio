# app-lynx 刷新 FAB 旋转动画 —— 功能规格

> 来源：grill-with-docs 会话（用户确认刷新按钮需动画）；决策记录：ADR-0108；术语：`packages/app-lynx/CONTEXT.md`（刷新旋转 / refresh spin）
> 状态：ready-for-agent

## Problem Statement

ADR-0107 的 FAB 刷新入口在刷新进行中仅有 `opacity: 0.6` 弱信号，不构成「可见刷新过程」（ADR-0076 语义 A）。点击刷新按钮应有动画：刷新中 ↻ 图标持续旋转。

## Decisions（ADR-0108 映射）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 动画形态 | 刷新中 ↻ 图标持续旋转（CSS keyframes `transform: rotate`，1s/圈 `linear infinite`）；启动即按压反馈，不另加按压动画 |
| D2 | 承载与触发 | 包裹图标的 view 加动画类；`refreshing=true` 加、`false` 移除（复位 0°）；样式放全局 `<style>`（与 shimmer 同机制） |
| D3 | 双信号 | 保留 `opacity: 0.6`（旋转 + 变暗） |
| D4 | 机制 | CSS keyframes（Lynx 原生 SDK 字节码实证含 LynxKeyframeAnimator + transform 支持）；否决 Animated API / opacity 脉冲 / JS timer / 图标 swap |
| D5 | 验收 | 单测（结构断言）+ 模拟器截图连拍；通过闭环 ADR-0107 待验证项 |

## 模块接口

**零变化**——动画为 RefreshableList 内部实现细节：

```vue
<RefreshableList :refresh="refreshFeed">
  <list …>…</list>
</RefreshableList>
```

## 实现要点（RefreshableList.vue）

```css
/* 全局 <style>（与 App.vue shimmer 同机制，规避 scoped keyframes 在 Lynx 的未验证面） */
@keyframes fab-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.fab-spin {
  animation: fab-spin 1s linear infinite;
}
```

模板：FAB 内图标外包 view（text transform 支持性弱）：

```html
<view :class="refreshing ? 'fab-spin' : ''">
  <text class="text-[6.4vw] leading-none text-primary-on-container">↻</text>
</view>
```

- `refreshing` 状态机（防重入 + try/finally）不变；动画类绑定与 `opacity: 0.6` 绑定同源
- 全局类名 `fab-spin` 全仓唯一（无碰撞）

## 状态与边界

| 场景 | 行为 |
|------|------|
| 点击 FAB | `refreshing=true` → 图标开始旋转（即时按压反馈） |
| 刷新完成 | `finally` 复位 → 动画类移除，图标回 0°（快切，不做回弹过渡） |
| 刷新中重复点击 | 防重入 guard 忽略（原有） |
| 刷新失败 | `catch` warn + `finally` 复位 → 动画停止（错误槽语义不变） |
| 刷新中组件卸载（切 tab） | 组件销毁，动画随 DOM 移除，无泄漏 |
| web-core 预览 | 浏览器原生 keyframes（shimmer 先例已实测） |
| 原生 LynxView | LynxKeyframeAnimator + TransformProps（字节码实证）；行为待 T2'' 模拟器确认 |
| 动画不生效（降级预案） | 保持 opacity 0.6 静态 + 旋转不转（可接受降级）；或换 opacity 脉冲（~10 行） |

## 测试计划

**单测（`packages/app-lynx/tests/unit.test.ts`，结构断言，oracle = ADR-0108 决策 1/2/3）**：

1. 组件含 `@keyframes fab-spin` + `animation: fab-spin 1s linear infinite`
2. 组件含 `:class` 条件绑定 `refreshing ? 'fab-spin'`（与 refreshing 同源）
3. 保留 `opacity: 0.6` 断言（D3 双信号）
4. 既有负向断言（无 `<refresh` / `createSelectorQuery` / `finishRefresh` / `setTimeout`）不受影响

**模拟器实测**（AVD `pictelio_ui`，lynx debug）：

| # | 项 | 通过判据 |
|---|----|---------|
| V1 | 旋转动画 | 点击 FAB 后截图连拍（≥3 张，间隔 ~150ms），↻ 图标取向逐帧变化；刷新完成停止 |
| V2 | 无错误 | logcat 无 animation/keyframe 相关错误 |
| V3 | 回归 | 刷新数据替换正常（RemoveNode 归零）、FAB 防重入/tab 互斥不回归 |
| V4 | web 构建 | `pnpm dev:app-lynx` 双 bundle 构建无新 warning（登录墙内交互不可达，同构模板同路径，记录降级） |

**T2'' 额外产出**：ADR-0107 待验证项回写为已验证（含 shimmer 原生动画支持结论 → App.vue 注释可更新）。

## 排除项（Non-goals）

- 不做按压瞬间单独动画（旋转启动已覆盖）
- 不做刷新完成回弹/阻尼过渡（v1 快切）
- 不做按钮整体位移/缩放动画
- 不做 prefers-reduced-motion（Lynx 无此媒体查询支持，记录）
- 不引入 Lynx Animated API / 新依赖

## 红线

1. 不新增 `setTimeout` / JS 计时器驱动动画（性能红线，负向断言守护）
2. 不引入新原生面 / NativeModule
3. 动画类必须与 `refreshing` 状态同源（禁止独立状态副本）
4. 模拟器实测发现动画异常 → 停下回报，不静默绕路（降级预案需先回报）

## Tickets

| # | 内容 | 前置依赖 | 验收 |
|---|------|---------|------|
| T0'' | CONTEXT.md 术语（刷新旋转）+ ADR-0108 + ADR-0107 待验证项标注 + 本 spec | — | docs 提交 |
| T1'' | RefreshableList 旋转动画实现 + 单测 4 条 | T0'' | `pnpm test:app-lynx` + `check:app-lynx` 绿 |
| T2'' | 模拟器验证 V1-V4 + 回写 ADR-0107 待验证项 + App.vue 注释 | T1'' | 4 项全过；截图留证；docs 提交 |
