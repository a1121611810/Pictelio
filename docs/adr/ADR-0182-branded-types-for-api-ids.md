# ADR-0182: Branded Types for API IDs —— 编译期身份隔离

- 状态: Accepted（2026-09-21）
- 日期: 2026-09-21
- 关联: spec [`docs/specs/branded-types-for-api-ids.md`](../specs/branded-types-for-api-ids.md)（[issue #700](https://github.com/a1121611810/Pictelio/issues/700)）；实施票 [#701](https://github.com/a1121611810/Pictelio/issues/701)（T1 foundation seam）/ [#702](https://github.com/a1121611810/Pictelio/issues/702)（T2 response field 改造）/ [#703](https://github.com/a1121611810/Pictelio/issues/703)（T3 app API signatures + caller fallout）/ [#704](https://github.com/a1121611810/Pictelio/issues/704)（T4 app-lynx API signatures + caller fallout）/ [#705](https://github.com/a1121611810/Pictelio/issues/705)（T5 docs，本 ADR + glossary）；研究 [`docs/research/typescript-strict-hidden-traps-analysis.md`](../research/typescript-strict-hidden-traps-analysis.md) §"第一道门"；分析源 = 李帕吉 / 前端小石匠 2026-09-21 公众号《开了 strict 照样翻车：TypeScript 没告诉你的三道隐形暗门》第一道门 <https://mp.weixin.qq.com/s/1sYdhpyW1SHxgGFPd9PIAA>
- 修订: T2 acceptance criteria 修订——response 类型升级触发的 caller fallout（auth.ts / novel.ts / pkceAuth.ts + 9 test fixtures）实际范围比 spec 预期更广，记录于 commit `a13e2c48` 描述。
- 延续: `tsconfig.json` `strict + noUnusedLocals + noUnusedParameters + noFallthroughCasesInSwitch`（项目既有，未变更）；[ADR-0181](ADR-0181-assertnever-exhaustive-checking.md) P1 assertNever（穷尽性防御）；本 ADR 是 P1 挂账的兑现（ADR-0181 后果节明确 "P2 独立 ADR: Branded Types for API IDs"）

## 背景

TypeScript 结构化类型系统（Structural Typing）只认"形状"不认"身份"——`type UserId = number` 和 `type OrderId = number` 在 TS 眼里等价，所有 `number` 互相同形可互转。Pixiv 的 ID 空间是共享整数集（`illust_id` / `novel_id` / `user_id` 数值范围可能撞车），Pictelio API 层之前的所有领域 ID 全部声明为 `number`：

```
loadDetail(illustId: number)              // 接受任何 number
loadDetail(novelId: number)              // 接受任何 number
fetchNovelData(novelId: number)           // 接受任何 number
```

跨类型 ID 误传（`fetchNovelData(illust.id)`）编译期零拦截，最终发的是 `/v2/novel/detail?novel_id=<illust-id>`，要么返回别作品要么空响应——运行时静默错误。

这正是李帕吉文章退款事故的等价形态（`refund(orderId, customerId)` 参数顺序调换）。Pictelio 当前规模（5 个领域 ID × 7+ API 文件 × 50+ 调用现场）虽未发现事故，但**接口公开暴露同形 ID 即潜在漏配**——随业务演化迟早会出现误传。

## 决策

**D1 · 类型实现**：`unique symbol` + `number & { readonly [Brand]: typeof Brand }` 交叉类型模式，5 个核心领域 ID 各一：

- `IllustId` / `NovelId` / `UserId` / `SeriesId` / `ChapterId`
- 每个 unique symbol 编译期全局唯一（结构同形但 identity 不同）
- 运行时：symbol 被擦除，所有 Branded 类型仍是 `number`——零运行时代价、bundle 零增长

**D2 · 工厂函数边界**：5 个工厂函数 `toIllustId / toNovelId / toUserId / toSeriesId / toChapterId`，签名 `(raw: number): XxxId`，body 仅 `return raw as XxxId`（运行时透传，类型层 cast）。**边界转换点**：
- HTTP / DB 反序列化：response 类型已声明 Branded（response.id 自动给 Branded），调用方零改造
- API 函数签名（`illust.ts` / `novel.ts` / `user.ts` / `comment.ts` / `ranking.ts` / `search.ts` / `translate.ts`）：仅接受 Branded，raw number 立即 TS2345 拒绝
- 非 response 源（URL `parseInt` / localStorage / native bridge input）：经工厂函数显式转换
- 内部 store cache key：保留 raw `number`（cache 标识符语义，非 API 参数）；转换发生在 API 调用边界

**D3 · 跨端策略**：**双端 byte-identical 复制**——`packages/app/src/api/id.ts` 与 `packages/app-lynx/src/api/id.ts` 内容逐字一致（含 trailing newline）；沿 ADR-0181 assertNever 决策；项目「双端差分对齐」惯例（5 份 `AiFilterMode` / 2 份 `DownloadStatus` / 2 份 `assertNever.ts` / 2 份 `id.ts` 独立维护）。

**D4 · API 函数签名收紧**：所有 `illustId / novelId / userId / seriesId / chapterId` 参数从 `number` 改为对应 Branded 类型。**不兼容期**：直接拒绝 raw number，无 `number | Branded` 兼容形态——防御价值核心是"编译期拒绝 raw number"，兼容期等于把防御砍半。

**D5 · 落点克制**：仅打标 5 类核心领域 ID（IllustId / NovelId / UserId / SeriesId / ChapterId）；**不打标**：
- `CommentId`（P3 候选——评论 fetch 路径尚未广泛演化）
- `TagId`（标签是 i18n 字符串而非数值 ID）
- `BookmarkId`（复合字符串主键 `${userId}_${type}_${id}` 已天然隔离，sp ec/loadBookmarks.ts 内部约定）
- 临时计数器、UI 内部 key、`offset / limit / 进度数字`

**D6 · 既有 seam 复用**：`tsc --noEmit` CI 必跑（`.github/workflows/ci.yml`），不引入新 lint 规则 / 插件 / 共享包。

**D7 · CommentTargetId 联合（实施时引入，spec 未明确）**：`api/comment.ts` 的 `targetId` 参数接受 `IllustId | NovelId` 联合类型——评论可对插画或小说二选一，是 Pixiv API 的设计而非 Branded 副作用。Worker T4 引入此联合类型以保持语义清晰。

## 否决的替代方案

- **class 模式封装**（`class IllustId { constructor(private v: number) {} }`）：完整封装、运行时类型守卫；缺点是运行时开销、box/unbox 性能损耗、与项目 `type + 函数` 风格不一致、store 内部 cache key 无法直接字符串化。否决。
- **数字字面量 intersection**（`type IllustId = number & { __illust: true }`）：更轻量；缺点是 `{ __illust: true }` 可能被其他类型意外满足（如 `{ __novel: true }` 在某些名义上是另一个 Branded 类型），类型区分度差；唯一性弱于 `unique symbol`。否决。
- **跨包 import app 端 `src/api/id.ts`**：与项目「双端差分对齐」惯例冲突；引入新跨包 seam（同 ADR-0181 拒绝跨包依赖理由）。否决。
- **推到 `@pictelio/ids` 共享包**：本规格 `Out of Scope` 明确否决——过度工程；P3 候选（如需多包共享再独立 ADR 评估）。
- **`number | Branded` 兼容期**（签名 `illustId: number | IllustId`）：渐进迁移；缺点是防御价值打折扣（编译仍接受 raw number）。spec §Q5 明确拒绝——防御收紧是核心目标。
- **打标所有 ID**（含 `CommentId` / `TagId` / `BookmarkId`）：覆盖广；缺点是工厂函数膨胀、symbol 声明膨胀、未演化的面过早防御。spec §Q3 明确拒绝。
- **API 层不改签名，只在 store 内部转换**：内部防御；缺点是 API 边界仍接受 raw number，调用方仍可误传——核心防御场景（"用户输入 → API 直传"）失效。否决。
- **Symbol 注册表 / `Symbol.for('IllustId')`**：与「编译期唯一」目标冲突；symbol 注册表是跨 realm 共享语义，本规格不需要。否决。
- **ID 值域验证**（`assert(raw > 0)` 在工厂函数）：运行时检查 Pixiv ID 范围；本规格 `Out of Scope` 明确——`assertNever` P1 决策类比：值域验证属于另一议题；P3 候选。
- **删 `unique symbol`，改用字符串字面量区分**（`type IllustId = number & { __illust: 'IllustId' }`）：字符串字面量比 `unique symbol` 重；type-level 唯一性弱（`'IllustId' === 'IllustId'` 跨类型共享）；保留 `unique symbol`。否决。

## 后果

- **正面**：API 函数签名拒绝跨类型 ID 误传——`loadDetail(novelId)` 接 `illustId` 立即 TS2345；`loadBookmarks(illustId)` 接 `userId` 立即 TS2345；response 字段自动给 Branded，调用方零改造；运行期零代价（symbol 擦除）；既有 1944+ 测试保持全绿；type-level 防御与运行期防御双层就位。
- **负面 / 风险**：
  - **caller fallout 比预期广**：T2 实际触发 9 个 test fixture 文件 + 3 个 auth/novel/pkceAuth 文件 + 14 个 T3 caller 文件 + 12 个 T4 caller 文件需更新（spec §acceptance 估计"应该是零"，实际更多——Branding 是真实 propagation，记录于各 commit message）。
  - **跨包类型不兼容**：`packages/novel-export` 仍有 raw `number` 的 `SeriesNavigation` 类型，与 app 端 Branded 类型不兼容。T2 用 `as unknown as` 在 `fetchNovelData` 返回处桥接（structural 兼容、运行时相同），待 novel-export 升级 Branded 后移除。
  - **`chapterId: string` 残留**：`translate.ts` 的 `TranslationRequest.chapterId` 是字符串（cache key 字符串化），与 `ChapterId = number & {brand}` 不兼容。T4 保留为 string；移除需重新设计 cache key 策略（P3 候选）。
  - **cache key 形态**：store 内部 cache key（如 `queryKeys.related(illustId)`）保留 raw `number`——cache 标识符而非 API 参数；该决策记录在 commit `ff09c427`。
- **机器防线**：
  - **tsc --noEmit 已 CI 必跑**：`packages/app/package.json:10` `"check": "vp check && tsc --noEmit -p tsconfig.json"`；`packages/app-lynx/package.json:11` `"check": "vue-tsc --noEmit -p src/tsconfig.json"`；CI `.github/workflows/ci.yml` 触发 `pnpm check:all`。
  - **type-contract 测试**：`packages/app/tests/unit/api/id.test.ts`（20 测试）含 5 个 `// @ts-expect-error` 钉死 "工厂函数拒绝任何非 number 入参" 的生产签名契约。
  - **smoke test 钉死**（人工 + PR 评审）：
    - T2 / T3 / T4 每个都跑了 2 个 smoke test：revert probe（签名改回 number 后 raw number 编译通过——证明 Branded 是 gate）+ cross-type probe（错传 ID 类型时 tsc 报 TS2345——证明防御生效）。临时编辑 + 验证 + 撤销后 commit。
- **跨 flavor / 跨包影响**：零。`src/api/id.ts` 是 utils 内部工具，不导出公共 API（除 5 类型 + 5 factory）；store / 组件 / 路由层通过 response 自动获得 Branded，无感知。
- **遗留挂账（显式，禁「后续处理」口头带过）**：
  - **P2.3**（按需触发）：少数 store 内部桥接点仍以 raw `number` 持有 ID（cache key + 临时变量），未来若演化需要 typed iteration 需独立票；当前 scope 内已最小化。
  - **P3 评估（2026-09-21，[#706](https://github.com/a1121611810/Pictelio/issues/706)）**——6 项候选逐项结论（grep 实证）：
    - 双端 `id.ts` byte-identical 同步守卫 → **已落地**：`tests/unit/differential/byteIdenticalSeamConsistency.test.ts`（含 assertNever seam；逐字节断言 + 空集防护 + 突变验证；随 `pnpm test:all` 进 CI 门禁）。
    - 工厂函数值域检查（`assert(raw > 0)`）→ **关闭**：`toUserId(0)` 是 3 处生产哨兵（`bookmarkStore.ts:18` / `novelBookmarkStore.ts:29,44`），值域断言会击穿哨兵；且为「零运行时代价」（D1）引入运行期检查，冲突。
    - `chapterId: string` 重新设计 → **关闭（按设计）**：string 是 provider IR / native bridge / cache key 的序列化边界形态（`String(chapterId)` 转换点，store 内部是 `number`）；非 ID 身份问题。
    - `TranslateErrorCode` 加 assertNever → **关闭（无适用点）**：详见 [ADR-0181](ADR-0181-assertnever-exhaustive-checking.md) 同项结论（无 switch over 该联合）。
    - `packages/novel-export` Branded 化（移除 cast）→ **保留候选（需独立设计决策）**：跨包品牌身份不互通（`unique symbol` 各包独立声明，novel-export 自建 brand 与 app/app-lynx 的 brand 不可赋值），cast 仍需存在于某处；共享 brand 需 novel-export 导出符号 → 破坏 D3 byte-identical 策略。当前 `as unknown as` 是显式边界（structural 兼容、运行时相同）。
    - `CommentId` / `TagId` 打标 → **保留候选（待业务驱动）**：ADR 明文「按业务演化决定」，当前无驱动不动。
- **排除面**：CommentId / TagId / BookmarkId（P3）；`number | Branded` 兼容期；跨包 import；新共享包 `@pictelio/ids`；class 模式；Symbol 注册表；值域验证。

## 实施记录

| 票 | 内容 | 交付 |
|---|---|---|
| [#701](https://github.com/a1121611810/Pictelio/issues/701) (T1) | id.ts seam（双端 byte-identical）+ 单测 | `daff6ad9`（+248 / 27+27+104 lines, 20 tests pass） |
| [#702](https://github.com/a1121611810/Pictelio/issues/702) (T2) | response field Branded 改造 + 9 个 test fixture + 3 个 caller fallout | `a13e2c48`（+67/-44, 15 files） |
| [#703](https://github.com/a1121611810/Pictelio/issues/703) (T3) | app 端 API 函数签名 Branded 化 + 14 个 caller fallout | `ff09c427`（+70/-51, 18 files, 1954 tests pass） |
| [#704](https://github.com/a1121611810/Pictelio/issues/704) (T4) | app-lynx 端 API 函数签名 Branded 化 + 12 个 caller fallout + CommentTargetId union | `fbd94ad2`（+113/-81, 20 files, 1944 tests pass） |
| [#705](https://github.com/a1121611810/Pictelio/issues/705) (T5，本 ADR + glossary) | 决策文档化 | 本 ADR + `glossary-branded-types.md`（同 PR） |

合并图（merge-base `9e7c6d63` → HEAD）：

```
*   a2ae9198 Merge branch 'feat/p2-t4-lynx-api-sigs' into feat/p2-branded-types
|\
| * fbd94ad2 feat(app-lynx): Branded Types on API sigs + caller fallout (#704)
* |   1c54948c Merge branch 'feat/p2-t3-app-api-sigs' into feat/p2-branded-types
|\ \
| * ff09c427 feat(app): Branded API function signatures + caller fallout (#703)
* | a13e2c48 feat(api): Branded Types on response field layer (#702)
* | daff6ad9 feat(api): add Branded Types seam for 5 core domain IDs (#701)
|/
* (main)
```

## 验证

- **格式 / lint / tsc**：`pnpm check:all` 全 9 包 pass。
- **单测**：`pnpm test:all` 全 8 包 pass；app 1954 tests / app-lynx 1944 tests；既有 downloadsViewModel/aiFilter/assertNever 测试保持全绿。
- **smoke test 钉死**（每个实施 commit 都跑了）：
  - **revert probe**：临时把 `illustId: IllustId` 改回 `illustId: number`，tsc 通过——证明 Branded 是 gate。
  - **cross-type probe**：临时调用 `loadDetail(toNovelId(123))`，tsc 报 `error TS2345: Argument of type 'NovelId' is not assignable to parameter of type 'IllustId'`——证明防御生效。
- **byte-identical 跨端**：`diff packages/app/src/api/id.ts packages/app-lynx/src/api/id.ts` 退出 0（含 trailing newline）。
- **test 硬约束对照**：
  - **#1 IO 边界**：工厂函数纯函数无 IO；既有 API 单测的 IO 测试已存在；新增 `id.test.ts` 5 工厂 × 4 形态覆盖。
  - **#2 真实样例**：5 个 ID 类型来自 `api/{illust,novel,user,comment}.ts` 函数签名；smoke test 用真实 number 值（如 `toNovelId(123)`）模拟调用。
  - **#3 禁止静默降级**：工厂函数 `return raw as XxxId` 是显式 cast；smoke test 钉住 cross-type 报错；无 `??` 默认值吞错。
  - **#6 oracle 溯源**：unique symbol + `number & { readonly [Brand]: typeof Brand }` 模式来自文章原文示例；5 个 ID 类型边界来自 `api/types.ts` 与 `api/illust.ts` 等函数签名。

## 与 P1 assertNever 的互补定位

| 工具 | 拦截目标 | 触发场景 |
|---|---|---|
| **`assertNever`**（ADR-0181） | 联合类型扩展时 switch 遗漏 | 新增枚举项 / 状态 |
| **Branded Types**（本 ADR） | 跨类型 ID 误传 | store / 路由参数 / URL path 解析 |

两者**正交**：P1 守"穷尽性"，P2 守"身份"。文章三道门中的前两道对应到 Pictelio 已有的两个真实风险面（spec / ADR-0181 / ADR-0182 分别落地）。第三道（`satisfies`）已在 en/ i18n 全量使用，无需新增。