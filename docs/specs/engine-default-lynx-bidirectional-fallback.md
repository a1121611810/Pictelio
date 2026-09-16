# Spec: 引擎缺省翻转为 Lynx 与双向引擎降级

- 状态：specified（2026-09-16）
- 日期：2026-09-16
- 关联：ADR-0164（本方案决策）、ADR-0153 / ADR-0062 / ADR-0064 / ADR-0102 / ADR-0136 / ADR-0159 / ADR-0163、`docs/adr/glossary-client-switch.md`（词条：引擎决策模块 / 自动回退开关 / 失败记忆 / 生效状态快照 / 降级原因码 / 强制 WebView / 双失败 / 无障碍回退 / E2E 降级取证键）
- 来源：用户目标「app 安装好后默认是 lynx；不支持时自动切换 webview；再不行给提示」+ Grill 八问拍板 + 两轮深读侦察

## 1. 背景与目标

缺省引擎从 `"webview"` 翻转为 `"lynx"`（仅 full 包可感知）；「Lynx 不支持」在**预检**（环境级）与**运行时硬错误**（渲染级）两层定义，自动回退 WebView；两引擎均不可用时给双失败提示。反向降级（WebView 不可用 → Lynx，ADR-0153）保持不回归。新增用户开关（缺省开）控制运行时自动跳。

## 2. 非目标（Out of Scope）

- 不动 `webview` / `lynx` 单引擎 flavor 的路由语义（`MainActivityWebview` 除探测收编外零行为变化）。
- 不做 Lynx 运行时热切换；切换总是重启后生效（既有契约）。
- 不统一双向通知机制（lynx 侧一次性键 vs webview 侧快照+开关并存，记为债务）。
- 不提升 `MIN_WEBVIEW_VERSION`、不处理 ADR-0145 `toSorted` 债务。
- 不给 lynx 单引擎包错误页加按钮（既有行为，残余挂账）。
- 不做 iOS。

## 3. 键契约（全部位于 SharedPreferences 文件 `CapacitorStorage`；常量唯一所有者 = Java `EnginePrefs`，TS 侧镜像常量经一致性测试钉住）

| 键 | 值 | 缺省 | 写者 |
|---|---|---|---|
| `pictelio_client_kind` | `"webview" \| "lynx"` | **缺省即 lynx**（翻转） | 显式切换（双端）；E2E 播种；**降级绝不写** |
| `pictelio_engine_auto_fallback` | `"true" \| "false"` | `true` | 双端设置 UI |
| `pictelio_engine_lynx_failure_version` | versionCode 十进制字符串 | 无 | 仅 `onLynxFailure` 自动跳时；显式选择时清除 |
| `pictelio_engine_state` | `preferred=<kind> effective=<kind\|none> reason=<code>` | 无 | 每次 `EngineRouting.resolve` 覆写 |
| `pictelio_engine_fallback_optout` | `"true"` = 不再提示 | 无 | webview 提示条「不再提示」 |
| `pictelio_engine_fallback_notice` | 既有（ADR-0153） | — | **不动** |
| `pictelio_debug_force_lynx_unavailable` | `"true"` | 无 | 仅 E2E；**仅 DEBUG 构建被读取** |

Intent extras：`pictelio_engine_fallback`（既有 `EXTRA_ENGINE_FALLBACK`，改由 `fallbackEntry` 驱动）、`pictelio_engine_forced_webview`（新，回环断路器）、`pictelio_engine_stay_reason`（新，落地原因码）。

### 3.1 降级原因码（稳定 ASCII，持久层与 extra 只存码，UI 用 `Record<code, I18nKey>` 映射）

`preferred` / `lynx_unavailable` / `lynx_known_bad` / `lynx_retry` / `webview_unavailable` / `a11y_webview` / `a11y_lynx_last_resort` / `no_engine` / `forced_webview` / `runtime_failure`

## 4. 决策矩阵（`EngineRouting.decide` 纯函数，唯一实现地；P=首选 F=失败记忆命中∧开关开 L=Lynx 可用 W=WebView 合格 A=无障碍服务启用）

