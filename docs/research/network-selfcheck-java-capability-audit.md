# Java 侧网络自检能力与暴露面审计（issue #440）

> 调研日期：**2026-09-11**
> 对象：Pictelio（`pictelio-app` WebView/SolidJS + `pictelio-app-lynx` Lynx/vue-lynx，单 APK 双引擎；执行层计划放 Java，复用 `PixivApiCore` 的 OkHttp）
> 任务：核实「Java 执行层到底能测什么、现有状态能暴露什么」，为 #441（L0–L6 检查项契约）与 #442（共享包 / Java bridge 契约）提供能力事实。
> 方法：以**本仓库源码**（工作树 + git 历史）与**官方一手元数据/源码**（Android SDK `api-versions.xml` / `annotations.zip`、OkHttp 4.12 源码、RFC）为准；每条结论附来源位置或 URL。
> 三档口径（全文统一）：**【已有能力】**=当前工作树已存在、可直接调用；**【需新增】**=当前不存在但技术上可做，需写代码/加依赖/加权限；**【做不到】**=受平台、协议或当前架构限制无法实现（或前提已不存在）。
>
> 重要：本文与该 issue 的前提存在硬冲突，见第 0 节，请先读第 0 节再读其余各节。

---

## 0. 必须先读：issue #440 的前提在当前树已不成立（直连功能已被整体移除）

issue #440 第 1、2、3、6、7 条大量引用 `DirectAccessPolicy` / `directAccessStatus()` / `ChannelCircuitBreaker` / `IpTableFetcher` / `SniStrippingSSLSocketFactory`。**这些代码在当前 HEAD 与 `main` 上都不存在。**

事实链（均为一手核验）：

1. 移除提交：`bf32620e1717cc154837ac3c94cb29afee063d6b`（2026-09-08 21:33:54 +0800，`refactor(app): 彻底移除网络直连功能，回归官方域基线`）。
   - `git merge-base --is-ancestor bf32620e HEAD` 与 `... main` 均返回 0（= 已并入两者）。
   - 提交说明原文：用户最终决策「一刀切移除所有网络直连相关功能（不保留直连、不保留反代）……网络可达性交给用户自身网络环境（系统代理/VPN）」；背景是「OPPO 真机（Android 9 Conscrypt）实测 GFW 对无 SNI ClientHello 指纹级 100% RST，纯客户端直连在强 GFW 环境不可用」。
   - `git show --stat bf32620e`：20 个文件、-5447 行。删除 8 个 Java 主源文件（`directaccess/` 子包：`DirectAccessTransport`、`DirectAccessConfig`、`DirectAccessPolicy`、`DirectAccessInitProvider`、`ChannelCircuitBreaker`、`DirectIpTableDefaults`、`IpTableFetcher`、`IpTableMerger`）、6 个 directaccess 测试文件（提交说明称 93 个用例）、4 个 TS 文件（`SettingsDirectAccess.tsx`、`directAccessStore.ts`、`src/native/DirectAccess.ts` 及 2 个对应单测）、ADR-0144 直连 ADR；并从 `PixivApiCore.getClient()`、`PixivApiPlugin`、`AndroidManifest.xml`、`SettingsSections.tsx` 清理接线。
2. 当前工作树核验：
   - `packages/app/src/native/DirectAccess.ts` **不存在**；`packages/app/src/native/` 下无任何直连文件。
   - 对 `packages/app/android/app/src`、`packages/app/src`、`packages/app/tests` 全量 grep `DirectAccess|directAccess|ChannelCircuitBreaker|IpTableFetcher|SniStripping`（排除 `/build/`）**命中 0**。
   - 当前 `PixivApiCore.java` 的 `getClient()` 是纯 `OkHttpClient.Builder`（超时/Dispatcher），没有任何自定义 `Dns`/`SSLSocketFactory`/`EventListener`/`Interceptor`；全 Java 源码 grep `okhttp3.Dns|EventListener|SSLSocketFactory|X509TrustManager|ConnectionPool` **命中 0**。
   - 当前 `PixivApiPlugin.java` 只有 4 个 `@PluginMethod`（`request` / `syncToken` / `setAccessToken` / `prefetchImage`），**没有** `directAccessStatus` / `directAccessCommand`。
   - `AndroidManifest.xml` 只有 `INTERNET` 权限（第 62 行），**没有** `DirectAccessInitProvider`。
3. 文档滞后（会误导下游）：`openwiki/architecture/direct-access.md` 仍在工作树中、仍以现在时描述该功能（第 22–33 行组件表、第 35–57 行门序、第 109 行 IP 表、第 113 行 JS bridge），并链接 `/docs/adr/ADR-0144-...`——该 ADR 文件已被同一提交删除，且编号 0144 已被 `docs/adr/ADR-0144-solidjs-2-migration.md` 复用（编号冲突）。
4. 同一研究线的姊妹文档 `docs/research/network-self-check-patterns.md`（未跟踪）第 596–605、636、651 行同样把直连/熔断当作**现有**资产；下游引用时需以本文为准修正。

### 影响（对 issue #440 的直接结论）

