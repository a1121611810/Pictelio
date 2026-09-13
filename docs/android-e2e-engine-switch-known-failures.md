# Android E2E 已知失败清单：双引擎切换线（与排行榜需求无关）

> **用途**：本文档是一份**移交记录**。这些失败与排行榜需求（spec #512 / 工单 #513–#519）**没有调用关系**，因此不在排行榜分支修复，**另开分支处理**。
> **状态**：仅记录，未修复。
> **记录时间**：2026-09-13
> **被测分支/版本**：`feat/solidjs-2-migration`，HEAD `0e6bba07`
> **设备**：`pictelio_ui`（emulator-5556，android-34，WebView 113.0.5672.136）、`pictelio_low`（emulator-5554，android-28，WebView 66）

---

## 1. 结论摘要

- 全量 `android-e2e` 结果：**10 failed / 21 passed / 5 skipped（36 条）**，按文件为 **6 failed / 6 passed / 3 skipped（15 个）**。
- **10 条失败全部落在「双引擎客户端切换」这一条产品功能线上**（WebView 网页渲染版 ↔ Lynx 原生渲染版互切），另有一条被连带「跳过」。
- 结构上是 **1 个共同前置阻断 + 3 条独立问题**：
  1. **共同阻断**：从首页导航到**设置页**失败 → “走 UI 切换引擎”的用例全部红，这是 #1–#8 共同的失败起点。
  2. **独立问题 A**：低端机（`pictelio_low`）**自动降级**到 Lynx 失效。
  3. **独立问题 B**：跨引擎**设置迁移播种**（R-18 分档键）未按预期写入（两轮结果不一致，见 §7）。
  4. **连带跳过**：Lynx 首页"点击恢复 / FAB 回归"用例因 **Lynx 侧登录超时**没跑起来。
- **重要**：**Lynx 引擎本身是好的**——`lynx-boot-renders` 通过、`client-kind-contract` 4/4 通过。坏的是**"从 WebView 主动切到 Lynx"这个动作**（UI 点击 → 落盘 → 重启生效），不是"发动机"。

---

## 2. 这块功能是什么（产品视角）

Pictelio 有两套「渲染引擎」，用户可切换、App 也会自动降级：

| 引擎 | 特点 |
|---|---|
| **WebView 版** | 像内嵌浏览器，兼容性最好 |
| **Lynx 版** | 原生渲染，低端机更流畅、启动更快 |

产品承诺 4 件事：

1. 用户能在**设置页**里点「切换渲染引擎」并确认；
2. App **记住选择**（写入 `pictelio_client_kind`），**重启后生效**；
3. 切换过程中**登录状态不丢**（refresh_token 保留）；
4. **低端机**（WebView 版本 < 85）**自动降级**到 Lynx（ADR-0153）。

用户路径：`首页 → 设置 → 切换渲染引擎 → 说明页 → 确认切换 → 重启 → 进入对应引擎`

---

## 3. 失败清单（逐条：功能 / 用例 / 报错原文）

### 分组 1 · 手动切换引擎（4 条）

| # | spec 文件 | 用例名 | 对应的功能 | 失败时具体提示（原文） | 用户可见影响 |
|---|---|---|---|---|---|
| 1 | `switch-client-oneway.spec.ts` | S2 单向链路：WebView → LynxActivity › **导航到设置页并点击「切换渲染引擎」** | 设置页入口可达 | `Error: 未进入设置页（当前 URL: https://localhost/home）` | **点不进设置页**，切换入口直接进不去 |
| 2 | `switch-client-oneway.spec.ts` | S2 单向链路：WebView → LynxActivity › **应用退出后 SharedPreferences 已写 lynx** | 切换选择落盘 | `AssertionError: pictelio_client_kind 应为 lynx（轮询 15s 内写入）: expected null to be 'lynx'` | 就算点了，App **没记住**"我选的是 Lynx"（键根本是 null） |
| 3 | `switch-client-oneway.spec.ts` | S2 单向链路：WebView → LynxActivity › **重启 App 后进入 LynxActivity** | 重启后生效 | `Error: 重启后未进入 LynxActivity` | 重启后还是老引擎，**选择等于白点** |
| 4 | `switch-client-roundtrip.spec.ts` | S2 双向闭环：WebView → Lynx → 切回 WebView › **WebView 登录并切换到 Lynx（真实 UI 点击，复用 #106）** | 切换选择落盘（UI 路径） | `AssertionError: pictelio_client_kind 应为 lynx: expected null to be 'lynx'` | 同 #2：切换选择没落盘 |

