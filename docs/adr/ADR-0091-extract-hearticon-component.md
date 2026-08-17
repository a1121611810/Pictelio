# ADR 0091: 提取 HeartIcon 共享组件

## 状态

已实现

## 日期

2025-06-22

## 背景

`ImageCard.tsx` (行 24-51) 和 `NovelCard.tsx` (行 10-37) 各自内联定义了完全相同的 `HeartSvg` 组件——相同的 SVG 路径、相同的 props 接口、相同的条件渲染逻辑。

- ImageCard.tsx: `function HeartSvg(props: { filled: boolean; size?: number })` — 28 行
- NovelCard.tsx: `function HeartSvg(props: { filled: boolean; size?: number })` — 28 行

重复意味着：若要修改图标样式（如调整 stroke-width、路径形状、aria 标签），必须在两处同步修改。违反了 DRY 原则。

## 决策

1. 在 `components/ui/HeartIcon.tsx` 中创建共享的 `HeartIcon` 组件
2. 导出类型接口 `HeartIconProps`
3. 从 `ImageCard.tsx` 中删除内联 `HeartSvg` 定义，改为 `import HeartIcon from "../ui/HeartIcon"`
4. 从 `NovelCard.tsx` 中删除内联 `HeartSvg` 定义，改为 `import HeartIcon from "../ui/HeartIcon"`
5. `GridCard.tsx` 目前使用 Unicode 字符 `♥/♡` 而非 SVG，保留原状不变

## 影响

- 正面：消除 2×28 = 56 行重复代码；一处修改全局生效；更易于单元测试
- 负面：新增一个文件；增加一个导入依赖
- 风险：无（纯机械提取，零行为变化）

## 符合原则

- 可维护性：单一职责，一处修改
- AI 可导航性：搜索 "HeartIcon" 而非在 900 行文件中搜索内联组件
- 删除测试：删除 HeartIcon 不影响 ImageCard/NovelCard 的业务逻辑
