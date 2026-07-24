# ADR 0027: UserWorksFeed 条件渲染替代双 Virtualizer 实例

## 状态

已批准 — 立即执行

## 分类

重构 + 性能优化

## 日期

2026-07-17

## 背景

`UserWorksFeed.tsx`（`packages/app/src/components/UserWorksFeed.tsx`）始终同时渲染 `VirtualFeed` 和 `NovelVirtualFeed` 两个组件，通过 CSS `display: none` 隐藏非活跃类型。这导致：

1. **内存浪费**：两个独立的 `Virtualizer` 实例同时运行，各自维护虚拟列表状态（items、offsets、ranges）。每个 ~30KB，低端设备上占用了宝贵的 JS 堆。
2. **性能开销**：两个实例各自绑定 scroll/resize 监听器；隐藏的 feed 仍执行所有 SolidJS effect（数据派生、DOM 测量、滚动恢复初始化）。
3. **生命周期混乱**：切换内容类型时 CSS 控制显隐而非 Solid 控制挂载/卸载。隐藏组件的 `onCleanup` 不触发，资源无法释放。
4. **滚动恢复干扰**：两个 Virtualizer 的 scroll 监听器同时运行，可能互相干扰恢复逻辑。

## 决策

### D1: 使用 SolidJS 条件挂载

将 `UserWorksFeed` 从始终双渲染改为使用 `<Switch>`/`<Match>` 条件挂载：

```tsx
<Switch>
  <Match when={props.contentType === "illust"}>
    <VirtualFeed ...illust props />
  </Match>
  <Match when={props.contentType === "novel"}>
    <NovelVirtualFeed ...novel props />
  </Match>
</Switch>
```

### D2: 滚动恢复策略

- 切换类型时，旧组件 unmount 前通过 `onScrollStateChange` 回调保存滚动状态
- 新组件 mount 时通过 `initialScrollState` 恢复
- 配合 TanStack Query 的 `gcTime`（5 分钟），切换回之前类型时数据立即可用，无需重新 fetch

## 后果

### 正面
- 内存：虚拟列表状态 + Virtualizer 对象减少 50%
- 性能：减少 50% scroll/resize 监听器数量和 effect 执行
- 生命周期：满足 React 声明式原则，组件切换正确触发 mount/unmount

### 负面
- 切换类型时可能出现短暂白屏（新组件 mount + 渲染延迟）
- 滚动恢复依赖于 `initialScrollState` 的正确传递

### 风险
中低。切换类型的场景不多，白屏影响有限。滚动恢复已有完善的 `scrollRestoreGlobal` 原语支撑。
