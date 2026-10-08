# Lynx SDK 升级评估（vue-lynx 0.5.1 / 引擎 4.0.1 → 最新）

> 评估日期：2026-09-01。对应 issue #307（父地图 #304「Lynx 滚动跟手性追平 webview」）。
> 方法：全部一手来源——npm registry（版本与时间戳）、GitHub API（releases / CHANGELOG / issues / 提交历史 / 源码逐字）、Maven Central（Android 构件元数据）；本仓事实来自 ADR-0110 / ADR-0115 / ADR-0123 / `docs/research/vue-lynx-masonry-feasibility.md` / `docs/research/vue-lynx-swiper-tutorial.md` / `packages/app-lynx/package.json` / `packages/app/android/app/build.gradle` / `pnpm-lock.yaml`。

## 结论速览

**不升——不是「不值得升」，而是「无版可升」。**

跟手性相关的两条主链上游均停在「本仓已用版本即最新 stable」：

- **vue-lynx**：npm `latest` = `0.5.1`（2026-07-17），与本仓 `^0.5.1` 相同；registry 上的 `1.0.0` 是 2025-03-10 发布的空占位包（tarball 仅含一个 `package.json`，无运行时代码）。main 分支最新提交 2026-08-17，未发版。
- **Lynx Android SDK（`org.lynxsdk.lynx:*`）**：最新 stable = `4.0.1`（2026-07-31），与本仓 gradle 锁定相同；`4.1.0` 仅有 2026-06 的 nightly 构建（**早于 4.0.1 发布日**，实质更旧且为 nightly 质量，不能作为升级目标）；3.9.1（2026-08-25）是 3.x 分支补丁，不在 4.x 升级路径上。

四项跟手性平台事实（cell 回收 no-op、`<list>` 无 per-frame scroll 事件、main-thread script 原生不可用、pointer-events 触摸不生效）在上游最新可得版本中**全部原封不动**（逐项证据见 §2）。工具链侧仅有两个与跟手性无关的可选项：rspeedy 0.13.6→0.14.5（无 breaking）与 web-core 0.23.1→0.25.0（无 breaking，仅影响 web 预览）。

**建议 = 不升 + 挂上游跟踪**；重估触发条件见 §4.3。

## 1. 版本矩阵现状（2026-09-01）

