# ADR-0172: app-lynx 运行时 Web API 面约束（PrimJS 缺项与收口）

- **状态**：accepted（2026-09-19）
- **日期**：2026-09-19
- **关联**：wayfinder map #617（app-lynx 端小说翻译）/ ADR-0050（lynx 持久化）/ ADR-0051（lynx 双通道）/ ADR-0163（平台事实取证模式）/ ADR-0170（PictelioTranslate native bridge）/ ADR-0171（翻译缓存）

---

## 背景

app-lynx 的 JS 运行在 Lynx 的 **PrimJS** 引擎里，与 web-core 预览（浏览器 Worker）**不是同一套 API 面**。
翻译功能落地过程中，同一类缺陷连续出现三次：代码在 web-core / node 测试里全绿，真机上却**同步抛错或永久挂起**——
因为用到了 PrimJS 不提供的 Web API。

真机取证（2026-09-19，emulator-5554 + debug APK；观测通道 = `PictelioPrefs` 写 SharedPreferences，
`adb shell run-as io.pictelio.app cat shared_prefs/CapacitorStorage.xml` 读回——生产 bundle 的 lynx console
在真机 logcat 不可见，故不能依赖 `console.log` 取证）：

| API | web-core / node | Lynx PrimJS（真机） |
|---|---|---|
| `TextEncoder` / `TextDecoder` | 有 | **undefined**（2026-09-11 WebDAV 备份链路已实测一次） |
| `crypto` / `crypto.randomUUID` | 有 | **undefined** |
| `indexedDB` | 有 | **undefined** |
| `confirm`（浏览器弹窗） | 有 | **undefined** |
| `URL.hostname` | 正常语义 | 不抛错但 `.hostname === undefined`（ADR-0163 已取证） |

后果（均已复现）：

1. `translationCache.fnv1a32` 用 `new TextEncoder()` → 真机 `ReferenceError` → `translateChapter` 同步段中断，
   按钮永久停在「0% 翻译中」（用户可见的挂起，且 UI 无任何错误提示，因为状态在异常前已置 `pending`）。
2. `nativeTranslate.translateStream` 用 `crypto.randomUUID()` → 翻译请求根本发不出去。
3. 翻译缓存整体依赖 `indexedDB` → 真机缓存永远 miss（功能降级但不可见）。
4. `SettingsEndpoint` 的 URL 校验用 `new URL(v).protocol` → 合法地址被判非法。

## 决策

### 1. 纯 JS 实现收口为单一事实源

- UTF-8 编解码：`packages/app-lynx/src/utils/utf8.ts`（`utf8Encode` / `utf8Decode`，含代理对）。
  `translationCache.fnv1a32` 与 `backupCore`（快照序列化）都从这里取——**禁止各自复制一份**
  （此前正是两个模块各写一份、其中一个漏了纯 JS 化才复发）。
- 流 ID：`nativeTranslate.newStreamId()` —— 有 `crypto.randomUUID` 时用标准 UUID，
  无 `crypto` 时降级为「时间戳 + 会话内单调序号」。该 ID 只要求在同一 JS 会话 +
  Java `ACTIVE_CALLS` 注册表内唯一（不要求 UUID 形态）。

### 2. 环境适配走既有 seam，不做能力探测式兜底

持久化统一走项目的 `isNativeMode() ? nativePrefs() : devPrefs()` 模式（ADR-0103）：
原生 = `PictelioPrefs`（SharedPreferences）/ 预览 = `idbKV`。翻译缓存层在 native 模式下**整体跳过**
（`isIdbAvailable()` 短路），不做「探测超时 + 兜底」——真机上 `indexedDB.open` 的事件与 `setTimeout`
都不可靠，超时兜底反而制造「看起来在工作」的假象。native 缓存通道（走 Prefs / Keystore）留待后续 ticket。

### 3. URL 解析唯一入口

业务判定一律经 `utils/safeParseUrl.ts`（`extractHostname` / `extractAuthority`），**禁用 URL 全局**；
`PlatformCheck.vue` 的守卫测试锁死该边界（`new URL` 只允许出现在探针函数体内）。

### 4. 平台事实常驻可见

`PlatformCheck.vue`（benchNav 深链可达的 debug 页）新增矩阵项：探测 `TextEncoder` / `TextDecoder` /
`crypto` / `indexedDB` / `confirm` 的存在性并如实展示 present/missing。缺项**不判 FAIL**
（业务已收口，缺项是平台事实而非缺陷）。

## 后果

- 正面：三处真机崩溃/挂起被消除；新增代码有单一事实源可依赖；平台事实有常驻观测面，同类缺口不必再靠真机盲试定位。
- 代价：纯 JS UTF-8 编码比 `TextEncoder` 慢（翻译链路上只对小字符串做哈希，实测无感）；
  native 模式下翻译缓存不生效（缓存 miss → 每次重译；已挂账 native 通道）。
- 约束：**新增依赖 Web API 的代码必须在真机验证**，或用 `typeof` 探测 + 纯 JS 降级；
  单测在 node 下通过不能作为跨端证据（node 有这些 API）。
