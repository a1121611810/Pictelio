# Tickets: 输入框 placeholder 亮色令牌保真（spec: docs/specs/lynx-placeholder-light-token-fidelity.md · issue #1015）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | 亮色取值表 + composable 亮色查表（防线红→绿） | — | `src/utils/lynxPlatformColors.ts`、`src/composables/useInputPlaceholderColor.ts`、`src/utils/lynxPlatformColors.test.ts`、`src/composables/useInputPlaceholderColor.test.ts`、`tests/hardcode-whitelist-colors.json` | ① 新增 `INPUT_PLACEHOLDER_LIGHT_COLOR` 7 项（6 档 ≡ tokens.css 亮段 `--md-on-surface-variant`；bili = `#5a5f66` clamp，docstring 写明 §4.2 规则）；② 亮色单值常量 `INPUT_PLACEHOLDER_COLOR` **删除**；③ composable 亮/暗皆查表，**禁读 `currentDarkMode`**、不做非法值兜底；④ 守值测试：亮色表单项 ≡ 亮段抽取产物 + bili clamp 值守 + 抽取下界扩 dark+light 两段（各 ≥7）；⑤ 接线组 15 处断言原样保留；⑥ 白名单 reason 改写为 clamp 规则摘要；⑦ **变异推演三发全红**：亮色分支换回单值 / bili 改回 `#61666d` / 抽取器扫空集；⑧ `check:app-lynx` + `test:app-lynx` + `fmt:check` 绿 | done |
| T1 | 文档收口 | T0 | `docs/adr/ADR-0180-lynx-dark-mode.md`、`docs/specs/lynx-placeholder-theme-color.md` §5 | ADR 实施记录表**追加**一行（#1015：亮色表 + clamp + 防线改造要点；历史行逐字保留）；#693 spec §5 排除项条目追加「→ 已由 #1015 承接（2026-10-16）」；`GLOSSARY-MAP.md` / ADR README 无结构变化（不动作，核对即可） | done |
| T2 | 像素验收 3 帧 + 落档 + #1015 关闭 | T0、T1 | `docs/research/placeholder-light-token-acceptance.md`、#1015 评论 | 亮色态（`night no`）模拟器跑 bili / sky / teal 三主题：probe 自检 → 采样（WebDAV 字段「聚焦+空」，坑见 spec §4.6）→ 实测对比度 bili ≥4.5（理论 4.54；<4.5 按 spec §4.4 升档 `#53585f` 重测并记明）/ sky = 7.3x 不变 / teal = 7.2x；三帧 PASS 落档 acceptance md（帧路径 + 实测值 + 与理论偏差）；`gh issue close 1015 --comment`（关闭评论含证据坐标 + 未覆盖声明：violet/pink/green/orange 四档留 #1014 T2 全矩阵） | done |

## 关键路径

`T0 → T1 → T2`（T1 措辞依赖 T0 最终形态；T2 的关闭评论依赖 T1 落账）。全部串行。

## 验收证据

- 自动门禁：`check:all` + `lint:all` + `test:all`（CI 三件套，ADR-0097）
- 像素验收：**不在 CI**（ADR-0084）。本票 3 帧抽样自立（spec §4.6），全主题覆盖归 #1014 T2
- 值 oracle：tokens.css 亮色段生成产物（非实现反推，测试硬约束 #6）

## review 修复轮（2026-10-16，提交前双轴 review）

双轴并行（Standards + Spec，仓库版 `.agents/skills/code-review/`）。**全程 0 blocking / 0 major**。

**轮 1**：7 条 minor（Standards 3 / Spec 4）。其中 5 条便宜闭合于 `28fbcecc`：
- 两张表 docstring 的 `console.warn` 归因修正（`isThemeColorId` 是纯谓词，告警实体在 store 读取路径）
- 接线守门标题还原暗色专属口径（扫描面只覆盖暗色表，冻结线禁止加码）
- spec §4.7 spec/tickets 落库时序措辞修正
- spec §5「暗色守值测试零 diff」→「断语音义不变」（消除与 §4.5 的条款张力）
- ADR-0180 #1015 行「实测 4.54」→「实算」（真机实测归 T2）

登记不改 2 条（两轴一致结论）：亮色表直引绕过接线守卫的面（本票遵守「接线组不动」门禁冻结线，留未来门禁迭代）；#693 spec §4.3 历史口径无就地标注（有意保留，新 spec 已定位其为前身）。

**轮 2**：2 条 minor（纯文档，双轴同指）。闭合于本轮 commit：
- spec §5 括注「详见 tickets『review 修复轮』」悬空——即本节，补登
- spec §4.4「暗色守值测试全部原样」残留绝对措辞——与本节登记的结构性适配事实对齐放宽

**结构性适配登记**（回应 spec §5 括注；T0 守值测试的 describe 合并、变量 `actual→darkActual`、暗色用例标题加前缀；唯一断言语面适配 = 「暗色值不得复用亮色基线值」因旧常量删除改引 `INPUT_PLACEHOLDER_LIGHT_COLOR[themeId]`，语义等价。**断言语义不变**，属 spec §4.5 守值组改造的结构必需，非加码）。

## 备注

- **测试硬约束 #4（行为不变声明）**：`INPUT_PLACEHOLDER_COLOR` 删除 + 亮色表新增属契约面变更，commit message 需标注。
- **门禁冻结线**（`workflows/review-fix-loop.md`）：T0 改造既有门禁，必须同票登记「已知失效面」（spec §6 已登记）；不得借机给既有门禁加码（接线组 15 处断言原样保留）。
- **与 #1014 的边界**：本票不碰走查矩阵；两票互不阻塞（spec §5）。
- **发现但非本票引入**：`BookmarkPanel.template.test.ts` 的 `@placeholder-color=` 旧写法断言与 gate 的 `:` 口径不一致——不顺手改，另找机会（同 #693 对 audit 计数错误的处理）。
- 提交粒度建议：T0 一个 commit（红线绿线同 commit 可见全过程）；T1 一个 commit；T2 的 acceptance md 一个 commit + issue 关闭评论。
