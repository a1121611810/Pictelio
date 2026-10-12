// ─── 通知公共图标（s.pximg.net）· JS↔Java 契约 + 文档措辞门禁 ───
//
// 背景：spec 边界 5 与 ADR-0188 曾把 `content.*_icon`（s.pximg.net 公共图标）描述为
// 「沿用仓库既有直通行为」，并把原因归给「代理通道目标硬编码 i.pximg.net，多域承载需 Java 改动」。
// 该归因**已被证伪**（`OAuthConfig.IMAGE_CDN_URL` 只在 `rewriteUrl()` 里为 `/pixiv-img/{path}` 反查，
// 不是域名闸门；`canParseUrl` 对任意 `http` 开头 URL 放行），并于 2026-10-12 订正，
// 挂账票 #734 随之按「已实现」关闭并改 `wontfix`。
//
// seam 分工（本仓「三者不重复」纪律）：
//   · JVM 行为锚     = PictelioImageServiceTest#canParseUrl_sPximgStaticCdn_acceptedSameAsPixivCdn
//   · 缓存键域隔离   = PixivImageLoaderTest#cacheKey_sPximgUrl_notCollapsedIntoCdnDomain
//   · **本文件**     = 跨端接得上（JS 交出的 URL，Java 收不收得下）+ **文档不得复述失真陈述**
// 后两者都拦不住「人把文档改回旧话」；前两者都拦不住「JS 交出空串 ⇒ 图标静默消失」。
//
// ⚠️ 断言纪律（ADR-0163 (b)，本仓反复吃亏的成因）：
//   ① 文档断言跑在 proseOnly() 之后的正文上——围栏代码块与引用块（`>`）先剥掉。
//      **理由**：订正注必须允许**原样引用旧措辞**，否则作者只能写含糊的订正、读者无从比对。
//      **已知边界（实测坐实，非推测）**：把失真陈述藏进 `>` 引用块能绕过本文件——
//      Round 2 实测 M4「把 `IMAGE_CDN_URL` 只在 rewriteUrl() 里写回」时，第一次注入
//      落在订正注内 ⇒ 门禁绿；改注入到正文同款句子才转红。即**引用块是确凿的盲区**。
//      本仓约定引用块=订正/引述，故取舍成立；JVM 行为锚不依赖文本，收窄 `canParseUrl`
//      时仍会红。另：关键词表封闭，只能拦住它认识的写法——换一种措辞重犯同一失真不会被抓。
//   ② 跨端符号用「两侧**都**出现」而非单侧出现，单侧出现正是半接线形态。
//   ③ 每个检测器带**夹具自检**（真实形态命中 / 误报形态不命中），证明检测器非恒真。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { proxyImageUrl } from '../utils/imageUrl'

/** 宿主 Android 源码根（ADR-0203 决策 2：packages/app/android → packages/android-host/android） */
const HOST_APP = new URL('../../../android-host/android/app/src/', import.meta.url)
const REPO_ROOT = new URL('../../../../', import.meta.url)

/** 真实抓包 fixture（2026-09-26 落库）——s.pximg.net 样本从这里取，不手写（测试硬约束 #2） */
interface NotificationFixture {
  notifications?: { content?: { left_icon?: string; left_image?: string } | null }[]
}
const fixture = JSON.parse(
  readFileSync(new URL('../api/__fixtures__/notification-list.json', import.meta.url), 'utf8'),
) as NotificationFixture

/** fixture 中「只有 left_icon、没有 left_image」的条目——即 s.pximg 分支真实触发的那一类 */
function sPximgSamples(): string[] {
  return (fixture.notifications ?? [])
    .map((n) => n.content)
    .filter((c): c is { left_icon: string } => !!c?.left_icon && !c?.left_image)
    .map((c) => c.left_icon)
}

/** 宿主图片服务源码（读字面量；JVM 侧行为另由 PictelioImageServiceTest 钉死，两处不重复） */
const IMAGE_SERVICE_CODE = readFileSync(
  new URL('lynx/java/io/pictelio/app/PictelioImageService.java', HOST_APP),
  'utf8',
)

