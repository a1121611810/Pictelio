# 提速方向 B（固定 SLEEP → 条件等待）可行性实测报告

> 状态：实测完成。本报告回答 `docs/agent-browser-e2e-perf-analysis.md` 第 3 节「方向 B」的
> 可行性问题，并按 **高可维护性 / 高性能 / 高安全性 / 低内存占用** 四个维度给出结论。
> 配套一次性原型：`packages/app/tests/agent-browser/prototype/`（含 `sleep-vs-wait.prototype.test.ts`
> 与 `waitFor.ts`，不进正式套件 include，标记为 PROTOTYPE）。
> 实测日期：2026-08-14；agent-browser 0.34.0（项目本地依赖），Vitest 4.1.10。

## 0. 结论摘要（TL;DR）

1. **方向 B 可行**：131 处 SLEEP 中，按站点数 66.4%（87/131）可**语义等价**替换为条件等待
   或直接删除，按等待时长占 **78.8%**（298.5s / 378.8s）；若把动画类等待从 1.5~2s 缩短到
   0.5s，可处理面扩大到站点 88.5%、时长 92.2%。
2. **实测收益**：6 个代表性场景中条件等待合计 **1.17s** vs 现状固定 SLEEP 合计 **17.5s**
   （**节省 93.3%**，单场景 88.5%~98.3%）：登录后 Feed 就绪由固定 3s 降到实测 **64ms**，
   滚动加载由固定 4s 降到实测 **780ms**，页面导航类由固定 3s 降到实测 **51~53ms**。
3. **风险可控**：超时上限兜底实测 **3049ms** 返回 `false`（timeout=3000，不悬挂）；
   轮询探测走 `eval`（单次实测 **44ms**）而非 `snapshot`（42ms），wall 时间相当，
   但返回负载从 ~100KB 降到 ~10B（见 4.4）。
4. **不推荐用原生 `agent-browser wait` 替代轮询**：`wait --text` 三度实测对页面已存在
   文本超时（25.1~25.8s），`wait --fn false` 默认阻塞 **25964ms** 且无 per-call
   `--timeout`，超时与命令异常同为 exit 1 无法区分（见 3.4）。

---

## 1. 方向 B 是什么（原文引用 + 本报告的操作化定义）

> 原文（分析文档第 3 节 B）："把'等数据/等组件'的 `SLEEP` 替换为
> `waitForSelector` / `waitForPageContent`（可带超时上限兜底），坏路径从固定上限变为
> 数据就绪即返回。`waitFor*` 内部轮询间隔 1s 改为可配置（300~500ms）。"

本报告将其操作化为三个可验证子项：

| 子项 | 内容 | 验证方式 |
|---|---|---|
| B-1 替换 | 有确定性条件的 SLEEP → 条件等待原语（selector/text/URL/JS 谓词） | 原型 S1~S6 实测 |
| B-2 间隔 | `waitFor*` 轮询间隔 1s → 300~500ms（可配置） | 原型 S11 实测粒度开销 |
| B-3 兜底 | 条件永不满足时必须在超时上限内返回，不悬挂 | 原型 S7 实测 |

**不改变**：`createLoggedInDriver` 的登录阶段循环结构（属于方向 A 的会话复用范畴）、
LLM 断言的重试参数（方向 C）、进程 spawn 模型（方向 D）。

---

## 2. 静态分析：131 处 SLEEP 的逐行分类

对 6 个 spec + fixtures + driver 共 **131 处 `SLEEP()`**（合计 **378.8s** 固定等待）
逐行审查，按等待语义分为 5 类（分类依据：该行前后代码能否提供确定性轮询条件）：

| 类别 | 判定标准 | 站点数 | 占比(站点) | 时长 | 占比(时长) |
|---|---|---|---|---|---|
| **R 可替换** | 存在确定性 DOM/URL/文本/JS 谓词可轮询，替换后语义等价 | 70 | 53.4% | 240.5s | 63.5% |
| **D 可删除** | 同一逻辑后续已有 `waitFor*`/`getState→waitForPageContent` 覆盖，纯冗余 | 17 | 13.0% | 58.0s | 15.3% |
| **S 可缩短** | 动画/输入稳定类，无稳定轮询条件，1.5~2s 过长，可缩至 0.5s | 29 | 22.1% | 50.8s | 13.4% |
| **I 轮询间隔** | 循环探测内 sleep 间隔，1~2s → 300~500ms | 15 | 11.5% | 29.5s | 7.8% |
| **K 保留** | 重试退避（launch 重试、LLM 网络），必须保留 | 3¹ | — | 6.0s | — |

¹ 3 处为 `setTimeout` 形式（sub-flows 235/297 与 fixtures 66 的 launch 重试退避），
不在 131 处 `SLEEP()` 计数内，另计。

**关键数字**：R+D 合计 **87/131 站点（66.4%）**、**298.5s（78.8%）** 可在不改断言语义的
前提下移除；R+D+S 合计 **88.5% 站点 / 92.2% 时长**。即方向 B 的收益面不是"部分场景"，
而是覆盖固定等待总时长的 **近 8 成可全部消除、再 1 成以上可缩短**。

### 2.1 各文件分布

