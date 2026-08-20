# ADR 0098：跨引擎一致性保障——差分测试 + 属性测试 + OAuth 400 识别修复

**状态**：待批准（草案，供评审）
**日期**：2026-08
**决策者**：团队成员 + grill-with-docs / to-spec 会话
**背景**：承接 ADR-0097（oracle check 执行层）的落地缺口；依据 `docs/adr/glossary-cross-engine.md`（统一术语文档）与 `docs/research/ai-generated-test-quality.md`（差分/属性测试依据）。

---

## 背景

Pictelio 是双引擎 monorepo（webview 客户端 `packages/app` / lynx 客户端 `packages/app-lynx`），共享同一 Pixiv 数据源与 OAuth 凭证体系。两引擎存在多组**同语义双实现**（同一领域概念、两套代码），且经过调研确认存在**真实行为分歧**：

1. **OAuth 400 错误识别面分歧**：app `isOAuthTokenErrorResponse` 只认对象形态 message 含 `OAuth`/`invalid_request`；lynx 额外认字符串 `{error:"invalid_grant"}` + `invalid_grant` 子串。**真实 Pixiv 契约**（pixivpy#374、gallery-dl#9331 独立来源）确认字符串形态 `invalid_grant` 是 refresh_token 失效的标准响应，app **漏识别**：同一真实响应体，app 归类 `UNKNOWN`（不视为会话失效、提示「请求失败」），lynx 归类 `UNAUTHORIZED`（进入会话失效流程）。且两侧测试把相反期望**固化**（app `client.test.ts:103-106` → false；lynx `unit.test.ts:76-88` → true）。
2. **R18 判定谓词一致、消费语义相反**：两引擎 `isRestricted` 谓词逐行相同（12 例真值表一致），但 app=过滤隐藏（store 写入前移除，捆绑 blockStore），lynx=全量渲染 + RestrictOverlay 遮罩。
3. **URL 重写 native 分支方向相反**：app 剥域名成相对 path（PixivApiPlugin 契约）；lynx 构造/保留绝对 URL（PictelioApi 契约）。web 分支严格度不同，且 app web 无 `shouldAttachAuth` 令牌附加守卫。
4. **ApiErrorType 枚举值大小写分歧**：app 大写、lynx 小写，成员与 7 类划分一致。

这些分歧中，OAuth 400 是**明确的 bug 候选**（真实契约漏识别、错误分类），其余多为「契约差异」而非 bug（由网关契约决定）。

**为何用差分/属性测试**（调研 §4.5、§7.2）：差分测试让两引擎**互为 oracle**（输出不一致即发现分歧/漂移）；属性测试用「不变量」作 oracle（幂等、round-trip、长度守恒），难写错。二者都是 ADR-0097 oracle 来源里的**独立实现 / 性质**合法来源。

---

## 决策

1. **修复 app OAuth 400 识别（invalid_grant）**：app `isOAuthTokenErrorResponse` 增加字符串 `invalid_grant` 识别 + `invalid_grant` 子串（对齐 lynx），纳入真实体快照契约测试；同步修正 app `client.test.ts:103-106` 的错误断言（改指向真实体快照）；更新 `packages/app/CONTEXT.md` OAuth 错误契约描述为两种形态并标注一手来源（openwiki/ 由 CI 定时任务重生成，本地不触发）。
2. **差分测试基建（跨引擎一致性保障）**：新增跨引擎差分测试套件，对**同语义纯函数**（R18 判定谓词、URL 重写 web 分支、OAuth 400 错误识别与错误分类）喂同一输入断言**按契约表输出一致或差异符合已记录契约差异**。由于 app 无 vue / lynx 无 SolidJS 依赖隔离，差分测试不能把对端实现 import 进本端 vitest —— 采用「**共享测试数据（契约表/fixture）+ 双端各自测试分别断言**」或独立差分测试包的 seam 形态（见 spec/tickets）。
3. **属性测试基建（fast-check）**：对纯函数模块（`isNewer`、`r18Filter` 谓词、`novelBlocks`、`searchMerger`）写不变量性质测试。fast-check 作为 devDependency。
4. **12 例 truth table 固化为共享测试 fixture**（供 app/lynx 测试共同引用，避免两处拷贝漂移）。**选择：双实现保留 + truth-table 双份同源拷贝 + 字节一致性契约测试守护**（沿 backupRulesConsistency 模式）。理由见替代方案评估「isRestricted」行：差分测试的价值恰恰依赖双实现存在；抽共享实现会消灭差分对象；truth-table 作为跨引擎共享 oracle（期望值来自 x_restrict 契约语义，不来自任一实现）。双拷贝漂移风险由 restrictionTruthTableConsistency.test.ts（readFileSync 逐字节比对）机械消除，两端共同锚定同一 oracle 值
5. **CI 门禁补全**：根 `package.json` 的 `test:all`/`check:all` 补 `--filter @pictelio/update-check`（当前缺口），新增 `test:update-check`/`check:update-check` 别名。
6. **ApiErrorType 枚举值统一（大写对齐 app）**：lynx 枚举小写值改为大写（`network→NETWORK` 等），并修正 2 处字符串字面量硬编码引用（`auth.ts:91`、`authStore.ts:112`）为枚举成员。影响面：仅 lynx `api/types.ts` 7 行 + 2 处引用；lynx 测试全用枚举成员零改动；无跨引擎序列化/持久化风险（idbSet 只存 token/settings）。
7. **mutation 试点（StrykerJS）**：仅 `@pictelio/ugoira` + `@pictelio/update-check`（in-process 纯模块），本地灵敏度门禁，**不进 CI**。mutation score 只当「测试灵敏度/弱断言检测器」，**不当正确性证据**（调研 §6 盲区）。

