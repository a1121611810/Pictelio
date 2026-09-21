# 编译期穷尽性检查（assertNever 模式）—— 功能规格

> 来源：grill-with-docs 会话（Q1–Q14 逐项拍板，2026-09-21）；ADR-0181
> 状态：ready-for-agent
> 前置分析：`docs/research/typescript-strict-hidden-traps-analysis.md`

## Problem Statement

Pictelio 已在 `tsconfig.json` 开 `strict + noUnusedLocals + noUnusedParameters + noFallthroughCasesInSwitch`，但 `noFallthroughCasesInSwitch` 只阻止"无 default 的隐式 fall-through"，**不能阻止"default 缺失 + 函数全分支 return 完整"** 这类陷阱。

两处真实存在的反例：

| 位置 | 现状 | 风险 |
|---|---|---|
| `packages/app/src/utils/downloadsViewModel.ts:91 statusLabel` | 6 case 全 return，无 default | 新增 `DownloadStatus` 枚举项（如 `"rate_limited"`）会静默返回 `undefined` → i18n 文案键 `t(undefined)` → 视图层显示空白/白屏 |
| `packages/app/src/utils/aiFilter.ts:41 isAiHiddenByType` | if-else 链：`show` → 短路；`mask` → AI 隐藏；only 分支隐式 | 新增 `AiFilterMode`（如 `"highlight"`）会静默走 `mask` 分支（行为错误） |

下游调用点（`packages/app-lynx/src/utils/downloadsViewModel.ts:90` 的 `statusLabel`）存在完全相同的形态——双端都有该漏洞，spec `docs/specs/download-manager.md §7` 明确"同源同语义"契约。

## Solution

引入 TypeScript `never` 穷尽性检查模式（参考前端小石匠 2026-09-21 公众号《开了 strict 照样翻车：TypeScript 没告诉你的三道隐形暗门》第二道门）：

1. 新增 `assertNever<T>(value: T): never` 工具。`T` 在被穷尽收窄的 switch 默认分支里被推导为 `never`；新增联合成员时 `T` 不再是 `never`，赋值给 `never` 返回值类型即编译报错。
2. 在两处反例（app + app-lynx 共 3 个调用点）的 switch 默认分支 `return assertNever(...)`。
3. 同步创建 ADR-0181 记录决策 + glossary 词条 `exhaustiveness-checking`。

### 数据流

```
【开发时】开发者给 DownloadStatus 加 "rate_limited"
  → TypeScript 联合拓宽
  → statusLabel 的 switch 内现有 6 case 收窄后剩余类型 = "rate_limited"（不再是 never）
  → default 分支 `return assertNever(status)` 中 status 类型变成 string
  → assertNever<T>(status: T) 的 T 不再是 never
  → 函数返回 never 的签名不兼容 string
  → tsc --noEmit 报错（PR 阶段拦截）

【运行时】所有 case 都被覆盖 → default 永远走不到 → assertNever 永远不抛
```

### 边界条件

- **P1 范围**：仅 `DownloadStatus`（双端）+ `AiFilterMode`（app 端）；稳定二元枚举（`Theme` / `ImageQuality` / `RestrictType`）不加 assertNever（克制边界）。
- **app-lynx 的 `isAiRestricted` / `shouldHideByAi`**：已经是 ternary 写法（`mode === "mask" && isAiWork(item)` 等），天然 fallback，**不改**。P1 grep 全仓确认无其他遗漏的 if-else 链。
- **运行时异常**：assertNever 仅在编译器漏判时才会执行；开发者错误，本质上走不到；不需要 try/catch 兜底。
- **错误信息**：`Error(\`Unhandled discriminated union member: ${JSON.stringify(value)}\`)`——含具体遗漏值便于排查。
- **与既有 seam 关系**：复用现有 `tsc --noEmit` 编译检查（CI 必跑），不引入新 seam 框架。

## User Stories

