# release 流程与 web bundle 产物/签名的整合点（issue #244 调研）

> 调研日期：2026-08-29。对应 issue #244（Wayfinder 地图 #240 的调研子任务）。前置结论：签名方案见 `docs/research/ota-ed25519-android.md`（域分隔前缀 + SHA-256(zip) 摘要签 / manifest JSON，Node 侧 `node:crypto` Ed25519），切换机制见 `docs/research/ota-switching-mechanism.md`（capgo 手动模式 / `versions/<id>/index.html` 布局）。**本文全部结论来自本仓源码逐行实读（文件 + 行号在来源节），无外部依赖。**
>
> 一句话结论：**插入点 = `release.mjs` 的 step 3（`buildReleaseApks()` 的 `buildSteps` 追加「打包 + 签名 web bundle」一步，正常发布与覆盖发布重建两条路径自动共用）+ step 6（`uploadReleaseAssets({ paths })` 追加 bundle 三件套资产，复用既有逐包重试/上传面板/失败隔离）；版本方案 = bundle 版本与 `package.json` / APK `versionName` 同源同值（tag/versionCode/version.json 一套状态零新增），兼容约束用 manifest 的 `minApkVersion` 字段（进签名覆盖范围）+ App 端下载前守卫 + CI 桥接口一致性契约测试三层表述；签名只放本地（现有 CI 无任何签名/发布步骤，与 APK 签名同一信任模型），CI 只做不持密钥的验证类工作（Ed25519 官方向量测试、桥契约测试、可选 zip 结构 smoke）。**

---

## 1. Q1：现有 release 流程全景与可挂载插入点

### 1.1 流程步骤清单（`packages/app/scripts/release.mjs`，1001 行实读）

`pnpm release` = `node scripts/release.mjs`（`packages/app/package.json` L32），强制 TTY + main 分支（L88-91、L102-111），正常发布共 6 步（`step(n, ...)` 编排，L674-883）：

| 步骤 | 位置 | 内容 | 与 OTA 的关系 |
| --- | --- | --- | --- |
| 1 检查签名环境 | L689-705 | `PICTELIO_KEYSTORE_PASSWORD` / `PICTELIO_KEY_PASSWORD` / `android/app/pictelio-release.keystore` 存在性，缺一 fail-fast | **插入点 A**：追加 OTA 私钥探测（见 §6） |
| 2 更新版本号 | L707-731 | 写 `package.json` → `sync-android-version.mjs` 同步 build.gradle → fastlane `changelogs/<versionCode>.txt` → `packages/website/version.json`；失败自动回滚（L907-930） | manifest 的 `version`/`minApkVersion` 直接取这里的 `newVersion` |
| 3 构建 APK | L733-738 → `buildReleaseApks()` L511-573 | `buildSteps` 数组顺序执行：sync:credentials → **`pnpm run build`（= `vp build`，产出 `dist/`，无 BASE_PATH）** → 构建 Lynx bundle → 同步 Lynx assets → cap:sync → gradlew assemble+rename | **插入点 B（主插入点）**：`buildSteps` 追加「打包并签名 web bundle」 |
| 4 Git 提交 + Tag | L740-762 | 只 `git add` 白名单 `releaseFilesFor()`（L56-62：package.json / android build.gradle / website version.json）；`git status --porcelain` 出现任何清单外路径（含未跟踪 `??` 文件）直接抛错「发布无关的变更」（L746-756） | **硬约束**：bundle 产物落盘路径必须被 gitignore，否则 step 4 必炸 |
| 5 推送 GitHub | L764-784 | `git push origin main --tags`，3 次指数退避 | — |
| 6 创建 GitHub Release | L786-883 | 先 `gh release create`（仅创建，L804-836，4xx 类错误不重试），再 `uploadReleaseAssets()` 逐包上传（L859-865） | **插入点 C（上传）**：`paths` 追加 bundle 三件套 |

另有一条覆盖发布路径：`pnpm release -o`（`runOverwriteFlow()` L317-508 + `release-overwrite.mjs` 深模块）——对**已存在且已发布**的 Release 用 `gh release edit` 更新文案、`uploadReleaseAssets`（`--clobber` 语义）覆盖/补齐资产；不 bump 版本号、不移动 tag（`docs/release-checklist.md` §七硬约束）。`buildReleaseApks()` 被覆盖发布的重建分支共用（L383），**所以挂在 `buildSteps` 里的打包步骤两条路径自动生效**。

