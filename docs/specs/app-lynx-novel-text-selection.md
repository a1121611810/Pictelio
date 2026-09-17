# Spec：lynx 小说正文长按选中与操作菜单（app-lynx）

> 父决策：wayfinder 地图 [#558](https://github.com/a1121611810/Pictelio/issues/558)（决策全清）｜设备实证 [#559](https://github.com/a1121611810/Pictelio/issues/559)｜复制通道 [#560](https://github.com/a1121611810/Pictelio/issues/560)｜路线定案 [#565](https://github.com/a1121611810/Pictelio/issues/565)
> 取证：`docs/research/lynx-text-selection-device-probe.md`（分支 `probe/text-selection-559` 含探针页与截图）
> 术语：`packages/app-lynx/CONTEXT.md`「正文选中」「操作菜单」「选中文本通道」

## Problem Statement

Lynx 客户端的小说详情页目前**无法选中正文文字**：段落是虚拟化列表里的 `<text>`，长按只有滚动行为，用户想复制一个句子、一个名词去搜索都做不到（只能整章导出）。webview 客户端有 DOM 选区但无自绘菜单，本 spec 只解决 lynx 端（#564 范围决策）。

设备实证（#559）确认：能力存在、但有三处会直接导致"预览正常、真机失效"的陷阱——`flatten=false` 是选中的硬前提、自绘菜单必须用**静态字面量属性**（动态布尔绑定被 vue-lynx 吞掉，引擎自带菜单不会被替换）、Lynx 运行时**没有 `navigator`**（无剪贴板可用）。

## Solution

正文段落的 `<text>` 开启**原生选中**（静态字面量 `text-selection="true"` + `flatten="false"` + `custom-context-menu="true"`），选中后由**自绘 M3 浮层工具栏**（复制 / 搜索）替换引擎自带菜单：

- **复制**：经新增的原生模块 `PictelioClipboard.setText` 写入系统剪贴板（Lynx 无内置剪贴板 API，见 #560），反馈为原位「已复制」。
- **搜索**：把选中文字交给全局搜索弹层 `openSearch(keyword)`（跳搜索页 + 预填，长文本先截断）。
- **定位**：`getTextBoundingRect`（内容区 dp）→ vw，置于选区上方、顶部越界翻转到下方；不依赖 `pointer-events`（ADR-0123），胶囊尺寸浮层。
- **消失**：点空白（引擎派发 `start=-1`）/ 列表滚动（**必须自行监听**——滚动不派发选中事件）/ 返回键（modalStack 三级语义）。

范围：段内选中（含整段）；跨段、划线、分享、翻译、webview 端、其他文本面均不做。

## User Stories

1. 作为 Lynx 客户端读者，我想长按正文选中一个字/一段话，使我能复制其中的片段。
2. 作为读者，我想拖动手柄把选中范围扩到本段任意位置（含整段），使长句复制不用分多次。
3. 作为读者，我想选中后立刻看到操作菜单（复制 / 搜索），且**不出现第二套系统菜单**。
4. 作为读者，我想点「复制」后剪贴板里就有选中的文字，并在原位看到「已复制」确认。
5. 作为读者，我想点「搜索」后进入搜索页且输入框已预填选中的文字，可编辑后再搜。
6. 作为读者，我想点空白处或开始滚动时菜单自动消失、选区被清除，使阅读不被打断。
7. 作为读者，我想按返回键时先关菜单、再清选、再返回上一页，使返回语义可预期。
8. 作为读者，我想选中态不会让我崩溃或错位（滚动经过被回收的段落也不崩）。
9. 作为读者，我想正文滚动性能不因为开启选中而变差。
10. 作为读者，若复制失败（模块不可用等），我想看到明确失败提示而不是「假装复制成功」。
11. 作为无障碍用户，我想菜单条目有可读的标签。

## Implementation Decisions

1. **属性契约（硬约束，防实证坑回归）**：段落 `<text>` 用**静态字面量**属性 `text-selection="true"` / `flatten="false"` / `custom-context-menu="true"`；**禁止**改用动态绑定（`:custom-context-menu="expr"` 被 vue-lynx 吞掉，实测引擎菜单不会被替换）。该约束由模板源级守卫测试钉住。
2. **段落结构不变**：仍是 `<list list-type="single">` + 每段一个 `<list-item>` + 单个 `<text>`（ADR-0134 虚拟化）；段落 `<text>` 增加稳定 `id`（`p-<idx>`）与 `:bindselectionchange`，`e.target.id` 即选中来源节点（实证：事件回传 target id）。
3. **选中状态（BG composable，纯逻辑可测）**：`composables/useTextSelection.ts` —— 持有 `{ id, start, end, text, rect }`；`onSelectionChange(e)` 解析 payload（`start === -1` → 清空并收起）；rect/text 走异步 selector query，回调落地前用 `(id, start, end)` 比对 **generation-gate** 丢弃过期结果（即时导航硬约束 3）。
4. **工具栏组件**：`components/TextSelectionToolbar.vue`（新）——props `{ anchor, copied }`，emits `copy` / `search`；胶囊浮层（`bg-inverse-surface` + `text-inverse-on-surface` + `rounded-[var(--md-shape-medium)]` + `shadow-[var(--md-elevation-3)]`，既有先例 `App.vue` exitHint / M3 反色浮层）；条目触控 ≥40×40px；不铺全屏透明层。
5. **定位（纯函数可测）**：`primitives/selectionToolbarGeometry.ts` —— 输入 `rect`（内容区 dp）+ 内容区宽度，输出 vw 样式串；规则 = 水平居中于选区、优先置于选区**上方**、顶部越界**翻转到下方**；锚点语义 `(0,0)` 根 + `left/top vw` + `translate(-50%,-100%)`（ADR-0131/0123）。**1vw = 1% 内容宽度**；dp→px 用 density（实测 1vw = 3.6dp @1080/480dpi）。
6. **复制通道**：新增 Java 模块 `PictelioClipboardModule`（`@LynxMethod setText(String, Callback)`）——`ClipboardManager` + `ClipData.newPlainText` + `setPrimaryClip`；**注册只需 `LynxRuntimeInitializer` 一处**（#560 实证：Share/Downloader/WebDav 均 global-only 且设备可用）；**禁止向 `Callback.invoke` 传 null**（真机 `CallbackImpl` 崩溃，`PictelioGalleryModule` 先例）；Android 13+ 系统自带剪贴板预览，**不加自家 toast**。TS 侧 `utils/lynxClipboard.ts`：本地 interface + cast + 缺失时 `console.warn` **并返回失败**（先例 `utils/downloadSharer.ts` / `lynxShare.ts`；web-core 预览即走此降级、不得假成功——#568 教训）。
7. **搜索通道**：`useSearchSheetStore().openSearch(keyword)`（跳搜索页 + 预填 + 一次性消费，既有入口先例 `Recommended.vue` / `NovelList.vue`）；长文本截断为纯函数 `truncateForSearch()`（取首个非空行，上限 30 字）。注意 `openSearch` 幂等：弹层已开时关键词被吞 —— 实施时若需要，在 store 增补显式语义（不改动既有调用点行为）。
8. **消失时机**：① 空白点击 = 引擎 `start === -1` 事件（实证可靠）；② 列表滚动 = 自行监听（`@scroll` 需 `scroll-event-throttle="0"`，ADR-0110 勘误；或复用既有 MT 信号），滚动即收起并清选；③ 返回键 = 工具栏挂载时 `useModalStack().registerModal(dismiss)`（房屋模式，先关菜单 → 再清选 → 再返回）；④ 章节切换/卸载清理（generation-gate）。
9. **复制反馈**：菜单原位把「复制」条目标为「已复制」，~2s 后整条收起；失败则原位显示「复制失败」（可见失败，禁静默降级）。
10. **i18n**：新增 `novelDetail.selection.copy` / `.search` / `.copied` / `.copyFailed`（zh-CN + en 双份，`satisfies Dict` 编译期完整性）。
11. **无障碍**：菜单条目 `:accessibility-element` + `:accessibility-label`，标签入 `utils/accessibility.ts` 表（房屋惯例）。
12. **不改动**：正文段落结构、虚拟化参数、滚动性能路径、导出流程；webview 客户端不动。

## Testing Decisions

- **纯逻辑单测（node）**：`useTextSelection`（事件解析、`-1` 清空、generation-gate 丢弃过期回调、dismiss 清选）、`selectionToolbarGeometry`（上方/越界翻转、dp→vw 换算、边界值）、`truncateForSearch`（单行/超长/空输入）、`lexClipboard` 工厂（**IO 边界成功 + 失败双路径**，禁静默降级——AGENTS.md 测试硬约束 1/3）。
- **契约测试**：Java 模块名/方法名与 TS 侧一致（从 `PictelioClipboardModule.java` 源码提取常量比对，参考 `backupRulesConsistency.test.ts` 模式）；模块注册在 `LynxRuntimeInitializer` 存在（源级断言）。
- **模板源级守卫**（防实证坑回归，最高价值）：`NovelDetail` 段落 `<text>` 含静态字面量 `text-selection="true"` / `flatten="false"` / `custom-context-menu="true"`，且**不得出现** `:custom-context-menu` 形式的动态绑定；工具栏为 root 内 absolute 胶囊（不铺全屏层）。
- **Java 单测**：`PictelioClipboardModule` 成功/失败路径（Robolectric，先例 `PictelioGalleryModuleTest`）。
- **不新增 E2E**：`custom-context-menu` 在 web-core 预览零实现（#559 实证）→ 预览无法验证；真机/模拟器验收走清单（见下）。
- **验收口径**：模拟器（R11S 口径 AVD）长按正文 → ① 出选区与手柄 ② 只出现自绘菜单（无引擎「复制/全选」叠加）③ 点复制后粘贴到输入框可见同文 ④ 点搜索后搜索页输入框预填 ⑤ 滚动/点空白后菜单消失 ⑥ 返回键先关菜单；`check:app-lynx` / `test:app-lynx` / `lint` 全绿；**正文滚动无肉眼劣化**（若需要，用既有 bench-scroll 口径对比 flatten=false 前后，作为一次性核查而非门禁）。

## Out of Scope

- **跨段连续选中**（`custom-text-selection` 手势层自研；程序化 `setTextSelection` 能力已实证可用，将来需要时不缺机制）。
- **划线 / 持久高亮批注**（需批注数据模型 + 跨章位置索引 + 列表内渲染，另立地图）。
- **分享选中文字、翻译选中**（分享为文件通道；lynx 无 AI 翻译能力）。
- **webview 客户端**（DOM 体系另一条实现线）。
- **lynx 其他文本面**（评论正文、插画简介）。
- 回收重建后选中保留性的专项取证（已记入地图 Not yet specified，实施后按需补）。

## Further Notes

- **建议落 ADR**（实施时随本 spec 产出）：*lynx 文字选中与自绘菜单契约*——三条不可从代码自明的事实：① 选中属性必须静态字面量（动态绑定被 vue-lynx 吞）② select 类属性必须配 `flatten=false`（扁平化视图不可选）③ Lynx 运行时无 `navigator` → 剪贴板须自建原生通道。
- 实现分支：`feat/lynx-text-selection`（本 spec 所在分支）；探针资产在 `probe/text-selection-559`（可复用的取点脚本与截图）。
- 验证限制：预览（web-core）对自绘菜单零支持，任何"预览看起来没问题/有问题"都不构成验收证据。
