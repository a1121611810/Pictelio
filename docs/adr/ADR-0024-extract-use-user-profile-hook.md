# ADR 0024: 提取 useUserProfile Hook

## 状态

已批准

## 分类

重构

## 日期

2026-07-25

## 背景

`routes/PersonalCenter.tsx`（257行）同时承担 5 项职责：

1. **路由编排**：子路由检测（`isRootUserPage`）、导航跳转（7 处）
2. **用户身份判断**：`targetUserId`、`isCurrentUser` 交叉依赖路由 + auth 状态
3. **头像加载**：Native/Web 平台适配、加载状态、错误处理（2 个 signal + 1 个 effect）
4. **派生数据计算**：`totalWorks` 聚合
5. **JSX 渲染**：菜单布局、条件渲染

虽然已提取 `CollapsedHeader`、`ProfileCard`、`ProfileBackground` 组件，路由层本身仍包含大量业务逻辑，导致：
- 业务逻辑无法在 Vitest 中独立测试（需要完整路由 context）
- 头像加载 createEffect 缺少 onCleanup（路由切换时可能触发已卸载组件的 setState）

## 决策

提取 `useUserProfile` hook 到 `primitives/useUserProfile.ts`，封装所有用户相关的派生数据和头像加载逻辑。

### Hook 接口

```typescript
function useUserProfile(props: { userId?: string }): {
  targetUserId: Accessor<number>;
  displayUser: Accessor<PixivUser | null>;
  isCurrentUser: Accessor<boolean>;
  isRootUserPage: Accessor<boolean>;
  totalWorks: Accessor<number>;
  avatarUrl: Accessor<string>;
  avatarErrored: Accessor<boolean>;
}
```

### Hook 内包含

1. **5 个派生 getter**：`targetUserId`、`displayUser`、`isCurrentUser`、`isRootUserPage`、`totalWorks`
2. **头像加载**：`createSignal` + `createEffect`（含 `onCleanup` 防止卸载后执行 setState）
3. 不包含 `onMount` 中的 `loadProfile`——路由 loader 已在组件挂载前完成数据加载，onMount 中的调用是冗余的

### 不在 Hook 内的

导航跳转函数（`navigate(...)` 调用）留在 PersonalCenter 中，因为它们是用户事件的直接响应，属于路由组件层的编排职责。

### 位置

创建在 `primitives/useUserProfile.ts`，与项目中其他 hook（`useComments`、`useContainerWidth` 等）同级。

### 清理

删除 `PersonalCenter.tsx` 中已提取的：
- L29-L46：5 个 getter 函数
- L49-L71：头像加载相关状态和 effect
- L73-L79：冗余的 `onMount` `loadProfile` 调用

## 理由

1. **可测试性 ↑**：身份判定逻辑（current user vs 他人、root page 检测）可在 Vitest 中独立测试，无需路由 context
2. **Locality ↑**：路由关注点（布局、导航）和业务逻辑（身份、加载）分离
3. **正确性 ↑**：添加 onCleanup 修复卸载后 setState 的潜在问题

## 后果

### 正面

- PersonalCenter 从 257 行减少到约 200 行
- 新增的 hook 文件可独立测试
- 修复头像加载缺少清理的问题

### 负面

- 新增一个文件（primitives/useUserProfile.ts）
- 轻微的 import 重定向

### 风险

低。纯提取重构，不修改业务逻辑。
