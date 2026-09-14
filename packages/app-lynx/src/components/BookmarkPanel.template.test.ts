// ─── BookmarkPanel.vue 结构契约（T5 #534 / spec docs/specs/bookmark-tags.md D8/D10 + ADR-0160）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定（SearchSheet.test.ts /
// NovelExportSheet.template.test.ts 同款）：本文件锁**外部行为与平台约束**（挂载契约、定位锚点、
// 遮罩/防穿透、modalStack、i18n 接线、保存通道），行为语义由 useBookmarkPanel.test.ts 覆盖。
//
// 期望值出处（Oracle 溯源）：
// - 全屏层规则 / 定位锚点 / modalStack = CONTEXT.md「覆盖层与命中测试」+ ADR-0123（真机实证，
//   独立于本实现）+ spec D8；挂载契约 = CommentOverlay.vue / PagePickerSheet.vue（既有弹层同款）；
// - i18n 键面与 zh 值 = webview 面板（packages/app/src/components/BookmarkPanel.tsx 的 t() 键名
//   + packages/app/src/i18n/locales/zh-CN/components2.ts 的 zh 值）——下方 PREFILL_ZH 是逐字粘贴的
//   快照 oracle（spec D10「同键名同语义」），不从被测模板反推；
// - 保存通道 = spec D2/D9：面板经宿主 saveWith（不直连 addBookmark）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import zhMisc from '../i18n/locales/zh-CN/misc'
import enMisc from '../i18n/locales/en/misc'
import { BOOKMARK_TAG_LIMIT } from '../utils/bookmarkTags'

