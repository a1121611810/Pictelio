import { defineConfig } from "vite-plus";

/**
 * 仓库级统一 lint / fmt 配置（唯一配置源，ADR-0185）
 *
 * vite-plus 1.0 起 lint/fmt 规则收敛到根：`pnpm vp lint` / `pnpm vp fmt` 在仓库根
 * 单进程覆盖全部 workspace 包（此前 lint:all / fmt:all 需按包 fan-out，且 6 个
 * 纯逻辑包与 app-lynx 的 lint/fmt 一直是空占位）。规则集自
 * packages/app/vite.config.ts 的 lint/fmt 块上移，语义不变；app 内同名块已删除，
 * 防止双源漂移。app 的 dev/build 配置仍在 packages/app/vite.config.ts。
 */
export default defineConfig({
  lint: {
    ignorePatterns: [
      "**/dist/**",
      // 收窄到 app 的 android 平台目录（ADR-0186 review P2）：通配 **/android/** 会
      // 误伤 packages/app/tests/unit/android/ 的 R8 keep 规则契约测试
      "packages/app/android/**",
      "**/node_modules/**",
      "**/.codegraph/**",
      "**/.playwright-cli/**",
      "**/.worktrees/**",
      "**/.husky/**",
      "pnpm-lock.yaml",
      "**/*.d.ts",
      // 研究产物与基准数据不进门禁（docs/research 下的 .ts 基准数据曾误入 lint 范围）
      "docs/**",
      // 真机交互审计取证脚本（#363）：一次性探针，刻意保持紧凑写法；字节原状保证
      // 与归档审计报告的复跑口径一致，不纳 lint/fmt
      "scripts/audit-real-interaction/**",
      // 范围裁定（ADR-0185）：astro 组件（.astro）不在 oxlint/oxfmt 支持面
      "packages/website/**",
      // 范围裁定（ADR-0185）：app-lynx 首次纳入 lint 面暴露 ~150 条存量风格债
      // （_ 前缀约定 / no-shadow / no-array-sort 等），属独立重构票，不在工具链
      // 升级中夹带；接入后再单独清债开闸
      "packages/app-lynx/**",
    ],
    options: {
      typeAware: false,
      typeCheck: false,
      maxWarnings: 0,
    },
    categories: {
      correctness: "error",
      suspicious: "warn",
      pedantic: "off",
      perf: "warn",
      style: "off",
      restriction: "off",
      nursery: "off",
    },
    plugins: ["typescript", "unicorn", "oxc"],
    rules: {
      // SolidJS 的 <div ref={el}> 会在运行时赋值，oxlint 的 no-unassigned-vars 无法理解该模式
      "no-unassigned-vars": "off",
      // 允许 _ 前缀的未使用变量，保持解构/回调参数可读性
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // 下划线命名豁免：tanstack-virtual 内部 API（_didMount/_willUpdate）、
      // 构建注入常量（__CREDENTIALS__/__PUBLIC_CONFIG__）、模块私有命名约定（_root/_raw/_credsPath/_authPromise）
      "no-underscore-dangle": [
        "warn",
        {
          allow: [
            "_didMount",
            "_willUpdate",
            "_root",
            "_raw",
            "_credsPath",
            "_authPromise",
            "__CREDENTIALS__",
            "__PUBLIC_CONFIG__",
            // ESM 下重建的 CJS 惯用名（scripts/deploy.mjs）
            "__dirname",
            // #722 e2e 诊断窗（__root.tsx）
            "__pictelioDebug",
          ],
        },
      ],
      // 循环内串行 await 是有意写法（分页、重试、顺序依赖请求），并行化是行为变更
      // （与测试文件 override 的既有豁免保持一致）
      "no-await-in-loop": "off",
      // oxlint 1.85（vite-plus 1.0-rc 内置）新启用的 unicorn 规则：在调用点内联定义
      // 回调是本仓惯用法（读局部性优先），提升到外层属纯风格重构、无行为收益——
      // 与 no-await-in-loop 同口径关闭
      "consistent-function-scoping": "off",
      // IndexedDB 事务事件（onsuccess/onerror）与 img.onload 的一次性属性赋值是惯用法
      "prefer-add-event-listener": "off",
    },
    overrides: [
      {
        files: ["**/tests/**/*.test.ts", "**/tests/**/*.test.tsx", "**/tests/**/*.spec.ts"],
        // Override 设置 plugins 会替换（而非合并）基线列表，必须包含所有所需插件
        plugins: ["typescript", "unicorn", "oxc", "vitest"],
        env: { node: true },
        rules: {
          "no-console": "off",
          "require-mock-type-parameters": "off",
          "no-unused-vars": [
            "error",
            { argsIgnorePattern: "^_", varsIgnorePattern: "^_|^vi$|^beforeEach$|^afterEach$" },
          ],
          "no-underscore-dangle": "off",
          "consistent-function-scoping": "off",
          "no-await-in-loop": "off",
          // T0 门禁（ADR-0097）：测试必须有断言，防"无断言测试"（conformance 弱测试）
          "expect-expect": "error",
          "no-conditional-expect": "off",
          "require-to-throw-message": "off",
          "no-standalone-expect": "off",
        },
      },
      {
        files: [
          "scripts/**/*.mjs",
          "packages/*/scripts/**/*.mjs",
          "*.config.ts",
          // 含嵌套 vitest/stryker 等配置（tests/*/vitest.config.ts）
          "packages/**/*.config.ts",
        ],
        env: { node: true },
        rules: {
          "no-console": "off",
        },
      },
    ],
  },

  fmt: {
    ignorePatterns: [
      "**/dist/**",
      // 收窄到 app 的 android 平台目录（ADR-0186 review P2）：通配 **/android/** 会
      // 误伤 packages/app/tests/unit/android/ 的 R8 keep 规则契约测试
      "packages/app/android/**",
      "**/node_modules/**",
      "**/.codegraph/**",
      "**/.playwright-cli/**",
      "**/.worktrees/**",
      "**/.husky/**",
      "pnpm-lock.yaml",
      "**/*.d.ts",
      // 字节一致性契约的数据 fixture 禁重排（novel-export payload 与 Java test resource 逐字节比对）
      "**/tests/fixtures/**",
      // oxfmt 0.70 起 md 规则变更：md 全域退出 fmt（冻结现状；openwiki 为 CI 生成物
      // 本就禁手改，AGENTS.md 有行数锚点契约测试）
      "**/*.md",
      "docs/**",
      "scripts/audit-real-interaction/**",
      "packages/website/**",
      "packages/app-lynx/**",
    ],
    options: {
      lineWidth: 100,
      indentStyle: "space",
      indentWidth: 2,
      quoteStyle: "double",
      jsxQuoteStyle: "double",
      quoteProps: "as-needed",
      semicolons: "always",
      trailingComma: "all",
      arrowParens: "always",
      bracketSpacing: true,
    },
  },
});
