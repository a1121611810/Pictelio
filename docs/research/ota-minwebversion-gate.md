# minWebVersion 强制门槛：数据源选型、检查时机与触发 UX

> 评估日期：2026-08-29。回答 issue #243（Map: #240）。前置结论：`docs/research/mpa-remote-githubpages-feasibility.md` §D（本地 webDir + OTA bundle 正路，远程壳否决）、`docs/research/ota-switching-mechanism.md`（#241：capgo 手动模式 + hostFiles 原子切换 + notifyAppReady 回滚）、`docs/research/ota-ed25519-android.md`（#242：bcprov 验签）。
> 第一手来源实抓：本仓代码实读（`packages/update-check/src/index.ts`、`packages/app/src/routes/__root.tsx`、`packages/app/src/stores/settingsStore.ts`、`packages/app/src/components/StartupUpdateDialog.tsx`、`packages/app-lynx/src/stores/updateStore.ts`、`packages/app/scripts/release.mjs`、`.github/workflows/deploy.yml`、`packages/website/src/pages/index.astro` / `layouts/BaseLayout.astro`）；ADR-0089；本站 raw.githubusercontent / GitHub Pages 响应头 curl 实测；docs.github.com 限流页、Expo Updates 官方文档、`microsoft/react-native-code-push` 文档（gh API 实抓）。

---

## 0. 结论摘要（对 issue 三问逐条 verdict）

| 问题 | Verdict | 一句话 |
|---|---|---|
| Q1 数据源选型 | 🟢 **扩展现有 `packages/website/version.json`**（新增平级字段） | 该文件已是双端更新检查的单一事实源（ADR-0089），生产链路（`release.mjs`）与消费链路（`@pictelio/update-check`）全部现成；单 commit 原子翻转 `version + minWebVersion (+ webBundle)`，无撕裂读；加字段对旧客户端零破坏（旧解析只读已知字段，未知字段忽略） |
| Q2 检查时机 | 🟢 **冷启一次检查三重消费 + 回前台节流复查** | 保持现有 500ms 延迟冷启检查时点不变，单次 fetch 同时服务 APK 弹窗 / 门槛评估 / OTA 元数据三套比较；回前台（`appStateChange`）节流 ≥4h 补一次；门槛数据本地缓存一份，离线时用上次已知 floor 判定（fail-open） |
| Q3 门槛触发 UX | 🟢 **先 OTA 自愈、失败才阻断**（选项 c 为主，b 作过渡，a 兜底） | bundle 可自愈（#240 已定静默 OTA + 自动回滚）⇒ 绝大多数门槛命中无需用户操作；OTA 下载/验签/回滚失败且仍低于 floor ⇒ 阻断页（复用 app-lynx `/update` 强制页语义：无返回、只能更新或退出） |

**语义分层（Q4 完整表见 §D）**：L1 静默 bundle OTA（无感知、高频）→ L2 APK 整包更新（可关闭弹窗、低频）→ G1 web 门槛（OTA 自愈优先，失败转阻断）→ G2 逆向门槛（bundle 声明最低 APK 版本，拒装转入 L2 通道）。

---

## A. Q1：数据源选型

### A.1 现状全景：version.json 的生产与消费链路（代码实读）

```
生产（release.mjs，发布时一次性写入）
  scripts/release.mjs step 2（L707-731）：写 { version, url, changelog }
    url = https://github.com/<repo>/releases/tag/<tag>（P7 动态取 git remote）
    changelog 截断上限见 ADR-0068（scripts/lib/changelog.mjs）
  step 4（L740-761）：version.json 与 package.json/gradle 同一 commit（"chore: bump version to X"）+ tag
  step 5（L764+）：push main → raw.githubusercontent 立即反映（CDN max-age=300，实测）

消费
  ① @pictelio/update-check（唯一运行时消费方，双端共用）
     UPDATE_URL = raw.githubusercontent.com/a1121611810/Pictelio/main/packages/website/version.json
     （URL 硬编码，已烧进所有已发 APK —— 不可移动文件位置）
  ② packages/website/src/pages/index.astro:3 / layouts/BaseLayout.astro:4 —— 构建期静态 import
     （落地页版本徽章 + 下载链接；加字段无影响）
  ③ .github/workflows/deploy.yml:48-49 —— cp 到 Pages dist（触发条件含 packages/website/**，
     version.json bump 即触发部署；Pages 侧缓存 max-age=600，实测）
  ④ packages/app/tests/agent-browser/specs/update-flow.test.ts:29 —— E2E mock 该 URL（契约测试锚点）
  ⑤ packages/update-check/tests/index.test.ts —— 单元测试契约
```

