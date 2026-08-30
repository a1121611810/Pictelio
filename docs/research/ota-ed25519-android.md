# web bundle OTA 的 Android 侧 Ed25519 验签选型与密钥流程（minSdk 28）

> 调研日期：2026-08-30。对应 issue #242（Wayfinder 地图 #240 的调研子任务）。Node 侧签名已定用 `node:crypto` 内置 Ed25519（本题不再展开），本题只解三件事：Android 侧验签工具链选型、公钥内置方式与私钥保管流程、签名对象（zip 直签 vs 摘要签）。
>
> 一句话结论：**`java.security` 的 Ed25519 虽在 AOSP javadoc 里标注 "API 33+"，但实测 Android 15 仍抛 `NoSuchAlgorithmException`（Conscrypt 2025-01 才提交实现），minSdk 28 下必须捆绑验签库；推荐 BouncyCastle 的 lightweight API（`bcprov-jdk18on` 1.85.2，只调 `Ed25519Signer`，全程不注册 JCA provider，从根上避开 Android 内置裁剪版 BC 的冲突坑），jar 原始 10.28 MB 但 R8 后 dex 增量仅数十 KB 量级，Android 侧核心验签代码约 50-70 行；公钥用 BuildConfig 字段内置 base64 raw 32 字节（仓库已有 `CLIENT_KINDS` 的 `buildConfigField` 先例）；签名对象推荐「域分隔前缀 + SHA-256(zip) 摘要」的 hash-then-sign（两侧均可流式、内存 O(1)，且 SHA-256 兼作下载完整性快检），不做 RFC 8032 的 Ed25519ph。**

---

## 1. 背景与约束

- OTA 场景（issue #240）：检查 GitHub Releases → 下载 web bundle zip → Ed25519 验签 → 原子切换 → 回滚。验签发生在 **Android 原生侧**（Java），公钥需要内置于 APK。
- **minSdkVersion = 28**（`packages/app/android/variables.gradle` 实测；AGENTS.md「Android」节同款约定）；`compileSdkVersion = 36`。原型沙盒 `packages/app-nuxt/android/` 目前只有 Capacitor 同步产物（未入库 gradle 工程文件），落地时按主 app 的 minSdk 28 约束对齐。
- `packages/app/android/app/build.gradle` 已有 `buildConfig = true`（L61）与 `buildConfigField` 先例（`CLIENT_KINDS`，L29-39）——BuildConfig 方案在本仓库零新增基建。
- 私钥保管惯例参照 `docs/release-signing.md`：本地生成、环境变量注入密码、禁止入库（`packages/app/android/app/*.keystore` 已在根 `.gitignore` L32）、密码管理器 + 加密介质多重备份。
- 已定事实：Node 侧签名用 `node:crypto`（`crypto.sign(null, data, ed25519PrivateKey)`，EdDSA 要求 algorithm 传 null 且 one-shot，见 [Node.js crypto 文档](https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key)）。

---

## 2. Q1：`java.security` 的 Ed25519 到底什么时候可用？——文档说 33+，实测 Android 15 都不行

### 结论

这是本次调研最重要的**反转**：「Ed25519 自 API 33 起可用」是一个**文档承诺而非平台现实**，三个第一手来源拼出完整证据链：

1. **文档确实写了 33+**。AOSP `libcore/ojluni/src/main/java/java/security/Signature.java` 的 javadoc 标准名表格里，Ed25519 一行标注 `33+`（本轮从 android.googlesource.com 逐字核实）：
   ```
    *       <td>Ed25519</td>
    *       <td>33+</td>
   ```
2. **实现 2025-01 才进 Conscrypt**。JCA `Signature` 实际由平台安全 provider Conscrypt（`AndroidOpenSSL`）提供，而 Conscrypt 的 Ed25519 实现提交是 2025 年 1 月：`#1287 "Add support for Ed25519 to NativeCrypto"`（2025-01-16）、`#1297 "Add Ed25519 signatures to Conscrypt"`（2025-01-29）。更早的 issue #1265 里维护者原话：*"Conscrypt doesn't implement Ed25519 (yet!)"*。
3. **Android 15 实测仍失败**。Google Issue Tracker 399856239（2025-02-28 提交，2025-08-30 仍更新）标题即 *"ed25519 signature algorithm not supported for android 15"*：Android 15 AOSP（android-15.0.0_r5）上 CTS 用例抛 `java.security.NoSuchAlgorithmException: 1.3.101.112 Signature not available`，报告者原文：*"As per the documentation ... ed25519 signature shall be supported for API level >= 33, but still for android 15, it is not supported yet"*；Google 侧回应直接指向 PR #1297 作为修复。

