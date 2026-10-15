# Tickets: 输入框 placeholder 亮色令牌保真（spec: docs/specs/lynx-placeholder-light-token-fidelity.md · issue #1015）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | 亮色取值表 + composable 亮色查表（防线红→绿） | — | `src/utils/lynxPlatformColors.ts`、`src/composables/useInputPlaceholderColor.ts`、`src/utils/lynxPlatformColors.test.ts`、`src/composables/useInputPlaceholderColor.test.ts`、`tests/hardcode-whitelist-colors.json` | ① 新增 `INPUT_PLACEHOLDER_LIGHT_COLOR` 7 项（6 档 ≡ tokens.css 亮段 `--md-on-surface-variant`；bili = `#5a5f66` clamp，docstring 写明 §4.2 规则）；② 亮色单值常量 `INPUT_PLACEHOLDER_COLOR` **删除**；③ composable 亮/暗皆查表，**禁读 `currentDarkMode`**、不做非法值兜底；④ 守值测试：亮色表单项 ≡ 亮段抽取产物 + bili clamp 值守 + 抽取下界扩 dark+light 两段（各 ≥7）；⑤ 接线组 15 处断言原样保留；⑥ 白名单 reason 改写为 clamp 规则摘要；⑦ **变异推演三发全红**：亮色分支换回单值 / bili 改回 `#61666d` / 抽取器扫空集；⑧ `check:app-lynx` + `test:app-lynx` + `fmt:check` 绿 | done |
| T1 | 文档收口 | T0 | `docs/adr/ADR-0180-lynx-dark-mode.md`、`docs/specs/lynx-placeholder-theme-color.md` §5 | ADR 实施记录表**追加**一行（#1015：亮色表 + clamp + 防线改造要点；历史行逐字保留）；#693 spec §5 排除项条目追加「→ 已由 #1015 承接（2026-10-16）」；`CONTEXT-MAP.md` / ADR README 无结构变化（不动作，核对即可） | todo |
| T2 | 像素验收 3 帧 + 落档 + #1015 关闭 | T0、T1 | `docs/research/placeholder-light-token-acceptance.md`、#1015 评论 | 亮色态（`night no`）模拟器跑 bili / sky / teal 三主题：probe 自检 → 采样（WebDAV 字段「聚焦+空」，坑见 spec §4.6）→ 实测对比度 bili ≥4.5（理论 4.54；<4.5 按 spec §4.4 升档 `#53585f` 重测并记明）/ sky = 7.3x 不变 / teal = 7.2x；三帧 PASS 落档 acceptance md（帧路径 + 实测值 + 与理论偏差）；`gh issue close 1015 --comment`（关闭评论含证据坐标 + 未覆盖声明：violet/pink/green/orange 四档留 #1014 T2 全矩阵） | todo |

## 关键路径

`T0 → T1 → T2`（T1 措辞依赖 T0 最终形态；T2 的关闭评论依赖 T1 落账）。全部串行。

## 验收证据

- 自动门禁：`check:all` + `lint:all` + `test:all`（CI 三件套，ADR-0097）
- 像素验收：**不在 CI**（ADR-0084）。本票 3 帧抽样自立（spec §4.6），全主题覆盖归 #1014 T2
- 值 oracle：tokens.css 亮色段生成产物（非实现反推，测试硬约束 #6）

## 备注

- **测试硬约束 #4（行为不变声明）**：`INPUT_PLACEHOLDER_COLOR` 删除 + 亮色表新增属契约面变更，commit message 需标注。
- **门禁冻结线**（`workflows/review-fix-loop.md`）：T0 改造既有门禁，必须同票登记「已知失效面」（spec §6 已登记）；不得借机给既有门禁加码（接线组 15 处断言原样保留）。
- **与 #1014 的边界**：本票不碰走查矩阵；两票互不阻塞（spec §5）。
- **发现但非本票引入**：`BookmarkPanel.template.test.ts` 的 `@placeholder-color=` 旧写法断言与 gate 的 `:` 口径不一致——不顺手改，另找机会（同 #693 对 audit 计数错误的处理）。
- 提交粒度建议：T0 一个 commit（红线绿线同 commit 可见全过程）；T1 一个 commit；T2 的 acceptance md 一个 commit + issue 关闭评论。
