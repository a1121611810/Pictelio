// ─── TagNeighbors.vue 接线契约（ADR-0197 D9/D14 / spec docs/specs/tag-neighbors.md）───
// 页面层接线不经 tsc/vitest 渲染（.vue 只做源级守卫），故用源级断言锚定「不该被静默改掉的形状」：
// a11y 注册表消费、i18n 键消费、页级首载三态（ADR-0150 跨页防线的同款三条）、无中文模板字面量、
// 结果卡可解释性三元组、标签可点与跳转、以及「零 absolute / 零 rem / 零 scoped CSS」纪律。
//
// 期望值出处（Oracle 溯源，禁自洽反推）：
//   - a11y 四键值 = src/utils/accessibility.ts 的 TAG_NEIGHBORS_A11Y_LABELS（注册表本体，
//     非本文档复述）；键必须全被消费（spec user story 32）。
//   - PageTopBar 双 label 走 props 形态 = Notifications.vue:148-154 / PageTopBar.vue 接口
//     （组件内部成对挂 element + label，页面侧只注入文案）。
//   - i18n 键清单与两侧取值 = src/i18n/locales/{zh-CN,en}/pages.ts 的 tagNeighbors.* 段
//     （键集合与 en 侧 satisfies 完备由字典自身强制）。
//   - 首载三态三条 = src/utils/firstLoadViewWireup.test.ts:44-58（同一判据的跨页版）。
//   - 卡片形态先例 = Notifications.vue 行卡 / IllustTypeBadgeRow.vue 徽章类串 /
//     IllustDetail.vue 里 TagPressChip 的既有用法（行号随文件漂移，不引具体行）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TAG_NEIGHBORS_A11Y_LABELS } from '../utils/accessibility'
import zhPages from '../i18n/locales/zh-CN/pages'
import enPages from '../i18n/locales/en/pages'

