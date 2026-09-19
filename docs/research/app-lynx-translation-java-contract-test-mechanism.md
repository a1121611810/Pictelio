# wayfinder 研究：在 CI 门禁 `testFullDebugUnitTest` 中驱动 `PictelioTranslateModule` 的真实终态交付路径

- 研究问题：如何驱动 `translateStream` 参数校验 → `failStream` / 流收尾 → `registerTerminal` → `publishFramesViaEvent` 这条**真实**终态交付路径，使「终态被当裸文本交付」这类回归**真的变红**。
- 环境：macOS / JDK 21 / Robolectric 4.14.1 / `GRADLE_USER_HOME=packages/app/android/.gradle`。
- 被测源码状态：`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateModule.java`，工作树版（`git stash` 前的 M 状态），`md5 = 732d85baea341458cab9f70920d98c02`。**实验后已逐字节还原（md5 一致）**。
- 本次为实验新增的探针文件 `app/src/testFull/java/io/pictelio/app/WfScratchTranslateProbeTest.java` 已删除；源码内容只以本文 §5 的 sketch 形式保留。

---

## 0. 结论（推荐机制）

**零生产代码改动。** 模块自己的 `@LynxMethod` 公共面就是那条缝，而且它**本身就是生产路径**：

```java
// 测试侧（app/src/test/java/io/pictelio/app/PictelioTranslateModuleTerminalTest.java）
@RunWith(RobolectricTestRunner.class) @Config(sdk = 28)
public class PictelioTranslateModuleTerminalTest {

    /** LynxContext 唯一抽象方法 = handleException(Exception)（javap 实证），子类可构造 */
    private static final class TestLynxContext extends LynxContext {
        TestLynxContext(Context base) { super(base, new DisplayMetrics()); }
        @Override public void handleException(Exception e) { }
    }

    private PictelioTranslateModule module;

    @Before public void setUp() throws Exception {
        seedFakeAndroidKeyStore("sk-test-0123456789");     // §5.2，~50 行测试侧 SPI
        module = new PictelioTranslateModule(
                new TestLynxContext(ApplicationProvider.getApplicationContext()));
    }

    @Test public void httpNon2xxTerminalIsJsonNotRawText() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(429).setBody("{\"error\":\"rate\"}"));
        String id = UUID.randomUUID().toString();                  // 每个用例必须唯一 id（§2.4）
        module.translateStream(request(server.url("/").toString(), id), noopCallback());
        String payload = pollUntilNonPending(module, id);           // 生产拉取通道
        JSONObject t = new JSONObject(payload);                     // 裸文本在这一行炸 → 红
        assertEquals("error", t.getString("type"));
        assertEquals(id, t.getString("streamId"));                  // ADR-0170 信封契约
    }
}
```

两条硬规则（都由实测得出，§2.2）：**① 断言必须读 `translatePoll`**（生产读路径，与事件总线读同一个 `STREAM_TERMINAL`）；**② 成功路径必须先把帧缓冲排空**（解析器自己也 emit 一个 `done` 帧，会在读到终态登记表之前就把断言"骗绿"）。

---

## 1. 证据总览（跑过的 vs 推的）

### 1.1 变体编译矩阵（回答问题 2）

| 命令 | 结果 | 日志 |
|---|---|---|
| `./gradlew :app:compileWebviewDebugUnitTestJavaWithJavac` | **FAILED，200 个编译错误** | `/tmp/wf-webview-compile.log` |
| `./gradlew :app:compileLynxDebugUnitTestJavaWithJavac` | **FAILED，68 个编译错误** | `/tmp/wf-lynxcompile.log` |
| `./gradlew testFullDebugUnitTest`（CI 门禁原样） | **BUILD SUCCESSFUL** | `/tmp/wf-fullsuite-rerun.log` |

最终树上的**非缓存**复跑（`--rerun`）：`BUILD SUCCESSFUL in 13s`，48 个测试类 XML，`FAILED` 命中 0，exit 0。

### 1.2 探针矩阵（未变异生产代码）

下表**由三轮运行拼成**（诚实标注，避免"全绿"误导）：

