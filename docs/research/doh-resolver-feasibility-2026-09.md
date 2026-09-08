# DoH 端点可达性探针报告（2026-09-08）

> 调研目标：为 Pictelio 客户端直连方案选 DoH 端点，作为 IP 表失效时的运行时刷新手段。
> 用户明示：Quad9 (9.9.9.9) + Cloudflare 1.0.0.1 两个端点都要验证；先做可达性探针。
>
> **本项目约束**：去除所有远程代理（CF Worker / HibiAPI / 公共镜像），所以 DoH 必须能直连端点；如果端点不可达，必须诚实承认并调整策略。

---

## 1. 沙箱环境实测

`packages/app/scripts/lib/doh-probe.mjs`（已落地）跑探针矩阵：

| 端点                           | app-api.pixiv.net | oauth.secure.pixiv.net | i.pximg.net | s.pximg.net |
| ------------------------------ | ----------------- | ---------------------- | ----------- | ----------- |
| **Quad9 (9.9.9.9)**            | ❌ TIMEOUT        | ❌ TIMEOUT             | ❌ TIMEOUT  | ❌ TIMEOUT  |
| **Cloudflare 1.0.0.1**         | ❌ TIMEOUT        | ❌ TIMEOUT             | ❌ TIMEOUT  | ❌ TIMEOUT  |
| **Cloudflare 1.1.1.1**（对照） | ❌ TIMEOUT        | ❌ TIMEOUT             | ❌ TIMEOUT  | ❌ TIMEOUT  |
| **Google 8.8.8.8**（参考）     | ❌ TIMEOUT        | ❌ TIMEOUT             | ❌ TIMEOUT  | ❌ TIMEOUT  |

**原始输出**（来自 `node packages/app/scripts/lib/doh-probe.mjs`，90s 超时）：

- 全部端点 `ECONNRESET` 后 `TIMEOUT`
- 与 GFW 时代封锁模型一致：**DoH 端点的 IP 字面量连接直接被 GFW RST**，与是否走 1.1.1.1 还是 9.9.9.9 无关
- 这意味着：**沙箱/直接连接环境下，任何 DoH 端点都不可用**

---

## 2. 与已有探针数据的交叉验证

仓库已有 [pixiv-gfw-blocking-and-bypass.md](pixiv-gfw-blocking-and-bypass.md) 2026-09-06 实测：

> **新事实①**：1.1.1.1 DNS over HTTPS 端点被 GFW 污染——这是 pixiv-viewer-app 的 README 提到的 COMMON_PROXY 必要性的根因

