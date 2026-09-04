# webview-only bench 测量集扩展提案（#306 之上）

> **【模拟器结论，不可直接外推真机】**
>
> 本提案是 `docs/research/webview-perf-diagnosis.md`（wayfinder #356 主报告）的产线副产品。**不修改** `#306` `bench-scroll.mjs`（已合并到 main，模拟器 + 真机 OPPO R11s 双 profile），**复用 + 扩展** —— 新增 webview-only 测量集覆盖 #356 主报告里所有「待 bench 验证」的假设。

## 0. 元数据

- 父报告：[`webview-perf-diagnosis.md`](./webview-perf-diagnosis.md)（wayfinder #356）
- 复用资产：`packages/app/scripts/bench-scroll.mjs`（位于 `bench/scroll-t0-306` 分支，commit 7c1b2601；**未合 main** —— 实施时需先 cherry-pick 到 `research/webview-perf-diagnosis` 分支或新分支）
- 复用方法学：`docs/research/scroll-responsiveness-bench-methodology.md`（`research/bench-methodology` 分支）
- 目标：在 `#306` 之上新增 5 个 webview-only 测量维度，让 #356 主报告里 17 条「待 bench 验证」假设具备实测前置条件

## 1. 现有 `#306` 能力盘点

`bench-scroll.mjs` 已实现：
- `adb input swipe` 手势驱动（drag / fling / swipe-left / back-top 四种）
- `dumpsys gfxinfo ${PKG} framestats` 采样 + 解析（Android 12+ 21 列 + Android 9 17 列兼容）
- 聚合摘要（p50/p90/p99 / jank rate）+ JSONL 落盘
- 双端导航（webview 走 SPA `pushState` + CDP `evaluate`，lynx 走 `benchNav` intent 深链 + bash 序列）
- `framesProbe`（滚动出帧判定 + 兜底）
- 场景：carousel / illust-waterfall / novel-single / novel-detail / multiimage / following-illust / following-novel

**复用点**：
1. 手势驱动 + framestats 采样 → 100% 复用
2. 双端导航 webview 段（`navWebview` 函数，bench-scroll.mjs:266+）→ 100% 复用
3. JSONL 报告格式 → 100% 复用
4. `parseSummary` 兜底 → 100% 复用

## 2. 5 个新增 webview-only 测量维度（不修改 #306，只新增子命令）

### M1. `shouldInterceptRequest` 主线程阻塞时长【对应 X1 / B1 / B4】

- **方法**：在 `MainActivityWebview.java:113-129` 的 `shouldInterceptRequest` 加 `android.util.Log` 输出（**需 Java 代码埋点 —— 评估是否允许**），格式：
  ```
  MainActivity interceptImage url=<hash8> startMs=<ns> endMs=<ns> hit=<disk|memory|miss|err>
  ```
  然后 bench 脚本读 logcat 过滤 `MainActivity`，统计：
  - 命中（disk/memory）p50/p90/p99 耗时
  - 未命中（miss）p50/p90/p99 耗时（含 OkHttp 下载）
  - 异常（err）次数
- **CDP 端替代方案（无需 Java 埋点）**：CDP `Runtime.evaluate` 注入：
  ```js
  window.__interceptProbe = (url, startMs) => {
    performance.mark(`intercept-start-${url}`);
    window.__interceptStarts = window.__interceptStarts || {};
    window.__interceptStarts[url] = startMs;
  };
  ```
  在 `shouldInterceptRequest` 返回的 `WebResourceResponse` 的 `onload` 时记录 endMs —— **但 webview 不暴露这个 hook**，所以这条路径只能靠 Java 埋点。
- **输出 JSONL 字段**：`{scenario, url8, hit, startMs, endMs, durationMs}`
- **聚合报告**：按 hit 类型分桶统计 p50/p90/p99，与 framestats 的帧时长做交叉（同一秒内 N 次 miss 是否对应帧 jank）

### M2. `setOptions` / `measure` / `setVirtualItems` 调用频率【对应 A1 / A2】

- **方法**：CDP `Runtime.evaluate` 注入 `performance.measure` 包装层（**无需 Java 埋点**）：
  ```js
  const _origSetOptions = window.__tanstackSetOptions;
  window.__tanstackSetOptions = function(opts) {
    performance.mark('setOptions-start');
    const r = _origSetOptions.call(this, opts);
    performance.mark('setOptions-end');
    performance.measure('setOptions', 'setOptions-start', 'setOptions-end');
    return r;
  };
  ```
  配合 `new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perfBuffer.push({name: e.name, duration: e.duration}); }).observe({entryTypes: ['measure']});`
  然后 bench 脚本通过 CDP 定期 `JSON.stringify(window.__perfBuffer)` 拉取并清空。
