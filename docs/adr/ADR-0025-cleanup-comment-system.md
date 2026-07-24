# ADR 0025: 评论系统清理与拆分

## 状态

已批准

## 分类

重构

## 日期

2026-07-25

## 背景

代码审查确认 `components/CommentOverlay.tsx`（360行）对 `api/comment.ts` 的唯一直接导入是 `CommentContentType` 类型。所有运行时 API 调用（`loadRootComments`、`loadRootCommentsNext`、`postComment`、`deleteComment`）均通过 `primitives/useComments.ts` 中介，seam 已正确。

然而仍存在以下问题：

1. **最大单体组件**：CommentOverlay（360行）是本项目最大的组件，UI 渲染 + 弹层管理 + 状态渲染混合在同一文件
2. **死导出**：`api/comment.ts` 中的 `loadReplies` 函数被导出但未被 `useComments` 或 `CommentOverlay` 消费
3. **可读性**：单文件内的评论列表渲染逻辑和输入框逻辑相互交织，难以独立修改

## 决策

### 1. 标记死导出

`loadReplies` 是评论回复功能的 API 函数，当前未被 UI 消费。添加 `@internal` JSDoc 注释说明其用途，保留导出不删除。

### 2. 拆分 CommentOverlay 为三个文件

将当前 360 行的单体拆分为：

```
components/
├── CommentOverlay.tsx    # 主体弹层（协调者，~140行）
├── CommentList.tsx       # 评论列表渲染 + 删除交互（~100行）
└── CommentInput.tsx      # 输入框 + 发表逻辑（~80行）
```

- **CommentOverlay**：负责弹层的开关状态、协调 CommentList 和 CommentInput、提供 useComments 的配置
- **CommentList**：接收 `comments`、`deletingId`、`onDelete`、`sentinelAttach` props，纯渲染
- **CommentInput**：接收 `posting`、`postError`、`onPost` props，纯渲染

### 3. 不修改 useComments 接口

`useComments` 的当前接口完整且正确，不做任何变动。

## 理由

1. **降低单体复杂度**：360 行 → 3 个文件各 ~100-140 行，每个文件职责单一
2. **可读性提升**：列表和输入框独立修改不影响对方
3. **预备扩展**：为未来评论回复（reply）功能提供更清晰的结构

## 后果

### 正面

- 评论系统的每个组件职责清晰
- 未来添加回复功能只需新增组件，不修改现有文件结构

### 负面

- 3 个文件代替 1 个，文件数增加
- 新增组件 props 接口定义

### 风险

低。纯拆分重构，不修改业务逻辑或 useComments 接口。
