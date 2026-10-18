# 测试套件一致性度量（2026-10-18）

> 背景：测试门禁重评（见
> [锚点审计](./gate-requirement-anchor-audit-2026-10.md)、
> [字面量普查](./unanchored-literal-census-2026-10.md)、
> [门禁索引](./gate-index-by-subject-2026-10.md)）的收尾项之一是「flaky 治理进第二阶段」。
> Google 的完整做法是两阶段：**第一阶段修**，**第二阶段重复跑算一致性率 → 把低一致性的移出
> gating CI、保留在可靠性套件里继续发现问题**。本仓此前只做过第一阶段，而且三个存量项
> （#998 墙钟等待 / #996 按序号分发的 mock / #997 时序档样板）都是**看代码看出来的**，
> 从未量化过整体一致性。
>
> **定策略之前需要数据**——没有数据就只能凭印象决定隔离谁。本文就是那份数据。

## 方法

两条独立证据：

1. **本地重复跑**：`node scripts/test-consistency.mjs 5`，连跑 5 轮全量，
   按「用例全名」聚合每轮通过/失败次数。
2. **CI 历史回溯**：`gh run list --workflow ci.yml --limit 60`，
   对全部失败 run 取 `--log-failed`，剥离 ANSI 后提取失败用例名并去重。

## 结果

### 本地：5 轮全绿

| 指标 | 值 |
| --- | --- |
| 轮次 | 5 |
| 用例总数（去重） | 4,366 |
| 累计断言执行 | 21,830 |
| **至少失败过一次** | **0** |
| 未在每轮都执行到 | 0 |

### CI：60 次运行中 2 次失败，**两次都失败在同两个用例**

| 结论 | 次数 |
| --- | --- |
| success | 51 |
| cancelled | 7 |
| failure | **2** |

两次失败的用例清单**完全相同**：

| 失败用例 | 性质 |
| --- | --- |
| `总字节 ≤ 30,720B（30KiB 硬门槛，ADR-0203 后重设）` | **确定性**：AGENTS.md 体积门禁（`packages/android-host/tests/unit/agentsMd.contract.test.ts`）。两次红跑对应的提交都在改 AGENTS.md，把它推过了 30KiB |
| `Node 上传器集成（uploadOne 层）` | **确定性**：纯注入式单测（`packages/android-host/tests/unit/scripts/upload-release-assets.test.ts`），不触真实网络 |

两次红跑相隔约 3 小时、提交内容相近、失败用例逐字相同 —— 这是**确定性失败**，不是 flaky。

## 结论

**本仓当前没有可测量的 flaky。** Google 第二阶段的「把低一致性用例移出闸门」**目前无物可移**。

这不是「引入了 flaky 治理机制」，而是「测过了，结论是不需要」——但它把「我们觉得不 flaky」
变成了「我们量过，当前不 flaky」。后者可以据此复查。

## ⚠️ 读数边界（别过度解读）

1. **5 轮只能发现失败率 ≥20% 的不稳定用例**；1/5 的偶发失败会被漏掉。Google 用数百次重复执行，
   本仓规模下不可行——本度量是**粗筛**，不是 flaky 的完备判定。
2. **单机单 OS 不代表 CI**。ubuntu runner 的 CPU 过订阅量级不同，时序敏感的用例恰恰在那里才现形
   （`tests/findPaletteSwatches.test.ts` 的头注就点名过这个风险）。要覆盖需接 CI 侧度量，
   本轮**未做**。
3. **「全绿」的正确读法是「没有可复现的不稳定」，不是「没有不稳定」**。
4. 历史上确有 flaky 的**书面记录**（`docs/research/flaky-novel-translate-store-diagnosis.md`），
   说明该缺陷类别在本仓**出现过**。当前测不出 ≠ 该类别不存在，只是当前样本里没复现。

## 产出物

`scripts/test-consistency.mjs` —— 可复跑的一致性粗筛脚本。

```bash
node scripts/test-consistency.mjs          # 默认 5 轮
node scripts/test-consistency.mjs 10       # 提高轮数
```

- **只度量，不定策略**：回答「哪些用例不稳定」；「移不移、移多少」留给维护者决策。
- **退出码恒 0**：这是度量不是门禁，不稳定本身不该让 CI 红。
- 脚本自带样本量说明，输出时一并打印，避免读数被过度解读。

## 留下的决策

- 要不要把一致性度量接进 CI 做**趋势**（每周一次、不阻塞），以覆盖 ubuntu 环境的 flaky？
  本轮**未做**——它是新增 CI 成本，属策略决策。
- 若将来出现 flaky 用例，隔离到哪个程度（整文件 / 单个 describe / 单个 case）？届时再定。
