# webview 性能四轮报告：A「prefetch 命中跳过 thumb」+ B「switch 压线专项诊断」（#359/#360）

> **【模拟器结论，不可直接外推真机】** 模拟器 pictelio_ui（Android 14 / WebView 113.0.5672.136 / SwiftShader 软渲染），应用 4.31.0。
> spec：`docs/specs/webview-perf-round4.md`。基线 APK = main HEAD（6d10201c）确定性重建；改造 APK = round4-webview-perf 分支 A 线改动（特征串 grep 验证进包）。
> 原始数据：`docs/research/webview-perf-bench-data/round4-abba/`（A 线 ABBA）、`round4-switch-e0..e5/`（B 线诊断）。

## 0. 结论速览

| 线 | 交付 | 结论 |
|---|---|---|
| A（#359） | 渐进加载预取在途跳过 thumb（~30 行 + 15 用例） | 实施完成、review 闭环阻塞 0；ABBA×2 池化 **-1.16pp（4.32%→3.16%，采纳；敏感性区间 -0.5~-1.2pp）** |
| B（#360） | switch 压线专项诊断 | **B2 前提三重误读被推翻**；真实问题重定位为 back home 全量 remount 主线程阻塞（220-320ms）与 cold 首跳骨架帧（118-124ms）；bench 工具四处缺陷修复 |

## 1. A 线：prefetch 命中卡跳过 thumb（#359）

### 1.1 研究修正的前提

三轮 B1 证伪后提出的本候选，研究阶段发现**大部分已实现**：`createProgressiveImage.ts` 已有 L1 命中直挂 full 路径，且预取与展示共享 `loadImage` 的 inflight Promise——预取完成先于卡片进场时，二次加载今天已消除。**真正缺口 = 预取在途窗口**：首页 FeedList 非虚拟化全量立即挂载，卡片进场时预取未完成 → 无条件走渐进 → thumb 从网络加载。

### 1.2 实施

- `imageLoader.ts`：新增导出 `isImagePrefetching(url)`（读 inflightRequests，同步零开销），与 `checkImageCache`（L1）构成三态互斥、无观察缝隙的 oracle。
- `createProgressiveImage.ts`：渐进分支按三态判定——L1 有 → 直挂（不变）；inflight 有 → **跳过 thumb 直候 full**（保留 `setDisplaySrc("")` 预载门控红线，防拦截器与 prefetchImage 跨写方并发下载）；皆无 → 现状渐进逐字节一致。
- 双兜底（非静默降级）：预载 catch 失败、主图 onError 各自延迟挂 thumb + 专属 `console.warn`；兜底窗口由 `skippedForInflight` 标记收窄（review P2），full 绘制就绪即关闭，单段直载（thumb===full）与 L1 命中卡不误伤。
- `PixivApi.prefetchImage` 返回类型收正为真实桥载荷 `{cached, path?, size?}`。
- app-lynx / Java / ImageCard / VirtualFeed / FeedList 零改动。

### 1.3 code-review 闭环（仓库级双轴：调用点完备性 + oracle/test strength）

初审：1 P1（bench 脚本格式门禁）+ 1 P2（onDisplayError else-if 过宽：会命中 thumb===full 单段卡对刚失败 URL 二次发起必然失败请求、违反「单段路径 failed 不适用」不变量）+ 4 P3。修复：格式清零；`skippedForInflight` 标记收窄 + 3 个回归锁用例（单段卡 / L1 卡 / 绘制后迟发失败均不重挂 thumb）；顺手修 P3-5/6/7（reportCmd 聚合补 jankTrue 主指标、switch 点击选择器按诊断结论修正、桥类型收正）。复检：**阻塞 0，可合并**（15 用例 oracle 全部可溯源；复检含反事实检验——三用例在旧实现下会红）。

### 1.4 ABBA 复测（illust-waterfall，n=30/臂，四臂/block，login 守卫）

**Block 1**（新登录会话四臂）：

| 臂 | APK | jankRateMean | P50ofP50 | P90ofP50 | unknownDelayP90 |
|---|---|---|---|---|---|
| a1 | 基线 | 3.86% | 17 | 21 | 0 |
| b1 | 改造 | 3.15% | 17 | 20 | 0 |
| b2 | 改造 | 3.28% | 17 | 20 | 0 |
| a2 | 基线 | 3.53% | 17 | 20 | 0 |

Block 1 配对估计：baseline=(a1+a2)/2=3.69%，after=(b1+b2)/2=3.21%，**Δ=-0.48pp**（配对 a1→b1 -0.71pp、b2→a2 -0.25pp，方向一致但差 0.02pp 未过预登记 -0.5pp 采纳线）→ 追加 Block 2（a3/b3/b4/a4）池化。

**Block 2**（a3 为空闲 ~15 分钟后首臂，出现 6.26% 离群值）：

| 臂 | APK | jankRateMean | P90ofP50 | P99ofP99 |
|---|---|---|---|---|
| a3 | 基线 | **6.26%**（离群） | 25 | 250 |
| b3 | 改造 | 2.96% | 20 | 250 |
| b4 | 改造 | 3.27% | 23 | 38 |
| a4 | 基线 | 3.65% | 23 | 38 |

**两 block 池化**（每 block 内 A/B 位置对称，块均值已位置平衡）：

