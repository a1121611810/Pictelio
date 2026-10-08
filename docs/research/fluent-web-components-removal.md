# 移除 @fluentui/web-components 可行性报告（pictelio-app 全手写替代方案）

> 日期：2026-09-09
> 分析对象：`@fluentui/web-components@3.0.3`（含 `@fluentui/tokens@1.0.0-alpha.23`、peer 依赖 `@microsoft/fast-element@3.0.1` / `@microsoft/focusgroup-polyfill@1.5.0`）
> 当前分支：`feat/solidjs-2-migration`（solid-js 2.0.0-rc.6 + @solidjs/router 2.0.0-next.21 + @tanstack/solid-query 6.0.0-rc.3，commit `1d6e696b`）
> 体积基线：`packages/app/dist/`（2026-09-09 01:38 构建产物，本分支）
> 调查方法：OpenWiki 架构页（overview）→ 全量 grep 用法普查（开标签计数）→ 关键文件精读 → dist chunk gzip 实测 → npm registry dist-tags 直查

---

## 1. 执行摘要

**Verdict：有条件建议做（Do, conditionally）——方案本身可行且收益为正，但必须排在 SolidJS 2 迁移合入之后执行，作为独立的 5 期系列（P0–P4），总成本约 7–11 人日。**

核心理由：

1. **体积收益实打实但非决定性**：`fluent-vendor` chunk（含 fast-element 全部运行时，已验证打包在同一 chunk）gzip 后 39.7KB，占全部 JS gzip 的 15.3%；扣除手写替代约 +2KB gzip，净收益约 **−38KB gzip（−163KB raw）**，且该 chunk 由 `main.tsx:10-22` 静态导入，**在首屏解析路径上**，对 WebView 冷启动有解析/编译收益。
2. **摩擦消除是比体积更强的论据**：项目已为这 13 个自定义元素支付了持续的"摩擦税"——`FluentDialog.tsx` 155 行纯 workaround 封装（open 属性缺失、shadow slot 重映射、rAF 等异步升级轮询）、`fluentOn.ts` 事件 shim（SolidJS 2 移除 `on:` 命名空间后 62 处迁移点**全部**源自 fluent 组件）、E2E 测试中至少 6 类针对 shadow DOM/property-vs-attribute/CLI click 失效的 workaround。手写后这些**整体归零**。
3. **主题链路零缺口**：`setTheme` 仅是把 Fluent token 写成 CSS 自定义属性供组件 shadow 内消费；应用自身的 Fluent 2 设计系统 100% 由自有 `tokens.css`（481 行，手抄自规范，无运行时依赖）承载。移除后删掉 `setTheme` + MutationObserver + `@fluentui/tokens` import 三段即可，主题同步链路反而简化为单条。
4. **AGENTS.md 强制的是 Fluent 2 设计令牌与视觉，不是 @fluentui 包**——手写组件消费同一套 tokens.css 即完全合规，且已有先例：`StartupUpdateDialog` 因 fluent-dialog 缺陷已改纯 CSS overlay（`StartupUpdateDialog.tsx:25-33`）。
5. **上游不是"弃维护"但地基仍是 alpha**：@fluentui/web-components 活跃（latest 3.1.3，2026-08-25，周级发布），但 token 基础包 `@fluentui/tokens` 的 latest 至今是 **1.0.0-alpha.24**——依赖链的地基多年未出 stable，继续锁定的供应链风险真实存在。

关键数字一览：

| 指标 | 数值 |
|---|---|
| 需替换元素实例 | 112 个（12 种元素，30 个模板文件；drawer 为死 import） |
| 手写组件层新增 | 约 560 LOC（10 个组件，含样式） |
| 调用点模板改写 | 约 30 文件 110+ 处（机械替换） |
| 总人力估计 | **7–11 人日**（含单测/E2E 选择器迁移/视觉比对） |
| 体积净收益 | **−163KB raw / 约 −38KB gzip**（占 JS gzip 15.3%→净 14.7%） |
| 删除的 workaround 代码 | FluentDialog 封装 155 行 + fluentOn 21 行 + happy-dom ElementInternals polyfill + 6 类 E2E workaround |
| 最大单项风险 | 50 处 button 的视觉/交互回归面（缓解：单组件收敛 + 视觉比对 + E2E 全量） |

---

## 2. 现状盘点

### 2.1 依赖接入面（极窄，利于移除）

`@fluentui/*` 的全部 import 只有 **2 个文件**（grep 全量核实）：

- `packages/app/src/main.tsx:8-22`——`setTheme` + `webLightTheme/webDarkTheme` + 13 个组件 side-effect 注册 import
- `packages/app/src/types/fluent.d.ts`——SolidJS JSX 类型补充（全部为 `Record<string, unknown>`，即**当前模板层对 fluent 组件本来就是零类型安全**）

没有其他文件 import @fluentui；没有 `document.createElement("fluent-…")`（src 范围 grep 为 0）；没有 CSS 规则直接选择 `fluent-*` 元素（styles/ 目录 grep 仅命中应用层 `fluent-*` 动画 keyframes，与组件无关）。

