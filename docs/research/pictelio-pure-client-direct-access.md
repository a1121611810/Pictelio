# Pictelio 纯客户端直连实施方案

> **作者**：研究 agent · **日期**：2026-09-08 · **状态**：实施方案（待 ADR 落地）
>
> **本方案唯一目标**：在 **不动用任何远程代理 / 反代 / HibiAPI / 公共镜像** 的前提下，让 Pictelio Android Native 构建走客户端级 GFW 抵抗路线，达到与 pixez-flutter / Pixeval 同档的免梯能力。

---

## 0. 任务边界（用户已明示，违反视为违规）

### 0.1 明确否决的路线（**不存在于本方案**）

本方案**根本不存在**对以下路线的取舍比较——它们已从设计空间删除：

- ❌ **CF Worker 反代**（ADR-0145/0146 主路径）—— 即便自建也属「远程代理」，整路径回滚
- ❌ **HTTP CONNECT 分片代理**（仓库内提及的 `direct-fragmentation-effort-403` / `prototype/tcp-fragment-proxy` 支线）—— 治标路线，验证后判负，整路径回滚
- ❌ **HibiAPI**（github.com/mixmoe/HibiAPI 第三方公共实例）—— 第三方依赖，禁用
- ❌ **任何公共镜像/反代**（i.pixiv.re / api.loliko.cn / pixiv.cat 等）—— 用户自主行为除外

### 0.2 保留的路线（**唯一允许的方案域**）

- ✅ **纯客户端直连**：IP 钉死 + Host 头注入 + ECH（可选）+ DoH 兜底刷新 + TLS 分片（应急储备）
- ✅ **用户系统代理**：`https_proxy` 环境变量 / Android 系统 VPN —— 用户的个人梯子不算「项目内的远程代理」，是用户自主行为
- ✅ **Native 平台原生能力**：Java `shouldInterceptRequest` / OkHttp 自定义 `Dns` / Cronet

---

## 1. TL;DR

**Pictelio 的「纯客户端直连」路线完全可行**，且仓库内已有 70% 的工程地基（`directaccess` 子包 + `MainActivity.shouldInterceptRequest` + `ImageIntercept` 拦截 + `PixivApiPlugin` OkHttp 装配）。

**关键结论**：

1. **撤销 ADR-0145/0146 整路径**——CF Worker 反代路线退出本方案域（但 ADR 不删，标记「已废弃，仅作技术记录」），配套回滚 `worker/` 目录、`ApiEndpoints` 设置卡、`ApiEndpoints` JS bridge、Cloudflare IP 表托管文件
2. **拒绝 TCP 分片代理落地**——`prototype/tcp-fragment-proxy` 分支实测只能 A/B 测试，不进生产；判断为治标路线失效，不进合并序列
3. **增强既有的 `directaccess` 子包**——ADR-0144 的「OkHttp + 自定义 Dns + SNI 剥离」已经是客户端级方案，保留并加固：补 Host 头注入到 `ImageIntercept` 的图片路径、补 `shouldInterceptRequest` 的 Host 头、扩 DoH 刷新端点候选池
4. **新增三档 `networkMode`（仿 pixez-flutter）**：`standard`（系统 DNS）/ `direct`（IP 钉死 + Host 头 + DoH）/ `compat`（兜底：Android 走系统代理；Web 平台弹窗告知）
5. **Web 平台诚实结论**：浏览器 fetch 不可自定义 DNS，**Web 平台纯客户端直连不可能**——`direct` 模式下 Web 只能走用户系统代理（用户责任），否则弹窗告知「请使用 Android 原生客户端」

---

## 2. 现有方案的去留决策

### 2.1 ❌ 回滚 ADR-0145/0146（CF Worker 反代主路径）

**判断依据**：用户明示「不要远程代理」，CF Worker 无论「自建」还是「公共」，都属于「远程代理」语义，**整路径回滚**。

**回滚清单（commit 范围）**：

| Commit           | 内容                                                                                        | 处置                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a39d543b`       | 「fix: 认证韧性（乐观登录）+ 直连 v2（多候选竞速/分层超时）+ 反代主路径（ADR-0145/0146）」  | 拆分：`乐观登录` 部分保留（独立价值，与反代无关，#394）；`直连 v2`（多候选竞速/分层超时）保留（属于客户端级方案，纳入 §6 direct 模式）；**`反代主路径` 整段撤销** |
| `0d933267`       | 「feat(app): 反代 App 侧接入——ApiEndpoints 端点提供者 + 「API 反代」设置卡（ADR-0146 D3）」 | **整 commit revert**                                                                                                                                              |
| `aae4b97d`       | 「docs(adr): ADR-0146 主路径转向用户自建反代（CF Worker）+ Worker 源码与部署指引」          | ADR 标记「已废弃，仅作技术记录」**不删**（保留回溯证据）                                                                                                          |
| `2dfe7e3d`       | 「test(worker): Worker 合约测试（前缀路由/头体透传/421 透传/502）+ CI 接入」                | **整 commit revert**                                                                                                                                              |
| `a89d...` (待查) | `worker/` 目录下的 `src/worker.js` / `wrangler.toml` / `worker/README.md`                   | **整目录删除**（或归档到 `archive/worker-0146/`，避免硬删丢证据）                                                                                                 |

**保留不动的 commit**（客户端级方案，不依赖 CF Worker）：

| Commit     | 内容                                                                         | 保留理由                                                                                    |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `c7a96041` | 「feat(directaccess): 直连 v2——多候选竞速、分层超时与记账修正（ADR-0145）」  | ADR-0145 D1-D5（候选序列/分层超时/记账修正/IP 池扩展/证书轮换）全部是客户端级方案，**保留** |
| `46b5ce0a` | 「feat(android): 直连传输层失败可观测——钉定失败/421 记账同步 warnSink 告警」 | 可观测性，独立价值                                                                          |
| `dbc0af3c` | 「feat(directaccess): 连接保活——池 idle 30min + HTTP/2 PING 30s」            | 连接复用，独立价值                                                                          |
| `83409cdc` | 「test(directaccess): D2 分层超时配置钉住（connect 5s / 整体 45s 不变）」    | 测试 pin 值                                                                                 |

**操作建议**：

```bash
# 1. 新建 revert 分支
git checkout -b revert/cf-worker-primary-0146 main

# 2. 整 commit revert（按时间逆序）
git revert --no-commit a39d543b  # 仅撤销反代部分，需手动 edit
git revert --no-commit 0d933267
git revert --no-commit aae4b97d
git revert --no-commit 2dfe7e3d

# 3. 手动编辑 a39d543b 的 revert：
#    - 保留 `乐观登录` patch（#394）
#    - 保留 `直连 v2` patch（c7a96041 的同语义独立提交）
#    - 仅撤销 `反代主路径（ADR-0146）` 相关行

# 4. 删除 worker/ 目录（移到 archive/）
mkdir -p archive/worker-0146
git mv worker/ archive/worker-0146/

# 5. ADR 标注为「已废弃，仅作技术记录」（不删）
#    在 docs/adr/ADR-0146-reverse-proxy-primary.md 顶部加：
#    > **状态变更（2026-09-08）**：已废弃。用户决策「纯客户端直连」路线不再依赖 CF Worker 反代；
#    > 本 ADR 仅作技术记录保留，新方案见 docs/research/pictelio-pure-client-direct-access.md。
```

### 2.2 ❌ 拒绝 TCP 分片代理落地

**判断依据**：仓库内 `prototype/tcp-fragment-proxy` 分支（commit `163a3478`，2026-09-08）实现了 `TlsFragmentingProxy`（144 行）+ `FragmentationABTest`（101 行）+ 单测（69 行）。模拟器实测：A 组（无分片）100% RST，B/C 组（分片 offset=1/5）100% 成功。**原理同 xray/GoodbyeDPI（TCP 流重组破坏）**。

**为什么拒绝合并**：

1. **治标路线判负**（与 ADR-0145 D5 同期判断一致）：GFW 已升级针对 TCP 分片的反制（参见 [GFW Report 2025 关于 TLS 分片反制](https://github.com/net4people/bbs/issues/296)）
2. **A/B 测试 ≠ 生产可用**：模拟器内 100% 成功不代表真机；用户实测后判定「治标不治本」
3. **架构冲突**：与 `directaccess` 子包（客户端 IP 钉死方案）互斥——同一 OkHttpClient 不能同时装 TCP 分片 + 自定义 Dns
4. **维护成本**：TCP 分片实现依赖 TCP 流重组时序敏感，GFW 调整窗口大小即可能全段失效

**处置**：

| 项                                                      | 动作                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `prototype/tcp-fragment-proxy` 分支                     | **不合并到 main**；保留为 throwaway prototype（与 `prototype/tcp-fragment-proxy` 同质：探针 + A/B 测试用） |
| `TlsFragmentingProxy.java` / `FragmentationABTest.java` | **不进生产代码**；归档到 `archive/tcp-fragment-ab-test-2026-09/`                                           |
| ADR（如有）                                             | 不写——prototype 不立 ADR                                                                                   |

> **应急保留**：如果未来某天客户端 IP 钉死 + ECH + DoH 全部失效（GFW 全面升级），TCP 分片作为「应急储备」可重新启用。`archive/` 目录保留源码，但**默认不装配到生产 client**。

### 2.3 ✅ 保留 + 增强 Java `shouldInterceptRequest` 图片代理

**现状**（commit `a612ec65` 已落）：`MainActivity.onStart`（full flavor） / `MainActivityWebview.onStart`（webview flavor）包装 `WebViewClient.shouldInterceptRequest`，命中 `/pixiv-img/` 路径调 `ImageIntercept.interceptImage()` → `PixivImageLoader` → `PixivApiCore` 走 OkHttp。

**保留**：

- `MainActivity.shouldInterceptRequest` 拦截逻辑（`packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java:117-175` 与 webview flavor 对应行）
- `ImageIntercept.interceptImage` 内存/磁盘双缓存逻辑（`packages/app/android/app/src/webview/java/io/pictelio/app/ImageIntercept.java:60-120`）
- `PixivImageLoader` 的 URL 重写 + 下载核心

**增强点**（详见 §4.2）：

| 增强                                                                                                               | 文件                                            | 优先级 |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------ |
| 显式注入 `Host: i.pximg.net` 头（避免 Akamai 虚拟主机错 bucket）                                                   | `PixivImageLoader.java` + `ImageIntercept.java` | P0     |
| `Referer` 头从 `https://app-api.pixiv.net/` 改为 `https://www.pixiv.net/`（pixez-flutter 同款，对部分 vhost 必要） | `PixivImageLoader.java`                         | P1     |
| IP 钉死走 `directaccess` 子包（统一 IP 表管理）                                                                    | `PixivImageLoader.java` 改用 `PinnedDns.lookup` | P1     |

