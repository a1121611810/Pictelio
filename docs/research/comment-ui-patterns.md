# 移动端评论区交互形态调研报告

> 面向：Pictelio lynx 版（`packages/app-lynx`，vue-lynx 框架）评论区 UI 形态决策。
> 背景：webview 版（`packages/app`，SolidJS）评论区为底部弹层（`fixed inset-0` 遮罩 + 底部 `80vh` 面板，见 `docs/comment-system-design.md`）。lynx 侧候选：A) 底部弹层（absolute 覆盖层挂在页面根 view 上，与 scroll-view 平级）；B) 独立路由全屏页（`/illust/:id/comments` + 顶栏返回）；C) 页内区块（详情页 scroll-view 内嵌评论列表）。
> 日期：2026-08；结论先行：**推荐 A 底部弹层**，B 作为弹层内「展开全部/楼层深读」的渐进升级路径预留。

---

## 1. 业界案例表

以下交互形态为**基于公开版本（2024–2025）的观察总结**，具体以各 App 当前版本为准；「官方规范」行引用的是设计系统文档。

| App | 评论入口 | 打开形态 | 键盘弹出处理 | 楼层/回复 | 分页/加载 |
|---|---|---|---|---|---|
| Instagram | 帖子底部评论图标 | **底部弹层**（半屏覆盖层，背景变暗，下滑关闭）——业界最早、最典型的「评论弹层」范式 | 输入框贴弹层底部；键盘弹出时弹层内容被顶起，列表在输入框上方继续滚动 | 支持：点击回复进入该评论的回复线程，root→reply 两级 | 无限滚动（上滑加载更多） |
| X (Twitter) | 帖文底部回复图标 | **全屏帖文详情页 + 底部回复输入栏**（回复输入框为底部面板形态） | 回复输入框固定底部，键盘弹出顶起 | 支持：回复进入对话流，缩进嵌套 | 加载更多/分页 |
| YouTube | 视频下方评论按钮/评论区 | **底部弹层**（评论列表从底部滑出，可上下拖、可放大） | 输入框在弹层底部，键盘顶起 | 支持 | 无限滚动 |
| Reddit | 帖子详情页评论入口 | **独立详情页内嵌评论**（页内区块）+ 底部固定评论输入栏 | 底部输入栏随键盘顶起 | 支持：树形缩进嵌套 | 分页/加载更多 |
| 哔哩哔哩 | 视频页评论 tab/按钮 | 页内评论区为主，另提供**全屏评论页**形态 | 底部输入框弹出 | 支持（楼中楼） | 分页 |
| 小红书 | 笔记底部评论图标 | **页内评论区**（笔记详情页内嵌，图片与评论同页滚动） | 底部输入框 | 支持 | 分页/加载更多 |
| 网易云音乐 | 歌曲页评论按钮 | **页内评论区块**（歌曲详情页内部）+ 最新/最热 tab | 底部输入框 | 支持（楼层） | 分页 |
| TikTok / 抖音 | 视频右侧评论图标 | **底部弹层，可上滑渐进放大到近全屏**（“先弹层后转全屏”的典型） | 输入框贴底，键盘顶起 | 支持（楼中楼） | 分页/加载更多 |
| Pixiv 官方 App | 插画详情页评论入口 | 详情页内**评论区块**（页内滚动） | 底部输入 | 支持（回复展开） | 分页 |

### 官方设计系统规范要点

- **Material Design（Bottom sheets，M2/M3）**：
  - *Standard bottom sheet*：与页面内容**并列**展示，不阻断页面其余交互，适合与主内容对照浏览的轻量内容。
  - *Modal bottom sheet*：**阻断**页面其余交互（背景遮罩 + 点击外部关闭），适合菜单、操作项；modal bottom sheet 支持**展开至全屏**（expandable）以承载更长的内容。
  - 移动端评论区普遍采用 modal bottom sheet 形态（阻断 + 遮罩 + 点空白关闭）。
  - 来源：<https://m3.material.io/components/bottom-sheets/overview>、<https://m2.material.io/components/sheets-bottom>