| 文件 | SLEEP 站点 | 总时长 | R | D | S | I | 备注 |
|---|---|---|---|---|---|---|---|
| sub-flows.test.ts | 80 | 238.0s | 51 | 14 | 12 | 3 | 10 处 beforeAll 冗余 + 4 处被后续 waitFor* 覆盖 |
| main-flow.test.ts | 16 | 45.0s | 11 | 0 | 4 | 1 | |
| adaptive-tags-240.test.ts | 12 | 50.5s | 3 | 2 | 5 | 2 | 含 6s/7s/8s 大等待，多数可替换 |
| translation-flow.test.ts | 10 | 17.8s | 1 | 1 | 4 | 4 | 已有循环轮询，仅需降间隔 |
| update-flow.test.ts | 8 | 18.5s | 2 | 0 | 3 | 3 | |
| fixtures.ts | 5 | 9.0s | 2 | 0 | 1 | 2 | 登录循环间隔 |
| driver.ts | 3(间隔) | — | — | — | — | 3 | waitFor* 硬编码 1s 间隔 |

### 2.2 可替换性的典型映射（R 类抽样，全表见附录 A）

| 现状 SLEEP | 替换为 | 条件 |
|---|---|---|
| sub-flows:36 登录后 `SLEEP(3000)` | `waitForJs(img 数量 > 0 \|\| 「暂无内容」\|\| 「加载失败」)` | Feed 进入稳定态（主 Feed 为 L5 单列，无 `.image-card`，ADR-0075） |
| sub-flows:84 点卡片后 `SLEEP(5000)` | `waitForUrl("/illust/")` | 路由进入详情页 |
| sub-flows:435 navigateSpa 后 `SLEEP(3000)` | `waitForSelector('fluent-switch[aria-label="启用图床代理"]')` | 主开关渲染 |
| sub-flows:388 滚动后 `SLEEP(4000)` | `waitForCount("img", n0+1)` | 整页滚到底后 img 数量递增（分页触发） |
| sub-flows:275 登录点击后 `SLEEP(8000)` | `waitForText("推荐")`（登录 markers） | 主界面出现 |
| update:111 检查更新后 `SLEEP(4000)` | `waitForText("发现新版本")` | 弹窗出现 |

**不可替换的边界**（S 类）：收藏/取消收藏后的按钮状态变化、小说标题栏随滚动渐显的
动画、双击回顶的滚动动画、开关切换后的对话框关闭过渡——这些是"事件已触发但 UI 仍需
动画收敛"的场景，没有稳定的可轮询谓词（或谓词成本高于直接短等），统一缩短到 0.5s
（Fluent 最长动效 500ms，见 AGENTS.md 动效规范）。

---

## 3. 实测数据（原型实验）

### 3.0 实验方法

- 真实登录（PIXIV_REFRESH_TOKEN，同一台机器、同一网络、同一次运行内完成全部场景；
  登录实测 **9062ms**/次，与方向 A 的会话复用收益正交）。
- 每个场景对比：① 现状固定 SLEEP（实测墙钟）② 条件等待（300ms 轮询，实测墙钟）。
- 全部为确定性 DOM/URL/文本断言，不调用 LLM，排除 AI 波动。
- 负例（S7）验证超时兜底不悬挂；S8/S9/S11 分别验证原生 wait 命令、
  spawn 基线、轮询粒度。

### 3.1 场景对比结果（最终一轮，10/10 通过）

| 场景 | 对应现状代码 | 固定 SLEEP 实测 | 条件等待实测 | 节省 | 条件 |
|---|---|---|---|---|---|
| S1 登录后 Feed 就绪 | sub-flows:36 | 3002ms | **64ms**（1 轮） | **+2938ms（97.9%）** | img 出现 /「暂无内容」/「加载失败」 |
| S2 navigateSpa(/image-host) | sub-flows:435 | 3001ms | **52ms**（1 轮） | **+2949ms（98.3%）** | 主开关渲染 |
| S3 navigateSpa(/me) | sub-flows:758 | 3001ms | **53ms**（1 轮） | **+2948ms（98.2%）** | 「我的作品」文本 |
| S4 navigateSpa(/debug) | sub-flows:889 | 3000ms | **51ms**（1 轮） | **+2949ms（98.3%）** | 「图片加载调试」标题 |
| S5 滚动加载更多 | sub-flows:388 | 4000ms | **780ms**（3 轮） | **+3220ms（80.5%）** | img 数量递增（整页滚到底触发分页） |
| S6 开关弹窗出现 | sub-flows:464 | 1502ms | **173ms**（1 轮） | **+1329ms（88.5%）** | 「开启图床代理？」文本 |
| **合计** | — | **17506ms** | **1173ms** | **+16333ms（93.3%）** | — |

> S1/S2/S3/S4/S6 五场景**首次探测即命中**（polls=1）：这些代码路径的 SLEEP 属于
> 纯冗余——页面在 sleep 开始前已就绪，条件等待把「固定 1.5~3s 空等」降为
> 「1 次 spawn 探测 ~45-65ms」。
> **S5 的重要修正**：首两轮用 `driver.scroll("down", 2000)`（滚窗口）img 数 15s 不递增
> （条件诚实超时）；改为 `window.scrollTo(0, document.body.scrollHeight)`（整页滚到底、
> 触达 `FeedPaginationSentinel`）后 780ms 即递增。说明① 该场景的正确锚点是
> 「分页触发后新卡片出现」而非 img 数量本身（img 懒加载会滞后）；② 条件等待会把
> 「滚动方式不对/分页未触发」显式暴露为超时，而固定 SLEEP 会静默"假通过"后把问题
> 留给 AI 断言去猜。

