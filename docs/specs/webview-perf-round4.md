# Spec：webview 性能四轮 —— A「prefetch 命中跳过 thumb」+ B「switch 压线专项诊断」

> 前置：三轮报告 `docs/research/webview-perf-round3-report.md`（B1 证伪 + B2 定性）。本轮两个候选并行推进。
> 研究输入：/tmp/research-prefetch-skip-thumb.md（A 线 file:line 设计）、/tmp/research-switch-jank-diagnosis.md（B 线诊断方案）。

## A 线：prefetch 命中卡跳过 thumb（渐进滚动代价回收）

### 背景与问题重述

三轮 B1 证伪：thumb 卸载未回收首页滚动 +1.4pp（2.95%→4.35%→4.59%，illust-waterfall jankRate 手势均值）。根因 = 渐进模式滚动中每卡 thumb+full 两次加载。

研究修正了前提：**候选大部分已实现**——`createProgressiveImage.ts:82-88` 已有 L1 命中直挂 full 路径；`loadImage` 完成必写 L1（imageLoader.ts:273 native / :287 web），预取与展示共享 inflight Promise（:236-248 去重）。**真正缺口是预取在途窗口**：卡片进场时预取未完成（首页每页仅前 12 张被预取且 FeedList 非虚拟化全量立即挂载，FeedList.tsx:26,77-90），`checkImageCache` miss → 无条件渐进 → thumb 从网络加载。

### 设计（定死参数）

**Oracle 选型**：新增导出 `isImagePrefetching(url)`（imageLoader.ts，读 `inflightRequests` Map，:204）。与既有 L1 查询构成三态互斥、无观察缝隙：

| 状态 | 判定 | 行为 |
|---|---|---|
| L1 已有（预取已完成） | `checkImageCache(full)` 命中 | 现有直挂 full 路径（:82-88），不动 |
| inflight 在途 | `isImagePrefetching(full)` true | **跳过 thumb**，`setDisplaySrc("")` 保持预载门控直候 full |
| 皆无（未启动/已失败） | 两者皆 false | 现状渐进（thumb 先行），行为与今天逐字节一致 |

**改动文件**（~30 行生产代码，其余一律不动）：

1. `packages/app/src/utils/imageLoader.ts`：`loadImage`（:249）后新增导出 `isImagePrefetching`（+14 行，含互补语义 doc 注释）。
2. `packages/app/src/primitives/createProgressiveImage.ts`：
   - import（:2）；头注状态机插入 2.5 条目（:4-22）；
   - 渐进分支 :97-99 改为 `if (isImagePrefetching(full)) setThumbSrc(undefined) else setThumbSrc(resolveImageUrl(thumb))`（保留 `setDisplaySrc("")` 预载门控）；
   - catch :106-111 追加：在途预取失败且尚未挂 thumb → 延迟挂 thumb + `console.warn`（禁止静默降级）；
   - `onDisplayError` :135-143 追加同兜底 else-if 分支；`failed` 双失败语义（:146）不变。

**红线**：
- 主层仍等预载 resolve 才挂载（避免拦截器 loadBytes 与 prefetchImage 跨写方并发下载，round3 遗留 #4）；
- `packages/app-lynx` 零文件改动；Java 零改动（112 用例回归即可）；
- oracle 未命中时首屏行为与现状完全一致（不劣化）。

**明确不动**：ImageCard/GridCard（次级 Feed blur-up 单段）、VirtualFeed/FeedList/HomePage、LazyImageCard/everVisible、LazyDetailImage、PixivImage 文件本体、Java 全部。

### URL 一致性依据（已验证）

预取 key 与展示 key 逐字符一致：`loadImage(large 原始 URL)` → 磁盘文件名 Base64URL(原始 URL)（PixivApiPlugin.java:145）；展示 `<img src=/pixiv-img/...>` → rewriteUrl 精确还原（PixivImageLoader.java:66-81）→ cachedFile 同 key 命中。目录三方同值 `pictelio-images`。首页 prefetchUrl=`large??medium` 与 IllustSingleCard fullUrl 逐字一致（HomePage.tsx:295-296 注释锁定）。图床开启时预取短路（FeedList.tsx:82）不破坏一致性。

### 测试（扩展现有文件，无新增空套件）

- `tests/unit/primitives/createProgressiveImage.test.ts`：mock 工厂（:17-21）+ beforeEach（:71-75）补 `isImagePrefetching`；8 个新用例：在途跳 thumb 直候 full / 在途 resolve 全程无 thumb / 在途失败延迟 thumb+warn / 主层 onError 延迟 thumb / 延迟 thumb 再失败 failed=true / 不在途现状回归锁 / L1 优先于在途 / generation 重置。oracle 来源：本 spec 状态机表 + round3 报告 §1-B1 候选条文（规格先于实现）；fixture 沿用文件内真实 CDN URL 形态。
- `tests/unit/utils/imageLoader.test.ts`：`isImagePrefetching` 在途 true→resolve false（成功路径）、失败后 false（失败路径，按 Web 语义断言 L1）。
- `tests/unit/utils/imageLoader.native.test.ts`：native 桥在途/完成双态 + checkImageCache 命中（oracle：loadImageInner native 分支 + PixivApiPlugin.java:129-189 真实桥契约）。
- 门禁：`pnpm test:app` + `pnpm check` + `pnpm lint` 全绿。

