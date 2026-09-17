// 正文选中会话深模块单测（spec docs/specs/app-lynx-novel-text-selection.md §Implementation Decisions）。
//
// oracle：spec §ID 不变式 1-10 逐条 + 设备实证（docs/research/lynx-text-selection-device-probe.md：
// 事件形状 {target.id, detail.{start,end}}、start === -1 为清空、索引是段落文本下标）。
// 依赖全部注入假件 → 不需要 vi.mock，也不需要 vue-lynx 渲染器（仓库无渲染器）。
import { describe, expect, it, vi } from 'vitest'
import {
  createTextSelection,
  type MeasureOutcome,
  type SelectionChangeEvent,
  type TextSelectionDeps,
} from './createTextSelection'

const PARAGRAPHS: Record<string, string> = {
  'p-0': '第 1 段．这是一段用于选中实证的正文。',
  'p-1': '第 2 段．第二句用来观察选区手柄。',
  // 含代理对（emoji）：引擎索引按码点计数，切片必须同单位（设备实证踩过：String.slice 劈开代理对）
  'p-2': '第三段带 emoji 🌸 与英文混合。',
}

/** 可手动放行的假调度器（宽限窗 / 反馈 TTL 都被它接管） */
function fakeScheduler() {
  const tasks = new Map<number, () => void>()
  let nextId = 0
  return {
    schedule: (fn: () => void): (() => void) => {
      const id = ++nextId
      tasks.set(id, fn)
      return () => {
        tasks.delete(id)
      }
    },
    /** 触发所有在挂任务（模拟时间流逝） */
    fire(): void {
      const pending = [...tasks.values()]
      tasks.clear()
      for (const fn of pending) fn()
    },
    pending(): number {
      return tasks.size
    },
  }
}

function setup(overrides: Partial<TextSelectionDeps> = {}) {
  const scheduler = fakeScheduler()
  const measureCalls: Array<{ nodeId: string; start: number; end: number }> = []
  const cleared: string[] = []
  const written: string[] = []
  const opened: string[] = []
  const modals: Array<() => void> = []

  let outcome: MeasureOutcome = { ok: true, rectVw: { left: 40, top: 50, width: 20, height: 3 } }
  let clipboardFails = false
  let paragraphs = { ...PARAGRAPHS }

  const deps: TextSelectionDeps = {
    getParagraphText: (nodeId) => paragraphs[nodeId] ?? null,
    engine: {
      measureRange: (nodeId, range) => {
        measureCalls.push({ nodeId, start: range.start, end: range.end })
        return Promise.resolve(outcome)
      },
      clearRange: (nodeId) => {
        cleared.push(nodeId)
        return Promise.resolve(true)
      },
    },
    clipboard: {
      writeText: (text) => {
        written.push(text)
        return clipboardFails ? Promise.reject(new Error('原生失败')) : Promise.resolve()
      },
    },
    search: {
      openWithKeyword: (keyword) => {
        opened.push(keyword)
      },
    },
    registerModal: (close) => {
      modals.push(close)
      return () => {
        const idx = modals.indexOf(close)
        if (idx !== -1) modals.splice(idx, 1)
      }
    },
    labels: { copy: '复制', search: '搜索', copied: '已复制', copyFailed: '复制失败' },
    schedule: scheduler.schedule,
    ...overrides,
  }

  const ctl = createTextSelection(deps)
  return {
    ctl,
    scheduler,
    measureCalls,
    cleared,
    written,
    opened,
    modals,
    setOutcome: (next: MeasureOutcome) => {
      outcome = next
    },
    setClipboardFails: (v: boolean) => {
      clipboardFails = v
    },
    mutateParagraph: (nodeId: string, text: string) => {
      paragraphs = { ...paragraphs, [nodeId]: text }
    },
  }
}