- **Apple HIG（Sheets）**：
  - Sheet 用于「当前上下文的**次要**任务/内容」；属于 modal，点击外部或下滑可关闭。
  - 支持 **detents 渐进式高度**（medium → large → full screen），用户可逐级拖大——即官方认可的「先弹层后转全屏」渐进形态。
  - 内容复杂、需要全屏专注（如深层浏览/楼层深读）时才用**全屏页面**。
  - 来源：<https://developer.apple.com/design/human-interface-guidelines/sheets>

### 业界形态小结

| 形态 | 代表 | 关键特征 |
|---|---|---|
| 底部弹层 bottom sheet | Instagram、YouTube、TikTok/抖音 | 保留上下文、点空白/下滑关闭、可渐进放大；适合「次要的查看+回复」 |
| 全屏页 full screen | X、Reddit（详情页）、B站全屏评论 | 信息层级更深、可承载楼层/嵌套深读；牺牲上下文 |
| 页内区块 inline section | 小红书、网易云、B站（页内）、Pixiv 官方 | 内容与主内容同页滚动，适合「评论即内容一部分」的浏览型场景 |

---

## 2. 形态取舍结论

### 推荐：A）底部弹层（absolute 覆盖层挂在页面根 view 上，与 scroll-view 平级）

理由按权重排序：

1. **与 webview 版一致，跨端体验统一**。本项目已有 `docs/comment-system-design.md` 明确采用「半屏覆盖层（Instagram 风格）」；lynx 版与 webview 版保持同形态是 ADR 体系一贯原则（如 ADR-0046 Tailwind、ADR-0044 单位体系都在对齐两端观感）。弹层形态本身已被 webview 版验证为产品既定方向。
2. **业界主流心智**。Instagram / YouTube / TikTok / 抖音的评论都是底部弹层，用户无需学习；Material/Apple 规范均把「评论」归为次要任务类内容，适合 modal bottom sheet 而非全屏页。
3. **保留上下文**。Pixiv 插画详情页内容长（多页大图 + 信息 + 关注/收藏操作，见 `IllustDetail.vue` 的 scroll-view 长内容）。弹层打开/关闭不丢详情页滚动位置、不打断「浏览作品」的主任务；页内区块则会让超长 scroll-view 更难管理滚动位置，并让评论与作品内容竞争注意力。
4. **lynx 能力完全覆盖**（详见 §3）：absolute/fixed 定位官方支持，absolute 全屏覆盖层已有 `RestrictOverlay.vue` 真机先例；输入框有 `Login.vue` + ADR-0055（XElement `<input>`）先例；列表分页有 `FollowList.vue`/`Recommended.vue` + ADR-0045 先例。

### 各形态适用场景与取舍

| 维度 | A 底部弹层 | B 独立全屏页 | C 页内区块 |
|---|---|---|---|
| 内容长度 | 中（评论列表 ≤ 屏幕内滚动） | 长（楼层深读、大量嵌套） | 长（与作品同页） |
| 楼层/回复交互 | 展开式回复（root→reply 两级，同 webview 版） | 树形/多级嵌套更舒适 | 同页展开 |
| 键盘 | 弹层贴底，键盘顶起后输入框自然在键盘上方 | 全屏页输入框贴底，同样需要键盘处理 | 需处理「键盘顶起时滚动锚定」 |
| 返回手势 | 下滑关闭 + 点遮罩关闭 + 系统返回（ADR-0066） | 顶栏返回 + 系统返回 | 无独立返回 |
| 信息层级 | 评论是详情页的次要层（modal） | 评论升为主页面（丢失详情页上下文） | 评论与作品平级 |
| 深链接/分享 | 不支持（需先打开详情） | 支持 `/illust/:id/comments` | 不支持 |
| 实现成本（lynx） | 低：absolute 覆盖层 + 既有组件先例复用 | 中：新增路由 + 详情状态传递 + 返回栈 | 中：改详情页布局，风险高（scroll-view 结构已有 fix，ADR-0055/issue #139） |