### 1.2 产物上传方式（现状机制）

- **两段式**：`gh release create`（REST 创建 Release 挂 notes）→ `uploadReleaseAssets()`（`packages/app/scripts/lib/release-uploader.mjs`，ADR-0065 编排深模块）：
  - 默认 **Node 原生上传器**（`lib/upload-release-assets.mjs`）：从 gh keyring 取 token（`gh auth token`，L26-41，不进环境变量），直连 `https://uploads.github.com/repos/{o}/{r}/releases/{id}/assets?name=` PUT（L64），实测吞吐约 gh 子进程 2.1 倍；`PICTELIO_UPLOADER=gh` 可回退 gh CLI。
  - 上传契约（release-uploader.mjs 头注释 L1-12）：`paths` 的 **basename 必须互异**（并发同名资产有「先删后传」竞争，启动前拒绝）；单包最多 3 次尝试（退避 1s/2s/4s）；失败进 `failed[]` 不整包 throw；并发数 = paths.length；**不读文件内容、不碰凭证**。
  - 上传前 `probeProxyRouting("uploads.github.com")` 探测直连/代理并提示（release.mjs L842-857）。
- 上传器对新增资产类型**零耦合**——它只看路径与 basename，zip/manifest/.sig 与 APK 走同一管线，重试/面板/失败恢复指引全部白拿。
- 失败恢复指引（catch 分支 L961-988）：step 6 失败时打印逐资产 `gh release upload --clobber` 恢复命令——需同步追加 bundle 资产的指引。

### 1.3 插入点判定（结论）

1. **打包 + 签名 → step 3 的 `buildSteps` 数组**（release.mjs L518-542）：追加一项 `["打包并签名 web bundle", "node", ["scripts/release-bundle.mjs"]]`，位置紧随「构建 Web 产物」之后（此后无任何步骤再触碰 `dist/`，cap:sync 是 copy 不 move，dist 完整保留；位置在数组尾部亦可，语义等价）。
   - 为什么不放在 step 6：step 4 已 commit/tag，签名失败会留下「已推送 tag 但 release 缺资产」的恢复态；放 step 3 内让失败落在 P4 回滚窗口内（step 2/3 失败自动回滚版本文件，L907-930），重跑干净。
2. **上传 → step 6 的 `uploadReleaseAssets({ paths })`**：现为 `apkPaths.map(...)`（L862），追加三件套路径即可；三件套 basename 与 APK 互异，满足上传器契约。
3. **新脚本 `scripts/release-bundle.mjs`**（预估 ~100-150 行）：zip 打包（dist 全量）→ SHA-256 → 生成 manifest → `node:crypto` Ed25519 签名（按 ota-ed25519-android.md §5：`sign(null, DOMAIN || manifestBytes, privateKey)`，64 字节 `.sig`）。设计为先例对齐：`sync-android-assets.mjs`（产物同步 + 大小校验 + fail-fast 风格）、`release-overwrite.mjs`（纯逻辑 plan 函数与副作用 execute 分离、可单测）。脚本同时支持独立运行（本地验证打包/验签 round-trip，不依赖完整 release 流程）。
4. **覆盖发布 `-o`**：`planOverwrite`/`executeOverwrite` 的资产清单需同步纳入三件套，但语义上**仅限「重传同内容」**（见 §3.2 的版本单调性裁决）。

---

## 2. Q2：dist/ 结构与 zip 内容

### 2.1 构建链与产物结构（实测）

- 构建链：`pnpm build` = `vp build`（vite-plus 封装 Vite/Rolldown，`vite.config.ts` 无 outDir 覆盖 → 默认 `packages/app/dist/`）；`cap:sync` 把 `webDir: "dist"`（`capacitor.config.ts` L11）复制进 `android/app/src/main/assets/public`（copy 不 move，dist 保留）。
- 本机 `dist/` 实测结构：

```
dist/
├── index.html                  # 引用 /assets/<name>-<hash>.js|css（实测 6+ 个引用）
├── assets/                     # hash 文件名 chunk：index-CZnFNMkt.js、rolldown-runtime、
│                               # vendor / fluent-vendor / tanstack-vendor、
│                               # imageSize.worker、native、spark-md5 等；0 个 .map
├── favicon-16x16.png / -32x32 / .svg
├── logo-192x192.png / -512x512
└── privacy-policy.html         # public/ 目录静态拷贝（vite 默认行为）
```

