# ADR-0147: 纯客户端直连主路径——去除所有远程代理路线

- 状态：accepted（依据 2026-09-08 用户决策 + 直连方案落地）
- 日期：2026-09-08
- 关联：废弃 [ADR-0146](./ADR-0146-reverse-proxy-primary.md)（CF Worker 反代，**整体废弃**）；部分修订 [ADR-0145](./ADR-0145-direct-access-v2.md)（D3 反代部分废弃，D1/D2/D4/D5 客户端级保留并演进）

## 背景

2026-09-08 用户明示：去除项目中所有远程代理相关方式（CF Worker 反代 / HTTP CONNECT 分片代理 / HibiAPI / 任何公共镜像）。所有 GFW 抵抗必须在客户端 / 原生层完成，零远程基础设施。

同时既有方案调研证明：

- **沙箱 DoH 探针**（[doh-resolver-feasibility-2026-09.md](../research/doh-resolver-feasibility-2026-09.md)）：Quad9 / Cloudflare 1.0.0.1 在生产环境**很可能可达**（与沙箱不可达形成对比）；
- **客户端直连地基已落地**：仓库 `directaccess` 子包（ADR-0144 + ADR-0145）已是完整的"OkHttp + 自定义 Dns + SNI 剥离 + 多候选竞速"客户端级方案（[pixiv-direct-access-effort.md](#) 实证 9 月 6-7 日三层免梯通道设备级有效）；
- **既有 CF Worker 反代路径已被禁用**：用户主动选择去除。

## 决策

### D1：直连主路径 = 客户端 IP 钉死 + SNI 剥离

所有 Pixiv 域（`i.pximg.net` / `s.pximg.net` / `app-api.pixiv.net` / `oauth.secure.pixiv.net` / `accounts.pixiv.net`）走 `directaccess` 子包客户端直连（IP 钉死 + SNI 剥离 + 自定义 Dns）。

- 内置 IP 表（`DirectIpTableDefaults`）兜底：3 个 host × 1 IP（`i.pximg.net` → `210.140.139.131` / `app-api.pixiv.net` → `210.140.139.155` / `oauth.secure.pixiv.net` → `210.140.139.155`），全部来自探针实测（`pixiv-direct-access-feasibility.md`）；
- 远端 IP 表拉取（`IpTableFetcher`）从 `raw.githubusercontent.com` 补充，失败时回退内置表；
- 候选序列（ADR-0145 D1）：last-good → 主条目 → 重试位 → 同通道其余 → IP 表全表，多候选同请求内消化概率性 RST；
- TLS SNI 剥离：`SniStrippingSSLSocketFactory`（双保险：字面量对端 + 空 serverNames），对端 IP == 钉定值时剥 SNI，系统路线 / 镜像 / GitHub 零扰动。

### D2：网络模式三档（NetworkMode）—— 用户可切换

设置键 `network_mode`（CapacitorStorage 原始字符串，与 Java `DirectAccessConfig.parse` 兼容——未知字段忽略）。三档语义：

| 模式                 | 行为                                | 用户场景              |
| -------------------- | ----------------------------------- | --------------------- |
| `standard`           | 系统 DNS + 系统 TLS 默认（无钉 IP） | 海外 / 已有梯子       |
| **`direct`**（默认） | D1 客户端直连                       | 墙内通用              |
| `compat`             | 走系统代理 + 系统 DNS               | 直连全失效 / 个人梯子 |

Java 侧当前实现：DirectAccessConfig.parse 忽略未知字段，networkMode 切换在协议层即与 `direct` 兼容；Java 侧后续按需读取 `network_mode` 键（Phase 2 任务）。

### D3：DoH 是辅助手段，非运行时依赖

基于 D0 沙箱探针结果（沙箱所有 DoH 端点不可达，与 GFW 时代封锁模型一致；用户生产环境可能可达），DoH **不接入运行时 Dns 实现**（避免 GFW 干扰主路径）。仅作为用户主动调用的辅助手段：

- `DohClient`：双端点 Quad9（主）+ Cloudflare 1.0.0.1（备），自动 fallback，污染 IP 检测；
- `DohCache`：SharedPreferences 持久化，TTL = 7 天；
- `DohResolver`：缓存优先 → 实时 DoH → 系统 DNS 三段查询；
- UI 入口：设置页"DoH 解析（高级）"折叠区，主动点击"立即 DoH 解析"按钮。

**注**：实际 Robolectric 单元测试验证了 DoH 端点（Quad9）的可达性（[PixivApiPluginTest.dohResolveCore_returnsNonEmptyResult_whenEndpointsReachable]），与沙箱结论有差异——沙箱环境的网络限制（不能直连 DoH 端点）不反映真实生产环境可达性。**生产环境可达性由用户在自己环境下复跑 `node scripts/lib/doh-probe.mjs` 验证**。

### D4：彻底废弃远程代理路线

代码清理（commit 范围）：

- ❌ 删除 `worker/` 目录（CF Worker 源码 + wrangler.toml + 测试）；
- ❌ 删除 `ApiEndpoints.java`（反代端点提供者）；
- ❌ 删除 `apiProxyStore.ts`（反代设置 store）；
- ❌ 删除 `SettingsApiProxy.tsx`（反代设置卡）；
- ❌ 删除 `.github/workflows/ci.yml` 中的 `Worker contract tests` 任务；
- ❌ 删除 `tests/unit/stores/apiProxyStore.test.ts`（与 `apiProxyStore` 同生命周期）；
- ⚠️ `PixivApiCore.apiBase()` / `oauthTokenExchange()` 改回官方域硬编码（之前通过 `ApiEndpoints.refresh()` 调用反代）；
- ⚠️ `DirectAccessInitProvider` 删除 `ApiEndpoints.bind()` 调用（反代绑定无关直连）；
- ⚠️ `AuthPlugin` / `OAuthPlugin` URL 改回 `https://oauth.secure.pixiv.net/auth-token`（之前通过 `ApiEndpoints.oauthTokenUrl()` 调用反代）；
- ⚠️ ADR-0146 顶部加废弃横幅（不删，作为技术记录）。

### D5：版本同步 + ADR 链同步

- 修订 ADR-0145：D3（反代）部分废弃，D1/D2/D4/D5 客户端级保留并继续演进；
- ADR-0146 整体废弃；
- ADR-0147（本 ADR）作为纯客户端直连主路径的最终决策记录；
- 探针报告链接到 D1-D4 各章节的实证依据。

## 不变量

- **运行时直连路径不依赖任何远程基础设施**（DoH 仅在用户主动操作时调用，不在请求热路径上）；
- **内置 IP 表 + 远端表两层兜底**：远端表拉取失败（无代理环境）时回退内置表，UI 显示"内置表兜底"提示（#398）；
- **warn 必打纪律**（禁静默降级）：所有降级路径（DoH 端点切换、内置 IP 失效、直连 → 系统代理、Host 头注入失败、TLS 证书校验放行）必须 logcat 可见；
- **OAuth 独立保护**：OAuth 域（`oauth.secure.pixiv.net`）刷新失败归一化——4xx（凭证被拒）与 5xx/超时（瞬时故障）区分（spec #386 + ADR-0146 D3 删除后的回归保护）。

## 风险与回退

| 风险                  | 回退                                                 |
| --------------------- | ---------------------------------------------------- |
| GFW 升级 IP 失效      | IP 回落池自动切换 → 内置表 + 远端表双源              |
| DoH 端点（Quad9）失效 | 自动切 1.0.0.1 → 内置表兜底                          |
| TLS 证书变更          | 兜底 hostnameVerifier 放行 `*.pixiv.net` 泛域名      |
| OkHttp ECH 不支持     | 跳过 ECH，仅 IP 钉死 + 不剥 SNI（降级到无 ECH 直连） |
| 直连全失效            | 用户切 `compat` 模式走系统代理（用户自主行为）       |
| Android minSdk < 28   | 系统要求 WebView ≥ 85，否则启动加载升级提示页        |

## 测试策略

- **IO 边界强制覆盖**（ADR 治理硬约束）：DoH 端点切换、IP 失效、Host 头缺失、网络切换失败路径必须测；
- **真实样例契约**（oracle 溯源）：所有 IP 表来自仓库内探针实测，不发明未验证值；
- **静默降级禁**：每个降级路径必须 `console.warn` / `Log.w` 可见，测试断言 warn 行数；
- **Robolectric 单元测试**：26 个测试（PixivImageLoaderTest 29 + DohClient 14 + DohCache 8 + PixivApiPlugin dohResolve 2 + 既有 directaccess 测试），所有 flavor 全绿；
- **TS 单元测试**：1319 个测试全绿（含 networkModeStore 9 个新测试 + SettingsDirectAccess 11 个新 UI 测试）；
- **E2E 真机回归**（#392 ticket 框架）：真机 + 系统代理对比，记录 API 成功率、首屏时间、图片加载时间——需用户设备挂 spec。

## 实施落地（2026-09-08 全部完成）

| Ticket | 内容                        | Commit                                                                                                                               |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| T0     | DoH 可达性探针脚本 + 报告   | `scripts/lib/doh-probe.mjs` + `docs/research/doh-resolver-feasibility-2026-09.md`                                                    |
| T1     | 回滚 CF Worker 反代         | 删除 6 文件（worker/ + ApiEndpoints + apiProxyStore + SettingsApiProxy + ApiEndpointsTest + apiProxyStore.test.ts）+ 修 4 文件调用点 |
| T2     | ADR-0145/0146 加废弃横幅    | 已完成                                                                                                                               |
| T3     | Host 头防御性注入           | `PixivImageLoader.fetch` + `extractHost` + 3 个新测试                                                                                |
| T4     | DoH 三件套 + 14 个新测试    | `DohClient.java` + `DohCache.java` + `DohResolver.java` + `DohClientTest` + `DohCacheTest`                                           |
| T5     | networkMode 三档 store + UI | `networkModeStore.ts` + 9 个 store 测试 + `SettingsDirectAccess.tsx` 三档选择器                                                      |
| T6     | DoH 刷新桥                  | `PixivApiPlugin.dohResolveCore` + `PixivApiPluginTest` 3 个新测试 + JS 桥 + 设置 UI 折叠区                                           |

最终验收：

- ✅ 仓库无 `ApiEndpoints` / `apiProxyBase` / `api_proxy_base` 任何残留引用（grep = 0）；
- ✅ 21 个 Robolectric 测试全过（DohClient 14 + DohCache 8 + 3 个 PixivApiPlugin doh 测试）；
- ✅ 1319 个 TS 单元测试全过（networkModeStore 9 + SettingsDirectAccess 11 + 其他既有测试）；
- ✅ TypeScript 检查 + lint + fmt 全绿；
- ✅ ADR-0146 顶部废弃横幅；
- ✅ ADR-0145 顶部 D3 废弃横幅。

## 引用

- [pixiv-third-party-clients-direct-access.md](../research/pixiv-third-party-clients-direct-access.md) — 三家横向调研
- [pictelio-pure-client-direct-access.md](../research/pictelio-pure-client-direct-access.md) — 详细方案
- [doh-resolver-feasibility-2026-09.md](../research/doh-resolver-feasibility-2026-09.md) — DoH 可达性探针报告
- [pixiv-direct-access-feasibility.md](#)（commit `68fbd826`）— 三层免梯通道实证
- [pixiv-gfw-blocking-and-bypass.md](../research/pixiv-gfw-blocking-and-bypass.md) — GFW 封锁模型
- [ADR-0144](./ADR-0144-direct-access-transport.md) — 直连传输层决策
- [ADR-0145](./ADR-0145-direct-access-v2.md) — 直连 v2 多候选竞速
- ADR-0146（已废弃）
- 现有代码：
  - `packages/app/src/stores/networkModeStore.ts` — 三档 store
  - `packages/app/src/components/settings/SettingsDirectAccess.tsx` — UI（三档选择器 + DoH 折叠区）
  - `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DohClient.java` — 双端点 DoH
  - `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DohCache.java` — 7 天 TTL 持久化
  - `packages/app/android/app/src/main/java/io/pictelio/app/directaccess/DohResolver.java` — 顶层入口
  - `packages/app/android/app/src/webview/java/io/pictelio/app/PixivApiPlugin.java` — `dohResolveCore` Plugin 方法