- 第 1 条「现有可读状态（零成本层）」在当前树上是 **【做不到】**：没有运行时状态可读。要恢复这一层，必须先做出「是否重新引入直连/路由层」的产品决策（#437 的 Decisions so far 未包含此决策）。
- 历史实现（v1）仍可从 git 读取，作为「如果要重建」的参考：`bf32620e^` 即最后保留直连 v1 的提交；分支 `fix/auth-resilience-393` 上还有更晚的「直连 v2 + 反代」实现（含 421 记账/多候选竞速）。这些都不在当前树。
- 第 2/3 条对 OkHttp 钩子的调研、第 4 条平台位、第 5 条 DoH、第 6 条 ProbeFn、第 7 条既有覆盖，**不依赖直连代码**，结论照常成立。

> 下文凡引用 `bf32620e^` 的文件行号，均指**历史版本**（删除前最后一版），已明确标注；引用 `packages/app/...` 未标注者指当前工作树。

---

## 结论速览

| # | 问题 | 三档结论（当前树） | 关键依据 |
|---|---|---|---|
| 1 | 现有可读状态：路由决策 / `directAccessStatus()` / 熔断相位计数冷却 / IP 表三层与刷新时间 | **做不到**（代码已删）；若重建则其中「按域决策、相位、条数、来源摘要、刷新时间」为**需新增**（历史已有实现可参考）；「失败计数、冷却剩余、按层条数、按请求路由」历史上也**需新增** | bf32620e；`bf32620e^` 各文件 |
| 2 | 主动探测：复用 getClient vs 专用非路由 client；DNS/TCP/TLS/TTFB 分阶段钩子 | **需新增**（专用非路由 probe client + `EventListener` 计时）；OkHttp 4.12 基础设施本身是**已有能力** | `PixivApiCore.java:54,77`；历史 `IpTableFetcher.java:16-18`；OkHttp `EventListener.kt` |
| 3 | TLS 带 SNI / 去 SNI 双路径探测且不改生产路由 | **做不到**（生产已无 SNI 剥离路由）；要做得**需新增**专用探测实现（技术参考历史 `SniStrippingSSLSocketFactory`） | bf32620e；`bf32620e^:DirectAccessTransport.java:305-393` |
| 4 | ConnectivityManager / NetworkCapabilities @ minSdk 28、权限、避开 SSID/位置 | **已有能力**（API 均在 28 及以下可用）+ **需新增** `ACCESS_NETWORK_STATE` 声明与读取代码；可完全避开 SSID/位置权限 | SDK `api-versions.xml` / `annotations.xml`；`AndroidManifest.xml:62`；`variables.gradle:2` |
| 5 | DoH 对照判 DNS 污染 | **需新增**（技术上可行）；建议**不进 v1**（依赖、bootstrap、端点可达性成本） | OkHttp `okhttp-dnsoverhttps` DnsOverHttps.kt（4.12）；RFC 8484 |
| 6 | `ImageHostConfig.runProbe` 的 `ProbeFn` 复用为 L6 执行器 | **需新增** `NetDiagProbe`；`ProbeFn` 只可借鉴「构造器注入接缝」范式，不能直接当执行器 | `ImageHostConfig.java:97-99,116-138,437-455` |
| 7 | 既有单测覆盖 | directaccess 覆盖**已删（0）**；`ImageHostConfigTest` 28 个用例覆盖 probe seam；**分阶段计时/平台位/TLS/DoH 无覆盖** → **需新增** | 见第 7 节 |

---

## 1. 现有可读状态（零成本层）

### 1.1 当前树：没有该层（【做不到】）

- `PixivApiCore.java:54-71` `getClient()`：只设置 connect/read/call 超时、自建 Dispatcher，`.build()` 后调 `setMaxRequestsPerHost(10)` / `setMaxRequests(20)`。无路由装配。
- `PixivApiCore.java:77-79` `getSharedClient()`：包可见（package-private）地返回同一单例，供同包 `PixivImageLoader` 等复用连接池。
- 没有 ContentProvider 预热、没有 SharedPreferences 直连配置键 `direct_access_settings`、没有 `PixivApi` 插件方法。

### 1.2 历史实现（`bf32620e^`，仅作重建参考）

