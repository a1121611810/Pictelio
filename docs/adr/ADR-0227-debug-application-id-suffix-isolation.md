# ADR-0227：debug 变体 applicationIdSuffix 隔离——#802 红线口径裁定与落地

- **状态**：**已接受（Accepted，2026-10-23）｜已实施**（本轮落地；§6 记录落地后的外部复核与整改）
- **日期**：2026-10-23
- **相关**：[#1037（本票来源）](https://github.com/a1121611810/Pictelio/issues/1037)、[#802（发版形态：flavor 合并为单 APK，红线出处）](https://github.com/a1121611810/Pictelio/issues/802)、[ADR-0203（WebView 客户端删除）](./ADR-0203-webview-client-source-removal.md)、[#1035（dev 播种键读侧闸门）](https://github.com/a1121611810/Pictelio/issues/1035)、[#1034（release `BuildConfig.DEBUG` 机器防线）](https://github.com/a1121611810/Pictelio/issues/1034)
- **落地坐标**：`packages/android-host/android/app/build.gradle`（`buildTypes.debug.applicationIdSuffix`）· E2E 咽喉点 `packages/android-host/tests/android-e2e/env.ts` · CI `.github/workflows/sysbars-acceptance.yml`

---

## 1. 背景

### 1.1 待裁定的那条红线

[#802](https://github.com/a1121611810/Pictelio/issues/802)（已关闭，2026-09-28）的**红线段**原文：

> 包名 `io.pictelio.app`、keystore 路径、`minSdkVersion = 28` 不动。

同票的**要做的**段写明该决策的由来是「flavor 合并为单 APK 与 release 脚本收口」——即**消除构建期分叉**（flavor 维度下线、三分包合并为单 APK），避免多变体带来的产物与脚本复杂度。

⇒ 红线与意图是**两件事**：红线保护**已发布产物的身份**，意图消除**构建期维度分叉**。

### 1.2 要解决的问题

debug 与 release 共用同一个 `applicationId` ⇒ 共用一份 SharedPreferences、同一套文件目录、同一批 Keystore 条目。dev 播种的一切——受限内容闸门键（R18）、LLM 端点 `base_url`/`model`、**refresh_token**——都会随「先装 debug 再覆盖装 release」这条**已发布文档写明的正常发版路径**残留进 release 安装。

已装的两道缓解**都不是存储层**：

- [#1035](https://github.com/a1121611810/Pictelio/issues/1035)：**读侧**闸门——release 读不到 dev 播种键（能自愈已被污染的设备）。
- [#1034](https://github.com/a1121611810/Pictelio/issues/1034)：release 变体 `BuildConfig.DEBUG` 的机器防线（证「不会真导出」，不证「读不到」）。

⇒ 存储层仍裸奔：同一闸门保护下写的键不止受限内容键，还有 refresh_token（进 Keystore）与 LLM 端点键。

### 1.3 一条被证伪的前提（原票面自带更正）

#1037 的初版 brief 把「OAuth 回调与分享链接走资源文件里写死的 deep-link scheme」列为需拍板的决策项。**该前提已被票面更正作废**，复核结论：

- `custom_url_scheme` 是**死资源**（全仓引用只在其自身声明处）；
- manifest **没有注册任何应用自有 scheme**（唯一 `intent-filter` 是 `MAIN`/`LAUNCHER`）；
- dev 工具链**不走 OAuth**（dev 登录走 intent extra `pictelio_dev_refresh_token`）。

⇒ 「两个可共存应用注册同一个 scheme」的风险**不存在**；无 scheme 可改，也无需在方案间取舍。

---

## 2. 决策

### D1：红线口径裁定——**红线约束已发布产物的身份，不禁止 dev 变体加后缀**

`debug` 加 `applicationIdSuffix` **不违反** #802 红线，理由逐条对齐红线三项：

| 红线项 | 本决策下的取值 | 是否动 |
| --- | --- | --- |
| 包名 `io.pictelio.app` | **release 仍是 `io.pictelio.app`**（已发布用户零影响，`adb install -r` 升级路径不变） | 不动 |
| keystore 路径 | `app/pictelio-release.keystore` | 不动 |
| `minSdkVersion = 28` | 28 | 不动 |

被改的只有 **debug 变体的有效 applicationId**（`io.pictelio.app.debug`）——它**不是已发布产物的身份**，且不引入新的构建维度（产物仍是一个 debug + 一个 release，#802 的意图不变）。

> 口径留痕：这是对一条**已关闭决策红线**的**解释**（而非推翻）。若日后判定「红线也约束 dev 变体」，则本决策整体回退——回退成本 = 去掉 `applicationIdSuffix` 一行 + 把 D4 的包名坐标改回。

### D2：只给 debug 加后缀

`buildTypes { debug { applicationIdSuffix ".debug" } }`。release 侧**零改动**（不写 `applicationIdSuffix`、不改 `applicationId`）。

### D3：`namespace` 与 Java 包名不动

`namespace` 仍是 `io.pictelio.app` ⇒ ~130 个 Java 源文件的包声明、`io.pictelio.app.LynxActivity` 等类 FQN、`io.pictelio.app.config` 生成类**全部不受影响**。变的只是「安装后的应用 id」。

### D4：dev 工具链的包名坐标必须 variant 感知，且**无残留字面量**

以下坐标一律改为从**单一咽喉点**派生，禁止各自写死；**路径一律用仓库根相对路径**（坐标基准 = 仓库根）：

| 坐标 | 现状 |
| --- | --- |
| E2E 编排咽喉点 | `packages/android-host/tests/android-e2e/env.ts` 的 `APP_PACKAGE` |
| 绕过咽喉点写死字面量的 spec | `packages/android-host/tests/android-e2e/specs/webdav-backup-lynx.spec.ts`（Activity FQN）、`packages/android-host/tests/android-e2e/specs/md3-visual-tokens.spec.ts`（`run-as` 包名） |
| 宿主包单测夹具 | `packages/android-host/tests/android-e2e/unit/*.test.ts`（`env.flavor` / `prefs.devLogin` / `ui-tree.io`） |
| CI 专用工作流 | `.github/workflows/sysbars-acceptance.yml`（`PKG=io.pictelio.app.debug`，`workflow_dispatch` 手动位） |
| dev 脚本（宿主侧） | `packages/android-host/scripts/dev-android.mjs`、`packages/android-host/scripts/lib/ui-tree-dump-core.mjs`、`packages/android-host/tests/android-e2e/tools/*.sh` |
| dev 脚本（客户端侧） | `packages/app-lynx/scripts/capture-md3-matrix.sh`、`packages/app-lynx/scripts/lynx-device-check.sh`、`packages/app-lynx/scripts/lynx-flow-check.sh`、`packages/app-lynx/scripts/lynx-router-back-regression.sh`、`packages/app-lynx/scripts/verify-statusbar-contrast.mjs`、`scripts/capture-readme-shots.sh` |
| **已知残留 → 已删除（2026-10-23）** | `scripts/audit-real-interaction/{switch_baseline,search_filter_smoke,run_regression,cdp_login}.mjs` 原写死 `io.pictelio.app` + `.MainActivityWebview` / `.MainActivity`——这 4 个脚本指向的 Activity **已随 ADR-0203 整包删除**（`git ls-files \| grep -i MainActivity` = 空），是 webview 时代的**死脚本**；后按用户指令「webview 残留不用留」**整目录删除**（254 文件 / 104MB），随之清理 `vite.config.ts` 的 lint/fmt 排除规则与 ADR-0185 排除表 |
| 文档坐标 | `docs/release-checklist.md` 等处写死的包名 |

**「无残留字面量」是验收项，不是风格偏好**：E2E 那一处若只改咽喉点而漏掉两个自写字面量的 spec，改动会**静默漏检**（装不上包 / 抓不到 UI 树），而不是报错。

⚠️ **本决策最大的隐性破坏面：相对类名在 applicationId ≠ namespace 时解析到不存在的类。**
`am start -n` 的组件串里，`.Class` 形式的相对类名按 **applicationId 的包**展开（`ComponentName.unflattenFromString` 前接 package）⇒
`io.pictelio.app.debug/.LynxActivity` 会解析成**不存在的** `io.pictelio.app.debug.LynxActivity` ⇒ 组件解析失败、Activity 起不来（且报错信息指向类名，不像包名问题，极易误判）。
⇒ 组件串一律写成**全限定类名**：`io.pictelio.app.debug/io.pictelio.app.LynxActivity`（applicationId + 类 FQN 组合）。
本仓已实测确认该坑会在 E2E 与 dev 脚本里同时发作（组件串 + dumpsys 归一化两处），见 §5 证据。

### D5：不做「包名字面量统一外部化」

把散落各处的包名抽成环境变量是**独立清理项**，与本决策正交。本决策只要求「**改对**」，不要求「改干净」。

### D6：与 #1035 互补，不是替代

- #1035 治**读侧**：已被污染的设备**能自愈**（键还在磁盘上，但读不出来）。
- 本决策治**存储层**：防未来，**治不了存量**（躺在 release 数据目录里的残留键，后缀加完仍在那个目录里）。

⇒ 两道防线都留。

---

## 3. 不做什么

- 不改 release 的 `applicationId` / keystore 路径 / `minSdkVersion`。
- 不改 `namespace` 与 Java 包声明。
- 不删 #1035 / #1034 的防线。
- 不做包名字面量的统一外部化（D5）。
- 不引入新的 flavor 维度。

---

## 4. 后果与遗留

**正面**

- dev 播种的一切（受限内容键、LLM 端点键、**refresh_token**）随 debug 数据目录走；release 安装的数据目录只剩 release 自己写下的内容。
- 已发布用户零影响：release 侧 applicationId 不变，升级路径与 Keystore 绑定不变。

**代价（一次性）**

- dev 侧全部包名坐标要改（D4 的六类）。
- 本机已装的旧 debug 包（`io.pictelio.app`，debug 签名）需**卸载**才能装新 debug 包（`io.pictelio.app.debug`）——两者 applicationId 不同，**可以共存**，但旧包的数据留在旧 id 下。
- release 包与 debug 包**签名不同**（release keystore vs debug keystore）⇒ 同机上 `io.pictelio.app` 若被 debug 签名包占用，release 覆盖安装会签名不匹配（既有事实，见 #802 票面记录）。

**遗留**

- **存量污染不治**：已被污染设备上的 release 数据目录残留键仍在（#1035 读侧闸门继续兜底）。
- 本决策**只裁定口径**，未回答「是否未来要给 release 也留隔离」——需要时另开 ADR。

---

## 5. 证据

| 事实 | 坐标 / 实测 |
| --- | --- |
| 红线原文 | #802 票面「红线」段（包名 / keystore 路径 / minSdkVersion 三项） |
| 红线意图 | #802 票面「要做的」段：flavor 合并为单 APK、消除构建期分叉 |
| `namespace` 与 applicationId 分离 | `app/build.gradle`：`namespace` 声明与 `applicationId` 无耦合；Java 包声明 130+ 文件不动 |
| FileProvider 随 applicationId 自动跟随 | `main/AndroidManifest.xml:50` `android:authorities="${applicationId}.fileprovider"`；`ShareHelper.java:74` 用 `context.getPackageName() + ".fileprovider"` ⇒ 两处都自动指向新 id |
| 无其它运行时包名依赖 | 全量检索 `APPLICATION_ID` / `getPackageName()` / `packageName`（宿主 src）仅命中上述两处 |
| dev 播种键写入应用私有目录 | dev hook 写 `PictelioPrefs` / Keystore（宿主私有数据目录）⇒ 随 applicationId 隔离 |
| release 构建链可用 | `packages/android-host/android/app/pictelio-release.keystore` 存在 + `PICTELIO_KEYSTORE_PASSWORD` / `PICTELIO_KEY_PASSWORD` 已注入 ⇒ `assembleRelease` 可本地构建（release 验签见 `docs/release-signing.md`） |
| **运行时验证（存储层隔离）** | 模拟器 `emulator-5556` 实测：两包共存（`pm list packages` 同时列出 `io.pictelio.app` 与 `io.pictelio.app.debug`）；dev 播种键 `dev_force_r18` **只在 debug 侧**；refresh_token 的 Keystore 落点 `WSSecureStorageSharedPreferences.xml` **只在 debug 侧**、release 侧不存在 ⇒ release 读不到任何一个；用户可见：debug 已登录出作品流、release 停在登录页。帧与逐步实测见 [`docs/research/debug-release-isolation-2026-10.md`](../research/debug-release-isolation-2026-10.md)（帧在 `docs/research/assets/debug-release-isolation/`）。⚠️ 口径：release 侧**首次启动后**会自建 `shared_prefs`（键 `usage_metrics_v1`，App 自身产物）⇒ 判据是「读不到 dev 播种键与凭据落点」，不是「目录不存在」 |

---

## 6. 落地后的复核记录（2026-10-23，双轴 review）

D4 的「无残留字面量」是**验收项**，落地后必须独立复核。首轮实施**未满足**该验收项：

| 复核发现 | 现象 | 处置 |
| --- | --- | --- |
| Standards 轴独立复核（外部复核，非自测） | `packages/app-lynx/scripts/capture-md3-matrix.sh` 只改了注释（说 `PKG` 是 debug id）**没改取值**（仍是 release id `io.pictelio.app`）⇒ 注释与代码互相矛盾；且 `pidof io.pictelio.app` 在 debug 安装上恒空 ⇒ `relaunch` 走到「✗ 进程不存在」中止，矩阵采集**静默不出图**（D4 预警的「静默漏检」家族） | 取值改为 `io.pictelio.app.debug`；`tests/captureScriptInvariants.test.ts`（已冻结）在**既有**「组件名只有一个来源」断言块内补 1 条 `PKG` 取值断言（同一事实的另一半，非新增检测面），并做变异验证（改回 release id 即转红）；同族另外 6 个 shell 脚本的 `PKG` 取值**无门禁** ⇒ 已登记为该门禁的「已知失效面」 |
| Standards 轴独立复核 | D4 的坐标表**漏列**客户端侧 5 个 dev 脚本（`packages/app-lynx/scripts/*.sh` 4 个 + `scripts/capture-readme-shots.sh`）——它们确实在本决策中被改了 | D4 坐标表补齐两行（宿主侧 / 客户端侧分列） |
| Standards 轴独立复核 | `docs/agents/qa-transition-checklist.md` 的 benchNav 深链写成**相对类名** `…/.MainActivity`（ADR-0227 D4 明令禁止的形态），且目标 Activity 随单引擎化已删除（benchNav 现由 `LynxActivity` 消费） | 4 处改为全限定类名组件串 `io.pictelio.app.debug/io.pictelio.app.LynxActivity`，并订正抬头那句「深链指向已不存在的 Activity」 |

⇒ 教训：**D4 这类「无残留字面量」验收项不能靠「我改过哪些文件」的自觉清单**——
坐标表本身也会漏，必须由**独立于实施方**的复核按「设备命令里出现的每一个包名」逐条对。
