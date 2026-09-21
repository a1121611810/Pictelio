# Branded Types for API IDs —— 功能规格

> 来源：grill-with-docs 会话（Q1–Q8 逐项拍板，2026-09-21）；ADR-0182（待 T5 文档票产出）
> 状态：ready-for-agent
> 前置：P1（[ADR-0181](ADR-0181-assertnever-exhaustive-checking.md) `assertNever` 防御）已合并 main；本规格是同一文章（《开了 strict 照样翻车：TypeScript 没告诉你的三道隐形暗门》李帕吉 2026-09-21）的**第一道门**落地
> 前置分析：`docs/research/typescript-strict-hidden-traps-analysis.md` §"第一道门"

## Problem Statement

TypeScript 采用结构化类型系统（Structural Typing）：两个类型只要"形状"相同就被视为同一类型，**只认长相不认身份**。Pictelio API 层的所有领域 ID——`illustId` / `novelId` / `userId` / `seriesId` / `chapterId`——全部声明为 `number`：

- `api/types.ts`: `PixivIllust.id: number` / `PixivNovel.id: number` / `PixivUser.id: number`
- `api/illust.ts`: `loadDetail(illustId: number)` / `loadBookmarks(userId: number)` / `loadRelated(illustId: number)` / `loadUgoiraMetadata(illustId: number)`
- `api/novel.ts`: `loadDetail(novelId: number)` / `loadBookmarks(userId: number)` / `fetchNovelData(novelId: number)` / `loadText(novelId: number)`

Pixiv 的 ID 空间是共享整数集（`illust_id` / `novel_id` / `user_id` 数值范围可能撞车）。当前类型层**完全不区分**——`fetchNovelData(123)` 与 `fetchNovelData(456)` 在 TS 眼里等价；如果 `123` 实际是 `illustId`，编译期零拦截，最终发的是 `/v2/novel/detail?novel_id=123`，要么返回别作品要么空响应。

这正是李帕吉文章退款事故的等价形态（`refund(orderId, customerId)` 参数顺序调换）。Pictelio 现状是 API 层公开暴露同形 ID 给所有调用方；调用方从 store / 路由参数 / response 提取 ID 时极易传错类型，运行时静默错误。

## Solution

引入 TypeScript **名义类型 + 品牌（Branded Types / Phantom Types）**模式（参考李帕吉 2026-09-21 文章第一道门）：给核心领域 ID 加唯一身份标签，编译期拒绝跨类型 ID 误传。

### 核心数据结构

```
// 5 个 unique symbol（编译期绝对唯一；运行时擦除）
declare const IllustIdBrand: unique symbol;
declare const NovelIdBrand: unique symbol;
declare const UserIdBrand: unique symbol;
declare const SeriesIdBrand: unique symbol;
declare const ChapterIdBrand: unique symbol;

// 5 个 Branded 类型（5 个 ID 互不兼容——结构相同但语义不同）
export type IllustId = number & { readonly [IllustIdBrand]: typeof IllustIdBrand };
export type NovelId  = number & { readonly [NovelIdBrand]:  typeof NovelIdBrand  };
export type UserId   = number & { readonly [UserIdBrand]:   typeof UserIdBrand   };
export type SeriesId = number & { readonly [SeriesIdBrand]: typeof SeriesIdBrand };
export type ChapterId= number & { readonly [ChapterIdBrand]:typeof ChapterIdBrand};

// 5 个工厂函数（在系统边界把 raw number 转换为 Branded 类型）
export function toIllustId(raw: number):  IllustId  { return raw as IllustId;  }
export function toNovelId(raw: number):   NovelId   { return raw as NovelId;   }
export function toUserId(raw: number):    UserId    { return raw as UserId;    }
export function toSeriesId(raw: number):  SeriesId  { return raw as SeriesId;  }
export function toChapterId(raw: number): ChapterId { return raw as ChapterId; }
```

### 边界规则

| 场景 | 类型流向 | 行为 |
|---|---|---|
| **HTTP response 解析** | raw `number` → `Branded` 类型 | API 模块边界处 `as` 转换（与 response 类型同步声明 Branded） |
| **API 函数签名** | 函数接受 `Branded` 类型 | 调用方传 raw `number` → TS 拒绝 |
| **API 函数返回** | 返回 `Branded` 类型 | 调用方可直接传递；`Branded → number` 需显式 cast（项目惯例不鼓励） |
| **内部流通** | 内部 `Branded → Branded` | 类型不变；零运行时代价 |
| **跨类型误传** | `loadDetail(illustId as NovelId)` | TS2345 / TS2322 编译报错（assertNever 模式无法做，Branded 是 structural typing 的根本解） |

