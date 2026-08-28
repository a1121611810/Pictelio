// 封面比例显示的纯逻辑（app-lynx，spec: app-lynx-recommended-carousel-polish-r2 §2.1 / §3.2；ADR-0118 决策 1）。
// 语义：推荐轮播封面「贴顶、宽满、高按原图比例」——不裁切不变形；显示高度用作品元数据预计算（插画 width/height、
// 小说无尺寸字段按方形封面 1:1），不等图加载；超高图（按比例高度 ≥ 滑页可视区高）回退 aspectFill 裁切（不溢出）。
// 与「深模块可测」惯例一致：无 DOM 依赖、node 可测；渲染行为归 web-core/真机验证闭环（spec §4）。

export type CoverFit = 'cover' | 'width-fill'

export interface CoverDisplayInput {
  /** 图片原始宽（px）；缺失视为尺寸缺失（小说方形契约） */
  imgWidth?: number
  /** 图片原始高（px）；缺失视为尺寸缺失（小说方形契约） */
  imgHeight?: number
  /** 滑页可视区宽（px，调用方从 SystemInfo 派生） */
  viewportWidth: number
  /** 滑页可视区高（px，调用方从 SystemInfo 派生） */
  viewportHeight: number
}

export interface CoverDisplay {
  /** 'width-fill' 贴顶宽满按比例；'cover' aspectFill 裁切回退 */
  fit: CoverFit
  /** 宽:高最简整数比字符串（如 "4 / 5"）；尺寸缺失时按方形契约 "1 / 1" */
  ratio: string
  /** 按比例显示高度（vw，容器宽 = 100vw） */
  heightVw: number
}

/** 最大公约数（欧几里得），把宽高约分到最简整数比 */
function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

/** 尺寸/视口是否有效：number、有限、> 0（缺失 / NaN / Infinity / <=0 均视为非法） */
function isValidDimension(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * 把 "W / H" 最简比字符串换算为按比例显示高度（vw）= 100 × H / W（容器宽 = 100vw）。
 * 非法输入（无法解析 / W 或 H 非正）返回 NaN——由调用方判断后防御性回退（CoverImage width-fill 回退 cover）。
 * oracle：spec §3.2「容器宽 = 100vw，高按原图比例」；"4 / 5" → 125、"16 / 9" → 56.25。
 */
export function ratioToHeightVw(ratio: string): number {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(ratio)
  if (!m) return Number.NaN
  const w = Number(m[1])
  const h = Number(m[2])
  if (w <= 0 || h <= 0) return Number.NaN
  return (100 * h) / w
}

/**
 * 推导封面显示方式（spec §2.1 / ADR-0118 决策 1）：
 * - 尺寸缺失或非法（<=0 / NaN / Infinity）→ width-fill + 方形契约（"1 / 1"、heightVw 100）——小说无尺寸字段。
 * - 否则 ratio = 宽高最简整数比（GCD 化简，如 600×750 → "4 / 5"），heightVw = 100 × imgHeight / imgWidth。
 * - 可视区可用高度（vw）= 100 × viewportHeight / viewportWidth；若 heightVw ≥ 可用高度（超高图）→ fit 'cover'
 *   （回退 aspectFill 裁切，不溢出、无页内滚动）；否则 fit 'width-fill'。
 * - viewport 非法（<=0）按可用高度 +∞ 处理（永不回退 cover）。
 * 纯函数不打印日志；非静默降级（尺寸缺失的 1:1 假定）由调用方在接线层负责（spec §3.5）。
 */
export function deriveCoverDisplay(input: CoverDisplayInput): CoverDisplay {
  const { imgWidth, imgHeight, viewportWidth, viewportHeight } = input
  if (!isValidDimension(imgWidth) || !isValidDimension(imgHeight)) {
    return { fit: 'width-fill', ratio: '1 / 1', heightVw: 100 }
  }
  const g = gcd(imgWidth, imgHeight)
  const ratio = `${imgWidth / g} / ${imgHeight / g}`
  const heightVw = (100 * imgHeight) / imgWidth
  const availableVw = isValidDimension(viewportWidth) && isValidDimension(viewportHeight)
    ? (100 * viewportHeight) / viewportWidth
    : Number.POSITIVE_INFINITY
  return { fit: heightVw >= availableVw ? 'cover' : 'width-fill', ratio, heightVw }
}