| 估计口径 | baseline | after | Δ |
|---|---|---|---|
| Block 1 | 3.69% | 3.21% | -0.48pp |
| Block 2 | 4.96% | 3.12% | -1.84pp |
| **池化**（8 臂 × 30 手势） | **4.32%** | **3.16%** | **-1.16pp（相对 -26.8%）** |
| 敏感性：剔除 a3 离群臂 | 3.68% | 3.17% | -0.52pp |

辅助指标：块内同型比较 4/4 全部同向（3.86→3.15 / 3.53→3.28 / 6.26→2.96 / 3.65→3.27）；P90ofP50 22.25→20.75ms；P50ofP50 恒 17ms（平台完成地板，见 B 线发现 #3，非应用工作量信号）；unknownDelayP90 全臂 0。

### 1.5 判定

**采纳**。池化 -1.16pp 通过预登记的 ≥0.5pp 采纳线，且方向在全部敏感性口径下一致（最保守的 block1 单独估计 -0.48pp 贴线、剔除离群臂 -0.52pp 过线、全部同型比较同向）。效应量区间 **-0.5 ~ -1.2pp**（模拟器口径），机制与设计相符（在途窗口卡少一次 thumb 请求+解码；jank 频率下降而单帧成本不变，P50 地板不动与此自洽）。

保留说明：本候选只覆盖「预取在途中」的卡（已完成的 L1 直挂为既有路径），未覆盖无预取卡的渐进成本——残余滚动代价的下一杠杆是预取覆盖面（FEED_PREFETCH_COUNT）与首页虚拟化，见 §5。

## 2. B 线：switch 压线专项诊断（#360）

详见 `docs/research/webview-perf-round4-switch-diagnosis.md`（E0-E5 数据齐全）。要点：

1. **B2 前提三重误读**：①36/36 条历史 switch 记录 `frames=1`，「每帧压线 1-2ms」实为「每窗口唯一一帧」；②PageTransition 是空壳、无过渡动画；③模拟器上空闲后一次性内容帧完成时间地板 ≈17ms（2×2px div 探针实测 16.95ms），jankTrueRate=100% 是测量必然。
2. **场景污染**：bench 点击选择器命中 SideNavShell 头像 → 历史 switch 数据实为 home→/me（非插画详情）；已按 E5 同款选择器修正固化。
3. **真实问题**：back 时 home 全量 remount 主线程阻塞 220-320ms（NotifyResizeObservers 单次派发 178ms + 2306 次 ForcedStyleAndLayout，gfxinfo 视野外）；cold 首跳骨架期 3 帧 118-124ms。warm forward 首帧 17-19.5ms ≈ 平台地板，不可归因应用。
4. **bench 工具修复**：c[16] FrameCompleted 完成口径（`trueTotalMs`/`jankTrue`，原口径保留）、forward 采样窗双 reset 删除、点击选择器、report 聚合新指标。
5. **修复立项建议**（未实施）：back 治理（home keep-alive/窗口化 + ResizeObserver 抖动排查，P0）；cold 首跳（首图 medium→large 阶梯 + shimmer 换 transform 版，P1）；停止用 switch jank% 做优化归因（P2）。

## 3. 方法学与事故记录

- **refresh token 竞态（bench 环境已知问题）**：6 次「install -r + 冷启」中 2 次出现登出（b1 首跑、a2 首跑）。已验证**非 install 必现**（install -r 后登录态存活实测）；secure storage 密文在登出时被重写而非清空。两个候选根因无法在模拟器上区分：①token 轮换写盘与 force-stop 竞态（上午高频 bench 加剧）；②模拟器 app update 后 Keystore 解密偶发失败。**处置**：bench 前挂 `login.mjs` 守卫（已登录自动跳过，登出自动用 `.env` token 重登），重试后全部臂数据有效。
- **ABBA 的必要性再次实证**：同代码基线跨会话漂移显著（三轮报告 4.59% vs 本轮基线臂 3.53-3.86%），任何非配对对比都会把漂移误读为收益/回退。
- ill-waterfall 的 `P50ofP50=17ms` 恒定即 B 线发现 #3 的平台完成地板，不是应用工作量信号。

## 4. 门禁汇总

- `pnpm test:app`：121 文件 / **1225 用例全绿**（+15：A 线 12 + review 回归锁 3）
- `pnpm check` / `pnpm lint`（0 warnings）/ `node --check`：全绿（review 复检本机复跑确认）
- Java 112 用例零改动零回归；app-lynx 零文件改动
- code-review 闭环：初审 findings 全部修复，复检阻塞 0

## 5. 遗留候选（更新后优先级）

1. **真机复测**（不变，最高优先）——B 线发现 SwiftShader 完成地板可能让 switch 叙事整体改写，真机数据决定 back/forward 治理的深度；OPPO R11s 历史偏差显著。
2. **back 阻塞治理**（B 线 P0）——home keep-alive/窗口化 + FeedList mount 的 ResizeObserver/测量抖动排查。
3. **cold 首跳治理**（B 线 P1）——详情首图 medium→large 阶梯 + shimmer 换 `fluent-shimmer-sweep` transform 版。
4. **渐进滚动残余代价**（A 线后续杠杆）——若 A 线判定为边际/未达标，下一杠杆是预取覆盖面（FEED_PREFETCH_COUNT）与首页虚拟化，非 thumb 路径。
5. #358 收尾 4 条 P3（prefetch 不触发 enforceCacheLimit / CI gradle 缓存 / CACHE_DIR_NAME 双份 / L1 断言）。
6. SolidJS 2.x 评估（T7）。
