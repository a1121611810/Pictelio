// 正文选中会话的 Vue 薄绑定（spec docs/specs/app-lynx-novel-text-selection.md §ID）：页面唯一逻辑入口。
// 三件事：组装生产适配器 → 交给框架无关的深模块 createTextSelection → 把只读视图与模板处理器给页面。
// 页面不需要知道 selector query / 剪贴板 / 搜索弹层 / modalStack 中的任何一个。
import { onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  createTextSelection,
  type SearchPort,
  type SelectionChangeEvent,
  type TextSelectionView,
} from '../primitives/createTextSelection'
import { createLynxSelectionEngine } from '../utils/lynxSelectionEngine'
import { writeClipboardText } from '../utils/lynxClipboard'
import { useModalStack } from '../stores/modalStack'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import { t } from '../i18n'

/**
 * 页面根 view 的 id：**满内容宽 + 定位锚点 (0,0)** 双职责（spec 不变式 3/4——
 * vw 换算基准来自它的实测宽，胶囊也挂在它下面）。
 */
export const TEXT_SELECTION_ROOT_ID = 'novel-selection-root'

export interface UseTextSelectionOptions {
  /** 正文段落（与模板 v-for 同一个值；索引即身份，spec 不变式 1） */
  paragraphs: Ref<readonly string[]>
}

export interface UseTextSelectionReturn {
  /** 绑到页面根 view 的 :id */
  rootId: string
  /** 段落节点 id（模板 :id / :key / :item-key 共用同一约定） */
  paragraphId(index: number): string
  /** 只读视图模型（传给 TextSelectionToolbar；getter 暴露，模板读取即最新值） */
  readonly view: TextSelectionView
  /** 绑到段落 <text> 的 :bindselectionchange */
  onSelectionChange(event: SelectionChangeEvent): void
  /** 绑到正文 <list> 的 @scroll（该 list 必须 :scroll-event-throttle="0"） */
  onScroll(): void
  /** 绑到页面根 view 的 @tap：菜单外点击收起（引擎对「点空白」不派发清空事件） */
  onTapAway(): void
  /** 绑到页面根 view 的 @longpress：为「抬手 tap」打标（防菜单被自己这次长按的抬手收掉） */
  notifyLongPress(): void
  copy(): void
  search(): void
}

/**
 * 搜索端口装配（spec §ID 7）：收编 `openSearch` 的**幂等吞词**怪癖——
 * 弹层已开时 `openSearch` 直接早退、关键词被静默丢弃，故先 `closeSearch()` 再开。
 * 导出以便单测（传假 store，不需要 Pinia）。
 */
export function createSelectionSearchPort(store: {
  isOpen: boolean
  closeSearch(): void
  openSearch(keyword: string): void
}): SearchPort {
  return {
    openWithKeyword: (keyword) => {
      if (store.isOpen) {
        store.closeSearch()
      }
      store.openSearch(keyword)
    },
  }
}

export function useTextSelection(options: UseTextSelectionOptions): UseTextSelectionReturn {
  const searchSheet = useSearchSheetStore()
  const selection = createTextSelection({
    getParagraphText: (nodeId) => {
      const match = /^p-(\d+)$/u.exec(nodeId)
      if (match === null) return null
      return options.paragraphs.value[Number(match[1])] ?? null
    },
    engine: createLynxSelectionEngine({ probeId: TEXT_SELECTION_ROOT_ID }),
    clipboard: { writeText: writeClipboardText },
    search: createSelectionSearchPort(searchSheet),
    registerModal: (close) => useModalStack().registerModal(close),
    labels: {
      copy: t('novelDetail.selection.copy'),
      search: t('novelDetail.selection.search'),
      copied: t('novelDetail.selection.copied'),
      copyFailed: t('novelDetail.selection.copyFailed'),
    },
  })

  const view = ref(selection.getView())
  const unsubscribe = selection.subscribe(() => {
    view.value = selection.getView()
  })
  onScopeDispose(() => {
    unsubscribe()
    selection.dispose()
  })
  // 段落源变化（切章 / 重载）→ 收起：旧索引对新文本无意义（spec 不变式 1）
  watch(options.paragraphs, () => selection.dismiss())

  return {
    rootId: TEXT_SELECTION_ROOT_ID,
    paragraphId: (index: number) => `p-${index}`,
    // 用 getter 暴露（模板读取即最新值；别处返回 Ref 会在模板里被当成对象传下去）
    get view(): TextSelectionView {
      return view.value
    },
    onSelectionChange: (event) => selection.onSelectionChange(event),
    onScroll: () => selection.onScroll(),
    onTapAway: () => selection.onTapAway(),
    notifyLongPress: () => selection.notifyLongPress(),
    copy: () => selection.copy(),
    search: () => selection.search(),
  }
}
