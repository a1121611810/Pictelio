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
| **单元测试** | `vitest.config.ts`               | `pnpm test`               | 纯逻辑：store、utils、API 参数验证（唯一客户端）                 | 快   |
| **仓库不变量** | `packages/android-host/vitest.config.ts` | `pnpm test:android-host` | WebView 客户端是否已彻底删除的权威判据（10 组不变量 + 19 条阳性对照 + 2 条扫描覆盖断言） | 快 |
| **E2E 测试** | `vitest.agent-browser.config.ts` | ~~`pnpm test:agent-browser`~~ | ~~AI 驱动 E2E~~ **已随客户端删除**                   | —    |
| **全量**     | —                                | `pnpm test:all`           | 所有包单测并行                                                    | —    |

> **命令失效提示**：`pnpm test:agent-browser` 与 `pnpm test:app:all` 依赖 WebView 客户端的
> Vite dev server（端口 5173），随客户端删除**整轮不可用**，无替代实现
> （见 ADR-0203 §后果第 4 条）。本表中标注 WebView-only 的章节同理。
>
> 替代入口：模拟器 E2E 走 `pnpm test:android-host:e2e`（**手动，不进 CI**，ADR-0084），
> JVM / Robolectric 原生单测走 `pnpm test:android-host:unit`（随 CI 跑）。
>
> **模拟器 E2E 是手动发布门，不是唯一防线**：本仓 e2e 不进 CI，且历史上多次出现
> 「单测全绿而真机错」。门禁职责由各片单测与跨端契约门禁承担；E2E 只钉**只有真机能证伪**
> 的链路。当前用例：
> - `delivery-probe-cold-start.spec.ts`（#942）：触达探测「强杀 App → 点通知 → 落通知中心」。
>   已知失效面写在 spec 文件头（点通知依赖固定坐标、依赖权限已授予、强杀必须用 `am kill`
>   而非 `am force-stop`），失败时截图落 `tests/android-e2e/evidence/`。
>
> **断言方式的物理边界**：模拟器 E2E 的交互靠 adb tap/swipe 驱动、内容断言走**截图像素比对**（区域帧差分），因为 Lynx 4.0.1 的 `LynxView` 无障碍树不暴露 view/text 节点，且 `uiautomator dump` 在参考 AVD 上被 SIGKILL。由此不可结构化断言的面——触达尺寸、圆角、对比度、状态层 alpha——是 E2E 的覆盖面上限，不是遗漏。

### app-lynx 侧的单测与 E2E

| 层级         | 位置                                | 命令                    | 说明                                                     |
| ------------ | ----------------------------------- | ----------------------- | -------------------------------------------------------- |
| **单元测试** | `packages/app-lynx/tests/unit/**`   | `pnpm test:app-lynx`    | Vitest，随 CI `test:all` 执行                            |
| **差分基准** | `packages/app-lynx/tests/differential/**` | 同上              | 原「双端差分」，webview 侧删除后退化为 **Lynx 单端行为基准**（见下方警告） |
| **原生单测** | `packages/app-lynx/android/**`（随宿主迁移至 `packages/android-host`） | CI `android-unit-test` job | Robolectric / JVM |

> **单文件 / 子集怎么跑**：`pnpm test:app-lynx` 是复合命令
> （`vitest run && vitest run --config vitest.fallback.config.ts`），位置参数只会被后半段吃到、
> 报「No test files found」假错。单文件正确姿势：
> `cd packages/app-lynx && pnpm exec vitest run <路径模式>`（#1015 retro 实证）。
> 全量仍以 `pnpm test:app-lynx` 为准（两段都要绿）。

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

### 取证通道：benchnav 深链**不保证动画时序**（登记于 2026-10-05，#908）

`adb … --es benchNav <scenario>` 是模拟器取证的主通道（放映 FAB 环项在合成点击下 hit-test 失效）。
但它走的是**冷挂载**路径，与真实导航的**patch 插入**路径不是同一条渲染时序，
两者在**入场动画**上会给出**不一致**的画面。

**实测反例**（#908，emulator-5554 / HEAD `c0e7bf0b`）：

| 条件 | 「通知」以下白色卡片占比 |
|------|------------------------|
| HEAD 原样 + benchNav 深链进 Me | **0.171**（整段设置区不可见） |
| 摘掉那 10 处 `:style="listItemStyle(N)"` 后 | **0.53+**（全部渲染） |
| **真实导航**（FAB → 「我的」） | **0.53**（正常） |

