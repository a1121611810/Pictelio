// ─── 全局搜索弹层 SearchSheet 模板契约（issue #295 / spec app-lynx-global-search D5） ───
// 仓库无 .vue 组件渲染测试基建（node 环境无 Lynx 渲染器，CommentOverlay 同款无单测先例）——
// 沿用「模板源码断言」约定（ugoiraViewerTemplate / unit.test.ts 同款）：契约由各 store /
// primitive 单测兜底（useSearch.test / searchHistoryStore.test / searchSheetStore.test），
// 本文件只锁**外部行为**（模板绑定 / 事件接线 / 分支渲染标记），不测内部 ref 实现。
// 期望值来源（Oracle 溯源）：
//   - 结构（标题栏/输入行/词条区/scope 段/sort 段/结果区 + 80vh 面板）= spec D5 + 原型变体 A；
//   - 五态交互语义 = spec US14-US17（分页失败保留结果 / 首载错误重试 / 无结果换词）；
//   - 提交点 ×3 = glossary「搜索提交点」（回车 / 点历史词条 / 点结果行）+ spec US20；
//   - R18 行遮罩 = spec US24 + D7（isRestricted 行内遮罩，不预过滤，开关实时联动）；
//   - 文案（标题/占位/历史/scope-sort chips/五态/遮罩提示）= 实现定义（无 spec/原型给定文案），
//     属 T6 文案审校范围；#511 补抽后断言改为「t(key) 调用形态 + zh 字典值逐字节不变」双锚，
//     防无意改动（characterization），不构成设计约束来源；
//   - 首搜骨架 / 空态判定 = ADR-0150（页级首载骨架）+ spec T4 #435（deriveFirstLoadView 派生，
//     loading/isSearching → 骨架；落定且空 → 空态；有旧结果优先 → 内容）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import zhMisc from '../i18n/locales/zh-CN/misc'

const source = readFileSync(fileURLToPath(new URL('./SearchSheet.vue', import.meta.url)), 'utf8')

/** zh 字典值 = 抽取前存量文案逐字快照（渲染产物不变的 oracle；#511 第 2 类补抽约定） */
const LEGACY_ZH: Record<string, string> = {
  'searchSheet.title': '搜索',
  'searchSheet.placeholder': '输入标签 / 关键词',
  'searchSheet.history': '搜索历史',
  'searchSheet.historyEmptyHint': '输入关键词开始搜索',
  'searchSheet.scope.all': '全部',
  'searchSheet.scope.illust': '插画',
  'searchSheet.scope.novel': '小说',
  'searchSheet.sort.newest': '最新',
  'searchSheet.sort.oldest': '最早',
  'searchSheet.sort.popular': '热门',
  'searchSheet.bookmarkDimmedHint': '热门榜不支持按收藏数筛（切回最新/最早恢复）',
  'searchSheet.ratioDimmedHint': '切到「插画」范围后可用（已设的值会保留）',
  'searchSheet.searchFailed': '搜索失败，请重试',
  'searchSheet.searching': '搜索中…',
  'searchSheet.emptyHint': '没有找到相关内容，试试换一个关键词',
  'searchSheet.rowAction': '查看 ›',
  'searchSheet.loadMoreFailed': '加载更多失败',
  'searchSheet.noMore': '没有更多了',
}

describe('SearchSheet 文案 i18n 抽取（#511 第 2 类：zh 渲染产物逐字节不变）', () => {
  it('zh 字典值 = 存量文案逐字快照（迁移期禁改写）', () => {
    for (const [key, legacy] of Object.entries(LEGACY_ZH)) {
      expect(zhMisc[key as keyof typeof zhMisc], key).toBe(legacy)
    }
  })

  it('遮罩行复用 RestrictOverlay / AiOverlay 域 key（zh 值逐字一致）', () => {
    expect(zhMisc['restrictOverlay.blocked']).toBe('受浏览限制，不予显示')
    expect(zhMisc['aiOverlay.maskHint']).toBe('AI 作品，已在设置中遮罩')
    expect(zhMisc['aiOverlay.pure']).toBe('AI')
    expect(zhMisc['aiOverlay.assisted']).toBe('AI辅助')
  })
})

