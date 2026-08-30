# OTA web bundle 更新实施规格

> 对应 issue [#246](https://github.com/a1121611810/Pictelio/issues/246)（Wayfinder 地图 [#240](https://github.com/a1121611810/Pictelio/issues/240) 唯一 open task）。
> 依据：`docs/research/` 五份调研（mpa-remote-githubpages-feasibility / ota-switching-mechanism / ota-ed25519-android / ota-minwebversion-gate / ota-release-integration，均为第一手源码/文档实抓）+ #245 原型四场景实测（分支 `prototype/ota-sandbox`，四坑修复已验证）。
> 关键裁决：**切换机制自研硬化**（见 ADR-0122）；其余决策为 2026-08-30 grill 会话与用户逐条确认（全屏过渡面 / 快慢双通道 / 开关+门槛豁免 / web-only 发布模式）。

## 问题陈述

Pictelio 通过 GitHub Releases 侧载分发，web 层与原生层绑定在同一个 APK 里：任何 web 修复（UI、逻辑、内容适配）都要走完整的构建→签名→上传链，用户必须重新下载安装整个 APK 才能收到几行代码的修复。更新粒度被 APK 锁死。

对维护者还有两个衍生问题：线上 web 层出现严重缺陷时，到达用户的路径太长；现有温和弹窗（`StartupUpdateDialog`）无法强制过低版本用户升级。

## 解决方案

web 层更新与 APK 解耦，形成分层更新：

- **L1 web bundle OTA**（高频、静默）：web 产物打包为 zip + Ed25519 签名三件套，经 GitHub Releases 分发；app 启动检查 → 静默下载 → 验签解压 → **下次启动原子生效** → 启动健康检查（notifyReady 版本握手）超时自动回滚。无网、首屏速度、桥接安全模型全部不变（bundle 仍从本地磁盘加载，origin 不变）。
- **L2 APK 整包更新**（低频、显式）：原生变更才发 APK，现有 `updateService` + 温和弹窗通道原样保留。
- **G1 强制门槛**：`minWebVersion` floor（维护者显式动作）命中时先 OTA 自愈（全屏过渡面），自愈失败才阻断。
- 发布工作流提供 **web-only 模式**（`pnpm release --web-only`）：不构建 APK，分钟级完成一次 web 热修发布。

## 用户故事

1. 作为侧载用户，我想让 web 层修复静默自动到达（下次启动即生效），不用重新下载安装 APK。
2. 作为侧载用户，我想在无网环境照常使用 app——bundle 从本地磁盘加载，断网不影响启动与已缓存内容。
3. 作为侧载用户，当一个更新包有问题（启动即崩）时，我想最多经历一次重启就自动回到上一个可用版本，而不是白屏卡死。
4. 作为侧载用户，当 app 版本低于维护者设定的最低可用版本时，我想看到清晰的「正在更新」过渡页而不是坏掉的界面，更新成功自动进入新版本。
5. 作为侧载用户，当自动更新通道彻底失败时，我想得到明确的阻断页与两个出口：重试更新、前往下载新 APK。
6. 作为流量敏感的侧载用户，我想能在设置里关闭「自动下载 Web 更新包」，由自己决定何时更新。
7. 作为侧载用户，我想知道 app 当前运行的是哪一版 web 包（About/Debug 页展示当前 bundle、lastGood、pending、公钥指纹），排查问题时有据可查。
8. 作为长驻会话用户（WebView 进程存活数日），我想在回到 app 时自动补查更新，不必杀进程重启。
9. 作为维护者，我想只发 web 修复时走 `pnpm release --web-only`：分钟级、不构建 APK、不输入 keystore 密码，用户的 app 自动吸收。
10. 作为维护者，我想正常发布（含原生变更）时一次 `pnpm release` 同时产出 APK 与 web bundle 三件套，版本号同源一套状态。
11. 作为维护者，我想用 `minWebVersion` 强制过低版本升级：floor 提升后所有低于它的 bundle 在下一次启动前被自愈或阻断。
12. 作为维护者，我想让分发的 bundle 不可被篡改——Ed25519 签名、公钥内置 APK、私钥只在发布者本机（仓外）。
13. 作为维护者，我想让「APK 整包升级」自动清掉旧 OTA 状态回到内置 bundle，防止新原生桥遇到按旧桥编译的 bundle（协议漂移防护）。
14. 作为维护者，我想让覆盖发布（`-o`）永远不产生"版本号没变但内容变了"的静默热修——热修一律走正常版本递增。
15. 作为维护者，我想新增原生桥方法时有契约测试拦截「bundle 依赖了不存在的桥 API」这类幽灵依赖。
16. 作为使用旧版 APK 的用户（无 OTA 能力），version.json 新增字段对我零影响——旧客户端只读已知字段，行为不变。
17. 作为维护者，我想让 OTA 检查失败/数据缺失时显式暴露（console.warn）而不是静默装作没有门槛——契约破坏必须可见。

## 实现决策

### 选型与架构

- **自研切换原语，不引入 `@capgo/capacitor-updater`**（ADR-0122）。运行时指向用 Capacitor 官方原语 `setServerBasePath` / `setServerAssetPath`（官方 issue #1228 背书的唯一正道；与 capgo 内部用的 `hostFiles` 同源）。原型 OtaPlugin（~350 行）为生产化基础。
- 原子切换语义 = **版本目录不可变 + 三指针（current / lastGood / pending）+ 整页 loadUrl 重载 + notifyReady 超时回滚**。指针存 SharedPreferences（commit 同步落盘）；磁盘上永远不存在半新半旧的文件混合。
- 状态机（源自原型，决策性部分原文保留）：
  - `current`：当前加载的版本（`"public"` = APK 内置 / 版本目录名）
  - `pending`：已安装待生效版本；插件 load 时 adopt → current → 延迟 ~500ms 切根 + 版本化 query 导航
  - `lastGood`：最近一次通过健康握手的版本；回滚目标
  - notifyReady 超时（10s）→ 指针回 lastGood → 清 pending → 重载；同版本重装先删后移（幂等）
- 下载/验签/解压全在原生侧执行（zip 字节零进 JS 堆，对齐「图片二进制零进 JS 堆」既有原则）；JS 侧只负责调度与元数据。

### 四个生产必修坑（#245 实测，生产代码必须内建）

1. **缓存陈旧文档**：Capacitor 本地服务器响应缺 `Cache-Control`，Chromium 缓存旧文档 → 切换后旧 JS 复活误调 notifyReady。修复 = MainActivity 层 no-store 包装（与既有 `/pixiv-img/` 拦截 wrapper 组合成链，未命中委托、命中注入）+ `clearCache` + index.html 导航带版本化 query（`?otav=<version>`）。
2. **notifyReady 版本握手**：健康上报必须携带 bundle 版本且与 current 指针一致才计健康；陈旧文档上报直接拒绝（否则坏 bundle 被旧文档误标健康，回滚失效）。
3. **切换与 WebView 首导航竞态**：plugin.load() 时立即切根会与 WebView 首次导航赛跑（实测两种时机都会输）；修复 = adopt pending 后延迟 ~500ms 再切根 + 版本化 query 导航，旧文档闪一帧但被坑 ② 的握手挡住误报。
4. **回滚清理**：回滚必须清 pending 指针；同版本重装必须先删旧目录再 rename（否则 renameTo 必败 → 安装假失败循环）。

### 生产化增量（原型未覆盖）

- **APK 升级清 OTA**（capgo `resetWhenUpdate` 同构语义，自研需自实现）：插件记录安装时的原生 versionCode，加载时发现变化 → 清空版本目录 + 指针全部复位内置。
- **快慢双通道下载**：T0 常规预热走 WorkManager（OneTimeWorkRequest，`NetworkType.CONNECTED` 含计费网络，指数退避，unique work 防重复），结果写 pending 下次启动生效；G1 门槛自愈走前台直连（用户正在全屏过渡面等待，不能受系统调度摆布）。两通道共用同一套 install 逻辑（验签/解压/写 pending）。
- **重试退避**：下载失败指数退避（避免门槛状态变成高频打 GitHub 的循环）；孤儿临时目录下次启动清扫。
- **磁盘清理**：健康握手确认后仅保留 current + lastGood 两个版本目录（磁盘峰值 ~2 版）。
- **公钥内置**：`buildConfigField OTA_ED25519_PUBLIC_KEY_B64`（base64 raw 32B，对齐 `CLIENT_KINDS` 先例）+ 构建期长度校验；About/Debug 页展示公钥指纹（SHA-256 of raw key）供肉眼比对。
- **验签依赖**：`bcprov-jdk18on`（仅 lightweight API，不注册 JCA provider）。签名 = 域分隔前缀 `"Pictelio-OTA-bundle-v1\n"` + SHA-256(manifest 字节) 的 Ed25519 签名（hash-then-sign，两侧流式/内存 O(1)；选择理由与 oracle 见 ota-ed25519-android.md §5）。
- **notifyReady 挂点语义**：路由首帧渲染完成（含骨架屏）即算 ready——「bundle 能执行到首帧」；数据加载失败不算不健康（那是 ErrorDisplay 的职责）。v1 接受的边界：深层导航才加载的 lazy chunk 缺失不在回滚覆盖内（hash 文件名 + 同版本目录一致性使该场景罕见）。
- **Web/dev 环境护栏**：非原生平台所有 Ota 插件调用 no-op 跳过（显式判断，不静默吞错）。

### 检查与调度（JS 编排）

- **单 fetch 三重消费**：保持现有冷启 500ms 延迟检查时点不变，一次 `checkForUpdate()` 响应同时驱动 APK 弹窗比较（`version` 字段）、门槛评估（`minWebVersion`）、OTA 元数据（`webBundle`）。不加第二次网络请求，不碰「先渲染后加载」硬约束。
- **回前台节流补查**：`appStateChange`（authStore 已有该监听先例）触发，距上次成功检查 ≥4h 才发请求；全程静默。
- **fail-open 显式化**：floor 缺失/检查失败 = 不设门槛，但必须是显式分支 + `console.warn("[update-check] ...")`（禁静默降级硬约束）；floor 本地缓存（settings registry）供零延迟与离线判定，网络成功后刷新。
- **开关边界**：现有 `autoCheckUpdate` 只关 APK 弹窗；新增「自动下载 Web 更新包」开关（默认开）只关 T0 预热下载（关闭时启动仍报告可用版本）；**门槛检查与自愈不受任何开关抑制**（完整性机制，对齐 lynx 强制页先例），设置页文案显式写明该边界。
- **模块归属**：新增 otaService（检查调度/退避/floor 缓存/插件调用）；updateService 保持薄 re-export 面不动；StartupUpdateDialog 现有流程不变。

### 门槛 UX（D4 裁决：全屏过渡面合并 T1/T2）

- 门槛命中（当前 bundle 版本 < floor）→ **全屏过渡面**（非错误样式，Fluent 令牌，激活期间返回键 = 退出应用，对齐 lynx `/update` 语义）：
  - 自愈中：「正在更新…」状态；
  - 自愈成功：自动 applyNow + reload 进新版，**尽量保留当前路由路径**（版本化 query 之上拼回路径）；
  - 自愈失败：同屏转阻断态（重试更新 + 前往下载 APK 两出口）。
- 实现形态为全屏覆盖层（复用 `StartupUpdateDialog` 自绘 overlay 模式）+ backGestureService 返回拦截，不新增路由。
- **T3 逆向门槛**：最新 bundle 的 `minApkVersion` > 本机 APK 版本 → 拒装，转入现有 APK 温和弹窗通道（fail-open：字段缺失 = 不设兼容下限）。

### 版本与数据源

- **数据源 = 扩展 `packages/website/version.json`**（ADR-0089 单一事实源，raw URL 已烧进已发 APK 不可迁移；旧客户端零破坏）。生产 schema：

```jsonc
{
  "version": "4.22.0",              // 存量：最新已发布 APK 版本（APK 弹窗坐标）
  "url": "…/releases/tag/v4.22.0",  // 存量
  "changelog": "…",                 // 存量
  "minWebVersion": "4.21.0",        // 新增：web 层最低可用版本（floor，缺省 = 不设门槛）
  "webBundle": {                    // 新增：OTA 元数据（缺省 = 无 bundle 更新）
    "version": "4.22.0",
    "url": "…/releases/download/v4.22.0/pictelio-4.22.0"   // 三件套资产前缀 URL
  }
}
```

- 客户端由前缀 URL 拼 `-manifest.json` / `-manifest.json.sig` / `-web-bundle.zip` 三件套；`checksum` 与 `minApkVersion` 只存在于**签名的 manifest**（唯一事实源，不放进未签名的 version.json——对 #243 草案 schema 的精简）。
- manifest 内容：`{ "version", "minApkVersion", "size", "sha256" }`（sha256 = zip 摘要，验签后解压前先做下载完整性快检）。
- **双坐标**：`version`（APK 坐标，APK 弹窗比较对象）与 `webBundle.version`（bundle 坐标，OTA 与 floor 比较对象）语义独立。floor 比较的 local 值 = 当前运行 bundle 版本（OTA 指针元数据；内置 bundle 时 = 构建期 `APP_VERSION`）。
- `manifest.version` = 构建时 package.json version（与 zip 内联 `APP_VERSION` 一致，manifest 不得说谎）；比较复用 update-check `isNewer()`，新增 `isBelowMin()` 纯函数。

### 发布链整合（#244 结论 + web-only 模式）

- 新脚本 **release-bundle.mjs**（打包 + 签名）：dist 全量打包 zip（**zip 根直接是 index.html**，对齐版本目录布局；zip 格式决策见下节）→ SHA-256 → 生成 manifest → `node:crypto` Ed25519 签名 → 三件套落 `packages/app/ota/`（**必须新增 .gitignore 条目**，否则 step 4 发布无关变更拦截必炸）。支持独立运行做本地 round-trip 验签。防呆：断言产物资源引用以 `/assets/` 开头（base 必须 "/"）。
- **正常发布**：release.mjs step1 追加 OTA 私钥探测（缺失默认 fail，`PICTELIO_RELEASE_SKIP_OTA=1` 显式跳过打 warn）；step3 buildSteps 追加打包签名步（正常与 `-o` 重建两条路径自动共用，失败落在自动回滚窗口内）；step6 上传三件套；catch 恢复指引同步追加。
- **web-only 模式（`pnpm release --web-only`）**：
  - step1 只查 OTA 私钥（无需 keystore 密码）；step2 照常 bump package.json（bundle 自报版本必须递增）+ 五处版本同步照旧；step3 只跑 credentials 同步 + web 构建 + release-bundle.mjs（跳过 gradle/Lynx/cap:sync）；step4/5 照常 commit + tag + push；step6 `gh release create --prerelease`（GitHub "Latest" 徽章仍指向最后完整 APK 版本）+ 只传三件套。
  - **version.json 唯一偏差**：`version` 字段保持上一个已发布 APK 版本不动（APK 弹窗不响），仅更新 `webBundle` 与（可选）`minWebVersion`。
- **覆盖发布 `-o` 语义**：对三件套仅限同内容重传；**OTA 热修禁止走 `-o`**——热修一律 `--web-only` bump patch（`-o` 不 bump 版本号 → `isNewer` 判无更新 → 热修静默失效）。
- **minWebVersion 生产策略**：release.mjs 默认继承上次值（门槛是稀有、显式动作），发布时交互确认或 `--min-web x.y.z` 提参；紧急提门槛允许手改 version.json 单独 commit。
- checklist（docs/release-checklist.md）新增「web bundle OTA 产物」一节：产物定义、round-trip 验签自检、桥 API 演进约定（新增桥方法 → 同步 TS 声明 + 契约测试 + 评估提升 minApkVersion；bundle 内新桥能力一律能力检测）。

### 打包格式：zip 而非 tar（决策显式化）

1. `java.util.zip` 平台内置零依赖；Java/Android 无标准库 tar 解析器（需引 Commons Compress 或手写），与依赖最小化方针冲突（D1 自研 + Ed25519 只引 bcprov 一个轻量库）。
2. 安全模型：zip 条目 = 名字 + 字节，语义面小（唯一要防的 zip-slip 已有 canonical-path 检查）；tar 携带权限位/owner/symlink 全套 Unix 元数据——解包侧要防 symlink 逃逸且 `filesDir` 根本用不上这些元数据。
3. delta 演进门：zip 条目独立压缩 + 中央目录 → 可按条目随机访问/Range 下载变化文件；tar.gz 单流取任一文件必须全解压，delta 通道堵死（delta 本身 v1 不做，但格式不为它堵门）。
4. 生态惯例与实测基线：capgo/CodePush 均用 zip；#245 磁盘口径（272KB）即 zip 实测。压缩率与 tar.gz 对已 minify 产物几乎无差。

## 测试决策

### 测试 seam（尽量用现有 seam，新增最少）

1. **update-check FetchLike 注入**（现有 seam）：单测直接传 mock fetchImpl（先例：update-check 单测）；E2E 用 `driver.mockFetch()` 在 UPDATE_URL 上构造远端状态（先例：update-flow.test.ts）。
2. **Ota 插件 JS 接口面**：单测 mock 插件（registerPlugin mock 先例），覆盖调度/退避/开关/门槛状态机。
3. **原生验签纯函数**：Ed25519 验签 + manifest 解析提为无 Android 依赖的独立类，JVM 单测——oracle = RFC 8032 §7.1 / Wycheproof 官方向量 + 与 Node 侧签名互验（差分测试），禁从被测实现反推期望值。
4. **release-bundle.mjs**：纯逻辑（plan）与副作用（execute）分离（先例：release-overwrite.mjs），签名 round-trip 用测试内临时 keypair + 官方向量。

### 必测路径（IO 边界硬约束：成功与失败都要测）

- update-check 扩展字段三态：成功（含 minWebVersion/webBundle）/ 缺失（fail-open + warn）/ 脏数据（解析失败带 error）。
- 契约测试三类：① Ed25519 官方向量；② manifest schema（字段完整性 + `minApkVersion ≤ version` 断言正反例）；③ 桥接口一致性（从 Java 插件 `@PluginMethod` 提取方法名 ↔ `src/native/*.ts` 声明比对，先例：backupRulesConsistency 从源码提取常量模式）。
- E2E（mockFetch 构造）：bundle < floor → 全屏过渡面自愈成功 reload；OTA 失败 → 阻断态；floor 正常 + 有新 bundle → 静默 pending；floor 缺失 → fail-open 无感。
- **设备四场景回归**（继承 #245 bench 编排模式，模拟器手测/脚本化，不进 CI）：好包下次启动生效 / 坏签名拒装 / 崩溃 10s 回滚 / 门槛阻断——在 packages/app 生产构建上复测（原型四坑修复内建后）。

## 范围外

- 灰度放量（2026-08-30 用户决策：不选）
- delta/差分更新（v1 不做；zip 格式已留演进门，带宽成本浮现再开）
- iOS 平台、app-lynx bundle 的 OTA（仅主 app web 层）
- 远程 URL 壳 / 运行时远程加载（mpa 调研已否决，不重开）
- 门槛宽限期（v1 不做；schema 加字段永远兼容，`minWebVersionGraceDays` 预留字段位）
- CI 签名（签名只放发布者本机，与 APK 签名同一信任模型；CI 只做无密钥验证类工作）
- 同版本号热修（`-o` 不 bump → 禁用于 OTA 热修；将来如需走 manifest 加 build 计数，v1 不做）

## 补充说明

- **原型处置**：`packages/app-nuxt` 沙盒（分支 `prototype/ota-sandbox`）仅作参考实现保留，不进生产；生产落地目标 = packages/app（含原生壳、JS 编排、update-check 共享包、发布链）。
- **时序窗口（诚实标注）**：release.mjs 顺序为 commit/tag → push → 上传资产，version.json 翻转先于资产就绪数分钟 → OTA 下载可能 404。由下载端有限重试 + 退避消化；可选改进为 version.json 推送挪到资产上传后（ticket 化时决定）。
- **实施分支**：to-tickets 后的实现工作应基于 main 拉新分支（当前 throwaway 分支只承载沙盒与研究产物）。
- 引用：切换机制细节 `docs/research/ota-switching-mechanism.md`；签名/密钥流程 `docs/research/ota-ed25519-android.md`；门槛数据源与时机 `docs/research/ota-minwebversion-gate.md`；release 整合点 `docs/research/ota-release-integration.md`；否决论证 `docs/research/mpa-remote-githubpages-feasibility.md`。
