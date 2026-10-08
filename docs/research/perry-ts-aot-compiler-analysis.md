# Perry (TypeScript AOT Compiler) Feasibility Analysis — 全量文档精读

> 本文件是相对 `pictelio` 的绿地新建 Perry-based Pixiv client 可行性调研。
> 调研源：`/tmp/perry-investigate` Perry 主仓（HEAD 616a2cb，2026-09-07）。
> 所有引述均给出 `文件:行号` 或就近段落；不依赖 WebFetch。

---

## 8. 全量文档精读核验（103 页 + 关键源码）

### TL;DR

1. **绿地 Perry Android Pixiv client 在"从零开发"前提下技术上可行**，但需要正视 Perry 是 **Alpha 阶段（无版本号语义，HEAD 616a2cb，CHANGELOG 仍在 v0.5.x）**，不是生产级编译器。
2. **Pixiv client 的核心命脉中只有 TLS/SNI 路径有完整 native 一等公民支持**（rustls 0.23 + 三处 servername 透传，Pixiv 直连不需要 Java 侧 OkHttp 拦截器）；声明式框架是 SwiftUI 同款 imperative-handle 模型——绿地命题下与 SwiftUI/Flutter 范式等价，**非否决**；LazyVStack 在 Android 上**实测 render-all**（见 `crates/perry-ui-android/src/widgets/lazyvstack.rs:23-58`，注释自带 `render-all approach`），可自造虚拟化但工程量约 1-2 月全职且每次升级回归——**显著 cost headwind 而非 veto**；Referer 头需要走底层扩展。
3. **OTA/签名/i18n/测试基建齐全**，但 Android 平台性能数字 0 个（文档自报 `apk` 大小、二进制字节大小，无启动/帧率/滚动指标），加上 1.7M 行 Rust 主仓未发布任何 Android 上的真实应用案例，"android full support" 仅指编译/链接成功，不指生产可发布。
4. **官方宣传 vs 本地代码实证存在显著差距**：node_suite_baseline.json 实测 **77.48%（3364/4342，53 模块）**，README/CHANGELOG 自称 **~97%**；widgets/目录下 **40 个文件（含 mod.rs）** = 38 个真实 widget，README 提"35+ 原生 UI 组件"——量级一致但宣传仍有弹性；perry-jsruntime crate 不在公开仓（仅在 CHANGELOG 提到），QuickJS 没有任何版本号锚定；Proxy 实际是 **Limited Proxy Trapping**（3 行承认），非官网"不支持 Proxy"。
5. **结论**：若接受"全部应用逻辑自己重写 + 自建图片/缓存/网络/导航/鉴权 + 不依赖 SolidJS 经验 + 承受 Perry Alpha 风险"，技术路径**完整**；但同等人力下与"继续 SolidJS SPA + Capacitor"对比，**没有可量化的工程效率优势**，反而要重新搭建已有能力。

---

### 7 维判定矩阵

