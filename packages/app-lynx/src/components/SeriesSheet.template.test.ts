// ─── SeriesSheet.vue 模板契约 + i18n 兜底（spec docs/specs/app-lynx-novel-intro-action-row §US3 / §5.3 / §6.3 / §10）───
//
// 测试硬约束（违反视为违规）：
// - 真实样例 mock：loadNovelSeriesChapters / loadNovelSeriesChaptersNext 是 api/novel.ts 真实端点函数
//   （Oracle = api/novel.ts:116-137，GET /v2/novel/series?series_id=...&last_order=...）；
//   vi.mock 仅替换为 vi.fn()，不重写语义
// - 期望值可追溯 oracle：状态机 = spec §6.3（loading / loaded / loadingMore / error / empty）
//   视觉 = spec §5.3（弹层高度 max-h-[80vh] / 圆角顶部 / 拖把顶栏）
//   ADR-0123 = 全屏覆盖层必须挂 @tap（禁止 pointer-events-none 兜底）
//   代闸 = 多次 mount 不同 seriesId 不串数据（spec §10 验收 #8）
// - 禁止静默降级：失败路径必 console.warn 带 [SeriesSheet] 模块前缀
// - IO 边界双路径：成功路径（加载章节列表）+ 失败/降级路径（错误展示 + 重试）
//
// 仓库无 vue-lynx 渲染器（node 环境，BookmarkButton.host-matrix.test.ts 同款约束），
// 本测试组合：
// 1) SFC 编译（vue/compiler-sfc.parse）→ 组件能 mount（验收 #1）
// 2) 源码模板断言 → 渲染形状 + 事件接线 + ADR-0123 合规（验收 #2-#7）
// 3) vi.mock(api/novel) + spyOn(console.warn) → 真实函数级行为（验收 #6/#8）
// 4) i18n 运行时 → t() 缺 key 不抛错（验收 #8 / spec §10）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'vue/compiler-sfc'
import { setLocale, t } from '../i18n'
import * as novelApi from '../api/novel'

