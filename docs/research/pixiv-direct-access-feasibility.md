# Pixiv 免梯直连可行性原型验证报告

> 2026-09-06 · 探针脚本 `scripts/prototype-pixiv-bypass.mjs`（PROTOTYPE，throwaway）· 环境：中国大陆家宽 + 本机系统代理（仅基线对照用，全部探测均为直连）
>
> 本文验证上一轮调研《第三方 Pixiv 客户端免梯机制》（会话报告，未落盘）给出的各条通路。上一轮有一项"高概率但未确证"的结论（s.pximg.net 换 host）本次被**证伪**，已修正。

## 一、结论速览

**三层免梯通路全部实证可行**：图片层 3 条通路可用、API 层 compat 路线打通、OAuth 登录端点（含 Pictelio 401 刷新契约）直连打通。s.pximg.net 换 host 方案证伪；QUIC 路线本次探针不可判定。

| 层 | 通路 | 判定 | 证据 |
|---|---|---|---|
| 图片 | 无 SNI TLS 直连 `i.pximg.net`（Pixez compat） | ✅ 可用 | HTTP 200，sha256 与经代理基线**完全一致** |
| 图片 | 明文 HTTP 直连 `i.pximg.net`（80 端口） | ✅ 可用（不建议生产） | HTTP 200，sha256 与基线一致 |
| 图片 | 社区镜像 `i.pixiv.re` 直连 | ✅ 可用 | HTTP 200（Pictelio 现有图床设置零代码路线） |
| 图片 | 换 host 到 `s.pximg.net` | ❌ **证伪** | 同路径返回 nginx 404（与 `i.pximg.net` 内容空间不同） |
| API | 无 SNI + 静态 IP `210.140.139.155`（Pixez host.json） | ✅ 打通 | `/v1/illust/detail` 返回 OAuth 错误 JSON（端点已处理） |
| API | 对照：同 IP 带 pixiv SNI | ❌ 被重置 | GFW 按 SNI 后缀 RST（封锁点确证） |
| API | 备选：Cloudflare IP + 无 SNI | ❌ 不可用 | CF 无 SNI 无法路由，握手失败告警 |
| 登录 | 无 SNI 直连 `POST /auth/token`（refresh_token grant） | ✅ 打通 | 返回 `invalid_grant` code 1508（= Pictelio 401 静默刷新契约免梯可达） |
| 登录 | 同上（password grant） | ⚠️ 网络通、授权被拒 | 返回 "The grant type is unauthorized"——官方 client_id 的密码直连可能已被 Pixiv 禁用，需真实凭证定论 |
| QUIC | UDP 443 → Cloudflare / Pixiv 自建边缘 | ⚠️ 不可判定 | 伪造 VN Initial 无响应（GFW 丢 UDP 与无 QUIC 服务无法区分，Shaft 用真 Initial） |

## 二、方法

一次性 Node 脚本（零依赖，Node 内置 `tls`/`net`/`dgram`），核心原语：

1. **裸 TLS + HTTP/1.1 探测**：`tls.connect` 以 **IP 字面量**建连（Node 对 IP 不发 SNI）+ 手写 `Host` 头——把「DNS 解析」「SNI」「HTTP 路由」三个变量完全解耦。
2. **内容一致性**：直连拉取与经代理基线（`curl -x`）做 sha256 比对，样本图为探测当日 ranking 榜单真实图片（必然在线）。
3. **假凭证探活**：OAuth 端点用假 refresh_token/password 发请求，以「服务端返回结构化错误」证明端到端处理（不触碰真实凭证）。
4. **对照实验**：同 IP 带/不带 SNI 一组成对，隔离 GFW 行为与边缘行为。

运行：`node scripts/prototype-pixiv-bypass.mjs`（含 15 项探测，~90 秒）。

局限：所有结论仅代表探测时刻（2026-09-06）的网络状态；GFW 策略与 Pixiv 边缘拓扑都会变化，通路属**猫鼠游戏**，量产实现需带配置更新机制。

## 三、关键事实（逐层）

### 3.1 封锁模型（与上轮一致，本次再确认）