- `vite.config.ts` 关键项：`base: process.env.BASE_PATH || "/"`（L56-58，GitHub Pages 部署才设 `/pixivizer/`）；`define.APP_VERSION = package.json version`（L87，**编译期内联进 bundle**）；`__CREDENTIALS__` 编译期内联（L88，现状已接受的安全模型）；默认不开 sourcemap（实测 0 个 .map）。

### 2.2 zip 应该包什么

- **包 `dist/` 全部内容，zip 根直接是 `index.html`**（即从 dist 内部打包，不带 `dist/` 顶层目录名）——与 ota-switching-mechanism.md §A.2 的版本目录布局（`filesDir/versions/<id>/index.html`，capgo `bundleExists()` 校验 index.html 存在）严格对齐，解压即目录、零转换。
- **排除清单：不需要排除任何东西**。dist 内无 sourcemap、无服务端产物、无未内联的凭证文件（凭证在编译期已进 JS——这与 APK 内置 assets 是**同一份产物、同一安全面**，OTA 不引入新暴露；打包脚本不做也不应做脱敏）。
- **两个防呆点**：
  1. **base 必须是 "/"**：`BASE_PATH` 环境变量是 GitHub Pages 专用；release 流程 step 3 的 `pnpm run build` 未设置它，天然安全。但独立手动跑 `release-bundle.mjs` 时应在脚本内校验产物 index.html 的资源引用以 `/assets/` 开头（或干脆在打包前 `delete process.env.BASE_PATH` + 断言），防止开发者 shell 残留变量打出错误 base 的 bundle。
  2. assets 全部 hash 文件名 → 全量 zip（v1 不做增量 diff）；`WebViewLocalServer` 对本地服务强制 `Cache-Control: no-cache`（switching 报告 §A.4），hash 文件名无缓存副作用。
- **产物落盘路径**：建议 `packages/app/ota/pictelio-<version>-web-bundle.zip` + `pictelio-<version>-manifest.json` + `pictelio-<version>-manifest.json.sig`（命名对齐现有 `pictelio-<version>-<flavor>.apk` 惯例，`apkPathsFor` release-utils.mjs L23-25）。**必须在根 `.gitignore` 新增 `packages/app/ota/`**：
  - 现有 `.gitignore` L3 的 `dist/` 无锚定斜杠、匹配任意层级（`packages/app/dist` 已被忽略），但 ota/ 是新目录；
  - **这是 load-bearing 的**：step 4 的发布无关变更拦截（§1.1）对未跟踪文件同样生效，产物不进 ignore 清单 = 发布必失败。不放 dist/ 里是因为 `vp build` 会清空重建 outDir，覆盖发布 `-o` 需要本地持久留存产物（对齐 `-o` 模式 localApks 复用逻辑，release.mjs L330-364）。

### 2.3 manifest 内容（对齐 ota-ed25519-android.md §5 的「直接签 manifest」形态）

```json
{
  "version": "4.21.0",
  "minApkVersion": "4.21.0",
  "size": 1234567,
  "sha256": "<hex of web-bundle.zip>"
}
```

- 签名对象 = manifest 文件字节（发布哪个字节就签哪个字节）：`.sig = Ed25519("Pictelio-OTA-bundle-v1\n" || manifestBytes)`，64 字节 base64。manifest 本身作为 release asset 与 `.sig` 同传——App 端流程：取 manifest → 验签（公钥内置 BuildConfig，防 manifest 被篡改）→ 按 `sha256`/`size` 快检 zip 下载完整性 → 解压切换（详见 ota-ed25519 §5 与 switching 报告）。
- `minApkVersion` 字段进签名覆盖范围，发布端无法事后篡改兼容下限（见 §3.3）。

---

## 3. Q3：版本号方案与兼容性守卫

### 3.1 现状版本机制（一套状态贯穿全部产物）

`packages/app/scripts/sync-android-version.mjs`（39 行全文实读）+ release.mjs step 2：