**断言位置**

- #1：`switch-client-oneway.spec.ts:157-159`（`timeoutMsg: 未进入设置页（当前 URL: ...）`）
- #2：`switch-client-oneway.spec.ts:210`（`expect(clientKind, "pictelio_client_kind 应为 lynx（轮询 15s 内写入）")`）
- #3：`switch-client-oneway.spec.ts:225`（`timeoutMsg: "重启后未进入 LynxActivity"`）
- #4：`switch-client-roundtrip.spec.ts:186`（`expect(prefs.clientKind, "pictelio_client_kind 应为 lynx")`）

### 分组 2 · 切换后 Lynx 页面能起来 + 登录态不丢（4 条）

| # | spec 文件 | 用例名 | 对应的功能 | 失败时具体提示（原文） | 用户可见影响 |
|---|---|---|---|---|---|
| 5 | `switch-client-roundtrip-3x.spec.ts` | T4 #131 引擎切换往返 3 次回归门 › **第 1 次往返：WebView 说明页确认切换 → LynxActivity 渲染 + token 不丢** | 连续切换稳定性 | `Error: 未进入设置页` | 切换流程前置步骤就断，**"登录态不丢"根本没机会验证** |
| 6 | `switch-client-roundtrip-3x.spec.ts` | T4 #131 引擎切换往返 3 次回归门 › **第 2 次往返：…（同上）** | 连续切换稳定性 | `Error: 未进入设置页` | 同上 |
| 7 | `switch-client-roundtrip-3x.spec.ts` | T4 #131 引擎切换往返 3 次回归门 › **第 3 次往返：…（同上）** | 连续切换稳定性 | `Error: 未进入设置页` | 同上 |
| 8 | `switch-client-roundtrip.spec.ts` | S2 双向闭环：WebView → Lynx → 切回 WebView › **LynxActivity 可达 + Lynx 渲染成功（logcat 断言，无致命错误）** | 切换后 Lynx 页面可渲染 | `Error: 未进入 LynxActivity` | 切过去后 **Lynx 页面起不来**（白屏/停在原页面） |

**断言位置**

- #5–#7：`switch-client-roundtrip-3x.spec.ts:246`（`timeoutMsg: "未进入设置页"`）与 `:295`（`timeoutMsg: 第 ${round} 次未进入 LynxActivity`）；`:269` 为 E2E 钩子断言、`:279` 为 pref 断言
- #8：`switch-client-roundtrip.spec.ts:197`（`timeoutMsg: "未进入 LynxActivity"`）

### 分组 3 · 低端机自动降级（1 条）

| # | spec 文件 | 用例名 | 对应的功能 | 失败时具体提示（原文） | 用户可见影响 |
|---|---|---|---|---|---|
| 9 | `switch-client-roundtrip-low.spec.ts` | S2 降级：Lynx 可达 + 切回自动降级进 Lynx（`pictelio_low`） › **切回 WebView（契约层）→ 自动降级进 LynxActivity（ADR-0153）** | 低端机自动降级 | `Error: 未自动降级到 LynxActivity（ADR-0153）` | **低端机用户可能一直卡在 WebView**（自动降级本就是为了救他们） |

**断言位置**：`switch-client-roundtrip-low.spec.ts:111`（`timeoutMsg: "未自动降级到 LynxActivity（ADR-0153）"`）

### 分组 4 · 跨引擎设置迁移播种（1 条）

| # | spec 文件 | 用例名 | 对应的功能 | 失败时具体提示（原文） | 用户可见影响 |
|---|---|---|---|---|---|
| 10 | `settings-sync-contract.spec.ts` | T5 跨 client 设置同步契约（ADR-0103） › **预置老键（模拟升级前设备）→ webview 登录 → 迁移播种 + 真实契约键断言** | 老版本升级后的设置迁移 | `AssertionError: expected '<?xml version='1.0' encoding='utf-…' to match /<string name="show_r18_\d+">fa…/string`（即期望 `<string name="show_r18_<uid>">false</string>`） | **老版本升级上来的用户，R-18 分档设置可能不按预期迁移** |

