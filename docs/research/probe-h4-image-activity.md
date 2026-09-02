# PROBE H4：列表滚动图片活动 × jank 证据（#318 候选①）

> 日期：2026-09-02（晚）
> 载体：throwaway 分支 `prototype/scroll-probe-h4`（基于 main；bench 工具从 `bench/scroll-t0-306` 复制，均不进 main）
> 设备：OPPO R11s（serial 69d1caa6，Android 9，1080×2160）；app-lynx 插画瀑布流（illust-waterfall 推荐 feed）
> 采集：`bench-scroll.mjs run --serial 69d1caa6 --engine lynx --scenario illust-waterfall --groups 3 --per 10`（30 手势，3 组 ×10，组间物理回顶）+ logcat 全量（JS `[PROBE_H4]` 流 + 原生 `PROBE_H4` 打点）
> 插桩：IllustList `@scroll`+rAF 帧间隙 / CoverImage bind/load / `PictelioImageService` fetch-start·cache-hit·img(fetchMs/decodeMs/inflight)
> 判据：Q2 拍板「A 双轨」——轨 1 重叠率 ≥50%，或（轨 2 ≥2× 且轨 3 ≥2pp）→ 现象成立

## 数据概览

| 指标 | 值 |
|---|---|
| rAF 帧流 | 6219 条（中位间隔 17ms ≈ 60Hz ✅），jank 阈值 25.5ms，jankRate **9.97%** |
| @scroll | 2163 条 |
| CoverImage bind / load | 249 / 67 |
| 原生 fetch-start / img / cache-hit | 77 / 77 / **0** |
| **引擎请求率** | bind→fetch = **31%**（249 绑定中仅 77 次实际请求） |
| 图片活动窗口（fetch+decode） | 77 窗，均值 1739ms/张 |
| fetch / decode 耗时 | fetch 均值 **1730ms**；decode 均值 **8.8ms**（轻） |
| 并发峰值 | maxInflight = **9** |

**时间线（10s 桶）**：全部 77 次 fetch/img 集中在会话前 ~60s；**回顶重滚（g1/g2，60s 起）引擎 0 次再请求**（引擎持有位图复用，不回到 img service）。分组 gfxinfo jank：**g0 = 9.24%（冷）→ g1 = 1.55% / g2 = 1.75%（热，-7.5~7.7pp）**（剔除 frames≤1 脏记录后：g0 n=9、g1 n=8、g2 n=8）。

## 三轨结果

| 轨 | 判据 | 实测 | 结论 |
|---|---|---|---|
| 轨 1 帧重叠率 | ≥50% | **29.7%**（±50ms 放宽 31.3%） | ❌ 不成立 |
| 轨 2 快甩段请求 ≥2× | ≥2× | 高速段 2 fetch / 77；常速段 75 | ❌ 不成立（反方向） |
| 轨 3 内存冷热 ≥2pp | ≥2pp | cacheHit=0 → 口径不可测；bench 分组冷热差 **7.5-7.7pp** | ⚠️ 替代信号（见下） |
| 补充：引擎门控 | — | 31% 请求率 + 重滚零请求 | ✅ 新事实（见下） |

**轨 1/2 说明**：图片请求几乎全部发生在非高速段（引擎 lazy 门控在 cell 进入加载窗口时才请求，而非甩动峰值那一刻）；帧级 rAF jank 与图片窗口**未出现**判别所需的正相关（29.7% < 50%）。warm 段 rAF jank 计数高于 gfxinfo（rAF=JS 线程、gfxinfo=渲染线程，两域不同），帧级结论按「未发现正相关」表述。

**轨 3 说明**：内存缓存 64MB LRU 在一轮 77 张解码后即淘汰（cacheHit=0——LRU 过小本身是发现）；g1/g2 的 7.5pp 改善发生在**磁盘缓存**热态，且 g0（冷）期间混杂 loadMore 分页/首轮 feed 构建/引擎 warm-up，不能干净归因于图片。

## 判定（per 判据 A）

**H4（「快速甩动时批量图片下载/解码与 MT 帧预算竞争」）证伪**：帧级三轨无一成立（轨 1 <50%，轨 2 反方向，轨 3 设计口径不可测），组级冷热差混杂不可归因。→ **速度感知图片降载正式从 #318 划掉**（用户 Q1-A 预授权路径：不成立即收口）。

## 沉淀的新事实（观察项，不立项）

1. **引擎 lazy 门控有效**：249 次 image 绑定 → 仅 31% 变成实际引擎请求；同内容回顶重滚**零再请求**（引擎位图复用）。「请求风暴」在引擎层已被抑制。
2. **重的是吞吐不是帧预算**：fetch 均值 1.73s、峰值 9 并发（慢网大图批量下载是吞吐问题）；decode 均值仅 8.8ms（2048 采样已很轻）。
3. **内存 LRU 偏小**：64MB < 一轮 feed 解码总量（约 154MB，按 ~2MB/张估算），同内容二滚不命中——若未来做缓存治理，这是候选点。
4. **帧级对齐形态**：图片活动窗口 × jank 帧重叠率 29.7%，且请求集中在高速段之后（lazy 窗口触发机制）——「按滚动速度延迟请求」与引擎现有行为（其在速度回落时本来就会请求）无差。

## 原材料

- logcat：`/tmp/probe-h4-logcat-raw.txt`（6.3MB，本机临时，未入仓）
- bench：`/tmp/probe-h4-bench/lynx_illust-waterfall.jsonl`
- 分析脚本：`packages/app/scripts/analyze-probe-h4.mjs`（本分支）
- 分析 JSON：`/tmp/probe-h4-analysis.json`
