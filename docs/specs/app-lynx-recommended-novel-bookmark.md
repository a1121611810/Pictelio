# app-lynx 推荐轮播小说滑页的收藏入口 —— 功能规格

> 来源：Grill（`grill-with-docs`）第 1/2 轮 + 补问轮（2026-09-21）；问题现场 = 用户截图「推荐 = 小说时看不见收藏按钮」
> 状态：ready-for-agent
> 相关决策：ADR-0115（推荐页 = 单卡轮播）、ADR-0118（封面比例/标签行）、ADR-0112（收藏动效）、ADR-0163（init-only props remount 契约）、ADR-0160（收藏面板范围裁剪：**仅插画**）
> 术语遵循 `packages/app-lynx/CONTEXT.md`（推荐轮播 / 滑页 / 小说介绍页 / 三段式导航）

## Problem Statement

推荐页是**单卡轮播**，一滑页 = 一个作品，插画与小说混合（ADR-0115）。底部 scrim 信息区按 kind 渲染：插画滑页有「♥ + 收藏数」（可点、可收藏），小说滑页**只有「N 字」**，没有任何收藏入口——同一屏、同一交互位，用户滑到小说就「看不见收藏按钮」。小说数据本身不缺口（`is_bookmarked` / `total_bookmarks` 均在推荐接口响应里），缺的只是渲染分支。

更糟的是文档层面这个缺口被**遮蔽**了：`CONTEXT.md` 的「推荐页」词条写着 scrim 承载「收藏按钮 / 字数」（暗示两 kind 都有），而 ADR-0160 D7 把范围裁剪写成「小说收藏入口**在列表卡片**」——事实是两侧客户端的小说列表卡都没有入口。于是「小说在轮播里没有 ♥」既不被文档承认，也不被任何测试覆盖，只能靠用户肉眼发现。

## Solution

推荐轮播的**小说滑页**补一颗与插画**同形同位**的 ♥（含收藏数，单击快速收藏/取消，乐观更新 + 失败回滚），点击 ♥ 不触发「进小说介绍页」；「N 字」保留，退到 ♥ 下方次行。插画滑页行为零变化。

范围**只到推荐轮播**：小说列表卡、收藏页小说 tab、用户主页小说 tab、搜索弹层的小说行都不在这次（登记为已知不一致，见 Further Notes）。

## User Stories

1. 作为用户，我滑到推荐里的**小说**滑页时也能看到一颗 ♥，以便不必先点进小说介绍页才能收藏。
2. 作为用户，我希望小说滑页的 ♥ 与插画滑页出现在**同一位置、同一形态**，以便左右滑动切换作品时不觉得界面在跳。
3. 作为用户，我希望 ♥ 旁边显示这本小说的**收藏数**，以便判断它值不值得看。
4. 作为用户，我希望点 ♥ 只收藏、**不会误跳进小说介绍页**，以便连续收藏多本。
5. 作为用户，我希望 ♥ 的收藏/取消**立即有反馈**（不等网络），失败时能看到回滚与提示，以便操作可靠。
6. 作为用户，我希望小说滑页仍然显示 **「N 字」**，以便快速判断篇幅。
7. 作为用户，我希望收藏后计数**当场 +1/-1**，以便确认操作生效。
8. 作为用户，我希望从小说滑页进介绍页后收藏，再滑回轮播时不会看到「错作品」的收藏态（宁可短暂陈旧，也不要串到别的作品上）。
9. 作为用户，我希望 R18/R18G 或 AI 过滤生效时，被过滤的小说**根本不出现在轮播里**（因此也不会出现可收藏的受限作品）。
10. 作为用户，我希望窄屏（320 宽）下 ♥ + 收藏数 + 字数**不与右下角回顶 FAB 打架**，以便小屏也能用。
11. 作为用户，我希望「N 字」只在小说的真实字数存在时显示，缺数据时**不要显示 0 字**这样误导的信息。
12. 作为开发者，我希望小说收藏走与插画**同一条快速收藏通道**（恒公开、无标签），以便两端语义不分叉。
13. 作为开发者，我希望这次改动**不破坏**「所有小说入口先进介绍页」的三段式导航契约（票 #588），以便既有导航护栏继续有效。
14. 作为开发者，我希望缺字段等异常路径**显式告警**而不是静默降级，以便线上异常可被看见。
15. 作为开发者，我希望「小说在轮播里可收藏」这件事有**机器防线**，以便它再次退化时不用靠用户肉眼发现。
16. 作为开发者，我希望这次只动 app-lynx，**webview 端的同款缺口**被显式记录而不是遗忘（各端小说收藏 UI 独立演进，ADR-0160 D7）。
17. 作为评审者，我希望 spec 明确列出**已知不一致清单**（其余小说卡宿主、webview 端、返回轮播的计数陈旧），以便它们不被当成 bug 重报。

## Implementation Decisions

### 模块与接口

| 模块 | 改动 |
|---|---|
| `pages/Recommended.vue`（改） | scrim 的小说分支：从「只渲染字数」改为「渲染 `BookmarkButton`（`target-kind="novel"`）+ 字数次行」；♥ 槽位与插画一致（`mt-5`），字数 `mt-2` 次行。两个 kind 的 `:key` 统一取 feed 模型的跨 kind 唯一键（`i-<id>` / `n-<id>`），避免插画与小说 id 相同（如 `123`）时 Vue 复用同一个 `BookmarkButton` 实例 → init-only props 冻结（ADR-0163 真实缺陷 44ee6401 的同类风险） |
| `components/BookmarkButton.vue`（**本票不改**） | 已支持 `targetKind: 'illust' \| 'novel'`、`bookmarkCount` 可选、tap 抑制冒泡（`@tap.stop`）；配色与尺寸（`self-start` hug content）的改动属**另一份 spec** `docs/specs/bookmark-color.md`（同一工作区，分属于提交见 Further Notes） |
| `composables/useBookmarkMutation.ts`（不改） | novel 形态已存在，快速收藏恒 `restrict="public"`、novel 无 tags |

