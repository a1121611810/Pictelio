// ─── 系统栏 JS↔Java 契约测试（spec docs/specs/lynx-systembars.md §4.3）───
// 模式 = backupRulesConsistency.test.ts（Java 源码字面量提取，任一侧漂移即红灯）。
// oracle = spec §4.3 契约锚点：事件名 / 载荷顺序 / 拉取方法 / 设置键。
// Java 侧由 LynxSystemBarsTest.contractConstants_matchSpecAnchors 钉同一组字面量。
//
// Java 路径：随宿主迁移指向 **最终位置** `packages/android-host/android/`（ADR-0203 决策 2）。
// 本文件在 `src/utils/`（深两级），故 `../../../` 到 `packages/`，再进 `android-host/android/app/`。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LYNX_ACTIVITY = readFileSync(
  new URL(
    '../../../android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java',
    import.meta.url,
  ),
  'utf8',
)
const APP_MODULE = readFileSync(
  new URL(
    '../../../android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java',
    import.meta.url,
  ),
  'utf8',
)
const SAFE_AREA = readFileSync(new URL('./safeArea.ts', import.meta.url), 'utf8')
const APP_VUE = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

describe('系统栏 JS↔Java 契约锚点', () => {
  it('事件名 pictelioInsets：Java 发送 ⇄ JS 订阅', () => {
    expect(LYNX_ACTIVITY).toContain('EVENT_INSETS = "pictelioInsets"')
    expect(LYNX_ACTIVITY).toContain('sendGlobalEvent(EVENT_INSETS')
    expect(SAFE_AREA).toContain("addListener('pictelioInsets'")
  })

  it('拉取方法 getSafeAreaInsets：Java 提供 ⇄ JS 调用', () => {
    expect(APP_MODULE).toContain('public void getSafeAreaInsets(Callback callback)')
    expect(SAFE_AREA).toContain('getSafeAreaInsets')
  })

  it('全屏键 settings_fullscreen_mode：Java 读取（T3 的 settingsStore 写同键）', () => {
    expect(LYNX_ACTIVITY).toContain('KEY_FULLSCREEN_MODE = "settings_fullscreen_mode"')
    expect(LYNX_ACTIVITY).toContain('SYSTEMBARS_PREFS = "CapacitorStorage"')
  })

  it('载荷契约：Java 数值双参 ⇄ JS 双参数消费', () => {
    // Java：JavaOnlyArray.of(top, bottom) 顺序
    expect(LYNX_ACTIVITY).toMatch(/sendGlobalEvent\(EVENT_INSETS,\s*JavaOnlyArray\.of\(sInsetTop,\s*sInsetBottom\)\)/)
    // JS：args[0]/args[1] 双参消费
    expect(SAFE_AREA).toContain('Number(args[0])')
    expect(SAFE_AREA).toContain('Number(args[1])')
  })

  it('底部安全区契约未变：App.vue 根容器 paddingBottom 仍绑定 safeBottom', () => {
    // #900 T1 只动**顶部**一条轴。底部仍是根容器集中补偿（底部弹层各自再消费 safeBottom），
    // 本票刻意不碰 —— 底部是既有正确状态，不引入第二个变量。
    expect(APP_VUE).toContain('paddingBottom: safeBottom')
    expect(APP_VUE).toContain('initSafeArea()')
  })

  // ─── 顶部让位归属（#900 T1 / #901）───
  //
  // ⚠️ **本组断言的已知失效面（门禁冻结线要求显式登记，不得只记它抓到了什么）**：
  // 下面三条全是**存在性 / 文本**判据。它们能抓「根容器没换成新契约」「某条路由忘了声明
  // topInset」「有人又往 App.vue 写回了 safeTop 算术」，但对以下两类缺陷**完全免疫**：
  //   ① 幅值错误（安全区被放大/缩小 N 倍）—— 本组绿灯而真机是破的；
  //   ② spacer 在页面上放错位置 —— 纯文本判据看不见 DOM。
  // ① 由 utils/topInset.test.ts（主门，测幅值）覆盖；② 与 ① 一并由真机幅值对拍
  // （#905/#906）覆盖。**本组绿灯不等于几何正确。**
  it('顶部让位已从根容器彻底移除（#907 收口后的最终契约）', () => {
    // 契约变更史：#901 起顶部走「按路由归属」，#907 收口把根容器那一半**整体删除**。
    // 现契约锁的是**否定式**：根容器不得再出现任何 safeTop 派生的内边距。
    // ⚠️ 剥注释后再查：App.vue 有一段「契约变更史」注释正是在解释这条断言，
    //   连注释一起扫会被自己的说明文档顶红（与本文件上方 stripComments 同款理由）。
    const appCode = APP_VUE.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
    expect(appCode, 'App.vue 又出现了 safeTop 派生的顶部内边距 = 旧契约复活').not.toMatch(/paddingTop/)
    expect(appCode, 'App.vue 不应再 import safeTop（顶部让位的归属点已完全下沉到页面）').not.toContain('safeTop')
    // 底部仍在：弹层让位与根容器兜底并存，删底部属另开票范围
    expect(appCode).toContain('paddingBottom: safeBottom')
    expect(APP_VUE).toContain('initSafeArea()')
  })

  it('模式词汇表封闭为 self / bleed 两值（防止悄悄加第三个模式）', () => {
    // ⚠️ 「由根容器补偿」的第三模式已在 #907 收口时**删除**：根容器不再压顶部内边距后，
    //    它退化成「完全不让位」——与 'bleed' 同义却长得完全不像，是静默破版的脚枪。
    const TOP_INSET = readFileSync(new URL('./topInset.ts', import.meta.url), 'utf8')
    expect(TOP_INSET).toContain("export type TopInsetMode = 'self' | 'bleed'")
    expect(TOP_INSET).not.toContain("'root' |")
  })

  it('顶部让位覆盖面：路由表每一条都必须显式声明 topInset', () => {
    // RouteMeta.topInset 已设为**必填**，vue-tsc（pnpm check）本就能抓漏声明；
    // 本条在 test 门禁里再抓一次，让失败信息直接指向「哪条路由漏了」而不是一个类型错误。
    // 不采用「缺省 = root + 白名单」形态：白名单第一次红就会被人加条目，然后彻底失效。
    const ROUTER = readFileSync(new URL('../router.ts', import.meta.url), 'utf8')
    const routeLines = ROUTER.split('\n').filter((l) => /^\s*\{\s*path:/.test(l))
    expect(routeLines.length, '路由表为空？抽取器可能已失效').toBeGreaterThan(20)
    const missing = routeLines.filter((l) => !l.includes('topInset:'))
    expect(
      missing.map((l) => l.trim().slice(0, 60)),
      '这些路由未显式声明 topInset（缺声明会走回落 + 告警，而不是编译期转红）',
    ).toEqual([])
  })

  it('让位归属与让位实现必须**同时**存在（#907 收口后的核心不变量）', () => {
    // ## 这条防的是什么
    //
    // 根容器已不再压顶部补偿（见上一条）。于是**「路由声明了 self」与「页面真的提供了 spacer」
    // 必须成对成立**。只做前者 ⇒ 内容直接顶到状态栏底下，且**没有任何报错** ——
    // 编译过、测试绿、门禁全绿，只有真机上肉眼可见。集成期就差点这么翻（25 条路由里若有页面
    // 漏了 spacer，会整批破版而不报任何错）。
    //
    // ## 失效面（照例显式登记）
    // 纯文本判据，看不见 DOM。它能抓「声明了 self 却没有几何消费」，抓不到
    // 「spacer 插在了根容器之外/之下」或「高度算错」—— 后者由 utils/topInset.test.ts（幅值）
    // 与真机对拍负责。
    const ROUTER = readFileSync(new URL('../router.ts', import.meta.url), 'utf8')
    const rows = [...ROUTER.matchAll(/name:\s*'([^']+)',\s*component:\s*(\w+),\s*meta:\s*\{([^}]*)\}/g)].map(
      (m) => ({ name: m[1], comp: m[2], meta: m[3] }),
    )
    expect(rows.length, '路由表解析为空？抽取器可能已失效').toBeGreaterThan(20)

    const offenders: string[] = []
    for (const { name, comp, meta } of rows) {
      const ti = /topInset:\s*([^,}]+)/.exec(meta)?.[1]?.trim()
      const file = new URL(`../pages/${comp}.vue`, import.meta.url)
      let src = ''
      try {
        src = readFileSync(file, 'utf8')
      } catch {
        offenders.push(`${name}(${comp})：页面文件缺失`)
        continue
      }
      if (ti === "'self'") {
        // 自让位：页面自己消费几何模块，或经公共入口 composables/useTopInsetSpacer
        // 消费（该 composable 内部即 resolveTopInsetOwnership，抽取后 11 个页面统一走它），
        // 或用了自带 spacer 的公共顶栏组件。
        // ⚠️ 三种形式是「同一不变量的三个入口」，不是三选一的豁免：三者皆无仍判红。
        if (
          !src.includes('resolveTopInsetOwnership') &&
          !src.includes('useTopInsetSpacer') &&
          !src.includes('<PageTopBar')
        ) {
          offenders.push(`${name}(${comp})：声明 'self' 但页面既未消费 resolveTopInsetOwnership / useTopInsetSpacer，也未用 <PageTopBar> ⇒ 根容器已不补偿，将顶到状态栏下`)
        }
      } else if (ti?.includes('?')) {
        // **条件表达式**形态（首页：__HOME_BLEED_HEADER__ ? 'bleed' : 'self'）。
        //
        // ⚠️ 这条分支的存在是被一次真实漏网倒逼出来的：初版只判 `ti === "'self'"`，
        //    首页的 ti 是条件表达式 ⇒ **整条路由被静默跳过** ⇒ 收口时首页「开关关闭但
        //    模板已改」这一破版组合无人拦下（#907 评论已自认）。
        // ⇒ 条件形态必须**同等**校验，且比字面量更严：两个分支都必须合法，
        //    且其中必须有一个 'self'（否则开关关闭时无人让位）。
        const branches = [...ti.matchAll(/'([a-z]+)'/g)].map((m) => m[1])
        if (branches.length !== 2) {
          offenders.push(`${name}(${comp})：topInset 条件表达式解析出 ${branches.length} 个分支，应为 2（原文：${ti}）`)
        } else {
          for (const b of branches) {
            if (b !== 'self' && b !== 'bleed') offenders.push(`${name}(${comp})：非法分支 '${b}'（合法值只有 self / bleed）`)
          }
          if (!branches.includes('self')) {
            offenders.push(`${name}(${comp})：条件表达式的两个分支都不是 'self' ⇒ 构建开关关闭时无人让位，根容器已不兜底 ⇒ 破版`)
          }
        }
        // 模板侧必须有与之对应的两个分支（开 / 关）
        if (!/v-if="!HOME_BLEED"/.test(src) || !/v-else/.test(src)) {
          offenders.push(`${name}(${comp})：meta 是条件表达式但模板缺少 v-if="!HOME_BLEED" / v-else 成对分支 ⇒ meta 与模板可能不同源（一边开一边关）`)
        }
        if (!src.includes('useTopInsetSpacer') && !src.includes('<PageTopBar')) {
          offenders.push(`${name}(${comp})：条件 meta 的 'self' 分支需要页面自带让位，但页面未消费 useTopInsetSpacer / <PageTopBar> ⇒ 开关关闭时破版`)
        }
      } else if (ti !== "'bleed'") {
        offenders.push(`${name}(${comp})：topInset 取值无法解析（原文：${ti}）`)
      }
    }
    expect(offenders, '让位归属与让位实现不配对（根容器已不再兜底 ⇒ 这些页面会破版且不报错）').toEqual([])
  })

  it('底部弹层家族安全区 spacer（spec §4.2 清单）：每个底部面板必须消费 safeBottom', () => {
    const SHEETS = [
      'SearchSheet',
      'CommentOverlay',
      'NovelExportSheet',
      'NovelCaptionSheet',
      'PagePickerSheet',
      'BookmarkPanel', // top-[20vh]+h-[80vh] 与 bottom-0 贴底等价（ADR-0123 正向锚点），同族消费方
    ] as const
    for (const name of SHEETS) {
      const src = readFileSync(new URL(`../components/${name}.vue`, import.meta.url), 'utf8')
      expect(src, `${name}.vue 缺 safeBottom 导入`).toContain("from '../utils/safeArea'")
      expect(src, `${name}.vue 缺安全区 spacer`).toContain("{ height: safeBottom + 'px' }")
    }
  })

  it('WatchlistPromptDialog 不消费 safeBottom（居中 Dialog 不触底，spec 清单的显式偏离）', () => {
    const src = readFileSync(
      new URL('../components/WatchlistPromptDialog.vue', import.meta.url),
      'utf8',
    )
    expect(src).not.toContain('safeBottom')
  })
})