### 3.2 超时兜底（B-3）

| 场景 | 结果 |
|---|---|
| S7 `waitForSelector("#never-exists", {timeout:3000})` | 实测 **3049ms** 返回 `false`（8 次轮询），不悬挂 ✅ |

> 超时语义精确：`timeout=3000` 时约 3000 + 1 次轮询周期（≈300ms 间隔 + ~45ms 探测）后
> 返回 `false`，与"条件满足即返回"是同一套路径，只是结果不同。不存在悬挂风险。

### 3.3 spawn 与轮询基线（B-2 的成本侧）

| 场景 | 实测 |
|---|---|
| S9 `eval` 单次 spawn | 平均 **44ms**（5 次：63/39/39/38/39） |
| S9 `snapshot` 单次 spawn | 平均 **42ms**（5 次：44/40/42/39/43） |
| S11 条件已满足时 interval=300 返回延迟 | **76ms**（1 轮） |
| S11 条件已满足时 interval=1000 返回延迟 | **41ms**（1 轮，噪声范围内） |

> **S11 结论（实测支撑）**：当条件**在轮询开始前已满足**，interval 不影响返回延迟
> （两者都是 1 轮 ~45-75ms，差异为噪声）。interval 只在"条件在两次探测之间变为真"
> 时有意义：此时返回延迟 = 上次探测时刻 + interval + 探测开销，即**额外等待上限为
> interval**（300ms vs 1000ms → 差 700ms 的尾延迟）。因此 B-2 把间隔从 1s 降到 300ms
> 的价值在"等待期最长 1s 粒度"→"300ms 粒度"，对单次等待是 0.7s 级、对累计
> 数百次等待是分钟级（静态 I 类 15 处 + driver 3 处轮询共用）。
> 一个 300ms 间隔的轮询周期实际约 **345~355ms**（300ms sleep + ~45ms 探测 + 调度误差）。

### 3.4 原生 `agent-browser wait` 命令（不推荐替代轮询的依据）

| 场景 | 实测 |
|---|---|
| `wait --fn "1===1"`（条件已满足） | **39ms**，status=0（单次 spawn 即返回） |
| `wait --fn "false"`（默认超时） | 阻塞 **25964ms**，status=1（默认约 25.96s，无 per-call `--timeout`） |
| `wait --fn "false"` + `AGENT_BROWSER_DEFAULT_TIMEOUT=2000` | **2816ms** 返回，status=1（env 可兜底，但超时与异常同为 exit 1） |
| `wait --text "推荐"`（页面含该文本） | **25067ms** 超时，status=1（**三轮实测复现**：25.07s/25.16s/25.81s，文本在页面却匹配不到） |

**结论（实测支撑）**：
1. `wait --fn` 在条件已满足时确实便宜（单次 spawn ~40ms），可作为方向 D（batch/spawn
   削减）的候选。
2. **`wait --text` 在本版本（0.34.0）实测不可靠**：三轮均对页面已存在的文本超时
   （25.07~25.81s），疑似其文本探测源与页面实际内容不一致。不可用作替代。
3. 原生 `wait` **没有 per-call `--timeout`**，默认阻塞 ~26s；`AGENT_BROWSER_DEFAULT_TIMEOUT`
   可全局兜底，但**超时与命令异常都返回 exit 1**，无法区分"条件未满足"与"命令失败"。
4. 因此方向 B 的落地形态应保留**测试进程侧 JS 轮询**（可精确控制超时/间隔/返回值），
   原生 `wait` 只适合方向 D 的"已知会快速满足"的单次探测场景。

---

## 4. 四维度分析

### 4.1 高可维护性

**结论：净正向，但要求"统一原语 + 语义锚点"纪律，否则会退化为散落的字符串谓词。**

正向因素（可量化）：
1. **消除魔法数字**：`SLEEP(3000)` 不表达任何意图；`waitForSelector(".image-card")`
   直接声明依赖（"等卡片渲染"）。测试即文档。131 处 SLEEP 中有 87 处（R+D）具备
   明确可声明的依赖条件，替换后每个等待调用点都能自解释。
2. **单一配置点**：轮询间隔/超时收敛到 driver.ts（或共享 helper）一处，而非每个
   spec 顶部各自 `const SLEEP = ...`。改间隔只动一处（现状是 6 个文件各定义一遍）。
3. **消除重复样板**：17 处 D 类（beforeAll `SLEEP(3000)` 等）是与后续
   `getState→waitForPageContent` 重复的冗余等待，删除后 describe 结构更干净。
4. **失败信息更好**：条件等待超时后可在谓词层输出"等了 10s 仍无 X"的定位信息
   （本原型 pageDiag 已验证该模式），比"SLEEP 后断言失败"的排查路径短。

