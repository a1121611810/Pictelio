// ─── 悬浮 FAB 几何的**单一事实源**（ADR-0217 / 术语文档 glossary-bottom-occlusion-allowance.md）───
//
// ## 为什么要这个模块
//
// `GlobalFab.vue` 的几何一直是**组件内局部常量**（`FAB_SIZE_VW` / `FAB_RIGHT_VW`），
// 而「底部遮挡让位」需要**同一个数**（FAB 从内容区底边往上占多高）。
// 此前两边各自硬编码 `19.2vw`，并在 4 处文档里声称「19.2vw 只写一次、FAB 改尺寸时占位自动跟随」
// —— **那句话是假的**（code-review Spec 轴 B1 实测：`GlobalFab.vue` 从不读 Tailwind 档位，
// 把 `spacing.18` 改成 30vw 时门禁仍全绿）。两个独立来源 + 一个看起来在防漂移的空门禁
// = 门禁冻结线 #5 点名的「假绿比没门禁更糟」。
//
// ⇒ 本模块把 FAB 几何**提取为共享常量**，`GlobalFab` 与 `FabAllowanceSpacer` 都从这里取。
//   此后改 FAB 尺寸，占位**真的**跟着变（那句话说这次才成立）。
//
// ## 数值口径（375dp 基准，见 glossary-lynx-units.md）
//
// - `FAB_SIZE_VW` = 14.933vw = 56dp —— FAB 本体直径
// - `FAB_EDGE_VW` = 4.267vw = 16dp —— 离屏幕边的距离。
//   ⚠️ `GlobalFab` 里这个常量名叫 `FAB_RIGHT_VW`，但它**同时**用作底距（`fabCy` 里的减项）。
//   改名会牵动多处调用点，故此处保留原名并在此登记「一名两用」这一事实。
// - 遮挡让位高度 = 边距 + 本体 = 19.2vw = 72dp。
//   ⚠️ 竖向净空来自**底距**，与「右距」无关；两者今天相等纯属同一个常量兼作两用的巧合。
//   改 FAB 时若把左右/上下拆成两个常量，占位高度只跟**下边距**走（见下方 `fabAllowanceHeightVw`）。
// - 遮挡带的**水平**左右缘（`FAB_BAND_LEFT_VW` / `FAB_BAND_RIGHT_VW`）：由上面两个常量导出，
//   与竖直轴**正交**的第二个轴，见文末小节与 glossary-app-lynx-hit-testing.md。

/** FAB 本体直径（vw；56dp @375dp 基准）。来源：GlobalFab 的 inline style `:style` 宽度。 */
export const FAB_SIZE_VW = 14.933

/** FAB 离屏幕边的距离（vw；16dp）。`GlobalFab` 中名为 `FAB_RIGHT_VW`，实为「右距兼底距」。 */
export const FAB_EDGE_VW = 4.267

// ─── search 模式的抬高几何（ADR-0132 决策 2）───
//
// 非 tab 内容页上，右下角**竖排两个** FAB：`RefreshableList` 的分页 FAB 在下（底边 4.267vw），
// `GlobalFab` 的 search 按钮在上。分页 FAB 展开的菜单自浮层槽位向上展开，菜单面板高
// `2 × 10.667 + 1.067 = 22.401vw`，面板顶落在 **42.667vw**。search FAB 若也停在低槽位，
// 展开的「刷新」项会被它盖住并吞点击（GlobalFab z-40 > 菜单 z-20）⇒ search FAB 底边
// 抬到「面板顶 + 1 间隙」= **43.734vw**。
//
// ⚠️ 整段推导**原在 GlobalFab.vue 组件内**（组件局部常量）。2026-10-03 迁入本模块
//（票 #922）：让位高度要按模式分档，就必须同时知道两档几何；留在组件里等于
// 占位侧只能看到 19.2vw 那一档，而真机遮挡源是 58.667vw 那一档 ——
// 「两边各自硬编码 + 一个看起来在防漂移的空门禁」= 本模块开篇点名要消灭的形态。

/** Tailwind `spacing` 1 档（vw；375dp 基准 4px/3.75dp）。与 `RefreshableList` 的 `bottom-4` 同口径。 */
export const SPACING_UNIT_VW = 1.067

