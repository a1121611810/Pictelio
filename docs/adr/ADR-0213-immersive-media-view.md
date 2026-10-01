# ADR-0213：沉浸式媒体查看 —— 详情页全屏看图 + 点图隐藏全部界面元素

## 状态

accepted（2026-10-01）

决策方向已拍板（**应用内沉浸 + 原生系统栏隐藏都做**，不做 Expressive 基线，只在现有 MD3
v0.192 范围内做深）。其中**决策 3 的返回可达性**与**决策 7 的手势裁决**以「真机取证前置」章的
探针结果为准：探针可以把这两条从「待验证」改写成「已实证」，**若结果与预期相反则回改本 ADR
（不推翻决策方向）**。

## 背景

诉求是「界面不够沉浸」。诊断结论是：对图站类应用，收益最大的一项是**详情页全屏看图 + 点图隐藏
所有界面元素**，而不是继续在颜色/圆角上打磨。本 ADR 只解决这一项。

### 一、关键发现：原生侧基础设施已完整存在，本决策**几乎零 Java 改动**

这是本 ADR 最重要的结论，它直接决定了「沉浸模式基本是纯前端接线」这一可行性判断。以下每条均
**已验证**（见「复核判据」第 1 组给出的复算命令），锚点为文件路径 + 符号名：

| # | 既有能力 | 锚点 |
|---|---|---|
| 1 | 边到边已启用：`EdgeToEdge.enable(this)` 在 `onCreate` 内、`super.onCreate` 之后、`applyStatusBarAppearance()` 之前 | `packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java` 的 `onCreate` |
| 2 | 隐藏/显示系统栏的方法已存在，`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` + `hide/show(Type.systemBars())` | 同上 `applySystemBarsHidden(AppCompatActivity, boolean)`（static 包私有，供单测） |
| 3 | 隐藏态有**闩锁**并有单测覆盖；切换时经 `syncStatusBarHidden` 回写并重下发外观 | 同上 `statusBarHidden` / `syncStatusBarHidden` / `isStatusBarHidden` |
| 4 | 持久化开关已存在：仅 `"true"` 判真，缺失/损坏一律 false | 同上 `isFullscreenModeRequested(Context)`、`KEY_FULLSCREEN_MODE`、`SYSTEMBARS_PREFS` |
| 5 | 冷启动/重建重设已在 `onCreate` 尾部完成，且注释自述依据「**新 Window 默认全显**」 | 同上 `onCreate` 尾的 `if (statusBarHidden) applySystemBarsHidden(this, true);` |
| 6 | insets 已桥接为全局事件，值变化才发 | 同上 `onWindowInsetsChanged` / `sendInsetsEvent` / `EVENT_INSETS` |
| 7 | **根容器已按 insets 上色**：系统栏隐藏后根 padding 归零 = 内容真正边到边 | `packages/app-lynx/src/App.vue` 的 `paddingTop: safeTop.value + 'px'` / `paddingBottom: safeBottom.value + 'px'`（`initSafeArea()` 于 `onMounted` 订阅 `pictelioInsets`） |
| 8 | JS 通道已通（含失败回滚内存态 + 禁静默 warn） | `packages/app-lynx/src/stores/settingsStore.ts` 的 `setFullscreenMode`；`packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java` 的 `setSystemBarsHidden(boolean, Callback)`；类型声明 `packages/app-lynx/src/rspeedy-env.d.ts` |
| 9 | 设置页开关已存在 | `packages/app-lynx/src/pages/Me.vue` 的 `toggleFullscreenMode` + `ME_A11Y_LABELS.fullscreenMode` |
| 10 | 跨端契约已被源级测试钉住 | `packages/app-lynx/src/utils/safeAreaJavaContract.test.ts` 的 describe「系统栏 JS↔Java 契约锚点」 |
| 11 | 系统返回桥可用（手势/按键 → JS 决策） | `LynxActivity` 的 `getOnBackPressedDispatcher().addCallback(...)` → `sendGlobalEvent("pictelioBack", …)`；消费方 `packages/app-lynx/src/router.ts` 的 `handleSystemBack` / `registerSystemBackHandler` |
| 12 | 启动屏位置正确（AndroidX 要求 `super.onCreate` 之前） | `LynxActivity.onCreate` 内的 `SplashScreen.installSplashScreen(this)` |

**⇒ 本决策不需要新建 Java 代码。** 需要动的只有前端接线 + 一个新增的状态所有权单例。若实施中
发现必须改 Java，本 ADR 需重开（见「风险与回退路径」R4）。

> ⚠️ **一处必须与给定口径区分的机制细节**：`applySystemBarsHidden(this, true)` 的「重建后重设」
> 分支位于 **`onCreate` 尾部**，由**持久化键**（`isFullscreenModeRequested`）驱动，**不由内存闩锁
> 驱动**。且 `onResume` 内**没有**「重新应用隐藏」的分支（`onResume` 只做暗色事件兜底比对）。
> 这两点共同决定了决策 4/5/6 的形状，务必不要读成「闩锁会在 resume 时自愈」。

### 二、详情页现状（`packages/app-lynx/src/pages/IllustDetail.vue`，已验证）

- 根容器：`class="w-full h-full flex flex-col relative bg-surface"`
- 顶栏：**独立组件** `PageTopBar back :title=… @back="goBack"`（变体 b，ADR-0194）
- 内容容器：`scroll-view class="w-full flex-1 min-h-0"`，其内图片层为
  `relative w-full bg-surface-container-highest overflow-hidden`
- **图片已是满幅宽**（`w-full`），高度按原图比例显式给（`detailImageHeight`）
- 三个浮层挂在页面层、DOM 顺序在 `scroll-view` 之后（覆盖内容区）：
  `showComments` / `showPicker` / `showBookmarkPanel` 三者宿主均为 `class="absolute inset-0"`

**图片层分支是 3 处，不是 2 处**（订正给定口径）：ugoira 播放器分支（`v-if illust.type === 'ugoira'`）、
多图连续列表分支（`v-else-if`，每页一层 `v-for`）、单图分支（`v-else`）。复算：
`grep -c 'bg-surface-container-highest overflow-hidden' packages/app-lynx/src/pages/IllustDetail.vue` → **3**。
⇒ 沉浸的单击绑定必须覆盖**三处**，只改单图分支会漏掉动图与多图两个分支。

**`@tap` 计数（复算口径精确到「处理器」而非「字面」）**：
`grep -n '@tap' packages/app-lynx/src/pages/IllustDetail.vue` → 9 行命中，其中 **1 行是模板注释**
（解释 `@tap.stop` 防冒泡的那行），实际处理器 **8 个 = 6 个裸 `@tap` + 2 个 `@tap.stop`**
（`openAuthor` / `toggleFollowAuthor` / `onSaveEntry` / `showComments = true` /
`navigate('/downloads')` / 标签 `openSearch`，以及 `toggleWatchLater` / `openTagNeighbors` 两个
`.stop`）。⚠️ 枚举**逐个对应一个处理器**：`showComments` 在本页**只有一处** `@tap`
（`showComments = true`；另两处 `showComments` 出现分别是 `ref` 声明与 `CommentOverlay` 的
`@close`，**均非 tap 处理器**）——报数时勿把它重复计一次。
**图片层容器本身零 `@tap`**（已验证），其内子组件 `SkeletonImage` 亦无 `@tap`。