- **第 1 轮**（`/tmp/wf-probe1.log`，9 个探针）：P1/P2/P9 绿；**P3 红**（`AndroidKeyStore not found` —— 平台能力探针，正是我们要证伪的那条）；**P4 红**（我把断言写成 `assertSame(app(), lc.getContext())`，而 `getContext()` 返回内部 `MutableContextWrapper` —— **构造本身成功**，打印值即证据）；P5–P8 红（当时还没有假 Keystore，`seedKey` 就抛了）。
- **第 3 轮**（`/tmp/wf-probe3.log`，8 个探针，假 Keystore 播种已就绪）：7 绿；P11 红是我当时把「零 delta 空流」的期望写成了 `error`（实测是 `done`，见 §3），改断言后绿。
- **基线**（最终 9 探针，`/tmp/wf-baseline.log` + `app/build/test-results/testFullDebugUnitTest/TEST-io.pictelio.app.WfScratchTranslateProbeTest.xml`）：**9/9 绿，1.8s**。

| 探针 | 驱动方式 | 实测交付载荷 |
|---|---|---|
| P1 | `new PictelioTranslateModule(applicationContext)`（普通 Context） | `WF-P1 OK io.pictelio.app.PictelioTranslateModule@...` |
| P2 | 普通 Context + `translateStream("{baseURL:""}")` → `translatePoll` | `{"type":"error","message":"baseURL 不能为空","streamId":"...","seq":0}` |
| P4 | `new TestLynxContext(app)` | `getContext()=MutableContextWrapper@...`、`getLynxView()=null`（构造成功） |
| P5 | MockWebServer 200 + SSE(delta+completed) | `[{"type":"delta_all",...seq:0},{"type":"done","usage":{...},"seq":1}]` |
| P6 | MockWebServer 429 | `{"type":"error","message":"HTTP 429: {\"error\":\"rate\"}",...}` |
| P7 | `http://127.0.0.1:1`（连接被拒） | `{"type":"error","message":"网络错误：Failed to connect to /127.0.0.1:1",...}` |
| P8 | MockWebServer `SocketPolicy.NO_RESPONSE` + `abortStream` | `{"type":"error","message":"aborted",...}` |
| P9 | 无 key（有 LynxContext） | `{"type":"error","message":"尚未配置 API key",...}` |
| P10 | 假 `AndroidKeyStore` provider + `SecureStorageCompat.encryptString` | `getItem()` 回明文 `sk-wf-probe-0123456789` |
| P12/P13 | 第二条流开始后看第一条流 | 新流拿到自己的终态；旧流 `{"type":"pending"}`（`pruneFinishedStreams` 生效） |
| P14 | 成功路径连续 3 次非 pending 交付都要求是 JSON | `[delta_all, done(解析器), done(终态寄存器)]` 三个都是 JSON |

### 1.3 变异实验（把生产路径改坏，看断言是否变红）

| 变异 | 改动 | 结果 |
|---|---|---|
| 基线 | — | **9/9 绿** |
| **M1** | `registerTerminal` 直接 `STREAM_TERMINAL.put(streamId, message)`（裸文本，不再盖章 JSON） | **6 红 / 3 绿**（`/tmp/wf-mutation-M1b.log` + `-M2` 合并跑）失败消息逐字：`org.json.JSONException: Value done of type java.lang.String cannot be converted to JSONObject` / `Value aborted ...` / `Value HTTP ...` / `Value 网络错误：Failed ...` / `Value baseURL ...` |
| **M2** | `publishFramesViaEvent` 改读 `STREAM_TERMINAL_MSG`（**总线只发裸文本**） | **9/9 绿（BUILD SUCCESSFUL）** → 事件总线载荷在 JVM 单测里是盲区（`/tmp/wf-mutation-M2only.log`） |

> M1 行数字来自「M1+M2 合并」的那一次运行（6 红：p6/p7/p8/p12/p13/p14）；M2 单跑全绿已证明 M2 对这批探针零影响，故合并跑的 6 红 = M1 单独效果。M1 单跑的日志（`/tmp/wf-mutation-M1.log`）里 p11 的红是那次编译中 p11 期望值尚未更新的陈旧断言，与变异无关。
> **M1 下 p5（成功路径"见到 done 就停"）保持绿** —— 这正是必须加 P14 的原因（见 §2.5）。

