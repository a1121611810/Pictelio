# ADR-0144: SolidJS 1.9 → 2.0（RC）主客户端升级与周边生态同步迁移

- 状态：accepted
- 日期：2026-09-08（用户拍板立项：「把 app 中的 solidjs 升级到 2.0 版本，周边相关库同步升级，完整验收通过，不需要问任何问题」）
- 关联：
  - 调研：`docs/research/solidjs-2-vs-1-analysis.md`（2.0 RC 变更全景）、`docs/research/solidjs-2-migration-impact.md`（本仓影响矩阵与高危点清单）
  - 术语：[glossary-solidjs2-migration](./glossary-solidjs2-migration.md)（本文与 spec/tickets 的唯一术语口径）
  - [ADR-0093](./ADR-0093-*.md)（TanStack Query 采用）/ [ADR-0096](./ADR-0096-*.md)（虚拟滚动迁 TanStack virtual）/ [ADR-0037](./ADR-0037-*.md)（PixivApiPlugin 网关，本次不受影响）

## 背景

solid-js 2.0 处于 RC 阶段（npm `next` = `2.0.0-rc.6`，2026-09-02；API 已冻结），官方明确 RC 语义为「API frozen, bugs still possible」，并请求 1.x 项目现在迁移报问题。1.x（`latest`=1.9.15）仍在维护但为终线。

前期调研（2026-09-08）给出的建议是「等 stable 后再动」；用户决策**现在升级**，本 ADR 记录在此约束下的技术决策。2.0 是响应式内核重写：微任务批处理（set 后读旧值）、effect 拆 compute/apply、`onMount`→`onSettled`、`solid-js/web`/`solid-js/store` 子路径消失、`classList`/`on:`/`use:` 等 JSX 语法移除。本仓影响面：150+ 迁移点（`classList` 65 处、`on:` 62 处/24 文件、createEffect 83 处/34 文件、onMount 49 处/28 文件、set-后-读高置信 15 处、effect 内写 signal 约 51 处/21 文件）。

有利条件：无 SSR、无 createResource/Suspense/Index/produce/createMutable 实际使用（0 处）、数据层走手动 fetch + TanStack Query；生态（router/vite-plugin/primitives/testing-library/solid-query）均有 2.0 适配版。

## 决策

### D1：目标版本矩阵（全部精确锁定，禁 `^` 漂移）

| 包 | 从 | 到 | 说明 |
|---|---|---|---|
| `solid-js` | ^1.9.14 | **2.0.0-rc.6** | 响应式内核 + store（`solid-js/store` 并入根导出） |
| `@solidjs/web` | （无） | **2.0.0-rc.6** | render/Portal/Dynamic/JSX 类型；`jsxImportSource` 切换 |
| `@solidjs/router` | ^1.0.0 | **2.0.0-next.21** | peer 要求 solid rc.5 + @solidjs/web |
| `vite-plugin-solid` ^2.11.14 | → 移除 | **`@solidjs/vite-plugin` 3.0.0-next.39** | 官方后继（OXC 编译器），peer vite ^8 兼容 |
| `@tanstack/solid-query` | ^5.101.4 | **6.0.0-rc.3** | v5 peer 仅 solid 1.x，必须随迁 |
| `@solid-primitives/intersection-observer` | ^2.2.5 | **3.0.0-next.3** | |
| `@solid-primitives/scroll` | ^2.1.6 | **3.0.0-next.4** | |
| `@solid-primitives/scheduled` | ^1.5.3 | **移除** | src 零 import，死依赖 |
| `@solidjs/testing-library` | ^0.8.10 | **1.0.0-beta.3** | 测试基建随迁 |
| `@tanstack/solid-virtual` | ^3.13.36 | **移除**（见 D2） | 无 2.0 适配，阻塞项 |
| `@tanstack/solid-db` | ^0.2.30 | **移除**（见 D2） | 无 2.0 适配，阻塞项 |

其余包（Capacitor、Fluent UI、UnoCSS、vite-plus、app-lynx/ugoira/update-check/website）与 solid-js 无依赖关系，不动。

否决的备选：等 stable（用户否决）；pnpm patch 两个阻塞包（补丁要同时修 4+ 处 API 且 vendor 化后同样要改语义——不如直接收编/替换，少一层补丁维护）。

