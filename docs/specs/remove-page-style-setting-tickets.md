# Tickets: 移除「页面风格」设置并固定为 Fluent（spec: docs/specs/remove-page-style-setting.md）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | ADR-0148 移除页面风格并固定 Fluent | — | `docs/adr/ADR-0148-remove-page-style-setting.md` | 记录移除决策 / 迁移行为 / 孤儿键策略 / 兑现 ADR-0069 挂账 / 严格保持渲染值 | done |
| T1 | 移除页面风格状态与工具 | T0 | `stores/themeStore.ts`、`utils/themeApplier.ts` | 无 `PageStyle*` / `setPageStyleTheme` 导出；`page_style_theme` 不再 define；`applyDarkClass` 保留含 SSR 守卫 | done |
| T2 | 设置 UI 收敛为明暗主题 | T1 | `components/ThemeSelector.tsx`、`components/settings/SettingsAppearance.tsx` | 只剩明暗主题 3 按钮；标题「明暗主题」；说明句删除；无 `pageStyle*` import | done |
| T3 | 清算 `page-card` 样式与 `--pageCard*` 令牌 | T0 | `styles/tokens.css`、`styles/base.css`、`uno.config.ts`、`routes/FollowListPage.tsx`、`routes/UserIllusts.tsx` | 零 `--pageCard*` / `page-card` 引用；`.surface-card` 有效渲染值保持不变（§3.5 映射表） | done |
| T4 | 注释与文档残留清理 | T1,T2,T3 | `main.tsx`、`startup.ts`、`settings/backends/mirrored.ts`、`docs/adr/glossary-ui-cards.md`、`docs/storage-architecture-proposal.md` | 无 `page_style_theme` / 页面风格 表述残留（历史文档按 spec §3.7 处理） | done |
| T5 | 测试同步 + 静态防线 | T1,T2 | `tests/unit/utils/themeApplier.test.ts`（真实 DOM）、`tests/unit/stores/themeStore.test.ts`、`tests/unit/components/ThemeSelector.test.tsx`（含移除断言）、`tests/unit/styles/pageStyleRemoval.test.ts`（新增静态防线） | 全绿；无空测试文件；`page-card` / `--pageCard*` 回流即红灯 | done |
| T6 | 验收 | T1–T5 | — | `pnpm check` + `pnpm test:app` + `pnpm lint` + `pnpm fmt:check` 全绿（已过）；设置页/Feed 亮暗视觉确认 | doing（自动门禁与浏览器计算样式契约已过；设置页人工视觉走查需登录，待补） |

## 关键路径

`T0 → T1 → T2`
`T0 → T3`（可与 T1/T2 并行）
`T4`、`T5` 收口于 T1+T2+T3；`T6` 最终验收。

## 验收证据

- `pnpm check`（vp check：444 files formatted / 429 files lint-clean；`tsc --noEmit` clean）
- `pnpm test:app`：145 test files / 1425 tests passed
- `pnpm lint`：0 warnings / 0 errors；`pnpm fmt:check`：pass
- 浏览器计算样式契约（agent-browser，dev server :5174）：`html` class = `dark`（无 `page-card`）；`.surface-card` computed `border-radius: 8px`、shadow = `--elevation4`、background = `--colorNeutralBackground1`（暗色 `#2a2622`）

## 备注

- T3 是纯样式重构，必须保证「有效渲染值不变」：`--pageCardRadius → --borderRadiusXLarge`、`--pageCardShadow → --elevation4`（**不是** fallback 的 `--borderRadiusLarge` / `--elevation2`）。
- 孤儿键 `page_style_theme` 不清理、不迁移、不提示。
- 每 ticket 完成后走 `code-review` → `tdd` 修复闭环（AGENTS.md 工作流硬约束）。
