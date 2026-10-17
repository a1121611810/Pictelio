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
import enMisc from '../i18n/locales/en/misc'

const source = readFileSync(fileURLToPath(new URL('./SearchSheet.vue', import.meta.url)), 'utf8')

/**
 * 剥掉源码注释，只留可渲染 / 可执行文本（逐字符挖空但保留换行 ⇒ 行号不变）。
 *
 * 「数某字面量出现几次」型断言**必须**先过这道：`SearchSheet.vue` 的 setup 注释里逐字抄了
 * `v-if="state.scope !== 'user'"`（解释「开关行 / 面板本体各带一道」）。不剥就把注释算进去，
 * 断言两向都不可信——删掉真门控照样绿（假绿），删掉注释反倒假红（脆到改个注释就红）。
 * 覆盖三种注释：HTML 模板注释（尖括号包裹的注释记号）、JS 块注释、JS 行注释；
 * `//` 前为 `:` 时跳过（不吃 URL 的 `://`）。
 * 已知边界：本文件无 URL 字面量与字符串内的 `//`，故不做字符串感知。
 */
function stripComments(src: string): string {
  const blank = (from: number, to: number): string => src.slice(from, to).replace(/[^\n]/g, ' ')
  let out = ''
  let i = 0
  for (;;) {
    const line = src.indexOf('//', i)
    if (line >= 0 && src[line - 1] === ':') {
      out += src.slice(i, line + 2) // URL 的 `://` 不是注释
      i = line + 2
      continue
    }
    const block = src.indexOf('/*', i)
    const html = src.indexOf('<!--', i)
    const starts = [line, block, html].filter((p) => p >= 0)
    if (starts.length === 0) break
    const at = Math.min(...starts)
    let end: number
    if (at === html) {
      const close = src.indexOf('-->', at + 4)
      end = close < 0 ? src.length : close + 3
    } else if (at === block) {
      const close = src.indexOf('*/', at + 2)
      end = close < 0 ? src.length : close + 2
    } else {
      const nl = src.indexOf('\n', at)
      end = nl < 0 ? src.length : nl
    }
    out += src.slice(i, at) + blank(at, end)
    i = end
  }
  return out + src.slice(i)
}

/** 剥注释后的模板文本：本文件所有「数出现次数」型断言的输入（见 stripComments 说明） */
const template = stripComments(source)

