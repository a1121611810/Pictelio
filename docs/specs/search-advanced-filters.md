# Spec: 搜索高级筛选（双端：app webview + app-lynx）

- 状态：draft（终审稿 v1，2026-09-12；决策经 wayfinder 地图 #474 收敛，#475~#479 全闭，终审通过后转 ready-for-implementation）
- 日期：2026-09-12
- 关联：wayfinder [#474](https://github.com/a1121611810/Pictelio/issues/474)（地图）/ research `docs/research/pixiv-appapi-search-filter-params.md`（分支 `research/search-filter-api-surface`，7781735e）/ 原型 `docs/research/search-filter-ui-proto/`（分支 `prototype/search-filter-ui`，84df25fd）/ ADR-0132（lynx 全局搜索，第 8 条契约）/ ADR-0155（AI 三态）/ feature-gap 报告 P0-2（`docs/research/pictelio-feature-gap-vs-third-party.md`，分支 research/feature-gap-reverify-20260912）
- 工单：待终审后 to-tickets 流水线拆票（地图外）

## 1. 背景与目标

feature-gap 复验（P0-2）确认：官方 App 标配的搜索高级筛选（期间/收藏数/比例/分辨率）在 Pictelio 双端完全缺失，两端搜索当前是「裸四参」（`word/sort/search_target/filter`）。本 spec 交付**双端一致的搜索高级筛选**：

1. **四个筛选维度**：投稿期间、收藏数、比例（横/竖/方）、分辨率（最小边），全部为官方 AppAPI 免费可用项。
2. **AI 覆盖行**：搜索面板内可临时覆盖账号级 AI 三态（仅本次搜索）。
3. **双端形态**：webview = 底部 Sheet（ReaderSettingsSheet 范式）；lynx = SearchSheet 内折叠筛选区（均已拍板，#477）。
4. **行为语义**：即改即搜、会话内保留、热门排序共存、scope 适用性置灰——全部沿用已拍决策（§5）。

## 2. 非目标（Out of Scope）

- **小说专属维度**：正文长度三单位（`text_length`/`word_count`/`reading_time`）、`genre`、`is_original_only`/`is_replaceable_only`——超出本地图 charted 维度集（四维+AI），列为下期候选（研究文档 §2 已备好参数事实）。
- **`content_type`（作品类别五档）与 `tool`/`lang` 维度**：未入 charted 维度集，候选。
- **服务端 AI 参数（`search_ai_type`）**：#479 裁决**不接入**，三态全部客户端处理；研究文档该参数已标「评估后不接入」。
- **筛选持久化**：#476 裁决会话内保留、冷启动重置，无跨会话存储。
- **收藏内搜索、搜索联想/热门词改造、排行榜**：地图外（见差距报告）。
- **`Xusers入り` 关键字后缀免会员方案**：不采用（§7 客户端兜底已覆盖其价值）。
- iOS / release 流水线 / OpenWiki / CI。

## 3. 领域模型

### 3.1 筛选状态（canonical shape，落 `@pictelio/search-core`）

```ts
export interface SearchFilters {
  /** 投稿期间：预设档或自定义起止；any = 不限 */
  period:
    | { kind: "any" }
    | { kind: "preset"; preset: "1d" | "1w" | "1m" | "6m" | "1y" }
    | { kind: "custom"; start: string; end: string }; // YYYY-MM-DD 闭区间
  /** 收藏数：官方七档带宽（闭区间，max null = 无上界）；null = 不限 */
  bookmark: { min: number; max: number | null } | null;
  /** 比例（仅插画） */
  ratio: "landscape" | "portrait" | "square" | null;
  /** 分辨率（仅插画）：宽度与高度同值下限（px） */
  minPixels: number | null;
  /** AI 覆盖（仅搜索页语义）：follow = 听账号级设置 */
  aiOverride: "follow" | "all" | "hide";
}
```

- 默认值 = 全部不限 + `aiOverride: "follow"`；**无值即默认**，不引入「显式不过滤」状态位（#476 Q6）。
- 七档收藏数带宽**硬编码常量**（值 = 官方 iOS 8.7.3 抓包 `/v1/search/options` 下发值，研究文档 §1.2）：`10-29 / 30-49 / 50-99 / 100-299 / 300-499 / 500-999 / 1000-∞`；UI 标签 `10+`…`1000+`。动态拉取 `/v1/search/options` 列为增强（非本期）。

### 3.2 维度适用矩阵（scope × 维度）

| 维度 | scope=all | scope=illust | scope=novel |
|---|---|---|---|
| 期间 | ✅ 双路携带 | ✅ | ✅ |
| 收藏数 | ✅ 双路携带（参数+客户端兜底） | ✅ | ✅ |
| 比例 / 分辨率 | ✅ **仅传插画路**，控件标「仅插画」 | ✅ | **置灰禁用，值保留** |
| AI 覆盖 | ✅（客户端，scope 无关） | ✅ | ✅ |

### 3.3 筛选状态 → 请求参数映射（由 search-core 单点实现）

| 状态 | 请求参数 | 说明 |
|---|---|---|
| `period` | `start_date` / `end_date`（`YYYY-MM-DD`） | **预设档换算成日期直发，不发 `duration`**（对齐 iOS 8.6.6；duration 与日期语义重叠，且 novel 端 duration 五档未验证）。换算以日本时区当天为界；校验 `end ≤ 今天`、`start ≤ end` |
| `bookmark` | `bookmark_num_min` / `bookmark_num_max`（闭区间） | max null → 只发 min |
| `ratio` | `ratio_pattern`（`landscape/portrait/square`） | 注意参数名非 Web 端的 `ratio` |
| `minPixels` | `width_min` + `height_min`（同值） | 官方预设档即宽高同值 |
| `aiOverride` | **不进请求** | 客户端过滤注入（§5.4） |

恒定附加（对齐 iOS/Shaft/pixez）：`merge_plain_keyword_results=true`、`include_translated_tag_results=true`、`filter=for_ios`（现状）、`search_ai_type` **不传**。

### 3.4 热门排序共存矩阵（#478 拍板：都能用，只灰收藏数）

| 排序 | 筛选态 | 行为 |
|---|---|---|
| 最新/最早 | 任意 | 普通搜索端点，筛选全量携带 |
| 热门 | 未激活 | `/v1/search/popular-preview/*`，现状不变（不分页、无加载更多） |
| 热门 | 期间/比例/分辨率/AI 任一 | **透传 popular-preview**（官方 iOS 同用法） |
| 热门 | 收藏数激活态 | 请求**不携带**收藏数；该维度置灰+标注「热门榜不支持按收藏数筛」；值保留，切回最新/最早恢复；客户端兜底过滤同样不生效 |

scope 轴不改变矩阵（popular-preview 两端对称接受各自端筛选面）。

## 4. 架构

```
packages/search-core/          # 新共享包 @pictelio/search-core（零 IO 纯函数）
  src/filters.ts               #   SearchFilters 类型 + 默认值 + 校验（日期/带宽）
  src/buildParams.ts           #   筛选状态 → 端点参数对象（含 scope/排序路由与 §3.4 矩阵）
  src/period.ts                #   预设档 → start/end_date 换算（日本时区当天为界）
  src/urlCodec.ts              #   筛选状态 ↔ webview URL query 编解码（§6.3）
  src/cacheKey.ts              #   缓存键构建（word_scope_sort + filters 规范段）
  tests/                       #   真值表单测（oracle = 研究文档官方抓包值）
```

- **单点共享**（#480 拍板，替代 ADR-0132 的双端镜像约定）：参数构建/换算/编解码只有一份代码。先例：`@pictelio/update-check` 已被 webview+lynx 双端共用，构建链集成已被验证。
- **双端薄传输层**：
  - webview `api/search.ts`：参数构建挪出至 search-core，保留 fetch/代理与 `next_url` 域名断言（SSRF 防卫）。
  - lynx `api/search.ts`：同上。
- **状态归属**（#476 派生结论）：
  - webview：扩展现有 `createSearchStore`（+筛选 signals）；`Search.tsx` URL 编解码接 search-core；新增 `components/search/SearchFilterSheet.tsx`（底部 Sheet，ReaderSettingsSheet 范式，入口=搜索栏筛选 icon+激活数徽标）。
  - lynx：扩展 `useSearch` controller（+filters ref，与 scopeRef/sortRef 同位）；`SearchSheet.vue` 新增折叠筛选区组件（默认折叠，#477 拍板）。

## 5. 交互与数据流（#476 全部拍板）

1. **生命周期**：会话内保留、冷启动重置（不持久化）；改关键词、切 scope 只重搜不清筛选。
2. **生效时机**：即改即搜——面板内最后一次改动后 400-500ms debounce 自动重搜；自定义日期在 start/end 两字段齐后生效；请求风暴由 debounce + 既有 AbortController/generation gate 兜底。
3. **重置**：面板顶部「清除全部」（仅有激活筛选时出现）+ 各维度可单独调回默认（chips 再点已选项回默认档）；筛选入口 icon 带激活数徽标（0 个激活时隐藏）。
4. **AI 覆盖**（#479）：面板 chips = **跟随设置（默认）/ 全部显示 / 隐藏 AI**；改动只影响本次搜索、不写回账号级设置 `ai_filter_mode_${uid}`；实现 = 客户端过滤模式注入（webview `filterSearchResultsByAiMode` 的 mode 参数、lynx 同源 composable），覆盖值进缓存键与 URL。「仅看」仅经全局设置生效（跟随设置路径），面板不设仅看档。
5. **R18 正交声明**：`isRestricted`/`r18Filter` 客户端逻辑本次不动；AI 遮罩徽章 UI 复用不变。
6. **URL 同步（仅 webview）**：筛选随 `word/scope/sort` 进 `/search` query（§6.3 键表）；lynx 弹层存续期保留、关闭即重置（与 keyword/结果现状对称）。

## 6. 契约面变更

### 6.1 请求参数变更（行为变更点，发布说明需标注）

| 变更 | 内容 | 依据 |
|---|---|---|
| 新增筛选参数 | `start_date`/`end_date`/`bookmark_num_min`/`bookmark_num_max`/`ratio_pattern`/`width_min`/`height_min`（按状态按矩阵携带） | 研究文档 §1/§2/§3/§4 |
| 恒发两个 bool | `merge_plain_keyword_results=true`、`include_translated_tag_results=true` | iOS/Shaft/pixez 一致行为（研究文档 §1.2） |
| `search_target` 修复 | **illust 端**：partial 场景（单词标签）**不传** `search_target`（不传 ≡ partial 且并入标题命中；显式传 partial 反而做严格 tag 匹配并忽略 merge 参数——Shaft #906）；exact 场景（含空格多标签）显式传 `exact_match_for_tags`。**novel 端**：恒显式传（partial/exact），不传会退化纯字面匹配、同义词不展开（#1038）。popular-preview 两端同规则 | 研究文档 §1.1/§2/§9.3（两端现状恰好各踩一半坑） |
| 不发 `include_potential_violation_works` | 维持现状不传（iOS 默认 false 会隐藏部分作品，Shaft 特意不传以免漏结果） | 研究文档 §1.2 |
| 不发 `duration`/`search_ai_type` | duration 换算成日期；AI 参数 #479 裁决不接入 | §3.3 |

### 6.2 缓存键

`word_scope_sort` → `word_scope_sort_<filters 规范段>`（search-core `buildCacheKey` 产出；aiOverride=follow 不落键、非 follow 落键）。webview `inFlightSearchKey` 判重键同步扩展。**防脏缓存是正确性硬要求**。

### 6.3 URL query 键表（webview）

| 键 | 值 | 示例 |
|---|---|---|
| `fp` | period preset：`1d/1w/1m/6m/1y` | `fp=1w` |
| `fd` | 自定义起止 `YYYY-MM-DD_YYYY-MM-DD`（与 `fp` 互斥，`fd` 优先） | `fd=2026-08-01_2026-08-15` |
| `fb` | 收藏数带宽序号 `0-6`（对应 §3.1 七档） | `fb=3` |
| `fr` | `landscape/portrait/square` | `fr=landscape` |
| `fw` | 最小边 px（正整数） | `fw=2000` |
| `fa` | `all/hide`（follow 为默认不落键） | `fa=hide` |

非法/未知值一律忽略回默认（容忍手改 URL 与旧链接）。详情页返回靠 URL 回填筛选 + LRU 缓存恢复结果（现状机制的延伸，#476 Q5）。

### 6.4 ADR 动作

- **ADR-0132 第 8 条修订**：lynx `api/search.ts`「逐字对齐 webview」→「同构薄传输（fetch/next_url 断言）+ 参数构建单点共享（@pictelio/search-core）」。第 4 条的 scope/sort 语义不动。
- **ADR-0155 增补条目**（非新 ADR）：搜索筛选面板 AI 行覆盖语义——默认跟随设置、仅本次搜索、不写回账号级设置；三态维持全客户端处理，`search_ai_type` 评估后不接入（#479）。
- **不新开 ADR**：共享包决策并入 ADR-0132 修订条目。

## 7. 免费账号与边界

- **收藏数客户端兜底**：搜索结果落地后按 `total_bookmarks` 字段本地过滤（Shaft 先例「客户端兜底让区间在非会员路径上也成立」）——会员/非会员/普通端点统一成立，热门路径除外（§3.4 置灰语义）。代价 = 免费账号下结果页稀疏（已知取舍 §9）。候选档七档常量与 UI 对 `is_premium` 无感知（不做会员检测）。
- **不可达路径声明**：`sort=popular_desc` 直发普通端点对非会员 400——应用内热门恒走 popular-preview，该路径不可达；`popular_male/female_desc` 不提供（novel 端不识别、会员限定）。
- **静默降级禁令**：筛选被服务端忽略的场景必须有 UI 表达（热门下收藏数置灰标注）；客户端兜底生效的场景无需提示。
- **空态/少结果态**：热门+筛选的少结果态、AI 仅看空结果——分页判空必须基于服务端原始返回（ADR-0155 教训：lynx 曾因全过滤白屏）；空态文案可渲染、可清除筛选重试。

## 8. 测试与验收（oracle 溯源）

1. **search-core 单测**（一处覆盖双端）：参数构建真值表（期望值 = 研究文档官方抓包值，禁止从实现反推）；期间预设→日期换算（日本时区边界）；URL 编解码 round-trip；缓存键构建；矩阵路由（scope/sort → 端点与参数子集）。
2. **webview**：searchStore 单测（筛选状态/URL 回填/缓存键/inFlight 判重）；SearchFilterSheet 组件测试（即改即搜 debounce、置灰、徽标、清除全部）。
3. **lynx**：useSearch 单测扩展（filters ref 重搜语义）；SearchSheet 折叠区组件测试；**模拟器过折叠区点击可达性**（原生 pointer-events 怪癖：全屏 pointer-events-none 容器吞点击的历史坑）+ 80vh 内滚动布局。
4. **契约/差分**：URL 编解码与参数构建 round-trip 差分；transport 层 next_url 断言保持既有差分测试。
5. **E2E**：agent-browser 搜索筛选主流程（设筛选 → URL 回填 → 刷新/返回保持）；S 端切换回归。

## 9. 已知取舍与未来候选

- 隐藏 AI 为客户端过滤 → 免费账号收藏数 fallback 同理：**结果页稀疏**（一页 30 条可能只剩几条可看）——#479 拍板接受。
- 热门榜不分页是官方端点性质：热门+筛选天然少结果。
- 七档收藏数带宽硬编码：官方档位若变需手动更新（动态 `/v1/search/options` 拉取列为增强）。
- 未来候选（按价值排序）：小说正文长度三单位（官方免费四档）> `content_type` 作品类别 > `tool`/`lang` > 动态档位拉取 > `search_ai_type` 服务端化翻案（入口 = 研究文档 + #479 resolution）。

## 10. 交付边界

本 spec 终审通过 = wayfinder 地图 #474 到达目的地；实现走地图外 to-spec→to-tickets→implement 流水线（建议 effort 分支首个 commit 即本 spec + ADR 两处动作）。
