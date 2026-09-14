# ADR-0147: 下载管理页底部动作栏在原生 LynxView 点击失效修复（absolute 覆层覆盖 `<scroll-view>` 的平台约束）

- 状态：accepted
- 日期：2026-09-10
- 关联：ADR-0123（全屏层规则 / 定位锚点 / `pointer-events` 平台约束，本次为同族新发现）、ADR-0111（`RefreshableList` 的正确对照实现）、ADR-0146（下载队列导出，本页功能来源）、`packages/app-lynx/src/pages/DownloadManager.vue`、`packages/app-lynx/src/components/GlobalFab.vue`、`docs/adr/glossary-app-lynx-hit-testing.md`
- 来源：用户要求「Lynx 引擎再跑一遍」的真机联调。发现下载管理页底部动作栏（开始/暂停/停止/分享/删除）**只有最左侧按钮偶发响应**；经模拟器逐项二分定位，确认根因并修复。
- 术语：见 `docs/adr/glossary-app-lynx-hit-testing.md`（本文档只记录决策，不写实现）。

## 背景

app-lynx 下载管理页（`/downloads`，ADR-0146）底部动作栏原本用 **`absolute` 覆层**盖在列表 `<scroll-view>` 之上。真机（模拟器 `emulator-5556`，原生 LynxActivity）实测：

| 布局 | 结果 |
|------|------|
| `fixed left-0 right-0 bottom-0` 全宽栏（带背景） | 5 个按钮**全部**收不到 `@tap`（logcat 有 `event: tap tag:N`，handler 不触发） |
| `absolute w-[92vw]` 居中胶囊（两行） | 仅最左按钮偶发响应，其余不动 |
| `absolute w-[92vw]` 单行 | 同上 |
| 去掉 `flex-wrap` / 去掉 `:class` 三元 / 显式 `w-[17.6vw]` | 无改善 |
| GlobalFab 式外层 (0,0) 零尺寸锚点 + `left/top` vw 定位 | 因 `screenHeightVw()` 回退值导致错位，未取得有效结论 |
| RefreshableList 式**逐个独立 absolute 叶子**（`left/bottom` vw + 显式宽高） | 无改善 |
| 去掉全宽 summary 元素 | 无改善 |
| **改为 in-flow（`scroll-view` `flex-1` + 动作栏占自身高度，不覆盖）** | **5 个按钮 + 删除弹窗全部正常** ✅ |

**关键对照**：同一 `@tap` 模式在**工具栏**（全选，`scroll-view` 之外）与**列表行内**（`scroll-view` 之内）均正常；只有「`absolute` 覆层 + 盖在 `<scroll-view>` 之上」失效。删除按钮的 handler 用临时状态读数验证过**确实未触发**（非弹窗不渲染）。

**根因**：原生 LynxView（本项目 lynx `4.0.1`）下，**覆盖在 `<scroll-view>` 之上的 `absolute` 元素不是可命中的触摸目标**——`<scroll-view>` 的原生滚动层在命中测试中胜出，其上的覆层（即使渲染在最上层、有背景、有 `@tap`）收不到 tap。这是 ADR-0123 同族的 hit-testing 平台约束（ADR-0123 记录的是「全屏层 + `pointer-events` 失效」与「定位锚点」，本条记录的是「`scroll-view` 覆层失效」）。

**为什么 `RefreshableList` / `GlobalFab` 的 FAB 不受影响**：它们的底层滚动容器是 `<list>`（或页面内容），不是 `<scroll-view>`；且这些 FAB 是**独立小体量 absolute 叶子**，不与 `<scroll-view>` 的命中面直接冲突。本次首版参考它们的形态仍失败，说明**关键变量是「`scroll-view` 之上的覆层」本身**，不是元素大小或锚点。

## 决策

1. **平台约束固化（不可变）**：**app-lynx 中，交互控件不得以 `absolute`/`fixed` 覆层形式盖在 `<scroll-view>` 之上**。底部/悬浮动作栏等交互控件必须：
   - 作为 `<scroll-view>` 的**兄弟节点参与正常文档流（in-flow）**，由 `scroll-view` `flex-1` 让出高度；或
   - 底层滚动容器改用 `<list>`（见 ADR-0111/0135 的滚动容器选型）。
   `pointer-events`、`z-index`、小体量、独立 absolute 叶子**均不能**解决 `scroll-view` 覆层失效。