### D2：两个阻塞依赖的去向

1. **`@tanstack/solid-virtual` → vendor 适配器**：其 solid 绑定仅 69 行，使用 2.0 已删 API（`solid-js/store` 子路径、`onMount`、`createComputed`、`mergeProps`、旧 `reconcile` 签名）。将适配器按 2.0 语义改写后收编为 `src/primitives/` 内部模块，依赖降为框架无关的 `@tanstack/virtual-core`（`Virtualizer` 核心类不受 2.0 影响）。两个消费方（feed 虚拟化、小说虚拟布局）只改导入，不改调用面。
2. **`@tanstack/solid-db` → 本地集合**：消费面仅 `historyStore` 的 localStorage 单 key 持久化（get/insert/update/delete/toArray；toArray 本就非响应式，页面刷新靠 `historyVersion` 信号）。本地实现等价替换，**storageKey（`pictelio-browsing-history`）与条目 JSON 形状不变**，老数据无缝延续；补存储读写失败路径的 IO 边界测试（测试硬约束 #1）。

### D3：语义迁移五条铁律（违反视为迁移缺陷）

1. **set 后立即读**：改局部变量传递（首选）或 `flush()`（仅命令式边界）；禁止盲目加 `flush()` 掩盖。15 处高置信命中逐一处理。
2. **effect 内写 signal（write-under-scope throw）**：拆分效应把写移入 apply 段（合法，untracked）；能改派生（memo / function-form signal）的改派生；内部状态信号才可用 `ownedWrite: true` 且须说明理由。
3. **apply 段读 store 代理**（STRICT_READ_UNTRACKED warn）：compute 段提取普通值传入。
4. **onMount → onSettled**：机械改名后审计「嵌套原语创建」（onSettled 不允许），有则改 `createEffect(..., { defer: true })` 或重构。
5. **`on:` 命名空间 → fluent 事件助手**：62 处 fluent-* 自定义事件经共享 `fluentOn(type, handler)` ref 工厂迁移（数组 ref 兼容既有 ref）；静默失效风险用组件行为测试兜底。

### D4：构建链与工具链

- `tsconfig.json`：`jsxImportSource: "@solidjs/web"`；`solid-js` 的 JSX 类型引用（若有）改 `@solidjs/web`，组件类型用 `Element` from `solid-js`。
- `vite.config.ts` / `vitest.config.ts`：`vite-plugin-solid` → `@solidjs/vite-plugin`；unplugin-auto-import 的 `"solid-js"` preset（含 2.0 已删 API 名）换成**显式 2.0 导出名清单**，重新生成 `auto-imports.d.ts`。
- 测试文件 6 处 `from "solid-js/web"` 的 `render` 改 `@solidjs/web`。

### D5：验收口径（不降级）

- `pnpm check`（tsc strict）、`pnpm lint`、`pnpm fmt:check` 全绿。
- `pnpm test` 全量通过：断言只允许「按 2.0 正确语义修正并注释标注」，**不允许删除/skip/弱化**（no-downgrade）；迁移前为 set-后-读高危点补时序 oracle 测试。
- Web：dev server 页面可达（home/detail/search/novel/settings 冒烟）。
- Android 模拟器：`pnpm build:android` 产物安装后页面可达 + 核心功能可用（feed 浏览/详情/收藏/设置）。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| RC 内在 bug（官方自认） | 版本精确锁定；遇到上游 bug 记录 issue 并以最小 shim 绕行，不改公共语义 |
| `on:` 迁移静默失效（不报错） | fluent 事件助手 + 代表性组件行为测试（switch 开关、dialog 关闭） |
| set-后-读语义反转隐性回归 | 迁移前 oracle 测试锁定；迁移后按 2.0 语义修正并注释 |
| solid-query 6 RC 行为差异 | createTQFeedStore/六 feed store 单测全量跑；异常时不改查询键契约 |
| 51 处 effect 内写 signal 重写引入新 bug | 分模块批次推进，每批以该模块测试绿为门槛；code-review 双轴审计（调用点完备性 + oracle check） |

## 后续

- 2.0 stable 发布后解除 RC 锁定（独立小 PR，仅版本号）。
- OXC 编译器构建提速数据独立测量，不作为本次验收项。