---

## 2. 逐问回答

### 2.1 问题 1：`LynxModule` 子类能否在 Robolectric 下构造？——能，且不需要 LynxContext

- **实测（P1）**：`new PictelioTranslateModule(RuntimeEnvironment.getApplication())` 直接成功。反编译 `com/lynx/jsbridge/LynxModule`（`lynx-4.0.1-runtime.jar`）：`LynxModule(Context)` 只做 `mContext = context; mParam = null;`，**没有类型检查、没有 native 调用**；`PictelioTranslateModule` 的构造器只 `super(context)`（`PictelioTranslateModule.java:185-187`）。
- **但要驱动 `appContext()` 就必须给一个 `LynxContext`**：`appContext()` = `((LynxContext) mContext).getContext()`（`:189-191`），普通 Context 会 ClassCastException，被 `translateStream` 的兜底 catch 抓成 `cb("", "请求构造失败：…")`（`:358-362`）——**不写终态**。
- **实测（P4）**：`LynxContext` 是抽象类但只有 1 个抽象方法 `handleException(Exception)`（`javap` 实证），所以测试可以本地子类化：`TestLynxContext extends LynxContext { super(base, new DisplayMetrics()); }`。构造成功，`getContext()` 返回内部 `MutableContextWrapper`（包着 app Context，可正常用），`getLynxView()` 返回 `null`（`publishFramesViaEvent` 的 `instanceof` + null 判断因此安全退出，`:559-567`）。
- **为什么 Clipboard/WebDav 当初没走这条路**：它们的 javadoc 写的是「LynxModule 构造函数需要 LynxContext，仓库没有任何测试构造过模块实例」（`app/src/test/java/io/pictelio/app/PictelioClipboardModuleTest.java:27-28`）。这句话**不精确**：`LynxModule(Context)` 接受任意 Context；真正需要 LynxContext 的是模块自己的 `mContext` 用法。不过对那两个模块而言静态缝更省事（无实例状态、无生命周期）：`PictelioClipboardModule.java:36` 的 `setText` 直接转发到包可见静态 `copyInto`（`:40`），`PictelioWebDavModule.java:49` 转发到 `run(callback, Op)`（`:121,127`）。翻译模块不同：它有实例状态（`frameQueue`、`sseParser`，`:157-158,119`），静态缝盖不住。
- **结论**：本仓库第一次有测试构造 `LynxModule` 实例（本探针）；这条能力是通用的（`TestLynxContext` 子类化技巧对任何 `LynxModule` 子类都成立）。

### 2.2 问题 2：上次会话的真凶——**变体选错**，症状可逐字复现

**复现（1.1 第一行）**：编译 webview 变体的单测源集时：

```
/app/src/test/java/io/pictelio/app/PictelioClipboardModuleTest.java:13: 错误: 程序包com.lynx.react.bridge不存在
import com.lynx.react.bridge.Callback;
/app/src/test/java/io/pictelio/app/TranslateEventContractTest.java:36: 错误: 找不到符号
        assertEquals(ADR_EVENT_NAME, PictelioTranslateModule.EVENT_FRAME);
  符号:   变量 PictelioTranslateModule
```

合计 **200 个错误**，`:app:compileWebviewDebugUnitTestJavaWithJavac FAILED`。英文 locale 下就是 `package com.lynx.react.bridge does not exist` + `cannot find symbol` —— 与上次会话记录的两条结论**完全对应**：
1. 「测试源集看不到测试缝（compile error: cannot find symbol）」→ `TranslateEventContractTest.java:36` 的 `PictelioTranslateModule`；
2. 「`Callback` 不在单测 classpath」→ `PictelioClipboardModuleTest.java:13` / `PictelioWebDavModuleTest.java:8` 的 `com.lynx.react.bridge.Callback`。