也就是说：**API 33-35 的实机上 `Signature.getInstance("Ed25519")` 不可依赖**；修复（PR #1297）要等平台 Conscrypt（Mainline 模块）更新到含该实现的版本才落地，不构成 minSdk 28 下可编程的验证路径。

### Keystore 侧（顺带核实，本项目用不上）

- 官方 `PackageManager` 文档：`FEATURE_HARDWARE_KEYSTORE` 版本 **100** 对应 *"Hardware support for Ed25519 signature generation and X25519 key agreement"*，标注 *"API shipped in Android 13"*——这是**硬件 Keystore 层**的能力标记（且硬件依赖、厂商差异大）。
- 且 Keystore 返回的 Ed25519 公钥在 JCA 侧以 OID `1.3.101.112` 表示（`AndroidKeyStoreProvider` 硬编码，见 Conscrypt issue #1265 及其中给出的 BC 换 provider 绕行代码），默认 provider 依然验不了。
- 本项目**只验签不生成密钥**（公钥内置 APK、私钥在 Node 侧），完全不需要 Keystore 参与——Keystore 侧的能力边界与本题正交。

### 对 minSdk 28 的设备矩阵结论

| 设备 API | `Signature.getInstance("Ed25519")`（默认 provider） |
| --- | --- |
| 28-32（Android 9-12L） | 不可用 |
| 33-35（Android 13-15） | **文档声称可用，实测不可用**（issue 399856239） |
| 36+（Mainline 更新到含 PR #1297 的 Conscrypt 后） | 可用，但不能作为兼容性前提 |

**结论：Android 侧必须捆绑验签库，这不是「性能优化」而是「可用性必需」。**

### 来源

- AOSP libcore `Signature.java` javadoc（Ed25519 → 33+ 表格行，逐字核实）：https://android.googlesource.com/platform/libcore/+/refs/heads/main/ojluni/src/main/java/java/security/Signature.java
- Google Issue Tracker 399856239（Android 15 实测 `NoSuchAlgorithmException: 1.3.101.112 Signature not available`，正文与状态从页面内嵌 JSON 提取）：https://issuetracker.google.com/issues/399856239
- Conscrypt 提交历史（Ed25519 实现时间线）：https://github.com/google/conscrypt/pull/1287 、https://github.com/google/conscrypt/pull/1297
- Conscrypt issue #1265（维护者 *"doesn't implement Ed25519 (yet!)"*；Keystore 公钥以 OID 1.3.101.112 表示）：https://github.com/google/conscrypt/issues/1265
- Android 官方 `PackageManager`（FEATURE_HARDWARE_KEYSTORE version 100 = 硬件 Ed25519/X25519，"API shipped in Android 13"）：https://developer.android.com/reference/android/content/pm/PackageManager
- Conscrypt 2.6.0 release notes（standalone 工件 2026-07-08 起含 Ed25519）：https://github.com/google/conscrypt/releases

---

## 3. Q2：候选库对比

### 总表（体积均为 Maven Central 工件 `content-length` 实测，非估计值）

| 候选 | 最新版（发布/上传日期） | 工件体积（实测） | 传递依赖 | 维护状态 | API 面向 |
| --- | --- | --- | --- | --- | --- |
| **BouncyCastle `bcprov-jdk18on`** | **1.85.2（2026-08-07）** | **10,280,518 B（jar）** | 无 | **活跃**（bcgit/bc-java 推送至 2026-08-29；release notes 明确跟踪 Android 兼容） | lightweight API，**免 provider 注册** |
| Google Tink `tink-android` | 1.23.0（2026-07-09） | 3,320,451 B（jar；1.16.0 起由 AAR 改为纯 jar） | gson + 注解库 | 活跃（tink-java 近一年 5 个 release：1.19.0 2025-10-21 → 1.23.0 2026-07-09） | keyset 中心（`KeysetHandle` + `PublicKeyVerify`）；keys API 可导入 raw 32B 公钥 |
| Conscrypt `conscrypt-android` | 2.6.3（2026-08-21） | 5,013,417 B（AAR，**含多 ABI native so**） | 无 | 活跃；2.6.0（2026-07-08）起 standalone 也支持 Ed25519 | 标准 JCA `"Ed25519"`，需插入 provider |
| str4d EdDSA-Java（`net.i2p.crypto:eddsa`） | 0.3.0（2018-05-05） | 63,292 B（jar） | 无 | **停更**：最后 release 2018 年，仓库最后推送 2023-08-12（未归档，233 star） | 自带 `EdDSA` provider + `EdDSAEngine` |
| 手写 ref10 移植 | — | 0 依赖 | — | — | ~2-3k 行 51-bit limb 域运算 + 点运算，需自证 constant-time 与正确性 |