### 2.4 ✅ 新增客户端直连主路径

| 改动                                         | 文件                                                                                     | 优先级 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| 三档 `networkMode` 设置项                    | `packages/app/src/settings/registry.ts` 新增 `networkMode`                               | P0     |
| API/OAuth 直连路径                           | `packages/app/src/api/client.ts` + `packages/app/src/api/auth.ts` 接入 `networkMode`     | P0     |
| 图片直连路径                                 | `packages/app/src/components/PixivImage.tsx` + `PixivImage.ts` 触发 `/pixiv-img/` 走直连 | P0     |
| Java 直连能力桥接                            | `packages/app/src/native/PixivApi.ts` + `PixivApiPlugin.java`                            | P0     |
| `shouldInterceptRequest` Host 头             | `MainActivity.java` + `ImageIntercept.java`                                              | P0     |
| DoH 刷新机制                                 | 新建 `packages/app/src/services/directAccessService.ts`                                  | P1     |
| 错误归类（IP 失效 / DoH 失败 / Host 头缺失） | `packages/app/src/utils/normalizeQueryError.ts`                                          | P1     |
| ECH 镜像（OkHttp 5.x）                       | `DirectAccessTransport.java` ECH 配置                                                    | P2     |

---

## 3. 域名分类与策略矩阵

> **Oracle 溯源**：所有「封锁模型」「可行性判定」「IP 默认值」均来自 `prototype/pixiv-bypass-feasibility` 分支（commit `68fbd826`，2026-09-06）的探针报告 `docs/research/pixiv-direct-access-feasibility.md`，加上 `prototype/pixiv-bypass-feasibility` 分支实测脚本 `scripts/prototype-pixiv-bypass.mjs` 的 I0-I5 / A1-A4 / H1-H2 / Q1-Q2 探测矩阵。

### 3.1 域名策略矩阵

| 域名                                | 封锁模型                               | 客户端直连可行性                                                          | 推荐策略                                                                                                          | 静态 IP 默认值                                             | 回落 IP 池                                                |
| ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| **`i.pximg.net`**                   | DNS 污染 + HTTPS SNI 阻断              | ✅ **高**                                                                 | IP 字面量建连 + 无 SNI + `Host: i.pximg.net`                                                                      | `210.140.139.131`（探针 I4 实测，sha256 与经代理基线一致） | `210.140.139.131`（单 IP；Akamai 边缘轮换，DoH 刷新获取） |
| **`s.pximg.net`**                   | DNS 干净、TLS 可直连（探针 D1）        | ⚠️ **中**（不能用作 `i.pximg.net` 替代，探针 I1 证伪）                    | 系统 DNS 直连（无需 IP 钉死）                                                                                     | 系统 DNS                                                   | —                                                         |
| **`app-api.pixiv.net`**             | DNS 污染 + SNI 拦截（探针 A3 确证）    | ⚠️ **中**（CF 后端 IP 经常轮换；探针 A2 实证 `210.140.139.155` 当前可达） | IP 钉死 + 无 SNI + `Host: app-api.pixiv.net`                                                                      | `210.140.139.155`（探针 A2 实测，vhost 服务该 host）       | `210.140.139.155` + DoH 拉取最新 Akamai 边缘              |
| **`oauth.secure.pixiv.net`**        | 同 app-api（探针 H2 实测同 IP 服务）   | ⚠️ **中**                                                                 | 同 app-api（`Host: oauth.secure.pixiv.net`）                                                                      | `210.140.139.155`（与 app-api 共 IP）                      | 同上                                                      |
| **`accounts.pixiv.net`**            | 同 app-api（未探针实证，但同机房推测） | ⚠️ **中**                                                                 | 同 app-api                                                                                                        | `210.140.139.155`（推测，待真机验证）                      | —                                                         |
| **`www.pixiv.net`**                 | DNS 污染 + SNI 拦截                    | ⚠️ **中**（pictelio 不直接调，主要给 cookie/UA 参考）                     | IP 钉死 + `Host: www.pixiv.net`                                                                                   | `210.140.139.155`（与 app-api 共 IP）                      | —                                                         |
| **`api.github.com`**                | DNS 污染 + TLS 阻断                    | ⚠️ **中**（直连 GitHub meta API）                                         | DoH 查询 GitHub Meta API（`https://api.github.com/meta` 返回 `actions`/`packages`/`...` 数组即 IP 列表）+ IP 钉死 | DoH 动态获取                                               | DoH 失败回落 — 走系统代理                                 |
| **`objects.githubusercontent.com`** | DNS 污染                               | ⚠️ **中**                                                                 | 同 api.github.com                                                                                                 | DoH 动态获取                                               | 同上                                                      |

### 3.2 关键事实（来自探针原文逐条引用）

**封锁模型（探针 §3.1）**：

- `*.pixiv.net` 与 `i.pximg.net`：DNS 污染（系统 DNS 假 IP）+ HTTPS SNI 阻断（带 pixiv SNI 的 ClientHello 即被 RST）
- **80 端口明文不拦**：明文 HTTP 请求原样到达 Pixiv 边缘（探针 I3 实测 sha256 一致）
- `s.pximg.net`：DNS 干净、TLS 可直连——但 **不能** 用来取 `i.pximg.net` 的图（探针 I1 证伪：同 IP 同边缘，但 vhost 内容空间不同，nginx 404）

**边缘特化（探针 §3.3）**：

- Pixiv 自建边缘 `210.140.139.155` 同时服务 `app-api.pixiv.net` 与 `oauth.secure.pixiv.net` vhost
- **同段的 pximg 边缘 IP（131/134）对 API/OAuth 的 Host 返回 421 Misdirected Request** —— 静态 IP 路线必须选对边缘 IP，错 IP 拿到的是 421 而非封锁
- Cloudflare 托管 IP（104.18.x）走无 SNI 不可用（CF 按 SNI 路由，无 SNI 直接 handshake_failure）—— **compat 路线依赖 Pixiv 自建边缘存活**

**证书与安全性（探针 §3.5）**：

- 无 SNI 握手时 Pixiv 边缘返回 `*.pixiv.net` 泛域名合法证书（issuer = Google Trust Services WR1，SAN 覆盖全部目标域名）
- **生产实现可以保留证书链校验**，仅需把主机名校验目标从「连接 IP」改为「预期域名 `*.pixiv.net`」
- Pixez compat 模式直接关闭证书校验（`verifyCertificates: false`），探针认为**非必要**——关闭校验会引入中间人风险

**OAuth 限频（探针 §3.4）**：

- `/auth/token` 连发（间隔 < 1s）第二次起超时/无响应，**冷却 30 秒后单发立即恢复**
- 量产实现的刷新退避策略需按此设计（探针脚本已内置 30s 冷却）

---

## 4. 静态 IP 表

### 4.1 硬编码默认 IP（基于实证数据）

**Oracle 来源**：全部取自探针报告 `pixiv-direct-access-feasibility.md` §3.2-3.4 的 I4 / A2 / H2 实测条目，**不发明未验证 IP**。

#### 4.1.1 图片边缘（*.pximg.net）

| Host                  | IP                | 探针矩阵                                               | 内容验证                                 |
| --------------------- | ----------------- | ------------------------------------------------------ | ---------------------------------------- |
| `i.pximg.net`         | `210.140.139.131` | I4：HTTP 200, 53,856B, sha256 与经代理基线**完全一致** | ✅ 强证据                                |
| `i.pximg.net`（备选） | `210.140.139.134` | 未直接探针；同段推测（同段 + 同 421 边缘特性）         | ⚠️ 弱证据，仅作回落                      |
| `s.pximg.net`         | 系统 DNS          | D1：未被污染                                           | ✅ 但**不能替代** i.pximg.net（I1 证伪） |

**两边缘必须分列（禁合并）**（探针 §3.3 + ADR-0144 DirectAccessPolicy.classifyChannel）：

- 图片边缘 IP 走 `Host: i.pximg.net` 命中图片 vhost
- 同一 IP 段（`210.140.139.x`）的 API 边缘 IP 走 `Host: app-api.pixiv.net` 命中 API vhost
- **错配 = 421 Misdirected Request**，不是封锁

#### 4.1.2 API + OAuth 边缘（*.pixiv.net）

| Host                     | IP                            | 探针矩阵                                                        | 内容验证    |
| ------------------------ | ----------------------------- | --------------------------------------------------------------- | ----------- |
| `app-api.pixiv.net`      | `210.140.139.155`             | A2：HTTP 400（OAuth 错误 JSON = 端点已处理）+ `Host` 头路由正确 | ✅ 端到端通 |
| `oauth.secure.pixiv.net` | `210.140.139.155`             | H2：HTTP 400 invalid_grant code 1508 = Pictelio 401 契约通      | ✅ 端到端通 |
| `accounts.pixiv.net`     | `210.140.139.155`（**推测**） | 未直接探针；同机房推测（待真机验证）                            | ⚠️ 弱证据   |

