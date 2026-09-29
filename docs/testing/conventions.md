# 测试约定（仓库级）

> **提升说明**：本文档自 `packages/app/tests/TESTING.md` **逐字提升**为仓库级文档。
> 原文件随 WebView 客户端源码删除（[ADR-0203](../../adr/ADR-0203-webview-client-source-removal.md)）。
> 提升日期：2026-09-29。
>
> **搬运纪律**：正文未改写。「6 条硬约束」段落**原样保留**，编号与措辞均不动。
> 仅两类改动：①只服务 WebView 客户端的章节标注为 **WebView-only**；
> ②分层表与命令表补上 app-lynx 侧对应项（原表只列 webview 包内命令）。
>
> `AGENTS.md`「测试硬约束」是本文档的**摘要**，本文档是**详版与准绳**；两者编号存在既有偏移
> （本文档 #5 = 摘要 #6），**引用时以条文内容为准**。

## 分层

| 层级         | 配置                             | 命令                      | 用途                                                             | 速度 |
| ------------ | -------------------------------- | ------------------------- | ---------------------------------------------------------------- | ---- |
| **单元测试** | `vitest.config.ts`               | `pnpm test`               | 纯逻辑：store、utils、API 参数验证                               | 快   |
| **E2E 测试** | `vitest.agent-browser.config.ts` | `pnpm test:agent-browser` | AI 驱动 E2E：用户流、页面渲染、交互                              | 慢   |
| **全量**     | —                                | `pnpm test:app:all`       | app 单测 + agent-browser E2E（所有包单测并行用 `pnpm test:all`） | —    |

> **命令失效提示**：`pnpm test:agent-browser` 与 `pnpm test:app:all` 依赖 WebView 客户端的
> Vite dev server（端口 5173），随客户端删除**整轮不可用**，无替代实现
> （见 ADR-0203 §后果第 4 条）。本表中标注 WebView-only 的章节同理。

### app-lynx 侧的单测与 E2E

| 层级         | 位置                                | 命令                    | 说明                                                     |
| ------------ | ----------------------------------- | ----------------------- | -------------------------------------------------------- |
| **单元测试** | `packages/app-lynx/tests/unit/**`   | `pnpm test:app-lynx`    | Vitest，随 CI `test:all` 执行                            |
| **差分基准** | `packages/app-lynx/tests/differential/**` | 同上              | 原「双端差分」，webview 侧删除后退化为 **Lynx 单端行为基准**（见下方警告） |
| **原生单测** | `packages/app-lynx/android/**`（随宿主迁移至 `packages/android-host`） | CI `android-unit-test` job | Robolectric / JVM |

> ⚠️ **差分测试语义退化**（ADR-0203 §决策 5）：`packages/app/tests/unit/differential/`
> 的文件多数断言「webview 与 Lynx 逐字一致」。删除一侧后**不得**表述为「差分测试继续覆盖两端」——
> 差分的对侧消失，语义不复存在。迁移后的合法形态只有两种：
> `X ↔ webview 一致` ⇒ `X ↔ Java/spec 契约`（有对侧）或 `X 单端行为基准`（无对侧）。

## 核心规则

### 文件命名

|  前缀           |  存放目录                       |  说明                                                                                                                                                                                                                                          |
| ------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  `*.test.ts`  |  `tests/unit/`              |  纯逻辑测试，`vitest.config.ts` 匹配                                                                                                                                                                                                                 |
|  `*.test.ts`  |  `tests/android-e2e/unit/`  |  android-e2e **契约工具的纯函数单测**（不碰 adb / 模拟器，issue #523）。#818 起已并入 `vitest.config.ts` 的 include，故随 `pnpm test` → `test:all` → CI 执行；⚠️ 它同时被 `test:android:e2e` 收进去——**若这批测试在跑 e2e 时处于红态，那一轮 e2e 的结论即失真**（红的是 unit 用例、不是设备行为），故跑长时 e2e 前先把代码推到终态  |
|  `*.test.ts`  |  `tests/agent-browser/`     |  AI 驱动 E2E 测试，`vitest.agent-browser.config.ts` 匹配 — **WebView-only**（依赖 Vite 5173 dev server，随客户端删除不可用） |

### E2E 测试模式 — **WebView-only**

> 以下两节服务 agent-browser E2E（Vite 5173 dev server 驱动），随 WebView 客户端删除**整轮不可用**。
> 保留原文供追溯与将来重建参考，**不构成当前可执行路径**。

每个 E2E 测试步骤遵循：操作（click/fill/scroll）→ `aiAssert` → `expect` 模式。

```typescript
const state = await getState(driver);
const result = await aiAssert("推荐 Feed 展示插画卡片瀑布流", state);
expect(result.passed, result.reason).toBe(true);
```

`aiAssert` 将页面 accessibility tree + innerText 发给 DeepSeek Flash 做语义化判断，失败自动重试 2 次。

### 精确 DOM 属性检查 — **WebView-only**

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

### 强制约束（违反视为架构违规；AGENTS.md「测试硬约束」为摘要，本节为详版与准绳）

