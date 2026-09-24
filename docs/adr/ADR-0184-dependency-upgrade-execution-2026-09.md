# ADR-0184: 全 workspace 依赖升级执行批次（2026-09）

- 状态: Accepted（2026-09-25）
- 日期: 2026-09-25
- 关联: 术语表 [`docs/adr/glossary-dependency-upgrade.md`](./glossary-dependency-upgrade.md)（含 2026-09-25「执行批次术语」节）；前序评估 [ADR-0080-dependency-upgrade-analysis.md](./ADR-0080-dependency-upgrade-analysis.md)；T1 锁定与 pnpm 供应链配置（`pnpm-workspace.yaml`）
- 性质: ADR-0080（2026-08-12）为「只评估不执行」；本 ADR 为其执行批次，逐包给出**本批次终态**（升级 / 暂缓）与 peer 证据。

## 背景

ADR-0080 以「均衡评估」盘点全 workspace 依赖：patch/minor 建议升级（只记录不执行），major 逐个暂缓并写明再评估触发条件。2026-09-25 执行批次目标：**全部直接依赖升至当前生态允许的最新版本**，暂缓项必须有 npm peer/engines 硬证据并保留触发条件。

供应链约束不变：`minimumReleaseAge: 1440`（24h 冷却）、`resolutionMode: time-based`、`trustPolicy: no-downgrade`、`@lynx-js/web-core@0.23.1` 豁免锁定（T1）。

事实基线（2026-09-25，`pnpm outdated -r` + `pnpm view` 逐包核实）：

- CI Node 基线 = 22（`.github/workflows/ci.yml`）；本机 24.18；根 `devEngines.node >=22.22.2`。
- prerelease 不占 `latest` tag，`pnpm outdated` 漏报了 solidjs rc 线推进（rc.6→rc.9 已发布）。

## 决策

**D1 · patch/minor 常规升（批次 A，原 17 项，执行期 vue / query-persist-client-core 两项移入 D5 暂缓）**——semver 兼容，直接升，门禁兜底：

| 包 | 从 → 到 | 宿主 |
|---|---|---|
| @commitlint/cli / config-conventional | 21.2.x → 21.2.3 | root |
| @tanstack/virtual-core | 3.17.7 → 3.17.11 | app |
| @fluentui/web-components | 3.0.3 → 3.1.3 | app |
| @fluentui/tokens | alpha.23 → alpha.24 | app |
| @tanstack/query-persist-client-core | 5.101.4（维持，执行期回退，见 D5） | app |
| @chenglou/pretext | 0.0.8 → 0.0.9 | app |
| fast-check | 4.9.0 → 4.10.2 | app / net-diagnostics / update-check |
| happy-dom | 20.11.2 → 20.14.5 | app |
| jsdom | 30.0.1 → 30.1.1 | app |
| unocss | 66.7.5 → 66.10.5 | app |
| vite | 8.2.1 → 8.3.0 | app |
| appium / webdriverio | 3.6.0→3.7.0 / 9.30.1→9.32.0 | app（e2e 工具） |
| @types/node | 26.2.0 → 26.6.2 | app / app-lynx |
| vue | 3.5.40（维持，执行期回退，见 D5） | app-lynx |
| @tanstack/vue-query | 5.102.8 → 5.103.2 | app-lynx |
| @lynx-js/tailwind-preset | 0.5.0 → 0.5.1 | app-lynx（peer tailwind ^3.4 ✓） |
| astro | 7.1.3 → 7.3.4 | website |

**D2 · solidjs rc 线同批升（批次 B，4 件强制同批）**——`@solidjs/vite-plugin@3.0.0-next.44` peer 要求 `solid-js ^2.0.0-rc.9`：

