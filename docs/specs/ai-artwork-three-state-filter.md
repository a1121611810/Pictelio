# AI 作品三态过滤（显示 / 遮罩 / 仅看）—— 功能规格

> 来源：grill-with-docs / domain-modeling 会话（Q1–Q7 逐项拍板，2026-09-14）；ADR-0155
> 状态：ready-for-agent

## Problem Statement

Pixiv 的插画与小说响应都带 `ai_type` 字段（0/undefined=非 AI，1=AI 辅助，2=纯 AI），但 Pictelio 现状是：

| 端 | AI 现状 |
|---|---|
| app（webview） | 仅 6 个卡片渲染点显示 badge，守卫写死 `ai_type > 1`；`ai_type === 1` 既无标识也不参与过滤（「AI辅助」分支为死代码）；无任何 AI 过滤设置 |
| app-lynx | 类型里没有 AI 字段，全包零 AI 相关实现 |

用户无法按自己的偏好处理 AI 作品：既不能只屏蔽 AI 作品，也不能只看 AI 作品。R18 已有成熟的账号级开关范式，AI 需要一套同构但三态的控制。

## Solution

新增账号级三态设置 **AI 内容过滤**（键 `ai_filter_mode_${uid}`，与 app-lynx 共享），取值：

| 模式 | 语义 | app（webview） | app-lynx |
|---|---|---|---|
| `show` 显示 | 不处理 | 原样展示 | 原样展示 |
| `mask` 遮罩 | 挡/隐藏 AI 作品 | 从列表派生结果中**过滤隐藏**（沿用 app R18） | **全量渲染 + AI 遮罩卡**（沿用 lynx R18） |
| `only` 仅看 | 只看 AI 作品 | 完全过滤**移除**非 AI 作品 | 完全过滤移除非 AI 作品 |

AI 判定统一为 `ai_type >= 1`（AI 辅助 + 纯 AI 都算），并修正卡片 badge 的死分支。覆盖列表 Feed、搜索、详情、历史。

### 数据流

```
【app 启动】settings.hydrateAll + loadAccountR18()/loadAccountAiFilter()（uid 就绪）
  → aiFilterMode() 信号就绪 → r18Filter/aiFilter 响应式生效

【app 切换】setAiFilterMode(mode) → factory.forId(uid).set(mode) → dispatch aiFilterChanged
  → 各 feed 的 filterFn 重新派生（屏蔽/过滤即时生效）

【app-lynx 启动】initRouter: restoreToken（currentUser.id 就绪）→ loadSettings(uid)
  → prefs().get('ai_filter_mode_' + uid) → _aiFilterMode ref
【app-lynx 切换】setAiFilterMode → 写同一键 → 遮罩卡/过滤即时重算

【引擎切换】Activity 重启 → 另一 client 读同一 SharedPreferences 文件
【登出】uid 变 null → 两端 accessor/ref 回默认 show，不落盘
```

### 边界条件

- **未登录**：不落盘，accessor 返回默认 `show`。
- **值损坏/非法**：`ai_filter_mode_${uid}` 不是三个合法值之一 → 维持默认 `show` 并 `console.warn`（禁止静默降级）。
- **仅看后空列表**：分页判空基于服务端原始返回（`res.illusts.length === 0`），不得基于过滤后长度；空态可渲染不白屏。
- **与 R18 正交**：先应用屏蔽用户与 R18/R18G（app 隐藏 / lynx 遮罩），再应用 AI 三态；被 R18 隐藏的作品不再渲染 AI 遮罩。
- **无旧键迁移**：本次全新键，无 legacy 键。
- **ai_type 缺失**：视为 0（非 AI），与 Pixiv 全年龄作品一致。

## User Stories