> ⚠️ **订正给定口径的一处结构性事实**：这 8 个 `@tap` 全部位于图片层**下方**的
> `p-4 bg-surface-container-lowest` 信息块内，与图片层是**兄弟节点、不是父子**。
> ⇒ 它们**不会**冒泡到图片层，「与已有 `@tap` 抢事件」在**兄弟关系上不成立**。
> 真正的冲突只有一处，见决策 2。

### 三、沉浸机制的第二根支柱：insets 事件本身

隐藏系统栏**不只**隐藏栏：`sendInsetsEvent` 会把新值推给 JS，`safeTop`/`safeBottom` 归零，
`App.vue` 根容器的上下 padding 随之归零 ⇒ 内容**真正**边到边。所以「沉浸」是两件事的合取：
**应用内 chrome 显隐**（前端）+ **系统栏 + 根安全区归零**（原生 + insets 管线）。只做前者
仍是「贴边但不沉浸」。

## 真机取证前置（P1–P7）

以下 7 项**本 ADR 未验证**，全部**依赖真机**（Lynx 的 scroll-view / image 手势 / 系统栏时序），
必须**在实施前**取证。按 ADR-0207 的纪律：**每条判据必须自带阳性对照**，否则「什么都没发生」
无法区分「引擎不支持」与「没触发」。探针建议挂一次性 dev-only 块（`BuildConfig.DEBUG` 门禁范式，
见 `LynxActivity.applyDevIntentHooks`），取证后删除。

| # | 待验证命题 | 探针设计 | 判读要点 |
|---|---|---|---|
| **P1** | 透明 `absolute inset-0` 浮层宿主是否吞掉下层图片的 tap | 在 `IllustDetail.vue` 三个浮层宿主上挂 `@tap` 计数（不改视觉），浮层开/关两种态下点图片区 | **阳性对照**：浮层打开时点浮层卡片本身必须有响应。若「关态计数 +1、开态计数不变」⇒ 宿主吞点击（安全）；若「开态也 +1」⇒ 透明宿主不吃点击，tap 会穿透到图片（危险）。`NovelDetail.vue` 的评论浮层有 `@tap="selection.onTapAway"` 而本页三个宿主**没有** catch-all，本差异是真差异还是无用武之地，只有真机能分 |
| **P2** | `scroll-view` 内**滑动**是否在抬手时派发 `@tap` | 图片层挂 `@tap`，分别做「原地单击」与「垂直滑动 200px 后抬手」两种手势，各计 20 次 | **阳性对照**：原地单击必须命中（证明绑定有效）。若滑动也命中 ⇒ 滑动看图会误触发 chrome，决策 7 的单击判定需加位移阈值；若滑动不命中 ⇒ 直接用 `@tap` |
| **P3** | 沉浸态下同 Activity 实例 resume（`launchMode="singleTask"` 从 recents 回）系统栏是否仍隐藏 | 进沉浸 → Home → recents 回来 | **阳性对照**：同路径下先设 `fullscreenMode=true`（持久化）作对照。若沉浸态回来后栏**仍隐藏** ⇒ 决策 5 的四层保障需要补第五层（`onResume` 兜底复位） |
| **P4** | 沉浸态下系统**手势**返回是否仍派发 `pictelioBack` | 隐藏 `PageTopBar` 后做系统边缘上滑返回 | **阳性对照**：非沉浸态同手势必须正常 pop。这是决策 3「唯一返回入口」的唯一凭据；阴性 ⇒ 决策 3 必须改为沉浸态保留一个最小返回入口 |
| **P5** | 动态 `accessibility-label` 在 Lynx 上是否生效 | 图片容器按 `chromeHidden` 切换 `accessibility-label` 两段文案 | 已知张力：`utils/accessibility.ts` 注释自述「Lynx 元素属性不支持 Vue 插值表达式」（故 `A11Y_ELEMENT_ENABLED` 必须绑常量），而 `Me.vue` 实有 `:accessibility-label="ME_A11Y_LABELS.fullscreenMode"` 插值绑定 ⇒ **两者需真机分清是「`:accessibility-element` 不可插值」还是「元素属性全不可插值」**。⚠️ **存量先例不构成反证**（已验证）：`Me.vue` 的 `:accessibility-label` 绑定**全部指向注册表里的模块常量**（`ME_A11Y_LABELS.*`），**没有一处**是随响应式状态切换的表达式 ⇒ 决策 9 要的「按 `chromeHidden` 切换的动态 label」在本仓**无既有先例**。**⚠️ 后果等级 = 可达性阻塞，与 P4 同级（不是「只影响防御层」）**：阴性时决策 3「必须保留的三条非可见路径」之第 3 条（屏幕阅读器退出路径）**根本不存在** ⇒ 屏幕阅读器用户进入沉浸后**无路可退**，是**可达性死路**。**阴性时的回退动作（必须落地，不靠推测）**：改为**常驻一个不依赖 `accessibility-label` 插值的退出入口**——沉浸态保留一个**始终以常量 label 标注**的最小退出控件（同 R1「最小返回入口」的形态，语义为「退出沉浸」而非「返回」），使决策 3 第 3 条路径退化为不依赖插值的实现 |
| **P6** | 隐藏 `PageTopBar` 后 `scroll-view` 的滚动位置是否跳变 | 滚到图片区中部再切 chrome，记录内容首行元素 | **阳性对照**：不切换时同样滚动位置的截图。若跳变 ⇒ 决策 1 要求「切换前后记录并恢复滚动位置」 |
| **P7** | 边到边时图片是否真的顶到屏幕最上/最下像素 | 沉浸态截图，量图片顶端到屏幕顶的距离 | **阳性对照**：非沉浸态量同一边距（应 = `PageTopBar` 高度 + `safeTop`）。两条边都量，Android 的三键/手势导航底栏可能只影响一边 |

**探针失败的处置**：P4 阴性 ⇒ 决策 3 回改（保留最小返回入口）；P2 阳性（滑动误触发）⇒ 决策 7
回改（加位移阈值）；P3 与 P7 为体验级 ⇒ 记为已知限制，不改决策方向。
**P6 单列，按阳性/阴性两分支分流（不并入「体验级」）**：见下。
**P1 无论正负都只影响防御层实现**，不改方向；**P5 的后果等级与回退动作见 P5 行**（可达性级，
**不是**「只影响防御层」）。

**P6 处置（与决策 1 同一条口径，不存在矛盾）**：P6 之所以不能与 P3/P7 一起归「体验级」，是因为
决策 1 已经为它**定好了恢复逻辑**——「切换前后记录并恢复 `scroll-view` 滚动位置」是决策 1
「P6 的连带约束」那条给出的**唯一出处**。故：

- **阳性（切换 chrome 后滚动位置跳变）⇒ 执行该恢复逻辑**。此时它**不是**已知限制，而是**必做的
  实现项**，并按决策 1 的要求**写进验收**（它只在真机上可见）