const src = readFileSync(fileURLToPath(new URL('./TagNeighbors.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明会提到目标串，断言须落在代码本文上） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
/** 模板区（i18n 键与中文字面量断言的落点） */
const template = src.slice(src.indexOf('<template>'))
/** 模板条件行：v-if / v-else-if（首载三态防线的判定对象） */
const conditionLines = (): string[] =>
  code
    .split('\n')
    .filter((l) => /v-(if|else-if)=/.test(l))

/** 本页必须消费的 i18n 键（用户故事 6/7/8/14/19/29/30 + 错误重试） */
const I18N_KEYS = [
  'tagNeighbors.title',
  'tagNeighbors.similarity',
  'tagNeighbors.commonTags',
  'tagNeighbors.source.author',
  'tagNeighbors.source.sitewide',
  'tagNeighbors.skip.tooFewTags',
  'tagNeighbors.empty',
  'tagNeighbors.retry',
] as const

describe('TagNeighbors a11y 注册表消费（spec user story 32 / ADR-0061 element+label 成对）', () => {
  it('四个键全部被消费：back / pageTitle 走 PageTopBar props，openItem / retry 走平台属性', () => {
    // 变体 b 顶栏（Notifications.vue 同款）：两个 a11y 文案经 props 注入，组件内成对挂载
    expect(code).toContain(':back-a11y-label="TAG_NEIGHBORS_A11Y_LABELS.back"')
    expect(code).toContain(':title-a11y-label="TAG_NEIGHBORS_A11Y_LABELS.pageTitle"')
    for (const key of ['openItem', 'retry'] as const) {
      expect(code).toContain(`:accessibility-label="TAG_NEIGHBORS_A11Y_LABELS.${key}"`)
    }
    for (const key of Object.keys(TAG_NEIGHBORS_A11Y_LABELS)) {
      expect(code).toContain(`TAG_NEIGHBORS_A11Y_LABELS.${key}`)
    }
  })

  it('label 引用数 == element 引用数（ADR-0061；每处可读标注都可被 a11y 树识别）', () => {
    const labels = (code.match(/:accessibility-label="TAG_NEIGHBORS_A11Y_LABELS\.\w+"/g) ?? []).length
    const elements = (code.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    // openItem（结果卡）+ retry（错误态重试键）+ dismissBroadening（阶段 2 提示行关闭，T4/#769）
    expect(labels).toBe(3)
    expect(elements).toBe(labels)
    expect(code).toContain("import { TAG_NEIGHBORS_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'")
  })
})

describe('TagNeighbors i18n 键消费与两侧齐备（spec user story 31）', () => {
  it('全部键在模板/脚本侧被消费（store 零文案：文案只在宿主 t() 渲染）', () => {
    for (const key of I18N_KEYS) {
      expect(code, `未消费 i18n 键 ${key}`).toContain(key)
    }
  })

  it('每个键在 zh 与 en 两侧都存在且非空（en 侧由 satisfies 编译期强制，此处钉消费侧不断链）', () => {
    for (const key of I18N_KEYS) {
      const zh = (zhPages as Record<string, string>)[key]
      const en = (enPages as Record<string, string>)[key]
      expect(zh, `zh 缺键 ${key}`).toBeTruthy()
      expect(en, `en 缺键 ${key}`).toBeTruthy()
    }
  })

  it('相似度与双值走变量插值（键含 {{score}} / {{common}} / {{total}} 占位符）', () => {
    // oracle：zh-CN/pages.ts 的 tagNeighbors.similarity = "{{score}} 相似"、
    // tagNeighbors.commonTags = "{{common}}/{{total}} 共同标签"
    expect(zhPages['tagNeighbors.similarity']).toBe('{{score}} 相似')
    expect(zhPages['tagNeighbors.commonTags']).toBe('{{common}}/{{total}} 共同标签')
    expect(code).toContain("t('tagNeighbors.similarity', { score: row.scorePercent })")
    expect(code).toContain('t(\'tagNeighbors.commonTags\', { common: row.common, total: row.total })')
  })

  it('模板区零中文/零硬编码文案（tests/hardcode-gate.test.ts 同步防线）', () => {
    const cjk = /[\u4e00-\u9fff]/
    const textOnly = template.replace(/\{\{[\s\S]*?\}\}/g, '').replace(/<[^>]*>/g, '\n')
    for (const line of textOnly.split('\n')) {
      expect(line.trim(), `模板文本节点含中文：${line.trim()}`).not.toMatch(cjk)
    }
  })
})

describe('TagNeighbors 页级首载三态接线（ADR-0150 跨页防线的同款三条）', () => {
  it('① 导入并调用 deriveFirstLoadView（三态唯一判定源）', () => {
    expect(code).toContain("import { deriveFirstLoadView } from '../utils/firstLoadView'")
    expect(code).toContain('deriveFirstLoadView(')
  })

  it('② 骨架分支落在模板条件上（v-if / v-else-if 含 skeleton）', () => {
    expect(conditionLines().some((l) => l.includes("'skeleton'"))).toBe(true)
    // 三态互斥单链：骨架 → 错误 → 空态 → 内容（else）
    expect(conditionLines().some((l) => l.includes("'error'"))).toBe(true)
    expect(conditionLines().some((l) => l.includes("'empty'"))).toBe(true)
  })

  it('③ 任何条件行不得同时门控 loading 与「渲染流为空」（旧 bug 形态，含 !x.length / length == 0 变体）', () => {
    const bad = conditionLines().filter(
      (l) => /loading/i.test(l) && /(?:length\s*===?\s*0|!\s*[\w.$]*\.length)/.test(l),
    )
    expect(bad).toEqual([])
  })

  it('请求由 onMounted 触发（先渲染后加载：store 初始化零请求）', () => {
    expect(code).toContain('onMounted(() => {')
    expect(code).toContain('store.load(illustId.value)')
    // 源作品 id 取路由参数 `id`（router.ts 的 /illust/:id/tag-neighbors 约定）
    expect(code).toContain('Number(currentParams.value.id ?? 0)')
  })
})

describe('TagNeighbors 结果卡可解释性三元组与下钻（spec user story 6/7/8/19/24/25/30）', () => {
  it('相似度徽标 + 来源标注 + 共同标签双值三者齐备（可解释性是本功能的卖点）', () => {
    expect(code).toContain("t('tagNeighbors.similarity', { score: row.scorePercent })")
    expect(code).toContain('sourceLabel(row.source)')
    expect(code).toContain('t(\'tagNeighbors.commonTags\', { common: row.common, total: row.total })')
    // 来源码 → 文案的映射在宿主持有（store 零文案，语言切换即时生效）
    expect(code).toContain("t('tagNeighbors.source.author')")
    expect(code).toContain("t('tagNeighbors.source.sitewide')")
  })

  it('阶段 1 跳过原因渲染出来（spec user story 30 / ADR-0197 D8，不静默）', () => {
    // 原因码在脚本侧判，文案在脚本侧翻（store 零文案）→ 结果串由模板渲染
    expect(code).toContain("store.phase1SkippedReason() === 'tooFewTags'")
    expect(code).toContain("t('tagNeighbors.skip.tooFewTags')")
    expect(template).toContain('{{ skipNotice }}')
  })

  it('封面走 SkeletonImage（图片三态骨架），非裸 image 元素', () => {
    expect(code).toContain("import SkeletonImage from '../components/SkeletonImage.vue'")
    expect(template).toContain('<SkeletonImage')
    expect(template).not.toMatch(/<image[\s/>]/)
  })

  it('点整条进作品详情；结果里的标签仍可点跳搜索（user story 24/25）', () => {
    expect(code).toContain('void navigate(`/illust/${row.illustId}`)')
    expect(template).toContain('@tap="openIllust(row)"')
    expect(code).toContain("import TagPressChip from '../components/TagPressChip.vue'")
    expect(template).toContain('@tap="useSearchSheetStore().openSearch(tag.name)"')
    // 标签用原名检索（ADR-0197 D10：translated_name 大量为 null）
    expect(template).toContain("'#' + (tag.translated_name || tag.name)")
  })

  it('无分页 → 不用 RefreshableList；错误/重试走 FeedListFooter（ADR-0194）', () => {
    expect(code).not.toContain('RefreshableList')
    expect(code).toContain("import FeedListFooter from '../components/FeedListFooter.vue'")
    expect(code).toContain("import PageTopBar from '../components/PageTopBar.vue'")
    expect(template).toContain(':retry-text="t(\'tagNeighbors.retry\')"')
    expect(code).toContain('store.retry()')
  })

})

// ─── 阶段 2 兜底提示行（spec user story 14/15；票 T4 / #769）───
// oracle：spec user story 14「看到一行『正在放宽标签范围…』的提示」+ user story 15
// 「能把这行提示关掉，不再反复出现打扰我」；ADR-0197 D15 未决项「阶段 2 兜底时是否需要
// 显式的『正在放宽标签…』中间态」在此落地。关闭的**会话级**语义见
// stores/tagNeighbor.ts 的 dismissedBroadeningNotices 注释。
describe('TagNeighbors 阶段 2 兜底提示行（T4 / #769）', () => {
  it('仅在阶段 2 真的跑过（phase2Ran）时出现，且会话内被关掉后不再出现', () => {
    expect(code).toContain('store.phase2Ran()')
    // dismissed 是会话级内存态（watchlistStore 同款），故以 ref 镜像进页面渲染条件
    expect(code).toContain('const broadeningDismissed = ref(isBroadeningNoticeDismissed())')
    // 门控：先看在途、再看是否跑过。phase2Ran 只在**落定后**为真，故在途态必须靠 phase2Running
    // （code-review B1：真机走查 + 独立审查同现）
    expect(code).toContain("if (broadeningDismissed.value) return ''")
    expect(code).toContain('if (store.phase2Running()) return t(\'tagNeighbors.broadening\')')
    expect(code).toContain("if (!store.phase2Ran()) return ''")
    expect(code).toContain('dismissBroadeningNotice()')
    expect(code).toContain('broadeningDismissed.value = true')
  })

  it('在途与落定两态文案随真实状态切换（不谎报进度）', () => {
    expect(code).toContain('store.phase2Running()')
    expect(code).toContain("t('tagNeighbors.broadeningDone', { count: layer.length })")
  })

  it('全层失败时提示行不出现（不得回落成「已放宽到 0 个标签」的假文案）', () => {
    // phase2LastLayer 只在内核**成功取回某层**时推进；全层失败时为 null。
    // 若回落成 `?.length ?? 0` 就会渲染 count=0，与整页错误态同时出现且互相矛盾
    // （code-review 新阻塞 1）。此处必须显式 return ''。
    expect(code).toContain('if (layer === null) return \'\'')
    expect(code).not.toContain('broadeningCount')
    // 限定在 broadeningNotice 的定义作用域内断言无 `?? 0` 回落
    // （全文另有合法的 `?? 0`：illustId 对缺失路由参数的兜底，不能一刀切禁掉）
    const notice = code.slice(code.indexOf('const broadeningNotice'), code.indexOf('function onDismissBroadening'))
    expect(notice).not.toContain('?? 0')
    expect(notice).toContain('phase2LastLayer()')
  })

  it('胶囊形态而非全宽盒（ADR-0123：全宽盒吞子元素点击，且原生不识别 pointer-events）', () => {
    const chip = template.slice(template.indexOf('TAG_NEIGHBORS_A11Y_LABELS.dismissBroadening') - 600, template.indexOf('TAG_NEIGHBORS_A11Y_LABELS.dismissBroadening') + 200)
    // 关闭键自身必须是 hug-content 的胶囊：靠最近的 rounded-full token + 不撑满宽度
    expect(chip).toContain('rounded-[var(--md-shape-full)]')
    expect(chip).not.toContain('w-full')
    expect(template).toContain('@tap.stop="onDismissBroadening"')
  })

  it('门控丢弃必须可见（D16「不做静默过滤」/ spec US27「而非被悄悄消失」）', () => {
    expect(code).toContain('store.gatedCount()')
    expect(code).toContain("t('tagNeighbors.gated', { count: store.gatedCount() })")
    expect(template).toContain('v-if="gatedNotice"')
  })

  it('a11y 注册表 dismissBroadening 被消费，且关闭键有 element 配对', () => {
    expect(code).toContain(':accessibility-label="TAG_NEIGHBORS_A11Y_LABELS.dismissBroadening"')
  })
})

describe('TagNeighbors 纪律（app-lynx 样式约定：Tailwind/M3 令牌、零 absolute、零 rem、零 scoped CSS）', () => {
  it('无 scoped CSS / 无 rem 单位（web-core 预览约束）', () => {
    expect(src).not.toContain('<style')
    expect(template).not.toMatch(/\b\d*\.?\d+rem\b/)
  })

  it('结果行内零 absolute 定位（真机会把 absolute 子元素算进内容高度）', () => {
    expect(template).not.toContain('absolute')
  })

  // ADR-0207 决策 5 真机实证：`:focus` 与 `:focus-visible` **都**不写（引擎不匹配，
  // 写出来只是死类名）。用例名原写「统一 :focus-visible」，与该结论反向，会误导后人。
  it('无裸 :focus / :focus-visible（ADR-0207 决策 5）+ 触控目标 ≥40px（10.667vw 高度键）', () => {
    expect(src).not.toMatch(/(^|[^-]):focus\b/)
    expect(template).toContain('h-[10.667vw]')
  })

  it('缩略图照既有调用形态：外层给尺寸、组件只收 height，不传 class 覆盖、不传 lazy-load', () => {
    // oracle（code-review B3 更正了初稿的过强论断）：仓库内 SkeletonImage 共 18 处调用
    // （含本页），其中 6 处**确实**传 class 且工作正常（components/{CommentItem,SearchSheet,
    // UserRow}.vue、pages/{IllustDetail,UserHome,WatchLater}.vue）——故「传 class 必然导致
    // 骨架卡死」不是全局规则。本断言的依据是两条可复核事实：
    //   ① 本场景真机实测（pictelio_ui 模拟器）：首版同时传 class + lazy-load 时缩略图全部停在
    //      骨架灰块（shimmer 不消失 = @load 从未触发），改回本形态后恢复；
    //   ② 与工作正常的 list 型调用同款：IllustList.vue / RelatedInlineSection.vue / Ranking.vue
    //      一律「外层 view 给尺寸、组件只收 height」。
    // 精确切到该自闭合标签本身，避免窗口溢出到相邻元素（否则相邻的 class= 会误判进来）
    const start = template.indexOf('<SkeletonImage')
    const call = template.slice(start, template.indexOf('/>', start) + 2)
    expect(call).toContain(':src="row.thumb"')
    expect(call).toContain('height="12vw"')
    expect(call).not.toContain('lazy-load')
    expect(call).not.toContain('class=')
    // 形态依据写在脚本块（模板注释内的类标签字面量会被剥标签正则提前截断，注释尾部会被
    // 误判为模板文本）——顺带钉住这个坑，避免下次把长说明又搬回模板
    expect(code).toContain('openTagNeighborCallShape')
    // 尺寸由外层容器承担（Lynx view 默认 align-items:stretch → 子元素满宽）
    expect(template).toContain('<view class="w-[12vw]">')
  })

  it('零硬编码颜色：只走 M3 语义色 / 形状 / 阴影令牌', () => {
    expect(template).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(template).not.toMatch(/rgba?\(|hsla?\(/)
    expect(template).not.toMatch(/\b(bg|text)-(black|white)\b/)
  })
})
