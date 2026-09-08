# ADR-0146: 免代理主路径转向「用户自建反代（Cloudflare Worker）」——无 SNI 直连降级为兜底

> **状态变更（2026-09-08）：已废弃，仅作技术记录**
>
> 用户 2026-09-08 拍板：去除项目中所有远程代理相关方式。本 ADR 描述的 CF Worker 反代主路径已不再采用。
>
> 废弃原因：用户偏好"零中间人"——所有 GFW 抵抗必须在客户端/原生层完成，零远程基础设施。
>
> 取代方案：见 [pictelio-pure-client-direct-access.md](../research/pictelio-pure-client-direct-access.md) + ADR-0147（待写：三档 networkMode + 客户端直连主路径）。
>
> 代码清理：commit 移除 `worker/` 目录、`ApiEndpoints.java`、`apiProxyStore.ts`、`SettingsApiProxy.tsx`、`.github/workflows/ci.yml` 中的 Worker 合约测试任务。

- 状态：~~accepted~~ → **deprecated**（依据 2026-09-08 用户决策）
- 关联：修订 [ADR-0144](./ADR-0144-direct-access-transport.md) 的方案定位；承接 [ADR-0145](./ADR-0145-direct-access-v2.md)（多候选竞速/分层超时保留为兜底机制）；图床体系（ADR-0143）镜像模式同构先例

## 背景（证据链摘要）

无 SNI 直连（钉定边缘 IP + Host 头路由）经真机+模拟器两代 Android TLS 栈实测：

- GFW 对 Android Conscrypt 的无 SNI ClientHello 做**指纹级 100% RST**（模拟器 API 28 与 OPPO 较新栈同判；同分钟同源 Mac LibreSSL ~50-55% 通过——同时性 A/B 实验排除网络级全面封锁）
- hello 整形试验（TLS1.2-only、精简 cipher、剥 ALPN）**全部无效**，判别器不可穷尽
- 结构性缺陷：IP 表托管于 GitHub（自身被墙）→ 新装无代理用户存在自举死锁；IP 池维护是无上限的猫鼠游戏

结论：无 SNI 直连可作为「零配置尽力而为」兜底，不可作为稳定主路径。

## 决策

### D1：主路径 = 用户自建反代

仓库内提供 Cloudflare Worker 源码（`worker/` 目录）+ 一键部署指引。用户部署后获得形如 `https://<name>.<subdomain>.workers.dev` 的私有反代端点，在 App 设置中填入。

- **TLS 全程正常**：App → Cloudflare（真 SNI，CF 不会被整段墙）；CF 边缘 → Pixiv（CF 网络出境，不受 GFW 对住宅流量的封锁影响）
- **信任边界**：Worker 是用户自己部署的账号——流量凭据不经过任何第三方
- **零维护**：无 IP 表、无证书跟踪；Pixiv 侧变更由 CF→Pixiv 的真实域名解析自然消化

### D2：Worker 合约（路径前缀路由，单 Worker 双上游）

```
<prefix>/api/*    → https://app-api.pixiv.net/*          （API）
<prefix>/oauth/*  → https://oauth.secure.pixiv.net/*     （OAuth 刷新/交换）
```

- 请求头/体/查询串透传（Authorization、X-Client-Time/Hash、App-OS、UA 原样上行；Host 由 fetch 按上游 URL 重写）
- 响应原样回传；错误（上游 4xx/5xx/异常）带状态码透传，不吞不降级
- 图片不在 Worker 合约内：图片走既有图床镜像体系（ADR-0143），两者正交可叠加

### D3：App 侧接入 = 单一接缝「API 反代地址」设置项

- 新增设置键 `api_proxy_base`（形如 `https://x.y.workers.dev/p`；空 = 关闭）
- Java 侧统一走 `ApiEndpoints`（读 CapacitorStorage，空值回退官方域名）：`PixivApiCore.apiBase()`、`AuthPlugin`/`OAuthPlugin` 的 OAuth URL——**接缝数量收敛为「基址提供者」一处**，请求构造点零散改动归零
- 双 flavor（webview/lynx）读同一 CapacitorStorage 键（跨引擎共享，先例：R18 账号设置）
- 直连开关语义不变：反代与直连**可叠加**（反代优先级高于直连：反代配置存在时，官方域名请求走反代，直连只服务未走反代的直连域名流量——边界在实施 spec 中细化）

### D4：直连降级为「零配置尽力而为」兜底

ADR-0145 的候选竞速/分层超时/记账修正/可观测性全部保留——直连在「边缘 IP 未被标记」的窗口内仍提供免部署价值；被标记时由 D3 的反代接管。

### D5：一键部署

Worker 目录附带 wrangler 配置与部署文档（Cloudflare Dashboard 粘贴部署 / `wrangler deploy` 两条路径）；一键部署按钮（Deploy to Cloudflare）在后续 ticket 落地。

## 后果

- 「极度稳定」的达成路径从「对抗 GFW 指纹识别」（无上限军备竞赛，本次判负）切换为「正常 TLS 到 CF」（该类流量是大陆互联网的常规形态，无对抗面）
- 用户成本：一次性 Cloudflare 账号注册 + 5 分钟部署（免费额度 10 万请求/天，远超单用户用量）
- 遗留：直连 v1/v2 的已修韧性（乐观登录、瞬时失败不踢登录页）与全部反代无关，独立上线价值不变