- **阴性（不跳变）⇒ 记为已知限制**。恢复逻辑可不实现；若已实现，作为无害冗余保留，由实施者择一

> 措辞纪律：「**阻塞级**」一词在本 ADR **只用于 P4**（开工前置门，见决策 3）。P6 阳性只是**必做的
> 实现项**，不得被读成第二道阻塞门。

## 探针实测结论（2026-10-01，模拟器 `emulator-5554` / Android 14 / 1080×2160 / density 480）

### P5 取证结果（#890，2026-10-01）：**阳性** —— 动态 `accessibility-label` 在真机生效

**探针与方法**：用 `adb shell uiautomator dump` 直接读 **a11y 树**。本 ADR 早先依据 ADR-0061
断言「Lynx 侧只暴露表单元素」——该断言**过宽**：实测**带 `accessibility-element` 标注的容器
会出现在树里**（详情页 12 个节点中含 2 个带 `content-desc` 的图片容器）。
⇒ **P5 可以在模拟器上直接取证，不必靠「代码写了」推断。**

| 状态 | a11y 树读到的 `content-desc` |
|---|---|
| 非沉浸 | `第 1 / 9 张，进入沉浸模式` · `第 2 / 9 张，进入沉浸模式` |
| 沉浸 | `第 1 / 9 张，退出沉浸模式` · `第 2 / 9 张，退出沉浸模式` |

⇒ **标签随 `chromeHidden` 实时切换**（决策 9 的动态绑定成立），且**多图分支已带「第 n / N 张」**。
决策 3 的三条非可见路径之第 3 条**确实存在**，**P5 行指定的回退动作（常驻常量 label 退出控件）
不需要落地**——决策 3「隐藏态不保留任何可见 chrome」得以保持。

**顺带查清 P5 行原本要求分清的那个歧义**：是「`:accessibility-element` 不可插值」还是
「元素属性全不可插值」？⇒ **两者都可插值**。`A11Y_ELEMENT_ENABLED` 绑常量不是引擎限制，
是本仓自己的约定（注释写「只绑元素、不绑文案」），与引擎能力无关。

#### ⚠️ 两条同源的平台事实（P5 阳性**没有**覆盖它们，必须单独登记）

1. **标注容器不被标记为可激活**：带 `@tap` + `accessibility-element` 的 `<view>` 在树里
   `clickable="false"`（`focusable="true"`）。对照组：登录页的 `<input>` 报 `clickable="true"`
   ⇒ 是 **Lynx 的 a11y delegate 不为 `<view>` 的 tap 处理器置 clickable**，不是本仓绑定缺失。
   **✅ 已用真 TalkBack 证伪其后果（2026-10-01，Marvin `com.google.android.marvin.talkback`）**：
   启用 TalkBack 后，焦点可移动到图片容器（绿色焦点框覆盖全屏），**双击即激活**——
   进入沉浸与退出沉浸**两个方向都实测通过**（退出后顶栏恢复 `(255,255,255)`）。
   ⇒ **`clickable=false` 是红鲱鱼**：该 flag 不决定 TalkBack 能否激活节点，
   只说明 delegate 没有广告 `ACTION_CLICK` 语义动作，而 TalkBack 的双击落到该节点
   仍是一次真实触摸。**决策 3 的第 3 条路径完整成立。**
   ⚠️ **测这条的代价与陷阱**：TalkBack 必须在模拟器上手动启用
   （`settings put secure enabled_accessibility_services com.google.android.marvin.talkback/…`），
   且**在紧跟转场后立即 `uiautomator dump` 会取到空树**（本次首次 dump 得 `[]`，
   关闭 TalkBack 后复验得 `第 1 / 6 张，退出沉浸模式`）⇒ **a11y 取证要等转场落定再 dump**，
   否则会误判成「沉浸态没有朗读路径」——那正好是本节要防的假阴性。
   ⇒ 系统返回键仍是**第二条**被保证的退出路径（P4 阳性，#888 CLOSED；本轮 F1 修复亦复验）。

2. **`accessibility-traits` 会吞掉 `content-desc`（禁止使用）**：引擎确实认这个属性
   （lepus 层声明了 `accessibility-element` / `accessibility-label` / `accessibility-traits`
   三项），但在图片容器上加 `accessibility-traits="button"` / `"Button"` 后，
   a11y 树里**原有的 2 个 `content-desc` 全部消失**（12 节点 → 0 个 desc）。
   ⇒ **它是「让节点可激活」的直觉修法，实际是净回退**。想用它改成可激活的人，
   会先丢掉已经生效的朗读路径。**本条是 ADR-0213 里唯一一条「看起来是修复、实测是回退」的记录。**

### P6 取证结果（2026-10-01）：**阴性** ⇒ 决策 1 的「记录并恢复滚动位置」**不实现**（按上面 P6 处置的阴性分支）

**测量**：详情页滚到图片区中部截 A → 单击图片进沉浸 → 再单击退出截 G。判据用**全图像素比对**
（自写 PNG 解码，逐像素 RGB 比较），而非「看首行是哪个元素」这类目视描述。

**结果**：A 与 G 的全图差异 = **425 px（0.018%）**，且差异**全部**落在 y 23–54 / x 162–183 的
22×32 px 方框内 —— 即状态栏时钟的末位数字由 `22:32` 变为 `22:33`（两次截图相隔约 9 秒）。
除时钟外**画面逐像素一致** ⇒ 隐藏 `PageTopBar` 引起的 `scroll-view` 盒高变化**没有**造成滚动跳变。

**判据自检（必须，否则「100% 一致」不可信）**：
- 阳性对照：相邻两次**仅滚动 400px** 的截图差异 = **64.6%** ⇒ 判据对真实位移灵敏。
- 陷阱记录：首次判据写成 `all(...)` 逐行取样，**对「必然不同」的两张图也返回 100%**（恒真），
  若只看被测量那一对，会把「P6 阴性」当成已证。**修正为全图逐像素比对后才得到上表结论。**
  ⇒ 与 `glossary-md3-alignment.md` §13.6 同源的纪律再次生效：**判据必须先自证能红**。

**结论落点**：决策 1「P6 的连带约束」按阴性分支处理 —— 记为**已知限制**、恢复逻辑**可不实现**
（本仓当前未实现任何 scroll 恢复代码）。`IllustDetail.vue` 中 `scrollTo` / `scroll-top` /
`scrollTop` 命中仍为 **0**，即现状与本结论一致，无「文档说已实现而代码没有」的缺口。

### 决策 5 的 L2 / L3 补齐（#889 验收缺口，见 issue #889）

code-review 双轴审查（F1）发现：系统栏联动落地时，L2 的复位对象错（`useImmersiveChrome` 的
`onUnmounted` 只 `exit()`，**不碰系统栏**）、L3 完全未接线 ⇒ 沉浸态按返回离开本页时
`applySystemBars(false)` 从未被调用。修复：`IllustDetail.vue` 持有唯一幂等出口
`releaseImmersive()`（先 `exit()` 再 `onImmersiveExit()`，顺序即语义），L2 挂 `onBeforeUnmount`，
L3 挂 `registerBackGuard(... return false)`（在历史栈 pop **之前**裁决，故上一页不会渲染出
「没有系统栏」的一帧），并随卸载注销守卫。