1. 作为维护者，我希望给 `DownloadStatus` 加新枚举项时编译器立刻报错，以便 PR 阶段拦截遗漏的 switch 分支。
2. 作为维护者，我希望 `assertNever` 工具在 app 与 app-lynx 双端共用一份语义，以便双端防御一致。
3. 作为用户，我想下载任务在网络受限时显示「限流中」等新状态时不被白屏吞没，以便看到真实状态。
4. 作为用户，我希望 AI 过滤模式将来扩展为「高亮但不隐藏」等形态时不出 UI 异常，以便保持体验。
5. 作为维护者，我希望 assertNever 抛错时能直接看到遗漏成员的具体值（JSON.stringify），以便定位是哪个枚举项。
6. 作为 app-lynx 用户，我希望下载任务状态枚举扩展后双端都同步拦截，以便不会出现"app 已修、lynx 漏改"的 drift。
7. 作为审查者，我希望下载状态机与 AI 过滤模式的防御网不需要新增框架或运行时依赖，以便 seam 数保持最小。
8. 作为审查者，我希望既有测试（statusLabel 全枚举 + isAiHiddenByMode 真值表）在改造后 100% 通过，以便没有回归。
9. 作为维护者，我希望 assertNever 工具与项目现有 utils 风格一致（`tryAsync` / `trySync` 同级），以便代码风格统一。
10. 作为审查者，我希望 P1 阶段的 ADR 与 glossary 同 PR 提交，以便术语与决策同步生效。
11. 作为维护者，我希望 assertNever 工具自带单测覆盖 throw 内容与签名，以便防御工具自身回归。
12. 作为长期维护者，我希望本规范在将来 P3（`TranslateErrorCode` 等）扩展时有清晰的术语与先例可循，以便团队沿用同一手法。

## Implementation Decisions

### 共享契约

1. **工具位置**：**两份**——`packages/app/src/utils/assertNever.ts`（app 端，27 行）与 `packages/app-lynx/src/utils/assertNever.ts`（app-lynx 端，27 行复制）。byte-identical 实现，仅 doc-comment 中的 `@see` 与所在包路径同步。

   **为什么复制而非跨包 import**（决策记录于本规范末尾「Spec 修订历史」节）：
   - **inline `throw` 不提供编译期防御**：worker 实测发现 vue-tsc 把 `default: throw new Error(...)` 视为"已处理所有剩余"，类型窄化在 default 停止；只有 `assertNever(value: never): never` 的 `never` 入参才能在联合拓宽时触发 TS2345。inline throw 等于把 P1 防御价值砍掉一半。
   - **跨包 import 违反"双端差分对齐"惯例**：项目已有 5 份 `AiFilterMode`（含 `@pictelio/search-core` / app / app-lynx / 两个 fixture）、2 份 `DownloadStatus`（app / app-lynx 各一）独立维护；引入跨包 import 等于单点破坏差分对齐约定。
   - **27 行复制成本最低**：与现有"双端差分对齐"模式一致；后续变更需双端同步（建议加 CI fixture 同步守卫，但 P1 不强制）。
2. **工具签名**：`export function assertNever(value: never): never`。函数体 `throw new Error(\`Unhandled discriminated union member: ${JSON.stringify(value)}\`);`。
3. **泛型约束**：`never` 入参 + `never` 返回——确保调用方必须把已经收窄到 never 的变量传进来；任何非 null 表达式会让 `tsc` 在调用点就报错。

### app（packages/app）

4. **新增** `packages/app/src/utils/assertNever.ts`：实现上文工具签名；附带 module-level doc comment 说明意图与使用方式（"用于 switch 默认分支；编译器会在联合拓宽时拦截"）。
5. **改造** `packages/app/src/utils/downloadsViewModel.ts:91 statusLabel`：在 6 个 case 之后加 `default: return assertNever(status);`；import `assertNever` from `./assertNever`。
6. **改造** `packages/app/src/utils/aiFilter.ts:41 isAiHiddenByType`：把 if-else 链改为 switch（`case "show": return false;` / `case "mask": return aiType >= 1;` / `case "only": return aiType < 1;`），default 分支 `return assertNever(mode);`。
7. **`packages/app/src/api/translate.ts` 的 `classifyTranslateError`**：P1 不改（按"克制边界"，错误码随上游演化但不是 P1 范围；P3 再处理）。
8. **测试** `packages/app/tests/unit/utils/assertNever.test.ts`（新文件）：断言 throw 内容包含 JSON.stringify 形态、断言函数返回类型签名（tsc-only）。

### app-lynx（packages/app-lynx）

9. **改造** `packages/app-lynx/src/utils/downloadsViewModel.ts:90 statusLabel`：在 6 个 case 之后加 `default: return assertNever(status);`；import `assertNever` from `./assertNever`（本地复制版本，与 app 端 byte-identical；详见 §1）。与 spec `docs/specs/download-manager.md §7` 的"同源同语义"对齐——本规范通过两份 assertNever 副本的 byte-identical 形态保持对齐。
   **smoke test 触发**：`DownloadStatus` 加 `"rate_limited"` 后 vue-tsc 报 `src/utils/downloadsViewModel.ts(105,26): error TS2345`（与 app 端 T2 同形态）。
   **运行时 fallback**：app 端 T2 的 6 case 全 return 同形态，app-lynx 端形态镜像等价。
