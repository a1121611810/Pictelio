# 视觉改动的验证手段：业界事实调研

> 调研日期：**2026-09-27**
> 覆盖范围：Web 侧像素级视觉回归（VRT）机制与工具、原生（Android）截图测试、VRT 的失效模式与 oracle 边界、语义/无障碍/设计令牌/动效与布局指标等互补断言层、AI 与 agent 参与视觉审查的能力与实测边界、治理实践
> 一手信源：官方文档与官方仓库源码（Playwright 文档源文件、`mapbox/pixelmatch` 的 `index.js`、`takahirom/roborazzi` / `cashapp/paparazzi` / `microsoft/playwright-mcp` / `dequelabs/axe-core` / `GoogleChrome/web-vitals` / `reg-viz/reg-cli` / `garris/BackstopJS` 的 README 与生成源、`figma` REST API 文档、MDN CSS 媒体特性页）、arXiv 论文原文摘要页
> **图例**：✅ 一手已验证 ｜ 🟡 二手/推断，未验证 ｜ ❌ 已验证为「不存在」｜ — 未找到可验证证据（≠ 没有）
>
> ⚠️ **A–F 是客观事实调研。** G 节「对 Pictelio 的候选落地路径」是调研者推演，**不是已决方案**。

---

## 0. T;DR（可执行结论）

1. **VRT 的能力边界由"基线从哪来"决定，与 diff 引擎好坏无关。** Playwright 官方文档写明：首次执行时它「**took a bunch of screenshots until two consecutive screenshots matched**, and saved the last screenshot」——基线由**被测实现自己**产出（[P1]）。故 VRT 是表征测试而非合规测试：**能发现"变了"，发现不了"一开始就错"**。这是 oracle 问题的视觉版本，与本仓库 `ai-generated-test-quality.md` 的 mutation-testing 结论同源。
2. **"零误报"不可达，稳定化是工程投入而非配置开关。** Playwright 警告渲染随 **宿主 OS、版本、系统设置、硬件、电源状态（电池 vs 适配器）、headless 模式**变化，要求「在生成基线的同一环境里跑测试」（[P1]）。BackstopJS 提供 `--docker` 消除跨平台差异并配图展示 Linux/macOS **文字渲染**差异（[B1]）。Roborazzi FAQ 直言跨 macOS/Ubuntu/Windows 失败是**已知问题**，「没有任何环境能保证渲染完全一致」（[R1]）。
3. **差分引擎的 AA 处理是关键分歧点，且有物理上限。** `pixelmatch` 默认 `includeAA: false`（跳过 AA 检测）、`threshold: 0.1`；AA 判据来自 Vysniauskas 2009 的 *Anti-aliased Pixel and Intensity Slope Detector*；颜色距离已从 YIQ 改为 **OKLab + HyAB** 并对近黑做 toe 校正（[P2]）。但 AA 检测**无法区分"亚像素抖动"与"低对比度边缘真平移 1px"**。
4. **小差异会静默通过，取决于工具的精度下限。** BackstopJS 官方：Resemble 的 `misMatchPercentage` **只能检测 0.01% 以上的差异**，更小的阈值须手开 `usePreciseMatching`；而 `misMatchThreshold` **默认 0.1**（[B1]）。两条叠加 = 默认配置下 **< 0.1% 的视觉变化完全不报错**。
5. **原生侧已有成熟的"JVM 内截图"路线。** Paparazzi（Cash App）「不用真机或模拟器就能渲染界面」，golden 落源码目录 `src/test/snapshots`，`record`/`verify` 两个 Gradle task 分离（[PP1]）。Roborazzi 基于 **Robolectric Native Graphics**（`@GraphicsMode(NATIVE)`，需 4.10+），同样跑在 JVM，理由写得很直白：「设备测试会因为设备环境频繁失败，产生**假阴性**且难以复现」（[R1]）。
6. **Roborazzi 官方文档有一句话直接命中"AI 审查截图"的失效模式**：「**AI agents are bad at judging small layout changes from screenshots** — 让它『给按钮上方加个 margin』，它常声称『已修复』而其实什么都没动。」解法是给**精确坐标**让它读，而不是让它看图（[R1]）。
7. **"AI 版 VRT"已有具体工程实现，但官方自定为实验特性**：Roborazzi 的 **Experimental AI-Powered Image Assertion**（`assertionPrompt` + `requiredFulfillmentPercent`），且**只在两张图不同时才跑**——「因为慢且贵」（[R1]）。
8. **VLM 判视觉差异的公开实测是 79%，且需微调。** XBIDetective（arXiv 2512.15804）在 1,052 个网站上找跨浏览器渲染不一致，微调 VLM 达 **79%**（动态元素 84%、广告 85%）（[X1]）——意味着**五分之一会判错**，不足以做 CI 门禁。
9. **但"更小、更结构化"的差异是 VLM 的明确弱项。** ASE 2026 论文 *Pattern over Pixels*（arXiv 2608.03691）：5 个前沿 MLLM 在"从截图恢复被遮蔽的宽度/字号"上，卡片宽度扰动**平均偏置率 69.78%**、字号扰动 **80.22%**，而准确率仅 **21.17%** / **7.89%**；论文指出模型「**能识别出异常元素，却仍用模式一致的答案覆盖它**」（[X2]）。
10. **agent 浏览器的官方立场是"别用截图做判断"。** Playwright MCP 工具描述原文：`browser_take_screenshot` —「你**不能**基于截图执行操作，请用 `browser_snapshot`」；`browser_snapshot` —「**这比截图更好**」；README 特性写「使用可访问性树，**而非基于像素的输入**」「无需视觉模型」「**确定性的工具调用，避免基于截图的方法常见的歧义**」；基于坐标的点击被放在 **`--caps vision` 之后默认关闭**（[M1]）。
11. **"读结构化坐标"已有现成一手实现。** Playwright MCP 的 `--snapshot-boxes` 在快照里附 `[box=x,y,width,height]`（来自 `getBoundingClientRect`，视口相对 CSS 像素）（[M1]）；Roborazzi 的 `.uitree.json` 是原生版，明确「**同一 UI 产出逐字节一致的 JSON**（无时间戳、无哈希）」，故数值变化即真实布局变化（[R1]）。
12. **自动化 a11y 检查是"部分覆盖"而非合规证明，且一批规则默认关闭。** axe-core 规则表带 `Issue Type` 列，大量 A/AA 规则标 `failure, needs review`（含 `color-contrast`、`image-alt`、`button-name`、`html-has-lang`）（[X3]）。**补充（wayfinder #798，源码级核对 axe-core `develop` 4.13.0 全量 105 个 rule JSON）**：默认 tag 排除**仅** `['experimental','deprecated']` 两条，`enabled: false` 的规则**只有 9 条**——文档虽以「WCAG 2.2 整节默认禁用」表述，**代码里是逐条 `enabled:false`，没有按等级批量启用的开关**。`target-size`（2.5.8）需显式开启才查得到，但**成因是该等级下本就仅此一条**（`wcag22aa` tag 全仓库只有它）。⚠️ 且即便开启：`target-size` 实际检查 **24×24 / 24px 间距**（`minSize`/`minOffset` 默认 24）**且需 `isWidgetType` + `isFocusable` + `isInTabOrder` 三者同时成立**，**比本项目 40×40 硬约束宽松** ⇒ **不能**作为 40×40 的机器防线；该约束改由坐标数值层用几何断言承担（wayfinder #790）。
13. **布局稳定性有官方可断言指标，但覆盖有硬限制。** `onCLS()` **仅 Chromium**；含 iframe 时实测的是 DCLS 而非 CLS；页面后台加载时 CLS/LCP/FCP 不上报；attribution build 可给 `largestShiftTarget`/`Time`/`Value` 定位到元素（[W1]）。
14. **Figma Variables 可经 REST API 读取，"设计源→代码"漂移检测技术上可行。** Figma REST API 有独立 **Variables** 章节（与 Components and styles、Webhooks、Rate Limits 并列），全量 OpenAPI 规范开源并提供生成的 TS 类型（[F1]）。
15. **治理共识形态是"基线变更当代码变更 review"。** Playwright 要求提交 `*.spec.ts-snapshots/` 并「**review any changes to it**」（[P1]）；BackstopJS 是显式 `test → approve`（[B1]）；Paparazzi 建议 golden 走 **Git LFS** 并配 pre-receive 钩子"发现未用 LFS 提交即快速失败"（[PP1]）；Roborazzi 的 CI 范式是 main 分支 record→存 artifact，PR 分支下载 main 的 artifact 再 verify（[R1]）。