现状字段契约（`update-check/src/index.ts` L5-6 注释固化）：`version` / `url` / `changelog` / `release_url`（预留兼容项）。`checkForUpdate()` 解析只读这四个显式字段，**未知字段天然忽略**。注意 AGENTS.md 中「updateService 通过 GitHub API 检查」已过时——ADR-0089（2026-08-07）后生产链路是 raw.githubusercontent 直连 version.json；`/github-api` 代理仍在 vite.config.ts dev 代理清单（L214）但更新检查不再使用。

### A.2 三候选对比

| | **(a) 扩展 version.json** | (b) GitHub Releases 最新 release metadata | (c) 独立 manifest 文件 |
|---|---|---|---|
| 更新频率适配 | ✅ 发布时 `release.mjs` 顺手写；紧急提门槛 = 单独改一个 commit（可 revert、可审计），不必发 release | ⚠️ floor 与「最新 release」语义强耦合：提门槛必须发 release 或改 body；「最新」≠「最低要求」，普通发布不该抬门槛 | ✅ 独立演化 |
| 缓存特性（实测） | raw `cache-control: max-age=300` + ETag；Pages 副本 `max-age=600` | api.github.com 无边缘缓存承诺；限流见下 | 取决于托管位置（同 raw/Pages） |
| 原子性 | ✅ 单 commit 同时翻转 version/minWebVersion/webBundle，客户端一次 fetch 拿到一致快照，无撕裂读 | 🟡 release 对象内原子，但与 release 资产上传存在时序窗口（见 A.4） | 🔴 两个文件两次 fetch，CDN 缓存窗口错位 → `minWebVersion` 与 bundle 元数据可读到新旧混合 |
| 对旧客户端破坏性 | ✅ 零（旧解析忽略未知字段；缺字段 = 不设门槛，fail-open） | 🔴 需新 fetch 通道 + 新解析；旧 APK 内 raw URL 白白作废 | 🔴 新增第二个 URL 契约，已发 APK 拿不到 |
| 硬伤 | 无（唯一代价是「latest APK」与「web floor」两种语义共居一文件，JSON 小、语义注释可化解） | ❌ **未认证限流 60 次/小时/IP**（docs.github.com 实抓原文），移动端 CGNAT 下多用户共享出口 IP 极易触顶；Web 模式还需 `/github-api` 代理；release body 非机读 | ❌ 双 fetch 一致性 + 多一处契约维护 |

### A.3 推荐 schema（增量扩展，不动存量字段）

```jsonc
{
  "version": "4.22.0",                  // 存量：最新 APK 版本
  "url": "https://github.com/.../releases/tag/v4.22.0",   // 存量
  "changelog": "...",                   // 存量
  "minWebVersion": "4.21.0",            // 新增：web 层最低可用版本（floor）
  "webBundle": {                        // 新增（#240 后续 ticket 用）：OTA 元数据
    "version": "4.22.0",
    "url": "https://github.com/.../releases/download/v4.22.0/pictelio-web-4.22.0.zip",
    "checksum": "sha256-...",           // 与 #242 Ed25519 签名 manifest 配合
    "minApkVersion": "4.21.0"           // G2 逆向门槛（mpa 报告 §D.3 兼容规则的载体）
  }
}
```