代价与纪律（必须写明，否则维护性反而变差）：
1. **谓词耦合页面实现**：`waitForSelector(".image-card")` 绑死 class 名——本实验
   就踩了坑：主 Feed 已是 L5 单列（ADR-0075）`IllustSingleCard`，`.image-card` 早已
   不在首页 DOM 中，按旧选择器写条件会**静默等满超时**。纪律：优先用稳定锚点
   （URL、语义文本、`aria-label`、`data-*`），class 只作为最后手段；页面结构变更
   必须同步审查测试谓词（与 AGENTS.md「重构行为不变约束」对齐）。
2. **S 类不可强轮询**：动画收敛类（对话框关闭、标题栏渐显、双击回顶）没有稳定谓词，
   强行轮询会引入"轮询永假→等满超时"的新坏味道。这些保留短 sleep（0.5s）并注释原因。
3. **原语层需文档化**：waitForText/Count/Url/Js 各自的契约（超时默认值、转义规则、
   单行 JS 约束——agent-browser `eval` 不支持多行）要写进 `tests/agent-browser/TESTING.md`。

### 4.2 高性能

**结论：方向 B 是四方向中收益确定性最高的一项，且"快路径更快、慢路径更稳"双向受益。**

1. **实测单点收益**：S1~S6 六场景，条件等待 51~780ms vs 固定 1500~4000ms，
   节省 80.5%~98.3%（合计 93.3%）。其中 S1/S2/S3/S4/S6 五场景是"页面已就绪但仍空等"
   的纯浪费，替换后几乎归零（单次探测 51~173ms）。
2. **静态可算总量**：R+D 类时长 298.5s / 总 378.8s = **78.8% 固定等待可移除**；
   R 类替换后等待时长 = 真实数据就绪时间（通常 <1s）而非固定上限；S 类 29 处从
   1.5~2s 缩到 0.5s 可再省 ~29s；I 类间隔从 1~2s 降 300~500ms 在登录循环上
   （21 次登录 × 每次 2~3 轮探测）保守再省 20~60s。
3. **慢网络场景（GFW/代理）是最大隐性收益**：固定 SLEEP 在数据 5s 才到时**必然不足**
   （3s 后断言失败 → aiAssert 重试 2 次 × 2s 间隔 + vitest retry 2 → 一次抖动放大
   3 倍墙钟）。条件等待在该场景自动延长等待直至就绪，**从根上消除"固定等待不够"
   这类 flake**——这是性能与稳定性的复合收益。
4. **轮询成本已量化**：每轮 ~350ms（300ms 间隔 + 45ms 探测 + 调度误差）；数据 1s
   就绪的场景净省 ~1.7s（对比 3s SLEEP）；数据 0.1s 就绪净省 ~2.6s。唯一反例是
   S7 负例（等一个永假条件）比固定 sleep 多 ~50ms（3049 vs 3000）——这是超时兜底的正确代价，
   只出现在"页面真的没就绪"的失败路径。
5. **不引入原生 wait 的坑**：`wait --text` 三轮实测 25.07s/25.16s/25.81s 超时
   （文本在页面），`wait --fn false` 默认阻塞 25.96s——若用原生 wait 替代轮询，
   等于把可控的"300ms 粒度轮询"换成"单次 25s 阻塞且无法区分超时/异常"，
   是性能与可靠性的双输。

### 4.3 高安全性

**结论：无新增攻击面；显式超时 + fail-fast 提升 CI 安全性；唯一纪律是谓词拼接保持转义。**

1. **改动面隔离**：方向 B 只触碰 `tests/agent-browser/` 测试代码，零接触 `src/`
   （API 客户端、认证、token 处理）。无生产攻击面变化。
2. **凭证安全不变**：token 仍只从 `PIXIV_REFRESH_TOKEN` env 读取；轮询谓词是测试内
   常量（URL 片段/文案/选择器），非用户输入，无注入源；谓词拼接沿用现有
   `JSON.stringify` 转义约定（本原型 waitFor.ts 已实现），与 driver.ts `evaluate` 的
   既有转义模式一致（AGENTS.md：注入 JS 必须单行、经 JSON 转义）。
3. **超时兜底 = 防失控**：S7 实测 3000ms 超时 → 3049ms 返回 `false`，等待路径
   **有界且可预期**。对比固定 SLEEP：页面卡死时 SLEEP 照样"成功"返回，失败被推迟到
   后续断言、且重试放大——条件等待把环境异常以显式超时快速暴露（fail-fast），
   CI 上更安全（不会让一个挂起的页面拖慢整个套件）。
4. **CI 门禁稳定性**：慢路径不再因"固定等待不够"误报 → flake 率下降 →
   `retry: 2` 的放大效应减少（配合方向 F 可进一步收敛）；同时条件等待的显式超时
   给 CI 提供确定的单用例上限，便于预算墙钟时间。
5. **风险提示**：若谓词需拼接动态值（如 token 相关断言），必须保持转义；原型与落地
   实现都应禁止把原始 token 直接拼进 eval 字符串（现有 fixtures 已正确转义反斜杠/引号）。

### 4.4 低内存占用

**结论：确定的正向收益，量级为"每轮探测负载降 3~4 个数量级"；不改变浏览器/进程数量。**

1. **探测负载对比（实测支撑）**：条件轮询用 `eval` 返回 `"yes"`（~10B）；现有
   fixtures 的 `snapshotHas` 与部分循环探测用 `snapshot` 返回整棵 accessibility 树
   （重 Feed 页实测可达 50~200KB）。S9 实测两者 wall 时间相当（44 vs 42ms），
   差异在**每次 spawn 的 stdout 缓冲/字符串分配**：131 处等待 × 每处 2~30 轮，
   合计数千次探测，从 ~100KB/次 降到 ~10B/次，累计减少数百 MB 级的临时分配与
   GC 压力（CI 上 5~6 文件并行时更明显）。
