# ADR 0033: 启动更新弹窗不可见的多次修复

## 状态

已实施

## 分类

缺陷修复

## 日期

2026-07-26

## 背景

用户反馈启动时自动更新检查弹窗（StartupUpdateDialog）不显示。该弹窗的逻辑链路为：

1. 启动 → `__root.tsx` 中 `runStartupUpdateCheck()` 检查最新版本
2. 若有更新且版本未被忽略 → `setShowUpdateDialog(true)`
3. `<Show when={showUpdateDialog()}>` 渲染 `<fluent-dialog>`

用户确认已开启"启动时检查更新"开关、设置页面能显示最新版本号（证明网络和版本检查均正常），但弹窗始终不出现。

## 决策过程

### 第一次修复：createEffect 二次保障

**假设根因**：SolidJS 响应式时序问题，`runStartupUpdateCheck` 中的 `setShowUpdateDialog(true)` 在 setTimeout 中调用，可能错过渲染周期。

**修复**：在 `StartupUpdateDialog` 内部添加 `createEffect`，响应式监控 `hasUpdate` / `checkCompleted` / `latestVersion` / `lastDismissedVersion` / `showUpdateDialog` 信号，当条件满足时自动调用 `setShowUpdateDialog(true)`。

**验证结果**：❌ 用户仍看不到弹窗。CDP 调试发现 `<fluent-dialog>` 宿主元素存在于 DOM 中，但：

- `getBoundingClientRect().top = 10777px`（页面底部，屏幕外）
- `display: inline`，`position: static`，`width: 0`，`height: 0`

弹窗虽挂载但不可见。

### 第二次修复：autoCheckUpdate 默认开启

**修复**：将 `settingsStore.ts` 中 `autoCheckUpdate` 默认值从 `false` 改为 `true`，`resetSettingsStore()` 同步更新。确保新安装用户默认开启检查。

**验证结果**：⏭️ 辅助修复，未解决根本问题。

### 第三次修复：手动调用 shadow DOM showModal

**诊断根因**：Fluent Web Components `<fluent-dialog>` 在通过 SolidJS `<Show>` 动态创建时，`open` 属性无法触发内部 `<dialog>` 的 `showModal()`。

Web 组件的 `attributeChangedCallback` **不会对初始属性触发**——这发生在元素通过 `document.createElement` 创建时所有属性已经就位，而不是后续 changed。而 CDP 手动调用 `dialog.showModal()` 能使弹窗正常显示。

**第一次尝试**：使用 `ref` 回调在元素挂载时调用 `showModal()`

```tsx
function onDialogMount(el: HTMLElement) {
    (el as any).showModal?.();
}
```

**结果**：❌ 无效。ref 回调在元素创建时同步触发，此时 Web 组件可能尚未完成内部初始化（`connectedCallback` 未运行），`showModal()` 调用被忽略。

**第二次尝试**：使用 `requestAnimationFrame` 延迟

```tsx
requestAnimationFrame(() => {
    (el as any).showModal?.();
});
```

**结果**：❌ 无效。rAF 的时序仍不够晚，Web 组件的 shadow DOM 在此时可能已存在但内部 dialog 未就绪。

**最终方案**：使用 `createEffect` + 短轮询（50ms 间隔）

```tsx
createEffect(() => {
    if (showUpdateDialog()) {
        const tryShow = () => {
            const host = document.querySelector('fluent-dialog');
            if (host?.shadowRoot) {
                const d = host.shadowRoot.querySelector('dialog');
                if (d && !d.open) { d.showModal(); return; }
            }
            setTimeout(tryShow, 50);
        };
        setTimeout(tryShow, 0);
    }
});
```

**结果**：✅ 弹窗正确显示（`dialog.open=true`, `display=block`, 位置和尺寸正确）。

## 关键教训

1. **永远不要凭假设下结论**。第一次修复假设是 SolidJS 响应式时序问题，但实际是 Fluent Web Component 的行为差异。CDP 调试直接暴露了真实根因（`display:none`, `internalOpen:false`, 零尺寸）。
2. **Web Components 在动态创建场景下的行为差异**。静态渲染（如 `AgeGate`）的 `<fluent-dialog open>` 可以工作，但通过 `<Show>` 动态创建时 `open` 属性无效。
3. **`showModal()` 需要在 Web 组件完全初始化后才能调用**。`ref` 回调和 `requestAnimationFrame` 的时序均不够晚，需要轮询等待 shadow DOM 就绪。
4. **CDP 远程调试是诊断此类问题的核心工具**。通过 `adb forward` + Chrome DevTools Protocol，可以注入 JavaScript 检查 Web Components 的 shadow DOM 内部状态、调用方法、获取计算样式。

## 涉及文件

- `packages/app/src/components/StartupUpdateDialog.tsx` —— 最终修复：`open` 属性 → `createEffect` + polling `showModal()`
- `packages/app/src/stores/settingsStore.ts` —— `autoCheckUpdate` 默认从 `false` 改为 `true`
- `packages/app/src/routes/__root.tsx` —— `runStartupUpdateCheck` 逻辑（未改动，保留并行路径）