`vite.config.ts:288-291` 的 manualChunks 将 `@fluentui` 路径独立成 `fluent-vendor` chunk；`vite.config.ts:117` 将 `fluentOn` 注册为 auto-import。

### 2.2 用法矩阵（按开标签 `<fluent-X` 精确计数实例）

| 元素 | 实例数 | 文件数 | 实际消费的 attributes / events / slots（全量普查） |
|---|---|---|---|
| fluent-button | 50 | 24 | `appearance`：primary×18、secondary×16、subtle×18（transparent 类型允许但 0 使用）；`disabled`；`aria-label`；`class` 透传 UnoCSS（如 `w-8 h-8 p-0 min-w-8`，ImageHostSettings.tsx:152）；内联 `style` 覆盖内部 custom prop（`--block-size:50px`，Login.tsx:175）；`slot="actions"`（对话框内 3 处，ImageHostSettings.tsx:496/502 等）；子元素 `slot="start"` 放 spinner（ClientSwitch.tsx:252、ImageHostSettings.tsx:466）；事件：`onClick`（Login.tsx:186）与 `fluentOn("click")`（ImageHostSettings.tsx:461）**两种写法并存**。`size` 属性 0 使用 |
| fluent-badge | 17 | 5 | `appearance="filled"`（15/17 使用，其余默认）；`color` danger×3、warning×3；一处 `style` 字号覆盖（GridCard.tsx:92）。使用点全部是 R18/R18G/AI/完结等状态徽标（ImageCard.tsx:95-107、NovelCard.tsx:83-266、GridCard.tsx:74-94、NovelTextListCard.tsx:79-109、IllustSingleCard.tsx:91-103） |
| fluent-switch | 15 | 7 | `checked={signal()}` + `fluentOn("change", …)` + `aria-label`（SettingsAppearance.tsx:54-58 等）；`disabled` 少量。事件为 fluent 自定义事件，Solid 委托不覆盖，必须走 fluentOn |
| fluent-message-bar | 7 | 4 | `intent`：success×4、warning×2、error×1（默认 info 0 使用）；`close` 事件×1（ImageHostSettings.tsx:176，可关闭条）；3 处作 fixed 定位 toast（Settings.tsx:86-88、IllustDetail.tsx:614-616） |
| fluent-divider | 6 | 5 | 仅 `style="margin-inline:var(--spacingHorizontalXL)"`（ReportSheet.tsx:82 等）——**纯视觉，替代成本≈0** |
| fluent-spinner | 5 | 4 | `size`：tiny×4、medium×1；`slot="start"` 嵌入 button×1（ImageHostSettings.tsx:466） |
| fluent-dialog / fluent-dialog-body | 1 个模板点（5 个消费组件） | 1 | 唯一模板点在 `FluentDialog.tsx:146-150`；消费方 SettingsTranslate/SettingsImage/SettingsDialogs/NovelDetail/ImageHostSettings 五处。API 面：`show()/hide()` 方法（**无 open 属性绑定**，FluentDialog.tsx:19-23）、`close` 自定义事件、shadow 内 `dialog.open` 状态探测（FluentDialog.tsx:64-66）、dialog-body 命名 slot `title`/`action`（复数 actions 需重映射，FluentDialog.tsx:45-57） |
| fluent-textarea | 2 | 2 | `value=`、`input`→fluentOn、`placeholder`、`required`、`disabled`、`style="--inline-size:100%;--min-block-size:80px"`（Login.tsx:195-201、DebugImage.tsx:44-49） |
| fluent-radio-group | 2 | 2 | `value=`、`change`（读 `CustomEvent.detail.value`，ImageHostSettings.tsx:224-235）、`disabled`、`class`。**命令式回写 value 需 rAF 等子元素升级**（ImageHostSettings.tsx:47-57 注释） |
| fluent-radio | 2 个模板点（循环展开多个实例） | 2 | `id`、`value`、`checked`、`disabled`、`fluentOn("click")` 与 group 级 change **双重绑定**（ImageHostSettings.tsx:263-267、ReportSheet.tsx:96-98）；外部 `<label for>` 关联 |
| fluent-checkbox | 2 | 1 | `checked`、`change`→fluentOn、`disabled`、`aria-label`（ImageHostSettings.tsx:369-374、538-540） |
| fluent-drawer | **0（死 import）** | 0 | `main.tsx:16` 导入 `drawer.js` 但全仓库（src+tests）仅 `types/fluent.d.ts` 提及。**死代码** |

结论：实际消费面远小于组件库能力面。**没有**用到 size 变体（button）、transparent appearance、info intent、icon slot（除 spinner start）、drawer、compound button 等。表单行为只用了受控 value/checked + change/input 两个事件，**未使用** form 关联提交（除 textarea `required` 在 Login form 内）。

### 2.3 主题链路（移除后无缺口，链路反而简化）

双 token 系统并行，互不依赖：

