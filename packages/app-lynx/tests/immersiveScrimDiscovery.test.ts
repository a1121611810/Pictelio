// 沉浸卡**自发现**判据（#1004 / #1009 拆分自 immersiveScrimContrast.test.ts）：
// 全仓候选集合与登记清单的双向相等、发现判据形态、遍历层（合成树）。
// 与颜色/对比度判据无关 —— 它管「哪些 .vue 算沉浸卡」，不管「颜色达不达标」。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  CONSUMERS,
  SRC_ROOT,
  consumerSetDiagnosis,
  discoverImmersiveCards,
  isImmersiveCardSource,
  registeredKeys,
} from './helpers/immersiveScrimShared'

/**
 * 真实沉浸卡的源码，原样读自实际消费点，用作 #1004 合成夹具的素材。
 *
 * ⚠️ 必须用**真实样例**，不能手写「自洽」的 class/style 串（测试硬约束 #2）。
 *    手写串会自洽地满足判据，却不代表仓里真有人这么写 —— 那样的夹具证明不了
 *    发现逻辑认的是真实形态。真实写法是 `style="background: var(--md-scrim-overlay)"`
 *    （渐变定义在令牌里，页面侧不套 linear-gradient），与手写猜测的形状并不相同。
 */
const REAL_CARD_SRC = fs.readFileSync(path.join(SRC_ROOT, 'pages/Recommended.vue'), 'utf-8')
  // ── #1004：全仓候选集合与登记清单双向相等 ──────────────────────────────
  //
  // 此前本文件只对三个硬编码文件名断言，**不扫描发现、也无集合相等夹逼**：
  // 新增第 4 个沉浸卡时这条断言恒绿地不覆盖它，也不报任何提示。本组把
  // 「新增即入判」交给机器。
  //
  // 遍历面与列表交错契约门禁共用一份实现（#1006）：扫描面是隐含的范围承诺，
  // 两道门禁各写各的就会漂。
  describe('沉浸卡自发现：全仓候选与登记清单双向相等（防「新卡静默漏判」）', () => {
    const DISCOVERED = discoverImmersiveCards(SRC_ROOT)
    const REGISTERED = registeredKeys()

    it('扫描结果与登记清单相等（漏网与过期双向暴露）', () => {
      expect(consumerSetDiagnosis(DISCOVERED, REGISTERED)).toBeUndefined()
    })

    it('登记清单非空（防「清单被清空 ⇒ 全称断言恒真」）', () => {
      expect(REGISTERED.length, '登记被清空时集合相等会空对空通过，必须单独拦').toBeGreaterThan(0)
    })

    // ⚠️ 有意窄覆盖（不得默默不覆盖）：本判据认的是**纯文本**里出现
    //    `var(--md-scrim-overlay)` 字面量。已登记**两处**抓不到什么：
    //
    //    ① 一张压在作品图上、却**没有**渐变的卡（纯硬边色块）不会被自动发现 ——
    //       而按本门禁的既定定义，没有渐变就不算「与作品图融合」的沉浸卡，
    //       它本就该被现有断言（渐变不可删）在**已登记**的消费点上拦住。
    //    ② **判据看不见经 `:style` / composable 间接注入的渐变**。若新卡写成
    //       `:style="{ background: scrimGradient }"`、渐变常量定义在 composable 里，
    //       该 `.vue` 内没有令牌字面量 ⇒ 不入候选 ⇒ 集合相等恒绿。**② 与 ① 是不同
    //       的情形**：① 是「根本没有渐变」，② 是「有渐变但判据看不见」，后者更隐蔽。
    //       登记若只写 ①，读的人会误以为没有缺口。实测当前仓**零例**（全仓含该字面量
    //       的仅三个消费点 `.vue` 与两个 `.ts` 夹具），属**潜伏**而非现存漏判。
    //
    //    为何两处都不补兜底判据：① 要在类串层面表达「压在作品图上」需读布局属性，
    //    机器数不出来；② 要追 composable 的间接引用，等于把发现判据从「与概念同义」
    //    退化成「追数据流」，只会引入误抓。写明是为了让它们成为**已登记的决定**而非疏漏。
  })
  // ── #1004：沉浸卡自发现（原「只认三个硬编码文件名」） ────────────────────
  //
  // 本组验的是**发现判据**与**双向集合夹逼**两件事的纯函数形态（缝二）。
  // 遍历层（哪些文件会被喂进来）在 walkProductionVue 自身的测试里下针（缝一）。
  //
  // ⚠️ 发现判据为什么认「用了 scrim 渐变令牌」而不是底色块形状
  //    （bg-inverse-surface + rounded-lg）：形状档位会变，全仓在用 5 种
  //    rounded-*，而 scrim 令牌的既定用途就是「与作品图融合」——它与
  //    「什么算一张沉浸卡」同源，与门禁自身「渐变不能被删」的断言也不会打架。
  describe('沉浸卡自发现：发现判据认的是 scrim 渐变，不是底色块形状', () => {
    it('真实沉浸卡源码 ⇒ 是候选（oracle：样例本身确实带该令牌）', () => {
      expect(REAL_CARD_SRC, '真实样例必须自带该令牌，否则夹具证明不了任何事').toContain(
        'var(--md-scrim-overlay)',
      )
      expect(isImmersiveCardSource(REAL_CARD_SRC)).toBe(true)
    })

    it('只有底色块形状、无 scrim 渐变 ⇒ 不是候选（形状档位会变，不能当发现判据）', () => {
      expect(isImmersiveCardSource('<view class="bg-inverse-surface rounded-lg">标题</view>')).toBe(false)
    })

    it('注释里提到 scrim 令牌 ⇒ 不是候选（判据必须落在代码本文上）', () => {
      // 三种注释形态都要剥：HTML 注释、`//` 行注释、**CSS 块注释**。
      // ⚠️ CSS 块注释是 code-review 实测补上的：原来的剥法不剥块注释，而 `.vue`
      //    的 `<style>` 里只要提一句「旧写法：var(--md-scrim-overlay)」，该文件就会
      //    被算成候选 ⇒ 集合相等判红并点名一个**根本没写沉浸卡**的文件（fail-closed 误诊）。
      const SLASH_STAR = '/' + '*'
      const STAR_SLASH = '*' + '/'
      for (const src of [
        '<!-- 这里记得写 var(--md-scrim-overlay) -->\n<view />',
        '// var(--md-scrim-overlay)\n<view />',
        `<style>${SLASH_STAR} 旧写法：var(--md-scrim-overlay) ${STAR_SLASH}</style>\n<template><view /></template>`,
        `<style scoped>\n${SLASH_STAR} var(--md-scrim-overlay) ${STAR_SLASH}\n.x { color: red }\n</style>`,
      ]) {
        expect(isImmersiveCardSource(src), `注释形态不该入候选：${src.slice(0, 40)}`).toBe(false)
      }
    })

    // ⚠️ characterization（钉住**已知失效面**，不是 specification）：下面断言的是
    //    「当前**会**误判」这一事实，不是「应该这样」。它存在的意义是让
    //    「行尾 // 注释不被识别」这条登记**可执行、可观察**，而不是只躺在散文里；
    //    将来有人扩了剥法，这条会红 —— 那正是应该发生的事（届时请同步删掉上方
    //    的失效面登记并说明新判据为何不再 fail-closed）。
    //    断言方向写死为 true，故只描述现状、不隐含改进承诺。
    it('【characterization·已知失效面】行尾 // 注释仍会被误判为候选', () => {
      expect(isImmersiveCardSource('const a = 1 // var(--md-scrim-overlay)\n<view />')).toBe(
        true,
      )
    })
  })

  describe('沉浸卡自发现：清单与扫描结果双向相等（漏网 / 过期都暴露）', () => {
    const REGISTERED = ['pages/Recommended.vue', 'pages/NovelIntro.vue']
    const REAL = '<view style="background:linear-gradient(var(--md-scrim-overlay))" />'

    it('两侧相等 ⇒ 无诊断', () => {
      expect(consumerSetDiagnosis(REGISTERED, REGISTERED)).toBeUndefined()
    })

    it('漏网侧：扫描出的文件不在清单里 ⇒ 点名该文件', () => {
      const msg = consumerSetDiagnosis([...REGISTERED, 'pages/NewCard.vue'], REGISTERED)
      expect(msg, '漏网必须判红').toBeDefined()
      expect(msg).toContain('pages/NewCard.vue')
      expect(msg).toContain('未入判')
    })

    it('过期侧：清单里的文件扫描不到 ⇒ 点名该清单项', () => {
      const msg = consumerSetDiagnosis(['pages/Recommended.vue'], REGISTERED)
      expect(msg, '清单过期必须判红').toBeDefined()
      expect(msg).toContain('pages/NovelIntro.vue')
      expect(msg).toContain('清单')
    })

    it('扫描到 0 个候选 ⇒ 报「扫描面退化」而不是谎报「清单过期」', () => {
      const msg = consumerSetDiagnosis([], REGISTERED)
      expect(msg).toBeDefined()
      expect(msg).toContain('退化')
      expect(msg).not.toContain('清单')
    })

    it('两侧同时为空 ⇒ 仍判红（「什么都没扫到」与「仓里真的没有」同形）', () => {
      const msg = consumerSetDiagnosis([], [])
      expect(msg, '空对空是最典型的恒真陷阱，必须拦').toBeDefined()
      expect(msg).toContain('退化')
    })
  })

  // ── 缝一：遍历层（合成树）。纯函数缝证得了逻辑，证不了「真实遍历有没有把
  //    对的文件喂进来」——而后者正是 #1004 的失效面本身。合成树用真实卡源码。
  describe('沉浸卡自发现：遍历层（合成树，#1004）', () => {
    /** 在临时目录造一棵源码树，返回「遍历 + 发现」给出的候选键。 */
    function candidatesOf(files: Record<string, string>): string[] {
      const root = fs.mkdtempSync(path.join(tmpdir(), 'immersive-discovery-'))
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content, 'utf-8')
      }
      return discoverImmersiveCards(root)
    }

    it('新卡被发现；.ts 夹具与 errorPrototype 原型页不入候选', () => {
      expect(
        candidatesOf({
          'pages/NewCard.vue': REAL_CARD_SRC,
          // src 下真实存在这类夹具（*.template.test.ts），它们也含该令牌。
          // 遍历不过滤扩展名 ⇒ 凭空多出候选，集合相等当场判红。实测曾真会如此。
          'pages/NewCard.template.test.ts': REAL_CARD_SRC,
          'errorPrototype/ErrorPagePreview.vue': REAL_CARD_SRC,
          'components/Plain.vue': '<template><view /></template>',
        }),
      ).toEqual(['pages/NewCard.vue'])
    })

    it('合成树里出现的新卡 ⇒ 端到端判红并点名（判别力自检）', () => {
      const msg = consumerSetDiagnosis(
        candidatesOf({ 'pages/NewCard.vue': REAL_CARD_SRC }),
        registeredKeys(),
      )
      expect(msg, '新卡不入判 ⇒ 门禁必须判红，否则本组与整个 #1004 都是恒真的').toBeDefined()
      expect(msg).toContain('pages/NewCard.vue')
    })
  })
