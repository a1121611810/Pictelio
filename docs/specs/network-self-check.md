# 网络自检实施规格（Lynx 单引擎）

> 对应 wayfinder 地图 [#437](https://github.com/a1121611810/Pictelio/issues/437)。
> 依据：docs/research/network-self-check-patterns.md（业界一手调研）、docs/research/network-selfcheck-java-capability-audit.md（#440 Java 能力核查）、Charter #438。
> 状态：用户已拍板「按推荐」，并以目标「继续地图直到功能完成 / 测试通过 / 系统安装的安卓模拟器验证通过」授权**执行**（覆盖 wayfinder 默认的 plan-don't-do）。WebView 客户端已随 ADR-0203 删除；本规格只描述 app-lynx。

## 问题陈述

用户遇到「加载失败 / 图片不出」时只能看到泛化错误，无法区分：本机无网、DNS 污染、TCP 被重置、TLS/SNI 阻断、本地代理没运行、登录过期（401）还是 Pixiv 服务端故障。项目当前只有 /debug 单图测试，定位能力接近为零（竞品 pixez / Shaft / Pixeval / pixiv-viewer 均已有网络自检）。

## 解决方案

在 pictelio-app-lynx 加一个「网络自检」页，判定与文案由共享包统一提供：

- **分层漏斗（互相证伪）**：本机网络能力位 -> DNS -> TCP 443 -> TLS -> 带鉴权 API -> 图片边缘。
- **交互**：一键运行给结论 + 逐项绿/黄/红给原因；可单项重测；一键复制脱敏诊断报告。
- **归因分层**：明确区分「你的问题（device / network / proxy）」与「我们的问题（service）/ 账号问题（auth）」。
- **架构**：执行层在 Java（`@pictelio/android-host` 的 Android 工程）；判定/文案/报告在共享纯逻辑包 @pictelio/net-diagnostics；app-lynx 以 Material 3 渲染。

## 用户故事

1. 作为用户，加载失败时我能一键自检，并看到「是本机没网 / DNS / 连接被重置 / 代理 / 登录过期 / Pixiv 服务端」的确切结论。
2. 作为用户，我能逐项看到耗时与失败原因，而不是一句「网络异常」。
3. 作为用户，我能一键复制一份不含任何凭证的诊断报告去求助。
4. 作为用户，报告不会泄露我的 access_token / refresh_token / SSID / IP。
5. 作为用户，弱网下自检不会长时间卡住（调用超时由执行层控制）也不会放大流量。
6. 作为维护者，新增检查项只需改共享包一处，客户端自动跟随。
7. 作为维护者，能在模拟器上复跑验收（构建 -> 安装 -> 进入自检 -> 断言）。

## 实现决策

### 检查项契约（L0–L5）

| checkId | layer | 测什么 | 技术 | 实际超时 | 失败呈现 |
|---|---|---|---|---|---|
| device | device | 有无可用网络 / 是否 validated / captive / metered / 传输类型 | Android ConnectivityManager + NetworkCapabilities | 0（本地读） | 无网=FAIL；未验证=WARN；强制门户=FAIL |
| dns | dns | API 域解析 | 专用 probe client 的 Dns 阶段计时 | 与 tcp/tls 共享单次调用 4000ms | FAIL -> network |
| tcp | tcp | app-api.pixiv.net:443 三次握手 | probe client EventListener connectStart/End | 与 dns/tls 共享单次调用 4000ms | 超时/重置=FAIL -> network |
| tls | tls | TLS 握手（带 SNI） | probe client secureConnectStart/End | 与 dns/tcp 共享单次调用 4000ms | FAIL -> network（SNI/证书） |
| http | http | 带鉴权轻量 API 往返 | probe client + Java 注入 Bearer；区分 401/403/429/5xx | PixivApiCore callTimeout 45s（connect 15s + read 30s） | 401=FAIL->auth；429=WARN->service；5xx=FAIL->service |
| edge | edge | i.pximg.net（或镜像）可达 | probe client HEAD/GET 小图 | 3000ms | FAIL -> network |

超时由 Java 执行层（`NetDiagProbe`）实际控制：网络探测调用 `timedProbe(..., 4000)`、边缘探测 `timedProbe(..., 3000)`；HTTP 项走 `PixivApiCore`（callTimeout 45s）；DNS/TCP/TLS 是同一次 OkHttp 调用的三个阶段，共享该调用的 callTimeout，无法逐项独立计时。共享包不声明项级超时，也不维护与实现脱节的「总预算」常量。

### 执行层（Java）

- `NetDiagProbe` 位于 `packages/android-host/android/app/src/main/java/io/pictelio/app/`：
  - **专用非路由 OkHttp client**（独立连接池）+ EventListener + 自定义 Dns，产出结构化 NetDiagResult（checkId / ok / latencyMs / errorClass / httpStatus）；`deviceInfo` 同文件。不复用 PixivApiCore 共享 client（连接复用会吞 dnsStart / connectStart）。
- `NetDiagModule` 位于 `packages/android-host/android/app/src/lynx/java/io/pictelio/app/`：Lynx Native Module，`diagnose(userId, cb)` 在模块线程池执行阻塞 IO。
- AndroidManifest 增加 ACCESS_NETWORK_STATE（normal 权限，无需运行时申请）。
- 既有能力审计（#440）：直连已移除 => 无 route 探测项；无 SNI 路径 => 只探测带 SNI；ProbeFn(long) 仅可借鉴，不复用。

### 共享包 API（已交付）

- CHECK_PLAN（`getCheck(id)` 已随 #1043 删除——它生产零消费，判定层用内联 `CHECK_PLAN.find`）
- evaluate(input: DiagInput): DiagReport（逐项 status/attribution + overall + headline + action/actionTarget）
- formatReport(input): string（纯文本、字段白名单、redactSecrets 强制脱敏）
- 消费者：pictelio-app-lynx（workspace:*）

### Bridge 契约

- lynx：NetDiag LynxModule（`diagnose(userId, cb) -> {device, probes}` JSON），注册名 `NetDiag`；JS 经 NativeModules 调用。
- app-lynx TS adapter 把 JSON 转成 DiagInput 并调用共享包的 evaluate/formatReport。

### UI

- lynx：新增 pages/NetworkCheck.vue（M3 / Tailwind），「我的」加入口。
- 报告：纯文本，可复制；技术详情折叠。

### 修复动作边界

v1 只诊断 + 建议跳转（auth -> /login；device -> 系统网络设置；proxy -> 设置；network/service -> 重试），不自动改配置。

## 已核实能力前提（#440）

- DirectAccessPolicy / ChannelCircuitBreaker / directAccessStatus / SniStrippingSSLSocketFactory 在当前 HEAD 均不存在（bf32620e 移除）。
- PixivApiCore.getClient() 私有、getSharedClient() 包可见；主动探测需专用 client 与新的可见性/注入接缝。
- Lynx 原生环境 JS 不保证有 fetch；探测必须走 NativeModule。
- DoH 对照可行但不进 v1（列为后置）。

## 验收样例

1. 正常网络：device/dns/tcp/tls/http/edge = OK，overall OK，headline「网络连接正常」。
2. 断网：device FAIL -> overall FAIL，归因 device，动作「打开系统网络设置」。
3. 强制门户：device FAIL 且 headline 含「登录」。
4. DNS 通、TCP 超时：tcp FAIL，归因 network。
5. 登录过期：http 401 -> 归因 auth，动作 target /login。
6. Pixiv 5xx：http 503 -> 归因 service。
7. 报告脱敏：故意注入 Bearer <secret> 与 access_token=<secret>，报告不含原值且含 [REDACTED]。
8. 模拟器：安装 debug APK -> 启动 -> 进入自检页 -> 运行 -> 断言逐项渲染与结论。

## Out of scope

吞吐测速 / 选路优化、逐跳 traceroute·mtr、后台周期探测、诊断历史持久化、一键自动改配置、iOS/桌面、app-lynx 独立实现。