**API+OAuth 共 IP 的语义**（探针 §3.3）：

- 同一自建边缘 `210.140.139.155` 同时服务 app-api 与 oauth.secure.pixiv.net vhost
- 探针 A2 用 `Host: app-api.pixiv.net` 命中 → API 端点
- 探针 H2 用 `Host: oauth.secure.pixiv.net` 命中 → OAuth 端点
- **直连只需一个 IP + 不同的 Host 头**

#### 4.1.3 GitHub 边缘（更新检查）

| Host                            | 策略                                 | 备注                         |
| ------------------------------- | ------------------------------------ | ---------------------------- |
| `api.github.com`                | DoH 动态获取 GitHub Meta API IP 列表 | 不硬编码（GitHub IP 经常变） |
| `objects.githubusercontent.com` | 同 api.github.com                    | 同上                         |

**实施路径**：调用 `https://api.github.com/meta`（**注意：GitHub meta API 必须走直连，依赖 GitHub Meta 自举**）→ 返回 `git: ["140.82.112.0/20"]` + `api: ["..."]` + `web: ["..."]` + `actions: ["..."]` + `packages: ["..."]` + `actions_inputs: ["..."]` 等 IP CIDR → 取 `api` 段作 `api.github.com`，取 `packages` 段作 `objects.githubusercontent.com`。

**自举死锁处理**：

- **第一次** `api.github.com` 调用必须走**用户系统代理**（用户已配梯子才能用更新检查）
- 解析到 IP 后写入持久化（`packages/app/src/settings/` 下新增 `directIpOverrides.githubApi`）
- **第二次起**走 IP 钉死
- 失败兜底：回落系统 DNS（GitHub IP 整体被污染概率低）+ `console.warn("[directAccess] GitHub DoH failed, fallback to system DNS")`

### 4.2 IP 钉死的 Android 实现细节

**接缝位置**：仓库内已有完整实现（`packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DirectAccessTransport.java`），本节**仅列出关键设计 + 增强点**。

#### 4.2.1 Java OkHttp 自定义 `Dns` 实现

**现状**（ADR-0144 D1 + `DirectAccessTransport.java:247`）：

- `PinnedDns implements Dns`：表内 host → 返回 IP 表钉定字面量；表外 → 委托 `Dns.SYSTEM.lookup`
- `InetAddress.getByAddress(InetAddress.getByName(ip).getAddress())`：严格 IPv4 字面量，按字节构造地址，**绝不发起 DNS 查询**
- 候选序列：`last-good` 优先位 → 主条目 → 重试预算 ×1 → 同通道其余（ADR-0145 D1）

**增强点**（§2.4 §6 接入 `networkMode` 后）：

```java
// DirectAccessTransport.install() 增强伪代码
switch (networkMode) {
    case STANDARD -> {
        // 卸载 PinnedDns / PinnedSSLSocketFactory / PinnedAccountingInterceptor
        // 仅保留默认 OkHttp
    }
    case DIRECT -> {
        // 现状：PinnedDns + SNI 剥离 + EventListener + AccountingInterceptor
        // 增强：补 Host 头注入（见 §4.2.3）
    }
    case COMPAT -> {
        // Android: 走系统代理（用户自主行为）
        // 不装 PinnedDns（与 ADR-0145 候选序列互斥，简化形态）
    }
}
```

#### 4.2.2 IP 选择策略（轮询 / 测速 / fallback）

**现状**（ADR-0145 D1 已落）：

- `last-good` 优先位：会话内最近一次成功候选
- 主条目 + 重试预算：单请求内原生握手重试吸收概率性 RST
- 同通道其余：IP 表内同 host 的其他条目
- 双通道独立熔断（图片通道 / API+刷新通道），3 次失败 → open 60s → 半开单探

**增强**（接 §6 三档 networkMode）：

- `DIRECT` 模式：保持现有多候选竞速
- `STANDARD` 模式：完全卸载 PinnedDns，**降级到 OkHttp 默认行为**（含系统 DNS / 系统代理）
- `COMPAT` 模式：见 §6 表格说明

#### 4.2.3 Host 头注入：Android 侧

**关键事实**（探针 + pixez-flutter + pixiv-viewer-app 三方一致）：

- Akamai 虚拟主机**必须**显式 `Host: i.pximg.net`，否则被路由到错误 bucket 返回 403/404
- Pixiv 边缘同理：`Host: app-api.pixiv.net` 区分 API 边缘 vhost 与图片边缘 vhost

**当前 Pictelio 实现**（ADR-0144 + `DirectAccessTransport.java`）：

- **隐式走 Host 头**：URL 写 `https://app-api.pixiv.net/path`、自定义 Dns 解析到 `210.140.139.155`，OkHttp 默认会用 URL 的 host 作 Host 头——**但 SNI 已被 SSLSocketFactory 剥除**（无 SNI 握手）

**问题**：URL 写域名 + 自定义 Dns 解析到 IP 时，OkHttp **同时** 会用域名做 SNI（默认行为）。必须显式覆盖。

**增强实现**（在 `PinnedSSLSocketFactory` 内增加 `SSLParameters.setServerNames(emptyList)` 已实测无效——ADR-0144 D1 注释已说明）：

```java
// DirectAccessTransport.java 新增 PinnedConnectionInterceptor
// （与 PinnedAccountingInterceptor 同模式：单实例 + warnSink + 计数）
final class PinnedConnectionInterceptor implements Interceptor {
    @Override public Response intercept(Chain chain) throws IOException {
        Request original = chain.request();
        String host = original.url().host();
        // 仅对直连白名单（*.pixiv.net / *.pximg.net）注入
        if (isDirectDomain(host) && GRANT.get() != null) {
            // GRANT 存在 = 该请求由 PinnedDns 解析（直连路径）
            // URL 仍是域名形态（保留缓存键不变量），但连接已走 IP
            // Host 头由 OkHttp 默认填 URL 的 host —— 无需手动覆盖
            // 仅当 URL 被改写为 IP 字面量时才需显式覆盖（暂不实施）
        }
        return chain.proceed(original);
    }
}
```

**结论**：**当前 ADR-0144 的实现已经隐式正确**——URL 写域名 + 自定义 Dns 解析到 IP + SNI 剥离 = OkHttp 自动用域名做 Host 头。**无需新增 Host 头显式注入**（除非未来改 URL 写 IP 字面量的形态）。

#### 4.2.4 证书校验

**当前实现**（ADR-0144 D1）：**保留标准证书链校验 + 主机名按真实 URL 域名过泛域名校验**。

**理由**（探针 §3.5）：

- Pixiv 边缘无 SNI 握手返回 `*.pixiv.net` 泛域名合法证书
- 生产实现可保留校验，**不引入 MITM 风险**
- pixez-flutter compat 模式选择关闭校验（`verifyCertificates: false`）是**非必要**的

**实施细节**：`OkHttpClient.Builder().hostnameVerifier(new OkHostnameVerifier())` + `TrustManagerFactory` 默认走平台 CA——OkHttp 默认行为即可。

#### 4.2.5 IP 钉死的 `shouldInterceptRequest` 路径增强

**现状**（commit `a612ec65` + `ImageIntercept.java:60-120`）：`shouldInterceptRequest` 拦截 `/pixiv-img/` 路径 → `PixivImageLoader.loadBytes` → `PixivApiCore` 走 OkHttp。**当前未注入 Host 头**（依赖 OkHttp 默认行为，但 URL 已是域名 `i.pximg.net` 形态）。

**增强建议**（细节见 §8 改动清单）：

| 增强                                | 文件                    | 改动                                                                                     |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| 显式注入 `Host: i.pximg.net`        | `PixivImageLoader.java` | URL 改写时若用 IP 字面量形态，必须显式 `Request.Builder().header("Host", "i.pximg.net")` |
| Referer 改 `https://www.pixiv.net/` | `PixivImageLoader.java` | pixez-flutter 同款（部分 vhost 必要）                                                    |
| 走 `directaccess.PinnedDns`         | `PixivApiCore.java`     | OkHttp 装配时接 `DirectAccessTransport.install(this)`                                    |

### 4.3 IP 钉死的 Web 实现细节

**核心结论**：**Web 平台完全无法纯客户端直连**——浏览器 fetch 不允许自定义 DNS。

#### 4.3.1 浏览器限制（诚实承认）

| 限制                                    | 影响                             |
| --------------------------------------- | -------------------------------- |
| `fetch(url)` 强制走浏览器 DNS 解析      | 无法绕过 DNS 污染                |
| `fetch` 不允许自定义 `sslSocketFactory` | 无法做 SNI 剥离                  |
| `fetch` 不允许自定义 `hostnameVerifier` | 无法做 IP 直连时的泛域名校验覆盖 |
| 浏览器原生 WebSocket 同上               | —                                |

**结论**：Web 平台下 `direct` 模式**不可能**做到 IP 钉死。

#### 4.3.2 Web 平台的诚实方案

**`direct` 模式下 Web 平台只能**：

1. **走用户系统代理**（`https_proxy` 环境变量）—— 用户自主行为
2. **弹窗告知**"请使用 Android 原生客户端" —— 最直白
3. **自动降级到 `standard` 模式** —— 网络请求等同 `standard`

**实施**（`packages/app/src/main.tsx` 启动时检测）：