### 3.1 BouncyCastle（推荐）

- **体积**：jar 10.28 MB 看着吓人，但本项目只引用 Ed25519 一个点：`org.bouncycastle.math.ec.rfc8032.Ed25519` 主类 class 文件实测 **22,517 B**（加内部类约 30 KB）+ `Ed25519Signer` 2,246 B + 依赖闭包里的 `SHA512Digest` 等工具类。R8 全量混淆下未引用代码整体剔除，**dex 增量为数十 KB 量级**（未做实机 R8 实测，此为按 class 字节合计的量级估计，实施 ticket 应以 `apkanalyzer` 复核）。
- **API 形态（源码逐行核实）**：`Ed25519Signer` 是纯 lightweight API——`init(boolean, CipherParameters)` / `update(byte b)` / `update(byte[], int, int)` / `verifySignature(byte[])`；`Ed25519PublicKeyParameters(byte[] buf)` 直接吃 raw 32 字节公钥，**不需要 KeyFactory / SPKI 解码 / provider 注册**。还有更轻的静态入口 `org.bouncycastle.math.ec.rfc8032.Ed25519.verify(byte[] sig, int sigOff, byte[] pk, int pkOff, byte[] m, int mOff, int mLen)`（L1659-1675，全静态、零对象分配）。
- **Android 内置裁剪版 BC 的著名坑——核实结果与本方案的绕行**：
  - 官方博客《Cryptography changes in Android P》原文：*"Starting in Android P, we plan to deprecate some functionality from the BC provider"*（理由：与 Conscrypt 重复：*"having duplicated functionality imposes additional costs and risks while not providing much benefit"*），并预告未来整体移除。
  - developer.android.com 密码学页原文：*"The Bouncy Castle implementations of many algorithms are deprecated. This only affects cases where you explicitly request the Bouncy Castle provider"*。
  - 历史包袱：Android 曾内置裁剪版 BC（SpongyCastle 仓库描述原文：*"a repackage of Bouncy Castle for Android (which ships a crippled version of BC)"*——同名包冲突是 SpongyCastle 诞生的原因）。
  - **关键绕行**：以上坑全部只在「把 BC 注册为 JCA provider / 指定 `"BC"` provider」时触发。lightweight API（`org.bouncycastle.crypto.*`）**根本不经过 provider 体系**，与系统内置 BC 零交互——坑被结构性消除。