---

# A. 像素级视觉回归（VRT）：机制与工具

## A.1 Web 侧基准：Playwright `toHaveScreenshot()`（[P1]）

| 机制 | 官方原文要点 |
|------|-------------|
| 基线生成 | 首跑生成参考图，后续与之比对；**基线自稳定**：「took a bunch of screenshots until **two consecutive screenshots matched**, and saved the last screenshot」 |
| 环境要求 | 渲染随 **host OS / version / settings / hardware / power source (battery vs. power adapter) / headless mode** 变化；「**run tests in the same environment where the baseline screenshots were generated**」 |
| 基线命名 | `example-test-1-chromium-darwin.png` = 测试名 + 浏览器 + 平台；「you will need **different snapshots for them**」 |
| 格式 | 默认 PNG；`.webp` 后缀或 `expect.toHaveScreenshot.type='webp'` 存**无损 WebP** |
| 更新 | `npx playwright test --update-snapshots` |
| **交互态污染** | 专设「Hover effects」节：「Screenshots capture any hover effects present at the moment」；规避法 `page.mouse.move(-1, -1)` |
| 稳定化 | `stylePath`：注入自定义样式表，「filtering out dynamic or volatile elements, hence **improving the screenshot determinism**」 |
| 引擎 | 使用 **pixelmatch**，可传 `maxDiffPixels` 等 |
| 治理 | 快照落 `my.spec.ts-snapshots/`，「You should **commit this directory to your version control, and review any changes to it**」 |
| 非图像 | `expect(value).toMatchSnapshot(name)` 对文本/二进制比对，自动选算法 |

> **对判据的影响**：默认快照名带平台，等于把"跨平台渲染不一致"从失败变成**多份基线**——它保证"同一环境下没变"，不保证"所有平台一致"。

## A.2 差分引擎语义：pixelmatch（[P2]）

- **颜色距离不再是 YIQ**：使用 **OKLab**（Ottosson 2020）+ **HyAB**（Abasi et al. 2019），`Lr` 用 toe 校正「avoids over-expanding near-black image/display differences while preserving the black-white 0..1 scale」。
- **默认参数**：`threshold=0.1`（OKLab HyAB 最大可接受距离，1.0=黑白距离，「smaller is more sensitive」）、`includeAA=false`、`alpha=0.1`、`aaColor=[255,255,0]`、`diffColor=[255,0,0]`、`diffColorAlt`、`diffMask=false`、`checkerboard=true`。
- **AA 判据**：`antialiased()` based on **"Anti-aliased Pixel and Intensity Slope Detector" (Vysniauskas, 2009)**；要求**两侧图像**的极值邻居都满足 `hasManySiblings()`（3 个以上同色邻居）才判为 AA。
- **`windowSize`（默认 `Infinity`）是新增的关键语义**：「If finite, return the **maximum number of diff pixels found in any N×N sliding window** instead of the total diff count」——阈值从"整图差异总数"变为"**最差局部窗口**的差异数"，局部小区域的大改动不再被大面积相同背景稀释。
- **有意保留旧度量**：`brightnessDelta` 注释解释为何不改用 ΔL——「switching to ΔL both **regressed AA detection on dark regions** and was much slower」。

> **🟡 推断**：AA 豁免逻辑无法区分"亚像素抖动"与"低对比度边缘真平移 1px"。深色主题（Fluent dark / M3 dark）边缘对比度更低，两者更难分辨——这解释了 Roborazzi 为何专门提供 `vShift`/`hShift` 让比较器**平移容差**（[R1]）。

## A.3 独立 CLI 与托管方案

**reg-cli**（[RG1]）
- 差分引擎从纯 JS 换成 **Rust → WebAssembly（WASI threads）**：对照 `reg-cli@0.18.16`，20×1280×720 加速 1.14×、100 张 1.35×、1 张 4K 加速 **2.86×**。
- 三层阈值且有明确优先级：`--matchingThreshold`（0–1，调「**the YIQ pixel-difference threshold**」）→ `--thresholdRate` → `--thresholdPixel`（「**takes precedence over thresholdRate**」）。**注意它仍用 YIQ**，与 pixelmatch 的 OKLab 不是同一套。
- **`--enableAntialias` 默认关闭**；`--ignoreChange` 让变化不报错；`--extendedErrors` 让「**新增/删除的图片也报错**」（默认只有内容变化报错）。
- `reg.json` 区分 `failedItems` / `newItems` / `deletedItems` / `passedItems`——**"图没了"与"图变了"是两个独立信号**。
- `--diffFormat` 默认 **webp**，「~5× smaller diff artefacts」。CI 矩阵**不含 Windows**（Node 内建 WASI 返回 `EINVAL`）。

**BackstopJS**（[B1]）
- 治理形态是显式三段式 `init → test → **approve**`；「Approving changes will update your reference files with the results from your last test」。
- **项目健康信号**：README News 段写「**BackstopJS needs a new maintainer/owner**」。
- **精度下限（关键）**：默认用 Resemble 的 `misMatchPercentage`，而它「**only detects mismatches above 0.01%**」；要更小的 `misMatchThreshold` 须手开 `usePreciseMatching`。而 `misMatchThreshold` **默认 0.1**。`requireSameDimensions` **默认 true**（尺寸变化单独即失败）。
- 动态内容两条不同语义：`hideSelectors` → `visibility:hidden`（**保留布局占位**）；`removeSelectors` → `display:none`（**移出布局流**）。文档更推荐「use a known static content **data stub**」。
- 抗 flaky 三件套：`readySelector` / `readyEvent` / `delay`。
- 跨环境：`--docker`「to eliminate cross-platform rendering shenanigans」，配图展示 Linux vs macOS **文字渲染**差异。`referenceUrl` 支持 staging vs prod 对比。
- 成本锚点：`asyncCaptureLimit` 默认 10、`asyncCompareLimit` 默认 50，「**100MB RAM plus approximately 5 MB for each concurrent image comparison**」。

**托管方案**：**Percy** 的 per-snapshot 选项含 `percyCSS`（官方示例 `img { animation: none !important; }` 冻结动画）、`minHeight`、`sync`，并自动捕获 cookie 复现会话；`percyThrowErrorOnFailure` **默认 false**（「errors are suppressed」）（[PC1]）。Chromatic / Applitools / Argos CI 本轮**未读到一手 README**，只在对比表以 🟡 标注存在性（见存疑清单）。

## A.4 原生侧（本项目最相关的一层）