```typescript
// packages/app/src/main.tsx 启动初始化
import { isNative } from "@/utils/clientSwitch";
import { directAccessService } from "@/services/directAccessService";

if (directAccessService.networkMode() === "direct") {
  if (isNative()) {
    // Android / iOS: direct 模式生效（iOS 当前不支持，落到 compat）
    if (Capacitor.getPlatform() === "ios") {
      // iOS 弹窗（一次性）
      presentDirectModeUnsupportedDialog("iOS 当前不支持纯客户端直连，已自动降级为系统代理模式");
      directAccessService.setMode("compat");
    }
  } else {
    // Web 平台：弹窗（一次性）+ 降级
    presentDirectModeUnsupportedDialog(
      "Web 浏览器无法自定义 DNS，纯客户端直连不可用。请：\n1. 配置系统代理，或\n2. 使用 Android 原生客户端",
    );
    directAccessService.setMode("compat");
  }
}
```

---

## 5. DoH 兜底刷新机制

### 5.1 关键警告

**GFW 污染 `1.1.1.1` DoH 端点**（pixiv-viewer-app 调研报告 §「DoH 必须走代理」确证）：

- `https://1.1.1.1/dns-query` 国内直接访问大概率被 RST / 重置
- pixiv-viewer-app 走自有 CF Worker 反代 DoH
- **本方案禁止远程代理** → 必须用 GFW 仍可达的 DoH 端点

### 5.2 可用 DoH 端点（**未经探针验证，列为候选项**）

> **诚实声明**：以下端点**未经仓库内探针验证**。`scripts/prototype-pixiv-bypass.mjs` 仅验证了 TLS 直连通路，未测 DoH 端点可达性。实施时必须先用 `scripts/prototype-pixiv-bypass.mjs` 同套探针方法测一轮 DoH 端点，确定候选池。

| DoH 端点                           | URL                                                  | 状态（推测）                          | 备注         |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------- | ------------ |
| Cloudflare `1.0.0.1`               | `https://1.0.0.1/dns-query`                          | ⚠️ 大概率被 GFW 污染（同 1.1.1.1 段） | 需探针验证   |
| Quad9 `9.9.9.9`                    | `https://9.9.9.9/dns-query`                          | ⚠️ 待验证（Quad9 在国内可达性不一致） | 需探针验证   |
| `dns.sb`                           | `https://doh.sb/dns-query`                           | ⚠️ 待验证（pixez-flutter 在用）       | 需探针验证   |
| `doh.dns.sb`                       | `https://doh.dns.sb/dns-query`                       | ⚠️ 待验证（pixez-flutter 在用）       | 需探针验证   |
| `1dot1dot1dot1.cloudflare-dns.com` | `https://1dot1dot1dot1.cloudflare-dns.com/dns-query` | ⚠️ 待验证（pixez-flutter 备用）       | 需探针验证   |
| **fallback**：硬编码 IP            | 直接用 `DirectIpTableDefaults` 内置表                | ✅ 永远可达（探针已实证）             | **最后兜底** |

### 5.3 实施策略

```typescript
// packages/app/src/services/directAccessService.ts（新建）
import { fetch } from "@/utils/http";

const DOH_ENDPOINTS = [
  // 候选池（按用户可达性排序；启动时探针验证后调整）
  "https://1.0.0.1/dns-query",
  "https://9.9.9.9/dns-query",
  "https://doh.sb/dns-query",
  "https://doh.dns.sb/dns-query",
  "https://1dot1dot1dot1.cloudflare-dns.com/dns-query",
];

async function resolveWithDoH(host: string): Promise<string | null> {
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const url = `${endpoint}?name=${host}&type=A`;
      const res = await fetch(url, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const answer = json.Answer?.[0];
      if (answer?.type === 1 && answer.data) return answer.data;
    } catch (e) {
      console.warn(`[directAccess] DoH ${endpoint} failed for ${host}:`, e);
      continue; // 试下一个端点
    }
  }
  console.warn(`[directAccess] DoH all endpoints failed for ${host}, fallback to builtIn`);
  return null; // 兜底由调用方落到内置 IP 表
}
```

### 5.4 解析失败回落硬编码 IP

**规则**（与 §4.2.1 PinnedDns 一致）：

```java
// DirectAccessConfig.refreshIpTableNow() 内部
List<IpTableMerger.Entry> remoteEntries = parseRemoteDoc(responseBody);
if (remoteEntries == null) {
    // 形状失败 = 同拉取失败处理
    warnSink.accept(TAG + " 远端 IP 表解析失败（形状不合规），保留上次有效表否则内置兜底");
}
// 远端表为空（无 entries 字段）= 同拉取失败处理
// 远端表非空 = 替换 remoteTable 引用
```

**fallback 链**：manual（用户手动编辑）> remote（远端 JSON）> builtIn（APK 内置常量）—— 仓库内 `IpTableMerger.merge()` 已实现。

### 5.5 TTL 处理

**仓库内现状**（`DirectAccessConfig.refreshIpTableNow()`）：

- `refreshIpTableNow()` = 设置页「立即更新」命令，忽略 TTL，**已在飞返回 false**（单飞语义）
- 远端表无 TTL 字段（`packages/website/pixiv-ip-table.json` 当前 schema：`{ version, updatedAt, entries }`）—— **必须新增 TTL 字段**（schema 升级）

**增强建议**（接 §2.4 新增 DoH 刷新）：

```typescript
// packages/website/pixiv-ip-table.json schema v2
{
  "version": 2,
  "updatedAt": "2026-09-08",
  "ttlDays": 7,  // 新增
  "entries": [
    {"host": "i.pximg.net", "ip": "210.140.139.131"},
    {"host": "app-api.pixiv.net", "ip": "210.140.139.155"},
    {"host": "oauth.secure.pixiv.net", "ip": "210.140.139.155"}
  ]
}
```

**客户端 TTL 处理**（`DirectAccessConfig.currentTable()` 增强）：

```java
// 启动时检查 lastFetchAt
// 距今 > ttlDays（默认 7） → 触发后台拉取（不阻塞）
// 拉取失败 → 保留上次有效表 + warn
// 永远不阻塞 currentTable() 返回（现状已实现）
```

### 5.6 Java 侧 OkHttp + DoH 客户端实现

**关键决策**：DoH 客户端**必须独立 OkHttpClient**——绝不能复用 `PixivApiCore` 的共享 client。

**理由**（`IpTableFetcher.java` 契约第 3 条注释）：

> 自举安全：生产实现必须使用**专用不路由**的 HTTP client——未来直连路由装配在共享 client（PixivApiCore）上时，本拉取器不得被路由（否则 IP 表拉取自身走直连 → 自举死锁）。

**实施**（新增 `DirectAccessDoHClient.java`）：

```java
// packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DirectAccessDoHClient.java
public final class DirectAccessDoHClient implements IpTableFetcher {
    private static final List<String> DOH_ENDPOINTS = List.of(
        "https://1.0.0.1/dns-query",
        "https://9.9.9.9/dns-query",
        "https://doh.sb/dns-query"
    );
    private final OkHttpClient nonRoutingClient;  // 不装 PinnedDns

    @Override
    public String fetchJson() throws IOException {
        // 实现见 §5.3 TypeScript 等价 Java 版
        // 关键：nonRoutingClient 必须是裸 OkHttpClient，无任何 Interceptor / Dns 替换
    }
}
```

> **iOS / Web 端 DoH 客户端**（`packages/app/src/services/directAccessService.ts`）：用 `fetch` + 同套端点列表 + 同套 fallback 链。

---

## 6. 三档网络模式（仿 pixez-flutter NetworkMode，给出 Pictelio 适配版）

> **重要修订**：调研报告 `pixiv-third-party-clients-direct-access.md` 表格中 `compat = HTTP CONNECT 分片代理`，**本方案中必须改为"系统代理兜底"**——分片代理已被排除（§2.2）。

### 6.1 三档 networkMode 定义

| 模式                         | API 通道                                                                                                                                                                                                              | 图片通道                                             | OAuth 通道                                                  | 用户场景                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| **`standard`**               | HTTPS 系统 DNS（`fetch` / `OkHttp` 默认）                                                                                                                                                                             | HTTPS 系统 DNS                                       | HTTPS 系统 DNS                                              | 海外 / 梯子 / 无墙环境  |
| **`direct`**（**墙内推荐**） | OkHttp 自定义 Dns 钉 IP + 无 SNI + Host 头                                                                                                                                                                            | Java `shouldInterceptRequest` 拦截 + 钉 IP + Host 头 | OkHttp 自定义 Dns 钉 IP + 无 SNI + Host 头（与 API 同通道） | 墙内通用，无梯环境      |
| **`compat`**（**兜底**）     | **Android**：走系统代理（`OkHttpClient.Builder().proxy(ProxySelector.getDefault())`）<br>**iOS**：走系统代理（`URLSessionConfiguration` 默认）<br>**Web**：弹窗告知「请使用 Android 原生客户端」+ 自动降级 `standard` | 同 API 通道                                          | 同 API 通道                                                 | 直连全失效时 / Web 平台 |

### 6.2 与 pixez-flutter NetworkMode 的差异

| 维度           | pixez-flutter                | Pictelio（本方案）                                            |
| -------------- | ---------------------------- | ------------------------------------------------------------- |
| 底层 TLS 引擎  | rhttp（Rust 抽象）           | OkHttp（Java）+ fetch（Web）                                  |
| ECH 支持       | ✅（默认开）                 | ⚠️ 待 OkHttp 5.x 镜像（§10 T10）                              |
| 证书校验       | ech 模式开 / compat 模式关   | **全模式开**（探针 §3.5 已确认 `*.pixiv.net` 泛域名合法证书） |
| OAuth 独立模式 | ✅ `oauthNetworkMode` 分离   | ✅ `oauthNetworkMode` 分离（与 API 共 Dns，但熔断计数独立）   |
| DNS 静态覆盖   | ✅ Cloudflare IP（ech 模式） | ✅ Pixiv 自建边缘 IP（direct 模式）                           |
| DoH 刷新       | ✅（`doh.dns.sb`）           | ✅（候选池 + 硬编码 fallback）                                |
| 镜像支持       | ✅ `pictureSource`           | ✅ `imageHostStore`（沿用现成实现）                           |
| SNI 关闭       | compat 模式                  | **direct 模式默认关**（IP 字面量建连天然无 SNI）              |

