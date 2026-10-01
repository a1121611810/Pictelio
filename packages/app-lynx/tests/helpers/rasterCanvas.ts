// ─── 合成 fixture 的画布 + PNG 编码（两个脚本门禁共用）───
//
// 抽出来是因为 `findUiBand.test.ts` 与 `findPaletteSwatches.test.ts` 需要**逐字相同**
// 的编码实现：两份 PNG 编码器一旦对 zlib/filter 的假设不同，同一张合成图会得到
// 两个不同的解码结果，而症状会表现成「判据时灵时不灵」——极难归因。
//
// 为什么在测试里现画、而不是提交二进制 PNG：提交的 fixture 会陈旧。改了脚本里的
// 阈值、换了画布尺寸、调整了圆角半径之后，PNG 还在而断言的期望值已经对不上，
// 要么红得莫名其妙，要么有人顺手把期望值改成「当前输出」——门禁就彻底废了。
// 现画则输入与期望写在同一处，不可能对不上。
//
// Oracle 纪律：**颜色必须是真机实测值**，不是「挑的好看的」。合成输入与真实输入
// 的差异必须小于被测判据的阈值，否则 fixture 验的是另一个问题
// （2026-09-30 #864 教训：我自称「取自真实色值」却编了色，色差 38 < 阈值 60，
//  阳性用例以「宽 0px」被拒，看着像脚本坏了，真 bug 藏在那个常量里）。
import { crc32, deflateSync } from 'node:zlib'

export type RGB = readonly [number, number, number]

/** 画布尺寸。真机同尺寸：被测脚本的判据阈值多为**屏宽/屏高比例**，
 *  换尺寸就是换阈值，fixture 就不再是在验真机上标定的那套判据。 */
export const W = 1080
export const H = 2160

/** `find-ui-band.py` 的 y 扫描窗口（`y_min_ratio` 0.12 / `y_max_ratio` 0.85）。 */
export const SCAN_Y0 = Math.floor(H * 0.12)
export const SCAN_Y1 = Math.floor(H * 0.85)

function chunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(payload.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crc])
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 任意尺寸 / 任意 color type 的 PNG 编码，每行 filter type 0。
 *
 * 为什么需要它（`png-luma.py` 门禁用）：
 * · **小图** —— 该脚本的标准库解码路径是纯 Python 逐像素循环，1080×2160 实测 ~25s，
 *   门禁里每张 fixture 都那么跑不动。
 * · **灰度 / RGBA** —— 它的 docstring 自己记着「灰度只有 1–2 通道，按 RGB 取值会跨像素，
 *   均值/标准差取错、饱和度恒不为 0，而且不报错」，那正是要钉住的潜伏缺陷。
 *
 * ⚠️ 刻意**不写第二份编码器**：两份编码器一旦对 zlib/filter 的假设不同，同一张合成图
 * 会得到两个解码结果，症状是「判据时灵时不灵」。`encodePng` 现在是本函数的薄包装。
 */
export interface PngOpts {
  w: number
  h: number
  /** 0=灰度 2=RGB 4=灰度+alpha 6=RGBA —— 与 png-luma.py 支持的四种 color type 一致 */
  colorType: 0 | 2 | 4 | 6
  /** 已按 colorType 的通道数平铺的像素（行优先） */
  px: Uint8Array
}

export function encodePngOpts(o: PngOpts): Buffer {
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[o.colorType]
  const src = Buffer.from(o.px.buffer, o.px.byteOffset, o.px.byteLength)
  const stride = 1 + o.w * ch
  const raw = Buffer.alloc(o.h * stride)
  for (let y = 0; y < o.h; y++) {
    raw[y * stride] = 0
    src.copy(raw, y * stride + 1, y * o.w * ch, (y + 1) * o.w * ch)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(o.w, 0)
  ihdr.writeUInt32BE(o.h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = o.colorType
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 8 位真彩色 PNG（color type 2），每行 filter type 0。真机同尺寸 1080×2160。 */
export function encodePng(px: Uint8Array): Buffer {
  return encodePngOpts({ w: W, h: H, colorType: 2, px })
}

export class Canvas {
  readonly px = new Uint8Array(W * H * 3)
  constructor(bg: RGB) {
    for (let i = 0; i < W * H; i++) this.px.set(bg, i * 3)
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    this.px.set(c, (y * W + x) * 3)
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c)
  }
  /** 圆角矩形；`r = 0` 时退化为方角 —— 方角 ⇒ 剖面**完全平坦**，是旧判据的触发形态。 */
  roundRect(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB): void {
    if (r <= 0) return this.rect(x0, y0, x1, y1, c)
    for (let y = y0; y <= y1; y++) {
      let shrink = 0
      if (y < y0 + r) shrink = r - Math.sqrt(Math.max(0, r * r - (y0 + r - y) ** 2))
      else if (y > y1 - r) shrink = r - Math.sqrt(Math.max(0, r * r - (y - (y1 - r)) ** 2))
      const sx = x0 + Math.ceil(shrink)
      const ex = x1 - Math.floor(shrink)
      for (let x = sx; x <= ex; x++) this.set(x, y, c)
    }
  }
  /** 实心圆（色板 swatch 用）。 */
  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c)
      }
    }
  }
  /** 圆环（选中态 swatch 的外圈）。`gap` 是环与本体之间的**白缝**宽度。 */
  ring(cx: number, cy: number, rOuter: number, rInner: number, c: RGB): void {
    for (let y = cy - rOuter; y <= cy + rOuter; y++) {
      for (let x = cx - rOuter; x <= cx + rOuter; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2
        if (d2 <= rOuter * rOuter && d2 >= rInner * rInner) this.set(x, y, c)
      }
    }
  }
}
