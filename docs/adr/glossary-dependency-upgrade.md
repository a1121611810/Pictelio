# 依赖升级评估 — 术语表

> 范围：2026-08 全 workspace 依赖盘点中使用的评估策略、供应链约束与升级决策术语。配套 ADR：[ADR-0080-dependency-upgrade-analysis.md](./ADR-0080-dependency-upgrade-analysis.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **依赖升级评估（Dependency upgrade assessment）** | 对 workspace 全部直接依赖进行可升级性盘点，为每个库给出「建议升级 / 暂缓」结论及风险收益依据的过程。本次评估只产出分析 + 决策记录（ADR），**不执行升级**。 |
| **均衡评估（Balanced assessment）** | 本次采用的评估策略：patch + minor 一律标「建议升级」；major 逐个评估破坏性变更、工具链兼容性与收益，给出独立结论。介于「保守」（major 一律暂缓）与「激进」（全部追新）之间。 |
| **建议升级（Recommended upgrade）** | 评估结论之一：版本升级收益大于成本、破坏面可控。只记录不执行，执行时按清单分批。 |
| **暂缓（Hold / Defer）** | 评估结论之一：当前版本继续保留，不升级。通常因为工具链/生态未跟上（如 Go 编译器不支持语言插件）、渲染引擎兼容存疑，或为保持已验证组合稳定（MVP）。 |
| **T1 决策锁定（T1 decision lock）** | `pnpm-workspace.yaml` 中 `minimumReleaseAgeExclude` 对 `@lynx-js/web-core@0.23.1` 与 `@lynx-js/web-worker-rpc@0.23.1` 的豁免——lynx-family 官方包 PoC 已验证版本的**刻意锁定**，升级需明确决策并同步修订豁免清单。 |
| **minimumReleaseAge 冷却期** | `pnpm-workspace.yaml` 的供应链安全配置：发布不足 24h（1440 分钟）的新包禁止安装，防攻击者利用刚发布的热门包。豁免见 `minimumReleaseAgeExclude`。 |
| **time-based 解析（resolutionMode: time-based）** | pnpm 按时间点解析子依赖，防止子依赖劫持。盘点时需注意此配置对可升级版本解析的影响。 |
| **devEngines Node 下限** | 根 `package.json` 的 `devEngines.node.version` 声明（当前 `>=20.19`），pnpm 安装时强制校验（onFail: error）。jsdom 30 将 Node 下限抬到 `^22.22.2 || ^24.15.0 || >=26.0.0`，与之绑定的升级必须同步提升该下限。 |
| **Corsa（Go 原生编译器）** | TypeScript 7.0（2026-07-08 发布）：编译器从 JS 移植到 Go，约 10x 类型检查提速；同时 hard-remove 一批旧配置（`es5` 目标、`baseUrl`、`moduleResolution: node`、`module: amd/umd/systemjs`、`types` 默认改为 `[]` 等），且**不支持语言插件**。 |
| **CSS-first 配置（`@theme`）** | Tailwind v4 的配置方式：`tailwind.config.js` 不再自动加载，改在 CSS 中用 `@theme` 声明令牌；JS 配置仅能经 `@config` 兼容模式保留。本项目 app-lynx 的定制 `tailwind.config.ts`（spacing=vw、fontSize=rpx、M3 色板）迁移即为此模式。 |
| **T1 已验证组合（T1 validated combo）** | lynx 侧当前锁定的依赖组合（rspeedy 0.13.x + web-core 0.23.1 + tailwind 3.4 等），PoC 阶段验证过、作为 MVP 基线保持不变。 |

## 决策速查（2026-08-12）

| 包 | 结论 | 关键约束 |
|----|------|---------|
| 13 项 patch/minor（app 为主） | 建议升级 | 无阻塞 |
| `jsdom` 30.0.1 | 建议升级（唯一放行 major） | 必须同步提升 devEngines Node 下限到 22.22.2 |
| `typescript` 7（4 包） | 暂缓 | Go 编译器不支持语言插件；`types` 默认 `[]` 变化 |
| `tailwindcss` 4 | 暂缓 | rsbuild 插件 / lynx preset 未确认支持；渲染引擎兼容存疑 |
| `vue-router` 5 | 暂缓 | 零破坏但为保持 MVP 稳定统一暂缓 |
| lynx 工具链（rspeedy / web-core / rsbuild-plugin-vue 等） | 暂缓 | T1 锁定不变 |
| `@fluentui/tokens` | 维持 alpha.23 | alpha 预发布，9.x experimental 非目标 |

## 易混淆概念辨析

- **「建议升级」≠「本次执行」**：本次盘点只产出 ADR 记录；升级执行是后续独立批次动作。
- **「暂缓」≠「不升级」**：暂缓项都有明确的再评估触发条件（如工具链支持落地、下一次版本规划），不是永久否决。
- **T1 锁定 ≠ 冷却期豁免**：`minimumReleaseAgeExclude` 既是「新包冷却」的豁免（免于 24h 等待），也是「已验证版本」的刻意锁定；解除需决策。
- **`devEngines` 下限 ≠ 运行时 Node 要求**：`devEngines` 是开发/安装期契约（CI 与本机），jsdom 30 抬的是它；运行时（Android WebView / 构建产物）不受影响。
- **TS7 的 `types` 默认 `[]` ≠ 显式 `"types": []`**：ugoira/update-check 已显式声明空数组，行为与 TS7 默认一致（不受影响）；app 未声明 `types` 字段，TS7 下会丢失 `@types/*` 自动引入（受影响）。
