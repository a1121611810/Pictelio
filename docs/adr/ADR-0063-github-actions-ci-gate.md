# ADR 0063: GitHub Actions CI 作为 PR 合并门禁——轻量双 job（check+lint / test）

## 状态

已采纳（2026-08-05 落地）

## 分类

技术决策 / CI 基建 / 质量门禁

## 日期

2026-08-05

## 背景

仓库开源化后，GitHub 提示 main 分支不受保护。计划用 Rulesets 保护 main（仅仓库 owner 可绕过，contributor 只能通过 PR 合入），但 Rulesets 的 "Require status checks to pass" 需要真实的 status check 才能生效，而仓库当时**没有任何线上 CI**：

- `.github/workflows/deploy.yml` 仅部署 website 到 GitHub Pages（只跑 astro build，不跑测试/lint）
- `.github/workflows/openwiki-update.yml` 仅定时刷新 OpenWiki 文档

因此需要新增一个 CI workflow，作为 PR 合并的自动验证门槛。

## 决策

### 1. 新增 `.github/workflows/ci.yml`，双 job 结构

| Job | 命令 | 产物 status check |
|-----|------|-------------------|
| `check`（Type check & lint） | `pnpm check:all` + `pnpm lint:all` | `CI / Type check & lint` |
| `test`（Unit tests） | `pnpm test:all` | `CI / Unit tests` |

拆成两个 job 而非单 job：GitHub 为每个 job 生成独立 status check，Rulesets 可分别勾选，失败时可立即区分"类型/风格"与"测试"问题。

### 2. 覆盖范围：全 workspace，复用根脚本委托

复用 ADR-0059 的根脚本约定（`check:all` / `lint:all` / `test:all` 委托到 app + app-lynx + ugoira，website 无 check/test 脚本自动跳过），不新增任何包级脚本。

### 3. 触发策略：push main + PR main，全路径不过滤

- 不设 `paths` 过滤：多包仓库路径过滤容易漏（改动 app-lynx 不触发 CI 即漏洞），全量跑代价小。
- push main 也触发：owner 绕过 Rulesets 直接 push 时仍有回归防护。

### 4. 明确排除（本期不做）

| 排除项 | 理由 |
|--------|------|
| agent-browser E2E | 需 DeepSeek API key + LLM 断言 + Playwright 浏览器，耗时数分钟，不适合作为开源 PR 门槛；留作本地 / 未来手动 `workflow_dispatch` |
| android-e2e（Appium 模拟器） | 按 ADR-0061 定为**本地**门禁（环境不可控 + 运行成本高），不进 CI |
| app `build`（vite 打包） | `check:all` 已含 `tsc --noEmit`，类型层面足够；vite build 慢且多余 |
| `fmt:check` | oxfmt 格式差异会卡住未跑 `pnpm fmt` 的贡献者，lint 已覆盖风格类问题 |
| Gradle/APK 构建 | 属发布流程（本地 `pnpm build:android`），需要 JDK，不适合作为 PR 门槛 |

### 5. 安全约束：仅用 `pull_request`

`pull_request` 事件对 fork PR 授予只读权限、不暴露 secret（`GITHUB_TOKEN` 只读），本项目 CI 只需读权限。**禁止**改用 `pull_request_target`（避免恶意 PR 注入 workflow 的供应链攻击面）。

### 6. 环境与依赖安装

沿用 `deploy.yml` 已验证的 setup 模式：`pnpm/action-setup@v4` + `actions/setup-node@v5`（node 22，`cache: pnpm`）。安装使用 `pnpm install --frozen-lockfile`：锁文件漂移（lockfile 未随依赖变更提交）时直接失败，防止 PR 悄悄改依赖。`concurrency` 取消同一 ref 的旧任务，避免快速迭代时 CI 排队。

## 后果

### 正面

- 开源 PR 合入 main 前自动通过类型检查、lint、单测三关，配合 Rulesets 的 "Require status checks to pass" 形成硬门禁
- owner 绕过 Rulesets 直接 push main 时同样有回归防护
- 零 secret 配置、零浏览器依赖、零新增脚本，CI 轻量（依赖安装为主，单测为 node 环境）
- 复用既有根脚本与 setup 模式，无新学习成本

### 负面 / 成本

- 每次 PR 需等待依赖安装 + 全 workspace 检查/测试（首次 2-5 分钟量级）
- fork PR 首次无 pnpm 缓存，会略慢
- 无 paths 过滤意味着纯文档类改动（如 README）也会触发 CI（代价小，可接受）
- lint 可能拦下部分本地未跑 lint 的提交，需贡献者本地 `pnpm lint` 对齐

### 风险缓解

- 双 job 隔离：类型/lint 与测试互不阻塞，失败信息清晰
- `concurrency` 取消旧任务控制成本
- CI 失败仅阻止合并，不影响 main 上既有代码（owner 绕过时靠 push CI 兜底，不强制阻塞）

## 关联

- 本决策背景：main 分支 Rulesets 保护（仅 owner bypass，PR 强制）
- 既有约定：ADR-0059（根目录脚本委托）、ADR-0061（android-e2e 本地门禁）
- 现有 workflow：`deploy.yml`（website 部署，提供 setup 模式参考）、`openwiki-update.yml`（定时文档刷新）