```
themeStore → themeApplier.applyDarkClass()（themeApplier.ts:33-36）
  → <html>.dark 类切换
     ├─ 消费方 A（应用 UI，占绝对主体）：tokens.css :root.dark 段（tokens.css:205）
     │    覆盖自有 --colorXxx/--spacingXxx 等 ~481 行令牌（手抄自 Fluent 2 规范，tokens.css:3 注明
     │    "Based on @fluentui/tokens v9"，纯静态 CSS，无运行时依赖）
     └─ 消费方 B（仅 fluent 组件 shadow 内部）：main.tsx:28-45 MutationObserver 监听 .dark
          → setTheme(webDarkTheme/webLightTheme)
```

`setTheme` 的真实作用（上游源码 `dist/esm/theme/set-theme.js:37-62` 实读）：把 theme 对象的每个 token 写成 `--tokenName: value` CSS 自定义属性（modern 环境走 adoptedStyleSheets/作用域注入，兜底写 documentElement.style），供 fluent 组件 shadow 模板里的 `var(--colorNeutralForeground1)` 消费。**它对应用自身样式零作用**——tokens.css 已在 `:root`/`:root.dark` 提供同名变量。

移除后的处置：删 `main.tsx:8-9,28-45`（setTheme、tokens import、syncFluentTheme、MutationObserver）共约 20 行。**缺什么：什么都不缺**。app-lynx 客户端与 @fluentui 无任何关系（openwiki/architecture/overview.md 设计系统章节：lynx 侧是 M3）。

### 2.4 体积基线（2026-09-09 01:38 dist 实测，`gzip -c | wc -c`）

| chunk | raw (B) | gzip (B) | 备注 |
|---|---|---|---|
| **fluent-vendor-BWuJmoOq.js** | **163,025** | **39,745** | 含 @fluentui/web-components + @fluentui/tokens + **fast-element 全部运行时**（chunk 头部可见 fast-element DI 错误码 enum `bindingInnerHTMLRequiresTrustedTypes` 等，尾部是 `.define()` 组件注册 + token 展开——即 fast-element 并未落入 vendor chunk，整条链可一次移除） |
| index-DcnObBDU.js | 457,388 | 125,153 | 应用代码 |
| tanstack-vendor | 149,772 | 47,786 | |
| vendor | 128,367 | 43,907 | 其余 npm 依赖 |
| 其余 10 个小 chunk | 5,396 | 1,380 | |
| **JS 合计** | **903,948** | **259,771** | |
| CSS（index-*.css） | 69,518 | — | 移除后基本不变 |

占比：fluent-vendor 占 JS raw **18.0%**、占 JS gzip **15.3%**。该 chunk 由 main.tsx 静态 side-effect import 引入，**必然进入首屏加载与解析**（路由已全部静态 import，见 openwiki overview v3.21.5 注）。

手写替代增量估计（假设：10 个组件约 560 LOC TSX+CSS，经 Oxc minify 与 gzip 约 6–8:1 压缩率）≈ +8–10KB raw / **+1.5–2KB gzip**。净收益 ≈ **−38KB gzip**。

### 2.5 已有本地替代品与 workaround 资产

- `components/ui/FluentDialog.tsx`（155 行）：对 fluent-dialog 的完整 workaround 封装——open→show()/hide() 转换、slot 重映射（actions→action、剥除 content）、`showWhenReady` rAF 轮询 120 帧等自定义元素异步升级（FluentDialog.tsx:84-99）、onSettled 兜底。**这证明"包装层收敛契约"的模式已跑通，但也证明摩擦真实存在**（ADR-0087 记录了 slot 契约破坏事故）。
- `components/StartupUpdateDialog.tsx:25-33`：因"动态创建时 open 不触发 showModal 且 slot 系统导致按钮不可见"，**明确弃用 fluent-dialog 改纯 CSS fixed overlay**——手写替代的现成先例与视觉模板。
- `components/ui/FluentIcon.tsx`：24 个自维护 SVG 图标。
- `components/LoadingSpinner.tsx`：品牌级 loading（logo 扫光），**不覆盖** 5 处 inline spinner 场景（那 5 处是 tiny/medium 小圈），需新写小 spinner。
- `primitives/fluentOn.ts`（21 行）：SolidJS 2 移除 `on:` 命名空间后的事件 ref 工厂（ADR-0144 D3-5）。移除 fluent 后**整体删除**——`docs/research/solidjs-2-migration-impact.md` 统计的 62 处/24 文件 `on:` 迁移点**全部**由 fluent 组件产生，这一整条 SolidJS 2 迁移风险轴将随移除消失。

---

## 3. 逐组件手写成本评估

评估基准：WebView ≥ 85（`variables.gradle` minSdk 28 / `MainActivity` WebView≥85 门禁，AGENTS.md 约定节）；`<dialog>` 核心 API Chrome 37 全支持（`docs/research/dialog-element-migration-feasibility.md` BCD 矩阵）；happy-dom 无 `ElementInternals`（FluentDialog.test.tsx:208 已有 polyfill 先例）——**手写组件若基于原生 input/button/dialog 则完全不依赖 ElementInternals，单测反而变简单**。