- **判定复用 `isNewer`**：`bundle 低于 floor ⟺ isNewer(bundleVersion, minWebVersion)`（共享包加一个 `isBelowMin(local, floor)` 纯函数包装即可，零新依赖）。
- **floor 数据缺失/检查失败 = fail-open（不设门槛）**。门槛是加压机制：数据未知时阻断会造成全网砖机；这与 `checkForUpdate` 现有 error 语义（失败带原因 + 安全默认值）同构，但「安全默认」方向必须显式写成分支 + `console.warn`（禁静默降级硬约束），不能是 `??` 兜底带过。
- **floor 的生产者策略**：`release.mjs` 默认**继承上一次的 `minWebVersion`**（门槛是稀有、显式的动作），提供发布时交互确认或 `--min-web x.y.z` 提参；紧急提门槛允许手改 version.json 单独 commit（(a) 的独特优势）。

### A.4 诚实标注的时序窗口（现状既有，非 (a) 引入）

`release.mjs` 顺序为 commit/tag → push → 上传 release 资产：version.json 翻转先于资产就绪数分钟。对现状 APK 弹窗的影响是「前往下载」落到尚无资产的 release 页；对 OTA 下载则是 404。属发版流程内部窗口，ticket 化时可选：把 version.json 推送挪到资产上传成功之后，或客户端对下载 404 做有限重试。

---

## B. Q2：检查时机

### B.1 现有触发时机盘点（代码实读）

| 端 | 时点 | 开关/去重 | 行为 |
|---|---|---|---|
| 主 app（webview） | 冷启 `onMount` 启动编排末尾 + `STARTUP_CHECK_DELAY_MS=500`ms（`__root.tsx` L28/L182） | `autoCheckUpdate`（settings registry，默认 true）+ `lastDismissedVersion` 单版本忽略记忆 | 弹 `StartupUpdateDialog`（可关闭，「前往下载」`window.open` release 页）；设置页有手动检查（`SettingsAccount`） |
| app-lynx | 冷启同款 500ms 延迟（`updateStore.ts` L13） | 无开关（dev 编译期禁用除外）；无忽略记忆 | 命中即 replace 进 `/update` 强制页 + 清空历史栈（`backBehavior: 'exit'`） |
| 两端共同点 | **均无回前台/周期检查**；均不阻塞首帧（符合「先渲染后加载」硬约束） | | |

### B.2 外部第一手先例

| 系统 | 检查时机 | 依据 |
|---|---|---|
| capgo capacitor-updater（#241 已选型） | auto-update 默认在**启动 + 回前台**时 `getLatest()`（源码实读，见 ota-switching 报告 §A.2） | CapacitorUpdaterPlugin.java |
| Expo Updates | `checkAutomatically` 默认 `ON_LOAD`（"Checks for updates whenever the app is loaded"）；下载后默认**下次重启**生效，可 `reloadAsync()` 立即 | docs.expo.dev/versions/latest/sdk/updates 实抓 |
| CodePush | `sync` 由开发者择机；恢复安装提供 `InstallMode.ON_NEXT_RESUME` + `minimumBackgroundDuration`（后台停留够久才刷） | react-native-code-push docs/api-js.md 实抓 |

行业共识：**冷启必查 + 回前台补查**；raw `max-age=300`（实测）意味着比 5 分钟更密的检查没有意义。

### B.3 推荐时机（与现有机制去重）

1. **冷启：保持现有时点与节律，单次 fetch 三重消费。** 现有 500ms 延迟检查只做一件事（APK 弹窗），扩展后同一次 `checkForUpdate()` 响应同时驱动：APK 比较（现有弹窗通道）、`minWebVersion` 门槛评估、`webBundle` OTA 元数据（供 #240 下载器）。**不加第二次网络请求，不改变冷启动时序**（先渲染后加载硬约束零触碰）。
2. **回前台节流补查：`appStateChange`（authStore 已有该监听先例）触发，距上次成功检查 ≥4h 才发请求。** 目的有二：长驻会话（WebView 进程可存活数日）的门槛兜底；OTA「提前下载、下次启动生效」的预热。此检查**全程静默**，只更新内存态，不弹任何窗（APK 弹窗由 `lastDismissedVersion` 天然去重）。
3. **门槛检查不受 `autoCheckUpdate` 开关抑制**（检查动作共用；开关只关「APK 更新弹窗」的打扰）。理由：`autoCheckUpdate` 的用户语义是「少弹窗」，而门槛是完整性机制（对齐 CodePush mandatory「不可忽略」语义与 lynx 已上线的强制页先例——后者本来就无开关）。设置页文案需显式写明该边界。若团队倾向更保守的 v1（门槛也跟开关走），实现上只是同一个 if 的归属问题，不构成架构分叉。
4. **floor 本地缓存**：最近一次成功 fetch 的 `minWebVersion` 持久化（settings registry），启动时先用缓存判（零延迟、离线可用），网络成功后刷新。缓存缺失 = 无 floor = fail-open。
5. **OTA 失败重试退避**：门槛自愈路径的下载失败需指数退避（参照 capgo 对 429 的 Retry-After/24h 封锁语义），避免 T1 状态变成每分钟打 GitHub 的循环。

