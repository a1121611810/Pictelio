# ADR 0055: vue-lynx 原生渲染兼容策略（真机实测问题系统化）

## 状态

已采纳（真机完整流程验证通过）

## 分类

技术决策 / 兼容性

## 日期

2026-08-02

## 背景

web-core 预览验证过的 app-lynx 页面在**原生 LynxView（fiber 渲染）**下暴露多处行为差异——真机 `lynx-flow-check.sh` 完整流程实测逐一暴露。这些不是 web-core 缺陷（glossary-web-core-pitfalls 覆盖），而是**原生端**的独立兼容问题，需系统化防护。

## 决策

### 1. 事件：原生 `text` 与 `list-item` 根级 `@tap` 失效

vue-lynx 原生 fiber 下 **`<text>` 元素与 `<list-item>` 根级绑定的 `@tap` 不触发**（`<view>` 的 tap 正常，真机实测：♥ 在 view 内工作、"‹ 返回"/"小说"在 text 上失效）。

**防护**：所有交互绑定移到**外层 `<view>`**：
- `list-item` 内容包一层 `<view @tap="...">`（♥ 的 `@tap.stop` 仍阻止冒泡）
- `text @tap` → `<view @tap>` 包裹（返回/翻页/小说/我的，4 个页面）

### 2. 布局：scroll-view 内 style `aspectRatio`/`minHeight` 失效

详情大图（`SkeletonImage` 的 `:style="{ aspectRatio, minHeight }"`）在**原生 scroll-view 内**不生效 → 容器高度 0 → 大图空白（推荐页 list 内正常）。

**防护**：详情大图改**固定高度容器**（`h-[100vw]` Tailwind class）+ 裸 `<image>`（aspectFill），不依赖 aspect-ratio style。动态 `aspect-ratio`（`${width}/${height}`）一律避免。

### 3. 元素：`<input>` 是 XElement 扩展元件

`<input>`/`<textarea>` 不在 lynx 基础元素集 → 需 `xelement` + `xelement-input` 依赖 + `LynxViewBuilder.addBehaviors(new XElementBehaviors().create())`（官方集成文档要求，真机 990200 实锤）。

### 4. 数据：list `item-key` 必须 String

`<list-item :item-key>` 传数字 id → lynx 报 220201（illegal item-key）。**一律 `String(item.id)`**。

### 5. 壳：MainActivity lynx 分发必须先 `super.onCreate`

lynx 分支直接 `return` 跳过 `super.onCreate()` → `SuperNotCalledException`（Android 硬约束）。**先 `super.onCreate` 再跳转**（bridge 初始化浪费可接受）。

## 验证

- 真机 `lynx-flow-check.sh` 全自动 PASS（登录→收藏→详情→小说→我的/R18）
- app-lynx 54 单测 + android 全量单测 + assembleDebug 全绿

## 相关

- 提交：`e8f412f`（super.onCreate）、`be1fd1a`（XElement）、`b9fe2c7`（item-key）、`c0d74f0`（text/list-item tap + 详情大图）
- 术语：`glossary-app-lynx-native.md`（含事件/布局防护速查）