10. **不改** `packages/app-lynx/src/stores/settingsStore.ts` 的 `isAiRestricted` / `isAiOnlyFiltered` / `shouldHideByAi`：ternary 写法天然 fallback，行为正确；P1 grep 确认无遗漏。

### 文档

11. **新增** `docs/adr/ADR-0181-assertnever-exhaustive-checking.md`：记录"为什么选 assertNever / 为什么两份副本（不跨包 import） / 为什么 P1 范围克制"等决策。决策记录中**必须**引用 spec 修订历史（见末尾）说明 inline throw → 复制 assertNever 的转变原因。
12. **新增** `docs/glossary/exhaustiveness-checking.md`：术语登记"穷尽性检查（Exhaustiveness Checking）"——定义、`never` 的语义、`assertNever` 模式、与 satisfies 的差异。
13. **不改** `openwiki/`：按 `AGENTS.md`「OpenWiki 维护规则」由 CI 定时任务重生成，不本地触发。

### 测试接缝（seams）

- **app 端** `assertNever.ts` 纯函数是首选接缝；`statusLabel` / `isAiHiddenByType` 是消费方接缝。
- **app-lynx 端** `statusLabel` 是消费方接缝；`assertNever.ts` 是 app-lynx 内部的次级 seam（与 app 端 byte-identical，变更需双端同步）。
- **跨端契约**：spec `download-manager.md §7` 的"同源同语义"——本规范通过两个端都加 `assertNever` / `throw` 的形态保持一致。

## Testing Decisions

**好测试的标准**：只断言外部可观察行为（给定 status 返回对应文案、给定 mode 返回 bool），不断言内部实现细节（不验 assertNever 工具自身被调用次数）。期望值必须可溯源——`DownloadStatus` 6 枚举值、`AiFilterMode` 3 模式真值表，禁止从被测实现反推。

- **`packages/app/tests/unit/utils/assertNever.test.ts`**（新）：Vitest + happy-dom。断言抛错信息含 JSON.stringify 形态；通过 `// @ts-expect-error` 注解验证 `never` 入参签名（tsc-only）。
- **`packages/app/tests/unit/utils/downloadsViewModel.test.ts`**（既有）：6 个 status 各自对应 case 断言既有覆盖（先例已存在）；不需新增。
- **`packages/app/tests/unit/utils/aiFilter.test.ts`**（既有）：12 例真值表 `mode × ai_type`（先例已存在）；不需新增。
- **`packages/app/tests/unit/differential/aiFilterTruthTable.test.ts`**（既有）：共享 fixture 与 app-lynx 逐字节一致（先例已存在）；不需新增。
- **`packages/app-lynx`**：当前无 Vitest 测试基础设施（与 app 端不同），P1 阶段不引入新测试基础设施；app-lynx `assertNever.ts` 的正确性靠与 app 端的 byte-identical 对称性保证（不另测；冗余测试不增加覆盖维度）。
- **tsc-only 编译测试**：在 PR 验证阶段临时加一项 `DownloadStatus` 验证 default 分支报错（人工验证 + `pnpm check`）；该临时 diff 不入库。
- **回归保证**：既有 downloadsViewModel/aiFilter 测试在改造前后断言一致即证明无回归。

## Out of Scope

- Branded Types（名义类型 / 幽灵类型）—— 推迟到 P2 独立 ADR（影响面涉及 API 签名 + 50+ 调用现场）。
- 给稳定二元枚举加 assertNever：`Theme` / `ImageQuality` / `RestrictType` / `ContentType` 都不在 P1。
- 给 `TranslateErrorCode` 加 assertNever——推迟到 P3（错误码随上游演化但非 P1 范围）。
- 把 switch 重写为 lookup object（与项目现有 if-else / switch 风格不一致）。
- i18n locale 文件改动（与 assertNever 无关；en/ 已用 `as const satisfies` 防御；zh-CN/ 误删 key 缺陷属另一议题）。
- API 类型层（types.ts）改动——不在本次 scope。
- settings registry 改动——不在本次 scope。
- app-lynx 的 `isAiRestricted` / `shouldHideByAi`——ternary 写法已天然安全。
- app-lynx 引入 Vitest 测试基础设施——属于另一个独立议题。
- openwiki 文档——由 CI 定时任务重生成。

