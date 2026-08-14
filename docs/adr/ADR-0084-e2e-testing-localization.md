# ADR-0084: agent-browser E2E 测试本地化与 CI 精简

## 状态

已采纳

## 分类

技术决策

## 日期

2026-08-14

## 背景

GitHub CI 的 `ci.yml` 原先在 `test` job 中执行 `pnpm test:all`（含 agent-browser E2E），但 Runner 无 `PIXIV_REFRESH_TOKEN`，43 个 E2E 用例中 42 个被 `skipIf` 跳过、不 spawn 浏览器——即 CI 名义挂载 E2E、实际从未真实执行，形成虚假安全感（agent-browser-e2e-perf-direction-f-report 实证漂移 6 天无人发现）。

## 决策

1. CI 只保留 `pnpm check:all`（类型检查）+ `pnpm lint:all`（lint）；`test` job 从 CI 移除。
2. 单元测试与 agent-browser E2E 全部改为本地运行。
3. refresh_token 只从本地 `PIXIV_REFRESH_TOKEN` 环境变量获取（`.env` 已 gitignore，历史从未提交），**绝不进入 GitHub Secrets / CI 日志**。
4. E2E 防漂移守卫改为本地两层：静态锚点校验 hook（`.husky/pre-push`，秒级）+ 手动浏览器验证（昂贵层）。

## 理由

- E2E 依赖真实 Pixiv 网络 + token，GitHub Runner 网络路径与本地（GFW+代理）完全不同，进 CI 只会引入不可复现的抖动。
- 空转壳比没有更糟：既拦截不了漂移，又误导维护者以为有守卫。
- refresh_token 具备账号级访问能力，绝不上 CI（安全硬约束）。

## 替代方案

- 保留 test job 并注入 token 跑全量：被拒绝——CI 网络路径未验证、拖累 PR、token 进 secrets 面。
- 保留空转壳：被拒绝——虚假安全感。