- **输出 JSONL 字段**：`{scenario, ts, name, durationMs}`
- **聚合报告**：每秒 `setOptions` 调用次数 + 单次调用 p50/p90/p99 时长；与 framestats 的帧时长做交叉（验证是否「帧 jank 与 setOptions 调用密集度相关」）
- **注意**：TanStack Virtual 的 `setOptions` / `_willUpdate` 是通过 internal Symbol 访问，**需要在 `createFeedVirtualizer.ts:173, 193, 217, 230` 上挂 monkey patch**，**或**通过 `performance.mark` 包住 `window.scroll` listener 的整个 callback（更粗粒度但更稳定）。

### M3. `imageCachePrefetch` + `checkImageCache` 命中率【对应 B1 / B3 / B5】

- **方法**：CDP `Runtime.evaluate` 注入计数器：
  ```js
  window.__imgCacheProbe = { hits: 0, miss: 0, loads: 0, prefetchs: 0 };
  // monkey-patch checkImageCache / loadImage（在 imageLoader.ts 模块导出上挂代理）
  ```
  然后 bench 脚本通过 CDP 定期拉取 `JSON.stringify(window.__imgCacheProbe)` 并清空。
- **输出 JSONL 字段**：`{scenario, ts, hitsDelta, missDelta, loadsDelta, prefetchsDelta}`
- **聚合报告**：每场景的 hit/miss 比例 + prefetch 命中率 + prefetch 后 miss 比例（**核心指标**：「预热后的冷启动 L1 填充速率」）

### M4. 路由切换瞬间的 skeleton → 真图过渡帧时长【对应 A4 / A6 / X6】

- **方法**：复用 `bench-scroll.mjs:266+` 的 `navWebview` 路由跳转函数，新增子命令 `nav-switch-instant`：
  - 跳到 `/home` → 等首屏 → 跳到 `/illust/<id>` → framestats 重置 + 采样首 500ms
  - 跳到 `/home` → 等首屏 → 跳到 `/novel/<id>` → framestats 重置 + 采样首 500ms
  - 跳到 `/home` → 等首屏 → 系统返回手势 → framestats 重置 + 采样首 500ms
- **输出 JSONL 字段**：`{scenario, kind, frames, jankRate, totalP50, totalP90, totalP99, unknownDelayP50, unknownDelayP90, deadlineMs}`（沿用 `#306` 格式）
- **聚合报告**：路由切换首 500ms vs 稳态的 p99 对比；验证「先渲染后加载」原则在 WebView 85+ 上的 jank 表现

### M5. Ugoira 动图播放期间的主线程占用【对应 B4】

- **方法**：新增子命令 `nav-ugoira-detail`：
  - 搜索带 Ugoira 标签的作品 → 进入详情 → 启动播放 → framestats 采样 10s
- **输出 JSONL 字段**：同 M4 格式，加 `ugoira-frame-fps` 字段（通过 CDP `evaluate` 注入 `window.__ugoiraFps` 计数器读取 `UgoiraViewer` 的帧率）
- **聚合报告**：Ugoira 播放期间帧时长 p99 vs scroll 期间帧时长 p99 对比；验证「高帧率动图是否反向吃主线程 paint 预算」

## 3. 实施接口（不修改 #306，新增旁挂）

### 3.1 目录结构

```
packages/app/scripts/
├── bench-scroll.mjs            # 现有 #306 脚本，**不动**
├── bench-webview-perf.mjs      # 新增：webview-only 测量集入口
└── bench-webview-lib/          # 新增：5 个测量维度 + 共用工具
    ├── index.mjs
    ├── intercept-telemetry.mjs # M1（依赖 Java 埋点）
    ├── setoptions-probe.mjs    # M2
    ├── imgcache-probe.mjs      # M3
    ├── switch-jank.mjs         # M4
    └── ugoira-jank.mjs         # M5
```

### 3.2 CLI 接口（与 #306 风格一致）

```
# 复用 #306 的手势 + framestats 采样，新增 webview-only 测量
node scripts/bench-webview-perf.mjs intercept  --serial emulator-5554 --scenario illust-waterfall --groups 3 --per 10
node scripts/bench-webview-perf.mjs setoptions  --serial emulator-5554 --scenario novel-detail --groups 3 --per 10
node scripts/bench-webview-perf.mjs imgcache    --serial emulator-5554 --scenario illust-waterfall --groups 3 --per 10
node scripts/bench-webview-perf.mjs switch      --serial emulator-5554 --kind home-illust --groups 5
node scripts/bench-webview-perf.mjs ugoira      --serial emulator-5554 --groups 3
node scripts/bench-webview-perf.mjs report      --out <dir>     # 汇总目录下所有 *.jsonl → summary
```

### 3.3 报告格式（与 #306 summary.json 兼容 + 扩展字段）

```json
{
  "intercept": {
    "diskHit": { "p50": 1.2, "p90": 3.5, "p99": 8.1, "count": 240 },
    "memoryHit": { "p50": 0.3, "p90": 0.5, "p99": 1.2, "count": 80 },
    "miss": { "p50": 120, "p90": 280, "p99": 450, "count": 60 }
  },
  "setOptions": {
    "callsPerSecond": 18.5,
    "durationP50": 0.8, "durationP90": 2.1, "durationP99": 5.3
  },
  "imgCache": {
    "hitRate": 0.78,
    "missRate": 0.22,
    "prefetchHitRate": 0.42,
    "warmupTimeMs": 320
  },
  "switch": {
    "home-illust": { "first500msJankRate": 0.18, "totalP99": 78 },
    "illust-home": { "first500msJankRate": 0.12, "totalP99": 52 }
  },
  "ugoira": {
    "playJankRate": 0.08,
    "playFrameP99": 28,
    "frameFps": 32
  }
}
```

