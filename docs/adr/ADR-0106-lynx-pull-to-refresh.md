# ADR-0106: app-lynx 列表下拉刷新（Lynx Pull-to-Refresh）

- 状态：accepted
- 日期：2026-08-24
- 关联：ADR-0076（webview 首页下拉刷新，语义 A 来源）、ADR-0104（分页收敛 / createMixFeed）、#51（XElement input 集成模式）、`packages/app-lynx/CONTEXT.md`（术语）
- 来源：grill-with-docs 会话，用户逐项拍板（D1-D7 见 spec `docs/specs/app-lynx-pull-to-refresh.md`）

## 背景

app-lynx 全部 9 个列表实例（Recommended / IllustList / NovelList / Following / Bookmarks×2 / UserHome×2 / FollowList）的数据层刷新能力早已存在（`feed.refresh()` 幂等 + generation 竞态防护，ADR-0104 收敛进 createMixFeed；FollowList 的 `fetchFirstPage()` 天然幂等），但**手势入口缺失**——仅推荐页有 FAB 刷新按钮，其余页面无任何刷新手段。

技术前提（字节码/POM/源码实证）：

1. Lynx 官方 `<refresh>` XElement 提供原生下拉手势（`bindstartrefresh` / `bindrefreshstatechange` / `finishRefresh` / `autoStartRefresh`），`xelement-refresh:4.0.1` 在 Maven Central 可用，与当前 Lynx SDK 4.0.1 同版本。
2. 基础 `xelement` 构件的 `LynxUIRefreshAutoRegistry` 通过 `Class.forName("com.lynx.xelement.refresh.LynxUIRefresh")` **可选注册**——classpath 存在即生效，`LynxActivity` 零改动（svg/markdown 同款机制）。
3. `xelement-refresh` 底层是第三方库 SmartRefreshLayout，POM 传递依赖 `io.github.scwang90:refresh-layout-kernel:3.0.0-alpha`（117 KB，无次级传递依赖）——**项目首个非官方组织的 Android 原生依赖**。
4. web-core（0.20.3 / 0.23.1）内置 `XRefreshView` 自定义元素实现，但 Lynx 标签映射表**无 `refresh` → `x-refresh-view`**（`view/text/image/list/input` 有映射，`refresh` 没有）——模板写 `<refresh>` 在 web-core 预览下不生效且可能破坏布局，必须条件分支。

## 决策

1. **技术路线 A**：官方 `<refresh>` XElement 承载原生手势；web-core 预览条件降级。否决自实现 JS touch 手势（路线 B）——ADR-0076 的 JS 手势是"浏览器无原生 PTR"的代偿，该前提在 Lynx 不成立；且路线 B 每帧 touchmove 跨 bridge（~60 次/秒），路线 A 每手势仅 4-5 次 bridge 通信。
2. **深模块 `RefreshableList.vue`**：接口仅 `:refreshing` prop + `@refresh` 事件 + 默认 slot（页面 `try/finally` 驱动，`finally` 保证失败也收起 header）。双端分支（`isNativeMode()`）、header 双态、SelectorQuery `finishRefresh()`、15s 卡死兜底全部收敛内部。页面禁止直接写 `<refresh>` 标签。否决 done-callback（`emit('refresh', done)`）——忘调 done = header 永久卡死，且与页面既有"ref 快照桥接"范式不一致。
3. **范围 = 9 个列表实例**（含 FollowList）：任何列表页下拉都可刷新的交互一致性；成本与 feed 页相同（~10 行/页）。排除详情页 / Me / ErrorPage。
4. **刷新语义对齐 ADR-0076 语义 A**（可见刷新过程）：原生由 `<refresh-header>` 停留 + spinner 天然实现，**不做**骨架遮罩替换（webview 专属代偿）。数据动作复用既有 `feed.refresh()` / `fetchFirstPage()`，数据层零改动。
5. **web-core 降级 = 组件内建刷新按钮**（web-only 分支自带，接口零新增）；推荐页独立 FAB 删除，`Fab.vue` 随之删除（全仓唯一消费方，删除后即成死代码）。
6. **header 低频状态驱动双态**：`bindrefreshstatechange`（每手势 ~3 次事件）→ 非刷新态「下拉刷新」/ `REFRESHING` 态 spinner+「刷新中…」。**不绑 `headeroffset`**（每帧高频事件），接受"过阈值未松手无「释放刷新」提示"缝隙。spinner 用 CSS keyframes 旋转（与 shimmer 同机制）。
7. **供应链钉死单点**：build.gradle 内嵌 SHA-256 校验任务（`xelement-refresh-4.0.1.aar` = `7ead729798dc8adaf4c823866e21f5ce1cb64c61c1fa7325382a762623aa602a`，`refresh-layout-kernel-3.0.0-alpha.aar` = `7f1f0132bf1bc5ee98cc1b60a0f4ca0bb67e726e20296aacb5127a1540ca2ad2`，2026-08-24 人工从 Maven Central 下载核验），`gradle.taskGraph.whenReady` 门控仅 lynx/full assemble 触发，校验失败 = 构建错误。否决全量 dependency verification——trust-on-first-use 锚点强度与单点相同，但须覆盖 130 个 group 并永久改变所有依赖升级流程。
8. **验收 = 单测 + 安卓模拟器实测**：契约断言的常量 oracle 来自 xrefresh AAR 字节码提取（`finishRefresh` / `autoStartRefresh` / `enable-refresh` / `REFRESH_STATE_*`）；模拟器覆盖布局穿透（`<refresh>` 包 `<list>` 后 `flex-1 min-h-0` 链与 waterfall gap）、RefreshState 事件、数据流全链路。Appium 手势 spec 尝试，对 LynxView 不灵则降级 adb swipe + 截图，不阻塞交付。

## 被考虑的方案

- **路线 B（移植 webview createPullToRefresh JS 手势）**：Lynx 有原生手势引擎，自实现为负资产；bridge 每帧通信开销量化劣势（60/s vs 4-5/手势）。否决。
- **done-callback 完成信号**：见决策 2。否决。
- **全量 Gradle dependency verification**：见决策 7。否决。
- **headeroffset 驱动「释放刷新」三态文案**：每帧高频 bridge 事件，性能否决；v1 接受语义缝隙。
- **页面各自补 FAB（web-core 降级）**：5 处复制 + 定位值逐页微调，位置知识散落。否决，收进组件。
- **原生 SwipeRefreshLayout（Capacitor 插件）**：ADR-0076 已否决同类方案（Android 专属，破坏双端共享）。
- **保留推荐页 FAB 与组件内按钮并存**：两个刷新入口形态不一致。否决，统一组件内建。

## 后果

- 正面：9 个列表实例统一手势入口；手势/回弹原生品质且零 JS 线程占用；下拉刷新知识单点收口（locality）；传递依赖变化从静默变为显式构建错误。
- 负面：引入首个非官方 alpha 原生依赖（SmartRefreshLayout kernel，由哈希钉死对冲）；`xelement-refresh` 与 Lynx SDK 版本锁定，升级需同步；proguard 需自写 keep 规则（官方 consumer rules 为空，AAR 实证）。
- 待验证项（实现期模拟器首验）：`<refresh>` 增加一层 ShadowNode 后 waterfall 布局穿透；原生 CSS keyframes 旋转动画（shimmer 已上线但原生动画验证无代码记录）。