| 能力点 | 历史源码位置（`bf32620e^`） | 可读性 |
|---|---|---|
| 路由判定（SYSTEM vs PINNED(channel, ip)） | `directaccess/DirectAccessPolicy.java:128-163` `decide(host, switchState, breaker, table)`；决策值对象 `:49-114`（`kind()` / `isDirect()` / `channel()` / `ip()` / `toString()`）；通道分类 `:173-185` | 纯函数，**按域可查**（传 host 即可），但历史**未暴露 bridge** |
| 门序（契约） | `DirectAccessPolicy.java:130-162`：switch → 入参 → 官方白名单（复用 `ImageHostConfig.isOfficialDomain`）→ IP 表条目 → 通道分类 → 装配存在 → 熔断（**熔断门必须最后**，`allowDirect` 半开态有授凭副作用） | — |
| 熔断相位 | `ChannelCircuitBreaker.java:44-52` `Channel{IMAGE,API_REFRESH}` / `Phase{CLOSED,OPEN,HALF_OPEN}`；只读 `phase(channel)` `:201-203` | **可读相位** |
| 失败计数 | `ChannelCircuitBreaker.java:68-82` `ChannelState` 为 `private static final class`，字段 `consecutiveFailures` 包可见但**无 getter**；阈值常量 `:55` `FAILURE_THRESHOLD=3` | **历史上不可读**（需新增访问器） |
| 冷却剩余时间 | `ChannelCircuitBreaker.java:58` `COOLDOWN_MILLIS=60000`；`openedAtMillis` 在 `ChannelState` `:74-75`，**无 getter** | **历史上不可读**（需新增访问器） |
| 熔断重置 | `ChannelCircuitBreaker.java:196-198` `reset(channel)` | 可写 |
| 开关三态 | `DirectAccessConfig.java:244-246` `switchState()` → ON/OFF/UNSET | 可读 |
| 三层合并快照 | `DirectAccessConfig.java:253-264` `currentTable()` → `IpTableMerger.Snapshot`（恒非 null） | 可读 |
| 合并快照内容 | `IpTableMerger.java:95-153`：`ipFor(host)` `:112-121`、只读 `entries()`（host→ip，`:124-126`）、`isEmpty()` `:129-131` | **可逐条读出合并结果** |
| 三层来源摘要 | `DirectAccessConfig.java:322-333` `tableSourceSummary()` → 形如 `manual+remote+builtin` 的 **presence 字符串** | 只读**摘要**；**无按层条数** |
| 上次成功刷新时间 | `DirectAccessConfig.java:312-314` `lastFetchAtMillis()`（`0` = 从未成功）；TTL 常量 `:100` = 24h；跨进程信封持久化 `:480-497` / `:505+` | 可读（成功时刻） |
| 手动刷新 | `DirectAccessConfig.java:273-293` `refreshIpTableNow()`，返回是否发起（单飞） | 可写 |
| 熔断器实例 | `DirectAccessConfig.java:296-298` `breaker()`；`:301-304` `resetCircuits()` | 可读/可写 |
| JS 状态面 | `packages/app/src/native/DirectAccess.ts:18-30`（历史）：`DirectAccessStatus` 仅 6 字段；`:58-63` `directAccessStatus()`；`:69-76` `directAccessCommand()` | 6 字段见下 |
| Java 状态面 | `webview/.../PixivApiPlugin.java:285-310`（历史）`directAccessStatusCore`，写入 6 个 key `:303-309` | 与 TS 契约一致 |

历史 `directAccessStatus()` 的 6 个字段（`DirectAccess.ts:18-30`）：
`switchState`、`imageChannel`（相位）、`apiChannel`（相位）、`tableEntries`（合并后条数）、`tableSource`（来源摘要字符串）、`lastFetchAtMillis`（上次成功拉取 ms）。

### 1.3 「按请求 / 按域查询」的准确性回答

- **按域查询**：历史 `DirectAccessPolicy.decide(host, ...)` 是无 I/O 纯函数，**可以**对任意 host 算出 `SYSTEM` 或 `PINNED(channel, ip)`——但历史 bridge 未暴露这个方法，要读就得**新增**一个 bridge 入口（或在 Java 内直调）。
- **按请求查询**：**做不到**。历史代码没有记录任何「某个具体请求实际走了哪条路由」的观测点；`AttributionEventListener` 只做失败记账，`PinnedAccountingInterceptor` 只做成功/失败 421 记账，都不落盘、不对外暴露。状态面只有**聚合快照**。
- **IP 表三层**：`Snapshot` 给出的是**合并后**结果；`remoteTable` 为 `DirectAccessConfig` 私有，manual 在 `Parsed` 内，builtin 为常量类——**按层条数/按层明细历史上读不出**，只有 `tableSourceSummary()` 的 presence 摘要。

### 1.4 支撑 L1 的缺口清单（历史实现口径）

| L1 需要的字段 | 历史是否可读 | 结论 |
|---|---|---|
| 开关三态 | ✅ `switchState()` | 已有（历史） |
| 双通道相位 | ✅ `phase()` | 已有（历史） |
| 双通道连续失败计数 | ❌ 无 getter | 需新增访问器 |
| 双通道冷却剩余 ms | ❌ 无 getter（`openedAtMillis` 私有语义） | 需新增访问器 |
| 合并后条数 | ✅ `Snapshot.entries().size()` | 已有（历史） |
| 三层来源摘要 | ⚠️ 仅 presence 字符串 | 可用但信息量低 |
| 按层条数（manual/remote/builtin） | ❌ | 需新增 |
| 上次成功刷新时间 | ✅ `lastFetchAtMillis()` | 已有（历史） |
| 上次拉取失败原因 / 是否在飞 | ⚠️ 仅 `warnSink` 日志，无状态面 | 需新增 |
| 指定 host 当前路由 | ⚠️ 可现算（`decide` 纯函数），但无 bridge | 需新增 bridge 方法 |
| 最近一次实际请求路由/IP | ❌ 无记录 | 做不到（需新增埋点） |

### 1.5 三档小结（第 1 条）

- **做不到**：在当前树读取任何直连/熔断/IP 表状态（代码已整体移除）。
- **需新增**：若要恢复该层，需先做重引入决策，再重建上述状态面；其中失败计数、冷却剩余、按层条数、按域路由 bridge 在历史实现里也**没有**，是纯新增。
- **已有能力**：无（当前树）。历史实现可在 `bf32620e^` 与分支 `fix/auth-resilience-393` 取用。

---

## 2. 主动探测（发包层）

### 2.1 复用 `PixivApiCore.getClient()` 还是专用非路由 client？