const src = readFileSync(fileURLToPath(new URL('./BookmarkPanel.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

/** webview 面板 key 面 + zh 文案快照（oracle：components2.ts / BookmarkPanel.tsx，spec D10） */
const PREFILL_ZH: Record<string, string> = {
  'bookmarkPanel.title': '收藏到…',
  'bookmarkPanel.closeAria': '关闭',
  'bookmarkPanel.closeScrimAria': '关闭收藏面板',
  'bookmarkPanel.detailLoading': '正在获取收藏状态…',
  'bookmarkPanel.detailFailed': '收藏状态获取失败：{{detail}}（为避免覆盖错误数据，保存已禁用）',
  'bookmarkPanel.visibilityLabel': '可见性',
  'bookmarkPanel.visibilityPublic': '公开',
  'bookmarkPanel.visibilityPrivate': '私密',
  'bookmarkPanel.selectedLabel': '已选标签（{{count}}/{{limit}}）',
  'bookmarkPanel.selectedEmpty': '尚未选择标签',
  'bookmarkPanel.removeTagAria': '移除标签 {{tag}}',
  'bookmarkPanel.newTagLabel': '新建标签',
  'bookmarkPanel.newTagPlaceholder': '输入后按空格或回车添加',
  'bookmarkPanel.newTagAddAria': '添加',
  'bookmarkPanel.limitReached': '最多只能选择 {{limit}} 个标签',
  'bookmarkPanel.newTagEmpty': '标签不能为空',
  'bookmarkPanel.newTagDuplicate': '该标签已在已选中',
  'bookmarkPanel.universeLabel': '我的标签',
  'bookmarkPanel.universeLoading': '正在加载标签库…',
  'bookmarkPanel.universeFailed': '标签库加载失败，仍可手动输入',
  'bookmarkPanel.universeEmpty': '暂无历史标签',
  'bookmarkPanel.universeTagAria': '标签 {{name}}，使用过 {{count}} 次',
  'bookmarkPanel.suggestionsLabel': '作品标签',
  'bookmarkPanel.suggestionAria': '加入作品标签 {{name}}',
  'bookmarkPanel.saveFailed': '保存失败：{{detail}}',
  'bookmarkPanel.saving': '保存中…',
  'bookmarkPanel.save': '收藏',
  'bookmarkPanel.saveEdit': '保存修改',
}

/** 组件内出现的 bookmarkPanel.* i18n 键（含 t() 调用；.vue 不经 tsc 检查，此处关闭 typo 洞） */
function usedKeys(): string[] {
  const hits = src.match(/t\('bookmarkPanel\.[A-Za-z]+'/g) ?? []
  return [...new Set(hits.map((h) => h.slice(3, -1)))]
}

describe('BookmarkPanel i18n 键面（spec D10：与 webview 同键名同语义）', () => {
  it('zh-CN 字典含全量键且值与 webview 面板快照逐字一致（oracle 溯源）', () => {
    for (const [key, legacy] of Object.entries(PREFILL_ZH)) {
      expect(zhMisc[key as keyof typeof zhMisc], key).toBe(legacy)
    }
  })

  it('en 字典含全量键且非空（satisfies 编译期强制键完备，此处再断运行期值）', () => {
    for (const key of Object.keys(PREFILL_ZH)) {
      const value = enMisc[key as keyof typeof enMisc]
      expect(typeof value, key).toBe('string')
      expect(value.length, key).toBeGreaterThan(0)
    }
  })

  it('全量键都在面板内被消费（无死键），且无字典外键（typo 即红）', () => {
    const used = usedKeys()
    expect(used.length).toBeGreaterThan(0)
    for (const key of used) {
      expect(PREFILL_ZH[key], `面板使用了字典外键 ${key}`).toBeDefined()
    }
    for (const key of Object.keys(PREFILL_ZH)) {
      expect(used, `字典键 ${key} 未被面板消费`).toContain(key)
    }
  })

  it('上限文案用 BOOKMARK_TAG_LIMIT 单一常量（10 不散写）', () => {
    expect(BOOKMARK_TAG_LIMIT).toBe(10)
    expect(code).toContain('limit: BOOKMARK_TAG_LIMIT')
    expect(code).toContain('{ count: selected.length, limit: BOOKMARK_TAG_LIMIT }')
  })
})

describe('BookmarkPanel 平台约束（ADR-0123 覆盖层与命中测试）', () => {
  it('全屏层靠条件渲染（宿主 v-if 挂载）：组件自身无 pointer-events 幽灵层写法', () => {
    expect(code).not.toContain('pointer-events')
    expect(code).toContain('class="absolute left-0 top-0 w-full h-full z-40"')
  })

  it('遮罩带 @tap 关闭、面板带 @tap.stop 防穿透（全屏层自身即交互面）', () => {
    expect(code).toContain('bg-scrim')
    expect(code).toMatch(/bg-scrim"[^>]*@tap="onClose"/)
    expect(code).toContain('@tap.stop')
  })

  it('定位锚点：面板只用 left/top 正向定位（top-[20vh] + h-[80vh]），无 right-/bottom-', () => {
    expect(code).toContain('absolute left-0 top-[20vh] w-full h-[80vh]')
    expect(code).not.toMatch(/\b(?:right|bottom)-[0-9[]/)
  })

  it('样式走 Tailwind utility + M3 语义 token（无 scoped/手写 style 块、无 rem）', () => {
    expect(src).not.toContain('<style')
    expect(code).not.toMatch(/[0-9]rem/)
    expect(code).toContain('bg-surface-container-lowest')
    expect(code).toContain('bg-secondary-container')
    expect(code).toContain('bg-primary')
  })

  it('系统返回键先关面板：挂载注册 modalStack 关闭回调、卸载注销（与 CommentOverlay 同机制）', () => {
    expect(code).toContain('useModalStack().registerModal(() => emit(\'close\'))')
    expect(code).toContain('unregisterModal?.()')
    expect(code).toContain('unregisterModal = null')
  })

  it('挂载即并行预填（onMounted → panel.load）、卸载即 dispose（中止在途请求）', () => {
    expect(code).toContain('void panel.load()')
    expect(code).toContain('panel.dispose()')
  })
})

describe('BookmarkPanel 交互接线（spec D5/D6/D11 + D2/D9）', () => {
  it('勾选/移除经 toggleTag、新建经 commitInput（reducer 在 composable 内）', () => {
    expect(code).toContain('@tap="panel.toggleTag(name)"')
    expect(code).toContain('@tap="panel.toggleTag(tag.name)"')
    expect(code).toContain('@tap="panel.commitInput()"')
    expect(code).toContain('@tap="onSave"')
  })

  it('新建输入：v-model 绑定 + 空格/回车提交 token（D11）', () => {
    expect(code).toContain('v-model="input"')
    expect(code).toContain('@input="onInput"')
    expect(code).toContain('@confirm="onInputConfirm"')
    expect(code).toContain("value.endsWith(' ')")
  })

  it('保存经宿主 saveWith（不直连 addBookmark，保留乐观状态机与不变量，D2/D9）', () => {
    expect(code).not.toContain('addBookmark')
    expect(code).toContain('props.saveWith(restrict, tags)')
    expect(code).toContain('saveWith: (restrict, tags) => props.saveWith(restrict, tags)')
  })

  it('保存失败禁用/呈现：canSave 门控按钮 + 宿主 errorMsg 渲染（禁止静默降级）', () => {
    expect(code).toContain(':class="canSave ?')
    expect(code).toContain('saveFailed')
    expect(code).toContain('canSave ? \'bg-primary active:bg-state-pressed-primary\'')
  })

  it('detail 失败禁存与标签库降级各有独立渲染分支（spec D6 两条降级路径）', () => {
    expect(code).toContain("detailStatus === 'error'")
    expect(code).toContain("universeStatus === 'error'")
    expect(code).toContain("detailStatus === 'loading'")
  })

  it('作品标签建议来自 props.workTags（建议来源，不是收藏状态的一部分）', () => {
    expect(code).toContain('v-for="name in workTags"')
  })
})