**真机取证**：详情页单击进沉浸 → 系统返回。三态 `topResumedActivity` 的
`ActivityRecord{df0b33e … t2432}` **完全一致** ⇒ 排除「Activity 重建导致系统栏自然恢复」这一
替代解释；沉浸态截图无状态栏，返回后截图状态栏（时钟）恢复。⚠️ 该判据的**弱项**已登记：顶部
色带「暗像素占比」不可用作判据（沉浸态顶部是**图片本身**偏暗，属开放世界内容污染，
见「用颜色像不像背景判渲染缺陷」这一失败族）—— 决定性证据是**目视时钟有无** + **Activity 实例未变**。

## 决策

### 决策 1：状态形态 = 页面本地 ref + **模块级单一所有权 token**；**不做自动隐藏超时**

- 状态变量 `chromeHidden` 为**页面本地 `ref`**，不进 Pinia：它是「当前查看状态」，不是跨页共享数据
  （符合「数据层分流」硬约束：页面独有数据由组件自身管理生命周期）
- **单一所有权**：新增模块级 token（单一事实源，禁在多处各写一份布尔量）。新 owner 申请时若已存在
  owner，**先强制旧 owner 复位（幂等）再接管**。这解决「A 页进沉浸 → push B 页 → B 页 pop →
  A 页已卸载但标志仍为 true」这一类泄漏
- **触发 = 仅手动单击切换，无自动隐藏超时**

**为什么不做自动隐藏超时**（四条理由，其中前两条是结构事实而非偏好）：

1. 顶栏**不在图上**。`PageTopBar` 是 `scroll-view` 的**上方兄弟**，隐藏它换来的是「图片可用高度
   增加一个顶栏高度」，不是「图变大」。用户为这点收益换来的代价是「突然失去所有可点入口」，
   收益/代价比不成立
2. **恢复路径的可靠性是未验证的**。自动隐藏后「chrome 曾经存在」这件事用户已经忘记，恢复只能靠
   盲点图片；而单击判定的可靠性**正是 P2 要测的**——若引擎把滑动抬手也判为 tap（P2 阳性），
   「滑动看图后想恢复」会变成连续误触发。**把恢复入口押在一个未验证的判定上、且叠加一个用户
   已遗忘其存在的状态，是把两个不确定性相乘**
3. 自动隐藏引入定时器，而定时器与 `scroll-view`、前后台切换存在未验证的竞态，泄漏面大一个量级
4. 手动切换可预期：点一下没反应（漏判）用户会再点一次；自动隐藏漏判则用户面对一个**没有任何
   入口的界面**，且不知道原因

**无定时器 ⇒ 无「定时器未清除」这一类泄漏**，这是本决策最大的实际收益。

**P6 的连带约束**：隐藏 `PageTopBar` 会改变 `scroll-view` 的盒高 ⇒ 切换时必须**记录并恢复滚动
位置**，否则用户在图中间点一下会跳回顶部。这是实现细节，但**必须写进验收**，因为它只在真机上可见。
**本条给出的是「已定好的恢复逻辑」，其强制性由 P6 探针结果分流**：阳性 = 必做阻塞项并进验收；
阴性 = 登记为已知限制、可不实现（分支定义见「探针失败的处置」的 P6 单列段）。

### 决策 2：单击绑定在**三处图片层容器**上（不动 8 个已有处理器），只给「n / N」角标补 `@tap.stop`

**事件关系的确切结论**（订正给定口径，见「背景」二）：

- 8 个已有 `@tap` 与图片层是**兄弟**，不冒泡 ⇒ **无需改、也不应改**它们
- **唯一真冲突**：多图分支的「n / N」页角标宿主 `class="absolute top-2 left-0 w-full flex flex-row
  justify-end pr-2"` 是**图片层的子节点** ⇒ 点角标会冒泡到图片层并切换 chrome。
  处置：给角标宿主加 `@tap.stop`（沿用本页 `toggleWatchLater` / `openTagNeighbors` 的同款范式）
- `SkeletonImage` 零 `@tap`（已验证）⇒ 不存在第二处冲突
- **浮层优先级**：见决策 3「浮层强制退出沉浸」+ 探针 P1。设计上不依赖 P1 的结论（浮层打开时
  沉浸态必然已退出），P1 只是验证「不依赖沉浸态时也不会穿透」

**为什么绑容器而不是绑图片**：绑容器可覆盖「图未加载完成时点空位」的情形，且三处形态一致；
绑 `<image>` 在 Lynx 上有已知陷阱族（`PageTopBar` 注释自述「返回键 `@tap` 绑在 view 上——
`text` 根级 `@tap` 原生无效（ADR-0055 家族）」）。故绑 `view`，符合本仓既有口径。

### 决策 3：chrome = 顶栏 + 操作/信息行 + 页角标；隐藏态**不保留任何可见 chrome**，返回路径交给系统返回键

**chrome 边界（明确清单）**：

| 元素 | 锚点 | 隐藏时 |
|---|---|---|
| 页级顶栏（含 `‹` 返回键与标题） | `PageTopBar` 变体 b | **隐藏** |
| 操作/信息行（作者、收藏、评论、下载、标签） | 图片层下方的 `p-4 bg-surface-container-lowest` 块 | **隐藏** |
| 「n / N」页角标 | 多图分支的 `absolute top-2 left-0 w-full …` | **隐藏**（注意：**图片层本身不隐藏**——沉浸隐藏的是 chrome 不是图。角标是图片层的**子节点**，父不隐藏 ⇒ 它**必须独立条件渲染**，不能靠父级级联） |
| 骨架屏 / 错误态 | `loading` / `errorMsg` 两个分支 | **不适用**（两者与沉浸互斥，沉浸只在 `illust` 就绪后可用） |

**必须保留的只有三条「非可见路径」**：

1. **系统返回键**（决策的核心）。沉浸态下系统返回**正常 pop、不劫持**——`router.ts` 的
   `handleSystemBack` 经 `evaluateBackRoute` 裁决后走 `goBack()`。不回改语义的好处是：页内返回
   入口消失**不造成功能缺口**，只是入口换了个位置
2. **图片单击**（再次点 = 退出沉浸）
3. **屏幕阅读器退出路径**：图片容器承载动态 `accessibility-label`（决策 9）。**该路径的可达性依赖
   P5**（探针判为可达性级）：P5 阴性时**不得**靠这条路径交差，须改走 P5 行指定的回退动作
   （常驻一个常量 label 的最小退出控件）。**✅ P5 已取证为阳性（2026-10-01）** —— 动态 label 真机
   随 `chromeHidden` 切换，回退动作**不需要**落地，决策 3「隐藏态不保留任何可见 chrome」得以保持。
   ⚠️ **但「节点是否广告可激活语义动作」未取证**（标注 `<view>` 报 `clickable=false`，见「探针实测
   结论」的平台事实 1）⇒ **唯一被保证的退出路径仍是系统返回键**（P4 阳性，#888 CLOSED）