- `*.pixiv.net` 与 `i.pximg.net`：DNS 污染（系统 DNS 假 IP）+ **HTTPS SNI 阻断**（带 pixiv SNI 的 ClientHello 即被 RST，与目标 IP 无关）。
- **80 端口明文不拦**：明文 HTTP 请求（含 Host 头、真实图片路径）原样到达 Pixiv 边缘。
- `s.pximg.net`：DNS 干净、TLS 可直连——但**不能**用来取 `i.pximg.net` 的图（见 3.2）。

### 3.2 图片层

- **无 SNI TLS 直连可行且内容一致**（I4）：钉 IP `210.140.139.131` + 不发 SNI + `Host: i.pximg.net` + `Referer: https://app-api.pixiv.net/`，返回 200、53,856B、sha256 与基线一致。
- **明文 HTTP 同样可行**（I3）：同路径 sha256 与基线一致。因 Host/路径明文暴露、未来可能被升级为 Host 阻断，**只作旁证，不推荐生产使用**。
- **s.pximg.net 换 host 证伪**（I1）：`s.pximg.net` 与 `i.pximg.net` 虽在相同 IP 段/相同边缘集群，但 **vhost 内容空间不同**——对 `i.pximg.net` 路径返回 nginx 404 页面（146B）。上轮报告"高概率可行"的推测**作废**。
- 社区镜像 `i.pixiv.re` 当日可用（I5）——这是 Pictelio **现有 imageHostService 设置里零代码**的免梯路线。

### 3.3 API 层

- Pixiv 自建边缘 `210.140.139.155`（Pixez `host.json` 内置值，2026-09 仍存活）**同时服务 `app-api.pixiv.net` 与 `oauth.secure.pixiv.net` vhost**：无 SNI + Host 头即可路由（A2/H1/H2 均命中该边缘）。
- **边缘特化**：同段的 `210.140.139.131/134`（pximg 边缘）对 API/OAuth 的 Host 返回 **421 Misdirected Request**——静态 IP 路线必须选对边缘 IP，错 IP 拿到的是 421 而非封锁。
- Cloudflare 托管的现网解析 IP（104.18.x）走无 SNI 不可用（A4：CF 按 SNI 路由，无 SNI 直接 handshake_failure）——**compat 路线依赖 Pixiv 自建边缘存活**，这正是 Shaft 2026-04 后 API 侧退化并迁 QUIC 的背景。

### 3.4 登录层（对 Pictelio 最关键）

- **refresh_token 刷新直连打通**（H2）：无 SNI 直连 `POST /auth/token`（`grant_type=refresh_token`，假 token），返回 `{"has_error":true,"errors":{"system":{"message":"Invalid refresh token","code":1508}},"error":"invalid_grant"}`——**Pictelio 现有 401 静默刷新链路的免梯版本完全可行**：登录一次（哪怕走梯）后，token 续期永远不需要梯。
- **password grant 网络通但被授权拒绝**（H1）：返回 "The grant type is unauthorized"。网络层可达，但官方 `client_id`（MOBrBDS8…）的密码直连可能已被 Pixiv 服务端禁用（与 pixivpy 2021 起弃用密码登录的旁证方向一致）。真实凭证未测（不触碰用户账号），定论需后续用真实账号验证。
- **新发现：OAuth 端点短窗口限频**：`/auth/token` 连发（间隔 < 1s）第二次起超时/无响应，冷却 30 秒后单发立即恢复——量产实现的刷新退避策略需按此设计（探针脚本已内置 30s 冷却）。

### 3.5 证书与安全性（重要，比 Pixez 更优的形态）

无 SNI 握手时，Pixiv 边缘返回**合法证书**：

```
subject: CN=pixiv.net
issuer : C=US, O=Google Trust Services, CN=WR1
validTo: 2026-11-01
SAN    : pixiv.net, *.pixiv.net, pixiv.me, public-api.secure.pixiv.net,
         oauth.secure.pixiv.net, www.pixiv…
```