- `PixivApiCore.getClient()` 是 **private**（`PixivApiCore.java:54`）；对外只有 **包可见** 的 `getSharedClient()`（`:77-79`，包 `io.pictelio.app`）。若新建 `io.pictelio.app.netdiag` 子包，**看不到**这两个方法，要么放同包，要么新增一个 public 访问器。
- **不建议**在共享单例上装探测用 `EventListener` / 改连接池：① 探测会进入生产连接的统计与连接池；② 生产 API 请求会被探测的 listen 逻辑牵连。
- **关键坑：连接复用会吞掉阶段事件。** OkHttp 官方源码明确：`dnsStart` 在「能复用连接池里的连接时不会触发」；`connectStart` 只在「没有可复用连接」时触发（OkHttp 4.12 `EventListener.kt` 注释）。因此**复用一个持续被生产请求使用的连接池，探测可能只测到 TTFB、测不到 DNS/TCP/TLS**。
- 正确做法：**专用 probe client**，且隔离连接池（例如 `shared.newBuilder().connectionPool(new ConnectionPool(0, 1, TimeUnit.MINUTES)).callTimeout(...).eventListenerFactory(...).build()`；`newBuilder()` 默认会**继承**共享连接池，必须显式替换）。
- **历史先例（契约级依据）**：`bf32620e^:directaccess/IpTableFetcher.java:16-18` 的 javadoc 原文要求「生产实现必须使用**专用不路由**的 HTTP client——未来直连路由装配在共享 client 上时，本拉取器不得被路由（否则 IP 表拉取自身走直连 → 自举死锁）」。即本仓库已有「探测/自举不能走生产路由」的成文契约，网络自检应沿用同一原则。
- 当前 `ImageHostConfig.java:116-138` 的生产探针就是「`PixivApiCore.getSharedClient().newBuilder().callTimeout(PROBE_TIMEOUT_MS)` + HEAD」——它复用了共享连接池、只测总耗时，可作为**最小实现**参考，但**不满足分阶段要求**（见第 6 条）。

### 2.2 OkHttp 4.12 的分阶段钩子（一手：OkHttp 源码 `parent-4.12.0`）

依赖版本已确认：`packages/app/android/app/build.gradle:222` `com.squareup.okhttp3:okhttp:4.12.0`。

`EventListener.kt` 的事件嵌套（源码类注释原文）：
```
call (callStart, callEnd, callFailed)
  proxy selection (proxySelectStart, proxySelectEnd)
  dns (dnsStart, dnsEnd)
  connect (connectStart, connectEnd, connectFailed)
    secure connect (secureConnectStart, secureConnectEnd)
  connection held (connectionAcquired, connectionReleased)
    request
      headers (requestHeadersStart, requestHeadersEnd)
      body (requestBodyStart, requestBodyEnd)
    response
      headers (responseHeadersStart, responseHeadersEnd)
      body (responseBodyStart, responseBodyEnd)
```

各阶段耗时的取法（含官方 javadoc 语义）：

| 阶段 | 钩子 | 精确定义/说明 |
|---|---|---|
| DNS 解析 | `dnsStart(call, domain)` → `dnsEnd(call, domain, addresses)` | 复用池连接时不触发。也可自定义 `Dns` 包一层计时（更可控，且能读解析结果 IP 列表）。当前树无自定义 Dns |
| TCP connect | `connectStart` → `secureConnectStart`（HTTPS）| `connectStart`「just prior to initiating a socket connection」，仅无可复用连接时触发。HTTPS 下 `secureConnectStart` 在握手前触发，差值即 TCP 建连耗时 |
| TLS 握手 | `secureConnectStart(call)` → `secureConnectEnd(call, handshake)` | 仅请求需要 TLS 且无可复用连接时触发。`handshake` 可读到协商版本/密码套件/证书链 |
| HTTP TTFB | `requestHeadersEnd` → `responseHeadersStart`（或 `callStart` → `responseHeadersStart`）| `responseHeadersStart` 是「响应头开始到达」的权威点（OkHttp 4.3 前语义曾过早，已修正）。`responseHeadersStart` 的 javadoc 原文说明 prior to 4.3 该事件「was incorrectly invoked when the client was ready to read headers」 |
| 总 connect | `connectStart` → `connectEnd` | `connectEnd` javadoc 原文：「If the `call` uses HTTPS, this will be invoked after `secureConnectEnd`, otherwise it will invoked after `connectStart`」——所以 connectEnd 含 TLS，不能单独当 TCP 耗时 |
| 整通 | `callStart` → `responseHeadersEnd` / `callEnd` | `callEnd` 成功、`callFailed` 失败 |

结论：**分阶段计时可达，但必须用 `EventListener`（或自定义 `Dns`）并且禁用/隔离连接复用**；否则事件缺失会把「0」误读成「极快」。

### 2.3 三档小结（第 2 条）

- **已有能力**：OkHttp 4.12、共享 client、超时常量、`PixivImageLoader` 的「镜像失败回退」范式、`ImageHostConfig` 的探针单飞 executor 范式。
- **需新增**：专用非路由 probe client（隔离连接池）＋ `EventListener`（或 `Dns` 包装）采集分阶段耗时＋结构化结果模型。
- **做不到**：在**不改探测实现**的前提下从共享 client 拿到可靠的分阶段耗时（连接复用会吞事件）。

---

## 3. TLS 带 SNI / 去 SNI 双路径

