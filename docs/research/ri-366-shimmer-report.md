# FT-3 tab 切换 shimmer 冻结治理报告（#366 / 地图 #361）

- 分支 `fix/ri-366-shimmer`（= main + FT-2 分支合并 + 本票改动）；日期 2026-09-05
- 设备 emulator-5554（pictelio_ui，Android 14，WebView 113），webview flavor debug APK 4.32.0
- 关联：体检报告场景 4（`research/real-interaction-audit` 分支）；本票证据 `ri-366-evidence/`

## 结论（TL;DR）

体检 P3 的「shimmer 冻结 1.3-1.5s」经三阶段排查重新定性：**不是动画被主线程掐断，而是骨架在数据仍在加载时被提前卸载**（loading 信号失真）→ 内容区出现数秒**位级空白窗** → 内容带图整体弹出。修复 = 工厂 `loading` 首载粘滞语义 + SkeletonShimmer transform 化（合成器驱动，健壮性加固）。修复后首访切换全程有可见反馈（骨架持续到数据到达），空白窗消灭。

## 排查过程（三个假设依次证伪/证实）

1. **假设 A（体检原始定性）：主线程长任务掐断动画** — 证伪。CDP Tracing 抓切换窗口（`ri-366-evidence/trace_follow.trace.json`）：渲染主线程 6.4s 内 busy 仅 **2%**（106ms），最大单任务 33.6ms，无长任务。
2. **假设 B：「冻结」为 VFR diff 阈值伪影为主** — 部分证实。骨架 shimmer 的降采样 diff 实测在 **0.0-0.2 浮动**，骑在判据阈值（<0.1）上；且拼接图第三帧实为「骨架消失后的半渲染/空白态」而非冻结的骨架。阈值判据对低对比度动画不可靠（方法论教训：低对比度动效不能用灰度均值 diff 判「冻结」）。
3. **假设 C（真因）：loading 信号提前翻 false → 骨架提前卸载 → 空白窗** — 证实。位级证据链：
   - 修复前首访关注切换 screencap 轮询（`follow1/`）：骨架可见（s03-s04，渐变相位在动）→ **s05-s21 位级静止**（其中 s15 目检 = 内容区完全空白，无任何卡片，仅标题栏 + [2] 徽标）→ s22 图片大弹出（diff 59.5）。
   - FeedList 骨架条件 `loading() && items().length===0`：空白 = `loading()` 中途翻 false 且 items 仍空 → `empty?.() ?? null`。
   - 根因面：follow 为 **merge 双源**（public+private）+ 骨架期数据到达由命令式 `queryClient.ensureInfiniteQueryData` 驱动，观察者 `isFetching` 信号在该组合下于 fetch 进行中失真翻 false。

## 修复（2 个代码 commit）

| commit | 内容 |
|---|---|
| `2ebd5f73` | **SkeletonShimmer transform 化**：background-position（paint 属性，主线程驱动）→ `fluent-shimmer-sweep` transform 扫光层（合成器线程驱动，base.css 既有 keyframes），主线程任何长任务/抖动期间动画照常流动；视觉观感不变，`data-testid` 契约保留 |
| `51795ebf` | **工厂 loading 首载粘滞**：`loading = isFetching ∥ (已激活 && status=pending && 无错误)`——骨架持续到数据真正到达（含合法空 feed 转 null 空态）或错误态接管；消灭空白窗。对全部使用工厂的 store 生效（含首页推荐/关注/收藏插画与小说面板） |

配套测试 `createTQFeedStore.loading.test.ts`（3 例）：粘滞核心回归（activate 无数据即 loading=true，不随 isFetching 抖动）/ 数据到达转 false / 出错让位错误态；另 lazy 未激活不误报。

## 验证（screencap 轮询逐帧，first-visit 未缓存口径）

修复前（`follow1/`，merged-but-unfixed）：s05-s21 **连续 17 个位级静止样本（~4s+ 空白窗）** → s22 内容大弹出。
修复后（`follow2/`，+loading 粘滞 + transform shimmer）：s03 切换骨架即现 → **全程连续变化**（shimmer 动画 + 渐进加载），最长静止间隙 2-3 个采样（~0.7-1s，为渐进图片解码间隙），无空白窗；s15 目检 = 骨架在屏、动画在走。

已缓存路径（关注/收藏二次切换）：<600ms 全内容直现，不受影响。

## 局限与诚实声明

- 内容就绪绝对时长首访 ~5-9s，为**网络支配**（当日代理抖动，与 FT-2 报告一致）；本票治理的是「等待期的视觉反馈连续性」，不承诺网络耗时。
- 体检判据「shimmer 冻结段 = 连续 diff<0.1 且 >500ms」对低对比度动画不可靠——回归脚本（FT-5）的 skeleton 阶段判定应改用「骨架元素存在性 + 无空白帧」（DOM 探测或帧间卡片区域存在性）。
- screenrecord 在本模拟器上 force-stop 后出现编码器静默失效（3232 字节空文件，杀进程可复），本轮后半改用 screencap 轮询（审计同款兜底）。
- 环境事故记录：中断的代理曾用 full flavor（双引擎，launcher `.MainActivity`）覆盖安装 webview flavor（`.MainActivityWebview`），已重装恢复；flavor 判定必须看 launcher activity 而非 versionName。
