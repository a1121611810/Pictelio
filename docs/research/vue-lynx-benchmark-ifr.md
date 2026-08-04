# vue-lynx 性能基准与 IFR 文档总结（统一基准矩阵 / VDOM vs Vapor / IFR）

> 记录日期：2026-08-07（实测抓取，走代理 `http://127.0.0.1:10808`，大陆直连超时）
> 来源（vue-lynx 官方文档站 Vercel 预览部署，Rspress；`.md` 后缀会 404，须去掉后缀访问）：
> - 统一基准矩阵：<https://vue-lynx-git-vapor-huxpros-projects.vercel.app/zh/guide/benchmark-unified>（正文含完整数据页 <https://vue-lynx-git-vapor-huxpros-projects.vercel.app/benchmark/unified.html>）
> - 框架测试 VDOM vs Vapor：<https://vue-lynx-git-vapor-huxpros-projects.vercel.app/zh/guide/benchmark-vapor>
> - IFR 性能数据 v0.5：<https://vue-lynx-git-vapor-huxpros-projects.vercel.app/zh/guide/ifr-benchmarks>
> - IFR 指南 v0.5：<https://vue-lynx-git-vapor-huxpros-projects.vercel.app/zh/guide/ifr>
> 前置阅读：`docs/research/vue-lynx-deep-dive.md`、`docs/research/vue-lynx-production-readiness.md`
> 结论速览：**IFR 是首帧（FCP）杠杆，不是交互杠杆；元素模板（+b/ET）是「内存 + 静态首帧」优化，不是动态延迟杠杆；Vapor 才是交互（点状更新）杠杆。VDOM 默认配置 `vdom +b +ifr`，裸开 `+ifr`（无 +b）在 10k 规模反而变慢。对 app-lynx 的落点：fetch 驱动页用 Shell IFR（enableIFR: true + `useQuery({ enabled: !isIfrMainThread() })`），别跳过 app.mount()；IFR 的代价是 gzip ×2.2、TTI 上界 ×1.36、MT 包 78–195 KiB。**

---

## 1. IFR 指南（ifr.md，产品论点）

**IFR = Instant First-Frame Rendering（首屏直出）**：Lynx `loadTemplate` 期间、后台线程启动之前，主线程就绘制真实内容，去掉「等待后台启动 + 首次 Vue 渲染 + IPC」造成的白屏。

### 1.1 怎么快

```
无 IFR： 主线程 空页面 ───────────────────────▶ 应用 ops ─▶ 绘制
        后台线程         启动 ─▶ 渲染 ─▶ IPC ─┘

开 IFR： 主线程 loadTemplate ─▶ 渲染 ─▶ 绘制      ← Vue 运行时 + 应用打进 MT bundle，loadTemplate 内同步渲染
        后台线程                 启动 ─▶ 渲染 ─▶ hydration
```

让同步绘制「够便宜、能上线」靠两层：

| 层 | 作用 | 何时画 |
|----|------|--------|
| IFR | loadTemplate 里主线程先画；后台启动重叠 | 首帧 |
| 画多便宜 | VDOM：enableIFR 自带元素模板（ET）· Vapor：`template()` → REGISTER_TREE / CLONE_TREE（不用 ET） | create 路径 |

裸 IFR（无 ET）在主线程上仍接近整条 create 路径 → **VDOM 默认 IFR + 元素模板一起开**。

### 1.2 为什么是架构优势

IFR 不是「任何 harness 里都更快的首帧」——它消掉的是**真实线程边界造成的白屏**。单进程/同 isolate 的 bench 会很平（没有可藏的 IPC 等待）。Lynx for Web（Worker 边界）和 native 双线程上那段白屏是真的，所以 IFR 体现为产品 FCP。

### 1.3 开启方式

```ts
// lynx.config.ts
import { defineConfig } from '@lynx-js/rspeedy'
import { pluginVueLynx } from 'vue-lynx/plugin'

export default defineConfig({
  plugins: [
    pluginVueLynx({
      enableIFR: true,   // VDOM：同时开启元素模板
      // vapor: true,    // 可选 — Vapor IFR 走树 clone，不用 ET
    }),
  ],
})
```

### 1.4 关键约束（对 app-lynx 直接相关）

