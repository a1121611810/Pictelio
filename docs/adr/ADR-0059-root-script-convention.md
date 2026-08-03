# ADR-0059：根目录脚本命令约定（`命令:包名` 与 `命令:all`）

## 背景

根目录 `package.json` 承担 workspace 命令委托层，但命名不统一：app 命令走 `vp run --filter pictelio-app`，lynx 用 `pnpm --filter pictelio-app-lynx` 加 `:lynx` 简称，website / ugoira 没有任何根脚本委托。用户要启动非默认包时需要记忆多种后缀与传输方式。

## 决策

采用统一约定：

- **裸命令默认 `pictelio-app`**：`pnpm dev` / `pnpm build` / `pnpm check` 等无后缀命令委托给 `pictelio-app`（保留历史行为）。
- **`<命令>:<包目录名>` 委托给对应包**：`dev:app`、`dev:app-lynx`、`dev:website`、`check:ugoira` 等。包目录名即后缀，不再使用 `lynx` 这类简称。
- **`<命令>:all` 并行执行所有拥有该脚本的包**：统一写成 `vp run --parallel --filter pictelio-app --filter pictelio-app-lynx --filter pictelio-website --filter @pictelio/ugoira <script>`，无该脚本的包自动跳过（已实测）。
- **统一传输方式为 `vp run --filter <包名> <脚本>`**：app / app-lynx / website / ugoira 一致，不再混用 `pnpm --filter`。
- **删除旧别名**：`dev:lynx` / `build:lynx` / `check:lynx` / `sync:lynx-bundle` 不保留别名，同步更新文档与注释（无 CI/脚本引用）。
- **`test:all` 语义回归字面**：变为"所有包的单测并行"；原"app 单测 + agent-browser E2E"组合迁移到 `test:app:all`。

## Considered Options

- **显式枚举（采纳）**：每个包每命令在根 `package.json` 写一行。直白、可 grep、无新文件；代价是新增包时需补脚本行。
- **通用分发器脚本（否决）**：`node scripts/pkg-run.mjs dev app-lynx` 可减少重复行，但引入间接层、可读性差，三包规模下收益边际。
- **`-r` recursive 实现 `:all`（否决）**：pnpm-workspace 把根目录本身（`.`）也算作一个包，`vp run -r dev` 会把 root 的 `dev` 脚本选入，造成无限递归；`:all` 一律显式 `--filter` 列包。
- **保留 `dev:lynx` 等旧名作别名（否决）**：私有项目、无自动化依赖；两套名字并存增加认知负担。

## Consequences

- 命名规则一条：裸命令 = app，`命令:包名` = 对应包，`命令:all` = 并行全包。新增包只需按约定补脚本行。
- `check:all` 会暴露此前被 app-only check 掩盖的包级 check 失败（实现本 ADR 时顺手修复了 ugoira check 的存量 `require` 类型错误）。
- `pnpm test:all` 从"app 单测 + e2e"变为"全包单测"；e2e 改用 `pnpm test:agent-browser` 或 `pnpm test:app:all`。
