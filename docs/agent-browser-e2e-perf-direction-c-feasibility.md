# 方向 C「削减 AI 断言」可行性验证报告

> 关联文档：`docs/agent-browser-e2e-perf-analysis.md` 第 3 节 C 项。
> 验证日期：2026-02（agent-browser ^0.34.0，Vitest 4.1）。
> 验证产物（throwaway 原型，用完即删）：`packages/app/tests/unit/prototypes/direction-c/`
> （`assert-inventory.ts` 64 条断言全量清单与分类 / `probes.ts` 确定性断言核心 /
> `verify.test.ts` 判定逻辑验证，67 项断言全部通过，lint/tsc 通过）。
> 原型运行：`cd packages/app && pnpm vitest run tests/unit/prototypes/direction-c/verify.test.ts`

## 1. 结论摘要

**方向 C 可行，且收益高于原文档估算。** 具体判定：

1. **64 条 `aiAssert` 中 55 条（A 34 + B 21）可替换为确定性 DOM 断言**，1 条（s48）因
   语义相关性判断保留 LLM，8 条（X）断言对象在源码中不存在或前提失真、需先修正测试意图。
2. **LLM 调用从 64 次降到 1 次（-98.4%）**；每次断言的外部依赖（snapshot + pageText + LLM
   网络往返 + 默认 2 次重试 × 2s）降为**单次本地 `evaluate`**。
3. **替换后的断言强度在关键语义点不下降**：路由、Tab 激活态、开关状态、标题栏显隐、
   主题切换、对话框开合等 34 条 A 类断言用产品源码逐条核对过的 DOM 信号，判定逻辑经
   正常/异常双态验证（无假阴性、无假阳性）。
4. **8 条 X 类断言暴露测试意图与产品实现的脱节**（详见第 4 节）：LLM 的宽松判定
   （"页面是否正常"）掩盖了这些失真，确定性断言会使其显式失败，倒逼修正测试。
5. **B 类 21 条中约 10 条依赖产品侧新增 `data-testid`**（如主 Feed 插画卡片），
   这是落地前置项，非阻塞性（改动量为每个关键节点加一个属性）。

**落地后预计 C 方向收益：3~5 min**（原文档估算 2~3 min），叠加 A+B 方向后
全量耗时有望按原文档预期从 20~35 min 降到 8~12 min。

## 2. 验证方法与可信度边界

本环境未设置 `PIXIV_REFRESH_TOKEN`，无法真实运行 agent-browser E2E（真实登录 + 真实
Pixiv 网络）。因此验证对象是**断言配方的判定逻辑**：

- 每条可替换断言 = 单行 `evaluate` JS（返回 JSON 可序列化值）+ 纯判定函数（predicate）。
  predicate 只消费 evaluate 返回值字符串，与浏览器解耦，可脱离浏览器验证。
- `verify.test.ts` 对 55 条 A/B 断言各注入两组模拟 DOM 状态：
  - 正常状态 → predicate 通过（验证无假阴性）；
  - 异常状态 → predicate 失败（验证无假阳性）。
- 探测表达式中的选择器、aria-label、文本、class 均来自 `packages/app/src` 源码逐条核对
  （每条在 `assert-inventory.ts` 的策略栏标注源码位置），非臆造。

**未覆盖部分（需真实环境首验）**：
- s17（无效 token 错误提示）依赖 ErrorDisplay 的实际渲染文本，错误 message 为动态值，
  落地时需一次真实运行固化信号；
- s40/s41（关注/粉丝列表）空列表分支当前产品无空态文本，落地需处理该分支；
- s30/s31（标题栏显隐）的滚动阈值触发依赖运行时行为，原型只验证判定逻辑，不验证时序。

## 3. 64 条断言分类与收益量化

### 3.1 分类结果

| 分类 | 数量 | 含义 | 分布 |
|---|---|---|---|
| A | 34 | 可直接替换：路由 / aria-current / aria-label / switch.checked / classList / 静态文本 | sub-flows s5-8, s12, s14-15, s22-27, s30-31, s34-36, s38-46, s49；main-flow m1, m6-9, m13 |
| B | 21 | 可替换：需产品加 data-testid，或正文/无错误类语义弱化（正确性下沉单测） | sub-flows s1-2, s4, s9-11, s13, s17-20, s28-29, s47, s50；main-flow m2-3, m10-12, m14 |
| X | 8 | 断言对象在源码中不存在或前提失真，需先修正测试意图 | sub-flows s3, s16, s21, s32-33, s37；main-flow m4-5 |
| C | 1 | 保留 LLM：标签内容与作品相关的语义判断 | s48 |

完整逐条清单（含每条的原描述、替换策略、源码证据、保留理由）见
`assert-inventory.ts`，此处不重复。