/** 分页 FAB 菜单单个 pill 的高（vw）。 */
export const FAB_MENU_PILL_VW = 10.667

/**
 * 分页菜单的项数。当前非 tab 列表页均无 `:items` ⇒ 菜单**恒为 2 项**（刷新 / 回顶）。
 * ⚠️ 若将来某页传入 `extras` 使菜单增项，必须同步本常量（否则 search FAB 会被新项盖住）。
 */
export const FAB_MENU_ITEM_COUNT = 2

/** 分页菜单面板总高（vw）。 */
export const FAB_MENU_PANEL_HEIGHT_VW = FAB_MENU_PILL_VW * FAB_MENU_ITEM_COUNT + SPACING_UNIT_VW

/** `GlobalFab` 在 **search 模式**下的底边（距内容区底边，vw）= 43.734vw。 */
export const FAB_BOTTOM_SEARCH_VW =
  FAB_EDGE_VW + FAB_SIZE_VW + SPACING_UNIT_VW + FAB_MENU_PANEL_HEIGHT_VW + SPACING_UNIT_VW

/**
 * 底部遮挡让位高度（vw）：FAB 从**内容区底边**往上占的净空。
 *
 * 为什么是「底边 + 本体」：FAB 的定位是 `bottom: <底边>`，故其**顶边**距内容区底边
 * 「底边 + 本体」vw。末项滚到底时需要正好让开这段。
 *
 * ⚠️ 这不是「右距 + 本体」——右距是水平方向的，与竖向净空无关。
 * 两者今天数值相同（都用 `FAB_EDGE_VW`），改 FAB 横向位置不该改这个值。
 *
 * ## 两档（票 #922）
 *
 * | 模式 | 页面 | 底边 | **让位高度** |
 * |---|---|---|---|
 * | `menu` | 4 个顶层 tab 页 | 4.267vw | **19.2vw** |
 * | `search` | **其余全部非 tab 内容页** | 43.734vw | **58.668vw** |
 *
 * ⚠️ 2026-10-03 真机取证（emulator-5554 / 1080×2160）：收藏页滚到底，search FAB 实测
 * 底边 **43.796vw** / 顶边 **58.611vw**（与理论偏差 <0.15%），**压在末张卡片上**。
 * 此前所有非 tab 页都按 19.2vw 让位，**差 39.467vw** ⇒ 点末项右侧开的是搜索弹层。
 *
 * ## 失败方向不对称 ⇒ 非 `menu` 一律取高档
 * 「档位算小了」会**遮挡内容**（末项点不到）；「档位算大了」只多一段**看不见的空白**
 * （占位是零内容透明块）。故除明确的 `menu` 外一律取 search 档——**包括 `hidden`**
 * （路由名尚未解析、或 login/update/error 这类无 FAB 的会话页）：宁可多留白，不可漏遮挡。
 *
 * ⚠️ `mode` **没有默认值，是必填**：给了默认值就等于替调用方做了选择，而「选错」在这套
 * 几何里是不对称的（见上）。必填把它变成编译期错误——新增调用点时必须先想清楚
 * 「这条路由的 FAB 是哪一档」，这正是票 #922 里 9 个页面集体选错的成因。
 *
 * ⚠️ 形参收 `RouteFabMode`（**含 `hidden`**）而不是 `'menu' | 'search'`：
 * `hidden` 的降级必须住在**本函数内**并被数值判据覆盖。若让调用方
 * （`FabAllowanceSpacer.vue`）自己写 `routeMode === 'menu' ? 'menu' : 'search'` 三元，
 * 那条降级路径就只剩「文件里出现过 routeMode 这个词」这种文本判据守着 ——
 * 实测可构造变异体（硬编码 `'menu'` + 留一个读 routeMode 的死变量）让全部断言转绿，
 * 而 39.467vw 缺陷完整回归（Standards 轴 code-review B2）。
 */
export function fabAllowanceHeightVw(mode: 'menu' | 'search' | 'hidden'): number {
  return mode === 'menu' ? FAB_EDGE_VW + FAB_SIZE_VW : FAB_BOTTOM_SEARCH_VW + FAB_SIZE_VW
}

