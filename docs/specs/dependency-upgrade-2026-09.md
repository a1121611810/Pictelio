# Spec: 全 workspace 依赖升级执行批次（2026-09）

- 状态: ready-for-agent
- 日期: 2026-09-25
- 决策依据: [ADR-0184-dependency-upgrade-execution-2026-09.md](../adr/ADR-0184-dependency-upgrade-execution-2026-09.md)
- 术语: [glossary-dependency-upgrade.md](../adr/glossary-dependency-upgrade.md)（含「执行批次术语」节）

## Problem Statement

维护者在 2026-09-25 面对：ADR-0080 评估批次产出的「建议升级」清单从未落地，workspace 直接依赖落后当前最新版约 1-2 个月（含安全与 bug 修复）；solidjs rc 线已推进到 rc.9 而 `@solidjs/vite-plugin@next.44` peer 要求 rc.9，继续滞留 rc.6 会让下一次 vite-plugin 升级无法单独进行。缺一次把「全部直接依赖升至生态允许的最新版」的执行批次，且暂缓项需要硬证据而非直觉。

## Solution

按 ADR-0184 的五批次决策，升级 `package.json` 版本声明并重装 lockfile：

- 批次 A（17 项 patch/minor）、批次 B（solidjs rc 四件同批）、批次 C（vitest 5 / vue-router 5 / TS 7 试升）落地；
- 批次 E（agent-browser、lynx 工具链、tailwind 4、vite-plus rc、app-lynx TS）持 peer/engines 硬证据暂缓；
- 每批独立提交，全量门禁准入；试升失败单批回退并在 ADR 记录触发条件。

终端用户视角无任何功能变化——这是纯依赖维护批次；收益是安全补丁、上游 bug 修复与 TS7 检查提速。

## User Stories

1. 作为维护者，我希望所有 patch/minor 落后的依赖一次性升到最新，以便获得上游安全与 bug 修复而无需逐个追踪。
2. 作为维护者，我希望 solid-js/@solidjs/web/@solidjs/router/@solidjs/vite-plugin 同批升到 rc.9/next.28/next.44，以便满足 vite-plugin 的 peer 契约并保持 rc 线一致。
3. 作为维护者，我希望 vitest 升到 5 并保持 stryker mutation 链路可用，以便测试基础设施不因大版本落后而腐化。
4. 作为维护者，我希望 vue-router 升到 5 且 lynx 路由守卫回归全绿，以便确认 5.x 无破坏性影响或拿到明确回退证据。
5. 作为维护者，我希望 TypeScript 升到 7（app + 6 个纯逻辑包）且类型检查零回归，以便获得 Corsa 编译器约 10x 检查提速。
6. 作为维护者，我希望 TS7 下 app 的 `@types/*` 引入行为显式化（显式 `types` 字段），以便消除「默认 `[]` 静默丢类型」陷阱（ADR-0080 已识别）。
7. 作为维护者，我希望 `vp test`（vp 内嵌链路）与外部 `vitest run`（agent-browser / android-e2e / core 包）两条测试链路在 vitest 5 下分别验证，以便不让「单链路绿」掩盖「双链路漂移」。
8. 作为维护者，我希望 agent-browser 定格 0.34.0 并在 ADR 记录 engines 证据，以便 CI（node 22）不被 `engines>=24` 的上游断供。
9. 作为维护者，我希望 lynx 工具链（rspeedy/plugin-vue/web-core/tailwind）持 peer 证据暂缓，以便不在 vue-lynx 锚点解除前盲目破坏 T1 验证组合。
10. 作为维护者，我希望每个批次独立 commit，以便任一批次引发回归时可单批 revert 定位。
11. 作为维护者，我希望试升失败的批次在 ADR 中记录「回退 + 再评估触发条件」，以便下次评估不用重新考古。
12. 作为终端用户，我希望升级后 app 的全部功能行为与升级前一致（纯依赖维护、零功能变更），以便升级不带来任何体验风险。
13. 作为 CI 流水线，我希望 check:all / lint:all / test:all 三门禁全绿作为准入，以便机器防线覆盖本次全部改动。
14. 作为供应链安全策略（pnpm-workspace.yaml），我希望 24h 冷却、time-based 解析、trust-policy 与 web-core@0.23.1 豁免清单全部保持不变，以便升级不松动既有供应链防线。
15. 作为 code-review 流程，我希望升级后的 diff 通过仓库级 code-review 双轴门禁并以 tdd 闭环修复，以便问题在提交前归零。

