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
