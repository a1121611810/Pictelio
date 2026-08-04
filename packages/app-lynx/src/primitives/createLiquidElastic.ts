// 液态弹性算法原语（issue #97，移植自 liquid-glass-react index.tsx L360-428）。
// 纯函数无 DOM 依赖：组件层负责 touch 事件与元素矩形查询，算法全部收敛于此（唯一测试接缝）。
//
// 算法要点：
// - 激活区：触点距元素边缘 ≤ 200px 生效，fadeInFactor = 1 - edgeDistance / 200
// - 方向性拉伸：触点方向的轴拉伸（×0.3），垂直轴压缩（×0.15），下限 clamp 0.8
// - 弹性位移：translate = (触点 - 中心) × elasticity × 0.1 × fadeIn

export interface ElasticPoint {
  x: number
  y: number
}

export interface ElasticRect {
  left: number
  top: number
  width: number
  height: number
}

export interface LiquidElasticOptions {
  /** 弹性系数（源库默认 0.15）；0 = 完全禁用 */
  elasticity: number
  /** 激活区半径 px（源库 200） */
  activationZone?: number
}

interface ElasticState {
  fadeInFactor: number
  normalizedX: number
  normalizedY: number
  centerDistance: number
  deltaX: number
  deltaY: number
}

function computeState(point: ElasticPoint, rect: ElasticRect, activationZone: number): ElasticState {
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const deltaX = point.x - centerX
  const deltaY = point.y - centerY

  const edgeDistanceX = Math.max(0, Math.abs(deltaX) - rect.width / 2)
  const edgeDistanceY = Math.max(0, Math.abs(deltaY) - rect.height / 2)
  const edgeDistance = Math.sqrt(edgeDistanceX * edgeDistanceX + edgeDistanceY * edgeDistanceY)

  const fadeInFactor = edgeDistance >= activationZone ? 0 : 1 - edgeDistance / activationZone

  const centerDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  return {
    fadeInFactor,
    normalizedX: centerDistance === 0 ? 0 : deltaX / centerDistance,
    normalizedY: centerDistance === 0 ? 0 : deltaY / centerDistance,
    centerDistance,
    deltaX,
    deltaY,
  }
}

export function createLiquidElastic(options: LiquidElasticOptions) {
  const { elasticity, activationZone = 200 } = options

  /** 方向性拉伸：scaleX(...) scaleY(...)；无效果时返回 "scale(1)" */
  function transform(point: ElasticPoint, rect: ElasticRect): string {
    if (elasticity === 0) return "scale(1)"
    const s = computeState(point, rect, activationZone)
    if (s.fadeInFactor === 0 || s.centerDistance === 0) return "scale(1)"

    const stretchIntensity = Math.min(s.centerDistance / 300, 1) * elasticity * s.fadeInFactor
    const scaleX =
      1 + Math.abs(s.normalizedX) * stretchIntensity * 0.3 - Math.abs(s.normalizedY) * stretchIntensity * 0.15
    const scaleY =
      1 + Math.abs(s.normalizedY) * stretchIntensity * 0.3 - Math.abs(s.normalizedX) * stretchIntensity * 0.15

    return `scaleX(${Math.max(0.8, scaleX)}) scaleY(${Math.max(0.8, scaleY)})`
  }

  /** 弹性位移（指向触点的轻微拖拽感）；无效果时返回 {x:0, y:0} */
  function translate(point: ElasticPoint, rect: ElasticRect): ElasticPoint {
    if (elasticity === 0) return { x: 0, y: 0 }
    const s = computeState(point, rect, activationZone)
    if (s.fadeInFactor === 0) return { x: 0, y: 0 }
    return {
      x: s.deltaX * elasticity * 0.1 * s.fadeInFactor,
      y: s.deltaY * elasticity * 0.1 * s.fadeInFactor,
    }
  }

  return { transform, translate }
}