/** 选中 p-0 的 [4, 6)（= 「这是」） */
function select(ctx: ReturnType<typeof setup>, start = 4, end = 6, nodeId = 'p-0'): SelectionChangeEvent {
  const event: SelectionChangeEvent = { target: { id: nodeId }, detail: { start, end, direction: 'forward' } }
  ctx.ctl.onSelectionChange(event)
  return event
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createTextSelection · 选中与定位', () => {
  it('选中 → 测矩成功后可见，style 由几何给出；modal 注册一次', async () => {
    const ctx = setup()
    select(ctx)
    await flush()

    const view = ctx.ctl.getView()
    expect(view.visible).toBe(true)
    expect(view.style?.left).toBeDefined()
    expect(view.style?.top).toBeDefined()
    expect(ctx.measureCalls).toEqual([{ nodeId: 'p-0', start: 4, end: 6 }])
    expect(ctx.modals).toHaveLength(1)
  })

  it('测矩失败（no-engine / bad-range / timeout / bad-calibration）→ 保持隐藏 + warn（不变式 3）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const reason of ['no-engine', 'bad-range', 'timeout', 'bad-calibration'] as const) {
      const ctx = setup()
      ctx.setOutcome({ ok: false, reason })
      select(ctx)
      await flush()
      expect(ctx.ctl.getView().visible).toBe(false)
      expect(ctx.modals).toHaveLength(0)
    }
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('本地切片：选中文本取自段落文本下标（不需要 getSelectedText，不变式 1）', async () => {
    const ctx = setup()
    select(ctx, 6, 8)
    await flush()
    await ctx.ctl.copy()
    expect(ctx.written).toEqual(['这是'])
  })

  it('按码点切片：emoji（代理对）不被劈开，索引与引擎同单位', async () => {
    const ctx = setup()
    // '第三段带 emoji 🌸 与英文混合。' 的码点下标：🌸 = 11
    select(ctx, 11, 12, 'p-2')
    await flush()
    expect(ctx.ctl.getView().visible).toBe(true)
    ctx.ctl.copy()
    await flush()
    expect(ctx.written).toEqual(['🌸'])
    expect(ctx.written[0].length).toBe(2) // 完整代理对（两码元）而非半个字符

    // 码点 13 = 「与」；若按 UTF-16 码元切片，slice(13,14) 会得到 emoji 之后的空格 → 判别式断言
    select(ctx, 13, 14, 'p-2')
    await flush()
    ctx.ctl.copy()
    await flush()
    expect(ctx.written[1]).toBe('与')
  })

  it('未知节点 / 越界 / 空白选中 → 忽略且不显示（warn 一次）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = setup()

    select(ctx, 0, 2, 'p-404') // 未知节点
    await flush()
    expect(ctx.ctl.getView().visible).toBe(false)

    select(ctx, 0, 999) // 越界
    await flush()
    expect(ctx.ctl.getView().visible).toBe(false)

    ctx.mutateParagraph('p-1', '   ') // 纯空白段
    select(ctx, 0, 3, 'p-1')
    await flush()
    expect(ctx.ctl.getView().visible).toBe(false)

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('过期测量被丢弃：旧选中的测量结果不得覆盖新选中（不变式 5）', async () => {
    const pending: Array<(v: MeasureOutcome) => void> = []
    const ctx = setup({
      engine: {
        measureRange: () =>
          new Promise<MeasureOutcome>((resolve) => {
            pending.push(resolve)
          }),
        clearRange: () => Promise.resolve(true),
      },
    })
    select(ctx, 4, 6)
    select(ctx, 0, 3)
    expect(pending).toHaveLength(2)

    // 第二次先落地；第一次（过期代）后落地不得覆盖
    pending[1]({ ok: true, rectVw: { left: 0, top: 90, width: 5, height: 3 } })
    await flush()
    const afterSecond = ctx.ctl.getView().style?.top
    pending[0]({ ok: true, rectVw: { left: 40, top: 10, width: 20, height: 3 } })
    await flush()
    expect(ctx.ctl.getView().style?.top).toBe(afterSecond)
    expect(ctx.ctl.getView().visible).toBe(true)
  })
})