| 组件 | 用量 | 需覆盖的 ARIA/行为 | 手写方案要点 | LOC 估计 | 难度 | 已有替代 |
|---|---|---|---|---|---|---|
| Badge | 17 | 无（视觉件） | `<span>` + tokens.css 类；`appearance`/`color` 两 prop 映射 token 组合 | ~20 | 低 | 无需 |
| Divider | 6 | `role="separator"`（`<hr>` 隐式） | `<hr>` + margin 样式 | ~8 | 低 | 无需 |
| Spinner | 5 | `role="progressbar"`/`aria-busy` 加分项 | CSS 圆环 + `fluent-shimmer` 同族 keyframes；size tiny/medium 两档 | ~25 | 低 | LoadingSpinner 是品牌级，不覆盖；需新写 |
| MessageBar | 7 | `role="status"`（toast 场景已有外层 `aria-live="polite"`，ClientSwitch.tsx:103） | div + intent→token 映射（success/warning/error/默认 info）；可关闭条 ×1 补 dismiss 按钮 | ~50 | 低-中 | 无 |
| Switch | 15 | `role="switch"` + `aria-checked` + 空格/回车键翻转 | 原生 `<input type="checkbox">` 视觉重绘（track+thumb CSS 过渡）→ 键盘与表单语义免费；`checked` 受控 + `onChange` | ~70 | 中 | 无 |
| Checkbox | 2 | 原生 checkbox 语义 | 同上，更简单 | ~40 | 低-中 | 无 |
| RadioGroup/Radio | 2 组 | 原生 radio name 分组 + 方向键导航免费 | `<fieldset>`/容器 + `<input type="radio">` 列表；value/onChange 向上收敛 | ~80 | 中 | 无 |
| TextArea | 2 | 原生 textarea 语义 + `:focus-visible` outline（tokens） | 原生 `<textarea>` + Fluent 2 边框/圆角/聚焦环样式 | ~35 | 低 | 无 |
| Button | 50 | 原生 `<button>` 语义全免费 | appearance 三变体（primary/secondary/subtle）token 化样式；disabled、icon 子元素、`min-h 40px` 触控目标；class/style 透传 | ~100 | 中 | 无 |
| Dialog | 5 消费方 | 原生 `<dialog>.showModal()`：焦点陷阱/Esc cancel/::backdrop/top layer 全免费（Android 返回键自动映射 cancel，见 dialog 迁移报告 §2.1） | 用原生 `<dialog>` 重写 FluentDialog 同签名组件（open/onClose/aria-label + title/actions 具名 JSX props 替代 slot 重映射）；**删除 showWhenReady/remapSlots/FluentDialogProbe 整套 workaround** | ~130 | 中-高 | FluentDialog.tsx（被替换）+ StartupUpdateDialog（纯 CSS 先例） |

**合计：组件层约 560 LOC**（含样式与类型，不含调用点改写）；调用点模板改写约 30 文件 110+ 处，全部是机械替换（`<fluent-button appearance="primary">` → `<FluentButton appearance="primary">`，事件从 fluentOn/onClick 统一为原生 `onChange`/`onClick`——原生元素上 Solid 原生支持）。

**人力估计**：组件编写 + 单测约 4–5 人日；调用点迁移 + E2E 选择器更新 + 视觉比对约 3–5 人日；缓冲 1 人日。**合计 7–11 人日**（单人 1.5–2 周，可按分期独立合入）。若走 WebSearch 评估的 headless 库路线（如 Kobalte），组件 LOC 可省一半，但见 §8 的否决论证。

---

## 4. 收益量化

| 收益 | 量化 | 证据 |
|---|---|---|
| JS 体积 | −163KB raw / −39.7KB gzip（占总 JS gzip 15.3%）；净约 −38KB gzip | §2.4 实测 |
| 首屏解析 | fluent-vendor 在首屏静态 import 路径上，WebView 冷启动少解析/编译 163KB JS；对 OTA web bundle（ADR-0122 L1 zip 分发）每版少 163KB 下载 | main.tsx:10-22；openwiki overview OTA 节 |
| 供应链 | npm 依赖 −4 包（@fluentui/web-components、@fluentui/tokens、@microsoft/fast-element、@microsoft/focusgroup-polyfill），其中 token 基础包 latest 仍是 **alpha**（§7） | registry dist-tags 实查 |
| 摩擦归零 | 删除：FluentDialog 155 行 workaround、fluentOn 21 行、happy-dom ElementInternals polyfill、radio-group rAF 等升级 hack（ImageHostSettings.tsx:47-57）、模板层 `--block-size` 等 shadow 内部 custom prop 内联 hack（Login.tsx:175）、fluent.d.ts 整文件 | §2.2/§2.5 |
| E2E 稳定性 | 消除 6 类 workaround：CLI click 对 fluent-button 失效（driver.ts:393）、checked 是 property 非 attribute（sub-flows.test.ts:414）、textarea setValue 报 invalid element state（switch-client-oneway.spec.ts:96）、shadow DOM textContent 不可见（同文件 :28）、fluent-dialog shadow open 探测（sub-flows.test.ts:439）、动态创建不打开（StartupUpdateDialog.tsx:25-33）——原生元素全部天然可用 | §6 逐行清单 |
| 类型安全 | fluent.d.ts 的 `Record<string, unknown>` → 手写组件完整 Props 类型 | fluent.d.ts |
| SolidJS 2 协同 | 62 处/24 文件 `on:` 迁移轴（solidjs-2-migration-impact.md 风险等级"高"）在后续维护中永久消失 | 同报告 TL;DR |
| 样式控制权 | 卡片化（ADR-0069/0074）等全局视觉调整不再受 shadow DOM 隔离限制；Fluent 2 规格更新时可按需只改用到的 10 个组件 | — |