| 条目 | 内容 |
|------|------|
| Hydration | 两线程同一应用 + 相同初始数据；结构不一致会丢掉 IFR 收益（开发环境打 log），不影响正确性 |
| 首屏约束 | 渲染确定性；副作用放组合式 API 生命周期（主线程抑制）；Options API `mounted()` 尚未抑制 |
| **Shell IFR** | **fetch 驱动页面仍应 mount，并在主线程画出有意义的外壳**——用 `useQuery({ enabled: !isIfrMainThread() })` 关掉网络请求，而不是整段跳过 `app.mount()`。跳过 mount 只会留下更大的 IFR bundle，却拿不到首屏收益 |
| 二分 ET | `enableIFR: true, enableElementTemplates: false` — 仅调试，不是性能旋钮 |
| Vapor | 实验性（Vue 3.6 预发布） |
| 何时不开 | 响应前无物可画（纯 fetch、无同步外壳）；Web 上大 bundle + 重 CPU 节流（先实测）；未实测就扛不住约 2× gzip |

---

## 2. IFR 性能数据 v0.5（ifr-benchmarks.md，代价账本）

### 2.1 代价总览

| 代价 | 大致形态 | 测量 |
|------|----------|------|
| 双 bundle | Vue 运行时 + 应用打进两个线程 | §2 |
| 包体 | main.lynx.bundle gzip 约 2×（中位） | §2 · §3c |
| 主线程同步工作 | 串行到可交互约 +35%（全示例 proxy）；真机上主线程绘制与后台启动重叠 | §1 · §2 |
| 空/异步首屏 | 响应前不存在的内容加速不了 | §2 (networking) · §3b |
| Web 大包 + 重节流 | bundle 解析项可能抹平甚至反转 FCP 收益 | §3 · §3b |

**配置命名映射**（重要）：原始报告 `ifr` = 今天的 IFR without ET（显式 `enableElementTemplates: false`）；`ifr+et` = 今天的默认 `enableIFR: true`。

### 2.2 §1 策略阶梯（为什么 ET 默认随 IFR 开启）

结论：**元素模板是渲染成本的拐点**。纯 IFR 重放的 JS 成本与完整渲染相当（解释器下每千元素约 8–11 ms）；**ET 砍掉 7–15×**；Vapor 式设计还能再买 2–3×、贴到 PAPI 地板。场景 1000–1400 元素：static-heavy（99.7% 模板静态）、content（卡片流，37%）、list（v-for，12%）。

Warm 渲染耗时（--jitless V8，解释器 ≈ 主线程引擎代理）：

| variant | static-heavy | content | list |
|---------|-------------|---------|------|
| bg-baseline（No IFR 管线） | 11.86 ms | 9.36 ms | 6.87 ms |
| IFR without ET（线上） | 10.94 ms | 8.40 ms | 6.57 ms |
| ifr-direct（原型，已被 ET 吸收） | 8.17 ms | 6.36 ms | 4.89 ms |
| ifr-static-tpl（原型） | 1.11 ms | 5.29 ms | 4.00 ms |
| **IFR + ET（线上，默认）** | **0.74 ms** | **1.26 ms** | **1.44 ms** |
| ifr-vapor（原型上界） | 0.53 ms | 0.55 ms | 0.46 ms |
| papi-floor（参照） | 0.54 ms | 0.39 ms | 0.31 ms |

Cold 首次执行（模拟设备一次性首帧）：IFR without ET 18.0/16.4/11.7 ms；IFR + ET 4.2/5.3/4.9 ms；ifr-vapor 1.4/1.2/0.8 ms。

需要跨线程传输的 ops 载荷：无 ET 77.6/60.4/45.1 KB；**有 ET 69 B / 9.2 KB / 17.1 KB**（static-heavy 近乎归零）。

### 2.3 §2 全示例扫描（代价 + 语义安全）

- 23 个示例（7guis、gallery、hackernews、tailwindcss、networking、vue-router、pinia…），三种配置构建。
- 代价：bundle gzip **中位 ×2.26**；TTI 上界 **×1.36**；单进程 harness 里 FCP 持平（中位 ×1.04）——「JS 工作量守恒」证据，真实收益在 §3。
- 安全性：22/23 逐字节一致的文档；**networking 示例 0 节点（fetch 驱动）——文档明确标注"不建议开 IFR"的画像**。
- Bundle 体积（gzip）：hello-world 34.5 → 76.3 KiB（+121%）；gallery 37.2 → 80.0（+115%）；hackernews-css 72.6 → 179.1（+147%）；networking 57.5 → 145.5（+153%）；tailwindcss 36.2 → 79.0（+118%）。**主线程段从 ~17 KiB（仅 worklet 注册）增长到 78–195 KiB（Vue 运行时 + 应用副本）**；ET 在此之上仅 +1%。
- 扫描顺带修复 3 个真实 bug（SystemInfo 覆写、数字样式烘焙绕过 auto-px 归一化、CSS Modules 令主线程 bundle 崩溃）。