⇒ 同一页面，**真实用户看是好的，benchnav 深链看是坏的**。该差异已两次让手动 QA 得出相反结论
（#908 的调查者最初把它当 P0 追查）。

**取用规则**：
1. **不要**把「benchnav 深链下某段内容不可见」当成产品缺陷，**先**用真实导航复核一遍。
2. 复核方法是走 `__BENCH_NAV__` 之外的路径（FAB 环项 / 返回键 / 系统返回），
   或临时摘掉该节点的入场动画再截一次。
3. 若真实导航下**也**不可见，那才是产品缺陷，按常规流程追。
4. 治本修法见 **#913**（装饰性动画不得让内容消失，形态无关，跨 10 个 `listItemStyle` 消费方页面；
   实测口径与页面清单见 `docs/specs/fail-safe-aux-mechanisms.md` 的 D1）。
   本节只是**登记取证通道的已知偏差**，不是豁免理由。

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
   - **告警计数按模块前缀过滤（#1059 轮 3 补充）**：断言「恰好一条 / 零条告警」时，计的必须是**该模块前缀**的告警条数（如按 `[backupWiring]` 前缀过滤 `warn.mock.calls`），**不得**用进程级 `console.warn` 总量。理由：spy 窗口里只要落进任何无关模块的模块级告警（如 `darkMode` 的 matchMedia 兜底告警），全局计数就多一条 ⇒ 断言变成顺序依赖的假红（整文件跑时那条告警恰好发生在更早的用例里被静默消耗，`--sequence.shuffle` 下则间歇性变红）。同时，断言文案应当与契约逐字一致（「恰好一条 `[backupWiring]` 告警」/「零条 `[backupWiring]` 告警」），别让「一条告警」在文案上等于「进程里一条告警」。
   - **适用边界（#1059 轮 5 澄清）**：本条针对「断言**本模块**发了几条告警」。**纯函数层的「一个都不许发」零告警断言**（被测函数同步、窗口内无他模块参与，如 `backupCore.test.ts` 的 `planRestore` 零告警用例）断言的是**进程级零告警**——那种窗口里无关模块告警不可能混入 ⇒ 仍可断言进程级零告警，不受本条约束。
   - **防线先例**：`packages/app-lynx/tests/unit/stores/novelTranslateStore.test.ts` 的 `describe.each` 时序档（正常 + 「provider 前 I/O 慢 250ms」恶意档）——恶意档常驻运行，把上述写法变成确定性红灯，而不是等 CI 偶发。诊断与复现方法见 `docs/research/flaky-novel-translate-store-diagnosis.md`。
   - **无 store 状态可等时（#993 补充）**：若被观测事实不是 store 状态，而是**监听器计数**（事件总线 `count(event)`）或**原生桥回调**（`translateStream` / `abortStream` / `translatePoll` 的 mock 回调），不要退回复制 store 用例的等法——改为**延迟注入原生桥 mock 本身**的同形时序档（与 `novelTranslateStore` 的 `slowCacheMiss` 同族但注入点不同），再用 `vi.waitFor(() => expect(emitter.count(...)))` 等该事实。同时：① `finally` 里的收尾必须含**摘监听器 + 拉干在飞桥调用**（只恢复被删的全局量不算收尾）；② 「确实落定」这类负向/时序事实要用可观测标记（settle 标记 + `vi.waitFor`）断言，不能拿 `loadingMore()` 之类已被其它路径复位的字段当判据。
   - **墙钟断言不可替代行为断言**：「取消/结束在 N ms 内返回」这类 `Date.now()` 差值断言测的是机器速度，负载一大必假红。用假时钟驱动窗口（`vi.useFakeTimers()` + `advanceTimersByTimeAsync`），断言「零时钟推进即落定」等速度无关事实。
   - **存量**：本条为新增禁令，仓内仍有未清存量（例如 #758 收口范围外的固定墙钟等待，见 #761 清单）；新增/改动用例一律按本条执行，存量按清单排期。

   **`mockResolvedValueOnce` 存量登记（#996 收口，2026-10-17 实测）**：仓内共 **25 处可执行调用 / 8 个文件**仍是「按调用序号一次性分发」（grep 命中 26，另 1 处在 `novelTranslateStore.test.ts:256` 的注释里，不计）。#996 只改了 `useSearch.test.ts`、`watchlistFeed.test.ts`、`notificationStore.test.ts` 三个文件。**关键澄清：本条第三 bullet 的「按标识分发」只针对「同一 target 排多个值、顺序即语义」的情形**；每个 target 每用例只排一个值的单发替身没有分发顺序可言，不受本条约束。按这个标准逐个核对，剩余 25 处分两类：

   - **顺序即被测语义，不可改**（5 处）：`createMixFeed.test.ts:1084-1085`（同一 target 上链式两次，首屏空、次屏有内容 = 分页）、`createWatchlistToggle.test.ts:74`（先失败后成功 = 重试阶梯）、`rateLimitBackoff.test.ts:153`（先 429 后成功 = 退避阶梯）、`useComments.test.ts:292`（首次返回 1 条、其后走 `mockResolvedValue` 默认 = 在途 `loadMore` 的对照）。
   - **单发替身，无顺序可混淆**（20 处）：`novelTranslateStore.test.ts` 15 处（`nativeProbeEndpoint` 9 + `nativeGetEndpoint` 2 + `nativeSetApiKey` / `nativeClearEndpoint` / `cacheClear` / `cacheGet` 各 1，逐用例各排一个）、`translationCacheFilesystemBranch.test.ts` 3 处（三个独立用例各排一个）、`useNovelWatchlistToggle.test.ts` 1、`useApiQuery.test.ts` 1。

   计数口径是**可执行调用点**（`grep -c` 排除注释行），故 5 + 20 = 25 与总数对齐；早先写成 4 + 21 少列了 `createMixFeed` 链式的第二行，已订正。

   ⚠️ **登记不等于放行**：第二类虽然没有当下的顺序混淆，但「一次性替身」本身仍让断言指向性偏弱（失败时看不出是哪个标识）。改动这些文件时按第一 bullet「等条件，不等时间」的方向升级，不要把本表当成永久豁免。`novelTranslateStore.test.ts` 另有门禁冻结线（仓内最大测试文件），本轮明确不加内容。

   ⚠️ **`watchlistFeed.test.ts` 的 7 处只是「归因加固」，不是验证过的红绿转换**：实施时未能构造出能让旧写法漏网的突变（真实缺陷归属到别处，旧写法在该用例里同样正确）。它改善的是断言指向性（失败时能指名是哪个标识），**不是**证明了旧写法会漏网。别把它当成已验证的迁移。

