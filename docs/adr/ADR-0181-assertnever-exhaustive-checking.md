# ADR-0181: 编译期穷尽性检查——`assertNever` 工具 + 跨端复制策略

- 状态: Accepted（2026-09-21）
- 日期: 2026-09-21
- 关联: spec [`docs/specs/assertnever-exhaustive-checking.md`](../specs/assertnever-exhaustive-checking.md)（[issue #694](https://github.com/a1121611810/Pictelio/issues/694)）；实施票 [#695](https://github.com/a1121611810/Pictelio/issues/695)（T1）/ [#696](https://github.com/a1121611810/Pictelio/issues/696)（T2 app）/ [#697](https://github.com/a1121611810/Pictelio/issues/697)（T3 app-lynx）/ [#698](https://github.com/a1121611810/Pictelio/issues/698)（T4 app aiFilter）/ [#699](https://github.com/a1121611810/Pictelio/issues/699)（T5 文档 + review 修复）；研究 [`docs/research/typescript-strict-hidden-traps-analysis.md`](../research/typescript-strict-hidden-traps-analysis.md)；分析源 = 李帕吉 / 前端小石匠 2026-09-21 公众号《开了 strict 照样翻车：TypeScript 没告诉你的三道隐形暗门》第二道门 <https://mp.weixin.qq.com/s/1sYdhpyW1SHxgGFPd9PIAA>
- 修订: 2026-09-21 同日，spec §1/§9 从 v1（"app 端工具 + app-lynx inline throw"）修订为 v2（"两份副本 + 双端均用 assertNever"）——理由见 [spec 末尾「Spec 修订历史」](../specs/assertnever-exhaustive-checking.md#spec-修订历史)；本 ADR 反映 v2 终态。
- 延续: `tsconfig.json` `strict + noUnusedLocals + noUnusedParameters + noFallthroughCasesInSwitch`（项目既有，未变更）

## 背景

TypeScript `strict: true` 已开（`packages/app/tsconfig.json:8`），但 `noFallthroughCasesInSwitch` 只阻止"无 default 隐式 fall-through"，**不阻止"default 缺失 + 全 case return 完整"** 陷阱——switch 在联合类型新增成员时静默穿透返回 `undefined`。

两处真实反例（已 grep 实证）：

| 位置 | 风险 |
|---|---|
| `packages/app/src/utils/downloadsViewModel.ts:91 statusLabel` | 6 case 全 return、无 default；新增 `DownloadStatus` 枚举项 → 静默 `undefined` → i18n 文案键空白 / 视图层白屏 |
| `packages/app/src/utils/aiFilter.ts:41 isAiHiddenByType` | if-else 链；新增 `AiFilterMode` → 静默走 `mask` 分支（行为错误） |
| `packages/app-lynx/src/utils/downloadsViewModel.ts:90 statusLabel` | 同 app 端形态——`docs/specs/download-manager.md §7`「同源同语义」契约下双端同时有漏洞 |

文章李帕吉（前端小石匠，2026-09-21）第二道门给出标准解：`assertNever<T>(value: T): never`，利用 `T` 在被收窄 switch 的 default 分支里被推导为 `never` 的特性——联合拓宽时 `T` 不再是 `never`，调用点拒绝。

## 决策

**D1 · 工具签名**：单一函数 `export function assertNever(value: never): never`，函数体 `throw new Error(\`Unhandled discriminated union member: ${JSON.stringify(value)}\`);`。
- 入参类型 `never` 是核心约束：调用方必须传已收窄到 `never` 的变量；任何非 `never` 表达式在调用点即编译报错。
- 抛出信息含 `JSON.stringify(value)`，调试时直接看到遗漏成员的具体值（字面量 / 数字 / 对象形态皆可读）。
- 抛出仅在编译器被绕过（`as` 断言 / 非 TS 边界）时生效；正常路径**永远走不到**——这是编译期防御的根本承诺。

**D2 · 工具位置（跨端复制）**：**两份** byte-identical 副本——
- `packages/app/src/utils/assertNever.ts`（app 端，27 行）
- `packages/app-lynx/src/utils/assertNever.ts`（app-lynx 端，27 行复制）

**不跨包 import**，理由：
- 跨包 import 引入新跨包依赖 seam；项目现有「双端差分对齐」惯例（5 份 `AiFilterMode` / 2 份 `DownloadStatus` 独立维护）即拒绝此类 seam。
- 27 行复制成本最低；维护期双端手动同步（建议 P3 加 CI fixture 同步守卫，**P1 不强制**）。

**D3 · 三处消费点**：
- `packages/app/src/utils/downloadsViewModel.ts:107 statusLabel`（app）：`default: return assertNever(status);`
- `packages/app/src/utils/aiFilter.ts:52 isAiHiddenByType`（app）：把 if-else 链改 switch（`case "show"` / `case "mask"` / `case "only"`）+ `default: return assertNever(mode);`
- `packages/app-lynx/src/utils/downloadsViewModel.ts:105 statusLabel`（app-lynx）：`default: return assertNever(status);`

**D4 · 行为 bit-identical**：`isAiHiddenByType` switch 形态对 3 个已知模式（`show` / `mask` / `only`）输出与原 if-else 链逐字等价；既有 12 例真值表（`tests/unit/utils/aiFilter.test.ts` + `tests/unit/differential/aiFilterTruthTable.test.ts`）守护，行为不变。

**D5 · 错误信息**：固定模板 `Unhandled discriminated union member: ${JSON.stringify(value)}`——含具体遗漏值便于排查。生产代码中走不到（编译器已拦截），仅在 `as` 断言绕过时执行。

**D6 · 既有 seam 复用**：复用现有 `tsc --noEmit` 编译检查（CI 必跑，`.github/workflows/ci.yml` 触发 `pnpm check:all`），不引入新 seam 框架 / lint 规则 / 插件。

## 否决的替代方案

- **inline `throw new Error(...)`**（spec v1 提议）：worker 实测发现 vue-tsc 把 `default: throw new Error(...)` 视为"已处理所有剩余"，类型窄化在 default 停止；只有 `assertNever(value: never): never` 的 `never` 入参才能在联合拓宽时触发 TS2345。inline throw 等于把 P1 防御价值砍掉一半（app-lynx 端仅有运行期兜底）。spec §9 v1 → v2 修订由该发现触发。否决。
- **跨包 import app 端 assertNever**：与项目「双端差分对齐」惯例冲突（5 份 `AiFilterMode` / 2 份 `DownloadStatus` 各自独立）；引入新跨包 seam（违反 P1 "seam 数最小" 约束）。否决。
- **Branded Types（名义类型 / 幽灵类型）**：文章第一道门提议，对 API ID 加 `string & { [Brand]: ... }` 类型。影响面涉及 `api/illust.ts` / `api/novel.ts` / `api/types.ts` 50+ 调用现场 + 调用方 store 改造。P2 独立 ADR 决策；**P1 不引入**（克制边界）。否决。
- **`satisfies` 运算符**（文章第三道门）：项目已在 i18n en/ 域全量使用（`as const satisfies Record<XxxKey, string>`），无需 P1 引入；剩余 config 对象场景稀少。否决。
- **lookup table（switch → object map）**：与项目现有 switch / if-else 风格不一致；spec §Testing Decisions 明确禁止。否决。
- **稳定二元枚举加 assertNever**：`Theme` / `ImageQuality` / `RestrictType` / `ContentType` 联合定义稳定（值域漂移低），加 assertNever 是 over-engineering。P3 按需扩展，不在 P1 范围。否决。
- **`TranslateErrorCode` 加 assertNever**：错误码随上游 API 演化确有价值，但 P1 范围克制（spec §7 显式 defer）；P3 独立票处理。否决。
- **app-lynx 引入 Vitest 测试基础设施**：属于另一独立议题；app-lynx `assertNever.ts` 与 app 端 byte-identical 已有对称性保证（不另测）。否决。

## 后果

- **正面**：编译期穷尽性防御在 app + app-lynx 双端覆盖 `DownloadStatus`（6 枚举）+ `AiFilterMode`（3 模式）；联合拓宽时 `tsc --noEmit` 在 PR 阶段拦截（CI 必跑）；错误信息含 `JSON.stringify(value)` 调试可读；既有 6 枚举 / 12 真值表测试保持全绿（行为不变）。
- **review 修复轮（2026-09-21 同日）**：
  - **Spec / Code 一致性**：spec §1/§9 v1（"app 端工具 + app-lynx inline throw"）→ v2（双端复制 assertNever）；T3 worker smoke test 发现 inline throw 不触发 TS2345 后由父会话提交用户拍板 Option A；spec「Spec 修订历史」节记录转变原因。spec v2 与代码 byte-identical 对齐。
  - **测试清理**（`assertNever.test.ts`）：`toThrowError` → `toThrow`（与仓库惯例一致）；删除冗余 `it("never returns normally")`；新增 `// @ts-expect-error` 守住"生产签名契约——拒绝任何非 `never` 入参"。
  - **审计对齐**（[code-review bg_8b4fa7e5](https://github.com/a1121611810/Pictelio/pull)）：原 BLOCKER（spec §1/§9 与 PR 不一致）由 spec v2 修订解决；原 MINOR（spec 承诺 `@ts-expect-error` 测试未落地）由新测试用例解决；剩余 LOW（测试 1-3 模板字面量同形 characterization-tendency）接受。
- **机器防线**：
  - **tsc --noEmit 已 CI 必跑**：`packages/app/package.json:10` `"check": "vp check && tsc --noEmit -p tsconfig.json"`；`packages/app-lynx/package.json:11` `"check": "vue-tsc --noEmit -p src/tsconfig.json"`；CI `.github/workflows/ci.yml` 触发 `pnpm check:all`。
  - **既有单测守护行为不变**：`tests/unit/utils/downloadsViewModel.test.ts`（6 枚举覆盖）+ `tests/unit/utils/aiFilter.test.ts`（12 真值表）+ `tests/unit/differential/aiFilterTruthTable.test.ts`（双端 fixture 一致性）。
  - **smoke test 钉死**：每次实施人工加 `"rate_limited"` 到 `DownloadStatus` 验证 TS2345 报错，加 `"highlight"` 到 `AiFilterMode` 同——`tsc --noEmit -p tsconfig.json` exit 1 + 错误行号；撤销后 commit。
  - **P1 不引入**（建议 P3）：双端 byte-identical 同步守卫（`assertNever.ts` diff 自动化）。
- **代价 / 风险**：
  - **跨端复制需手动同步**：未来变更 `assertNever.ts` 签名/格式时双端必须同步；漏改 → 双端行为漂移。**显式挂账**：建议 P3 加 CI fixture 同步守卫。
  - **`JSON.stringify(value)` 副作用**：极端值（循环引用 / `BigInt`）会抛 `TypeError`；穷尽性检查的运行期兜底本就极少触发，可接受。
- **跨 flavor / 跨包影响**：零。`assertNever.ts` 是 utils 内部工具，不导出公共 API；store / 组件 / 路由层无需感知。
- **遗留挂账（显式，禁「后续处理」口头带过）**：
  - **P2 独立 ADR**：Branded Types for API IDs（`IllustId` / `NovelId` / `UserId` / `SeriesId` / `ChapterId`），影响面涉及 `api/illust.ts` / `api/novel.ts` / `api/types.ts` + 50+ 调用现场。
  - **P3 按需扩展**：`TranslateErrorCode` 等运行时演化联合加 assertNever；双端 byte-identical 同步守卫（fixture 化 CI 检查）。
- **排除面**：Branded Types（P2）；稳定二元枚举（`Theme` / `ImageQuality` / `RestrictType` / `ContentType`）；i18n locale 文件；API 类型层；settings registry；app-lynx `isAiRestricted` / `shouldHideByAi`（ternary 已天然安全）；app-lynx Vitest 基础设施（独立议题）；openwiki 文档（CI 定时任务）。

## 实施记录

| 票 | 内容 | 交付 |
|---|---|---|
| [#695](https://github.com/a1121611810/Pictelio/issues/695) (T1) | assertNever 工具 + 单测 | `e3995f86`（+27 / +36，4 测试通过） |
| [#696](https://github.com/a1121611810/Pictelio/issues/696) (T2) | app 端 downloadsViewModel.statusLabel | `e5611274`（+3；smoke test 触发 TS2345 line 107） |
| [#697](https://github.com/a1121611810/Pictelio/issues/697) (T3) | app-lynx 端 downloadsViewModel.statusLabel（**v1→v2 后**：复制 assertNever + 用之） | `e07e98bf`（inline throw v1）→ amend → `aeb92843`（复制 assertNever v2；smoke test 触发 TS2345 line 105） |
| [#698](https://github.com/a1121611810/Pictelio/issues/698) (T4) | app 端 aiFilter.isAiHiddenByType 改 switch + assertNever | `e20b68fe`（+11/-2；smoke test 触发 TS2345 line 52；既有 12 例真值表全绿） |
| code-review 修复轮（2026-09-21 同日） | spec v1→v2 修订 + 测试清理 + 新增 `@ts-expect-error` 类型契约测试 | `de88c4ce`（+182/-12，4 测试通过） |
| [#699](https://github.com/a1121611810/Pictelio/issues/699) (T5，本 ADR + glossary) | 决策文档化 | 本 ADR + `glossary-exhaustiveness-checking.md`（同 PR） |

合并提交图（merge-base `9e7c6d63` → HEAD）：

```
*   d14c6c57 Merge branch 'feat/adr-0181-t4-app-aifilter'
|\
| * e20b68fe refactor(app): convert isAiHiddenByType to switch + assertNever (#698)
* |   603b6fe3 Merge branch 'feat/adr-0181-t3-app-lynx-statuslabel'
|\ \
| * | aeb92843 feat(app-lynx): use assertNever in statusLabel default (#697)
| |/
* |   c82c4a74 Merge branch 'feat/adr-0181-t2-app-statuslabel'
|\ \
| * | e5611274 feat(app): add assertNever to downloadsViewModel.statusLabel (#696)
| |/
* | de88c4ce fix(test,spec): address code-review findings on assertNever (#694)
|/
* e3995f86 feat(app): add assertNever utility for exhaustive checking (#695)
```

## 验证

- **格式 / lint / tsc**：`pnpm check:all` 全 9 包 pass；574 文件格式化通过、557 文件 lint 0 warning。
- **单测**：`pnpm test:all` 全 8 包 pass；`assertNever.test.ts` 4/4；`downloadsViewModel.test.ts` 15/15；`aiFilter.test.ts` 38/38；`aiFilterTruthTable.test.ts` 15/15。
- **smoke test 钉死**：
  - app 端 T2：`src/utils/downloadsViewModel.ts(107,26): error TS2345` —— `status` 从 `never` 拓宽到 `"rate_limited"` 被拒绝。
  - app-lynx 端 T3：`src/utils/downloadsViewModel.ts(105,26): error TS2345` —— 同形态。
  - app 端 T4：`src/utils/aiFilter.ts(52,26): error TS2345` —— `mode` 从 `never` 拓宽到 `"highlight"` 被拒绝。
- **byte-identical 跨端**：`diff packages/app/src/utils/assertNever.ts packages/app-lynx/src/utils/assertNever.ts` 退出 0。