---

## 替代方案评估

| 决策 | 方案 | 评估 |
|---|---|---|
| OAuth 400 | a) 抽共享错误分类模块（update-check 模式） | 最彻底（单一事实源），但属大重构；先做识别修复（b），共享化后续 |
| | **b) app 补 invalid_grant 识别 + 真实快照测试（选定）** | 低风险、直接修复真实 bug、对齐 lynx 已验证面 |
| 差分基建 | a) 独立差分测试包 `differential-tests` | 隔离 tsconfig/vitest 上下文，但多一个包要维护 |
| | **b) 共享测试数据 + 双端各自断言（选定）** | 避开 vue/solid 依赖隔离，复用两端各自 vitest；契约表即 oracle |
| isRestricted | a) 抽共享纯函数包 | **击败自己的目标**：差分测试依赖双实现，抽共享后只剩一份实现无从差分 |
| | **b) 仅共享 truth-table fixture（选定）** | 最严谨：数据契约单一事实源 + 双实现保留以维持差分价值；truth-table oracle 独立于任一实现 |
| | c) 保持双实现 + 纯差分 | 差分的 oracle 价值保留，但两端各拷贝 12 例矩阵，有矩阵数据漂移风险 |

---

## 影响范围

| 文件 | 改动 |
|---|---|
| `packages/app/src/api/client.ts` | `isOAuthTokenErrorResponse` 补字符串/子串识别 |
| `packages/app/tests/unit/api/client.test.ts` | 修正 invalid_grant 断言 + 真实快照契约测试 |
| `packages/app/CONTEXT.md` | OAuth 400 错误契约描述扩为两种形态 + 来源标注 |
| 差分测试套件 | 新增（R18 谓词 / URL web / OAuth 分类一致性与契约差异断言） |
| 属性测试 | 新增（fast-check，4 模块） |
| `packages/update-check` / app 属性测试 | devDep fast-check |
| 共享 truth-table fixture | 新增 |
| `package.json`（根） | CI 门禁补 `update-check` + 别名 |
| Stryker 配置 | ugoira/update-check 试点（本地） |
| `.gitignore` | 忽略 `viz/`（会话产物） |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 差分测试把「契约差异」误当 bug | 契约表显式记录差异类型，断言「差异符合已记录契约」而非「必须一致」 |
| 跨包 import 依赖隔离（vue/solid） | 采用共享测试数据 + 双端各自断言，避开 import 对端实现 |
| invalid_grant 修复影响 app 存量 | 爆炸半径有限（登出主链路不依赖 body 形态）；测试先行（tdd） |
| fast-check 新依赖（pnpm minimumReleaseAge 1440） | 仅 devDeps；确认包龄满足冷却期 |
| 属性测试的 oracle 也必须可靠 | 性质必须来自问题本身（幂等/round-trip/长度守恒），非实现观察 |
| 枚举大小写 | 差分断言一律用枚举成员而非字面量，规避 |

## 后果

- OAuth 400 真实 bug 修复：app 与 lynx 对同一真实响应一致归类 UNAUTHORIZED，错误提示正确。
- 跨引擎一致性有机器守卫：差分配对的分歧/漂移会在 CI（或本地门禁）暴露。
- 术语统一（glossary-cross-engine.md）成为测试/PR/issue 的共同语言，避免各自造词。
- 属性测试用「不变量」补充具体样例测试对 oracle 的覆盖。
