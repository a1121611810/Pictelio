# 底部让位族术语表（安全区 vs 遮挡让位）

> 范围：`packages/app-lynx`（vue-lynx + Lynx 4.0.1 + Tailwind 3.4，Android 构建）中**屏幕底部**的两族让位概念：**平台安全区**与**自绘控件遮挡让位**。
> **本表是术语文档：只登记「这个概念在我们这儿叫什么、落在哪、什么含义」，不含修复方案。** 方案见 [ADR-0217](./ADR-0217-bottom-occlusion-allowance-scoped-to-scroll-content.md)。
> 交叉引用（不重复定义）：顶部让位族见 [./glossary-top-inset-and-verification.md](./glossary-top-inset-and-verification.md)；单位与换算见 [./glossary-lynx-units.md](./glossary-lynx-units.md)（**权威**）；MD3 角色与形状档位见 [./glossary-md3-alignment.md](./glossary-md3-alignment.md)。
> 证据坐标一律用**稳定锚点**（符号名 / 类名 / 文件 / 组件），不写行号。

---

## 〇、为什么底部需要两张表（这是本表存在的理由）

屏幕底部有**两种性质完全不同的东西**，此前被混为一谈，导致「底部留白该多少」变成一个说不清的问题：

| | 平台安全区 | 自绘控件遮挡让位 |
|---|---|---|
| 是什么 | 系统导航栏 / 手势条**占掉**的区域 | **我们自己画的**悬浮控件盖住的区域 |
| 平台知道吗 | **知道**（有 `WindowInsets` 真值） | **不知道**（自绘层不在平台视野里） |
| 换设备会变吗 | **会**（手势条 / 三键导航高度不同） | 不会（值来自我们自己的控件尺寸） |
| 谁该让位 | 根容器一次性消费 | **滚动内容末尾**自持 |