**Paparazzi（Cash App）**（[PP1]）
- 定位：「render your application screens **without a physical device or emulator**」。
- 三个 task 分离：`recordPaparazziDebug` 把 golden 存**源码目录**（默认 `src/test/snapshots`）；`verifyPaparazziDebug` 与已记录 golden 比对，diff 落 `build/paparazzi/failures`；`testDebug` 顺带产 HTML 报告。
- **Golden 存储纪律**：推荐 **Git LFS**，并给 pre-receive 钩子在 CI 上比对「files that match .gitattributes filter to those actually tracked by git-lfs」，不一致即 exit 1。
- **值得抄的原则**：故意**不**全局设置 `LocalInspectionMode`，「to ensure that the snapshot represents the **true production output**」——即承认截图是"实现 × 环境"的函数。
- 坑：Lottie 动画须强制同步执行否则抛异常。许可 Apache-2.0。

**Roborazzi（Robolectric Native Graphics）**（[R1]）
- **核心理由**：「Device testing can result in **frequent failures due to the device environment, leading to false negatives**… hard to reproduce」。
- 与 Paparazzi 的关系：「Paparazzi is a great tool for visualizing displays within the JVM. However, it's **incompatible with Robolectric**」——Roborazzi 补的正是这个洞。需 Robolectric 4.10-alpha1+ + `@GraphicsMode(GraphicsMode.Mode.NATIVE)`。
- Task 三件套：`record` / `compare`（产 `[original]_compare.png` + JSON diff）/ `verify`（有差异即失败）/ `verifyAndRecord`（**先 verify，失败才重录**）。
- 抗锯齿调参：`CompareOptions(changeThreshold = 0.01, SimpleImageComparator(maxDistance = 0.007F, vShift = 2, hShift = 2))`，注释直说「**Increasing the shift can help resolve antialiasing issues**」。
- 设备/外观矩阵：`RobolectricDeviceQualifiers.Pixel5` / `MediumTablet`、`+night`、`+ja`（locale）。
- **Compose Preview 截图测试**：经 `ComposablePreviewScanner` 把 `@Preview` 变成 golden；README 给了 **Android vs Compose Desktop 特性对照表**，明确桌面端 `@Preview(device=)` 不适用、`uiMode` 只认 night 位。`@PreviewWrapper`（Compose UI 1.11+）自动包裹。
- **动效时序**：`@RoboComposePreviewOptions(manualClockOptions = [ManualClockOptions(advanceTimeMillis = 516L)])` 让截图落在**指定虚拟时刻**——这是"动效实现对不对"能在 JVM 上确定性验证的关键。
- 环境坑（直接相关）：「**Robolectric Native Graphics doesn't work properly on older SDK versions**」，建议 **API 28+**（本项目 `minSdkVersion = 28` 恰在下限）；阴影异常开 `robolectric.pixelCopyRenderMode="hardware"`；OOM 需 `unitTests.maxHeapSize="4096m"`。
- 其他：实验性 WebP（**默认有损**需另加 lossless imageio）、Compose Desktop 与 iOS 目标（iOS 因 CoreGraphics 预乘 alpha 对半透明有精度损失）、`captureRoboGif()` / `recordRoboVideo()`、IDEA 插件、独立 `roborazzi-accessibility-check` 模块、`separateOutputDirs` 修 Gradle task 竞态（Gradle 9 会硬失败 `Cannot access input property 'roborazziImageInput'`）。Apache-2.0。

---

# B. VRT 的失效模式与 oracle 边界

## B.1 已确认的失效模式

| 失效模式 | 一手证据 | 业界应对 |
|---------|---------|---------|
| **跨平台/跨主机渲染不一致** | Playwright 警告列举 host OS/版本/设置/硬件/**电源状态**/headless（[P1]）；BackstopJS 配图（[B1]）；Roborazzi FAQ「no guarantees for identical rendering across all environments」并援引 Now in Android issue（[R1]） | 同环境 record+verify（[P1][R1]）；`--docker`（[B1]）；JVM 渲染绕开设备（[PP1][R1]） |
| **抗锯齿与字体渲染** | pixelmatch 的 AA 豁免与 detector（[P2]）；Roborazzi `maxDistance`/`vShift`/`hShift` 专治 AA（[R1]）；reg-cli `--enableAntialias` 默认关（[RG1]）；BackstopJS 依赖 Resemble `ignoreAntialiasing`（[B1]） | 放大 `threshold`；平移容差；开 AA 豁免；`--docker` 统一字体环境 |
| **小差异静默通过** | BackstopJS 0.01% 精度下限 + 默认阈值 0.1%（[B1]）；pixelmatch `threshold=0.1`（[P2]） | 显式设更小阈值 + `usePreciseMatching`；`requireSameDimensions` 单独兜尺寸 |
| **hover / focus 瞬时态** | Playwright 专设「Hover effects」节（[P1]） | 截图前移出指针；`stylePath` 压制 |
| **动态内容** | Playwright `stylePath` 定位即「filtering out dynamic or volatile elements」（[P1]）；BackstopJS 建议静态 stub（[B1]） | `stylePath`/`hideSelectors`（保布局）/`removeSelectors`/`percyCSS`；最佳是数据 stub |
| **基线缺失/被误删** | Playwright 首跑报错（[P1]）；reg-cli `newItems`/`deletedItems`（[RG1]） | 快照目录纳入 VCS review（[P1]）；开 `extendedErrors`；单独盯"图少了" |
| **基线被默认审批** | `backstop approve` 一条命令覆盖 reference（[B1]）；`--update-snapshots` 一条命令重录（[P1]） | 基线 diff 当 PR artifact review；`verifyAndRecord` 明确"失败才录"（[R1]） |
| **误报淹没 CI** | Roborazzi AI 断言定位即「runs **only when the images are different**… because it can be **slow and expensive**」（[R1]） | 分级门禁（见 E 节） |

## B.2 关键论点：基线自产 ⇒ VRT 只能发现"变化"

三条独立一手证据指向同一结论：

1. **Playwright 官方自陈基线来源**（[P1]）：首跑连拍直到连续两张一致，**把最后一张存为参考**。基线即"当前实现的输出"，不是"设计意图的输出"。
2. **Roborazzi 把 VRT 定位写成回归而非合规**（[R1]）：「validate your app's **appearance**… tests the app **as users would use it**」——表征语言，不是合规语言。
3. **Paparazzi 承认渲染环境会改变截图**（[PP1]）：故意不启用 `LocalInspectionMode`，理由正是要反映「**true production output**」。

> **结论**：VRT 的期望值（基线）与被测实现同源，**对 oracle 缺陷是结构性盲区**——实现一开始就错时，基线会把错误固化，此后每次 diff 都绿。这与 `ai-generated-test-quality.md` 中 mutation testing「假设测试期望值本身正确」是同一条逻辑的视觉版本。**该层不能替代"独立期望值"层**（设计令牌 spec / 参考图 / ARIA 断言 / 显式数值断言）。
>
> **唯一突破路径是引入基线之外的独立 oracle**——正对应 A.4 的 `assertionPrompt`、C.1 的 ARIA 快照、C.3 的令牌检查。

---

# C. 与 VRT 互补、但能直接断言"对的"的层次

## C.1 语义与可访问性树断言

- **Playwright 内建 ARIA 快照断言**（[P2b]）：`expect(page).toMatchAriaSnapshot(expected)`（v1.60 新增），断言「page body matches the given accessibility snapshot」；也可存成独立的 **`.aria.yml`**，路径由 `pathTemplate` / `snapshotPathTemplate` 配置。期望值是人可读的 YAML（`- heading "todos"` / `- textbox "What needs to be done?"`），与图像基线一样进版本库 review。
- **该层的核心价值**：期望值是人写的 **role + accessible name**，**不依赖实现的像素输出**——**不满足 B.2 的自产基线缺陷**。
- **Playwright MCP 把它做成产品定位**（[M1]）：`browser_snapshot` 描述为「**this is better than screenshot**」；`browser_find` 支持在快照里按文本/正则检索并只回传匹配节点（「cheaper than capturing the whole snapshot」）；`browser_verify_element_visible` / `browser_verify_text_visible` 是显式结构化断言（需 `--caps=testing`）。
- **坐标进快照**（[M1]）：`--snapshot-boxes` 让快照附 `[box=x,y,width,height]`，来源 `Element.getBoundingClientRect`，**视口相对 CSS 像素**——"布局数值对不对"由此变成可断言的数值断言。

