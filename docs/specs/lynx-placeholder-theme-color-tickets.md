# Tickets: 输入框 placeholder 主题化 · 暗色对比度修复（spec: docs/specs/lynx-placeholder-theme-color.md）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | 决策落档：#693 票内改判 + ADR-0180 代价段订正 | — | #693 评论、`docs/adr/ADR-0180-lynx-dark-mode.md` | #693 记明「方案 B 前提已被 #537 + spike 证否、改判方案 A」并给出两处证据坐标；ADR「代价 / 风险」段该条由「明示接受（方案 B）」改为「**已决定按方案 A 修复，实施中**」；实施记录表**追加**一行（历史行逐字保留） | done |
| T1 | 取值表 + 防漂移测试 | T0 | `src/utils/lynxPlatformColors.ts`、`src/utils/lynxPlatformColors.test.ts`（新增） | 导出 `INPUT_PLACEHOLDER_DARK_COLOR: Record<ThemeColorId, string>` 7 项；新测试逐项断言 ≡ `tokens.css` 的 `.theme-*.dark --md-on-surface-variant`；**抽取器断言命中数下界**（扫空集即红，防 ArchUnit `failOnEmptyShould` 式恒真）；旧 `INPUT_PLACEHOLDER_COLOR` 单值导出**保留**（亮色侧不改，spec §4.3） | done |
| T2 | `useInputPlaceholderColor()` composable | T1 | `src/composables/useInputPlaceholderColor.ts`（新增）及其单测 | 返回 computed：读 `settingsStore.themeColor` + `settingsStore.resolvedDark`，**禁止读 `currentDarkMode`**（手动模式下 stale，`settingsStore.ts:989`）；亮色返回单值、暗色查表；**不做非法值兜底分支**（store 已拦）；单测覆盖 7 主题 × 亮暗 14 组 + 主题切换后重算 | done |
| T3 | 9 处消费点改绑 | T2 | `SearchSheet.vue`、`BookmarkPanel.vue`、`Me.vue`（7 处）、`SettingsEndpoint.vue`（6 处） | 9 处全部绑 `placeholderColor`；模板内零 `placeholder-color="#`；**`BookmarkPanel` 新增 `useSettingsStore` 引入**（当前未引）；`Me.vue` 删除 `INPUT_PLACEHOLDER_COLOR` import、`SearchSheet` 同步清理；`BookmarkPanel.template.test.ts:206-208` 三条断言按新形态改写（**保留**「模板不含 `placeholder-color="#`」这条防散写断言） | done |
| T4 | 终态文档收口 | T3 | ADR-0180、`lynx-night-mode-walkthrough.md:128`、`hardcode-whitelist-colors.json:8`、`lynx-night-mode-audit.md` | ADR「代价 / 风险」段「实施中」→「**已解除**」；走查矩阵 `:128` 由「接受项 / 不判 ❌」改为**判据**「暗色 placeholder 对比度 ≥ 4.5:1，截图留档」；白名单 reason **删掉「关闭 #693 时同步删本豁免」**（采纳 A 后该承诺作废——常量保留即豁免保留）并补「随常量保留」；audit 同行补同款声明 | done |
| T5 | 验收 + #1014 走查项登记 | T1–T4 | #1014 评论 / 走查矩阵 §4 | `pnpm check:app-lynx` + `pnpm test:app-lynx` + `pnpm fmt:check` 全绿；#1014 走查矩阵新增 **T4-6** 判据「暗色 placeholder 对比度 ≥ 4.5:1」并写明**取样时机**（WebDAV 六字段须「聚焦 + 空」）；已并入 `release-checklist.md:233` 的 gate 枚举。**另含 review 轮补入的两道防线**（见下「review 修复轮」） | done |

## 关键路径

`T0 → T1 → T2 → T3 → T4 → T5`（全串行：T3 的模板形态依赖 T2 的 composable 返回值；T4 的文档措辞依赖 T3 的最终形态）

## 验收证据

- 自动门禁：`check:all` + `lint:all` + `test:all`（CI 三件套，ADR-0097）
- 像素验收：**不在 CI**（ADR-0084）。由 #1014 的真机走查 gate 承载，判据 = 暗色 placeholder 对比度 ≥ 4.5:1
- 平台事实前提：`docs/specs/lynx-placeholder-theme-color.md` §7 探针记录（动态绑定无 remount 即时刷新）

## review 修复轮（2026-10-15，提交前双轴 review）

双轴各出 1 条 blocking，**均已用「先证伪、再修复、再复验同一证伪」闭合**：

| 轮 | finding | 证伪（修复前） | 修复 | 复验（修复后） |
|---|---|---|---|---|
| 1 | 9 处改绑只有 `BookmarkPanel` 有接线守卫 | 把 8/9 处回退成静态常量 → **297 文件 / 4236 测试全绿** | `lynxPlatformColors.test.ts` 增 `②` 组：9 处声明式清单 + 逐处绑 `placeholderColor` + 零裸字面量 + 每个文件真引了 composable + 无组件绕过 composable 直取暗色表 | 同一证伪 → **1 failed** ✅ |
| 2 | `resolvedDark` 归一语义零覆盖，而 `system` 是缺省模式 | 把 `resolvedDark` 换成 `darkMode` → **6/6 全绿** | `useInputPlaceholderColor.test.ts` 增 `system` 组 6 条：三态键留 `system` + `currentDarkMode` 设 `dark`/`light` 双向断言，并显式断言 `DEFAULT_DARK_MODE === 'system'` | 同一证伪 → **2 failed** ✅ |

同轮另修：ADR-0180:56「方案 A/B 待定」与 :54「已解除」互斥（→ 遗留挂账仅剩 #1014）；走查判据从正文 bullet 提升为矩阵行 **T4-6** 并进 `release-checklist.md:233` 枚举；平台升级风险（#537 遗留属性）落账到 spec §6 + 常量文件头；门禁文件头精简（规模线）；移除重复断言与越界断言（composable 用例名不再断言平台事实）。

## 备注

- **测试硬约束 #6（oracle 溯源）**：T1 的期望值必须指向 `tokens.css` 生成产物，**不得**从 `lynxPlatformColors.ts` 自身反推。
- **测试硬约束 #4（行为不变声明）**：亮色侧维持单值不属本票变更；但 T1 新增导出属契约面变更，commit message 需标注。
- **门禁冻结线**（`workflows/review-fix-loop.md`）：T1 是**新增**门禁，必须同票登记「已知失效面」（见 spec §6）；不得借机给既有门禁加码。
- **与 #1014 的边界**：本票只改走查矩阵的**判据文字**并把它接入 gate 枚举；矩阵的**执行与落档**归 #1014，不在本票范围。
- **亮色侧令牌保真**（7 套主题 placeholder 与其 `on-surface-variant` 不符）已作为**显式排除项**登记于 spec §5，**不静默丢弃**；如需修复另开票（涉及新增 placeholder 专属令牌 + bili clamp 决策）。
- **发现但非本票引入**：`lynx-night-mode-audit.md` 白名单计数写「6 条」，实际 8 条。归因早于本票（`4392bb34` / `d6da8b54`），**单独立票**，不在 T4 顺手改（避免给本票挂无关变更）。