### 6.3 网络模式 + 域名分类组合

| 模式 \ 域名 | i.pximg.net                            | app-api.pixiv.net                 | oauth.secure.pixiv.net            | api.github.com                       |
| ----------- | -------------------------------------- | --------------------------------- | --------------------------------- | ------------------------------------ |
| `standard`  | 系统 DNS                               | 系统 DNS                          | 系统 DNS                          | 系统 DNS                             |
| `direct`    | 钉 IP `210.140.139.131` + Host 头      | 钉 IP `210.140.139.155` + Host 头 | 钉 IP `210.140.139.155` + Host 头 | DoH 拉 GitHub Meta API 拿 IP + 钉 IP |
| `compat`    | Android 走系统代理 / Web 降级 standard | 同                                | 同                                | 同                                   |

---

## 7. TLS / SNI 主动对抗方案对比

| 路径                                                   | 描述                                                                                                             | 实施成本                                                                | 风险等级                                                           | 建议                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| **A. 维持 TLS 默认 + 接受 IP 轮换风险**                | 不动 `SSLSocketFactory`；仅靠 IP 钉死 + 隐式 Host 头 + 无 SNI（IP 字面量建连天然无 SNI）                         | **零**（已具备）                                                        | **低**（TLS 证书合法，轮换由 OkHttp 默认 TrustManager 处理）       | ✅ **采纳**（Pictelio 当前 ADR-0144 形态） |
| **B. 自定义 hostnameVerifier 仅对 `*.pixiv.net` 接受** | `OkHostnameVerifier` 改写，主机名校验目标从「连接 IP」改为「预期域名」                                           | **低**（~20 行 Java）                                                   | **中**（减弱默认校验；pixeval 用此形态但保留默认路径）             | ⚠️ **可选**（如 A 路径证书校验失败再启用） |
| **C. ECH 加密 SNI**（治本）                            | OkHttp 5.x 支持 ECH（Encrypted Client Hello）；配置 `echConfig` + `enableEch = true`                             | **中-高**（需 OkHttp 5.x 镜像 + ECH config 注入；ECH 端点不可用时回退） | **中**（Pixiv 当前走 CF 后端，ECH 价值受限；pixez-flutter 默认开） | ⏳ **Phase 3**（T10）                      |
| **D. TLS ClientHello 分片**（最强对抗）                | Java `Socket` + 自定义 `InputStream`/`OutputStream` 包装 TLS ClientHello；仿 pixeval `TlsRecordFragmentedStream` | **高**（~200 行 Java + 全测试矩阵；TCP 流重组时序敏感）                 | **高**（GFW 已反制；§2.2 已判负）                                  | ❌ **拒绝合并**（应急储备归档）            |

**采纳路径**：

1. **P0**：路径 A（**已具备**）—— ADR-0144 + ADR-0145 当前形态
2. **P1**：路径 B（**Host 头兜底**）—— 仅在路径 A 证书校验失败时启用；默认不开
3. **P2**：路径 C（**OkHttp 5.x ECH 镜像**）—— Phase 3 ticket T10
4. **拒绝**：路径 D —— 治标路线失效，不进合并序列

---

## 8. 关键源文件改动清单

> **绝对路径** + **改动类型** + **简短描述** + **依赖关系**

### 8.1 回滚类（Phase 1 T1-T2）

| 文件                                                                             | 改动类型 | 改动内容                                                                                                                       | 依赖 |
| -------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `docs/adr/ADR-0146-reverse-proxy-primary.md`                                     | 修改     | 顶部加 `> 状态变更（2026-09-08）：已废弃，仅作技术记录`                                                                        | T1   |
| `docs/adr/ADR-0145-direct-access-v2.md`                                          | 修改     | 顶部加 `> 状态变更：CF Worker 反代主路径部分已废弃；保留 D1-D5 多候选竞速/分层超时/记账修正/IP 池扩展/证书轮换 = 客户端级方案` | T1   |
| `worker/` 目录                                                                   | 移动     | `git mv worker/ archive/worker-0146/`                                                                                          | T1   |
| `packages/app/src/api/apiEndpoints.ts`                                           | 删除     | 整个 `ApiEndpoints` 端点提供者（commit `0d933267` 引入）                                                                       | T1   |
| `packages/app/src/settings/registry.ts`                                          | 修改     | 删除 `apiProxyBase` 设置项                                                                                                     | T1   |
| `packages/app/src/components/settings/Sections/`                                 | 修改     | 删除「API 反代」设置卡 UI                                                                                                      | T1   |
| `packages/app/src/native/PixivApi.ts`                                            | 修改     | 删除 `apiProxyBase` 桥接代码                                                                                                   | T1   |
| `packages/app/android/app/src/main/java/io/pictelio/app/PixivApiPlugin.java`     | 修改     | 删除 `apiProxyBase` 相关 plugin method                                                                                         | T1   |
| `packages/app/android/app/src/test/java/io/pictelio/app/PixivApiPluginTest.java` | 修改     | 删除 apiProxy 相关测试                                                                                                         | T1   |
| `packages/website/pixiv-ip-table.json`                                           | 修改     | **可选**：保留作为 direct 模式远端表来源，但 schema 升级（§5.5）                                                               | T5   |

### 8.2 客户端直连增强类（Phase 1 T3-T5）

| 文件                                                                                             | 改动类型 | 改动内容                                                                                                                  | 依赖 |
| ------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| `packages/app/src/settings/registry.ts`                                                          | 修改     | 新增 `networkMode: 'standard' \| 'direct' \| 'compat'` 设置项                                                             | T4   |
| `packages/app/src/settings/types.ts`                                                             | 修改     | 新增 `NetworkMode` 类型 + `DirectIpOverrides` 类型                                                                        | T4   |
| `packages/app/src/services/directAccessService.ts`                                               | **新建** | DoH 刷新 + IP 持久化 + networkMode 命令面                                                                                 | T4   |
| `packages/app/src/api/client.ts`                                                                 | 修改     | `PixivApi.request()` 接入 `networkMode`；`direct` 模式透传 direct flag 给 Java 侧                                         | T4   |
| `packages/app/src/api/auth.ts`                                                                   | 修改     | OAuth 请求接 `networkMode`（与 API 共 Dns，但熔断计数独立）                                                               | T4   |
| `packages/app/src/native/PixivApi.ts`                                                            | 修改     | 桥接 `networkMode` → Java `PixivApiPlugin`                                                                                | T4   |
| `packages/app/android/app/src/main/java/io/pictelio/app/PixivApiPlugin.java`                     | 修改     | 接收 JS 侧 `networkMode`，调 `DirectAccessTransport.switchMode(mode)`                                                     | T4   |
| `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DirectAccessTransport.java` | 修改     | 新增 `switchMode(NetworkMode)`：standard 卸载三件套 / direct 装上 / compat 走系统代理                                     | T4   |
| `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/PinnedDns.java`             | 修改     | 增强兜底日志（**每个 fallback 路径必须 `warnSink.accept(...)`**，禁静默降级）                                             | T4   |
| `packages/app/android/app/src/main/java/io/pictelio/app/PixivImageLoader.java`                   | 修改     | URL 重写时若用 IP 字面量形态，显式 `Request.Builder().header("Host", "i.pximg.net")`；Referer 改 `https://www.pixiv.net/` | T3   |
| `packages/app/android/app/src/webview/java/io/pictelio/app/ImageIntercept.java`                  | 修改     | 调 `PixivImageLoader` 时确认 Host 头注入到位；telemetry 加「直连通道」标签                                                | T3   |
| `packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java`                       | 修改     | `shouldInterceptRequest` 包装类新增 `Host: i.pximg.net` 头透传（若上层用 IP 字面量 URL）                                  | T3   |
| `packages/app/android/app/src/webview/java/io/pictelio/app/MainActivityWebview.java`             | 修改     | 同 full flavor                                                                                                            | T3   |
| `packages/app/src/main.tsx`                                                                      | 修改     | 启动时初始化 `directAccessService`；检测 `isNative()` + `networkMode === 'direct'` 决定是否弹窗                           | T5   |
| `packages/app/src/components/settings/Sections/`                                                 | 修改     | 新增「网络直连」设置卡 UI（mode 选择器 + IP 手动编辑 + 立即更新按钮 + 熔断重置按钮）                                      | T4   |

### 8.3 DoH 刷新 + 错误归类类（Phase 2 T6-T9）

| 文件                                                                                             | 改动类型     | 改动内容                                                                                | 依赖 |
| ------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------- | ---- |
| `packages/app/src/services/directAccessService.ts`                                               | 修改（增强） | DoH 候选池（§5.2）+ TTL 处理（§5.5）+ 失败兜底 warn                                     | T6   |
| `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DirectAccessDoHClient.java` | **新建**     | Java 侧独立 OkHttp 客户端（不路由）调 DoH                                               | T6   |
| `packages/app/src/services/updateService.ts`                                                     | 修改         | 更新检查用 DoH 解析的 `api.github.com` IP                                               | T6   |
| `packages/app/src/utils/normalizeQueryError.ts`                                                  | 修改         | 新增 `ApiErrorType.DIRECT_IP_EXHAUSTED` / `DOH_FAILED` / `HOST_HEADER_MISSING` 错误类型 | T9   |
| `packages/app/src/components/ErrorDisplay.tsx`                                                   | 修改         | 新增上述错误的渲染指引（如「IP 已耗尽，请刷新 IP 表」「DoH 全端点失败，已回落内置表」） | T9   |
| `packages/website/pixiv-ip-table.json`                                                           | 修改         | schema v2：加 `ttlDays` 字段                                                            | T6   |