> ⚠️ **不可逆性风险登记（必须真机取证 P4）**：`PageTopBar` 被隐藏后，**页内**返回入口消失。
> 唯一返回路径是系统返回键（手势 + 按键），其可达性**依赖 P4 的真机结果**。
> 若 P4 阴性（沉浸态下引擎不派发 `pictelioBack`），后果是**页面无任何返回入口**——这不是体验
> 降级，是**死路**。故 P4 是**唯一的阻塞级前置门**：阴性即回改本决策为「沉浸态保留一个最小返回
> 入口（如右上角 `AppIcon` 浮标）」，不靠推测放行。
>
> **「唯一」不因 P5 升格而稀释**（区分两件事）：P5 阴性同样是**可达性死路**（后果等级与 P4 相同），
> 但它的处置是**换一个已定好的实现形态**（P5 行的回退动作：常驻常量 label 退出控件），**不回改
> 决策、也不构成开工前置**；P4 阴性则是**入口不可逆消失**，只能回改决策本身。⇒ **开工前置门仍只有
> P4 一道**，P5 是「实现形态须随探针结果二选一」。
>
> 另注：`android:launchMode="singleTask"`（`packages/android-host/android/app/src/main/AndroidManifest.xml`）
> 意味着从 recents 回来是**同一实例**，不会借「重建 → 新 Window 全显」顺带复位系统栏（P3 同源风险）。

**浮层优先级**：**浮层（评论 / 选页 / 收藏面板）打开 ⇒ 强制退出沉浸**。理由：这三者都是需要 chrome
的模态（标题、按钮、关闭入口），沉浸态下打开会得到一个「没有关闭按钮的模态」。实现为进入浮层的
既有入口（`showComments = true` 等赋值处）统一走一次「退出沉浸 + 打开」的复合动作，不在浮层组件
里反向感知沉浸（避免反向依赖）。

### 决策 4：进入沉浸 → `setSystemBarsHidden(true)`；退出 → **回落到设置项当前值**，不是硬编码 `false`

- 进入：`setSystemBarsHidden(true)`（复用既有通道，不新增 Java）
- 退出：`setSystemBarsHidden(settingsStore.fullscreenMode)` —— **回落到用户原设定**

**为什么不是硬编码 `false`**：若用户本就把「全屏模式」设为开（`fullscreenMode === true`），
此时全应用已处于系统栏隐藏态；沉浸退出时若硬编码 `false`，会把用户的**持久设定静默改掉**一次
（表现为：下次从 `Me.vue` 看开关还是开，但实际已被改回可见 —— 状态与 UI 不一致）。回落到设置值
⇒ 两条路线共存且互不污染。

**失败回滚**：`setSystemBarsHidden` 的 callback 返回 err 时，必须**同步回滚 `chromeHidden`**
（照抄 `settingsStore.setFullscreenMode` 的既有范式：回滚内存态、保留用户意图、模块前缀
`console.warn`）。**禁止静默失败**（测试硬约束 #3）。

### 决策 5：复位保障 = 四层，且明确已知缺口

「flag 设了没复位，退出应用后系统栏还是隐藏的」是本决策最容易出 bug 的地方。四层保障按
**兜底方向**排列：

| 层 | 机制 | 覆盖的失效场景 | 锚点 |
|---|---|---|---|
| **L1 单一所有权** | 模块级 token；新 owner 接管前强制旧 owner 幂等复位 | 页面间 push/pop 交错、owner 意外卸载 | 决策 1 |
| **L2 生命周期兜底** | `onUnmounted` 必复位 | 路由 pop、页面被卸载的一切路径 | `IllustDetail.vue` |
| **L3 返回路径必经** | `registerBackGuard` 内先复位再放行（`return false` **不拦截**） | 系统返回**与**页内返回两条路径（两者共用守卫链） | `router.ts` 的 `registerBackGuard` / `runBackGuards` / `requestBack` / `handleSystemBack`；范本消费方 `NovelDetail.vue` 的 `unregisterBackGuard` |
| **L4 进程外兜底（刻意留空）** | 无 —— 见下 | 杀进程 / 同实例 resume | 见下 |

> 措辞统一口径：**四层保障，其中第四层刻意留空**。L4 是**已知缺口**而非待补项；「门禁断言只覆盖
> L1–L3」是决策，不是遗漏（对应复核判据第 6 条的明确警告）。

**L4 的确切事实（已验证）**：`onResume` **没有**「重新应用隐藏」的分支；`onDestroy` 复位的是
insets 与 `uiMode` 静态字段（`sContentW` / `sInsetTop` / `sLastSentTop` 等），**不复位系统栏可见性**。
但失败方向是**安全**的：`onCreate` 尾部那句 `if (statusBarHidden) applySystemBarsHidden(this, true)`
的注释自述依据是「**新 Window 默认全显**」⇒ 进程被杀后新实例从「可见」起步，**不会卡在隐藏**。
**真正会卡的是 `singleTask` 下同实例 resume**（不新建 Window）⇒ 这正是探针 **P3**。

**P3 阳性则本决策补 L5：只走 `onResume` 侧兜底复位（Java）。**
⚠️ **原备选「或要求 JS 侧在 `onHide` 语义上复位」已删除——本栈不存在可验证的「页面隐藏」JS 钩子**，
证据见下。**L5 不得直接实施**：钩子问题须先按 R4 流程解决（见「L5 的钩子前置」）。

**「JS 侧页面隐藏钩子」不存在的证据（已验证）**：

- **框架侧**：`vue-lynx` 的公开导出面只有 Vue 组件生命周期（`onMounted` / `onBeforeUnmount` /
  `onUnmounted` / `onActivated` / `onDeactivated` / `onScopeDispose`），**无任何前台/后台或可见性
  钩子**（逐项核对 `vue-lynx` runtime 的导出清单）。其 `onLifecycleEvent` 只是把宿主下发的
  `globalEventFromLepus` 转发进 `GlobalEventEmitter` 的**通用桥**，**不携带**任何内置的隐藏/显示
  事件名——要触发它仍需宿主先发事件
- **本仓侧**：`app-lynx` 内搜不到 `visibilitychange` / `pagehide` / `pageshow` / app-state 类钩子；
  `src/composables/` 下 8 个 composable **无一**提供生命周期/可见性能力
- **原生侧**：`onPause` 只调 `lynxView.onEnterBackground()`、**不向 JS 发任何事件**；现有全局事件
  只有 `pictelioBack` / `EVENT_INSETS` / `EVENT_DARK_MODE` 与 bench/翻译类
- ⇒ **要拿到该信号只能新增一个原生全局事件 = Java 改动**，与「零 Java 改动」前提直接冲突

**L5 的钩子前置（若 P3 阳性，必须先解决再动手）**：L5 降级为**待解前置项**——须先在两条路里择一
并落定：① 接受 Java 改动、按 R4 重开本 ADR 加一个 `onPause` 全局事件；② 在真机上实证某个**当前
未验证**的引擎钩子确实可触发。**在二者之一落定前，不得凭空写一个钩子名进实现**（Goodhart：不为
想象的钩子建门禁）。

