# AI 作品三态过滤 —— 工单拆分

> 来源：docs/specs/ai-artwork-three-state-filter.md（ADR-0155）
> 约定：tracer-bullet 垂直切片，每个 ticket 可独立验证；blocker 未完成不开工。

## 依赖图

```
T1 (app 列表三态垂直切片) ──> T2 (app 搜索/历史/metrics)
T3 (lynx 列表三态垂直切片) ──> T4 (lynx 搜索/详情)
T1,T3 ──> T5 (跨端契约 + 收口验证 + code-review)
```

---

## T1：app 列表三态垂直切片

**What to build**：app 端在「内容与过滤」设置里出现 AI 三态选择（显示 / 遮罩 / 仅看），切换后首页推荐/关注/收藏、用户作品列表、关注列表预览等所有 Feed 立即按模式重算：`show` 原样；`mask` 过滤隐藏 AI 作品；`only` 过滤移除非 AI 作品。设置账号级持久化到 `ai_filter_mode_${uid}`（与 lynx 共享键）。同时修正 AI 徽章守卫，使 `ai_type=1` 显示「AI辅助」。

**Blocked by**：None（可立即开工）

**Status**：ready-for-agent

- [ ] `AiFilterMode` 类型 + `settings.defineFactory` + `aiFilterMode()/setAiFilterMode()/loadAccountAiFilter()`，切换派发 `aiFilterChanged`
- [ ] 新纯函数模块 `aiFilter.ts`（`isAiWork` / `isAiHiddenByMode`），模式作为参数注入
- [ ] `r18Filter.ts` 三个过滤器叠加 AI 过滤（含 `filterUserPreviews` 直测）
- [ ] `types.ts` 补 `ai_type` 0/1/2 值语义注释
- [ ] 6 处卡片 badge 守卫 `>1` → `>=1`
- [ ] `SettingsContent.tsx` 三态分段控件（role=group + aria-pressed）
- [ ] 真值表单测（3 模式 × 4 值）+ badge 组件断言
- [ ] `pnpm check` + 相关单测通过

---

## T2：app 搜索与历史接入 AI 三态

**What to build**：app 搜索结果与浏览历史也受 AI 三态约束——`only` 下移除不符合的条目，`mask` 下隐藏 AI（app 口径）。切换模式后无需重新搜索即可响应。

**Blocked by**：T1

**Status**：ready-for-agent

- [ ] `searchStore.ts` 的 `results` memo 在 merge 后经 AI 模式过滤（缓存仍存原始结果）
- [ ] `HistoryEntry` 新增 `aiType`，`recordVisit` 写入；历史列表按模式过滤
- [ ] 搜索/历史单测覆盖三态
- [ ] `pnpm check` + 相关单测通过

---

## T3：app-lynx 列表三态垂直切片

**What to build**：app-lynx 在「内容」组出现 AI 三态 M3 分段选择，切换后推荐/插画/小说/收藏/关注/用户主页列表即时响应：`mask` 态 AI 条目渲染 scrim 遮罩卡（AI 徽章 + 文案，无交互）；`only` 态过滤移除非 AI 条目（服务端原始判空，空态可渲染）；`show` 原样。读写共享键 `ai_filter_mode_${uid}`。

**Blocked by**：None（可立即开工，与 T1 并行；键契约由 spec/ADR 固定）

**Status**：ready-for-agent

- [ ] `types.ts` 补 `illust_ai_type?` / `novel_ai_type?`
- [ ] settingsStore：`_aiFilterMode` + key + load/set + 登出重置 + `isAiWork/isAiRestricted/isAiOnlyFiltered` + 非法值 warn
- [ ] `AiOverlay.vue`（M3，overlay/inline 两模式）+ `AiRestrictedIllustCard.vue`/`AiRestrictedNovelCard.vue` + `useAiOnlyVisible` 组合式
- [ ] 列表页接入（Recommended / IllustList / Bookmarks / Following / UserHome / NovelList）
- [ ] `Me.vue` 三态分段 + `ME_A11Y_LABELS` 注册
- [ ] 真值表单测（3 模式 × 4 值）+ 存储键读取/非法值/登出用例
- [ ] `pnpm check:app-lynx` + 单测通过

---

## T4：app-lynx 搜索与详情接入 AI 三态

**What to build**：app-lynx 全局搜索弹层与插画/小说详情页也受 AI 三态约束：`mask` 态搜索行内 scrim + AI 徽章文案、详情盖 `AiOverlay`（受限时不拉正文）；`only` 态过滤。

**Blocked by**：T3

**Status**：ready-for-agent

- [ ] `SearchSheet.vue` 行内 AI 遮罩/过滤
- [ ] `NovelDetail.vue` `mask` 态 AI 遮罩（不拉正文）；`IllustDetail.vue` 与其 R18 一致不遮罩（文档同步）
- [ ] 相关单测/模板结构断言
- [ ] `pnpm check:app-lynx` + 单测通过

---

## T5：跨端契约 + 收口验证 + code-review

**What to build**：固化跨端契约并收口：新增 `ai_filter_mode_` 双端键一致性契约测试与双端逐字节一致的 AI 真值表 fixture；跑全量测试；执行 code-review 双轴（Standards + Spec，含调用点完备性与 oracle 溯源审计）；修复发现的问题后提交。

**Blocked by**：T1、T2、T3、T4

**Status**：ready-for-agent

- [ ] `novelExportSettingsConsistency` 式双端键一致性测试
- [ ] `sharedAiFilterTruthTable.ts` + 双端逐字节一致性测试
- [ ] `pnpm check:all` + `pnpm test:all` 通过
- [ ] code-review 闭环（发现问题 → 修复 → 复审至零问题）
- [ ] Conventional Commits 提交
