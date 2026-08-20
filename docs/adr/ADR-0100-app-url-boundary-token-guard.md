# ADR 0100：URL 重写受信边界修复——伪后缀域误判与 access_token 附加守卫（对齐 lynx #165）

**状态**：已批准
**日期**：2026-08（双轴 code-review 通过：Standards + Spec，0 blocker）
**决策者**：团队成员 + security-review（#165 结论复核）/ code-review（F1 conformance）会话
**背景**：承接 ADR-0098（跨引擎一致性保障）差分契约表的 F1 conformance warning——evil 伪后缀域行把 app 的误重写固化为 expectedWebApp；lynx 已由 security-review 修复同类缺陷（#165），本次将修复方案对齐回 app（D2-A）。

---

## 背景

Pictelio 是双引擎 monorepo（webview 客户端 `packages/app` / lynx 客户端 `packages/app-lynx`），共享同一 Pixiv 数据源与 OAuth 凭证体系。URL 重写是同语义双实现之一（ADR-0098 确立差分测试 + 契约表机制，两引擎互为 oracle）。

该缺陷已由跨引擎差分测试显式记录：`packages/app/tests/unit/differential/sharedUrlRewriteCases.ts` evil-suffix 行（L70-74）当前把 app 的误重写固化为 `expectedWebApp: "/pixiv-api.evil.com/v1/illust"`（code-review F1 conformance warning）；lynx 侧 `expectedWebLynx` 为原样放行。

lynx 已修复（#165 security review）：`rewriteUrl` web 分支改用边界匹配（`path === base || startsWith(base + "/")`），并新增 `shouldAttachAuth`（`/pixiv-` 前缀 或 `isTrustedPixivHost` 精确 hostname 白名单）。app 仍为无边界 `startsWith` + 无条件附 token，存在真实安全缺陷。

## 问题描述

1. **web 分支无边界前缀匹配 → 伪后缀域误判**：app `rewriteUrl` web 分支（`packages/app/src/api/client.ts` L223-227）用 `path.startsWith(PIXIV_API_BASE)` 判定 Pixiv 主机。伪后缀域 `https://app-api.pixiv.net.evil.com`（攻击者可控域名）以 `PIXIV_API_BASE` 为前缀 → 被误判为 Pixiv 主机，重写为 `/pixiv-api.evil.com/v1/illust`，后续请求落到攻击者域名。auth URL 分支（L226-227）同样无边界。
2. **execute web 分支无条件附加 access_token**：`execute` web 分支（`client.ts` L305 GET / L311 POST）`if (devAccessToken) headers["Authorization"] = \`Bearer \${devAccessToken}\`` 对目标 URL 无信任判断——一旦 rewriteUrl 输出攻击者域名（上述误判即触发），devAccessToken 被携带到非 Pixiv 域。顺序上 token 附加发生在 fetch 内联调用 `rewriteUrl(path)` 之后，但未基于重写结果做裁决。
3. **差分契约表固化错误行为**：`sharedUrlRewriteCases.ts` evil 行将误重写固化为 app 期望值，F1 conformance 固化使"误重写"成为受守护的契约而非缺陷。

## 决策

1. **rewriteUrl web 分支边界修复（对齐 lynx #165）**：web 分支 Pixiv API 判定改为严格边界 `path === PIXIV_API_BASE || path.startsWith(PIXIV_API_BASE + "/")`；auth URL 分支同样改严格边界，并补带 query 的边界：`path === PIXIV_AUTH_URL || path.startsWith(PIXIV_AUTH_URL + "/") || path.startsWith(PIXIV_AUTH_URL + "?")`。伪后缀域不再命中任何分支 → 原样放行。既有 `/pixiv-` 前缀短路分支与相对路径分支不变。
2. **新增 `shouldAttachAuth(rewrittenUrl)`（纯函数，对齐 lynx）**：接收**已重写**的 URL——web 分支返回 `rewrittenUrl.startsWith("/pixiv-")`；native 分支返回 `startsWith("http") && isTrustedPixivHost(rewrittenUrl)`。仅本地代理路径携带 token，外部绝对 URL（含伪后缀域）不带。
3. **新增 `isTrustedPixivHost(url)`（纯函数）**：从 `__PUBLIC_CONFIG__` 常量（app 现有 `PIXIV_API_BASE` / `PIXIV_AUTH_URL`，`client.ts` L7-8）解析 hostname 组成白名单（**禁止硬编码域名字符串**——项目约束），对目标 URL 做精确 hostname 比对——天然防伪后缀域（`app-api.pixiv.net.evil.com` 的 hostname 不等于白名单）。
4. **execute web 分支守卫**：`if (devAccessToken)` 改为 `if (shouldAttachAuth(url) && devAccessToken)`，其中 `url = rewriteUrl(path)` 结果——**先重写、再基于重写结果裁决是否附 token**（与 lynx 顺序一致）；fetch 内联重写改为先算 `url` 再复用，避免重复重写与裁决对象不一致。
5. **同步差分契约表与单测期望**：`sharedUrlRewriteCases.ts` evil 行 `expectedWebApp` 由 `"/pixiv-api.evil.com/v1/illust"` 改为**原样放行** `"https://app-api.pixiv.net.evil.com/v1/illust"`（与 lynx 一致），契约差异行移除、F1 conformance 固化消除；同步更新 app URL 重写测试期望值，并补 `shouldAttachAuth` / `isTrustedPixivHost` 单测（evil-suffix、auth 带 query、外部域不带 token）。
6. **不抽共享层（保持 D2-A 双实现 + 差分兜底）**：app/lynx 各自实现上述修复，不抽共享 build/normalize 模块——避免削弱刚建立的 URL 差分测试独立性（ADR-0098 isRestricted 行同款论证：差分价值依赖双实现存在）。

