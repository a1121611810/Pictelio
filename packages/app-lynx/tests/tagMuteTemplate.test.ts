// 标签静音 UI 与组装点接线守卫（ADR-0187 D4/D5 / #732）。
// 仓库无 .vue 渲染测试基建（node 环境无 Lynx 渲染器，SearchSheet.test.ts 同款）——
// 沿用「模板源码断言」约定；期望值出处（Oracle 溯源）：
// - 长按静音入口三宿主 + 手势绑 view 层 = ADR-0187 D5 + 原生 <text> 不收手势约束；
// - 数据层移除（非遮罩）= ADR-0187 D4；搜索行不进 isRowMasked = spec docs/specs/tag-mute.md 边界；
// - 排行榜先赋名次后过滤 = spec 边界 5（ADR-0158 保序精神）；
// - 管理页 /mute-tags requiresAuth + Me 内容组入口行 = 票面落点；
// - 轻提示宿主 = App.vue exitHint 同形态（M3 snackbar、无全宽盒 ADR-0123）。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

const muteTagsVue = read("../src/pages/MuteTags.vue")
const meVue = read("../src/pages/Me.vue")
const router = read("../src/router.ts")
const a11y = read("../src/utils/accessibility.ts")
const appVue = read("../src/App.vue")
const chip = read("../src/components/TagPressChip.vue")
const chipRow = read("../src/components/TagChipRow.vue")
const adaptiveRow = read("../src/components/AdaptiveTagRow.vue")
const illustDetail = read("../src/pages/IllustDetail.vue")
const recommended = read("../src/pages/Recommended.vue")
const searchSheet = read("../src/components/SearchSheet.vue")
const relatedInjection = read("../src/stores/relatedInjection.ts")
const ranking = read("../src/pages/Ranking.vue")
/** 去掉 HTML 注释与行注释后的代码本文（负向断言的对象） */
const code = (src: string): string => src.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "")