## C.2 自动化 a11y 检查（axe-core）与能力边界

axe-core 规则表元数据本身就是边界证据（[X3]）：
- `Issue Type` 列取值 **`failure`**（可判失败）/ **`failure, needs review`**（命中但需人工复核）/ **`needs review`**。`color-contrast`、`image-alt`、`button-name`、`input-button-name`、`html-has-lang`、`form-field-multiple-labels`、`bypass`、`aria-hidden-focus` 等大量 A/AA 规则带 `needs review`。
- 分节启用状态：**Best Practices**（"do not necessarily conform to WCAG success criterion"）、**WCAG 2.x AAA**（「**disabled by default in axe-core**」）、**Experimental**（「**disabled by default**」）、**Deprecated**（默认禁用，下个大版本移除）。
- **WCAG 2.2 的禁用是「文档按节表述、代码按条实现」——#798 更正**：`rule-descriptions.md` 确实有 `## WCAG 2.2 Level A & AA Rules` 节标题并写「These rules are disabled by default, until WCAG 2.2 is more widely adopted and required.」（该节当前只列 `target-size`，**2.5.8 "Ensure touch targets have sufficient size and space"**）。**但源码级核对**（axe-core `develop` 4.13.0，`lib/rules/*/*.json` 全量 **105 个 rule** + `rule-should-run.js`）显示：默认 tag 排除**仅** `['experimental','deprecated']` 两条，`enabled: false` 的规则**只有 9 条**，`wcag22aa` tag 下**全仓库只有 `target-size` 一条**。⇒ **没有「按等级批量禁用」的开关**：文档的「整节」是**归组表述**，代码里是**逐条 `enabled:false`**。⚠️ **实践影响**：**无法靠调 tag 批量启用某等级**，必须逐条开；开启后仍可能因规则前置条件而零命中。
- **`target-size` 即便显式开启也不足以守住本项目 40×40 硬约束**（#798 补，#792 实测）：实际检查 **24×24 或 24px 间距**（`minSize` / `minOffset` 默认 **24**），**比 40×40 宽松**；且需 `isWidgetType` + `isFocusable` + `isInTabOrder` **三者同时成立**才生效。⇒ 40×40 由**坐标数值层几何断言**承担（wayfinder #790 #787）。
- 规则带 `cat.*` 分类（`color`/`keyboard`/`name-role-value`/`structure`/`forms`/`parsing`/`aria`/`text-alternatives`/`semantics`/`sensory-and-visual-cues`/`time-and-media`/`tables`/`language`）与 **W3C ACT 规则哈希**，给出可追溯编号。Roborazzi 另有独立 `roborazzi-accessibility-check` 模块（[R1]）。

## C.3 设计系统一致性：令牌漂移检测

- **Figma Variables 可经 REST API 访问**（[F1]）：Figma REST API 侧栏有独立 **Variables** 章节（`/docs/rest-api/variables-endpoints/`），与 "Components and styles"、Webhooks、Rate Limits、Activity logs、Dev Resources 并列；base `https://api.figma.com`，鉴权 access token 或 OAuth2；全量接口由 **OpenAPI 规范**（`figma/rest-api-spec`）描述并提供生成的 TS 类型。
  → **🟡 推论**：只要令牌以 Figma Variables 承载，「拉取 → 与代码令牌 diff → 失败即报」在技术上成立，且期望值来自**设计源**而非实现，**不满足 B.2 的缺陷**。
- Style Dictionary / Tokens Studio / Stylelint 本轮**未读到一手文档**，不对其机制下论断（见存疑清单）。
- **与本项目的对应（推断）**：`packages/app` 令牌集中在 `src/styles/tokens.css`、排版令牌在 `uno.config.ts` 的 preflights——这种"单一事实源 + 构建期零转换"结构天然适合**静态一致性检查**（禁硬编码色值、禁非 Fluent 缓动），因为期望值（AGENTS.md 禁止清单）是**外部规格**而非渲染输出。

## C.4 布局与动效正确性

**CLS / LCP / INP（web-vitals）**（[W1]）
- 支持 Core Web Vitals（CLS/INP/LCP）+ FCP/TTFB。
- **浏览器支持是硬边界**：`onCLS()` — **仅 Chromium**；`onFCP/onINP/onLCP/onTTFB` — Chromium/Firefox/Safari；软导航需 **Chromium 151+**。
- **可能不上报**：「INP is not reported if the user never interacts… **CLS, FCP, and LCP are not reported if the page was loaded in the background**」。
- **iframe 盲区**：「no visibility into `<iframe>` content (not even same-origin)」，故「`onCLS()` technically measures **DCLS** rather than CLS, if the page includes iframes」。
- 阈值常量：`CLSThresholds = [0.1, 0.25]`、`INPThresholds = [200, 500]`、`LCPThresholds = [2500, 4000]`。
- **attribution build 给出可断言的定位**：`largestShiftTarget`（选择器）/`largestShiftTime`/`largestShiftValue`/`largestShiftEntry`/`loadState`；INP 给出 `interactionTarget`/`inputDelay`/`processingDuration`/`presentationDelay`。
- 调用纪律：「**Avoid calling the Web Vitals functions repeatedly per page load**… may eventually result increased memory overhead」。

**prefers-reduced-motion**：MDN 定义该特性为「detect if a user has enabled a setting on their device to **minimize the amount of non-essential motion**… the user **prefers an interface that removes, reduces, or replaces motion-based animations**」（[MD1]）。它**可在测试中显式模拟**——Playwright MCP 的 `browser_emulate_media` 就有 `reducedMotion`（另有 `forcedColors`、`contrast`、`colorScheme`、`media`）（[M1]），故"是否尊重 reduced-motion"是**可自动化断言**的，不必看图。

**尺寸与溢出**：`toHaveScreenshot` 的 `mask`、pixelmatch 的 `windowSize`、BackstopJS `requireSameDimensions` 提供尺寸/局部区域兜底（[P1][P2][B1]）；专门的"元素溢出检测"官方工具本轮未核实。

---

# D. AI / agent 参与的视觉审查：能力与实测边界

## D.1 工具侧官方立场：结构化优先，截图为辅

Playwright MCP 的一手表述（[M1]）：
- README 特性：「**Uses Playwright's accessibility tree, not pixel-based input**」/「**No vision models needed, operates purely on structured data**」/「**Deterministic tool application**. Avoids ambiguity common with **screenshot-based approaches**」/「Fast and lightweight」。
- `browser_take_screenshot`：「Take a screenshot of the current page. **You can't perform actions based on the screenshot, use browser_snapshot for actions.**」
- `browser_snapshot`：「Capture accessibility snapshot of the current page, **this is better than screenshot**」。
- **坐标驱动是 opt-in 且默认关闭**：`--caps vision` 才启用 `browser_mouse_click_xy` / `_drag_xy` / `_wheel`。
- 截图开关 `--image-responses allow|omit|only`；设备 `--mobile`（Chromium 下 Pixel 10、WebKit 下 iPhone 17）/ `--device`。
- 另一条视觉路径 `browser_annotate`（`--caps=devtools`）：「Open the Playwright Dashboard in annotation mode and **wait for the user to draw annotations**. Returns the **annotated screenshot, ARIA snapshot, and the list of annotations**」——**人机协同**，非模型自动判断。