**不选 `onUnmounted` 之外的 `onDeactivated`**：keep-alive 路径在 Lynx + vue-router 下是否触发
`onDeactivated` 未验证；与其押注一个未验证钩子，不如让 **L3 返回守卫**覆盖「离开本页」这一事实上的
唯一出口（L2 + L3 已足够，**L3 是与「离开」语义直接绑定的，不依赖组件生命周期钩子的具体触发时机**）。
（补充事实：`onActivated` 在本仓**已被实证可用**——KeepAlive 白名单页的返回锚点就用它，且有
template 测试钉住；`onDeactivated` 虽由 `vue-lynx` 导出，但全仓**零使用**，只存在于注释中。
故「未验证」的只是**触发时机**，不是「API 是否存在」。）

**为什么不用「Java 侧加一个 onResume 复位」**：那需要新增 Java 代码，与「零 Java 改动」的前提冲突；
且 P3 未跑之前不知道是否真的需要（Goodhart：别为想象的需求建门禁）。P3 阳性再开，届时写进本 ADR。

### 决策 6：沉浸**独立于** `settings_fullscreen_mode`，**严禁**在沉浸路径写该键

**决策：独立。** 两者共用同一个原生通道 `setSystemBarsHidden`，但**不是同一个开关**。

**理由（其中第 1 条是实测口径决定的，不是偏好）**：

1. **写键 = 永久生效**，这是 Java 侧口径决定的：`isFullscreenModeRequested` 读的是同一个键，
   而 `onCreate` 尾部据此重设系统栏。⇒ 若沉浸复用该键，**每次冷启动都会进入沉浸**——而用户上次
   只是在一张图上点了一下。这不是 bug，是「临时状态被存成了持久偏好」的直接后果
2. **语义不同层**：设置项是「设备级持久偏好」；沉浸是「当前查看状态」。混用会让「全屏模式」这个
   开关的语义从「全应用隐藏系统栏」漂移成「上次看图时点过一下」
3. 若反过来做成「全屏模式 = 沉浸总闸」（沉浸仅在开关为开时可用），则首次使用要先跳去 `Me.vue`
   开开关，交互断裂；且用户会得到「我明明点了图但什么也没发生」

**硬规则**：沉浸路径**只调** `setSystemBarsHidden`，**严禁**写 `FULLSCREEN_MODE_KEY`。
`settingsStore` 的 `setFullscreenMode` 是该键的**唯一写点**，沉浸**不得**复用它。
⇒ 这条需要门禁（决策 9 之外的复核判据第 2 条），否则将来「顺手复用一下」会静默把临时状态写成持久偏好。

**共存的唯一交互点**：退出沉浸时读 `fullscreenMode` 作为回落目标（决策 4）。这是**读**，不违反本决策。

### 决策 7：手势边界 —— 本轮**只加** `@tap`；**不做**双指缩放，**不做**长按保存

**现状（已验证，全仓口径）**：

- `@pinch` / `@gesture` 全仓命中 **0**（`grep -rn "@pinch\|@gesture" packages/app-lynx/src | wc -l` → 0）
  ⇒ **本仓没有任何多指手势词汇**。双指缩放是**从零新建**，不是「接上已有的」
- `@longpress` 只存在于小说侧（`NovelDetail.vue` 的 `selection.notifyLongPress` 及其
  `useTextSelection` / `createTextSelection` 两条 primitive），**图片详情页零长按**
- 原生 touch 三件套（`@touchstart`/`@touchmove`/`@touchend`）只用于**按压视觉反馈**与
  **横滑轮播**（`GlassCard` / `TagPressChip` / `BookmarkButton` / `CarouselSwiper`），**不用于手势语义**

**决策**：

- **不做双指缩放**。理由：需要多指事件 + 与 `scroll-view` 的手势仲裁，两者在本仓**都没有先例也没有
  阳性对照**；在一个连「滑动会不会误触发 tap」都还是 P2 待测的引擎上新建多指手势仲裁，是把
  三个不确定性相乘。列为后续，前置条件是 P2 出结果且缩放需求经真机确认
- **不做长按保存**。当前保存走操作行 `onSaveEntry`（点击路径已存在）。加长按会与 `@tap` 抢**同一条**
  手势通道，而 tap 判定的可靠性正是 P2 的对象 ⇒ 同样是叠不确定性
- **单击判定最终形态取决于 P2**：P2 阴性 ⇒ 直接 `@tap`（3 处容器）；P2 阳性 ⇒ 加位移阈值
  （复用 `TagPressChip` / `GlassCard` 已有的 touch 三件套判位移，不新建手势框架）
- **单点触发的单击不吞双击**：`@tap` 在 Lynx 上无 dblclick 概念，两次快速点击 = 切换两次
  （回到原状）——这是可预期行为，不额外处理

### 决策 8：小说详情页**本轮不做**，列为后续

`NovelDetail.vue` 的沉浸诉求与插画**不同**：插画是「全幅看图」，小说是「长文本连续阅读」。

**本轮不做的三条理由**：

1. **收益低**：小说页的 chrome 本来就少（页级手写返回头一处 + 若干元信息行），隐藏它们
   换来的阅读面积增量远小于插画页
2. **有真冲突**：小说页的核心交互是 `selection`（`useTextSelection` / `createTextSelection`），
   其入口是 `@longpress="selection.notifyLongPress"`，且**长按抬手的那次 tap 已被打标消费**
   （该文件注释自述：否则菜单会被自己这次长按的抬手收掉）。点图隐藏 chrome 会在这套仲裁里
   再插一个 tap 消费者，而这套仲裁的细节**本轮不打算重新验证**
3. **有既有硬门禁会误伤**：`packages/app-lynx/src/pages/novelIntro.template.test.ts` 断言页面
   源码 `not.toContain("registerBackGuard")`，而小说页顶栏按其注释刻意保留了手写头
   （「PageTopBar 化需语义改测试，与『既有页面测试零语义修改』硬门禁冲突」）。改小说页 chrome
   会连带触碰这条门禁 ⇒ 范围蔓延

**后续的前置条件**：① 决策 7 的 P2 有结论；② selection 与 tap 的仲裁在真机上被单独取证过；
③ 该门禁的处理方式（扩门禁 or 豁免）先拍板。

### 决策 9：降级与无障碍

**reduced-motion**：按 `useReducedMotion` 的 **R1** 规则——沉浸切换**不挂** `transition-*` 类
（类级条件挂载），**不是**挂 `0ms` 时长（挂 0 时长与不挂同义反复，且该文件注释已把 R1 定为
「不挂类」形态）。复用 `packages/app-lynx/src/composables/useReducedMotion.ts`（全仓唯一偏好事实源，
组件只读 `reducedMotion`，**禁自建 `matchMedia`**），`App.vue` 已于根级消费其 `animationStyle`。

**无障碍**：

