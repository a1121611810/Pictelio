// heroTransition 的**测量与在途态**单测（ADR-0211 决策 12 机制 1/3/4）。
//
// 覆盖的是「降级矩阵」：拿不到矩形时必须退回普通转场，且**每条降级都要有独立原因码**。
// oracle 不取自实现：矩形数值是**构造的合成输入**，断言只关心「拿到/没拿到 + 拿到的是不是同一块矩形」；
// 时长/曲线断言的 oracle 是 src/styles/tokens.css 与 motion.ts 的档位表（见 heroTransitionContract 组）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HERO_ROOT_ID,
  beginHeroSource,
  armHeroBack,
  cacheHeroRect,
  currentHeroSourceIllustId,
  isPlausibleHeroRect,
  measureHeroDetail,
  measureHeroList,
  measureHeroRoot,
  resetHeroTransitionForTest,
  takeHeroSource,
  takeHeroTarget,
  heroSourceId,
} from './heroTransition'
import type { BoundingRect, SelectorQuery, SelectorQueryFactory } from '../primitives/measureRects'

/** 合成矩形构造器：数值是本文件给定的输入常量，不是从实现反推的 */
const R = (left: number, top: number, width: number, height: number): BoundingRect => ({
  left,
  top,
  width,
  height,
})

/** 页面根（视口坐标系；safeTop=40 用来验证「视口坐标 → 页面相对坐标」的换算不是恒等映射） */
const ROOT = R(0, 40, 1080, 2000)
/** 缩略图盒（视口坐标，落在根内部） */
const THUMB = R(60, 900, 500, 500)
/** 详情 hero 盒（视口坐标） */
const HERO = R(0, 320, 1080, 1350)

type RectMap = Record<string, BoundingRect | 'fail' | 'never'>

/**
 * 假 SelectorQuery 工厂：`rects` 里给矩形 / 'fail'（回调 fail）/ 'never'（回调永不落）。
 * 链式 select().invoke() 后统一 exec() —— 与 ADR-0149 的平台约束同形（逐 id select + 链式 exec）。
 */
function fakeFactory(rects: RectMap): SelectorQueryFactory {
  return () => {
    const query: SelectorQuery = {
      select(selector: string) {
        const id = selector.replace('#', '')
        return {
          invoke(options) {
            const entry = rects[id]
            if (entry === 'never') return query
            // 同步回调：模拟「查询已在 UI 线程排好队」的最快路径
            queueMicrotask(() => {
              if (entry === 'fail' || entry === undefined) options.fail?.(new Error('no node'))
              else options.success?.(entry)
            })
            return query
          },
        }
      },
      exec() {
        /* 链尾：真实实现把 task 提交到 UI 线程；假实现在 invoke 时已排微任务 */
      },
    }
    return query
  }
}

const opts = (rects: RectMap) => ({ createQuery: fakeFactory(rects) })

