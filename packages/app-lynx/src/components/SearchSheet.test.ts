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
//   - 文案「搜索中…」/「受浏览限制，不予显示」= 实现定义（无 spec/原型给定文案），
//     属 T6 文案审校范围，断言为防无意改动（characterization），不构成设计约束来源。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./SearchSheet.vue', import.meta.url)), 'utf8')

describe('SearchSheet 弹层结构（spec D5 / 原型变体 A）', () => {
  it('整体：遮罩 @tap 关闭 + 80vh 面板 @tap.stop + 根 view absolute inset-0 z-40（离流锚 page 根；盖 GlobalFab/页面 z-30 分页 FAB，review P1-1）', () => {
    expect(source).toContain('class="absolute inset-0 z-40"')
    expect(source).toContain('class="absolute inset-0 bg-scrim" @tap="onClose"')
    expect(source).toContain('h-[80vh]')
    expect(source).toContain('@tap.stop')
  })

  it('标题栏「搜索」+ × 关闭；输入行占位「输入标签 / 关键词」+ 有词清除 ×', () => {
    expect(source).toContain('>搜索</text>')
    expect(source).toContain('placeholder="输入标签 / 关键词"')
    expect(source).toContain('@tap="onClose"') // × 关闭走统一关闭路径
    expect(source).toContain('@tap="onClearInput"')
  })

  it('词条区（idle 且无词）：历史 chips 单删 + 清空入口；无历史提示「输入关键词开始搜索」', () => {
    expect(source).toContain('v-if="!keyword.trim()"')
    expect(source).toContain('>搜索历史</text>')
    expect(source).toContain('@tap="onHistoryTap(w)"') // 历史词条点选（提交点②）
    expect(source).toContain('@tap.stop="onHistoryRemove(w)"') // 单删 ×
    expect(source).toContain('@tap="onClearHistory"') // 全清
    expect(source).toContain('输入关键词开始搜索')
  })

  it('scope 段（全部/插画/小说）与 sort 段（最新/最早/热门）', () => {
    expect(source).toContain('>全部</text>')
    expect(source).toContain('>插画</text>')
    expect(source).toContain('>小说</text>')
    expect(source).toContain('>最新</text>')
    expect(source).toContain('>最早</text>')
    expect(source).toContain('>热门</text>')
  })
})

describe('SearchSheet 五态渲染分支（spec D5 / US14-US17）', () => {
  it('搜索中：顶部轻量指示「搜索中…」（debounce 窗口 isSearching + loading，保留旧结果不闪空白）', () => {
    expect(source).toContain('搜索中…')
    expect(source).toContain("state.isSearching || state.status === 'loading'")
  })

  it('首载错误：关键词保留 + 错误文案 + 重试按钮（controller.refresh）', () => {
    expect(source).toContain("v-if=\"state.status === 'error'\"")
    expect(source).toContain("state.error ?? '搜索失败，请重试'")
    expect(source).toContain('@tap="onRetry"')
    // onRetry → refresh（错误态重试，useSearch.refresh 仅 error 态生效）
    const onRetryFn = /function onRetry\(\): void \{[\s\S]*?\n\}/.exec(source)
    expect(onRetryFn).not.toBeNull()
    expect(onRetryFn![0]).toContain('controller.refresh()')
  })

  it('无结果：换词提示（ready + 空结果，不合并「未搜索」与「无结果」）', () => {
    expect(source).toContain("state.status === 'ready' && state.results.length === 0")
    expect(source).toContain('没有找到相关内容，试试换一个关键词')
  })

  it('结果列表：行式（缩略图 + 标题 + 作者 · 类型/字数）+ 查看指示；item-key String（ADR-0055/0056）', () => {
    expect(source).toContain('v-else-if="state.results.length > 0"') // 属性断言，不锁换行/缩进（P2-2）
    expect(source).toContain('list-type="single"')
    expect(source).toContain(':item-key="rowKey(row)"')
    expect(source).toContain('row.entity.user.name }} · {{ rowSub(row)')
    expect(source).toContain('{{ rowSub(row) }}') // 类型/字数（novel=`${text_length} 字`）
    expect(source).toContain('查看 ›')
    // String 前缀：type-{id} 防插画/小说 id 撞 key
    expect(source).toContain('`${row.type}-${row.entity.id}`')
    expect(source).toContain("return `${row.type}-${row.entity.id}`")
  })

  it('分页失败：保留结果 + 底部内联重试行（paginationError + loadMore 重试）', () => {
    expect(source).toContain('v-if="state.paginationError"')
    expect(source).toContain('加载更多失败')
    // 内联重试行绑定 onLoadMore（重试 = 再次 loadMore，next_url 未推进故可重试）
    const footerFn = /@tap="onLoadMore"/g
    expect(source.match(footerFn)).not.toBeNull()
    expect(source).toContain('controller.loadMore()')
  })

  it('没有更多了 footer（hasMore=false；spec US14）', () => {
    expect(source).toContain('v-else-if="!state.hasMore"')
    expect(source).toContain('>没有更多了</text>')
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
    expect(source).toContain('void loadHistory()')
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
    expect(source).toContain('受浏览限制，不予显示')
    expect(source).toContain('h-[4.267vw] bg-scrim')
  })

  it('非受限行照常渲染缩略图（SkeletonImage lite 模式）+ 标题 + 作者 · 类型/字数', () => {
    expect(source).toContain('v-if="!isRestricted(row.entity)"')
    expect(source).toContain('<SkeletonImage')
    expect(source).toContain(':src="rowThumb(row)"')
  })
})
