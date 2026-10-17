# Spec: 搜索目标准选化 + 查询语法提示（app-lynx 搜索弹层）

- 状态：implemented（2026-10-17 实施；门禁 check:all + lint:all + fmt:check + test:all 全绿，**app-lynx 4293 / 全仓 4921**——2026-10-17 实测口径；⚠️ 「全仓」= `pnpm test:all` 九个套件合计（app-lynx 主 4293 + fallback 3 + android-host 386 + novel-export 67 + ranking-core 37 + update-check 34 + search-core 54 + ugoira 27 + net-diagnostics 20），**单包数勿当回归基线**；本轮在原 4291 基础上新增 2 条（`targetDimmedHint` 提示行存在性、折叠面板 `watch` 回写防线））。模拟器 pictelio_low 真机验证：匹配方式三档切换 + 徽标计数 + 小说档置灰保值 + 语法提示行渲染。**留档**：2026-10-17 补上 `docs/verification/app-lynx-search-target-user-scope-emulator-2026-10-17.md`（5 项用户可见行为 + 11 张配套截图，截图 MD5 可当场复核）——此前此处声称做过模拟器验证却**无可复核留档**。
  ⚠️ **该留档自声明的边界，本 spec 一并遵守**：设备上**只能**证明「用户档把排序段与筛选区从 UI 上撤掉了」，
  **不能**证明「端点忽略 `sort`」（UI 压根没发这个参数，两件事在设备上不可区分）；它对 `search_target` /
  `merge_plain_keyword_results` 的**端点行为一个字都没验**。端点级结论一律指向
  `docs/research/verify-search-user-api.sh`（用户端 sort 与 search_target 硬拒）与
  `docs/research/verify-illust-target-equivalence.sh`（插画端 target/merge 等价性），**不指向该设备留档**。
  2026-10-17 证据订正：§4 表「小说端不识别 `title_and_caption`」由**未实测**升级为**实测被拒（HTTP 400）**，
  §10 同条随之作废重写，§7.1 补置灰的后果强度；§1 改前代码锚与 §3.1 死类型锚去掉行号（行号锚必然漂移））
- 日期：2026-10-17
- 关联：`docs/specs/search-user-scope.md`（同族：用户搜索第四档，2026-10-16 已实施）/ ADR-0132 / `docs/research/verify-query-syntax.sh`（查询语法实测）/ memory `notes/pixiv-query-syntax-verified-2026-10.md`
- 工单：#1025 search-core 档位类型与两端不对称参数映射（并删除 `word.includes(" ")` 派生）· #1026 缓存键纳入档位 + 清理同名死类型 · #1027 匹配方式选择器 + 查询语法提示行 · #1028 术语层/研究层落档（均已 CLOSED）

## 1. 背景

两件事，都是 2026-10-16 调研 + 实测留下的缺口。

**① 查询语法已验证可用，但用户不知道。** `docs/research/verify-query-syntax.sh` 实测确认
`/v1/search/{illust,novel}` 由**服务端**解析 `AND`（空格）/ `OR` / 负号排除 / 括号嵌套，
四个 `search_target` 档位全部成立。本仓把用户原始 `word` 直接透传 ⇒ **这四种语法今天就能用**，
只是界面零提示。缺口是**可发现性**，不是能力。

**② 搜索目标是程序替用户猜的。** `buildParams.ts` 的 `illustTargetParam`（**本票已删除**，
此处保留改前形态作对照）：

```ts
function illustTargetParam(word: string): string | null {
  return word.includes(" ") ? "exact_match_for_tags" : null;
}
```

单词词不传、多词强制 exact。后果：含空格的查询丢失关键字/标题命中
（机理推断自 Shaft #906「显式传 `search_target` 时服务端忽略 `merge_plain_keyword_results`」——
⚠️ 该机理**未经一手实测证实**，见 §4.1 方法论与 §4 的理由改写）。
用户没有任何选择权。

## 2. 非目标

- **不接 `keyword` 档**（标签+标题+说明）：仅 PixivBiu / Mako 两个第三方在用，官方 UI 不暴露，
  属超官方行为。留作后续单票。
