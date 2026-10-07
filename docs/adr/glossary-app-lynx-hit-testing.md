# app-lynx 命中测试与覆盖层统一术语表

> 范围：`packages/app-lynx` 在**原生 LynxView** 上渲染覆盖层（遮罩、弹窗、悬浮菜单）时的**统一术语**与**平台约束**。配套 ADR：[ADR-0123](./ADR-0123-app-lynx-fab-hit-testing-fix.md)（本次修复）；相关 ADR：[ADR-0120](./ADR-0120-app-lynx-radial-nav-fab.md)（放射 FAB）、[ADR-0121](./ADR-0121-app-lynx-radial-fab-m3-size.md)（FAB 尺寸/层叠）、[ADR-0111](./ADR-0111-app-lynx-fab-menu.md)（RefreshableList FAB menu）。本表只定义领域语言与平台事实，不写实现。

## 核心术语

| 术语 | 定义 |
|------|------|
| **命中测试（hit-testing）** | 原生 LynxView 把触摸事件路由到目标元素的机制：取触点下**最顶层**（层叠序最高）的渲染元素作为事件目标。与 Web 语义一致，但**不识别 `pointer-events`**（见下）。 |
| **命中面（hit surface）** | 参与命中测试、可能成为触摸目标的一个渲染元素。**任何全屏元素都是命中面**——不管有没有内容、有没有背景色。 |
| **全屏层规则（full-screen layer rule）** | app-lynx 覆盖层的**不可变约束**：渲染树中的**全屏元素必须是交互面（带 `@tap` 句柄），否则必须从命中测试中移除**（`v-if` 条件渲染 / 零尺寸盒）。_Avoid_: 全屏元素 + `pointer-events-none` 指望它穿透触摸（原生不生效 → 吞掉其下所有点击）。 |
| **非命中层（inert layer）** | 从命中测试中移除、不参与触摸路由的层。实现手段只有两种：**`v-if` 不渲染**（关闭态最常用）或**零尺寸盒**（`absolute` 钉在 (0,0)、无宽高，只作定位锚点，子元素 vw 定位仍正常渲染）。`pointer-events: none` 在原生 LynxView **不是**合法手段。 |
| **定位锚点（positioning anchor）** | **平台事实**：原生 LynxView 把「最近的 view 祖先」当作 absolute 子元素的定位锚点——即使该祖先未设 `position`（与 Web「无定位祖先回退到视口」的语义不同，模拟器实测：`right/bottom` 按非全屏父盒边缘解析，FAB 直接跑出屏幕）。因此覆盖层元素的绝对定位一律用 **`left/top` vw + `translate(-50%,-50%)` 居中**（vw 视口基准，从 (0,0) 锚点起算恒等于视口坐标）。_Avoid_: 非全屏父盒内用 `right/bottom`。 |
| **交互面（interactive surface）** | 带 `@tap` 句柄的全屏层：触摸落在其上时事件被消费（如遮罩点空白收起）。示例：`CommentOverlay` 的遮罩 `@tap="onClose"`、`RefreshableList` 展开态 scrim `@tap="onCloseMenu"`。 |
| **pointer-events 平台约束（pointer-events platform constraint）** | **平台事实**：原生 LynxView（本项目 lynx `4.0.1`）的 hit-testing **不识别 `pointer-events` CSS 属性**（官方 3.5 才引入，4.0.1 实机实测仍不生效；2026-08-30 T5 真机验证 + 模拟器复现双重印证）。结果：`pointer-events: none` 的**全屏透明层依旧命中触摸**，吞掉其下页面全部点击。web-core（浏览器）行为正常，**双端行为不一致**——不能以 web-core 验证通过推断真机行为。_Avoid_: 用 `pointer-events` 控制覆盖层穿透。 |
| **遮挡带（occlusion band）** | 悬浮控件在屏幕上占据的**水平投影带**。GlobalFab 的遮挡带 = `x[872,1033]` = **80.74vw..95.65vw**（真机实测 emulator-5554 / 1080×2160），宽度 = **本体 `FAB_SIZE_VW` = 14.933vw**（实测 161px）。⚠️ **带宽只有本体，不含右距**：`FAB_EDGE_VW` 4.267vw 是带右缘到屏幕右缘的**外部间隙**，把它算进带宽会让门禁**多放行 4.267vw 的误点区**。理论值 `100 - FAB_EDGE_VW - FAB_SIZE_VW` .. `100 - FAB_EDGE_VW` = 80.8..95.733vw，与实测差 <1px（栅格化粒度）。**落在遮挡带内的命中面会被 GlobalFab 整个吃掉**——原生 hit-test 取最顶层元素，FAB 恒在其上。⚠️ 遮挡带是**水平**概念，与底部遮挡让位的**竖直**方向**互不相干**：后者让**末项**能滚到 FAB 上方，前者管 FAB 压住的是行的**哪一段**（票 #932） | `GlobalFab.vue` 的 `fabCx` / `fabStyle`；带边界导出为 `FAB_BAND_LEFT_VW` / `FAB_BAND_RIGHT_VW`，常量 `FAB_SIZE_VW` / `FAB_EDGE_VW` 同源 | 票 #932 |
| **行内动作（row action）** | **行级**交互控件，与「整行导航」相对：移除 / 取消追更 / 关注取关一类。⚠️ 与整行 `@tap` 并存时必须挂 `@tap.stop`，否则误触变成导航 | `ContinueRow.vue`、`Watchlist.vue`、`WatchLater.vue`、`MuteTags.vue`、`UserRow.vue` | ADR-0219；票 #932 |
| **行尾动作（trailing action）** | 位于行**尾部（右缘）**的行内动作。⚠️ 行内容右边缘 = **94.665vw**（`mx-3` 3.201vw + `p-2` 2.134vw），**本身就落在 GlobalFab 遮挡带内** ⇒ 行尾动作实测 **97% 宽度**（`x[867,1021]`）被覆盖，点它会**确定性地**开出搜索弹层而非执行动作。⚠️ **遮挡带与路由档位无关**：`fabCx` 只用 `FAB_EDGE_VW`/`FAB_SIZE_VW`，两档**水平带完全相同**，分档只改 `top`。⇒ `menu` 档页同样横向暴露，只是竖直位置低（4.27–19.2vw）+ 19.2vw 让位恰好护住末项。_Avoid_：在有 GlobalFab 的页面把行内动作放在行尾 | 同「行内动作」各页 | 票 #932（真机像素 + 点按双重取证） |
| **行首动作（leading action）** | 位于行**首部（左缘）**的行内动作。GlobalFab 恒锚定右下（遮挡带起于 **80.8vw**，与路由档位无关），行首动作完全落在遮挡带之外 ⇒ 不与 FAB 竞争命中。⚠️ **行首不是"零成本"**：缩略图也在行首（18.667vw），动作插在它前面会把缩略图**右推**。实测行首动作（10.667vw）+ 间隙 ⇒ 缩略图左缘 6.20vw → 18.43vw（**右推 12.2vw**）；但同时行尾药丸（14.3vw）被移除 ⇒ **标题列净变化 ≈ +1vw**（动作的占位是「搬移」而非「新增」） | 同「行内动作」各页 | ADR-0221 |
| **展开层（expanded layer）** | 放射 FAB 的**展开态渲染层**：整层 `v-if="view.isOpen"` 条件渲染，内含遮罩（z-10）与菜单项（z-20）。关闭态整层不存在 → 渲染树无全屏命中面。 |
| **展开层叠序（expanded stacking order）** | 放射 FAB 展开后的层叠：**遮罩(z-10) < 菜单项(z-20) < 主 FAB(z-30)**，同一 **z-40 外层**内。外层为钉在 (0,0) 的**零尺寸盒**（只作定位锚点、不参与命中测试）；遮罩与菜单项整层 `v-if="view.isOpen"` 条件渲染（关闭态不存在），主 FAB 常显于其内。修复前（ADR-0123 之前）外层为**常显全屏容器**（`absolute inset-0` + `pointer-events-none`），关闭态吞掉页面全部点击（见「pointer-events 平台约束」）。ADR-0121 时期的 z 相对次序与此一致（当时容器常显全屏，FAB 在容器内 z-30）。 |
| **滚动容器覆层约束（scroll-view overlay constraint）** | **平台事实（ADR-0147）**：原生 LynxView 下，**覆盖在 `<scroll-view>` 之上的 `absolute`/`fixed` 元素不是可命中的触摸目标**——`<scroll-view>` 的原生滚动层在命中测试中胜出，其上的覆层（即使渲染在最上层、有背景、带 `@tap`）收不到 tap（logcat 有 `event: tap tag:N` 但 handler 不触发）。`pointer-events`、`z-index`、收窄宽度、独立 absolute 叶子**均不能**解决。合法做法：交互控件作为 `<scroll-view>` 的**兄弟节点走正常文档流（in-flow）**，或底层滚动容器改用 `<list>`。_Avoid_: 把吸底动作栏做成盖在 `<scroll-view>` 上的 `absolute` 覆层。 |
| **内流覆盖层顶出视口（in-flow overlay pushed off-viewport）** | **平台事实（issue #139 / SearchSheet 注释，2026-09 真机复现）**：原生 LynxView 下页面根为固定高（`h-full`）时，**文档流内**再放一个 `w-full h-full` 覆盖层，会被前面的满高滚动容器（`<list>`/`<scroll-view>`）**顶到视口下方**——元素已挂载、`@tap` 处理器可触发，但整层在屏幕外看不见。合法做法：页面根 **`flex flex-col relative`** + 滚动容器 **`flex-1 min-h-0`** + 覆盖层外包 **`<view class="absolute inset-0">`** 脱离文档流（IllustDetail 既定结构）。_Avoid_: 把弹层组件作为满高滚动容器的内流兄弟直接挂载（`NovelDetail` 曾因此让评论/导出弹层在屏幕外挂载）。 |
| **弹出动画习语（menu pop-in idiom）** | 菜单项进入动画的既定写法：**keyframes + `both` fill + 逐项 stagger**（`RefreshableList` 的 `item-rise`、放射 FAB 的 `fab-ring-in`）。覆盖层元素用 `v-if` 挂载时，`transition` 不触发（状态无变化），必须改用 keyframes。 |