- `package.json` 的 `version`（当前 4.21.0）是**唯一版本源**，step 2 一次写入五处：
  1. `packages/app/package.json`（L711）；
  2. `android/app/build.gradle`：`versionName = "x.y.z"`、`versionCode = major*10000 + minor*100 + patch`（sync-android-version.mjs L24-33；`parseVersion` 强制 minor/patch < 100 防进位冲突，release-utils.mjs L205-210）；
  3. fastlane `changelogs/<versionCode>.txt`（L713-715）；
  4. `packages/website/version.json`（L716-730，`{version, url, changelog}`——ADR-0089 update-check 契约，`@pictelio/update-check` 从 `raw.githubusercontent.com` 拉取，见 `packages/update-check/src/index.ts` L55）；
  5. git tag `v<version>`（L640）+ Release title。
- 此外 `APP_VERSION`（package.json version）经 vite define 内联进 web bundle（vite.config.ts L87）——**bundle 里已经带着构建时的版本号**。
- 自定义版本号防倒退已有守卫：`interactivePickVersion` 用 `isVersionAtLeast` 拒绝低于当前版本（L294-298，防 versionCode 倒退被 Android 拒装）；tag 重名预检（L646-658）。

### 3.2 提案：bundle 版本 = package.json 版本（同源同值），不做独立递增

**manifest.version 直接取 release 的 `newVersion`**，理由：

1. **零新增版本轴/状态**：release 流程已有 tag、versionCode、fastlane、version.json、APP_VERSION 五处同源消费，bundle 加入即第六处，不需要新的递增器或存储。
2. **比较器现成且 oracle 合规**：App 端「是否下载新 bundle」直接复用 `@pictelio/update-check` 的 `isNewer()`（三段数值比较、缺位补 0、v 前缀兼容，update-check/src/index.ts L31-49，已有单测覆盖的独立实现——满足仓库「期望值出处可追溯」约束，不是从被测实现反推）。
3. **单调性自然成立**：正常发布 bundle.version 随 package.json 递增；`isVersionAtLeast` 的防倒退守卫同样适用于 bundle（OTA 拒绝降级安装是 App 端一行判断）。
4. **与 APK versionName 的关系表述**：`bundle.version` 是「web 内容版本」，`宿主 APK versionName` 是「原生容器版本」；两者同源但语义独立，跨层约束**不靠版本号大小关系表达，而靠 manifest 的 `minApkVersion` 显式声明**（见 §3.3）——这比「bundle 版本必须 ≤ APK 版本」的大小关系约定更精确（bundle 4.21.1 完全可以装在 APK 4.21.0 上，只要它没调用新桥 API）。

**覆盖发布（-o）与 OTA 的冲突裁决（本方案最重要的边界条件）**：

- `-o` 硬约束是不 bump 版本号（checklist §七）→ 同版本号重传内容变了的 bundle → App 端 `isNewer()` 判「无更新」→ 热修静默失效。这不是实现 bug，是版本语义冲突。
- **裁决：OTA 热修禁止走 `-o`，必须走正常发布（bump patch，如 4.21.0 → 4.21.1）**。这与 checklist §七既有语义完全自洽（「覆盖发布不 bump 版本号……代码功能修复请走正常发布」——OTA bundle 本质就是代码功能修复）。`-o` 对 bundle 三件套仅限「重传同内容」（上传中断补传、asset 损坏替换），重跑 `release-bundle.mjs` 用同一输入产物保证字节一致。
- 将来若确需「同版本号热修」，演进路径是 manifest 增加独立 `build` 计数（比较键变 `(version, build)`）——v1 明确不做（第二版本轴的存储/比较/回滚复杂度不划算，且 `-o` 语义会变得可争议）。

### 3.3 兼容性约束「bundle 不得调用比宿主 APK 新的原生桥 API」的现状与守卫

**现状实读：原生桥没有任何版本号/能力协商机制。**

- 接口面 = `MainActivity.java`（`android/app/src/full/java/io/pictelio/app/MainActivity.java` L114-118）注册的 5 个自定义插件：`ImageCachePlugin` / `AuthPlugin` / `OAuthPlugin` / `PixivApiPlugin` / `ClientInfoPlugin`（ADR-0062）+ Capacitor 内置插件（App/Preferences/SecureStorage 等）。
- TS 侧声明（`src/native/*.ts`）：`PixivApi.ts` 4 方法 + 1 事件（L3-25）、`ClientInfo.ts` 2 方法（L11-17）、`AuthPlugin`/`OAuthPlugin`/`ImageCache`/`splashBridge` 各自接口——**全部是无版本的静态类型声明，无 `bridgeApiVersion`、无能力位图**。
- 故障形态（决定了守卫强度要求）：Capacitor `registerPlugin` 对未实现方法只是 promise reject（"not implemented"），**不崩溃**——即 bundle 调了新 API 的后果是功能拒绝而非白屏。按仓库「禁止静默降级」约束，reject 必须显式暴露，但流程上更应事前拦截。