**断言位置**：`settings-sync-contract.spec.ts:207`（`expect(prefs.rawXml).toMatch(/<string name="show_r18_\d+">false<\/string>/u)`）

> ⚠️ **注意**：这条在**非 e2e 构建模式**那一轮是**通过**的（见 §7）。两轮结果不一致，**更像用例自身时序/顺序敏感**，不一定是真 bug。

### 连带跳过（不计入 10 条失败）

| spec 文件 | 情况 | 报错原文 | 对应功能 |
|---|---|---|---|
| `fab-hit-testing-regression.spec.ts` | **Failed Suite**，2 条用例被跳过 | `Error: 登录超时（未出现 refresh_token 持久化标记）`（`fab-hit-testing-regression.spec.ts:159`） | Lynx 首页「页面点击恢复 / FAB 全屏容器吞触摸」回归（ADR-0123）——因为 **Lynx 侧登录**没成功，用例没跑到 |

> 说明：该 spec 的 `beforeAll` 里用 Lynx 引擎登录（找 `PictelioSecureStorage.setItem.refresh_token` 日志标记），60s 超时。

---

## 4. 因果链（为什么一次红这么多条）

```
共同前置阻断
  /home → /settings 导航失败（#1；#5/#6/#7 同）
        ↓
  切换 UI 到不了 → pictelio_client_kind 没写（#2；#4）
        ↓
  重启后进不了 LynxActivity（#3；#8 的渲染断言同源）

独立问题 A
  低端机自动降级失效（#9）—— 契约层直接写 pref 也进不了 LynxActivity

独立问题 B
  设置迁移播种未按预期（#10）
```

**注**：`/home → /settings` 的失败信息是 `未进入设置页（当前 URL: https://localhost/home）`，即 URL 停在首页——是**页面跳转没发生**，不是"设置页渲染错"。

---

## 5. 已确认正常的部分（避免重复排查）

同一轮里**通过**的用例，说明以下能力是好的：

| 用例 | 结果 | 说明 |
|---|---|---|
| `lynx-boot-renders` › boot lynx → LynxActivity 前台 + logcat 有渲染初始化 + 无 TDZ / loadCard failed | ✅ | **Lynx 引擎能启动、能渲染**（不是 Lynx 包坏了） |
| `client-kind-contract`（4 条） | ✅ 4/4 | **引擎选择的契约层（读写 `pictelio_client_kind` + 重启分发）是好的** |
| `switch-client-roundtrip-3x` › 基线：WebView 真实登录 + refresh_token 已持久化 | ✅ | WebView 登录与 token 持久化正常 |
| `switch-client-roundtrip-3x` › 第 1/2/3 次**契约层切回 WebView** → /home 登录态恢复 + token 不丢 | ✅ 3/3 | **"切回 WebView + 登录态恢复"方向是好的** |
| `switch-client-oneway` › 通过年龄确认并登录 | ✅ | WebView 登录正常 |
| `switch-client-roundtrip-low` › 写入 lynx 后重启进入 LynxActivity（WebView 版本不影响 Lynx 方向） | ✅ | **Lynx 方向的分发是好的** |
| `background-resume` / `network-check` / `smoke` / `lynx-network-check` | ✅ | 与切换线无关 |

**推论**：单独"写入 lynx + 重启"能进 LynxActivity（契约层 ✅），但"走 UI 切换"进不去（#1–#8）。问题在 **UI 路径（设置页可达性 + 确认切换的落盘）**，以及**低端机自动降级**这一独立分支。

---

## 6. 既有问题证据（对照实验）

为确认"不是排行榜改动引入"，用**不含排行榜代码的旧版本 APK**（`/tmp/prerank`，对应 `94a5f7e5`，构建于排行榜首个提交 `31de4de0` 之前）跑同一批用例做对照。

