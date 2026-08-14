# 提速方向 E（图片/网络降载）可行性实测报告

> 状态：实测完成。本报告回答 `docs/agent-browser-e2e-perf-analysis.md` 第 3 节「方向 E」的
> 可行性问题，并按 **高可维护性 / 高性能 / 高安全性 / 低内存占用** 四个维度给出结论。
> 配套一次性原型：`packages/app/tests/agent-browser/prototype/image-offload.prototype.test.ts`
> （run 命令见文件头注释，不进正式套件 include）；机制验证冒烟脚本见第 6 节附录。
> 实测日期：2026-08-14；agent-browser 0.34.0（项目本地依赖，`node_modules/.bin/agent-browser`），
> Vitest 4.1.10，真实登录（.env 的 PIXIV_REFRESH_TOKEN），同一机器/网络/token。

## 0. 结论摘要（TL;DR）

1. **文档 E-1 的主路径（mockFetch 拦截 /pixiv-img/ 为占位图）机制上不可行**：
   - `driver.mockFetch`（driver.ts:310-326）只包装 `window.fetch`；Feed 图片由
     `<img src="/pixiv-img/...">` 原生加载（PixivImage.tsx:50-59），**不经 fetch → 拦不住**；
   - 唯一走 fetch 的图片加载是详情页 `LazyDetailImage` 的 prefetch（imageLoader.ts:405
     `fetchWeb` / :375 `fetch(proxyUrl)`），但 `mockFetch` 只能返回 `application/json` 字符串
     body，**无法返回二进制占位图**，会破坏图片解码。
2. **`agent-browser network route` 可拦截 `<img>`，但 `--body '<svg>'` 实测返回无
   Content-Type 的响应，Chromium 不对 SVG 做图片嗅探 → `<img>` 触发 onerror，与 `--abort`
   效果相同（占位图方案落空）。唯一能给出"真实可见占位图"的机制是 **Vite dev 中间件**
   （正确 `image/svg+xml` Content-Type，实测 200 + SVG）。
3. **实测三种模式的断言结果**（真实登录 + 4 项代表性用例，详见第 3 节）：

   | 断言场景 | off（真实图） | abort（全拦截） | placeholder（SVG 占位） |
   |---|---|---|---|
   | Feed 首屏 AI 断言 | ✅ | ✅ | ✅ |
   | 滚动加载 AI 断言 | ✅ | ✅ | ✅ |
   | 详情页 AI 断言（"展示大图"） | ✅ | ❌（"⚠加载失败"×3） | ✅ |

   即：**abort 会击穿详情页断言，但 Feed 级断言在图片全断下依然通过**（aiAssert 的输入
   是 accessibility tree + innerText，不含图片像素）；placeholder 全场景通过。
4. **收益量化（单会话实测）**：off 模式会话内仅 **5~6 个图片请求 / ~218KB / 解码位图峰值
   ~5~7MB**（HAR 实测，含详情页）；abort 为 **0B / 0MB**；placeholder 为 **~1KB / <1MB**。
   但**墙钟时间收益≈0~1s/会话**：图片请求少、且多与登录等待并行发生，不占关键路径。
   文档第 3 节估计"2~5 min（视网络）"、第 4 节表"-1~3 min"**偏高**；按 21 个登录会话
   摊算，全量收益约 0.5~1 min（网络慢时上限 ~2 min）。瓶颈排序（登录 > SLEEP > AI > 图片）
   不变，E 的份额低于文档估计。
5. **E-2（--profile 持久缓存）实测不可用**：`--profile` 全局选项存在（0.34.0），但实测
   带 `--profile` 启动后 app 标签页变成 `about:blank`（tab list 实测），登录流程无法执行；
   工具链真正的状态持久化是 `--restore`/`--state`（恢复 cookies/localStorage），但它**不
   恢复 Chrome HTTP 磁盘缓存**（每次运行全新浏览器），拿不到 E-2 声称的"图片命中磁盘缓存"
   收益。E-2 与方向 A-2 重叠部分（免登录）可改由 `--restore` 验证，但图片缓存部分不成立。

---

## 1. 方向 E 是什么（原文引用 + 本报告的操作化定义）