describe('SearchSheet 弹层结构（spec D5 / 原型变体 A）', () => {
  it('整体：遮罩 @tap 关闭 + 80vh 面板 @tap.stop + 根 view absolute inset-0 z-40（离流锚 page 根；盖 GlobalFab/页面 z-30 分页 FAB，review P1-1）', () => {
    expect(source).toContain('class="absolute inset-0 z-40"')
    expect(source).toContain('class="absolute inset-0 bg-scrim" @tap="onClose"')
    expect(source).toContain('h-[80vh]')
    expect(source).toContain('@tap.stop')
  })

  it('标题栏「搜索」+ × 关闭；输入行占位「输入标签 / 关键词」+ 有词清除 ×', () => {
    expect(source).toContain(">{{ t('searchSheet.title') }}</text>")
    expect(source).toContain(`:placeholder="t('searchSheet.placeholder')"`)
    expect(source).toContain('@tap="onClose"') // × 关闭走统一关闭路径
    expect(source).toContain('@tap="onClearInput"')
  })

  it('词条区（idle 且无词）：历史 chips 单删 + 清空入口；无历史提示「输入关键词开始搜索」', () => {
    expect(source).toContain('v-if="!keyword.trim()"')
    expect(source).toContain(">{{ t('searchSheet.history') }}</text>")
    expect(source).toContain('@tap="onHistoryTap(w)"') // 历史词条点选（提交点②）
    expect(source).toContain('@tap.stop="onHistoryRemove(w)"') // 单删 ×
    expect(source).toContain('@tap="onClearHistory"') // 全清
    expect(source).toContain("t('searchSheet.historyEmptyHint')")
  })

  it('scope 段（全部/插画/小说）与 sort 段（最新/最早/热门）', () => {
    expect(source).toContain(">{{ t('searchSheet.scope.all') }}</text>")
    expect(source).toContain(">{{ t('searchSheet.scope.illust') }}</text>")
    expect(source).toContain(">{{ t('searchSheet.scope.novel') }}</text>")
    expect(source).toContain(">{{ t('searchSheet.sort.newest') }}</text>")
    expect(source).toContain(">{{ t('searchSheet.sort.oldest') }}</text>")
    expect(source).toContain(">{{ t('searchSheet.sort.popular') }}</text>")
  })

  it('预填词（ADR-0133 决策 2）：onMounted 一次性消费并走 controller.search（不写历史）', () => {
    // 消费入口：consumePrefillKeyword 读取即清（store 单测覆盖消费语义）
    expect(source).toContain('consumePrefillKeyword()')
    const onMountedFn = /onMounted\(\(\) => \{[\s\S]*?\n\}\)/.exec(source)
    expect(onMountedFn).not.toBeNull()
    expect(onMountedFn![0]).toContain('consumePrefillKeyword()')
    expect(onMountedFn![0]).toContain('controller.search(prefill)')
    // 预填路径不写历史：消费分支内不得出现 addHistory（提交点仅三处，glossary「搜索提交点」）
    const prefillBranch = onMountedFn![0].slice(onMountedFn![0].indexOf('prefill'))
    expect(prefillBranch).not.toContain('addHistory')
  })
})

describe('SearchSheet 五态渲染分支（spec D5 / US14-US17）', () => {
  it('搜索中：顶部轻量指示「搜索中…」（debounce 窗口 isSearching + loading，保留旧结果不闪空白）', () => {
    expect(source).toContain("t('searchSheet.searching')")
    expect(source).toContain("state.isSearching || state.status === 'loading'")
  })

  it('首载错误：关键词保留 + 错误文案 + 重试按钮（controller.refresh）', () => {
    expect(source).toMatch(/v-if="[^"]*'error'/)
    expect(source).toContain("state.error ?? t('searchSheet.searchFailed')")
    expect(source).toContain('@tap="onRetry"')
    // onRetry → refresh（错误态重试，useSearch.refresh 仅 error 态生效）
    const onRetryFn = /function onRetry\(\): void \{[\s\S]*?\n\}/.exec(source)
    expect(onRetryFn).not.toBeNull()
    expect(onRetryFn![0]).toContain('controller.refresh()')
  })

  it('首搜骨架：无旧结果可保留时显示结果行骨架（取代纯「搜索中…」文字）', () => {
    // ADR-0150 / spec T4 #435：首搜（results 空 ∧ loading/isSearching）→ 骨架
    expect(source).toMatch(/v-if="[^"]*'skeleton'/)
    expect(source).toContain('deriveFirstLoadView({')
  })

  it('无结果：换词提示（落定且空结果，不合并「未搜索」与「无结果」）', () => {
    // ADR-0150：空态由三态纯函数派生（settled=ready ∧ 无结果 ∧ 非加载中）
    expect(source).toMatch(/v-if="[^"]*'empty'/)
    expect(source).toContain("t('searchSheet.emptyHint')")
    expect(source).toContain("import { deriveFirstLoadView } from '../utils/firstLoadView'")
  })

  it('结果列表：行式（缩略图 + 标题 + 作者 · 类型/字数）+ 查看指示；item-key String（ADR-0055/0056）', () => {
    expect(source).toContain('v-else-if="visibleResults.length > 0"') // AI 仅看态过滤后的可见集（ADR-0155）
    expect(source).toContain('list-type="single"')
    expect(source).toContain(':item-key="rowKey(row)"')
    expect(source).toContain('row.entity.user.name }} · {{ rowSub(row)')
    expect(source).toContain('{{ rowSub(row) }}') // 类型/字数（novel=`${text_length} 字`）
    expect(source).toContain("t('searchSheet.rowAction')")
    // String 前缀：type-{id} 防插画/小说 id 撞 key
    expect(source).toContain('`${row.type}-${row.entity.id}`')
    expect(source).toContain("return `${row.type}-${row.entity.id}`")
  })

  it('分页失败：保留结果 + 底部内联重试行（paginationError + loadMore 重试）', () => {
    expect(source).toContain('v-if="state.paginationError"')
    expect(source).toContain("t('searchSheet.loadMoreFailed')")
    // 内联重试行绑定 onLoadMore（重试 = 再次 loadMore，next_url 未推进故可重试）
    const footerFn = /@tap="onLoadMore"/g
    expect(source.match(footerFn)).not.toBeNull()
    expect(source).toContain('controller.loadMore()')
  })

  it('没有更多了 footer（hasMore=false；spec US14）', () => {
    expect(source).toContain('v-else-if="!state.hasMore"')
    expect(source).toContain(">{{ t('searchSheet.noMore') }}</text>")
  })
})