## Implementation Decisions

- **版本终态以 ADR-0184 决策表为准**（D1-D6），本 spec 不重复版本号表。
- **批次顺序**：A（低风险热身）→ B（solidjs rc，独立提交）→ C1 vitest 5 → C2 vue-router 5 → C3 TS 7；每批 `pnpm install` 重析 lockfile 后跑受影响包门禁，全绿才提交。
- **批次 B 必须同批**：vite-plugin next.44 peer `solid-js ^2.0.0-rc.9`，四件拆开单升必挂（术语「rc 线同批升级」）。
- **TS7 适配点**：app tsconfig 需显式声明 `types` 字段（现依赖隐式 @types 自动引入）；core 包已显式 `types: []` 不动；app-lynx 不升（rspeedy 0.13.6 peer 封顶 5.9.x）。TS7 移除项（baseUrl、node10 moduleResolution 等）本仓 tsconfig 已核实不存在。
- **vitest 5 适配点**：关注 `vitest.workspace`→`projects` 类配置迁移、happy-dom/jsdom 环境选项重命名；stryker-vitest-runner@10 peer `>=2.0.0` 已核实兼容，无需动。
- **vue-router 5 适配点**：`createMemoryHistory` 仍为首方 API（lynx 路由基础）；破坏面以 app-lynx 760 单测 + 守卫回归为准。
- **锁死的部分**：`pnpm-workspace.yaml` 的供应链配置与 overrides 全部不动（web-core 豁免、event-listener next.5 强制、css-serializer/template-webpack-plugin 对齐）。
- **不新增任何 seam**：本 spec 零生产代码改动；若适配需要改生产代码（如 TS7 类型修正），改动必须最小化且不引入新抽象。

## Testing Decisions

- **验收缝 = 既有三门禁**（最高缝，零新缝）：`pnpm check:all`（9 包类型检查）、`pnpm lint:all`（oxlint）、`pnpm test:all`（app 单测 + agent-browser E2E + 7 包单测）。
- 只验证外部行为：测试全绿 = 行为未变；不为升级本身写新测试。若上游行为变化暴露既有断言失真，按「测试硬约束 3」补 `console.warn` 显式化而非静默改期望。
- oracle 溯源：门禁命令与 CI（`.github/workflows/ci.yml`）完全一致，推送前本地复跑 CI 同命令（先例：ci-parity 约定）。
- 好测试标准沿用 `packages/app/tests/TESTING.md`；本批次预期的「好结果」是**零新增测试、零期望值修改**，任何一处期望值被迫修改都是上游行为漂移信号，须单独说明。

## Out of Scope

- Android 原生构建链（Capacitor 8.5 / Gradle / AGP）——`pnpm outdated` 未报过时。
- 批次 E 全部暂缓项（见 ADR-0184 D4/D5）。
- openwiki 生成文档（CI 定时重生成，禁手改）。
- 发版（`pnpm release`）与 versionCode bump——升级批次不触发发布。
- 模拟器/真机验收——批次不含渲染层逻辑变更；若批次 B 门禁出现渲染类失败，升级为模拟器验收并在票内记录。

## Further Notes

- 执行分支 `chore/dependency-upgrade-2026-09`；ADR-0184 与术语表已先期提交（b3789078）。
- `pnpm outdated` 对 prerelease 漏报（solid rc.9 案例）——后续盘点须辅以 `pnpm view <pkg> versions`。
- 门禁全绿后的 review 闭环：code-review → tdd 修复 → code-review 复检，直至零问题（用户强制要求）。
