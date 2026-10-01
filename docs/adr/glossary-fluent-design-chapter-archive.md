# Fluent Design 规范章 — 存档归档（逐条适用性判定）

> **这是 `AGENTS.md`「Fluent Design 规范（历史存档）」章的完整存档。**
> 该章服务于**已随 [ADR-0203](./ADR-0203-webview-client-source-removal.md) 整包删除的 WebView 客户端**。
> 拆分原因：它与 app-lynx 的现行约束无关，却占用了 `AGENTS.md` 的项目指令字节预算
> （运行时按 32 KiB 截断，超出会让后续每个会话读不到后面的章节）。
>
> **现行设计约束只有 MD3 一套**，见 `AGENTS.md`「约定 → app-lynx 的 MD3 约定」与
> [`glossary-md3-alignment.md`](./glossary-md3-alignment.md)。
> 基线决策：[`ADR-0205-md3-baseline-and-scope.md`](./ADR-0205-md3-baseline-and-scope.md) 决策 2。
>
> 逐条判定口径见下表三列：**仍成立** = 纪律与设计系统无关，MD3 下同样有效（改用 `--md-*` 口径）；
> **存档条款** = 只对 Fluent 2 成立；**已失效** = 载体随 WebView 客户端一并消失。

---

## Fluent Design 规范（历史存档，非现行约束）

> ⚠️ **历史存档（ADR-0203）**：本章服务的是 **WebView 客户端**——其运行时随 #610 下线，
> **源码与依赖随 ADR-0203 整包删除**，仓库中不再保留（术语见 `docs/adr/glossary-webview-client-removal.md`）。
> 唯一客户端 `pictelio-app-lynx` 使用 **Material Design 3**；**现行设计约束只有一套**，见「约定」→ **app-lynx 的 MD3 约定**。
> 本章**只为决策史保留**，对 app-lynx 新代码**不具约束力**；章内条款已逐条标注在 MD3 下的适用性。

**判读规则**：**仍成立** = 纪律与设计系统无关，MD3 下同样有效（改用 `--md-*` 口径）；**存档条款** = 只对 Fluent 2 成立，不再执行；**已失效** = 载体随 WebView 客户端一并消失。原章的「必须 / 禁止 / 只允许」是当时的原文口吻，**不是现行约束**；下面是历史记录，不是待办清单。

### 设计令牌