- **隐藏的 chrome 从 a11y 树移除是正确的**，不是缺陷：不可见的控件不应被朗读
- **但必须补一条 TalkBack 可用的退出路径**：图片容器按 `chromeHidden` 挂动态
  `accessibility-label`（「进入沉浸模式」/「退出沉浸模式」），否则屏幕阅读器用户**无法退出沉浸**
  （点得到图片，但没人告诉他这是开关）。⚠️ 该动态绑定是否生效见 **P5**（后果等级为**可达性
  阻塞**）；**P5 阴性时改走其指定的回退动作**——常驻一个常量 label 的退出控件。**本条要求的是
  「退出路径存在」，不是「插值必然生效」**。**✅ P5 已取证为阳性（2026-10-01）**：a11y 树实测读到
  `第 1 / 9 张，进入沉浸模式` ⇄ `第 1 / 9 张，退出沉浸模式` 随状态切换，多图分支已带「第 n / N 张」。
  ⚠️ **两条平台事实不因 P5 阳性而消失**：标注 `<view>` 报 `clickable=false`（Lynx delegate 不为
  view 的 tap 置位，`<input>` 则为 true），且 **`accessibility-traits` 会吞掉 `content-desc`（禁止使用）**
  —— 详见「探针实测结论」
- `A11Y_ELEMENT_ENABLED`（`packages/app-lynx/src/utils/accessibility.ts`，常量 `true`）**照旧只
  绑元素、不绑文案**；`PageTopBar` 的 `backA11yLabel` 双分支形态不变
- 角标从「`n / N`」变为隐藏后，**多图的位置信息在沉浸态丢失** ⇒ 图片容器的 `accessibility-label`
  在多图分支应带上 `第 n / N 张`（否则 TalkBack 用户在沉浸态下不知自己在第几张）

## 后果

- **「沉浸」在本应用是纯前端接线**：不改 Java、不改 `tokens.css`、不改 Tailwind 配置。
  改动面 = `IllustDetail.vue` + 一个新增的沉浸所有权单例 + 一个门禁测试
- **详情页观感可见变化**：`PageTopBar` + 操作行 + 角标在沉浸态消失，图片可用高度增加
  **一个 `PageTopBar` 高度 + 两条系统栏带**（`PageTopBar` 变体 b 的高度是 `h-[17.067vw]`）。
  **属可见视觉变化，需进截图回归**
- **滚动位置跳变风险带进验收**（P6）：切换 chrome 改 `scroll-view` 盒高，若不记录/恢复滚动位置，
  用户在图中间点一下会跳回顶部。**验收范围随 P6 结果分流**：阳性 = 必做并进验收；阴性 = 记为
  已知限制（分流见「探针失败的处置」的 P6 单列段）
- **多图位置信息在沉浸态从视觉与 a11y 双通道丢失**（角标隐藏）⇒ 由图片容器的 a11y label 补回
- **`fullscreenMode` 语义保持不变**（「全应用隐藏系统栏」）。若用户已开启，进入沉浸时
  系统栏本来就隐藏，沉浸此时**只做应用内 chrome 显隐**——这是预期共存，不是降级
- **决策 6 的硬规则若不设门禁**，「顺手复用 `setFullscreenMode`」会静默把临时状态写成持久偏好
  ⇒ 用户每次冷启动都被扔进沉浸，且 `Me.vue` 开关显示为「开」而实际已被改回 ⇒ 状态与 UI 不一致

## 风险与回退路径

| # | 风险 | 影响 | 回退路径 |
|---|---|---|---|
| **R1** | **P4 阴性**（沉浸态下系统手势返回不派发 `pictelioBack`） | **页面无任何返回入口 = 死路**（顶栏已隐藏） | 阻塞级：回改决策 3 为「沉浸态保留一个最小返回入口（右上角 `AppIcon` 浮标，`z-40` 同层）」。**不放行、不靠推测** |
| **R2** | P2 阳性（滑动抬手被判为 tap） | 滑动看图时 chrome 反复闪烁 | 决策 7 的位移阈值方案（复用既有 touch 三件套）；或本轮**改为双击进入沉浸**、单击不作切换（代价：发现性下降） |
| **R3** | P3 阳性（`singleTask` 同实例 resume 后系统栏仍隐藏） | 用户离开后回来仍是无栏界面，且不限于本页 | 补 L5：**只能走 `onResume` 兜底复位（Java）**——JS 侧「页面隐藏」钩子在本栈**不存在**（决策 5 已验证），故 JS 侧复位**不是可选项**。**须先解决 L5 钩子前置**（决策 5 已列两条待择路径），**需开 Java 改动**（与「零 Java」前提冲突，故按需回退） |
| **R4** | 实施中发现**必须**改 Java（如原生多指手势、或需要一个 JS 拿不到的系统事件） | 打破「零 Java 改动」前提 | 本 ADR 重开：把 Java 侧改动列为独立决策 + 单测（沿用 `applySystemBarsHidden` / `isFullscreenModeRequested` 的「static 包私有纯逻辑供单测」范式） |
| **R5** | 沉浸态下 `P7` 某一边未真正贴边（如三键导航底栏） | 单边留白，观感不对称 | 记为已知限制；`minSdkVersion = 28` 覆盖导航模式多样，纯前端无法统一，**不做逐模式适配** |
| **R6** | 「沉浸」与 `Me.vue` 的「全屏模式」在用户心智中混淆 | 用户分不清两者差别 | 文案层缓解：`Me.vue` 现有描述（`me.fullscreenMode` / `me.fullscreenModeDesc`）明确其范围是
「全应用」；**不改设置项语义**（决策 6）。⚠️ **文案范围切分（本轮裁定，消除与决策 9 的歧义）**：
**① 新增 = 本轮内、必需**——决策 9 要求的两段沉浸 a11y 标签（「进入沉浸模式」/「退出沉浸模式」，
多图另含「第 n / N 张」）是**决策 9 与 P5 可达性路径的实现最小集**，**必须**随本轮落地，
**两语种同步新增**（i18n 仅 `zh-CN` / `en` 两语，由 `SUPPORTED_LOCALES` 定）；**② 调整既有文案
措辞 = 不纳入本轮**——`me.fullscreenMode` / `me.fullscreenModeDesc` 等既有描述的润色属范围外，另开
范围。（已验证：a11y 标注注册表 `accessibility.ts` 现为**中文单语字面量**、仅作 Appium 定位锚点、
**不走 i18n**，故「两语种」对这两段文案属**新增要求**；新增 key 落在 `ILLUST_DETAIL_A11Y_LABELS`，
实施时须给这两段文案提供双语来源，**不得只加中文**。） |

## 复核判据

1. **零 Java 改动**：本 ADR 落地后 `git diff --name-only` **不含** `packages/android-host/**`。
   出现即说明决策 1 的可行性判断错了（须回退到 R4 流程重开 ADR）
2. **沉浸路径不写持久键**：`IllustDetail.vue` 所在的新增单测断言 —— 沉浸代码路径的源码中
   `not.toContain("setFullscreenMode")` 且 `not.toContain("settings_fullscreen_mode")`。
   沿用 `safeAreaJavaContract.test.ts` 的**源级断言**范式（该文件已用它钉住全屏键的 Java⇄JS 契约）