## 替代方案评估

| 决策 | 方案 | 评估 |
|---|---|---|
| 修复策略 | **D2-A 对齐补全（选定）** | 精准修复（边界匹配 + 令牌守卫），双端在差分契约表收敛为一致，改动面仅 app 单包 + 契约表；与 lynx 已验证面（#165）对齐，风险最低 |
| | D2-B 抽共享 build/normalize 模块 | 单一事实源、消除双实现漂移，但**削弱差分独立性**（抽共享后差分对象消失）、引入新包/新依赖面、扩大改动面；本次否决，留待后续专项评估 |

## 影响范围

| 文件 | 改动 |
|---|---|
| `packages/app/src/api/client.ts` | `rewriteUrl` web 分支严格边界 + auth query 边界（L223-227）；新增 `shouldAttachAuth` / `isTrustedPixivHost` 纯函数；`execute` web 分支附 token 条件（L305/L311）改 `shouldAttachAuth(rewriteUrl(path)) && devAccessToken` |
| `packages/app/tests/unit/differential/sharedUrlRewriteCases.ts` | evil 行 `expectedWebApp` 误重写 → 原样放行（与 lynx 一致），消除 F1 conformance 固化 |
| `packages/app/tests/unit/api/client.test.ts` | URL 重写期望值同步；新增 shouldAttachAuth / isTrustedPixivHost 单测（含 evil-suffix、auth 带 query、外部域不带 Authorization） |
| `packages/app-lynx/src/api/client.ts` | 参照基准，不改动（#165 已实现） |

注：app native 分支 token 由 PixivApiPlugin（Java 侧）管理、JS 零知，`shouldAttachAuth` native 分支为纵深防御对齐，实际守卫落在 web 分支。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 差分契约表与 app 实现不同步（只改一端）→ 契约测试红 | 实现 + 契约表 + 测试期望值**同一改动原子提交**，改完跑 `pnpm test` 全量 |
| 影响既有 `rewriteUrl` 调用面（blimp radius） | 动手前先 grep 全部 `rewriteUrl` 调用点确认无依赖"误重写行为"的调用方；边界修复只收紧误判输入，合法输入（`/pixiv-` 短路、相对路径、真 Pixiv 域）行为不变 |
| access_token 保护属安全项，改动需谨慎 | 守卫收紧为 `shouldAttachAuth(url) && devAccessToken`；用测试显式断言"非 /pixiv- 目标不带 Authorization 头"；code-review 重点核对（F1 维度） |
| auth URL 带 query 的边界遗漏（`?`） | 决策 1 显式补 `PIXIV_AUTH_URL + "?"` 分支，用真实带 query 的 auth URL 样例做契约测试（oracle 溯源） |

## 后果

- 伪后缀域不再被误重写为攻击者路径；access_token 不再被携带到非 Pixiv 域（web 分支双防护：边界匹配 + 令牌守卫）。
- app 与 lynx 的 web URL 重写语义在差分契约表**收敛为一致**（evil 行从"契约差异"变为"一致"），F1 conformance 固化消除。
- 双实现 + 差分兜底保留（D2-A），跨引擎一致性继续由差分测试机器守卫；后续若再评估抽共享层，须另行 ADR 论证差分价值替代方案。