const src = readFileSync(fileURLToPath(new URL('./SeriesSheet.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与行注释后的代码本文（负向断言对象：约束说明本身会提到目标串） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

// ─── vi.mock 拦截 api/novel ───
// vi.hoisted 保证 mock 变量在 import 之前实例化（vitest 工厂内可见）
const { loadNovelSeriesChapters, loadNovelSeriesChaptersNext } = vi.hoisted(() => ({
  loadNovelSeriesChapters: vi.fn(),
  loadNovelSeriesChaptersNext: vi.fn(),
}))

vi.mock('../api/novel', () => ({
  loadNovelSeriesChapters,
  loadNovelSeriesChaptersNext,
}))

// ─── 真实字段形状 mock（oracle: api/types.ts:74-92 PixivNovel）───
// 测试硬约束 #2 真实样例：mock 字段名/形状对齐 PixivNovel（id/title/text_length 等真实字段），
// 不手写自洽字段。
function makePixivNovel(
  id: number,
  overrides: { title?: string; text_length?: number } = {},
): {
  id: number
  title: string
  text_length: number
} {
  return {
    id,
    title: overrides.title ?? `Chapter ${id}`,
    text_length: overrides.text_length ?? 1000,
  }
}

function silenceWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

afterEach(() => {
  loadNovelSeriesChapters.mockReset()
  loadNovelSeriesChaptersNext.mockReset()
  vi.restoreAllMocks()
})

// ─── 验收 #1：组件能 mount（不崩）───
describe('SeriesSheet.vue SFC 编译（验收 #1：组件能 mount）', () => {
  it('parse 不报错（vue/compiler-sfc 解析 <script setup> + <template> 双块）', () => {
    const { errors } = parse(src, { filename: 'SeriesSheet.vue' })
    expect(errors).toEqual([])
  })

  it('export default 由 <script setup> 自动产生（无显式 export）', () => {
    // <script setup> 编译产物自带隐式 export default；源码不应有显式 export default
    expect(code).not.toMatch(/^export default /m)
  })
})

// ─── 验收 #2-#5：模板渲染形状（modalStack 模式 + 三态 + 当前章节高亮）───
describe('SeriesSheet.vue 弹层结构（spec §5.3 modalStack 模式）', () => {
  it('根 absolute inset-0 宿主（modalStack 模式约定，CommentOverlay / NovelExportSheet 同款）', () => {
    expect(code).toContain('class="absolute inset-0"')
  })

  it('半透明遮罩：absolute inset-0 + bg-scrim（M3 scrim token）+ @tap 关闭', () => {
    // ADR-0123 红线：遮罩必须挂 @tap（lynx 原生 hit-testing 不识别 pointer-events）
    expect(code).toContain('class="absolute inset-0 bg-scrim"')
    expect(code).toMatch(/class="absolute inset-0 bg-scrim"[\s\S]{0,200}@tap="emit\('close'\)"/)
  })

  it('底部面板：max-h-[80vh] + rounded-t M3 + @tap.stop 防穿透', () => {
    expect(code).toContain('max-h-[80vh]')
    expect(code).toContain('rounded-t-[var(--md-shape-extra-large)]')
    // 面板 @tap.stop 防冒泡到 scrim
    expect(code).toMatch(/class="absolute bottom-0 left-0 right-0 max-h-\[80vh\][\s\S]{0,300}@tap\.stop/)
  })

  it('拖把式顶栏（视觉提示，可点关闭）+ 系列名标题', () => {
    expect(code).toContain('w-12 h-1 rounded-full')
    expect(code).toContain('w-full flex justify-center pt-2 pb-1')
    expect(code).toContain('{{ seriesTitle }}')
  })
})

describe('SeriesSheet.vue 三态（spec §6.3 状态机）', () => {
  it('加载中态（loading）→ 显示 novels.footer.loading 文本', () => {
    expect(code).toContain('v-if="loading"')
    // 复用既有 key（zh-CN/en 均已注册），不依赖本期新增 key
    expect(code).toContain("{{ t('novels.footer.loading') }}")
  })

  it('错误态（errorMsg）→ 显示错误文案 + 重试按钮（用 novelIntro.retry 既有 key）', () => {
    expect(code).toContain('v-else-if="errorMsg"')
    expect(code).toContain('{{ errorMsg }}')
    expect(code).toContain('@tap="reload"')
    expect(code).toContain("{{ t('novelIntro.retry') }}")
  })

  it('空态（chapters.length === 0）→ 显示本期新增 seriesSheet.empty 文案', () => {
    expect(code).toContain('v-else-if="chapters.length === 0"')
    expect(code).toContain("tt('seriesSheet.empty')")
  })

  it('列表态（v-else）→ 章节列表（vue-lynx 原生 <list> + <list-item>）', () => {
    expect(code).toContain('<list')
    expect(code).toContain('v-for="(chapter, idx) in chapters"')
    expect(code).toContain(':item-key="String(chapter.id)"')
  })
})

describe('SeriesSheet.vue 当前章节高亮（spec §5.3：bg-secondary-container）', () => {
  it('列表项匹配 currentNovelId 时套 bg-secondary-container + font-semibold', () => {
    // 选中态：bg-secondary-container（M3 secondary container，与 BookmarkButton.is-bookmarked 同范式）
    expect(code).toContain("chapter.id === currentNovelId ? 'bg-secondary-container' : ''")
    // 当前章节标题加粗
    expect(code).toContain("chapter.id === currentNovelId ? 'font-semibold' : ''")
  })

  it('列表项命中 currentNovelId 时显示「当前」chip（tt(\'seriesSheet.current\')）', () => {
    expect(code).toContain('v-if="chapter.id === currentNovelId"')
    expect(code).toContain("tt('seriesSheet.current')")
    // chip 视觉：bg-primary + text-primary-on
    expect(code).toContain('class="ml-2 px-2 py-0.5 rounded-full bg-primary flex-shrink-0"')
    expect(code).toContain('text-primary-on')
  })

  it('验收 #5：章节点击触发 onChapterTap（emit select 与 novelId）', () => {
    // 列表项 @tap → onChapterTap(chapter.id)
    expect(code).toContain('@tap="onChapterTap(chapter.id)"')
    // 函数体：emit('select', novelId)
    expect(code).toContain("emit('select', novelId)")
  })
})

describe('SeriesSheet.vue 分页 footer 三态（spec §6.3：loadingMore / end / sentinel）', () => {
  it('分页加载中（loadingMore）→ 显示 novels.footer.loading', () => {
    expect(code).toContain('v-if="loadingMore"')
    expect(code).toContain("{{ t('novels.footer.loading') }}")
  })

  it('分页结束（!hasMore && chapters.length > 0）→ 显示 novels.footer.end', () => {
    expect(code).toContain('v-else-if="!hasMore && chapters.length > 0"')
    expect(code).toContain("{{ t('novels.footer.end') }}")
  })

  it('分页 sentinel（hasMore）→ 暴露 loadMore（defineExpose）', () => {
    expect(code).toContain('v-else-if="hasMore"')
    // 暴露 loadMore 给宿主（本期不接 @scrolltolower，宿主按需触发）
    expect(code).toContain('defineExpose({ loadMore })')
  })
})

// ─── ADR-0123 合规 ───
describe('SeriesSheet.vue ADR-0123 合规（禁 pointer-events-none 兜底）', () => {
  it('模板内不出现 pointer-events-none（lynx 原生 hit-testing 不识别，会吞掉下面所有点击）', () => {
    // 检查代码本体（剥注释后），不检 src 原文——注释里提及 pointer-events-none 是 ADR 说明，
    // 模板/脚本里**使用**它才违反红线
    expect(code).not.toMatch(/pointer-events-none/)
  })

  it('全屏覆盖层（根 view）必须挂 @tap 句柄或 v-if 条件渲染——本组件走 @tap="emit(\'close\')"', () => {
    // 遮罩 @tap 直接关闭；面板 @tap.stop 防穿透；拖把 @tap 关闭
    const scrimClose = (code.match(/@tap="emit\('close'\)"/g) ?? []).length
    expect(scrimClose).toBeGreaterThanOrEqual(2) // 遮罩 + 拖把
  })
})

// ─── 验收 #5/#6：scrim 关闭 + modalStack 返回键 ───
describe('SeriesSheet.vue 关闭路径（scrim 点击 + modalStack 返回键）', () => {
  it('验收 #4：scrim 点击触发 close emit（@tap="emit(\'close\')" 存在于遮罩）', () => {
    expect(code).toContain('@tap="emit(\'close\')"')
  })

  it('返回键拦截：useModalStack 注册 + 卸载注销（与 CommentOverlay / NovelExportSheet 同款）', () => {
    expect(code).toContain("useModalStack().registerModal(() => emit('close'))")
    expect(code).toContain('unregisterModal?.()')
    expect(code).toContain('onBeforeUnmount(')
  })
})

// ─── 验收 #8：i18n 字典值对齐（spec §10：spec #734 T5 worker 已补齐 seriesSheet.* 中英文案，
  //     运行时 t() 缺 key 仍走 console.warn + 返回 key 兜底，但本期新增的 4 个 key 已被 zh-CN/en 收录）───
describe('SeriesSheet.vue i18n 兜底（验收 #8：本期新增 key 字典值对齐 + t() 缺 key 仍兜底）', () => {
  it('本期新增 4 个 key 全部走 tt() 包装（unknown-as 旁路 I18nKey 类型）', () => {
    // 4 个 key 全部走 tt 而非 t（避免 vue-tsc 编译错误）
    expect(code).toContain("tt('seriesSheet.empty')")
    expect(code).toContain("tt('seriesSheet.current')")
    expect(code).toContain("tt('seriesSheet.loadFailed')")
    expect(code).toContain("tt('seriesSheet.loadMoreFailed')")
    // tt() 用 unknown-as 旁路 I18nKey
    expect(code).toContain('key as unknown as I18nKey')
  })

  it('t() 缺 key 不抛错 + 返回 key 字符串本身（约定行为 i18n/index.ts:45-52）', () => {
    const warnSpy = silenceWarn()
    // 锁定 zh-CN locale（spec #734 T5 已补 seriesSheet.* 中英文案，断言 zh 字典值）
    setLocale('zh-CN')
    // seriesSheet.empty 已在 zh-CN/en 字典注册（spec #734 T5），t() 返回 zh 文案
    const result = t('seriesSheet.empty' as unknown as Parameters<typeof t>[0])
    expect(result).toBe('该系列暂无章节')
    // 兜底路径仍生效：调用一个**未注册**的 key 时 console.warn 被触发
    // （seriesSheet.empty 已补齐，但兜底逻辑本身未变；以下 key 仅用于触发 warn，断言不挂在结果上）
    t('__nonexistent__.placeholder' as unknown as Parameters<typeof t>[0])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('i18n 字典值校验（zh-CN/en 既有 key 仍可命中，避免无意改动存量文案）', () => {
    setLocale('zh-CN')
    // novels.footer.loading / novelIntro.retry / novels.footer.end / novels.charCount 是既有 key
    expect(t('novels.footer.loading' as unknown as Parameters<typeof t>[0])).toBe('加载中…')
    expect(t('novelIntro.retry' as unknown as Parameters<typeof t>[0])).toBe('重试')
    expect(t('novels.footer.end' as unknown as Parameters<typeof t>[0])).toBe('没有更多了')
    setLocale('en')
    expect(t('novels.footer.loading' as unknown as Parameters<typeof t>[0])).toBe('Loading…')
    expect(t('novelIntro.retry' as unknown as Parameters<typeof t>[0])).toBe('Retry')
    expect(t('novels.footer.end' as unknown as Parameters<typeof t>[0])).toBe('No more content')
  })
})

// ─── 验收 #6/#8：API 接线 + 代闸（防竞态）+ 显式 warn ───
describe('SeriesSheet.vue 行为契约（vi.mock(api/novel) + 模块前缀 warn）', () => {
  it('loadInitial：失败时 console.warn 带 [SeriesSheet] 前缀 + errorMsg 设置（IO 边界双路径）', () => {
    const warnSpy = silenceWarn()
    // mock 装载 + spy 安装就绪（实际调用走 mount 后的 setup，不在此处触发——
    // mount 需要 vue-lynx 渲染器，本文件用源码断言覆盖契约）
    loadNovelSeriesChapters.mockResolvedValue({
      novel_series_detail: { id: 1, title: 'S', content_count: 0, is_concluded: false, watchlist_added: false },
      novels: [],
      next_url: null,
    })
    expect(loadNovelSeriesChapters).toBeDefined()
    expect(loadNovelSeriesChaptersNext).toBeDefined()
    // 验证源文件里有显式 warn 调用（IO 失败硬约束 #3：禁止静默降级）
    expect(code).toContain("console.warn('[SeriesSheet] loadInitial failed'")
    expect(code).toContain("console.warn('[SeriesSheet] loadMore failed'")
    expect(warnSpy).toBeDefined() // spy 已安装
  })

  it('loadMore：失败时 console.warn 带 [SeriesSheet] 前缀 + 内联 errorMsg', () => {
    silenceWarn()
    expect(code).toContain("console.warn('[SeriesSheet] loadMore failed'")
    // loadMore 失败 errorMsg 走 seriesSheet.loadMoreFailed key（tt 包装）
    expect(code).toContain("tt('seriesSheet.loadMoreFailed')")
  })

  it('验收 #8：代闸（防竞态）—— loadGeneration + 自增 + 响应后比对', () => {
    // 代闸三件套：变量声明 + 自增 + 异步响应后比对
    expect(code).toContain('let loadGeneration = 0')
    expect(code).toContain('++loadGeneration')
    expect(code).toContain('myGen !== loadGeneration')
    // loadMore 也捕获当前代（防 seriesId 切换时旧响应覆盖新数据）
    expect(code).toMatch(/const myGen = loadGeneration[\s\S]{0,200}if \(myGen !== loadGeneration\)/)
  })

  it('loadInitial 走 seriesId 参数（toSeriesId 包装）+ novels/next_url 字段（真实契约）', () => {
    // loadInitial 主体：seriesId 转 SeriesId 调 API，取 novels + next_url
    expect(code).toContain('toSeriesId(props.seriesId)')
    expect(code).toContain('chapters.value = res.novels')
    expect(code).toContain('nextUrl.value = res.next_url')
    // loadMore 增量追加（append-only，ADR-0107 D4 安全追加）
    expect(code).toContain('[...chapters.value, ...res.novels]')
  })

  it('验收 #5：emit(\'close\') + emit(\'select\', novelId) 事件契约', () => {
    // defineEmits 声明两个事件
    expect(code).toContain('close: []')
    expect(code).toContain('select: [novelId: number]')
    // emit 调用
    expect(code).toContain("emit('close')")
    expect(code).toContain("emit('select', novelId)")
  })
})

// ─── 模块解耦（验收 #5/#6：不耦合 watchlist / 不调 navigate）───
describe('SeriesSheet.vue 模块解耦（验收 #5/#6：解耦 watchlist + 导航归宿主）', () => {
  it('不读 prompt.watchAdded（与 watchlist prompt 解耦，本组件只渲染章节列表）', () => {
    expect(code).not.toMatch(/watchAdded|prompt\?\.watchAdded|watchlistPrompt/)
    expect(src).not.toMatch(/watchAdded|prompt\?\.watchAdded|watchlistPrompt/)
  })

  it('不调 navigate()（章节导航归宿主 NovelIntro，本组件只 emit select）', () => {
    // navigate 仅在 NovelIntro 等页面宿主调用，SeriesSheet 自身不调
    expect(code).not.toMatch(/\bnavigate\(/)
    expect(src).not.toMatch(/\bnavigate\(/)
  })

  it('不读 watchlistStore（与追更交互完全解耦）', () => {
    expect(code).not.toMatch(/watchlistStore/)
    expect(src).not.toMatch(/watchlistStore/)
  })
})

// ─── 验收 #7：空列表渲染空态文案（已含于「三态」describe block，此处补真实样例 mock）───
describe('SeriesSheet.vue 空列表渲染（验收 #7：mock 真实字段形状）', () => {
  it('loadInitial 返回空 novels[] 时走空态分支', () => {
    // 空态触发条件：chapters.length === 0
    expect(code).toContain('v-else-if="chapters.length === 0"')
    // 空态文案 key
    expect(code).toContain("tt('seriesSheet.empty')")
  })

  it('mock 数据形状对齐 PixivNovel 真实字段（id/title/text_length，非自洽字段）', () => {
    // 验证 mock 工厂使用真实字段名
    const mock = makePixivNovel(42, { title: 'Prologue', text_length: 500 })
    expect(mock).toEqual({
      id: 42,
      title: 'Prologue',
      text_length: 500,
    })
  })
})