2. **进程模型不变**：spawnSync 阻塞式、子进程即用即弃；轮询不持有页面状态——
   与固定 SLEEP 相同的进程模型，无新增常驻内存。
3. **不改变浏览器规模**：方向 B 不增减 Chrome/daemon 数量（并行度归方向 F、
   会话复用归方向 A），内存影响集中在"单次 spawn 传输负载"层面：**低幅但确定**。
4. **量化口径**：一次 eval 探测的峰值分配 ~KB 级（CLI 进程 + 管道），一次 snapshot
   探测 ~百 KB 级。以 300ms 间隔 × 平均 5 轮/等待 × 131 等待计，替换后累计减少
   的字符串分配在数百 MB 量级——对单测进程内存峰值影响小，但对长时间运行的
   CI 聚合压力有可测量改善。

---

## 5. 落地建议（增量、可回滚）

按"风险从低到高、收益从高到低"分 5 个 phase，每 phase 独立可回滚、独立验证
（验证协议：跑对应单文件 + 全量，记录耗时与通过率；重点回归空状态分支与无效 token
用例——条件谓词必须覆盖空态文案「暂无内容」/「暂无小说」等）：

| Phase | 内容 | 涉及 | 风险 | 预期收益 |
|---|---|---|---|---|
| 1 | 删除 17 处 D 类冗余 SLEEP（beforeAll 冗余、被后续 waitFor* 覆盖） | sub-flows 等 | 极低 | ~58s |
| 2 | driver.ts 原语层扩展：`waitForText/Url/Count/Js` + `waitFor*` 间隔参数化（默认 300~500ms）+ timeout 显式化；写进 TESTING.md | driver.ts | 低（纯增量 API） | 为 3/4 打基础 |
| 3 | R 类 70 处逐一替换（先导航/路由类：navigateSpa→waitForText/Url；再数据加载类） | 全部 spec | 中（谓词需覆盖空态） | ~240s |
| 4 | S 类 29 处缩到 500ms（Fluent 最长动效 500ms），可轮询的做谓词化（scrollY/aria-pressed） | 全部 spec | 低 | ~30s |
| 5 | I 类 15 处循环间隔 1~2s → 300~500ms（fixtures 阶段 2/4、translation/update 循环） | fixtures + spec | 低 | 20~60s |

**明确不做**：
- 用原生 `agent-browser wait` 完全替代轮询（3.4 实测：`--text` 不可靠、无 per-call
  timeout、超时/异常不可区分）。
- 对 S 类动画做无谓词的强轮询（会引入"等满超时"新坏味道）。
- 在方向 B 内改动登录会话复用（那是方向 A）、AI 断言（方向 C）、spawn 合并（方向 D）。

**落地后的预期总量**：R+D 全删 + S 缩短 + I 降间隔后，378.8s 固定等待中约
**300~330s 可消除**（78.8% 全消除 + S/I 部分），加上慢网络 flake 消除的连锁收益
（重试放大从 ×2~3 回落），全量套件墙钟可望减少 **5~7 分钟**（与方向 A 的 8~12 min
收益正交、可叠加）。

## 附录 A：R/D 类逐行映射全表

（131 站点的行号-类别-替换条件，见下方表格）