- **不做查询语法 UI 构造器**（点按钮拼 `OR`）：服务端已解析，客户端拼串只会重复语义且易漂移。
  本票只给**提示文案**。
- **不做小说端 `text`（正文搜索）**：pixiv 已于 2021-09 停止该服务（ITmedia / J-CAST）。
- **不动 `packages/search-core/src/urlCodec.ts`**：它零生产消费方（webview 客户端随 ADR-0203
  删除后遗留的死代码），本票不扩大死代码面，也不在此清理。
- 用户搜索（`docs/specs/search-user-scope.md`）不在本票范围。

## 3. 领域模型

### 3.1 档位类型（search-core 侧，用户可选的形态）

```ts
// packages/search-core/src/filters.ts
/** 搜索目标档位（用户可选）。注意与 Pixiv API 的 search_target **原始值**不是一回事：
 *  partial 在两端映射到不同的「是否显式发送」——见 §4 表。 */
export type SearchTargetMode = "partial" | "exact" | "title_and_caption";
```

**并删除** `packages/app-lynx/src/api/types.ts` 的死类型
`SearchTarget = "partial_match_for_tags" | "exact_match_for_tags" | "title_and_caption"`
——零引用（本次实测 grep 确认），且与 `SearchTargetMode` 同名易混。

### 3.2 SearchFilters 新增字段

```ts
export interface SearchFilters {
  // …既有五项…
  /** 搜索目标档位；默认 partial（= 维持现状，见 §5 行为变更） */
  target: SearchTargetMode;
}
```

`DEFAULT_SEARCH_FILTERS` 加 `target: "partial"`。

## 4. 档位 → 请求参数映射（本票的核心，**两端不对称**）

| 档位 | 插画端 `/v1/search/illust` | 小说端 `/v1/search/novel` |
|---|---|---|
| `partial` | **`null`（整个参数不传）** | `"partial_match_for_tags"`（**显式发**） |
| `exact` | `"exact_match_for_tags"` | `"exact_match_for_tags"` |
| `title_and_caption` | `"title_and_caption"` | **实测被拒（HTTP 400）** → UI 置灰，值保留不发 |

**小说端 `title_and_caption` 是「实测被拒」，不是「未被识别」**（2026-10-17 一手实测升级；本表
初稿写「该端点不识别」、§10 初稿写「未实测（UI 置灰规避）」，两者都**低估**了后果）：

| 请求（`/v1/search/novel`，`word=東方`） | HTTP | 条数 |
|---|---|---|
| 省略 `search_target` | 200 | 30 |
| `search_target=title_and_caption` | **400** | 0 |
| `search_target=partial_match_for_tags` | 200 | 30 |
| 未知参数名 `foo=bar`（对照） | 200 | 30 |

**交错 2 轮结论一致**（2026-10-17）。对照组是关键：未知参数名 200 且结果不变 ⇒ 不是「服务端不认识
这个参数名所以忽略」，而是**明确拒绝该取值**——性质与用户端对 `search_target` 的硬拒一致（§7.1）。

⚠️ **后果强度（这条决定了 UI 置灰不能被当成可随手放宽的细节）**：置灰保值挡的不是「结果不准」
这类体验问题，而是「**每一次小说搜索直接 400 失败**」。只要 UI 的置灰逻辑哪天回归、小说端开始
真发这个参数，scope=novel 的搜索就会**整片报错**，而不是退化成多几条结果。
⇒ 放宽它需要一次显式决策，不能当作 UI 细节顺手改掉。

**取证可复跑性**（2026-10-17 补齐；**本段是本 spec 该组数字的单一事实源**——§10 只登记证据强度、不重复脚本口径，
两处各写一份必然漂移）：上表的 HTTP 码与条数由 `docs/research/verify-novel-title-target.sh` 产出
（交错 2 轮，逐格打印 HTTP 码 / 条数 / ids md5）。
⚠️ 该脚本与本文档**同 commit 入库**（`docs/research/verify-novel-title-target.sh`）⇒ 路径即出处；若日后它被移动或删除，这组数字就只剩本段留档，届时须回填。
已入库的同源脚本 `docs/research/verify-query-syntax.sh` 跑 `/v1/search/novel title_and_caption` 时，
对被拒响应只打印 `ERR: …`、**不打印 HTTP 码与条数**，只能复核「被拒」这一层。