### 2.4 §3 真实线程（Lynx for Web：真实 Web Worker + postMessage IPC + headless Chromium）

结论：**有了真实线程边界，IFR 在内容优先屏幕上获胜——FCP 约 −8% 到 −26%，中位 −19%（10 个 demo）与 −12%（后续 7 应用集）**。收益来源是移除关键路径上的后台启动 + IPC。

无 CPU 节流（FCP ms，中位：默认配置 −19%，不带 ET −15%）：

| example（节点数） | No IFR | IFR w/o ET (Δ) | IFR + ET 默认 (Δ) |
|-------------------|--------|----------------|-------------------|
| hello-world (16) | 96.6 | 75.8 (−22%) | 75.4 (−22%) |
| todomvc-day1 (7) | 92.9 | 78.6 (−15%) | 73.4 (−21%) |
| swiper (39) | 100.5 | 77.7 (−23%) | 79.1 (−21%) |
| tailwindcss (68) | 95.7 | 80.9 (−15%) | 80.6 (−16%) |
| keep-alive (49) | 103.5 | 86.0 (−17%) | 84.4 (−18%) |
| transition (55) | 104.6 | 93.3 (−11%) | 85.1 (−19%) |
| 7guis (145) | 104.1 | 90.3 (−13%) | 80.6 (−23%) |
| gallery (302) | 136.6 | 104.5 (−23%) | 109.9 (−20%) |
| css-features (50) | 102.0 | 93.9 (−8%) | 100.3 (−2%) |
| **hackernews-css (18)** | **115.3** | **131.7 (+14%) ⚠** | **131.8 (+14%) ⚠** |

⚠ Hacker News 行早于 shell IFR——反转画像：首屏几乎没有同步 chrome 时，IFR 反而变慢（整段跳过 mount 满速 +14%；改 shell IFR 后约 −12%，见 §3b）。

4× CPU 节流：内容优先的屏幕保住收益（hello-world −16…−18%、todomvc-day1 −10%、swiper −10%）；FCP 由 CSS 处理或大 bundle 主导的屏幕压缩到接近零（节流放大了 bundle 解析项）。gallery 302 节点 −2%…−1%。

ReactLynx 对照组：真实线程下同样赢同一量级（85 节点 97.7 → 75.2 ms，−23%）；单进程 harness 同样持平。

距单线程裸 Web 的差距拆解（ReactLynx 探针屏、无节流）：渲染 85 元素 ~21 ms + 框架拉取解析 +7 ms + Lynx-for-Web 平台层 +47 ms + 后台启动/hydration IPC 往返 +23 ms。**线程边界的成本约 23 ms，IFR 移除的正是这一片**；剩余差距是 web 宿主仿真层常数项，原生 Lynx 平台层是原生代码不付这笔。

### 2.5 §3b 大应用复测

第二轮（hello-world、TodoMVC、gallery、Hacker News、AI Chat、Elk）：满速内容优先中位约 **−12%**（hello −26%），仍在 §3 的 −8%…−26% 带内，但低于 −19% 套件中位。**4× 节流下 Elk / AI Chat 约 +25% 到 +44%，七应用中位略偏正**。gzip 仍约 ×2.2–2.5（中位 ×2.23）。

**跨 §3 与 §3b：把 −12% 到 −19% 当作 Lynx for Web 上合理的内容优先中位带，而不是单一的 −19% 标题。** ET-only 体积约免费（~+1%）、web FCP 接近持平；ET 默认随 IFR 开启的依据仍是策略阶梯的渲染成本（6–15×），不是小屏 web FCP。

### 2.6 §4 原生引擎观察

全示例套件在原生模拟器（LynxExplorer，Lynx SDK 1.4 / PrimJS）：24/25 通过、0 次 hydration mismatch，No IFR 与 IFR+ET 视觉一致（SSIM ≥ 0.9977）。单次冷启动录屏：IFR 首帧内容提前约 0.3 s（gallery）到约 1.2 s（7guis）。

