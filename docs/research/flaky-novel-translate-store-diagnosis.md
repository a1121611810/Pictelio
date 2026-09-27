# 诊断：novelTranslateStore 单测时序 flaky（CI 红率主因）

- 日期：2026-09-27
- 状态：**取证完成，未修**（待修复边界拍板；后续走 to-spec → to-tickets）
- 触发事件：CI run [36239607963](https://github.com/a1121611810/Pictelio/actions/runs/36239607963)（2026-09-26 11:41，一笔 **docs-only** 提交把 main 的 Unit tests job 推红）
- 关联：ADR-0171（翻译缓存/半成品策略）、ADR-0178（重试与 partial，PR #662 补 `reset()` abort）、`docs/specs/app-lynx-novel-translation.md` §9.8（in-flight 复用；测试 describe 标题误标 §9.6）、ADR-0097（期望值溯源）

## 0. 一句话结论

失败断言全部位于「**固定墙钟 `sleep(10/20ms)` 之后立即读取 store 状态 / provider 调用计数**」这一形态上。provider 启动前 store 要穿过一段**真实 I/O**（fake-indexeddb，4 次 `indexedDB.open`），负载下该预算被击穿。

这是**测试侧观察点选取错误 + 缺少收尾隔离**，**不是** store 的 abort / 去重语义错误（`store:409` 的 `activeController?.abort()` 未被证伪）。复现条件是 **9 包并行的整体过订阅**（`pnpm test:all`，即 CI 的 `ci.yml` 命令）；隔离运行不复现。

## 1. 事实基线（含路径纠正）

| 项 | 事实 |
| --- | --- |
| 测试文件 | `packages/app-lynx/tests/unit/stores/novelTranslateStore.test.ts`（1358 行 / 59 用例） |
| 被测实现 | `packages/app-lynx/src/stores/novelTranslateStore.ts`（1261 行，Pinia） |
| 流水线原语 | `packages/app-lynx/src/primitives/createNovelTranslator.ts` |
| CI 归属 | `ci.yml` 的 Unit tests job → `pnpm test:all` → `--filter pictelio-app-lynx test`（`vitest run`，`environment: 'node'`，无 retry / 无假定时器） |

**纠正**：此前把该文件记成 `packages/app/tests/unit/stores/…` 是错的。`git ls-files` 只有 app-lynx 一条；app 端同位置是对应物 `translationStore`（另一套栈，ADR-0171 §背景明确两端不共享代码）。CI 原始日志坐实：`~/packages/app-lynx$ vitest run`，栈帧 `packages/app-lynx/src/stores/novelTranslateStore.ts:845`。

**连带的本地影响**：pre-push 的 app-lynx 域门禁（`check-app-lynx-anchors.mjs`）在触碰 `packages/app-lynx/**` 时跑**该包全量单测**。实测单包全量跑 6/6 全绿（不复现），故本地推送基本不受影响——**CI 是重灾区**（它跑的是 9 包并行）。

## 2. 根因链（实证）

1. **墙钟窗口**：`translateChapter()` 到真正调用 provider 之间必须穿过
   R18 gate（同步）→ in-flight 判定（同步）→ `await loadEndpointMetadataForCache()`（`store:678`，fake-indexeddb 4 路 `idbGet`，`idbKV.ts` 每次调用新 `indexedDB.open`）→ `await getTranslation()`（`store:690`）。
   负载下这段超过 10ms → 断言读到「还没发生」的状态（`'pending'`、`captured === null`）。
2. **连锁污染**（解释 CI 里那个 `3`）：前一个用例断言失败 → 其收尾 `d.finish(); await p`（`test:657-658` 等）**不可达** → 泄漏的 invocation 卡在 provider 前的 await 链上（此时尚无 controller，测试钩子 `resetNovelTranslateStoreForTest()` 的 `activeController?.abort()` 够不着它）→ 下一个用例的窗口里它才启动 provider。
   失败样本日志逐字：`[novelTranslateStore] cacheMiss chapter=82 → 70 → 71` ⇒ 计数 `call = 3`（本应 2）。
3. **mock 序号映射掩盖异常**：`call === 1 ? d1.iter : d2.iter`（`test:667`）会把第 3 次调用静默映射为 `d2`，使「多调一次」只以计数差形式出现，难以归因。

## 3. 复现画像（三份独立实验的合并口径）

| 条件 | 次数 | 失败 |
| --- | --- | --- |
| 单文件全量（隔离） | 15 | 0 |
| 单文件 + 15 路 CPU 烧机（10 核） | 10 | 0 |
| 单文件 6 路并发 | 12 | 0 |
| 单包全量（app-lynx 187 文件） | 6 | 0 |
| 2 包并行 | 4 | 0 |
| 目标 describe 块单跑（复核） | 10 | 0 |
| **`pnpm test:all`（9 包并行，CI 同款）** | 10 | **3（30%）** |
| `pnpm test:all`（安静窗口复核） | 4 | 0 |

**触发因素是整体过订阅的量级**（噪声窗口 load 17–78；当时有 dev server / IDE / 后台 daemon + 并发实验），不是单个进程拿不到 CPU——纯 CPU 烧机把单次耗时拉长 2.6–7 倍仍不复现。GitHub runner（2 vCPU）跑 9 个 vitest 实例正处该量级，所以 CI 上稳定偶发。

## 4. 失败签名（3 例，全在同一 describe 块）

| 用例 | 断言位置 | 失败文本 | 方向 |
| --- | --- | --- | --- |
| `reset() 必须 abort store 自己的 in-flight signal（S1）` | `test:649` | `expected null not to be null` | 流水线未推进 |
| `translating 期间调不同 chapterId → 并行触发（provider 调用 2 次）` | `test:674` | `expected 3 to be 2` | 多调一次（第 2 节的连锁） |
| `切章节后旧 iterator 的 delta 帧不得写进新章节（P2 delta gate）` | `test:608` | `expected 'pending' to be 'translating'` | 流水线未推进 |

前两例与 CI 报错**逐字一致**；第三例是本机 `pnpm test:all` 复现出来的（CI 尚未见过）——**flaky 面比 CI 显示的大**，该 describe 块 6 个用例共用同一形态。

## 5. 独立发现：一条生产竞态候选（与本案无因果）

`store:690`（最后一个 await）→ `store:719-722`（创建 controller 并 `genNow = ++gen`）之间**没有任何 `gen` / `aborted` 闸门**。恰好落在此窗口被 `reset()` / `abort()` 取消的 invocation 会：

1. 仍然发起一次全新 provider 请求（正文外发，白烧 token）；
2. `++gen` 把**更新的**那个 invocation 变旧 → 新章节的 `if (gen !== genNow) return` 落地被丢弃，而旧章节结果照写。

生产触发点：`NovelDetail.vue:288`（章节切换 → `reset()`）、`NovelDetail.vue:350-351`（`abort(); reset()`）、`TranslateButton.vue:117`（`store.abort()`）。

**仅路径分析，未复现**，因此不足以定性为缺陷——需要确定性复现（注入延迟）才能立票。

## 6. 同类风险面与既有防线

- 同类面（全仓扫描）：**S1**「并行/复用 + 调用计数断言」9 文件 12 用例；**S2**「abort/generation 竞态」7 文件 12 用例。
- `packages/app/tests/TESTING.md`：**零**异步确定性条文（flush / 等待模式 / 假定时器 / flaky 全部零命中）——这类 bug 的温床。
- 单测层配置：无 `retry` / 无 `pool` / 无 `sequence` 覆盖。
- 既有姿态：`vitest.agent-browser.config.ts` 明确写「全局 retry 2→0（消除 flake 重试放大）」，已知 flake 用 per-test `{ retry: 1 }` 兜底；全仓**无** quarantine 先例。
- 期望值溯源：provider 调用次数（1 次 / 2 次）在 docs 侧**无量化条文**，出处只有测试自身注释；正条是 spec §9.8 的语义（同 chapter 复用、不同 chapter 并行）。

## 7. 方案（待拍板）

### D1 修复手段：测试侧确定性化（不含生产代码）

- 把固定墙钟等待换成**条件等待**（`vi.waitFor` 轮询断言，或等到 store 明确暴露的完成信号），不引入 test-only API 到生产文件为佳。
- 每个涉及 in-flight 的用例加 **`try/finally` 收尾**（断言失败也必须 `finish()` + `await` 在飞 promise），消灭跨用例污染。
- 计数类断言改为**按标识映射**（按 chapterId 给 iterator，而非「第 1 次给 d1、其余给 d2」），使「多调一次」可见而非被吞。
- 顺手修正 oracle 溯源：describe 标题 `§9.6` → `§9.8`，注释里把计数期望的条文出处写全。

### D2 生产竞态候选（第 5 节）的处置

- **推荐**：本轮**只登记诊断**，另立票；该票要求先做出确定性复现（注入延迟），再谈修法（因为改的是取消/generation 语义，属生产行为变更，需 ADR 评审）。
- 备选：本轮一并修（范围与回归面显著扩大，且当前无复现证据支撑改动方向）。

### D3 防线（防同类复发）

- **推荐**：① 在 `TESTING.md` 增「异步测试确定性」硬约束条文（禁固定墙钟等待；断言失败路径必须收尾；计数断言按标识映射）；② 加**恶意时序回归守卫**——把 provider 前的 I/O 路径人工变慢（stub 端点元数据读取为可控延迟），断言修好的用例在延迟下仍绿。这条守卫把「概率性 flake」变成**确定性门禁**：谁再写回墙钟等待，守卫必红。
- 不做：CI `retry`（与既有姿态冲突，且掩盖真回归）；quarantine（全仓无先例，单文件不值得）。
- 可选（更强，需另议）：机械扫描/门禁禁止单测内 `await new Promise(r => setTimeout(r, N))` 形态。

### D4 验收标准

1. **确定性证据（主）**：注入延迟的复现实验——**修前必红、修后必绿**（对上述 3 例及同块其余用例）。
2. **概率性证据（辅）**：负载复跑 `pnpm test:all` × 20 零失败（基准：噪声窗口 10 次 3 失败；安静窗口 4 次 0 失败）。**必须在能复现的负载窗口内跑**，否则不构成证据。
3. **CI 观察**：合并后连续 3 次 CI 全绿（该文件零失败）。

### D5 范围

- 本轮：**该文件该 describe 块全量收口**（6 用例，同一形态，一次改完），而非只修 CI 见过的那 2 例。
- 跨文件同类面（S1/S2 共 24 用例）：**登记成一张票**（附文件+用例清单），不塞进本轮。
- 文档/流程产物：`TESTING.md` 条文（D3）；本轮**不需要新 ADR**（无生产语义变更）。若 D2 选「本轮一并修」，则必须有 ADR。

## 8. 排除项（本轮不做）

- CI 侧 `retry` / 测试 quarantine。
- 全仓 24 个同类用例一次性重写。
- 改动 store 的取消 / generation 语义（除非 D2 备选被选中，且先有复现证据）。
- 触碰 webview 端 `translationStore`（另一套栈，本案无关）。

## 9. 证据出处

- CI：run 36239607963 完整日志（`gh run view --log-failed`）。
- 本机复现：`pnpm test:all` ×10（3 失败，含本机新增的 P2 delta gate 例）；定向 describe 块单跑 ×10（0 失败，证隔离不复现）；单包/多包/烧机对照共 47 次（0 失败）。
- 代码定位：`packages/app-lynx/src/stores/novelTranslateStore.ts:158-169 / 401-412 / 657-775 / 1033 / 1065`、`packages/app-lynx/tests/unit/stores/novelTranslateStore.test.ts:117-125 / 243-299 / 638-679 / 604-620`。
