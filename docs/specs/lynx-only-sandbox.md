# Lynx 单引擎沙盒规范（去 Capacitor 化）

> **本文件是 #609 声称已落盘但实际丢失的 spec 的重建版**（2026-09-28）。
> 丢失根因：原 spec 只作为 **worktree `pixivizer-lynx-only` 的未跟踪文件**存在，**从未 commit**，worktree 删除后不可恢复（核查证据见 #606 的评论）。
> 本次重建**逐条标注来源**：`[票]` = 来自仍存的 GitHub 票；`[码]` = 本次对代码实测核对；`[重建]` = 依据前两者推导，**需领域确认**。
> 地图：[#606](https://github.com/a1121611810/Pictelio/issues/606) · 前置决策：[#607](https://github.com/a1121611810/Pictelio/issues/607) / [#608](https://github.com/a1121611810/Pictelio/issues/608) / [#609](https://github.com/a1121611810/Pictelio/issues/609) · 执行票：[#610](https://github.com/a1121611810/Pictelio/issues/610) → #611 → #612
> 基线：2026-09-28 @ `53005dd6`

---

## 1. 沙盒目标

**只求纯 Lynx 版端到端跑通。** `[票 #608]`

不是「生产迁移的缩小版」，而是**一次性验证「删掉 WebView 线之后，Lynx 单引擎能否独立成立」**。沙盒成功 ⇒ 才有资格在 [#612](https://github.com/a1121611810/Pictelio/issues/612) 讨论是否进入生产迁移。

## 2. 五项决策（沙盒宪章）`[票 #608]`

| # | 决策 | 内容 |
|---|---|---|
| ① | **数据兼容** | **不动存储格式**——零迁移工程。靠「Lynx 本就读写原格式」自然达成 |
| ② | **节奏** | **一次性大改**。沙盒无中间发布需求 |
| ③ | **发版** | **不考虑**。flavor 合并 / release 脚本均不在范围 |
| ④ | **SPA** | **删除**（连同其单测与 E2E）。功能验证改人工走查；测试基建替代 = 生产迁移期的 fog |
| ⑤ | **更新能力** | **全删**。OTA 随 SPA 消失，**app-lynx 侧 `update-check` 消费点一并删除**。将来是否重建待生产迁移期决策 |

> ⚠️ **生产口径的原推荐未被否决，只是延期**（`[票 #608]`）：三阶段推进 / flavor 合并单 APK / SPA 保留为测试载体 / 更新管道解耦重建 —— 见 §8 延期清单。

## 3. 终态形态

**WebView 线完全下线**，客户端收敛为 Lynx 单引擎。`[票 #607]`

删除：webview flavor、引擎切换 UI、降级矩阵、Capacitor 依赖。

**替代容器评估已结案**（`[票 #607]`，结论为「不做」）：Tauri+Lynx 是范畴错误（Tauri 前端即系统 WebView）；GeckoView / X5 / UC U4 均为「替代 WebView」而非「替代 Lynx」的方案；Rust 形态 B 无净收益。

⚠️ **代价（已确认并接受）**：无障碍兜底随 WebView 下线一并退役。

## 4. 切割清单

### 4.1 整块删

| 目标 | 实测规模 | 来源 |
|---|---|---|
| `android/app/src/webview/` 源集（Java + AndroidManifest） | **20 个 Java 类** `[码]` | #610 原文写「17 个 Java 类」—— **已陈旧**，实测 20 |
| `android/app/src/full/` 源集 | **3 个 Java 类**（`MainActivity` / `PictelioApp` / `FullEngineProbe`） `[码]` | 同上 |
| ⇒ **待删合计** | **23 个 Java 类** `[码]` | |
| `android/app/src/main/java/io/pictelio/app/engine/` | **7 个类**（`Engine` / `EnginePrefs` / `EngineProbe` / `EngineRoute` / `EngineRouting` / `EngineState` / `WebViewAvailability`） `[码]` | #610「引擎机制全链删除」 |
| `android/app/src/main/java/io/pictelio/app/EngineFallbackNotice.java` | 1 个 `[码]` | #610「降级矩阵/失败记忆」 |
| `android/capacitor.settings.gradle` | 1 个（生成文件，头部自陈 `DO NOT EDIT`） `[码]` | #610 |
| ④ SPA 及其测试 | `packages/app` 单测 **225 个文件** + android-e2e **20 个 spec** `[码]` | ⚠️ #608 写「60+ 单测与 12 个 E2E」—— **已陈旧** |
| ⑤ `packages/update-check/` + app-lynx 消费点 | `@pictelio/update-check`（单文件 `index.ts`）+ `app-lynx/src/stores/updateStore.ts`(+test) + `api/queryKeys.ts` `[码]` | #608 ⑤ |

### 4.2 手术五项（#610 的执行项）

1. **Gradle**：`app/build.gradle` 删 `flavorDimensions "client"` 与全部 `productFlavors`；删 `webviewImplementation` / `fullImplementation` 对 `capacitor-android` / `capacitor-cordova-android-plugins` 的依赖（实测位于 `app/build.gradle:227-230` 与 `:256-258`）。`[码]`
2. **Manifest 入口写死**：`manifestPlaceholders` 改固定为 `launcherActivity: ".LynxActivity"` / `appClass: ".PictelioAppLynx"`（即现有 `lynx` flavor 的取值）。`[码]`
3. **`buildConfigField "String[]", "CLIENT_KINDS"`** 从 `{"lynx","webview"}` / `{"webview"}` 收敛为 `{"lynx"}`，并删除消费方。⚠️ 注意 ADR-0164 曾定「`CLIENT_KINDS[0]` 是 Java 侧缺省引擎的单一事实来源」——**单引擎后该机制失去意义**，须一并清理，**但 ADR-0164 本身不重开**。`[重建]`
4. **根 `package.json` 的 `build:android`**：改为 `lynx bundle 构建 → sync-android-assets → gradle assembleDebug`；**删除** web build 与 `cap:sync` 步骤。`[票 #610]`
5. **`capacitor.config.json` / `capacitor.plugins.json`** 的处理（现有构建已从 assets 排除它们，见 `app/build.gradle:174-175`）。`[码]`

### 4.3 保留不动（手术红线）`[票 #609]`

| 红线 | 说明 |
|---|---|
| **`SharedPreferences` 文件名 `"CapacitorStorage"` 必须保留** | Lynx 模块的 `image_host_settings` 等键在其中。**它只是一个 XML 文件名**，与 Capacitor 框架无关——删文件名 = 丢用户配置。`PictelioPrefsModule.PREFS_FILE`（`:36`）不动 |
| **包名 `io.pictelio.app`** | 不动 |
| **签名** | 不动 |
| **`minSdkVersion = 28`** | 不动 |
| **共享 Java 深模块全部保留** | `PixivApiCore` / `PixivImageLoader` / `SecureStorageCompat` / `BackupCrypto` / `WebDavClient` / `NovelExporter` 系 / 各 `LynxModule`（`app/src/lynx/`，**20 个类**）`[码]` |

## 5. 已知破损表（接受不修复）

> ⚠️ **本节是原 spec 丢失最多的部分。** 以下为**依据 §4 切割项推导**的 `[重建]` 清单，**未经领域确认**——执行前请逐条判「是否真的可接受」。

| 破损 | 原因 | 是否可接受 |
|---|---|---|
| `packages/app` 全部 225 个单测删除后，**JS 侧无任何测试防线** | 决策 ④ | 沙盒可接受（只求跑通）；**生产迁移前必须重建**（生产口径把 SPA 保留为测试载体） |
| android-e2e 20 个 spec 删除后，**无模拟器自动化** | 决策 ④ | 沙盒可接受（功能验证改人工走查 = #611 的职责） |
| 失去「无障碍兜底」路径 | 决策终态，#607 已确认接受 | 已接受 |
| OTA / 应用内更新能力消失 | 决策 ⑤ | 沙盒可接受（手动装 APK） |
| `CLIENT_KINDS` 机制清除后，**将来若要恢复多引擎需重新设计** | 手术第 3 项 | ⚠️ **与「WebView 暂时下线后重写」的口径相关**——重写回归时该机制可能需要回来 |
| Lynx 侧无法读到系统级 `prefers-reduced-motion` | Lynx 平台事实（ADR / #792 实证） | 已接受（另见视觉验证图 #786 的 L4 决策） |

## 6. 验收条件

> #610 引用了「spec §6 之 2、3 条」——**#2、#3 为原文可考**，#1/#4/#5 为 `[重建]`。

| # | 条件 | 来源 |
|---|---|---|
| 1 | `pnpm build:android` 一次跑通，产出可安装 APK | `[重建]` |
| 2 | **构建零 Capacitor 依赖残留**——产物中无 `capacitor-android` / `capacitor-cordova-android-plugins` / `BridgeActivity` 痕迹 | `[票 #610]` |
| 3 | **APK 安装后启动直达 Lynx 界面**，logcat 无 `BridgeActivity` / capacitor 痕迹 | `[票 #610]` |
| 4 | **`SharedPreferences("CapacitorStorage")` 中既有设置与 token 升级后仍在**（红线验证） | `[重建]`（源自 #609 红线） |
| 5 | app-lynx 侧 `update-check` 消费点已清理且无悬空 import | `[重建]`（源自决策 ⑤） |

## 7. 风险

> ⚠️ **原 spec 的「风险」节已丢失。** 以下为 `[重建]`。

| 风险 | 缓解 |
|---|---|
| **一次性大改不可增量回滚**（决策 ②） | 沙盒在独立 worktree / 分支进行，**产物必须提交进版本控制**（本次丢失即反面教材） |
| 删错共享深模块导致 Lynx 侧连带失效 | §4.3 红线清单逐条对照；#611 走查七项核心功能即为此设 |
| `capacitor.settings.gradle` 是**生成文件**（`DO NOT EDIT`） | 沙盒内 `cap:sync` 已删（手术第 4 项），不会再被重新生成；生产迁移时若恢复须重新评估 |
| 「WebView 永久下线」的措辞被误当终局 | ⚠️ **口径纪律**：本项目是**暂时下线后重写**。本 spec 的切割是**沙盒验证**，不是生产终局决策；生产迁移结论由 #612 独立作出 |

## 8. 延期清单（沙盒不做，留给生产迁移期）`[票 #608]`

- 三阶段推进节奏与版本策略
- flavor 合并为单 APK
- SPA 保留为测试载体（测试基建替代方案）
- 更新管道解耦重建
- 文档 / CI 收尾、合流策略

## 9. 执行须知

1. **本 spec 必须提交进版本控制**（`docs/specs/lynx-only-sandbox.md`），**不得**只落在 worktree 未跟踪文件里——这正是本次丢失的原因。
2. 载体：`worktree pixivizer-lynx-only` + 分支 `feat/lynx-only`。⚠️ **该分支当前是空壳**（相对 main 领先 0 提交 / 落后 314），需从当前 main 重新切出。
3. #610 执行时**逐条对照 §4.1 的实测计数**（23 个待删 Java 类、7 个 engine 类、225 单测 / 20 E2E），**不要沿用票面旧数字**（17 / 60+ / 12 均已陈旧）。
4. 红线违反（尤其 `CapacitorStorage` 文件名）视为**阻塞**，须停下来重新决策，不得「顺手改掉」。