describe('createTextSelection · 收起（五条路径，不变式 6/8/9）', () => {
  it('空白点击（start === -1）→ 宽限窗内不立即收起，到点收起 + 清选 + 注销 modal', async () => {
    const ctx = setup()
    select(ctx)
    await flush()
    expect(ctx.ctl.getView().visible).toBe(true)

    ctx.ctl.onSelectionChange({ target: { id: 'p-0' }, detail: { start: -1, end: -1 } })
    expect(ctx.ctl.getView().visible).toBe(true) // 宽限窗内仍可点动作
    ctx.scheduler.fire()
    expect(ctx.ctl.getView().visible).toBe(false)
    expect(ctx.modals).toHaveLength(0)
    expect(ctx.cleared).toEqual(['p-0'])
  })

  it('宽限窗内点复制：载荷不丢（不变式 9 的核心收益）', async () => {
    const ctx = setup()
    select(ctx, 6, 8)
    await flush()
    // 模拟「点菜单时引擎先派发清空」
    ctx.ctl.onSelectionChange({ target: { id: 'p-0' }, detail: { start: -1, end: -1 } })
    ctx.ctl.copy()
    await flush()
    expect(ctx.written).toEqual(['这是'])
    expect(ctx.ctl.getView().copyState).toBe('copied')
    ctx.scheduler.fire()
    expect(ctx.ctl.getView().visible).toBe(false)
  })

  it('滚动收起：隐藏态早退零副作用（不变式 8）', async () => {
    const ctx = setup()
    ctx.ctl.onScroll()
    expect(ctx.cleared).toHaveLength(0)

    select(ctx)
    await flush()
    ctx.ctl.onScroll()
    expect(ctx.ctl.getView().visible).toBe(false)
    expect(ctx.cleared).toEqual(['p-0'])
  })

  it('dismiss 幂等：连续收起只清一次选、只注销一次', async () => {
    const ctx = setup()
    select(ctx)
    await flush()
    ctx.ctl.dismiss()
    ctx.ctl.dismiss()
    expect(ctx.cleared).toEqual(['p-0'])
    expect(ctx.modals).toHaveLength(0)
  })

  it('菜单外点击（onTapAway）：长按抬手被消费（不收起），随后的点别处收起', async () => {
    // 设备实测：① 点空白**不派发**清空事件 → 宿主转发 tap；② 长按抬手的 release 会被判为 tap
    // → 宿主导入 @longpress 打标，模块消费该次抬手（同 useLongPress.consumeLongPress 惯例）
    const ctx = setup({ tapGuardMs: 10_000 })
    select(ctx)
    await flush()
    ctx.ctl.notifyLongPress()
    ctx.ctl.onTapAway()
    expect(ctx.ctl.getView().visible).toBe(true) // 抬手不收起
    expect(ctx.cleared).toHaveLength(0)
    ctx.ctl.onTapAway() // 第二次 tap（用户真的点了别处）
    expect(ctx.ctl.getView().visible).toBe(false)
    expect(ctx.cleared).toEqual(['p-0'])
  })

  it('保护窗过期后的 tap 正常收起（长按后过一会儿再点别处）', async () => {
    const ctx = setup({ tapGuardMs: 100 })
    select(ctx)
    await flush()
    ctx.ctl.notifyLongPress()
    const base = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(base + 200) // 越过保护窗
    ctx.ctl.onTapAway()
    spy.mockRestore()
    expect(ctx.ctl.getView().visible).toBe(false)
  })

  it('返回键：注册的回调被调用即收起（三级语义的前两级）', async () => {
    const ctx = setup()
    select(ctx)
    await flush()
    expect(ctx.modals).toHaveLength(1)
    ctx.modals[0]() // 模拟 modalStack.closeTopModal
    expect(ctx.ctl.getView().visible).toBe(false)
  })
})

describe('createTextSelection · 动作', () => {
  it('复制成功 → copied 态 + 文案切换；TTL 到点整条收起（spec §ID 9）', async () => {
    const ctx = setup()
    select(ctx)
    await flush()
    ctx.ctl.copy()
    await flush()

    const copiedView = ctx.ctl.getView()
    expect(copiedView.copyState).toBe('copied')
    expect(copiedView.items[0]).toMatchObject({ key: 'copy', label: '已复制', state: 'done' })
    ctx.scheduler.fire()
    expect(ctx.ctl.getView().visible).toBe(false)
  })

  it('复制失败 → failed 态常驻且文案可见（禁假成功，#568）', async () => {
    const ctx = setup()
    ctx.setClipboardFails(true)
    select(ctx)
    await flush()
    ctx.ctl.copy()
    await flush()

    const view = ctx.ctl.getView()
    expect(view.copyState).toBe('failed')
    expect(view.items[0]).toMatchObject({ key: 'copy', label: '复制失败', state: 'error' })
    ctx.scheduler.fire()
    expect(view.visible !== false).toBe(true) // 无 TTL 任务 → 仍可见
  })

  it('动作前校验（不变式 2）：段落文本已变 → 不写剪贴板并收起', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = setup()
    select(ctx, 6, 8)
    await flush()
    ctx.mutateParagraph('p-0', '第 1 段．内容被换掉了（回收重建）。')
    ctx.ctl.copy()
    await flush()
    expect(ctx.written).toHaveLength(0)
    expect(ctx.ctl.getView().visible).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('搜索：先收起（modal 注销）再把截断后的关键词交给端口', async () => {
    const ctx = setup()
    select(ctx, 0, 12)
    await flush()
    ctx.ctl.search()
    expect(ctx.opened).toEqual(['第 1 段．这是一段用于']) // 12 字以内 → 原样（首行）
    expect(ctx.ctl.getView().visible).toBe(false)
    expect(ctx.modals).toHaveLength(0)
  })
})

describe('createTextSelection · 生命周期', () => {
  it('dispose 后：注销 modal、清 timer，迟到回调 no-op', async () => {
    const ctx = setup()
    select(ctx)
    await flush()
    expect(ctx.modals).toHaveLength(1)
    ctx.ctl.dispose()
    expect(ctx.modals).toHaveLength(0)
    expect(ctx.ctl.getView().visible).toBe(false)
    ctx.ctl.copy() // 不抛
    expect(ctx.written).toHaveLength(0)
  })

  it('新选中重置复制反馈（copyState 不串到下一段）', async () => {
    const ctx = setup()
    select(ctx, 4, 6)
    await flush()
    ctx.ctl.copy()
    await flush()
    expect(ctx.ctl.getView().copyState).toBe('copied')

    select(ctx, 0, 3)
    await flush()
    expect(ctx.ctl.getView().copyState).toBe('idle')
  })
})