## D.2 失效模式的第一手证据：模型读不出"细小的布局变化"

**Roborazzi 官方 UI tree dump 章节**给出了本主题最直接的一手材料（[R1]）：

> 「**AI agents are bad at judging small layout changes from screenshots** — ask one to "add margin above the button" and it will often claim "fixed" when nothing moved. The deterministic UI tree gives it **exact coordinates to check** instead, so the agent can read the button's bounds before and after and **prove the change actually landed**.」

其解法形态（一手）：
- 截图旁写 **`.uitree.json`** 侧车文件（Compose semantics + View 层级）。「The sidecar is **informational only**: it **never participates in image diffing and never fails verification**」——不进入像素门禁，是给 agent 读的旁证。
- `bounds` 为 `[left, top, right, bottom]`，单位是**原始（未缩放）窗口像素**；根 `capture` 对象带 `imageWidth`/`imageHeight`/`scale`。
- 「Output is **deterministic**: the same UI produces **byte-identical JSON** (no timestamps, no hashes)」——故「any change in the numbers is a **real layout change, not noise**」。
- 编号 `n` 只打在**可标注节点**（可见且有 test tag / `Text` / `ContentDescription`，或有 action）；`MergeDescendants` 节点的子节点跳过。
- 配套 **Set-of-Mark 标注图**（`.annotated.png`），引用 **Yang et al. 2023（arXiv:2310.11441）**：「overlaying numbered marks on image regions lets a model refer to a region unambiguously by its number」。该图「is a **display artifact of the current run only** — never compared, never failing a capture, never treated as a golden」。
- 官方范式即"读 before → 改 → 读 after → 比数值"，并示范**几何关系断言**：「To prove a *gap*, also compare the sibling above: its `bottom` vs this `top`」——**几何关系**，不是"看起来对不对"。

## D.3 VLM 直接判视觉差异的公开实测

| 研究 | 任务 / 样本 | 结果 |
|------|-----------|------|
| **XBIDetective**（Mozilla 等，arXiv 2512.15804，cs.SE，2025-12-16）（[X1]） | Firefox + Chrome 各截图，VLM 找**跨浏览器视觉不一致**；**1,052 个网站**；现成 VLM + **微调 VLM** | 微调 VLM：跨浏览器差异 **79%**、动态元素 **84%**、广告 **85%**。自陈用途含「automated regression testing, large-scale monitoring, rapid triaging」 |
| **Pattern over Pixels**（arXiv 2608.03691，**ASE 2026**，DOI 10.1145/3832783.3834443）（[X2]） | 重复 UI 模式中扰动**一个**局部元素的宽度/字号，遮蔽后让模型从截图+HTML 恢复；Design2Code 的 30 页 → **1,440 张**截图，**5 个前沿 MLLM** | 卡片宽度扰动**平均偏置率 69.78%**、准确率仅 **21.17%**；字号扰动偏置率 **80.22%**、准确率仅 **7.89%**。最佳模型 Codex-5.3 从卡片 68.61% 掉到文字 13.89%；Flash-3.0 文字偏置率 **96.11%**。结论：「**models can identify the anomalous element and still override it with the pattern-consistent answer**」，且「**Noise, subtler perturbations, and boundary positions further increase bias rate**」 |

> **两条合读**：79% 的**粗粒度**识别（X1）说明 VLM 在"明显不一样"上有用，但 21% 错误率对 CI 门禁不可接受；21.17%/7.89% 的**细粒度数值恢复**（X2）说明 VLM 在"差几 px / 字号差一档"上**几乎不可用**，失败模式是**被模式覆盖**——与 Roborazzi 文档的"声称已修复但什么都没动"是同一现象的量化版。X2 指出更大推理投入与更低偏置相关，但"识别到却仍被覆盖"说明**提高推理预算不能消除该失效模式**。

**已有的"AI 断言"工程实现**——Roborazzi 的 **Experimental AI-Powered Image Assertion**（[R1]）：模块 `roborazzi-ai-gemini`（走 `generative-ai-kmp`）与 `roborazzi-ai-openai`（Ktor 直调 HTTP）；断言形态 `AiAssertion(assertionPrompt = "it should have PREVIOUS button", requiredFulfillmentPercent = 90)`，返回 `fulfillmentPercent` + `explanation`；**触发策略**「runs **only when the images are different**… because it can be **slow and expensive**」⇒ 它是**像素 diff 的下游分诊器**而非替代品；公开 `AiAssertionModel` 接口并给出「You can use **local LLMs or other LLMs**」示例，**不锁死托管服务**；密钥要求「**DO NOT HARDCODE your API key**」。

---

# E. 治理与工程实践

1. **基线变更 = 代码变更**。Playwright 要求提交 `*.spec.ts-snapshots/` 并「review any changes to it」（[P1]）；BackstopJS 的 `approve` 是显式审批动作（[B1]）；**Roborazzi 的 CI 范式**（[R1]）：main job `recordRoborazziDebug` → `upload-artifact`（`retention-days: 30`）；PR job 用 `dawidd6/action-download-artifact` 拉 **main 分支**的基线到同一路径 → `verifyRoborazziDebug` → **`if: always()`** 上传 diff 图 / HTML 报告 / `test-results`；另有示例仓库把 diff 以 **PR 评论**展示。
2. **Golden 存储手段**：Paparazzi 走 Git LFS + pre-receive 防漏（[PP1]）；reg-cli 默认 WebP「~5× smaller」（[RG1]）；Playwright 可切无损 WebP（[P1]）；Roborazzi 实验性 WebP **默认有损需另加 lossless**（[R1]）。→ 基线库体积是真实治理成本。
3. **并发与成本锚点**：BackstopJS「100MB + 5MB/并发」，capture 10 / compare 50（[B1]）；reg-cli 并发默认 4 且「below 20 images we fall back to single-threaded」（[RG1]）；Roborazzi 需 `maxHeapSize=4096m` 量级堆（[R1]）；Playwright 需预装浏览器。
4. **误报率的共同处理模式**（从一手材料反推）：把昂贵/易错检查放在便宜检查**下游**（AI 断言"仅图不同时跑"）；"图少了"与"图变了"分两个信号（`newItems`/`deletedItems`）；尺寸变化从像素变化里拆出单独判（`requireSameDimensions`）；AA 噪声从真实差异剔除（`includeAA`）。
5. **人工与自动的组合**：可读到的一手形态是「自动 verify 阻断 + artifact / PR 评论供人复核」+「`approve` 作为显式人工动作」+「AI 分诊只在有 diff 时介入」。⚠️ **未找到任何一手来源给出"抽检比例"或"可接受误报率"的量化标准**。

---

# F. 工具能力对比表

> 「原生 WebView」列 = 能否直接驱动 Android `WebView` 内的页面；「Lynx 视图」列 = 能否渲染/对比 `@lynx-js/*` 产出的视图树。二者均以**本轮读到的官方能力陈述**为准，未读到的一律标 🟡 或 —，**不做"做不到"的断言**。