**机理**：`app/src/test/java` 是**所有 flavor 变体共用**的单测源集（`build.gradle:54-69` 只声明 flavor 的 `java.srcDir`，没有按 flavor 排除测试源），而 lynx 依赖只挂在 `lynxImplementation` / `fullImplementation`（`build.gradle:240,260-264`），lynx 源码只进 `src/lynx/java`（`:60-62`）。于是：
- `full` 变体：lynx + webview 源集/依赖都在 → `src/test/java` 能编译 ✅（CI 只跑这个：`.github/workflows/ci.yml:103-105` 就是 `./gradlew testFullDebugUnitTest --no-daemon`）；
- `webview` 变体：没有 lynx 依赖 → 200 错（`Callback` / `PictelioTranslateModule` / `PictelioImageService` / `UgoiraStreamEngine` …）；
- `lynx` 变体：没有 Capacitor/webview 源集 → **68 错**（`com.getcapacitor.JSObject`、`PictelioApp`；全部落在 `AuthPluginTest.java` / `PixivApiPluginTest.java` / `PictelioAppTest.java`）。

**判定**：上次会话跑的不是 `testFullDebugUnitTest`，而是任何会编译 webview 变体单测的命令（`./gradlew test` / `build` / `check` / `testWebviewDebugUnitTest`；这些在本仓库从来都是红的，且只有 full 变体是绿的）。**事实 1–3 全部成立**，不存在"测试源集看不见缝"的问题：`TranslateEventContractTest.java:36` 早就在 `src/test/java` 里引用 `PictelioTranslateModule.EVENT_FRAME` 并通过 CI。

### 2.3 问题 3：让缝被生产路径自己使用的最小改动 = **零改动**

本问题的"缝"已经存在且**就是生产路径**：`translateStream`（`:296`）/ `translatePoll`（`:605`）/ `abortStream`（`:711`）三个 `@LynxMethod`。实测四条终态路径全部可经它们驱动（§1.2），并且 M1 变异下断言确实变红（§1.3）。要补的只是**测试侧**两块平台缺口：

1. `TestLynxContext`（§2.1）——补 `LynxContext`；
2. 假 `AndroidKeyStore` provider（§5.2）——Robolectric 4.14.1 **没有** `AndroidKeyStore`（实测异常逐字：`java.security.KeyStoreException: AndroidKeyStore not found` / `Caused by: java.security.NoSuchAlgorithmException: AndroidKeyStore KeyStore not available`，栈顶 `SecureStorageCompat.getKeyStore(SecureStorageCompat.java:115)` ← `getOrCreateSecretKey(:92)` ← `setItem(:130)`）。这与仓库自己的判断一致：`SecureStorageCompatTest.java:27-28`「AndroidKeyStore 密钥路径…依赖系统 KeyStore，Robolectric 覆盖不稳定 → 归入 #51 原生环境验证」。假 provider 只伪造**密钥存储**（JVM 上不存在的那部分），密文仍由生产 `SecureStorageCompat.encryptString`（`SecureStorageCompat.java:55-57`）生成、由生产 `decryptString` 解密——不是"手写自洽字段"。

对题面给的两种形状的评估：

| 形状 | 本仓库先例 | 对本问题的评价 |
|---|---|---|
| **(a) 包可见静态缝**，由 `registerTerminal`/`failStream` 调用 | 强：`PictelioClipboardModule.copyInto`（`:40`，被 `setText:36` 调用）、`PictelioWebDavModule.run/errorJson`（`:127,157`）、`PictelioApiModule.streamDownloadZip/ugoiraStreamCore/...`（`:273,312,397,467,513`）、`PictelioPrefsModule.get/set/remove`（`:82,86,93`） | **不需要，且单独用会退化成"事实 5"的陷阱**：测试若直接 `static` 缝，改坏 `registerTerminal` 的 `put` 不影响静态缝，断言不会红。只有当缝被 `translateStream`/`translatePoll` 真正调用时才有意义——而它们已经在了。唯一值得的变体是**给 apiKey 读路径开缝**（绕开假 Keystore），但那需要"可变静态字段 + setter"，本仓库**没有**这种 test hook 先例（全仓 `ForTests/VisibleForTesting` 命中 0 处）。 |
| **(b) 抽出不依赖 `LynxContext` 的普通类**（终态盖章 + 入队 + 派发） | 强：**同一个模块**已经这么干过一次——`TranslationSseParser` + `Sink` 回调（`PictelioTranslateModule.java:851-873`，注释「解析逻辑抽到 TranslationSseParser（纯逻辑、可 Robolectric 单测；本模块此前零防线）」），测试见 `TranslationSseParserTest.java` | **对可达性零收益**（apiKey 门在它上游，`:337-346`）；**唯一独有价值 = 让事件总线载荷变成可断言对象**（补 §2.6 的 M2 盲区）。属于"更大改动换取一个盲区"，应由盲区本身的价值来立项，而不是为"可测性"——终态交付本来就可测。 |

