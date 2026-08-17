# 测试约定

## 分层

| 层级         | 配置                             | 命令                      | 用途                                | 速度 |
| ------------ | -------------------------------- | ------------------------- | ----------------------------------- | ---- |
| **单元测试** | `vitest.config.ts`               | `pnpm test`               | 纯逻辑：store、utils、API 参数验证  | 快   |
| **E2E 测试** | `vitest.agent-browser.config.ts` | `pnpm test:agent-browser` | AI 驱动 E2E：用户流、页面渲染、交互 | 慢   |
| **全量**     | —                                | `pnpm test:app:all`       | app 单测 + agent-browser E2E（所有包单测并行用 `pnpm test:all`） | —    |

## 核心规则

### 文件命名

| 前缀        | 存放目录               | 说明                                                    |
| ----------- | ---------------------- | ------------------------------------------------------- |
| `*.test.ts` | `tests/unit/`          | 纯逻辑测试，`vitest.config.ts` 匹配                     |
| `*.test.ts` | `tests/agent-browser/` | AI 驱动 E2E 测试，`vitest.agent-browser.config.ts` 匹配 |

### E2E 测试模式

每个 E2E 测试步骤遵循：操作（click/fill/scroll）→ `aiAssert` → `expect` 模式。

```typescript
const state = await getState(driver);
const result = await aiAssert("推荐 Feed 展示插画卡片瀑布流", state);
expect(result.passed, result.reason).toBe(true);
```

`aiAssert` 将页面 accessibility tree + innerText 发给 DeepSeek Flash 做语义化判断，失败自动重试 2 次。

### 精确 DOM 属性检查

需要精确检查 CSS class、计算样式、DOM 属性时，使用 `driver.evaluate()` 或 `driver.getAttribute()`/`driver.getComputedStyle()`：

```typescript
const pressed = await driver.getAttribute('[aria-label="浅色"]', "aria-pressed");
expect(pressed).toBe("true");
```

### 何时使用 E2E

- 用户登录流
- Feed 加载、滚动、Tab 切换
- 作品/小说详情页渲染
- 收藏、关注等用户操作
- 设置页功能
- 页面导航和路由

### 何时使用单元测试

- Store 状态管理逻辑
- API 参数拼接和响应处理
- 工具函数
- 纯数据转换

### 强制约束（违反视为架构违规，与 AGENTS.md「测试硬约束」一致）

1. **IO 边界测试强制覆盖**：任何从外部数据源读取数据的函数（fetch/HTTP、Preferences、原生桥、JSON 解析）必须同时具备成功路径与失败/降级路径的单元测试。禁止只测纯函数而不测 IO 边界。
2. **契约测试必须使用真实样例**：跨文件/跨端数据契约的测试 mock 必须来自真实数据源（线上文件、插件源码常量、真实响应快照），禁止手写"与实现自洽"的 mock 字段（实现错了 mock 也会全绿）。参考 `tests/unit/utils/backupRulesConsistency.test.ts` 模式。
3. **禁止静默降级**：所有降级兜底路径（`?? ""`、`?? null`、catch 后返回默认值）必须输出 `console.warn`（带模块前缀）或显式暴露错误状态。
4. **重构行为不变约束**：重构中涉及字段名、常量、默认值改动时，必须检查对应契约测试是否存在（缺失则补上），并在 commit message 标注行为变化点。

### E2E 状态构造基建（driver）

依赖外部状态（如更新弹窗需要远端版本更高）的路径，通过页面级注入构造状态，不依赖真实网络：

- `driver.mockFetch(urlContains, responseJson)` — 拦截页面 fetch 中 URL 包含指定片段的请求，返回固定 JSON（其他请求透传）
- `driver.spyOnWindowOpen()` / `driver.getWindowOpenCalls()` — 拦截 `window.open` 记录调用 URL，断言跳转是否真实发生
- 注入时机：必须在目标页面导航完成后注入（页面导航会清空注入的 JS）
- 注意：`driver.evaluate` 直接执行 JS（agent-browser CLI 不支持多行参数，注入脚本必须为单行；CLI 输出为 JSON 编码，取回结果需 `JSON.parse`）
- 参考用例：`tests/agent-browser/specs/update-flow.test.ts`（更新弹窗 + 前往下载跳转）

### 登录态 E2E

设置页等受登录守卫保护（`src/routes/__root.tsx` 启动导航强制 `/home`）的路径：

- 需要 `PIXIV_REFRESH_TOKEN` 环境变量（`~/.zshrc` 已配置；CI 需配置 secret），无 token 时测试自动跳过（`describe.skipIf`）
- **env 文件兜底**：agent-browser 与 android-e2e 均通过 globalSetup 自动读取 `packages/app/.env`（`tests/ai-shared/globalSetup.ts` 的 `loadEnvFile()` / `tests/android-e2e/globalSetup.ts`）注入 `process.env`——`process.env` 已有值时不覆盖（bash export 优先，`.env` 兜底）。两个 `.env`（app 与 app-lynx）均被 `.gitignore` 忽略
- 直接 `navigate` 子路由会被启动导航覆盖，必须走 UI 路径（如 `/home` 顶部用户名 → `/me` → "设置"行 → `/settings`）
