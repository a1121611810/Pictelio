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

**模块地图（2026-09-17 `codebase-design` 四方案比对后定稿：取「调用方零知识」的入口形状 + 「注入式深模块」的依赖形状）**

| 模块 | 文件 | 性质 |
|---|---|---|
| **深模块** `createTextSelection(deps)` | `src/primitives/createTextSelection.ts` | 状态机：事件解析 → 本地切片 → 异步测矩 → 定位 → 收起 → 动作执行；**不 import Vue / Pinia / `lynx` 全局**，依赖注入（房屋先例：`createWatchlistPrompt` / `createBookmarkToggle`） |
| **Vue 薄绑定** `useTextSelection({ paragraphs })` | `src/composables/useTextSelection.ts` | 组装生产适配器 + 段落源变化收敛 + `onScopeDispose(dispose)`；**页面唯一逻辑入口** |
| **视图** `TextSelectionToolbar.vue` | `src/components/` | 哑组件：`items` / `style` 进、`action` 出；`style == null` 自行不渲染（忘记 `v-if` 也不会画出幽灵层） |
| **纯核** | `src/primitives/selectionToolbarGeometry.ts`、`src/primitives/truncateForSearch.ts` | dp→vw 换算、水平居中、上方优先 / 越界翻转；搜索关键词截断。node 单测 |
| **适配器** | `src/utils/lynxSelectionEngine.ts`（测矩 + 内容宽校准 + 尽力清选）、`src/utils/lynxClipboard.ts`（原生模块探测；缺失 warn + reject） | 每个自带环境探测与**显式失败**（不假装成功） |
| **原生** | `app/src/lynx/java/io/pictelio/app/PictelioClipboardModule.java` + `LynxRuntimeInitializer` 一行注册 + `PictelioClipboardModuleTest.java` | 见下方 ID 6 |

**页面需要知道的全部（接口）**：`useTextSelection({ paragraphs })` → `{ rootId, paragraphId(idx), onSelectionChange(e), onScroll(), view: { visible, style, items, copyState }, copy(), search(), dismiss(), dispose() }`；模板只接 5 处：根 `<view :id="rootId">`、段落 `<text>` 三条静态字面量 + `:id` + `:bindselectionchange`、`<list :scroll-event-throttle="0" @scroll="…">`、`<TextSelectionToolbar>` 置于 `</list>` 之后。

**不变式（实现必须守）**
1. **索引即身份**：`start` / `end` 是**该段渲染文本**的字符索引（实证：`start=10,end=11` ↔ 该段第 11 字）→ 选中文字本地 `slice` 得出，**不需要 `getSelectedText`**。越界 / 纯空白 → 收起 + `console.warn`。
2. **动作前校验**：执行 `copy` / `search` 时，捕获的段落文本必须仍等于当前 `paragraphs[i]`，否则 warn + 收起 + no-op（防回收重建后复制到别的段落）。
3. **定位先于显示**：只有测矩成功才给 `style`；失败保持隐藏 + warn——不猜位置、不渲染在 `(0,0)`。
4. **dp→vw 用实测内容宽**（根 view 的 `boundingClientRect`；与 `getTextBoundingRect` 同源同单位）：**不得引入 density 常量、`SystemInfo`、`getViewportSize`**（后者是物理 px，探针里正是用错基准导致菜单落在屏幕上部）。
5. **异步结果全等落地**：`(id, start, end, generation)` 四项全等才应用；拖手柄的事件风暴合并到最后一次。
6. **可见性 ⇔ modalStack 注册**：隐藏态绝不持有注册（悬空注册会白吞一次返回键）；`search()` 先收起自己再 `openSearch`（弹层注册落后进先出）。
7. **复制无乐观态**：`copied` 只在通道 resolve 后出现；失败显示「复制失败」并 warn（#568 教训：禁假成功）。
8. **滚动收起**：BT `@scroll` + `:scroll-event-throttle="0"`（MT 信号本构建不派发）；处理器在隐藏态**零成本早退**（该信号 60Hz 常驻）。
9. **冻结 + 宽限窗**：动作点击瞬间冻结快照；`start === -1` 在 ~150ms 宽限窗内不立即收起（防「点菜单时引擎先清选」把载荷打没）。
10. **清选尽力而为**：引擎侧清选**未取证** → 适配器返回 `false` + warn once，工具条照收；原生高亮可能残留（列入验收清单）。