3. **三处图片层全覆盖**：`IllustDetail.vue` 中带 `@tap` 切换 chrome 的容器数 = **3**
   （ugoira / 多图 / 单图）。数错会让动图与多图分支静默失去沉浸入口
4. **`@tap` 处理器计数 = 实施后目标态 9 裸 + 3 `.stop`（= 12 个处理器）**。
   **⚠️ 该基线是「实施后」的目标态，不是当前态**——写「不回归」会必红：决策 2 一边给**三处图片层
   容器各绑一个裸 `@tap`**（判据 3 钉的就是这 3 个），一边给页角标宿主补**第 3 个 `.stop`**，两条
   都会让计数上涨。
   - **当前态**（复算自 `IllustDetail.vue`）：`@tap` 字面命中 9 行，其中 **1 行是模板注释**（解释
     `@tap.stop` 防冒泡的那行）⇒ 实际处理器 **8 个 = 6 裸 + 2 `.stop`**（`openAuthor` /
     `toggleFollowAuthor` / `onSaveEntry` / `showComments = true` / `navigate('/downloads')` /
     标签 `openSearch`，以及 `toggleWatchLater` / `openTagNeighbors` 两个 `.stop`）
   - **实施后**（= 6 裸 + 3 图片层裸 + 2 `.stop` + 1 角标 `.stop`）：字面命中 **13** 行（含那 1 行
     注释）/ 实际处理器 **12 个 = 9 裸 + 3 `.stop`**
   - 复算：`grep -n '@tap' packages/app-lynx/src/pages/IllustDetail.vue`；**必须先剔除模板注释行
     再计数**。⚠️ **两个计数陷阱**：① 字面命中 ≠ 处理器数（多算那 1 行注释）；②
     `grep -c '@tap\.stop'` 会返回 **3**（注释里也含该字面），正确口径是**剔除注释后的 2**——
     照抄裸 `grep -c` 会把当前态误报成已达标，从而放过角标漏绑
5. **角标阻断冒泡**：多图分支的页角标宿主带 `@tap.stop`（否则点角标会切 chrome）
6. **复位四层保障齐备（本条只覆盖 L1–L3；L4 刻意留空）**：`IllustDetail.vue` 同时含
   ① `onUnmounted` 复位、② `registerBackGuard` 内复位且**返回 `false` 不拦截**、③ 单一所有权单例的
   新 owner 强制接管。缺任一即判红。
   ⚠️ **门禁实现者：不得为第四层（L4 进程外兜底）补任何断言**。L4 是决策 5 **刻意留空**的已知
   缺口（不写 Java `onResume` 兜底，见 P3 / R3），**为「一个刻意不存在的兜底」写门禁 = 假门禁**：
   它会把「按设计留空」判成红，逼着实现去补一个 Goodhart 式的多余机制。措辞统一为「四层保障，
   其中第四层刻意留空」——**计数是四，断言只有三**。
7. **退出回落而非硬编码**：`setSystemBarsHidden` 的第二个实参是 `fullscreenMode`（设置项当前值），
   **不是** 字面 `false`（否则会静默改掉用户的持久设定一次）
8. **失败可回滚**：`setSystemBarsHidden` 的 callback 返回 err 时**同步回滚 `chromeHidden`** +
   模块前缀 `console.warn`。**禁静默失败**（测试硬约束 #3）
9. **reduced-motion 走 R1**：沉浸切换的条件类名在 `reducedMotion` 为真时**不挂** `transition-*`；
   且**不出现**自建 `matchMedia`（`useReducedMotion` 是全仓唯一偏好事实源）
10. **a11y 退出路径存在**：`chromeHidden` 为真时，存在**可被屏幕阅读器到达的退出入口**；
    多图分支的位置信息「第 n / N 张」不丢失（角标在沉浸态已隐藏）。
    **形态随 P5 结果二选一**：P5 阳性 = 图片容器的**动态** `accessibility-label` 承载；
    P5 阴性 = **常驻的常量 label 退出控件**（P5 行指定的回退动作）。**两条都算达标**——
    本条断言的是「路径可达」，**不是**「插值生效」
11. **P1–P7 全部有结论**：每条**必须带阳性对照**记录「探针 / 触发 / 观测 / 判读」；
    **阴性结论必须写明是「引擎不支持」还是「没触发」**（ADR-0207 的首版假阴性教训），
    并据此回改本 ADR 对应决策或如实登记为已知限制

## 参考

- 决策来源：用户诉求「界面不够沉浸」的诊断结论（对图站类应用，详情页全屏看图 + 点图隐藏所有界面元素
  收益最大）；用户已拍板**应用内沉浸与原生系统栏隐藏都做**、不做 Expressive 基线
- 既有系统栏能力链：
  [`ADR-0180`](./ADR-0180-lynx-dark-mode.md)（暗色三态与状态栏外观下发）、issue #592 F3.2（新 Window 默认全显）、
  issue #689（`statusBarHidden` 单向闩锁修复）、issue #692（外观运行时重下发）
- 返回与生命周期：[`ADR-0066`](./ADR-0066-lynx-system-back-bridge.md)（系统返回桥）、
  `packages/app-lynx/src/router.ts` 的 `registerBackGuard` / `evaluateBackRoute`、
  `NovelDetail.vue` 的 `unregisterBackGuard` 范本
- 结构与样式基线：[`ADR-0205`](./ADR-0205-md3-baseline-and-scope.md)、
  [`ADR-0206`](./ADR-0206-typography-type-scale.md)、
  [`ADR-0207`](./ADR-0207-shape-and-state-layer-guardrails.md)（**「引擎能力边界」章的阳性对照纪律**
  与「待验证须标注」的写法范本，本 ADR 的 P1–P7 与「已验证 / 待真机验证」二分沿用之）、
  [`ADR-0209`](./ADR-0209-md3-filled-text-field-alignment.md)
- 降级与无障碍：`packages/app-lynx/src/composables/useReducedMotion.ts`（R1/R2/R3 降级规则）、
  `packages/app-lynx/src/utils/accessibility.ts`（`A11Y_ELEMENT_ENABLED` 与 a11y 注册表）
- 手势与布局既有事实：
  `packages/app-lynx/src/components/PageTopBar.vue`（「返回键 `@tap` 绑 view 层，text 根级 `@tap` 原生无效
  （ADR-0055 家族）」）、`packages/app-lynx/src/components/TagPressChip.vue` 与 `GlassCard.vue`（touch 三件套范本）、
  `packages/app-lynx/src/pages/novelIntro.template.test.ts`（`registerBackGuard` 禁入门禁）
- 探针与真机纪律：[`glossary-emulator-verification.md`](./glossary-emulator-verification.md)、
  [`ADR-0207`](./ADR-0207-shape-and-state-layer-guardrails.md) 的「引擎能力边界（真机实证）」章
- 集成背景（生成文档，**以源码为准绳**）：
  [`openwiki/integrations/android-native.md`](../../openwiki/integrations/android-native.md)、
  [`openwiki/architecture/overview.md`](../../openwiki/architecture/overview.md)