/** zh 字典值 = 抽取前存量文案逐字快照（渲染产物不变的 oracle；#511 第 2 类补抽约定） */
const LEGACY_ZH: Record<string, string> = {
  'searchSheet.title': '搜索',
  'searchSheet.placeholder': '输入标签 / 关键词',
  'searchSheet.history': '搜索历史',
  'searchSheet.historyEmptyHint': '输入关键词开始搜索',
  'searchSheet.scope.all': '全部',
  'searchSheet.scope.illust': '插画',
  'searchSheet.scope.novel': '小说',
  'searchSheet.scope.user': '用户',
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
  it('整体：弹层壳收口 BottomSheet（ADR-0194 D5/D6，壳类串单点锁在 BottomSheet.template.test.ts）+ 根 view absolute inset-0 z-40（离流锚 page 根；盖 GlobalFab/页面 z-30 分页 FAB，review P1-1）', () => {
    expect(source).toContain('class="absolute inset-0 z-40"')
    expect(source).toContain('<BottomSheet')
    expect(source).toContain(':close-accessibility-label="SEARCH_A11Y_LABELS.close"')
    expect(source).toContain('@close="onClose"')
  })

  it('标题栏「搜索」+ × 关闭；输入行占位「输入标签 / 关键词」+ 有词清除 ×', () => {
    expect(source).toContain(`:title="t('searchSheet.title')"`) // 标题文案经 prop 注入 BottomSheet
    expect(source).toContain(`:placeholder="t('searchSheet.placeholder')"`)
    expect(source).toContain('@close="onClose"') // scrim/× 关闭统一经 BottomSheet @close
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

  it('提交点③ 点结果行：addHistory + closeSearch + 导航详情（插画 /illust/ 直达；小说经 openNovel 缝隙，介绍页先行可经设置关闭，ADR-0183）', () => {
    const fn = /function onResultTap\(row: SearchResultItem\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain('addHistory(keyword.value)')
    expect(fn![0]).toContain('closeSearch()')
    // 小说分支走导航缝隙（开关决定 intro / 正文落点）；/intro 串禁止内联回流
    expect(fn![0]).toContain('openNovel(row.entity.id)')
    expect(fn![0]).not.toContain('/intro')
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

  it('关闭：scrim/× 统一 BottomSheet @close="onClose" → 两段式退场后 closeSearch()（返回键由 searchSheetStore 注册的 modalStack 承担）', () => {
    expect(source).toContain('@close="onClose"')
    // ⚠️ #878：onClose 不再直接 closeSearch()——先进 exit 相位播退场动画，
    //    计时器（与退场动画同源、减弱动效开启时归零）到点才真正 closeSearch。
    //    Lynx 无 transitionend，退场无法事件驱动，只能显式建模（ADR-0211 决策 3）。
    const fn = /function onClose\(\): void \{[\s\S]*?\n\}/.exec(source)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain('dismiss.requestClose()')
    // closeSearch 收敛在状态机的终态回调里（唯一一处），不在 tap 处理器里
    const machine = /useSheetDismiss\(\{[\s\S]*?\}\)/.exec(source)
    expect(machine, '未接两段式退场状态机').not.toBeNull()
    expect(machine![0]).toContain('onDismissed: () => searchSheet.closeSearch()')
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
  it('开关：激活数徽标 + a11y 标签 + chevron 图标（⌄/⌃ → AppIcon expand_more / expand_less，ADR-0208 决策 3）', () => {
    // 面板门控带 scope 条件（scope=user 隐藏，见「用户搜索范围」块），故不锁逐字相等
    expect(source).toMatch(/<scroll-view\s+v-if="filterOpen/)
    expect(source).toContain("filterOpen = !filterOpen")
    expect(source).toContain('SEARCH_A11Y_LABELS.filterToggle')
    expect(source).toContain('{{ activeFilterCount }}')
    // chevron 渲染位：图标名 + 与存量 text-label-medium 同口径字号（24rpx = 12sp = 3.2vw）
    expect(source).toContain(":name=\"filterOpen ? 'expand_less' : 'expand_more'\"")
    expect(source).toContain(':size="3.2"')
    expect(source).toMatch(/import AppIcon from '\.\/AppIcon\.vue'/)
    // 负向：旧裸字符 ternary 零残留
    expect(source).not.toContain("filterOpen ? '⌃' : '⌄'")
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

// ─── 搜索范围「用户」（issue #1019-#1022 / spec docs/specs/search-user-scope.md §5.4）───
// 这些是 spec 给出的**行为契约**，此前只有实现没有任何断言（code-review Spec 轴 BLOCK-1/BLOCK-2）。
// 本仓无 .vue 渲染测试基建，故沿用本文件既有的模板源码断言形态。oracle = spec §3.2/§5.4 条款原文。
describe('SearchSheet 用户搜索范围（spec search-user-scope §5.4）', () => {
  it('scope 段静态写出第 4 档「用户」（沿用本文件既有的静态 chip 约定，禁 v-for）', () => {
    expect(source).toContain("@tap=\"onScopeTap('user')\"")
    expect(source).toContain(">{{ t('searchSheet.scope.user') }}</text>")
    // 三档既有 chip 仍在（静态断言，防重构时被 v-for 收编）
    expect(source).toContain(">{{ t('searchSheet.scope.illust') }}</text>")
    expect(source).toContain(">{{ t('searchSheet.scope.novel') }}</text>")
  })

  it('头像只取 medium（spec §3.2 实测：该响应 profile_image_urls 只有 medium 一个键）', () => {
    // 只看 userAvatar 函数体：文件头注释里「不写 px_170x170 回退」这句会污染全文正则
    const avatarFn = source.match(/function userAvatar\([\s\S]*?\n\}/)?.[0] ?? ''
    expect(avatarFn).toContain('profile_image_urls.medium')
    // 无 px_170x170 / px_50x50 / px_16x16 回退——实测键不存在，写了也是永不命中的死分支
    expect(avatarFn).not.toMatch(/px_/)
  })

  it('R18 预览项不渲染图：scrim 占位包住 SkeletonImage（spec §5.4 安全承诺）', () => {
    expect(source).toContain('function isPreviewRestricted(item: PixivIllust | PixivNovel): boolean {')
    expect(source).toContain('return item.x_restrict > 0')
    expect(source).toContain("isPreviewRestricted(item) ? 'bg-scrim'")
    expect(source).toContain('v-if="!isPreviewRestricted(item)"')
  })

  it('预览缩略图：illusts 优先补 novels、截断到 USER_PREVIEW_MAX', () => {
    expect(source).toContain('const USER_PREVIEW_MAX = 3')
    expect(source).toContain('[...entity.illusts, ...(entity.novels ?? [])].slice(0, USER_PREVIEW_MAX)')
  })

  it('scope=user 隐藏 sort 段与筛选折叠区（sort 用户端点实测完全忽略；折叠区里的 target 档**必须不发**——端点枚举校验、任何取值皆 400）', () => {
    // 三道门控：sort 段 / 折叠**开关行** / 折叠**面板本体**。
    // ⚠️ 数出现次数前**必须先剥注释**（template = stripComments(source)）：SearchSheet.vue 的
    // setup 注释里逐字抄了同一段 v-if 字面量（解释「开关行 / 面板本体各带一道」）。按原文数会
    // 被这句注释凑到 3——删掉真门控照样绿（假绿），删掉注释反倒假红（脆到改注释就红），两向都假。
    // 剥注释后该字面量的真实命中 = **2**（sort 段 + 折叠开关行）；面板本体那道是**另一段字符串**
    // （与 filterOpen 成对），另有独立断言。
    const GATE_RE = /v-if="state\.scope !== 'user'"/g

    /** 该标记之前有几道 GATE 门控（标记本身不存在会先在这里证伪） */
    const gatesBefore = (marker: string): number => {
      const at = template.indexOf(marker)
      expect(at, `模板中未找到标记：${marker}`).toBeGreaterThan(-1)
      return template.slice(0, at).match(GATE_RE)?.length ?? 0
    }

    // ① sort 段：三枚 chip 都落在**第 1 道**门控之后、第 2 道之前（= 只被 sort 段那道罩住）。
    //    定位到「谁被哪道罩住」而非只比总数：总数断了只说得出「少了一个」，说不出少的是哪个。
    for (const chip of ['newest', 'oldest', 'popular']) {
      expect(
        gatesBefore(`t('searchSheet.sort.${chip}')`),
        `sort 段 ${chip} chip 未被第 1 道 scope=user 门控罩住`,
      ).toBe(1)
    }
    // sort chip 本体（另两个 scope 仍要用）必须在
    expect(template).toContain(">{{ t('searchSheet.sort.popular') }}</text>")

    // ② 折叠**开关行**：开关本体（a11y 标签 + 翻转 tap）落在**第 2 道**门控之后。
    for (const marker of ['SEARCH_A11Y_LABELS.filterToggle', '@tap="filterOpen = !filterOpen"']) {
      expect(
        gatesBefore(marker),
        `折叠开关行（${marker}）未被第 2 道 scope=user 门控罩住`,
      ).toBe(2)
    }

    // ③ 折叠**面板本体**不可见：门控与 filterOpen 成对。⚠️ 这条不能只靠 watch 收 filterOpen——
    // 删掉那个 watch 测试照样全绿（源码断言数不到 watch 里的状态回写），而 scope=user 下
    // 会露出一块没有入口的悬空面板。面板本体自带 v-if ⇒ 可见性不依赖任何状态回写。
    // （2026-10-17 补记：watch 那道第二重保险此前**确实零断言**——上面这句说的就是当时的实情，
    //   属历史留痕保留；该缺口已由紧随其后的一条独立 it 补上机器防线。）
    expect(template, '折叠面板本体未带 scope 门控').toMatch(
      /<scroll-view\s+v-if="filterOpen && state\.scope !== 'user'"/,
    )

    // 护栏（放最后：上面三条各自报错才指出「哪道门控」坏了，这条只兜「总数悄悄变了」——
    // 新增第三道 / 挪动位置时逼人重看上面三条的归属，不让总数悄悄通过）。
    expect(
      template.match(GATE_RE) ?? [],
      '剥注释后应恰好 2 道门控：sort 段 + 折叠开关行',
    ).toHaveLength(2)
  })

  // ── 第二重保险的独立防线（此前为零）──
  // SearchSheet.vue 里 `watch(() => state.value.scope)` 在切到 user 时收 filterOpen=false：
  // 切回别的档时不会莫名展开。上一条 it 的模板门控锁的是「v-if 出现次数」，**数不到 watch 里的
  // 状态回写** ⇒ 删掉整个 watch，上一条照样全绿。组件注释对此诚实写明了缺口，
  // 但诚实不等于有防线（此即补这条的原因）。
  it('第二重保险仍在位：watch(scope) 切到 user 时收 false（切回来不会莫名展开）', () => {
    // 取剥注释后的源码（template）：组件注释逐字抄过 v-if 字面量，不剥会让注释满足断言
    const scopeWatch = /watch\(\s*\(\) => state\.value\.scope[\s\S]*?\n\)/.exec(template)
    expect(scopeWatch, '未找到 watch(() => state.value.scope) —— 第二重保险被删或改了形').not.toBeNull()
    // 作用域到 watch 调用体：只锁「文件里有这句」的话，他处出现同形文本即退化成恒真断言
    // （文件内另有一道 watch(() => state.value.status)，故定位必须带 state.value.scope 锚）
    expect(scopeWatch![0]).toMatch(/if \(scope === 'user'\) filterOpen\.value = false/)
  })

  it('用户行点按跳作者主页且不进 heroTransition（无插画 id 可测矩形）', () => {
    expect(source).toContain('void navigate(`/user/${row.entity.user.id}`)')
    // heroTransition.begin 仍在同一分支之后的内容行路径上（未把用户行也接进转场）
    expect(source).toContain('heroTransition.begin(row.entity.id)')
  })

  it('用户行跳过 AI 遮罩与标签静音过滤（PixivUserPreview 无 illust_ai_type / tags）', () => {
    expect(source).toContain("if (r.type === 'user') return true")
  })

  it('两条渲染降级路径都经 warnRenderFallback，且告警查 proxyImageUrl 的返回值', () => {
    // 查返回值而非入参：非信任域绝对 URL 被 proxyImageUrl 拒载返回空串，只查入参会静默变空白
    expect(source).toContain('const url = proxyImageUrl(entity.user.profile_image_urls.medium')
    expect(source).toContain('if (!url) warnRenderFallback(`avatar-')
    expect(source).toContain('if (!url) warnRenderFallback(`preview-')
  })

  it('渲染降级告警去重集存在（同一 key 只报一次，防列表重渲染刷屏）', () => {
    expect(source).toContain('const warnedRenderFallbacks = new Set<string>()')
    expect(source).toContain('if (warnedRenderFallbacks.has(key)) return')
  })
})

// ─── 匹配方式 + 查询语法提示（issue #1027 / spec docs/specs/search-target-mode.md §7）───
// oracle = spec §7.1（形态、置灰、置灰原因提示行）/ §7.2（行位、门控、文案与文案纪律）。
// ⚠️ 锚点只引**小节号**、不引行号：本仓并行改该 spec 频率高，行号锚必然漂移且无声。
// 档位→请求参数映射与缓存键在 search-core（#1025 落地），本文件只锁组件侧接线。
describe('SearchSheet 匹配方式行（spec search-target-mode §7.1）', () => {
  it('置于筛选折叠区第一行：标题 + 三档 chip，且排在「期间」之前', () => {
    expect(source).toContain("t('searchSheet.targetTitle')")
    expect(source).toContain('v-for="opt in TARGET_OPTIONS"')
    expect(source).toContain('filters.target === opt.value')
    // 行位：目标行起点 < 期间行起点（清除全部行是维度之上的操作条，不参与此序比较）
    const targetRow = source.indexOf("t('searchSheet.targetTitle')")
    const periodRow = source.indexOf("t('searchSheet.periodTitle')")
    expect(targetRow).toBeGreaterThan(-1)
    expect(periodRow).toBeGreaterThan(targetRow)
  })

  it('三枚 chip 的档位值与 t() key 齐备（partial / exact / title_and_caption，spec §3.1 联合类型）', () => {
    const options = /const TARGET_OPTIONS[^=]*=\s*\[[\s\S]*?\n\]/.exec(source)
    expect(options).not.toBeNull()
    expect(options![0]).toContain("value: 'partial'")
    expect(options![0]).toContain("value: 'exact'")
    expect(options![0]).toContain("value: 'title_and_caption'")
    expect(options![0]).toContain("labelKey: 'searchSheet.target.partial'")
    expect(options![0]).toContain("labelKey: 'searchSheet.target.exact'")
    expect(options![0]).toContain("labelKey: 'searchSheet.target.titleAndCaption'")
    // 档位类型取自 search-core 单点事实源，不在组件里就地重声明联合类型
    expect(source).toContain('type SearchTargetMode')
    expect(source).toContain("from '@pictelio/search-core'")
  })

  it('scope=novel 时 title 档置灰且点击无效：门控复用 illustDimmed，另两档不置灰', () => {
    // 小说端点不识别 title_and_caption（spec §4/§7.1）⇒ 仅该档 novelDisabled
    const options = /const TARGET_OPTIONS[^=]*=\s*\[[\s\S]*?\n\]/.exec(source)
    expect(options![0]).toContain('novelDisabled: true')
    expect(options![0].match(/novelDisabled: false/g)).toHaveLength(2)
    // 门控与比例/分辨率同款（illustDimmed = scope === 'novel'）
    expect(source).toContain("const illustDimmed = computed(() => state.value.scope === 'novel')")
    expect(source).toContain('return opt.novelDisabled && illustDimmed.value')
    // 点击被短路
    expect(source).toContain('@tap="!isTargetDisabled(opt) && setTarget(opt.value)"')
    // 接线断言**作用域到 setTarget 函数体**：全文 toContain 只锁「文件里有这句」，
    // 锁不住「是 setTarget 在用它」——他处出现同形调用时它就退化成恒真断言。
    const setTargetFn = /function setTarget\(v: SearchTargetMode\): void \{[\s\S]*?\n\}/.exec(source)
    expect(setTargetFn).not.toBeNull()
    expect(setTargetFn![0]).toContain('onFilterChange({ ...filters.value, target: v })')
  })

  it('置灰不清值：isTargetDisabled 只读不写（值保留，切回插画恢复，spec §7.1）', () => {
    const gate = /function isTargetDisabled\([\s\S]*?\n\}/.exec(source)
    expect(gate).not.toBeNull()
    // 门控函数体内不得出现对 target 的赋值/复位
    expect(gate![0]).not.toContain('target:')
    // 且组件内不存在「scope 变 novel 就把 target 打回 partial」的分支
    expect(source).not.toContain("target: 'partial'")
  })

  it('scope=novel 时 chips 下方给置灰原因提示行（spec §7.1：解释置灰 + 保值）', () => {
    // key 必须真的接进模板——字典里有值、模板里没引用 = 死 key，此前零断言
    expect(source, 'targetDimmedHint 未接进模板').toContain(
      "t('searchSheet.targetDimmedHint')",
    )
    // 门控与第三枚 chip 同一条件（illustDimmed），非独立判定；
    // 同为 illustDimmed 门控的还有 ratioDimmedHint 一行，故正则必须带上本 key 才不串味
    const hint =
      /<text v-if="illustDimmed"[^>]*>\s*\{\{ t\('searchSheet\.targetDimmedHint'\) \}\}/.exec(source)
    expect(hint, '置灰提示行未与第三枚 chip 共用 illustDimmed 门控').not.toBeNull()
    // zh/en 两侧都有值（缺一侧 = 语言切换即露空行）
    expect(zhMisc['searchSheet.targetDimmedHint']).toBeTruthy()
    expect(enMisc['searchSheet.targetDimmedHint']).toBeTruthy()
  })
  // ⚠️ 曾在这里多一条「筛选变更走 controller.setFilters」的 it：两行断言与上方
  // 「#474/#477 筛选折叠区」块的既有 it 逐字重复（同义反复，Standards A4）；且它只断
  // 「onFilterChange 存在 + 它调 controller.setFilters」——实测把 setTarget 改成直调
  // controller.setFilters 绕开单入口，这两条**照样绿**，即它防不住任何回归。
  // target 接线的真实防线是上面「scope=novel 时 title 档置灰」块里那条
  // （已改为作用域到 setTarget 函数体）。
})

describe('SearchSheet 查询语法提示行（spec search-target-mode §7.2）', () => {
  it('置于输入框正下方：紧跟输入行 view、词条区之前', () => {
    const inputRow = source.indexOf('@confirm="onConfirm"')
    const hintRow = source.indexOf("t('searchSheet.querySyntaxHint')")
    const historyBlock = source.indexOf('v-if="!keyword.trim()"')
    expect(hintRow).toBeGreaterThan(inputRow)
    expect(historyBlock).toBeGreaterThan(hintRow)
  })

  it('仅 keyword.trim() 非空时显示（idle 态不占位），且不改写输入值', () => {
    const hint = /<view v-if="keyword\.trim\(\)" class="px-4 mt-1 flex-shrink-0">[\s\S]*?<\/view>/.exec(
      source,
    )
    expect(hint, '未找到绑定 keyword.trim() 的提示行容器').not.toBeNull()
    expect(hint![0]).toContain("t('searchSheet.querySyntaxHint')")
    expect(hint![0]).toContain('text-label-small text-outline')
    // 只提示：不校验、不拦截——提示行内不得出现任何对 keyword 的写入
    expect(hint![0]).not.toContain('keyword =')
    expect(hint![0]).not.toContain('keyword.value =')
  })

  it('文案含 spec §7.2 四项语法；且不承诺「大小写无关」（§7.2 文案纪律）', () => {
    const zh = zhMisc['searchSheet.querySyntaxHint']
    // oracle = spec §7.2 给定原文的四个语法项：空格=与 / -排除 / OR=或 / ( )
    expect(zh).toContain('空格=与')
    expect(zh).toContain('-排除')
    expect(zh).toContain('OR=或')
    expect(zh).toContain('( )')
    // 文案纪律（spec §7.2）：实测 exact_match_for_tags 档大小写敏感（RoSeMaRy → 0 条），
    // 而本票默认档 partial 大小写无关；两者并存时措辞须避免绝对化。
    // 这两条是**独立防线**：断言只查片段，不先用 toBe 把全文钉死——钉死后任何「大小写」字样
    // 都会被上一条连带判定，本条永远绿，纪律形同虚设（Standards A5：恒真/被连带判定的断言）。
    expect(zh).not.toContain('大小写')
    expect(enMisc['searchSheet.querySyntaxHint']).not.toMatch(/case/i)
  })

  it('匹配方式三枚 chip 的 zh 文案 = spec §7.1 给定原文', () => {
    // oracle = spec §7.1 给定的字面量（标题 + 三枚 chips）
    expect(zhMisc['searchSheet.targetTitle']).toBe('匹配方式')
    expect(zhMisc['searchSheet.target.partial']).toBe('标签部分一致')
    expect(zhMisc['searchSheet.target.exact']).toBe('标签完全一致')
    expect(zhMisc['searchSheet.target.titleAndCaption']).toBe('标题·说明')
  })
})