1. 作为用户，我想在设置里选择 AI 作品的处理方式（显示 / 遮罩 / 仅看），以便按偏好控制浏览内容。
2. 作为用户，我选「仅看」时只想看到 AI 相关作品，以便专门浏览 AI 创作。
3. 作为用户，我选「遮罩」时不想看到 AI 作品内容但希望列表仍保留上下文，以便知道那里有内容。
4. 作为用户，我选「显示」时不希望任何 AI 处理，以便正常浏览全部作品。
5. 作为 app 用户，「遮罩」态下 AI 插画/小说从各类列表消失（沿用 R18 的隐藏），以便获得与 R18 一致的体验。
6. 作为 app-lynx 用户，「遮罩」态下 AI 条目的封面被 scrim 遮罩卡挡住并带 AI 徽章与文案，以便知道这是 AI 作品但不必看到内容。
7. 作为 app-lynx 用户，AI 遮罩卡点击不响应也不穿透，以便不误触进入详情。
8. 作为用户，AI 辅助作品（`ai_type === 1`）也应被识别并显示「AI辅助」徽章，以便不与纯 AI 混淆。
9. 作为用户，纯 AI 作品（`ai_type === 2`）显示「AI」徽章，以便一眼识别。
10. 作为用户，我在搜索里也受到 AI 三态约束，以便搜索结果与列表口径一致。
11. 作为搜索结果里的 AI 作品在「only」下被移除、在「mask」下按端遮罩，以便不漏过滤。
12. 作为用户，详情页与列表口径一致：app-lynx 小说详情在「遮罩」态盖 AI 遮罩（不拉正文），其余详情与其 R18 既有交互一致。
13. 作为用户，我的浏览历史也按 AI 三态过滤，以便历史与列表一致。
14. 作为用户，我在 webview 设置了 AI 三态，切到 lynx 后保持一致，以便双引擎体验统一。
15. 作为用户，我退出账号 A 登录账号 B，AI 三态恢复为 B 自己的值（默认显示），以便设置跟随账号。
16. 作为用户，未登录时我不看到上一个账号的 AI 偏好，以便不泄露。
17. 作为用户，切换 AI 模式后列表立即响应，无需刷新，以便操作即时。
18. 作为用户，我选「仅看」后列表为空时看到空态而非白屏或无限加载，以便知道确实没有 AI 作品。
19. 作为维护者，我希望 AI 判定是带值语义注释的纯函数，以便 `ai_type` 值域漂移时测试精确失败。
20. 作为维护者，我希望 app 与 app-lynx 的存储键一致性有契约测试把守，以便键名不漂移。
21. 作为维护者，我希望 AI 三态行为有真值表测试（模式 × ai_type），以便语义可追溯。
22. 作为用户，我选「仅看」后仍能翻页加载后续 AI 作品，以便不会因为过滤而中断分页。
23. 作为用户，AI 模式设置与 R18 开关互不干扰，以便两类过滤独立组合。
24. 作为 app 用户，历史行卡的 R18 模糊行为保持不变，AI 只按三态处理，以便不引入意外视觉回归。
25. 作为用户，我切换 AI 模式时不需要重新请求网络，以便操作即时且不浪费流量。

## Implementation Decisions

### 共享契约

1. **存储键**：`ai_filter_mode_${uid}`，值为裸字符串 `"show" | "mask" | "only"`，默认 `"show"`。app 用 `settings.defineFactory<AiFilterMode>`（keyPrefix `ai_filter_mode`，validate 三值），app-lynx 直接拼键。native 端同写 SharedPreferences "CapacitorStorage"（app-lynx 经 `PictelioPrefs`），dev 端 app-lynx 走 IndexedDB。**无 legacy 键**。
2. **模式类型**：`AiFilterMode = "show" | "mask" | "only"`，两端各自定义（app 导出 `AiFilterMode` / lynx 同名字面量联合）。

### app（packages/app）