**partial 在插画端取「不传」**——**映射不变，但理由已按 2026-10-17 一手实测重写**：

- 旧表述「显式传 partial 会转成严格标签匹配**并忽略** `merge_plain_keyword_results`」
  （Shaft #906）**本次一手实测未复现**。四组组合（omit / 显式 partial /
  `merge_plain_keyword_results=true` / 两者并用）在 3 检索词 × 2 轮**交错**采样下
  **ID 序列 md5 完全相同**；决定性一条是多词 `Rosmontis rosemary` 在 omit 与显式
  partial 下**同为 4 条**，而 `exact` 是 1 条——若显式 partial 真会触发严格标签匹配，
  此处应退回 1 条。
- 故「显式发会坏行为」**未经证实**（Shaft #906 是第三方源码推断，非本仓一手实测）。
  本表取「不传」是**保守选择**：不依赖未经证实的差异，且与改动前单词词路径逐字一致
  ⇒ §5 的行为变更只剩「多词不再强制 exact」一条。

**partial 在小说端必须继续显式发**：不传会退化成纯字面 keyword 匹配、同义词/译名不展开（#1038）。

⇒ 两侧都**移除** `word.includes(" ")` 派生，改读 `filters.target`。

### 4.1 ⚠️ 方法论：结果集随时间漂移，A/B 比对必须**交错采样**

插画端结果集**随时间漂移**：同一查询连续采样，ID 序列 md5 会变（实测首位 ID 从 150944641
漂到 150944731，秒级内稳定）。⇒ **任何「A/B 序列相同 / 不同」的断言都必须交错采样**
（A、B、A、B…）。顺序采样（A 全跑完再跑 B）会把时间漂移误读成参数差异，产生
**方向完全相反的假差异**——实测 agent 第一轮就中招。

「显式 partial 有害」这个错误结论能活下来，正是靠顺序采样造出的那批假差异。

**判断口径**：交错采样下 ID 序列 md5 **相同** ⇒ 该参数组合在本轮**无可观测效果**
（不是「保证无影响」，只是本次未观测到差异）；md5 不同才进因果讨论。

## 5. 行为变更（测试硬约束 #4：默认值改动须标注）

| 场景 | 改前 | 改后 |
|---|---|---|
| 单词词 + partial（默认） | 不传 search_target | **不变**（仍不传） |
| **多词 + partial（默认）** | 强制 `exact_match_for_tags` | **改为不传** ⇒ 服务端并入关键字/标题命中 |
| 小说端 partial | 显式发 | **不变** |

多词从 exact 切到 partial 是**有意的行为变更**：partial 档下 `A B` 仍是 AND（空格语义不变），
但结果**变多**（实测 `Rosmontis rosemary`：exact 1 条 / partial 4 条），且并入关键字命中。
方向与 §1② 要修的「多词丢关键字命中」一致。

**这不是新默认值，但确实是既有查询结果集的变化**，须在发布说明与 commit message 标注。

## 6. 缓存键（**前瞻性接线**——当前无生产消费方）

档位落键规则（`cacheKey.ts`，已实现且有单测）：

- `partial`（默认）**不落键**（与默认键逐字相同）
- 非默认落 `ft=exact` / `ft=title_and_caption`，**追加在末尾**——存量非默认筛选的键逐字不变，升级不撞旧缓存

**可达性现状（2026-10-17 grep 实测）**：本节四条落点里只有一条是活的。

| 落点 | 生产消费方 | 状态 |
|---|---|---|
| `buildCacheKey` | **零**——webview 消费方随 ADR-0203 删除；ADR-0132 决策 3 与 `useSearch.ts` 均写明「搜索结果全局 LRU 缓存不做」 | 死代码，口径同 §2 的 `urlCodec.ts` |
| `isDefaultFilters` | **仅** `cacheKey.ts` 内部 | 随缓存键一并不可达 |
| `countActiveFilters` | `SearchSheet.vue` 的 `activeFilterCount` | **活的**（非默认档点亮筛选入口徽标） |
| `normalizeFilters` | **仅**死代码 `urlCodec.ts` | 随 §2 的 URL 编解码一并不可达 |

