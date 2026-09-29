# Pictelio 公共版本发布前检查清单

> 本文件由 Task 15「最终集成与发布」生成，记录 Tasks 1-15 完成情况、验证结果以及正式发布前仍需处理的占位符与检查项。

---

## 一、Tasks 1-15 完成摘要

| 任务    | 内容                    | 关键产出                                                                                   |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| Task 1  | 重命名应用身份          | 应用名/包名改为 Pictelio (`io.pictelio.app`)，`APP_VERSION` 从 `package.json` 注入         |
| Task 2  | 重新生成应用图标        | 生成 Pictelio 品牌图标与启动图，覆盖 `assets/`、`public/`、`android/app/src/main/res/`     |
| Task 3  | 移除用户名/密码登录     | 仅保留 refresh_token 登录方式，移除密码输入与相关 API                                      |
| Task 4  | 加密本地 token 存储     | 使用 `capacitor-secure-storage-plugin` 将 refresh_token 存入 Android Keystore              |
| Task 5  | 年龄门与默认过滤改造    | 默认过滤 R-18/R-18G，首次展示敏感内容前弹出年龄确认                                        |
| Task 6  | 举报与屏蔽功能          | 新增 `ReportSheet`、`BlockSheet` 与对应 store，支持举报/屏蔽用户或作品                     |
| Task 7  | 免责声明与 About 页更新 | `About.tsx` 加入第三方免责声明，说明与 Pixiv 无关联                                        |
| Task 8  | 隐私政策页面            | 新增 `docs/privacy-policy.md`、`website/privacy-policy.html`、`public/privacy-policy.html` |
| Task 9  | 账号删除入口            | 设置中提供「清除所有本地数据」入口                                                         |
| Task 10 | Release 构建与签名配置  | 配置 Gradle release 签名、`android/app/pictelio-release.keystore` 占位                     |
| Task 11 | 本地 release 构建测试   | 验证签名 APK 构建流程                                                                      |
| Task 12 | F-Droid Fastlane 元数据 | 创建 `fastlane/metadata/android/` 多语言描述、图标、截图与功能图占位                       |
| Task 13 | GitHub Release 脚本     | `scripts/release.mjs` 一键构建签名 APK 并发布到 GitHub Releases                             |
| Task 14 | 官网落地页              | 创建 `website/index.html`、`website/privacy-policy.html` 等品牌官网                        |
| Task 15 | 最终集成与发布          | 替换 GitHub 仓库占位符、同步隐私政策、全量验证、Android 构建冒烟测试                       |

---

## 二、占位符替换情况

- ✅ `YOUR_USERNAME/pictelio` → `a1121611810/pixivizer`（已替换于 `website/index.html`）
- ✅ `YOUR_NAME` → `a1121611810`（已替换于 `website/index.html` 版权信息）
- ✅ `YOUR_PRIVACY_EMAIL@example.com` → `a1121611810@outlook.com`（已替换于隐私政策文件）
- ✅ `YOUR_REPORT_EMAIL@example.com` → `a1121611810@outlook.com`（已替换于 `ReportSheet.tsx` 与隐私政策文件）
- ✅ `public/privacy-policy.html` 已与 `website/privacy-policy.html` 保持同步

---

## 三、预发布检查清单

- [x] 替换 `YOUR_PRIVACY_EMAIL@example.com` 为真实隐私联系邮箱
- [x] 替换 `YOUR_REPORT_EMAIL@example.com` 为真实举报联系邮箱
- [x] 创建真实 release keystore 于 `android/app/pictelio-release.keystore`
- [x] 设置环境变量 `PICTELIO_KEYSTORE_PASSWORD` 与 `PICTELIO_KEY_PASSWORD`（已验证 release 构建成功）
- [x] 验证 `pnpm release:github --repo=a1121611810/pixivizer` 可正常工作（已发布 https://github.com/a1121611810/pixivizer/releases/tag/v1.0.0）
- [x] 向 `fastlane/metadata/android/en-US/images/phoneScreenshots/` 添加真实截图
- [x] 向 `fastlane/metadata/android/en-US/images/featureGraphic.png` 添加真实功能图
- [ ] 提交 F-Droid 收录申请（参考 `docs/superpowers/plans/2026-06-27-pictelio-public-release.md` 中的 metadata 模板）