---

## 5. 风险矩阵

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | **a11y 回归**：15 switch + 2 radio 组 + 2 checkbox 的键盘/读屏行为在重写中走样 | 中 | 中（移动端为主，读屏用户面小，但属 AGENTS.md 交互状态硬约束） | 全部基于原生元素实现（input/button/dialog 语义免费）；单测断言 role/aria-checked/键盘事件；agent-browser 冒烟键盘路径 |
| R2 | **Fluent 2 视觉合规漂移**：50 处 button、15 处 switch 的几何/状态样式与官方规格出现偏差（hover/active/focus-visible 三态、40×40 触控目标） | 中 | 中（合规是 AGENTS.md 硬约束，但约束的是令牌与视觉而非包） | 单组件收敛（一处改全局生效）；样式只引用 tokens.css 既有变量；以官方 Storybook（storybooks.fluentui.dev/web-components）为视觉 oracle，逐组件截图比对 |
| R3 | **迁移期间回归面大**：button 50 处/24 文件，message-bar 3 处 toast 依赖 fixed 定位与 z-index 叠放 | 中 | 中-高 | 分期推进（§9），每期独立合入 + `pnpm test`（T0 门禁 passWithNoTests=false）+ 6 个 agent-browser spec 全量；button 期纯机械替换、diff 可 review |
| R4 | **SolidJS 2.0-rc × 自定义元素既有摩擦复发**：property-vs-attribute、Solid 编译器对未知元素默认写 attribute 等 | 低（移除后该摩擦**消失**；残留风险仅在过渡期两套并存） | 低 | 每期只动一类元素，手写组件是普通 Solid 组件（Div 元素 + 原生 input），不再有未知元素语义 |
| R5 | **维护负担长期化**：~560 LOC UI kit 需自维护，Fluent 2 规格演进需手动跟进 | 确定 | 低-中 | 已有同模式先例（tokens.css 481 行 + FluentIcon 24 图标 + 全部路由/组件样式均自维护）；10 个组件消费面窄（§2.2），演进压力小；相比"锁 alpha token 地基"的被动风险更可控 |
| R6 | **dialog 行为差异**：原生 `<dialog>` 与 fluent-dialog 在堆叠/滚动锁定/返回键路径上的细微差异 | 低-中 | 中（dialog 承载设置/翻译/图床/小说删除确认等 5 个流程） | WebView ≥85 对 `<dialog>` 核心支持完整（dialog 迁移报告 §3 BCD 矩阵）；`@starting-style` 入场动画在旧 WebView 静默降级为无动画（可接受，报告 §5.3 已论证）；P4 单独一期 + android-e2e roundtrip spec 兜底 |
| R7 | **E2E 选择器更新遗漏**导致 CI 红灯 | 高（若不同步改） | 低 | §6 提供逐文件清单；选择器更新与组件替换同 commit 提交 |

总体：无"不可接受"级风险；全部风险有成熟的工程缓解手段，且多数风险的对照面（现状摩擦）本身就在持续产生成本。

---

## 6. 测试与 E2E 影响清单

**单元测试（4 文件）**：

| 文件 | fluent 引用 | 迁移动作 |
|---|---|---|
| tests/unit/components/FluentDialog.test.tsx | 29 处（show/hide 转换、slot 重映射、fluentOn change、ElementInternals polyfill） | 重写为针对新 Dialog 组件的行为测试（open/onClose/焦点陷阱）；polyfill 删除 |
| tests/unit/components/FluentDialogProbe.test.tsx | 6 处（fluent-dialog 上游契约守护：open 属性缺失、shadow dialog 升级） | **随上游依赖一并删除**（守护对象消失） |
| tests/unit/components/GateOverlay.test.tsx | 4 处（querySelectorAll("fluent-button")） | 选择器改新组件标签 |
| tests/unit/components/StartupUpdateDialog.test.tsx | 2 处（querySelectorAll("fluent-button")） | 同上 |

**agent-browser E2E（driver + fixtures + 6 spec 中 5 个涉及）**：