⇒ **今天不存在会被弄脏的缓存**，本条不是「正确性硬要求」而是**前瞻性接线**：缓存日后重建时
按此规则接线即自动正确，search-core 侧无需回头改。

历史留痕（**不改判、只补前提**）：「防脏缓存是正确性硬要求」这条判断出自 spec
`search-advanced-filters.md` §6.2 缓存键——当轮成立是因为 webview 侧有 `inFlightSearchKey`
消费方，该消费方已随 ADR-0203 删除。✅ `cacheKey.ts` 头注释已于 2026-10-17 随本节改写：
不再宣称「正确性硬要求」，并把裸锚点 `§6.2` 补全为 `search-advanced-filters.md §6.2`
（裸 `§6.2` 易被读成本 spec 的 §6.2，而那里讲的是别的事）。

## 7. UI（`SearchSheet.vue`）

### 7.1 匹配方式行（票 B）

置于**筛选折叠区第一行**（与 Pixiv 官方「検索オプション」同一容器）：

- 标题 `匹配方式`（i18n key）
- 三枚 chips：标签部分一致 / 标签完全一致 / 标题·说明
- **scope=novel 时第三枚置灰**，点它无效，**值保留**——完全沿用既有 `illustDimmed`
  的比例/分辨率置灰模式（`docs/specs/search-advanced-filters.md` §3.2 维度适用矩阵）
- **scope=novel 时 chips 下方给一行置灰原因提示**（i18n key `searchSheet.targetDimmedHint`，
  门控复用同一 `illustDimmed`）——与比例/分辨率的 `ratioDimmedHint` 同款形态：
  只解释「为什么灰、值会不会丢」，**不**阻止已在其他档的值保留
- ⚠️ **置灰的理由不是「结果不够准」，是「发了就 400」**：小说端对 `search_target=title_and_caption`
  是**实测硬拒**（§4 表，交错 2 轮一致）——置灰挡的是「每一次小说搜索直接 400 失败」。
  这条与比例/分辨率的置灰**性质不同**：那两个置灰只是「该维度在此端点无意义」，放开只影响结果集；
  本条放开则会让 scope=novel 的搜索整片报错。故它不可被当作可随手放宽的 UI 细节。
- scope=user 时整个折叠区已隐藏，无需额外处理。该端点对 `search_target` 做**枚举校验**：
  ⚠️ **发了任何取值都 400**（空串 / `partial_match_for_tags` / `zzz` 一律拒绝），
  而不相关的未知参数名（`foo=bar`）才 200 且结果不变 ⇒「不消费」是危险的措辞，
  正确口径是**必须不发**（请求侧：`/v1/search/user` 的构建函数压根不接受该参数）

### 7.2 查询语法提示行（票 A）

置于**输入框正下方**，仅 `keyword.trim()` 非空时显示（idle 态不占位）：

- 文案 `空格=与 · -排除 · OR=或 · ( )`
- 样式走既有 `text-label-small text-outline`
- 验收：仅提示，**不做语法校验、不拦截输入**

**文案纪律**：不得承诺「大小写无关」——实测 `exact_match_for_tags` 档大小写敏感
（`RoSeMaRy` 返回 0 条），而本票默认档是 partial（大小写无关）。两者并存时措辞须避免绝对化。

## 8. 测试与验收（oracle 溯源）

> ⚠️ **锚点约定**：外部（代码注释 / 测试名 / 其他 spec）**只引小节号**，禁引行号——本仓并行
> 改文档频率高，行号锚必然漂移且漂移无声（第一轮的 `§8.5` 甚至因不存在子标题而不可解析）。
> §8 的验收项因此写成 `### 8.x` 真小节，供外部锚定。

### 8.1 search-core 参数映射真值表

三档 × 两端 = 6 个组合，端点 + 完整参数集合断言。
oracle = §4 表 + `verify-query-syntax.sh` 实测。

**必须有一条反证断言**：插画端 partial 档**不含** `search_target` 键。

### 8.2 缓存键

`target=partial` 与默认键逐字相同；`exact`/`title` 各带 `ft=` 段。

### 8.3 三个派生谓词

`isDefaultFilters` / `countActiveFilters` / `normalizeFilters` 三项定向用例。