- **打包风险（一项，可控）**：`bcprov-jdk18on` 是 multi-release jar，实测内含 `META-INF/versions/9/OSGI-INF/MANIFEST.MF` 与 `module-info.class`；历史上 AGP 打包对 MRJAR 的 `META-INF/versions/9` 目录报过重复路径冲突。若构建报错，`packaging { resources { excludes += "META-INF/versions/9/**" } }` 一行解决（版本化目录对 Android 运行时本就无效，剔除无副作用）。
- **维护活跃度（第一手）**：`bcgit/bc-java` 推送时间 2026-08-29（调研当日）；官网 1.85 release notes 甚至在修 Android 兼容细节：*"BigInteger.intValueExact and friends are missing on Android below API level 33 (github #2369)"*——说明 BC 在主动跟踪 minSdk < 33 的 Android 场景。
- **正确性背书**：BC 的 Ed25519 与 RFC 8032 测试向量对拍（`rfc8032` 包名即表明按 RFC 实现）；项目测试侧可再用 [Wycheproof](https://github.com/google/wycheproof) 的 Ed25519 向量做 oracle（符合仓库「oracle 溯源」测试约束）。

### 3.2 Google Tink（备选，一句话：能用但杀鸡用牛刀）

- **体积**：1.23.0 jar 3.32 MB（1.16.0 起从 AAR 改为纯 jar，POM `<packaging>jar</packaging>` 已核实）；传递依赖 gson；jar 内 1,878 个 class，自带 proguard 规则（`META-INF/proguard/protobuf.pro`）。R8 后估 ~1 MB 级（量级估计，实施时以 apkanalyzer 复核）。
- **维护**：非常活跃——tink-java 2025-10 到 2026-07 连发 1.19.0/1.20.0/1.21.0/1.22.0/1.23.0 五个版本（GitHub releases 日期实测）。
- **API 形态（官方示例源码核实）**：`SignatureConfig.register()` → `TinkJsonProtoKeysetFormat.parseKeyset(json, ...)` → `handle.getPrimitive(RegistryConfiguration.get(), PublicKeyVerify.class)` → `verifier.verify(signature, msg)`。设计围绕 **keyset 管理**（密钥轮换、key id、output prefix），而本项目是「单把内置公钥、无轮换」的极简场景，keyset ceremony 属于纯负担。
- **raw key 导入**：keys API 的 `Ed25519PublicKey`（tink-java 源码核实：构造即校验 32 字节长度）可以从 raw 32 字节公钥构建，但要再包一层 `KeysetHandle` 才能取 primitive——与 node:crypto 的 raw/SPKI 互操作多两层间接。
- **何时选它**：如果未来想要 Google 官方维护背书、或 OTA 体系升级为多密钥/keyset 轮换/远端密钥分发，Tink 的抽象才开始回报。

### 3.3 conscrypt-android（不推荐）

标准 JCA `"Ed25519"` API 很诱人（2.6.0 起支持），代价是 5.01 MB AAR（多 ABI native so，arm64/armv7/x86/x86_64 各一份）+ 需要 `Security.insertProviderAt()` 插桩（provider 顺序影响全局密码学行为，与仓库既有 `capacitor-secure-storage-plugin` 等组件的 provider 假设存在交互风险）。只为一个验签点引入 native 密码学栈，体积/风险比最差。

### 3.4 str4d/eddsa（不推荐）

63 KB、public domain、ref10 移植（README 原文：*"Structurally, it is based on the ref10 implementation in SUPERCOP"*），一切都很美——除了**8 年没发版**（0.3.0，2018-05-05）、仓库最后推送 2023-08。密码学库的「停更」不是中性问题（漏洞响应通道消失），新引入不成立；且它相比 BC lightweight 没有额外收益（BC 同样免 provider、体积经 R8 后同量级）。

### 3.5 手写 ref10（不推荐，理由存档）

ref10 是 SUPERCOP 参考实现的 51-bit limb 域运算 + 扭曲爱德华兹曲线点运算，移植量级 2-3k 行；难点不在行数而在：constant-time 纪律（每条分支/内存访问都要防时序泄漏）、边界情况（非规范编码点、malleable S）、以及无交叉验证语料时的自证困难。BC/Tink/eddsa 的实现均源自 ref10 系且互相有 RFC 向量对拍——重复造这个轮子只有负期望，仓库「先渲染后加载/全局最优」的工程原则下更没有立足点。

### 选型结论

**主案：`org.bouncycastle:bcprov-jdk18on:1.85.2`，只用 lightweight API（`Ed25519Signer` 或静态 `rfc8032.Ed25519.verify`），不注册任何 JCA provider。**
备选：`tink-android`（当且仅当未来需要 Tink 的 keyset 管理/官方背书）。

Android 侧验签核心代码（基于已核实的 BC 源码 API，约 50-70 行含外围）：

```java
// implementation("org.bouncycastle:bcprov-jdk18on:1.85.2")
import org.bouncycastle.crypto.signers.Ed25519Signer;
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters;

/** 验签：domainSep 前缀 + SHA-256(bundle) 的 64 字节 Ed25519 签名 */
static boolean verifyBundle(byte[] rawPublicKey32, byte[] domainSepPrefix,
                            InputStream bundleStream, byte[] signature64) throws Exception {
    byte[] digest = sha256WithPrefix(domainSepPrefix, bundleStream); // DigestInputStream 流式，内存 O(1)
    Ed25519Signer verifier = new Ed25519Signer();
    verifier.init(false, new Ed25519PublicKeyParameters(rawPublicKey32, 0)); // raw 32B，无需 provider/KeyFactory
    verifier.update(digest, 0, digest.length);
    return verifier.verifySignature(signature64);
}
```

代码量估计：Android 验签类（含 base64 解码、域分隔常量、流式 SHA-256、错误暴露）约 **50-70 行**；Node 签名脚本约 **30 行**（见 §5）；对比手写 ref10 的 2-3k 行 + 自证负担。

### 来源

- Maven Central 工件实测（本轮 `curl -sI` content-length）：[tink-android 1.23.0](https://repo1.maven.org/maven2/com/google/crypto/tink/tink-android/1.23.0/tink-android-1.23.0.jar) 3,320,451 B、[bcprov-jdk18on 1.85.2](https://repo1.maven.org/maven2/org/bouncycastle/bcprov-jdk18on/1.85.2/bcprov-jdk18on-1.85.2.jar) 10,280,518 B、[eddsa 0.3.0](https://repo1.maven.org/maven2/net/i2p/crypto/eddsa/0.3.0/eddsa-0.3.0.jar) 63,292 B、[conscrypt-android 2.6.3](https://repo1.maven.org/maven2/org/conscrypt/conscrypt-android/2.6.3/conscrypt-android-2.6.3.aar) 5,013,417 B
- BC 源码（github.com/bcgit/bc-java，`master`）：[Ed25519Signer.java](https://github.com/bcgit/bc-java/blob/master/core/src/main/java/org/bouncycastle/crypto/signers/Ed25519Signer.java)（`init/update/verifySignature` + 内部 `Buffer` 缓冲）、[Ed25519.java](https://github.com/bcgit/bc-java/blob/master/core/src/main/java/org/bouncycastle/math/ec/rfc8032/Ed25519.java)（静态 `verify` L1659）、[Ed25519PublicKeyParameters.java](https://github.com/bcgit/bc-java/blob/master/core/src/main/java/org/bouncycastle/crypto/params/Ed25519PublicKeyParameters.java)（`byte[]` 构造器）
- BC 维护活跃度：`gh api repos/bcgit/bc-java`（pushed_at 2026-08-29）；[BouncyCastle 官网 Java release notes](https://www.bouncycastle.org/java.html)（1.85 节 Android API 33 兼容修复引用 github #2369，原文本轮核实）
- Android P 弃用内置 BC：[Cryptography changes in Android P](https://android-developers.googleblog.com/2018/03/cryptography-changes-in-android-p.html)（引语见正文）；[Android 密码学页 BC 弃用条目](https://developer.android.com/privacy-and-security/cryptography)
- SpongyCastle（裁剪版 BC 历史佐证）：https://github.com/rtyley/spongycastle （仓库描述原文）
- Tink：[tink-java releases](https://github.com/tink-crypto/tink-java/releases)（1.19.0-1.23.0 日期）、[官方 SignatureExample.java](https://github.com/tink-crypto/tink-java/blob/main/examples/signature/SignatureExample.java)（`SignatureConfig.register()` + `TinkJsonProtoKeysetFormat` + `PublicKeyVerify` 用法）、[Ed25519PublicKey.java](https://github.com/tink-crypto/tink-java/blob/main/src/main/java/com/google/crypto/tink/signature/Ed25519PublicKey.java)（32 字节约束 + `getPublicKeyBytes`）
- Wycheproof Ed25519 测试向量（实施 ticket 的 oracle 来源）：https://github.com/google/wycheproof

---

## 4. Q3：公钥内置方式与私钥流程

### 4.1 公钥内置：BuildConfig 字段（推荐）

| 方式 | 优点 | 缺点 | 判定 |
| --- | --- | --- | --- |
| **BuildConfig 字段** | 编译期常量、零文件 IO、类型安全；**本仓库已有先例**（`CLIENT_KINDS`，且 `buildConfig = true` 已开启）；gradle 侧可在 config 阶段校验解码后长度 = 32 | 换 key 需重新构建（OTA 场景换 key 本来就要发 APK，无额外代价） | **推荐** |
| string resource（`resValue` / strings.xml） | 不依赖 BuildConfig；flavor 可覆盖 | 运行时查找；语义上是「文案」不是「配置常量」；同样需重构建才能换 | 可用，次选 |
| assets 文件（PEM/b64） | 天然支持 PEM 原文、**可放多把 key（轮换过渡期双 key 并验）**、可用 AssetManager 流式读 | 文件 IO + 解析代码；文件名/路径成为隐式契约 | v1 不用；将来做密钥轮换过渡时再迁 |

**v1 落地形态**（对齐 `CLIENT_KINDS` 先例）：

```groovy
// packages/app/android/app/build.gradle
defaultConfig {
    buildConfigField "String", "OTA_ED25519_PUBLIC_KEY_B64", '"<base64 of 32-byte raw pubkey>"'
}
```

- 公钥编码选 **raw 32 字节的 base64**（而非 SPKI/PEM）：BC 的 `Ed25519PublicKeyParameters(byte[])` 直接吃 raw 字节，Android 侧连 DER 解析都省掉。Node 侧导出方式已本地实测（Node 22）：`publicKey.export({ format: "der", type: "spki" })` 得到 44 字节 SPKI，**固定前缀 `302a300506032b6570032100` + 32 字节 raw**，取 `subarray(12)` 即 raw。若将来需要 SPKI（如用 API 33+ 的 `KeyFactory`），补回前缀即可。
- **公钥指纹核验**（issue 问题的第三点）：生成时同时输出 `SHA-256(raw 公钥 32B)` 指纹，三处落地——① 记录进本文档/release checklist（带日期）；② 构建期校验（gradle task 断言 `Base64.getDecoder().decode(buildConfigValue).length == 32`，防手滑截断）；③ 可选在 About/Debug 页展示 app 内置公钥指纹（仓库已有 `DebugImage.tsx` 这类开发者诊断页先例），与文档中指纹肉眼比对。指纹让「APK 里装的到底是不是文档里那把 key」随时可验，是公钥（公开物）的防呆手段而非保密手段。

### 4.2 私钥生成与保管（对齐 docs/release-signing.md 的行文与惯例）

**生成**（本地，一次性，Node 路线免装 openssl 也可用 openssl 等价生成）：

```bash
# Node 路线（实测通过，Node 22）
node -e '
const { generateKeyPairSync } = require("node:crypto");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
require("fs").writeFileSync(process.env.HOME + "/.pictelio-keys/ota-ed25519-private.pem", privateKey.export({ format: "pem", type: "pkcs8" }));
const spki = publicKey.export({ format: "der", type: "spki" });
console.log("raw pubkey b64:", spki.subarray(12).toString("base64"));
console.log("fingerprint  :", require("node:crypto").createHash("sha256").update(spki.subarray(12)).digest("hex"));
'
# openssl 等价路线
openssl genpkey -algorithm ed25519 -out ~/.pictelio-keys/ota-ed25519-private.pem
openssl pkey -in ~/.pictelio-keys/ota-ed25519-private.pem -pubout -outform DER -out /tmp/pub.der
openssl dgst -sha256 /tmp/pub.der   # 指纹（SPKI 口径）
tail -c 32 /tmp/pub.der | base64    # raw 公钥 → BuildConfig
```

**保管规则**（逐条对照 release-signing.md 惯例）：

1. **永不入库**：私钥放仓库外（`~/.pictelio-keys/`），同时兜底在根 `.gitignore` 增加显式规则（当前根 `.gitignore` 只有 `packages/app/android/app/*.keystore`，无 pem 规则）：
   ```gitignore
   # OTA web bundle 签名私钥（永不入库，见 docs/research/ota-ed25519-android.md）
   **/ota-ed25519-private.pem
   ```
2. **与 release keystore 严格分离**：OTA 签名 key 与 APK 签名 keystore 不共钥、不共密码、不共备份介质——两者失陷的影响面与处置方式完全不同（keystore 失陷 = 冒充 app 身份；OTA key 失陷 = 冒充 bundle 内容，可通过换 key + 发版止血）。
3. **多重备份**：私钥 + 指纹记录分别存至少两个安全位置（密码管理器条目 + 加密 U 盘），与 release-signing.md 第 7 节同款要求；指本质上是公开物，可明文入文档，但**私钥丢失 = 已发布 APK 内置公钥作废**，必须备份。
4. **CI**：v1 签名随 `pnpm release` 本地执行，无需 CI 密钥；若未来 CI 需要签名，走 GitHub Secrets 注入 PKCS8 base64（`secrets.PICTELIO_OTA_SIGNING_PRIVATE_KEY`），命名风格对齐现有 `PICTELIO_KEYSTORE_PASSWORD`。
5. **轮换预案**（v1 不实现，预留语义）：BuildConfig 换成 assets 多 key 或版本化 key id 前 `keyId || signature` 前缀均可；前提是签名格式（见 §5）从一开始就带版本化域分隔前缀。

### 来源

- 仓库本地第一手：`packages/app/android/variables.gradle`（minSdk 28）、`packages/app/android/app/build.gradle` L29-39（`CLIENT_KINDS` buildConfigField 先例）、L61（`buildConfig true`）、根 `.gitignore` L32（keystore 规则现状）、`docs/release-signing.md`（生成/环境变量/备份章节结构）
- Node 侧导出格式：本轮本地实测（Node 22.22，`node:crypto`，SPKI 44 B、前缀 `302a300506032b6570032100`、签名 64 B、篡改验证返回 false）；`crypto.sign` 的 EdDSA 用法参考 https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key
- BC raw key 构造器：https://github.com/bcgit/bc-java/blob/master/core/src/main/java/org/bouncycastle/crypto/params/Ed25519PublicKeyParameters.java

---

## 5. Q4：签名什么内容——推荐「域分隔前缀 + SHA-256(zip) 摘要」的 hash-then-sign

### 结论

**推荐**：对 `SHA-256(zip 字节流)` 加域分隔前缀后做 PureEdDSA 签名，即签名输入为：

```text
sign_input = "Pictelio-OTA-bundle-v1\n" || SHA-256(bundle.zip)     // 24 + 32 = 56 字节
signature  = PureEdDSA_Ed25519(sign_input)                          // 固定 64 字节
```

**不推荐 zip 字节流直签**，三个第一手依据：

1. **PureEdDSA 天然要求整条消息**。RFC 8032 §4 原文：*"PureEdDSA requires two passes over the input"*（先算 `r = H(prefix || M)`，再算 `h = H(R || A || M)`，见 §3.3/3.4 的两处 `H(... || M)`）。任何库都无法真正流式验证。
2. **主流 Java 实现确实整包进内存**。BC `Ed25519Signer` 源码内部是一个 `Buffer`，`update()` 只是把字节追加进缓冲（L17/L50-58，本轮核实）；Tink 的 `PublicKeyVerify.verify(signature, msg)` 也是整段 `byte[]`。几 MB 的 zip 直签意味着 Android 侧下载后还要整包驻留内存；摘要签则两侧都能流式（Android 用 `DigestInputStream` 边落盘边算，内存 O(1)）。
3. **免费获得完整性快检**。签名文件里同时携带的 `sha256` 可在解压前先对下载产物做一次快速完整性校验（下载中断/CDN 截断早失败），失败就不必进入昂贵的验签分支。

**为什么不是 RFC 8032 的 Ed25519ph（标准 prehash 变体）**：Ed25519ph 把 PH 固定为 SHA-512 且带专用域分隔（RFC 8032 §5.3、§7.3 测试向量），`node:crypto` 对 Ed25519 只提供 one-shot PureEdDSA（`crypto.sign` 首参必须为 null），不支持 Ed25519ph——用 Ed25519ph 意味着 Node 侧要手搓 prehash 协议，两端还要各自实现。自定义「SHA-256 + 域分隔」的 hash-then-sign 是语义等价、两端零额外实现的形态（RFC 8032 §4 本身把「PureEdDSA 签 PH(M)」作为 EdDSA 的通用定义：*"EdDSA simply uses PureEdDSA to sign PH(M)"*）。

**两个工程要点**：

- **域分隔前缀不是可选项**。裸签 32 字节 SHA-256 摘要会让签名在「任何以 32 字节消息为输入的协议」间可重放/可移植（跨协议混淆面）；固定 ASCII 前缀 `"Pictelio-OTA-bundle-v1\n"` 把签名唯一绑定到本 OTA 体系。版本号进前缀还顺带解决将来改签名格式时的版本判定。
- **落地形态建议直接签 manifest**：把 `{ "version": ..., "size": ..., "sha256": ... }` 的紧凑 JSON 作为被签字节串（manifest 本身作为 release asset 与签名 `.sig` 一起发布），与「签摘要」等价且天生可扩展（将来加 `minApkVersion` 等字段不用改签名方案）；hash-then-sign 的碰撞韧性让渡（安全性绑定 SHA-256 而非 PureEdDSA 的碰撞韧性，RFC §4 明确讨论过该 trade-off）在「只验自己签的包」的封闭场景不构成实际风险。若追求与 Ed25519ph 的对称性，把摘要换 SHA-512 即可，两端实现同样一行——v1 选用 SHA-256 是为了与下载完整性校验复用同一次流扫描。

Node 侧（已本地实测通过：签名 64 B、验证 true、篡改 false）：

```js
import { createHash, sign, verify } from "node:crypto";
const DOMAIN = Buffer.from("Pictelio-OTA-bundle-v1\n");
const digest = createHash("sha256").update(zipBytes).digest();
const signature = sign(null, Buffer.concat([DOMAIN, digest]), privateKey); // EdDSA：algorithm 必须为 null
```

### 来源

- RFC 8032（rfc-editor.org 全文逐段核实）：§3.3（*"The EdDSA signature of a message M under a private key k is defined as the PureEdDSA signature of PH(M)"*）、§3.4（验证方程两处依赖完整 M）、§4（*"PureEdDSA requires two passes over the input"*、PH(M) = SHA-512(M) 的 HashEdDSA 定义）、§5.3 与 §7.3（Ed25519ph）：https://www.rfc-editor.org/rfc/rfc8032
- BC `Ed25519Signer` 内部整包缓冲（`Buffer` 成员 + `update` 追加实现）：https://github.com/bcgit/bc-java/blob/master/core/src/main/java/org/bouncycastle/crypto/signers/Ed25519Signer.java
- Node `crypto.sign` EdDSA one-shot 约定：https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key
- 本地实测（2026-08-30，Node 22）：签名/验签/篡改拒绝 + SPKI 格式，命令与输出见 §4.2

---

## 6. 结论速查（对齐 issue #242 Question 的逐问回答）

| 问题 | 回答 |
| --- | --- |
| 验签库选型 | **`org.bouncycastle:bcprov-jdk18on:1.85.2`，仅用 lightweight API（`Ed25519Signer` / 静态 `rfc8032.Ed25519.verify`），不注册 JCA provider**；备选 `tink-android 1.23.0`（需要 Google 官方背书/keyset 轮换时） |
| `java.security` Ed25519 边界 | javadoc 声称 API 33+，**实测 Android 15 仍 `NoSuchAlgorithmException`**（Conscrypt 2025-01 才实现）；minSdk 28 下捆绑库是必需品 |
| 依赖体积 | bcprov jar 原始 10.28 MB（Maven Central 实测）；本项目仅引用 Ed25519，R8 后 dex 增量约数十 KB（量级估计，实施时 `apkanalyzer` 复核）；tink-android jar 3.32 MB + gson，R8 后约 1 MB 量级 |
| Android 侧代码量 | 验签类约 50-70 行（含 base64/域分隔/流式 SHA-256）；Node 签名脚本约 30 行；手写 ref10 约 2-3k 行且需自证（否决） |
| 公钥内置 | **BuildConfig 字段**（`buildConfigField`，base64 raw 32B；仓库已有 `CLIENT_KINDS` 先例）；指纹 = SHA-256(raw key)，文档 + 构建期长度校验 + 可选 Debug 页展示三重核验；将来轮换过渡再迁 assets 多 key |
| 私钥流程 | 本地 `node:crypto`/openssl 生成 → 私钥存仓库外 `~/.pictelio-keys/` + 显式 `.gitignore` 兜底 → 与 release keystore 严格分离 → 双介质备份；CI 签名（如未来需要）走 `PICTELIO_OTA_SIGNING_*` Secrets |
| 签名对象 | **域分隔前缀 + SHA-256(zip) 摘要**的 hash-then-sign（或直接签含 sha256 的 manifest JSON）；不做 zip 直签（PureEdDSA 两遍扫描 + Java 实现整包缓冲）也不做 Ed25519ph（Node 不支持、SHA-512 专用域分隔） |
| 测试 oracle | RFC 8032 §7.1 官方测试向量 + Wycheproof Ed25519 向量（符合仓库「oracle 溯源」测试约束；Node 侧生成物与 Android 侧互验可作差分测试） |