- driver.ts:368、396——`clickReliable` 的按钮选择器列表 `'button, fluent-button, fluent-switch, [role="button"], [role="switch"]'`（移除后原生 button 反而更可靠，注释 :393/:407 的 workaround 说明可删）
- fixtures.ts:32、104-105——`fluent-textarea` 存在性探测 + token 注入（`.value=` + dispatchEvent input）
- adaptive-tags-240.test.ts:55-96——`fluent-switch[aria-label="显示 R18 内容"]` 等选择器
- sub-flows.test.ts:396-498——`fluent-switch` checked property 三通道读取（:414 注释）、`fluent-dialog` shadowRoot open 探测（:439/483）、fluent-button 文本匹配点击（:498）
- update-flow.test.ts:10、38-70、translation-flow.test.ts:80-83、main-flow.test.ts:195——fluent-button click workaround 注释与选择器
- TESTING.md:1——文档提及

**android-e2e（4 spec）**：settings-sync-contract.spec.ts:56-109（fluent-switch checked 三通道兜底读取 + `fluent-button=登录` WebdriverIO 文本选择器 + fluent-textarea JS 注入）、switch-client-oneway.spec.ts:28-179、switch-client-roundtrip.spec.ts:109-174、switch-client-roundtrip-3x.spec.ts:174+（同模式）。注意 `fluent-button=文本` 是 WebdriverIO 自定义元素语法，替换后改 `button=文本` 或 `aria-label` 选择器。

合计约 **60 处选择器/探测点**需要同步更新（多数是机械替换且新选择器更简单）。工作量已计入 §3 估计。

---

## 7. 上游库健康度