beforeEach(() => {
  resetHeroTransitionForTest()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('heroTransition 降级矩阵（每条降级一个独立原因码，禁静默）', () => {
  it('前进成功：点图发起的测量被详情页取到同一块矩形（id 与数值逐字相同）', async () => {
    beginHeroSource(7, opts({ [heroSourceId(7)]: THUMB }))
    const got = await takeHeroSource(7)
    expect(got).toEqual(THUMB)
  })

  it('无在途测量（深链直达详情）→ null + 落痕', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    expect(await takeHeroSource(7)).toBeNull()
    expect(spy).toHaveBeenCalled()
  })

  it('id 不匹配（守卫重定向 / 连点落到别的作品）→ null', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    beginHeroSource(7, opts({ [heroSourceId(7)]: THUMB }))
    expect(await takeHeroSource(8)).toBeNull()
    // 原因码独立可读：不是 measure-failed，而是 id-mismatch
    expect(spy.mock.calls[0]?.[1]).toBe('id-mismatch')
  })

  it('被更晚一次点击覆盖（stale-generation）→ null', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    beginHeroSource(7, opts({ [heroSourceId(7)]: THUMB }))
    const first = takeHeroSource(7)
    // 第二次 tap（同 id）自增代号：第一次的在途态已过期
    beginHeroSource(7, opts({ [heroSourceId(7)]: R(0, 0, 10, 10) }))
    expect(await first).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('stale-generation')
  })

  it('测量回调 fail（元素不在树上）→ null，原因码 measure-failed', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    beginHeroSource(7, opts({ [heroSourceId(7)]: 'fail' }))
    expect(await takeHeroSource(7)).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('measure-failed')
  })

  it('测量永不落定 → 超过截止时间即降级（不给转场挂可见延迟），原因码 deadline', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    beginHeroSource(7, opts({ [heroSourceId(7)]: 'never' }))
    expect(await takeHeroSource(7, { timeoutMs: 5 })).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('deadline')
  })

  it('无 createSelectorQuery（web-core 预览）→ 降级而不是抛错', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    beginHeroSource(7, { createQuery: () => undefined })
    expect(await takeHeroSource(7)).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('measure-failed')
  })

  it('一次性消费：同一次在途测量取第二次 → no-source（不留会误触发后续页的陈旧矩形）', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    beginHeroSource(7, opts({ [heroSourceId(7)]: THUMB }))
    expect(await takeHeroSource(7)).toEqual(THUMB)
    expect(await takeHeroSource(7)).toBeNull()
  })

  it('返回方向：详情页存下 hero 盒 → 返回守卫置位 → 列表页取到同一块矩形（同步可取）', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    cacheHeroRect(7, HERO)
    armHeroBack(7)
    // 前进在途态空 ⇒ 前进取不到；返回起点只服务 takeHeroTarget
    expect(await takeHeroSource(7)).toBeNull()
    expect(await takeHeroTarget(7)).toEqual(HERO)
  })

  it('未置位就返回（深链直达 / 详情页滚动过未置位）→ no-source，不硬造起点', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    expect(await takeHeroTarget(7)).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('no-source')
  })

  it('置位的作品与列表页要的不是一个 → id-mismatch（换作品后误返回）', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    cacheHeroRect(7, HERO)
    armHeroBack(7)
    expect(await takeHeroTarget(8)).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('id-mismatch')
  })

  it('存下的矩形与置位时的作品对不上（换作品后 arm 旧件）→ 不置位', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    cacheHeroRect(7, HERO)
    armHeroBack(8)
    expect(await takeHeroTarget(8)).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('no-source')
  })

  it('返回置位使正在等待的前进测量过期（决策 12 机制 4：提前返回不继续播）', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    beginHeroSource(7, opts({ [heroSourceId(7)]: THUMB }))
    const inflight = takeHeroSource(7)
    cacheHeroRect(7, HERO)
    armHeroBack(7)
    expect(await inflight).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('stale-generation')
  })

  it('一次性消费：置位只服务一次返回', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    cacheHeroRect(7, HERO)
    armHeroBack(7)
    expect(await takeHeroTarget(7)).toEqual(HERO)
    expect(await takeHeroTarget(7)).toBeNull()
  })
})

describe('heroTransition 测量工具', () => {
  it('measureHeroList：一次查询拿到「页面根 + 缩略图盒」两块矩形', async () => {
    const got = await measureHeroList(7, opts({ [HERO_ROOT_ID]: ROOT, [heroSourceId(7)]: THUMB }))
    expect(got).toEqual({ root: ROOT, source: THUMB })
  })

  it('measureHeroDetail：根矩形缺失时整体降级（覆盖层没有换算基准就不能定位）', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const got = await measureHeroDetail('hero-box', opts({ 'hero-box': HERO }))
    expect(got).toBeNull()
    expect(spy.mock.calls[0]?.[1]).toBe('measure-failed')
  })

  it('measureHeroRoot：根矩形可用（供覆盖层 absolute 定位换算）', async () => {
    expect(await measureHeroRoot(opts({ [HERO_ROOT_ID]: ROOT }))).toEqual(ROOT)
  })

  it('heroSourceId：按作品 id 派生且可逆（同一 id 恒得同一串 ⇒ 点图与测量不会张冠李戴）', () => {
    expect(heroSourceId(42)).toBe(heroSourceId(42))
    expect(heroSourceId(42)).not.toBe(heroSourceId(43))
    expect(heroSourceId(42).startsWith('pictelio-hero-source-')).toBe(true)
  })

  it('currentHeroSourceIllustId：供 onDeactivated 判定「这次 push 我活下来了」', () => {
    expect(currentHeroSourceIllustId()).toBeNull()
    beginHeroSource(7, opts({ [heroSourceId(7)]: THUMB }))
    expect(currentHeroSourceIllustId()).toBe(7)
  })
})

describe('矩形合法性（插值起点/终点的准入）', () => {
  it('正常屏内盒可用', () => {
    expect(isPlausibleHeroRect(THUMB)).toBe(true)
  })

  it('top < 0（详情页被滚动过，hero 盒已在视口上方）不可用：从屏外起飞会看到图凭空出现', () => {
    expect(isPlausibleHeroRect(R(0, -400, 1080, 1350))).toBe(false)
  })

  it('尺寸非正 / 非有限 / 缺字段一律不可用（空白矩形放大比滑动难看得多）', () => {
    expect(isPlausibleHeroRect(R(0, 0, 0, 100))).toBe(false)
    expect(isPlausibleHeroRect(R(0, 0, 100, 0))).toBe(false)
    expect(isPlausibleHeroRect(R(0, 0, Number.NaN, 100))).toBe(false)
    expect(isPlausibleHeroRect(R(0, 0, Number.POSITIVE_INFINITY, 100))).toBe(false)
    expect(isPlausibleHeroRect(null)).toBe(false)
    expect(isPlausibleHeroRect(undefined)).toBe(false)
  })
})