**端口（恰好三个，其余依赖不造缝）**
- `SelectionEnginePort`：`measureRange(nodeId,{start,end}) → {ok,rect|reason}`（reason ∈ `no-engine`/`bad-range`/`timeout`/`bad-calibration`）、`contentWidthDp()`、`clearRange(nodeId) → boolean`。生产 `createLynxSelectionEngine`（复用 `primitives/measureRects.ts` 的平台规则：逐 id `select`、`exec` 必须链在 `invoke` 返回值上、1500ms 超时）+ 测试 fake = **真 seam**。
- `ClipboardPort`：`writeText(text) → Promise<void>`；生产 `createLynxClipboard`（探测 `NativeModules.PictelioClipboard`，缺失 → warn + reject）+ 测试 fake。
- `SearchPort`：`openWithKeyword(keyword)`；2 行适配器，价值 = 把 `openSearch` 的**幂等吞词**怪癖收编到一处（已开则先 `closeSearch()` 再开 + warn）。
- **不设端口**：`getParagraphText`（页面闭包，无变异）、`registerModal`（一次调用）——单实现即假设缝。

**原生模块（ID 6 修订）**：`PictelioClipboardModule extends LynxModule`（无类注解）+ 公开 `(Context)` 构造 + `@LynxMethod setText(String, Callback)`；`ClipboardManager` + `ClipData.newPlainText` + `setPrimaryClip`；回调双参 `invoke("1","")` / `invoke("", msg)`（Share 同款；**禁传 null**）；错误消息用 `e.getMessage() != null ? … : getClass().getSimpleName()`；**注册只加 `LynxRuntimeInitializer`**（`LynxActivity` 的 per-view 列表本身就不含 Gallery/Share/Downloader/WebDav）；Android 13+ 系统自带剪贴板预览，不加自家 toast。**可测缝**：把写入逻辑放包可见静态方法（`static void copyInto(Context, String, Callback)`），测试直接驱动它——仓库里**没有任何测试构造过 LynxModule**（构造函数要 `LynxContext`），先例是 `PictelioWebDavModuleTest` 驱动的 `PictelioWebDavModule.run(Callback, Op)`。

**与先前 spec 的差异（4 处，均已并入上文）**
① 工具栏 props 由 `{ anchor, copied }` + emits 改为 `items` / `style` 进 + `action` 出（视图不持有控制器，也不因页面忘了 `v-if` 而画出活胶囊）；
② a11y label 用**内联 `t()`**（对齐本页导出入口的既有做法；房屋 a11y 表是 zh-only，`locale=en` 下会串味）——不新增 `NOVEL_DETAIL_A11Y_LABELS`；
③ Java 测试先例更正为 `PictelioWebDavModuleTest`（原 spec 引用的 `PictelioGalleryModuleTest` 不存在）；
④ 不新增 `getSelectedText` 的类型声明与调用（本地切片，省一次跨线程往返与一个失败面）。

**未取证 · 实现前补探针**（探针页在 `probe/text-selection-559` 分支，可直接复用）
1. 引擎能否**程序化清选**（`setTextSelection` 退化参数是否真的清除高亮）——决定「滚动收起后高亮残留」是缺陷还是可接受。
2. 索引单位是 **UTF-16 code unit 还是 code point**（含 emoji / 代理对的段落会不会错位切片）。
3. 点自绘菜单时引擎是否派发 `start === -1`（决定不变式 9 的宽限窗是否必要）。

## Testing Decisions

- **纯逻辑单测（node）**：`useTextSelection`（事件解析、`-1` 清空、generation-gate 丢弃过期回调、dismiss 清选）、`selectionToolbarGeometry`（上方/越界翻转、dp→vw 换算、边界值）、`truncateForSearch`（单行/超长/空输入）、`lexClipboard` 工厂（**IO 边界成功 + 失败双路径**，禁静默降级——AGENTS.md 测试硬约束 1/3）。
- **契约测试**：Java 模块名/方法名与 TS 侧一致（从 `PictelioClipboardModule.java` 源码提取常量比对，参考 `backupRulesConsistency.test.ts` 模式）；模块注册在 `LynxRuntimeInitializer` 存在（源级断言）。
- **模板源级守卫**（防实证坑回归，最高价值）：`NovelDetail` 段落 `<text>` 含静态字面量 `text-selection="true"` / `flatten="false"` / `custom-context-menu="true"`，且**不得出现** `:custom-context-menu` 形式的动态绑定；工具栏为 root 内 absolute 胶囊（不铺全屏层），且使用选定视觉令牌（`bg-surface-container-high` + `shadow-[var(--md-elevation-3)]`）与 view 绘制的线性图标（**不得回退为 emoji/字形图标**）。
- **深模块单测（主战场）**：`createTextSelection(deps)` 注入 fake 端口后可直接驱动——选中 → 断言 `visible` / `style` / `items` / `copyState`，覆盖：过期回调丢弃、`-1` 清空、宽限窗、滚动收起、modal 注册/注销配对、动作前校验、复制失败可见、索引越界。**不用 `vi.mock`**（deps 即测试缝）。
- **Java 单测**：`PictelioClipboardModule` 成功/失败路径（Robolectric 驱动包可见静态缝，先例 `PictelioWebDavModuleTest`；仓库无任何测试构造 `LynxModule`）。
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