关键分界（**要点转述，非 iOS HIG 逐字原话**：系统默认已处理安全区，**只有自己加的遮挡物**才需要额外 inset；
所链是 SwiftUI [`safeAreaInset`](https://developer.apple.com/documentation/swiftui/view/safeareainset(_:edges:content:)) **API 参考页**，
正文极短、**不是 HIG 原文** ⇒ 不得当作「HIG 原话」引用；口径见
[ADR-0217 §1.3 B 条](./ADR-0217-bottom-occlusion-allowance-scoped-to-scroll-content.md) 与其 §5）：

> **平台知道的，由平台 inset 解决；平台不知道的，必须我们自己在内容里让。**

---

## 一、底部让位族

| 术语 | 含义 | 本项目落点 | 证据 |
|---|---|---|---|
| **Bottom safe area inset（底部平台安全区）** | 屏幕底边到系统导航栏 / 手势条上沿的距离。平台真值来自原生 insets，**随设备与导航模式变化**。**本项目只让位一次**（根容器消费），底部弹层各自另有一份（作用对象不同、不重叠，见「单一消费」条） | `utils/safeArea.ts` 的 `safeBottom`（物理→逻辑换算的唯一入口）；根容器 `App.vue` 的 `rootStyle`；6 个底部弹层各自消费（`BottomSheet` / `CommentOverlay` / `BookmarkPanel` / `NovelExportSheet` / `NovelCaptionSheet` / `PagePickerSheet`） | `safeArea.ts`；`App.vue`；ADR-0216 §2.2 |
| **Bottom occlusion allowance（底部遮挡让位）** | 为**应用自绘悬浮控件**（GlobalFab）预留的、让**滚动内容能滚到其上方**的末尾空间。**归属 = 滚动容器末尾**；**值 = 悬浮控件自身几何，按其所在路由分两档**（`utils/fabGeometry.ts` 的 `fabAllowanceHeightVw(mode)`）：
  `menu` 档（4 个顶层 tab 页）= 19.2vw（FAB 底距 4.267vw + 本体 14.933vw）；
  `search` 档（**其余全部非 tab 内容页**）= 58.668vw（FAB 底边 43.734vw + 本体）。
  ⚠️ 两档差 39.467vw——`search` 档的 FAB 为避开 `RefreshableList` 分页菜单面板顶 42.667vw 而抬升（ADR-0132 决策 2）。
  ⚠️ **应**存在于每个有自绘悬浮控件的页面；**当前覆盖 17 个页面**（三根页 + 9 个列表页 + 4 个补接线页 + `DownloadManager`），票 #921 / #922 均已于 2026-10-03 落地 | 17 个页面的滚动容器末尾零内容占位（三根页 + 9 个列表页 + 4 个补接线页 + DownloadManager）；几何单一来源 `utils/fabGeometry.ts` 的两档函数（**不是** Tailwind 档位，见 §三·3） | ADR-0217；`FabAllowanceSpacer` |
| **自绘悬浮层（app-drawn overlay）** | 平台 inset 管线**看不见**的浮层：GlobalFab 是零尺寸 `absolute` 锚点盒 + 绝对定位子元素，**不参与流** ⇒ 滚动容器不会为它自动让位 | `GlobalFab.vue`（外层 `absolute z-40`，内含 scrim / 环层 / 菜单） | `GlobalFab.vue`；ADR-0120 |
| **单一消费（single consumption）** | 同一份 inset **只被消费一次**。父子都加 = double inset = 官方点名的经典 bug（「huge gap」） | 系统栏 inset = 根容器消费一次；遮挡让位 = 滚动内容末尾消费。**两者正交、互不叠加** | `App.vue` 的 `rootStyle`；ADR-0217 §后果 |
| **零内容占位（zero-content spacer）** | 一个**不渲染任何可见内容**、只为撑高度的节点。**底部遮挡让位一律用它，不用父容器 padding** —— 理由同顶部让位（Lynx border-box UA 默认 vs web-core 预览不复刻 ⇒ 两套渲染器分叉） | `FabAllowanceSpacer`（`<view>` 内零子节点）；顶部同族见 `useTopInsetSpacer` | `utils/topInset.ts` 约束 2；`FabAllowanceSpacer` |

---

## 二、三者的对照（最容易被问住的一格）

| 维度 | Bottom safe area inset | Bottom occlusion allowance | Top inset（顶部让位，交叉引用） |
|---|---|---|---|
| 挡的是谁 | **平台**的系统栏 | **我们自己的**悬浮控件 | 平台状态栏 |
| 平台知道吗 | ✅ 有真值 | ❌ 需自行申报 | ✅ 有真值 |
| 归属模型 | **全站统一**（根容器一处） | **逐滚动容器**自持 | **逐路由声明**（`meta.topInset` 封闭两值） |
| 有模式选择吗 | ❌ 纯几何 | ❌ 纯几何 | ✅ `'self' \| 'bleed'`（产品可选出血） |
| 值随设备变 | ✅ 手势条 / 三键不同 | ❌ 只随我们自己的控件尺寸 | ✅ 刘海 / 挖孔不同 |
| 落在哪 | 根容器 `paddingBottom` | 滚动内容**末尾** | 页面顶部零内容 spacer |

**⚠️ 不要给底部遮挡让位仿造一个「归属模式」**（如 `bottomInsetMode: 'self' | 'bleed'`）：

顶部之所以有模式，是因为「出血 / 不出血」是**产品选择**（首页封面要不要铺到状态栏下）。
底部遮挡让位**没有产品选择**——只要页面上有 FAB，末项就必须能滚到它上方，否则末项点不到。
凭空造出第三种「不让位」模式 = 重蹈 `utils/topInset.ts` 记录的「静默破版脚枪」。

---

## 三、术语使用纪律

1. **说「安全区」时只指平台 inset。** 讨论 FAB 遮挡时用「底部遮挡让位」，不要混称「安全区」——
   两者的真值来源、变更条件、归属模型全都不同。
2. **不要用「底部留白」描述任一者。** 「留白」是视觉结果，不是机制；两个概念的视觉结果可能相同（都是一段空隙），
   但换设备时行为不同：`safeBottom` 会变，遮挡让位不变。
3. **值不写死、且按路由分档。** 高度来自 `utils/fabGeometry.ts` 的 `fabAllowanceHeightVw(mode)`，
   `mode` 由 `globalFab.view.routeMode`（**路由派生**档位，不含弹层互斥）自动推导，**页面不传任何高度**——
   让页面自己声明档位，新页面漏写就会静默落到 19.2vw，正是票 #922 里 9 页集体选错的形态。
   ⚠️ 必须读 `routeMode` 而非 `view.mode`：后者随弹层开关变化，跟它走会让让位高度跳变、内容整体重排。
   ⚠️ `mode` 形参**必填无默认**：给了默认就等于替调用方做选择，而「算小了遮挡 / 算大了只多留白」是不对称的。
   而 `GlobalFab` 与 `FabAllowanceSpacer` **同 import 这个模块** —— 这是「改 FAB 尺寸时占位**真的**自动跟随」的
   唯一机制。
   ⚠️ Tailwind `spacing` 档位**不是**该高度的来源：档位是**编译期常量**、FAB 几何是 **JS 常量**，
   不同源。code-review 实测把 `spacing.18` 改成 30vw，占位高度纹丝不动 ⇒ 「同档位即跟随」是**已证伪的旧归因**。
   ✅ 与让位高度同值的 `spacing.18`（连同 `14` / `16`）**已删除**（实测三者 class 消费者均为 0），
   并由门禁断言「spacing 里不得再出现与让位高度同值的档位」防其回流。
   ⚠️ 判据只禁**同值**档位，不是禁所有档位 —— 将来加一个与让位无关的 18 档不该被误伤。
4. **占位必须在滚动内容之内，不能在滚动容器之外。** 容器外 = 内容滚不过去 = 白加
   （这正是被删除的全局 `pb-18` 的形态，ADR-0216 §2.2 记其代价）。
