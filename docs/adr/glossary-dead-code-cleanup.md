# 死代码治理 — 术语表

死代码分析与清理（ADR-0083）使用的统一术语。帮助后续维护者在判断"某段代码是否可删"时对齐概念，避免重复全仓扫描。

## 核心术语

| 术语 | 定义 |
|------|------|
| **死代码（dead code）** | 生产路径不可达、且无任何消费者（含测试）的源码：零引用文件、未使用导出、未使用依赖、未接线脚本、死路由等。运行时被 Vite/Rollup tree-shaking 消除，代价是维护负担（继续被 `pnpm check` 扫描、误导文档读者）。 |
| **零引用（zero reference）** | 全仓（src/tests/scripts/各包/配置文件/原生代码）无任何 import/require/动态导入/字符串引用。判定时须覆盖 `.ts/.tsx/.vue/.mjs/.html/.java/.gradle` 全部扩展名——只搜 `.ts/.tsx` 会漏 `.vue`（历史教训：app-lynx `fetchNovelText` 曾被误判为零引用，实际被 `NovelDetail.vue` 调用）。 |
| **未使用导出（unused export）** | 模块内被 `export` 暴露、但全仓无任何 `import { X }` 的符号。删除 `export` 关键字安全（符号本体在定义模块内仍被使用）；删除符号本体不安全。 |
| **仅测试引用（test-only reference）** | 生产代码零引用、仅被 `tests/` 消费的符号。按仓库规则"测试即消费者"，**不算死代码**；是否删除属人工决策（保留则继续维护测试，删除则测试一并删除）。 |
| **死引用链（dead reference chain）** | 一组文件互相引用、但整体不可达的闭包。如 `RecommendedFeed` → `NovelRecommendedFeed`：组件被引用但引用者自身是死组件。删除时须整链处理，不能只删链尾。 |
| **未接线脚本（unwired script）** | 存在于 `scripts/` 目录、但未被任何 package.json script / CI workflow 调用的脚本。部分可能因依赖缺失（如 playwright 不在任何 package.json）而无法运行。 |
| **未使用依赖（unused dependency）** | 声明于 package.json、但 src/tests/scripts/原生代码全仓零引用的依赖。移除前须确认非 peer 依赖（如 vue-lynx 的 `@rsbuild/plugin-vue` 为必需 peer，移除会报 peer 缺失）。 |
| **生成文档（generated docs）** | `openwiki/` 目录下由 GitHub Actions 定时任务（openwiki-update.yml）每日自动生成的内容（禁止本地触发、禁止手改）。删除死代码后无需手动同步，CI 定时重生成。 |
| **tree-shaking（摇树优化）** | Vite/Rollup 在生产构建时剔除未引用模块/导出的优化。死代码虽被消除、运行时影响为零，但**不构成保留理由**——维护负担与文档误导仍存在。 |
| **测试即消费者（tests as consumers）** | 仓库规则：测试对符号的引用视为合法消费。仅被测试引用的代码不算死代码，删除前须人工权衡（连同测试一起删 vs 保留为公共 API 面）。 |

## 删除决策分级

| 置信级 | 定义 | 处置 |
|--------|------|------|
| **高置信** | 引用计数 + 生产 bundle 交叉验证，全仓（含 tests/原生代码/配置）零引用 | 直接删除 |
| **中置信** | 仅测试引用 / 疑似依赖 / 需人工确认 | 人工决策：保留（测试即消费者）或连同测试删除 |
| **低置信** | 可能为 PWA/应用商店/未来功能预留 | 保守保留，文档标注 |

## 验证方法（删除前必做）

1. **引用计数**：grep 符号名全仓，区分「定义处 / import 引用 / 注释与文档提及 / 字符串」。
2. **扩展名覆盖**：`.ts / .tsx / .vue / .mjs / .html / .java / .gradle / *.config.*` 全部覆盖（`.vue` 是历史漏网重灾区）。
3. **测试交叉验证**：`tests/` 是否引用；若删除符号，对应测试是否需一并删除。
4. **原生代码检查**：`android/` 下 `.java / .gradle` 是否有插件/桥接引用（如 `@capacitor/device` 的原生 `DevicePlugin`）。
5. **peer 依赖检查**：依赖移除前查 `node_modules/*/package.json` 的 peerDependencies 与 pnpm-lock.yaml，避免 peer 缺失。
6. **生产 bundle 核对**：`dist/` 中确认死代码已被 tree-shaking（运行时影响为零，但非保留理由）。
7. **删除后闭环**：`pnpm check` + `pnpm test:all` + agent-browser E2E + Android 模拟器 E2E 全量回归。

## 相关链接

- ADR: `docs/adr/ADR-0083-dead-code-cleanup.md`
- 分析报告: `docs/research/dead-code-analysis.md`
- 前置决策: ADR-0023（滚动原语统一，未执行的删除步骤由本次补执行）、ADR-0075（首页 C shell 改版遗留旧 Feed 组件群）