### 3.1 历史机制（`bf32620e^:directaccess/DirectAccessTransport.java`）

- 装配入口 `:142-181` `install(builder, config)`：先用一次性探针 client 取平台默认 `sslSocketFactory()` 与 `trustManager`（`:164-171`），再 `builder.dns(new PinnedDns(...))`（`:167`）、`builder.sslSocketFactory(new SniStrippingSSLSocketFactory(base, warn), trustManager)`（`:171`）、`builder.eventListenerFactory(...)`（`:179`）。
- 去 SNI 的实现 `SniStrippingSSLSocketFactory` `:305-393`：
  - 主机制 `:316-328`：若 socket 已连接对端 IP == 本次钉定 IP（`pinnedGrantFor` `:366-375` 比对 ThreadLocal `GRANT`），就把**IP 字面量**当 `peerHost` 传给底层工厂——JDK/Conscrypt 对字面量地址不派生 SNI，ClientHello 不带 SNI 扩展。
  - 副机制 `:382-392`：握手前置空 `SSLParameters.serverNames`；注释明确「实测 JDK 21 上 no-op」，仅双保险。
  - 权威说明 `:283-303`：证书链校验与主机名校验**完全保留**（TrustManager 透传；`OkHostnameVerifier` 按真实 URL 域名校验），且「无已连接对端的重载不在 OkHttp 直连路径上，原样委托」。
- `PinnedDns` `:225-274` 在 PINNED 时 `GRANT.set(new PinnedGrant(...))` `:271`，SYSTEM 时 `GRANT.set(null)` 并委托 `Dns.SYSTEM`（`:249-253`）——**SNI 剥离的开关由路由决策驱动，不是独立开关**。

### 3.2 当前能力与可行性判断

- **做不到（当前树）**：生产路由里已没有任何 SNI 剥离；`DirectAccessTransport` 整体不存在。
- **需新增（如要做对照）**：要「只探测、不改生产路由」，必须**另建一个专用 client**，在其上装自定义 `SSLSocketFactory`（把 IP 字面量当 peerHost，必要时加空 `serverNames`）与自定义 `Dns`（直接返回字面量），**绝不调用任何生产 install**。历史 `SniStrippingSSLSocketFactory` 是 `DirectAccessTransport` 的 `static final` 嵌套类、构造函数包可见，且剥离判定依赖 `GRANT` ThreadLocal（由 `PinnedDns` 设置）——**不能拿来即用**，要在新包内重实现（可直接抄 `:316-328` 的 peerHost 字面量手法）。
- **重要边界（产品事实）**：移除提交明确记录「GFW 对无 SNI ClientHello 指纹级 100% RST」——即在目标用户网络里「去 SNI 路径」大概率就是失败态。因此**双路径对照的诊断价值已从「解释开了直连为什么好」降级为「确认无 SNI 也走不通」**；#440 第 3 条设想的「开了直连就好了」叙事在当前产品里已不成立。若重新引入直连，此对照才有意义。
- **带 SNI 路径**：默认 `SSLSocketFactory` + 正常域名即可，属【需新增】（探测代码）而非平台限制。

### 3.3 三档小结（第 3 条）

- **做不到**：在当前生产架构上复用现成的 SNI 双路径（代码已删，且生产已无剥离路由）。
- **需新增**：专用探测 client + 自实现 `SSLSocketFactory`（字面量 peerHost）＋把「带 SNI」也纳入同一探测框架。
- **需产品决策**：是否重新引入直连——不引入的话，第 3 条整体可从 v1 检查项中移除。

---

## 4. Android 平台位（ConnectivityManager / NetworkCapabilities @ minSdk 28）

### 4.1 API 可用性（一手：本机 Android SDK 36 的 `platforms/android-36/data/api-versions.xml`）

- 工程配置：`packages/app/android/variables.gradle:2` `minSdkVersion = 28`（`compileSdkVersion = 36`、`targetSdkVersion = 36`）。
- `android/net/NetworkCapabilities` `since=21`；`NET_CAPABILITY_VALIDATED` `since=23`；`NET_CAPABILITY_CAPTIVE_PORTAL` `since=23`；`NET_CAPABILITY_NOT_METERED`（随类，API 21 起）；`TRANSPORT_WIFI` / `TRANSPORT_CELLULAR` / `TRANSPORT_VPN` / `TRANSPORT_ETHERNET` 均 `since=21`；`hasTransport(int)` / `hasCapability(int)` `since=21`。
- `android/net/ConnectivityManager`：`getNetworkCapabilities(Network)` `since=21`；`getActiveNetwork()` `since=23`；`isActiveNetworkMetered()` `since=16`；`registerDefaultNetworkCallback(Callback)` `since=24`（带 Handler 重载 `since=26`）；`getActiveNetworkInfo()` 标记 `deprecated=29`（API 28 仍可但已不推荐）。
- **全部 ≤ 28**，minSdk 28 下无兼容层需求。

### 4.2 权限（一手：同 SDK 的 `data/annotations.zip` → `android/net/annotations.xml`）

- `getActiveNetwork()`、`getNetworkCapabilities(Network)`、`isActiveNetworkMetered()`、`registerDefaultNetworkCallback(...)` 四个方法的注解均为：
  `<annotation name="androidx.annotation.RequiresPermission"><val value="android.permission.ACCESS_NETWORK_STATE"/></annotation>`。