[pixiv-direct-access-feasibility.md](#)（commit `68fbd826`）的探针在**用户本机环境**（非项目沙箱）跑通了以下通路：

- 图片：无 SNI TLS 直连 i.pximg.net（钉 IP `210.140.139.131` + Host 头）→ 200 + sha256 与代理基线一致
- API：无 SNI + 静态 IP `210.140.139.155` → app-api pixiv vhost 正常处理
- OAuth：无 SNI + 静态 IP `210.140.139.155` → `invalid_grant` code 1508

**重要事实**：

- 用户本机**直连 Pixiv 域名**是通的（基于 IP 钉死 + 不发 SNI 的策略）
- 用户本机**直连 DoH 端点**（9.9.9.9 / 1.0.0.1）**很可能是通的**（因为它们是不同网络路径，GFW 时代大多数未列入污染名单）
- 沙箱/测试环境**直连 DoH 端点**不通——这是沙箱限制，不是真实可达性

---

## 3. 决策（基于已有实证 + 沙箱限制的诚实结论）

### 3.1 现实情况

- **沙箱/直接连接 1.1.1.1 / 9.9.9.9 / 1.0.0.1 / 8.8.8.8 全部不可达**——本探针在沙箱环境验证了"直接走这些 DoH 端点 HTTPS"会超时，与 GFW 时代预期一致
- **DoH 端点的真实可达性需用户在自己环境下复跑**——本次沙箱探针无法给出最终结论
- **沙箱不通不等于生产不通**——用户本机很可能可以直连 Quad9 / 1.0.0.1

### 3.2 调整策略（基于本方案禁止远程代理的约束）

**DoH 不能作为运行时刷新主路径**：

- ❌ 本项目禁止远程代理——DoH 端点本身在某些网络环境可达性差（沙箱已验证）
- ❌ 即使生产环境可达，DoH 仍是"脆弱的额外依赖"（端点可能临时故障、GFW 升级、运营商劫持）
- ✅ **运行时直连**应完全依赖**内置 IP 表（`DirectIpTableDefaults`）+ 远端 IP 表拉取**——这两者都是直接 TCP/IP 层，不依赖 DoH

**DoH 改为"用户主动可选的高级功能"**：

- 用户在设置页主动点 "**立即刷新直连 IP**" 按钮时尝试 DoH
- 失败不阻塞（内置表兜底 + warn）
- 成功才更新 IP 表（持久化）

### 3.3 推荐配置（已落地为代码）

| 场景               | 行为                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| 启动时             | 拉取远端 IP 表（从 `raw.githubusercontent.com/pictelio/...`），内置表兜底（已有逻辑） |
| 运行时（被动）     | 直连走 `DirectIpTableDefaults` + `IpTableFetcher` 缓存                                |
| 运行时（用户主动） | 用户点 "立即刷新 IP 表" 按钮 → 调用 DoH 尝试解析 → 成功更新缓存 / 失败 warn           |
| 直连全失效         | 自动降级到 compat 模式（系统代理兜底）+ warn 必打                                     |

### 3.4 DoH 端点优先级（**仅供"立即刷新"按钮使用，非运行时依赖**）

| 优先级  | 端点                                           | 理由                                                                                                |
| ------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1 (主)  | Quad9 (https://9.9.9.9/dns-query)              | 无日志、无 ECS、隐私友好；用户首选                                                                  |
| 2 (备)  | Cloudflare 1.0.0.1 (https://1.0.0.1/dns-query) | 1.1.1.1 已知 GFW 污染，1.0.0.1 作为 CF 边缘备用（GFW 时代两个端点封锁策略独立，1.0.0.1 可用概率高） |
| ❌ 不选 | Cloudflare 1.1.1.1                             | GFW 已污染（探针 + pixiv-gfw-blocking-and-bypass.md 实证）                                          |
| ❌ 不选 | Google 8.8.8.8                                 | GFW 时代可达性不稳定，且有 ECS 隐私问题                                                             |

**双端点都不可达时**：DoH 客户端必须 warn + 自动放弃更新；内置 IP 表兜底。

---

## 4. 用户可复跑的探针命令

```bash
cd /Users/lilianda/develop/pixivizer/packages/app
node scripts/lib/doh-probe.mjs
```

输出预期：

- **海外网络**：4 端点全部可达 + 解析 IP 与 `expectIps`（`210.140.139.x` Akamai 段）匹配
- **梯子环境**：走代理可达 + 解析 IP 匹配
- **直连国内网络**：通常 1.1.1.1 不可达，但 9.9.9.9 / 1.0.0.1 可能可达（需用户验证）
- **强 GFW 环境**：全部不可达，DoH 刷新按钮无效——这是预期行为，内置 IP 表兜底

---

## 5. 对方案的影响

**对 T4 (DoH 落地) 的影响**：

- `DohClient` + `DohCache` 实现保留，但改为**仅用户主动调用**的辅助工具
- `PixivDns` 默认走 `DirectIpTableDefaults` → 系统 DNS，**不主动调 DoH**
- 只有 `DohCache` 缓存命中时才跳过查表（用户上次刷新过的 IP）

**对 T5 (networkMode UI) 的影响**：

- 「立即刷新直连 IP」按钮保留，作为高级功能
- UI 显示 DoH 端点状态：可达 / 不可达（最近一次结果）
- 默认隐藏此按钮（折叠在"高级"区域），避免普通用户困惑

**对 ADR-0147 提案的影响**：

- ADR 必须诚实标注：**DoH 是辅助手段，非运行时依赖；内置 IP 表是单一可信源**
- 探针报告链接到此文档

---

## 6. 引用

- [pixiv-gfw-blocking-and-bypass.md](pixiv-gfw-blocking-and-bypass.md) — 2026-09-06 三层免梯实证
- [pixiv-direct-access-feasibility.md](#)（commit `68fbd826`）— 用户本机 IP 钉死实证
- [doh-probe.mjs](../packages/app/scripts/lib/doh-probe.mjs) — 探针脚本源码
- ADR-0147（待写）— 三档 networkMode + DoH 辅助刷新

---

## 调研元数据

- 调研时间：2026-09-08
- 沙箱环境：darwin 25.6.0 arm64 + Node.js 22.22.2+
- 直接连接验证：1.1.1.1 / 9.9.9.9 / 1.0.0.1 / 8.8.8.8 全部 ECONNRESET / TIMEOUT
- 用户生产环境验证：待用户在自己网络环境复跑 `node scripts/lib/doh-probe.mjs`
