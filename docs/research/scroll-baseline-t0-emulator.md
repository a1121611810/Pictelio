# 双端滚动跟手性 T0 基线（模拟器 pictelio_ui，2026-09-02）

> 票：#306（父地图 #304「Lynx 滚动跟手性追平 webview」）
> 方法：T0 层 = `input swipe` 手势驱动 + `adb shell dumpsys gfxinfo <pkg> framestats` 逐手势采集（方法学见 research/bench-methodology 分支 `docs/research/scroll-responsiveness-bench-methodology.md` §4.1/§5）
> 工具：`packages/app/scripts/bench-scroll.mjs`（采样/解析/汇总）+ `packages/app/scripts/lynx-bench-nav.sh`（lynx 导航，bash 序列 + 截图 diff 校验）
> 原始数据：`docs/research/scroll-baseline-data/*.jsonl`（本分支）
> **结论速览：帧级指标（jank 率/帧时长）双端基本持平（p50 ≈17.3ms @30fps；jank lynx 3–4% vs webview 2.7–3.2%）。帧率指标解释不了用户体感的「手指动了内容慢半拍」——该时延段在 gfxinfo 视野之外（输入→内容位移的首帧链路），须 T1 层（UiAutomation 注入 + framestats 对齐 / 240fps 校验）才能归因。这与列表根因假设的 H5（双线程派发延迟地板）预期吻合：短列表 E4 地板实验必须上 T1。**

---

## 1. 环境

| 项 | 值 |
| --- | --- |
| 设备 | AVD `pictelio_ui`（Pixel 4 / API 34 / arm64，720×1280，软件渲染，**30Hz 刷新**——预算 33ms/帧） |
| 应用 | debug 三 flavor（`app-webview-debug.apk` / `app-lynx-debug.apk`），同一 applicationId `io.pictelio.app`，共享登录态（安全存储恢复） |
| 触发器 | 真实账号数据（推荐/小说 feed 实时拉取）；图片缓存未单独预热（滚 50ms 内首屏即加载） |
| 采样 | 每个场景 3 组 × 10 手势（drag 600ms 与 fling 180ms 交替），每手势后立即 dump；组间回顶 |
| 场景对照 | 见 §2（内容非严格同卡，见 §5 caveats） |

## 2. 场景映射（双端路径等价）

| 场景 | webview | lynx |
| --- | --- | --- |
| 插画 feed | `/home` 推荐面板（TanStack Virtual 单列） | FAB → 插画 tab（`<list>` waterfall 双列 + 推荐子 tab） |
| 小说 feed | `/search?word=少女&scope=novel` 搜索结果（虚拟化单列） | FAB → 小说 tab（`<list>` single，推荐子 tab） |
| 小说正文 | 搜索点击首卡 → `/novel/29025321`（pretext + TanStack Virtual） | 小说 tab 滚一屏后点首张可点卡（`<scroll-view>` 全文渲染） |

## 3. 结果（30 手势/场景）

| 场景 | jank 率 | 帧时长 P50 | 帧时长 P90 | UNKNOWN_DELAY P90 |
| --- | --- | --- | --- | --- |
| **插图 feed** webview | 2.7% | 17.36ms | 17.76ms | 4.45ms |
| **插图 feed** lynx | 3.2% | 17.31ms | 19.94ms | 4.08ms |
| **小说 feed** webview | 3.2% | 17.27ms | 17.67ms | 3.68ms |
| **小说 feed** lynx | 4.4% | 17.28ms | 17.46ms | 3.46ms |
| **小说正文** webview | 2.9% | 17.23ms | 17.37ms | 2.37ms |
| **小说正文** lynx | 4.4% | 17.33ms | 17.57ms | 3.89ms |

（jank 判定 = FrameCompleted − IntendedVsync > FrameDeadline − IntendedVsync；帧预算 33ms。）

## 4. 发现

1. **帧级指标双端持平。** P50 帧时长 17.2–17.4ms 全程一致（都远低于 33ms 预算）；jank 率 lynx 每场景小幅高于 webview（+0.5% ~ +1.5pp），但绝对水平都低（≤4.4%）。**不存在「帧率层面爆发性劣化」**。
2. **帧指标与体感矛盾 → 时延段在帧视野之外。** 用户体感「手指动了内容慢半拍」的测度 = 触摸位移 → 内容首帧位移的时延；gfxinfo 只记录 app UI 线程的帧时间戳，**看不到** `injectInputEvent` 事件时刻与首帧上屏之间的整段（lynx 双线程跨线程派发：触摸在 MT、JS 处理在 BT，官方定性延迟随页面复杂度与设备性能变动）。这正是「列表根因假设」H5（架构固有延迟地板）预测的形态——**E4 短列表地板实验必须依赖 T1**，本节数据无法证伪/证实 H5。
3. **小说正文（lynx）帧级无劣化信号**（17.33ms / 4.4% 与 feed 场景同水平）——但注意踩到的正文可能非长文（feed 首张可点卡，长度未知）；H1（全文一次性渲染）以**文本长度**为曲线变量，长文（~10 万字）需真机/大样本复核。
4. **轮播（迷雾区）注入横滑响应不稳定**：本会话 4/4 次注入 swipe-left 全部零帧（应用画面无变化）；此前一次 30 连滑中有 1 次出帧（40 帧）。疑似 carousel `@touchmove` + translateX 链路对该形式注入手势响应不可靠（尚不能判定是「渲染不进 gfxinfo」还是「注入识别问题」）——**列入迷雾区观察项，真机需人工/高帧录屏校验**。
5. **30Hz + 软件渲染是强衰减器。** 33ms 帧预算下，任何 <33ms 的卡顿都不计 jank；真机（OPPO 90/120Hz，硬件 GPU）帧预算 8–16ms，本就该放大的差异会被真实暴露——**真机基线是结论成立的必要条件**。

## 5. Caveats

- **内容非严格同卡**：两端各自拉取不同的加载瞬间数据（webview 小说详情为 novel/29025321；lynx 为自选首卡小说 id 未知、长度未知）。方法学要求同 fixture——fixture 注入（双端 mock 数据快照）判定为 T1+ 工作，本基线接受内容差异、以结构等价为准。
- **ABBA 不严格**：lynx 全采集后才切 webview（安装互换耗时）；组内顺序修正可用，组间设备温升/网络漂移未交叉。
- **未做图片预热**：首屏冷图滚动；H4（图片链路）用冷/热对照（E3）专门验证，不在本节。
- **轮播数据不可用**（见发现 4），不计入指标。
- gfxinfo `UNKNOWN_DELAY`（输入排队延迟）P90 双端同量级（2.4–4.5ms），无异常。

## 6. 交付与后续

- **已入库工具**：`bench-scroll.mjs`（`run`/`probe`/`report` 三命令，JSONL 落盘）/ `lynx-bench-nav.sh`。真机复用：接 OPPO 设备后 `--serial <serial>` 直接跑；导航坐标按 720 基准缩放（脚本已处理），真机分辨率不同需重校 FAB/环项坐标。
- **下一步（#306 未完）**：① OPPO 真机同套采样（90/120Hz 预算下差异会放大）；② T1 层触摸→首帧时延（E4 地板实验）——按方法学用 UiAutomation `injectInputEvent` + framestats 对齐，或 240fps 慢动作 + Show taps 做抽取校验。
