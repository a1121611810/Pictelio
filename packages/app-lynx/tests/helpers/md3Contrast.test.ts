// ─── WCAG 对比度工具自身的单测（issue #862 票面验收 ② 的前置防线）───
//
// 为什么单独测算法：对比度断言一旦转红，必须能区分「**色板改坏了**」与「**公式算错了**」。
// 若公式本身没有独立的教科书用例，一次公式笔误（例如把 0.2126 写成 0.2126R、漏掉 +0.05）
// 会让 14 个色板 × N 组断言一起变红，看起来像大规模回归，实际是一行 bug —— 而对着
// 「色板当前值」校准过头的公式，会反过来把真实的可读性回归判成合规。
//
// Oracle 纪律：期望值取**公开教科书用例**（W3C / 各类无障碍资料的通用引用值），
// 不用本仓 tokens.css 里的任何颜色当期望（那是自洽反推）。
import { describe, expect, it } from 'vitest'

import { contrastRatio, parseCssColor, relativeLuminance } from './md3Contrast'

/** 取两位小数后比较：教科书值都是两位，浮点尾数不该让断言变脆 */
const r2 = (n: number): number => Math.round(n * 100) / 100

describe('parseCssColor · 形态解析', () => {
  it('#rrggbb 逐通道解析（大小写不敏感）', () => {
    expect(parseCssColor('#1a6fa8')).toEqual({ r: 26, g: 111, b: 168, alpha: 1 })
    expect(parseCssColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
  })

  it('#rgb 按 CSS 规范展开为每字符重复（#abc ≡ #aabbcc）', () => {
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, alpha: 1 })
    expect(parseCssColor('#ABC')).toEqual({ r: 170, g: 187, b: 204, alpha: 1 })
  })

  it('rgb() / rgba() 两种分隔与百分比通道都能解析，缺省 alpha 记为 1', () => {
    expect(parseCssColor('rgb(26, 111, 168)')).toEqual({ r: 26, g: 111, b: 168, alpha: 1 })
    expect(parseCssColor('rgb(26 111 168)')).toEqual({ r: 26, g: 111, b: 168, alpha: 1 })
    expect(parseCssColor('rgba(26, 111, 168, 0.12)')).toEqual({ r: 26, g: 111, b: 168, alpha: 0.12 })
    expect(parseCssColor('rgb(26 111 168 / 12%)')).toEqual({ r: 26, g: 111, b: 168, alpha: 0.12 })
    expect(parseCssColor('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 127.5, alpha: 1 })
  })

  it('解析不了的形态一律抛错，不返回默认色（静默降级 = 假绿）', () => {
    // var() 引用、渐变、具名色、空串、越界通道 —— 令牌表里出现它们就是缺陷，必须看得见
    for (const bad of [
      'var(--md-surface)',
      'linear-gradient(to top, rgba(0,0,0,.82), rgba(0,0,0,0))',
      'transparent',
      '',
      '#12345',
      'rgb(300, 0, 0)',
      'rgba(0, 0, 0, 1.5)',
    ]) {
      expect(() => parseCssColor(bad), `${bad} 应抛错`).toThrow(/md3Contrast/)
    }
  })
})

describe('relativeLuminance · WCAG 2.1 公式', () => {
  it('两端锚点：白 = 1、黑 = 0', () => {
    expect(relativeLuminance('#ffffff')).toBe(1)
    expect(relativeLuminance('#000000')).toBe(0)
  })

  it('三原色 = WCAG 亮度系数本身（R 0.2126 / G 0.7152 / B 0.0722）', () => {
    // 这三条同时钉住「系数有没有写错」与「线性化有没有被跳过」：
    // 若实现漏了 ((c+0.055)/1.055)^2.4，纯色通道会算成 1 而非系数值
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 6)
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 6)
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 6)
  })

  it('中灰 #808080 的公认亮度值 0.2159（线性化后 ≠ 0.5019）', () => {
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4)
  })

  it('走 c ≤ 0.03928 的线性分支（#0a0a0a = 10/255），且与幂分支结果不同', () => {
    // 该分支没有公开教科书值，改用「公式逐项展开」核对分支确实被走到；
    // 再断言它 ≠ 幂分支的算术结果，使「阈值写成 0.04045 / 0.03928 抄错」无法蒙混过关
    const c = 10 / 255
    expect(c).toBeLessThanOrEqual(0.03928)
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(c / 12.92, 9)
    const viaPower = ((c + 0.055) / 1.055) ** 2.4
    expect(relativeLuminance('#0a0a0a')).not.toBeCloseTo(viaPower, 6)
  })
})

describe('contrastRatio · WCAG 2.1 比值', () => {
  it('黑底白字 = 21:1（WCAG 教科书极值）', () => {
    expect(r2(contrastRatio('#ffffff', '#000000'))).toBe(21)
  })

  it('同色 = 1:1（比值下界）', () => {
    expect(r2(contrastRatio('#767676', '#767676'))).toBe(1)
  })

  it('#767676 on #fff ≈ 4.54:1（白底上刚过 4.5:1 的经典灰）', () => {
    expect(r2(contrastRatio('#767676', '#ffffff'))).toBe(4.54)
  })

  it('#595959 on #fff = 7:1（白底上 AAA 档的经典灰）', () => {
    expect(r2(contrastRatio('#595959', '#ffffff'))).toBe(7)
  })

  it('比值对称：交换前景背景结果不变', () => {
    expect(contrastRatio('#191c20', '#f8faff')).toBeCloseTo(contrastRatio('#f8faff', '#191c20'), 12)
  })

  it('半透明色直接抛错（alpha 叠加层必须先合成到具体底色）', () => {
    expect(() => contrastRatio('rgba(26, 111, 168, 0.12)', '#ffffff')).toThrow(/alpha=0.12/)
    expect(() => contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)')).toThrow(/alpha=0.5/)
  })
})