| 组件 | 本仓锁定 | 上游最新 stable | 差距 | 来源 |
|---|---|---|---|---|
| `vue-lynx` | `^0.5.1`（lock 0.5.1） | `0.5.1`（2026-07-17，npm `latest`） | **无**（`1.0.0` 为空占位） | [npm](https://www.npmjs.com/package/vue-lynx)、[CHANGELOG](https://github.com/Huxpro/vue-lynx/blob/main/packages/vue-lynx/CHANGELOG.md) |
| `org.lynxsdk.lynx:lynx` 等 5 个 Android 构件 | `4.0.1` | `4.0.1`（2026-07-31） | **无** | [GitHub Releases](https://github.com/lynx-family/lynx/releases)、[Maven Central](https://repo1.maven.org/maven2/org/lynxsdk/lynx/lynx/maven-metadata.xml) |
| `@lynx-js/rspeedy` | `^0.13.6`（lock 0.13.6） | `0.16.5`（2026-08-21） | 可升但被 vue-lynx peer 卡死在 ≤0.14.5（见 §3.1） | [npm](https://www.npmjs.com/package/@lynx-js/rspeedy)、[CHANGELOG](https://github.com/lynx-family/lynx-stack/blob/main/packages/rspeedy/core/CHANGELOG.md) |
| `@lynx-js/web-core` | `^0.23.1`（lock 0.23.1） | `0.25.0`（2026-08-21） | 可升、无 breaking，仅影响 web 预览 | [npm](https://www.npmjs.com/package/@lynx-js/web-core)、[CHANGELOG](https://github.com/lynx-family/lynx-stack/blob/main/packages/web-platform/web-core/CHANGELOG.md) |
| `@lynx-js/tailwind-preset` | `^0.5.0` | `0.5.1`（2026-08-07） | patch 可升 | [npm](https://www.npmjs.com/package/@lynx-js/tailwind-preset) |
| `@rsbuild/plugin-vue` | `^1.2.6` | `2.0.1`（2026-07-05） | 2.x 需 Rsbuild v2，与 vue-lynx peer 冲突（见 §3.1） | [npm](https://www.npmjs.com/package/@rsbuild/plugin-vue) |

## 2. 上游修复核查（逐项）

### 2.1 list cell 回收（vue-lynx #302）——❌ 未修，无任何进展

- issue [Huxpro/vue-lynx#302](https://github.com/Huxpro/vue-lynx/issues/302)（「list: framework-side cell recycling (enqueueComponent / recycle pool)」，2026-07-20 由 cursor bot 创建）：截至 2026-09-01 仍 **OPEN、0 评论、无关联 PR**。
- 源码实证：vue-lynx main 分支（HEAD 2026-08-17）`packages/vue-lynx/main-thread/src/list-apply.ts` 第 156–158 行仍是 `/** No-op: element recycling tracked in #302. */ function enqueueComponentNoop(): void {}`（经 GitHub API 逐字读取）。
- 0.5.1 之后的 main 分支提交（2026-07-17 → 2026-08-17，共约 25 个）无一触及回收：`fix(runtime)` CSS scope 清理、IFR hydration fallback 修复（#358）、touch-fx 示例、website 文档等，均与 list 回收无关（提交清单经 GitHub commits API 逐条核对）。
- **对本仓含义**：超长 Feed 的 MT 元素树不回收问题没有任何上游缓解；`vue-lynx-masonry-feasibility.md` 的「5k 可用 / 10k+ 风险 / 50k 崩溃」结论继续有效。

### 2.2 `<list>` per-frame scroll 事件（ADR-0110）——❌ 平台事实未变

- ADR-0110 实证（2026-08-24，4.0.1）：`@scroll` / `@scrollend` / `@scrollstatechange` + `scroll-event-throttle="100"` 四路全测 JS 端零派发。
- 引擎侧 Android `ListEventManager` 的 scroll 事件门控（`events.containsKey(LynxListEvent.EVENT_SCROLL)` → `SCROLL_EVENT_ON` bitmask，默认 throttle 200ms）自 **2025-03-04 初始提交以来未变**（经 `git log` 该文件仅 1 个提交）；develop 分支与 4.0.1 tag 的 `UIList.java` / `ListEventManager.java` 相关代码逐行一致（仅行号偏移）。
- 上游无任何新 stable/nightly 产物含此变更（§1：4.0.1 即最新）。
- **补充判读**（本次新增）：引擎门控机制本身存在（`bindscroll` 注册进 events map 即开闸），ADR-0110 的零派发更可能是 **vue-lynx 事件注册路径对 `<list>` scroll 事件的缺口**而非引擎裁剪——同机制下 `scrolltolower` 边界事件在本仓工作正常。但框架侧也无新版可修此缺口。
- **对本仓含义**：ADR-0110 的「常驻回顶按钮」决策继续成立；无滚动位置信号源。

### 2.3 main-thread script（ADR-0115）——❌ 原生不可用结论未变

- ADR-0115 T5 真机实证（2026-08-30，原生 4.0.1 + vue-lynx 0.5.1）：`main-thread-*` 绑定导致组件整块空白，移除即恢复。
- vue-lynx 无新 release（§1）；main 分支 0.5.1 后无 MTS-native 修复提交（提交清单逐条核对）。
- 相关上游 issue：[Huxpro/vue-lynx#314](https://github.com/Huxpro/vue-lynx/issues/314)（`<script main>` SFC 块特性请求）仍 OPEN，说明 MTS 语法/能力面仍在演进且未完成；[#357](https://github.com/Huxpro/vue-lynx/issues/357)（`<list>` ownership × IFR hydration × MT handler `__FlushElementTree` self-check）仍 OPEN。
- web-core 0.24.1 修复了「MT event handler 内 `__FlushElementTree()` 触发 wasm-bindgen recursive-borrow」（[#3438](https://github.com/lynx-family/lynx-stack/pull/3438)）——**仅改善 Web 端 MTS**，与原生 LynxView 无关。
- **对本仓含义**：推荐轮播（ADR-0115）只能继续走后台线程触摸；「若后续 Lynx 主线程支持度提升可再评估切回」的前提未出现。

### 2.4 pointer-events 触摸命中（ADR-0123）——❌ 未修

- ADR-0123 实证（2026-08-30，4.0.1）：原生 LynxView hit-testing 不识别 `pointer-events`，全屏透明层吞掉全部点击。
- lynx 主仓仅存的 pointer-events 相关 issue [lynx-family/lynx#8529](https://github.com/lynx-family/lynx/issues/8529)（「[WPT] pointer-events: auto has an empty computed value」）仍 OPEN——该属性连 computed value 都未完整实现。
- develop 分支（4.0.1 后）无 Android pointer-events / hit-testing 修复提交（经 commits API 按路径与关键词检索，2026-07-31 → 2026-09-01 的触摸相关提交仅 Clay/Windows 与 Harmony 平台）。
- **对本仓含义**：ADR-0123 固化的「全屏元素必须是交互面 / `pointer-events: none` 不是合法穿透手段」约束继续成立。

### 2.5 触摸链路 / 滚动延迟优化——⚠️ develop 有动作，但无任何可用产物

- lynx 主仓 develop 分支 4.0.1 之后与滚动/触摸相关的提交（经 commits API 全量检索）：
  - `37d4f10c`（2026-07-31）「[BugFix][Android] Fix ancestor pan interception in scroll containers」——scroll-view / list / list-container 的祖先 pan 拦截状态传播修复；经 `compare` API 确认**不在 4.0.1 中**（diverged，4.0.1 不含该提交）。
  - `ce80febc`（2026-08-12）「[Optimize][Android] Improve nested scrolling for list containers」。
  - `c80affd2`（2026-08-14）「[Optimize][Android] Unify list item snapping by default using ScrollSnapHelper」。
  - `a0fbffae`（2026-08-20）「[Optimize][Android] Move scroll helpers to shared utils package」（重构）。
- 上述提交**均不在任何 stable 或 nightly 产物中**——4.1.0 nightly 构建日期为 2026-06-19 ~ 06-29（Maven Central 元数据），早于全部这些提交。
- 已知跟手性上游 issue：[lynx-family/lynx#194](https://github.com/lynx-family/lynx/issues/194)（「[Performance]: Jank Frame between list scrolling」，Android）仍 OPEN；官方合作者回复将拖拽/惯性起步大帧归因于「cell 填充渲染耗时 + 文本排版」，建议业务侧用 `text-overflow: ellipsis` 替代 `inline-truncation`，**无引擎侧修复落地**。
- **对本仓含义**：上游在嵌套滚动/pan 拦截方向有活跃工作，方向与本仓「触摸响应延迟」痛点吻合，但距离可用（4.1.0 stable）尚无时间表；本仓列表未用嵌套滚动容器，这几个修复的直接收益有限。

## 3. 升级成本评估

### 3.1 rspeedy 0.13.6 → 0.16.5：被 vue-lynx peer 卡死在 ≤0.14.5

**硬性约束**（版本矩阵死结）：vue-lynx 0.5.1 的 peerDependencies 为 `"@rsbuild/core": "^1.0.0"` 与 `"@rsbuild/plugin-vue": "^1.2.6"`（[vue-lynx package.json](https://github.com/Huxpro/vue-lynx/blob/main/packages/vue-lynx/package.json)）。rspeedy 版本线：

- `0.14.x`：Rsbuild v1.7.4 / Rspack v1.7.10（[CHANGELOG](https://github.com/lynx-family/lynx-stack/blob/main/packages/rspeedy/core/CHANGELOG.md) 0.14.0 节）——**与 vue-lynx peer 兼容，是无冲突升级的天花板**。
- `0.15.0`：**BREAKING** —— 工具链整体升到 `@rsbuild/core 2.0.11` / Rspack v2（PR [#2603](https://github.com/lynx-family/lynx-stack/pull/2603)，含 `performance.chunkSplit` → `splitChunks`、`source.alias` → `resolve.alias` 配置迁移）——**直接违反 vue-lynx 的 `@rsbuild/core ^1.0.0` peer**，不可行。
- `0.16.x`：Rsbuild v2.1.x，同死结。

即：只要 vue-lynx 停在 0.5.1，rspeedy 最多升到 **0.14.5**。该区间（0.13.6 → 0.14.5）无 breaking，内容为：SWC target 自定义配置尊重（#2654）、`Minify.mainThreadOptions/backgroundOptions`（#2336）、CSS sourcemap 选项、dev host IPv4 优选、qrcode entry API。**全部为构建期/dev 体验改善，与运行时滚动跟手性零相关。**

### 3.2 web-core 0.23.1 → 0.25.0：无 breaking，但只影响 web 预览

- 0.24.0：新增 `__AddEventListener`/`__RemoveEventListener` Element PAPI、`lynx.getEngine()`、XML markup card 编译（[#3388](https://github.com/lynx-family/lynx-stack/pull/3388)、[#3389](https://github.com/lynx-family/lynx-stack/pull/3389)、[#3402](https://github.com/lynx-family/lynx-stack/pull/3402)）。
- 0.24.1：MT handler 内 `__FlushElementTree` 修复（#3438，web 端 MTS）、`__GetAttributeNames` PAPI。
- 0.25.0：`lynx.createIntersectionObserver`、浏览器内 markup card 加载（[#3383](https://github.com/lynx-family/lynx-stack/pull/3383)、[#3404](https://github.com/lynx-family/lynx-stack/pull/3404)）；tarball 增大 ~397KB（新增 markup chunk + encode wasm，均为 lazy）。
- 无 breaking 条目。但本仓 web-core 仅用于 **web 预览/开发**（生产跑原生 LynxView），升级收益 = web 预览保真度提升（IntersectionObserver、MTS 修复），对原生滚动跟手性零贡献。

### 3.3 Android LynxView 依赖升级面：无 stable 目标

- 本仓 `packages/app/android/app/build.gradle` 锁定 5 个构件 `lynx` / `lynx-service-http` / `lynx-service-log` / `xelement` / `xelement-input` = `4.0.1`（lynxImplementation + fullImplementation 两处）。
- Maven Central 全部 5 构件的最新 stable 均为 `4.0.1`；之上只有 `4.1.0-nightly.2026-06-*`（构建早于 4.0.1 发布，质量与内容均不可作为升级目标）。
- 若未来 4.1.0 stable 发布，升级面预估：5 构件版本号齐刷刷替换 + `LynxActivity`/`PictelioImageService`/`PictelioApi` 等自研桥接点的 API 兼容性回归（4.0.0→4.0.1 无破坏的先例不代表 4.1 大版本安全），另需重跑 android-e2e 回归门（引擎切换往返、lynx-boot-renders 等 6 个 spec）。

### 3.4 其他

- `@lynx-js/tailwind-preset` 0.5.0 → 0.5.1：patch，可随时升，无感知。
- `@rsbuild/plugin-vue` 1.2.6 → 2.0.1：2.x 面向 Rsbuild v2，与 §3.1 同一死结，冻结在 1.x。

## 4. 结论建议

### 4.1 判定：**不升**

1. **跟手性主线无版可升**：vue-lynx 与 Lynx Android SDK 的最新 stable 就是本仓在用版本；四项平台事实（§2.1–2.4）在上游最新可得代码中原封不动。升级无法消解任何一个已知 blocker。
2. **可升的组件与目标无关**：rspeedy ≤0.14.5、web-core 0.25.0、tailwind-preset 0.5.1 的增量全部落在构建链与 web 预览，不触原生滚动链路；而 rspeedy/plugin-vue 的 further 升级被 vue-lynx peer 死结挡住。
3. **nightly 不构成选项**：4.1.0-nightly 构建日期早于 4.0.1 stable，且嵌套滚动修复（§2.5）连 nightly 都未包含。

### 4.2 可选的低成本动作（与跟手性无关，独立决策）

- `rspeedy ^0.13.6 → ^0.14.5`：无 breaking，dev 体验小幅改善；若做需重跑 `pnpm build:app-lynx` + web 预览冒烟 + 模拟器冷启动冒烟。
- `@lynx-js/web-core ^0.23.1 → ^0.25.0`：web 预览保真（IntersectionObserver、MTS 修复）；注意 tarball +397KB lazy chunk 对 dev 无感。
- `@lynx-js/tailwind-preset ^0.5.0 → ^0.5.1`：patch。
- 以上三者可作为一次独立的「工具链养护」改动，**不捆绑**跟手性目标。

### 4.3 重估触发条件（上游跟踪点）

满足任一即重开本评估：

1. **vue-lynx 发布 > 0.5.1**，且 changelog 含 #302（framework-side cell 回收）或 MTS-native 修复 → 直接命中本仓两个最大 blocker。
2. **Lynx 发布 4.1.0 stable**（或更高），含 2026-08 的 Android 嵌套滚动 / pan 拦截修复（§2.5）→ 命中触摸链路。
3. **lynx-family/lynx#194**（Android list 滚动 jank）关闭并随版本发布。
4. **lynx-family/lynx#8529**（pointer-events）修复落地 → 可解除 ADR-0123 的覆盖层约束。
5. vue-lynx peer 放宽到 `@rsbuild/core ^2`（即 vue-lynx 适配 Rsbuild v2）→ 解开 rspeedy/plugin-vue 升级死结。

跟踪方式建议：在 wayfinder 地图 #304 登记为「引擎死结兜底 = 跟踪上游」（与 2026-09-01 用户拍板的兜底策略一致），上述 5 个跟踪点写入地图 Notes；两场景根因诊断（#308）与降级方案照常推进，不等待上游。

## 附录：信息来源（一手索引，全部可核验）

- npm registry：`vue-lynx`（`latest=0.5.1`，`1.0.0` 发布时间 2025-03-10 且 tarball 仅含 package.json——本次实拉验证）；`@lynx-js/rspeedy`（`0.16.5`，2026-08-21）；`@lynx-js/web-core`（`0.25.0`，2026-08-21）；`@lynx-js/tailwind-preset`（`0.5.1`）；`@rsbuild/plugin-vue`（`2.0.1`）
- GitHub Huxpro/vue-lynx：[CHANGELOG](https://github.com/Huxpro/vue-lynx/blob/main/packages/vue-lynx/CHANGELOG.md)（HEAD = 0.5.1）、[issue #302](https://github.com/Huxpro/vue-lynx/issues/302)、[#314](https://github.com/Huxpro/vue-lynx/issues/314)、[#357](https://github.com/Huxpro/vue-lynx/issues/357)、[list-apply.ts（main）](https://github.com/Huxpro/vue-lynx/blob/main/packages/vue-lynx/main-thread/src/list-apply.ts)、[package.json peerDeps](https://github.com/Huxpro/vue-lynx/blob/main/packages/vue-lynx/package.json)、main 分支提交清单（2026-07-17 → 2026-08-17，commits API）
- GitHub lynx-family/lynx：[Releases](https://github.com/lynx-family/lynx/releases)（4.0.1 为 Latest stable，2026-07-31；3.9.1 为 3.x 补丁）、[issue #194](https://github.com/lynx-family/lynx/issues/194)、[issue #8529](https://github.com/lynx-family/lynx/issues/8529)、develop 分支 `ListEventManager.java`（git log 仅 2025-03-04 初始提交）与 `UIList.java`（4.0.1 vs develop 逐行比对）、develop 提交 37d4f10c / ce80febc / c80affd2 / a0fbffae（compare API 确认 37d4f10c 不在 4.0.1 中）
- GitHub lynx-family/lynx-stack：[rspeedy CHANGELOG](https://github.com/lynx-family/lynx-stack/blob/main/packages/rspeedy/core/CHANGELOG.md)（0.15.0 BREAKING = Rsbuild v2 / PR #2603；0.14.0 = Rsbuild 1.7.4）、[web-core CHANGELOG](https://github.com/lynx-family/lynx-stack/blob/main/packages/web-platform/web-core/CHANGELOG.md)（0.24.0/0.24.1/0.25.0 节）
- Maven Central：[org.lynxsdk.lynx:lynx](https://repo1.maven.org/maven2/org/lynxsdk/lynx/lynx/maven-metadata.xml) 及 lynx-service-http / lynx-service-log / xelement / xelement-input 元数据（最新 stable 均 4.0.1；4.1.0 仅 2026-06 nightly）
- 本仓：`packages/app-lynx/package.json`、`packages/app-lynx/lynx.config.ts`、`packages/app/android/app/build.gradle`（L236–262）、`pnpm-lock.yaml`（rspeedy 0.13.6 / web-core 0.23.1 / @rsbuild/core 1.7.3 实解）、`docs/adr/ADR-0110-lynx-back-to-top-persistent.md`、`docs/adr/ADR-0115-app-lynx-recommended-carousel.md`、`docs/adr/ADR-0123-app-lynx-fab-hit-testing-fix.md`、`docs/research/vue-lynx-masonry-feasibility.md`、`docs/research/vue-lynx-swiper-tutorial.md`
