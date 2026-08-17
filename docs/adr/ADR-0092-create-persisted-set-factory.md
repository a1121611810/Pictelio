# ADR 0092: 提取 createPersistedSet 工厂消除 store 重复

## 状态

已实现

## 日期

2025-06-22

## 背景

`blockStore.ts` 和 `reportStore.ts` 各自独立实现了相同的模式：

- `createSignal<Set<number>>(new Set())` 管理 ID 集合
- `Preferences.get` + `JSON.parse` 加载
- 增删操作后 `Preferences.set` + `JSON.stringify` 持久化
- 完整的 `try/catch` 错误处理包装
- `has()` 检查 + `reset()` 清空

blockStore (61 行) 的 ~80% 是上述模板代码。reportStore (71 行) 额外管理 ReportRecord 数组（带 reason + timestamp），因此不完全适用简单 Set 模式。

## 决策

1. 在 `stores/shared/createPersistedSet.ts` 中创建泛型工厂 `createPersistedSet<T>()`
2. 工厂返回 `{ values, add, remove, has, load, reset }` 接口
3. 重写 `blockStore.ts` 为工厂调用（约 6 行）
4. `reportStore.ts` 保持自有逻辑（ReportRecord 数组存储与 Set 不同）
5. 保留 `blockUser`、`unblockUser`、`isBlocked`、`loadBlockedIds`、`resetBlockedIds` 等导出名不变——消费者零改动

## 影响

- 正面：blockStore 从 61 行减至 ~10 行；统一的持久化逻辑（未来 Preferences API 变更只需改一处）
- 负面：无（纯提取，无行为变化，API 兼容）
- 风险：低

## 符合原则

- 可维护性：消除结构重复；持久化逻辑集中在工厂
- 内存：blockStore 的 Set 信号不再独立维护——工厂统一管理生命周期
