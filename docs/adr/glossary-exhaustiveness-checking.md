# 编译期穷尽性检查（Exhaustiveness Checking）—— 术语表

> 范围：TypeScript `strict` 模式无法覆盖的 switch 分支遗漏场景；通过 `assertNever` 工具在编译期拦截。配套 ADR：[ADR-0181-assertnever-exhaustive-checking.md](./ADR-0181-assertnever-exhaustive-checking.md)。
>
> 文章源：李帕吉 / 前端小石匠 2026-09-21 公众号《开了 strict 照样翻车：TypeScript 没告诉你的三道隐形暗门》第二道门 <https://mp.weixin.qq.com/s/1sYdhpyW1SHxgGFPd9PIAA>

## 核心术语

| 术语 | 定义 |
|------|------|
| **结构化类型系统（Structural Typing）** | TypeScript 默认的类型系统：只要两个类型"形状"相同（成员名 + 类型一致），就视为同一类型。**只认长相不认身份**。与名义类型系统（Nominal Typing，如 Java / C#）相对。 |
| **可辨识联合（Discriminated Union）** | 联合类型的所有成员都有一个共同字面量字段（"tag"），使 `switch` 可以按该字段收窄类型。例：`type Status = { kind: "pending"; ... } \| { kind: "done"; ... }`。 |
| **类型收窄（Type Narrowing）** | 在 `if` / `switch` / 类型守卫后，TS 把变量类型从联合收窄到单一成员；switch 中处理过某 case 后该成员从变量类型中"剔除"，剩余集合逐步缩小。 |
| **`never` 类型** | TypeScript 底层类型：表示"永远不可能的值"。**联合收窄到空集时**变量类型为 `never`。也可显式 `function foo(): never { throw new Error(); }` 标注函数永不返回。 |
| **穷尽性检查（Exhaustiveness Checking）** | 在 switch / if-else 链 / 处理完所有联合成员后，**通过类型系统确保无遗漏**——编译器拒绝新增成员时未同步处理的代码。是文章三道门中的第二道。 |
| **`assertNever` 工具** | `function assertNever(value: never): never`——故意接收 `never` 类型参数。当联合拓宽（如新增枚举项）后某 switch 默认分支传 `status` 不再是 `never`，`never` 参数拒绝接受 → 编译期拦截。本项目 ADR-0181 引入。 |
| **穷尽性检查的运行期兜底** | `assertNever` 函数体 `throw new Error(\`Unhandled discriminated union member: ${JSON.stringify(value)}\`)`——编译器漏判时（如 `as` 断言绕过）抛错，错误信息含遗漏成员的具体值。正常路径永远走不到此分支。 |
| **`noFallthroughCasesInSwitch`** | TypeScript 编译器选项（本项目已开，`tsconfig.json:11`）：禁止 switch 无 default 时隐式 fall-through。**但**不能阻止"default 缺失 + 全 case return 完整"陷阱——`assertNever` 模式补此盲区。 |
| **`@ts-expect-error` 注解** | 测试中用于钉住"该表达式必须编译报错"的契约：本项目 `assertNever.test.ts` 用于验证生产签名"拒绝任何非 `never` 入参"——tsc-only 防线。 |

## 与其他模式对比

| 模式 | 拦截时机 | 拦截维度 | 适用场景 |
|------|---------|---------|---------|
| **`@ts-expect-error`** | 编译期 | 单条表达式报错契约 | 测试类型层契约 |
| **`assertNever`** | 编译期 + 运行期兜底 | 联合成员遗漏 | switch / if-else 链的 default 分支 |
| **Branded Types（名义打标类型）** | 编译期 | 字符串 / 数字 ID 误传 | API 边界、跨类型 ID 区分（本项目 P2 候选，文章第一道门） |
| **`satisfies` 运算符**（TS 4.9+） | 编译期 | 形状校验 vs 字面量推断兼顾 | 配置字典、路由表（项目已在 en/ i18n 落地，文章第三道门） |
| **`as const`** | 编译期 | 锁定字面量类型 | 只读常量（无对外校验） |
| **lookup table** | 运行期 | 枚举 → 值映射 | 配置表（与项目 switch 风格不一致，本项目不采用） |

## 决策模板（沿用至 P3）

任何时候给现有项目加入"运行时演化的联合类型"加 assertNever 时，套用 ADR-0181 的 6 项决策：

1. **D1 工具签名**：`export function assertNever(value: never): never` + `JSON.stringify(value)` 错误信息模板
2. **D2 工具位置**：app + app-lynx 双端各一份 byte-identical（**不**跨包 import）
3. **D3 消费点**：每个 switch / if-else 链 default 分支 `return assertNever(value);`
4. **D4 行为 bit-identical**：refactor 必须保持对已知模式输出等价；既有真值表测试守护
5. **D5 错误信息**：固定模板（含 `JSON.stringify(value)`）
6. **D6 既有 seam 复用**：`tsc --noEmit` CI 必跑，不引入新框架

## 复现 trap（不要踩）

```typescript
type DownloadStatus = "queued" | "downloading" | "failed";

// ❌ 反例 1：default 缺失 → 新增枚举项时静默 undefined
function label(s: DownloadStatus): string {
  switch (s) {
    case "queued": return "排队中";
    case "downloading": return "下载中";
    case "failed": return "失败";
    // 新增 "rate_limited" → 此函数返回 undefined（编译无报错）
  }
}

// ❌ 反例 2：inline throw 不提供编译期防御
function label2(s: DownloadStatus): string {
  switch (s) {
    case "queued": return "排队中";
    case "downloading": return "下载中";
    case "failed": return "失败";
    default: throw new Error(`Unhandled: ${s}`);  // ← TS 仍视为"已处理全部"，联合拓宽不报错
  }
}

// ✅ 正解：assertNever 在 default 分支守住联合收窄
import { assertNever } from "./assertNever";
function label3(s: DownloadStatus): string {
  switch (s) {
    case "queued": return "排队中";
    case "downloading": return "下载中";
    case "failed": return "失败";
    default: return assertNever(s);  // ← s 在此被收窄到 never；联合拓宽时 TS 拒绝
  }
}
```

## 与 satisfies 的边界（不混淆）

- **`assertNever` 处理"遗漏"**——联合拓宽后 switch 没跟上的成员
- **`satisfies` 处理"形状"**——配置对象是否满足外部契约（同时保留字面量推断）

二者正交；同一文件可同时使用（如项目 en/ i18n 的 `as const satisfies Record<XxxKey, string>` + app 端 aiFilter 的 `assertNever`）。

## 引用

- [ADR-0181-assertnever-exhaustive-checking.md](./ADR-0181-assertnever-exhaustive-checking.md) — 决策记录
- [docs/specs/assertnever-exhaustive-checking.md](../specs/assertnever-exhaustive-checking.md) — 功能规格（含 Spec 修订历史）
- [docs/research/typescript-strict-hidden-traps-analysis.md](../research/typescript-strict-hidden-traps-analysis.md) — 项目现状分析（grep 实证）
- `packages/app/src/utils/assertNever.ts` + `packages/app-lynx/src/utils/assertNever.ts` — 工具实现（byte-identical）
- `packages/app/tests/unit/utils/assertNever.test.ts` — 单测 + 类型层契约（`@ts-expect-error`）
- issue #694（spec）/ #695（T1）/ #696（T2）/ #697（T3）/ #698（T4）/ #699（T5 + review 修复）