### 2.4 问题 4：四条路径全覆盖 + 静态状态复位

| 终态路径 | 可驱动？ | 驱动方式（实测） | 证据 |
|---|---|---|---|
| ④ `translateStream` 参数校验失败（baseURL/model/https/input） | ✅ 连 LynxContext 都不需要 | `translateStream("{...bad...}")`（`:314-335` → `failStream:487`） | P2、P12、P13 |
| ⑤ 未配置 apiKey（同属 failStream） | ✅ 需要 `TestLynxContext` | key 缺失 → `:342-346` | P9 |
| ① HTTP 非 2xx | ✅ | MockWebServer 429（`:377-386`） | P6 |
| ② 网络异常 | ✅ | `http://127.0.0.1:1`（loopback 白名单 `:324-326` 正是为此留的） | P7 |
| ③ 用户 abort | ✅ | `SocketPolicy.NO_RESPONSE` 顶住流 + `abortStream`（`:711-724` → catch 分支 `:439-443`） | P8 |
| 成功 done（附带） | ✅ | SSE `delta+completed` | P5、P14 |

**静态状态**（全部 private static，无需也无法从生产侧重置）：

- `STREAM_FRAMES`（`:138`）/ `STREAM_TERMINAL`（`:148`）/ `STREAM_TERMINAL_MSG`（`:150`）/ `STREAM_SEQ`（`:533`）：**自我清理**——每次 `translateStream` 入场都 `pruneFinishedStreams(streamId)` 清掉除自己以外的所有条目（`:471-485`）。**实测**：P13 里第二条流开始后，第一条流的 `translatePoll` 返回 `{"type":"pending"}`。
- `ACTIVE_CALLS`（`:104`）与 `USER_ABORTED`（`:115`）：`abortStream` 写入（`:717-718`），worker 的 `finally` 清理（`:450-453`）。**风险点**：对"没有活 worker 的 streamId"调 `abortStream`，该 id 会永久留在 `USER_ABORTED` 里（生产没有重置入口），后续复用同 id 的用例会走静默路径。
- **复位策略（推荐）**：每个用例用 `UUID.randomUUID().toString()` 作为 `_abortToken`（与 JS 侧一致，`PictelioTranslateModule.java:304`），即可与残留状态天然隔离；无需反射清 map，也无需新增生产 API。Robolectric 每个测试方法会重置 Application/SharedPreferences，但**不会**重置这些类静态字段。abort 用例里我用了 `Thread.sleep(300)` 让 worker 进入阻塞读；**更短的等待（甚至不等待，因为 `ACTIVE_CALLS.put` 在 `execute` 之前，`:367`）大概率也成立，但未验证**。

### 2.5 问题 5：断言到底要观察什么

**要观察的是 `translatePoll` 返回的终态载荷**（`:605-628`，特别是 `:607` 读 `STREAM_TERMINAL`、`:620` 回传），断言它 `new JSONObject(payload)` 可解析且 `type ∈ {error, done}`、`streamId` 等于本流 id（信封契约单一事实源 = `docs/adr/ADR-0170-lynx-translate-nativemodule-bridge.md:492-506`）。

**为什么必须经生产读路径而不是直接调缝**：`translatePoll` 读的正是 `registerTerminal` 写的那个 `STREAM_TERMINAL`（`:514-515`）；把 `registerTerminal` 改回裸文本 `put`，这个寄存器里就是裸文本 → 生产读路径把它原样回传 → `JSONObject` 抛 `JSONException` → **红**（M1 实测：`Value done/aborted/HTTP/网络错误… of type java.lang.String cannot be converted to JSONObject`）。若测试直接调一个 test-only 静态缝，缝自身仍会构造 JSON，生产被改坏也照样绿——这正是事实 5 的教训。