---

## 3. 统一基准矩阵（benchmark-unified + unified.html）

把 IFR 风格、VDOM vs Vapor、React vs Vue 放进同一 schema（同一台机器、同一阶梯 1k→30k）。三套旧 campaign 各答一题：IFR 风格（首帧成本/FCP）、框架 VDOM vs Vapor（instrumented BG/e2e + 可交互）、React（参照系）。

**怎么读**：Select = 点状更新（每次只动选中态/少量 class）；Update = 批量更新（每轮改很多行）。**别把两条曲线当成同一种工作负载。** 环境规则：lynx-web 是主产品量纲；bare-dom / node-jitless 是不同仪器，禁止跨环境比毫秒。

### 3.1 8 条结论（unified.html Conclusions）

| 结论 | so what | verify |
|------|---------|--------|
| **Vapor ~8.3× 点状更新** | Select = 点状。交互密集列表默认 Vapor；单次点击常贴帧地板 | selectStorm@10k 984→119 ms · vs RL ~22× · BG ~9.8× |
| ReactLynx 赢 create ~1.05× | Snapshot 批量实例化。创建 ≠ 更新 | create@10k RL 1659 · VDOM 1736 · Vapor 1732 ms |
| ReactLynx FCP 最低 | 同密度探针：RL 赢。Vue 首帧 → vdom +b +ifr | FCP@10k RL 241 · +b +ifr 373 · vdom baseline 452 ms |
| **无 +b 就别开 +ifr** | 「−19%」不是常数。vdom +ifr（无 +b）规模变大反而输；默认 vdom +b +ifr | vs off：1k −21% · **10k +33%** |
| +b 提速更新约 2% | 模板 clone 对 mount 后也有帮助。+ifr（无 +b）≈ baseline | selectStorm@10k baseline 984 · +ifr 995 · +b +ifr 968 ms |
| Vapor sparse naming ×1 FCP −20% | Keeper sparse A2 在 ×1 有用；×4 不是 hedge。native ET 仍是最大杠杆 | dense 152.9 → sparse 121.8 ms · ×4 +12% |
| **create→RL · updates→Vapor · Vue FCP→vdom +b +ifr** | 产品选择塌缩成这一行 | 见下表 |
| **引用比值，不要引用毫秒** | 中位数跨宿主漂移 2×+；同宿主比值才稳定 | 旧宿主 React selectStorm@10k ≈2544 ms；本宿主 ≈2632 ms |

### 3.2 Storms 表（IFR × 框架矩阵，黑盒点击 → 组合 DOM 终态；1k/10k/30k）

关键行（select storm = 点状更新风暴，@10k）：

| scenario | select storm @10k | update storm @10k | select storm @30k |
|----------|-------------------|-------------------|-------------------|
| vdom (baseline) | 984.1 ms (10.59) | 1.86 s (2.66) | 3.57 s (12.97) |
| vdom +b | 1.04 s (11.19) | 1.94 s (2.78) | 3.23 s (11.73) |
| vdom +ifr | 994.6 ms (10.70) | 1.97 s (2.82) | 3.33 s (12.10) |
| vdom +b +ifr（默认） | 967.9 ms (10.41) | 1.89 s (2.71) | 3.17 s (11.53) |
| vapor (baseline) | 106.0 ms (1.14) | 729.8 ms (1.04) | 306.1 ms (1.11) |
| vapor +b（默认） | 118.6 ms (1.28) | 887.6 ms (1.27) | 275.2 ms (1.00) |
| vapor +b +ifr（默认 +ifr） | 124.7 ms (1.34) | 740.5 ms (1.06) | 362.9 ms (1.32) |
| rl (Snapshot+IFR+memo) | 2.63 s (28.32) | 6.04 s (8.64) | 10.3 s (37.29) |

（create：RL 全阶梯领先 ~1.05×；vdom/vapor 各 variant 均在噪声带。slowdown 几何均值：vdom 系 2.32–2.48，vapor 系 1.06–1.19，RL 5.02。）

### 3.3 Content-probe FCP（架构阶梯，同卡片密度 ~1k→30k 元素）

