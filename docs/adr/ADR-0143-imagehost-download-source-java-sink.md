# ADR-0143: 图床下载源决策下沉 Java 下载层与「缓存键恒官方 URL」契约

- 状态：accepted
- 日期：2026-09-06（accepted，用户拍板「B 方向 + zip 纳入本质范围 + 源无关命中提为显式不变量」）
- 关联：
  - spec [#376](https://github.com/a1121611810/Pictelio/issues/376) / `docs/specs/imagehost-native-fix.md`（tickets 编号见各 ticket 关联回填）
  - [ADR-0037](./ADR-0037-*.md)（PixivApiPlugin 网关架构：图片二进制零进 JS 堆——本决策沿用其缓存单轨纪律）
  - [ADR-0125](./ADR-0125-*.md)/[ADR-0126](./ADR-0126-*.md)/[ADR-0128](./ADR-0128-*.md)（ugoira 解压写盘 / range 降级 / 流式渐进——zip 三路径的既有语义）

## 背景

### 图床在 native 下从未真正生效（双断裂诊断，2026-09-06 CodeGraph 链路实证）

图床（`imageHostService`，模式：单一/负载均衡/最快 IP/并发请求）自引入起，其 URL 改写的消费方只有 `imageLoader.ts` 三处，全部位于**预取/下载路径**；而显示 `<img src>` 恒为官方 `/pixiv-img/` 代理路径（`resolveImageUrl` 37 个调用点无一消费图床改写）。由此产生两处断裂：

1. **断裂一（决策不落地）**：列表卡片纯 `<img>` 直渲染，不经任何图床代码；四模式（含最快 IP 探针）的决策从未到达出图路径。
2. **断裂二（key 断裂）**：native 预取 `prefetchImage(镜像URL)` 按**镜像 URL** 写缓存键（`PixivApiPlugin.java:145`），显示拦截按 `rewriteUrl` 产物的**官方 URL** 查键 → 永不命中，预取镜像字节成为死数据（`PixivApiPlugin.java:176` 注释自证「无自定义图床时……可直接命中」）。

zip 链路同查：webview zip（`downloadAndExtractUgoira` → `/pixiv-img/` fetch → `ImageIntercept` → `PixivImageLoader`）已流经共享下载核心；lynx zip（`PictelioApiModule.downloadZip`/`streamDownloadZip`）直用 `PixivApiCore.getSharedClient()`，不经任何图床逻辑。

该缺陷属「功能从未兑现」而非回归：native 用户开启图床后出图路线与图床开关完全无关。

## 决策

### D1：接缝选在 Java 下载层——「URL 进 → 下载源出」

新增深模块 **`ImageHostConfig`**（`src/main`，双 flavor 共享），接口仅一方法：

```java
String resolve(String officialUrl)  // 官方 URL 进 → 实际下载 URL 出
```

接入点四个薄适配：`PixivImageLoader.download`（webview 图片+zip、lynx 图片）、`PixivApiPlugin.prefetchImage`（webview 预取）、`PictelioApiModule.downloadZip`/`streamDownloadZip`（lynx zip 两态）。

选此接缝的理由：全部出图流量天然流经 Java 下载层，37 个 JS 显示调用点与两引擎组件层**零改动**；双 flavor 编译 `src/main`，一处实现双引擎生效（局部性）。删除测试（deletion test）：移除本模块则模式决策/权重随机/探针 TTL/失效兜底散落至 4 调用点 × 2 引擎。

**否决的备选**：
- **显示 URL 接管**（`resolveImageUrl` 应用图床改写，`<img>` 直用镜像 URL）：镜像流量绕开三层缓存与缓存管理（双轨制），且仅惠及 webview——架构劣化，否。
- **官方优先 + 镜像兜底**：改变图床语义（用户意图是主路线而非降级），无梯场景列表首载仍先撞官方超时，否。

### D2：缓存键恒官方 URL（源无关命中不变量）

**下载源跟随图床，缓存键不跟随**：任何来源（官方/任一镜像）下载的字节一律存「官方 URL」键；命中判定只依赖「是否曾以任意来源缓存过」，与图床开关、模式、host 选择完全无关。切源不失效、不重下；同图全生命周期单一条目。

键的二次断裂由机器防线把守：anti-drift 测试断言 `keyToFilename(officialUrl)` ≡ 拦截侧 `rewriteUrl` 产物；Java 配置解析的契约 fixture 取自 `imageHostStore.ts` 真实持久化形态（测试硬约束 #2）。

### D3：四模式的 Java 映射（JS 决策退役于 native，配置生产者留在 JS）

| 模式 | Java 行为 | 与 JS 语义关系 |
|---|---|---|
| single | selectedHostId，无效回退第一个 enabled | 逐规则一致 |
| weighted | enabled ∧ weight>0 按权重每请求独立抽样（注入 `Random` 可确定性测试） | oracle = `selectWeightedHost` |
| fastest-ip | 内存探针结果 30s TTL（oracle = `getFastestHost`）内用最快；过期/缺失**立即**回退 weighted 不阻塞 | 探针决策源 JS → **Java 惰性探针**（单飞、专用单线程 executor、5s 超时），双引擎生效；设置页探针 UI（webview）不变，两者独立无冲突 |
| race | 降级 weighted + 设置页标注「仅 Web」 | native 从未实现 race，此为显式化而非行为缩减 |

配置读取走 `RawProvider` 接缝（生产 = SharedPreferences `"CapacitorStorage"` 的 `image_host_settings` JSON，先例：`ImageIntercept` 读 `image_cache_disk`），按 String 引用比对惰性重解析；注入 `Clock`/`Random`/`ProbeFn` 保证接口即测试面。

### D4：失败回退与失效兜底

- 镜像下载失败 → **官方重试一次**（四接入点一致）；镜像连接/调用预算低于官方（spec 定值），防止通路劣化拖慢首载。
- 配置 JSON 解析/形状校验失败 → 图床视为关 + `console.warn`/`Log.w`（测试硬约束 #3，禁静默降级）。
- 镜像 host 的 baseUrl 为 pximg.net 域 → 跳过（与 JS `validateHostInput` 写入侧防线对称）。

## 后果

- **用户可见**：native 图床首次真正生效（列表/详情/动图全出镜像图）；lynx 引擎继承 webview 配置的图床（lynx 无设置 UI，共享存储契约）；fastest-ip 双引擎生效；race 在 native 显式降级。
- **错误面微变（review 补记）**：预取 reject 消息文本随委托下载核心而变（`Download failed (HTTP xxx)` → `Prefetch failed: <IOException 消息>`，无 JS 文本消费方）；空 body 200 由「写空缓存文件」变为抛 IOException 不写盘（self-healing miss 改进）。
- **契约固化**：prefetch 入参回归官方 URL，预取/显示键从「巧合对齐」变「契约保证」。
- **不受影响**：三层缓存体系、`ImageCachePlugin`、ugoira 帧缓存（illustId 键，天然源无关）、web dev 图床链路（开发机有网，维持现状，另行澄清不在本期）。
- **风险承接**：镜像对 `/img-zip-ugoira/` 的支持未实证——回退官方兜底 + 验收探针；镜像字节与官方一致性列入验收（sha256 比对）。
- **排他澄清**：Pixiv 直连（免梯 IP 表，方案 v2 见直连 effort）为**独立挂起立项**，与图床修复无共享代码；其落地后的「图床 × 直连优先级」是该 effort 的新决策点。