## 4. 与 #306 bench 的整合点

### 4.1 共用部分（无需复制）

- 手势驱动函数（`gesture`，bench-scroll.mjs:88-100）→ 通过 `import` 复用
- 屏幕尺寸解析（`screenSize`）→ 复用
- framestats 解析（`parseSummary` / `parseFramestats`）→ 复用
- CDP 连接（`cdpEvaluate`）→ 复用
- JSONL 写入（`appendFileSync`）→ 复用

### 4.2 差异化部分（仅新增）

- 5 个 webview-only 探针注入（CDP `Runtime.evaluate`）
- Java 埋点读取（`adb logcat` 过滤）→ 复用 `adb` 帮助函数
- 新增 5 种场景（路由切换 × 3 + Ugoira × 1 + intercept telemetry 跟随已有场景）

## 5. 实施步骤（提案，非本 ticket 执行）

### Step 1：Java 埋点决策（**前置**）

- 在 `MainActivityWebview.java:113-129` 加 `Log.i("PictelioPerf", "interceptImage ...")`
- 或：在 `PixivImageLoader.java:97, 105, 129, 150` 各处加 method entry/exit log
- **评估**：OpenWiki `integrations/android-native.md` 显示 Java 代码允许修改（在 wayfinder #355 范围内），但需要确认 `proguard-rules.pro` 不要 strip 这个 log

### Step 2：CDP 探针模块实现

- 在 `packages/app/scripts/bench-webview-lib/` 下实现 5 个模块
- 探针注入代码用 single-line（与 agent-browser driver 兼容，openwiki/testing/overview.md:42）

### Step 3：入口脚本 + 路由切换扩展

- 实现 `bench-webview-perf.mjs` 入口（5 个 subcommand）
- 复用 `bench-scroll.mjs` 的 `navWebview` 路由切换，扩展支持 `home-illust` / `illust-home` / `novel-detail` 三种切换

### Step 4：报告聚合

- 实现 `report` subcommand 汇总 5 个 JSONL → summary.json
- 格式与 `#306` 兼容 + 扩展字段（见 §3.3）

### Step 5：基线采集

- 模拟器（emulator-5554）跑 5 个 subcommand 各 3 组
- 真机 OPPO R11s（如果环境可用）跑同样 5 组
- 落盘到 `docs/research/webview-perf-bench-data/` （不入版本控制，按 `#306` 惯例）

## 6. 与主报告假设的映射（每个 subcommand 对应哪些 A/B/C 假设）

| Subcommand | 主线程时序 A | 图片管线 B | 路由/Store C | 跨场景 X |
|------------|--------------|------------|--------------|----------|
| `intercept` | A1, A2（间接） | **B1**, B4, B7 | C5 | **X1**, X2 |
| `setoptions` | **A1**, **A2**, A3 | — | C3 | **X3** |
| `imgcache` | A4（间接） | **B1**, **B3**, **B5** | — | X2, X4 |
| `switch` | **A4**, **A6** | — | C1, C4, **C5** | X6 |
| `ugoira` | A4（间接） | **B4** | — | — |

**关键对应**：
- `intercept` + `setoptions` + `imgcache` 三件套覆盖了 X1/X2/X3 三个最高优先级跨场景假设
- `switch` 是 X6 的直接量化
- `ugoira` 是 B4 的直接量化

## 7. 不在本提案范围

- **Java 端 telemetry 上线**（Step 1）：本提案是「在模拟器 + 一次性 Java 埋点 + bench 脚本」三件套；如果 Java 埋点长期保留（telemetry 上报），需要单独立 ticket
- **真机 OPPO R11s 实测**：模拟器优先；真机在 #355 决策「仅模拟器量化」下不强制
- **Service Worker / Web Worker 桥引入**：属于 X 系列改造 ticket（不在本 bench 范围）
- **Lynx 端 bench**：本提案 webview-only；lynx 端已有 `#306` + `#312` 覆盖

## 8. 与 #355 决策的对齐

- **不锁数字指标**：本提案**只采集，不立阈值**，让主报告的「待 bench 验证」假设获得实测前置条件
- **仅模拟器量化**：默认 `--serial emulator-5554`，真机 OPPO R11s 可选
- **不修改 #306 现有脚本**：通过 `bench-webview-lib/` 复用 + 扩展，100% 向后兼容
- **不修代码**：本提案是测量基础设施 + 测量方法；Java 埋点是唯一可能涉及代码变更的点（需用户确认是否允许）
- **OpenWiki 不手改**：本提案不涉及 OpenWiki 任何内容
