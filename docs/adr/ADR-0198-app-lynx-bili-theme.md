# ADR-0198：app-lynx bili 主题——bilibili 品牌色手工映射为第 7 支主题色

- 状态：Accepted（已采纳）
- 日期：2026-09-27
- 关联：[glossary-lynx-bili-theme.md](./glossary-lynx-bili-theme.md)（术语表）、ADR-0152（主题色机制：静态预生成 M3 色板 + 根类切换）、ADR-0180（暗色模式：`.theme-X.dark` 复合选择器 + 生成脚本）、spec `docs/specs/lynx-bili-theme.md`
- 输入材料：`docs/research/bilibili-theme-feasibility-app-lynx-2026-09.md`（可行性评估）+ `bilibili-theme-tokens-full-2026-09.md`（v12 官方令牌 191 原语全表，一手抓取）

## 背景

用户需要「在 lynx 增加新主题（bilibili 配色），可在设置切换；只做 lynx，不管 webview」。

可行性评估（2026-09-27）已核实：app-lynx 主题机制**早已就绪**——6 支主题 × 3 暗态在跑、386 处 `var(--md-*)` 消费覆盖全量组件、无 Tailwind 硬编码色、无 Java 主题色读点、测试已数据驱动（加主题自动进角色集不变量循环）。因此加第 7 支主题 = **只加数据不加机制**，真正的工作是「bilibili 的哪个色对应 M3 的哪个角色」这一设计决策。

bilibili 侧一手调研结论（决定方案形态）：

1. **bilibili 没有主题系统**（App 端只有亮/暗切换，主题运行时值域硬编码 `"light"/"dark"`）→ 只能拿到「一套配色」，拿不到「一套机制」；而机制 app-lynx 本来就有。
2. **真实色值可取**：品牌粉 `--Pi5` 亮 `#FF6699` / 暗 `#D44E7D`；品牌蓝 `--Lb5` 亮 `#00AEEC` / 暗 `#0087BD`；灰阶 Ga/Wh 全表已抓取。
3. **bilibili 自己的用法是「蓝才是通用交互强调色」**（首页 CSS `brand_blue` 39 次 vs `brand_pink` 9 次），但大众品牌认知是粉色——这是本 ADR 唯一真正的设计难点（R2）。
4. `--bili-*` CSS 变量在 bilibili 全部产物中 **0 命中**（已证伪），别用该前缀命名任何东西。

## 决策

**D1 档位 = L2（bilibili 真实色值手工映射），拒绝 L1 / L3。**
L1（锚点喂 TonalSpot 全自动生成）产物是「M3 的粉」而非 bilibili，视觉不可信；L3（引入 191 原语 + 40 语义体系）要改 Tailwind 映射、推翻 M3 约定，明确不做。L2 的 65 角色映射决策一次付清，机制零改动。

**D2 `--md-primary` = `#D03171`（Pi7，主粉）——不是 `#FF6699`，也不是 `#FB7299`，更不是蓝。**
白字对比实测：`#FF6699` = 2.76:1、`#FB7299` = 2.64:1，均低于 M3 on-primary 4.5:1 门槛；粉阶梯中过线的是 Pi7 `#D03171`（4.81:1）。品牌感由 primary-container（`#FFECF1` = `brand_pink_thin`）与 inverse-primary（`#FF6699` = Pi5 本体）承载。**否决「primary=蓝」（忠实 bilibili 交互语义的选项）**：用户选「bili」期待的是品牌粉第一印象；蓝 DNA 改由 tertiary（`#00699D` = `--text_link`）与 secondary 蓝灰族（`#4D5D7C` = Si8）保留。R2 就此拍板，本条即结论。

**D3 亮色板手调（48 角色，映射表见 spec）、暗色板走既有生成管道不手调。**
暗色从锚点 `#d03171` 经 SchemeTonalSpot 生成（与既有 6 支完全同构）。**否决「暗色按 bili 真实暗值微调」**（`--Pi5` 暗 `#D44E7D` 等）：微调会击穿漂移锁的「产物 ≡ 脚本 stdout」逐字节比对，需给脚本加 per-theme 覆盖机制——为几处色值引入机制复杂度不值；且与既有 6 支暗色的观感同构性优先于对 bilibili 暗色的还原度。

**D4 机制零改动。** 根 `<page>` 类切换、零运行时算色（ADR-0152）、Tailwind `colors → var(--md-*)` 映射、Java 原生（只读暗色键）、settingsStore 校验（`isThemeColorId` 自动接受新 id）全部不动。改动仅为**数据与接线**：脚本 `THEMES[]` +1、tokens.css +2 块、`themeColor.ts` +1 项、Me.vue +1 色块、i18n/a11y +键、测试计数 6→7。

**D5 范围边界。** 仅 app-lynx；webview 不同步（其无 accent 主题概念，双端不对称是既有事实 R1，不扩大也不在本轮收敛）。Me.vue 第 7 色块**沿用既有同构手写模板**（不做 v-for 收敛重构——「实施范围不扩散」裁定；收敛机会记入 spec 挂账）。顺带修正 i18n hint 文案失真：`选择主题色（Material Design 3 配色）` → `选择主题色`（bili 为手工映射，该表述不再准确，R4）。

**D6 命名。** id/类名 `bili` / `theme-bili`；用户可见文案 zh `哔哩粉`、en `Bilibili Pink`；a11y `主题色哔哩粉`。禁止使用 `--bili-*` 前缀（调研已证伪该前缀）。

**D7 测试防线。** `palettes-drift.test.ts` `EXPECTED_THEME_COUNT` 6→7、`appearanceClasses.test.ts` 清单计数断言 6→7；角色集不变量（unit.test.ts）与漂移锁对其余部分**自动覆盖**第 7 支，不新增手写 oracle。对比度断言（primary/secondary/tertiary ≥ 4.5:1）按 `appearanceClasses.test.ts` 既有 WCAG 口径补进该测试文件的逐主题循环。

## 风险与边界

| # | 风险 | 处置 |
|---|------|------|
| R5 | `text-white`/`bg-white` 硬编码 44 处不随主题变 | 本主题 `--md-on-primary` 仍为白，语义用法（彩底白字）无冲突；维持现状 |
| R7 | Lynx 引擎 CSS 变量支持面 | 不引入新机制即不引入新风险；真机视觉验收由模拟器检查承担（含 7 色块窄屏换行） |
| R-brand | 第三方品牌色内置的产品/法务判断 | 定位为「lynx 端可选配色」，主题名为用户可见的「哔哩粉」而非「bilibili 官方」；风险已知悉并接受 |
| R8 | 忘记同步脚本/tokens.css | 漂移锁直接红，机器强制 |