> 原文（分析文档第 3 节 E）："对**不依赖图片像素的 UI 结构断言**，用 `mockFetch` 把
> `/pixiv-img/` 拦截为固定尺寸占位图（translation-flow 已证明 mock 链路可行），避免每次
> 导航下载几十张真实图片。**注意**：瀑布流布局由图片尺寸驱动（`createImageSizeWorker`），
> mock 需返回固定尺寸占位图或仅对非布局关键路径启用，否则引入假阳性。……或改用 `--profile`
> 持久缓存（同 A-2），第二次运行起图片命中磁盘缓存。"

操作化为三个可验证子项：

| 子项 | 内容 | 验证方式 |
|---|---|---|
| E-1a | mockFetch 能否拦截图片请求（含 `<img>`） | 静态代码审查 + 冒烟实测 |
| E-1b | 网络层/代理层占位图是否产生"可见占位图"（能被 `<img>` 解码） | network route --body 冒烟实测 |
| E-1c | 占位图/拦截后，Feed 与详情页断言是否仍通过、省多少字节/内存/时间 | 原型三种模式实测 |
| E-2 | `--profile`/`AGENT_BROWSER_PROFILE` 持久化是否可用且带来图片缓存收益 | 独立脚本实测 |

**关键前置结论（文档的两处假设需要修正）**：

- **假设一"mockFetch 能拦图片"错误**：mockFetch 是页面级 `window.fetch` 包装，图片不走 fetch。
- **假设二"瀑布流布局由图片尺寸驱动（createImageSizeWorker）"不成立**：`createImageSizeWorker`
  仅被 `novelImageDimensions.ts`（小说正文内嵌图）使用；主 Feed 与次级 Feed 的布局宽高来自
  **Pixiv API 元数据**（ImageCard.tsx:32-33 用 `illust.width/height`；IllustSingleCard.tsx:34-38
  用 `width/height` 计算 aspect-ratio，异常回退 16:10），**与图片字节完全解耦**。因此文档
  "mock 需返回固定尺寸占位图否则引入假阳性"的顾虑对 Feed 不成立——布局不依赖图片字节。

---

## 2. 静态分析：图片加载链路与三种拦截机制

### 2.1 图片在 E2E 环境中的加载路径（Web 模式，Vite dev server 5173）

| 加载方 | 代码位置 | 请求方式 | mockFetch 能否拦截 |
|---|---|---|---|
| Feed 卡片封面（IllustSingleCard/ImageCard → PixivImage） | PixivImage.tsx:50 `<img src={resolveImageUrl(src)}>` | 浏览器原生 `<img>` | ❌ |
| 用户头像（UserAvatar → PixivImage） | 同上 | 浏览器原生 `<img>` | ❌ |
| 详情页大图 prefetch（LazyDetailImage → loadImage） | imageLoader.ts:405 `fetchWeb` → :417 `fetchSingleWeb` | `fetch()` | ✅（但返回 JSON 会破坏解码） |
| 详情页带进度下载 | imageLoader.ts:375 `loadWithProgressWeb` → `fetch(proxyUrl)` | `fetch()` | ✅（同上） |
| 小说内嵌图尺寸测量 | novelImageDimensions.ts:66-68 worker.measureImages | fetch → Blob → worker | ✅（同上） |

**推论**：E2E 会话中 95% 以上的图片请求（Feed 封面 + 头像）是 `<img>` 标签请求，
`mockFetch` 一个都拦不住；能拦的 fetch 型 prefetch 又被"只能返回 JSON"限制卡死。
**mockFetch 方案整体不可行**——这不是参数调优问题，是机制边界问题。

### 2.2 三种可行的拦截机制（冒烟实测，2026-08-14）

| 机制 | 能否拦 `<img>` | 实测结果 | 能否产生可见占位图 |
|---|---|---|---|
| M1 `mockFetch`（window.fetch 包装） | ❌ | — | — |
| M2 `network route "**/pixiv-img/*" --body '<svg…>'` | ✅ | fetch 返回 `{"status":200,"ct":null}`；`new Image()` 实测 `loaded:false, error:true`（无 Content-Type，Chromium 不对 SVG 嗅探） | ❌ 与 abort 等效 |
| M3 `network route --abort` | ✅ | `new Image()` 实测 `loaded:false, error:true` → PixivImage 走"加载失败"降级 | ❌（图片全断） |
| M4 Vite dev 中间件（env 门控 `PICTELIO_PROTO_E_PLACEHOLDER=1`，`configureServer` 先于代理执行） | ✅ | curl 实测 `200 + Content-Type: image/svg+xml + SVG body` | ✅ 真实可见占位图 |