| # | 条件 | action | effective | reason | 备注 |
|---|---|---|---|---|---|
| S1 | P=lynx ∧ ¬F ∧ L ∧ ¬A | BOOT_LYNX | lynx | `preferred` | 99% 路径；只探 L |
| S1a | P=lynx ∧ ¬F ∧ L ∧ A ∧ W | BOOT_WEBVIEW | webview | `a11y_webview` | 无障碍回退 |
| S1b | P=lynx ∧ ¬F ∧ L ∧ A ∧ ¬W | BOOT_LYNX | lynx | `a11y_lynx_last_resort` | 无障碍降级优于不可用 |
| S2 | P=lynx ∧ ¬F ∧ ¬L ∧ W | BOOT_WEBVIEW | webview | `lynx_unavailable` | |
| S3 | P=lynx ∧ ¬F ∧ ¬L ∧ ¬W | UPGRADE_PAGE | none | `no_engine` | 双失败 |
| S4 | P=lynx ∧ F ∧ W | BOOT_WEBVIEW | webview | `lynx_known_bad` | 失败记忆 |
| S5 | P=lynx ∧ F ∧ ¬W ∧ L | BOOT_LYNX | lynx | `lynx_retry` | 唯一生路 |
| S5' | P=lynx ∧ F ∧ ¬W ∧ ¬L | UPGRADE_PAGE | none | `no_engine` | |
| S6 | Lynx 运行中硬错误 ∧ 开关开 ∧ 包含 webview | hop→MainActivity(forced) | webview | `runtime_failure`（stay extra） | 先写失败记忆再跳 |
| S7 | Lynx 运行中硬错误 ∧ 开关关 | ERROR_PAGE | — | — | 手动按钮照旧 |
| S8 | 10s 加载超时 | ERROR_PAGE | — | — | **永不自动跳** |
| S9 | P=webview ∧ W | BOOT_WEBVIEW | webview | `preferred` | 不探 L |
| S10 | P=webview ∧ ¬W ∧ L | BOOT_LYNX | lynx | `webview_unavailable` | ADR-0153 不回归 |
| S11 | P=webview ∧ ¬W ∧ ¬L | UPGRADE_PAGE | none | `no_engine` | |
| stay | forced extra=true | W ? BOOT_WEBVIEW : UPGRADE_PAGE | 同左 | extra 携带的 stay 原因码 | **永不 BOOT_LYNX**（结构防回环） |

派生规则：`fallbackEntry = (effective == lynx) ∧ ¬W`（在 decide 内一次求值，随路由返回）——驱动 `EXTRA_ENGINE_FALLBACK` 与错误页「仅退出、无返回按钮」。S1 且 W=false 时也为 true（吸收 ADR-0153 E7 单次弹跳为不弹跳）。

不变量（逐条 JVM 可测）：`decide` 全函数且纯；stay ⇒ action ≠ BOOT_LYNX；开关关 ⇒ F 惰性（落 S1）；失败记忆与当前 versionCode 精确相等才命中；probe 惰性求值（S1 只调 lynxAvailable+a11y，S9 只调 webviewOk；每探针每次 decide 至多 1 次）；所有探针全函数不抛（适配器负责 fail-open）。

## 5. 模块接口（`src/main/java/io/pictelio/app/engine/`；**禁止引用任何 flavor 类**——`clientKinds`/探针全部注入）

```java
public enum Engine { LYNX, WEBVIEW }            // kind(): "lynx"/"webview"；ofKind(raw) 未知→null
public interface EngineProbe {                  // 唯一外缝（适配器缝）
    String[] clientKinds();                     // BuildConfig.CLIENT_KINDS
    boolean lynxAvailable();                    // 可能触发 Lynx 初始化（幂等）
    boolean webviewOk();                        // framework 探测；-1 fail-open = true
    boolean a11yActive();                       // AccessibilityManager；失败→false
}
public record EngineState(Engine preferred, boolean knownBad, boolean autoFallback) {}
public record EngineRoute(Engine preferred, Engine effective /*null=无引擎*/,
                          Action action /*BOOT_LYNX|BOOT_WEBVIEW|UPGRADE_PAGE*/,
                          Reason reason, boolean fallbackEntry) {}
public final class EnginePrefs {                // 键唯一所有者 + 读写 + 快照发布
    // PREFS_FILE/KEY_* 常量；read(kinds)/publish(route)/setAutoFallback(b)
    // recordLynxFailure()/clearLynxFailure()/autoFallbackEnabled()
    // setPreferredExplicit(kind)：写首选 + 清失败记忆（S12）
    // debugForceLynxUnavailable()：BuildConfig.DEBUG 门控读取
}
public final class EngineRouting {
    public static EngineRoute resolve(Context app, EngineProbe p,
                                      boolean forcedWebview, String stayReason); // 读+decide+publish+Log.i
    public static EngineRoute decide(EngineState s, EngineProbe p,
                                     boolean forcedWebview, String stayReason); // 纯函数
    public enum FailureVerdict { HOP_TO_WEBVIEW, SHOW_ERROR_PAGE }
    public static FailureVerdict onLynxFailure(Context app, EngineProbe p,
                                               LynxFailureKind kind); // 见 §6
}
```