7. **源码不得含 U+FFFD（编码腐化防线）**〔本详版新增条目：AGENTS.md「测试硬约束」摘要尚未收录；本文件与摘要的编号存在既有偏移，引用时以条文内容为准〕：**生产源码与 `docs/**` 中不得出现 U+FFFD（Unicode 替换字符）**，机器防线是 `packages/app-lynx/tests/mojibakeGuard.test.ts`。

   - **为什么单列一条**：U+FFFD 是「此处原本有个字符但解码失败」的标记，而它本身是**合法 UTF-8 序列**——编译器、`vue-tsc`、类型检查、构建、单测**全部照常通过**。这个缺陷类别**不产生任何既有信号**，实测出现过「`vue-tsc` 干净 + 3360 个测试全绿 + 构建成功」而源文件注释已被腐化的情况（批量正则编辑把 `src/pages/IllustDetail.vue` 的「切换沉浸」写成 `切<U+FFFD><U+FFFD>沉浸`）。⇒ 「查不到 ⇒ 不存在」的推断在这里必然成立且永远成立，必须自己长门禁。
   - **报法要求**：按「行号 + 该行原文」点名，**不得只报「某文件有 N 处」**。U+FFFD 在编辑器里常渲染成空心方框甚至不可见，只报文件名会逼人全文搜索且极易漏掉。
   - **豁免须显式登记**：白名单按「路径 + 条数 + 理由 + 原文」四元组登记，死登记（路径已不存在）与总量上限均有棘轮——否则豁免机制本身会变成盲区。

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
- **env 文件兜底**：android-e2e 通过 globalSetup 自动读取 `packages/app-lynx/.env`（`packages/android-host/tests/android-e2e/globalSetup.ts`）注入 `process.env`——`process.env` 已有值时不覆盖（bash export 优先，`.env` 兜底）。该 `.env` 被 `.gitignore` 忽略。
  ⚠️ agent-browser 套件已随 WebView 客户端删除（ADR-0203 决策 2），其 `tests/ai-shared/globalSetup.ts` 不复存在；E2E 契约单测迁到 `packages/android-host/tests/android-e2e/unit/`
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
