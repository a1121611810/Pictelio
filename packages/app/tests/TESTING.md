# 测试约定

## 分层

| 层级         | 配置                             | 命令                      | 用途                                | 速度 |
| ------------ | -------------------------------- | ------------------------- | ----------------------------------- | ---- |
| **单元测试** | `vitest.config.ts`               | `pnpm test`               | 纯逻辑：store、utils、API 参数验证  | 快   |
| **E2E 测试** | `vitest.agent-browser.config.ts` | `pnpm test:agent-browser` | AI 驱动 E2E：用户流、页面渲染、交互 | 慢   |
| **全量**     | —                                | `pnpm test:all`           | 单元 + E2E 全部测试                 | —    |

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
