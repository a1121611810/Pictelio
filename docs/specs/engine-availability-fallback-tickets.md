# Tickets: 引擎可用性与降级（spec: docs/specs/engine-availability-fallback.md）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | ADR-0153 + 平台/门禁文档同步 | — | `docs/adr/ADR-0153-engine-availability-fallback.md`、`packages/app/CONTEXT.md` 词条、`docs/platform-compatibility.md`、`docs/android-e2e-gate.md` | ADR/CONTEXT 已落地；平台兼容表「不满足时的行为」与门禁 AVD 描述不再写「切回停升级页」 | done |
| T1 | LynxRuntimeInitializer 幂等修复 + isAvailable 探针 + 通知键常量 + Java 单测 | — | `src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java`（InitGate + isAvailable）、`src/main/java/io/pictelio/app/EngineFallbackNotice.java`、`src/testFull/java/io/pictelio/app/LynxRuntimeInitializerTest.java` | InitGate 成功置位/失败可重试；`isAvailable = hasInited ∧ isNativeLibraryLoaded`；`testFullDebugUnitTest` 绿 | done |
| T2 | MainActivity 降级分支 + LynxActivity 降级标记/兜底页/通知写 | T1 | `src/full/java/io/pictelio/app/MainActivity.java`、`src/lynx/java/io/pictelio/app/LynxActivity.java` | `compileFullDebugJavaWithJavac` 通过；pictelio_low（WebView 66）冷启直达 LynxActivity；降级入口兜底页仅「退出应用」；通知键在渲染前写入 | done（编译通过；模拟器行为断言并入 T4） |
| T3 | app-lynx 降级通知消费 UI + 契约测试 | T1 | `packages/app-lynx/src/utils/engineFallbackNotice.ts`、`src/stores/engineFallbackStore.ts`、`src/App.vue` 提示条、`src/utils/engineFallbackNotice.test.ts`、`packages/app/tests/unit/utils/engineFallbackNoticeConsistency.test.ts` | 首帧读到即展示可关闭提示并清键；无键无 UI；Java↔TS 键契约测试绿；原生不可用 warn 不静默 | done（app-lynx 单测 6/6、契约 4/4、tsc 绿） |
| T4 | Android E2E 翻转 + webview flavor 回归 + 文档收口 | T2, T3 | `tests/android-e2e/specs/switch-client-roundtrip-low.spec.ts`（翻转）、`specs/webview-only-upgrade.spec.ts`（新增）、`env.ts`/`prefs.ts`/`driver.ts`（`ANDROID_E2E_FLAVOR` + 入口降级等待）、`chromedriver.ts`（Intel 回退 zip 名修正）、`packages/app/package.json`（`build:android:e2e` 补 app-lynx bundle 构建+同步——修复 E2E 装到陈旧 Lynx bundle） | **pictelio_low full 2/2 + pictelio_low webview 1/1 + pictelio_ui smoke/契约 6/6 全绿**（2026-09-11 实跑） | done |
| T5 | 真机批次验收（低 WebView 设备） | T4 | 验收记录（截图 + logcat + 命令行） | 真机低 WebView 直达 Lynx；提示条可见可关；WebView 升级后回 webview。**模拟器手工三场景已截图验证（2026-09-11：pictelio_ui 正常路径 / pictelio_low full 降级+提示条 / pictelio_low webview-only 升级页）；本条仅剩真机硬件批次** | todo（需真机） |

## 关键路径

`T1 → T2 → T4 → T5`（原生主链）
`T1 → T3`（app-lynx 通知，可与 T2 并行）
`T0` 与主链并行，T4 收口文档。

## 备注

- **T1 是前置**：`InitGate` 未修则「探测失败 → 进程内不可重试」，E6/E8 的判定语义依赖它。
- **不引入 static 会话标记**：防环由「Lynx 不可用 → 升级页」+「降级入口兜底页仅退出」两点承担（ADR-0153 决策 5）。
- T2 的降级分支必须镜像 lynx 分支的 `super.onCreate` 硬约束；`webview` 包编译期引用不到 Lynx 类，改动只能落在 full sourceSet。
- 每 ticket 完成后走 `code-review` → `tdd` 修复闭环（AGENTS.md 工作流硬约束）。