> M4 的中间件注入点：`vite.config.ts` 的 `server.middlewares.use()`（configureServer 钩子），
> 在 Vite 内置代理之前匹配 `/pixiv-img|pixiv-re|pixiv-nl/*`，返回 600×900 灰底 SVG。生产
> 构建（build 无 server）与未设 env 的 dev 完全不受影响。**注意：这是原型改动，勿并入正式代码。**

---

## 3. 实测数据（原型实验）

### 3.0 实验方法

- 原型 spec：`image-offload.prototype.test.ts`，4 个用例：
  - E0：Feed 首屏确定性健康度（imgs/decoded/broken/failedText 计数，`evaluate` 直接量测 DOM）；
  - E1：复制 main-flow 图片敏感 AI 断言"推荐 Feed 已加载出插画卡片瀑布流，展示多张作品缩略图"；
  - E2：滚动 1500px + 健康度 + AI 断言"滚动加载出新作品卡片，无白屏或错误"；
  - E3：真实点击首卡进详情 + 详情健康度 + AI 断言"展示大图、标题、作者、标签"。
- 三种模式（env `PICTELIO_PROTO_E_MODE`）：`off`（真实图）/ `abort`（路由前置注入 `--abort`
  于浏览器启动前，见下）/ `placeholder`（M4 中间件 + `PICTELIO_PROTO_E_PLACEHOLDER=1`）。
- 每会话记录：登录耗时、测试阶段耗时、图片请求总数（`network requests --json` 过滤）、
  HAR 字节与解码位图估算（`scripts/prototype-e-summary.mjs`，仅统计实际传输字节的条目）。
- 每模式完整跑 1 次（off 另取 2 次完整采样 + 2 次局部采样用于方差）。

### 3.1 三模式实测结果总表

| 指标 | off（真实图） | abort（全拦截） | placeholder（SVG 占位） |
|---|---|---|---|
| 登录耗时 | 9.0~9.2s（3 次） | 8.4~8.6s（3 次） | 10.3s |
| E0 健康度 decoded/broken/failedText | 2~4 / 0 / 0 | **0 / 2~3 / 0** | 4 / 0 / 0 |
| E1 Feed AI 断言 | ✅ ×3 | ✅ ×3 | ✅ |
| E2 滚动 AI 断言 | ✅ ×3 | ✅ ×3 | ✅ |
| E3 点击进详情 | ✅（CLI 真实点击） | ✅（偶发需重试，同套件既有 flake） | ✅（CLI 真实点击） |
| E3 详情健康度 decoded/broken/failedText | 4 / 0 / 0 | **0 / 0 / 3**（"加载失败"×3） | 3 / 0 / 0 |
| E3 详情 AI 断言 | ✅ | ❌（"大图未能正常展示"） | ✅ |
| 会话图片请求数 | 5~6 | 3~9（详情页请求更多但全被拦） | 6 |
| 会话图片字节（HAR） | ~218KB | **0B** | ~1KB |
| 会话解码位图峰值（估算） | ~5~7MB | **0MB** | <1MB（SVG 光栅化到元素尺寸） |
| 测试阶段耗时（不含登录） | 13.8~14.8s | 12.1~15.3s | 20.3s¹ |

¹ placeholder 的 20.3s 高于 off/abort，主因是 E2 的 AI 断言 LLM 延迟（10.1s）与固定
SLEEP(3s) 波动，**非图片相关**（图片只有 6 请求 ~1KB）；三模式时间差在单样本噪声内，
不做墙钟结论。abort 模式 E2 耗时 8.0~10.9s 与 off 8.0~8.5s 亦无显著差异。

### 3.2 关键机制细节（实验中发现）

1. **abort 路由必须前置注入**：登录窗口期（~9s）内 Feed 首屏图片已加载完成；`--abort`
   路由若在 `createLoggedInDriver()` 之后注入，E0 会显示 `decoded:4`（与 off 无异）。
   原型在浏览器启动前 `ab("network","route",...)`（daemon 级路由，先注册后 open），
   实测 E0 `decoded:0`，拦截生效。