### 渐进式形态（先弹层后转全屏）

Apple HIG 的 sheet detents（medium→large→full）、Material modal bottom sheet 的 expandable、TikTok/抖音评论弹层（可上滑放大近全屏）、以及 lynx-ui `<Sheet>` 的 `snapPoints` 吸附点（默认 `['fit']`，可配 `'50%'`/`'90%'` 等多级）都是同一种渐进式思路。

**对本项目的落地建议**：MVP 先做固定高度弹层（对齐 webview 版 `80vh`，简化）；预留「展开全部回复/上滑放大到近全屏」作为后续渐进升级；若楼层深读需求增大，再考虑 `navigate('/illust/:id/comments')` 独立路由页（B）作为弹层内的更深一层，而非替换弹层。

---

## 3. 若采用弹层：lynx 实现可行性依据

### 3.1 lynx 官方文档对 position / overlay 的支持

**`position` 属性（lynxjs.org 官方 API 文档）**：

- Lynx 支持 `relative | fixed | absolute | sticky`；**不支持 `static`，默认值为 `relative`**。
- `absolute`：脱离文档流，相对父元素的 containing block 定位。
- **`fixed` 的语义**：「The element will be treated as a direct child of root node with the property position as absolute」——即 fixed 元素会被视为根节点（LynxView 根）的直接子节点并以 absolute 定位，等价于相对整个 LynxView 视口定位，与 Web 的 fixed 语义接近。
- 官方 FAQ：**在 `position: absolute` 元素中使用 `z-index` 时，需同时在父元素设置 `z-index: 0`**（创建 stacking context）。
- 来源：<https://lynxjs.org/api/css/properties/position>

**`z-index` 属性（官方文档）**：

- Lynx 通过「是否显式设置 z-index」判断是否 auto（与 Web 的 auto 默认不同）；`z-index: 0` 可用于创建 stacking context（官方例子：给 scroll-view 加 `z-index: 0` 避免子元件不跟随滑动）。
- **不建议在 `<list>` 直接子元件使用 z-index**（可能影响 list 复用）。
- 来源：<https://lynxjs.org/zh/api/css/properties/z-index>

**原生渲染的历史坑（GitHub 证据链）**：

- `lynx-family/lynx#1900`（2025-07，open/WIP）：`z-index` 在 Android/iOS 原生端曾导致插入失败（`990200 Insertion (new) failed due to unknown parent signature` / iOS `LynxInsertUlException`）。
- `lynx-family/lynx#4902`（2026-02 合并）：Fix z-index and fixed positioning issues in DOM rendering——说明官方在持续修复并确认 fixed/z-index 的渲染路径。
- `lynx-family/lynx#4176` / `#4207` / `#4222`（2025-12 合并）：Correctly handle `position:fixed` when under `display:none` nodes——`display:none` 下的 fixed 定位曾有问题，已修复。

**结论**：`position: absolute / fixed` 是 lynx 原生支持的一等公民（有持续修复记录）；风险点集中在 `z-index`（曾有插入 bug）与 `display:none` 切换（已有修复）。**实现弹层时应避免依赖 z-index 叠层排序，优先用 DOM 渲染顺序（后渲染的兄弟节点覆盖在先渲染者之上）**。

### 3.2 lynx 官方对「弹层/覆盖层」的推荐做法

lynx-ui（官方组件库，`lynx-family/lynx-ui`）提供两个直接对应的组件：