// ─── 遮挡带几何（水平轴；ADR-0221 / glossary-app-lynx-hit-testing.md §遮挡带）───
//
// ## 这是什么
//
// GlobalFab 在屏幕上的**水平投影带** `[FAB_BAND_LEFT_VW, FAB_BAND_RIGHT_VW]`。
// 落在带内的命中面**会被 FAB 整个吃掉**：原生 hit-test 取最顶层元素，FAB 恒在其上，
// 而原生 LynxView 不识别 `pointer-events`（ADR-0123）⇒ 没有穿透手段可绕。
// 票 #932 的原始形态就是它：`/continue` 行尾「移除」药丸 97% 宽度落在带内，
// 点它开的是搜索弹层而不是删除。
//
// ## 为什么由本模块导出，而不是让门禁各写各的字面量
//
// 两个边界**都从 `FAB_EDGE_VW` / `FAB_SIZE_VW` 导出，本模块不引入第三个字面量**
// ⇒ 改 FAB 尺寸或右距，带**自动跟随**。这正是开篇那次「假声明」的修法：门禁若把
// `80.8` / `95.73` 抄进判据，FAB 一改尺寸门禁就静默放过（ADR-0221 §7 新增门禁的
// 前提是「判据从几何常量推导，不得写字面量」，spec §缝 1 同）。
//
// ⚠️ 本模块的几何**不挂在任何 Tailwind 档位上**（不要为了「跟档位走」把它挪进
// `tailwind.config.ts` 的 `spacing`/`borderRadius`）：那些是**编译期常量**，
// 读不到本模块的运行期值，两边又要变成两个事实源 —— 就是开篇点名要消灭的形态。
//
// ## 与 `GlobalFab` 的关系：同一条恒等式，不是第二事实源
//
// `GlobalFab.vue` 以 `fabCx = 100 - FAB_EDGE_VW - FAB_SIZE_VW/2` + `translate(-50%,-50%)`
// 定位，import 的正是上面两个常量 ⇒ 带的左右缘就是该恒等式在 `∓ FAB_SIZE_VW/2` 处的取值。
// 两边共用同一对输入 ⇒ **改 FAB 几何时不需要同步改本模块**（这才是单一事实源的实质，
// 而不是「两边各有一份、靠人记得同步」）。
//
// ## 两条易漏的性质（ADR-0221 §1.2 / §2）
//
// 1. **与路由档位无关**：两个边界是**常量、不接收 mode 形参** —— TS 层就不存在
//    「按档取不同带」的写法。`routeMode` 只改 FAB 的 `top`（底边 4.267vw / 43.734vw），
//    水平带两档**逐位相同**。⇒「只有 search 档页会撞上」是错觉：menu 档页同样横向暴露，
//    只是 FAB 竖直位置低、19.2vw 让位恰好护住末项。
// 2. **带宽 = FAB 本体，不是「本体 + 右距」**：右距是 FAB 与屏边之间的**空隙**，
//    不在 FAB 的投影里。真机实测带宽 161px = 14.907vw ≈ 本体 14.933vw；
//    若把右距也算进去会得到 19.2vw，多算 4.267vw，会让「行首动作已让开」判据**假绿**。
//
// ⚠️ 数值出处（测试的 oracle 溯源同源）：真机像素实测（票 #932 / ADR-0221 §1，
//    emulator-5554 / 1080×2160）带 = `x[872,1033]` = 80.741vw..95.648vw；理论
//    80.8 / 95.733vw（ADR-0221 §2 记作 `[80.80, 95.73]vw`），偏差均 < 1px
//    （1px = 100/1080 = 0.0926vw）⇒ 是像素粒度，不是几何分歧。
//    数值判据见 `tests/fabGeometry.test.ts`。

/**
 * 遮挡带左缘（vw）：FAB 投影的最左 x = `100 - 右距 - 本体`。
 * 行内动作的**行首 vs 行尾**抉择就以此为界（ADR-0221 决策：行内动作一律置行首）。
 */
export const FAB_BAND_LEFT_VW = 100 - FAB_EDGE_VW - FAB_SIZE_VW

/** 遮挡带右缘（vw）：FAB 投影的最右 x = `100 - 右距`。它到 100vw 之间的空隙是右距，不属于带。 */
export const FAB_BAND_RIGHT_VW = 100 - FAB_EDGE_VW