**三层守卫（发布端 → 消费端 → CI，逐层兜底）**：

| 层 | 机制 | 落点 |
| --- | --- | --- |
| 1. 发布端（约定 + 字段） | manifest 携带 `minApkVersion`（该 bundle 要求的最低宿主 APK versionName）；新增桥 API 时发布者提升它。`release-bundle.mjs` 打包时断言 `minApkVersion ≤ 本次 package.json version`（同仓同 commit 构建，bundle 的代码与宿主 APK 同源，天然满足；断言防手填错） | manifest 字段 + 打包脚本校验；字段被签名覆盖，不可事后篡改 |
| 2. 消费端（运行时守卫） | App 端 OTA 检查**先验** `manifest.minApkVersion ≤ 本机版本`（原生侧 `BuildConfig.VERSION_NAME`/PackageManager；JS 侧 `APP_VERSION` define 已内联）再进入下载/验签，不满足则跳过该 bundle 并显式上报；capgo 的 `resetWhenUpdate`（APK 升级自动清全部 OTA 回内置 bundle，switching 报告 §A.2 实读）天然兜底跨 APK 漂移 | App 端 OTA 流程（switching 报告已选 capgo 手动模式）|
| 3. CI/测试端（契约测试） | 从 Java 插件源码提取方法名清单（`@PluginMethod` 注解常量，backupRulesConsistency 从源码提取常量比对模式）与 `src/native/*.ts` 的声明做一致性比对——防「TS 声明了/改名了但 Java 未实现」与「bundle 依赖了幽灵 API」；进现有 vitest（ci.yml test job），无需新 workflow | `tests/unit/native/` 契约测试 |

**v1 不给桥 API 引入版本号**（评估结论）：接口面小（5 插件约 10 个方法 + 2 个事件）、增量完全可枚举，`minApkVersion` + 契约测试已覆盖；桥版本号是 OTA 体系成熟后的增强项，manifest 天生可扩展（ota-ed25519 §5 已论证），届时加 `bridgeApiVersion` 字段即可，签名方案无需变更。配套的 checklist 约定（见 §6）：**新增桥方法必须同步更新 `src/native/*.ts` 声明 + 契约测试 + 评估是否提升 `minApkVersion`**；bundle 内对新桥能力做能力检测（既有先例：`ClientInfo.getClientKinds()` 决定是否渲染切换引擎入口）。

---

## 4. Q4：签名放 CI 还是本地

### 4.1 CI 现状实读：无签名、无发布

- `.github/workflows/ci.yml` 仅 2 个 job：`check`（`pnpm check:all` + `pnpm lint:all`，L17-40）与 `test`（`pnpm test:all`，L42-62）；`permissions: contents: read`（L9-10）——**没有任何构建/signing/release 步骤**。
- `.github/workflows/deploy.yml` 只做 website 的 Astro 构建 + GitHub Pages 部署（含 `version.json` 拷贝），与 APK/bundle 产物无关。
- 现有信任模型：**全部签名材料只在发布者本地**——release-checklist §三明确「正式发布前仍需本地用真实 keystore 执行 `build:android:release:all`」；`release-signing.md` §4 的 `PICTELIO_KEYSTORE_PASSWORD` 是本地 shell 环境变量，其「CI / GitHub Actions Secrets」一节是前瞻性说明，实际 CI 从未使用。另外 release.mjs 强制 TTY（L88-91），本就无法在 CI 里跑。

### 4.2 裁决：Ed25519 签名只放本地（release.mjs step 3 内），CI 只做验证类工作

