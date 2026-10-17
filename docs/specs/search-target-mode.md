# Spec: 搜索目标准选化 + 查询语法提示（app-lynx 搜索弹层）

- 状态：implemented（2026-10-17 实施；门禁 check:all + lint:all + fmt:check + test:all 全绿，4290 tests；模拟器 pictelio_low 真机验证：匹配方式三档切换 + 徽标计数 + 小说档置灰保值 + 语法提示行渲染）
- 日期：2026-10-17
- 关联：`docs/specs/search-user-scope.md`（同族：用户搜索第四档，2026-10-16 已实施）/ ADR-0132 / `docs/research/verify-query-syntax.sh`（查询语法实测）/ memory `notes/pixiv-query-syntax-verified-2026-10.md`
- 工单：待建（见 §9）

## 1. 背景

两件事，都是 2026-10-16 调研 + 实测留下的缺口。

**① 查询语法已验证可用，但用户不知道。** `docs/research/verify-query-syntax.sh` 实测确认
`/v1/search/{illust,novel}` 由**服务端**解析 `AND`（空格）/ `OR` / 负号排除 / 括号嵌套，
四个 `search_target` 档位全部成立。本仓把用户原始 `word` 直接透传 ⇒ **这四种语法今天就能用**，
只是界面零提示。缺口是**可发现性**，不是能力。

**② 搜索目标是程序替用户猜的。** `buildParams.ts:61` 现状：

```ts
function illustTargetParam(word: string): string | null {
  return word.includes(" ") ? "exact_match_for_tags" : null;
}
```

单词词不传、多词强制 exact。后果：含空格的查询丢失关键字/标题命中
（显式传 `search_target` 时服务端忽略 `merge_plain_keyword_results`，Shaft #906）。
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

**并删除** `packages/app-lynx/src/api/types.ts:374` 的死类型
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
| `title_and_caption` | `"title_and_caption"` | **该端点不识别** → UI 置灰，值保留不发 |

**partial 在插画端必须继续「不传」**，不能改成显式发：显式 `partial_match_for_tags`
会让 pixiv 转成严格标签匹配**并忽略** `merge_plain_keyword_results`（Shaft #906 实测），
那等于把今天单词词路径的行为改坏。

**partial 在小说端必须继续显式发**：不传会退化成纯字面 keyword 匹配、同义词/译名不展开（#1038）。

⇒ 两侧都**移除** `word.includes(" ")` 派生，改读 `filters.target`。

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

## 6. 缓存键（正确性硬要求）

`buildCacheKey` 必须含档位，否则切换档位命中脏缓存（spec search-user-scope §6.2 先例）：

- `partial`（默认）**不落键**
- 非默认落 `ft=exact` / `ft=title_and_caption`

`isDefaultFilters` 同步纳入 `target === "partial"`。
`countActiveFilters`：非默认档计 1（筛选入口徽标随之亮）。

`normalizeFilters`：逐字段校验，非法值回 `partial`（与既有一致回默认的纪律）。

## 7. UI（`SearchSheet.vue`）

### 7.1 匹配方式行（票 B）

置于**筛选折叠区第一行**（与 Pixiv 官方「検索オプション」同一容器）：

- 标题 `匹配方式`（i18n key）
- 三枚 chips：标签部分一致 / 标签完全一致 / 标题·说明
- **scope=novel 时第三枚置灰**，点它无效，**值保留**——完全沿用既有 `illustDimmed`
  的比例/分辨率置灰模式（spec search-advanced-filters §3.2 维度适用矩阵）
- scope=user 时整个折叠区已隐藏，无需额外处理（用户端点不消费 search_target）

### 7.2 查询语法提示行（票 A）

置于**输入框正下方**，仅 `keyword.trim()` 非空时显示（idle 态不占位）：

- 文案 `空格=与 · -排除 · OR=或 · ( )`
- 样式走既有 `text-label-small text-outline`
- 验收：仅提示，**不做语法校验、不拦截输入**

**文案纪律**：不得承诺「大小写无关」——实测 `exact_match_for_tags` 档大小写敏感
（`RoSeMaRy` 返回 0 条），而本票默认档是 partial（大小写无关）。两者并存时措辞须避免绝对化。

## 8. 测试与验收（oracle 溯源）

1. **search-core 参数映射真值表**：三档 × 两端 = 6 个组合，端点 + 完整参数集合断言。
   oracle = §4 表 + Shaft #906 / #1038 + `verify-query-syntax.sh` 实测。
   **必须有一条反证断言**：插画端 partial 档**不含** `search_target` 键。
2. **缓存键**：`target=partial` 与默认键逐字相同；`exact`/`title` 各带 `ft=` 段。
3. **`isDefaultFilters` / `countActiveFilters` / `normalizeFilters`** 三项定向用例。
4. **爆炸半径**：`SearchFilters` 加必填字段 ⇒ 所有构造字面量的测试需补 `target`，
   以 tsc 红为准逐个补齐（**不得**改成可选字段绕过）。
5. **控制器**：三档切换各自重搜；小说端 title 置灰时值保留且请求不携带。
6. **源级断言**（`SearchSheet.test.ts`，沿用本仓既有形态）：匹配方式行存在、
   语法提示行存在且绑定 `keyword.trim()`、第三枚 chip 的置灰门控。
7. **门禁**：`check:all` + `lint:all` + `test:all` 全绿。

## 9. 已知取舍与后续候选

- **`keyword` 档未接**：超官方行为，留单票。
- **`urlCodec.ts` 死代码未清**：不在本票范围，建议另开技术债票。
- **提示文案只有一行**：不覆盖 `Xusers入り` 桶标签、尺寸指定（`小/中/大`）、工具指定等
  官方搜索框语法（后三者在 app-api 未实测）。
- 后续候选：搜索联想 `/v2/search/autocomplete`、`content_type` 作品类别、
  小说端空结果降级重发、趋势标签。

## 10. 证据强度

- 查询语法服务端解析：`docs/research/verify-query-syntax.sh` **一手实测**（四档 × 双端点）
- partial 必须不传 / 小说端必须显式发：Shaft #906 / #1038 第三方源码 + 本仓既有
  `buildParams.ts` 注释（**未做「改成显式发会怎样」的反向实测**，沿用既有结论）
- `title_and_caption` 在小说端不识别：第三方枚举（Mako `SearchNovelTagMatchOption`
  只有 partial/exact/text/keyword）+ 官方帮助中心未列该档；**未实测**（UI 置灰规避）