适配器：`WebViewAvailability`（src/main，framework API；收编 MainActivity / MainActivityWebview 逐字重复的两份探测，fail-open 口径不变）；`LynxProbe`（src/lynx；`lynxAvailable` = DEBUG 取证键优先 → `LynxRuntimeInitializer.isAvailable`；同时给 `isAvailable` 补上 `CLIENT_KINDS 含 lynx` 合取项——ADR-0153 决策 1 声明过但实现缺失）；`FullEngineProbe`（src/full，组合前两者 + `AccessibilityManager` a11y 探测）。

## 6. 运行时失败漏斗（`LynxActivity`，4 生产者收敛为 1 决策点）

生产者映射：init throw → `INIT`；`onLoadFailed` → `BUNDLE_LOAD`；`handleRenderError` 致命（9902/990200/InstantiationException/isFatal，判定留在 Activity）→ `RENDER_FATAL`；10s watchdog → `LOAD_TIMEOUT`。

`onLynxFailure(app, probe, kind)`：`LOAD_TIMEOUT` → SHOW_ERROR_PAGE；否则 若 `autoFallbackEnabled() ∧ clientKinds 含 webview` → `recordLynxFailure()`（**先写记忆再返回**，hop 途中崩溃也不丢）→ HOP_TO_WEBVIEW；否则 SHOW_ERROR_PAGE。

HOP 执行（Activity 侧）：反射定位 `MainActivity`（lynx-only 包无此类，沿用既有探测）→ Intent + `EXTRA_FORCED_WEBVIEW=true` + `EXTRA_STAY_REASON="runtime_failure"` + `CLEAR_TASK|NEW_TASK` → finish。错误页按钮逻辑不变（fallbackEntry → 仅退出；否则 full 包显示「返回 WebView」）。**「返回 WebView」按钮改为 `setPreferredExplicit(webview)`（写首选 + 清记忆）后反射跳 MainActivity——翻转后删键 = 回 lynx = 死循环，此为 P0 修复。**

## 7. 调用点接线（file-by-file）

### 7.1 Java

| 文件 | 改动 |
|---|---|
| `src/full/.../PictelioApp.java` | `onCreate` 改用 `resolve(...)`：BOOT_LYNX→`initLynx()`；BOOT_WEBVIEW→`warmUpWebView()`；UPGRADE_PAGE→不预热（消灭「预热与路由错位」） |
| `src/full/.../MainActivity.java` | 路由块改 `resolve(getApplication(), FullEngineProbe, forced, stayReason)`：BOOT_LYNX→保留 super-first + `isTaskRoot` 守卫 + benchNav `putExtras` + `EXTRA_ENGINE_FALLBACK=fallbackEntry`；UPGRADE_PAGE→`showWebViewUpgradeError(reason)` 带 query；否则落原 WebView 启动（删除已死的 `!webviewOk` 分支，`getWebViewMajorVersion/isWebViewVersionOk` 移交 `WebViewAvailability`） |
| `src/webview/.../MainActivityWebview.java` | 仅探测收编为 `WebViewAvailability`（行为逐字不变，含 fail-open） |
| `src/lynx/.../LynxActivity.java` | §6 漏斗 + `switchBackToWebview` 改写 |
| `src/lynx/.../PictelioAppModule.java` | `getClientKind` 读缺省 `"webview"`→`null`（absent → `CLIENT_KINDS[0]` 归一化，配合翻转）；`CLIENT_KEY/CLIENT_PREFS` 别名 `EnginePrefs` 常量；`setClientKind` 成功后 `clearLynxFailure`（S12） |
| `src/webview/.../ClientInfoPlugin.java` | `restart` 前 `clearLynxFailure`（S12） |
| `src/lynx/.../LynxRuntimeInitializer.java` | `isAvailable` 补 `CLIENT_KINDS 含 lynx` 合取（ADR-0153 决策 1 收口） |
| `app/build.gradle` | full flavor `CLIENT_KINDS` 翻序 `{"lynx", "webview"}`（Java 侧默认值单一事实来源） |
| `src/main/res/raw/upgrade.html` | 读 `location.search` 的 `reason=no_engine` → 切换为双失败文案（页面其余不动，仍零外部资源 ES5） |

### 7.2 webview TypeScript（packages/app）