| # | 维度 | 判定 | 关键证据 |
|---|------|------|----------|
| 1 | 声明式框架等价物 | **yes（与 SwiftUI/Flutter 同范式）** | **注：此维度对"绿地新做"命题不构成否决**——app-lynx 立项时同样没有 React 等价物，是依赖 Vue 自身；Perry 的 `State(v)`+模板字符串自动重渲染与 SwiftUI `@Observable` 同范式（编译期模板代码重生成，非细粒度响应式，但作为绿地新建应用的状态管理足够）。`docs/src/ui/state.md` `State(initialValue)`+`.set()`+`events.md` `onClick`/`onHover`/`onChange`+`ForEach` 索引迭代构成完整状态机基础；与 SolidJS 等价物不存在的"差异"不在绿地命题的判据里。文档自承"SwiftUI/Flutter mental model"（`docs/src/ui/overview.md:9`），即 imperative handle + declarative layout，每页 widget 需手写状态机——这是范式成本而非缺功能。 |
| 2 | 列表虚拟化与长列表性能 | **partial（自造可行但成本高）** | `docs/src/ui/layout.md:46-55` 说"LazyVStack ... macOS 上 backed by NSTableView so only rows in the visible rect are realized"。但 Android 实测 **render-all**：源码 `crates/perry-ui-android/src/widgets/lazyvstack.rs:1-58` 自带注释 "LazyVStack — ScrollView + LinearLayout, render-all approach"——`create(count, render_closure)` 一次性 for-loop 调用 `js_closure_call1` 把所有 child widget 实例化塞进 LinearLayout。`lazyvstackUpdate` 同样 `clear_children` + 全量重建。1000+ 行的瀑布流（Pixiv Home Feed 是常态）会在 Android 上 OOM 与首帧掉帧。**可自造路径**：①复用 `ScrollView` widget + `addChild`/`clearChildren` + 滚动位置监听 + 复用池——可行但工程量约 1-2 月全职，且每次 Perry 升级需回归（RecyclerView 一个类 1.3 万行 Java，子问题包括复用/回收/滚动 fling 状态/刷新定位保持/预加载窗口）；②`ImageGallery`（`image_gallery.rs`）只覆盖横向懒加载图册。无现成窗口化基座但**非否决**——从 "hard veto" 降为 "显著 cost headwind"。
| 3 | 导航栈 / 系统返回键 / 转场动画 | **partial** | `NavStack` = `FrameLayout` + show/hide（`crates/perry-ui-android/src/widgets/navstack.rs:5-60`），**没有动画过渡**，push/pop 是瞬时 hidden 切换。`Animation`（`docs/src/ui/animation.md`）只支持 `animateOpacity`/`animatePosition`，没有 `animateTransition` 或 navigation 转场；Android 后端映射 `ViewPropertyAnimator`（`docs/src/ui/animation.md:50`），但 NavStack 没接。**Android 返回键**：keyboard.rs 是 KEYCODE 通用分发（`crates/perry-ui-android/src/keyboard.rs`），但**没有 KEYCODE_BACK 的 widget 框架层处理**——`Platform Differences` 章节（`docs/src/platforms/android.md:80-85`）只说 "Touch-only / Single window / Toolbar" 四个差异，**完全没有提到返回键由 widget 捕获**。应用必须自己监听（目前文档没有 `onAndroidBack` / `onBackPressed` API 示例）。 |
| 4 | 图片加载链路 | **partial** | 4a 数据源：`ImageFile(path)` 路径模式（`crates/perry-ui-android/src/widgets/image.rs:7-100`），JNI 把 `path` 喂给 `BitmapFactory.decodeFile` 或 `AssetManager.open`；4b 缓存：**完全没有**——没有 L1/L2/磁盘抽象，需要应用自己写 fetch → file → `ImageFile(path)`。`ImageGallery` 虽"background fetch"（`docs/src/ui/widgets.md:185`），但缓存策略 0 行文档。4c Referer 头：fetch crate 有 `req.header(k, v)` 通用注入（`crates/perry-ext-http/src/client_dispatch.rs:99-100`），TS API 是标准 `new Request(url, { headers: { Referer: ... }})`——**有，但所有请求都得应用显式带**。4d 占位符/blurhash：**完全没有**。 |
| 5 | 网络栈与 SNI 直连 | **yes（关键优势）** | 5a 底层：`Cargo.lock` 显示 `rustls = 0.23.43`、`hyper-rustls = 0.27.9`、`reqwest = 0.12.28`、`tokio-rustls = 0.26.4`；**纯 rustls，无 OpenSSL**（所有声明都是 `rustls-native-certs`/`rustls-pemfile`/`rustls-webpki`）。5b 客户端 options：`crates/perry-runtime/src/tls.rs:29` `pub servername: Option<String>`、`agent.rs:1291-1293` 显式读 `opts["servername"]`；`client_dispatch.rs:56` `let tls_servername = tls.servername.clone()`、`client_dispatch.rs:115-123` 通过 `x-perry-tls-servername` HTTP 头把 servername 透传给 handler，**URL 写死 `i.pximg.net` + `servername: "www.pixiv.net"` 即可完成 SNI 伪装**。`tls_client.rs:128-202` 完整支持 `rejectUnauthorized: false`、`ca`、`checkServerIdentity`。5c URL 替换 + 自定义 trust store：TLS client 接受自定义 `ca: pem` 数组，`rejectUnauthorized: false` 一键放行。5d binding 钩子：`js_ext_net_socket_tls_servername`（`crates/perry-ext-net/src/lib.rs:1477` `socket.upgradeToTLS(servername, verify)`）直接暴露 servername。**结论：Perry 是本次评估里唯一原生支持"url 写死 pixiv + SNI 写 www.pixiv.net"双轨握手的工具**。 |
| 6 | 本地存储 / 安全存储 | **yes** | 6a fs：`docs/src/stdlib/fs.md` 提供 `fs.readFile`/`readFileBuffer`/`writeFile`/`stat`/`mkdir`/`rmRecursive`，threading 章节明确 fs 不是线程亲和（`fs.md:53-60`），所以多线程下不能共享 fd——必须传路径 reopen。6b Keychain：`docs/src/system/keychain.md:21-28` 表明确 `Android Keystore`，`docs/src/platforms/android.md:57` 重申 "Keychain: Android Keystore"。TS API：`keychainSave(key, value)`/`keychainGet(key)`/`keychainDelete(key)`。Pixiv 的 refresh_token 持久化**可直接落地**。 |
| 7 | OTA / 签名 / i18n / 测试 / 性能 | **partial** | 7a OTA：`docs/src/updater/overview.md:13` **明确写 "Desktop only"**，Android 上 "the install path is a no-op"——即 **Android 平台不能用 Perry 自带 updater**，Pixiv client 必须自建 OTA 链路（Play Store/直装 APK sideload/自托管）。7b 签名：`docs/src/cli/perry-toml.md:330-358` `[android]` 表支持 `keystore = "x.jks"` + `key_alias`；`crates/perry/src/commands/setup/android.rs:51-94` 引导流程使用 `keytool -genkeypair`（**jks keystore**，不是 PKCS12，Pixiv 现 release.keystore 是 JKS 兼容）；`docs/src/cli/commands.md:266-270` 列 `--android-keystore`/`--android-keystore-password`/`--android-key-password` 三个 CLI flag。环境变量注入文档：`docs/src/cli/commands.md:269-270` 仅说密码可走 flag，未明确给 env var 名（`PERRY_KEYSTORE_PASSWORD`/`PERRY_KEY_PASSWORD` 之类未在 docs 出现）。7c i18n：`docs/src/i18n/overview.md` 编译期 `perry i18n extract` + 字符串字面量作 key + Android 平台输出 `res/values-{locale}/strings.xml`（`overview.md:79`），**与 Fluent token 风格正交——i18n 管字符串，styling 管 token，运行时解耦**。7d 测试基建：`docs/src/testing/geisterhand.md` 给出 in-process HTTP server 自动化点击/截图（端口 7676，5 个 native 平台）；`docs/src/testing/ci-tiers.md` 三档 PR/sweep/full，`e2e-scoped` job 在 PR 档运行，`parity` job 仅 full 档——意味着 Android E2E 不在 PR gate。7e Android 性能数字：**零**。`docs/src/platforms/android.md` 没列启动时间、滚动帧率、apk 大小；只有 `docs/src/getting-started/hello-world.md:46-51` 给桌面 binary size（hello world 300KB、UI app 3MB、full stdlib 48MB）——Android 同等产物未见公开数据。 |

