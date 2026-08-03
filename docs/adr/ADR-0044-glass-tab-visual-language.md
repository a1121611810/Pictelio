# 玻璃 Tab 视觉语言（Glass Tab Visual Language）

Status: accepted

应用内五处 tab 控件（底部导航胶囊、顶栏内容类型切换、Feed 子标签栏、用户作品分段切换）原本各自为政、视觉不统一。经 Liquid Glass 三档原型验证（thread `019fc60e`，详见 `docs/specs/glass-tab-visual-language.md`），决定全局 Tab 采用 **A+ 档**：磨砂玻璃容器（`backdrop-filter` + `--colorNeutralBackgroundAlpha` tint + 顶部内高光）+ 激活项浮起玻璃胶囊；指针跟随高光仅限底部导航胶囊（300ms gentle，`prefers-reduced-motion` 时关闭）；**不做** SVG 折射/色差与 WebGL 弹性形变；Feed 卡片、详情页、阅读器不上玻璃。

理由：`backdrop-filter` 仅用于小面积静态面，避免滚动 Feed 上 SVG filter 每帧重绘与 WebGL 的成本；Android WebView（≥85）是主目标平台，A+ 档全平台行为一致，无 iOS 折射兼容损失。

Considered Options:

- **B 档（SVG 折射 + RGB 色差）**：Chromium 全效，但每帧重绘成本高；仅限底部胶囊时成本可控，作为后续可选增强，不在本期实现。
- **C 档（WebGL 湍流 + 弹性形变）**：移动端发热与滚动掉帧风险，否决。
- **全量液态玻璃覆盖卡片/阅读器**：大面积玻璃叠在滚动 Feed 上，性能不可接受，否决。

Consequences: 后续新增 tab 一律复用 `GlassTabBar` 组件与 `glass-tab-*` shortcuts；「为什么 tab 是玻璃而 Feed 卡片不是」以本文档为准，避免后续被误"修复"。
