# ADR-0185: vite-plus 1.0.0-rc 采纳与 lint/fmt 仓库根收敛

- 状态: Accepted（2026-09-25）
- 日期: 2026-09-25
- 关联: 前序 [ADR-0184-dependency-upgrade-execution-2026-09.md](./ADR-0184-dependency-upgrade-execution-2026-09.md)（vite 8.3.0 / TS7 基线即本 ADR 前提）；事故复盘 ADR-0142（release 走错 vp 版本）
- 性质: 工具链升级。vite-plus 自 `31a4eeb3`（pnpm workspace 迁移）起已是本仓任务编排底座，本 ADR 记录升级 1.0.0-rc.0 的决策、实证与范围裁定。

## 背景

vite-plus 1.0.0-rc.0（2026-09-22，npm `latest` tag，MIT）相对 app 原钉的 0.2.8（2026-08-05）跨 0.2.9~0.3.3 五个版本。升级前实证的四个问题：

1. **本地版本偏移（P0）**：root `package.json` 脚本分裂两派——裸 `vp` 命中用户级全局 vp（当时 1.0.0-rc.0），`pnpm vp` shim 命中 app 内 0.2.8，同机两大版本并存；无全局 vp 的机器上裸派命令直接 command-not-found。与 ADR-0142 记录的 release 事故（用户级 0.3.2 顶替 app 内 0.2.8）同根因，当时仅修表象。
2. **双 vitest 大版本**：app 硬绑 vitest 4.1.10（0.2.8 内置），其余 6 包已用 vitest 5.0.1，测试行为与配置语法事实分叉。
3. **lint/fmt 覆盖缺口**：9 包中 8 个无 lint/fmt（app-lynx 为 echo 占位，6 个纯逻辑包零配置），root `lint:all/fmt:all` 按包 fan-out 且过滤清单含无 script 的包。
4. **1.0 工具链换代红利**：`vp toolchain` 实测 1.0 内置 vite 8.3.0（与本仓同版）+ rolldown 1.2.9 + **vitest 5.0.1**（告别 vitest 4 硬绑）+ oxlint 1.85 + oxfmt 0.70 + oxlint-tsgolint（TS7 原生 type-aware lint，本期未启用）。

## 决策

**D1 · 双侧钉版 1.0.0-rc.0（精确版本，禁 caret）**——root `devDependencies` 与 app `devDependencies` 同钉 `vite-plus@1.0.0-rc.0`。所有裸 `vp` 脚本经 PATH 解析到仓内钉版，`vp --version` 的 Local vite-plus 探测由 "Not found" 变为命中；`pnpm vp` shim 保留为兜底。版本偏移在依赖安装层根除（不依赖机器环境）。

**D2 · vite 依赖别名对齐 vite-plus-core**——vp 1.0 硬要求：workspace 解析到的 `vite` 必须是 vite-plus-core 别名（否则 build/dev 拒跑：`Expected @voidzero-dev/vite-plus-core@1.0.0-rc.0, but found vite@8.3.0`）。app 依赖改为 `"vite": "npm:@voidzero-dev/vite-plus-core@1.0.0-rc.0"`（官方 migrate-rules 语义：保留声明、指向 core 别名）。**peer 告警为 RC 期版本串噪声**：`@solidjs/vite-plugin`/`@vitest/mocker`/vitefu 的 peer 范围读到的 Installed 版本串是 `1.0.0-rc.0`，而 vite-plus-core 实际 bundle vite 8.3.0（`vp toolchain` 证实），build 943ms 成功即运行时兼容实证。等各插件声明 1.0 兼容范围后告警自然消失。

**D3 · vitest 4→5 归一，零适配即绿**——app `vitest` 精确钉 `5.0.1`（与 vp 1.0 内置同版，消灭双大版本）。三套测试配置**零改动**通过：
- unit（`vite-plus/test/config` 入口）：200 文件 / 1957 用例，vitest 4 与 5 各跑一轮全绿；
- agent-browser（独立 `vitest/config`）：`vitest list` 全量收集成功（globalSetup/spec 语法兼容），真跑留待下次手动批次；
- android-e2e（独立 `vitest/config`）：同构配置，随 agent-browser 结论。

`vitest` 直接依赖**保留**（官方 migrate-rules 允许：存在 standalone 配置直跑 `vitest` CLI 的上游引用）。未采用 `vp migrate`：其配置合并步骤会把 `vitest.config.ts`（mock 凭据）并入 `vite.config.ts`（真实凭据），破坏两文件刻意分离的凭据注入面；200 文件的 `vitest → vite-plus/test` import 重写留待 1.0 stable 后评估。