### 数据流

```
【response 解析】fetch → JSON.parse → res.illust.id (number)
  → api/types.ts 声明 res.illust.id: IllustId（编译期保证）
  → 调用方直接拿到 IllustId，无需再 cast

【API 调用方】const target = illustFromResponse.id  // IllustId
  → loadDetail(target)  ✓ 直接通过（类型匹配）
  → loadNovelDetail(target)  ✗ TS2345（IllustId 不能赋给 NovelId 参数）
  → loadBookmarks(target)  ✗ TS2345（IllustId 不能赋给 UserId 参数）

【store 内部桥接】某 store 从外部数据源（非 response）拿 number
  → const rawId: number = parseInt(localStorage.getItem('pending')!)
  → const illustId = toIllustId(rawId)  // 显式边界转换
  → loadDetail(illustId)  ✓
```

### 边界条件

- **HTTP / DB 反序列化**：response 类型字段声明 `Branded`，TS 编译期保证；运行时仍是 `number`，零开销。
- **工厂函数唯一职责**：边界转换；不验证 ID 范围（Pixiv ID 有效值域是「正整数」，项目目前不验证，加 `assert(raw > 0)` 是 P3 候选）。
- **运行时类型擦除**：`unique symbol` 在编译后被擦除；运行时所有 `Branded` 类型都是 `number`——bundle size 零增长、运行时性能零损耗。
- **现有 `id: number` 字段**：改造时**直接替换**为 `id: IllustId` 等；调用现场从 `response.id` 取值时类型自动升级为 Branded——多数调用方无需任何改动。
- **少数调用现场需要改**：store / 组件从非 response 源（localStorage、URL 参数、`parseInt` 字符串）拿 number 时，需经工厂函数转换。**P2.3 独立票**处理。
- **跨端契约**：`src/api/id.ts` 双端（app + app-lynx）byte-identical 复制（与 assertNever 策略一致，project "双端差分对齐"惯例）。

## User Stories

1. 作为维护者，我希望给核心领域 ID 加 Branded 类型，以便 API 函数签名拒绝 `novelId` 误传给 `loadDetail(illustId: IllustId)` 这类跨类型调用。
2. 作为维护者，我希望 Branded 类型在编译后被擦除，以便运行时零开销、bundle 零增长。
3. 作为维护者，我希望 Branded 类型在 system boundary（HTTP / DB 反序列化）通过工厂函数转换，以便防御集中、可审计。
4. 作为维护者，我希望 API 层的 `id: number` response 字段直接升级为 `id: IllustId` 等，以便调用方从 `response.id` 取值时类型自动升级——多数调用现场零改动。
5. 作为维护者，我希望 5 个 ID 类型各自独立、互不兼容，以便任何跨类型赋值在编译期被拦截（包括子类型、双向转换、as 断言外的直接赋值）。
6. 作为审查者，我希望 `unique symbol` 模式的 Branded 类型有 tsc-only 类型契约测试，以便守住"任何非 number 入参被拒绝"的契约。
7. 作为审查者，我希望 `toIllustId(raw: number)` 这类工厂函数有运行时单测（type-correctness + 实际擦除行为），以便工具自身有回归测试。
8. 作为 app-lynx 用户，我希望 Branded 类型在 app + app-lynx 双端定义一致，以便双引擎调用相同的 API 函数时类型契约对齐。
9. 作为维护者，我希望 Branded 类型不引入新共享包、不引入跨包 import，以便 seam 数保持最小（沿 P1 assertNever 决策）。
10. 作为长期维护者，我希望 API 函数签名变化对 store / component 调用现场的影响降到最小（response 自动 Branded），以便防御落地不至于产生大量 follow-up 改造。
11. 作为维护者，我希望工厂函数命名直白（`toIllustId` / `toNovelId` 等），以便在 store 桥接点一眼读懂转换意图。
12. 作为维护者，我希望有 smoke test 钉死"调换两个 ID 类型，tsc 报错"的契约（spec §Testing Decisions 钉死），以便任何回归立刻在 PR 阶段发现。
13. 作为审查者，我希望 Branded 类型与 P1 assertNever 形成完整的类型防御网——P1 守 switch 联合扩展遗漏，P2 守跨类型 ID 误传，以便文章三道门中的前两道全部落地。
14. 作为维护者，我希望 P2 不触及 store / route / 组件（除双端 `api/id.ts` 之外的代码保持不变），以便改造面严格受控、既有 1900+ 测试全部保持。
15. 作为长期维护者，我希望 P2.3（少数 store 桥接点适配）独立成票处理，以便本规格 scope 清晰、未来 follow-up 可追溯。