| 工具 | 覆盖层次 | 运行时 | CI 成本量级 | 原生 WebView | Lynx 视图 | 主要误报来源 | 许可/费用 |
|------|---------|--------|-----------|-----------|-----------|------------|---------|
| **Playwright `toHaveScreenshot`** ✅[P1][P2] | 像素（+`toMatchSnapshot` 文本/二进制）✅ | 浏览器（chromium/firefox/webkit）✅ | 需预装浏览器 + dev server；并行分片原生 ✅ | 🟡 需自建桥接（无官方 WebView 驱动） | — | 跨平台渲染/AA/字体/hover/动态内容（官方逐条列出）✅ | Apache-2.0 免费 ✅ |
| **Playwright `toMatchAriaSnapshot`** ✅[P2b] | **语义 / a11y 树**（YAML）✅ | 同上 ✅ | 极低（无像素比对）✅ | 同上 🟡 | — | 语义树变化（通常是真回归）✅ | Apache-2.0 ✅ |
| **pixelmatch** ✅[P2] | 差分算法（库）✅ | 平台无关 ✅ | 纯计算；Wasm 后 4K 单图 0.66s 量级 ✅ | ✅ | ✅ | AA 豁免误判 / threshold 过大 ✅ | MIT ✅ |
| **reg-cli** ✅[RG1] | 像素 + HTML/JUnit/JSON 报告 ✅ | Node 20+ ✅ | 20–100 张亚秒~秒级；并发 4 ✅ | 🟡 需自配截图器 | — | 新增/删除默认不报（需 `--extendedErrors`）✅；AA 默认关 ✅ | MIT ✅ |
| **BackstopJS** ✅[B1] | 像素（Resemble.js）✅ | Chrome Headless / Playwright，可选 `--docker` ✅ | 100MB + 5MB/并发 ✅ | 🟡 | — | **默认精度下限 0.01%** ✅；AA 依赖 Resemble ✅ | MIT ✅，**官方招募新 maintainer** ✅ |
| **Paparazzi** ✅[PP1] | 像素（JVM 内渲染 View/Compose）✅ | **无设备/无模拟器**，纯 JVM ✅ | 极低 ✅ | ❌ 只渲染 View/Compose | ❌ 无支持 | Lottie 异步、SDK 版本、阴影渲染 ✅ | Apache-2.0 ✅ |
| **Roborazzi** ✅[R1] | 像素 + **UI tree JSON** + **Set-of-Mark** + 实验性 **AI 断言** + a11y check ✅ | **JVM**（Robolectric 4.10+ RNG）✅ | JVM 堆 4GB 量级；无设备 ✅ | ❌ 不驱动 WebView ✅ | ❌ 无支持 | **跨 OS 渲染不一致（官方承认为已知问题）**✅；AA 需调 `vShift`/`hShift` ✅；SDK<28 ✅ | Apache-2.0 ✅ |
| **Percy** 🟡[PC1] | 像素 + 云端审批 + 多浏览器矩阵 | 云（BrowserStack） | SaaS | — | — | `percyThrowErrorOnFailure` **默认 false** ✅ | 商业 🟡 |
| **Chromatic / Applitools / Argos CI / looks-same / resemblejs / Loki / ApprovalTests / Verify / jest-image-snapshot** — | — | — | — | — | — | — | 未读到一手 README，见存疑清单 |
| **axe-core** ✅[X3] | **无障碍规则**（A/AA/AAA/BP/Experimental/Deprecated）✅ | 任意 JS 运行时 ✅ | 极低 ✅ | 🟡 需 WebView 内可注入 | ❌ Lynx 侧产物无 `role`/`aria-*`（#792 实证） | 大量规则 `needs review`；experimental/deprecated 默认禁用，另有 9 条 `enabled:false`（#798 更正，非按节批量禁用）✅ | MPL-2.0 ✅ |
| **web-vitals** ✅[W1] | CLS/LCP/INP/FCP/TTFB ✅ | 浏览器 API（`onCLS` **仅 Chromium**）✅ | 极低 ✅ | 🟡 WebView 版本支持未核实 | — | 后台不上报；iframe 盲区（DCLS≠CLS）✅ | Apache-2.0 ✅ |
| **Playwright MCP / agent 浏览器** ✅[M1] | 可访问性树 + 截图 + `browser_annotate`（人机协同）✅ | 浏览器 ✅ | 按会话计（token/工具调用） | 🟡 | — | 官方定位：截图**不可用于动作判断**，结构化树优先 ✅ | Apache-2.0 ✅ |

---

# G. 对 Pictelio 的候选落地路径（🟡 **推断与建议，非已决方案**）

> 本节全部是调研者推演。**A–F 是事实，本节是推论。** 每条标注依赖的上文事实编号，以及在「SolidJS+UnoCSS WebView 客户端 + Lynx 客户端 + Capacitor Android 容器」形态下的坑。
>
> **当前资产的一手确认**（本轮只读检索）：`packages/app/tests/agent-browser/driver.ts:664` 已有 `async screenshot(path?)`（委托 agent-browser CLI 的 `screenshot`，**只截图不比对**）；`packages/app/tests/android-e2e/driver.ts:265-287` 已有失败现场截图（优先 Appium `takeScreenshot()` → base64 写 `screenshot.png`，catch 后回退 `adb shell screencap` + `adb pull /sdcard/__e2e_shot.png`）——**同样只产 artifact**。对 `packages/app/tests/**` 检索 `screenshot|toMatchAria|ariaSnapshot|axe|prefers-reduced-motion|visual` 共 42 处命中，**无基线比对、无 axe、无 ARIA 快照、无 reduced-motion 断言**。`packages/app-lynx` 依赖为 `@lynx-js/web-core` / `vue-lynx` / `@lynx-js/rspeedy` / `vitest` / `fake-indexeddb` 等，**未见任何 Lynx 侧截图/视觉测试依赖**（这是"依赖层面未安装"，不等于"能力不存在"）。

## G.1 零成本（不改基建、纯流程）

| # | 建议 | 依赖事实 | 具体形态下的坑 |
|---|------|---------|---------------|
| 1 | **把"视觉基线更新"当需人看的代码变更**：新增/更新的基线必须在 PR 里被单独 review，commit message 写清"哪块变了、为什么变" | [P1]（提交并 review）、[B1]（显式 approve）、[R1]（PR 评论展示 diff） | 本仓库 `docs/research/` 下已有 7 个他人未跟踪文档 ⇒ **基线文件同样是并行会话的碰撞面**；必须按 [P1] 纳入 VCS review，不能本地静默重录 |
| 2 | **给现有 android-e2e 失败截图建立"人工抽检"节律**：发版前把 `screenshot.png` 按场景归档并人眼过一遍 | [B1]（approve 语义）、[R1]（record→artifact→verify 范式） | 这**不是**回归门禁，只是把已有 artifact 变成有纪律的检查；文档中不得称其为 VRT |
| 3 | **code-review 清单加一条"视觉改动的期望值从哪来"**——若答案是"从上一次截图来"，则该改动**不得**仅凭截图通过 | [B2]（基线自产只能发现"变化"）、[X2]（VLM 细粒度准确率 7.89%–21.17%） | 纯流程、成本最低：把 B.2 的结构性盲区变成显式人工拦截点，不依赖任何新工具 |
| 4 | **双客户端改动的"双份证据"要求**：同时动 `packages/app` 与 `packages/app-lynx` 的视觉改动，必须两侧各留一份证据才可合并 | 项目结构事实（双客户端双设计系统：Fluent 2 vs M3） | 纯推断、无对应业界一手来源；但直接对应"同一份设计意图要在两套体系各自验证"的困难 |

## G.2 低成本（少量新增依赖 / 脚本）