**D4 · lint/fmt 收敛仓库根单配置源**——新建 root `vite.config.ts` 承载 lint/fmt 全量规则（自 app 块上移，语义不变）；app `vite.config.ts` 删除两块（防双源漂移），app scripts 以 `vp -C ../..` 重定向到根执行；root `lint`/`lint:all` 归一为 `pnpm vp lint` 单命令（单进程 626 文件），新增 `fmt:check`/`outdated` 顶层命令。**探针实证** root lint/fmt 均遍历 `packages/app` 与 core 包子树（注入违规文件双命中）。范围裁定（豁免面，均有 ADR 记录）：

| 豁免 | 理由 |
|---|---|
| `packages/app-lynx/**` | 首次纳入暴露 ~150 条存量风格债（`_` 前缀约定 / no-shadow / no-array-sort 等），属独立重构票；spike 证实 oxlint 1.85 **可直接解析 .vue**，开闸只欠清债 |
| `packages/website/**` | .astro 不在 oxlint/oxfmt 支持面 |
| `docs/**`、`scripts/audit-real-interaction/**` | 研究产物 / 真机审计取证脚本（字节原状保证复跑口径） |
| `**/*.md` | oxfmt 0.70 md 规则变更；openwiki 为 CI 生成物禁手改，AGENTS.md 有行数锚点契约 |

**D5 · 存量告警当场清偿（10 项）+ 新规则口径**——oxlint 1.85 新启用 `unicorn/consistent-function-scoping`（10 条），与既有 `no-await-in-loop` 同口径关闭（调用点内联回调是本仓惯用法，提升外层属纯风格重构）。清偿项：search-core `filters.ts` 三数组改 `ReadonlySet.has`；ugoira `stream.ts` 错误补 `cause`、测试 `toReversed()`；`kill-dev-server.mjs`/`verify-agent-skills.mjs`/`stryker.config.ts` 死代码与 API 换新。search-core 改动经 21 个受影响测试回归验证。

**D6 · 明确不采纳面**——vp 包管理器 / `vp env` Node 管理（devEngines + .node-version 已覆盖）/ `vp hooks` 替代 husky（commitlint + check-push-refs 契约不动）/ tsdown pack。`vp run --cache`：默认关闭（脚本任务 cache disabled），实测前置 `--cache` flag 可达 **3/3 命中、省 2.42s**（`--cache` 置于任务名**之前**，置于之后会被透传为脚本参数——实测 `tsc --cache` 报错），留作本地可选杠杆，不进 CI（RC 期缓存正确性未经长期验证）。

**D7 · app `vite.config.ts` 的 `as any` 维持**——实测拆除后 TS2321（Excessive stack depth）依旧触发：栈深爆点在 vite 8 + rolldown 的 UserConfig 联合类型本身（与 lint/fmt 块无关）。注释已更新归因。

## 执行结果终态（2026-09-25，分支 chore/vite-plus-1rc）

| 门禁 | 结果 |
|---|---|
| app unit（vitest 4 基线 / vitest 5 / 别名后复跑） | 200 文件 / 1957 用例全绿 ×3 |
| 全仓 `test:all`（9 包） | exit 0 |
| app web `vp build` | ✓ 943ms（别名对齐后） |
| root lint | 626 文件 0 warnings 0 errors |
| root fmt `--check` | 660 文件全过（46 文件一次性归一） |
| `pnpm check`（app：root fmt+lint+tsc） | exit 0（连续两次） |
| `vp run --cache` 二次命中 | 3/3（100%），2.42s |
| CI android job 影响面 | 脚本路径未变（`pnpm --dir packages/app run build` → vp build，别名后可用）；Robolectric 侧无工具链接触 |

## 回退

单分支 revert 即回 0.2.8/4.1.10 基线（lockfile 同步还原）；lint/fmt 覆盖回退到「仅 app + fan-out」旧行为。

## 遗留与再评估触发器

- **1.0 stable 发布**：重跑 `vp migrate --dry` 对比；评估 `vitest → vite-plus/test` import 全量重写与 tsgolint（type-aware lint）启用。
- **app-lynx 清债开闸**：~150 条存量债清偿后从豁免面移出（独立票）。
- **peer 告警收敛**：`@solidjs/vite-plugin` / vitest 系声明 1.0 兼容范围后复查 `pnpm peers check`。
- **`vp run --cache` 进 CI**：RC 期缓存正确性观察后定。