---

## 四、Task 15 验证结果

| 验证项             | 命令                                                | 结果                                                         |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| 格式化             | `pnpm fmt`                                          | ✅ 通过（134 文件，863 ms）                                  |
| 类型检查与代码检查 | `pnpm check`                                        | ✅ 通过（格式化 + lint 均无问题）                            |
| 单元测试           | `pnpm test -- --run`                                | ✅ 通过（6 个测试文件，48 个测试）                           |
| 生产构建           | `pnpm build`                                        | ✅ 成功生成 `dist/`                                          |
| Android Debug 构建 | `cd android && ./gradlew assembleDebug --no-daemon` | ✅ `BUILD SUCCESSFUL`（213 个任务，27 执行，186 up-to-date） |

> 注：Android Debug 构建仅作冒烟测试；正式发布前仍需使用真实 keystore 执行 `pnpm build:android:release` 生成**单个**签名 APK。
>
> 注（单引擎）：`build:android:release` 已内置 Lynx bundle 构建与同步（`pnpm --dir ../app-lynx run build` → `node ../app-lynx/scripts/sync-android-assets.mjs`）。若 APK 缺 `main.lynx.bundle`，LynxActivity 将加载失败（历史白屏问题，见 #51）；构建完成后可检查 `packages/app/android/app/src/main/assets/main.lynx.bundle` 是否存在。
>
> ⚠️ **2026-09-28 单引擎化后变更**（[c6ade216](https://github.com/a1121611810/Pictelio/pull/810)）：`full` / `webview` flavor 与 WebView / Capacitor 构建链已整体删除。
> - `pnpm build:android:release:all`（三 APK）与 `pnpm cap:sync` **已不存在**，照抄会 command not found。
> - 一个版本只产**一个** APK，无「选哪个包发布」这一步。

---

## 五、Git 信息

- **分支**：`main`
- **当前 commit**：`cc54e24`
- **commit message**：`assets(fastlane): improve Playwright screenshots with API mocking and settings scroll`
- **GitHub Release**：https://github.com/a1121611810/pixivizer/releases/tag/v1.0.0
- **已上传 APK**：`app-release.apk`（版本 1.0.0，versionCode 10000）

---

## 六、后续行动

GitHub Release 已发布完成。

## 七、覆盖发布（`pnpm run release -o`）

**场景**：已发布的版本（如 v4.2.4）漏发资产或文案有误，需要修正 GitHub Release 页面，而非发布新版本。

- **命令**：`pnpm run release -o`（别名 `--overwrite`）；加 `--dry-run` 仅打印将执行的 gh 命令、不实际调用。
- **交互流程**：
  1. 选择覆盖范围：`1` 仅文案 / `2` 仅资产 / `3` 全部（默认）。
  2. 本地已存在全部变体 APK 时询问「复用本地 APK 还是重新构建」；存在缺失变体则自动重新构建。
  3. 文案默认读取 `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`，可确认（Y）或重新粘贴（e）；缺失时交互粘贴。
  4. 展示覆盖计划（覆盖/新增资产清单 + 警告）→ 输入 `Y` 后再输入 tag 名（如 `v4.2.4`）双重确认。
  5. 执行：下载备份旧资产 → `gh release edit` 更新文案 → **逐包上传**（每个变体 APK 独立 `gh release upload --clobber` 子进程，并发数 = 变体数，单包最多 3 次重试、失败隔离）；上传面板逐行显示每包状态（变体/大小/耗时/重试次数/完成后平均速率），非 TTY 降级为事件流。上传失败只从备份恢复**失败资产**（新增资产无备份则跳过，可重跑补传）。
- **硬约束**：
  - 覆盖发布**不 bump 版本号**（versionCode 不变）：已安装该版本的用户**无法通过系统覆盖安装**获得新 APK。代码功能修复请走正常发布（如 4.2.4 → 4.2.5）。
  - 目标必须为**已存在且已发布**（非 draft）的 Release；`package.json` 版本与远端 tag 不一致时拒绝执行。
  - 不移动 tag、不创建新 commit、不 force push；操作范围严格限定于 GitHub Release 页面。
  - 正常发布与覆盖发布共用同一逐包上传编排（ADR-0065/ADR-0067）；上传默认走 **Node 原生上传器**（直连，实测端到端吞吐约为 gh 的 2.1×），重跑只补失败包（`--clobber` 幂等）。可用环境变量 `PICTELIO_UPLOADER=gh` 回退到 gh 子进程。
- **验证**：正式覆盖前先跑 `pnpm run release -o --dry-run` 预览计划与命令，确认无误后再实际执行。

## 八、web bundle OTA 产物（#250）

正常发布（`pnpm run release`）会在构建 APK 的同时产出 web bundle OTA 三件套并与 APK 上传到同一个 GitHub Release；web 修复也可以不经 APK 重装、由 app 静默 OTA 吸收（机制见 `docs/specs/ota-web-bundle.md`）。

### 产物定义

三件套落在 `packages/app/ota/`（已加入根 `.gitignore`——release step 4 的「发布无关变更拦截」对未跟踪文件同样生效，不 ignore 则发布必炸）：

| 文件 | 内容 |
| --- | --- |
| `pictelio-<version>-web-bundle.zip` | `dist/` 全量打包，zip 根直接是 `index.html`（对齐原生侧 `versions/<id>/index.html` 布局） |
| `pictelio-<version>-manifest.json` | `{ version, minApkVersion?, size, sha256 }`（sha256 = zip 摘要；`minApkVersion` 缺省 = 不设兼容下限，App 端 fail-open） |
| `pictelio-<version>-manifest.json.sig` | manifest 字节的 Ed25519 签名（base64）：`PureEdDSA(DOMAIN_PREFIX || SHA-256(manifest))`，域分隔前缀 `Pictelio-OTA-bundle-v1\n` 与 Android 侧 `OtaSignatureVerifier` 逐字一致 |

发布脚本挂载点：step 1 探测 OTA 私钥 → step 2 `version.json` 追加 `minWebVersion` / `webBundle` 字段 → step 3 打包签名 → step 6 随 APK 上传；step 6 失败的恢复指引已包含三件套的 `gh release upload --clobber` 命令。

### 发布前 round-trip 验签自检

`release-bundle.mjs` 在打包流程内已完成 round-trip 自验（打包 → 签名 → Node 验签 → 落盘），独立运行即可复验既有三件套，无需走完整 release：

```bash
node scripts/release-bundle.mjs --version=<version>   # dist 默认 dist/，产物默认 ota/
```

另比对公钥指纹：`~/.pictelio-keys/ota-ed25519-private.pem` 对应公钥的 SHA-256(raw 32B) 指纹须与 `docs/research/ota-ed25519-android.md` §4.2 记录值一致（生成命令同节）。私钥缺失时 step 1 直接 fail；OTA 签名密钥与 APK release keystore 严格分离（不共钥、不共密码、不共备份介质）。

### 桥 API 演进约定

新增原生桥方法（`MainActivity` 注册的自定义插件）时必须同步三件事：

1. 同步 `src/native/*.ts` 的 TS 声明；
2. 补/改桥接口一致性契约测试（Java 插件方法名 ↔ TS 声明比对）；
3. **评估是否提升 `minApkVersion`**：若 bundle 会调用新桥方法，旧 APK 宿主上将得到 promise reject（不崩溃但功能缺失）——此时设 `PICTELIO_OTA_MIN_APK=x.y.z` 再发布，让 manifest 声明最低宿主版本（进签名覆盖范围，不可事后篡改）。bundle 内对新桥能力一律先能力检测（先例：`ClientInfo.getClientKinds()`）。

### 跳过与门槛语义

- `PICTELIO_RELEASE_SKIP_OTA=1`：显式跳过三件套的打包与上传（step 1 打 warn）。缺省（不设）时私钥缺失直接 fail——三件套缺失 = 该版本 OTA 通道断裂，禁止静默降级。
- `minWebVersion`（version.json 字段，web 层最低可用版本/floor）：release 默认**继承旧值**（覆写前读旧文件）；仅当要主动抬门槛时用 `--min-web=x.y.z` 覆写。旧文件缺失/解析失败只 warn 不阻断（不设门槛）。紧急提门槛也允许手改 version.json 单独 commit。
- 覆盖发布（`-o`）不 bump 版本号 → App 端 `isNewer()` 判「无更新」→ 热修静默失效，**OTA 热修禁止走 `-o`**，必须走正常发布（或 web-only 模式）bump patch；`-o` 对三件套仅限同内容重传（重跑 `release-bundle.mjs` 同输入产物字节一致）。

### 发布文案的模型总结（可选步骤，ADR-0166）

文案选定之后、选版本号之前，脚本会问一句「是否让模型总结这份文案?」——答是则把素材交给配置好的 OpenAI 兼容服务改写成用户视角文案（`-i` 与 `-c` 共用；`-o` 不做）。四个键填在 `packages/app/.env`（该文件不进 git），**缺任一即为未配置**：跳过该步骤并打一行 warn。

| 键 | 说明 |
| --- | --- |
| `PICTELIO_AI_BASE_URL` | 服务 base URL，脚本追加 `/chat/completions`（chat）或 `/responses`（responses） |
| `PICTELIO_AI_API_KEY` | 服务方 API key |
| `PICTELIO_AI_MODEL` | 模型名；**带思考的推理模型单次可能 >100s**，建议先用快档（实测 `deepseek-flash` 13s、`deepseek-v4-pro` 103s） |
| `PICTELIO_AI_PROTOCOL` | `chat` 或 `responses`（显式填，不自动探测） |

- 成稿整篇打印后由人拍板：`Y`/回车 用成稿，`n` 回退原文案，`e` 重新总结（`e` 始终以**原始文案**为输入重跑）。成稿替换同一条 changelog，四处落点（commit body / fastlane / Release notes / version.json）同文。
- 调用失败一律可见：打 warn 说明成因（网络 / 401 / 402 / 404 / 429 / 5xx / 非 JSON / 空输出），再问「改用原文案继续?」——答 `n` 中止发布。最多 2 次尝试；429 / 5xx / 网络错误 / 非 JSON / 空输出重试一次，**4xx 与超时不重试**（超时默认 240s）。
- 该步骤在 step 1（签名环境检查）之前：若 keystore 密码或 OTA 私钥未就绪，会先花一次模型调用再在 step 1 失败。
- 已知后果：成稿带 Markdown 标记（`#` / `##` / `-` / `**`）流入 `version.json` 的 `changelog` 字段，而应用内更新弹窗与 Lynx 更新页按纯文本渲染，会**原样显示**这些标记（既有现状，5.1.0 起如此）。

### web-only 发布模式（`--web-only`，#255）

**何时用**：只改 web 层（UI/逻辑/内容适配）的热修——不构建 APK、不需要 keystore 密码，分钟级完成一次 OTA 发布；已装用户的 app 静默吸收（下次启动生效），无需重装 APK。含原生变更（Java/Kotlin、Capacitor 插件、桥方法、Lynx bundle）的发布一律走正常发布。

- **命令**：`pnpm run release --web-only`（交互流程与正常发布一致：选 commit → 选版本 → 确认发布；版本建议 bump patch，符合热修语义）。
- **流程差异**（相对正常发布）：step 1 只查 OTA 私钥（跳过 keystore 密码/文件检查）；step 3 只跑 credentials 同步 + web 构建 + `release-bundle.mjs`（跳过 gradle assemble / Lynx / cap:sync）；step 4/5 照常 commit + tag + push；step 6 `gh release create --prerelease`（GitHub "Latest" 徽章仍指向最后完整 APK 版本），**只上传三件套不传 APK**。
- **双坐标行为**：`version.json` 的 `version` 字段（APK 坐标，APK 弹窗比较对象）**保持上一已发布 APK 版本不动**（从旧 version.json 继承；旧文件缺失/解析失败 = 硬错误，禁止静默降级）；`webBundle.version`（bundle 坐标）前进到本次版本；`url` 仍指向本次新 tag 的 Release 页。`minWebVersion` 同正常发布（`--min-web=x.y.z` 覆写 / 缺省继承旧值）。下次正常发布时一次 commit 原子翻转全部坐标。
- **与 `-o` 的边界**：`--web-only` 与 `-o` 互斥（脚本拒绝）——OTA 热修一律走 web-only bump patch；`PICTELIO_RELEASE_SKIP_OTA=1` 与 `--web-only` 也互斥（web-only 的唯一交付物就是三件套，跳过打包 = version.json 指向不存在的资产）。
- **中途失败**：与正常发布共用自动回滚（step 2/3 失败回滚 package.json / build.gradle / changelog / version.json），可安全重跑。

## 非 main 分支发布（`PICTELIO_RELEASE_BRANCH`，#816）

**何时用**：从过渡分支/长期特性分支发版（首个用例：6.2.0 过渡版从 `release/transition-6.2.0` 发 tag——tag 必须指向该分支的 commit）。

- **命令**：`PICTELIO_RELEASE_BRANCH=release/transition-6.2.0 pnpm run release`（交互流程与其余步骤完全不变）。
- **三处一并切换**：分支校验、远端分叉预检（`origin/<branch>`）、step 5 `git push origin <branch> --tags`。**必须一起切**——只放开 push 而预检仍比对 main，就会产生 P2 注释要防的故障：tag 指向一个远端不存在的 commit。
- **安全约束**：不设变量时行为与从前逐字相同（恒为 `main`）；设了变量**仍强制**人必须处在该分支上（不会出现「人在 A 分支、发到 B 分支」）；非 main 时在分支校验处与发布确认页各打一条 ⚠ 告警，确认页会显式列出「目标分支」。
- **不适用**：`pnpm release -o` 覆盖发布不动 tag/commit，无需此开关。
- 单测：`tests/unit/scripts/release-branch.test.ts`（开关解析/校验/告警）+ `release-preflight.test.ts`（非 main 分支的真 git 拓扑，含「指定分支分叉但 main 干净」的阳性/阴性对照，证明参数确实换了被检引用）。

## 上传网络说明（2026-08 研究结论，详见 `docs/research/github-release-upload-acceleration.md` 与 ADR-0067）

- `uploads.github.com` 慢的根因是**国际链路**（CNAME 到新加坡 Azure 20.205.243.161），与客户端选型无关；发布脚本会在上传前打印「本次将走直连/代理」。
- Node 原生上传器默认**直连**（实测直连更快且无 api.github.com 走代理的间歇 403 风险）。
- 若发布机 shell 配置了 `HTTPS_PROXY` 且需 gh 回退模式直连，固化 `NO_PROXY=api.github.com,uploads.github.com`（**不要写 `github.com`**，否则 uploads 也被带成直连——除非确实想全直连）。
- 任何方案都建议发布前用一次小文件实测直连/代理吞吐（时段波动可达 5 倍，ADR-0065 实测 38–190KB/s）。

## 官网部署

- ✅ `website/` 已推送到 `origin/gh-pages` 分支
- ⏳ 需要你在 GitHub 仓库设置中启用 GitHub Pages：
  1. 打开 https://github.com/a1121611810/pixivizer/settings/pages
  2. Source 选择 **Deploy from a branch**
  3. Branch 选择 `gh-pages`，文件夹选 `/ (root)`
  4. 点击 Save
- 启用后官网地址：https://a1121611810.github.io/pixivizer

## 发版前 QA 防线（#547 / ADR-0163）

除既有构建/签名/上传步骤外，每次发版前必须完成以下各项：

1. ⚠️ **原「双引擎转换清单」前提已消失，待重新定义**（单引擎化后无法执行）：`docs/agents/qa-transition-checklist.md` 的 R1-R4 全部以 webview 引擎存在为前提（其前置条件原文写「full 包即可」），现无 webview 可切换 ⇒ **该清单不可执行**。替代 gate 待 [#805](https://github.com/a1121611810/Pictelio/issues/805) 重新定义。⚠️ **在重新定义前本项视为未设防，不得当作「已过」**。重新定义时须注意：R1-R4 每行都源自一个真实缺陷回归，**逐行判定「该缺陷在单引擎下是否仍可能复现」，不可整份丢弃**。
2. **pre-release 分阶段发布**：GitHub Releases 先以 pre-release 标记发布（beta 通道），挂 ≥3 天收集真机反馈后再转 stable（`gh release edit <tag> --prerelease=false`，或在 Release 页面取消 pre-release 勾选）。本项目不经 Play 分发，pre-release 标记即分阶段发布（ADR-0163「发布侧适配」）。
3. **发布中发现缺陷先登记再修**：转换矩阵覆盖范围内的任何缺陷，先在 `docs/agents/qa-transition-checklist.md` 登记（标记回归行或新增矩阵行），再进入修复流程，确保修复自带回归防线。
4. ⚠️ **原「引擎降级取证（ADR-0164）」已失效**（单引擎化后无法执行）：`specs/engine-fallback-matrix.spec.ts` 的 M1–M3' 四格取证全部测「Lynx 不可用 → 降级到 WebView」，现无 WebView 可降 ⇒ **四格均不再适用**。其中的取证键消除断言（`unzip -p <apk> 'classes*.dex' | grep -c pictelio_debug_force_lynx_unavailable` 必须为 0）**已成假绿**——该键已随引擎机制从生产代码删除，全仓仅剩 app-lynx 的测试里一处字符串残留（`packages/app-lynx/src/stores/settingsStore.test.ts` 的备份键名单），**恒为 0 恒过，不再具备「发布包含测试后门」的检出能力**。替代 gate 待 [#805](https://github.com/a1121611810/Pictelio/issues/805) 重新定义；在其之前本项**不得计为已过**。
5. **发版门真的跑了吗（#819 第 7 项）**：`transition-matrix.spec.ts` 带 `describe.skipIf` + `@release-gate` 标注，而 vitest 的 `suite.mode === "skip"` 分支**不含 `afterAll`** ⇒ 门整个消失时**不判红、不 warn、没有任何门结论**。跑完 android-e2e 后必须核对 `Tests … | N skipped` 的 **skipped 计数**。合法 skip 的来源是确定的、可枚举的：`fab-hit-testing-regression` / `lynx-bookmark-tags` / `transition-matrix` / `lynx-detail-image-probe` 四个 spec 都带 `describe.skipIf(SKIPPED)`、其 `SKIPPED = TARGET_AVD !== "pictelio_ui"`（**非** pictelio_ui 即各整批 skip；源码写的是 `SKIPPED` 而非展开式，按展开式 grep 会 0 命中），`webdav-backup-lynx` 带 `describe.skipIf(!ENABLED)`。枚举命令：`grep -nE "^\s*describe\.skipIf" tests/android-e2e/specs/*.spec.ts`（应恰好 **5** 行）。⚠️ **必须带行首锚点**：不带锚点会连注释里提到 `describe.skipIf` 的说明行一起命中（实测 7 行 vs 5 行）。该形态已有机器防线：`tests/android-e2e/unit/specSkipGuard.test.ts` 扫描全部 spec，禁止 `it` 体内 `if (SKIPPED) return`，并交叉核对「声明了 `SKIPPED` 常量 ⇒ 必须有 `describe.skipIf`」。
   ⚠️ **该 grep 只认「用 `describe.skipIf` 实现跳过」的 spec**——在 `it` 体内写 `if (SKIPPED) return;` 的 spec **grep 不到，且跳过时 vitest 记 passed、对 skipped 计数贡献 0**，即「冒充通过」而核对项对它结构性失明。`lynx-detail-image-probe` 原先就是这个形态（#819 收口时改成 `describe.skipIf`）。**新增带设备门控的 spec 时必须用 `describe.skipIf`**，别在用例体内 `return`；自查用 `grep -rnE "^\s*if \(SKIPPED\) return" tests/android-e2e/specs/*.spec.ts`，命中的行应只在文件级 `beforeAll` / `afterAll` 里（实测当前恰 2 行）。⚠️ **必须带行首锚点**：不带锚点会连注释里提到这句的说明行一起命中（实测 4 行 vs 2 行）——抽取范围要由结构界定，不能由词面命中界定。
   ⚠️ 全仓共 **4 处动态 `t.skip()`**（逐条枚举：`grep -rnE "^\s*t\.skip\(" tests/android-e2e/specs/*.spec.ts`），它们同样进 `Tests … | N skipped` 计数 ⇒ **skipped 计数不是一个固定数字**：
   · `transition-matrix` **3 处**（R1 断言③ 1 + R3 收藏行 2，内容形态不利时**合法**出现）——其中 R3 两处**互斥**（`undetected.length > 0` 那支先抛 `PendingError`，`judgedPairs === 0` 那支不可达），故该 spec 单轮最多 **2** 次（缺省 AVD 下实测 0–2）；
   · `settings-sync-contract` **1 处**（缺 `PIXIV_REFRESH_TOKEN` 时，#819 第 12 轮由 `return` 改 `t.skip()`）——⚠️ 它**不**在上面的 `describe.skipIf` 枚举里（那 5 个是**整批** skip，这个是**单例** skip），**有 token 时不出现、缺 token 时 +1**。判读前先确认环境里 `PIXIV_REFRESH_TOKEN` 是否已设。
   ⇒ 缺省 `pictelio_ui` AVD 下总 skipped 在 **0–3** 浮动（**非** pictelio_ui 时上表 5 个整批 suite 也进计数，量级远大于此）。
   **两条口径，别混用**——默认 reporter **只打计数、不打 suite 名**，所以「逐个确认发版门没被 skip」这件事**只有 verbose 口径能做**：显式加 `--reporter=verbose` 后看的是 **suite 名**：`transition-matrix` 这个 suite 不应整批出现在 skipped 里。
   ⚠️ **别拿「用例名不以 skipped 出现」当判据**——三态表第 2 格的设计就是内容形态不利时该用例**合法地**显示为 `↓`（vitest 记 skipped 而非 passed）。照那条判据执行，会把一次合法的「本轮未验证」误判成「门没跑」。
   ⚠️ **不要**改去核对 spec 里那行 `console.log`：实测（vitest 5.0.1 隔离复现）**默认 reporter 只输出挂在具体 test 上的 stdout**，模块级 / 文件级的 `console.log` 在默认 reporter 下不输出——**与该文件是否被 skip 无关**（无任何 skip、全部通过的文件同样不输出），只有 `--reporter=verbose` 才有。且非 TTY 下默认 reporter 只打印计数、**不打印 suite 名**，所以判据只能是 skipped 计数，不能是名字；verbose 口径见上。
6. **lynx 夜间模式真机走查 gate（#692）**：发版前**必须执行并落档** [`docs/specs/lynx-night-mode-walkthrough.md`](specs/lynx-night-mode-walkthrough.md) 的 T2/T3/T4 矩阵（状态栏图标 4 组合、splash 4 组合、plate / icon-size 轨间差异、一次性滞后边界、API 28–30 残留、T4 五项），结果写入 `docs/research/lynx-night-mode-walkthrough-acceptance.md`，并与 [`docs/adr/ADR-0180-lynx-dark-mode.md`](adr/ADR-0180-lynx-dark-mode.md) 状态行的「真机走查 gate」对齐；矩阵未执行/未落档 = gate 未解除，不得发版（落档文件为新建、当前不存在属预期——**文件存在且矩阵全勾**才是解除判据；机器防线（契约测试）只证明读点/键名/色值同源，证明不了设备可见行为——见 spec §4.8「防线边界」）。
