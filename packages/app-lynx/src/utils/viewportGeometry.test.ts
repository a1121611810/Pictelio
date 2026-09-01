import { describe, it, expect } from 'vitest'
import { screenHeightVw } from './viewportGeometry'

// oracle = ADR-0131（2026-09-01，内容区尺寸契约）的像素取证源数据 + 决策 2 的三路径优先级：
// 内容区尺寸 > SystemInfo > web-core 兜底 216.4vw。期望值独立推算（非从实现反推）：
// - 164.44 = (1184/720)×100：ADR-0131 实测内容区 720×1184（全屏 720×1280 扣除 96px 系统导航条 inset）；
// - 177.78 = ((1280/2)/(720/2))×100 = (640/360)×100：SystemInfo 全屏换算逻辑 360×640（ADR 同源）；
// - 216.41 = (844/390)×100：SystemInfo 缺 pixelHeight 时按逻辑宽 ×844/390 回退——390×844 设计基准，
//   与兜底 216.4 同源（216.4 即 216.41 的取整，正是「按 390×844 估」的契约值）；
//   该分支为「迁移契约」：公式与被替换的 GlobalFab.vue 内联逻辑逐行等价（f3ee0cb 基线），
//   另以「缺高分支 ≡ 显式补高分支」的恒等断言防公式写错（各自实现，两边同步才绿）；
// - 216.4：web-core 兜底常量（ADR-0131 决策 2，无 SystemInfo 环境按 390×844 估）。
// 纯函数、无 Vue/无原生模块；契约 IO 边界（getViewportSize 调用沿与哨兵回退）归
// utils/viewportSizeBridge.test.ts（AGENTS.md 测试硬约束 #1）——本文件只锁纯逻辑。

describe('screenHeightVw（逻辑屏高 vw 推导，ADR-0131 决策 2/3）', () => {
  it('内容区命中：720×1184 → 164.44vw，且优先于 SystemInfo（双参数同给，内容区胜出）', () => {
    const sys = { pixelWidth: 720, pixelHeight: 1280, pixelRatio: 2 }
    // (1184/720)×100 = 164.444…（ADR-0131 像素取证值 164.44，二者同给时系统区 177.78 不生效）
    expect(screenHeightVw({ w: 720, h: 1184 }, sys)).toBeCloseTo(164.44, 2)
    // systemInfo 缺失（web-core 无 SystemInfo 时内容区同样生效）
    expect(screenHeightVw({ w: 720, h: 1184 }, undefined)).toBeCloseTo(164.44, 2)
  })

  it('SystemInfo 三值推导：720×1280 pr2 → 逻辑 360×640 → 177.78vw', () => {
    // (640/360)×100 = 177.777…（ADR-0131：SystemInfo 给 vw=177.78，比内容区高 96px/48dp）
    expect(screenHeightVw(null, { pixelWidth: 720, pixelHeight: 1280, pixelRatio: 2 })).toBeCloseTo(
      177.78,
      2,
    )
  })

  it('SystemInfo 缺 pixelHeight → 按逻辑宽 ×844/390 回退：780 物理宽 pr2（逻辑 390）→ 216.41vw', () => {
    // w = 780/2 = 390；h = (390×844)/390 = 844；(844/390)×100 = 216.410…（390×844 设计基准）
    expect(screenHeightVw(null, { pixelWidth: 780, pixelRatio: 2 })).toBeCloseTo(216.41, 2)
  })

  it('性质恒等：缺 pixelHeight 的补高结果 ≡ 显式传入该补高像素值的显式高结果（防补偿公式写错）', () => {
    // 任意输入下,「缺高分支」与「显式高分支」走不同代码路径,但必须给出同一结果;
    // 若实现把 844/390 写成错误比例,两分支不再恒等 → 红（性质 oracle,不依赖公式本身正确）。
    // 注:ratio 用 2（2 的幂,二进制浮点缩放精确,toBe 精确相等成立）；改非 2 幂比例需换近似断言。
    for (const pw of [390, 720, 780]) {
      const ratio = 2
      const w = pw / ratio
      const hLog = (w * 844) / 390
      const missing = screenHeightVw(null, { pixelWidth: pw, pixelRatio: ratio })
      const explicit = screenHeightVw(null, { pixelWidth: pw, pixelHeight: hLog * ratio, pixelRatio: ratio })
      expect(missing).toBe(explicit)
    }
  })

  it('两参数皆缺（web-core 兜底）→ 216.4vw', () => {
    // 契约常量：无 SystemInfo 环境按 390×844 估（216.4 为 216.41 取整，同上一条同源）
    expect(screenHeightVw(null, undefined)).toBe(216.4)
  })

  it('contentSize 为 null → 回退 SystemInfo → 177.78vw', () => {
    expect(screenHeightVw(null, { pixelWidth: 720, pixelHeight: 1280, pixelRatio: 2 })).toBeCloseTo(
      177.78,
      2,
    )
  })

  it('内容区契约哨兵 -1×-1（原生未布局/异常回传值）→ 视为无内容区，回退 SystemInfo', () => {
    expect(screenHeightVw({ w: -1, h: -1 }, { pixelWidth: 720, pixelHeight: 1280, pixelRatio: 2 })).toBeCloseTo(
      177.78,
      2,
    )
  })

  it('内容区非法（0 / NaN）→ 视为无内容区，回退 SystemInfo（防御，不进入除法）', () => {
    const sys = { pixelWidth: 720, pixelHeight: 1280, pixelRatio: 2 }
    expect(screenHeightVw({ w: 0, h: 1184 }, sys)).toBeCloseTo(177.78, 2)
    expect(screenHeightVw({ w: 720, h: 0 }, sys)).toBeCloseTo(177.78, 2)
    expect(screenHeightVw({ w: Number.NaN, h: 1184 }, sys)).toBeCloseTo(177.78, 2)
  })
})