1. **签名步骤 = 本地**，与 APK 签名同一信任模型：私钥 `~/.pictelio-keys/ota-ed25519-private.pem`（ota-ed25519-android.md §4.2 已定：仓库外 + `.gitignore` 兜底 + 双介质备份 + 与 release keystore 严格分离），签名随 `release-bundle.mjs` 在 step 3 执行，零 CI 依赖。CI 永不接触私钥，也就不存在 Secret 泄漏面。
2. **`PICTELIO_KEYSTORE_PASSWORD` 环境变量模式对 Ed25519 私钥不适用也不必要**：keystore 密码保护的是「加密容器」，而 Node `export({format:"pem", type:"pkcs8"})` 产出的 Ed25519 PEM 本身不加密——**密钥文件即秘密**，保护手段是文件权限 + 仓库外存储 + 备份，不是口令注入。可复用的是**命名惯例**：将来确需 CI 相关密钥时走 `PICTELIO_OTA_SIGNING_*` 前缀（对齐现有 `PICTELIO_*` 风格）。
3. **CI 该做的（全部无密钥，进现有 workflow）**：
   - **签名/manifest 脚本单测**（test job）：RFC 8032 §7.1 / Wycheproof Ed25519 官方向量做 oracle（满足仓库 oracle 溯源约束），加篡改拒绝、manifest schema/字段完整性、`minApkVersion ≤ version` 断言的正反用例——密钥用测试内临时生成的 keypair 做性质测试（可验 + 篡改必拒），官方向量防实现漂移。
   - **桥接口一致性契约测试**（test job，§3.3 第 3 层）。
   - **（可选）构建 smoke**：CI 跑 `pnpm build` + 校验 `dist/index.html` 存在与 zip 结构（index.html 在 zip 根、无 BASE_PATH 残留）——不需要任何密钥，可作为将来独立 job。
4. **为什么不建议 v1 做 CI 签名**（即便技术上可行——GitHub Secrets 注入 PKCS8 base64）：与 ota-ed25519-android.md §4.2 的既定决策（私钥只本地）冲突，且 CI 签名意味着私钥进入 GitHub 运行时环境（fork/PR 触发面、日志脱敏面、Secrets 权限面都要重新审计），而现有流程的信任锚本来就在发布者本机——CI 签名带不来一致性收益（release 流程整体都在本地）。

---

## 5. 结论速查（对 issue #244 Question 的逐点回答）

| 问题 | 回答 |
| --- | --- |
| 插入点 | 打包 + 签名 = `release.mjs` step 3 `buildReleaseApks().buildSteps` 追加 `release-bundle.mjs`（正常发布与 `-o` 重建两条路径自动共用，失败落在 P4 自动回滚窗口内）；上传 = step 6 `uploadReleaseAssets({ paths })` 追加三件套（上传器对资产类型零耦合，重试/面板/失败指引白拿） |
| 上传方式 | 复用现状两段式：`gh release create`（REST 建 Release + notes）→ Node 原生上传器直连 `uploads.github.com` PUT（token 从 gh keyring，单包 3 次重试，basename 互异契约满足）；无需任何新上传代码 |
| zip 内容 | `dist/` 全部、zip 根 = `index.html`（对齐 `versions/<id>/index.html` 布局）；无排除项（无 sourcemap、凭证已内联与 APK assets 同安全面）；防呆：base 必须 "/"（脚本内断言）；产物落 `packages/app/ota/`（**必须新增 .gitignore 条目**，否则 step 4 发布无关变更拦截必炸）；命名 `pictelio-<version>-web-bundle.zip` 等 |
| 版本方案 | `manifest.version` = `package.json` version（与 APK versionName / tag / versionCode / version.json / APP_VERSION 同源，零新增版本轴）；App 端比较复用 update-check `isNewer()`；**OTA 热修禁止走 `-o`（-o 不 bump 版本号 → isNewer 判无更新），必须正常发布 bump patch；将来热修需求走 manifest 加 build 计数（v1 不做）** |
| 兼容守卫 | 现状：原生桥无版本号（5 插件 + Capacitor 内置，TS 静态声明，调用未实现方法仅 promise reject）。守卫三层：manifest `minApkVersion`（进签名覆盖，打包时断言 ≤ 本次版本）→ App 端下载前校验本机版本 + capgo `resetWhenUpdate` 兜底 → CI 桥接口一致性契约测试（Java 方法名 ↔ TS 声明，进现有 vitest）。v1 不引入桥 API 版本号（manifest 预留 `bridgeApiVersion` 扩展位） |
| 签名位置 | **只放本地**（release.mjs step 3，`node:crypto`，私钥 `~/.pictelio-keys/`）；与 APK 签名同一信任模型且 release 流程本身强制 TTY 无法进 CI；keystore 密码环境变量模式不复用（PEM 不加密，文件即秘密），仅复用 `PICTELIO_OTA_*` 命名惯例；CI 只做验证类工作（Ed25519 官方向量单测、桥契约测试、可选 zip 结构 smoke），现有 ci.yml 无需新增 job |