### 8.4 爆炸半径

`SearchFilters` 加必填字段 ⇒ 所有构造字面量的测试需补 `target`，
以 tsc 红为准逐个补齐（**不得**改成可选字段绕过）。

### 8.5 控制器

（`useSearch.test.ts`，验收行为见 §7.1）

- **三档切换各自重搜**：`setFilters`（`useSearch.ts`）走 `FILTER_DEBOUNCE_MS` 防抖后
  `executeSearch(keyword)`，故断言点是「切档后发出**新一批**请求」而非同步立即重搜。
- **小说端 title 置灰时值保留且请求不携带**：档位值不被回写为 `partial`（留在
  `filters.target`），而请求侧由 `NOVEL_TARGET_PARAMS.title_and_caption = null` 不发
  `search_target`（`buildParams.ts`）。两条都要断言——只断一条会让另一半回归无人发现。

### 8.6 源级断言

（`SearchSheet.test.ts`，沿用本仓既有形态）：匹配方式行存在、语法提示行存在且绑定
`keyword.trim()`、第三枚 chip 的置灰门控、**scope=novel 的置灰原因提示行**
（`searchSheet.targetDimmedHint` 接进模板 + 复用同一 `illustDimmed` 门控）（§7.1）。

### 8.7 门禁

`check:all` + `lint:all` + `fmt:check` + `test:all` 全绿。

## 9. 已知取舍与后续候选

- **`keyword` 档未接**：超官方行为，留单票。
- **`urlCodec.ts` 死代码未清**：不在本票范围，建议另开技术债票。
- **提示文案只有一行**：不覆盖 `Xusers入り` 桶标签、尺寸指定（`小/中/大`）、工具指定等
  官方搜索框语法（后三者在 app-api 未实测）。
- 后续候选：搜索联想 `/v2/search/autocomplete`、`content_type` 作品类别、
  小说端空结果降级重发、趋势标签。

## 10. 证据强度

- 查询语法服务端解析：`docs/research/verify-query-syntax.sh` **一手实测**（四档 × 双端点）
- partial 在插画端取「不传」：**一手反向实测（2026-10-17）显示显式发与不传无可观测差异**
  （交错采样下 ID 序列 md5 相同）⇒ 映射本身是**保守选择**而非必需；原依据 Shaft #906 为
  第三方源码推断，**本次未复现**（理由链与样本见 §4，方法论见 §4.1）
- partial 在小说端必须显式发：#1038 / 第三方源码 + 本仓既有 `buildParams.ts` 注释。
  ⚠️ 「不传退化为纯字面匹配、同义词不展开」这一**机制未经证实**——实测差异幅度小
  （東方 2/30 互换、初音ミク 6/30、冴えない彼女 0/30），量级远小于该主张暗示。
  **映射方向可信，理由未证实**：凡依赖此理由的表述须带置信度标注
- `merge_plain_keyword_results`：**一手实测三端均无可观测效果**（illust / novel / user
  传 true / false / 不传，结果都不变）；illust 端对非法值 `zzz` **400**（校验枚举），
  novel 与 user 端对 `zzz` **静默接受**。⇒ 把它当「可用且有效果」强于证据；
  本仓行为（照发，无害 + 对齐第三方）**不变**，仅置信度下调
- `title_and_caption` 在小说端：**一手实测被拒（2026-10-17，交错 2 轮一致）**——省略 → 200/30 条，
  显式发 → **HTTP 400 / 0 条**；`partial_match_for_tags` 与未知参数名 `foo=bar` 均 200/30 条作对照
  （对照说明是服务端**拒绝该取值**，不是不认参数名）。~~第三方枚举（Mako `SearchNovelTagMatchOption`
  只有 partial/exact/text/keyword）+ 官方帮助中心未列该档；**未实测**（UI 置灰规避）~~ 该条**已作废**：
  它描述的是「未被识别」这一较弱的可能，实测结果比它严重一档。第三方枚举一项仍作为旁证保留。
  ⚠️ 400/0 这两个数字的**取证脚本与判读边界见 §4「取证可复跑性」**——本节只登记证据强度，脚本口径
  以 §4 为单一事实源，此处不重复（同一组数字两处各写一份必然漂移）