### 8.4 ECH 镜像类（Phase 3 T10）

| 文件                                                                                             | 改动类型 | 改动内容                                                                         | 依赖 |
| ------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------- | ---- |
| `packages/app/android/app/build.gradle`                                                          | 修改     | OkHttp 升 5.x（镜像 Ktor `rhttp` 的 ECH 支持）                                   | T10  |
| `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DirectAccessTransport.java` | 修改     | 新增 ECH 配置（`OkHttpClient.Builder().eventListenerFactory` + ECH config 注入） | T10  |
| `packages/app/src/settings/registry.ts`                                                          | 修改     | 新增 `enableEch: boolean` 设置项（默认关，待真机验证）                           | T10  |

### 8.5 测试类（强制 IO 边界 + 真实样例）

| 文件                                                                                                 | 改动类型             | 改动内容                                                                                                                       | 依赖 |
| ---------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `packages/app/android/app/src/test/java/io/pictelio/app/directaccess/PinnedDnsTest.java`             | 新建（已有测试需扩） | **真实样例**：测试 `DirectIpTableDefaults.builtIn()` 的 IP 与探针报告 `pixiv-direct-access-feasibility.md` §3.2-3.4 字面值一致 | T5   |
| `packages/app/android/app/src/test/java/io/pictelio/app/directaccess/DirectAccessDoHClientTest.java` | **新建**             | DoH 候选池轮询、TTL 过期触发、单端点失败降级、全部失败 fallback 内置表                                                         | T6   |
| `packages/app/android/app/src/test/java/io/pictelio/app/directaccess/HostHeaderTest.java`            | **新建**             | URL 写 IP 字面量时必须显式注入 `Host: i.pximg.net` 头；URL 写域名时 OkHttp 默认填 Host 头                                      | T3   |
| `packages/app/android/app/src/test/java/io/pictelio/app/directaccess/NetworkModeSwitchTest.java`     | **新建**             | `standard` / `direct` / `compat` 三模式切换；PinnedDns 装/卸载；`compat` 模式 OkHttp 走 `ProxySelector.getDefault()`           | T4   |
| `packages/app/android/app/src/test/java/io/pictelio/app/directaccess/AntiDriftIpTableTest.java`      | **新建**             | 远端 `pixiv-ip-table.json` 文件 ≡ 内置 `DirectIpTableDefaults.builtIn()`（schema v2 后）                                       | T6   |
| `packages/app/src/services/directAccessService.test.ts`                                              | **新建**             | DoH 失败 fallback、IP 持久化、TTL 触发刷新、warn 必打                                                                          | T6   |
| `packages/app/src/utils/normalizeQueryError.test.ts`                                                 | 修改                 | 新增 `DIRECT_IP_EXHAUSTED` / `DOH_FAILED` / `HOST_HEADER_MISSING` 测试                                                         | T9   |

---

## 9. 测试策略

### 9.1 IO 边界测试强制覆盖

**硬约束**（AGENTS.md 测试硬约束 §1）：

> 任何从外部数据源读取数据的函数（fetch/HTTP、Preferences、原生桥、JSON 解析）必须同时具备成功路径与失败/降级路径的单元测试。

**适用本方案的 IO 边界**：

| IO 边界                                  | 成功路径测试                  | 失败/降级路径测试                                     |
| ---------------------------------------- | ----------------------------- | ----------------------------------------------------- |
| `DirectAccessDoHClient.fetchJson`        | 200 OK 远端表 JSON            | 网络不可达 / 非 2xx / 空响应体 / 超时 / schema 不合规 |
| `PinnedDns.lookup`                       | 表内 host 返回 IP 列表        | 表外 host → 系统 DNS；畸形 IP 字面量 → 防御兜底       |
| `MainActivity.shouldInterceptRequest`    | `/pixiv-img/` 命中 → 拦截成功 | 非 `/pixiv-img/` → 透传；拦截异常 → null              |
| `networkMode` 切换                       | 三档切换正确                  | 非法值 → fallback `standard`                          |
| `PixivApiPlugin.request` (native bridge) | JS 调用透传 Java              | bridge 断连 → 401 触发 auth 刷新                      |

### 9.2 真实样例契约（**禁止自洽 mock**）

**硬约束**（AGENTS.md 测试硬约束 §2 + §6 oracle 溯源）：

> 跨文件/跨端共享数据契约的测试 mock 必须来自真实数据源，禁止手写「与实现自洽」的 mock 字段。

**本方案的 oracle 溯源**：

| 测试期望值                                      | 真实来源                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `i.pximg.net → 210.140.139.131`                 | 探针报告 `pixiv-direct-access-feasibility.md` §3.2 I4（sha256 与经代理基线一致） |
| `app-api.pixiv.net → 210.140.139.155`           | 探针报告 §3.3 A2（HTTP 400 OAuth 错误 = 端到端已处理）                           |
| `oauth.secure.pixiv.net → 210.140.139.155`      | 探针报告 §3.4 H2（HTTP 400 invalid_grant code 1508 = Pictelio 401 契约通）       |
| `s.pximg.net` 不能用作 i.pximg.net 替代         | 探针报告 §3.2 I1（证伪：nginx 404）                                              |
| 边缘特化（同段 pximg IP 走 app-api Host → 421） | 探针报告 §3.3                                                                    |
| OAuth 端点 30s 短窗口限频                       | 探针报告 §3.4                                                                    |
| `*.pixiv.net` 泛域名合法证书                    | 探针报告 §3.5                                                                    |
| `210.140.139.131` 当前（2026-09）               | 探针报告 §3.2 I4                                                                 |

### 9.3 单元测试清单

| 测试类型 | 文件                              | 覆盖目标                                               |
| -------- | --------------------------------- | ------------------------------------------------------ |
| 单元     | `PinnedDnsTest`                   | DNS 接缝三态：表内/表外/熔断开                         |
| 单元     | `PinnedAccountingInterceptorTest` | 失败归因恰好一次 + headersArrived 边界                 |
| 单元     | `ChannelCircuitBreakerTest`       | 3 次失败 → open；60s 冷却 → 半开；半开单探 CAS         |
| 单元     | `IpTableMergerTest`               | manual > remote > builtIn 优先级；非法条目跳过 + warn  |
| 单元     | `DirectIpTableDefaultsTest`       | 内置表恒定值；与探针报告 oracle 一致                   |
| 单元     | `DirectAccessDoHClientTest`       | 候选池轮询；全失败 fallback 内置表                     |
| 单元     | `HostHeaderTest`                  | URL 写 IP 时 Host 头显式注入；URL 写域名时 OkHttp 默认 |
| 单元     | `NetworkModeSwitchTest`           | 三模式切换 + PinnedDns 装/卸载                         |
| 单元     | `AntiDriftIpTableTest`            | 远端表 ≡ 内置表（CI 跨端契约）                         |

### 9.4 E2E 测试

| 测试类型            | 文件                                                    | 覆盖目标                                                               |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| E2E (agent-browser) | `tests/agent-browser/specs/network-direct-mode.test.ts` | UI 切到 `direct` 模式 → 真机模拟器验证图片加载 / API 调用 / OAuth 刷新 |
| E2E (android-e2e)   | `tests/android-e2e/specs/direct-mode-smoke.test.ts`     | Android 模拟器真机验证直连通道（需关闭系统代理模拟墙内环境）           |
| E2E (android-e2e)   | `tests/android-e2e/specs/network-mode-fallback.test.ts` | 直连失败 → compat 模式自动降级 → 系统代理接管                          |

**E2E 限制说明**：

- 仓库内 agent-browser / android-e2e 测试**无法**模拟 GFW 真实拦截（依赖外部状态）—— 通过 `driver.mockFetch()`（页面级 fetch mock）模拟 IP 钉死失败的场景
- 直连模式**真实 GFW 行为**必须人工真机验证（用户实测）+ warnSink 日志观测

### 9.5 静默降级（**禁 `?? ""` / `?? null` / catch 后默认值**）

**硬约束**（AGENTS.md 测试硬约束 §3）：

> 所有降级兜底路径必须输出 `console.warn`（带模块前缀）或显式向上层暴露错误状态。

**本方案的静默降级检查清单**：

| 降级路径                                     | 必有 warn                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| DoH 全端点失败 → fallback 内置表             | `[directAccess] DoH all endpoints failed for ${host}, fallback to builtIn`                                      |
| 远端表解析形状失败 → 保留上次有效            | `[directAccess] 远端 IP 表解析失败（形状不合规），保留上次有效表否则内置兜底`                                   |
| `PinnedDns.lookup` 畸形 IP 字面量 → 系统 DNS | `[directAccess] 钉定 IP 字面量构造地址失败（防御兜底，已按传输失败记账并回退系统路线）`                         |
| `shouldInterceptRequest` 拦截异常 → null     | `[ImageIntercept] interceptImage 失败: ${url}`                                                                  |
| `networkMode` 非法值 → fallback `standard`   | `[directAccess] Invalid networkMode: ${value}, fallback to standard`                                            |
| Web 平台 direct 模式 → 降级 standard         | `[directAccess] Web platform cannot pure-direct, fallback to standard. 请配置系统代理或使用 Android 原生客户端` |
| GitHub DoH 失败 → 系统 DNS                   | `[directAccess] GitHub DoH failed, fallback to system DNS`                                                      |

---

## 10. ADR 关系

### 10.1 现有 ADR 处置