1. **IO 边界测试强制覆盖**：任何从外部数据源读取数据的函数（fetch/HTTP、Preferences、原生桥、JSON 解析）必须同时具备成功路径与失败/降级路径的单元测试。禁止只测纯函数而不测 IO 边界。
2. **契约测试必须使用真实样例**：跨文件/跨端数据契约的测试 mock 必须来自真实数据源（线上文件、插件源码常量、真实响应快照），禁止手写"与实现自洽"的 mock 字段（实现错了 mock 也会全绿）。参考 `tests/unit/utils/backupRulesConsistency.test.ts` 模式。
3. **禁止静默降级**：所有降级兜底路径（`?? ""`、`?? null`、catch 后返回默认值）必须输出 `console.warn`（带模块前缀）或显式暴露错误状态。
4. **重构行为不变约束**：重构中涉及字段名、常量、默认值改动时，必须检查对应契约测试是否存在（缺失则补上），并在 commit message 标注行为变化点。
5. **期望值出处可追溯（oracle 溯源，对应 AGENTS.md 硬约束 #6）**：测试断言的期望值必须能指向独立来源——规格/验收样例、真实数据/字面量、独立实现（差分测试）、性质/不变量；禁止从被测实现反推、自洽 mock 推导或同义反复重算。建议在测试文件头注释注明期望值来源。执行机制：仓库级 `.agents/skills/code-review/SKILL.md` 在 code-review 的 Spec 轴强制 Oracle check 与 Test strength（依据 `docs/research/ai-generated-test-quality.md`）。

6. **异步测试确定性（时序 flaky 防线，app 与 app-lynx 两包适用）**〔本详版新增条目：AGENTS.md「测试硬约束」摘要尚未收录；且本文件与摘要的编号存在既有偏移（本文件 #5 = 摘要 #6），引用时以条文内容为准〕：单测禁止用固定墙钟等待做同步——`await new Promise((r) => setTimeout(r, N))` 这类「睡一觉再断言」在负载下必然被击穿（真实 I/O 先于断言发生的时间不可预测，CI runner 的过订阅量级尤甚）。三条硬要求：
   - **等条件，不等时间**：用 `vi.waitFor(() => expect(...))` 等被观测事实发生（仓内范式：`notificationStore.test.ts`、`settingsStore.test.ts`）。负向断言（「不得写入 / 不得调用」）必须挂在**确定发生的事件**之后（例如消费方再次索取下一帧、状态已收敛），否则断言的实际是「还没轮到」。
   - **失败路径必须收尾**：涉及 in-flight 异步的用例用 `try/finally` 结束挂起迭代器、`await` 在飞 promise。断言失败即泄漏的 invocation 会在**下一个用例**的窗口里继续跑，制造与被测代码无关的失败——这是跨用例污染型 flaky 的通用成因，也是「失败信息与真实缺陷对不上」的常见来源。
   - **计数断言按标识映射**：并发 mock 的分发按业务标识（如 chapterId）而非调用序号。序号映射（「第 1 次给 A、其余给 B」）会把多余的第 N 次调用静默派给最后一个分支，使「多调一次」只表现为计数差、难以归因。
   - **防线先例**：`packages/app-lynx/tests/unit/stores/novelTranslateStore.test.ts` 的 `describe.each` 时序档（正常 + 「provider 前 I/O 慢 250ms」恶意档）——恶意档常驻运行，把上述写法变成确定性红灯，而不是等 CI 偶发。诊断与复现方法见 `docs/research/flaky-novel-translate-store-diagnosis.md`。
   - **存量**：本条为新增禁令，仓内仍有未清存量（例如 #758 收口范围外的固定墙钟等待，见 #761 清单）；新增/改动用例一律按本条执行，存量按清单排期。

### E2E 状态构造基建（driver）— **WebView-only**

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

## 本文档的删除影响登记

WebView 客户端删除后，下列内容随源码消失，**引用它们的位置需要另行处理**：

| 内容 | 现状 | 处置 |
| --- | --- | --- |
| `tests/unit/**`（220 个，其中 173 依赖 `src/`） | 随包删除 | 行为基准迁到 app-lynx（ADR-0203 §决策 5，**须改写语义**） |
| `tests/agent-browser/**`（16 个 / 12 spec） | 整轮不可用 | 无替代实现（ADR-0203 §后果第 4 条） |
| `tests/android-e2e/**`（37 个） | **不删**，随宿主迁移至 `packages/android-host` | 纯函数单测继续随 CI 跑 |
| 68 个以 `docs/specs/**` / `docs/adr/**` 为 oracle 的单测 | 随源码删除而消失 | 知识（文档）不丢，但「spec 漂移」将无人发现（ADR-0203 §后果第 3 条） |
| `packages/app/tests/unit/agentsMd.contract.test.ts` | oracle 随包消失 | 须迁到宿主包并**改写**：去掉 `Capacitor 8.5` 版本号断言，保留体积门禁 |

## 参考

- [ADR-0203](../../adr/ADR-0203-webview-client-source-removal.md)（删除决策与后果）
- `AGENTS.md`「测试硬约束」（本文档的摘要版）
- `docs/research/ai-generated-test-quality.md`（oracle 溯源依据）
- `docs/research/flaky-novel-translate-store-diagnosis.md`（硬约束 #6 的诊断案例）
- 领域知识搬运：[`webview-client-knowledge-migration.md`](./webview-client-knowledge-migration.md)