2. **abort 下点击首卡的偶发失败**：abort 模式下 E3 首卡 CLI 点击曾连续 2 次不导航
   （off/placeholder 首试即成功），重跑后成功——与套件既有"sub-flows 卡片点击 flake"
   同源（图片破裂引发重渲染、ref/坐标失效），**不是 abort 的确定性破坏**，但会放大 flake 面。
3. **图片请求数不因拦截而减少**：abort/placeholder 与 off 的请求数同级（5~9），拦截只省
   字节与解码，不省请求往返与 spawn（方向 D 不受影响）。

---

## 4. 四维度分析

### 4.1 高可维护性

| 方案 | 代码侵入 | 测试语义影响 | 维护结论 |
|---|---|---|---|
| mockFetch 占位图（文档原案） | 不可行，无需评估 | — | 从文档移除，避免后续会话重复踩坑 |
| M3 abort | driver 加 1 个 helper（`ab("network","route",p,"--abort")` ×3，~5 行），零 app 代码改动 | **详情页断言被击穿**（实测 ✗），只能用于 Feed 级流程 | 不能单独落地；若用，需在详情页用例显式关闭拦截（driver 需加 unroute 能力） |
| M4 Vite 占位图中间件 | vite.config.ts +~15 行（env 门控）+ globalSetup 注入 env | 全部断言通过（实测 4/4） | 可行；但引入"测试不再覆盖真实图片加载"的盲区（CDN 故障、代理错误会被占位图掩盖），须保留 ≥1 个 off 冒烟用例 |
| E-2 `--profile` | 改 fixtures/driver launch | 实测 app 空页（about:blank），不可用 | 不可落地，需先查 Chrome-for-Testing 自定义 profile 兼容性 |
| E-2 `--restore`/`--state` | 改 launch 参数 + 状态文件管理 | 免登录可行（A-2 重叠），图片缓存收益不成立 | 属方向 A-2 范畴，与 E 无关 |

**维护性结论**：唯一不破坏断言且改动可控的是 M4（Vite 中间件），但它以"测试盲区"为代价；
M3 改动最小但断言残缺。文档 E-1 需整体改写为"M3/M4 二选一"并写明取舍。

### 4.2 高性能

- 实测单会话：off 218KB 下载 + ~5~7MB 解码 vs abort 0+0 vs placeholder ~1KB+<1MB。
- 墙钟收益：**≈0~1s/会话**（图片请求少、与登录并行、不占关键路径）；全量 42 用例按
  21 个登录会话摊算 ≈ 0.5~1 min，慢网络上限 ~2 min。**低于文档"2~5 min / -1~3 min"估计**。
- 请求数不减：三模式 5~9 请求同级；若网络瓶颈是"往返数"而非"字节数"，收益进一步缩水。
- 与方向 D（batch 合并 spawn）无叠加冲突；与 A/B/C 正交，可独立落地。

**性能结论**：E 是六个方向中实测收益最小的一项；建议优先级低于 A/B/C/D。

### 4.3 高安全性

- 三机制均在测试域内运行（page-level mock / CDP 拦截 / dev-server 中间件），不触碰生产代码路径。
- **M4 中间件必须 env 门控**（`PICTELIO_PROTO_E_PLACEHOLDER=1`）：误开会把开发环境所有
  图片替换为占位图（仅 dev server 生效，build 不含 server，故无生产泄漏，但属于开发期脚枪）。
- **E-2 `--profile`/`--restore` 引入新的密钥工件**：profile 目录 / 状态文件内含 localStorage
  的 refresh_token（authStore 持久化），等同新 secret，须 gitignore + 定期清理；CI 共享
  机器上存在 token 泄露面。当前 .env 方案（gitignored）无此问题。
- mock 盲区：占位图/拦截会掩盖真实 CDN/代理故障与 SSRF 白名单路径回归，属"测试盲区"
  而非运行时安全风险，但会降低回归检测能力。

**安全结论**：测试域内风险低；M4 需 env 门控并文档化；E-2 若落地须按 secret 工件管理。

### 4.4 低内存占用

- 解码位图是 headless Chrome renderer 内存的大头（每张 master1200 ≈ 600×1200×4 ≈ 2.9MB，
  540×540 缩略 ≈ 1.2MB，实测 5~6 张 ≈ 5~7MB/会话）。abort 实测 0MB；placeholder 的 SVG
  光栅化到元素渲染尺寸（Feed 卡 ~350×500），远小于原图，估算 <1MB/会话。