2. **`DownloadManager.vue` 动作栏改 in-flow**：`scroll-view` 用 `flex-1 min-h-0`，动作栏为 `w-full flex flex-col items-center gap-1 py-2 bg-surface-container border-t` 的正常流兄弟节点；5 个动作按钮为行内 `view` + `@tap`（保留 `:accessibility-*` 与 `:class` 可用性禁用态）。
3. **删除二次确认弹窗**：改用 `absolute` + **显式 vw 坐标/尺寸**（scrim `left:0;top:0;width:100vw;height:220vw`，卡片 `left:12.667vw;top:70vw;width:74.667vw`），不再用 `fixed inset-0 flex items-center justify-center`（`fixed` 在该构建下不可靠；显式 vw 定位与 ADR-0123 的定位契约一致）。
4. **回归接缝**：
   - 单测：`downloadManagerTemplate.test.ts`（既有模板结构/无障碍断言模式）保持动作栏 `@tap` 与 `DOWNLOAD_A11Y_LABELS` 消费断言；如需，新增**负向断言**——动作栏不得是盖在滚动容器上的 `absolute` 覆层。
   - 真机：模拟器 LynxActivity 上逐项点验（本 ADR「验收」）。
5. **文档同步**：`glossary-app-lynx-hit-testing.md` 新增「滚动容器覆层约束（scroll-view overlay constraint）」词条。

## 被考虑的方案

- **保留 `absolute` 覆层，靠调小宽度/去掉全宽元素/改锚点解决**：上表逐项实测无改善。否决。
- **GlobalFab 式 (0,0) 零尺寸锚点 + `left/top` vw**：理论正确，但本页需要「贴底」定位，依赖 `screenHeightVw()`；实测该值在本页回退为兜底 `216.4vw` 导致动作栏落到屏幕外（GlobalFab 全局挂载时该值可用，页面级挂载时序不同）。否决（引入高度依赖，脆弱）。
- **把 `<scroll-view>` 换成 `<list>`**：可能可行，但改动面大（分组卡片结构、`v-for` 分组）。暂不采用；作为未来如需「悬浮动作栏」时的备选（须真机验证）。
- **在 web-core 预览验证通过即视为修复**：web-core 是浏览器语义，不出现该问题；ADR-0123 已确立「必须原生验证」。否决。

## 后果

**正面**：
- 下载管理页 Lynx 客户端动作栏全部可用：**开始**（Lynx 原生执行器桥，任务 `已暂停→已完成` 且持久化）、**分享**（拉起系统选择器 `com.android.intentresolver/.ChooserActivity`）、**删除**（二次确认，`仅清空记录` 保留文件 / `删除文件与记录` 删文件，MediaStore 实测正确）。
- 得到一条可复用的平台约束（`scroll-view` 覆层不可命中），避免后续页面重踩。
- 深模块零改动：`downloadManager`/`downloadExecutor`/`downloadsViewModel` 及其单测不受影响。

**负面/风险**：
- 动作栏占据布局高度（不再悬浮）——列表可视高度略减；换取命中可靠性，且与移动端既有「底部固定操作条」观感一致。
- 若后续要在滚动内容上做悬浮/吸底控件，必须走 `<list>` 方案或其它经验证的结构，不能直接回到 `absolute` 覆层。

## 验收

- [x] 模拟器原生（LynxActivity）：底部动作栏 5 个按钮均可点；`开始` 触发原生下载并完成（`download_queue_v1` 落盘 `completed/100`）。
- [x] `分享` 拉起系统选择器（`ResumedActivity` 变为 `com.android.intentresolver/.ChooserActivity`）。
- [x] `删除` 弹出二次确认；`仅清空记录` → toast「已清空记录」、列表清空、MediaStore 文件保留。
- [x] 列表渲染 / 全选 / 单行勾选 / 空态正常。
- [x] `pnpm check:app-lynx` 通过；`pnpm test:app-lynx` 897 单测全绿；`pnpm build:app-lynx` 成功。
- [x] 术语表同步（本 ADR 一并提交）。

## 相关文档

- docs/adr/glossary-app-lynx-hit-testing.md（新增「滚动容器覆层约束」词条）
- docs/adr/ADR-0123-app-lynx-fab-hit-testing-fix.md（同族约束）
- docs/adr/ADR-0146-download-queue-export.md（本页功能来源）
- packages/app-lynx/src/pages/DownloadManager.vue（修复实现）