3. **新纯函数模块** `src/utils/aiFilter.ts`：`isAiWork(item)`（`(illust_ai_type ?? novel_ai_type ?? 0) >= 1`）、`isAiHiddenByMode(item, mode)`（mask→AI 隐藏，only→非 AI 隐藏，show→不隐藏）、`filterSearchResultsByAiMode(items, mode)`。不依赖 store，模式作为参数注入以便测试。
4. **`src/utils/r18Filter.ts`**：`filterFeedIllusts` / `filterNovels` / `filterUserPreviews` 在既有 R18/屏蔽过滤之上追加 AI 过滤（读 `aiFilterMode()`）。这是 7 个 feed store + userIllustsStore 的统一接缝，改动集中在此。
5. **`src/api/types.ts`**：给 `illust_ai_type` / `novel_ai_type` 补 0/1/2 值语义注释（oracle 固化）。
6. **卡片 badge 修正**：`ImageCard` / `GridCard` / `IllustSingleCard` / `NovelCard`（两处）/ `NovelTextListCard` / `NovelRowCard` 的守卫 `> 1` → `>= 1`。
7. **settingsStore**：`aiFilterModeFactory` + `aiFilterMode()` + `setAiFilterMode()` + `loadAccountAiFilter()`（登录后 hydrate；并入 `loadAccountR18` 触发时序）+ `resetSettingsStore` 重置为 `show`。切换派发 `aiFilterChanged`。
8. **设置 UI**（`components/settings/SettingsContent.tsx`）：在 R18/R18G 开关下方新增三态分段控件（3 个按钮 `role=group` + `aria-pressed`，先例 `ThemeSelector`），label「AI 作品」，选项「显示 / 遮罩 / 仅看」。
9. **搜索**（`stores/searchStore.ts`）：`results` memo 在 merge 之后经 AI 模式过滤（缓存仍存原始结果，过滤在派生层，响应式随模式变化）。
10. **历史**（`stores/historyStore.ts`）：`HistoryEntry` 新增 `aiType: number`；`recordVisit` 写入 `illust_ai_type ?? novel_ai_type ?? 0`；历史列表按 AI 模式过滤。
11. **详情页**：app 沿用 R18「不拦截」现状，不做改动。

### app-lynx（packages/app-lynx）

12. **类型**（`src/api/types.ts`）：`PixivIllust` 加 `illust_ai_type?: number`，`PixivNovel` 加 `novel_ai_type?: number`，带 0/1/2 注释。
13. **settingsStore**（Pinia）：`_aiFilterMode` ref + `aiFilterMode` getter + `setAiFilterMode` + `loadSettings` 读键 + 登出 watch 重置 + `isAiWork(item)` / `isAiRestricted(item)`（mask 态）/ `isAiOnlyFiltered(item)`（only 态被移除）。非法值 warn + 默认。
14. **AI 遮罩组件** `src/components/AiOverlay.vue`：M3 形态，props `{ aiType: number; overlay?: boolean }`（接 ai_type 原值，徽章文案组件内部单点派生），徽章「AI」/「AI辅助」+ 文案，无交互。插画列表卡用 `AiRestrictedIllustCard`、小说列表卡用 `AiRestrictedNovelCard`（内部 overlay=false + 调用方 bg-scrim 容器）；详情用 overlay=true。**禁止 list-item 内 absolute**。
15. **列表页接入**：`Recommended` / `IllustList` / `Bookmarks` / `Following` / `UserHome` 的插画卡、`NovelList` / `Bookmarks` / `UserHome` 的小说卡：`mask` 态 AI 条目渲染 AI 遮罩卡（插画 `AiRestrictedIllustCard` / 小说 `AiRestrictedNovelCard`）；`only` 态统一经 `useAiOnlyVisible` 组合式在渲染派生处过滤非 AI 条目（保留服务端原始判空）。`Recommended` 沿用其 R18 的过滤口径（`shouldHideByAi`）。
16. **搜索**（`components/SearchSheet.vue`）：行内在 `mask` 态对 AI 条目加 scrim + AI 徽章 + 文案；`only` 态经 `useAiOnlyVisible(rawResults, (r) => r.entity)` 过滤。沿用 R18 行内遮罩的缩放变体做法。
17. **详情（按各端 R18 既有交互）**：app-lynx 仅在 `NovelDetail`（其 R18 有遮罩）于 `mask` 态盖 `AiOverlay` 且受限时不拉正文；app-lynx `IllustDetail` 与其 R18 一致不遮罩；app 插画/小说详情与其 R18 一致不拦截（深链可见）。
18. **设置 UI**（`Me.vue` 内容组）：新增 M3 segmented button 三态选择（先例：同页「动图播放」的 ugoiraMode 分段），a11y label 注册到 `utils/accessibility.ts` 的 `ME_A11Y_LABELS`。