- 图片字节在任何模式下**不进 JS 堆**（`<img>` 解码在 renderer 进程；fetchWeb 的 Blob 是
  瞬态对象，随 Promise 结束 GC），故 JS 堆内存三模式无差异；L1 LRU（`loadedKeys`，仅存
  URL 字符串，上限 500 条）亦不受影响。
- 网络下载内存（HAR 字节）off ~218KB vs abort 0 vs placeholder ~1KB，差异同样集中在
  renderer/网络层。

**内存结论**：abort 收益最大（100% 消除解码位图），placeholder 次之（~80%+），但绝对值
小（单会话 5~7MB，全量 21 会话 ~100~150MB 峰值摊算），对 CI 机器内存压力的缓解有限。

---

## 5. 落地建议（增量、可回滚）

1. **修正分析文档第 3 节 E**：将"mockFetch 拦截为占位图"改写为两条实测可行路径——
   `network route --abort`（M3，零侵入但击穿详情页断言）与 Vite dev 中间件占位图（M4，
   全断言通过但有测试盲区），并下调收益估计（0.5~1 min，上限 ~2 min）。
2. **若目标是全量套件提速**：选 M4 路线，步骤为 ① vite.config.ts 加 env 门控中间件（~15 行，
   原型已写好）② driver 加 `imagePlaceholderMode()` helper ③ globalSetup 在
   `PICTELIO_PROTO_E_PLACEHOLDER=1` 时以该 env 启动 dev server ④ 保留 1~2 个 off 冒烟用例
   （真实图片）兜底盲区。每步独立可回滚。
3. **若只求 Feed 级流程提速**：M3 一行注入即可，但详情页断言必须保持 off（详情页图片
   加载本身是"展示大图"断言的验收点，不应 mock）。
4. **E-2 暂缓**：`--profile` 实测不可用；`--restore` 的免登录收益并入方向 A-2 评估，
   图片缓存部分不成立，无需单独立项。
5. **原型的处置**：`image-offload.prototype.test.ts`、`prototype-e-summary.mjs`、
   `prototype-e-profile.mjs`、vite.config.ts 的 env 门控中间件均为 throwaway（标记 PROTOTYPE），
   按仓库惯例归档到一次性分支，不并入 main；vite.config.ts 的改动需回滚或保留为文档化门控。

---

## 6. 附录

### 6.1 原型与脚本清单

| 路径 | 作用 | 状态 |
|---|---|---|
| `packages/app/tests/agent-browser/prototype/image-offload.prototype.test.ts` | 三模式实验 spec（off/abort/placeholder，env 控制） | throwaway |
| `packages/app/scripts/prototype-e-summary.mjs` | HAR 字节/解码内存汇总（忽略 size=-1 的中断条目） | throwaway |
| `packages/app/scripts/prototype-e-profile.mjs` | E-2 `--profile` 持久化验证（两次启动对比） | throwaway |
| `packages/app/vite.config.ts`（`PICTELIO_PROTO_E_PLACEHOLDER=1` 门控中间件） | M4 占位图实现 | 原型改动，勿并入正式代码 |
| `prototype-e-{off,abort,placeholder}.har`（packages/app/ 下） | 三模式网络流量记录 | 证据留存 |

### 6.2 关键实测证据（原始输出摘要）

- M2 `network route --body '<svg…>'`：fetch 响应头 `{"status":200,"ct":null,"len":null}`；
  `new Image()` → `{"mode":"svg-body","loaded":false,"error":true}`。
- M3 `--abort`：`new Image()` → `{"mode":"abort","loaded":false,"error":true}`。
- M4 中间件：curl `/pixiv-img/…` → `HTTP 200, Content-Type: image/svg+xml, body=<svg…>`。
- abort 详情页：`E3 详情健康度={"broken":0,"decoded":0,"failedText":3,"imgs":0}`，
  aiAssert 理由："页面存在错误提示：图片加载失败（出现多个⚠加载失败标记），大图未能正常展示"。
- E-2：`--profile /tmp/xxx open http://localhost:5173/` → `tab list` 仅 `→ [t1] about:blank`；
  20s 后 `document.body.innerText` 仍为空；对照（无 profile）5s 内渲染年龄确认页。
- 会话图片流量：off 5~6 请求 / 218KB / 解码峰值 ~5~7MB；abort 0B / 0MB；placeholder ~1KB。