describe('SearchSheet 提交点 ×3 写历史（glossary「搜索提交点」/ spec US20）', () => {
  it('提交点① 回车：@confirm（lynx confirm = soft keyboard 确认键/硬件 Enter，web-core submit 事件映射）→ addHistory', () => {
    expect(source).toContain('@confirm="onConfirm"')
    const fn = /function onConfirm\(\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain('addHistory(keyword.value)')
  })

  it('提交点② 点历史词条：设 keyword + addHistory + controller.search（即搜不 debounce）', () => {
    const fn = /function onHistoryTap\(word: string\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain('keyword.value = word')
    expect(fn![0]).toContain('addHistory(word)')
    expect(fn![0]).toContain('controller.search(word)')
  })

  it('提交点③ 点结果行：addHistory + closeSearch + navigate 详情（插画 /illust/、小说 /novel/）', () => {
    const fn = /function onResultTap\(row: SearchResultItem\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain('addHistory(keyword.value)')
    expect(fn![0]).toContain('closeSearch()')
    expect(fn![0]).toContain("`/novel/${row.entity.id}`")
    expect(fn![0]).toContain("`/illust/${row.entity.id}`")
  })

  it('输入中间态不写历史（无 watch(keyword) 自动写入；历史唯一写者 = 三个提交点函数）', () => {
    expect(source).not.toContain('watch(keyword')
    // onInput 不写历史（只 controller.search）
    const fn = /function onInput\(data: LynxInputEvent\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).not.toContain('addHistory')
  })
})

describe('SearchSheet 数据流与生命周期', () => {
  it('输入 @input → controller.search（debounce 在控制器内层，spec D2；组件单向只调用）', () => {
    expect(source).toContain('@input="onInput"')
    const fn = /function onInput\(data: LynxInputEvent\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain('controller.search(keyword.value)')
    // debounce 300ms 语义属 useSearch 测试域（useSearch.test.ts），此处不重复锁定
  })

  it('IME 组合态过滤：isComposing 时不搜（组合结束的 lynxinput 事件 isComposing=false 再搜）', () => {
    expect(source).toContain('data?.detail?.isComposing')
  })

  it('scope/sort tap → controller.setScope / setSort（关键词存在时 controller 内部重搜）', () => {
    expect(source).toContain("onScopeTap('all')")
    expect(source).toContain("onScopeTap('illust')")
    expect(source).toContain("onScopeTap('novel')")
    expect(source).toContain("onSortTap('date_desc')")
    expect(source).toContain("onSortTap('date_asc')")
    expect(source).toContain("onSortTap('popular_desc')")
    expect(source).toContain('controller.setScope(scope)')
    expect(source).toContain('controller.setSort(sort)')
  })

  it('滚动到底 @scrolltolower → controller.loadMore（自动分页，spec US14）', () => {
    expect(source).toContain('@scrolltolower="onLoadMore"')
    expect(source).toContain('void controller.loadMore()')
  })

  it('关闭：遮罩 / × 统一 @tap="onClose" → closeSearch()（返回键由 searchSheetStore 注册的 modalStack 承担）', () => {
    expect(source).toContain('@tap="onClose"')
    const fn = /function onClose\(\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain('closeSearch()')
    // 弹层不重复注册返回键（D4：searchSheetStore.openSearch 已注册）——防双注册
    // （语义化断言：注册行为 = 出现 registerModal 字样，风格无关）
    expect(source).not.toContain('registerModal')
  })

  it('onMounted → loadHistory（历史 chips）+ 自动聚焦；onBeforeUnmount → controller.dispose()', () => {
    expect(source).toContain('onMounted(() => {')
    expect(source).toContain('void searchHistory.loadHistory()')
    expect(source).toContain('inputRef.value?.focus?.()')
    expect(source).toContain('onBeforeUnmount(() => {')
    expect(source).toContain('controller.dispose()')
  })
})

describe('SearchSheet R18/R18G 行遮罩（spec US24 / D7：不预过滤，isRestricted 实时联动）', () => {
  it('缩略图遮罩：scrim 底 + R-18/R-18G 徽章（等效行内 RestrictOverlay 缩放）', () => {
    expect(source).toContain('isRestricted(row.entity)')
    expect(source).toContain('bg-scrim flex items-center justify-center')
    expect(source).toContain("'R-18G' : 'R-18'")
    expect(source).toContain('restrictLevel(row)')
    expect(source).toContain('row.entity.x_restrict === 2 ? 2 : 1')
  })

  it('标题区遮蔽：scrim 条 + 「受浏览限制，不予显示」；作者行照常', () => {
    expect(source).toContain("t('restrictOverlay.blocked')")
    expect(source).toContain('h-[4.267vw] bg-scrim')
  })

  it('非受限行照常渲染缩略图（SkeletonImage lite 模式）+ 标题 + 作者 · 类型/字数', () => {
    expect(source).toContain('v-if="!isRowMasked(row)"')
    expect(source).toContain('<SkeletonImage')
    expect(source).toContain(':src="rowThumb(row)"')
  })
})

describe('SearchSheet AI 三态行遮罩（ADR-0155：mask 行内遮罩 / only 过滤）', () => {
  it('遮罩谓词合并 R18 与 AI（R18 优先；AI 段=有效模式注入，#479 面板覆盖）', () => {
    expect(source).toContain('function isRowMasked(row: SearchResultItem): boolean {')
    expect(source).toContain('isRestricted(row.entity) ||')
    expect(source).toContain("effectiveAiMode.value === 'mask' && settings.isAiWork(row.entity)")
  })

  it('AI 徽章：纯 AI=AI / 辅助=AI辅助，走 secondary-container 语义色', () => {
    expect(source).toContain("aiLevel(row) === 2 ? t('aiOverlay.pure') : t('aiOverlay.assisted')")
    expect(source).toContain("'bg-secondary-container text-secondary-on-container'")
  })

  it('AI 行文案 + 有效模式过滤（visibleResults：follow=账号设置 / only=移除非 AI；#479 覆盖经 resolveAiMode）', () => {
    expect(source).toContain("t('aiOverlay.maskHint')")
    expect(source).toContain('resolveAiMode(settings.aiFilterMode, state.value.filters.aiOverride)')
    expect(source).toContain("effectiveAiMode.value === 'only'")
    expect(source).toContain('v-for="row in visibleResults"')
  })
})

describe('SearchSheet 筛选折叠区（#474/#477：SearchSheet 内折叠筛选区，默认折叠）', () => {
  it('开关：激活数徽标 + a11y 标签 + 字符 chevron', () => {
    expect(source).toContain('v-if="filterOpen"')
    expect(source).toContain("filterOpen = !filterOpen")
    expect(source).toContain('SEARCH_A11Y_LABELS.filterToggle')
    expect(source).toContain('{{ activeFilterCount }}')
  })

  it('维度齐全：期间预设/收藏数七档/比例/分辨率/AI 覆盖 + 清除全部（仅激活时）', () => {
    expect(source).toContain('v-for="p in PERIOD_PRESETS"')
    expect(source).toContain('v-for="band in BOOKMARK_BANDS"')
    expect(source).toContain("v-for=\"r in ['landscape', 'portrait', 'square']\"")
    expect(source).toContain('v-for="px in RES_OPTIONS"')
    expect(source).toContain('v-for="opt in AI_OPTIONS"')
    expect(source).toContain('v-if="activeFilterCount > 0"')
    expect(source).toContain('@tap="clearAllFilters"')
  })

  it('置灰联动：scope=novel 比例/分辨率置灰不清值；热门下收藏数置灰（#476 Q4/#478）', () => {
    expect(source).toContain('illustDimmed')
    expect(source).toContain('bookmarkDimmed')
    expect(source).toContain("t('searchSheet.bookmarkDimmedHint')")
    expect(source).toContain("t('searchSheet.ratioDimmedHint')")
  })

  it('变更入口走 controller.setFilters（450ms debounce 在控制器内层，spec §5.2）', () => {
    expect(source).toContain('function onFilterChange(next: SearchFilters): void {')
    expect(source).toContain('controller.setFilters(next)')
  })
})
