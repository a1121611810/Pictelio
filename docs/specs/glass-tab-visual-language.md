# 全局 Tab 玻璃视觉语言（Glass Tab Visual Language）—— 功能规格

> 来源：grill-with-docs 会话（Q1–Q5 已全部确认）；效果基准：Liquid Glass 三档原型（thread `019fc60e`）+ `docs/research/liquid-glass-app-lynx-feasibility.md`（worktree eff5 / 主 checkout 深度版）
> 状态：ready-for-tickets（待用户确认后进入 to-tickets 拆分）

## Problem Statement

应用内存在五处 tab 类切换控件，各自为政：

| Tab 形态 | 位置 | 现状 |
|---|---|---|
| 底部导航胶囊（推荐/关注/收藏/历史 + 搜索钮） | `components/NavBar.tsx` + `uno.config.ts` 的 `floating-nav-*` | 已有一层磨砂（blur 30px / saturate 125%），激活态仅品牌色文字，无层次 |
| 顶栏内容类型切换（插画/小说） | `routes/HomePage.tsx` | 普通中性色胶囊，无玻璃 |
| Feed 子标签栏（综合/插画/漫画；公开/非公开） | `components/RecommendedFeed.tsx`、`components/FollowFeed.tsx`、`routes/NovelFollowFeed.tsx` | sticky `surface-appbar` + 普通胶囊，无玻璃 |
| 用户作品分段切换（插画/漫画/小说） | `routes/UserIllusts.tsx` | `segmented-*` 普通分段控件 |

五套独立写法导致视觉不统一、维护成本高。目标：以 Liquid Glass 效果为基准，统一全局 tab 视觉语言，同时守住性能边界（Android WebView、滚动 Feed 上的大面积重绘风险）。

## Solution（A+ 档）

只统一样式层，**不触碰任何路由 / tab 切换 / 滚动逻辑**。

1. **统一组件**：新增 `components/ui/GlassTabBar.tsx`，支持两种形态：底部胶囊导航（含中心按钮位）与单行分段（顶栏切换 / 子标签 / 作品分段复用）。五处全部替换为同一组件族。
2. **视觉规格（全部 Fluent 令牌，零硬编码）**：
   - 容器：`--colorNeutralBackgroundAlpha` tint + `--backdropBlurDefault`（30px）+ `--backdropSaturateDefault`（125%）+ 1px `--colorNeutralStroke2` 描边 + 顶部内高光（白色 alpha 线性渐变层）
   - 激活项：浮起的玻璃胶囊 = 磨砂提亮 + `--elevation2` + 高光描边 + `--colorCompoundBrandForeground1` 文字
   - 非激活项：`--colorNeutralForeground3` 文字，hover / active / focus-visible 三态沿用现有 Fluent 规范
3. **动效（Q4）**：仅底部胶囊做指针跟随高光（300ms 缓动，仓库令牌为 `--durationSlow`）；`prefers-reduced-motion: reduce` 时关闭一切动效。
4. **明确不做**：SVG 折射、RGB 色差、WebGL 弹性形变（C 档）；Feed 卡片、详情页、阅读器不上玻璃；不引入新依赖。

## User Stories

1. 作为用户，我希望所有 tab 切换控件外观一致（底部导航、插画/小说切换、子标签、作品分段），以便界面统一。
2. 作为用户，我希望当前激活 tab 有清晰可见的「浮起玻璃胶囊」反馈，以便知道当前所在页。
3. 作为用户，我希望底部导航胶囊在滚动 Feed 上仍保持可读（磨砂 + 描边），以便内容滚动时不糊。
4. 作为用户，我希望亮/暗色下玻璃效果都自然（alpha 令牌自适应），以便不刺眼。
5. 作为用户，我希望系统开启减弱动态效果时无玻璃动效，以便符合系统偏好。
6. 作为开发者，我希望 tab 样式收敛到统一组件与统一 shortcut，以便后续增删 tab 只改一处。

