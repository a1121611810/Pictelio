# ADR-0144: Pixiv 直连传输层——OkHttp 原生缝路由与图床正交语义

- 状态：accepted
- 日期：2026-09-06（accepted，用户拍板：方案 A v2 + design-it-twice 混合方案 + 「公共独立文件夹两边共用」落位子包）
- 关联：
  - spec [#385](https://github.com/a1121611810/Pictelio/issues/385)（含设计决策回填评论：机制修正/模块地图/缝清单）
  - tickets #386–#392（T1 prefactor → T7 验收）
  - [ADR-0037](./ADR-0037-*.md)（PixivApiPlugin 网关：access_token 只在 Java 堆——直连全部发生在 Java 层，JS 零知）
  - [ADR-0143](./ADR-0143-imagehost-download-source-java-sink.md)（图床下载源 Java 下沉——直连与其正交，见 D4）
  - 探针报告：`prototype/pixiv-bypass-feasibility` 分支（68fbd826）`docs/research/pixiv-direct-access-feasibility.md`（三层免梯通路全实证）

## 背景

大陆网络对 `*.pixiv.net` / `*.pximg.net` 实施 DNS 污染 + HTTPS SNI 阻断（带 pixiv SNI 的 ClientHello 即被 RST）。Pictelio 的官方流量（图片、API、OAuth 刷新）因此依赖用户自备代理；首次登录后持有 refresh_token 的用户，token 续期仍需代理，登录态随时可断。

探针报告实证了免梯通路：钉 IP + 无 SNI + Host 头路由可直连 Pixiv 自建边缘（图片边缘 `210.140.139.131`、API+OAuth 边缘 `210.140.139.155`，两者按 vhost 特化分工——错边缘 IP 得 421 而非封锁）；无 SNI 握手返回 `*.pixiv.net` 泛域名合法证书，**证书链校验可以保留**（优于 Pixez compat 的关校验形态）；OAuth 刷新端点免梯可达但有 30s 短窗口限频。

## 决策

### D1：接缝在 OkHttp client 层——同一 client 上的原生缝，调用点零改动

否决「孪生 client 重派」（design-it-twice 四案中三案独立否决：重派引入循环守卫、流式 zip 语义扰动、连接池分裂）。定案：**共享 OkHttpClient 上安装三件套**——

- 自定义 `Dns`：Policy 判定 PINNED → 返回 IP 表钉定字面量；SYSTEM → 委托系统 Dns
- 自定义 `SSLSocketFactory`：对端 = 钉定字面量即天然不发 SNI（JDK/Conscrypt 对 IP 字面量不派生 SNI；JDK 21 上 `SSLParameters.setServerNames(空)` 已实证无效，仅作副机制）；证书链校验保留平台默认，主机名按真实 URL 域名过泛域名校验
- `EventListener` + 应用拦截器：直连尝试的失败归因（421 无条件计失败；连接/握手/响应头阶段失败计入；**body 读取阶段失败不计**——大 zip 流式断流不误熔断）

收益：URL 与 Host 头恒不改写（缓存键「源无关命中」不变量天然继承 ADR-0143 D2）；`PixivApiCore`/`PixivImageLoader`/zip 双路径/`AuthPlugin` 全部调用点零改动自动获得直连；无重派、无循环守卫。

### D2：路由决策 = 纯函数门序，熔断门最后

`DirectAccessPolicy.decide(host, 开关三态, 熔断器, IP 表快照)`：开关门 → 入参门 → 白名单门（`*.pixiv.net` / `*.pximg.net`，复用 `ImageHostConfig.isOfficialDomain` 单一事实源）→ IP 表门（缺条目回系统路线——421 特化，宁回退不瞎猜边缘）→ 通道分类 → 装配门 → 熔断门。熔断门必须最后：`allowDirect` 在半开态有单探授凭副作用，先问熔断后查表会白白消耗单探资格且无请求回收。

### D3：双通道独立会话级熔断

图片通道（pximg 边缘）/ API+刷新通道（pixiv.net 边缘）各自计数：连续 3 次传输层失败 → open 切系统路线；60s 冷却（≥ OAuth 端点 30s 限频窗）后半开单探（CAS 授凭，并发只放行一个）；成功清零恢复；open 态迟到失败重启冷却、迟到成功 no-op；设置页可手动重置。记账恰好一次由请求作用域 `PinnedGrant`（Dns 授凭时生成，四归因点 CAS 去重）保证。

### D4：直连 × 图床正交——「路」与「仓」分离

图床决定下载源（哪个仓：官方/镜像），直连决定到官方仓的路线（哪条路：系统路线/直连小路）。规则：

- 镜像 URL **不做直连化改写**（白名单外天然系统路线——镜像本身就是免梯可达的第三方仓）
- 镜像失败回退官方的那次重试属官方流量，直连开则走直连（镜像抖动时的兜底路线）
- 缓存键恒官方 URL → 任意开关组合下缓存零失效零重下

### D5：IP 表三层来源 + 远端通道与 update-check 同机制

手动编辑 > 远端 JSON > APK 内置，逐条覆盖（非整层替换）。托管文件 `packages/website/pixiv-ip-table.json`——**raw.githubusercontent 直读 main 即生效**（update-check version.json 同机制），零部署改动；Java 惰性拉取（开关跃迁 + TTL 24h + 手动，单飞不阻塞），专用**不路由** OkHttp client（自举安全：IP 表拉取自身不得走直连，否则死锁）；cacheDir 信封持久化（跨进程 lastFetchAt 播种），失败保留上次有效否则内置兜底 + warn。anti-drift 测试钉住托管文件 ≡ 内置常量。

### D6：装配 = manifest 自装配，零 Java 装配代码

`DirectAccessInitProvider`（main 源集 ContentProvider，manifest 一条）在 Application.onCreate 前预热 Config 单例——full/webview/lynx 三 flavor 零装配代码（androidx.startup InitializationProvider 同类先例）。装配缺失（JVM 单测/极端时序）= `install(null)` no-op = **纯系统路线零异常**（降级契约；回归实证：接线上库后存量测试零改动全绿）。

### D7：落位 = main sourceSet 专属子包（非 Gradle 模块）

`io.pictelio.app.directaccess/`（Java 层的 ugoira——独立文件夹、职责单一、三 flavor 编进同一份）。不建独立 Gradle 模块：子包测试自动进现有 `testFullDebugUnitTest` 门禁（新模块的新测试任务有静默漏跑风险）、当前无第二消费方、子包→模块是随时可走的机械搬家。

## 后果

- 直连默认关；开启后无代理环境全功能可用（看图/API/刷新/动图）。首次登录（PKCE 必带 SNI）与 password grant 明确排除。
- 通路属猫鼠游戏：IP 表可更新是可维护前提；边缘 IP 存活性与 GFW 策略变化由「被动熔断 + 远端表 + 手动编辑」三层消化。
- 开发机注入代理系统属性会旁路 Dns（OkHttp 优先系统代理）——「有代理时无需直连」与产品语义一致；测试显式 NO_PROXY。
- 全部新代码 JVM 可测：纯核心零 android/okhttp 依赖；线缆层经 MockWebServer + okhttp-tls 真握手验证（SNI 有无以 `ExtendedSSLSession` 观测真实 ClientHello）。
