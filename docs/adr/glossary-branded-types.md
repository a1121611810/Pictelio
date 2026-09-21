# Branded Types（名义类型 / 幽灵类型）—— 术语表

> 范围：TypeScript 结构化类型系统无法区分同形 ID（illustId / novelId / userId 都是 `number`）；通过 Branded Types 在编译期拦截跨类型 ID 误传。配套 ADR：[ADR-0182-branded-types-for-api-ids.md](./ADR-0182-branded-types-for-api-ids.md)。
>
> 文章源：李帕吉 / 前端石匠 2026-09-21 公众号《开了 strict 照样翻车：TypeScript 没告诉你的三道隐形暗门》第一道门 <https://mp.weixin.qq.com/s/1sYdhpyW1SHxgGFPd9PIAA>

## 核心术语

| 术语 | 定义 |
|------|------|
| **结构化类型系统（Structural Typing）** | TypeScript 默认类型系统：两个类型"形状"相同（成员名 + 类型一致）即视为同一类型。**只认长相不认身份**——`type UserId = number` 与 `type OrderId = number` 等价。与名义类型系统（Nominal Typing，如 Java / C#）相对。 |
| **名义类型系统（Nominal Typing）** | 显式声明类型身份（如 `MyCache` class）的类型系统；Java / C# / Swift / Rust 默认。结构同形但身份不同的类型不互通。TypeScript **不**默认支持，需要 Branded Types 模拟。 |
| **Branded Types** | 在结构化类型系统上模拟名义类型的模式：给基础类型（如 `number`)交叉一个永远不可能运行时存在的专属属性，使两个结构同形的类型在编译器眼里不同。本项目 ADR-0182 引入。 |
| **`unique symbol`** | TypeScript 编译器全局唯一的 symbol 类型；用作 brand 标记以保证编译期绝对唯一性（字符串字面量或普通 symbol 不具备此保证）。 |
| **Phantom Type** | 仅在类型层面存在、运行时无实例的类型（典型如 `unique symbol` brand）；用于"给类型加标记"而不增加运行时开销。 |
| **Boundary Coercion（边界类型转换）** | Branded Types 的工厂函数（`toIllustId(raw: number): IllustId`）在系统边界处把 raw `number` 转换为 Branded 类型；body 仅 `return raw as XxxId`（运行时透传）。 |
| **`CommentTargetId`** | `packages/app-lynx/src/api/comment.ts` 引入的联合类型 `IllustId \| NovelId`——评论可对插画或小说二选一；是 Pixiv API 的设计而非 Branded 副作用。 |
| **Pictelio 5 个核心 Branded ID** | `IllustId` / `NovelId` / `UserId` / `SeriesId` / `ChapterId`——5 类核心领域 ID 各自独立、互不赋值。 |
| **Pictelio 不做标的 ID** | `CommentId` / `TagId` / `BookmarkId`——次级 ID（P3 候选）；`offset` / `limit` / 临时计数器——非身份语义。 |

## 与其他模式对比

| 模式 | 拦截时机 | 拦截维度 | 适用场景 |
|------|---------|---------|---------|
| **`@ts-expect-error`** | 编译期 | 单条表达式报错契约 | 测试类型层契约 |
| **`assertNever`**（ADR-0181） | 编译期 + 运行期兜底 | 联合成员遗漏 | switch / if-else 链 default 分支 |
| **Branded Types**（本 ADR） | 编译期 | 跨类型 ID 误传 | API 函数签名 + response 字段 |
| **`satisfies` 运算符**（TS 4.9+） | 编译期 | 形状校验 vs 字面量推断兼顾 | 配置字典、路由表（已在 en/ i18n 落地） |
| **`as const`** | 编译期 | 锁定字面量类型 | 只读常量（无对外校验） |
| **class 模式** | 编译期 + 运行期 | 完整封装（含运行时守卫） | 与 type + 函数风格不符；运行时开销不为零（本项目不采用） |
| **数字字面量 intersection**（`type X = number & { __x: true }`） | 编译期 | 与 Branded 类似的身份隔离 | 唯一性弱于 `unique symbol`（`'IllustId' === 'IllustId'` 跨类型共享） |

## 决策模板（沿用至 P3 增量 ID）

任何时候给 Pictelio 新增 Branded ID 时，套用 ADR-0182 的 7 项决策：

