# Agent-browser E2E 测试

基于 [agent-browser CLI](https://github.com/vercel-labs/agent-browser) 的 AI 驱动主流程测试。

## 前置条件

```bash
# 1. 安装 agent-browser CLI（全局推荐）
npm install -g agent-browser

# 2. 下载 Chrome for Testing
agent-browser install

# 3. 设置环境变量
export PIXIV_REFRESH_TOKEN="your_token"
export DEEPSEEK_API_KEY="your_key"
```

## 运行

```bash
# 从 packages/app 目录
pnpm test:agent-browser
```

## 目录结构

```
tests/agent-browser/
├── specs/
│   ├── main-flow.test.ts    # 超长链（25 步）
│   └── sub-flows.test.ts    # 4 条中链
├── driver.ts                # AgentBrowserDriver 封装
├── fixtures.ts              # 测试 fixture（登录等）
└── setup.ts                 # Vitest setup
```

## 架构

- 每个测试步骤：操作（click/fill/scroll）→ snapshot → aiAssert → expect
- aiAssert 将页面状态（accessibility tree + innerText）发给 DeepSeek Flash 判断
- 失败自动重试 2 次，全部失败则阻断

## pre-push 静态锚点校验

背景：E2E 套件曾因"改了 UI 但没人跑 E2E"而漂移无人发现。为此在 git pre-push 阶段加了一道**秒级静态校验**（不跑浏览器），把"锚点失效"这类静态可判的漂移挡在 push 前。

### 工作机制

- hook 位于 `.husky/pre-push`（仓库已用 Husky v9 管理 hooks，`pnpm install` 触发 `prepare` 自动激活，**无需手动安装**）。
- push 时检测本次推送范围是否触碰 `packages/app/src/` 或 `packages/app/tests/agent-browser/`：
  - 未触碰 → 零开销直接放行；
  - 触碰 → 运行 `packages/app/scripts/check-e2e-anchors.mjs`，失败则阻止 push。
- 校验逻辑：扫描 `specs/*.test.ts`（含 `*.spec.ts`）中引用的锚点，逐一与 `src/` 源码比对存在性：
  - **硬校验（缺失即失败）**：`data-testid`、`aria-label` / `placeholder` 属性选择器、`navigate`/`navigateSpa`/`pathname` 判断中的路由路径（与 `src/router.tsx` 具体路由段级匹配，catch-all 白名单见脚本内 `KNOWN_CATCH_ALL_PATHS`）、元素标签选择器（如 `fluent-textarea`、`h1`）。
  - **软校验（仅警告）**：CSS class 选择器（UnoCSS 动态拼 class，静态判定不可靠）、`clickReliable`/`clickButtonByText` 的关键文本。

### 手动运行

```bash
# 仓库根目录
node packages/app/scripts/check-e2e-anchors.mjs
```

### 绕过方式

确认为误报时可用 `git push --no-verify` 绕过，但应随后手动跑 `pnpm test:agent-browser` 兜底确认。新增“故意访问不存在路由”的测试时，需在脚本的 `KNOWN_CATCH_ALL_PATHS` 白名单中登记并注明原因。
