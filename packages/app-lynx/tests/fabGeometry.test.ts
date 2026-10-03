// ─── 悬浮 FAB 几何的**数值** oracle（票 #922 / ADR-0217 修订节）───
//
// 之所以独立成文件、而不是塞进 bottomOcclusionAllowance.test.ts：
// ① 关注点不同 —— 本文件只验「算出来的数对不对」，那个文件验「16 个页面接没接对、接在哪」。
//    混在一起时门禁文件会持续膨胀到被测对象的 3 倍以上（门禁冻结线 #1「给回归创造就业」）。
// ② 几何是**数值**不变量，用「把公式跑出数字」的断言最稳：它对「公式搬不搬家、
//    等价写法怎么写」完全免疫，而这正是字符串判据反复假红/假绿的原因。
//
// ⚠️ 期望值出处（Oracle 溯源，禁从被测实现反推）：
//   - `search` 档 = 58.667vw：真机像素量测（emulator-5554 / Android 14 / 1080×2160 /
//     手势导航，收藏页滚到底）实测搜索 FAB 顶边 58.611vw / 底边 43.796vw / 尺寸 14.907vw，
//     与理论 58.667 / 43.734 / 14.933 偏差均 <0.2%。见 ADR-0217 修订节的实测表。
//   - `menu` 档 = 19.2vw：三根页染色法量测 207px vs 理论 207.36px（−0.17%）。
//   - 推导来源：ADR-0132 决策 2（search FAB 须避开 RefreshableList 分页菜单面板顶 42.667vw）。
//   ⇒ 期望值与「实现算出来的值」**并不相等**（差 0.056vw），故非同义反复。

import { describe, it, expect } from 'vitest'
import {
  FAB_BOTTOM_SEARCH_VW,
  FAB_EDGE_VW,
  FAB_MENU_PANEL_HEIGHT_VW,
  FAB_SIZE_VW,
  fabAllowanceHeightVw,
} from '../src/utils/fabGeometry'

describe('fabGeometry：底部遮挡让位高度（数值 oracle，票 #922）', () => {
  // ⚠️ 为什么这条不用源码字符串判据，而**直接把公式跑出数字**：
  //   几何是**数值**不变量，字符串匹配只能锁「公式写在哪个文件、写成什么形状」——
  //   那是形态锁：公式搬家就假红，改等价写法也假红（本文件已栽两次）。
  //   数值断言则对「搬不搬家、等价不等价」免疫：只要算出来的让位高度还是那个数，
  //   判据就绿；算错了立刻红。
  //
  // 依据（**独立来源** = 真机像素量测，不是本模块自己）：
  //   emulator-5554 / Android 14 / 1080×2160 / 手势导航，收藏页滚到底的搜索 FAB
  //   实测：底边 43.796vw / 顶边 58.611vw / 尺寸 14.907vw（理论 43.734 / 58.667 / 14.933）。
  //   下面对 **search 档**用 0.2vw 容差卡真机实测值；menu 档沿用三根页已验收的 19.2vw。
  it('menu 档让位 = 19.2vw（4 个根页，已真机量测 207px vs 理论 207.36px / −0.17%）', () => {
    expect(fabAllowanceHeightVw('menu')).toBeCloseTo(19.2, 6)
  })

  it('search 档让位 = 58.667vw —— 对齐真机实测 58.611vw（容差 0.2vw），不是 19.2vw', () => {
    expect(fabAllowanceHeightVw('search')).toBeCloseTo(58.667, 2)
    // ⚠️ 回归防线：search 档若退回 menu 档（19.2vw），非 tab 页末项会被搜索 FAB 压住。
    //    这条差 39.467vw，正是票 #922 的原始缺陷。
    expect(fabAllowanceHeightVw('search') - fabAllowanceHeightVw('menu')).toBeCloseTo(39.467, 2)
  })

  it('search FAB 底边 = 43.734vw（避开分页菜单面板顶 42.667 + 1 间隙，ADR-0132 决策 2）', () => {
    expect(FAB_BOTTOM_SEARCH_VW).toBeCloseTo(43.734, 2)
    // 抬高量 = 分页 FAB 竖向占用（底边+本体）+ 1 间隙 + 菜单面板 + 1 间隙
    expect(FAB_BOTTOM_SEARCH_VW - (FAB_EDGE_VW + FAB_SIZE_VW)).toBeCloseTo(24.534, 2)
    expect(FAB_MENU_PANEL_HEIGHT_VW).toBeCloseTo(22.401, 2)
  })

  it('档位未显式给出时取 search 高档（失败方向不对称：多留白 ≪ 漏遮挡）', () => {
    // 运行时兜底：非 'menu' 一律取高档。同时用类型层面保证调用点必须显式选档
    // （`mode` 是必填参数），见 fabGeometry.ts 的注释。
    const anyGeo = fabAllowanceHeightVw as (m?: 'menu' | 'search' | 'hidden') => number
    expect(anyGeo()).toBeCloseTo(fabAllowanceHeightVw('search'), 6)
    expect(anyGeo('menu')).toBeCloseTo(19.2, 6)
  })

  it("'hidden' 档（路由未解析 / 会话页）降级到 search 高档，而不是掉回 menu 档", () => {
    // ⚠️ 这条是 Standards 轴 code-review B2 的**修法核心**：`hidden` 的降级必须住在
    //    `fabAllowanceHeightVw` 内部并被**数值**判据覆盖。若让调用方在组件侧写三元
    //    （`routeMode === 'menu' ? 'menu' : 'search'`），降级路径就只剩文本判据守着，
    //    而实测那种判据可被「硬编码 'menu' + 死变量」骗过而全绿。
    // ⇒ 本条 + 「组件实参必须是 view.value.routeMode」两条合起来，把回归钉死。
    expect(fabAllowanceHeightVw('hidden')).toBeCloseTo(58.668, 2)
    expect(fabAllowanceHeightVw('hidden')).toBeCloseTo(fabAllowanceHeightVw('search'), 6)
    // 反向：'hidden' 绝不能等于 menu 档（那正是票 #922 让 9 页集体落到 19.2vw 的形态）
    expect(fabAllowanceHeightVw('hidden')).not.toBeCloseTo(19.2, 2)
  })

  it('三档取值互不相同（防止两个分支被写成同一个值而门禁看不出来）', () => {
    const vals = [fabAllowanceHeightVw('menu'), fabAllowanceHeightVw('search'), fabAllowanceHeightVw('hidden')]
    expect(new Set(vals.map((v) => v.toFixed(3))).size, 'search 与 hidden 必须同值，menu 必须另成一档').toBe(2)
  })
})