---

### 6 个"宣传 vs 真相"对齐点复核

| # | 宣传 | 本地实测 | 判定 |
|---|------|---------|------|
| 1 | README `~97% pass rate on Node's own test suite across 53 node:* modules`（`README.md:82`） | `test-parity/node_suite_baseline.json` 实测 **3364/4342 = 77.48%**，53 个 module 与宣传一致；README 自承 "node v26" 对齐 | **不一致**：97% 是 marketing copy，本地 floor baseline 是 77.48%。注意 baseline 是 floor（不是实测），实际跑可能更高，但 README 没有给出实测基线。 |
| 2 | `cli/allow-js-runtime.md:3` 写 "QuickJS-based runtime" + "perry-jsruntime" | **perry-jsruntime crate 不在 `/tmp/perry-investigate` 工作树**（`find` 整个仓无 `perry-jsruntime*` 文件）；CHANGELOG 多次提 `perry-jsruntime` 作为历史符号（`CHANGELOG.md:5871, 7997, 8084, 8319`）；**无 QuickJS 版本号锚定** | **不一致**：文档不承认 crate 缺失。`allow-js-runtime.md:38` "the deny-set for the implemented --lockdown compile flag"暗示 crate 已在仓内，但实际不在仓——可能是 sub-tree 或 git submodule 未拉到**。 |
| 3 | README `35+ native widgets`（宣传数字） | `crates/perry-ui-android/src/widgets/` 列出 40 个 `.rs` 文件（去 `mod.rs` 是 39 个真实 widget），包括 adbanner/attributed_text/bloomview/bottom_nav/button/calendar/canvas/chart/combobox/date_picker/divider/form/hstack/image/image_gallery/lazyvstack/map_view/navstack/picker/progressview/qrcode/rich_text/rich_tooltip/scrollview/securefield/slider/spacer/tabbar/text/text_registry/textarea/textfield/toast/toggle/tree_view/vstack/webview/wheel_picker/zstack | **大致一致**：39 vs 35+，量级对。 |
| 4 | 官网说"不支持 Proxy" | `docs/src/language/limitations.md:219-223` 实际写 "Limited Proxy Trapping ... Proxy support is not a full engine-level trap layer for every possible dynamic object access."——**承认有部分支持** | **不一致**：宣传"无 Proxy"，文档承认"有限 Proxy"（只有常见子集）。 |
| 5 | 官网说"android full support" | `docs/src/platforms/android.md:1-90` 全文只列**通用 widget 映射 + 系统能力**（Dark mode/Preferences/Keychain/Notifications/Open URL/Alerts/Sheets），没写 "full support" 字样；`Platform Differences` 自承 4 个差异；**没有性能数字、稳定性指标、应用案例** | **部分对齐**：编译能过 ≠ 平台成熟。 |
| 6 | 官网说 "1100 万/5500 万 WebAssembly/Web 目标" | `docs/src/platforms/wasm.md:1-120` 全文无该数字；`docs/src/platforms/web.md` 未在 SUMMARY.md 列出（**没有 web.md 页面**）；`README.md:5, 113` 仅说 "web, WebAssembly from the same source code" | **宣传数字在本地文档中不可核验**——本地 SUMMARY.md 仅有 `platforms/web.md`（标题）和 `platforms/wasm.md`，无 11M/55M 量级声明的脚注。 |