### 交互契约

- **单击 = 快速收藏/取消**：乐观翻转收藏态与计数 → 调 novel 端点 → 失败回滚；busy 期间 no-op（沿用 ADR-0112 语义）。
- **不开长按收藏面板**：面板语义 = 「收藏 + 标签」，小说标签已被 ADR-0160 D7 明确排除在本期外；给出半成品入口比不给更糟。
- **点击 ♥ 不导航**：`BookmarkButton` 内 `@tap.stop` 抑制冒泡到 scrim 的「进介绍页」`@tap`（既有插画行为）。
- **收藏后不回写 feed**：轮播显示的是 feed 快照，不引入跨页 store；从介绍页返回后计数可能短暂陈旧（明确接受，见 Further Notes）。
- **受限/AI 过滤**：沿用渲染层过滤（`visibleItems`），♥ 不新增第二套受限判定，避免两套判定分叉。

### 数据契约

- 唯一外部依赖 = 推荐小说响应字段 `is_bookmarked` / `total_bookmarks` / `text_length`（`PixivNovel` 既有类型）。**已用真实响应钉死**：2026-09-21 抓取真实端点（HTTP 200、原始 88,626 B / 33 条，每条均带三字段），落 fixture `packages/app-lynx/tests/fixtures/novel-recommended.real.json`（保留 3 条字段逐字、覆盖 `x_restrict` 0/1/2），契约测试直接读该 fixture 断言字段可用性。
- 缺字段降级（**已实现**）：`total_bookmarks` 缺失 → 计数不渲染；`text_length` 缺失或不 > 0 → 字数行不渲染；两者都在 `Recommended.vue` 的 `mapNovels` 打 `[recommended]` 前缀 `console.warn`（测试硬约束 #3：禁静默降级）。

## Testing Decisions

**什么算好测试**：只测外部行为与接线形状，不测实现细节；页面级行为在仓库内无法单测（无 vue-lynx 渲染器），因此页面接线用**源级守卫**（形态断言）而不是伪造渲染器。

三类缝（两个既有 + 一个复用范式）：

1. **主缝（组件行为，既有）**：`components/BookmarkButton.host-matrix.test.ts` 的 FakeNode 渲染器 + 真实组件 + mock api——新增「轮播小说宿主」用例：novel 形态 init-only props 正确初始化、单击走 novel 端点且 `restrict=public`、`:key` 变化强制重建（对照插画侧既有 `(b) 复用宿主形态` 用例）。
2. **补充缝（页面接线，新文件）**：`tests/recommendedNovelBookmark.test.ts`——按 `tests/novelIntroEntryGuards.test.ts` 的源级守卫惯例，锁「小说分支渲染 ♥ + `target-kind="novel"` + 跨 kind 唯一键 + 字数保留」，并断言不破坏三段式改道护栏。
3. **数据缝（端点契约 + 真实样例）**：`tests/novelRecommendedApi.test.ts` 读**真实响应 fixture**（`tests/fixtures/novel-recommended.real.json`，逐字入库）断言端点/参数/透传、页面依赖的三字段可用性（含 fixture 自身有效性断言：非空 + 覆盖三档 `x_restrict`，防 fixture 变空后全称断言恒真）与失败路径。

非自动化证据：**已落 `docs/verification/app-lynx-recommended-novel-bookmark-emulator-2026-09-21.md`**——设备实跑命令 + 3 张截图（小说滑页 ♥540 + 5011 字、点 ♥ 不跳页且计数双向翻转后还原）；web-core **400 / 320** 两档实测（320 用 mock 小说优先 feed 做几何验证，截图入库，三元素无碰撞）。

## Out of Scope

- 其它小说卡宿主的收藏入口：小说列表、收藏页小说 tab、用户主页小说 tab、搜索弹层小说行。
- webview 客户端（`packages/app`）小说卡的可点 ♥。
- 小说收藏标签（ADR-0160 D7 裁剪不变）、小说长按收藏面板。
- 推荐轮播的翻页指示器、其它 scrim 信息项重排。

## Further Notes

- **接受的代价**：从轮播进小说介绍页收藏后返回，轮播滑页显示 feed 快照里的旧计数（刷新/翻页后收敛）。这是「不引入跨页 store」的直接代价，作为**明确验收用例**而非隐性 bug。
- **row 宿主居中**：♥ 自带 `self-start`（为 column 宿主 hug content，见 `bookmark-color.md`），详情页/小说介绍页的 row 宿主以 `class="self-center"` 覆盖回居中。
- **提交切分**：本票与 `bookmark-color.md`（chip 配色 + 尺寸）同处一个工作区，按主题分两笔提交（便于二分与回滚），spec 内容各自独立。
- **已知不一致登记**（下次排期一眼可见）：① 其余小说卡宿主无收藏入口；② webview 侧小说卡仅只读展示收藏数、无入口；③ 上述「返回轮播计数短暂陈旧」。
- **文档勘误**：ADR-0160 D7 追加「勘误（2026-09-21）」段——小说收藏入口 = 小说介绍页（+ 本 spec 新增的推荐轮播滑页），列表卡两侧客户端均无入口；`CONTEXT.md` 新增词条「小说收藏入口（novel bookmark entry）」。不开新 ADR（可逆、不意外、无真实取舍）。