| scale | vdom baseline | vdom +ifr | vdom +b +ifr | vapor +b (default) | vapor +b +ifr | rl |
|-------|---------------|-----------|--------------|--------------------|---------------|-----|
| 1k | 128.3 (1.73) | 101.6 (1.37) | 98.1 (1.33) | 173.6 (2.35) | 144.8 (1.96) | 74.0 (1.00) |
| 3k | 204.9 (1.86) | 177.4 (1.61) | 160.8 (1.46) | 268.8 (2.45) | 232.8 (2.12) | 109.9 (1.00) |
| 5k | 258.5 (1.70) | 252.1 (1.65) | 221.0 (1.45) | 379.5 (2.49) | 345.6 (2.27) | 152.4 (1.00) |
| **10k** | **452.1 (1.87)** | **601.6 (2.49)** | **372.8 (1.54)** | 626.4 (2.60) | 576.7 (2.39) | 241.3 (1.00) |
| 20k | 839.0 (1.83) | 1.05 s (2.29) | 708.2 (1.55) | 1.15 s (2.52) | 1.06 s (2.30) | 458.0 (1.00) |
| 30k | 1.17 s (1.67) | 1.51 s (2.16) | 1.59 s (2.26) | 1.73 s (2.47) | 1.66 s (2.36) | 702.2 (1.00) |

**关键发现**：`vdom +ifr`（无 +b）在 10k 起反超 vdom baseline（601 vs 452 ms）——印证「无 +b 就别开 +ifr」；`vdom +b +ifr` 是 vdom 系的规模 hedge。CPU ×4 下 vdom +ifr 同样最差（3.24 s @10k），+b +ifr 收敛（2.36 s）。

### 3.4 Main-effect 结论（单 flag 边际归因）

1. **Update 和 select 是模板盲**：+b 因子在 update/select 全阶梯都在 ±10% 噪声带内——模板只改变谁构建首帧，不改变怎么写洞。
2. **模板 create 收益只出现在 static-heavy 屏**：动态表 app 的 create 被动态 v-for 行主导，模板只盖住小静态骨架（−0.2%…−8.1% ≈ 噪声）；sfc-probe 静态内容 FCP 阶梯上 block/code 模板是全阶梯唯一负因子。**规则：先量首屏静态占比，再决定要不要模板。**
3. **render 轴（vdom→vapor）才是更新杠杆**：updateStorm −47.8%/−60.7%/−38.4%（1k→30k），远超任何模板轴。选渲染模型决定交互性能；别指望模板挪动它。
4. **IFR 是首帧杠杆，不是交互杠杆**：ifr 因子只在 create/FCP 显著，update 因子在噪声内；×4 下 vapor 的 IFR 首帧成本被 +b 收回（baseline +12% → +b +2%）。
5. **vapor +b 到底做什么**：动态表上 create/update/select/storm 全在 ±10% 噪声带。两个真实收益：(1) 内存/簿记——BG shells −94%、MT 表项 −92%（精确计数）；(2) 静态重型首帧——block staging 让首帧构建更便宜，收益随子树静态占比缩放。**一句话：+b 是内存 + 静态首帧优化，不是动态延迟杠杆。**
6. +b:e / +ifr:e（engine rung）在 Lynx for Web 上 N/A（无 engine ET PAPI，stub）。
7. +b!（bundle delivery，#338）与 +b:c（code staging，#337）收益**有条件**：小模板 × 多实例（列表行）才值得 bake；单实例 mega-template 属于 data path——**用模板大小做门槛**。+b:c 在 30k 时 MT 段 8 kB → 487 kB gzip（raw 24 kB → 3.5 MB）。
8. +ifr:c（code-paint，#340）首帧是 wash：×1 −3.3%…+11.9%、×4 −6%…+9.5%、均值 +5.2%——单次临时实例化由 PAPI 元素创建主导，code rung 只去掉 per-node 解释器走查（首帧成本的小头）。

---

## 4. 框架测试 VDOM vs Vapor（benchmark-vapor，Vue 框架切片）

同一 Vue 应用、两种模式、完整双线程管线（Vue core benchmark 移植到 Lynx）。ReactLynx 是参考系，不是被测主体。

### 4.1 Instrumented BG / e2e

| 操作类型 | vdom bg | vapor bg | 提速 | vdom e2e | vapor e2e | 提速 |
|----------|---------|----------|------|----------|-----------|------|
| 选中行（点状） | 2.95 ms | 0.30 ms | 9.8× | 3.45 ms | 0.55 ms | 6.3× |
| 每第 10 行更新（批量） | 3.20 ms | 0.55 ms | 5.8× | 4.85 ms | 2.30 ms | 2.1× |
| 交换行（近点状） | 3.90 ms | 0.65 ms | 6.0× | 4.65 ms | 1.20 ms | 3.9× |
| 删除行（点状） | 2.85 ms | 0.40 ms | 7.1× | 3.40 ms | 0.90 ms | 3.8× |