## 边界约定

- 全屏层规则适用于**所有**覆盖层（弹窗 backdrop、菜单遮罩、引导层），不只是 FAB。
- 交互面的语义属于渲染适配器（`.vue` 模板），不进入深模块接口（`createGlobalFab` 不感知渲染/命中）。
- web-core 与原生 LynxView 的 hit-testing 行为可不同；**涉及穿透/遮挡的改动必须以原生验证为准**（模拟器或真机），web-core 全绿不构成充分证据。
- 「滚动容器覆层约束」与「全屏层规则」「定位锚点」并列：三者共同构成 app-lynx 覆盖层的平台约束集合（ADR-0123 定前两者，ADR-0147 定此条）。

### 遮挡带与底部让位是**两个正交轴**（最容易漏掉的一条）

| | 底部遮挡让位（竖直轴） | 遮挡带（水平轴） |
|---|---|---|
| 挡的是谁 | GlobalFab 的**上缘** | GlobalFab 的**右段** |
| 保证什么 | **末项**能滚到 FAB 上方 | 行内动作**不被 FAB 吞点击** |
| 落点 | 滚动内容末尾零内容占位 | 行内动作的**行内位置**（行首 / 行尾） |
| 治不了什么 | 治不了**中间某行**被横向压住 | 治不了末项被**竖直**压住 |

⚠️ **两者都成立也不够**：`FabAllowanceSpacer` 让末项能滚到 FAB 上方是对的，但它只管竖直；
行内动作照样会在滚动途中被**横向**遮挡带吃掉（票 #932 的原始形态：`/continue` 末项让位齐全，
点行尾「移除」仍然开出搜索弹层）。⇒ **行内动作的横向位置是一条独立于底部让位的约束**，
两者都要各自成立。