| 维度 | 事实 | 来源 |
|---|---|---|
| 发布节奏 | @fluentui/web-components latest **3.1.3**（2026-08-25）；v3 GA 2026-06-29；此后 3.0.1→3.1.3 每 1-2 周一版，节奏稳定 | npm registry dist-tags/time 实查（registry.npmjs.org/@fluentui/web-components） |
| 项目锁定 | 3.0.3（2026-08-05 发布，精确锁版本，package.json:35） | packages/app/package.json |
| 仓库 | microsoft/fluentui monorepo（packages/web-components，web-components-v3 分支演进而来） | [github.com/microsoft/fluentui](https://github.com/microsoft/fluentui)、[discussion #30424](https://github.com/microsoft/fluentui/discussions/30424) |
| **地基状态** | **@fluentui/tokens latest 仍是 1.0.0-alpha.24**（2026-08-11；nightly 持续产出但 stable 遥遥无期） | registry.npmjs.org/@fluentui/tokens 实查 |
| 文档/生态 | 官方 Learn 文档 + Storybook 持续更新 | [learn.microsoft.com fluent-ui/web-components](https://learn.microsoft.com/en-us/fluent-ui/web-components/)、[storybooks.fluentui.dev/web-components](https://storybooks.fluentui.dev/web-components/) |
| 破坏性历史 | v2(FAST 基建) → v3 全部重写，v3 未包含全部 v2 组件且部分不再回归 | [issue #32958](https://github.com/microsoft/fluentui/issues/32958)、[fluentui-blazor discussion #2902](https://github.com/microsoft/fluentui-blazor/discussions/2902) |

判断：**上游不属于"已死/弃维护"**（机会成本论证不能走这条路）；真实风险是 (a) token 地基常年 alpha，语义/命名仍有变动空间（v3 的 3.1.x 已在挪动 API），(b) 大厂 monorepo 的优先级随 Fluent 生态战略波动（v2→v3 重写的前科），(c) 项目自身只用其 13/60+ 组件中的极小能力面（§2.2），为 5% 的能力付 100% 的运行时。综合看"继续依赖"的机会成本中等偏高，"自研 10 个窄用途组件"的成本一次性且可控。

---

## 8. 推荐替代设计

**形态裁决：纯 SolidJS 函数组件 + 原生 HTML 元素 + tokens.css 令牌，不继续自定义元素、不引入 headless 库。**

1. **为什么是 Solid 组件而不是继续写自定义元素**：
   - 消费方 100% 在 Solid 模板内，自定义元素的"跨框架复用"价值为零；
   - 自定义元素会重新引入本次要消除的全部摩擦（属性 vs 特性、自定义事件不走 Solid 委托、shadow DOM 样式隔离、异步升级竞态）；
   - Solid 组件获得编译期 Props 类型检查、原生事件绑定（onChange/onClick 直接可用）、与既有 `useCardInteractions` 等原语一致的范式（AGENTS.md 组件范式约定）。
2. **为什么不引入 headless 库（Kobalte/p–solid 系）**：
   - 需求面太窄：§2.2 证明实际只用受控 value/checked + 两个事件 + 三种视觉变体，Kobalte 的 headless 抽象（集合组件、Combine 原语等）大材小用；
   - 与本次"去依赖"的目标自相矛盾（新依赖 + 其自身对 solid-js 2.0-rc 的适配成熟度存疑，正值 RC 期）；
   - 项目已有"自维护设计系统件"的成熟先例（tokens.css、FluentIcon、SkeletonCard 家族、surface-card 等 UnoCSS shortcuts），团队模式一致。
3. **tokens 复用**：全部样式只引用 `src/styles/tokens.css` 既有变量（`--colorBrandBackground`、`--borderRadiusMedium`、`--durationNormal`、`--curveEasyEase` 等），dark 模式经 `:root.dark` 自动生效——不再需要任何运行时主题注入（对照 §2.3）。组件内禁止硬编码（AGENTS.md Fluent 禁止清单继续适用）。
4. **组件骨架约定**：`components/ui/` 下 PascalCase 文件 + `Component<Props>` 类型 + 默认导出（AGENTS.md 约定）；表单类统一基于原生元素（键盘/表单语义免费）；Dialog 基于原生 `<dialog>`（复用 `docs/research/dialog-element-migration-feasibility.md` §6 的实施方案：`useDialog` primitive + `@starting-style` 入场动画 + cancel 事件对接 backGesture）。
5. **可选精简**：Divider/Badge 体量过小，可以不做成组件而降级为 UnoCSS shortcut（如 `fluent-badge-filled-danger`），进一步压缩新增代码。倾向：badge 保留组件（17 处、3 色组合，组件化收益明显），divider 直接用 `<hr class="fluent-divider">` + base.css 一条规则。

---

## 9. 分期迁移方案与 SolidJS 2 时序裁决

### 9.1 时序裁决：**SolidJS 2 迁移先落地，本方案在其后启动**

论证（含反方）：

- **支持"Solid 2 先"（多数理由）**：
  1. Solid 2 迁移已在 feat/solidjs-2-migration 深度展开（rc.6 + router/query/primitives 全套 next 版本，`pnpm check`/测试已过，E2E 修复 commit 到 1d6e696b），此刻插入第二个大迁移会在**同一批文件**（settings/ 7 个组件、ImageHostSettings、FluentDialog 等恰是两个迁移的重叠面）上叠加回归面，违背"双大迁移不叠加"的一般工程原则；
  2. fluent 特有的 Solid 2 成本（62 处 `on:` → fluentOn、FluentDialog 的 compute/apply 拆分、ref 数组语义）**已经支付完毕**并有测试兜底（ADR-0144 D3-5、FluentDialog.test.tsx）。若现在反过来先移除 fluent，这批已验证的工作将处于半途状态，两分支互相 rebase 的冲突面约 24 文件；
  3. 移除方案的验证手段（单测 + agent-browser E2E）依赖一个语义稳定的运行时；在 rc 期做视觉/行为等价比对，无法区分"手写组件回归"与"框架语义回归"。
- **反方论点（曾成立但已过期）**："先移除 fluent 可以为 Solid 2 消掉 62 处 `on:` 迁移点"——该迁移点在本分支已完成（fluentOn + ADR-0144），收益已实现，此论点不再构成先移除的理由。
- **附加约束**：P0（drawer 死 import 清理）为 1 行零风险改动，可随时先行，不受时序约束。

### 9.2 分期方案

| 期 | 内容 | 规模 | 验证手段 |
|---|---|---|---|
| **P0 死代码清理** | 删 `main.tsx:16` drawer.js import + `fluent.d.ts` 的 drawer/drawer-body 声明 | 2 行 | `pnpm check` + build 产物无 fluent-drawer |
| **P1 低风险叶子组件** | 新写 Badge/Divider/Spinner/MessageBar（合计 17+6+5+7=35 实例，5+5+4+4 文件）；MessageBar 保留 1 处 close 行为 | 组件 ~100 LOC + 模板 18 文件 | 单测（intent/color 映射、dismiss 事件）；`pnpm test`；agent-browser main-flow/sub-flows 冒烟（卡片徽标、图床 toast 在路径上）；构建对比 fluent-vendor 体积首次下降 |
| **P2 表单控件** | Switch/Checkbox/RadioGroup/Radio/TextArea（15+2+2组+2=21 实例）；统一 `checked/value` 受控 + 原生 onChange；E2E 选择器同步（§6 清单中 fluent-switch/fluent-textarea 各处） | 组件 ~225 LOC + 模板 9 文件 + E2E 6 文件选择器 | 单测（aria-checked/键盘/受控翻转，对照 SettingsAppearance 真实用法）；agent-browser adaptive-tags-240（R18 开关）、sub-flows 图床开关/textarea；android-e2e settings-sync-contract（switch 状态同步契约）+ switch-client 系列（登录 textarea 注入路径） |
| **P3 button 批量替换** | FluentButton 上线，50 处/24 文件机械替换（appearance/disabled/aria-label/class 透传一一对应；`--block-size` 内联样式改 height；spinner slot="start" 改子元素） | 组件 ~100 LOC + 模板 24 文件 | 全量单测；6 个 agent-browser spec（login/update/translation/main/sub-flows 全在 button 路径上）；GateOverlay/StartupUpdateDialog 单测选择器更新；**逐页截图与 P2 基线比对** |
| **P4 dialog 收尾与摘除** | 原生 `<dialog>` 版 Dialog 组件替换 FluentDialog（5 消费方 + wrapper 重写 + FluentDialogProbe 删除）；删除 fluentOn.ts、fluent.d.ts、main.tsx 的 setTheme/MutationObserver/13 条 import、vite.config.ts fluent-vendor chunk 配置、package.json 4 个依赖 | 组件 ~130 LOC + 6 文件 + 配置清理 | 单测重写（open/onClose/Esc/焦点）；agent-browser update-flow（StartupUpdateDialog 纯 CSS，不受影响）+ sub-flows 的 dialog open 探测改 `dialog[open]`；android-e2e 全 4 spec（图床确认弹窗、小说删除确认在路径上）；最终 `gzip -c dist/assets/*.js | wc -c` 复核 −38KB 目标 |

每期独立 commit（Conventional Commits：`refactor(app): …` / `feat(app): …`），合入节奏建议每期间隔 ≥1 天观察 CI 与内部使用。P1–P2 之间无依赖可并行，P3 建议单独一期（回归面最大），P4 必须最后。

### 9.3 最终验证清单（P4 完成时）

- `pnpm check && pnpm test && pnpm test:agent-browser` 全绿；
- android-e2e smoke + switch-client roundtrip 全绿；
- `grep -r "fluent-" packages/app/src packages/app/tests` 仅剩 base.css 动画 keyframes 命名（与应用无涉）；
- dist JS gzip 总量较基线（259.8KB）下降 ≥35KB；
- 明/暗主题 + page-card 风格下设置页/图床页/小说删除确认的人工走查（对照 Fluent 2 Storybook 视觉 oracle）。

---

## 10. 附录：证据索引

**源码事实**（均为 2026-09-09 在 feat/solidjs-2-migration @ 1d6e696b 上 grep/实读）：

- 唯一 import 面：packages/app/src/main.tsx:8-22；类型补充：src/types/fluent.d.ts（全 `Record<string, unknown>`）
- 主题双链路：src/utils/themeApplier.ts:33-36（applyDarkClass）；src/styles/tokens.css:3（"Based on @fluentui/tokens v9"，纯静态）、:205（:root.dark）；src/stores/themeStore.ts → themeApplier（无 @fluentui 耦合）
- setTheme 实现：@fluentui/web-components dist/esm/theme/set-theme.js:37-62（token→CSS 自定义属性）
- workaround 证据：src/components/ui/FluentDialog.tsx:19-23（无 open 属性）、:45-57（slot 重映射）、:84-99（rAF 等升级）、:146-150（唯一模板点）；src/components/StartupUpdateDialog.tsx:25-33（弃用声明）；src/primitives/fluentOn.ts:1-11；src/routes/ImageHostSettings.tsx:47-57（radio 升级 rAF）、:224-235（detail.value 收窄）；tests/unit/components/FluentDialog.test.tsx:208（happy-dom 无 ElementInternals）
- E2E 摩擦：tests/agent-browser/driver.ts:393/:407；tests/agent-browser/specs/update-flow.test.ts:10；sub-flows.test.ts:414/:427-439；switch-client-oneway.spec.ts:28/:96

**体积实测**：`packages/app/dist/assets/`（2026-09-09 01:38），fluent-vendor 163,025B raw / 39,745B gzip；JS 总计 903,948B raw / 259,771B gzip；fast-element 与 fluent 同 chunk（chunk 头部 DI 错误码 enum 实证）。

**上游数据**：

- [npm @fluentui/web-components](https://www.npmjs.com/package/@fluentui/web-components)（dist-tags/time 直查：latest 3.1.3 @ 2026-08-25）
- [npm @fluentui/tokens](https://www.npmjs.com/package/@fluentui/tokens)（latest 1.0.0-alpha.24 @ 2026-08-11）
- [microsoft/fluentui monorepo](https://github.com/microsoft/fluentui)、[discussion #30424（web-components-v3）](https://github.com/microsoft/fluentui/discussions/30424)、[issue #32958（v2→v3 迁移）](https://github.com/microsoft/fluentui/issues/32958)
- [Fluent UI Web Components 官方文档](https://learn.microsoft.com/en-us/fluent-ui/web-components/)、[官方 Storybook（视觉 oracle）](https://storybooks.fluentui.dev/web-components/)

**内部关联文档**：

- docs/research/solidjs-2-migration-impact.md（62 处 `on:` 迁移点全部源自 fluent；Solid 2 生态矩阵）
- docs/research/dialog-element-migration-feasibility.md（原生 `<dialog>` BCD 矩阵与实施方案，P4 的技术底座）
- docs/research/solidjs-2-vs-1-analysis.md（Solid 2 破坏性变更）
- openwiki/architecture/overview.md（设计系统章节、启动时序、OTA web bundle）
- docs/adr/ADR-0087（fluent-dialog slot 契约事故）、ADR-0144 D3-5（fluentOn 工厂）、ADR-0069/0074（A2 卡片化视觉语言）