e2e < bg，因为两种模式发出的 ops 几乎相同——差距在后台线程的 Vue 工作（与应用逻辑共享）。创建 e2e 大致持平（vapor create1k ~0.87×…create10k ~0.94×，见 REGISTER_TREE / CLONE_TREE）。

### 4.2 跨线程流量（create 1k）

| | vdom | vapor |
|--|------|-------|
| 每次 flush ops | 17,000 | 7,000（−59%） |
| JSON 字节 | 327 KB | 160 KB（−51%） |

Lynx for Web 上几乎不挪动 e2e（DOM 构建占主导）；**native 上载荷要过序列化边界——砍半更有意义**。

### 4.3 启动、内存、包体

| 指标 | vdom | vapor | 备注 |
|------|------|-------|------|
| 首屏（attach → 内容） | 121.7 ms | 125.8 ms | +3%，CI 重叠 |
| 包体 gzip（main.lynx.bundle） | 39.2 KB | 49.3 KB | +26% |
| 10k 行后 JS heap | 76–136 MB | 76–105 MB | 仅供参考 |

---

## 5. 对 app-lynx 的应用要点（vue-lynx 0.5.1）

结合本文档与 [[lynx-ifr-reference]] 的既有结论：

1. **app-lynx 全部页面 fetch 驱动但有骨架屏（SkeletonCard/SkeletonImage）→ 属于文档推荐开 IFR 的「数据驱动但有同步外壳」区间**。VDOM 默认 `enableIFR: true`（自带 ET），且当前版本已支持（`pluginVueLynx` 选项 + 运行时 `isIfrMainThread()`，见 node_modules/vue-lynx/runtime/dist/ifr-env.d.ts）。
2. **必须 Shell IFR**：保留 `app.mount()`，主线程画出骨架屏外壳；用 `useQuery({ enabled: !isIfrMainThread() })` 在 MT 抑制 fetch。跳过 mount 会白付 IFR bundle 却无首屏收益（§1.4、§2.4 的 Hacker News 反转画像）。
3. **不要裸开 IFR**（`enableIFR: true` + `enableElementTemplates: false` 仅调试）：无 +b 时 vdom 在 10k 规模 FCP 反超 baseline（§3.3）。
4. **代价预算**：gzip ×2.2、MT 段 +78–195 KiB、TTI 上界 ×1.36；首帧收益预期带 **−12%…−19%**（不是常数），4× 重节流 + 大 bundle 时可能反转——上线前在目标设备实测。
5. **交互性能（收藏动画、下拉刷新、点击反馈）别指望 IFR/ET**——它们是首帧/内存杠杆；交互杠杆是 Vapor（点状更新 8.3×）或主线程方案（见 [[lynx-touch-fx-reference]]）。
6. **首屏优化先量静态占比**：block/code 模板收益随首屏静态子树占比缩放；动态 v-for 主导的屏（如推荐瀑布流）模板收益 ≈ 噪声。
7. 文档站访问注意：`vue.lynxjs.org` 大陆不可达，Vercel 预览部署 `.md` 后缀会 404，须去掉后缀；均走代理 `http://127.0.0.1:10808`。

**复现命令**（如后续需要自行复测）：
```bash
pnpm --filter vue-lynx-benchmark bench:unified   # 统一矩阵
pnpm --filter vue-lynx-benchmark bench:synthesize
pnpm --filter vue-lynx-benchmark bench:report
pnpm --filter vue-lynx-benchmark bench           # vapor instrumented
pnpm --filter vue-lynx-benchmark bench:cross     # 黑盒（含 React 参考）
pnpm --filter vue-lynx-benchmark bench:storms
pnpm --filter vue-lynx-ifr-bench run check && pnpm --filter vue-lynx-ifr-bench run bench  # IFR 策略阶梯
```

---

## 6. 补充：app-lynx 真机 32 组全矩阵实测（2026-08-02）

> 前置研究（§1–§5）为官方基准；本节为 **app-lynx 本机实测**（模拟器真机环境），
> 用于回答「app-lynx 开启 IFR 是否更好」——结论：**32 组无一收益，不推荐开启**。