- **`<OverlayView>`（`@lynx-js/lynx-ui`）**：「用于在主视图树之上**通过原生浮层渲染内容**」，`container="default"` 建议用全屏透明容器承载弹窗；提供 `overlayLevel`（1–4）调整与附近元素的显示层级。
- **`<Sheet>`（`@lynx-js/lynx-ui-sheet`）**：方向性 Sheet 组件，明确支持「底部面板、吸附点（百分比/`'fit'` 内容自适应）、拖拽、点击遮罩关闭、受控/非受控」。其 `SheetView` 可通过 `container="spark"/"bullet"/"bulletPopup"` 把 Sheet 渲染到 **LynxView 外部**（原生层级），说明 lynx 生态对「弹层」有完整的第一方支撑。

> ⚠️ 注意：lynx-ui 是 **ReactLynx** 组件库；本项目是 **vue-lynx**（Huxpro 社区维护的 Vue 3 custom renderer，`github.com/Huxpro/vue-lynx`，pre-alpha）。vue-lynx 目前不直接消费 lynx-ui 的 React 组件，**弹层需用 vue-lynx 自带元素（view/scroll-view/input）+ position 定位自行实现**；但官方存在这一形态组件，说明「弹层是 lynx 官方认可/推荐的做法」，且底层 CSS position 能力一致。
- 来源：<https://lynxjs.org/zh/ui/components/overlay>、<https://lynxjs.org/zh/ui/components/sheet>、<https://github.com/lynx-family/lynx-ui>

### 3.3 本项目先例（全部真机验证过）

| 先例 | 文件/文档 | 与弹层的关系 |
|---|---|---|
| **absolute 全屏覆盖层** | `packages/app-lynx/src/components/RestrictOverlay.vue` | `position: absolute; top/left/right/bottom: 0` 铺满父容器（父容器 `relative`），注释明确「web-core 与原生 LynxView 观感一致」；真机 `lynx-flow-check.sh` 全流程 PASS（含 R18 遮罩，见 ADR-0053 验证段）。**这就是弹层遮罩+面板的直接骨架** |
| **根 view 布局结构** | `packages/app-lynx/src/pages/IllustDetail.vue` | 根 view `w-full h-full flex flex-col` + 顶栏 + `scroll-view flex-1 min-h-0`。弹层挂为根 view 的兄弟子节点（absolute 覆盖）即可不侵入 scroll-view 结构（该结构已有 issue #139/#129 修复，改动风险高，弹层方案恰好零侵入） |
| **输入框** | `packages/app-lynx/src/pages/Login.vue` + ADR-0055 §3 | `<input>` 是 XElement 扩展元件（需 `xelement`/`xelement-input` + `LynxViewBuilder.addBehaviors(new XElementBehaviors().create())`），真机 990200 已修。评论输入框复用该链路 |
| **列表分页** | `packages/app-lynx/src/pages/FollowList.vue` + ADR-0045 | `<list>` + `@scrolltolower` + 加载冷却/节流/空页防护；评论分页（webview 版 30 条/页）可直接套用该模式。列表图加 `lazy-load`（ADR-0060） |
| **独立路由先例（备选 B 所需）** | `packages/app-lynx/src/router.ts` + `FollowList.vue` | 极简路由支持 `navigate`/`goBack`/系统返回桥（ADR-0066），新增 `/illust/:id/comments` 路由成本可控，可作为弹层内深读的后续升级路径 |
| **单位/属性契约** | ADR-0044（rpx 塌陷→用 vw/px）、ADR-0056（number 属性 v-bind 数字） | 弹层高度/偏移用 vw/px；scroll-view/list 的 number 属性用数字绑定 |

### 3.4 弹层在 vue-lynx 的实现要点（给后续实施的备忘）

