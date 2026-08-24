# ADR-0107: app-lynx 列表刷新入口改 FAB（废弃原生下拉刷新）

- 状态：accepted
- 日期：2026-08-24
- 关联：ADR-0106（superseded，本 ADR 取代其决策 1/2/3/4/6；范围决策 D5 沿用）、ADR-0104（分页收敛 / createMixFeed）、ADR-0076（webview 下拉刷新）、`packages/app-lynx/CONTEXT.md`（术语）
- 来源：grill-with-docs 会话——ADR-0106 T4 模拟器验收发现原生 `<refresh>` 路线不可行，用户拍板改需求为右下角刷新按钮

## 背景

ADR-0106 选择官方 `<refresh>` XElement（底层 SmartRefreshLayout）承载原生下拉手势，其成本模型建立在两个假设上：①`LynxUIRefreshAutoRegistry` 可选注册、LynxActivity 零改动；②JS 侧经 SelectorQuery `invoke("finishRefresh")` 即可收起 header（官方示例路径）。T4 模拟器验收（2026-08-24）实证两条假设均不成立，并连带暴露更多平台缺陷：

**平台事实（模拟器实测，logcat/探针留证）：**

1. **SelectorQuery 对 XElement 节点静默不命中**：id / tag / class 三种选择器对 `<refresh>` 节点全部无 success/fail 回调，连 `boundingClientRect` 通用方法探针对照也静默消失——方法调用根本到不了原生。ADR-0106 决策 2 的完成信号链路（`watch(refreshing)` → `finishRefresh()`）在平台层断裂。
2. **`<refresh>` 包裹下 vue-lynx patch 索引错位**：数据整体替换触发 `FiberElement RemoveNode got wrong child index` → 列表空白；需 `:key` 强制整树销毁重建绕过（绕框架 bug 的 workaround）。
3. **`<refresh>` 布局契约脆弱**：内容区非 flex 容器（内部 list `flex-1` 解析为 0 → 列表 0×0，必须 `h-full`）；`refresh-header` 官方强制 `position:absolute`。
4. **SmartRefreshLayout kernel 3.0.0-alpha POM 漏声明 viewpager2**：运行时 `NoClassDefFoundError`（`SmartUtil.isContentView` 的 `instanceof ViewPager2`），需额外补依赖。

若继续沿原路线收尾，落地形态为四层代偿叠加：首个非官方 alpha 原生依赖（+viewpager2 补漏）+ 新增 `@LynxMethod finishRefresh` 原生桥（主线程遍历 decorView 全局搜索 SmartRefreshLayout，靠 `isRefreshing()` 时序寻址）+ 9 处框架 bug workaround（refreshEpoch 整树重建）+ 脆弱布局契约。成本/收益已反转，用户拍板废弃下拉手势，改右下角刷新按钮。

关键利好：RefreshableList 的 web-core 降级分支（ADR-0106 D4）本就是「列表容器 + 右下角 M3 FAB」实现，且其前身 Fab.vue 在原生端真实上线过（推荐页 FAB，T3 才删除）——新方案是回退到已验证模式，不是新发明。

## 决策

1. **刷新入口 = RefreshableList 内建 FAB，双端同构**：固定列表容器右下角（M3 FAB 56dp=14.933vw、shape-large、primary-container、elevation-3），LynxView 原生与 web-core 预览同一分支。废弃原生 `<refresh>` XElement 下拉手势路线；页面禁止写 `<refresh>` 标签的红线保留并加强（组件内也不许出现）。
2. **接口换形为函数 prop**：`:refresh="fn"` + 默认 slot（接口元素 3→2）。刷新状态机内收组件：tap → 防重入 guard → `refreshing=true` → `await props.refresh()` → `finally` 复位。**页面禁止自持刷新态**（无 refreshing ref、无 onRefresh 包装器；grep 实证 T3 形态下 9 处 refreshing ref 唯一消费者就是该 prop，纯桥接样板）。取代 ADR-0106 决策 2；其否决 done-callback 的理由（忘调 done 卡死）不适用于本方案——`finally` 由组件自己持有，责任方向相反。vue-lynx 组件边界是 Vue 层（background 线程），emit 底层即 callback prop，函数 prop 无跨线程序列化风险。
3. **原生面整体回滚至 ADR-0106 前基线**：移除 build.gradle 中 `xelement-refresh` / `viewpager2` 显式声明、verifyPinnedAars 校验任务与 proguard keep 规则；删除未提交的 `PictelioAppModule.finishRefresh` @LynxMethod。历史处理：rebase drop T1 提交（918f731，未推送），失败知识由本 ADR 承载而非 git 历史。**修正 ADR-0106 背景事实（回滚期 POM 实证）**：`xelement:4.0.1` 的 POM 将 `xelement-refresh:4.0.1` 声明为 **runtime 依赖**——`refresh-layout-kernel` 自基线起就随 xelement 传递存在于运行时 classpath（origin/main 基线同样包含），T1 的显式声明对运行时存在性是冗余的，真正的新增只有 viewpager2 与编译期可见性；「项目首个非官方组织原生依赖」的表述不成立（它一直传递存在）。由此 viewpager2 的 `NoClassDefFoundError` 是基线就埋着的雷（kernel 在、viewpager2 不在），与是否显式声明无关。回滚判据相应修正为：显式声明零残留 + 运行时构件集与基线一致，而非构件零出现。
4. **patch 错位 workaround = 页面侧同 tick epoch 重建**：T4' 模拟器实测（2026-08-24）两段结论——①`RemoveNode got wrong child index` 与 `<refresh>` 包裹**无关**：裸 list 数据整体替换即复现（FAB 点击后列表全空白，logcat 16 条错误；ADR-0106 T4 归因于包裹层是误判，T3 前推荐页 FAB 刷新「正常」实际从未在原生验证过）；②**epoch 必须与 items 替换在同一 reactive flush**：组件内 `await` 后 bump 的 flush 排在 items 替换之后，旧 list 仍吃一发错误 patch（15 条 RemoveNode，视觉靠后续重建修复）；改页面侧（refresh 函数内 `sync()` 后同步 `refreshEpoch.value++`，list `:key="refreshEpoch"`）后**错误归零、列表渲染新数据**。框架 bug 不修；成本每页 3 行（ref + :key + ++），刷新语义本就回顶，重建成本 = 首屏级。
5. **FAB 行为**：refreshing 中忽略重复点击（防重入，吸收原"原生刷新态锁定"语义）+ `opacity: 0.6` 禁用态反馈（CSS keyframes 旋转动画在原生 LynxView 未验证，ADR-0106 挂账项，不引入）；不做滚动时隐藏；a11y label 沿用 `REFRESH_A11Y_LABELS.refreshList`。
6. **范围沿用 ADR-0106 决策 3**：9 个列表实例（Recommended / IllustList / NovelList / Following / Bookmarks×2 / UserHome×2 / FollowList）；排除详情页 / Me / ErrorPage。Bookmarks/UserHome 双列表经 tab `v-if` 互斥渲染，同屏最多 1 个 FAB。数据层（createMixFeed / fetchFirstPage）零改动。
7. **验收 = 单测 + 安卓模拟器实测**（沿用 ADR-0106 决策 7 方法论，断言换形）：组件结构断言 + 负向断言（源码无 `<refresh` / `createSelectorQuery` / `finishRefresh` 字面量，防原生方案复活）+ 页面断言（9 实例 `:refresh=` 绑定、无 refreshing ref 残留）；模拟器覆盖布局解析、刷新全链路、防重入、tab 互斥、patch 错位回归。