即 **`*.pixiv.net` 泛域名证书覆盖全部目标域名**。生产实现可以**保留证书链校验**，仅需把主机名校验目标从「连接 IP」改为「预期域名 `*.pixiv.net`」（自定义 TrustManager/hostnameVerifier）。Pixez compat 模式选择直接关闭证书校验（`verifyCertificates: false`），本报告认为非必要——关闭校验会引入中间人风险，得不偿失。

### 3.6 QUIC 路线

伪造 Version Negotiation Initial（version=0x0a0a0a0a）对 Cloudflare 与 Pixiv 自建边缘的 UDP 443 均无响应。原因无法区分（GFW 丢 UDP / 边缘不响应伪造包 / 无 QUIC 服务），本探针**不可判定** Shaft 的 QUIC 路线。若未来 compat 路线退化，需用真 QUIC 栈（Cronet）重测。

## 四、对 Pictelio 的落地含义（仅结论，未实施）

| 场景 | 落地形态 | 改动量 |
|---|---|---|
| 看图免梯（今天就可用） | 设置 → 图片托管 → 启用 `i.pixiv.re`（现有 imageHostService 多模式已支持） | **零代码** |
| 看图免梯（直连官方，不依赖第三方镜像） | 图片请求按 I4 形态改造：OkHttp 请求 URL host 写 IP、拦截器补 `Host` 头、无 SNI TLS（IP 建连即无 SNI）、自定义 hostnameVerifier 按 `*.pixiv.net` 校验 | 中（`PixivImageLoader`/`PixivApiCore` 的 URL 构建层 + 一个连接工厂） |
| API 免梯 | 同上形态应用于 `PixivApiCore.API_BASE` 的请求构建；IP 表需带更新机制（参照 Pixez host.json 的可更新资产） | 中 |
| 登录后免梯 | 已具备（refresh_token 持久化 + 401 静默刷新），网络层按上两行改造后**全程免梯**；注意刷新限频退避（≥30s 窗口） | 低 |
| 首次登录免梯 | 依赖 password grant 是否仍被授权（H1 显示可能已被禁）——**待真实凭证验证后定论**，不作为立项前提 | — |

风险面：通路依赖 Pixiv 自建边缘 IP 存活（421 特化证明边缘按 vhost 分工）与 GFW 策略不变；两者都会变，量产需「可更新 IP 表 + 多通路降级（直连 → 镜像）+ 现有代理路线兜底」。

## 五、完整探测矩阵（最终运行输出）

```
✅ D1   系统 DNS 解析 s.pximg.net          未污染（210.140.139.x 真实 IP）
✅ D2   系统 DNS 解析 app-api.pixiv.net    污染确认（假 IP 74.86.226.234）
✅ I0   基线：经代理拉 i.pximg.net         200, 53856B, sha=42950663683f8b01
❌ I1   直连 HTTPS s.pximg.net（换 host）  200 但 body 为 nginx 404（证伪）
✅ I3   直连明文 HTTP i.pximg.net          200, 53856B, sha 与基线一致
✅ I4   直连 HTTPS i.pximg.net 无 SNI      200, 53856B, sha 与基线一致
✅ I5   社区镜像 i.pixiv.re 直连           200
✅ A1   API 基线：假 IP + 正常 SNI         timeout（封锁复现）
✅ A2   API 免梯：无 SNI + 静态 IP 155     HTTP 400 OAuth 错误 JSON（端点已处理）
✅ A3   API 对照：同 IP 带 pixiv SNI       RST@TLS握手（SNI 是封锁点确证）
❌ A4   API 备选：Cloudflare IP + 无 SNI   TLS handshake_failure（CF 需 SNI 路由）
✅ H1   OAuth /auth/token（password）      HTTP 400 "grant type is unauthorized"（网络通）
✅ H2   OAuth /auth/token（refresh_token） HTTP 400 invalid_grant code 1508（Pictelio 契约通）
❌ Q1   UDP 443 → Cloudflare               无响应（不可判定）
❌ Q2   UDP 443 → Pixiv 自建边缘           无响应（不可判定）
```

（PASS 判定含义见脚本内注释：A1/H1 的 PASS/FAIL 语义为「符合预期/不符合预期」，非「功能可用」。）