- **结构**：根 view 内、scroll-view 平级追加弹层根（`v-if` 控制）；遮罩 view（absolute 铺满 + 半透明底 + `@tap` 关闭，参考 `RestrictOverlay` 的 `swallow` 防穿透）+ 底部面板 view（`absolute bottom-0` + 显式高度 `80vh`，用 vw/px，勿用 rpx）。
- **层级**：优先靠 DOM 顺序让弹层最后渲染（盖在 scroll-view 上），避免依赖 z-index；确需 z-index 时遵循官方 FAQ（父级建 stacking context，如 `z-index: 0`），并真机回归（issue #1900 类 bug 曾只出现在原生端）。
- **滚动**：面板内用 `scroll-view` 或 `<list>` 承载评论列表；`@scrolltolower` 分页需加 ADR-0045 双重防抖 + 空页防护。
- **键盘**：输入框在原生端按 ADR-0055 接 XElement；键盘弹出时的面板顶起依赖 Android 宿主 windowSoftInputMode（`adjustResize`）配置，需真机验证。
- **关闭**：点遮罩关闭 + 下滑关闭（手势若 MVP 不实现可省略）+ 系统返回关闭（ADR-0066 系统返回桥已有）。

---

## 4. 外部来源 URL 列表

### lynx 官方（lynxjs.org）
- <https://lynxjs.org/api/css/properties/position> —— position 支持（fixed 视为 root 直接子节点 + absolute；FAQ z-index 提示）
- <https://lynxjs.org/zh/api/css/properties/z-index> —— z-index/stacking context 用法与 list 注意事项
- <https://lynxjs.org/zh/ui/components/overlay> —— lynx-ui `<OverlayView>` 原生浮层组件
- <https://lynxjs.org/zh/ui/components/sheet> —— lynx-ui `<Sheet>` 底部面板/抽屉组件（snapPoints/拖拽/遮罩关闭）
- <https://lynxjs.org/zh/guide/ui/elements-components> —— lynx 内置元素与原生渲染对照
- <https://lynxjs.org/zh/guide/ui/layout/relative-layout> —— lynx 相对布局（可选辅助）

### lynx GitHub（lynx-family/lynx）
- <https://github.com/lynx-family/lynx/issues/1900> —— z-index 原生插入 bug（open/WIP）
- <https://github.com/lynx-family/lynx/pull/4902> —— Fix z-index and fixed positioning issues in DOM rendering（2026-02 合并）
- <https://github.com/lynx-family/lynx/pull/4176> 与 <https://github.com/lynx-family/lynx/pull/4222> —— position:fixed under display:none 修复（2025-12 合并）
- <https://github.com/lynx-family/lynx-ui> —— lynx-ui 官方组件库

### vue-lynx
- <https://github.com/Huxpro/vue-lynx> —— vue-lynx（Vue 3 custom renderer，pre-alpha）
- <https://registry.npmjs.org/vue-lynx> —— npm 元数据（仓库/版本 0.5.1 确认）

### 设计系统规范
- <https://m3.material.io/components/bottom-sheets/overview> —— Material Design 3 Bottom sheets（standard/modal/expandable）
- <https://m2.material.io/components/sheets-bottom> —— Material Design 2 Bottom sheets
- <https://developer.apple.com/design/human-interface-guidelines/sheets> —— Apple HIG Sheets（detents：medium/large/full screen）

### 业界案例（交互形态为公开版本观察，官方规范 URL 见上）
- <https://help.instagram.com/> —— Instagram（评论底部弹层范式）
- <https://www.youtube.com/> —— YouTube（评论底部弹层）
- <https://www.reddit.com/> —— Reddit（详情页内嵌评论）
- <https://www.tiktok.com/> —— TikTok/抖音（评论弹层渐进放大）
- <https://www.pixiv.net/> —— Pixiv 官方（详情页内评论区块）
- <https://www.xiaohongshu.com/> —— 小红书（页内评论区）

### 项目内参考（非外部）
- `docs/comment-system-design.md` —— webview 版评论系统设计（半屏覆盖层形态、API、组件、分页策略）
- `packages/app-lynx/src/components/RestrictOverlay.vue` —— absolute 覆盖层先例
- `packages/app-lynx/src/pages/IllustDetail.vue` / `FollowList.vue` / `Login.vue` —— 根布局 / 分页 / 输入先例
- `docs/adr/` ADR-0044 / 0045 / 0053 / 0055 / 0056 / 0060 / 0066 —— lynx 布局、输入、分页、路由相关契约