| # | 建议 | 依赖事实 | 具体形态下的坑 |
|---|------|---------|---------------|
| 5 | **先加"结构化坐标"断言，而不是像素比对**：借鉴 `--snapshot-boxes`（[M1]）与 `.uitree.json`（[R1]），在 WebView 客户端用 `getBoundingClientRect()` 产出确定性布局 JSON 侧车，断言"某元素 top 从 24 变 32"这类**数值事实** | [R1]（确定性 JSON、byte-identical、坐标可证）、[M1]（box 进快照）、[D.2]（agent 读不出细差→给坐标） | **坑 1**：需稳定选择器锚点（`data-testid` 之类），而 AGENTS.md 未规定 test-id 约定 ⇒ 属要一并引入的约定。**坑 2**：JSON 必须**无时间戳/无随机/无 hash**（[R1] 硬要求），否则退化成另一种 flaky。**坑 3**：`app-lynx` 是否有等价位置查询 API **未核实**，这层在 Lynx 侧可能直接做不了 |
| 6 | **令牌一致性静态检查**（期望值来自 AGENTS.md 禁止清单，不是渲染输出） | [F1]（Figma Variables 可经 REST API 读）、[B2]（外部规格不满足自产基线缺陷） | **坑 1**：AGENTS.md 禁止清单目前是**散文**，机器检查需先变成可执行规则表（`#xxx`/`rgb()`/非 Fluent 缓动/`duration-200` 等）——属新增产物。**坑 2**：一手确认仓库内**无 Figma 设计源** ⇒ [F1] 链路当前**没有上游可对**，短期只能做"代码内部令牌自洽"而非"设计→代码漂移" |
| 7 | **`prefers-reduced-motion` 显式模拟 + 断言**（而不是看图） | [MD1]（语义）、[M1]（`browser_emulate_media` 有 `reducedMotion`）、[C.4] | AGENTS.md 规定了 100/150/200/300/500ms 五档与四条曲线，**但未规定 reduced-motion 下的降级策略** ⇒ 先要有规格才能断言。另：`app-lynx` 能否设置/读取该偏好**未核实** |
| 8 | **补一条容器级契约断言**（系统栏 inset、安全区、首屏可见区域），而不是等截图 | [R1]（`bounds` 是"原始窗口像素" ⇒ 容器 inset 进入所有坐标）、[M1]（box 是"视口相对 CSS 像素"） | 纯推断：从两套坐标体系不同，可推出容器 inset 是一次真实转换点，转换错了截图与坐标都会错。**未做运行时验证** |

## G.3 需要基建（引入新 CI 环节）

| # | 建议 | 依赖事实 | 具体形态下的坑 |
|---|------|---------|---------------|
| 9 | **若要像素门禁，优先 JVM 侧（Roborazzi 路线）而非模拟器侧** | [R1]（设备测试"频繁失败→**假阴性**且难复现"）、[PP1]（Paparazzi 同理） | **致命坑**：两者只能渲染 **Android View / Compose**（[PP1][R1]），**不驱动 WebView、不支持 Lynx** ⇒ 对本项目**双客户端都不直接适用**。对本项目的价值主要在方法论（JVM 渲染、record/verify 分离、`maxHeapSize`/`pixelCopyRenderMode` 的坑） |
| 10 | **若要像素门禁，WebView 客户端走 Playwright + 同环境 record/verify** | [P1]（同名警告 + "run in the same environment" + 平台化快照名）、[P2]（`windowSize` 局部窗口判据） | **坑 1**：Playwright **无官方 Android WebView 驱动**，需自建桥接 ⇒ 成本远超"加个测试文件"（🟡 未验证）。**坑 2**：快照名带平台 ⇒ CI 换 runner 镜像就是一批新基线。**坑 3**：放宽阈值会直接吞掉细间距错误（[B1] 的 0.1%/0.01% 双下限是前车之鉴）。**坑 4**：本项目**无任何 VRT 基础设施**，数据 stub、时钟控制、hover 规避、mask 需全部从零建 |
| 11 | **不要把 VLM 视觉审查放在阻断位** | [X1]（79%⇒21% 误判）、[X2]（细粒度 7.89%/21.17%，"识别到异常仍被模式覆盖"）、[M1]（官方："不能基于截图执行操作"）、[D.4]（Roborazzi 自定为"仅图不同时运行"的实验特性） | 若要用，形态应照 [R1]：**像素 diff 的下游分诊**（只在有 diff 时跑），输出 `fulfillmentPercent`+`explanation` 供人判，且必须可换本地模型（`AiAssertionModel`）。**成本坑**：官方明说 "slow and expensive" |
| 12 | **真机/模拟器矩阵只作发版前人工抽检位，不作 PR 门禁** | [R1]（设备假阴性）、[P1]（渲染随硬件/电源变化）、[E]（Roborazzi 官方 CI 范式：record 在 main、verify 在 PR） | 本项目已有 19 个 `android-e2e` spec（手动按需 + `transition-matrix.spec.ts` @release-gate）⇒ 视觉抽检位可**挂在同一 release-gate 节点**，不新增环节。**注意**：[B1] 的 `--docker` 思路在真机矩阵下不适用（真机差异比容器更大） |
| 13 | **把 Lynx 侧列为独立且当前"能力未知"的缺口** | 一手确认：`app-lynx` 依赖中无 Lynx 截图/视觉测试库；Lynx 官方是否有截图/测试工具链**本轮未核实** | 本项目**最大未知**。在 Lynx 侧视觉验证能力被确认前，任何"双客户端都有视觉门禁"的方案都是空中楼阁 |

## G.4 关键分界（给项目决策的核心结论）

| 层次 | 能发现"实现本身就错"？ | 只能发现"相对上一次变了"？ | 依据 |
|------|----------------------|--------------------------|------|
| 像素 VRT（截图基线比对：Playwright / Roborazzi / Paparazzi / reg-cli / BackstopJS） | ❌ **不能**（基线由实现自产） | ✅ 能 | [B2] 三处一手证据 |
| VLM 审查截图 | 🟡 理论上是（不依赖历史基线），但**实测不足以当门禁**：粗粒度 79%、细粒度 7.89%–21.17% | ✅ 能 | [X1][X2] |
| 语义 / ARIA 快照（`toMatchAriaSnapshot`） | ✅ **能**（期望值是人写的 role + accessible name） | ✅ 能 | [P2b] |
| 自动化 a11y 规则（axe-core） | ✅ **能**（对照 WCAG/ACT） | ✅ 能 | [X3] |
| 令牌 / 样式规则静态检查（期望值来自规格） | ✅ **能**（外部规格/设计源） | ✅ 能 | [F1] + [B2] 推论 |
| 布局坐标数值断言（bounding box / uitree JSON） | ✅ **能**（显式数值或几何关系） | ✅ 能 | [R1][M1] |
| 动效降级断言（`prefers-reduced-motion` 模拟） | ✅ **能**（期望值来自规格） | ✅ 能 | [MD1][M1] |
| CLS / LCP / INP（web-vitals） | ✅ **能**（对照官方阈值） | ✅ 能 | [W1] |
| 人工看截图 | ✅ 能 | ✅ 能 | 唯一不依赖工具就能发现"一开始就错"的手段 |

> **一句话**：**像素层只能做"变化检测"，做不了"正确性检测"；要能判"一开始就错"，期望值必须来自基线之外**——规格文本、WCAG 规则、设计源令牌、显式数值，或一个人。这与本仓库 `ai-generated-test-quality.md` 的主结论完全一致：两份调研是同一条逻辑在视觉领域的两个投影。

---

# 来源清单

> 全部于 **2026-09-27** 实际抓取并逐条阅读。

> 说明列只标注该源**独家提供**的事实（细节见正文对应编号处），不重复正文。