| 用例 | 旧版本 APK（无排行榜代码） | 当前 HEAD（`0e6bba07`） |
|---|---|---|
| `switch-client-oneway` › 通过年龄确认并登录 | ✅ 通过 | ✅ 通过 |
| `switch-client-oneway` › 导航到设置页并点击「切换渲染引擎」 | ❌ `未进入设置页（当前 URL: https://localhost/home）` | ❌ 同一提示 |
| `switch-client-oneway` › 应用退出后 SharedPreferences 已写 lynx | ❌ `pictelio_client_kind 应为 lynx（轮询 15s 内写入）: expected null to be 'lynx'` | ❌ 同一提示 |
| `switch-client-oneway` › 重启 App 后进入 LynxActivity | ❌ `重启后未进入 LynxActivity` | ❌ 同一提示 |
| `lynx-network-check` › NetDiag 探测 | ❌ `expected ... to contain 'NetDiagModule'` | ❌ 同一提示（非 e2e 构建模式下） |
| `fab-hit-testing-regression` | ⏭️ 2 skipped（`登录超时`） | ⏭️ 同一原因 |

**结论：失败项目与报错逐条一致，属既有问题，与排行榜改动无关。**

---

## 7. 两轮结果差异：构建模式（重要）

同一份代码，`ANDROID_E2E_BUILD_MODE` 不同，结果集合不同：

| 用例 | 普通构建（`pnpm test:android:e2e`） | e2e 构建（`ANDROID_E2E_BUILD_MODE=e2e pnpm test:android:e2e`） |
|---|---|---|
| `lynx-network-check` › NetDiag 探测 | ❌ 失败（缺 `NetDiagModule` 日志） | ✅ **通过** |
| `switch-client-roundtrip` › WebView 登录并切换到 Lynx | ❌ `E2E 钩子应存在（--mode e2e 构建）: expected 'E2E-HOOK-MISSING' to be 'E2E-HOOK-CALLED'` | ❌ 变成 `pictelio_client_kind 应为 lynx: expected null to be 'lynx'`（钩子已存在，走到落盘断言） |
| `settings-sync-contract` › 迁移播种 | ✅ **通过** | ❌ `show_r18_\d+\">fa…` 不匹配 |

**由此确认**：

1. `switch-client-*` 系列中若用例调用 `window.pictelioE2e.confirmSwitchClient()`（断言见 `switch-client-roundtrip.spec.ts:182`、`switch-client-roundtrip-3x.spec.ts:269`、`switch-client-oneway.spec.ts:195`），**必须用 e2e 构建模式**，否则会先因缺钩子而红（`README.md` 当前只写了 `pnpm test:android:e2e`，**建议补充说明**）。
2. `settings-sync-contract` 的两轮差异说明它**对时序/顺序敏感**，建议后续单独复现确认是否真 bug。

---

## 8. 复现方法

```bash
# 前置：两个 AVD 都在线（pictelio_ui=5556 / pictelio_low=5554）
adb devices

# 方式 A（完整：会构建 APK）—— 需要 E2E 钩子的用例必须用这个
cd /Users/lilianda/develop/pixivizer
ANDROID_E2E_BUILD_MODE=e2e pnpm test:android:e2e

# 方式 B（复用已有 APK，快速迭代）
ANDROID_E2E_SKIP_BUILD=1 pnpm test:android:e2e

# 只跑某一条
cd packages/app
ANDROID_E2E_SKIP_BUILD=1 pnpm exec vitest run -c tests/android-e2e/vitest.config.ts \
  specs/switch-client-oneway.spec.ts
```

**运行环境要点**

- `PIXIV_REFRESH_TOKEN` 来自 `packages/app/.env`（由 `tests/android-e2e/globalSetup.ts` 注入 `process.env`）。缺失时相关 spec 会被 `skipIf` 跳过。
- AVD 选择：`ensureEmulator(process.env.ANDROID_E2E_AVD)`；不传时按 `KNOWN_AVDS = ["pictelio_ui", "pictelio_low"]` 取第一个存在的，**实际默认是 `pictelio_ui`**。
- `switch-client-roundtrip-low` / `webview-only-upgrade` 需要 `ANDROID_E2E_AVD=pictelio_low`；`webview-only-upgrade` 还需要 `ANDROID_E2E_FLAVOR=webview`。
- **已在线模拟器不是目标 AVD 时 `ensureEmulator` 会直接抛错**（不抢用别的设备），所以配对跑 low 用例前要先确认 5554 在线。

**当前工作区已做的测试基建调整（另开分支时请注意区分）**