## Implementation Decisions

### 共享契约

1. **类型实现**：`unique symbol` + `number & { readonly [Brand]: typeof Brand }` intersection 模式；5 个 ID 类型共享同一结构但用不同 symbol 隔离。
2. **工厂函数签名**：每个 ID 一个 `function toXxxId(raw: number): XxxId`，body 仅 `return raw as XxxId`（运行时无操作；纯类型层边界）。
3. **跨端策略**：**双端 byte-identical 复制**——`packages/app/src/api/id.ts` 与 `packages/app-lynx/src/api/id.ts` 内容完全一致；沿 P1 `assertNever` 决策；项目「双端差分对齐」惯例。

### app（packages/app）

4. **新增** `packages/app/src/api/id.ts`：5 个 `declare const XxxIdBrand: unique symbol;` + 5 个 `type XxxId = number & { ... }` + 5 个 `function toXxxId(raw: number): XxxId { return raw as XxxId; }` + module-level doc 解释意图与边界规则。
5. **改造** `packages/app/src/api/types.ts`：
   - `PixivUser.id: number` → `PixivUser.id: UserId`
   - `PixivIllust.id: number` → `PixivIllust.id: IllustId`
   - `PixivNovel.id: number` → `PixivNovel.id: NovelId`
   - `NovelNavItem.id: number` → `NovelNavItem.id: NovelId`（系列导航下属的章节是 NovelId；如系列 ID 字段出现需独立处理）
   - `series.id: number`（PixivNovel.series 字段）→ `series.id: SeriesId`
   - 引入 `import type { IllustId, NovelId, UserId, SeriesId } from "./id"`
6. **改造** `packages/app/src/api/illust.ts`：所有 `illustId: number` 参数 → `illustId: IllustId`；所有 `userId: number` 参数 → `userId: UserId`；保持函数签名其他部分不变。
7. **改造** `packages/app/src/api/novel.ts`：所有 `novelId: number` → `novelId: NovelId`；所有 `userId: number` → `userId: UserId`；如有 `chapterId` 参数 → `ChapterId`；如有 `seriesId` 参数 → `SeriesId`。
8. **改造** `packages/app/src/api/user.ts`：所有 `userId: number` 参数 → `userId: UserId`。
9. **改造** `packages/app/src/api/comment.ts`：如有 ID 参数 → 对应 Branded 类型。
10. **改造** `packages/app/src/api/translate.ts` / `packages/app/src/api/ranking.ts` / `packages/app/src/api/search.ts`：同上模式。
11. **新增** `packages/app/tests/unit/api/id.test.ts`：5 工厂函数 × 多种 number 入参（正整数 / 0 / 负数 / 浮点）的类型正确性 + `// @ts-expect-error` 守住「拒绝任何非 number 入参」契约。

### app-lynx（packages/app-lynx）

12. **新增** `packages/app-lynx/src/api/id.ts`：byte-identical 复制 app 端内容（5 symbol + 5 type + 5 factory + doc comment）。
13. **改造** `packages/app-lynx/src/api/types.ts`（如有独立类型声明）：同 §5 模式。
14. **改造** `packages/app-lynx/src/api/{illust,novel,user,...}.ts`（如有独立 API 文件）：同 §6-§10 模式（视 app-lynx 实际 API 形态而定——可能直接 import 共享 model，或独立 mirror）。

### 文档

15. **新增** `docs/adr/ADR-0182-branded-types-for-api-ids.md`：决策记录（与 ADR-0181 同结构）。必须包含：
   - 决策动机（结构化类型系统陷阱；与 P1 assertNever 的互补定位）
   - 决策 5 项（类型实现 / 工厂签名 / 跨端策略 / API 边界 / 落地范围克制）
   - 否决替代方案（class 封装 / 数字字面量 intersection / 跨包 import）
   - 后果（正面 + 风险 + 机器防线 + 跨 flavor 影响 + 遗留挂账）
   - 实施记录（5 ticket 含 commit hash）
