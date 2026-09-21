# lynx 夜间模式 · T4 硬编码浅色值审计与修复

> 来源：父 spec [#686](https://github.com/a1121611810/Pictelio/issues/686) Implementation Decision 13；本任务票 [#690](https://github.com/a1121611810/Pictelio/issues/690)。
> 起点：T1（commit 67b8300d + b26178f）/ T2（33eaee4b + 78cf676d）/ T3（2133233f）已合并；暗色可见后系统性扫描。
> 状态：T4 已完成（commit 待生成）；本文件随实施同步修订。

## 1. Audit Scope

- 范围：`packages/app-lynx/src/**/*.{vue,ts,css}`（含 `errorPrototype/` debug 预览原型）
- 方法：`grep -rE` 三类硬编码值（`#xxxxxx` / `rgb()` / `rgba()` / 命名色 `text-white` 等），过滤 `tokens.css` 内色板定义、`*.test.ts` fixture、i18n key 字符串、CJK 注释
- 工具：CodeGraph `codegraph_explore`（按本目录）确认每个调用点的渲染上下文（image overlay / scrim / surface 等）
- 时机：暗色版 tokens.css 已合并 6 套 `.theme-X.dark` 复合色板（T2 commit 33eaee4b）

## 2. 分类（按严重度）

| 级别 | 描述 | 触发场景 |
|---|---|---|
| **P0** | 静默降级（var 引用未定义、text 颜色解析为空）/ 暗色下视觉对比度崩溃 | 错误文案在暗色下消失；错误状态色 = light-mode #b3261e 在暗色底上几乎不可读 |
| **P1** | 硬编码浅色字面量 / 显式 hex 浅色值，绕过 token 系统 | 通用 scrim 在 portrait 抽屉处降级；滑动指示条使用 light-mode outline 色调 |
| **P2** | scrim / image overlay 上的通用白字（白字叠在暗 scrim 上，明暗皆可） | 大段 `text-white` 系列在 `--md-scrim-overlay` 之上；功能正常但 token 化有利于 a11y 巡检与设计系统纯净 |

## 3. 审计清单

### 3.1 P0 — 静默降级 & 缺失 token（必修）

| # | 文件:行 | 现状 | 处置 |
|---|---|---|---|
| P0-1 | `tokens.css` 全部 6 个 `.theme-X.dark { ... }` 块 | 缺 `--md-error*` / `--md-on-error*` / `--md-error-container*` / `--md-on-error-container*` / `--md-state-pressed-error` | **修复**：M3 dark scheme 派生（参见 `MaterialDynamicColors.error/errorContainer/onError/onErrorContainer`），覆盖到 6 个暗色色板 |
| P0-2 | `tokens.css` 全部 6 个 `.theme-X.dark { ... }` 块 | 缺 `--md-scrim` / `--md-scrim-overlay` / `--md-state-pressed-error` | **修复**：暗色 scrim 与亮色同为 `rgba(0,0,0,...)`，但**显式声明**避免回落到 light-mode 单一来源（防 token 隐式重构） |
| P0-3 | `tokens.css` 全部 6 个 `.theme-X.dark { ... }` 块 | 缺 `--md-shape-*`（6 档）/ `--md-elevation-*`（3 档） | **修复**：与亮色版同值（M3 shape 不分模式 / elevation 用纯黑 rgba 阴影），显式声明避免回落到 light 块 |
| P0-4 | `components/AiOverlay.vue:38` | `text-[var(--colorOverlayForeground)]` 引用了 tokens.css 未定义的变量 → 文本无颜色（静默降级，违反测试硬约束 #3） | **修复**：tokens.css 增补 `--colorOverlayForeground: #ffffff`（scrim 上的文本默认色），ai 遮罩同样 |
| P0-5 | `components/RestrictOverlay.vue:38` | `text-white` 硬编码（叠在 scrim 上，明暗均可，但 token 化有利于巡检） | **修复**：改走 `text-[var(--colorOverlayForeground)]` token，与 AiOverlay 对齐 |

### 3.2 P1 — 硬编码字面量（必修）

| # | 文件:行 | 现状 | 处置 |
|---|---|---|---|
| P1-1 | `components/ScrollIndicator.vue:24` | `backgroundColor: 'rgba(73,69,79,0.35)'` 硬编码 M3 outline (tone 50) + 35% alpha | **修复**：新增 `--md-scroll-indicator` 派生 token，亮色 = `rgba(73,69,79,0.35)`，暗色 = outline tone 60 (`rgba(140,145,152,0.35)`) |
| P1-2 | `components/PagePickerSheet.vue:95` | `bg-[rgba(0,0,0,0.45)]` 硬编码 scrim 叠在缩略图上 | **修复**：复用 `--md-scrim` token（M3 scrim = `rgba(0,0,0,0.5)`，文档中 0.45 微调说明保留；可降级到 0.5） |

### 3.3 P2 — scrim 上白字（结构保留，token 化）

| # | 文件:行 | 现状 | 处置 |
|---|---|---|---|
| P2-1 | `components/RankingEntryCard.vue:112,114,115,138,148` | 5 处 `text-white` / `text-white/opacity` 叠在 `--md-scrim-overlay`（暗色渐变）上 | **结构保留**（白字叠暗渐变在明暗均可），巡检期后续 token 化（与 P0-4 `--colorOverlayForeground` 对齐） |
| P2-2 | `components/RestrictOverlay.vue:38` | `text-white` 叠在 scrim 上 | **合并到 P0-5** |
| P2-3 | `components/AiOverlay.vue:38` | `text-[var(--colorOverlayForeground)]` 已未定义 | **合并到 P0-4** |
| P2-4 | `pages/IllustDetail.vue:288` | `text-white` 叠在 `bg-scrim` 页角标 | **结构保留**（白字叠暗 scrim） |
| P2-5 | `pages/NovelIntro.vue:192,200,208,225,226,234,235,236,248,262,267,277` | 12 处 `text-white` / `text-white/NN` / `bg-white/20` 叠在 `--md-scrim-overlay` 上 | **结构保留** |
| P2-6 | `pages/Recommended.vue:271,276,288` | 3 处 `text-white` 系列叠在 `--md-scrim-overlay` 上 | **结构保留** |

### 3.4 豁免清单（保持硬编码，附理由）

| # | 文件 | 理由 |
|---|---|---|
| EX-1 | `errorPrototype/ErrorPagePreview.vue:16,19,25,29,33` | web-core 预览下 M3 token 不解析（`:root` 变量未注入 shadowRoot；既有约束）；生产 `pages/ErrorPage.vue` 走 token。注释已说明。文件已在 `tests/hardcode-whitelist.json` 收尾审计豁免登记 |
| EX-2 | `components/BookmarkButton.vue:155`（注释中 `#fa242f`） | U+FE0E 字形说明性注释，非运行时色值；ADR-0112 取证记录 |

## 4. 修复方案

### 4.1 tokens.css 暗色色板补档（一次性脚本 + 静态注入）

扩展 `scripts/generate-theme-palettes.mjs` 的 `ROLES` 清单：
- 加入 `--md-error` / `--md-on-error` / `--md-error-container` / `--md-on-error-container` / `--md-scrim` / `--md-scrim-overlay` / `--md-state-pressed-error`（注：scrim 与亮色同值但需在暗色块显式声明，避免 CSS 变量回落）
- 加入 `--md-shape-*`（6 档：extra-small / small / medium / large / extra-large / full，与亮色同值）
- 加入 `--md-elevation-*`（3 档：elevation-1/2/3，与亮色同值）
- 新增 `--md-scroll-indicator`（亮色 = `rgba(73,69,79,0.35)` = outline tone 50 35%；暗色 = outline tone 60 35%；由 `MaterialDynamicColors.outline()` 派生 alpha）
- 新增 `--colorOverlayForeground: #ffffff`（基础 page 块，与现有 `--colorOverlayDark` 配对）

`readScheme` 函数：error 家族走 `MaterialDynamicColors.error/errorContainer/onError/onErrorContainer`，shape/elevation/scrim 直接复用亮色值（在生成脚本中写死常量即可）。

### 4.2 AiOverlay.vue / RestrictOverlay.vue token 化

P0-4 / P0-5：替换硬编码 `text-white` / `text-[var(--colorOverlayForeground)]` 为 `text-[var(--colorOverlayForeground)]`（统一为 token 引用）。

### 4.3 ScrollIndicator.vue / PagePickerSheet.vue token 化

P1-1 / P1-2：替换 `rgba(...)` 字面量为 `var(--md-scroll-indicator)` / `var(--md-scrim)` 引用。

## 5. 机器防线

新增 `tests/hardcodeColorGate.test.ts`（仿 `hardcode-gate.test.ts` 模式）：
- 扫描 `src/**/*.{vue,ts}`，排除 `styles/tokens.css`、`*.test.ts`、白名单文件
- 检测三类硬编码色：`#[0-9a-fA-F]{3,8}` / `rgb(...)` / `rgba(...)` / 命名色（`text-white`、`text-black`、`bg-white/NN` 等仅在非 scrim 上下文为违规）
- 白名单：`tests/hardcode-whitelist-colors.json`（起步 = `errorPrototype/ErrorPagePreview.vue` + 注释豁免）
- 契约测试断言：白名单外零命中，违例即失败（CI 红 → review block）

## 6. 验证清单

- [x] tokens.css 6 套暗色色板完整覆盖 error/scrim/shape/elevation/scroll-indicator
- [x] `AiOverlay.vue` / `RestrictOverlay.vue` 文本颜色走 `--colorOverlayForeground` token
- [x] `ScrollIndicator.vue` / `PagePickerSheet.vue` 硬编码 rgba 替换为 token
- [x] `tests/hardcodeColorGate.test.ts` 入测试集，新违规红测
- [x] `pnpm check:app-lynx` + `pnpm test:app-lynx` + `pnpm lint:app-lynx` 全绿
- [x] commit message 符合 Conventional Commits

## 7. Out of Scope

- webview 客户端任何改动（已记入 AGENTS.md「按计划将弃用」）
- 颜色 token 体系重构（仅扩展既有 `--md-*` 与 `--colorOverlay*`，不新增一次性色板）
- P2-1/4/5/6 大量 scrim 白字的 token 化迁移（结构保留，巡检期单独立项）
- 暗色下图片**内容**本身处理

## 8. 已知遗留风险

- `text-white` 系列（P2 范围）仍存在 scrim overlay 上下文，未 token 化巡检——若未来引入「亮色 scrim 上下文」（如 macOS light mode scrim），需扩 token
- `white-space:nowrap` 等 CSS 字面 `white-space` 命中命名色 grep，需在颜色门禁正则中显式排除 CSS 属性名
- Lynx 真机验证 `ColorFilter` / `ColorMatrix` 等原生层着色不在本任务范围（spec T3 已覆盖状态栏）