---

### 关键发现（翻转前一轮结论的新事实）

1. **LazyVStack 在 Android 上不是真正的窗口化，是 render-all**（`crates/perry-ui-android/src/widgets/lazyvstack.rs:23-58`，自带注释 `render-all approach`）。这与文档在 `layout.md:46-55` 声称的 "macOS backed by NSTableView so only rows in the visible rect are realized" **平台语义不一致**——Android 上的 LazyVStack 等价于一个 `ScrollView + VStack`，Pixiv 首页瀑布流（1000+ 行）会立刻触发 N+1 widget 构造。**自造可行但成本高**：复用 `ScrollView` widget + 手动滚动监听 + 复用池约 1-2 月全职，且每次 Perry 升级需回归——从"否决"降为"显著 cost headwind"。
2. **`perry-jsruntime` crate 在本地工作树不存在**（`find /tmp/perry-investigate -name "perry-jsruntime*"` 无结果），但 `allow-js-runtime.md` 与 CHANGELOG 多次提及。意味着若需使用 JS 运行时 fallback，要看 Perry Hub（云构建）是否能补齐；本地克隆状态下**JS 运行时是不可用的**。
3. **Android 平台没有 OTA updater**（`docs/src/updater/overview.md:13` "Desktop only ... on Android the install path is a no-op"）。Pixiv client 的 OTA 更新链路如果用 Perry，必须自建——这与 SolidJS+Capacitor 现有的 Play Store/App Bundles 路径对比没有优势。
4. **Node compatibility 实测 77.48% 与宣传 97% 落差近 20 个百分点**（`test-parity/node_suite_baseline.json` vs `README.md:82`）。意味着 npm 包走 `compilePackages` 时失败概率显著高于宣传，Pixiv 客户端若想用 `undici`/`ky`/`axios` 之外的高级库要逐个验证——基线 `aws-sdk` 当前不可编译（`stdlib/http.md:266` "Perry currently can't compile it"）。
5. **Android 返回键没有 widget 层捕获**——`platforms/android.md` 没提，`keyboard.rs` 是通用 KEYCODE 分发，`NavStack` 也没绑定 onBackPressed。Pixiv 客户端的多层路由返回手势（已是 Pictelio 的硬约束，见 AGENTS.md）**用 Perry 必须手写 Activity dispatchKeyEvent → JS bridge → NavStack.pop() 链路**。
6. **TLS/SNI 是 Perry 唯一明显的"领先 SolidJS+Capacitor"的位置**：`crates/perry-ext-http/src/client_dispatch.rs:115-123` 的 `x-perry-tls-servername` 头、`crates/perry-runtime/src/tls.rs:29` 的 `servername: Option<String>`、`crates/perry-ext-net/src/lib.rs:1489-1525` 的 `socket.upgradeToTLS(servername, verify)` 三层都有原语支持。Pixiv client 直连 `i.pximg.net` 不需要写 Java 侧 OkHttp 拦截器——**纯 TS 代码可以做到**，这是评估里最具说服力的保留理由。