| 文件 | 改动 |
|---|---|
| `src/utils/clientSwitch.ts` | `DEFAULT_CLIENT` 值翻转为 `"lynx"`（注释说明缺省语义翻转）；`switchClient` 成功路径无改动（S12 清记忆在 Java 侧 `ClientInfoPlugin.restart`）；新增 `readAutoFallbackSwitch()/writeAutoFallbackSwitch(b)`（`@capacitor/preferences` 直读写，缺省 true）与 `readEngineState()`（解析快照为 `{preferred, effective, reason} | null`，畸形值 warn + null，禁止静默） |
| `src/components/settings/SettingsClient.tsx` | 「客户端」卡新增「自动回退 WebView」开关行（`fluent-switch` + `fluentOn`，照 `SettingsContent.tsx` 范式）+「本次生效」双态行（读快照，降级时显示原因文案） |
| `src/routes/ClientSwitch.tsx` | 说明页展示「首选 X · 本次生效 Y · 原因」（读快照） |
| `src/components/EngineFallbackBanner.tsx`（新） | **手写**提示条（非 `fluent-message-bar`——fluent 是 shadow DOM，E2E 点不到其内部按钮；本条需两个可点动作）。挂 `__root.tsx`（exitHint pill 旁）。显示条件：快照 `effective=webview ∧ preferred=lynx ∧ reason≠preferred ∧ 未 optout`。「知道了」仅关闭本次；「不再提示」写 optout 键 |
| `src/i18n/locales/{zh-CN,en}/…` | 新键：banner 文案（按原因码映射）、`知道了`/`不再提示`、设置行文案、说明页双态文案。zh-CN 与 en 成对新增（`satisfies` 编译期完备） |

### 7.3 lynx TypeScript（packages/app-lynx）

| 文件 | 改动 |
|---|---|
| `src/stores/settingsStore.ts` | 新增设备级布尔 `autoFallbackEngine`（键 `pictelio_engine_auto_fallback` 与 app 逐字一致；照 `relatedInjection` 全套范式：ref + load + setter + `applyRawKey` case + `BACKUP_DEVICE_KEYS`） |
| `src/pages/Me.vue` | 客户端卡新增开关行（M3 switch，照 R18 行逐字范式 + `ME_A11Y_LABELS`/`A11Y_ELEMENT_ENABLED` 注册）+「本次生效」文本行 |
| `src/App.vue` | 既有降级提示条硬编码中文 → i18n（`engineFallback.*` 键），行为不变 |
| `src/i18n/locales/{zh-CN,en}/pages.ts` | 新键成对新增 |

### 7.4 E2E 基建（packages/app/tests/android-e2e）

| 文件 | 改动 |
|---|---|
| `setup.ts` | `pm clear`（及真机 rm -rf 分支）后**播种** `pictelio_client_kind=webview`——把「全新安装=webview」的隐式前提显式化，保住约 10 个既有 spec 的基线 |
| `prefs.ts` | 新增 `readEngineState(serial)`（regex 提取快照行 → 结构化；配合既有 `pollPrefs`） |
| `specs/client-kind-contract.spec.ts` | 新增用例：自有 `pm clear`（无键）→ 启动 → 断言 `LynxActivity`（翻转契约）；既有四用例语义不变 |
| `specs/engine-fallback-matrix.spec.ts`（新） | 降级取证格（见 §8） |
| `specs/webview-only-upgrade.spec.ts` | 升级页断言从弱 oracle（`includes("WebView")`）收紧为精确文案 |

## 8. E2E 取证格（`engine-fallback-matrix.spec.ts`，均用 DEBUG 取证键，release 无此分支）

| 格 | AVD | 播种 | 期望 |
|---|---|---|---|
| M1 预检降级 | pictelio_ui（WebView 113） | `pictelio_debug_force_lynx_unavailable=true`，无首选键 | top=`MainActivity`；快照 `preferred=lynx effective=webview reason=lynx_unavailable` |
| M2 双失败 | pictelio_low（WebView 66） | 同上 | top=`MainActivity` 升级页；页面含双失败文案、不含 Lynx 渲染内容 |
| M3 失败记忆→S4 | pictelio_ui | 失败记忆=当前 versionCode（`dumpsys package` 提取），无首选键 | top=`MainActivity`；快照 reason=`lynx_known_bad`；**后续两次冷启均不落 LynxActivity**（防回环） |
| M4 显式选择→S12 | pictelio_ui | M3 后 `writeClientKind(lynx)` | top=`LynxActivity`（记忆被清，重试恢复） |

## 9. 测试决策

