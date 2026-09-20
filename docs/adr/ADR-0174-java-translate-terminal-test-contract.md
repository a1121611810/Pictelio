# ADR-0174: PictelioTranslate Java 终态交付契约的单测防线（机制采纳）

- **状态**: proposed
- **日期**: 2026-09-20
- **关联**: wayfinder map [#644](https://github.com/a1121611810/Pictelio/issues/644)（app-lynx 翻译收尾遗留项收敛）；issue [#647](https://github.com/a1121611810/Pictelio/issues/647)（决策：Java 交付契约防线——仅剩「总线载荷在 JVM 是盲区」这一项）；issue [#642](https://github.com/a1121611810/Pictelio/issues/642)（root ticket：PictelioTranslateModule 补 Robolectric 单测）；调研 [#646](https://github.com/a1121611810/Pictelio/issues/646)（CLOSED：在 JVM 单测驱动 PictelioTranslate 真实终态路径的可行机制）；ADR-0170（PictelioTranslate native bridge / 信封契约 / `translateStream` → `translatePoll` 交付通道）；ADR-0163（QA 防线三网——平台事实取证模式 + 转换矩阵）；ADR-0097（`passWithNoTests: false` 门禁）

---

## 背景

wayfinder map #644 收尾过程中，跨流污染调研 #649（多窗口竞态 + 缓存残留）与 24 轮审计（spec §10.3 + ADR-0163 转换矩阵触发）同时指向同一处缺口：**`PictelioTranslate` Java 端的「终态交付契约」在 CI 门禁内零防线**。具体表现为：仓库已上线 ADR-0170 的全部 native bridge 行为（参数校验 / Keystore 写入 / 流式 SSE 解析 / `translatePoll` 兜底拉取 / 终态盖章 / abort 流），但 `app/src/test/java/io/pictelio/app/` 内**没有任何测试类**能驱动 `translateStream` → `failStream` / `registerTerminal` → `publishFramesViaEvent` + `translatePoll` 这条真实生产路径（issue #647 §症状）。

### 为什么这道防线缺不得

1. **终态被当裸文本交付** = 永久挂起的 UI 状态。`translateStream` 异常分支若 `STREAM_TERMINAL.put(streamId, rawText)`（无 `withSeq(withStreamId(payload, streamId), streamId)` 盖章），JS 侧轮询拿到 `String`，`JSONObject` 解析直接抛 → 状态机卡在「n% 翻译中」直到用户手动重启 App（2026-09-16 历史缺陷复现，参见 ADR-0170 §实现期修订）。
2. **4 条终态路径共用单一寄存器**（`STREAM_TERMINAL`：`PictelioTranslateModule.java:145`）—— 任一路径（参数校验 / HTTP 非 2xx / 网络异常 / 用户 abort）回归都会让 UI 永久挂起，**不存在「局部失效」**。
3. **现有先例只覆盖解析器**（`TranslationSseParserTest.java`），不覆盖「解析 + 终态盖章 + 入队 + 派发」这条完整管线（research §2.3）—— 这是 `registerTerminal` 与 `failStream` 之间的真实生产路径。
4. **CI 门禁原样已可驱动 JVM 单元测试**：`./gradlew testFullDebugUnitTest --no-daemon`（`.github/workflows/ci.yml:103-105`），且 webview 变体的「200 编译错」（research §2.2）是上次会话跑错命令所致，不是源集本身的问题（research §2.2 末段）—— 跑 full 变体即可。

调研 #646（CLOSED）以 `app/src/testFull/java/io/pictelio/app/WfScratchTranslateProbeTest.java`（实验性探针文件，实验后已删；研究留存于 `docs/research/app-lynx-translation-java-contract-test-mechanism.md`）证明了：

- `LynxModule(Context)` 接受任意 Context（`LynxModule.java` 反编译实证；research §2.1）；
- 真 `LynxContext` 抽象方法 = 1 个（`handleException`，`javap` 实证），可本地构造 `TestLynxContext` 子类（research §2.1）；
- Robolectric 4.14.1 无 `AndroidKeyStore` provider（异常逐字复现），但可用 `Provider("AndroidKeyStore", 1.0d, ...)` + `KeyStoreSpi` 子类伪造**密钥存储**（不伪造密文，密文仍由生产 `SecureStorageCompat.encryptString` 生成，research §5.2）；
- 4 条终态路径 + 成功路径在 JVM 内全部可驱动（research §1.2 探针 P5/P6/P7/P8/P14）；
- M1 变异（`registerTerminal` 改回裸文本 `put`）下 6/9 探针变红，M2 变异（事件总线改裸文本）下 9/9 探针全绿 → **JVM 单测可钉住寄存器空间 → 事件总线这一段是盲区**（research §2.6）。

本 ADR 在零生产代码改动前提下，把上述机制固化为 `PictelioTranslate` Java 终态交付契约的**官方 CI 防线**。

---

## 决策

### D1. 测试缝 = 生产流水线 `translatePoll`（不是 test-only 静态 hook）

**采纳 research §2.3 的结论（b）：缝即生产路径。** 测试必须经 `@LynxMethod public void translatePoll(String streamId, Callback callback)`（`PictelioTranslateModule.java:608-628`，生产拉取通道）读取终态寄存器 `STREAM_TERMINAL`（`:145`），不另开静态测试 hook。

**为什么**：

- `translatePoll` 与事件总线共享同一个 `STREAM_TERMINAL` 寄存器（research §2.5 + `:610` ← `:145` 的同一引用；事件总线读与 poll 读在 `:587` 与 `:610` 行**字符串字面量等价**）。把 `registerTerminal` 改回裸文本 `put`，这个 map 里就是裸文本 → 生产读路径原样回传 → `new JSONObject(payload)` 抛 `JSONException` → **断言变红**（M1 实测 6/9 红，逐字：`Value done of type java.lang.String cannot be converted to JSONObject`）。
- 若测试直接调 test-only 静态缝，缝自身仍会构造 JSON，生产被改坏也照样绿—— 这正是 #647 题面里「事实 5」陷阱的复刻（research §2.3「对题面给的两种形状的评估」）。
- 仓库先例 `PictelioClipboardModule.copyInto`（`PictelioClipboardModule.java:40`）+ `PictelioWebDavModule.run`（`:127`）+ `PictelioApiModule.streamDownloadZip`（`:273`）等**包可见静态缝**对此问题**不适用**：翻译模块有实例状态（`frameQueue` `:157`、`sseParser` `:119`），静态缝盖不住，且单独使用会退化成事实 5（research §2.3 评估表）。

**不**新增 `static @VisibleForTesting` 字段或 `ForTests` 内部包。**不**为 apiKey 读路径开「可变静态字段 + setter」缝—— 全仓 `ForTests/VisibleForTesting` 命中 0 处（research §2.3 末段）。

### D2. 测试侧两块平台缺口 = TestLynxContext + 假 AndroidKeyStore provider

**测试侧**需补两块平台能力（**零生产代码改动**）：

#### D2.1 `TestLynxContext` 子类

```java
// 测试源集内
private static final class TestLynxContext extends LynxContext {
    TestLynxContext(Context base) { super(base, new DisplayMetrics()); }
    @Override public void handleException(Exception e) { /* no-op */ }
}
```

- `appContext()`（`PictelioTranslateModule.java:188-191`）需 `mContext instanceof LynxContext`；普通 Context 会 ClassCastException，被 `translateStream` 兜底 catch 抓成 `cb("", "请求构造失败…")`（`:358-362`）—— **不写终态**（research §2.1）。
- `LynxContext` 抽象方法只有 1 个（`handleException`，`javap` 实证；research §2.1）—— 测试可本地子类化。`getContext()` 返回内部 `MutableContextWrapper`（包着 app Context，可正常用），`getLynxView()` 恒为 `null`（research §1.2 P4）—— 这恰好是 D6 事件总线盲区的成因。
- 此技巧对任何 `LynxModule` 子类都成立（research §2.1 末段），本 ADR 是仓库内**首次**有测试构造 `LynxModule` 实例。

#### D2.2 假 `AndroidKeyStore` provider

```java
public static final class FakeKeyStoreSpi extends KeyStoreSpi {
    static final Map<String, Key> KEYS = new ConcurrentHashMap<>();
    @Override public Key engineGetKey(String alias, char[] p) { return KEYS.get(alias); }
    // engineGetEntry / engineContainsAlias / engineAliases ...
}
```

- Robolectric 4.14.1 无 `AndroidKeyStore`（research §2.3 异常逐字：`java.security.KeyStoreException: AndroidKeyStore not found` ← `getOrCreateSecretKey` ← `setItem`）。
- 假 provider 只伪造**密钥存储**（JVM 上不存在的那部分），密文仍由生产 `SecureStorageCompat.encryptString`（`SecureStorageCompat.java:55-57`）生成、由生产 `decryptString` 解密 —— **不是"手写自洽字段"**，仓库测试硬约束 #2 通过（ADR-0163 + AGENTS.md 测试硬约束 2「真实样例」）。
- 仓库自己的判断一致：`SecureStorageCompatTest.java:27-28` 注释「AndroidKeyStore 密钥路径…依赖系统 KeyStore，Robolectric 覆盖不稳定 → 归入 #51 原生环境验证」。
- 假 provider 安装前检查同名 provider 已存在则跳过；若同一 JVM 内多个测试类注册同名 provider 行为未定义（research §4 #4），但当前 41 个单测文件无此先例 —— 风险可接受。

### D3. 覆盖范围：5 条路径（全终态路径 + 成功路径）

| # | 路径 | 驱动方式 | 引用 |
|---|------|----------|------|
| 1 | **参数校验失败**（baseURL / model / https / input） | `translateStream("{...bad...}")` → `translatePoll` | `:314-335` → `failStream:487`（research §2.4 #④ / 探针 P2） |
| 2 | **未配置 apiKey**（同属 `failStream`） | key 缺失 → `:342-346` | 探针 P9 |
| 3 | **HTTP 非 2xx** | MockWebServer 429 → `failStream` `:377-386` | 探针 P6 |
| 4 | **网络异常** | `http://127.0.0.1:1`（loopback 白名单 `:324-326` 正是为此留的） | 探针 P7 |
| 5 | **用户 abort** | `SocketPolicy.NO_RESPONSE` 顶住流 + `abortStream` → catch 分支 `:439-443` | 探针 P8 |
| 6 | **成功 done**（附带） | SSE `delta+completed` → `registerTerminal(:514-515)` | 探针 P5、P14 |

每条用例**必须**含 3 个断言：

1. `new JSONObject(payload)` 不抛（**裸文本在这一行炸 → 红**，research §0）；
2. `payload.type ∈ {error, done}`；
3. `payload.streamId == _abortToken`（**信封契约**：ADR-0170 §实现期修订 + `:492-506`）。

### D4. 静态状态隔离 = 唯一 streamId（UUID.randomUUID）

**每个用例必须用 `UUID.randomUUID().toString()` 作为 `_abortToken`**（与 JS 侧约定一致，`PictelioTranslateModule.java:304`）。

**为什么**：

- 静态 map（`STREAM_FRAMES :138` / `STREAM_TERMINAL :145` / `STREAM_TERMINAL_MSG :147` / `STREAM_SEQ :533`）虽然有 `pruneFinishedStreams(streamId)` 自清理（`:471-485`，每次入场清掉除自己外所有条目；research §2.4），但：
  - **`USER_ABORTED :115` 无重置入口**——对「没有活 worker 的 streamId」调 `abortStream`，该 id 永久留在 set 里（research §2.4 末段）。后续复用同 id 的用例会走静默路径（worker 在 `execute()` 之前已 `ACTIVE_CALLS.put`，`:367`，先于 `USER_ABORTED.contains` 检查 `:370`，但若 worker 已退出且 `_abortToken` 撞 id，会被早期 catch 误判为已 abort）。
  - Robolectric **不会**重置类静态字段（research §2.4）。
- UUID 隔离 = **零反射清 map，零新增生产 API**，与现有 JS 侧 token 形态完全一致（ADR-0170 §D7）。
- **不**在生产侧新增「测试用清静态状态」API —— 违反 D1「缝即生产路径」原则。

### D5. 成功路径陷阱：必须排空帧缓冲

成功路径下，`TranslationSseParser.processSseLine` 在 `response.completed` 上**也 emit 一个 `{"type":"done"}` 负载帧**（`TranslationSseParserTest.java:86-95` 已钉住；sink 只看帧类型置 `deltaSeen = true` —— 见 §3 顺带发现），并被 `frameQueue.offer` 入缓冲（`:869-871`）。

`translatePoll` 优先返回帧缓冲（`:608-613`）。所以**「轮询到第一个 done 就断言」**的写法**永远读不到终态寄存器** → M1 变异下仍绿（research §2.5 P5 实测）。

**强制修正**（research §2.5 末段）：

- 错误类终态（路径 #1-5）**帧缓冲为空** → `translatePoll` 自然落到 `STREAM_TERMINAL` 寄存器读取（`:610` + `:616-620`）—— M1 变异下断言变红（M1 实测 6/9 红：p6/p7/p8/p12/p13/p14）。
- 成功路径（路径 #6）**必须断言「每一次非 pending 交付的载荷都是 JSON」**（research §1.2 P14；示例 SSE 体恰为 3 次非 pending：`delta_all` → 解析器的 `done` → 寄存器终态），不能停在第一个 `done`。或：分两段断言，第一段消费 `delta_all`、第二段消费 `done`（断言第二段为 JSON 即可，寄存器终态与解析器的 done 字面相同可证明终态也经过盖章）。

### D6. 事件总线盲区：明文承认，≥1 mutation test/release 兜底

`publishFramesViaEvent`（`PictelioTranslateModule.java:560-595`）在 JVM 内**不可观测**：方法第一条语句就要求 `mContext instanceof LynxContext` 且 `ctx.getLynxView() != null`（`:565-568`），Robolectric 下 `getLynxView()` 恒为 `null`（research §1.2 P4 实测；真 `LynxView` 需要 native 库）。

**实测**：把事件总线改裸文本（M2 变异，research §1.3）后，9 个探针全绿。**JVM 单测能钉住的是两通道共同的那个字符串**（`:587` 与 `:610` 读同一个 `STREAM_TERMINAL`），**钉不住总线这段代码本身**（research §2.6）。

**两条解法路径**（research §2.6），**本 ADR 不选定**：

1. **LynxView.sendGlobalEvent Robolectric shadow** —— 需要 `@Config(instrumentedPackages = "com.lynx.tasm", ...)`；仓库现有唯一 shadow 先例是对框架类（`PictelioAppTest.java:36,50-57`）。性能与副作用未知（research §4 #2）。
2. **抽出事件总线载荷构造为单独可测类**（research §2.3 形状 b）—— 仓库已有先例：`TranslationSseParser`（`PictelioTranslateModule.java:851-873`，纯逻辑、无 `LynxContext` 依赖，测试见 `TranslationSseParserTest.java`）。

**当前采纳**（research §2.6 末段）：

- D6.1 **盲区承认**：JVM 单测不钉事件总线载荷，仅钉状态寄存器内容（两通道共享的单一事实源）。
- D6.2 **成本 ≤1 mutation test / release**：每次发布前手工跑一次 M2 变异（事件总线改裸文本），跑 android-e2e「翻译按钮 ≥4 段成功流」—— 若真机能拿到完整译文，证明总线载荷未退化。**不**纳入 CI（emulator 启动慢、变体矩阵按需）。
- D6.3 **留口**：若未来任一 release 的 M2 mutation test 失败（即总线载荷回归），立即启用方案 1 或方案 2 之一（届时另起 ADR 决策）。

**为什么不立即选定方案 1 或方案 2**：research §2.6 明说「JVM 断言只能钉住两通道共同的那个字符串」—— 当前机制已能钉住寄存器 100% 的回归；总线盲区是已知缺陷、**已知修复路径**、**已知成本**（≤1 mutation test/release），不阻塞本 ADR 落地。

---

## 后果

### 正面

- **CI 内 Java 终态契约防线**：`./gradlew testFullDebugUnitTest` 内新增 `PictelioTranslateModuleTerminalTest`（research §0 / §5.1 sketch），CI 跑 5 条终态路径 + 成功路径全部断言 —— 任何「终态被当裸文本交付」类回归 5/6 路径立刻变红（M1 实测 6/9 红、去掉 P11 期望值笔误与 P10 假 Keystore 单点探针后为 6/6 路径变红）。
- **零生产代码改动**：测试缝 = 生产路径（`translateStream` + `translatePoll` + `abortStream`），不引入 test hook、不改生产 API、不改打包配置（research §2.3「本问题的缝已经存在且就是生产路径」）。
- **mutation-resistant**：M1 变异（`registerTerminal` 改回裸文本 `put`）6/6 路径变红；M2 变异（事件总线改裸文本）仅总线盲区逃逸（D6.2 mutation test 兜底）。
- **跨测试隔离 = UUID，不引入反射 / 静态状态重置**：与 JS 侧 token 形态一致（ADR-0170 §D7），跨 Robolectric 测试方法天然独立（research §2.4）。
- **仓库内首次构造 `LynxModule` 实例的测试先例**：`TestLynxContext` 子类化技巧对任何 `LynxModule` 子类都成立（research §2.1 末段），未来 Lynx NativeModule 单测可零成本复用。

### 负面 / 成本

- **事件总线载荷在 JVM 是盲区**（D6）：M2 变异全绿，需 mutation test + 真机 e2e 兜底（≤1 mutation test / release）。
- **~50 行测试侧平台桥接**（research §0 §5.2）：`TestLynxContext`（约 5 行）+ `FakeKeyStoreSpi`（约 30 行 KeyStoreSpi 抽象方法实现）+ `seedFakeAndroidKeyStore`（约 15 行）。**全部在测试源集内**，零生产代码变更。
- **CI 环境约束 = full 变体**：测试源集 `app/src/test/java` 是所有 flavor 变体共用，lynx 依赖只挂在 `lynxImplementation` / `fullImplementation`（research §2.2 + `build.gradle:240,260-264`）—— CI 必须跑 `testFullDebugUnitTest`（已是现状，`.github/workflows/ci.yml:103-105`）。**禁止**跑 `test` / `testWebviewDebugUnitTest`（webview 变体 200 编译错逐字命中；research §2.2）。
- **Robolectric 4.14.1+ 要求**：假 `AndroidKeyStore` provider 的 `Provider(String, double, String)` 构造器（实测编译错：Android stub 缺该构造器）需要 Robolectric ≥ 4.14.1（JDK 21 兼容版本）—— 当前仓库版本已满足（research §0 环境声明）。
- **成功率/稳定性**：research §4 #5 明说每个探针只跑过 1–2 次；P8（abort）含 `Thread.sleep(300)`，CI 负载下可能需放宽到 500ms。implement 阶段需在 CI 跑 3-5 轮验证稳定性。
- **假 Keystore provider 的选择顺序风险**（research §4 #4）：探针每次安装前检查同名 provider 已存在则跳过；若同一 JVM 里别的测试类注册同名 provider，行为未定义。**当前 41 个单测文件无此先例**，风险可接受；future-safe：测试 fixture 改用 `@BeforeClass` 一次性安装 + `@AfterClass` 清理。

---

## Alternatives Considered

### A) 抽出终态盖章为不依赖 `LynxContext` 的普通 Java 类（research §2.3 形状 b）

**评估**：仓库已有先例（`TranslationSseParser` + `Sink` 回调，`PictelioTranslateModule.java:851-873`，测试见 `TranslationSseParserTest.java`）。**拒绝理由**：

1. **对可达性零收益**——`apiKey` 门在它上游（`:337-346`），可测性不改善；
2. **不修事件总线盲区**（D6）—— 抽出的类仍不感知 `LynxView`，盲区仍在；
3. **更大改动换 0 收益**—— 当前 `registerTerminal` + `failStream` + `translatePoll` 已可断言（research §1.2）。

**保留为后续升级路径**（D6.3 方案 2）：若 M2 mutation test 在某次 release 失败，立即启用此方案。

### B) 包可见静态缝（test-only static hook）

**评估**：仓库强先例（`PictelioClipboardModule.copyInto:40` + `PictelioWebDavModule.run:127` + `PictelioApiModule.streamDownloadZip:273`）。**拒绝理由**：

1. **单独用会退化成事实 5 陷阱**（research §2.3）：测试若直接调静态缝，改坏 `registerTerminal` 的 `put` 不影响静态缝，断言不会红。M1 变异下静态缝自身仍会构造 JSON → **绿**—— 与「测得到」的目标相反；
2. **翻译模块有实例状态**（`frameQueue:157`、`sseParser:119`），静态缝盖不住；
3. **唯一值得的变体** = 给 apiKey 读路径开缝（绕开假 Keystore），但需「可变静态字段 + setter」—— 全仓 `ForTests/VisibleForTesting` 命中 0 处，无先例；
4. **D1 已固化为「缝即生产路径」原则**—— 加静态缝与之冲突。

### C) Mock `LynxView` via Robolectric shadow（`LynxView.sendGlobalEvent` Robolectric shadow）

**评估**：最彻底的方案——能给总线载荷设断言（research §2.6）。**拒绝理由**：

1. **需要 `@Config(instrumentedPackages = "com.lynx.tasm", ...)`**（research §2.6）—— 给第三方包加 instrument，性能与副作用未知；
2. **仓库现有唯一 shadow 先例是对框架类**（`PictelioAppTest.java:36,50-57`），不覆盖第三方 `com.lynx.tasm`；
3. **research §4 #2** 明说「未尝试」；
4. **当前机制已能钉住寄存器 100% 回归**（D6.1），总线盲区有 mutation test 兜底（D6.2）—— 立即上 shadow 性价比低。

**保留为后续升级路径**（D6.3 方案 1）。

### D) 仅靠 E2E（android-e2e `translate.spec.ts`，跳过 JVM 单测）

**拒绝**：

- **ADR-0084** agent-browser 入门禁；
- **spec §10.3** android-e2e 是「手动按需」级别（转换矩阵门 `transition-matrix.spec.ts` @release-gate，ADR-0163），不在 CI 主流程；
- emulator 启动慢、变体矩阵按需 → 慢反馈，单条流回归要 5+ 分钟才能被发版前矩阵捕获；
- 调试成本远高于 JVM 单测（logcat 取证、断点困难）；
- 与本 ADR「CI 内机器防线」目标相悖（AGENTS.md 门禁边界 #539 拍板「关键行为必须有 CI 内单测防线」）。

---

## References

- **调研** [`docs/research/app-lynx-translation-java-contract-test-mechanism.md`](../research/app-lynx-translation-java-contract-test-mechanism.md)（CLOSED #646）—— §0 结论 / §1.2 探针矩阵 / §1.3 变异实验 / §2.1 LynxModule 构造性 / §2.2 变体编译矩阵 / §2.3 缝的形态评估 / §2.4 四条路径全覆盖 / §2.5 断言观察对象 + 成功路径陷阱 / §2.6 事件总线盲区 / §5.1 + §5.2 可复用骨架
- **ADR-0170** [`docs/adr/ADR-0170-lynx-translate-nativemodule-bridge.md`](./ADR-0170-lynx-translate-nativemodule-bridge.md)—— `translateStream :295` / `translatePoll :608` / `abortStream :714` / `STREAM_TERMINAL :145` / `publishFramesViaEvent :560` / §D7 AbortController token / §D8 测试策略（Java 单测 + Robolectric 模式，本 ADR 是其落地）/ §实现期修订（终态被当裸文本交付 = UI 永久挂起的历史缺陷翻版）
- **ADR-0163** [`docs/adr/ADR-0163-qa-defense-lines.md`](./ADR-0163-qa-defense-lines.md)—— QA 防线三网 / 转换矩阵 / 平台事实取证模式
- **ADR-0097** `passWithNoTests: false` 门禁（防本测试集成为空壳）
- **issue #647**（wayfinder:grilling 决策：Java 交付契约防线——仅剩「总线载荷在 JVM 是盲区」这一项；本 ADR 是其落点）
- **issue #644**（wayfinder 地图：app-lynx 翻译收尾遗留项收敛）
- **issue #642**（root ticket：PictelioTranslateModule 补 Robolectric 单测）
- **issue #646**（CLOSED 研究：JVM 单测驱动 PictelioTranslate 真实终态路径的可行机制——本 ADR 采纳的机制出处）
- **`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateModule.java`**（生产代码路径行号锚点）
- **`packages/app/android/app/src/testFull/java/io/pictelio/app/WfScratchTranslateProbeTest.java`**（research 实验性探针，实验后已删除；research §5 留存 sketch）
- **`packages/app/android/app/src/testFull/java/io/pictelio/app/TranslationSseParserTest.java`**（解析器单测先例，§D5 引用其 :86-95）
- **`packages/app/android/app/src/testFull/java/io/pictelio/app/SecureStorageCompatTest.java`**（:27-28 注释 AndroidKeyStore 在 Robolectric 下覆盖不稳定的来源）
- **`packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioAppTest.java`**（:36, 50-57 仓库唯一 Robolectric shadow 先例，§D6 / Alternatives C 引用）
- **`.github/workflows/ci.yml:103-105`**（`./gradlew testFullDebugUnitTest --no-daemon` 已是 CI 门禁原样，无需新增步骤）
- **`packages/app/android/app/build.gradle:54-69, 240, 260-264`**（test 源集共享 + lynx 依赖条件，本 ADR 必须在 full 变体下跑，research §2.2 实证）