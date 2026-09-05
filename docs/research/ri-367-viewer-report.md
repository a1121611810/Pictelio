# FT-4 查看器翻页反馈治理报告（#367 / 地图 #361）

- 分支 `fix/ri-367-viewer`（= FT-3 合并态 + 本票）；日期 2026-09-05；emulator-5554（pictelio_ui），webview flavor debug 4.32.0
- 证据：`ri-367-evidence/`（viewer2/viewer3 轮询序列）+ 本报告

## 黑屏机制定位

翻页在手势中段（deltaX>50px）即切页：新页若未加载且无 LRU 预览 → Layer1（blur 占位）/Layer2（原图）都不挂载，只剩 Layer3 的 **48px 细环 spinner + 30% 黑遮罩**（存在但对比度极低，录屏/肉眼均近黑）→ 等待 ~2s 原图下载完成才淡入。即「黑屏静帧」= 等待态视觉反馈不足 + 无预取。

## 修复（commit `feat(app): 查看器邻页预取…`，单 commit）

1. **邻页预取**：当前页原图加载完成后，自动预取前后一页（`neighborPages` 纯函数 + createEffect；loadingStarted 去重，与既有点击加载路径合流）。翻页时多数情况直接命中已加载——**等待窗口整体消失**。
2. **预览图异步加载**：未进 LRU 的页并行下小图（loadImage），翻到即有 blur-up 可看（Layer1 的 `previewFor` = LRU 同步 ∥ 异步结果），不再纯黑。
3. **等待态可见性**：spinner 48px 细环 → 64px 3px 环 + 「加载第 N/M 页」页码文案（Fluent token），预取未命中时等待明确可感知。

## 验证（screencap 轮询，多图作品实翻）

- 打开查看器：即出全屏图（既有 61ms blur-up 正向基线保持）。
- 翻页（swipe 600,640→120,640）：**第 2 页即时呈现**（轮询 s06→s15：第 1 页深色泳衣 → 第 2 页白色背心已完全渲染，无黑屏帧、无 spinner 介入）——预取命中口径。
- 翻页后静止（bit-identical）为静态图片页的正确终态。
- 门禁：fmt/lint 0 警告 + tsc + **1241 单测全绿**（+5：neighborPages 边界/跳过语义）。

## 局限

- 预取未命中场景（快速连翻超过预取窗）仍有等待，此时新等待态（大 spinner + 页码 + 可能的 blur 预览）保证可感知反馈——该口径未在本次录屏中复现（预取命中率 100%），如实记录。
- 邻页预取会提前消耗一张原图的下载流量（每次翻页窗口最多 2 张），与首页 Feed 预取（FEED_PREFETCH_COUNT=12）同类权衡。