## Further Notes

- P1 完成后，P3 的扩展（`TranslateErrorCode` 等）可以引用 ADR-0181 的"决策模板"；避免每个 switch 都重新讨论。
- 文章三道门中本规范仅处理第二道（never 穷尽）；第一道（Branded Types）推到 P2，第三道（satisfies）已全量在 en/ i18n 落地无需处理。
- assertNever 工具与现有 `tryAsync` / `trySync` 同级（utils/ 目录），便于发现与复用；不抽离到 `types/` 强调类型工具性质（与项目惯例一致）。
- app-lynx 用**复制**而非跨包 import 的理由（与 §1 重复，便于回看）：inline throw 不触发编译期防御；跨包 import 违反"双端差分对齐"惯例；27 行复制成本最低、与现有 AiFilterMode 5 份 / DownloadStatus 2 份独立维护的模式一致。后续维护：双端 byte-identical 由手动同步 + 建议加 CI fixture 同步守卫（**P1 不强制，留作 P3 候选**）。
- 测试硬约束对照：#1 IO 边界（assertNever 不涉及 IO，跳过）；#2 真实样例（statusLabel/aiFilter 测试既已使用真实枚举值）；#3 禁止静默降级（throw 比返回 undefined 更显式）；#6 oracle 溯源（6 个 status 来自 `downloadQueueCore.ts` 定义；3 个 mode 来自 ADR-0155）。
- 报告与实际代码的差异：本规范依赖 `downloadsViewModel.ts` 与 `aiFilter.ts` 的既有形态；如实施时发现状态已变，需先更新本规范再实施。

## Spec 修订历史

### 2026-09-21 v2（实施后修订）：app-lynx 从"inline throw"改为"复制 assertNever"

**原决策**（v1，grill-with-docs Q3/Q9 锁定）：
- §1：app 端单点 `assertNever.ts`；app-lynx 端 inline `throw`
- §9：app-lynx `default: throw new Error(\`Unhandled discriminated union member: ${JSON.stringify(status)}\`);`
- 理由：跨包共享 utils 引入新 seam；当前 app-lynx 没有同类工具包；inline 是最低成本方案

**修订原因**（实施时由 T3 worker 触发）：
- T3 worker 在交付报告（#697）中明确报告 smoke test 行为：
  > 向 `DownloadStatus` 加 `"rate_limited"` → vue-tsc exit 0（**无 error**）
- 分析：`throw new Error(...)` 在 default 分支是**纯运行期兜底**；TypeScript 视 default 已处理所有剩余 case，类型窄化停止；只有 `assertNever(value: never): never` 的 `never` 入参签名才能在联合拓宽时触发 TS2345
- **结论**：inline throw 等于把 P1 防御价值砍掉一半（app 端有编译期防御，app-lynx 端只有运行期兜底）——与 P1 核心目标矛盾

**修订决策**（父会话提交用户拍板，用户选 Option A）：
- §1 v2：`assertNever.ts` 复制为两份（app 端 + app-lynx 端，27 行 byte-identical）
- §9 v2：app-lynx `default: return assertNever(status);` 导入本地副本
- 跨包 import 仍被排除（违反"双端差分对齐"惯例，与 5 份 `AiFilterMode` / 2 份 `DownloadStatus` 独立维护的模式冲突）

**ADR 锚点**：ADR-0181（T5 文档票产出）必须显式记录此转变及理由（参考 ADR-0180 D7 → #692 precedent）。

**回归验证**（2026-09-21，commit `aeb92843`）：
- vue-tsc 报 `error TS2345: Argument of type '"rate_limited"' is not assignable to parameter of type 'never'.`（与 app 端 T2 同形态）
- `pnpm check:app-lynx` exit 0
- byte-identical diff：`diff packages/app/src/utils/assertNever.ts packages/app-lynx/src/utils/assertNever.ts` 退出 0

**Code-review BLOCKER 闭环**（修复 2026-09-21）：
- 原 BLOCKING：spec §1/§9 与 PR 实施不一致
- 修复：本节 spec 修订历史 + §1/§9 v2 修订
- 审查轨迹：`bg_8b4fa7e5` (Spec axis) → 本节修订 → 计划下一次 review 确认修复