# 双端滚动跟手性 T0 基线（OPPO R11s 真机，2026-09-02）

> 票：#306（父地图 #304「Lynx 滚动跟手性追平 webview」）
> 方法：T0 层 = `input swipe` 手势驱动 + `dumpsys gfxinfo` 逐手势采集（方法学同模拟器版；真机 Android 9 的 framestats 列语义不稳，改用 gfxinfo 聚合摘要：Janky frames % / 50-99th 分位，见 bench-scroll.mjs parseSummary）
> 原始数据：`docs/research/scroll-baseline-data/oppo-*.jsonl`（30 手势/场景）
> **结论速览：真机 60Hz 预算 16.7ms 下，帧级指标出现与体感方向一致的差距——插画 feed lynx jank 19.3% vs webview 8.7%（2.2×）；小说正文 11.6% vs 3.3%（3.5×）；但 P50 帧时长同为 10–11ms（预算内），差距集中在**长尾/脉冲**段（R18 式突发卡顿，对应根因 H1/H3 的渐进劣化与翻页脉冲），而非稳态帧成本。小说列表（webview=搜索页作对照，内容不同构）反向：lynx 8.2% 优于 webview 20.9%（webview 搜索页滚动中加载开销，见 §3 caveats）。「慢半拍」触及时延仍属 T1 测量域，但真机数据已能区分「谁更卡」，T1 专注「多慢一拍」。**

---

## 1. 环境

| 项 | 值 |
| --- | --- |
| 设备 | OPPO R11s（Android 9 / SDK 28 / 1080×2160 / **60Hz**，density 480，3 键导航条） |
| WebView | 138.0.7204.179（≥85 门槛通过） |
| 应用 | debug 风味：`app-lynx-debug.apk` / `app-webview-debug.apk`（同 applicationId，`install -r` 覆盖保留登录态） |
| 数据源 | 真实账号实时数据（与模拟器同一 token） |
| 采样 | 每场景 3 组 × 10 手势（drag 600ms / fling 180ms 交替）；组间物理回顶 |
| 指标 | 手势级 = 手势窗口内 Janky 帧占比 + P50/P90/P99 帧时长（gfxinfo 摘要，legacy 判定） |
| 导航 | lynx 经 benchNav intent 深链（`--es benchNav`，真机 FAB 环项 input tap 失效的绕过，见 bench 分支 `4ae5a4b`）；webview 经 CDP SPA 导航 |

## 2. 结果（30 手势/场景）

| 场景 | jank 率 lynx / webview | P50 lynx / webview | P90 lynx / webview | P99 |
| --- | --- | --- | --- | --- |
| 插画 feed | **19.3% / 8.7%** | 11 / 11ms | 13 / 14ms | 62 / 61ms |
| 小说 feed* | 8.2% / **20.9%** | 11 / 14ms | 13 / 15ms | 61 / 63ms |
| 小说正文 | **11.6% / 3.3%** | 10 / 11ms | 13 / 11ms | 61 / 61ms |

\* 内容不同构：lynx=推荐小说 feed（`<list>` single）；webview=搜索「少女」结果页（虚拟化列表）。webview 侧高 jank 与搜索页滚动中图片/更多结果加载相关，与模拟器同场景（17.3ms/3.2%）差异显著，需单独复核（可能为搜索页该日数据加载行为，非稳态结论）。

## 3. 发现

1. **帧级差距在真机显现，方向与体感一致**（插画 feed 2.2×、小说正文 3.5×）。模拟器 30Hz 软件渲染确实遮蔽了差异（帧预算 33ms 占不满）——真机 60Hz 预算 16.7ms，暴露 lynx 的更重帧负载。
2. **差距在长尾而非稳态**：P50 双端同（10–11ms，均在预算内）；lynx 的 jank 来自挥手势的高载帧（插画单样本 jank 62%/P50 20ms——翻页脉冲；可见「随时间/深度越来越卡」的 H1 迹象）与部分 fling（惯性段连帧高耗时）。P99 双端都 61ms（设备自身的慢帧地板）。
3. **novel-detail（lynx）数据异常干净**（P50 10ms / jank 1–8% 交替）——与 feed 类相比更稳；按 H1 预期全文渲染随文本长度劣化，本次所测正文长度未知，长文仍需长文 fixture 验证。
4. **webview 小说搜索页 jank 20.9% 为内容差异的噪声项**——不应解读为「lynx 小说 feed 比 webview 快」；该数据点提示：不同内容的「列表」对照会引入负载差异，严格对照需 fixture 同内容（T1 工作项）。
5. 「慢半拍」触及时延仍无直接测量（gfxinfo 只有帧时间，不见输入→内容位移首帧）；**E4 地板实验（T1）现在是差异化真机的关键**：本报告已确认 lynx 负载重，但「地板」是否有独立贡献需 UiAutomation 事件时间戳 vs 内容首帧对齐。

## 4. Caveats

- jank 判定 = gfxinfo 摘要「Janky frames (legacy)」口径（Android 9 只有 legacy 判定）——与模拟器「FrameDeadline 超出」严格判定的绝对数值不可互比（同设备内相对比有效）。
- 内容非严格同卡（除 §2 标注外，插画 feed 为同日实时推荐，两端窗口化后内容集近似但非逐卡一致）。
- debug 构建（无 R8，debuggable）与生产 release 有轻微差异；登录态为真实账号。
- 每次运行间网络/加载波动（图片懒加载拉取）贡献 group 间方差。
- benchNav 钩子为 bench 分支改动（`bench/scroll-t0-306`），生产构建不含此 intent 路径，零生产影响；未合入 main。

## 5. 交付与后续

- 工具同模拟器版：`bench-scroll.mjs`（新增 parseSummary 老设备兜底）+ `lynx-bench-nav.sh`（emu/oppo profile）。
- **#306 可关闭**：模拟器 + 真机 T0 基线完成——「双端帧级定位 + 真机差异确认」交付达成。
- 下一层（T1）：① UiAutomation 注入器测触摸→首帧时延（E4 地板）——现在有真机差异数据做靶子；② 长文小说 fixture 复核 H1；③ 严格同内容 fixture 注入（webview mock + lynx debug 开关）。