/**
 * 文件缺失时返回空串而非抛 ENOENT——顶层 readFileSync 抛出会让 vitest 记「0 用例」
 * 而不是逐条红，失去定位价值（同 deliveryProbeContract.test.ts 的先例）。
 */
function safeRead(url: URL): string {
  try {
    return readFileSync(url, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 剥掉围栏代码块与引用块，只留正文散文。
 *
 * ⚠️ 引用行必须容忍**前导缩进**：Markdown 允许把块引用嵌进列表项，写作
 * `  - 列表项` + `    > 订正注`（ADR-0188 的订正注就是这么写的）。早先只匹配
 * `/^>/`，于是缩进引用块原样留存、订正文里**原样引述的旧措辞**把本文件自己判红——
 * 而作者不会去改检测器，只会把订正注删掉，门禁随即退化成空壳。故此处用 `^\s*>`。
 *
 * 块注释必须先行——否则块内部的 `>` 行会被行引用规则先截断，留下半截内容。
 */
function proseOnly(md: string): string {
  return md.replace(/```[\s\S]*?```/g, '').replace(/^\s*>.*$/gm, '')
}

/**
 * 受检文档 → 其散文正文。
 * 三份都承载 s.pximg 相关的行为陈述，故都纳入：Round 1 的订正跨了三份文档，
 * 只守其中两份会让第三份成为盲区（`imagehost-native-fix.md` 的 Out of Scope 里
 * 就藏着一句「不经下载层」，是 Round 1 差点漏掉、靠 Spec 轴抓出来的阻塞项）。
 */
const DOC_PROSE: Record<string, string> = {
  'notification-center.md': proseOnly(
    readFileSync(new URL('docs/specs/notification-center.md', REPO_ROOT), 'utf8'),
  ),
  'ADR-0188': proseOnly(
    readFileSync(new URL('docs/adr/ADR-0188-notification-center.md', REPO_ROOT), 'utf8'),
  ),
  'imagehost-native-fix.md': proseOnly(
    readFileSync(new URL('docs/specs/imagehost-native-fix.md', REPO_ROOT), 'utf8'),
  ),
}

/**
 * 已证伪的失真陈述片段。
 * 刻意取**长片段**而非关键词：短词（如「直通」）在合法语境里也出现，会误红。
 *
 * ⚠️ 这张表必须随**每一次订正**增长（Round 2 review 抓到的自伤）：
 *   本表初版收的是 #734 挂账时的旧措辞家族（直通 / 多域承载 / 硬编码），
 *   但 Round 1 真正证伪并改掉的是另外两句——「不经下载层」与「IMAGE_CDN_URL 只在
 *   rewriteUrl() 里」。二者**都不在初版词表里** ⇒ 文档门禁覆盖不到本轮真正被推翻的
 *   那两句，将来谁把它们写回正文，门禁照样绿。**它当时只在拦它自己认识的那批老词。**
 *   故新增订正时，两句都要同时加进本表。
 */
const STALE_CLAIMS = [
  // —— #734 挂账时期的旧措辞家族 ——
  '沿用仓库既有直通行为',
  '代理通道硬编码',
  '承载不了多域',
  '多域承载需 Java 改动',
  '多域代理扩展挂账',
  // —— Round 1 订正时证伪并改掉的原句 ——
  '不经下载层',
] as const

/**
 * 同上的正则形态（片段写法盖不住时用）。取**受限窗口**而非裸词，
 * 避免「只有 / 只在」这类正常表述被误伤。
 */
const STALE_PATTERNS: readonly RegExp[] = [
  // 「IMAGE_CDN_URL 只在 rewriteUrl() 里」——真相是两个生产消费点，其中只有 rewriteUrl 参与反查
  /只在[^。\n]{0,16}rewriteUrl/,
]

function staleFoundIn(prose: string): string[] {
  return [
    ...STALE_CLAIMS.filter((c) => prose.includes(c)),
    ...STALE_PATTERNS.filter((re) => re.test(prose)).map((re) => re.source),
  ]
}

describe('通知公共图标（s.pximg.net）· JS↔Java 契约（spec notification-center 边界 5 / ADR-0188）', () => {
  describe('fixture 自检（防恒真 / 防夹具腐坏）', () => {
    it('fixture 里确有「只有 left_icon」的 s.pximg 条目（抽不出 ⇒ 下面全部断言恒失效）', () => {
      const samples = sPximgSamples()
      expect(samples.length, 'fixture 中已无「仅 left_icon」条目 ⇒ s.pximg 样本源失效').toBeGreaterThan(0)
      expect(samples[0]).toMatch(/^https:\/\/s\.pximg\.net\//)
    })

    it('proseOnly 确实剥掉了引用块与围栏（否则订正注里的原文引用会误红自己）', () => {
      const withQuote = '正文\n> 引用块里的旧措辞：承载不了多域\n'
      expect(withQuote).toContain('承载不了多域') // 朴素 toMatch 会命中
      expect(proseOnly(withQuote)).not.toContain('承载不了多域') // 本组形态：剥得掉

      // ⚠️ 缩进引用块（嵌在列表项里的订正注，ADR-0188 用的就是这种形态）：
      //   只匹配 `^>` 的检测器会漏掉它 ⇒ 订正注里原样引述的旧措辞把本文件判红，
      //   而作者的自然反应是删掉订正注 ⇒ 门禁退化成空壳。这条把该形态钉死。
      const indentedQuote = '  - 列表项\n    > 缩进引用块里的旧措辞：承载不了多域\n'
      expect(indentedQuote).toContain('承载不了多域')
      expect(proseOnly(indentedQuote)).not.toContain('承载不了多域')

      const withFence = '正文\n```\n承载不了多域\n```\n'
      expect(withFence).toContain('承载不了多域')
      expect(proseOnly(withFence)).not.toContain('承载不了多域')
    })
  })

  describe('跨端接得上（JS 交出的 URL，Java 收得下）', () => {
    it('JS 侧 proxyImageUrl 原样交出 s.pximg.net URL（既非空串也非代理路径）', () => {
      for (const sample of sPximgSamples()) {
        const out = proxyImageUrl(sample)
        expect(out, 's.pximg.net 被 JS 侧拒收 ⇒ 通知图标静默消失').not.toBe('')
        expect(out).not.toContain('/pixiv-img/')
        expect(out).toBe(sample) // 形态归一：交出原 URL，由 Java 侧接管
      }
    })

    it('JS 交出的形态落在 Java canParseUrl 的放行域内（接缝本体）', () => {
      // 收窄 canParseUrl 到域名白名单时，JS 交出的 s.pximg URL 将无人接管 ⇒ 图标静默消失。
      // JVM 侧行为由 PictelioImageServiceTest 钉死；本条钉的是**两侧接得上**这层，
      // 两侧各自的单测都证明不了它。
      //
      // ⚠️ 判据只用「不含域名白名单」这一条**否定式**，不钉 `||` 两析取项的完整字面量：
      //   早先钉了整条 return 表达式，等价重构（调换两析取项次序、提取局部变量）会误红，
      //   而那不是契约变化（review Standards 轴判为「复述实现 + 更脆」）。
      // ⚠️ 否定侧与肯定侧**必须切同一段**（Round 2 发现）：肯定侧早先扫的是「canParseUrl
      //   之后整份文件」，当下恰好等价，但若日后文件尾部新增含该串的方法、而 canParseUrl
      //   被掏空，两条断言会一起绿——掏空即恒真。已验证 `return false;` 变异确实转红。
      //
      // ⚠️ 已知失效面（门禁纪律第 5 条，显式登记）：域名判据必须带 `.net` 后缀，
      //   因为合法的代理路径标记 `/pixiv-img/` 本身就含子串 `pixiv`——短词正则会误伤它
      //   （本轮实测踩过：`/pximg|pixiv/` 把门禁判成了红）。代价是
      //   `url.contains("pixiv")` 这种**不带 `.net` 的宽松白名单**写法能溜过去。
      //   本仓不写这种写法；JVM 侧 `canParseUrl_sPximgStaticCdn_acceptedSameAsPixivCdn`
      //   兜住它的后果（真收窄了必然红），故不另加判据。
      const canParseFrom = IMAGE_SERVICE_CODE.indexOf('public boolean canParseUrl')
      const canParseRaw = IMAGE_SERVICE_CODE.slice(canParseFrom)
      const methodBody = canParseRaw.slice(0, canParseRaw.indexOf('\n    }'))
      expect(methodBody, '未能切出 canParseUrl 方法体').not.toBe('')
      expect(
        methodBody,
        'canParseUrl 自带 Pixiv 域名白名单 ⇒ JS 交出的 s.pximg URL 可能无人接管',
      ).not.toMatch(/pximg\.net|pixiv\.net/)
      // 肯定侧：放行判据仍含 http 前缀（否则上一条会退化成「反正什么都没限制」）
      expect(methodBody).toContain('startsWith("http")')
    })

    it('⚠️ JVM 测试里的 s.pximg 字面量必须与真实 fixture 同源（跨语言双源守卫）', () => {
      // JVM 侧读不到 app-lynx 的 fixture（模块边界），只能硬编码字面量 ⇒ 双源。
      // 本条是两侧的**同步守卫**：fixture 换样本时本条转红，提醒同步 JVM 侧。
      // 无此守卫时 fixture 与 JVM 字面量可各自漂移，而两边单测都会绿。
      const serviceTest = safeRead(
        new URL('test/java/io/pictelio/app/PictelioImageServiceTest.java', HOST_APP),
      )
      expect(serviceTest, '未读到 PictelioImageServiceTest.java').not.toBe('')
      for (const sample of sPximgSamples()) {
        expect(
          serviceTest,
          `JVM 侧没有引用 fixture 样本 ${sample} ⇒ 两侧样本漂移且无人报警`,
        ).toContain(sample)
      }
    })
  })

  describe('文档不得复述已证伪的失真陈述（#734 / Round 1 订正的措辞锚）', () => {
    it.each(Object.entries(DOC_PROSE))('%s 正文里已无陈旧措辞', (_name, prose) => {
      expect(staleFoundIn(prose), '复述了已证伪的「s.pximg 走直通 / 不经下载层」主张').toEqual([])
    })

    it.each(Object.entries(DOC_PROSE))('%s 仍在讨论 s.pximg（防「整段删掉也算通过」）', (_name, prose) => {
      expect(prose).toContain('s.pximg.net')
    })

    it('本组能抓到「把措辞改回旧文」（变异自证）', () => {
      // 订正前的 spec 边界 5 原文形态 ⇒ 必须被检出。
      const reverted =
        '5. **图片代理**：`content.*_icon`（`s.pximg.net` 公共图标）**v1 沿用仓库既有直通行为**' +
        '——代理通道硬编码 `i.pximg.net` 目标承载不了多域；多域代理扩展挂账（#734）。'
      expect(reverted).toContain('沿用仓库既有直通行为') // 朴素关键词查会命中
      expect(staleFoundIn(proseOnly(reverted)), '本组形态：拦不住 ⇒ 检测器已腐坏').not.toEqual([])
    })

    it('本组能抓到「把 Round 1 改掉的那两句原样写回」（变异自证 · Round 2 补）', () => {
      // ⚠️ 这两条曾**缺席于词表**：初版只收 #734 挂账时的老词，而这才是 Round 1 真正
      //   证伪并改掉的原句。缺了它们，门禁守的不是它该守的东西。
      const notInTable = '`s.pximg.net` 静态资源（不经下载层）'
      expect(staleFoundIn(notInTable)).not.toEqual([])

      const cdnOverclaim = '`OAuthConfig.IMAGE_CDN_URL` 只在 `rewriteUrl()` 里为 `/pixiv-img/{path}` 反查。'
      expect(staleFoundIn(cdnOverclaim)).not.toEqual([])

      // 反向自检：订正后的正确表述**不得**被误判
      const corrected = '两个生产消费点里只有 `rewriteUrl()` 参与 URL 反查（另一个是探针 baseUrl）。'
      expect(staleFoundIn(corrected), '正确表述被误判 ⇒ 正则窗口太宽').toEqual([])
    })
  })
})