- `ACCESS_NETWORK_STATE` 是 **normal 权限**（安装时自动授予，无运行时弹窗）。
- **当前清单只有 `INTERNET`**：`packages/app/android/app/src/main/AndroidManifest.xml:62`（全部 flavor 清单中 `uses-permission` 仅此一条）。因此**需新增** `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`，否则状态查询会直接 SecurityException/失败——这正是 `docs/research/network-self-check-patterns.md:321` 标注的「易踩的坑」。

### 4.3 能否避开 SSID / 位置权限

- **能，且应当**：网络类型判定只用 `NetworkCapabilities.hasTransport(TRANSPORT_*)` 与 `hasCapability(NET_CAPABILITY_*)`，**不需要** `ACCESS_WIFI_STATE`/`ACCESS_FINE_LOCATION`，也不需要 `WifiManager`。
- SSID/BSSID 才需要位置权限（Android 官方 Wi-Fi permissions 文档：`https://developer.android.com/develop/connectivity/wifi/wifi-permissions`；该页正文为 JS 渲染，本次未逐字抓取，但结论与 `network-self-check-patterns.md:322` 一致）。设计上直接不显示 SSID/BSSID 即可完全绕开。
- 报告口径建议（沿用 patterns 文档 6.4）：只报 `TRANSPORT_*` / `NET_CAPABILITY_*`，不报 SSID。
- 另注：`NET_CAPABILITY_VALIDATED` 表达「系统已完成联网校验」，`NET_CAPABILITY_CAPTIVE_PORTAL` 表达「疑似强制门户」，二者都是系统侧结论，零发包成本。

### 4.4 三档小结（第 4 条）

- **已有能力**：minSdk 28 下全部目标 API 可用；权限模型为 normal 权限。
- **需新增**：清单 `ACCESS_NETWORK_STATE` + Java 读取代码（建议放新 `netdiag` 子包）。
- **做不到**：无需（本项无平台级不可行点）。

---

## 5. DoH 对照（判 DNS 污染）

### 5.1 技术可行性

- OkHttp 官方提供独立构件 `com.squareup.okhttp3:okhttp-dnsoverhttps`（4.12.0 有对应版本），核心类 `okhttp3.dnsoverhttps.DnsOverHttps` **实现 `Dns` 接口**，可直接替换某个 client 的 Dns（一手：`square/okhttp` `parent-4.12.0` 的 `DnsOverHttps.kt`）。
- `DnsOverHttps.Builder` 关键方法（源码）：`client(OkHttpClient)`（必填）、`url(HttpUrl)`（必填，DoH 端点）、`post(boolean)`、`includeIPv6(boolean)`、`resolvePrivateAddresses(boolean)`、`resolvePublicAddresses(boolean)`、`bootstrapDnsHosts(InetAddress...)`、`systemDns(Dns)`；媒体类型常量 `DNS_MESSAGE = "application/dns-message"`、响应上限 `MAX_RESPONSE_SIZE = 64 * 1024`。
- 协议侧：RFC 8484（媒体类型 `application/dns-message`）与 DoT 的 RFC 7858。对照方式：同一次自检里分别用系统 `Dns.SYSTEM` 与 `DnsOverHttps` 解析同一域名，比对 IP 集合即可给「本地解析器被污染/劫持」的线索。

### 5.2 成本与风险

1. **新依赖**：需在 `app/build.gradle` 增加 `okhttp-dnsoverhttps:4.12.0`（当前只有 `okhttp` 4.12.0 与测试用 `mockwebserver`/`okhttp-tls`）。
2. **API 稳定性**：4.12 源码类注释仍写「**Warning: This is a non-final API** … unstable preview」，引入了升级风险。
3. **Bootstrap DNS 悖论**：DoH 端点自身的域名（如 `cloudflare-dns.com` / `dns.google`）也要解析——同步解析可能同样被污染。缓解手段是 `bootstrapDnsHosts(InetAddress...)` 直接钉 IP，或用纯 IP 端点。**注意**：钉 IP 又回到「该 IP 是否可达」的问题。
4. **端点可达性**：公共 DoH（Cloudflare/Google）在目标用户网络里可能不可达或被干扰；「DoH 失败」≠「系统 DNS 被污染」，判据必须区分。
5. **与系统代理的交互**：`DnsOverHttps` 内部用 OkHttpClient（可走系统代理）；走用户代理时 DoH 结果代表的是代理侧解析，不能直接当作「本地污染」证据。若走专用 client，需明确是否绕过代理。
6. **不应与生产 client 混用**：DoH 是「对照通道」，必须用独立 Dns 实例（`DnsOverHttps` 可包在专用 client 上），不能改共享 client 的 Dns。

### 5.3 建议

- 不进 v1：L1–L6 的 DNS 层先用「系统解析结果 + 耗时」即可；DoH 对照作为 v2 可选高级项，或仅在用户显式点「高级诊断」时运行。
- 若进 v1，优先用**纯 IP 的国内可达 DoH 端点**或自托管，避免公共端点不可达造成的误报。

### 5.4 三档小结（第 5 条）

- **需新增（可行）**：依赖 + 独立 Dns 实例 + 系统/DoH 结果比对逻辑。
- **做不到**：不借助任何加密解析通道、在客户端可靠区分「系统 DNS 被污染」与「网络整体不通」。
- **风险**：非 final API、bootstrap 依赖、端点可达性；建议 v1 不纳入。