### B.4 双版本坐标（门槛比较对象必须是 bundle 版本，不是 APP_VERSION）

OTA 生效后「web 层版本」与「APK 版本」脱钩：门槛比较的 local 值 = **当前运行的 web bundle 版本**（来自 OTA 系统的当前 bundle 元数据 / capgo `getCurrentBundle`，APK 内置 bundle 时 = 构建期 `APP_VERSION`）；APK 弹窗比较的 local 值仍 = `APP_VERSION`。两套比较各自独立、互不复用判定结果——这是「静默 OTA + 门槛」分层后必然的双坐标系，schema 里 `version`（APK 坐标）与 `webBundle.version`（bundle 坐标）分开承载。

---

## C. Q3：门槛触发 UX

### C.1 仓内语料 + 外部先例

- **主 app**：`StartupUpdateDialog` = 温和弹窗（「稍后再说」/「前往下载」，Escape 可关，`lastDismissedVersion` 记忆）。
- **app-lynx**：`/update` 强制更新页 = 阻断页完整先例（ADR-0089 §5：replace 进入 + 清空历史栈、无返回按钮、返回键 = 退出、唯一主动作「下载新版本」开系统浏览器）。
- **CodePush**（第一手，docs/api-js.md）：mandatory 更新「wouldn't have the choice to ignore it」（弹窗不可忽略）；`mandatoryInstallMode` 默认 `IMMEDIATE`；且其 `notifyAppReady` 未调用即回滚上一版——与 #240 回滚机制同构。
- **capgo**：`getLatest` 响应带 `major` 破坏性标记（ota-switching 报告 §A.3 源码提取）——行业把「门槛」实现为更新元数据上的 flag，而非独立端点。**这佐证了把 floor 放进 version.json 的选型**。

### C.2 推荐分层（选项 c 为主干，b 作过渡反馈，a 兜底）

| Tier | 触发条件 | 系统动作 | 用户感知 | 出口 |
|---|---|---|---|---|
| **T0 常态静默** | bundle ≥ floor，且有新 bundle | 静默 OTA（#240 既定：下载 → 下次启动原子生效 → 回滚兜底） | 无 | — |
| **T1 门槛自愈** | bundle < floor，但 OTA 链路可用（floor ≤ 最新 bundle 版本） | 立即触发 OTA（优先下载完成即生效，降级下次启动）；期间**不阻断** | 轻量过渡反馈（选项 b：非阻断横幅/toast「正在更新，将在下次启动生效」），成功后消失 | 自动，多数门槛命中止步于此 |
| **T2 OTA 通道失败** | bundle < floor 且 OTA 失败（下载 404 / 验签失败 / 回滚后仍 < floor，重试退避耗尽） | **阻断页**（复用 lynx `/update` 语义：无返回、返回键=退出）：主按钮「立即更新」开 release 页，副按钮「重试更新」手动再触发 OTA | 阻断 | 更新 APK 或 OTA 自愈成功后放行 |
| **T3 原生不兼容** | 最新 bundle 的 `minApkVersion` > 当前 APK 版本（OTA 拒装） | 转入现有 L2 温和通道：APK 更新弹窗 | 可关闭弹窗（不阻断使用旧 bundle，除非同时命中 T2） | 前往下载 APK |