16. **新增** `docs/adr/glossary-branded-types.md`：术语表条目——Branded Types / Nominal Type / unique symbol / Phantom Type / Boundary Coercion；与 ADR-0182 配套。
17. **不改** `openwiki/`：按 AGENTS.md「OpenWiki 维护规则」由 CI 定时任务重生成。

### 测试接缝（seams）

- **`src/api/id.ts` 纯函数 seam**（首选）：5 工厂函数独立可测；类型契约用 `// @ts-expect-error` 钉死。
- **API 函数签名 seam**：tsc 编译即验证（CI 必跑）；无需新单测。
- **smoke test**：临时在 `api/types.ts` 调换 `IllustId` / `NovelId` 字段类型，run check，确认 tsc 报错；撤销。

### P2.3（独立票，本规格 Out of Scope）

- 少数 store / component 从非 response 源拿 `number` 时需经工厂函数转换（典型：`localStorage` 持久化值、URL 参数 `parseInt`、手动构造 ID）。
- 桥接点统计：实施 P2.2 后跑 `tsc --noEmit` 报错清单 → 评估影响面 → 单独 ADR + 独立票处理。
- 时间窗：P2.2 merge 后 1-2 周内独立处理，避免遗留长期 `// @ts-expect-error` 在生产代码。

## Testing Decisions

**好测试的标准**：
- 类型层契约：`// @ts-expect-error` 钉死"拒绝任何非 number 入参"（tsc-only 防线）。
- 运行时契约：工厂函数接受任意 number（包括 0、负数、浮点——本规格不验证范围），返回值的 `typeof === 'number'`（验证 symbol 擦除）。
- 双端 byte-identical：`diff packages/app/src/api/id.ts packages/app-lynx/src/api/id.ts` 退出 0。

**新增测试**：
- `packages/app/tests/unit/api/id.test.ts`：Vitest + happy-dom；5 × 3 = 15 测试（5 工厂函数 × 3 入参形态：正整数 / 0 / 浮点）+ 类型契约测试（`@ts-expect-error`）。
- 不在 app-lynx 端重复（双端 byte-identical + app 端测试覆盖已足够；P1 同模式先例）。

**既有测试保持**：
- 既有 1900+ 单测（`pnpm test:all`）应保持全绿——本规格不触及 store / route / 组件；既有 response 字段类型升级为 Branded 后，多数调用现场零改动（response.id 自动 Branded）。

**smoke test 钉死**：
- 在 `api/types.ts` 临时把 `PixivIllust.id: IllustId` 改为 `PixivIllust.id: NovelId`，跑 `pnpm check`，确认 tsc 报 `error TS2322: Type 'NovelId' is not assignable to type 'IllustId'`... 撤销。

**机器防线**：
- `tsc --noEmit`（CI 必跑）守 API 函数签名 + response 类型；
- `pnpm test:all` 守运行时行为；
- `diff packages/app/src/api/id.ts packages/app-lynx/src/api/id.ts`（建议 P3 加 CI 自动检查，P2 手动同步）。

## Out of Scope

- **P2.3 少数 store / 组件从非 response 源拿 number 的桥接点改造**：独立票；典型来源 `localStorage` 持久化值 / URL 参数 `parseInt` / 手动构造 ID。P2.2 merge 后 1-2 周内独立处理。
- **次级 ID 打标**：`CommentId` / `TagId` / `BookmarkId` 不在 P2 范围。BookmarkId 已用复合字符串主键（`${userId}_${type}_${id}`）天然隔离；CommentId / TagId 改造 ROI 低（P3 候选）。
- **跨包 import**：违反 P1 assertNever seam 决策；本规格延续双端 byte-identical 复制策略。
- **新共享包（`@pictelio/ids` 等）**：过度工程；与项目"双端差分对齐"惯例冲突。
- **ID 值域验证**：`toIllustId(raw: number)` 不验证 raw 是否 > 0；Pixiv ID 理论上是正整数，但项目目前不验证——P3 候选（边界检查属另一议题）。
- **class 模式封装**：与项目 type + 函数风格不一致；运行时开销不为零。
- **数字字面量 intersection（`type IllustId = number & { __illust: true }`）**：与字符串区分度差；`{ __illust: true }` 可能被其他类型意外满足——unique symbol 模式绝对唯一性更强。
- **Symbol 注册表 / 反查**（`Symbol.for('IllustId')`）：与「编译期唯一」目标冲突；symbol 注册表是跨 realm 共享语义，本规格不需要。
- **改名 / 迁移脚本**：项目历史数据无 ID 持久化为 raw number 的形态（BookmarkId 复合字符串、`pending` 等新字段由 P3 处理）；本规格是新增防御面，不改既有数据形态。
- **response 解析层的 `as` cast 验证**：TS 编译期保证 + 既有 `pixiv-api` 类型层（response 类型已声明 Branded）；运行时若有 `as` 误用，TS 类型不保证——属于另一类契约测试范畴（P3）。
- **OpenAPI / 客户端 SDK 暴露**：本规格只锁 TS 层；HTTP 协议层 ID 仍是 raw number——这是预期（HTTP 协议不应承载 TS 编译期类型）。