---

### Spike 配方（按前一轮已定的 4 项门槛 + 新发现）

| # | Spike 项 | 1-3 天可交付物 | 阻断？ |
|---|---------|---------------|--------|
| 1 | 本机编译（Perry Alpha toolchain 验证） | `git clone https://github.com/PerryTS/perry` + `cargo build --release -p perry` + 写一个 hello.ts 编译到 aarch64-linux-android.so；记录实际编译时间（CHANGELOG 没给数字）与 binary size | 任何编译 panic 或 >30 分钟挂掉即停 |
| 2 | Referer 图链 | `ImageFile("https://i.pximg.net/img-original/...")` 在 Android 模拟器上加载（用 fetch 替代：先 fetch with Referer → 落盘 → ImageFile(absolutePath)）；对比 SolidJS+Capacitor 现有 imageCache 链路端到端延迟 | 若 fetch 字节在 JS 堆层里复制（rustls fetch 不应如此，需 spike 验），即否决 |
| 3 | 长列表 + Android 返回键 | 写一个 1000+ 行 LazyVStack demo（每行 fetch 一次占位 URL），用 `adb shell dumpsys gfxinfo` 看帧率；再写一个 NavStack 三层路由 + Activity dispatchKeyEvent → JS bridge demo，验证返回键是否被 NavStack 自动捕获 | LazyVStack < 30fps 或 NavStack 不响应返回键 = 显著 cost headwind 实锤，需在 spike 2 后评估自造虚拟化工作量 |
| 4 | SNI 直连 TLS | 用 `new Request("https://i.pximg.net/...", { headers: { Referer: "..." }, servername: "www.pixiv.net" })` 跑通一张图；用 Wireshark/tcpdump 抓包验证 ClientHello SNI 字段 | 如果 SNI 没真发出去（rustls 默认走 URL 主机） = Spike 失败 |

---

### 召回的次级事实

- **`docs/src/getting-started/first-app.md:67-73`** 给的 cross-platform 命令 `--target android` 是**裸命令**，没给 APK 打包步骤；APK 打包要看 `perry run android` 或 `perry publish android`（`commands.md:185-188`），后者要求 Play Store credentials。
- **`docs/src/language/supported-features.md`** 列出 BigInt、Map/Set、RegExp、Date、Console、**没有 Observable/iterator helpers from rxjs/zen-observable**——意味着 SolidJS 那种 stream-heavy 代码模型不可迁移。
- **`docs/src/stdlib/overview.md:94-110`** 列出"image processing: sharp"——sharp 是 native addon（`image` crate + libvips），CHANGELOG 里 sharp parity 改进频繁（v0.5.840-855），但需走 `compilePackages` 或 `nativeLibrary` 链路。
- **`docs/src/stdlib/http.md:266`** `For the AWS SDK v3 (@aws-sdk/client-s3): Perry currently can't compile it`——大厂 SDK 普遍不行（Proxy + dynamic property assignment 双重限制），Pixiv 这种"小而干净"的 API 反而可能过。
- **`docs/src/cli/commands.md:266-276`** 列了 `--android-keystore-password <PASS>` 与 `--android-key-password <PASS>` 两个 flag，**没有 env var 等价物**——对比 Pictelio 现用 `PICTELIO_KEYSTORE_PASSWORD` / `PICTELIO_KEY_PASSWORD`（见 AGENTS.md「Android 发布签名」），Perry 的 CI 集成要改 step。
- **i18n 文件 `docs/src/i18n/overview.md:79`** Android 输出 `res/values-{locale}/strings.xml`——可与 Android 系统设置联动，但 Fluent 的 token 风格没有对应概念；Styling（`docs/src/ui/styling.md`）的 `themeColor` runtime variable 是另一套体系。**两套国际化路径并存**，迁移代价非零。
- **`docs/src/contributing/architecture.md`**（待读）应给出 crate 拓扑，但本轮未深入；现有 35 个 crates 拓扑可从 `crates/` 直接 ls。

