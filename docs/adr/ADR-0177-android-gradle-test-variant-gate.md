# ADR-0177: Android Gradle 单测变体门禁（`./gradlew test|build|check` 恒红陷阱收口）

- **状态**：accepted（2026-09-20，用户 review 通过）
- **日期**：2026-09-20
- **关联**：wayfinder map [#644](https://github.com/a1121611810/Pictelio/issues/644)（app-lynx 翻译收尾，#655 为本 ADR 父 ticket）；决策 ticket [#655](https://github.com/a1121611810/Pictelio/issues/655)（wayfinder:grilling）；研究 [#646](https://github.com/a1121611810/Pictelio/issues/646) §2.2（机制证明 + 上一 session 误诊证伪，本 ADR 唯一事实来源）；[`packages/app/android/app/build.gradle`](../../packages/app/android/app/build.gradle) flavor / sourceSets / dependencies 三段（`:54-69` / `:240-265` / `:268-275`）；[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) `android-unit-test` job（`:64-105`，门禁即 `./gradlew testFullDebugUnitTest`）；ADR-0170（姊妹 ADR：跨端信封契约——本 ADR 收敛其单元测试可达性）；ADR-0174（Java translate 终态契约测试——已先于本 ADR 落地，证明 C 可行）

---

## 背景

### 现象

`./gradlew test` / `build` / `check` 在本仓库**恒红**（webview 变体 200 个编译错误、lynx 变体 68 个编译错误）。只有 `./gradlew testFullDebugUnitTest` 是绿的——CI 跑的正是它（`ci.yml:103-105`）。这条事实已造成至少**两次误诊**（issue #655 票面与 #644 交接文档第 2 条勘误所引）。

### 研究结论（#646 §2.2，唯一事实来源）

`packages/app/android/app/src/test/java` 是**所有 flavor 变体共用**的单测源集（`build.gradle:54-69` 只声明了 flavor 的 `java.srcDir` 包含哪些**生产**源，没有按 flavor 排除**测试**源）。Lynx 依赖只挂在 `lynxImplementation` / `fullImplementation`（`build.gradle:240, 260-264`），Lynx 源码只进 `src/lynx/java`（`:60-62`）。于是：

| 命令 | 实测结果（#646 §1.1） |
|------|-----------------------|
| `:app:compileWebviewDebugUnitTestJavaWithJavac` | **FAILED，200 个编译错误**（`Callback` / `PictelioTranslateModule` / `PictelioImageService` / `UgoiraStreamEngine` ...） |
| `:app:compileLynxDebugUnitTestJavaWithJavac` | **FAILED，68 个编译错误**（`com.getcapacitor.JSObject` / `PictelioApp` ...） |
| `testFullDebugUnitTest`（CI 门禁原样） | **BUILD SUCCESSFUL** |

英文 locale 报错逐字命中上一 session 的两条结论（#644 票面交接文档勘误 #2：「P1 的根因写错了：真凶是跑到了非 full 变体的单测编译」）。

### 为什么是陷阱

1. **`./gradlew test` 是 Android 开发者肌肉记忆**：新人 onboarding 第一反应总是 `gradle test` 看测试；本仓库这个命令是恒红的。
2. **CI 给出绿灯假象**：CI 只跑 `testFullDebugUnitTest`，从不暴露其它变体错——开发者以为 CI 全绿 = 单测健康。
3. **结构上看不出问题**：build.gradle 看起来有完整的 flavor 拆分（`sourceSets` 块 + `xxxImplementation` 拆分），但测试源集**没有**对应拆分——这种「生产侧拆、测试侧没拆」的不对称是阅读时容易忽略的。

### 必须修（不动手不算完）

issue #655 票面已写明「本 ticket 只**定案**，不实现」——本 ADR 即「定案」。ticket 要求落四件事：(1) 修法选型；(2) 防回归的本地执行防线；(3) 文档落点；(4) CI 是否加非 full 变体编译检查。本 ADR 只决策前三件（D1 + D2 + D5 文档落点）；第 (4) 件在 D3/D4 中说明取舍。

---

## 决策

### D1. 选 C（per-flavor test source sets）

**成本矩阵**（2026-09-20 拍板）：

| 选项 | 一次性成本 | 长期维护 | 误诊率 | 防御深度 |
|------|----------|---------|--------|---------|
| **A** 文档纪律 + `ci-tests` alias | 极低（README + alias） | **高**（靠人记） | 仍可能踩 | 无（仅口头） |
| **B** `sourceSets` 排除 | 中（build.gradle 改 + 风险） | 中（每次加测试要维护） | 低 | 机械 |
| **C** per-flavor test sources | **高**（10 文件搬迁） | **低**（结构对，自然不会错） | 极低 | **结构性** |
| **D** A + 防御脚本 | 中-高（双轨） | 高（脚本 + 文档双轨） | 中 | 半结构 |

**选 C 的关键理由**：

1. **与现有生产源集结构镜像**：`src/full/java` / `src/lynx/java` / `src/webview/java` 已经按 flavor 分（`build.gradle:54-69`），测试侧用 `src/testFull/java` / `src/testLynx/java` / `src/testWebview/java` 是**同款镜像**——dev 不需要新心智模型。AGP 原生支持 flavor-specific test source set，无需插件。
2. **防御深度 = 结构性**：「生产 src 拆 + 测试 src 也拆」是不变量——任何一次新增 flavor（未来如 #116 后续调整）会自动走对称结构，不会再现「加了 flavor 忘了拆测试」的设计偏差。
3. **零 false negative / false positive**：C 下 `./gradlew test` / `build` / `check` 仍会变体编译（每个变体各自编译自己的测试源集），但**每个变体只编自己味儿的测试**——webview 编 webview 的、lynx 编 lynx 的、full 编 full 的（= 全集）。任何变体编译失败都是**真问题**，不再是「假红」。
4. **A/B/D 的核心缺陷**：A 靠纪律——issue #655 票面已证伪「上一 session 据此得出两条错误结论」（参见 #644 勘误）；B 需要在 build.gradle 写维护性 hack（`sourceSets.all*.java.srcDirs += filter`，每加测试要改）；D 是双轨（既改 build 又写脚本 + 又写文档）——三处维护点反而放大漂移面。
5. **与姊妹 ADR 一致**：ADR-0174 已先于本 ADR 落地（translate 终态契约测试），其新增的 7 个 `PictelioTranslateModule*Test` 全放在 `src/testFull/java`（参考 #646 §0 推荐机制的探针文件路径）——证明 C 是**当前仓库已经在用**的模式（不是新引入的）。

**A/B/D 的具体拒绝理由**见「Alternatives Considered」§。

### D2. 测试文件搬迁清单

按 `grep -l "^import (com\.lynx|com\.getcapacitor|io\.pictelio\.app\.[A-Z][A-Za-z]*Module|...PictelioTranslateModule|UgoiraStreamEngine|PictelioApp)" src/test/java/io/pictelio/app/*.java` 与「测试类名引用 lynx/webview 类」的逐文件核查（2026-09-20 已实测），共 **10 个文件**需搬迁：

#### D2.1 搬到 `src/testFull/java/io/pictelio/app/`（8 个，lynx-only 或 full-only）

| 文件 | 依赖项 | 行号（实测） | 备注 |
|------|--------|-------------|------|
| `PictelioClipboardModuleTest.java` | `import com.lynx.react.bridge.Callback` | `:13` | lynx NativeModule 测试 |
| `PictelioWebDavModuleTest.java` | `import com.lynx.react.bridge.Callback` | `:8` | lynx NativeModule 测试 |
| `PictelioImageServiceTest.java` | `import com.lynx.tasm.image.*`（5 个类型） | `:14-18` | Lynx image service |
| `TranslateEventContractTest.java` | `PictelioTranslateModule.EVENT_FRAME`（lynx 静态字段） | `:36` | 与 ADR-0170 同步 |
| `PictelioApiModuleTest.java` | `UgoiraStreamEngine` / `PictelioApiModule`（`src/lynx/java/`） | `:235, 329-415` | lynx NativeModule 流式测试 |
| `PictelioPrefsModuleTest.java` | `PictelioPrefsModule`（`src/lynx/java/`） | 实测命中 | lynx Prefs NativeModule |
| `LynxSystemBarsTest.java` | `LynxActivity.applyVisibleInsets` / `SYSTEMBARS_PREFS` / `KEY_FULLSCREEN_MODE`（`src/lynx/java/`） | `:40-83, 94, 101` | lynx Activity 测试 |
| `PictelioAppTest.java` | `@Config(application = PictelioApp.class)`（`src/full/java/`） | `:25` | full Application 测试 |

#### D2.2 搬到 `src/testWebview/java/io/pictelio/app/`（2 个，webview/Capacitor-only）

| 文件 | 依赖项 | 行号（实测） | 备注 |
|------|--------|-------------|------|
| `AuthPluginTest.java` | `import com.getcapacitor.JSObject` | `:8` | Capacitor Plugin 测试 |
| `PixivApiPluginTest.java` | `import com.getcapacitor.JSObject` | `:21` | Capacitor Plugin 测试 |

#### D2.3 留在 `src/test/java/io/pictelio/app/`（27 个，真共享）

非 flavor 依赖的测试文件（含纯算法 / Robolectric 通用 / Android stdlib 依赖），例如 `BackupCryptoTest.java` / `GallerySaverTest.java` / `ImageMemoryCacheTest.java` / `LruCacheTest.java` / `Mp4EncoderTest.java` / `NovelDocxEncoderTest.java` / `NovelEpubEncoderTest.java` / `NovelExportModelGoldenTest.java` / `GifEncoderTest.java` / `WebDavClientTest.java`（仅引用 `src/main/java/` 的 `WebDavClient`，非 `PictelioWebDavModule`）/ `WebpEncoderTest.java` / `UgoiraExporter*Test.java`（仅 `src/main/java/` 的 `UgoiraExporter`，非 `UgoiraStreamEngine`）/ `SecureStorageCompatTest.java` / `ShareHelperTest.java` / `NetDiagProbeTest.java`（`NetDiagProbe` 在 `src/main/java/`） 等。

**判定原则**（新测试自查口径，与 ADR-0174 D6 风格一致）：
- 引用 `com.lynx.*` / `com.getcapacitor.*` / `src/lynx/java/` / `src/full/java/` 类 → 不进 `src/test/java/`
- 引用 `src/webview/java/`（非 `src/main/java/`）类 → 不进 `src/test/java/`
- 只依赖 `android.*` / `androidx.*` / `org.json` / `okhttp3` / `org.robolectric` / `src/main/java/` 类 → 可留 `src/test/java/`

**搬迁验证方法**：搬迁后跑 `grep -rE "^import (com\.lynx|com\.getcapacitor)" src/test/java/io/pictelio/app/` 应**返回零行**——这是**自动化校验基线**（implement ticket 应把这条命令包成 pre-commit 或 CI 检查；本 ADR 不强制，本 ADR 仅定决策）。

### D3. `build.gradle` 改动（机械；AGP 原生支持）

新增 **per-flavor test source sets 块**（与现有生产源集镜像）：

```groovy
android {
    // ...（已有 defaultConfig / productFlavors 块保持不变）

    sourceSets {
        // === 既有：生产源集（:54-69） ===
        webview  { java.srcDir 'src/webview/java' }
        lynx     { java.srcDir 'src/lynx/java' }
        full     { java.srcDir 'src/webview/java'
                   java.srcDir 'src/lynx/java'
                   java.srcDir 'src/full/java' }

        // === 新增：测试源集镜像 ===
        // 关键事实：AGP 不会自动从 src/test/java 排除任何文件，
        // 只能 ADD 一个新源集。搬迁后的 src/test/java 是 27 个真共享文件，
        // 各 flavor 的"专有"测试走对应的 testXxx/java，AGP 编译时按 flavor
        // 选择 src/test/java + src/testXxx/java 并集。
        full {
            test.java.srcDirs += 'src/testFull/java'
        }
        webview {
            test.java.srcDirs += 'src/testWebview/java'
        }
        lynx {
            test.java.srcDirs += 'src/testLynx/java'
        }
    }
}
```

**为什么不需要 `exclude`**：AGP 的 `sourceSets.test.java.srcDirs` 是**追加**语义——`src/test/java` 是默认 base dir，per-flavor 追加的 `src/testFull/java` 等会与 base dir 合并形成该变体的测试源集。本仓库没有 `src/testLynx/java/` 内容（#646 §2.2 已实测空），未来 lynx 变体专属测试直接落到该目录即可。

**为什么不需要动 `testImplementation` dependencies**：`build.gradle:268-275` 的 `testImplementation "junit:junit:..."` / `robolectric` / `okhttp-tls` 是**所有 flavor 共用**（不区分 `fullTestImplementation` / `webviewTestImplementation`）——这正是 #646 §2.2 指出的「lynx + webview 依赖在 main 是 flavor 互斥，但 test 共用」现状。testImplementation 不分 flavor 没问题（testImplementation 永远进所有变体的 classpath），问题仅在**测试源集**引用的**生产类**是 flavor 互斥——D2 把源集拆开即解决。

### D4. 不强制新增 `./gradlew ci-tests` 别名（选 C 下非必需）

**理由**：

1. C 是结构性解——`./gradlew test` 跑每个 flavor 各自测试源集后**不再有 false red**（只有 real red）。`ci-tests` alias 解决的是「避免 dev 跑错命令」问题，C 下没跑错命令的问题。
2. 但若 implement 期发现 dev 仍习惯 `./gradlew test`（肌肉记忆），可作为**锦上添花**加一条 `tasks.register('ciTests') { dependsOn 'testFullDebugUnitTest' }`——本 ADR 不强制，**留给 implement ticket 自决**。
3. CI 侧 `ci.yml:103-105` 显式跑 `testFullDebugUnitTest`（**已是对的门**，无需 alias）——**alias 是 dev-only UX 改进**，与 ADR 决策无关。

### D5. 迁移序列与验证门

迁移分**四步**，每步有独立验证：

1. **建空目录**：`mkdir -p src/testFull/java/io/pictelio/app src/testWebview/java/io/pictelio/app`（保留 src/testLynx/java/ 暂空——ADR D3 已声明 lynx 变体当前无专属测试）。
2. **`git mv` 10 个文件**（保留 blame）：按 D2.1 / D2.2 表逐文件搬。可分两批 commit：(a) lynx-only → testFull；(b) webview-only → testWebview。
3. **验证门 1（必须绿）**：`./gradlew testFullDebugUnitTest --rerun` —— 全集（`src/test/java` 共享 + `src/testFull/java` 全味）必须全绿，与 #646 §1.1 的基线（48 suites / 375 tests / exit 0）**逐项一致**。
4. **验证门 2（必须零错）**：`./gradlew testWebviewDebugUnitTest testLynxDebugUnitTest --rerun` ——webview 编 `src/test/java + src/testWebview/java`、lynx 编 `src/test/java + src/testLynx/java`（空）—— 两者编译必须 exit 0（即使 0 个测试也 exit 0）。**这是 #646 §1.1 表格从「200 错 / 68 错」翻成「0 错 / 0 错」的唯一可证伪口径**。

**迁移期临时策略**（commit-by-commit 期间不应长时间出现恒红）：
- 建议先 commit 「建空目录 + D3 build.gradle 改动」（此步会让 `src/testFull/java` / `src/testWebview/java` 是空目录，编译无新增内容），再 commit 逐文件 `git mv`。
- 不需要「临时 disable flavor」之类的过渡——AGP 对空目录天然容忍。

**新增测试的归属守门**（落地期补，**本 ADR 仅定口径**）：
- pre-commit / CI 加 `grep -rE "^import (com\.lynx|com\.getcapacitor)" packages/app/android/app/src/test/java/io/pictelio/app/` 应**返回零行**——失败即红。
- 文字版的归属守门写进 `packages/app/tests/TESTING.md`（已存在，按 ADR-0174 / D6 风格补充一段「Android 测试源集选位规则」即可，**本 ADR 不直接改 TESTING.md**，留给 implement ticket）。

---

## 后果

### 正面

- **`./gradlew test|build|check` 从恒红变零错**——任何变体编译失败都是**真问题**（不再是「上一 session 的假红」），未来 CI 加 `compileWebviewDebugUnitTestJavaWithJavac` / `compileLynxDebugUnitTestJavaWithJavac` 检查都直接绿。
- **新测试的归宿有明确口径**（D2.3 判定原则）——新增 `PictelioXxxTest` 时一眼能看出该放哪。
- **与生产源集结构镜像**（`src/full/java` ↔ `src/testFull/java`、`src/lynx/java` ↔ `src/testLynx/java`、`src/webview/java` ↔ `src/testWebview/java`）——dev 心智模型零新增。
- **AGP 原生支持、无新依赖**——D3 改动 8 行 Groovy，不引入插件。
- **CI 零变更**——`ci.yml` 已是 `testFullDebugUnitTest`，本 ADR 决策与之天然契合。

### 负面 / 成本

- **一次性 10 文件搬迁 + 验证**——预计 ~30 分钟工作量（含 #646 §1.1 那种「9 个探针 + 变异实验」式的最终验证）。
- **新增测试需注意归属**——D2.3 三条原则需在 `packages/app/tests/TESTING.md` 写明（implement ticket 工作）。
- **D2 列表存在轻微漂移风险**：本 ADR 写于 2026-09-20，文件清单按当前 src tree 实测；若未来某测试文件被重构（D2.2 列出但内部 import 已变），搬迁前应再跑一次 `grep` 复核。
- **D4 alias 留为可选**：若 implement ticket 发现 dev 仍误用 `./gradlew test`，可加 `ci-tests` 别名（~3 行 Groovy），不影响本 ADR 结论。

---

## Alternatives Considered

### A) 文档纪律 + `./gradlew ci-tests` 别名

**拒**：
- 「文档纪律」已被 issue #655 票面证伪——上一 session 两人分别得错误结论并写进交接文档（#644 勘误第 2 条「真凶是跑到了非 full 变体的单测编译」），文档可读不等于可强制。
- `ci-tests` alias 是 dev-only UX 改进，CI 已是对的门（`ci.yml:103`）。alias 解决「少踩坑」不解决「结构缺陷」。
- 防御深度为零：未来新增 contributor 仍可能误用 `./gradlew test`，alias 不阻止。
- 长期维护负担高：文档可能漂移、alias 可能被改名、CI 可能在不知情下被扩展——三处必须同步维护。

### B) `sourceSets` 排除（非追加）

**拒**：
- AGP 的 `sourceSets.test.java.srcDirs` 是**追加语义**（见 D3 注释），要「排除」需用 `sourceSets.all*.java.exclude(...)` 或 `tasks.compileXxxUnitTestJavaWithJavac` 的 `exclude` hack——非原生支持。
- 维护性差：每加一个测试文件都要更新排除规则——若忘了更新排除规则，#655 这种恒红**会再次发生**。
- 与「生产侧拆、测试侧不拆」的不对称**没消除**——只是用 hack 掩饰，未来加 flavor 时仍会再踩。

### C) per-flavor test sources（本 ADR 已选）

见 D1-D5 决策主体。

### D) A + 防御脚本（auto-detect variant mismatch）

**拒**：
- 双轨（文档 + 脚本 + build 改动）维护点放大到 3 处。
- 防御脚本本身是 Gradle task（维护在 `build.gradle`），与 A 的 alias 重叠——是 A 的超集而非新选项。
- 防御脚本能「提示」，但**不能阻止编译**——仍是 false red 等价的软防线。

### E) 不修（维持现状）

**拒**：
- issue #655 票面已写「不是本功能的 bug，但它已经害过一次」（指 #644 误诊）。
- 文档面（票面 Q3：「这条事实该落在哪」）至少要做——即使选 A 也要写文档，纯「不修」连文档都不写等于放任下一 session 重付误诊成本。

---

## References

- **研究 #646 §2.2**（[app-lynx-translation-java-contract-test-mechanism.md](../../research/app-lynx-translation-java-contract-test-mechanism.md)：§1.1 变体编译矩阵表 / §2.2 机理复现段）——本 ADR 唯一事实来源，所有数字（200 / 68 / 48 suites / 375 tests）与逐字报错引自此文档
- **wayfinder map #644**（app-lynx 翻译收尾总图；票面交接文档第 2 条勘误：「P1 的根因写错了，真凶是跑到了非 full 变体的单测编译」→ #655 → 本 ADR）
- **issue #655**（决策 ticket，wayfinder:grilling；票面四问：(1) 修法 / (2) 防回归 / (3) 文档落点 / (4) CI 非 full 变体编译检查——本 ADR 答前三，第 (4) 在 D3/D4 取舍中说明）
- **`packages/app/android/app/build.gradle`**：`:33-52` productFlavors、`:54-69` 既有生产 sourceSets、`:240, 260-264` lynx 依赖、`:268-275` testImplementation
- **`.github/workflows/ci.yml`**：`:64-105` `android-unit-test` job，门禁即 `./gradlew testFullDebugUnitTest --no-daemon`
- **ADR-0170**（姊妹 ADR，跨端信封契约；TranslateEventContractTest.java:36 引 `PictelioTranslateModule.EVENT_FRAME` 是本 ADR D2.1 的搬迁目标之一）
- **ADR-0174**（Java translate 终态契约测试；先于本 ADR 落地，证明 C 是当前仓库已在用的模式——其探针文件路径 `src/testFull/java/io/pictelio/app/WfScratchTranslateProbeTest.java` 已验证 C 的可行性）
- **`packages/app/tests/TESTING.md`**（已存在；D5 「新增测试归属守门」需在此处补一段「Android 测试源集选位规则」——implement ticket 工作，不在本 ADR）