| ADR                              | 状态变更                                                             | 处置                                      |
| -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| **ADR-0144 直连传输层**          | **保留**（客户端级方案核心）                                         | 不动                                      |
| **ADR-0145 直连 v2**             | **部分保留**（D1-D5 客户端级方案保留；CF Worker 反代主路径部分废弃） | 顶部加状态变更注释                        |
| **ADR-0146 反代主路径**          | **废弃**（用户决策拒绝远程代理）                                     | 顶部加 `> 状态变更：已废弃，仅作技术记录` |
| **ADR-0037 PixivApiPlugin 网关** | **保留**（这是客户端级方案）                                         | 不动                                      |

### 10.2 建议新增 ADR

**编号建议**：`ADR-0147`（接 0145/0146 之后）

**标题候选**：「纯客户端直连主路径（IP 钉死 + Host 头 + 三档 networkMode）」

**状态**：proposed（待 spec/grill 通过）

**核心决策点**（D1-D7 草案）：

- **D1**：撤销 ADR-0146 CF Worker 反代主路径（理由：用户决策 + 反代语义）
- **D2**：撤销 HTTP CONNECT 分片代理（含 `prototype/tcp-fragment-proxy` 不合并）
- **D3**：保留 ADR-0144 + ADR-0145 D1-D5（客户端级直连）
- **D4**：新增三档 `networkMode`（standard / direct / compat）
- **D5**：新增 `DirectAccessDoHClient` + DoH 候选池
- **D6**：Web 平台诚实结论（无法纯客户端直连，弹窗告知）
- **D7**：新增强制点（Host 头显式注入 + Referer 改 pixiv.net + 静默降级禁制）

---

## 11. 落地路线图

### 11.1 Phase 1（1-2 周，立即）

| Ticket                                        | 内容                                                                                                                                        | 依赖 | 估计代码量             | 风险等级                                  | 可独立验收标准                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **T1**：回滚 CF Worker 反代                   | 整 commit revert `0d933267` `2dfe7e3d` `aae4b97d`；手 edit `a39d543b` 仅撤销反代段；`worker/` → `archive/worker-0146/`                      | —    | ~500 行删除 + ADR 标注 | **低**（纯删除）                          | `git grep "ApiEndpoints\|apiProxyBase\|api_proxy_base"` 返回空；`worker/` 不在主分支；ADR-0146 顶部有废弃标记 |
| **T2**：回滚 HTTP CONNECT 分片代理            | 不合并 `prototype/tcp-fragment-proxy`；归档 `TlsFragmentingProxy.java` 等到 `archive/tcp-fragment-ab-test-2026-09/`；不写 ADR               | —    | ~250 行归档            | **低**（不合并即回滚）                    | `prototype/tcp-fragment-proxy` 分支存在但 main 无相关文件；`grep -r "TlsFragmentingProxy" packages/` 无结果   |
| **T3**：增强 `shouldInterceptRequest` Host 头 | `PixivImageLoader.java` 显式注入 `Host: i.pximg.net`；`ImageIntercept.java` + `MainActivity.java` 透传；Referer 改 `https://www.pixiv.net/` | —    | ~30 行修改             | **低**（TLS 证书合法，Host 头错才会出错） | 真机模拟器验证图片加载 OK；`HostHeaderTest` 单测全绿                                                          |
| **T4**：新增 `networkMode` 设置项             | `settings/registry.ts` + `types.ts`；UI 设置卡；`directAccessService.ts`（最小版：仅 mode 切换命令）                                        | T1   | ~150 行新增            | **低**                                    | 设置页可切三档 + 持久化；切换后重启生效                                                                       |
| **T5**：落地基础 IP 钉死 + 硬编码默认 IP 表   | `DirectAccessTransport.switchMode(NetworkMode.DIRECT)` 完整接入；`DirectIpTableDefaults` 已是默认值（commit `a089a147` 引入）               | T4   | ~200 行新增 + 增强     | **中**                                    | 真机无代理环境切 `direct` 模式 → 图片/API/OAuth 全部 200；`AntiDriftIpTableTest` 钉住内置表                   |

### 11.2 Phase 2（1-2 月）

| Ticket                                               | 内容                                                                                                                                 | 依赖 | 估计代码量  | 风险等级                           | 可独立验收标准                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---- | ----------- | ---------------------------------- | ---------------------------------------------------------------------- |
| **T6**：落地 DoH 刷新（候选池 + TTL）                | `DirectAccessDoHClient.java` + `services/directAccessService.ts` DoH 候选池（§5.2）；`pixiv-ip-table.json` schema v2（加 `ttlDays`） | T4   | ~400 行新增 | **中**（DoH 端点可达性需探针验证） | 设置页「立即更新」按钮可触发；7 天 TTL 自动触发；失败兜底内置表 + warn |
| **T7**：落地 IP 回落池 + 测速策略                    | `DirectIpTableDefaults` 加 `alternates` 候选池（`i.pximg.net` 至少 3 个 Akamai 边缘 IP，需探针验证）；ADR-0145 D5 已落               | T6   | ~100 行增强 | **中**（候选池 IP 需探针验证）     | 单 IP 失效时自动切换到候选池；`PinnedDnsTest` 候选序列覆盖             |
| **T8**：OAuth 独立网络模式                           | `networkMode` 已支持 OAuth 独立（与 API 共 Dns 但熔断计数独立）；settings 加 `oauthNetworkMode`（默认与 `networkMode` 同步）         | T4   | ~50 行新增  | **低**                             | 设置页 OAuth 模式独立可配；OAuth 失败不影响 API 通道熔断               |
| **T9**：错误归类（IP 失效 / DoH 失败 / Host 头缺失） | `normalizeQueryError.ts` 新增 3 类错误；`ErrorDisplay.tsx` 渲染指引                                                                  | T6   | ~200 行新增 | **低**                             | 用户看到「IP 已耗尽，请刷新 IP 表」等明确指引                          |

### 11.3 Phase 3（长期）

| Ticket                                    | 内容                                                                                                     | 依赖 | 估计代码量                | 风险等级                                        | 可独立验收标准                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---- | ------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| **T10**：ECH 加密 SNI（OkHttp 5.x 镜像）  | OkHttp 升 5.x + ECH config 注入；`enableEch: boolean` 设置项                                             | T4   | ~600 行新增（含依赖升级） | **中-高**（OkHttp 5.x API 变更 + ECH 端点配置） | 真机启用 ECH 后 GFW 嗅探失效（人工验证）             |
| **T11**：TLS ClientHello 分片（应急储备） | 不落地合并；保留 `archive/tcp-fragment-ab-test-2026-09/`；如未来客户端 IP + ECH + DoH 全部失效，重新评估 | —    | 0（仅应急储备）           | —                                               | 决策触发条件：GFW 全面升级到客户端 IP+ECH+DoH 都失效 |

### 11.4 依赖关系图

```
T1 (回滚 CF Worker) ──┬─→ T4 (networkMode) ──┬─→ T5 (IP 钉死)
                      │                       ├─→ T6 (DoH) ──┬─→ T7 (回落池)
                      │                       │                ├─→ T9 (错误归类)
T2 (回滚分片) ────────┘                       └─→ T8 (OAuth 独立)
                                                      │
T3 (Host 头) ──────────────────────────────────────────┴─→ T5

T6 (DoH) ──→ T10 (ECH, Phase 3)
T6 (DoH) ──→ T11 (TLS 分片, Phase 3 应急)
```

---

## 12. Web 平台的诚实结论

### 12.1 浏览器限制

| 限制                                    | 影响                             |
| --------------------------------------- | -------------------------------- |
| `fetch(url)` 强制走浏览器 DNS 解析      | 无法绕过 DNS 污染                |
| `fetch` 不允许自定义 `sslSocketFactory` | 无法做 SNI 剥离                  |
| `fetch` 不允许自定义 `hostnameVerifier` | 无法做 IP 直连时的泛域名校验覆盖 |
| `XMLHttpRequest` 同 fetch               | —                                |
| WebSocket 同 fetch                      | —                                |
| Service Worker 同 fetch                 | —                                |

### 12.2 诚实方案

**Web 平台下 `direct` 模式不可能做到 IP 钉死**——这是浏览器架构限制，不是工程问题。

**实施策略**：

```typescript
// packages/app/src/main.tsx 启动初始化
import { isNative } from "@/utils/clientSwitch";
import { directAccessService } from "@/services/directAccessService";

if (directAccessService.networkMode() === "direct") {
  if (!isNative()) {
    // Web 平台：弹窗告知 + 降级
    presentDirectModeUnsupportedDialog({
      title: "纯客户端直连在 Web 平台不可用",
      body: "浏览器 fetch 无法自定义 DNS，纯客户端直连做不到。\n\n请选择以下任一方案：\n1. 配置系统代理（设置 → 网络 → 代理）\n2. 使用 Android 原生客户端（Pictelio for Android）",
      primaryAction: "我已了解，切换到兼容模式",
      onPrimary: () => directAccessService.setMode("compat"),
    });
  }
}
```

**`compat` 模式下 Web 平台行为**：

- 网络请求等同 `standard`（走系统 DNS）
- 提示用户「Web 平台请使用系统代理或 Android 客户端」

### 12.3 不要为了 Web 平台妥协

**明确**：

- ❌ **不要**为了 Web 平台在 `direct` 模式中加入远程代理桥接（如 Web fetch 走 CF Worker）——这就违背了「纯客户端直连」路线
- ❌ **不要**为了 Web 平台在 `direct` 模式中假装支持——必须诚实弹窗告知不可用
- ✅ **Web 平台用户**的免梯方案：① 配置系统代理（用户自主行为）② 使用 Android 原生客户端（产品推荐）

---

## 13. 风险与回退

### 13.1 风险矩阵