**陷阱（实测，必须写进测试设计）**：成功路径下，解析器在 `response.completed` 上也 emit 一个 `{"type":"done"}` **负载帧**（`TranslationSseParserTest.java:86-95` 已钉住这一点；`processSseLine` 把它 `frameQueue.offer`，`:869-871`），而 `translatePoll` 优先返回帧缓冲（`:608-613`）。所以"轮询到第一个 `done` 就断言"的写法**永远读不到终态寄存器** → M1 下仍绿（P5 实测绿）。修正：断言**每一次交付的载荷都是 JSON**，即把缓冲排空（示例 SSE 体恰为 3 次非 pending：`delta_all` → 解析器的 `done` → 寄存器终态），或改用 error 类终态（校验/HTTP/网络/abort 四条路径帧缓冲为空，终态只能来自寄存器）。P14 在 M1 下红（`Value done of type java.lang.String...`），基线绿。

### 2.6 事件总线盲区（M2 实测，必须明说）

`publishFramesViaEvent`（`:557-595`）在 JVM 里不可观测：它的第一条语句就要求 `mContext instanceof LynxContext` 且 `ctx.getLynxView() != null`（`:559-567`），而 Robolectric 下 `getLynxView()` 恒为 `null`（P4 实测），真 `LynxView` 需要 native 库。**实测**：把总线改成发裸文本（M2）后，9 个探针全绿。
因此 JVM 断言只能钉住"**两个通道共同的那个字符串**"（`:584` 与 `:607` 读同一个 `STREAM_TERMINAL`），不能钉住总线这段代码本身。要闭环只有两条路：给 `LynxView.sendGlobalEvent` 做 Robolectric shadow（需要 `@Config(instrumentedPackages = "com.lynx.tasm", ...)`，仓库现有唯一 shadow 先例是对框架类：`PictelioAppTest.java:36,50-57`），或走 §2.3 的形状 (b) 把总线载荷构造抽出来直接断言。

---

## 3. 顺带发现（非本 ticket 交付物，供后续 ticket 参考）

SSE 只发 `response.completed`、**零 delta** 时，终态是 `done` 而不是空流失败：`WF-P11 payloads=[{"type":"delta_all","paragraphs":[],"streamId":"...","seq":0},{"type":"done",...}]`（`/tmp/wf-probe3.log`）。
成因：解析器在 `response.completed` 上仍 emit 一个空 `delta_all`，而 `processSseLine` 的 sink 只看帧类型就置 `deltaSeen = true`（`:851-873`），于是收尾的 `!deltaSeen` 空流分支（`:426-428`）永远不触发——与该分支注释「SSE 流结束但未产出任何译文段 → 报空流失败」及 `deltaSeen` 字段注释（`:120-121`）的意图相矛盾。JS 侧对空 `delta_all` 是 no-op（`packages/app-lynx/src/api/nativeTranslate.ts:503-509`），随后 `done` 会把状态机推进到 `completed`（`docs/specs/app-lynx-novel-translation.md:517-521`）。**我未核对 spec 是否显式要求空流报错**，故只作"实测行为 + 与注释不符"记录，不定性。

---

## 4. 我无法验证的

1. **上次会话到底跑了哪条命令**：我没有他们的原始日志，只精确复现了症状（webview 变体 200 错逐字命中两条结论）。仓库内（`.scratch/`、`.handoff.md`、`docs/`）没有留下相关笔记。
2. **`LynxView.sendGlobalEvent` 的 Robolectric shadow 是否可行**（`:584-587` 的载荷捕获）——未尝试；需要 instrument `com.lynx.tasm` 包，性能与副作用未知。
3. **无 sleep 的 abort 时序**（§2.4 最后一条）。
4. **假 Keystore provider 的选择顺序风险**：探针每次安装前检查同名 provider 已存在则跳过；若同一 JVM 里别的测试类注册了同名 provider，行为未定义（现有 41 个单测文件里没有）。
5. **成功率/稳定性**：每个探针只跑过 1–2 次；P8（abort）含 `Thread.sleep(300)`，CI 负载下可能需放宽。整套 9 探针耗时 1.8s，成本可接受。
6. **事件总线在真机上的行为**不受本机制影响：ADR-0170 记录 callback 通道「一条流至多 1 帧」，`translatePoll` 在生产实测回调 0/158（`docs/adr/ADR-0170-...md:471,488`）——所以本断言钉的是**状态寄存器内容**（两通道共享的单一事实源），不是"JS 真的收到了"。