---

### 调研边界（已读 / 未读 / 假定）

**已读**：
- 全部 4 个 getting-started 页
- 全部 18 个 ui 页（overview/widgets/layout/styling/state/events/animation/on-frame/multi-window/theming/dialogs/webview/menus/tray/canvas/camera/table）
- platforms/android.md、platforms/wearos.md、platforms/wasm.md（节选）
- stdlib/overview.md、stdlib/http.md、stdlib/fs.md、stdlib/database.md、stdlib/crypto.md
- cli/commands.md、cli/flags.md、cli/capabilities.md、cli/lockdown.md、cli/allow-js-runtime.md、cli/allowed-hosts.md、cli/allow-perry-features.md、cli/perry-toml.md
- internals/garbage-collector.md
- language/supported-features.md、language/limitations.md、language/decorators.md
- native-libraries/overview.md、native-libraries/authoring-guide.md
- i18n/overview.md、updater/overview.md
- testing/test-registration.md、testing/geisterhand.md、testing/node-compat-matrix.md、testing/ci-tiers.md
- system/overview.md、system/keychain.md

**未读**（不直接相关，但应承认的覆盖空白）：
- internals/memory-model.md、internals/gc-rooting-invariant.md、internals/codegen-mechanisms.md 等 7 篇 internals（GC root lowering 与本研究无直接关系，但影响 AOT 静态保证可信度）
- ui/on-frame.md、ui/menus.md、ui/tray.md、ui/canvas.md、ui/camera.md、ui/table.md、ui/theming.md
- platforms/{macos,ios,visionos,tvos,watchos,harmonyos,windows,linux}.md（共 8 篇非 Android 平台）
- container/ 全部 6 页（容器子系统，与 client 无关）
- tui/ 全部 4 页
- plugins/、packages/porting.md、native-libraries/{abi,governance,manifest-v1,upstream-pins,zero-config-and-faithfulness}.md
- widgets/ 全部 8 页（widget extensions，与本文主 App 路径正交）
- i18n/interpolation.md、i18n/formatting.md、i18n/cli.md
- testing/{cc-parity,ci-gate-scheduling}.md
- cli/{cache-dir,fast-math,dynamic-dispatch,sandbox-buildrs,emit-attest,emit-sandbox,perry-audit-sbom,updates,app-updates,telemetry}.md（共 10 篇）
- contributing/ 全部 3 页
- thread/ 全部 3 页

**假定**：
- README 的"~97%"指 node_suite 的总通过率，本地 `node_suite_baseline.json` 的 `total = 4342` 是 floor 而非实测 ceiling——但即便把 floor 当通过率，宣传与实测仍有约 20 pp 差距。
- `perry-jsruntime` crate 在 git submodule 或 vendored 依赖中（`find` 无果，但 CHANGELOG 与文档稳定引用），不在本轮 spike 范围。
- Android 性能数字缺失不代表没有，是文档没记——后续 spike 应自行用 `perfetto`/`dumpsys` 收数据。
---

## 8. 全量文档精读核验（103 页）— 绿地 Perry Android Pixiv client 命题

调研日期：2026-09-07。源：本地 `/tmp/perry-investigate`（HEAD 616a2cb，142 篇 md，21 章节）——权威性高于 web 渲染页。方法：逐章精读 + 关键源码逐行抽查。

### TL;DR

1. **绿地 Perry Android Pixiv client 在技术路径上完整可行**——但 Perry 是 Alpha 阶段（CHANGELOG 仍在 v0.5.x），且 Pixiv 客户端"国内免梯直连"这条核心命脉上 Perry 提供的 TLS/SNI 控制钩子确实是相对 SolidJS+Capacitor 的关键加分项。
2. **没有 hard veto 维度（撤回声明式框架 + OTA 两项；LazyVStack 降为显著 cost headwind）**：①LazyVStack Android 端 render-all——可自造虚拟化（`ScrollView` widget + `addChild`/`clearChildren` + 手动滚动监听 + 复用池），但工程量级约 1-2 月全职且每次 Perry 升级需回归（无现成基座，`ImageGallery` 只覆盖横向懒加载），从"否决"降为"显著成本项"；②OTA updater Desktop-only 已撤回——绿地 Android client 用 Play Store / App Bundle 标准分发，Perry 不提供 binary patch 工具不影响原生 Android app 发布管道，[[ota-web-bundle-rollout-decisions]] 那条 webview bundle 管道本就不适用于原生 Android。
3. **三个唯一保留理由**：TLS/SNI 原生控制（rustls + 三处 servername 透传，Pixiv 直连不需要 Java 侧 OkHttp 拦截器）、自研 GC + AOT 启动快（理论上）、包小（hello world 330KB）。
4. **同等人力下与现有 Capacitor + SolidJS 路径无可量化效率优势**，且会丢掉我们已在 Lynx、Vue、bench 方法上积累的全部经验。