- **好测试的标准**：只测接口可见行为。矩阵测试全部从 `EngineRouting.decide/resolve/onLynxFailure` 外缝穿过，断言 `action/effective/reason/fallbackEntry`；不测内部分支结构。
- **矩阵单测**（纯 JUnit，无 Robolectric，先例 `LynxRuntimeInitializerTest`）：S1–S11 + stay + 派生规则逐格；不变量测试（stay 永不 BOOT_LYNX 的四角遍历、F 惰性、S12 清记忆、probe 调用计数锁惰性——防未来重构把探针提升到函数顶部）。
- **EnginePrefs 单测**（Robolectric `@Config(sdk=28)`，先例 `PictelioAppTest`）：absent→lynx 归一化、畸形值容错、versionCode 精确匹配与升级遗忘、optout、快照格式。
- **韧性集成一例**：`PictelioAppTest` 扩展 shadow 用例——两探针全失败时 `onCreate` 不抛且发布 S3 快照（纯测试无法陈述的唯一集成事实）。
- **一致性测试**（先例 `engineFallbackNoticeConsistency.test.ts` 三重模式）：Java `EnginePrefs` 键字面量 ↔ TS 镜像常量；`build.gradle` full `CLIENT_KINDS[0]` ↔ TS `DEFAULT_CLIENT`；`Reason.code()` 枚举 ↔ TS `Record<code,I18nKey>` 的键集相等。
- **Oracle 溯源**：矩阵期望值来源 = 本 spec §4 表（逐格标注 S 编号）；键字面量来源 = ADR-0164 决策文本；WebView fail-open 来源 = `docs/platform-compatibility.md` 既有口径。
- **CI 门禁内**：全部 JVM 测试经 `testFullDebugUnitTest`（CI 唯一 Java 任务）+ vitest 单测。android-e2e 不入门禁（ADR-0163 口径），转换矩阵格为发版前手动门。

## 10. 边界与错误路径

| # | 场景 | 期望 |
|---|---|---|
| E1 | 存量用户显式 `pictelio_client_kind=webview` | S9 照旧，零感知 |
| E2 | 存量用户显式 lynx，本机 lynx 坏（新） | 预检 S2 → WebView + 快照 + 提示条（旧行为是白屏/错误页） |
| E3 | 失败记忆命中 ∧ WebView 升级后仍 <85 | S5 重试 lynx |
| E4 | 应用升级后 | 失败记忆版本失配 → 自动遗忘 → 重试 lynx |
| E5 | 自动回退开关关 + lynx 硬错误 | S7 错误页 + 手动按钮（用户自担） |
| E6 | 10s 超时 | S8 永不自动跳 |
| E7 | S6 跳转落地后 WebView 也 <85 | stay 分支 → 升级页（`forced_webview`），不回弹 |
| E8 | webview 单引擎包 + WebView <85 | 升级页（现状不变） |
| E9 | lynx 单引擎包 | 无 WebView 逻辑；`onLynxFailure` 因 `CLIENT_KINDS` 不含 webview 恒 SHOW_ERROR_PAGE |
| E10 | TalkBack 启用 + 两引擎可用 | S1a WebView 生效 |
| E11 | 快照键畸形/缺失 | UI 侧 warn + 按无降级渲染（禁止静默） |
| E12 | 磁盘写失败（`apply()` 静默） | 单次提示缺失/单次白屏重演，下次启动自愈——可接受，不阻断启动 |
| E13 | 桥线程竞争下开关写入 | 落盘异步，测试断言轮询（ADR-0159 口径） |

## 11. 文档

新 ADR-0164（已写）；`glossary-client-switch.md`（已更新）；`packages/app/CONTEXT.md`（已更新）；本 spec；`docs/platform-compatibility.md` 行为表与实现细节段更新（并修正其指向 `MainActivity` 内常量的陈旧描述）；`docs/android-e2e-gate.md` 触发文件清单增补；`openwiki/` 不动（CI 重生成）。

## 12. 实施顺序（5 票，依赖有序）

T1 模块骨架+矩阵单测（无行为变化）→ T2 翻转默认值 + 死循环修复 + S12 清记忆 + E2E 播种（**原子票**：翻转、循环修复、播种必须同票落地，否则循环 bug 与整套 E2E 同时红）→ T3 运行时漏斗 + 双端开关/双态 UI（三子代理并行：Java / webview UI / lynx UI）→ T4 提示条 + 双失败页 + i18n → T5 E2E 取证格 + 文档收口。发布验收追加：release APK dex 断言不含 `pictelio_debug_force_lynx_unavailable`。