### 6.1 方法

- **环境**：pictelio_ui（Android 34 arm64）、pictelio_low（Android 9 API 28），
  均窗口模式 + swiftshader 软件渲染，`http_proxy=10.0.2.2:10808` 访问 Pixiv。
- **4 个 APK 变体**：IFR off/on × 原始 router（默认登录页）/ 乐观 router（默认推荐页）。
- **Splash 开关**：LynxActivity 临时加 `pictelio_splash` SharedPreferences 开关
  （仅控制 `setKeepOnScreenCondition` 是否保持到 bundle 加载完；Android 12+ 系统 splash 本身强制显示）。
- **指标**（logcat 时间线，各 5 轮取中位）：
  - `toLoadSuccess`：`renderTemplateUrl` → `dispatchLoadSuccess`（bundle 加载 + 首渲完成）
  - `toFirstScreen`：→ `onFirstScreen`
  - `splashDispose`：→ 系统 Splash 释放（仅冷启动有）
- 测量脚本为临时 PROTOTYPE 脚本，验证后已删除；代码改动已全部还原。

### 6.2 Android 34 实测（toLoadSuccess / toFirstScreen，ms 中位）

| 场景 | IFR off | IFR on | IFR on 相对 |
|---|---|---|---|
| 登录页·冷启动·splash on | 28 / 94 | 87 / 74 | load +59ms |
| 登录页·热启动·splash on | 11 / 32 | 28 / 26 | load +17ms |
| 登录页·冷启动·splash off | 22 / 146 | 54 / 53 | load +32ms |
| 登录页·热启动·splash off | 18 / 98 | 21 / 20 | load +3ms |
| 推荐页·冷启动·splash on | 14 / 65 | 60 / 59 | load +46ms |
| 推荐页·热启动·splash on | 15 / 42 | 28 / 23 | load +13ms |
| 推荐页·冷启动·splash off | 12 / 46 | 61 / 48 | load +49ms |
| 推荐页·热启动·splash off | 15 / 47 | 30 / 28 | load +15ms |

### 6.3 Android 9 实测（toLoadSuccess / toFirstScreen，ms 中位）

| 场景 | IFR off | IFR on | IFR on 相对 |
|---|---|---|---|
| 登录页·冷启动·splash on | 87 / 516 | 437 / 430 | load +350ms |
| 登录页·热启动·splash on | 64 / 226 | 178 / 162 | load +114ms |
| 登录页·冷启动·splash off | 83 / 417 | 418 / 423 | load +335ms |
| 登录页·热启动·splash off | 55 / 445 | 62 / 68 | load +7ms |
| 推荐页·冷启动·splash on | 16 / 135 | 396 / 386 | load +380ms |
| 推荐页·热启动·splash on | 13 / 37 | 195 / 185 | load +182ms |
| 推荐页·冷启动·splash off | 52 / 490 | 382 / 373 | load +330ms |
| 推荐页·热启动·splash off | 60 / 206 | 225 / 207 | load +165ms |

### 6.4 结论

1. **IFR 开启后 `toLoadSuccess` 在全部 32 组中均变慢**（+3ms ~ +380ms）：
   bundle gzip ×2.33（52KB→121KB）使 `loadTemplate` 解析成本成为净负担；
   `onFirstScreen` 两者接近（骨架屏同步渲染本身便宜，IFR 的 ET 收益无处发挥）。
2. **Splash 开关**：冷启动下 splashDispose 中位 Android 9 on/off ≈ 1443/1288ms、
   Android 34 on/off ≈ 591/552ms（off 提前 ~40–160ms）；热启动无 splash。
   但 **Android 12+ 系统 splash 为 OS 强制**，`keepOnScreenCondition` 仅缩短保持时长，
   无法让 splash「消失」——「关闭 splash」的真实收益上限约 160ms（Android 9 冷启动）。
3. **低版本（Android 9）整体更慢**（冷启动 loadSuccess 为 Android 34 的 2–5 倍），
   但 IFR 的相对劣势方向在 Android 9/34 完全一致——结论跨版本稳定。
4. **维持最终判定**：app-lynx 为「骨架屏 + fetch 驱动」画像（§1.3 文档明确此类先实测），
   实测不支持开启 IFR；安全无退化（生产 bundle 凭证零泄漏）、内存 ×2.05、可维护性影响低。