1. **D1 类型实现**：`unique symbol` + `number & { readonly [Brand]: typeof Brand }` 模式
2. **D2 工厂函数**：`function toXxxId(raw: number): XxxId { return raw as XxxId }`（运行时透传）
3. **D3 跨端策略**：双端 byte-identical 复制（`packages/app/src/api/id.ts` + `packages/app-lynx/src/api/id.ts`）
4. **D4 API 函数签名**：直接 Branded（无 `number | Branded` 兼容期）
5. **D5 落点克制**：仅核心领域 ID；次级 ID / 临时计数器不打
6. **D6 既有 seam 复用**：`tsc --noEmit` CI 必跑
7. **D7 联合类型边界**：跨语义字段用 union（如 `CommentTargetId = IllustId \| NovelId`）

## 复现 trap（不要踩）

```typescript
// ❌ 反例 1：raw number ID 互相误传
type IllustId = number;
type NovelId = number;

function loadDetail(illustId: IllustId) { /* ... */ }
function loadNovelDetail(novelId: NovelId) { /* ... */ }

const illustId: IllustId = 123;
const novelId: NovelId = 456;

loadNovelDetail(illustId);  // ❌ 编译通过，运行期 /v2/novel/detail?novel_id=123 → 错作品/空响应
loadDetail(novelId);       // ❌ 同上

// ❌ 反例 2：type alias 不提供身份隔离
type UserId = number;
type OrderId = number;
type CancelRequest = { userId: UserId; orderId: OrderId };
function cancel(userId: UserId, orderId: OrderId) { /* ... */ }
const req: CancelRequest = { userId: 9981, orderId: 1024 };
cancel(req.orderId, req.userId);  // ❌ TS 编译通过，运行期 cancel 错对象

// ✅ 正解：Branded Types
declare const IllustIdBrand: unique symbol;
declare const NovelIdBrand: unique symbol;

type IllustId = number & { readonly [IllustIdBrand]: typeof IllustIdBrand };
type NovelId  = number & { readonly [NovelIdBrand]:  typeof NovelIdBrand  };

function toIllustId(raw: number): IllustId { return raw as IllustId; }
function toNovelId(raw: number): NovelId { return raw as NovelId; }

function loadDetail(illustId: IllustId) { /* ... */ }
function loadNovelDetail(novelId: NovelId) { /* ... */ }

const illustId = toIllustId(123);
const novelId = toNovelId(456);

loadNovelDetail(illustId);  // ✗ TS2345: Argument of type 'IllustId' is not assignable to parameter of type 'NovelId'
loadDetail(novelId);       // ✗ 同上
```

## 边界规则（与 assertNever 镜像）

| 场景 | 类型流向 | 行为 |
|---|---|---|
| **HTTP response 解析** | raw `number` → Branded | response 字段声明 Branded；调用方从 `response.id` 取值自动获得 |
| **API 函数签名** | 函数接受 Branded | 调用方传 raw `number` → TS2345 拒绝 |
| **API 函数返回** | 返回 Branded | 调用方可直接传递；`Branded → number` 需显式 cast（项目惯例不鼓励） |
| **内部流通** | Branded → Branded | 类型不变；零运行时代价 |
| **非 response 源**（URL 参数 / localStorage / native bridge） | raw `number` → Branded | 经工厂函数 `toXxxId(raw)` 显式转换 |
| **内部 store cache key** | 保留 raw `number` | cache 标识符而非 API 参数；转换发生在 API 调用边界 |

## 与 assertNever / satisfies 的边界

- **`assertNever`**：处理"遗漏"——联合拓宽后 switch 没跟上的成员
- **Branded Types**：处理"身份"——结构同形但语义不同的区分
- **`satisfies`**：处理"形状"——配置对象是否满足外部契约 + 保留字面量推断

三者正交，可同文件使用（如项目 en/ i18n 的 `as const satisfies Record<XxxKey, string>` + assertNever 在 download model + Branded Types 在 API 层）。

## 引用

- [ADR-0182-branded-types-for-api-ids.md](./ADR-0182-branded-types-for-api-ids.md) — 决策记录
- [docs/specs/branded-types-for-api-ids.md](../specs/branded-types-for-api-ids.md) — 功能规格
- [docs/research/typescript-strict-hidden-traps-analysis.md](../research/typescript-strict-hidden-traps-analysis.md) — 项目现状分析（grep 实证）
- `packages/app/src/api/id.ts` + `packages/app-lynx/src/api/id.ts` — 工具实现（byte-identical）
- `packages/app/tests/unit/api/id.test.ts` — 单测 + 类型层契约（`@ts-expect-error`）
- issue #700（spec）/ #701（T1 foundation）/ #702（T2 response）/ #703（T3 app sigs）/ #704（T4 lynx sigs）/ #705（T5 docs）