- **仍成立**｜颜色、间距、圆角、阴影、字体大小必须用 CSS 变量 —— MD3 口径 = `src/styles/tokens.css` 的 `--md-*`（单一事实源不变）
- **仍成立**｜禁止硬编码具体值（`#xxx`、`rgb()`、`px`/`rem` 字面量）—— 窄例外见「约定」的未路由原型页一条
- **仍成立**｜视觉令牌在 `src/styles/tokens.css` 的 `:root` 中声明后使用
- **已失效**｜排版令牌（`--fontSizeBase*`）在 `uno.config.ts` preflights 中以 `clamp(rem + vw)` 定义 —— `uno.config.ts` 随客户端删除，现为 `tailwind.config.ts` 的 `fontSize`（rpx）
- **存档条款**｜新增令牌的来源必须是 [Fluent 2 官方设计令牌](https://fluent2.microsoft.design/design-tokens) —— MD3 的令牌来源改为 material-web v0.192 生成令牌文件（见「约定」）
- **已失效**｜UnoCSS shortcuts 统一在 `uno.config.ts` 中定义 —— 同上，UnoCSS 已随客户端删除
- **已失效**｜`@fluentui/web-components` 的 `setTheme()` 在 `main.tsx` 中同步亮/暗 —— 依赖与 `main.tsx` 已随客户端删除，现为 `tokens.css` 色板类 + `utils/darkMode.ts`

### 动画与动效

**原章缓动曲线（存档，仅 4 种）：**

| 曲线                          | 用途                 |
| ----------------------------- | -------------------- |
| `cubic-bezier(0,0,0,1)`       | exit / decelerate    |
| `cubic-bezier(0.33,0,0.67,1)` | standard             |
| `cubic-bezier(0.33,0,0,1)`    | enter / accelerate   |
| `linear`                      | 仅限 loading spinner |

**原章动画时长（存档，仅 5 档）：**

| 时长  | 名称   | 场景                          |
| ----- | ------ | ----------------------------- |
| 100ms | micro  | 微交互（ripple、checkbox）    |
| 150ms | fast   | 小过渡（tooltip、hover 反馈） |
| 200ms | normal | 常规过渡（页面元素进出）      |
| 300ms | gentle | 柔缓过渡（弹窗、面板）        |
| 500ms | slow   | 大幅过渡（页面切换、展开）    |

- **存档条款**｜缓动只允许上表 4 条，原章禁令为 **禁止** `ease`、`ease-in`、`ease-out`、`ease-in-out` —— MD3 口径是「只允许 `--motion-*` 四条」（`emphasized` 与 `standard` 同为 `(0.2,0,0,1)`，**同值是官方事实**；`(0.4,0,0.2,1)` 是 `easing-legacy`，MD2 遗留，应避免）
- **存档条款**｜时长只允许上表 5 档 —— MD3 改走 duration scale（short/medium/long 1-4）
- **已失效**｜页面过渡统一使用 `PageTransition.tsx` —— 该文件随客户端删除
- **存档条款**｜组件内动效优先用 Fluent motion tokens（`--durationNormal`、`--curveEasyEase`）—— MD3 改走 `--motion-*` / `--duration*`

### 交互状态

- **仍成立（部分）**｜可交互元素须覆盖三态 —— MD3 四态为 hover .08 / focus .12 / pressed .12 / dragged .16 的 alpha 层；其中 `focus-visible`（禁裸 `:focus`）**仍是待补项**，`hover` 在纯触屏**判定为不适用**（见「约定」的有意偏离清单第 4 条）
- **存档条款**｜`active`（pressed）用 `scale(0.98)` 或 pressed 颜色加深 —— MD3 的 pressed 是 12% alpha 叠加层，不是「颜色加深」的实色近似
- **存档条款**｜触控目标最小 40×40px —— MD3 / Android 平台**建议** ≥48×48dp，WCAG 2.2 AA 的**最小值**是 24×24 CSS px（三口径不是一回事，术语文档 §9.1）

### 禁止清单（存档表 + MD3 下的判定）

| 原章禁止项                                | 原章要求的替代                                   | MD3 下的判定                              |
| ----------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| 硬编码颜色值（`#xxx`、`rgb()`）           | `var(--colorXxx)`                                | **仍成立** → 改 `var(--md-*)` 角色令牌     |
| 硬编码圆角值（`8px`、`0.5rem`）           | `var(--borderRadiusXxx)`                         | **仍成立** → 改 `var(--md-shape-*)`        |
| 硬编码阴影值                              | `var(--elevationN)`                              | **仍成立** → 改 `var(--md-elevation-*)`    |
| 非 Fluent 缓动曲线                        | Fluent 标准曲线（见上表）                        | **存档条款** → 只允许 `--motion-*`         |
| 非标准动画时长                            | Fluent duration（见上表）                        | **存档条款** → 走 `--duration*` / 官方档位  |
| 自定义字体大小（`15px`、`1.2rem`）        | `var(--fontSizeBaseXxx)` 或 `var(--fontSizeHeroXxx)` | **仍成立** → 改语义档位 `text-body-medium` |
| 裸 `:focus` 伪类                          | `:focus-visible`                                 | **仍成立**（无障碍关键路径，仍待补）        |
| `[color:var(--colorXxx)]` 形式            | `text-[var(--colorXxx)]`                         | **仍成立** → 变量名换 `--md-*`             |
| `[background-color:var(--colorXxx)]` 形式 | `bg-[var(--colorXxx)]`                           | **仍成立** → 变量名换 `--md-*`             |
| `duration-200` / `duration-300` 等        | `duration-[var(--durationNormal)]` 等            | **存档条款** → 官方 duration 档位          |
| `bg-black` / `text-white` 硬编码          | 使用 overlay token（`--colorOverlay*`）          | **仍成立** → 改 `--md-scrim` / `inverse-*` 等角色 |

> **章尾存档声明**（与章首同义，ADR-0205 决策 2 要求双标注）：以上内容截至 ADR-0203 **只对已删除的 WebView 客户端**有效。
> app-lynx 的现行设计约束**只有 MD3 一套**，写在「约定」→ **app-lynx 的 MD3 约定**；冲突时**以那一节为准**。
> 两者都不适用 = 该设计决策**尚未记录**——补 ADR，不要就地自造规则。