## 范围（Q1 确认）

覆盖五处：

1. NavBar 底部胶囊（推荐/关注/收藏/历史 + 中心搜索钮）
2. HomePage 顶栏内容类型切换（插画/小说）
3. RecommendedFeed 子标签（综合/插画/漫画）
4. FollowFeed / NovelFollowFeed 子标签（公开/非公开）
5. UserIllusts 分段切换（插画/漫画/小说）

排除项：不改路由 / tab 切换 / 滚动 / 缓存逻辑；Feed 卡片、详情页、阅读器不上玻璃；不做 Lynx / app-lynx 侧工作；不引入新依赖。

## 数据流与状态变化

纯样式任务，**无数据流变更**。视觉状态变化：

- 激活 tab：item 由 `inactive` → `active`（浮起玻璃胶囊 + 品牌色文字）
- hover / pressed / focus-visible 三态沿用现有 Fluent 交互规范
- `prefers-reduced-motion: reduce` → 移除指针跟随高光与过渡动画
- 主题切换（亮/暗）→ alpha 令牌自动适配，**不新增**暗色分支（Q5）

交互层状态（`currentTab`、`setCurrentTab`、`contentType`、`recommendSubTab` 等）**零改动**。

## 边界条件

- **WebView 兼容**：Android WebView ≥85 支持 `backdrop-filter`（项目基线内）；不支持时浏览器自动忽略 filter，容器退化为纯半透明 tint，无需 JS 检测分支。
- **性能**：`backdrop-filter` 仅用于小面积面。Feed 子标签栏为 sticky 单行、内容固定，blur 区域小，可接受；若实测滚动掉帧，预案为「滚动中临时降级 blur」（风险预案，不在本期实现）。
- **暗色**：顶部内高光与描边用白色 alpha 令牌，暗色下亮度自动降低，不额外分支。
- **触控**：保持 ≥40×40 触控目标，现有 `min-h-*` / `min-w-*` 不变。
- **长标签**：「非公开」等不截断、不换行破坏布局，flex 布局与现有 padding 保持一致。
- **无障碍**：focus-visible 保持现有双环 focus 令牌；aria 语义（`role="tab"`、`aria-selected`、`aria-current`）原样保留。

## 验收标准

- 五处 tab 视觉统一（同一组件 / 同一 shortcut 族，无残留的旧样式类副本）
- 亮/暗色截图对比：无模糊、无布局位移、激活态清晰
- `pnpm check`（tsc）与 `pnpm lint` 通过；新增文件通过 oxfmt
- `prefers-reduced-motion` 下无动效
- 无新增依赖；diff 仅含样式层与组件抽取（无逻辑/路由改动）

## Implementation Decisions（to-tickets 阶段细化）

- 组件：`components/ui/GlassTabBar.tsx`，Props 形态参考现有 NavBar 与 segmented 用法（items / activeKey / onSelect / 形态开关）
- shortcuts：`uno.config.ts` 新增 `glass-tab-bar` / `glass-tab-item` / `glass-tab-item-active`；`surface-appbar` 保留（sticky 子标签容器仍用它）
- 令牌：优先复用现有令牌；确需新增时在 `tokens.css` 补派生值并注明 Fluent 来源
- NavBar 指针跟随高光：胶囊内加高光层（pointermove 更新），300ms gentle；不做弹性形变
- 测试：implement 阶段按 `/tdd` 规则决定——若仓库有组件测试先例则补 GlassTabBar 单测（激活态 class 映射、reduced-motion 分支），否则以截图/手工验收为主

## 风险

- 滚动 Feed 上 sticky 玻璃容器的性能（预案见边界条件）
- 视觉回归：五处替换后需逐处亮/暗截图比对
- 本方案不含折射/色差，iOS 无兼容损失（thread 中 B 档的 iOS 限制与本方案无关）
