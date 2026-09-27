# spec: app-lynx 翻译 store 测试确定性（flaky 收口）

- 状态：待实施（`ready-for-agent`）
- Tracker：[#758](https://github.com/a1121611810/Pictelio/issues/758)
- 日期：2026-09-27
- 取证与证据：`docs/research/flaky-novel-translate-store-diagnosis.md`（诊断报告，含 CI run 36239607963 与本机复现画像）
- 关联：ADR-0171（翻译缓存/半成品策略）、ADR-0178（重试与 partial UI；PR #662 补 `reset()` abort）、ADR-0097（期望值溯源）、`docs/specs/app-lynx-novel-translation.md` §9.8（in-flight 复用正条）

## Problem Statement

维护者在 main 上反复被同一件事打断：一笔**与翻译毫无关系**的提交（例如只改文档）会把 CI 的 Unit tests job 推红，红窗口约 20 分钟，且报错文本指向翻译 store 的单测。本地复跑同一测试却全绿——「本地绿、CI 红」让维护者无法用本地证据判断自己有没有改坏东西，也迫使每笔提交都要等一轮 CI 才能确认。发布路径同样被牵连：CI 红就无法安心发版。

根因已在诊断报告中实证：失败断言全部位于「**固定墙钟 `sleep(10/20ms)` 之后立即读取 store 状态 / provider 调用计数**」这一形态上。provider 启动前 store 要穿过一段真实 I/O（fake-indexeddb 四次 `indexedDB.open`），9 包并行的过订阅量级下这段会超过预算。这是**测试观察点选取错误 + 缺少收尾隔离**，不是 store 的 abort / 去重语义错误。其中 `expected 3 to be 2` 是连锁污染：前一个用例断言失败导致其收尾不可达，泄漏的 invocation 在下一个用例的窗口里才启动 provider。

## Solution

把该 describe 块的 6 个用例改造成**对 provider 前真实 I/O 延迟免疫的确定性测试**：等待条件而非固定睡眠、断言失败也收尾在飞请求、计数断言按标识映射。并用**同一个既有 mock 接缝**注入恶意延迟，把「谁再写回墙钟等待」变成**确定性红灯**——概率性 flake 转成确定性门禁。

生产代码零改动：翻译状态机（in-flight 复用、abort、generation-gate）语义一字不变。

## User Stories

1. 作为维护者，我希望该 describe 块在 9 包并行的负载下也确定性通过，so that 一笔无关提交不再把 CI 推红。
2. 作为维护者，我希望断言失败时用例仍然收尾 in-flight 请求，so that 一个用例的失败不会污染后续用例的计数与状态。
3. 作为维护者，我希望计数类断言按标识（章节）映射而不是按调用序号映射，so that「多调一次」以失败形式暴露，而不是被静默吞掉。
4. 作为维护者，我希望等待用条件等待而非固定睡眠，so that 测试结论只取决于被观测行为是否发生，与机器快慢无关。
5. 作为维护者，我希望「恶意时序守卫」在有人重新引入固定墙钟等待时立刻红，so that 这类 flake 不会靠人自觉来防。
6. 作为维护者，我希望该守卫使用**既有** mock 接缝（不新增接缝、不改生产代码），so that 修复本身不引入新的架构面。
7. 作为未来接手这段代码的 agent，我希望 `TESTING.md` 有异步测试确定性的硬约束条文，so that 新写测试有据可依、评审有据可查。
8. 作为维护者，我希望 describe 标题引对规格章节（`§9.8`，现为 `§9.6`），so that 期望值与规格的溯源链正确（ADR-0097）。
9. 作为维护者，我希望本轮修复面被严格限定在该 describe 块，so that 翻译状态机零回归风险、改动可一次评审完。
10. 作为发布负责人，我希望该文件在 CI 上连续多次绿，so that 发版不被 flaky 阻断。
11. 作为维护者，我希望「修前必红、修后必绿」的确定性证据（注入延迟下），so that「已修」不依赖「跑了 N 次没复现」这种概率论证。
12. 作为维护者，我希望生产竞态候选（`store:690`→`719` 无 gen/aborted 闸门）被登记成独立票并附复现要求，so that 它不被遗忘、也不在本轮被无证据地顺手改掉。
13. 作为维护者，我希望跨文件同类风险面（S1 12 例 + S2 12 例）有清单票，so that 后续可排期处理而不塞进本轮。
14. 作为维护者，我希望本轮明确不做 CI `retry` 与测试 quarantine，so that 真回归不会被重试掩盖、防线不被削弱。
15. 作为维护者，我希望不引入 test-only API 到生产文件，so that 生产接口不被测试需求污染。
16. 作为维护者，我希望 webview 端 `translationStore`（另一套栈）不受影响，so that 双端边界保持清晰。
17. 作为维护者，我希望验收在「能复现的负载窗口」内执行，so that 验收结论不被安静窗口的假绿误导。

## Implementation Decisions

- **收口范围**：该 describe 块的全部 6 个用例（不是只修 CI 见过的那 2 个）。诊断已证明同块第 3 例（P2 delta gate）同样会 flaky，CI 只是尚未见过。
- **同步点**：把固定墙钟等待替换为条件等待——等到被观测事实发生（provider 被调用到期望次数、观测值非空、状态到达目标态）或超时。**不引入假定时器**：这里的等待源是真实 I/O（IDB / 桥），不是时钟推进，假定时器无法替代。
- **收尾隔离**：所有涉及 in-flight 的用例改为 `try/finally`，断言失败路径也必须结束挂起迭代器并 `await` 在飞 promise，杜绝「失败即泄漏」。
- **计数断言**：provider mock 的分发改成按标识（章节 id）映射，额外的第三次调用必须可见（当前按序号 `第 1 次→d1、其余→d2` 会把异常静默吞掉）。
- **恶意时序守卫**：该块以「provider 前 I/O 延迟」为参数做参数化，至少在「正常」与「恶意延迟」两档下断言同一批行为。延迟由该文件**已有**的翻译缓存 mock 以 deferred 方式注入（它是 provider 启动前最后一个 await），因此**不新增接缝、不改生产代码**。
- **溯源修正**：describe 标题 `spec §9.6` → `spec §9.8`；把「provider 调用次数」期望的条文出处补进注释（正条是 §9.8 的语义：同章节复用、不同章节并行，次数是派生可观测量）。
- **观测口径**：断言只通过公共 API（`status` / `displayParagraphs` / `isCached` / provider mock 的调用序列）观测，不读 store 内部数据结构。
- **文档条文**：在测试约定文档中新增「异步测试确定性」硬约束：单测禁止固定墙钟等待；断言失败路径必须收尾在飞异步；计数类断言必须按标识映射，禁用序号映射。
- **明确不做**：CI `retry`、测试 quarantine、机械式 lint 门禁（本轮先靠守卫 + 条文）、任何生产代码改动。
- **验收口径**：主证据是「注入延迟下修前必红、修后必绿」（实施时先跑守卫在旧断言上取红，再改测试取绿，两份输出都留档）；辅证据是负载窗口内全量套件重复跑零失败；收尾证据是合并后 CI 连续多次绿。

## Testing Decisions

- **好测试的判据**：断言外部可观测行为——状态机迁移、provider 被调用的章节序列与次数、abort 是否作用于 store 自己的 controller；不依赖「多久之后」这类与机器速度耦合的条件，也不探针 store 内部实现。
- **被测模块**：lynx 翻译 store 的 in-flight 复用 / abort / generation-gate 行为，经其公共 API 驱动。
- **新增守卫**：注入延迟的同一批断言（把 provider 前的 I/O 变慢若干倍，行为断言必须不变）。它同时是回归防线：任何重新引入的固定等待都会让它确定性失败。
- **先例（prior art）**：同文件既有的 provider mock 接缝（透传 signal 的 `translate` 桩）；同包 `primitives/createNovelTranslator` 的挂起迭代器 + abort 断言写法；该文件既有的缓存/设置 module mock；webview 端 store 测试的查询 mock 模式仅作对照，不共享代码。
- **测试基线**：`docs/specs/app-lynx-novel-translation.md` §10.1 的测试基线表中「并发去重」「缓存写策略（三态钉死）」两行即为本块断言的规格出处。

## Out of Scope

- 跨文件同类风险面（S1「并行/复用 + 调用计数断言」12 例、S2「abort/generation 竞态」12 例）——登记为独立票，附清单。
- 生产竞态候选（取消落在「最后一个 await」与「创建 controller」之间时仍外发请求 + `++gen` 反转新旧 invocation）——独立票，且该票必须先做出确定性复现再谈修法，需 ADR。
- webview 端 `translationStore` 及其测试（另一套栈）。
- CI `retry` / quarantine / 机械 lint 门禁。
- 同文件本 describe 块之外的用例（无实证 flaky 证据）。

## Further Notes

- **复现画像（验收必须在此窗口内做）**：隔离条件（单文件全量、单文件 6 路并发、加 CPU 烧机、单包全量、2 包并行）共 47 次全绿；CI 同款全量套件并行跑 10 次失败 3 次。触发因素是整体过订阅量级，不是单进程缺 CPU；安静窗口复核 4 次全绿。因此「跑 N 次都绿」在安静窗口**不构成证据**，验收须在负载窗口内或直接用注入延迟的确定性证据。
- **失败签名（3 例，同一 describe 块）**：S1 用例 `captured === null`；并行用例 `3 ≠ 2`（连锁污染）；P2 delta gate `'pending' ≠ 'translating'`。前两例与 CI 报错逐字一致。
- **关键位置指针**（实现时以源码为准）：store 的 in-flight Map 与 `reset()`/`abort()` 定义、provider 启动前的两个 await、缓存与端点元数据读取路径；测试文件的 describe 块、`makeDeferredIterator` 辅助、模块 mock 定义区。
- **连带收益**：pre-push 的 app-lynx 域门禁在触碰该包时跑该包全量单测（实测不复现此 flake），修好后本地推送也彻底不受牵连。
- **本块用例数与运行时**：参数化会把该块用例数翻倍，单文件运行时增加量级为数百毫秒，远低于单测超时预算。
