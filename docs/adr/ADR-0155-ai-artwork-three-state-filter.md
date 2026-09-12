# ADR-0155: AI 作品三态过滤（显示 / 遮罩 / 仅看）

- 状态：accepted
- 日期：2026-09-14
- 关联：ADR-0103（账号级内容设置跨 client 同步）、ADR-0051（app-lynx R18 过滤转遮罩）、docs/specs/ai-artwork-three-state-filter.md

## 背景

Pixiv 在插画与小说响应中提供 `ai_type` 字段：0/undefined = 非 AI，1 = AI 辅助，2 = 纯 AI。app（webview）当前只在 6 个卡片渲染点上显示 AI badge，且守卫统一为 `ai_type > 1`，导致 `ai_type === 1` 既无任何标识、也不参与任何过滤——三元表达式里的「AI辅助」分支是死代码；app-lynx 则完全没有 AI 字段与 AI 相关实现。用户希望像 R18 一样，用一个账号级开关控制 AI 作品呈现，并区分三种语义：显示全部 / 遮罩 / 仅看。

R18 在两端的既有实现并不相同：app 在 store 层（`r18Filter.ts` 经 `createTQFeedStore.filterFn`）直接过滤隐藏受限作品；app-lynx 已从过滤转为「全量渲染 + 受限卡 scrim 遮罩」（`RestrictOverlay`）。因此「遮罩」态的落地形态按端对齐各自 R18 的既有交互，而不是强行统一为同一种视觉。

## 决策

**D1. AI 判定口径**：`ai_type >= 1` 视为 AI 作品（含 AI 辅助与纯 AI）。修正 badge 守卫 `> 1` → `>= 1`，使 `ai_type === 1` 显示「AI辅助」、`=== 2` 显示「AI」。字段缺失或 0 为非 AI。判定收敛到纯函数（app `aiFilter.ts` / lynx `settingsStore.isAiWork`）。

**D2. 三态语义**：账号级设置 `ai_filter_mode_${uid}`，取值 `show | mask | only`，默认 `show`；webview 与 lynx 读写同一 SharedPreferences "CapacitorStorage" 键（ADR-0103 契约）。

- `show`（显示）：不做任何 AI 处理。
- `mask`（遮罩）：app = 在 store 派生结果中过滤隐藏 AI 作品（沿用 app R18）；app-lynx = 全量渲染 + AI 遮罩卡/遮罩层（沿用 lynx R18）。
- `only`（仅看）：两端都完全过滤移除非 AI 作品；这是三态中唯一在 lynx 也执行「移除」的态。

**D3. 交互**：遮罩态跟随各端 R18 交互。app 的隐藏无遮罩可交互；app-lynx 的 AI 遮罩无交互（点击不响应、不穿透）。

**D4. 覆盖范围**：列表 Feed、搜索、详情、历史全部纳入。app 搜索现状完全不过滤 R18，本次为 AI 单独接入客户端过滤（Pixiv 搜索 API 无 `ai_type` 参数）。app 的插画/小说详情页沿用其 R18「不拦截」的现状；app-lynx 详情页沿用其 R18 遮罩。

**D5. 术语**：AI 作品 / AI 内容过滤 / AI 模式（显示、遮罩、仅看）/ AI 遮罩卡（仅 lynx 的视觉形态）。写入两端 CONTEXT.md。

## 被考虑的方案

- **双端统一为真正的「遮罩」**：app 需新建遮罩组件、并把 R18 交互一并改掉，超出本次范围，且与用户「按各自 R18 交互」的拍板不符。
- **把 `ai_type === 1` 视为非 AI**：与用户「`ai_type >= 1` 都算 AI」的拍板不符，且保留死分支。
- **双端各自独立存储键**：与 ADR-0103「账号级设置跨 client 同步」契约冲突。
- **在 app 沿用 `r18Filter.ts` 单一文件承载 AI 逻辑**：文件命名与职责会漂移；改为新增 `aiFilter.ts`，由 `r18Filter.ts` 组合调用。

## 后果

- app 历史条目需新增 `aiType` 字段（当前 `HistoryEntry` 只有 `xRestrict`），并在历史列表按 AI 模式过滤；历史行卡对 R18 的无条件模糊保持不变。
- app-lynx 需先补齐 `PixivIllust` / `PixivNovel` 的 `illust_ai_type?` / `novel_ai_type?` 字段类型（当前类型定义完全缺失）。
- 「仅看」过滤后可能得到空列表：分页判空必须基于服务端原始返回（app-lynx 曾因全过滤白屏，见 docs/specs/app-lynx-r18-overlay-skeleton.md），空态需可渲染。
- 新增跨端存储键一致性契约测试（照 `novelExportSettingsConsistency.test.ts` 的 readFileSync 双端对照模式），防 `ai_filter_mode_` 键名漂移。
- `ai_type` 的 0/1/2 语义此前仅存在于 research 文档且自相矛盾（文档称 1 显示 badge，代码 `>1` 永不显示）。本次以 types.ts 注释 + 纯函数 + 真值表单测把语义固化为可追溯 oracle。

## 修订（2026-09-12，wayfinder #474 / spec `docs/specs/search-advanced-filters.md` #479）

- **搜索筛选面板 AI 覆盖**：搜索页筛选面板新增「AI 作品」行（跟随设置 / 全部显示 / 隐藏 AI），**只影响本次搜索**、不写回账号级设置 `ai_filter_mode_${uid}`；其他场景（Feed/收藏/历史等）照旧听账号设置。实现 = 有效模式解析（`@pictelio/search-core` 的 `resolveAiMode`：follow 原样 / all→show / hide→mask）注入各端既有管线（webview `filterSearchResultsByAiMode` 的 mode 参数；lynx 行遮罩 / 仅看判定）。
- **服务端 `search_ai_type` 评估后不接入**：AI 过滤维持全客户端处理（D4 的搜索覆盖语义不变）；面板不设「仅看」档（仅看仍仅经账号设置生效）。

## 关联

- 术语：`packages/app/CONTEXT.md`「内容过滤」、`packages/app-lynx/CONTEXT.md`「受限内容」
- 规格：`docs/specs/ai-artwork-three-state-filter.md`
- 工单：`docs/specs/ai-artwork-three-state-filter-tickets.md`
