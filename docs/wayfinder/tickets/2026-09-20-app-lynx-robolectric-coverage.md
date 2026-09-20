# Ticket Plan — PictelioTranslateModule 补 Robolectric 单测（wayfinder #642）

**Part of:** wayfinder map #644（app-lynx 小说翻译收尾遗留项收敛）
**Source ticket:** issue #642（无标签 root ticket；与 #647 决策相关）
**ADR anchors:** [ADR-0174](https://github.com/a1121611810/Pictelio/blob/main/docs/adr/ADR-0174-java-translate-terminal-test-contract.md)（Java 终态测试契约）+ [ADR-0177](../docs/adr/ADR-0177-android-gradle-test-variant-gate.md) D2（CI 闸门 = testFullDebugUnitTest）
**Spec sections:** §10.1（测试 oracle 表）+ §10.3（端到端验收靠 android-e2e）
**Base line:** HEAD `03ed8610`（fix branch；含 5 张 ADR + spec 同步）

## Target end state

`PictelioTranslateModule.java` 在 CI 门禁 `./gradlew testFullDebugUnitTest` 内有完整的**真实生产路径**单测覆盖：
- 4 条终态路径（参数校验 / HTTP 非 2xx / 网络异常 / 用户 abort）
- 成功路径（流式 SSE delta + done）
- 边界场景（空流 #654 已覆盖）
- 跨流场景（per-stream 寄存器 + 切换流不残留状态）
- AbortController 包装（取消可达性 #649）

CI 防线**：变异测试可对每一类回归变红**（满足 #644 决策溯源「能对变异变红」标准）。

## 范围

**In:**
- `packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioTranslateModuleTerminalTest.java`（**新**）—— 4 条终态路径
- `packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioTranslateModuleSuccessTest.java`（**新**）—— 成功路径
- `packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioTranslateModuleCancelTest.java`（**新**）—— 取消可达性（#649 + #653）
- `packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioTranslateModuleCrossStreamTest.java`（**新**）—— 跨流状态隔离（#652 决议后实装）
- 复用 `PictelioTranslateModuleEmptyStreamTest`（#654 已落地）

**Out:**
- 真实 SSE 协议边界（`TranslationSseParserTest` 已有，独立单元）
- E2E 路径（android-e2e 手动按需，不阻塞）
- LynxView 事件总线载荷测试（JVM 单测盲区，ADR-0174 §D6 明文承认）

## 前置依赖

- ✅ #647 决策已解锁（ADR-0174 D1 已选 `translatePoll` 作为测试缝）
- ✅ #654 已落地（提供 `TestLynxContext` + `FakeKeyStoreSpi` 基础设施）
- ⚠️ 等待 ADR-0174 / ADR-0176 用户 review → 拍板后开工

## Tickets

### T1 — TerminalTest：4 条终态路径

**位置**：`packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioTranslateModuleTerminalTest.java`

复用 `PictelioTranslateModuleEmptyStreamTest` 的 `TestLynxContext` + `FakeKeyStoreSpi` + `request()` + `pollUntilTerminal()` 模板。

用例（每条都配 M1 变异实验）：

1. `httpNon2xxTerminalIsJsonNotRawText` —— MockWebServer 429 → `translateStream` → `translatePoll` 拿到 `{"type":"error","message":"HTTP 429: ...","streamId":"...","seq":...}`
2. `networkErrorTerminalIsJson` —— `http://127.0.0.1:1`（连接拒） → `{"type":"error","message":"网络错误：Failed to connect to /127.0.0.1:1: ...","streamId":"...","seq":...}`
3. `abortedStreamTerminalIsJson` —— MockWebServer `SocketPolicy.NO_RESPONSE` + `module.abortStream(token)` → `{"type":"error","message":"aborted","streamId":"...","seq":...}`
4. `parameterValidationFailsWithJsonError` —— `translateStream("{baseURL:''}", cb)` → `{"type":"error","message":"baseURL 不能为空","streamId":"...","seq":0}`

**变异实验**（已记录在研究文档 #646 §1.3）：
- M1：`registerTerminal` 改回裸文本 → 4 用例全红
- M2：`publishFramesViaEvent` 改读 `STREAM_TERMINAL_MSG` → 4 用例全绿（验证总线盲区）

### T3 — SuccessTest：成功路径

**位置**：`PictelioTranslateModuleSuccessTest.java`

用例：

1. `successStreamEmitsDeltaAndDone` —— MockWebServer 200 + SSE `[response.output_text.delta, response.completed]` → `translatePoll` 拿到 2 帧：`delta_all` + `done`
2. `successPathRequiresNonEmptyStream` —— 与 #654 互补：有 delta 的流必须 success
3. `doneTerminalCarriesUsage` —— `done` 帧的 `usage` 字段透传
4. `delta_allHasParagraphsIndexAndText` —— `delta_all.paragraphs[].{index, text}` 字段正确
5. `seqInjection_appliesAtBufferTime` —— ADR-0170 §6 修订：seq 入缓冲时盖章（同帧两路同字符串）

### T4 — CancelTest：取消可达性（#649 跨流串段可达性论证 + #653 修复）

**位置**：`PictelioTranslateModuleCancelTest.java`

用例：

1. `abortStreamOnLiveCall_terminatesOkHttp` —— `translateStream` + MockWebServer `SocketPolicy.DISCONNECT_AFTER_REQUEST` + `abortStream(token)` → 验证 OkHttp call 被取消（用 `MockWebServer.takeRequest()` 验证连接断开）
2. `abortAfterCompletion_noOp` —— 已 done 的流 abort 不报错
3. `abortBeforeStart_noOp` —— 未启动的 streamId abort 不报错
4. `multipleAbortSameToken_idempotent` —— 同一 token 多次 abort 不抛错

### T5 — CrossStreamTest：跨流状态隔离（#652 决议后）

**位置**：`PictelioTranslateModuleCrossStreamTest.java`

用例（依赖 ADR-0176 决议后的 per-stream 对象落地）：

1. `twoStreamsAreIndependent` —— 流 A 在 translating 时流 B 启动 → A 的帧不被 B 的 STREAM_TERMINAL 看见
2. `staleStreamNotAffectedByNewTranslation` —— 流 A done 后清空 STREAM_TERMINAL → 新翻译 B 启动 → B 不读 A 的残留
3. `terminal_usesStreamIdFiltering` —— 旧流 A 的 frameQueue 不被新流 B 的 translatePoll 拉到

### T6 — CI 门禁与变异实验

- pre-push 钩子继续生效（已验证 #654）
- 全量 `testFullDebugUnitTest` 跑过 → `48+ tests in this file, 0 failures`
- 每个新测试至少 1 条变异实验（research #646 模式）

## CI 门禁（合并前置）

- `./gradlew :app:testFullDebugUnitTest --tests "*PictelioTranslateModule*Test" --rerun` 全绿
- `./gradlew :app:testFullDebugUnitTest` 全量绿（防回归）
- 至少 3 条变异实验记录在 commit message

## 验收（设备实测）

- 真机 / 模拟器：`./gradlew testFullDebugUnitTest` 在 CI 镜像上可重现跑过
- 不依赖 android-e2e（device-side 是手动按需）
- 提交时引用 #647 / #642 关闭

## Out of scope

- 真实 SSE 协议边界（`TranslationSseParserTest` 已有）
- E2E 路径
- LynxView 事件总线载荷测试（JVM 盲区，ADR-0174 §D6 承认）

## References

- ADR-0174 D1（测试缝 = translatePoll）+ D2（基础设施 TestLynxContext + FakeKeyStoreSpi）+ D3（M1/M2 变异）+ D6（事件总线盲区承认）
- ADR-0177 D2（CI 闸门 = testFullDebugUnitTest）+ D3（禁用 ./gradlew test|build|check）
- ADR-0170 §6（信封契约 seq 入缓冲盖章）+ §1.4（终止盖章 JSON）
- 研究 #646（机制研究：M1 变异下 6/9 探针红）
- spec §10.1（oracle 表）/ §10.3（E2E 靠 android-e2e）
- 实施 ticket issue #642 / 决策票 issue #647
- 姊妹 ticket：`2026-09-20-fix-empty-stream-gate.md`（#654 基础设施来源）