| # | URL | 独家提供的关键事实 |
|---|-----|------------------|
| P1 | https://raw.githubusercontent.com/microsoft/playwright/main/docs/src/test-snapshots.md | "two consecutive screenshots matched" 基线自稳定；渲染环境警告含**电源状态**；平台化快照名；无损 WebP；`stylePath` 定位；提交快照目录并 review |
| P2 | https://raw.githubusercontent.com/mapbox/pixelmatch/master/index.js | OKLab+HyAB 与 toe 校正；`threshold=0.1`/`includeAA=false`；**`windowSize` 滑窗最大差异**；Vysniauskas 2009 AA 判据 |
| P2b | https://playwright.dev/docs/api/class-pageassertions | `toMatchAriaSnapshot`（v1.60）两重载、`.aria.yml`、`pathTemplate` |
| RG1 | https://raw.githubusercontent.com/reg-viz/reg-cli/master/README.md | Wasm 加速倍率；三层阈值优先级；`--enableAntialias` 默认关；`newItems`/`deletedItems`；`--extendedErrors` 语义 |
| B1 | https://raw.githubusercontent.com/garris/BackstopJS/master/README.md | `approve` 语义；**Resemble 0.01% 精度下限** + `usePreciseMatching`；`--docker` 跨平台文字渲染差异；100MB+5MB/并发；**"needs a new maintainer/owner"** |
| PP1 | https://raw.githubusercontent.com/cashapp/paparazzi/master/README.md | "without a physical device or emulator"；golden 落源码目录；**Git LFS + pre-receive**；**不设 `LocalInspectionMode` 以反映生产输出** |
| R1 | https://raw.githubusercontent.com/takahirom/roborazzi/main/README.md | **设备测试→假阴性**；与 Paparazzi 的 Robolectric 不兼容；`vShift`/`hShift`；Compose Preview Android↔Desktop 对照；`ManualClockOptions`；**UI tree dump JSON（byte-identical、不参与 diff）**；**Set-of-Mark + arXiv:2310.11441 + "AI agents are bad at judging small layout changes"**；**Experimental AI 断言（仅图不同时跑、可换本地模型）**；SDK≥28；`maxHeapSize=4096m`；`separateOutputDirs` 竞态 |
| M1 | https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md | "not pixel-based input"、"No vision models needed"、"**不能基于截图执行操作**"、"better than screenshot"；`--caps vision` 默认关闭；`--snapshot-boxes`（`getBoundingClientRect`、视口相对 CSS px）；`browser_emulate_media` 的 `reducedMotion`/`forcedColors`/`contrast`；`browser_annotate`（需人画标注） |
| X3 | https://raw.githubusercontent.com/dequelabs/axe-core/develop/doc/rule-descriptions.md | `Issue Type` 三态；`target-size`(2.5.8)；ACT 规则哈希。**#798 补充**：文档以「WCAG 2.2 整节默认禁用」表述，但源码级核对（axe-core `develop` 4.13.0，`lib/rules/*/*.json` 全量 105 个 rule + `rule-should-run.js`）显示默认 tag 排除仅 `['experimental','deprecated']` 两条、`enabled:false` 仅 9 条、`wcag22aa` tag 下仅 `target-size` 一条 ⇒ **逐条生效，无按等级批量开关** |
| W1 | https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/README.md | **`onCLS()` 仅 Chromium**；后台不上报；**iframe→实为 DCLS**；阈值常量；`largestShiftTarget/Time/Value`；软导航需 Chromium 151+ |
| X1 | https://arxiv.org/abs/2512.15804 | XBIDetective：1,052 网站、**微调 VLM 79%**（动态 84%、广告 85%） |
| X2 | https://arxiv.org/abs/2608.03691 | Pattern over Pixels：**偏置率 69.78%/80.22%**、准确率 21.17%/7.89%、Flash-3.0 96.11%、"identify the anomalous element and still override it" |
| F1 | https://developers.figma.com/docs/rest-api/ | REST API **独立 Variables 章节**；Components and styles、Webhooks、Rate Limits；OpenAPI 规范与生成的 TS 类型 |
| MD1 | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion | "minimize the amount of non-essential motion"；"removes, reduces, or replaces motion-based animations" |
| PC1 | https://yarnpkg.com/en/package/@percy/cypress | `percyCSS` 冻结动画；**`percyThrowErrorOnFailure` 默认 false**；`@percy/migrate` 迁移 |
| — | https://playwright.dev/docs/test-snapshots | 与 P1 同内容的渲染版，交叉印证警告块与 "review any changes to it" 表述 |

---

# 未能核实 / 存疑清单

**工具层（未读到一手来源，不写入结论）**
- **Chromatic / Storybook Visual Tests addon**：`code-renderer/src/frameworks/react/README.md` → 404。仅由二手文章得知"每个 story 自动成为视觉测试"，**未核实**。
- **Applitools / Argos CI**：`argosi/argosi` raw README → 404。**仅存在性（🟡），机制完全未核实**。
- **ApprovalTests / Verify / jest-image-snapshot / looks-same / resemblejs / Loki**：`approvals/ApprovalTests` 的 `master` 与 `main` 两个 README 路径均 → 404。"approval / golden master 谱系"一支**只由 [B1][P1][PP1] 的 approve/update 机制反推角色定位，未直接引用其官方定义**。
- **Percy 当前状态**（免费额度、`@percy/agent` 废弃时间点、定价）：仅 [PC1] 可核实；"5,000 snapshots/月免费"与"@percy/agent 已 deprecated"**来自第三方博客**，本文档按 🟡 标注，**决策前应直接查 BrowserStack 官方定价页**。
- **Cypress × Percy 集成是否仍在维护**：未核实（仅间接证据：Changelog 最后条目为 2020-02）。
- **iOS 侧 XCTAttachment / swift-snapshot-testing、Flutter golden、React Native snapshot、Espresso screenshot、Shot**：全部未核实。
- **Android 官方 Compose Preview Screenshot Testing 文档**：`/jetpack/compose/ui/screenshot-testing` 与 `/develop/ui/compose/testing/screenshot-tests` **两个 URL 均返回 404**（`<title>` 为 `404 | Page Not Found`）。故 Compose Preview 截图测试**只能引用 Roborazzi 侧表述（[R1]），未引用 Google 官方表述**。正确 URL 需另行确认。
- **Figma Variables 端点的具体字段、写权限与 plan 限制**：仅确认 REST API **存在** Variables 章节（[F1]），未读端点细节。
- **Style Dictionary / Tokens Studio / Stylelint 的"design linting"能力**：未核实。
- **专门的"元素溢出检测"自动化工具**：未核实。
- **Testing Library guiding principles 原文**：`docs/guiding-principles.mdx` → 404。本文关于"查询哲学"只引用 Playwright 侧等价机制（[P2b][M1]），**未引用 Testing Library 官方文本**。

**项目侧（推断未经运行时验证）**
- **Playwright 驱动 Android WebView 的桥接可行性**：官方无此能力，一律标 🟡，**未做技术验证**。
- **`app-lynx` / Lynx 侧是否存在官方或社区的截图/视觉测试工具链**：**完全未核实**。已一手确认的只是"依赖里没装"。
- **G.2 #8「容器 inset 是坐标体系转换点」**：由 [R1]（原始窗口像素）与 [M1]（视口相对 CSS 像素）的差异推出，**未做运行时验证**。
- **"人工抽检比例"与"可接受误报率"**：业界一手来源中**未找到任何量化标准**，本文只描述机制未给数字。
- **CI 成本量级绝对数字**：除 BackstopJS 的「100MB + 5MB/并发」([B1]) 与 Roborazzi 的 `maxHeapSize=4096m` ([R1]) 外，**Playwright / Percy / Chromatic 的实际 CI 成本未取得一手数据**，对比表中的成本是相对表述。

**时效性提示（2026-09-27 口径）**
- pixelmatch 已切 OKLab+HyAB 并新增 `windowSize`；reg-cli 仍用 YIQ —— **两套主流 diff 引擎的颜色空间已不一致**，跨工具迁移基线时不能假设阈值等价（[P2] vs [RG1]，均为当日源码）。
- Playwright 快照命名含平台、`toMatchAriaSnapshot` 为 v1.60 新增 —— **API 形态在近几个大版本内变动明显**，采纳前应重新核对当前版本。