---

## 6. `ImageHostConfig.runProbe` 的 `ProbeFn` 能否复用为 L6 执行器

### 6.1 现状（当前树）

- `ImageHostConfig.java:97-99`：`interface ProbeFn { long probe(String probeUrl); }`——**包可见嵌套接口**，入参是探测 URL，返回值是**单一 `long` 延迟 ms**（<0 或抛异常 = 不可达）。
- 注入面：构造函数 `:172-178` 接收 `ProbeFn probe` 与 `Executor probeExecutor`；生产单例 `get(Context)` `:109-145` 在 `:116-138` 组装真实实现：`PixivApiCore.getSharedClient().newBuilder().callTimeout(PROBE_TIMEOUT_MS)` + `Request.Builder().url(url).head().build()`，只量 `System.nanoTime()` 差值；失败 `Log.w` + 返回 `-1L`。
- 探针单飞与缓存：`kickProbe` `:403-430`（volatile 快路径 + synchronized 双检 + executor 拒绝复位）、`runProbe` `:437-455`（逐 host 取最小延迟，全部不可达不写缓存）。

### 6.2 作为 L6 执行器的评估

| 维度 | `ProbeFn` 现状 | L6 需要 |
|---|---|---|
| 作用域 | 包可见（`ImageHostConfig` 内部） | 新 `netdiag` 跨类可用（需 public 或同包） |
| 结果形状 | 单个 `long` | 分阶段耗时 + HTTP 状态 + 错误类型 + 解析 IP + 是否复用连接 |
| 状态/错误 | 只区分可达到 / 不可达 | 要区分 DNS 失败 / 连接超时 / TLS 失败 / HTTP 4xx/5xx / 421 |
| 连接池 | 复用共享池（`:116`） | 需隔离池，保证分阶段事件出现 |
| 端点 | 图床 host 样本 URL | 业务域（`app-api.pixiv.net` / `i.pximg.net` / OAuth 域 / 镜像） |
| 注入范式 | 构造器注入接口 + executor（很好） | 可沿用 |

### 6.3 结论

- `ProbeFn` **不能直接当 L6 执行器**：返回值信息量不足、作用域受限、共享连接池。
- 值得**复用的是它的接缝设计**（「接口即测试面」的构造器注入 + 单飞 executor），以及 `ImageHostConfig` 的 `transform`/白名单等既有语义。
- 新建 `NetDiagProbe`（建议放 `io.pictelio.app.netdiag`），定义结构化结果（如 `phase@_ms* / status / errorType / resolvedIps / reusedConnection`），由共享纯逻辑包消费。

### 6.4 三档小结（第 6 条）

- **需新增**：`NetDiagProbe` 与结构化结果模型。
- **已有能力（可借鉴）**：构造器注入接缝、单飞 executor、`isOfficialDomain` 白名单（`ImageHostConfig.java:549-551`）。
- **做不到**：用现有 `ProbeFn` 表达分阶段/状态/错误。

---

## 7. 既有单测覆盖

### 7.1 current：`ImageHostConfigTest.java`（28 个 @Test）

覆盖点（行号为当前文件）：

- ProbeFn 注入范式：内部 `RecordingProbe implements ImageHostConfig.ProbeFn` `:91-100`；构造注入 `:143-144`。
- 探针样本 URL 改写：`probe_usesSampleUrlTransformedPerHost` `:379-389`。
- 单飞：`resolve_fastestIp_concurrent_singleFlight_probeOnce` `:395-`、`resolve_fastestIp_seededExpired_fallsBackToWeighted_thenProbeCacheTakesOver` `:341-355`。
- 图床关不触发探测 `:153-160`；fastest-ip 种子/过期/禁用 host/null 过期 `:330-395`。
- 官方域精度 `:471-488`（与路由白名单同源语义）。

**未覆盖**：真实 OkHttp 的 DNS/TCP/TLS/TTFB 分阶段事件、HTTP 状态码、TLS 失败分类、DoH、Android 平台位。`ProbeFn` 在测试里恒为桩，不触真网络（这是刻意设计，见 `:22` 注释）。

### 7.2 已删除的 directaccess 测试（`bf32620e`）

提交说明称共 6 文件、93 个用例；`git show --stat` 行数如下（历史参考）：

| 测试文件（`bf32620e^`） | 删除行数 |
|---|---|
| `directaccess/DirectAccessTransportTest.java` | 934 |
| `directaccess/DirectAccessConfigTest.java` | 407 |
| `directaccess/DirectAccessPolicyTest.java` | 342 |
| `directaccess/ChannelCircuitBreakerTest.java` | 336 |
| `directaccess/IpTableMergerTest.java` | 223 |
| `directaccess/DirectIpTableDefaultsTest.java` | 103 |

另有 `tests/unit/components/SettingsDirectAccess.test.tsx`（229 行）与 `tests/unit/stores/directAccessStore.test.ts`（256 行）被删。当前工作树对以上全部 **0 覆盖**。

### 7.3 其它