---

## 6. 对 `docs/release-checklist.md` 的整合建议（对齐 issue 要求的「产出整合方案」）

新增一节「web bundle OTA 产物」（发布流水线变更清单）：

1. **流水线**：step 1 环境检查追加 OTA 私钥探测（`~/.pictelio-keys/ota-ed25519-private.pem`）——缺失默认 **fail**（三件套缺失 = 该版本 OTA 通道断裂，静默降级违反仓库约束）；提供 `PICTELIO_RELEASE_SKIP_OTA=1` 显式跳过开关（打 warn）。step 3 `buildSteps` 追加打包签名步；step 6 上传三件套；catch 恢复指引追加 bundle 资产的 `gh release upload --clobber` 命令。
2. **产物定义**：`packages/app/ota/` 下 `pictelio-<version>-web-bundle.zip` + `pictelio-<version>-manifest.json` + `pictelio-<version>-manifest.json.sig`；`.gitignore` 新增 `packages/app/ota/`。
3. **-o 覆盖发布语义**：范围选择的「资产」纳入三件套，但仅限同内容重传；OTA 功能热修必须走正常版本发布（与 §七既有硬约束同款表述）。
4. **发布前自检项**：`release-bundle.mjs` 本地 round-trip 验签（对 manifest/.sig/zip 三件套）+ 公钥指纹与 `docs/research/ota-ed25519-android.md` §4.2 记录值肉眼比对（对齐现有 `apksigner verify` 的验证环节）。
5. **桥 API 演进约定**：新增原生桥方法 → 同步 `src/native/*.ts` 声明 + 契约测试 + 评估提升 `minApkVersion`；bundle 内新桥能力一律能力检测（先例 `ClientInfo.getClientKinds()`）。

---

## 7. 来源（本仓第一手，均为 2026-08-29 实读）

- `packages/app/scripts/release.mjs`（6 步编排 L674-883；buildSteps L511-573；releaseFilesFor 白名单 L56-62 与 step 4 拦截 L740-762；tag 预检 L646-658；版本交互 L271-307；catch 恢复 L898-1001；TTY 强制 L88-91）
- `packages/app/scripts/lib/release-utils.mjs`（`DEFAULT_VARIANTS` L20、`apkPathsFor` L23-25、`parseVersion` 防进位 L200-212、`isVersionAtLeast` L215-222、`getRepoSlug` L190-198）
- `packages/app/scripts/lib/release-uploader.mjs`（上传契约头注释 L1-12、重试退避 L14-16）与 `lib/upload-release-assets.mjs`（`gh auth token` L26-41、uploads.github.com URL L64、Bearer L133-134）
- `packages/app/scripts/release-overwrite.mjs`（deep module 头注释与 `probeRemote` L27-60）；`docs/release-checklist.md` §七（-o 硬约束）与上传网络说明
- `packages/app/scripts/sync-android-version.mjs`（全文 L1-40，versionCode 公式 L24）
- `packages/app/package.json`（version 4.21.0 L3；`build` L9；`release` L32；`build:android:release:all` L31）
- `packages/app/vite.config.ts`（base L56-58、define APP_VERSION/__CREDENTIALS__ L87-88、build 段 L243-274）；`packages/app/capacitor.config.ts`（webDir L11、appId L9）；本机 `packages/app/dist/` 结构实测（assets hash 文件名、0 个 .map、public 拷贝物）
- `packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java`（插件注册 L114-118；WebView 版本检查先例 L238-282）；`packages/app/src/native/PixivApi.ts`（接口 L3-25）、`ClientInfo.ts`（L11-17）
- `.github/workflows/ci.yml`（2 job 全文）、`deploy.yml`（website 部署全文）；`.gitignore`（L3 `dist/` 无锚定匹配任意层级、L32 keystore）
- `packages/website/version.json`（当前 4.21.0 实文件）；`packages/update-check/src/index.ts`（契约注释 L5-7、`isNewer` L31-49、UPDATE_URL L55）
- 前置研究：`docs/research/ota-ed25519-android.md`（§4.2 私钥流程、§5 签 manifest 形态）、`docs/research/ota-switching-mechanism.md`（§A.2 `versions/<id>/index.html` + `resetWhenUpdate`、§A.4 no-cache）
- 先例脚本：`packages/app-lynx/scripts/sync-android-assets.mjs`（产物同步 + 大小校验 + fail-fast 风格）
