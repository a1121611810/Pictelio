# ADR-0176: app-lynx 翻译 Java 端解析状态按 streamId 分桶（per-stream keying）

- **状态**: proposed
- **日期**: 2026-09-20
- **关联**: wayfinder map [#644](https://github.com/a1121611810/Pictelio/issues/644)（app-lynx 翻译收尾遗留项收敛）；issue [#652](https://github.com/a1121611810/Pictelio/issues/652)（决策：跨流状态隔离 —— 解析状态按 streamId 收进 per-stream 对象）；issue [#640](https://github.com/a1121611810/Pictelio/issues/640)（root ticket：P3 step 7）；调研 [#649](https://github.com/a1121611810/Pictelio/issues/649)（CLOSED：app-lynx 翻译跨流污染可达性论证）；ADR-0170 §D6 / 信封契约 / :471-485（per-stream 缓冲与 `pruneFinishedStreams` 范式）/ :503「陈旧流不得写进当前翻译」；ADR-0174 D1（生产读缝 `translatePoll`）；[#654](https://github.com/a1121611810/Pictelio/issues/654) 空流门禁（`deltaSeen` 实例字段已删除，commit `c7019273`）

---

## 背景

调研 #649（CLOSE 2026-09-20）论证了 `PictelioTranslateModule` 的**实例级共享可变状态**在两条 SSE 流同时存活时会跨流污染（cross-stream contamination）。该污染是**结构性可达**而非时序竞态：因为模块是 `LynxActivity.java:222/231/234` 注册表单例（`com.lynx.jsbridge.CommonModuleCreator` 缓存 `LynxModuleWrapper`，反编译实证），整个 app 会话只有这一个 Java 实例（research #649 §3 模块身份段）。

### 三条污染机制（research #649 §3，已可达）

| 编号 | 机制 | 行号（c7019273） | 现象 |
|------|------|------------------|------|
| **M1** | drain attribution race：所有 worker 抽同一个共享 `frameQueue`，streamId 由抽帧的 worker 而非生产帧的流盖上 | `:409-417` + `:529-534` | A 的 consolidated 帧被 B 的 worker 抽走 → 盖成 B 的 streamId → JS 误收 |
| **M2** | 解析器实例被覆盖：每次 `translateStream` 用 `sseParser = new TranslationSseParser()`（`:397`）覆盖实例字段；前一流仍在读 SSE 时把帧灌进新解析器（`TranslationSseParser.java:134-137` `TreeMap` 共享） | `:122` 字段 + `:397` 赋值 + `:901-902` 读字段 | A 的剩余 `output_text.delta` 被并入 B 的解析器 → B 的 `done` 帧含 A+B 文本 → 写进 B 的缓存 |
| **M3** | 共享 parse state 互相干扰：`sseParser.terminalError()`（`:418`）读到的是 B 的解析器；`flushIfAny`（`:401-405`）也走同一个解析器；两个 reader 线程 `accept` 同一非线程安全实例 → `ConcurrentModificationException` 吞掉 → JS 拿到空帧 | `:122`, `:391-392`, `:418` + `TranslationSseParser.java:36/80/134-137` | 早结束的流被后开始的流判失败；两流的 `TreeMap` 并发迭代 → CME |

### 触发场景（research #649 §4，I1 同章重译可达）

1. t0 用户点击「翻译」→ S1 起流（`ACTIVE_CALLS.put("S1", call1)` `:364`）
2. t1 用户点「停止」→ `provider.abort()` → `abortHandle?.abort()`（在 #653 修复前**结构死路径**，research §2；fix in commit `6e1ad678`）
3. t2 用户再点「翻译」→ store 复用守卫失败（status 已非 translating/pending，`novelTranslateStore.ts:615-621`）→ 起 S2 → `frameQueue.clear()`（`:393`）+ `sseParser = new`（`:396`） → S1 仍在读 SSE → M2 把 S1 后续帧灌进 S2 解析器
4. S2 收尾合并 → `done` 帧含 S1+S2 文本 → JS 写入 S2 缓存（污染）

### 第四项缺口：JS→Java 取消路径

研究 #649 §2 同时论证 `abortHandle?.abort()` 是**结构死路径**：JS `abortHandle` 仅在 `translateStream` promise `.then((h) => …)`（`nativeTranslate.ts:603-606`，原行号）中赋值，而该 promise 仅在 Java `callback.invoke({"type":"done"}, …)` 时 settle。但 Java 实测回调通道一条流至多一帧（ADR-0170「交付通道实测」），promise 常永不 settle → `abortHandle` 永远 `null` → 用户主动 abort 永远到不了 OkHttp `Call.cancel()`。

#653（commit `6e1ad678`）把 `abortHandle` 改为**同步赋值** `{ abort: () => abortStream(streamId).catch(…) }`（`nativeTranslate.ts:602-607`），但 ADR 层面尚未把这条路径与 per-stream keying 整体架构绑定。本 ADR 在 #653 修复基础上**正式**把 streamId 设为 JS 与 Java 两侧的共享键。

### 为什么「并发=1」救不了

`concurrency: provider.id === "native-bridge" ? 1 : undefined`（`packages/app-lynx/src/stores/novelTranslateStore.ts:785`）只约束**单次翻译运行内**的 chunk 级并发（`runChunkPool` `createNovelTranslator.ts:206-207`），对**跨翻译运行**与**原生侧**均无约束力（research #649 §1）。

---

## 决策

### D1. 引入 `TranslationStreamState`，把所有污染源字段收进 per-stream 对象

新增内部静态类 `TranslationStreamState`，封装当前被 M1/M2/M3 利用的所有共享可变解析状态：

```java
/** 单流的解析状态（与 streamId 一一对应）。
 *  不放「每流终态/缓冲」（STREAM_FRAMES 等已是 per-stream map，见 D7）。 */
static final class TranslationStreamState {
    /** 解析线程入队的临时帧；流收尾时整体搬进 STREAM_FRAMES[streamId]。 */
    final ConcurrentLinkedQueue<String> frameQueue = new ConcurrentLinkedQueue<>();
    /** SSE 解析器实例（段落锚定 / hasText / terminalError 等状态）。 */
    TranslationSseParser sseParser;
    /** 解析线程每帧盖章前递增（per-stream 序号，已在 STREAM_SEQ；此处冗余仅为
     *  把「解析线程」需要的 seq 计数器贴近解析路径，调试更直观，可选）。 */
    // 不另起字段：seq 由 STREAM_SEQ 统一管理，避免双重事实源。
}
```

**关键事实**：
- `frameQueue`（`PictelioTranslateModule.java:156-157`）—— **唯一**搬入 per-stream 的字段
- `sseParser`（`:122`）—— **唯一**搬入 per-stream 的字段（已 #654 删除 `deltaSeen` 后只剩它）
- `deltaCount` —— #654 已删 `deltaSeen`（commit `c7019273`），`deltaCount` 实际未被任何代码读写，仅注释残留（`research/app-lynx-translation-cross-stream-contamination.md` §3 提到的字段已不存在于生产代码），本 ADR 不动

> **不**搬入的字段：`STREAM_FRAMES` / `STREAM_TERMINAL` / `STREAM_TERMINAL_MSG` / `STREAM_SEQ` —— 已是 `Map<streamId, V>`（`:135-137` / `:145` / `:147` / `:536-537`），M1/M2/M3 与它们无关，详见 D7。

### D2. 流生命周期：注册 / 更新 / 注销

**新增 `Map<String, TranslationStreamState> STREAM_PARSE_STATE = new ConcurrentHashMap<>()`**（与 `STREAM_FRAMES` 等同款命名风格、同款并发容器）。

| 触发点 | 行为 | 行号（c7019273） |
|--------|------|------------------|
| `translateStream` 入口，**校验通过后**（`pruneFinishedStreams` 之后） | `STREAM_PARSE_STATE.computeIfAbsent(streamId, k -> new TranslationStreamState())` + `state.sseParser = new TranslationSseParser()` + `state.frameQueue.clear()` | 替换 `:393-396` |
| 每次解析入帧 | `STREAM_PARSE_STATE.get(streamId).frameQueue.offer(payload)` | 替换 `:402`、`:875` |
| `sseParser` 字段读取（`processSseLine`） | `state = STREAM_PARSE_STATE.get(streamId); state.sseParser.accept(…)` | 替换 `:861-862` |
| 流收尾（`response.completed` / 异常 / 用户 abort） | 仍持有 `state` 引用完成 flush / drain / `hasText()` 判据，最后随 `pruneFinishedStreams` 一起 `STREAM_PARSE_STATE.remove(streamId)` | 替换 `:393-396` / `:401-405` / `:407-416` / `:417-431` |
| `pruneFinishedStreams(keepStreamId)` | 在现有 4 个 map 清理外，**新增第 5 个循环**：`for (key : new HashSet<>(STREAM_PARSE_STATE.keySet())) if (!key.equals(keepStreamId)) STREAM_PARSE_STATE.remove(key);` | `:474-488` 末尾新增 |

**JMM 可见性**：`STREAM_PARSE_STATE` 用 `ConcurrentHashMap`（`get/put/computeIfAbsent` 提供 happens-before 链），替换原 `:122` 裸 `private TranslationSseParser sseParser` 字段也**顺手解决了** research #649 §6 #1 的 JMM 可见性不确定（plain non-volatile 字段 → 不同 reader 线程可能读到旧引用）。

### D3. drain attribution 修复（M1 直接受益）

收尾分支（`:407-416`）改为：

```java
TranslationStreamState state = STREAM_PARSE_STATE.get(streamId);
// 防御：state == null 视为流已注销（pruneFinishedStreams 已清）→ 不交付
if (state == null) { registerTerminal(streamId, "done"); publishFramesViaEvent(streamId); return; }
ConcurrentLinkedQueue<String> ownQueue = state.frameQueue;
while (!ownQueue.isEmpty()) {
    STREAM_FRAMES.computeIfAbsent(streamId, k -> new ConcurrentLinkedQueue<>())
                 .offer(withSeq(withStreamId(ownQueue.poll(), streamId), streamId));
}
```

**为什么这能修 M1**：drain 只从**本流的** `state.frameQueue` 取，streamId 由 `withStreamId(..., streamId)` 显式盖上，不再依赖「抽帧的 worker 是谁」。两条流各自 drain 各自的 queue，没有共享可竞争的资源。

### D4. 解析器实例隔离（M2 / M3 直接受益）

`processSseLine`（`:861-862`）改为：

```java
TranslationStreamState state = STREAM_PARSE_STATE.get(streamId);
if (state == null || state.sseParser == null) state.sseParser = new TranslationSseParser();
return state.sseParser.accept(line, /* sink */ payload -> {
    TranslationStreamState s = STREAM_PARSE_STATE.get(streamId);
    if (s != null && payload != null && !payload.isEmpty()) s.frameQueue.offer(payload);
});
```

**为什么这能修 M2**：A 的 reader 线程读 `STREAM_PARSE_STATE.get("A")` 拿到 A 自己的解析器；B 后启动时 `computeIfAbsent("B")` 创建 B 自己的解析器。两解析器物理隔离，A 的 `TreeMap` 与 B 的 `TreeMap` 互不可见。`emitConsolidated` 输出的 consolidated 帧只来自本解析器。

**为什么这能修 M3**：`terminalError()` / `hasText()` / `flushIfAny` 全部从 `state.sseParser` 读，不再读「最新一个」实例字段 —— A 的收尾看到的是 A 自己的 parser，B 的失败不会被误报为 A 的失败。

### D5. 测试缝 = `translatePoll`（沿用 ADR-0174 D1）

**不**新增 `static @VisibleForTesting` 包内缝（research §2.3 论证过：会退化成事实 5 陷阱）。新增 per-stream keying 的 CI 防线**经生产读路径 `translatePoll`** 读取：

- 现有 `TranslateEventContractTest`（ADR-0174）扩展：新增「M1 触发 → `STREAM_FRAMES[B]` 不含 A 文本」探针（P9）：用两条不同 `_abortToken` 起流，A 慢流 + B 快流，断言 B 终态帧不含 A 字符串
- 「M2 触发 → `STREAM_FRAMES[B]` 含 A 文本」探针（P10）：变异回 `sseParser` 共享字段后必须变红
- 「M3 触发 → A 终态错误消息是 A 自己的，不是 B 的」探针（P11）

Robolectric JVM 单测可达性已由 ADR-0174 D2 验证。

### D6. JS→Java 取消路径 = 直接传 streamId（沿用 #653，把模式正式化）

`controller.signal.addEventListener('abort', () => translateModule.abortStream(streamId))`（`nativeTranslate.ts:481` 已有 `signal.addEventListener` 入口）。

#653（commit `6e1ad678`）已经把 `abortHandle` 改为同步赋值的 streamId-direct handle（`nativeTranslate.ts:602-607`），但 ADR 层面**正式**承认：

1. **JS 侧**已经在 `translateStream` 调用**之前**就持有 `streamId`（`nativeTranslate.ts:589-593` `newStreamId()`）
2. **Java 侧** `abortStream(streamId, cb)`（`PictelioTranslateModule.java:714-732`）已按 streamId 直接取消 `ACTIVE_CALLS[streamId]?.cancel()`
3. **JS 侧** 不再依赖 `translateStream` promise settle —— 这是 #653 已落地的形态，本 ADR 在 §D2 把 Java 侧的 streamId 设为「JS / Java 共用键」，与 D1 的 per-stream keying 同源

> `nativeTranslate.ts:478` 的 `void abortHandle?.abort()` 与 `:675` 的二次 `abortHandle?.abort()`（`provider.abort()` 入口）保留为冗余防御层（双触发幂等，Java 侧 `abortStream` 已注释「无活动流也算成功」）。

### D7. 维持现有 4 个 per-stream map 不合并

**不**把 `STREAM_FRAMES` / `STREAM_TERMINAL` / `STREAM_TERMINAL_MSG` / `STREAM_SEQ` 合并进 `TranslationStreamState`。理由：

1. **它们已是 per-stream map**（key = streamId）：M1/M2/M3 与它们无关，把它们再包一层只增加间接寻址（`STREAM_FRAMES[streamId]` → `state.frames`）
2. **prune 纪律已稳定**：`pruneFinishedStreams` `:474-488` 4 个循环清晰，本 ADR 仅追加第 5 个循环（清理 `STREAM_PARSE_STATE`），blast radius 受控
3. **测试兼容性**：ADR-0174 的 5 条终态路径探针全部按 `STREAM_TERMINAL[streamId]` 字面量读取（research #2.5 + `:610` ← `:145`），合并后会破坏 ADR-0174 现有 41 个相关探针的可读性
4. **`withSeq` / `withStreamId` 的盖章路径不依赖** `TranslationStreamState` 任何字段，把它们外置保持工具函数纯净

**最终数据布局**：

| 容器 | key | value | 行号（c7019273） |
|------|-----|-------|------------------|
| `ACTIVE_CALLS` | streamId | OkHttp `Call` | `:104` |
| `USER_ABORTED` | streamId | 标记用户主动中断 | `:115` |
| `STREAM_FRAMES` | streamId | 帧队列（已盖章） | `:135-137` |
| `STREAM_TERMINAL` | streamId | 终态帧（已盖章） | `:145` |
| `STREAM_TERMINAL_MSG` | streamId | 终态原始消息（日志） | `:147` |
| `STREAM_SEQ` | streamId | `AtomicInteger` | `:536-537` |
| **`STREAM_PARSE_STATE`（本 ADR 新增）** | **streamId** | **`TranslationStreamState`（frameQueue + sseParser）** | **新增** |

---

## 后果

### 正面

- **M1 修掉**：drain 只走本流的 `state.frameQueue`，streamId 与生产流严格一致
- **M2 修掉**：解析器实例与 streamId 绑定，前一流的后续 SSE 帧进入的是「自己流的解析器」（如果该流还在处理）或被 `pruneFinishedStreams` 清掉（如果该流已收尾）
- **M3 修掉**：`terminalError()` / `hasText()` / `flushIfAny` 全部从本流 state 读取；不再可能「A 的失败报告为 B 的」；两 reader 线程的 `TreeMap` 物理隔离，CME 窗口关闭
- **JMM 可见性顺手解决**：`ConcurrentHashMap.get/put` 提供 happens-before 链，替换原 `:122` 裸 non-volatile 字段（research §6 #1）
- **JS abort 路径正式化**：与 D1 的 per-stream keying 同源，streamId 成为跨端唯一标识
- **测试覆盖增厚**：M1/M2/M3 三条机制各有一条变异变红的 Robolectric 探针（ADR-0174 范式）
- **零 JS 侧 API 改动**：JS 侧 `translateStream` / `abortStream` 签名不变，只是内部从「依赖 promise settle」改为「直接 streamId」（#653 已落地）

### 负面 / 成本

- **每流额外 ~32 字节**：`TranslationStreamState` 对象头 + 两个字段引用；与现有 `STREAM_FRAMES` 每流的 `ConcurrentLinkedQueue` + `AtomicInteger` 同量级（总成本仍 < 200 字节/流）
- **新增 1 个静态 map + 1 个内部类 + 5 处字段替换**：约 30 行 Java 净增量；与 ADR-0170 §负面「新增 ~600 行」相比可忽略
- **`pruneFinishedStreams` 扩到 5 个循环**：可读性轻微下降；不抽公共方法以保持每条循环单义（与现有 4 个循环同款风格）
- **state 为 null 的兜底**：流收尾时若被 `pruneFinishedStreams` 清掉（极端时序），读 `state` 返回 null 必须分支处理；D3 / D4 已显式 if-null 返回，避免 NPE
- **JMM 仍有一处不变量要守住**：`pruneFinishedStreams` 的清理**必须**发生在**新流**完成 `computeIfAbsent` **之后**（否则新流的 `state` 会被旧 prune 误删）。当前 `pruneFinishedStreams(streamId)` 在入口先调（`:304`），新流 `computeIfAbsent` 在 HTTP 校验**之后**调（替换原 `:393-396`），时序天然安全

### 风险与遗留

- **「同一 streamId 复用」**：JS 侧 streamId 由 `newStreamId()` 生成（UUID v4，research #649 §1），碰撞概率忽略；Java 侧 `pruneFinishedStreams` 清理后允许同 streamId 再用
- **`TranslationStreamState` 内存泄漏**：若 `pruneFinishedStreams` 漏调某个分支（如 Java 进程崩溃前最后一条流未走完收尾）会留一条 `TranslationStreamState`；`ConcurrentHashMap` 持有弱引用但 `TranslationStreamState` 字段强引用 `frameQueue` → 不会被回收。可接受上限：每流 < 200 字节 × 数百条泄漏 ≈ 几十 KB，影响远低于 `STREAM_FRAMES` 历史已存在的同源泄漏（commit `6a648ab5` 已修）
- **不写 agent-browser E2E**（ADR-0084 入门禁）；android-e2e 转换矩阵门（`transition-matrix.spec.ts` @release-gate，ADR-0163）覆盖跨流场景
- **Java 单测扩展**：本 ADR 引入的 3 条 Robolectric 探针（P9/P10/P11）随 ADR-0174 既有测试类扩展；不新建测试文件（保持 ADR-0174 测试侧单一来源）

---

## 否决的替代方案

### A. 给共享状态加锁（`synchronized` / `ReentrantLock`）—— **已否决**

**理由**：治标不治本，且损害并发性能。

- 锁住 `frameQueue` / `sseParser` 只能保证「单次操作原子」，无法保证「A 的整段解析语义与 B 不重叠」—— A 仍然把帧灌进 B 的解析器（M2 仍存在）
- 锁内串行化 SSE 行读取 → 把 OkHttp 高频 chunk 流拖到单线程序；30s 流 5-20 chunks/s × 锁开销 ~0.5ms → 用户感知 ~10% 减速
- research #649 §5 P3 「共享 parse state 不共享」是**架构层**诉求，加锁只能给 P3 加**运行时**约束，不改变「两 reader 共用一个非线程安全解析器」的事实（`TranslationSseParser.java:36` `TreeMap` 仍并发迭代 → CME 仍在）

### B. Java 侧 `concurrency: 1`（串行起流）—— **已否决**

**理由**：与 `concurrency: 1` 误用同源，但搬到 Java 侧同样救不了。

- 「开新流时强制等老流收尾」需要在 Java 入口加全局互斥；`translateStream` 是 `@LynxMethod`，可被 JS 任意并发调 → 用户连点两次「翻译」第二次仍会进入新流（M2 窗口仍开）
- 真正的串行要求：JS 侧 store 已 `concurrency: 1` 但只约束 chunk 级；要求「跨翻译运行 + 跨 novelId」串行 → UX 倒退（用户切小说必须等上一本翻译完；切到一半就 abort 会触发 research #649 §2 的死路径）
- 这不是架构修复，是把可达性问题降到「用户感知不到的延迟」—— 用户连续切小说仍然会撞 I2（research #649 §4 I2：导航走 + 翻译另一小说）

### C. 每帧 envelope 带 streamId + 接收侧过滤 —— **已否决**

**理由**：仅能防御 P5（陈旧流帧到达新流监听器），不解决 M1/M2/M3。

- ADR-0170 :503 已落地此防御（`withStreamId` + JS `attachTranslateFrameListener` 按 streamId 过滤，research #649 §5 P5）
- 但 P4（drain attribution mis-stamping，M1）会让 A 的帧被盖成 B 的 streamId → JS 过滤**接受**「看起来是 B 的帧」，实际内容是 A 的 —— 过滤机制形同虚设
- M2 同样破坏 envelope：envelope 是「帧的归属键」，M2 是「解析器实例被覆盖」—— envelope 在帧离开解析器时才盖上，污染已发生在解析器内部
- 与 D1 互补而非替代：本 ADR 不**取消** envelope 防御（它仍防 P5），只是承认 envelope 不能独当 P3/P4

### D. 每流新建一个 module 实例 —— **已否决**

**理由**：破坏 Lynx module 身份契约。

- Lynx 4.0.1 的 `CommonModuleCreator.mModulesByName`（research §3 段）是 `ConcurrentHashMap<String, LynxModuleWrapper>`，wrapper 持有单例 `mModule`；绕开它需要反射或 fork Lynx runtime
- 即便能新建，每实例的 `STREAM_FRAMES` / `STREAM_TERMINAL` / `STREAM_SEQ` 也得跟着分裂 → JS 侧 `translatePoll(streamId)` 必须先按 module 寻址，复杂度陡增
- 与 ADR-0170 D1「`PictelioTranslate` 与 `PictelioApi` / `PictelioAuth` 同级 Lynx NativeModule」契约直接冲突
- 「每视图单例 + 内部分桶」是 Lynx 体系内已有的成熟范式（参考 `PictelioApi` / `PictelioAuth`），本 ADR 沿用而非另起

---

## References

- ADR-0170（app-lynx 翻译 native bridge / SSE 解析 / 信封契约 / `pruneFinishedStreams` 范式 / :471-485「开新流时清掉除自己以外的所有完结条目」/ :503「陈旧流不得写进当前翻译」/ §D6 推送 + 终态交付 / §D7 abort 通道 / 「交付通道实测」callback 通道 1/158 不可达）
- ADR-0174（Java 终态交付契约 Robolectric 单测防线 / D1「测试缝 = 生产流水线 `translatePoll`」/ D2 `TestLynxContext` + 假 `AndroidKeyStore` provider）
- 调研 #649 `docs/research/app-lynx-translation-cross-stream-contamination.md`（本 ADR 的事实基础：M1/M2/M3 + JS abort 死路径 + 模块身份论证 + 5 条可达 interleaving + 9 条安全前提 + 3 条「无法静态验证」项）
- spec `docs/specs/app-lynx-novel-translation.md` §7.2（流状态机：`translating` / `pending` / `completed` / `failed` / `aborted`）
- `TranslationSseParser.java`（`packages/app/android/app/src/main/java/io/pictelio/app/TranslationSseParser.java:36` `paragraphText` `TreeMap` / `:80` `emitConsolidated` 迭代 / `:134-137` `accept` 入 map / `hasText()` / `terminalError()`）
- `PictelioTranslateModule.java` HEAD `c7019273` 行号全集：
  - `:104` `ACTIVE_CALLS` / `:115` `USER_ABORTED` / `:122` `sseParser`（D1 删除） / `:135-137` `STREAM_FRAMES` / `:145` `STREAM_TERMINAL` / `:147` `STREAM_TERMINAL_MSG` / `:156-157` `frameQueue`（D1 删除） / `:303-304` streamId 入口 + prune / `:366` `ACTIVE_CALLS.put` / `:393-396` 每流新建 parser（替换为 D2 入口） / `:397` 旧 sseParser 赋值（D1 删除） / `:401-405` `flushIfAny`（替换为 D4 state-sourced） / `:409-416` drain from frameQueue（替换为 D3 state-sourced） / `:418` `sseParser.terminalError()`（替换为 D4 state-sourced） / `:474-488` `pruneFinishedStreams` 4 循环（新增第 5 个清 `STREAM_PARSE_STATE`） / `:536-537` `STREAM_SEQ` / `:714-732` `abortStream`（streamId-direct，已 #653 落地） / `:861-862` `processSseLine` 读字段（替换为 D4 state-sourced） / `:875` sink offer frameQueue（替换为 D2 state-sourced）
- `nativeTranslate.ts`（`packages/app-lynx/src/api/nativeTranslate.ts:474/478/589/602-607/675`，与本 ADR D6 / D2 JS 侧 streamId 共享键对齐）
- `novelTranslateStore.ts`（`packages/app-lynx/src/stores/novelTranslateStore.ts:615-621` 复用守卫 / `:785` `concurrency: 1` 边界）
- `LynxActivity.java:222/231/234` 模块注册表单例（research #649 §3）
- commit `c7019273`（#654 删除 `deltaSeen` / commit `6e1ad678`（#653 同步 abortHandle = streamId-direct）/ commit `6a648ab5`（STREAM_FRAMES 保留而非 drain）/ commit `13b1f58d`（24 轮审计三连击收尾）

---

## 实现期修订

无（ADR 与 #654 落地后的代码完全一致；本 ADR 是 #652 决策的架构层落地文档）。