describe("MuteTags.vue 管理页（ADR-0187 D5 / #732）", () => {
  it("骨架：TopAppBar 返回 + 标题、列表行「标签名 + 移除」、空态（Watchlist 形态）", () => {
    expect(muteTagsVue).toContain("MUTE_TAGS_A11Y_LABELS.back")
    expect(muteTagsVue).toContain("MUTE_TAGS_A11Y_LABELS.pageTitle")
    expect(muteTagsVue).toContain("t('muteTags.title')")
    expect(muteTagsVue).toContain("t('muteTags.remove')")
    expect(muteTagsVue).toContain("t('muteTags.empty.title')")
    expect(muteTagsVue).toContain("t('muteTags.empty.hint')")
    // 数据源 = settingsStore 集合快照（响应式 computed）
    expect(muteTagsVue).toContain("settings.mutedTags()")
    expect(muteTagsVue).toContain("settings.unmuteTag(name)")
  })

  it("MUTE_TAGS_A11Y_LABELS 注册表全键被模板消费且配套 element（注册表完整性口径）", () => {
    for (const key of ["pageTitle", "back", "remove"]) {
      expect(muteTagsVue).toContain(`MUTE_TAGS_A11Y_LABELS.${key}`)
    }
    const labelCount = (muteTagsVue.match(/:accessibility-label="[^"]+"/g) ?? []).length
    const elementCount = (muteTagsVue.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(elementCount).toBeGreaterThanOrEqual(labelCount)
    // 行级动态标签（原始标签名）不进注册表（唯一动态标注，静态键 3 个）
    expect((muteTagsVue.match(/:accessibility-label="name"/g) ?? []).length).toBe(1)
  })

  it("M3 语义类着色（移除 = error 语义色；无硬编码色值——hardcodeColorGate 兜底）", () => {
    expect(muteTagsVue).toContain("text-error")
    expect(code(muteTagsVue)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code(muteTagsVue)).not.toMatch(/\brgb\(/)
  })
})

describe("路由与 Me 入口行（票面落点）", () => {
  it("router：/mute-tags 次级业务页 + requiresAuth（非 NAV_TABS 外环）", () => {
    expect(router).toContain("import MuteTags from './pages/MuteTags.vue'")
    expect(router).toContain(
      "{ path: '/mute-tags', name: 'mute-tags', component: MuteTags, meta: { requiresAuth: true } }",
    )
  })

  it("Me 内容组入口行：openMuteTags → /mute-tags，消费 i18n 键 me.content.muteTags", () => {
    expect(meVue).toContain("function openMuteTags()")
    expect(meVue).toContain("navigate('/mute-tags')")
    expect(meVue).toContain("t('me.content.muteTags')")
  })

  it("入口行在内容组 AI 三态分段之后（票面指定插入位）", () => {
    const aiIdx = meVue.indexOf("ME_A11Y_LABELS.aiFilterOnly")
    const muteIdx = meVue.indexOf("ME_A11Y_LABELS.muteTags")
    expect(aiIdx).toBeGreaterThan(-1)
    expect(muteIdx).toBeGreaterThan(aiIdx)
  })

  it("ME_A11Y_LABELS.muteTags 登记且与其它键无重复（注册表唯一性口径与 unit.test 一致）", () => {
    const registryMatch = /ME_A11Y_LABELS = \{([^}]*)\}/.exec(a11y)
    expect(registryMatch).not.toBeNull()
    const labels = [...(registryMatch![1]!.matchAll(/'([^']*)'/g))].map((m) => m[1]!)
    expect(labels).toContain("管理静音标签")
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe("静音轻提示宿主（ADR-0187 D5，App.vue exitHint 同形态）", () => {
  it("App.vue 消费 muteTagHint：M3 snackbar（inverse-surface）+ 胶囊定位（ADR-0123）+ i18n 渲染", () => {
    expect(appVue).toContain("v-if=\"settings.muteTagHint\"")
    expect(appVue).toContain("t('muteTag.mutedHint'")
    const codeApp = code(appVue)
    expect(codeApp).toContain("bg-inverse-surface")
    expect(codeApp).toContain("text-inverse-on-surface")
    // 无全宽盒（原生 hit-testing 不识别 pointer-events，ADR-0123）
    expect(codeApp).not.toMatch(/left-0 right-0/)
  })
})

describe("长按静音手势（ADR-0187 D5：手势绑 view 层 + 吞 tap 守卫）", () => {
  it("TagPressChip：useLongPress 绑 view + consumeLongPress 吞 tap + @tap.stop 防冒泡", () => {
    expect(chip).toContain("useLongPress")
    expect(chip).toContain("if (longPress.consumeLongPress()) return")
    // 手势三通道绑 view（原生 <text> 不收手势）+ 长按计时在途取消
    const chipCode = code(chip)
    for (const dir of ["@touchstart", "@touchmove", "@touchend"]) {
      expect(chipCode).toContain(dir)
    }
    expect(chipCode).toContain("@tap.stop")
    expect(chip).toContain("longPress.cancel()")
  })

  it("TagChipRow / AdaptiveTagRow：纯展示保持——新事件上抛，不 import store", () => {
    expect(chipRow).toContain("(e: 'tag-long-press', name: string): void")
    expect(adaptiveRow).toContain("(e: 'tag-long-press', name: string): void")
    expect(chipRow).not.toContain("stores/settingsStore")
    expect(adaptiveRow).not.toContain("stores/settingsStore")
    // 测量不变量：CHIP_CLASS 经 :chip-class 透传（类与盒模型逐字一致）
    expect(adaptiveRow).toContain(':chip-class="CHIP_CLASS"')
  })

  it("详情页标签行：TagPressChip 点击搜索 + 长按 muteTag（IllustDetail）", () => {
    expect(illustDetail).toContain("<TagPressChip")
    expect(illustDetail).toContain("@long-press=\"onTagLongPress(tag.name)\"")
    expect(illustDetail).toContain("settings.muteTag(name)")
  })

  it("其余两宿主接线 tag-long-press → muteTag（Recommended / NovelList / NovelIntro）", () => {
    expect(recommended).toContain("@tag-long-press=\"onTagLongPress\"")
    expect(recommended).toContain("useSettingsStore().muteTag(name)")
    const novelList = read("../src/pages/NovelList.vue")
    const novelIntro = read("../src/pages/NovelIntro.vue")
    expect(novelList).toContain("@tag-long-press=\"onTagLongPress\"")
    expect(novelList).toContain("settings.muteTag(name)")
    expect(novelIntro).toContain("@tag-long-press=\"onTagLongPress\"")
    expect(novelIntro).toContain("settings.muteTag(name)")
  })
})

describe("数据组装点过滤注入（ADR-0187 D4：数据层移除，非遮罩）", () => {
  it("五个列表页可见流经 useTagMuteVisible 缝（useAiOnlyVisible 链式后置）", () => {
    for (const page of ["IllustList", "NovelList", "Following", "UserHome", "Bookmarks"]) {
      const src = read(`../src/pages/${page}.vue`)
      expect(src).toContain("useTagMuteVisible(")
      expect(src).toContain("useTagMuteVisible(useAiOnlyVisible(")
    }
  })

  it("Recommended visibleItems 同谓词并排（R18/AI/静音三谓词一处组装）", () => {
    expect(recommended).toContain("!isTagMuted(it.data)")
  })

  it("搜索结果行数据层移除；不进 isRowMasked（spec 边界）", () => {
    expect(searchSheet).toContain("!settings.isTagMuted(r.entity)")
    // isRowMasked 维持 R18/AI 两谓词，静音不进遮罩态
    const masked = /function isRowMasked[\s\S]*?\n\}/.exec(code(searchSheet))![0]!
    expect(masked).not.toContain("isTagMuted")
  })

  it("相关注入行：过滤链追加静音一环（relatedInjection.ts）", () => {
    expect(relatedInjection).toContain("!settings.isTagMuted(i)")
  })

  it("排行榜：先赋名次后过滤（assignRanksThenDropMuted），R18/AI 遮罩口径不变", () => {
    expect(ranking).toContain("assignRanksThenDropMuted(illusts.value, settings.isTagMuted)")
    // 渲染流切换到带名次行（静音行已数据层移除，无遮罩分支）
    expect(ranking).toContain('v-for="row in visibleRows"')
    expect(ranking).toContain("{{ row.rank }}")
    // R18/AI 保留条目盖遮罩（本端口径不变，ADR-0187 D4 有意差异）
    expect(ranking).toContain('v-if="isRestricted(row.item)"')
  })
})