## Further Notes

### 与 P1 assertNever 的互补定位

| 工具 | 拦截目标 | 触发场景 |
|---|---|---|
| **`assertNever`** | 联合类型扩展时 switch 遗漏 | 新增枚举项 / 状态 |
| **Branded Types** | 跨类型 ID 误传 | store / 路由参数 / URL path 解析 |

两者**正交**：P1 守"穷尽性"，P2 守"身份"。文章三道门中的前两道对应到 Pictelio 已有的两个真实风险面（spec / ADR-0181 / ADR-0182 分别落地）。

### 跨端 byte-identical 复制维护成本

与 assertNever 决策同源（ADR-0181 D2）：27 / 80 行的工具文件跨端复制成本低；CI 守卫可加但 P2 不强制。建议 P3 加 fixture 化 CI 检查（`diff packages/{app,app-lynx}/src/api/id.ts` 退出 0 才允许 merge）。

### 与 satisfies 的边界

`satisfies` 处理"形状"（配置对象是否满足外部契约 + 保留字面量推断）；**Branded Types 处理"身份"**（结构同形但语义不同的区分）。两者正交，可同文件使用（如 i18n en/ 域 `as const satisfies Record<XxxKey, string>` + ID 类型 Branded 不冲突）。

### 测试硬约束对照

- **#1 IO 边界**：`toXxxId` 是纯函数无 IO，硬约束不适用；既有 API 单测的 IO 测试已存在。
- **#2 真实样例**：ID 测试用真实 number 值（Pixiv 真实响应 ID 范围 1-99999999+），无 mock。
- **#3 禁止静默降级**：工厂函数 `return raw as XxxId` 是显式 cast（编译期拒绝传错类型）；不静默吞错。
- **#6 Oracle 溯源**：5 个 ID 类型来自 `packages/app/src/api/{illust,novel,user}.ts` 函数签名；5 个 unique symbol 来自文章原文；与 ADR-0181 决策模式一致。

### 跨 flavor / 跨包影响

零。`src/api/id.ts` 是 utils 内部工具；store / route / 组件无需感知 ID 概念（response 自动 Branded）。

### 遗留挂账（显式，禁「后续处理」口头带过）

- **P2.3 独立票**：少数 store / 组件从非 response 源拿 number 的桥接点（预计 < 10 处）；P2.2 merge 后 1-2 周内处理。
- **P3 候选**：
  - 双端 byte-identical CI 同步守卫（fixture 化）。
  - 工厂函数值域检查（`assert(raw > 0)`）。
  - `TranslateErrorCode` 加 assertNever（P1 已挂账，P2 不动）。
  - `CommentId` / `TagId` / `BookmarkId` 是否打标（按业务演化决定）。

### ADR-0181 P2 挂账关闭

ADR-0181「后果」节明文挂账：**P2 独立 ADR：Branded Types for API IDs（IllustId / NovelId / UserId / SeriesId / ChapterId），影响面涉及 `api/illust.ts` / `api/novel.ts` / `api/types.ts` + 50+ 调用现场**。本规格即为该挂账的落地。

### Spec / Issue 关联

- 本规格：`docs/specs/branded-types-for-api-ids.md`
- GitHub issue：（T2 /to-spec 阶段创建，label `ready-for-agent`，作为 T1-T5 sub-issue 的 parent）
- 配套 ADR：`docs/adr/ADR-0182-branded-types-for-api-ids.md`（T5 文档票产出）
- 配套 glossary：`docs/adr/glossary-branded-types.md`（T5 文档票产出）
- 前置：ADR-0181（P1 assertNever）+ spec `assertnever-exhaustive-checking.md`