### 3.2 收益量化

| 指标 | 现状 | 替换后 | 变化 |
|---|---|---|---|
| LLM 调用次数 | 64 | 1（s48） | **-63（-98.4%）** |
| 每次断言 spawn 次数 | 2~3（snapshot + pageText，waitForPageContent 轮询另计） | 1（单次 evaluate） | -55 条 × 1~2 次 |
| 外部网络依赖 | 每断言一次 DeepSeek API（默认重试 2 次 × 2s 间隔，30s 超时） | 无 | 消除 |
| 失败重试放大 | aiAssert 重试 + vitest retry:2 叠加，flake 即 ×2~3 | 确定性断言失败即精确报出 | 消除 |
| 预计耗时 | 64 × (snapshot 0.5~2s + LLM 1~3s) ≈ 3~5 min | 55 × evaluate 30~150ms ≈ 0.1 min | **约 3~5 min** |

说明：B 类中正文渲染（s10/s11/m11/m12）与"无渲染异常"（s19/s20/m3）为弱化断言——
"正文非空/无错误文本"，pretext 渲染正确性、卡片去重等强语义由现有单元测试
（如 `novelTextLayoutCache` 相关测试）承担，符合测试分层，不构成覆盖缺口。

## 4. 关键发现：8 条 X 类断言（测试与产品脱节）

以下断言对象在 `packages/app/src` 源码中**不存在或与产品现状不符**。当前 LLM 断言
（prompt 为"页面是否正常"）对这些失真要么宽松放行、要么不稳定地失败重试，二者都掩盖问题。

| id | 原断言意图 | 源码现状 | 处理建议 |
|---|---|---|---|
| s3 / m4 / m5 | 「漫画/综合」子 Tab 切换 | `ContentTypeToggle.tsx:11-14` 只有「插画 / 小说」，src 无「综合/漫画」；`clickReliable("漫画")` 找不到目标 | 删除或用「小说」切换断言替代 |
| s16 | 登录成功跳 `/recommended` | `router.tsx` 无 `/recommended`，登录后落 `/home` | 改为断言 `pathname === "/home"` |
| s21 | 关注 Tab 后 URL 含 `/following` | 关注是 `/home` 下面板（`SideNavShell.tsx:37-39`），URL 不变 | 改为断言主导航「关注」aria-current=page |
| s32 / s33 | 关注页有「全部/公开/非公开」筛选 | `FollowListPage.tsx` 全文无筛选按钮，src 全局无「公开/非公开」 | 删除或补产品功能后重写 |
| s37 | 设置页可切换布局模式 | ADR-0075 已移除布局切换器，`clickReliable("瀑布流")` 找不到，用例实际空转 | 删除用例 |

另发现：主 Feed（L5 单列，`HomePage.tsx:344` → `IllustSingleCard`）**无 `.image-card`**
class，现有 `waitForSelector(".image-card")` 仅在骨架屏（`SkeletonCard.tsx:19`）短暂命中，
`clickFirst()` 的 CSS 分支必然落空、回退到 snapshot ref 点击——这是既有 flake 源，
与方向 C 无关但同属"测试与产品结构脱节"，建议一并修正。

## 5. 四维度分析

### 5.1 高可维护性

- **断言可读、可 review、可静态审查**：确定性断言是"选择器 + 判定"的显式代码，
  失败时 `failMessage` 精确指出失败点；LLM 断言的 reason 是自然语言，
  且"页面是否正常"的宽泛标准无法回答"哪一步错了"。
- **消除外部依赖**：spec 不再需要 `DEEPSEEK_API_KEY`、不再受 DeepSeek 限流/断网影响，
  CI 失败原因从"LLM 抖动"收敛为"真实断言失败"。
- **暴露并修正失真测试**：8 条 X 类断言在确定性断言下立即失败，迫使测试意图与产品
  对齐（修正或删除），从根上消除 6 个"空转用例"（s33/s37/m4/m5 等 `if (!ok) return`
  分支使用例无断言执行，属测试死代码）。
- **代价**：落地需为 B 类约 10 条加 `data-testid`（产品侧每节点一个属性，无逻辑改动）；
  正文类断言弱化后，其强语义验证责任移交现有单元测试——需在落地 PR 中确认对应单测
  存在（当前 `novelTextLayoutCache` 等已有覆盖）。

### 5.2 高性能

- **LLM 调用 64 → 1（-98.4%）**，每次断言从"2~3 次 spawn + 1 次 LLM 网络往返（+ 默认
  2 次重试 × 2s 间隔 + 30s 超时）"降为"1 次本地 evaluate（30~150ms）"。