| 文件 | 调整 | 原因 |
|---|---|---|
| `tests/android-e2e/specs/fab-hit-testing-regression.spec.ts:170` | 默认 AVD 固定为 `pictelio_low`（`process.env.ANDROID_E2E_AVD \|\| "pictelio_low"`） | 该 spec 坐标硬绑 720×1280/density 320；自动选到 `pictelio_ui`(1080×2160) 时几何断言必失败 |
| `tests/android-e2e/driver.ts:194-210` | `switchToWebView` 改为「无条件回 NATIVE → 切 WEBVIEW → `getUrl` 探针」重试 3 次；回 NATIVE 失败改为 `console.warn`；chromedriver 版本类确定性失败立即抛出 | 修复 app 重启后旧 chromedriver 会话 `disconnected: not connected to DevTools` |
| `tests/android-e2e/avd.ts:33-34` | 修正注释：默认 AVD 实际是 `pictelio_ui`（原注释误写 `pictelio_low`） | 注释与 `KNOWN_AVDS` 顺序不符 |
| `test-results/android-e2e/*` | 失败证据（`activity.txt` / `screenshot.png` / `logcat-tail.txt`），如 `01-lynx-launch-failed/` | 自动生成 |

---

## 9. 建议排查顺序

| 优先级 | 问题 | 切入点 |
|---|---|---|
| **P1** | **首页 → 设置页导航失败**（阻断 #1，进而阻断 #2–#8） | `switch-client-oneway.spec.ts:130-160` 的顺序导航（`/home → h1.click → /me → 设置行.click → /settings`）；对照 WebView 侧路由守卫（`routes/__root.tsx` 登录态守卫）与 `SideNavShell` 的 h1/设置入口可点性 |
| **P1** | **切换选择未落盘**（#2/#4） | `/client-switch` 说明页 →「确认切换」的实际落盘路径（写 `pictelio_client_kind`）；契约层写入是好的（`client-kind-contract` ✅），所以问题在 UI 触发到落盘之间 |
| **P1** | **低端机自动降级失效**（#9） | ADR-0153 降级判定的触发条件（WebView 主版本 < 85）；注意 `switch-client-roundtrip-low` 的"写入 lynx → 重启进 LynxActivity"是**通过**的，说明分发 OK，问题在**自动**降级那条判定 |
| **P2** | **Lynx 侧登录超时**（导致 `fab-hit-testing` 整文件跳过） | `fab-hit-testing-regression.spec.ts:159` 的日志标记 `PictelioSecureStorage.setItem.refresh_token`；确认 Lynx 登录链路（uiautomator 定位输入框 → `input text` → 点登录）在 android-28 上是否仍成立 |
| **P2** | **设置迁移播种**（#10，两轮不一致） | `settings-sync-contract.spec.ts:207`；先单独重复跑 3 次确认是否 flaky，再看迁移播种逻辑本身 |
| **P3** | `README.md` 未说明 `ANDROID_E2E_BUILD_MODE=e2e` | 补充文档，避免他人复现时被"缺 E2E 钩子"误导 |

---

## 10. 原始证据位置（本机）

| 内容 | 路径 |
|---|---|
| e2e 构建模式全量日志（本文档 §3 报错原文来源） | `/tmp/e2e-final-e2emode.log` |
| 普通构建全量日志（§7 对照来源） | `/tmp/e2e-snapshot.log` |
| 旧版本 APK（无排行榜代码）对照日志 | `/tmp/e2e-prerank-baseline.log` |
| 旧版本 APK 路径 | `/tmp/prerank/packages/app/android/app/build/outputs/apk/full/debug/app-full-debug.apk` |
| 失败证据（截图/logcat/activity） | `packages/app/test-results/android-e2e/` |

**本轮已确认通过的基线（供回归对照）**

| 套件 | 结果 |
|---|---|
| `pnpm test:all` | ✅ app 186 文件 / 1749 用例、lynx 92 文件 / 1221 用例 全绿 |
| `pnpm check:all` | ✅ 格式 + lint + tsc 全绿 |
| 排行榜端到端（模拟器，临时验收 spec） | ✅ 登录 → 首页横滑条「今日排行 Top 20」（20 条）→ `/ranking` 7 个维度 chip |

**r18 断言补充说明**：#10 的期望值是 `<string name="show_r18_<uid>">false</string>`（账号级键，uid 从真实 `CapacitorStorage.xml` 提取，见同文件 `:50-52`）。
