import { defineConfig } from "vite-plus";

/**
 * 仓库级统一 lint / fmt 配置（唯一配置源，ADR-0185）
 *
 * vite-plus 1.0 起 lint/fmt 规则收敛到根：`pnpm vp lint` / `pnpm vp fmt` 在仓库根
 * 单进程覆盖全部 workspace 包（此前 lint:all / fmt:all 需按包 fan-out，且 6 个
 * 纯逻辑包与 app-lynx 的 lint/fmt 一直是空占位）。规则集自
 * packages/app/vite.config.ts 的 lint/fmt 块上移，语义不变；app 内同名块已删除，
 * 防止双源漂移。app 的 dev/build 配置已随 WebView 客户端整包删除（ADR-0203 决策 2），
 * 唯一客户端 app-lynx 的 dev/build 走根 package.json 的裸名命令。
 */
export default defineConfig({
  lint: {
    ignorePatterns: [
      "**/dist/**",
      // ADR-0203 宿主迁移：Gradle 工程从 packages/app/android 迁到 packages/android-host/android。
      // 仍按**具体路径**收窄（ADR-0186 review P2：通配 **/android/** 会误伤
      // packages/android-host/tests/unit/android/ 的 R8 keep 规则契约测试）。
      // 逐条列出的理由——oxfmt/oxlint 不读 .gitignore，故生成物必须显式排除：
      // ① .gradle/ 是 GRADLE_USER_HOME，内含整个 Gradle 发行版的 HTML 文档
      //   ⚠️ ADR-0203 迁移后的真实路径是**包根**下的 .gradle/（`build:android` 以
      //   `GRADLE_USER_HOME=$(pwd)/.gradle` 从 packages/android-host 起 gradle），
      //   不是 android/.gradle/。旧条目漏了真实路径 ⇒ oxlint 扫进 Gradle 发行版的
      //   Javadoc/JS，`pnpm lint` 恒 exit≠0 而诊断 0 条来自本仓源码。
      // ② **/build/ 是 AGP 构建产物
      // ③ 源树里 oxfmt 真正会碰的只有两类：res/raw/upgrade.html（Android 资源，
      //      随 APK 分发）与 src/test/resources/*.json（Java 测试资源，与
      //      novel-export payload 逐字节比对，重排即破契约）
      // Java / .gradle / .pro / .xml 不在两者的支持面内，不列。
      "packages/android-host/.gradle/**",
      "packages/android-host/android/.gradle/**",
      "packages/android-host/android/**/build/**",
      "packages/android-host/android/**/*.html",
      "packages/android-host/android/**/*.json",
      // 旧宿主路径（packages/app/）曾在此列 4 条忽略项，注释同时写着「不要重建
      // 对已删包的长期忽略契约」—— 注释与代码自相矛盾。已按注释删除，实测它们
      // 什么都匹配不到：oxlint/oxfmt 的文件发现按 **workspace 成员**收敛，
      // `packages/app` 已不是成员（ADR-0203 整包删除，pnpm-workspace 只认
      // `packages/*` 下真实存在的包）。阳性对照实测：磁盘上重建一个带
      // package.json 的完整 packages/app/ 并放入 .json/.html/.ts 垃圾文件，
      // `pnpm fmt:check` 扫描文件数恒为 163、0 条来自该目录；同一时刻
      // packages/update-check/src/ 里的同类垃圾被抓出并转红。
      // ⇒ 本机若真有残留垃圾，正确处置是删掉那个目录，不是往这里加条目。
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
            // #722 e2e 诊断窗（__root.tsx）与实例标记（authStore.ts）
            "__pictelioDebug",
            "__authStoreInstance",
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
      // ADR-0203 宿主迁移：Gradle 工程从 packages/app/android 迁到 packages/android-host/android。
      // 与上方 lint 块同一条收窄纪律（ADR-0186 review P2：不能用 **/android/** 通配，
      // 那会误伤 packages/android-host/tests/unit/android/ 的 R8 keep 规则契约测试），
      // 逐条理由见上：oxfmt 不读 .gitignore，故 .gradle/ 与 **/build/ 显式排除；
      // 源树里只有 res/raw/upgrade.html 与 src/test/resources/*.json 两类会被碰。
      // ⚠️ 与上方 lint 块（line 31）**必须保持同一组路径**：ADR-0203 迁移后真实
      // GRADLE_USER_HOME 在包根（`build:android` 用 `GRADLE_USER_HOME=$(pwd)/.gradle`），
      // 本块曾只列 android/.gradle/ 而漏了它 ⇒ oxfmt 扫进 Gradle 发行版的 JDK 文档，
      // `pnpm fmt:check` 恒红而诊断 0 条来自本仓源码。两个块各改一处就会再次漂移。
      "packages/android-host/.gradle/**",
      "packages/android-host/android/.gradle/**",
      "packages/android-host/android/**/build/**",
      "packages/android-host/android/**/*.html",
      "packages/android-host/android/**/*.json",
      // 旧宿主路径（packages/app/）：T10 删包前的本机 git-ignored 残留，曾在此列
      // 5 条。已按 lint 块同一份实测删除（含 fmt 侧独有的 assets/public/**）。
      // 判据与证据见 lint 块注释：文件发现按 workspace 成员收敛，该目录扫不到。
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