- **消除重试放大链**：aiAssert 重试与 vitest `retry: 2` 叠加，一次 flake 放大 ×2~3；
  确定性断言失败即精确报出，不再触发 LLM 重试。
- **耗时可预测**：确定性断言无外部网络，单条耗时上界 = evaluate spawn 耗时，
  不再受 GFW/代理波动影响（文档第 0 节强调的对照污染源之一被消除）。
- 预计收益 3~5 min（超过原文档估算的 2~3 min，因 X 类失真用例不再消耗 LLM 重试）。

### 5.3 高安全性

- **消除页面内容外泄面**：当前 `aiAssert` 把 `snapshot`（accessibility 树，含页面全部
  交互元素与文本）+ `pageText`（`document.body.innerText`，含用户名、作品标题、关注
  列表等用户数据）发送到第三方 DeepSeek API。替换后页面内容不再离开本机。
- **消除第三方密钥依赖**：spec 不再使用 `DEEPSEEK_API_KEY`，减少密钥在 CI/本地环境的
  暴露面。
- **不新增注入面**：确定性断言使用的 `evaluate` 注入 JS 全部为测试代码内的静态字符串
  （无用户输入拼接），与现有 `driver.evaluate` 生产测试用法一致；探测表达式为只读
  查询（无 `click()` 等副作用），不改变页面状态。

### 5.4 低内存占用

- **断言相关内存占用显著下降**：当前每次 `aiAssert` 在测试进程构造并持有完整的
  `snapshot` 大字符串（accessibility 树，通常数十 KB）+ `pageText` + LLM prompt body +
  响应缓冲；替换后每次断言只持有单次 `evaluate` 的小 JSON 返回值（数十字节~数百字节）。
- **并行压力缓解**：全量 5~6 个 Chrome + 5~6 个 daemon 并行时，测试进程的字符串持有
  减少可降低 GC 压力与峰值堆占用。
- **诚实边界**：内存收益为测试进程侧、量级在 KB~MB 级，不改变 5~6 个 Chrome 的
  主导内存占用（图片解码/渲染进程是内存大头，需方向 E 图片降载解决）；LLM 调用是
  测试进程内的 fetch，不新增独立进程。故内存是次要收益，主要收益在时间与确定性。

## 6. 落地步骤（按顺序，每步可独立提交）

1. **产品侧前置（一次性，小改动）**：为 `IllustSingleCard`、小说卡片（主 Feed 行卡）、
   `ImageCard` 等关键节点补 `data-testid`（如 `illust-card` / `novel-card` /
   `illust-title`），并在落地 PR 中同步更新 `assert-inventory.ts` 的 B 类探测表达式。
2. **X 类修正（第 4 节）**：删除 s3/s32/s33/s37/m4/m5 失真断言（或按产品现状重写），
   修正 s16/s21 断言前提。此步独立于性能目标，属测试健康化。
3. **A 类替换（34 条）**：逐条将 `aiAssert(...)` 替换为 `evaluate` + `expect`，每替换
   一条跑对应 describe 单文件验证通过率（用例名即验收点，原 42~43 个用例须全部通过）。
4. **B 类替换（21 条）**：先完成步骤 1 再替换；s17 需一次真实运行固化错误提示信号。
5. **清理**：`assertion.ts` 中 `aiAssert` 保留仅服务 s48（或在 s48 也降级后整体移除）；
   删除本原型目录 `tests/unit/prototypes/direction-c/`。
6. **回归**：`pnpm test:agent-browser` 全量跑通，对比耗时并更新
   `docs/agent-browser-e2e-perf-analysis.md` 第 2 节耗时画像。

## 7. 限制与风险（诚实声明）

1. **未做真实浏览器验证**：判定逻辑已双态验证，但探测表达式在真实 DOM 上的行为
   （选择器匹配、web component 属性序列化如 `fluent-switch.checked`、UnoCSS class
   生成）需在具备 `PIXIV_REFRESH_TOKEN` 的环境按步骤 3/4 逐条首验。
2. **断言强度弱化点**：正文渲染（s10/m11）与"无渲染异常"（s19/s20/m3）为弱化断言，
   依赖单元测试补强；若团队认为 E2E 必须覆盖 pretext 渲染正确性，可保留这 3~4 条 LLM
   断言（LLM 调用 64 → 4，收益仍达 -93.75%）。
3. **`fluent-switch` 属性读取**：s23/s25/s26/s27 读取 `el.checked` property，FAST 组件
   属性反映行为需在真实环境确认；若不可靠，可改读 `aria-checked` attribute。
4. **空态分支**：s40/s41 空列表无空态文本，账号无关注/粉丝时会假阴性，需产品补空态
   文本或测试注入 mock 数据。