## 被考虑的方案

- **继续修通原生桥收尾下拉刷新**：见背景——四层代偿叠加，且 decorView 全局搜索本质是页面级时序寻址，违背组件封装。否决。
- **保留 `:refreshing` prop + `@refresh` 事件接口**：该形状的唯一存在理由是原生 header 需外部信号收起；手势没了理由就没了。9 页 × 6 行纯桥接样板 = 浅模块征兆。否决。
- **复活 Fab.vue 独立组件**：seam 无第二适配器（唯一消费方是 RefreshableList），独立即成浅模块（生前为纯样式 pass-through）。否决，FAB 内联。
- **页面各自渲染 FAB**：FAB 定位/样式/a11y/防重入知识散落 9 处，违反 locality。否决，收敛组件内。
- **refreshing 中 FAB 用 CSS keyframes 旋转 spinner**：原生 LynxView 动画支持是 ADR-0106 未闭环的待验证项，为零收益反馈引入未验证面。否决，用 opacity。
- **前向 revert T1（保留 git 轨迹）**：T1 未推送，rebase drop 更干净；失败记录由 ADR-0106 正文 + 本 ADR 承载。否决前向 revert。

## 后果

- 正面：
  - 原生显式依赖声明与 JS↔native 方法面**回退到 ADR-0106 前基线**（-2 显式声明、-1 @LynxMethod、-66 行校验任务、-2 proguard keep；xelement-refresh/kernel 经 xelement POM runtime 传递在基线本已存在，见决策 3 修正）。
  - 刷新知识收口点从 4 处（组件 + 原生桥 + build.gradle + 9 页状态机）减到 **1 处**（RefreshableList.vue）；页面侧刷新代码净删约 6 行/页。
  - 无 `<refresh>` 包装层 → 无 SmartRefreshLayout 原生视图常驻、无 header 子树。
  - 刷新语义更准：refreshing 仅反映 FAB 发起的刷新；onMounted/watch/onActivated 的补拉不再误触禁用态。
- 负面：
  - 失去下拉手势这一移动端惯用交互（用户已拍板接受）。
  - 原生 LynxView 下 FAB 遮挡列表右下角内容（56dp 见方；与 web-core 一致，可接受）。
- 待验证项（T4' 模拟器验收闭环）：
  - 裸 view 容器（`relative flex-1 min-h-0`）内 list `h-full` 的原生解析（T4' 已验证通过：推荐页首屏双列/间距/FAB 定位正常）；
  - ~~裸 list 数据替换无 patch 错位~~ **已证伪**；页面侧同 tick epoch 重建后 RemoveNode 错误归零、列表渲染新数据（T4' 已验证通过，决策 4）；
  - 失败知识入档：决策 1/2 的两条平台事实（SelectorQuery-XElement 静默不命中、裸 list 整体替换 patch 错位）为本项目平台约束，禁止后来者重试 SelectorQuery 调 XElement 方法路径。
  - ~~原生 CSS keyframes 旋转动画~~ **ADR-0108 闭环**：Lynx 原生 SDK 字节码实证含 LynxKeyframeAnimator + TransformProps（transform 旋转引擎存在），模拟器实测确认行为（T2''）。
  - 失败知识入档：决策 1/2 的两条平台事实（SelectorQuery-XElement 静默不命中、`<refresh>` 包裹 patch 错位）为本项目平台约束，禁止后来者重试 SelectorQuery 调 XElement 方法路径。