- `solid-js` rc.6 → **rc.9**；`@solidjs/web` rc.6 → **rc.9**；`@solidjs/router` next.21 → **next.27**（next.28 发布于 24h 冷却期内被 `minimumReleaseAge` 正确拦截，冷却过后可顺移）；`@solidjs/vite-plugin` next.39 → **next.44**。
- 破坏面由 1282 单测 + agent-browser E2E 兜底；@solid-primitives/* 已是各自 latest，不动。

**D3 · 无生态死锁 major：门禁兜底试升（批次 C）**——门禁红且一轮修复不收敛即回退并在本 ADR 记录：

| 包 | 从 → 到 | 约束核实 |
|---|---|---|
| vitest（7 包直跑） | 4.1.10 → **5.0.1**；**app 除外**，定格 ^4.1.10（执行期修订，见下） | engines ^22.12 ✓；peer vite ^8 ✓；stryker-vitest-runner@10 peer `>=2.0.0` ✓（ugoira mutation 实测通过）。**执行期发现 `vite-plus@0.2.8` 硬依赖 `vitest@4.1.10`（dependencies 非 peer）**：app 的 `vp test` 走 vp 内嵌 4.1.10，外部 devDep 若升 5 只会制造双实例 peer 警告——app 的 vitest 与 vp 绑定，vp 1.0（批次 E 触发）时统一。 |
| vue-router（app-lynx） | 4.6.4 → **5.3.1** | peer vue ^3.5.34 ✓、pinia ^4 ✓；路由守卫 760 单测兜底 |
| typescript（app + 6 纯逻辑包） | 6.0.3 / 5.9.3 → **7.0.2** | app 需显式 `"types": ["node"]` 应对 TS7 默认 `[]`（ADR-0080 已识别）；core 包已显式 `types: []` 不受影响；**app-lynx 除外**（见 D5）。**执行期发现**：TS7 npm 包主入口只剩版本存根（tsgo 原生编译器不再携带编译器 JS API，`exports` 仅 version + unstable 子路径）——app 的 i18n 回潮门禁（P1 防线）依赖 `createSourceFile`/`ScriptKind` 完整 API，经 npm alias `typescript-compiler-api: npm:typescript@^6.0.3` 钉 TS6，门禁逻辑零改动；全仓仅 2 处消费（双端 hardcode-gate 测试，lynx 侧保持 5.9 不受影响） |

**D4 · engines 封顶暂缓（批次 E-1）**：

- **agent-browser 定格 0.34.0**——≥0.35 全线 `engines.node >=24`，CI 基线 22。触发：CI 升 Node 24，或上游恢复 node 22 支持线。

**D5 · 生态 peer 卡点暂缓（批次 E-2，硬证据）**：

| 暂缓项 | 卡点证据（2026-09-25 `pnpm view`） | 触发条件 |
|---|---|---|
| tailwindcss 4（app-lynx） | `@lynx-js/tailwind-preset@0.5.1` peer `tailwindcss ^3.4.0`；`rsbuild-plugin-tailwindcss@0.2.4` peer `tailwindcss ^3.1.0` | lynx preset / 插件发版支持 tw4 |
| @lynx-js/rspeedy 0.17 / @rsbuild/plugin-vue 2.0 / @lynx-js/web-core 0.26 | **vue-lynx@0.5.1（最新）** peer `@rsbuild/core ^1.0.0` + `@rsbuild/plugin-vue ^1.2.6`，锚死 rsbuild 1 线 | vue-lynx 发版支持 rsbuild 2（届时三件与 web-core 豁免清单同批决策） |
| app-lynx typescript | `@lynx-js/rspeedy@0.13.6` peer `typescript 5.1.6 - 5.9.x`（当前 5.9.3 已在顶） | rspeedy 升级批次落地 |
| vite-plus 1.0.0-rc.0 | prerelease（延续 ADR-0080 政策） | 1.0 stable |
| @lynx-js/web-core@0.23.1 豁免清单 | T1 锁定（ADR-0080），与 rspeedy 批次绑定 | 同上 |
| **vue 3.5.41+**（app-lynx，执行期实测新增） | `vue-tsc --noEmit` 在 3.5.41/3.5.42/3.5.43 全报 `Excessive stack depth comparing 'DefineComponent' and 'Component'`（3 个 `createApp` 入口），3.5.40 绿；vue-tsc@3.3.11 已是最新无解 | vue 3.5.44+ 或 vue-tsc 新版修复后复测 |
| **@tanstack/query-persist-client-core 5.103.2**（app，执行期实测新增） | `@tanstack/solid-query@6.0.0-rc.3`（latest）被 time-based 解析冻结在 `query-core@5.101.4`；persist-client 升 5.103.2 产生双 query-core 实例（`#private` 字段 nominal 失配，app tsc 红） | solid-query 6 rc 发版对齐 query-core 5.103+ 后同步升级 |

**D6 · 门禁与验收**：准入 = `pnpm check:all` + `pnpm lint:all` + `pnpm test:all` 全绿（test:all 含 app 单测 + agent-browser E2E）。批次 B（solidjs rc）为高风险批次，独立提交便于回退定位。Android 构建链（Capacitor 8.5 / Gradle）不在本次范围（`pnpm outdated` 未报过时）。

## 后果

- 正面：安全补丁与 bug 修复全量跟进；solidjs rc 线对齐 vite-plugin 要求；TS7 带来检查提速（Corsa）；为 vite-plus 1.0 / lynx 工具链解卡后的快速跟进铺垫。
- 代价：solidjs rc.9 行为漂移风险由测试兜底；vitest 5 / vue-router 5 / TS 7 各自的破坏性变更在实施票中逐项消化；暂缓项保留明确触发条件（评估期 5 条 + 执行期实测新增 2 条）。
- 回退策略：批次独立 commit；任一门禁红且不可收敛 → 单批 `git revert`，并在本 ADR 修订记录回退与再评估触发。