关键推论：**OTA 自愈能力直接决定门槛的打扰量级**——floor 提升后只要最新 bundle 可达，T1 一次静默下载就消化掉整个门槛事件，用户最多看到一条过渡提示；只有分发通道本身故障（GitHub 不可达、验签失败、连续回滚）才升到 T2 阻断。这与「静默更新+自动回滚是底座」的既定决策形成闭环：底座越可靠，门槛越接近纯保险机制。

实现锚点：T2 阻断页在 webview 侧用路由级实现（如 `/force-update`，进入即 replace + `backGestureStore` 覆盖返回语义），视觉遵循 Fluent 令牌；文案与按钮复用 `StartupUpdateDialog` 的既有语料（「前往下载」）。T1 横幅是纯增量组件，可后置到主 app 落地阶段。

### C.3 宽限期（可选，v1 不做）

CodePush/Expo/capgo 均无「floor 宽限期」概念。若担心长期离线用户被 T2 硬拦，可加本地首见时间戳 + N 天宽限（宽限内 T2 降级为 T1 横幅）。代价是引入时钟可信问题与额外状态；当前侧载用户规模小、lynx 已先例无宽限硬拦——**v1 不做**，schema 预留 `minWebVersionGraceDays` 字段位即可（加字段永远兼容）。

---

## D. Q4：语义分层表

| 层 | 触发条件 | 数据源（version.json 字段） | 生效时机 | 用户感知 | 失败语义 | 频率量级 |
|---|---|---|---|---|---|---|
| **L1 静默 web bundle OTA** | `webBundle.version` > 当前 bundle 版本，且 APK ≥ `webBundle.minApkVersion` | `webBundle.{version,url,checksum,minApkVersion}` | 静默下载 → 下次启动原子切换（notifyAppReady 超时回滚，#241） | **无感知** | 自动回滚 + 重试退避；检查失败 = 不动作 | 日/周级（高频） |
| **L2 APK 整包更新（温和）** | `version` > `APP_VERSION` | `version` + `url` + `changelog` | 用户手动下载安装 APK | 可关闭弹窗（`lastDismissedVersion` 忽略记忆）+ 设置页手动检查 | 检查失败 warn，无弹窗（现状） | 月级（低频） |
| **G1 强制门槛（web 层 floor）** | 当前 bundle 版本 < `minWebVersion` | `minWebVersion` | 先走 L1 自愈（T1）；OTA 不可用/失败 → 阻断页即时生效（T2） | T1 轻提示 / T2 阻断不可关 | **fail-open**：floor 缺失或检查失败 = 不设门槛 | 罕见（维护者显式动作） |
| **G2 逆向门槛（原生桥兼容）** | APK 版本 < `webBundle.minApkVersion` | `webBundle.minApkVersion` | OTA 拒装该 bundle（capgo `resetWhenUpdate` 同构语义），回落内置/旧 bundle | 转入 L2 APK 更新弹窗 | fail-open（字段缺失 = 不设兼容下限） | 跟随 L1 |

分层判据一句话：**能静默修复的绝不打扰（L1），需要用户动手的温和提醒（L2），两者都失效才阻断（G1-T2），原生契约变化用声明式下限拒装（G2）**。

---

## E. 落地注意清单（供 to-spec / to-tickets 取材）

1. **单一事实源扩展点在 `@pictelio/update-check`**（ADR-0089）：`CheckResult` 增 `minWebVersion?` / `webBundle?`；新增 `isBelowMin()` 纯函数；主 app `updateService.ts` 薄 re-export 面不动。原型沙盒（app-nuxt）与主 app 共用同一份解析。
2. **契约测试用真实样例**：`packages/update-check/tests/index.test.ts` 补 minWebVersion 成功/缺失/脏数据路径（IO 边界硬约束：成功 + 失败都要测）；`update-flow.test.ts` 的 mock version.json 同步扩字段；后续 OTA 场景 E2E 用 `driver.mockFetch()` 构造「bundle < floor」状态。
3. **禁静默降级显式化**：floor fail-open 必须是显式分支 + `console.warn("[update-check] ...")`，禁止 `??` 一行带过（floor 未知被当「不阻断」是行为决策，要可见）。
4. **`release.mjs` 产出策略**：minWebVersion 默认继承 + 发布时交互确认/`--min-web` 提参；标注 §A.4 资产时序窗口的处理取舍。
5. **T2 阻断页**：复用 lynx `/update` 的交互语义（ADR-0089 §5）而非代码；webview 侧需处理 backGestureStore 返回覆盖与 Escape；Fluent 令牌约束全程适用。
6. **检查编排**：B.3 的五条（共用 fetch、resume 节流、开关边界、floor 缓存、退避）逐条 ticket 化，避免实现时顺手合成一团。
7. **不重开已决项**：灰度放量（不做）、远程 URL 壳（否决）、delta 更新（v1 不做）——floor 机制不依赖其中任何一项。