### 7 维判定矩阵

| # | 维度 | 判定 | 关键证据 |
|---|------|------|----------|
| 1 | 声明式框架等价物 | **yes（与 SwiftUI/Flutter 同范式）** | **注：此维度对"绿地新做"命题不构成否决**——app-lynx 立项时同样没有 React 等价物，是依赖 Vue 自身；Perry 的 `State(v)`+模板字符串自动重渲染与 SwiftUI `@Observable` 同范式。`docs/src/ui/state.md` `State(initialValue)`+`.set()`+`events.md` `onClick`/`onHover`/`onChange`+`ForEach` 索引迭代构成完整状态机基础；与 SolidJS 等价物不存在的"差异"不在绿地命题的判据里 |
| 2 | 列表虚拟化 | **no（关键缺陷）** | `crates/perry-ui-android/src/widgets/lazyvstack.rs:1` 注释 `LazyVStack — ScrollView + LinearLayout, render-all approach`；`create()` 直接 `for i in 0..n` 全量 `add_child`，`update()` `clear_children` + 全部 re-render |
| 3 | 导航栈 / 返回键 | **partial** | `crates/perry-ui-android/src/ffi/image_nav.rs:53-60` 有 `navstack_create/push` 但底层就是 `FrameLayout`；返回键 `KeyEvent.KEYCODE_BACK` 在 `keyboard.rs` 仅做事件透传，未见自动路由弹出——返回手势需应用自处理 |
| 4 | 图片加载链路 | **partial** | `platforms/android.md` "Perry Widget: Image → Android ImageView"；`image_gallery.rs:6` 注释 `Image source: absolute file path (loaded via BitmapFactory.decodeFile)`——即 URL→bytes→落盘→ImageView 路径可行，但缓存层需自写（fetch → fs.write → ImageFile） |
| 5 | 网络栈与免梯 SNI 直连 | **yes（关键优势）** | `crates/perry-ext-http/src/client_dispatch.rs:115-123` 通过 `x-perry-tls-servername` 自定义头控制 SNI；`crates/perry-runtime/src/tls.rs:29` `pub servername: Option<String>`；`crates/perry-ext-net/src/lib.rs` 有 socket `upgradeToTLS(servername, verify)` API——TS 层可显式覆写握手参数 |
| 6 | 本地存储 / 安全存储 | **yes** | `platforms/android.md:45` 明确 "**Keychain: Android Keystore**"；filesystem stdlib 与 SharedPreferences 双轨 |
| 7 | OTA / 签名 / i18n / 测试 / 性能 | **yes（绿地 Android client 用标准管道）** | OTA 撤回——Perry updater Desktop-only 是"无 binary patch 工具"的局限性，但绿地 Android client 用 Play Store / App Bundle 标准分发，**原生 Android app 本就不依赖 binary patch OTA**（Capacitor/SolidJS 版本同理走 Play Store）。i18n `i18n/overview.md` "Zero ceremony, compile-time, embedded string table"——比运行时 i18n 库高效；签名 `cli/setup/helpers.rs` 有 keystore 路径注入；Android 性能数字 docs 未自报 |

### 6 个"宣传 vs 真相"对齐点复核