---

## 5. 附：实测草图（探针文件已删，此处为可直接复用的骨架）

### 5.1 驱动与断言

```java
private static String request(String baseUrl, String id) {
    return "{\"baseURL\":\"" + baseUrl + "\",\"model\":\"gpt-5\",\"input\":[\"段落一\"],"
         + "\"_abortToken\":\"" + id + "\"}";
}

/** 轮询到非 pending（生产拉取通道） */
private static String pollOne(PictelioTranslateModule m, String id) throws Exception {
    for (int i = 0; i < 300; i++) {
        Rec cb = new Rec();                       // Callback.invoke 双参，记录实参
        m.translatePoll(id, cb);
        String payload = (String) cb.args[0];
        if (!"pending".equals(new JSONObject(payload).optString("type"))) return payload;
        Thread.sleep(50);
    }
    throw new AssertionError("15s 内无交付");
}

/** 成功路径：连续 3 次非 pending 交付都必须是 JSON（第 3 次只能来自 STREAM_TERMINAL） */
@Test public void successPathEveryDeliveredPayloadIsJson() throws Exception {
    String id = UUID.randomUUID().toString();
    module.translateStream(request(server.url("/").toString(), id), new Rec());
    for (int i = 0; i < 3; i++) new JSONObject(pollOne(module, id));   // 裸文本 → 红
}
```

### 5.2 测试侧假 `AndroidKeyStore`（Robolectric 无该 provider）

```java
public static final class FakeKeyStoreSpi extends java.security.KeyStoreSpi {
    static final Map<String, Key> KEYS = new ConcurrentHashMap<>();
    @Override public Key engineGetKey(String a, char[] p) { return KEYS.get(a); }
    @Override public KeyStore.Entry engineGetEntry(String a, KeyStore.ProtectionParameter p) {
        Key k = KEYS.get(a); return k == null ? null : new KeyStore.SecretKeyEntry((SecretKey) k);
    }
    @Override public boolean engineContainsAlias(String a) { return KEYS.containsKey(a); }
    @Override public Enumeration<String> engineAliases() { return Collections.enumeration(KEYS.keySet()); }
    // 其余 engineXxx 返回 null/false/空实现（约 12 个）
}

static void seedFakeAndroidKeyStore(String plaintext) throws Exception {
    // 注意：Android stub 的 java.security.Provider 只有 (String, double, String) 构造器（实测编译错）
    Security.addProvider(new Provider("AndroidKeyStore", 1.0d, "fake") {
        { put("KeyStore.AndroidKeyStore", FakeKeyStoreSpi.class.getName()); }
    });
    KeyGenerator gen = KeyGenerator.getInstance("AES");
    gen.init(128);
    SecretKey key = gen.generateKey();
    FakeKeyStoreSpi.KEYS.put("capacitor-storage_translate_llm_api_key", key);
    RuntimeEnvironment.getApplication()
        .getSharedPreferences("WSSecureStorageSharedPreferences", Context.MODE_PRIVATE)
        .edit()
        .putString("capacitor-storage_translate_llm_api_key",
                   SecureStorageCompat.encryptString(plaintext, key))   // 生产加密，密文格式契约不变
        .commit();
}
```

### 5.3 后续 ticket 的"红"验收步骤

```bash
# 1) 新测试基线必须绿
cd packages/app/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew testFullDebugUnitTest --no-daemon
# 2) 手工注入回归：PictelioTranslateModule.registerTerminal 里
#    STREAM_TERMINAL.put(streamId, withSeq(withStreamId(payload, streamId), streamId));
#    → STREAM_TERMINAL.put(streamId, message);
# 3) 重跑：error 类终态用例 + 成功路径排空用例必须同时变红（实测 6/9 红）
# 4) 还原（byte-exact）
```