| 风险                   | 概率                                                                          | 影响                                                | 回退方案                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| GFW 升级 IP 失效       | **中**（Akamai 边缘 IP 历史上稳定，2024-2026 未见大范围失效）                 | 中（直连通道失败，回退系统 DNS = 走用户代理或被墙） | IP 回落池自动切换（§11.2 T7）+ DoH 刷新（§11.2 T6）+ 用户手动编辑 IP 表   |
| DoH 端点失效           | **中**（GFW 可能封锁新 DoH 端点）                                             | 低（直连通道失败但内置表兜底）                      | 候选池轮询；全失败 → 内置表兜底 + warn                                    |
| TLS 证书变更           | **低**（Pixiv 走 Let's Encrypt 90 天自动轮换，OkHttp 默认 TrustManager 处理） | 低（直连通道失败但 `compat` 模式不受影响）          | 兜底 hostnameVerifier 放行（§7 路径 B，默认不开）                         |
| OkHttp ECH 不支持      | **低**（OkHttp 5.x 已支持）                                                   | 极低（仅 Phase 3 涉及；T10 依赖 OkHttp 升级）       | 回退到 IP 钉死 + 不开 ECH（§11.3 T10）                                    |
| 单 IP 失效             | **中**（Akamai 边缘按 vhost 特化，可能整 IP 段失效）                          | 低（候选池轮询）                                    | 候选池自动切换 + DoH 刷新                                                 |
| OAuth 端点 30s 限频    | **高**（探针 §3.4 已实证）                                                    | 低（refresh_token 刷新频率本就低，30s 内不会触发）  | 退避策略：30s 内不重复发刷新；现有 auth 刷新机制已有退避（ADR-0144 配套） |
| **客户端直连整体失效** | **极低**（探针 + 真机已验证三层均通）                                         | 高（用户无图可看）                                  | 应急储备：HTTP CONNECT 分片代理（§2.2 不合并但保留源码）                  |
| **GFW 全面升级**       | **极低**                                                                      | 高                                                  | 应急储备：TLS ClientHello 分片（§11.3 T11）                               |

### 13.2 回退决策树

```
用户报告直连失效
  │
  ├─ 单一 host 失败
  │   ├─ 候选池内还有 IP？ → 切到候选池 IP（自动）
  │   ├─ 候选池全失效？ → DoH 刷新（自动）
  │   └─ DoH 也失败？ → 内置表兜底（自动）+ warn
  │
  ├─ 所有 host 失败
  │   ├─ 熔断器状态？ → 半开探针自动恢复；open 态需等 60s
  │   └─ 仍失败？ → 用户手动切 `compat` 模式（走系统代理）
  │
  └─ GFW 全面升级（罕见）
      └─ 应急储备：HTTP CONNECT 分片代理 / TLS ClientHello 分片（§2.2 §11.3 T11）
```

---

## 14. 引用

### 14.1 仓库内引用

| 引用               | 路径                                                                                                                                                             | 用途                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 探针报告           | `docs/research/pixiv-direct-access-feasibility.md`（`prototype/pixiv-bypass-feasibility` 分支 commit `68fbd826`）                                                | **核心 oracle**：IP 默认值、封锁模型、可行性判定、证书语义全部出自此处                          |
| 探针脚本           | `scripts/prototype-pixiv-bypass.mjs`（同上分支）                                                                                                                 | I0-I5 / A1-A4 / H1-H2 / Q1-Q2 探测矩阵的实现                                                    |
| 三家对比           | `docs/research/pixiv-third-party-clients-direct-access.md`                                                                                                       | pixez-flutter / pixiv-viewer-app / Pixeval vs Pictelio 现状对照                                 |
| pixez-flutter      | `docs/research/pixez-flutter-direct-access.md`                                                                                                                   | 三档 NetworkMode / 静态 IP + DoH 兜底                                                           |
| pixiv-viewer-app   | `docs/research/pixiv-viewer-app-direct-access.md`                                                                                                                | 仅图片直连取舍 / DoH 必须走代理                                                                 |
| Pixeval            | `docs/research/pixeval-direct-access.md`                                                                                                                         | TLS ClientHello 分片 / 6 域静态 IP 表                                                           |
| ADR-0144           | `docs/adr/ADR-0144-direct-access-transport.md`                                                                                                                   | OkHttp 原生缝路由 + 图床正交语义（客户端级方案核心）                                            |
| ADR-0145           | `docs/adr/ADR-0145-direct-access-v2.md`                                                                                                                          | 多候选竞速 / 分层超时 / 记账修正（保留）                                                        |
| ADR-0146           | `docs/adr/ADR-0146-reverse-proxy-primary.md`                                                                                                                     | CF Worker 反代主路径（**废弃**，仅作技术记录）                                                  |
| ADR-0037           | `docs/adr/ADR-0037-*.md`（PixivApiPlugin 网关）                                                                                                                  | 客户端级方案（access_token 仅 Java 堆）                                                         |
| 既有直连子包       | `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/`                                                                                           | `DirectAccessTransport` / `PinnedDns` / `PinnedAccountingInterceptor` / `DirectIpTableDefaults` |
| 既有图片拦截       | `packages/app/android/app/src/webview/java/io/pictelio/app/ImageIntercept.java` + `packages/app/android/app/src/main/java/io/pictelio/app/PixivImageLoader.java` | `shouldInterceptRequest` 拦截 + URL 重写 + Referer/UA 注入                                      |
| 既有 MainActivity  | `packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java` + `webview/java/.../MainActivityWebview.java`                                         | `shouldInterceptRequest` 包装                                                                   |
| TCP 分片 prototype | `prototype/tcp-fragment-proxy` 分支 commit `163a3478`                                                                                                            | **不合并**，仅应急储备                                                                          |

### 14.2 仓库外引用

| 引用                      | URL                                               | 用途                                                  |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| pixez-flutter             | <https://github.com/Notsfsssf/pixez-flutter>      | rhttp + 三档 NetworkMode + 静态 IP + DoH 兜底参考实现 |
| pixiv-viewer-app          | <https://github.com/asadahimeka/pixiv-viewer-app> | 仅图片直连取舍参考                                    |
| Pixeval                   | <https://github.com/Pixeval/Pixeval>              | TLS ClientHello 分片参考（仅参考，不迁移）            |
| GFW Report TLS 分片反制   | <https://github.com/net4people/bbs/issues/296>    | TLS 分片已被 GFW 反制，分片代理路线判负依据           |
| OkHttp 5.x ECH            | <https://square.github.io/okhttp/>                | ECH 支持文档（Phase 3 T10 依赖）                      |
| Microsoft Fluent Design 2 | <https://fluent2.microsoft.design/design-tokens>  | 设计令牌来源（本方案不改设计令牌）                    |

---

## 附录 A：与 ADR-0144/0145/0146 的 diff

### A.1 保留部分（直接合并到本方案）

- ADR-0144 D1（OkHttp 自定义 Dns）→ §4.2.1 §4.2.2 §4.2.4
- ADR-0144 D2（路由决策门序）→ §4.2.2
- ADR-0144 D3（双通道独立熔断）→ §4.2.2
- ADR-0144 D4（直连 × 图床正交）→ §2.3 §6.3
- ADR-0144 D5（IP 表三层来源 + 远端通道）→ §4.1 §5
- ADR-0144 D6（manifest 自装配）→ §4.2.1
- ADR-0144 D7（main sourceSet 子包）→ §8.2
- ADR-0145 D1（单钉定 → 候选序列）→ §4.2.2
- ADR-0145 D2（分层超时）→ §4.2.2
- ADR-0145 D3（记账语义修正）→ §4.2.2
- ADR-0145 D4（熔断语义重估）→ §4.2.2
- ADR-0145 D5（IP 池扩展）→ §11.2 T7
- ADR-0145 D6（证书轮换）→ §4.2.4
- ADR-0145 D7（多维测试矩阵）→ §9

### A.2 废弃部分（明确不回滚到本方案）

- ADR-0146 D1（主路径 = CF Worker 反代）→ §2.1 整路径撤销
- ADR-0146 D2（Worker 合约）→ §2.1 整路径撤销
- ADR-0146 D3（App 侧 `apiProxyBase`）→ §2.1 整路径撤销
- ADR-0146 D4（直连降级为「零配置尽力而为」）→ 反驳：直连是主路径，不是降级
- ADR-0146 D5（一键部署）→ §2.1 整路径撤销

### A.3 新增部分（本方案独有）

- 三档 `networkMode`（standard / direct / compat）→ §6
- DoH 候选池 + 候选池轮询 + TTL 7 天 → §5
- Web 平台诚实结论（弹窗 + 降级）→ §12
- TLS 分片应急储备（不合并，仅归档）→ §2.2 §11.3 T11
- GitHub 直连（`api.github.com` + `objects.githubusercontent.com`）→ §4.1.3
- OAuth 独立网络模式 → §6.3 §11.2 T8
- 静默降级禁制（§9.5 warn 必打清单）→ §9.5

---

## 附录 B：commit 历史对齐（实施参考）

```
# Phase 1 立即执行
T1: revert commit a39d543b (部分) + 0d933267 + aae4b97d + 2dfe7e3d
T2: 不合并 prototype/tcp-fragment-proxy
T3: 修改 PixivImageLoader.java + ImageIntercept.java + MainActivity.java
T4: 新增 directAccessService.ts + settings/registry.ts
T5: DirectAccessTransport.switchMode 接入 + DirectIpTableDefaults 验证

# Phase 2 中期
T6: 新增 DirectAccessDoHClient.java + pixiv-ip-table.json schema v2
T7: DirectIpTableDefaults 加 alternates 候选池
T8: settings 加 oauthNetworkMode
T9: normalizeQueryError.ts 新增 3 类错误

# Phase 3 长期
T10: OkHttp 5.x + ECH 镜像
T11: TLS 分片应急储备（不合并）
```

---

**报告完。** 核心发现详见 §1 TL;DR，Phase 1 回滚清单详见 §2.1 + §11.1 T1-T2。