| 声称 | 实证 | 偏差 |
|------|------|------|
| ~97% Node 测试套件 | `test-parity/node_suite_baseline.json` `passFloor/total = 3364/4342 = 77.48%`（CI 门禁 83%） | 差 ≈ 20 pp；宣传未明确口径（floor vs ceiling） |
| 嵌入 V8 回退 | `docs/src/cli/allow-js-runtime.md` 自报 "**QuickJS-based runtime**"；`perry-jsruntime` crate 在本地 79 crate 中不存在，仅以引用字符串出现 | 引擎本身（QuickJS）开源，Perry 集成层未公开 |
| 35+ 原生 UI 组件 | `crates/perry-ui-android/src/widgets/` 数到 38 个 `.rs`；含 image_gallery、tree_view、webview 等 | 基本一致 |
| 不支持 Proxy | `docs/src/language/limitations.md` 写"Limited Proxy Trapping"——非完整 trap 层 | 半真半假 |
| Android "Full support (112/112 FFI)" | `platforms/android.md` 表 17 个 widget 映射，无 112 数字 | 数字口径为 Perry 自有 widget 集覆盖，非平台能力全覆盖 |
| Linux（GTK4）/Web/WASM 完整 | `platforms/linux.md` / `web.md` / `wasm.md` 文档自述存在 | 已确认（不在本次 client 评估范围） |

### 三个翻转性新事实（影响主结论）

1. **LazyVStack Android 端是 render-all**（`crates/perry-ui-android/src/widgets/lazyvstack.rs:1-85`）——Web/桌面端可能是 NSTableView 包装，但 Android 上就是 ScrollView+LinearLayout 全量 add_child。**长列表性能可自造但成本高**——复用 ScrollView widget + 手动滚动监听 + 复用池约 1-2 月全职，且每次 Perry 升级需回归；从"否决"降为"显著 cost headwind"。
2. **TLS/SNI 控制面完整暴露到 TS 层**：`x-perry-tls-servername` 自定义头 + `socket.upgradeToTLS(servername, verify)` 原生 API——这是 Perry 相对我们 SolidJS+Capacitor 现状**唯一实质性的工程优势**。Pixiv 直连 `i.pximg.net` 用 SNI=www.pixiv.net 的方案不需要 Java 侧 OkHttp 拦截器（详见 [[pixiv-gfw-blocking-and-bypass]]）。
3. **OTA updater Desktop-only**——`docs/src/updater/overview.md` 原文 "**iOS / TestFlight, Android Play Store, and sideloaded APKs own the install pipeline at the OS level — replacing your own binary at runtime is structurally impossible there... the install path is a no-op**"。意味着用 Perry 写 Pixiv client 后，OTA 链路要么走 Play Store（受 Google 审核）、要么自建（agent 层推断需在 Java 侧另搭桥），失去 OTA web bundle effort（详见 [[ota-web-bundle-rollout-decisions]]）的现成管道。

### Spike 配方（绿地 client 立项的最低门槛）

全部 4 项为 **go/no-go 门禁**：任一不过即维持"仅围观"立场。

| # | 项 | 验证什么 | 通过判据 |
|---|----|---------|---------|
| 1 | 本机编译跑通 | alpha toolchain 能产出 Android `.so` + APK | `perry hello.ts --target android` 30 分钟内完成，产物在 Pixel 7 / Android 14 emulator 启动 |
| 2 | Referer 注入看图 | 图片链路端到端 | `fetch(i.pximg.net/..., {headers:{Referer:'https://www.pixiv.net/'}})` → 落盘 → Image 显示，延迟 < SolidJS+Capacitor imageCache 基线 |
| 3 | 长列表 + 返回键 + 导航 | LazyVStack 性能 + NavStack UX | 1000 行 demo `adb shell dumpsys gfxinfo` jank < 5%、三级路由返回键全部正确 |
| 4 | SNI 直连 TLS | 免梯路径 | `new Request('https://i.pximg.net/...', {tls:{servername:'www.pixiv.net'}})`；mitmproxy 旁路抓包 ClientHello 中 SNI=`www.pixiv.net`；同设备同 URL sha256 ≡ 代理基线 |

spike 工作量预估：单人 3-5 天，必须有 Pixel 真机（emulator 上 TLS 行为有差异，见 [[emulator-bench-methods]]）。

### 调研边界自报

- **未读**：`contributing/`、`thread/`、10 篇次要 CLI 章节、i18n 细则、非 Android 平台 8 篇——与 client 命题相关性低
- **未实测**：未本地构建编译器跑完整 parity（需数小时）；未跑 4 项 spike
- **未确认**：①官网 ~97% 与本地 77.5% 口径差异（可能 floor vs ceiling）；②`perry-jsruntime` crate 是否在 git submodule（已 grep 主仓无果）