| 文件 | 行 | 类别 | 时长 | 等待语义 | 替换条件/处理 |
|---|---|---|---|---|---|
| sub-flows | 36 | 可替换 | 3000ms | `await SLEEP(3000);` | 登录后 Feed：img/「暂无内容」/「加载失败」任一 |
| sub-flows | 42 | 可替换 | 3000ms | `await SLEEP(3000);` | 滚动后：img 数量递增 |
| sub-flows | 50 | 可替换 | 2000ms | `await SLEEP(2000);` | 漫画 Tab：等「漫画」内容/aria-selected |
| sub-flows | 56 | 可替换 | 2000ms | `await SLEEP(2000);` | 综合 Tab：等「综合」内容 |
| sub-flows | 59 | 可替换 | 3000ms | `await SLEEP(3000);` | 关注 Tab：`waitForUrl('/following')` |
| sub-flows | 79 | 可删除 | 3000ms | `await SLEEP(3000);` | 后续已有 waitForSelector('.image-card')（L81） |
| sub-flows | 84 | 可替换 | 5000ms | `await SLEEP(5000);` | 详情页：`waitForUrl('/illust/')` |
| sub-flows | 105 | 可缩短 | 2000ms | `await SLEEP(2000);` | 收藏点击后：无稳定谓词，缩至 500ms |
| sub-flows | 116 | 可缩短 | 2000ms | `await SLEEP(2000);` | 取消收藏后：同上 |
| sub-flows | 124 | 可替换 | 3000ms | `await SLEEP(3000);` | 返回 Feed：等「推荐」+ img |
| sub-flows | 148 | 可替换 | 3000ms | `await SLEEP(3000);` | 小说 Tab：等「暂无小说」或卡片 |
| sub-flows | 159 | 可替换 | 5000ms | `await SLEEP(5000);` | 小说详情：`waitForUrl('/novel/')` |
| sub-flows | 174 | 可缩短 | 2000ms | `await SLEEP(2000);` | 正文滚动后：缩至 500ms |
| sub-flows | 198 | 间隔 | 1000ms | `await SLEEP(1000);` | 个人中心轮询间隔：降 300ms |
| sub-flows | 212 | 可替换 | 3000ms | `await SLEEP(3000);` | 我的收藏：等「收藏」内容/URL |
| sub-flows | 243 | 可删除 | 2000ms | `await SLEEP(2000);` | 后续已有 waitForPageContent(20s)（L245） |
| sub-flows | 256 | 可替换 | 3000ms | `await SLEEP(3000);` | 年龄确认后：`waitForSelector('fluent-textarea')` |
| sub-flows | 273 | 可缩短 | 1000ms | `await SLEEP(1000);` | 填 token 后输入稳定：缩至 300ms |
| sub-flows | 275 | 可替换 | 8000ms | `await SLEEP(8000);` | 登录后：等主界面 markers（推荐/关注/小说） |
| sub-flows | 300 | 可删除 | 2000ms | `await SLEEP(2000);` | launch 后，清理循环可先 waitForPageContent |
| sub-flows | 331 | 间隔 | 2000ms | `await SLEEP(2000);` | localStorage 重试间隔：降 500ms |
| sub-flows | 334 | 可替换 | 2000ms | `await SLEEP(2000);` | navigate('/') 后：waitForPageContent |
| sub-flows | 338 | 间隔 | 2000ms | `await SLEEP(2000);` | 年龄确认重试间隔：降 500ms |
| sub-flows | 353 | 可缩短 | 1000ms | `await SLEEP(1000);` | 填无效 token 后：缩至 300ms |
| sub-flows | 355 | 可替换 | 5000ms | `await SLEEP(5000);` | 无效登录：等错误提示谓词（失败/错误/invalid） |
| sub-flows | 374 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余，首个 getState 已等待 |
| sub-flows | 388 | 可替换 | 4000ms | `await SLEEP(4000);` | 滚动后：img 数量递增 |
| sub-flows | 395 | 可替换 | 4000ms | `await SLEEP(4000);` | 二次滚动后：img 数量递增 |
| sub-flows | 407 | 可替换 | 5000ms | `await SLEEP(5000);` | 关注 Tab：`waitForUrl('/following')` |
| sub-flows | 426 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 435 | 可替换 | 3000ms | `await SLEEP(3000);` | 图床页：`waitForSelector('fluent-switch[aria-label="启用图床代理"]')` |
| sub-flows | 447 | 可删除 | 3000ms | `await SLEEP(3000);` | navigateSpa 后接 getState（L450）已等待 |
| sub-flows | 464 | 可替换 | 1500ms | `await SLEEP(1500);` | 开关点击后：`waitForText('开启图床代理？')` |
| sub-flows | 475 | 可缩短 | 1500ms | `await SLEEP(1500);` | 取消后弹窗关闭动画：缩至 500ms |
| sub-flows | 487 | 可替换 | 3000ms | `await SLEEP(3000);` | 图床页：等主开关 |
| sub-flows | 498 | 可替换 | 1500ms | `await SLEEP(1500);` | 开关点击后：等弹窗文本 |
| sub-flows | 502 | 可替换 | 2000ms | `await SLEEP(2000);` | 确认开启后：等弹窗关闭/开关 aria-checked |
| sub-flows | 520 | 可缩短 | 1500ms | `await SLEEP(1500);` | 复原开关：缩至 500ms |
| sub-flows | 536 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 547 | 可替换 | 3000ms | `await SLEEP(3000);` | 小说 Tab：等 Feed 稳定 |
| sub-flows | 562 | 可替换 | 5000ms | `await SLEEP(5000);` | 小说详情：`waitForUrl('/novel/')` |
| sub-flows | 570 | 可缩短 | 2000ms | `await SLEEP(2000);` | 标题栏渐显动画：缩至 500ms |
| sub-flows | 581 | 可缩短 | 2000ms | `await SLEEP(2000);` | 回顶动画：缩至 500ms |
| sub-flows | 597 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 615 | 可替换 | 5000ms | `await SLEEP(5000);` | 关注 Tab：等筛选按钮出现 |
| sub-flows | 627 | 可替换 | 3000ms | `await SLEEP(3000);` | 公开筛选：等列表切换 |
| sub-flows | 643 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 652 | 可替换 | 2000ms | `await SLEEP(2000);` | 设置抽屉：等「关于」行出现 |
| sub-flows | 659 | 可替换 | 3000ms | `await SLEEP(3000);` | 关于页：`waitForText('关于')` |
| sub-flows | 661 | 可替换 | 3000ms | `await SLEEP(3000);` | 关于页 fallback 导航后：同上 |
| sub-flows | 678 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 687 | 可替换 | 2000ms | `await SLEEP(2000);` | 设置抽屉：等主题行出现 |
| sub-flows | 692 | 可替换 | 2000ms | `await SLEEP(2000);` | 深色切换：等 html.dark / aria-pressed |
| sub-flows | 700 | 可替换 | 2000ms | `await SLEEP(2000);` | 浅色切换：等 html 无 dark / aria-pressed |
| sub-flows | 719 | 可替换 | 2000ms | `await SLEEP(2000);` | 设置抽屉：等布局行出现 |
| sub-flows | 724 | 可缩短 | 2000ms | `await SLEEP(2000);` | 布局切换：缩至 500ms |
| sub-flows | 727 | 可替换 | 3000ms | `await SLEEP(3000);` | /recommended：等 img 出现 |
| sub-flows | 750 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 758 | 可替换 | 3000ms | `await SLEEP(3000);` | /me：`waitForText('我的作品')` |
| sub-flows | 773 | 可替换 | 5000ms | `await SLEEP(5000);` | 我的作品：`waitForUrl('/illusts')` |
| sub-flows | 785 | 可替换 | 3000ms | `await SLEEP(3000);` | /me：`waitForText('我的关注')` |
| sub-flows | 792 | 可替换 | 5000ms | `await SLEEP(5000);` | 我的关注：`waitForUrl('/following')` |
| sub-flows | 804 | 可替换 | 3000ms | `await SLEEP(3000);` | /me：`waitForText('我的粉丝')` |
| sub-flows | 811 | 可替换 | 5000ms | `await SLEEP(5000);` | 我的粉丝：`waitForUrl('/followers')` |
| sub-flows | 830 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 838 | 可替换 | 3000ms | `await SLEEP(3000);` | /image-cache：等标题「图片缓存」 |
| sub-flows | 857 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 874 | 可替换 | 3000ms | `await SLEEP(3000);` | 收藏 Tab：等「收藏」内容/URL |
| sub-flows | 881 | 可替换 | 3000ms | `await SLEEP(3000);` | 推荐 Tab：等 img |
| sub-flows | 889 | 可替换 | 3000ms | `await SLEEP(3000);` | /debug：`waitForText('图片加载调试')` |
| sub-flows | 900 | 可替换 | 3000ms | `await SLEEP(3000);` | 未知路由：等回退主页内容 |
| sub-flows | 919 | 可删除 | 3000ms | `await SLEEP(3000);` | beforeAll 冗余 |
| sub-flows | 932 | 可替换 | 5000ms | `await SLEEP(5000);` | 点卡片：`waitForUrl('/illust/')` |
| sub-flows | 947 | 可替换 | 3000ms | `await SLEEP(3000);` | 小说 Tab：等 Feed 稳定 |
| sub-flows | 954 | 可替换 | 5000ms | `await SLEEP(5000);` | 小说详情：`waitForUrl('/novel/')` |
| sub-flows | 959 | 可替换 | 3000ms | `await SLEEP(3000);` | 目录面板：等「目录」内容 |
| sub-flows | 973 | 可替换 | 3000ms | `await SLEEP(3000);` | 小说 Tab：等 Feed 稳定 |
| sub-flows | 980 | 可缩短 | 5000ms | `await SLEEP(5000);` | 小说详情：可 waitForUrl（归 R），此处保守列 S |
| sub-flows | 984 | 可缩短 | 2000ms | `await SLEEP(2000);` | 滚动后：缩至 500ms |
| sub-flows | 990 | 可替换 | 2000ms | `await SLEEP(2000);` | 双击回顶：等 `scrollY===0` 谓词 |
| main-flow | 35 | 可替换 | 3000ms | `await SLEEP(3000);` | 登录后 Feed：等 img/空态 |
| main-flow | 52 | 可替换 | 3000ms | `await SLEEP(3000);` | 滚动后：img 递增 |
| main-flow | 60 | 可替换 | 3000ms | `await SLEEP(3000);` | 漫画 Tab：等内容 |
| main-flow | 66 | 可替换 | 2000ms | `await SLEEP(2000);` | 综合 Tab：等内容 |
| main-flow | 74 | 可替换 | 3000ms | `await SLEEP(3000);` | 综合 Tab 再切：等 img |
| main-flow | 84 | 可缩短 | 2000ms | `await SLEEP(2000);` | clickFirst 重试间隔：缩至 500ms |
| main-flow | 89 | 可替换 | 5000ms | `await SLEEP(5000);` | 详情页：`waitForUrl('/illust/')` |
| main-flow | 111 | 可缩短 | 2000ms | `await SLEEP(2000);` | 收藏点击后：缩至 500ms |
| main-flow | 122 | 可缩短 | 2000ms | `await SLEEP(2000);` | 取消收藏后：缩至 500ms |
| main-flow | 140 | 可替换 | 3000ms | `await SLEEP(3000);` | 关注 Tab：`waitForUrl('/following')` |
| main-flow | 153 | 可替换 | 3000ms | `await SLEEP(3000);` | navigateSpa /home 后：等 Feed |
| main-flow | 160 | 可替换 | 3000ms | `await SLEEP(3000);` | 小说 Tab：等 Feed 稳定 |
| main-flow | 171 | 可替换 | 5000ms | `await SLEEP(5000);` | 小说详情：`waitForUrl('/novel/')` |
| main-flow | 186 | 可缩短 | 2000ms | `await SLEEP(2000);` | 正文滚动后：缩至 500ms |
| main-flow | 198 | 间隔 | 1000ms | `await SLEEP(1000);` | 个人中心轮询间隔：降 300ms |
| main-flow | 209 | 可替换 | 3000ms | `await SLEEP(3000);` | 我的收藏：等收藏内容 |
| adaptive-tags-240 | 34 | 可缩短 | 2000ms | `await SLEEP(2000);` | setViewport 后视口重排：缩至 500ms |
| adaptive-tags-240 | 36 | 可替换 | 6000ms | `await SLEEP(6000);` | 打开首页：等 img/页面内容 |
| adaptive-tags-240 | 42 | 可替换 | 7000ms | `await SLEEP(7000);` | reload 后：等登录页/主页 marker |
| adaptive-tags-240 | 50 | 间隔 | 2500ms | `await SLEEP(2500);` | 年龄确认轮询间隔：降 500ms |
| adaptive-tags-240 | 67 | 可缩短 | 1500ms | `await SLEEP(1500);` | 填 token 后：缩至 500ms |
| adaptive-tags-240 | 69 | 可删除 | 8000ms | `await SLEEP(8000);` | 登录后已有 25×3s 主界面轮询（L73-80） |
| adaptive-tags-240 | 79 | 间隔 | 3000ms | `await SLEEP(3000);` | 主界面轮询间隔：降 500ms |
| adaptive-tags-240 | 87 | 可替换 | 5000ms | `await SLEEP(5000);` | /settings：等 R18 开关出现 |
| adaptive-tags-240 | 91 | 可缩短 | 1500ms | `await SLEEP(1500);` | R18 开关点击后：缩至 500ms |
| adaptive-tags-240 | 99 | 可缩短 | 2000ms | `await SLEEP(2000);` | R18G 开关点击后：缩至 500ms |
| adaptive-tags-240 | 101 | 可删除 | 8000ms | `await SLEEP(8000);` | 后续已有 waitForSelector 20s（L102） |
| adaptive-tags-240 | 106 | 可缩短 | 4000ms | `await SLEEP(4000);` | RO 重算：可 waitForJs(data-fit) 或缩至 500ms |
| translation-flow | 156 | 可替换 | 4000ms | `await SLEEP(4000);` | /novel 详情：等 mock 标题「E2E 翻译测试小说」 |
| translation-flow | 120 | 可删除 | 2000ms | `await SLEEP(2000);` | 后续已有 10×1.5s 轮询等「翻译设置」（L124-130） |
| translation-flow | 145 | 可缩短 | 800ms | `await SLEEP(800);` | 填 key 后：缩至 300ms |
| translation-flow | 152 | 可缩短 | 1500ms | `await SLEEP(1500);` | 保存后：缩至 500ms |
| translation-flow | 190 | 可缩短 | 1500ms | `await SLEEP(1500);` | 翻译面板弹出：缩至 500ms |
| translation-flow | 210 | 可缩短 | 1500ms | `await SLEEP(1500);` | 切回原文后：缩至 500ms |
| translation-flow | 129 | 间隔 | 1500ms | `await SLEEP(1500);` | 设置页轮询间隔：降 300ms |
| translation-flow | 148 | 间隔 | 1500ms | `await SLEEP(1500);` | 保存重试间隔：降 300ms |
| translation-flow | 176 | 间隔 | 1500ms | `await SLEEP(1500);` | 详情渲染轮询间隔：降 300ms |
| translation-flow | 199 | 间隔 | 2000ms | `await SLEEP(2000);` | 译文注入轮询间隔：降 300ms |
| update-flow | 53 | 可替换 | 2500ms | `await SLEEP(2500);` | launch 后：waitForPageContent |
| update-flow | 111 | 可替换 | 4000ms | `await SLEEP(4000);` | 检查更新后：`waitForText('发现新版本')` |
| update-flow | 65 | 可缩短 | 1500ms | `await SLEEP(1500);` | 检查登录页前：缩至 500ms |
| update-flow | 72 | 可缩短 | 1000ms | `await SLEEP(1000);` | 填 token 后：缩至 300ms |
| update-flow | 130 | 可缩短 | 2000ms | `await SLEEP(2000);` | 前往下载后：等弹窗关闭（或缩至 500ms） |
| update-flow | 60 | 间隔 | 2000ms | `await SLEEP(2000);` | 年龄确认轮询间隔：降 500ms |
| update-flow | 76 | 间隔 | 3000ms | `await SLEEP(3000);` | 登录等待轮询间隔：降 500ms |
| update-flow | 97 | 间隔 | 2500ms | `await SLEEP(2500);` | 设置页导航轮询间隔：降 500ms |
| fixtures | 77 | 可替换 | 2000ms | `await SLEEP(2000);` | launch 后：waitForPageContent |
| fixtures | 83 | 可替换 | 2000ms | `await SLEEP(2000);` | 年龄确认点击后：等 fluent-textarea 出现 |
| fixtures | 113 | 可缩短 | 1000ms | `await SLEEP(1000);` | 填 token 后输入稳定：缩至 300ms |
| fixtures | 100 | 间隔 | 2000ms | `await SLEEP(2000);` | 阶段2 轮询间隔：降 500ms |
| fixtures | 124 | 间隔 | 2000ms | `await SLEEP(2000);` | 阶段4 轮询间隔：降 500ms |
| driver.ts | — | 间隔 | — | `setTimeout(..., 1000)` ×3 | waitForPageContent/waitForSelector 间隔参数化默认 300ms |