### 测试接缝（seams）

- **app**：`aiFilter.ts` 纯函数（模式作为参数注入）是首选接缝；`r18Filter.ts` 经 mock `aiFilterMode` 间接测；settingsStore 经 memory backend 注入测键与 hydrate。
- **app-lynx**：`settingsStore.isAiWork/isAiRestricted` action 是唯一新逻辑接缝，页面只做 `v-if` 绑定。
- **跨端**：`ai_filter_mode_` 键字符串一致性契约测试 + AI 真值表 fixture 双端逐字节一致测试。

## Testing Decisions

**好测试的标准**：只断言外部可观察行为（给定 ai_type + 模式 → 是否隐藏 / 是否遮罩 / 输出哪些条目），不断言内部实现。期望值必须可溯源——出处为 ADR-0155 的三态语义表、`ai_type` 0/1/2 契约、research/ai-artwork-filtering.md，禁止从被测实现反推。

- **app `aiBadgeGuardConsistency.test.ts`**：源码级断言 6 个 AI badge 渲染点均使用 `ai_type >= 1`，禁止退回 `> 1` 死分支（机器防线）。
- **app `aiFilter.test.ts`**（tests/unit/utils）：真值表 —— `mode ∈ {show, mask, only}` × `ai_type ∈ {undefined, 0, 1, 2}`，断言 `isAiHiddenByMode`；`only` 下非 AI 移除；`mask` 下 AI 移除。
- **app `aiFilterTruthTable.test.ts` + shared fixture**：与 app-lynx 逐字节一致的 `sharedAiFilterTruthTable.ts`，由 `aiFilterTruthTableConsistency.test.ts` readFileSync 守护。
- **app `r18Filter.test.ts` 扩展**：mock `aiFilterMode` 后断言 `filterFeedIllusts/filterNovels/filterUserPreviews` 叠加 AI 过滤；补 `filterUserPreviews` 直测（当前无）。
- **app settingsStore 测试**：memory backend 注入，断言写 `ai_filter_mode_42`、未登录不落盘、换号隔离、非法值 warn+默认。先例 `tests/unit/stores/settingsStore.test.ts`。
- **app 键一致性契约测试**：照 `novelExportSettingsConsistency.test.ts` readFileSync 双端 settingsStore，断言 `ai_filter_mode_` 字面出现在两端。
- **app-lynx `settingsStore.test.ts` 扩展**：native/dev adapter 读同键、非法值 warn、登出重置；`isAiRestricted` 真值表 3 模式 × 4 值。
- **app 组件 badge**：复用现有组件测试先例，断言 `ai_type=1` 渲染「AI辅助」、`=2` 渲染「AI」、`undefined/0` 不渲染。
- **E2E（可选）**：agent-browser `driver.mockFetch` 注入含 `ai_type` 的真实响应，设置页切三态后断言 DOM；不做真机 AI E2E。

## Out of Scope

- app 端新建视觉遮罩组件 / 改动 R18 既有交互（用户明确「按各自 R18 交互」）。
- 修改 R18 本身的二态过滤/遮罩行为。
- `translateR18` 等 AI 翻译相关开关（与内容过滤独立）。
- app-lynx 轮播以外页面的像素级视觉打磨。
- 服务端 AI 过滤（Pixiv API 不支持）。
- openwiki 更新（由 CI 定时任务重生成）。

## Further Notes

- 报告与实际代码的差异已记录：AGENTS.md 中「ImageCard 含 R18 模糊、R18G 遮罩」的表述已过时（app 实际只有 badge + 过滤隐藏），本次不改 AGENTS.md。
- app 搜索此前完全不过滤 R18；本次 AI 在搜索接入客户端过滤，是 AI 独有的新路径，不改变 R18 搜索行为（不在本次范围）。
- 测试硬约束对照：#1 IO 边界（settings 读/写失败路径）、#2 真实样例（ai_type 来自真实 Pixiv 响应结构/research）、#4 重构行为不变（badge 守卫改动补组件断言）、#6 oracle 溯源（本 spec 三态表 + research）。
