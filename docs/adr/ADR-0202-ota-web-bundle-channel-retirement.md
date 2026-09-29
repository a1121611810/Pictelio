# ADR-0202：OTA web bundle 发布通道下线（消费层留存）

## 状态

accepted（2026-09-29）

## 背景

WebView 客户端已随 [#610](https://github.com/a1121611810/Pictelio/issues/610) 于 v6.3.0 整体下线，
Pictelio 自此为 **Lynx 单引擎**客户端（[ADR-0201](./ADR-0201-single-engine-facade-consolidation.md)）。
但 `packages/app/scripts/` 下的 **OTA web bundle 发布通道**（构建 web 产物 → Ed25519 签名 →
三件套上传 GitHub Release）**原样留在了发布脚本里**，文档也仍在完整叙述它。

该通道已无任何消费方，三条独立证据：

1. **Lynx 侧对 OTA 零消费。** 唯一运行时是 `LynxActivity` / `PictelioAppLynx`，
   其更新能力走 `PictelioAppModule.httpGet` + `@pictelio/update-check` 的**普通 APK 更新检查**，
   从不拉取、验签或加载 web bundle。
2. **Java 侧 Ota 类早已不在仓库。** 实测 `find packages/app/android/app/src -iname "*Ota*" -o -iname "*Signature*"`
   **返回 0 行**——`OtaPlugin` / `OtaWorker` / `OtaInstaller` / `OtaSignatureVerifier` 全部不存在。
   三件套的 Ed25519 签名**没有任何验签方**。
3. **产物无落点。** `packages/app/ota/` 被根 `.gitignore` 忽略；三件套只会被上传到 GitHub Release，
   而没有任何客户端会去下载它。

同时，文档侧已出现**指向不存在实体的陈述**：`docs/release-checklist.md` 写「域分隔前缀
`Pictelio-OTA-bundle-v1\n` 与 Android 侧 `OtaSignatureVerifier` 逐字一致」「`MainActivity`
注册的自定义插件」——`OtaSignatureVerifier` 与 `MainActivity` 均已不存在。

## 决策

**发布通道整体下线，消费层原样留存。** 两者必须一起说，缺一半就是错误陈述。

1. **删除发布侧**：`release.mjs` 的 `--web-only` 模式与三件套打包/签名/上传路径、
   `release-bundle.mjs`、`lib/release-bundle-core.mjs`、`lib/release-webonly.mjs`，
   以及 `packages/website/version.json` 的 `webBundle` 字段。
2. **保留消费侧，一行不删**：`packages/app/src/**` 的 OTA 消费代码（`otaService.ts` /
   `GateOverlay.tsx` / `native/Ota.ts` / About 的 OTA 面板 / 设置页 OTA 自动下载开关 /
   `settingsStore` 的 OTA 持久键 / OTA i18n 文案），以及 `packages/update-check` 的
   web bundle API（`isBelowMin` / `WebBundleMeta` / `parseWebBundle` / `parseMinWebVersion` /
   `CheckResult.minWebVersion` / `CheckResult.webBundle`）。

### 消费层为何保留：四态并存

[`glossary-single-engine-facade`](./glossary-single-engine-facade.md) 为「webview 下线」这句话
钉了三态（运行时下线 / 源码留存 / 依赖留存），并警告**任何只描述其中一态的表述都是不完整的**。
OTA 通道有第四态，且这次是把它**新增**为「已下线」：

| 态 | 对象 | 本 ADR 处置 |
|---|---|---|
| 运行时下线 | WebView 运行时（#610） | 不变 |
| 源码留存 | `packages/app/src/**`（#819 第 4 项挂账） | **不变** |
| 依赖留存 | Capacitor npm 依赖（派生自源码留存） | **不变** |
| **发布通道下线** | **OTA web bundle 的构建/签名/上传** | **本 ADR 新增** |

关键点：**「发布通道下线」不等于「OTA 代码删除」。** 消费层代码的清理归属 `packages/app/src/**`
的 WebView 源码清理（[#819](https://github.com/a1121611810/Pictelio/issues/819) 第 4 项），
与本 ADR 是**两张票**。`packages/update-check` 的 web bundle API 保留还有一个**编译约束**：
消费层源码仍 import 它，提前删会让 WebView 留存源码编译失败。

## 影响面

**删除清单**

| 对象 | 说明 |
|---|---|
| `packages/app/scripts/release.mjs` 的 `--web-only` 模式 | 及其 step 1 私钥探测、step 2 `version.json` 字段追加、step 3 打包签名、step 6 三件套上传 |
| `packages/app/scripts/release-bundle.mjs` | 独立 round-trip 验签自检入口 |
| `packages/app/scripts/lib/release-bundle-core.mjs` | 打包 / 签名 / `bundlePathsFor` / `resolveOtaPrivateKeyPath` |
| `packages/app/scripts/lib/release-webonly.mjs` | `parseWebOnlyArgs` / `buildVersionJson` |
| `packages/app/scripts/bench-ota.sh` | 设备级 OTA 回归脚本：硬调 `release-bundle.mjs` 打三件套并驱动模拟器四场景（好包生效 / 坏签拒装 / 崩 10s 回滚 / 门槛阻断）。随通道下线一并删除——它是**消费层唯一的设备级回归网**，其消失是本 ADR 的已知代价（见「后果」）；JS 层面用例 `tests/agent-browser/specs/ota-gate.test.ts` 保留 |
| `packages/app/scripts/lib/release-build-steps.mjs` 的打包步骤 | step 3 步骤表里的「打包并签名 web bundle」及其 `otaSkipped` 形参（`release.mjs` 已不再传该参数，留着会产出调用已删脚本的步骤导致 `pnpm release` 第 3 步硬失败） |
| `packages/app/tests/unit/scripts/release-bundle.test.ts` | 485 行：三件套打包 / 签名 / zip 格式契约测试 |
| `packages/app/tests/unit/scripts/release-webonly.test.ts` | 171 行：双坐标版本语义契约测试 |
| `packages/website/version.json` 的 `webBundle` 字段 | 消费侧解析逻辑随之成为恒空读 |
| `docs/release-checklist.md` 的 OTA 章节 | 「web bundle OTA 产物」「跳过与门槛语义」「web-only 发布模式」整节删除 |

**新增清单**（非删除，是被删模块里仍需存活的部分的搬家）

| 对象 | 说明 |
|---|---|
| `packages/app/scripts/lib/release-version-json.mjs` | `buildVersionJson` 从 `lib/release-webonly.mjs` 迁入并剥除 OTA 语义；签名由 `{newVersion, apkVersion, repo, tag, changelog, minWebVersion}`（双坐标 + floor）收敛为 `{version, repo, tag, changelog}`（单坐标） |
| `packages/app/tests/unit/scripts/release-version-json.test.ts` | 新契约的单测 |
| `release-build-steps.test.ts` 的反向回归守卫 | 原「`otaSkipped` 双路径」用例换成「步骤表不得再出现任何 web bundle / OTA 打包步骤」，防止已下线的通道被静默接回 |

**保留清单（消费层，一行不改）**

`packages/app/src/services/otaService.ts`、`components/GateOverlay.tsx`、`native/Ota.ts`、
About 页 OTA 面板、设置页 OTA 自动下载开关、`settingsStore` 的 OTA 持久键、OTA i18n 文案；
`packages/update-check` 的 `isBelowMin` / `WebBundleMeta` / `parseWebBundle` /
`parseMinWebVersion` / `CheckResult.minWebVersion` / `CheckResult.webBundle`。

## 明确不做的事（Out of Scope）

- **`packages/app/src/**` 消费层清理**——属 #819 第 4 项，与本 ADR 是两张票。
- **`packages/update-check` 的 web bundle API**——留存即让 WebView 源码仍编译得过。
- **`packages/app-lynx/package.json` 的 `@pictelio/update-check` 残留依赖**——不在本次范围。
- **本机 `packages/app/ota/` 与 `assets/public` 产物清理**——本地产物（前者被 `.gitignore` 忽略），
  与仓库内容无关。
- **`openwiki/` 重生成**——生成物，由 GitHub Actions 定时任务负责；
  **禁止手改、禁止本地 `pnpm openwiki:update`**。
- **`AGENTS.md`**——该文件无任何 OTA / web-only / `minWebVersion` / `webBundle` 字样（实测 grep 0 命中），
  且受 28,672 B 体积门禁约束（改前 28,646 B，仅余 26 B），本次不动。

## 考虑过的方案

| 选项 | 为什么不选 |
|---|---|
| 只删 `--web-only` 发布模式，保留三件套随 APK 发布 | 三件套**同样无人消费**（无验签方、无加载方）。留着一个每次发版都白跑一遍打包签名、还要一把 OTA 私钥的产物，是持续的成本与误导。 |
| 发布侧与消费层一并删除 | 会让 `packages/app/src/**` 的 WebView 留存源码编译失败（依赖 `@pictelio/update-check` 的 web bundle API），并越过 #819 第 4 项的边界重复立项。 |
| 发布侧下线 + 消费层清理，单票做完 | 消费层清理涉及约 291 源文件 / 约 170 单测的存量清理，须重划 `check:all` / `test:all` 的 CI 范围并重跑全量门禁。**范围应按票切分**（同 ADR-0201 的「范围应按票切分，不在文档票里夹带代码重构」）。 |

## 与 ADR-0122 的关系

[ADR-0122](./ADR-0122-ota-self-built-switching.md)（OTA web bundle 切换机制自研而非引入
`@capgo/capacitor-updater`）被本 ADR **部分取代**：

- **发布侧通道部分失效**——其裁决所服务的「web 层热修不经 APK 重装」目标，在 Lynx 单引擎下
  已无实现路径。
- **消费侧设计记录仍作历史资料保留**——自研 vs capgo 的选型依据、四个生产坑的修复语义、
  Ed25519 验签与密钥保管的信任模型，仍是完整有效的决策史，**不删除、不改写**，
  按仓库惯例加存档横幅。

## 后果

- **`docs/release-checklist.md` 是活文档，正文真删**（不是加横幅）——它指导实际发版操作，
  留着已失效的 OTA 步骤会让人照着跑不存在的命令。
- **历史文档只加横幅，正文一字不改**：`docs/specs/ota-web-bundle.md`、
  `docs/research/ota-{minwebversion-gate,release-integration,ed25519-android,switching-mechanism}.md`
  与本 ADR 所取代的 ADR-0122。抹掉决策史的代价高于「读到过时描述」的代价。
- **`docs/research/mpa-remote-githubpages-feasibility.md` 结论作废**：其 §D 主张
  「走分层更新，先 spike 自研 OTA 最小闭环」，该动作已不存在。
- **删除后 `isBelowMin()` 成为恒空读**——消费层仍会解析 `version.json` 的 `minWebVersion` /
  `webBundle`，但字段已不再被写入，判定恒为「未低于门槛」。这是**留存的已知副作用**，
  消费层既无 Activity 承载也无用户可见路径，不构成运行期故障。
- **`buildVersionJson` 已换模块**——它从 `lib/release-webonly.mjs` 迁到 `lib/release-version-json.mjs`。
  后人若 grep 旧模块名找不到 `buildVersionJson`，那是搬家不是丢失。
- **消费层的设备级回归网随 `bench-ota.sh` 一起消失**——好包生效 / 坏签拒装 / 崩 10s 回滚 /
  门槛阻断这四个机制级场景，此后只剩 `tests/agent-browser/specs/ota-gate.test.ts` 的 JS 层面用例
  （原生桥不可达，机制链路无自动化覆盖）。鉴于消费层无 Activity 承载、无用户可见路径，可接受；
  真正需要机制级回归时，随 #819 第 4 项的 WebView 源码清理一并处理。
- **`openwiki/architecture/overview.md` 与 `openwiki/quickstart.md` 仍描述 web-only**——
  生成物，CI 定时重生成会收敛，**本次不处理**。
- **不设新的机器防线**：OTA 通道已无代码可被误路由到，「删干净」由本次 diff 自身保证；
  唯一新增的机器防线是 `release-build-steps.test.ts` 的反向守卫（步骤表不得再出现 web bundle 打包步），
  覆盖「`pnpm release` 调用已删脚本」这一具体回归。消费层代码若日后被误接线，
  其余检出口是 #819 第 4 项清理时的编译与测试。