- `PixivApiPluginTest.java` 当前 5 个 @Test，删除提交移除了其中 4 个 directAccess 用例，**现无任何 directAccess 断言**。
- 当前树**没有**任何针对 `ConnectivityManager`/`NetworkCapabilities` 的测试（也没有对应代码）。
- 相邻但不可复用：`packages/app/scripts/lib/proxy-probe.mjs` + `packages/app/tests/unit/scripts/proxy-probe.test.ts` 是 **Node 侧发布工具**的网络探测，与设备端 Java 无关。

### 7.4 三档小结（第 7 条）

- **已有能力**：`ImageHostConfigTest` 的 28 个用例为「probe 注入接缝 + 单飞」提供了可照抄的测试范式。
- **需新增**：分阶段计时（`EventListener`/`Dns`）、TLS 双路径、平台位、DoH、结构化结果模型的单测；可使用 `mockwebserver` 4.12（已在 `build.gradle:270`）与 `okhttp-tls`（`:273`，仅 testImplementation）。
- **做不到**：直接复用已删除的 directaccess 测试（文件与 fixture 都不在）。

---

## 8. 给 #441 / #442 的输入（bridge 契约的最小字段清单）

1. **若不在本版重新引入直连**：L1「路由/熔断状态」层应显式标注为 `skipped`（原因：功能已移除），不要渲染绿色的「正常」；bridge 无需暴露 directAccess* 字段。
2. **若重新引入直连**，`netdiag` 状态快照至少需要（相对历史 6 字段的增量，均**需新增访问器**）：
   - `imageChannel` / `apiChannel`：相位 + `consecutiveFailures` + `cooldownRemainingMillis`；
   - IP 表：`tableEntries` + **按层条数**（`builtinCount`/`remoteCount`/`manualCount`）+ `lastFetchAtMillis` + `lastFetchError`/`fetching`；
   - 按域路由：`routeFor(host)`（调纯函数 `decide`，返回 `SYSTEM` 或 `PINNED(channel, ip)`）；
   - 选项：最近一次实际请求路由（历史没有，需新增埋点）。
3. **探测执行器契约**（#442）：建议 `NetDiagProbe` 返回结构化结果（阶段耗时 + 状态 + 错误类型 + 解析 IP + 是否复用连接），而非 `ProbeFn` 的单个 `long`；共享纯逻辑包只消费该结构，不碰 OkHttp。
4. **平台位契约**（#441 L0）：只报 `TRANSPORT_*` / `NET_CAPABILITY_VALIDATED` / `CAPTIVE_PORTAL` / `NOT_METERED`，不报 SSID；需先在清单加 `ACCESS_NETWORK_STATE`。

---

## 9. 核验说明与未能核实项

- 本文「当前树已无直连」的结论来自：`git merge-base --is-ancestor bf32620e HEAD/main`、`git show --stat bf32620e`、`git ls-tree`、工作树 grep、`git log --all -S 'DirectAccessPolicy'`。均为本地一手。
- Android API 级别来自本机安装的 SDK 36 元数据 `platforms/android-36/data/api-versions.xml`；权限来自同 SDK 的 `data/annotations.zip` → `android/net/annotations.xml`。为**官方 SDK 元数据一手**。
- OkHttp 事件语义来自 `square/okhttp` 仓库 `parent-4.12.0` 的 `EventListener.kt` / `RealConnection.kt` / `DnsOverHttps.kt` 源码原文。
- **未能逐字核验**：`developer.android.com` 参考页正文为 JS 渲染，`web_fetch` 抓取被截断，故 SSID 需位置权限一条引用的是官方 Wi-Fi permissions 文档 URL（结论与 `docs/research/network-self-check-patterns.md:322` 一致），未逐字验证其原文。
- **未做**：未运行任何真实网络探测；未修改任何生产代码；未执行 `pnpm openwiki:update`。

---

## 附录：关键来源清单

| 主题 | 来源（一手） |
|---|---|
| 直连移除 | 提交 `bf32620e1717cc154837ac3c94cb29afee063d6b`（`git show` / `--stat`） |
| 历史直连实现 | `bf32620e^:packages/app/android/app/src/main/java/io/pictelio/app/directaccess/*.java`、`packages/app/src/native/DirectAccess.ts`、`packages/app/android/app/src/webview/java/io/pictelio/app/PixivApiPlugin.java` |
| 当前 OkHttp 出口 | `packages/app/android/app/src/main/java/io/pictelio/app/PixivApiCore.java:54-79` |
| 探测接缝 | `packages/app/android/app/src/main/java/io/pictelio/app/ImageHostConfig.java:97-99,116-138,403-455,549-551` |
| 平台清单/版本 | `packages/app/android/app/src/main/AndroidManifest.xml:62`、`packages/app/android/variables.gradle:2` |
| Android API 级别 | SDK `platforms/android-36/data/api-versions.xml`（本机） |
| Android 权限注解 | SDK `platforms/android-36/data/annotations.zip` → `android/net/annotations.xml`（本机） |
| OkHttp 事件/DoH | `https://raw.githubusercontent.com/square/okhttp/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/EventListener.kt`、`.../internal/connection/RealConnection.kt`、`.../okhttp-dnsoverhttps/src/main/kotlin/okhttp3/dnsoverhttps/DnsOverHttps.kt` |
| 依赖版本 | `packages/app/android/app/build.gradle:222,270,273` |
| 业界基线 | `docs/research/network-self-check-patterns.md`（未跟踪，与本文互补；其直连相关表述已过期） |
| 下游工单 | #437 / #440 / #441 / #442 |