---

## 附：引用来源

| 论断 | 来源（抓取/实读日期 2026-08-29） |
|---|---|
| update-check 契约（version/url/changelog/release_url）、UPDATE_URL 烧进客户端、10s 超时、error 字段、未知字段忽略 | `packages/update-check/src/index.ts` 全文实读；ADR-0089 §6 |
| release.mjs step2 写 `{version,url,changelog}`（url 动态 repo slug）、step4 同 commit + tag、releaseFiles 清单含 version.json、changelog 截断 | `packages/app/scripts/release.mjs` L707-761 实读；`scripts/lib/changelog.mjs`（ADR-0068） |
| website 构建期消费 version.json（版本徽章/下载链接）；Pages 部署触发路径含 packages/website/**；cp 到 dist | `packages/website/src/pages/index.astro` L3/L114-116、`layouts/BaseLayout.astro` L4/L141、`.github/workflows/deploy.yml` L48-49 实读 |
| raw.githubusercontent `cache-control: max-age=300` + ETag；Pages `max-age=600` | curl -sI 实测本仓两 URL（2026-08-29） |
| GitHub REST 未认证限流 60 req/h，按来源 IP 关联 | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api 实抓 |
| 主 app 冷启检查时点（500ms 延迟、autoCheckUpdate gate、lastDismissedVersion 去重、弹窗条件）、无 resume 检查 | `packages/app/src/routes/__root.tsx` L28/L50-74/L181-186、`settingsStore.ts` L195-216、`StartupUpdateDialog.tsx` 实读 |
| lynx 强制更新页语义（replace + 清历史栈、backBehavior exit、无忽略记忆、openUrl/exitApp 收敛） | `packages/app-lynx/src/stores/updateStore.ts` 全文实读；ADR-0089 §4-5 |
| capgo auto-update 启动/回前台检查、getLatest `major` 字段、notifyAppReady 10s 回滚、resetWhenUpdate | `docs/research/ota-switching-mechanism.md` §A.2/§A.3（capgo 8.51.15 Android 源码逐行实读，2026-08-29） |
| CodePush mandatory「不可忽略」、`mandatoryInstallMode` 默认 IMMEDIATE、`minimumBackgroundDuration`、`notifyAppReady` 未调用即回滚 | https://github.com/microsoft/react-native-code-push docs/api-js.md（gh API raw 实抓） |
| Expo Updates `checkAutomatically ON_LOAD` 默认、下载后下次重启生效、rollback directive 回退 embedded、runtime version 兼容门 | https://docs.expo.dev/versions/latest/sdk/updates/ 实抓 |
| E2E mock 锚点（raw URL pattern + mockFetch 构造远端状态） | `packages/app/tests/agent-browser/specs/update-flow.test.ts` L25-90 实读 |
| 分层更新（L1/L2）、bundle 声明最低 APK 版本、远程壳否决、AGENTS.md「GitHub API 检查」描述已过时（ADR-0089 后为 raw version.json） | `docs/research/mpa-remote-githubpages-feasibility.md` §D.3；ADR-0089；`packages/app/vite.config.ts` L214（/github-api 仅存 dev 代理清单） |
| 「T1 消化绝大多数门槛、底座越可靠门槛越接近纯保险」「双版本坐标脱钩」「宽限期 v1 不做的权衡」「floor 缓存零延迟判定」 | **推测/设计推论**（基于上述源码事实与 #240 既定决策外推，落地前按 §E 清单 ticket 化验证） |