### Bench（同口径复测）

- 场景：`node scripts/bench-scroll.mjs run --engine webview --scenario illust-waterfall --groups 3 --per 10`（n=30），模拟器 pictelio_ui（emulator-5554）。
- 指标：`jankRateMean`（bench-scroll.mjs:714）+ totalP50ofP50/P90ofP50 + unknownDelayP90。
- **ABBA 配对**（A1基线→B1改造→B2改造→A2基线）抵消漂移（历史漂移 4.3pp/轮）；基线 APK = main HEAD 全新构建（非 09:04 旧包，其早于收口 commit 不可确证一致）；改造 APK 含 `isImagePrefetching` 特征串 grep 验证进包。
- 判定：相对 main 基线回落 ≥0.5pp 且 P99 不升 → 采纳；无回落 → 如实证伪（残余代价来自无预取覆盖卡，下一杠杆是预取扩容/虚拟化，超出本候选范围）。

### 风险清单

在途跳过 → 可见卡 blank 窗口（可见卡预取按列表序最先入 OkHttp 队列先完成；失败即时延迟 thumb 兜底）｜L1 命中但磁盘文件被淘汰 → 拦截器下载首帧慢不破图（既有同类行为）｜预取+延迟 thumb 双失败 → failed=true 失败 UI 无永久空｜NovelCoverCard 联动：novel 预取键 ≠ 其 full → isImagePrefetching false 行为不变。

## B 线：switch 压线专项诊断（B2 前提修正）

### 研究结论：B2 定性存在三处误读（已主会话核验两处）

1. **「每帧压线」是采样误读**：round3-{baseline,after} 36/36 条 switch 记录 `frames=1`（1800ms 窗口仅渲染 1 帧）——jank% 粒度 0/1，p99=p50=单帧值，「每帧超 1-2ms」实为「每窗口唯一一帧超线」。已核验：JSONL 全量 frames=1 属实。
2. **PageTransition 是空壳、无过渡动画**（PageTransition.tsx:6-16，动画已移除）——「过渡动画×骨架渲染」的动画成分不存在。已核验：源码属实。
3. **forward 窗口系统性丢弃 click 后前 ~350-550ms**（bench sampleFrames 内部二次 reset 缺陷）——forward 首帧成本从未被测到；back 窗口完整覆盖。

真实问题 = 两个单帧超线：**back（home 全量 remount 帧，14-27ms）** 与 **forward（疑似详情首图 paint 帧，16-18ms）**。back 单帧超出量连续分布 0.3-10.2ms，非 1-2ms 压线。

### 假设表

| # | 假设 | 先验 | 判据 |
|---|---|---|---|
| H1 | 采样伪影+误读；真实=两个单帧 | 高 | E1 修窗口后帧数仍 1-3 帧/切换 |
| H2 | 单帧成本以图片 decode/raster 为主（SwiftShader 放大） | 中高 | E3 档 C 单帧跌破 16.67；E4 DecodeImage/Raster 占比 |
| H3 | WebView 合成路径使 gfxinfo 低估帧数 | 中 | E2 rAF≈100 而 gfxinfo=1 |
| H4 | 窗口内有持续动画，frames=1 是解析丢失 | 低 | E0 原始 dump 行数 ≫1 |
| H5 | Solid mount 突发散布逐帧税 | 很低 | E1 后出现密集 16-18ms 帧群 |

### 实验计划（零构建优先，现有安装包即可）

- **E0 方法学标定**：bench 跑 switch 期间另抓 `dumpsys gfxinfo framestats` 原始行，核对 PROFILEDATA 行数 vs `Total frames rendered`、列映射（c[11] 当 interval 存疑）。
- **E2 页面内 rAF + longtask**（最关键）：CDP 注入 rAF 计数器 + PerformanceObserver(longtask)，每组 click 后读回。rAF≈100 而 gfxinfo=1 → H3；longtask 直接给出单帧成本真身。
- **E3 CSS kill 三档**：全动画禁 / 仅 shimmer 禁 / `img{display:none}`，各 10 组。C 档大降 → H2。
- **E4 CDP Tracing**：`Tracing.start("devtools.timeline,...")` 覆盖一次 click→1.5s，perfetto 归因单帧构成。
- **E1 修采样窗口**（bench 脚本修复，后续工作）：删 sampleFrames 内二次 reset 对齐 back；summarize 输出 frameCount + 每帧数组；复跑验证 H1。

### 交付

诊断报告（docs/research/webview-perf-round4-switch-diagnosis.md）+ 原始数据（webview-perf-bench-data/round4-switch-e*）+ bench 脚本修复 + B2 结论修正记录（含「模拟器结论，不可直接外推真机」黑体标注）。修复方向预判（back: home keep-alive/窗口化；forward: 首图 medium→large 阶梯）仅立项建议，不在本轮实施。

## 流程

研究（已完成，×2 并行）→ 本 spec → **实施并行**（A 线实施子代理：packages/app/src×2 + tests×3；B 线实验子代理：模拟器零构建实验 + bench 脚本修复；文件集零重叠）→ A 线 code-review 闭环（仓库级 `.agents/skills/code-review/SKILL.md` 双轴）→ A 线 ABBA 复测 → 报告 + issue 收口 + 合并。
