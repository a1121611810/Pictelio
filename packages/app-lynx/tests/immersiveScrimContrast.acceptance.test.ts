// #1005/#1012 与 #1003 的**验收组**（#1009 拆分自 immersiveScrimContrast.test.ts）。
//
// ⚠️ 与真门禁的关系：这里只做「变异注入 + 反事实」的判别力验收，**不参与真判据**。
//    所有判定走 ./helpers/immersiveScrimShared.ts 的共享函数 —— 抄副本的话，
//    真门禁把判据删掉，这里照样绿（正是被「拔掉真门禁接线、57/57 照样全绿」那次
//    code-review 钉死的 F1：真门禁与验收组必须共用**接线** judgeConsumerColours）。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  CONSUMERS,
  PALETTES,
  colourTokenNames,
  colourTokenViolation,
  extractPlates,
  missingPlateMessage,
  plateAlphaViolation,
  stripVueComments,
  titleTagClassOf,
} from './helpers/immersiveScrimShared'

  // ── #1005/#1012 验收：颜色令牌解析面（变异注入，不落盘）──────────────────
  //
  // ⚠️ 与 #1003 那一组同纪律：反事实必须**编码进产物**，不能只写在注释里。若只写「旧实现会
  //    取错」，谁都无法复核。旧解析内核原样落成 `OLD_RESOLVE`，下方逐形态断言它**一律返回
  //    看似合理的 token 名**（即恒真），而新判定会点名。双侧从此永久可复核。
  describe('#1005/#1012 验收：颜色令牌解析面（变异注入，不落盘）', () => {
    const ref = PALETTES[0]
    /**
     * 标题 needle 形态。**从 `CONSUMERS` 派生而非手抄**（测试硬约束 #2）：
     * 手抄一份的后果是 `CONSUMERS` 改了夹具不跟，两边悄悄不同形而**无人发现** ——
     * 那正是本文件头自己写着的「不能手写『自洽』的 class/style 串」。
     */
    const NEEDLE = CONSUMERS[0].titleMarker
    /**
     * 合法底色块：**取自真实源文件**（同上，硬约束 #2 的真实样例要求）。
     * 叠了第二个颜色类的形态由它派生，保证两者只差一个类。
     */
    const PLATE_OK = extractPlates(
      stripVueComments(fs.readFileSync(path.resolve(__dirname, CONSUMERS[0].rel), 'utf-8')),
    )[0]!
    const PLATE_BAD = `${PLATE_OK} bg-surface-container`

    /**
     * #1012 修复前的解析内核，原样保留（`git show HEAD:…` 可核对）：
     * 按令牌存在性筛出命中项后**取第一个**。
     *
     * ⚠️ 它对「叠第二个颜色类」「元素换色」一律**不报错**，都吐得出一个 token 名 ——
     *    这就是它的恒真性所在。下面对三种形态逐条把这个「不报错」钉死。
     */
    // ⚠️⚠️ **禁止改写为调用 colourTokenNames**（review S9）：OLD_RESOLVE 与被验函数
    //    体相同是**刻意**的反事实设计 —— 一旦「顺手去重」改成调用被验函数，本组对
    //    「旧实现恒不报错」的断言就变成同义反复（恒真），反事实永久失效。
    const OLD_RESOLVE = (cls: string, prefix: 'bg' | 'text'): string | undefined => {
      const names = [...cls.matchAll(new RegExp(`${prefix}-([\\w-]+)`, 'g'))]
        .map((m) => m[1])
        .filter((n) => ref.tokens.has(n))
      return names[0]
    }

    /** 把 .vue 源码 + needle 送进**真门禁那条组合路径**（共享函数，非副本）。 */
    const judgeTitle = (src: string, needle = NEEDLE): string | undefined =>
      colourTokenViolation('夹具', '标题', titleTagClassOf(src, needle) ?? '', 'text', ref)

    const judgePlate = (plate: string): string | undefined =>
      colourTokenViolation('夹具', '底色块', plate, 'bg', ref)

    it('接线自检：真门禁的**消费点 describe 必须真的调用**共享判定（F1 闭合）', () => {
      // 为什么需要这条（#1005 轮 review 实测的阻塞项）：共享**函数**挡不住「调用点被删」。
      // 实测三种变异 —— ① 删掉真门禁两处颜色判定；② 只删 bg 侧那处；③ 把标题退回读
      // `CONSUMERS` 常量（#1012 洞 2 的修复前行为）—— 验收组 **57/57 照样全绿**。
      // 本条用 source-scan 把「真门禁真的接上了」变成产物自证的断言。
      const file = fs.readFileSync(path.resolve(__dirname, 'immersiveScrimContrast.test.ts'), 'utf-8')
      const gateStart = file.indexOf("describe('三个消费点确实用上了稳定底色")
      expect(gateStart, '消费点 describe 必须存在').toBeGreaterThan(-1)
      // 本验收组的 describe 排在真门禁**之后**，用它当右边界 ⇒ 切出的正是真门禁那段。
      // #1009 拆分后：消费点 describe 是真门禁文件里的**最后一个** describe（其后只有 #891
      // 收尾的括号），右边界直接取文件末尾。将来若在消费点判据之后再追加 describe，
      // 也会落入本自检的扫描面 —— 这是**保守方向**（宁多扫不误漏）。
      const gateBody = file.slice(gateStart)
      expect(
        gateBody,
        '真门禁必须经由共享接线 judgeConsumerColours 取颜色判定（不得内联调 colourTokenViolation）',
      ).toContain('judgeConsumerColours(')
      expect(
        gateBody,
        '真门禁**禁止**再内联调 colourTokenViolation（否则「接线」又退回各自一份）',
      ).not.toContain('colourTokenViolation(')
    })

    it('洞 1 的**判红文案**点名两个令牌（不是只报「有歧义」）', () => {
      const src = `<template><text class="${NEEDLE} text-primary">标题</text></template>`
      expect(judgeTitle(src)).toContain('2 个（inverse-on-surface、primary）')
    })

    it('洞 2 的「定位不到」是产物自证的（不是只活在注释里）', () => {
      // #1005 轮 review F10：此前这条「正是定位不到暴露了旧路径没读过源文件」只写在注释里。
      expect(
        titleTagClassOf(NEEDLE, NEEDLE),
        'needle 在**裸类串**（非源码）里定位不到标签 —— 这正是旧路径压根没读源文件的证据',
      ).toBeUndefined()
    })

    it('交互态变体前缀**不计入**颜色歧义（F6：hover 不改变静息颜色）', () => {
      // 改动前这一格会判红，且文案宣称「谁胜出取决于产物顺序」—— 该说法对 hover **不成立**，
      // 且 AGENTS.md「有意偏离 MD3」第 4 条已拍板 hover 在纯触屏判定为不适用。
      for (const variant of ['hover:', 'active:', 'focus-visible:']) {
        const src = `<template><text class="${NEEDLE} ${variant}text-primary">标题</text></template>`
        expect(judgeTitle(src), `${variant}text-primary 不应被判为第二个颜色令牌`).toBeUndefined()
      }
      // ⚠️ 模式类前缀**仍要计入**：`dark:` 在某条件下确实改变静息颜色，而本判据是绝对下界。
      const dark = `<template><text class="${NEEDLE} dark:text-primary">标题</text></template>`
      expect(judgeTitle(dark), 'dark:text-primary 确实改变静息颜色，必须计入').toContain('2 个')
    })

    it('`/alpha` 修饰符不会让底色块被判成「零个」（#897 判红能力不得被抢跑）', () => {
      // `colourTokenNames` 改成按空白切分后，`<alpha>` 必须仍被截掉 ——
      // 否则 `inverse-surface/70` 查不到令牌 ⇒ 「零个」判红会抢在 `plateAlphaViolation` 之前。
      const v = judgePlate('bg-inverse-surface/70 rounded-lg')
      expect(v, '带 /alpha 的底色块仍抽得到唯一令牌，不该报「零个」').toBeUndefined()
    })

    it('反事实：旧内核对三类叠加形态**一律不报错**（它的恒真性在此被钉死）', () => {
      // ① text 侧、needle **之后**追加第二个颜色类
      expect(OLD_RESOLVE(`${NEEDLE} text-primary`, 'text')).toBe('inverse-on-surface')
      // ② bg 侧、合法底色**之后**追加
      expect(OLD_RESOLVE(PLATE_BAD, 'bg')).toBe('inverse-surface')
      // ③ bg 侧、合法底色**之前**插入
      expect(OLD_RESOLVE(`bg-surface-container ${PLATE_OK}`, 'bg')).toBe('surface-container')
      // ⚠️ ② 与 ③ 的结论**不同，但都不是「歧义判红」** —— 这一点务必分清（#1005 轮 review 实测）：
      //    ② 改前**静默全绿**（fail-open 漏过）：`resolve` 取首个命中的 `inverse-surface`，
      //      数字纹丝不动。
      //    ③ 改前**判红，但报的是错根因**（fail-closed 误诊）：bg 侧读的是**源文件**，
      //      `resolve` 取到了新插入的 `surface-container` ⇒ 对比度按错底色算成 1.03，
      //      诊断指向「底色不达标」而非「底色块上叠了两个颜色类」。
      //    ⇒ 两侧都需要「恰好一个」判据，但**病因不同**：text 侧是**读常量**（看不见源文件），
      //      bg 侧是**取首个**（看得见但挑错）。⚠️ 曾把 ③ 误记为「改前也全绿」并据此推出
      //      「与读不读源文件无关」—— 该推论**已被实测否掉**（③ 正是 bg 侧读源文件才会红）。
    })

    it('洞 1 · text 侧：needle 之后叠加第二个颜色类 ⇒ 判红并点名两个令牌', () => {
      const src = `<template><text class="${NEEDLE} text-primary">标题</text></template>`
      expect(judgeTitle(src)).toContain('2 个')
      expect(judgeTitle(src)).toContain('inverse-on-surface、primary')
    })

    it('洞 1 · bg 侧：**前置与后置**叠加第二个颜色类都判红（只验一种会漏掉另一种）', () => {
      expect(judgePlate(PLATE_BAD), '后置').toContain('2 个')
      expect(judgePlate(`bg-surface-container ${PLATE_OK}`), '前置').toContain('2 个')
    })

    it('洞 2 · 文字色必须从**源文件实写**解析：常量合规而源文件违规时必须判红', () => {
      const src = `<template><text class="${NEEDLE} text-primary">标题</text></template>`
      // 旧实现的喂法 = **直接把 `CONSUMERS` 里的期望常量当类串判**。该常量本身恰好一个颜色
      // 令牌 ⇒ 合规 ⇒ 旧路径对同一处源文件违规**判不出任何东西**。
      // ⚠️ 此处刻意**不走** `titleTagClassOf`：常量不是源码，needle 在其中定位不到标签。
      //    正是这一「定位不到」暴露了旧路径压根没读过源文件。
      expect(
        colourTokenViolation('夹具', '标题', NEEDLE, 'text', ref),
        '期望常量本身应判为合规',
      ).toBeUndefined()
      expect(OLD_RESOLVE(NEEDLE, 'text'), '旧内核对常量照常吐得出值').toBe('inverse-on-surface')
      // 新实现的输入是源文件实写 class。**同一份 needle**，源文件违规 ⇒ 必须判红。
      expect(judgeTitle(src), '源文件实写 class 违规时必须判红').toContain('2 个')
    })

    it('零个颜色令牌同样判红（不是「取不到就跳过」）', () => {
      const src = '<template><text class="text-title-large">标题</text></template>'
      expect(judgeTitle(src, 'text-title-large')).toContain('零个')
    })

    it('反向对照：合法形态不得判红（含 needle 定位抽取的三格形态）', () => {
      for (const tag of [
        `<text class="${NEEDLE}">标题</text>`,
        `<text :aria-label="t" class="${NEEDLE}">标题</text>`,
        `<text class='${NEEDLE}'>标题</text>`,
        `<text\n  class="${NEEDLE}">标题</text>`,
      ]) {
        const src = `<template>${tag}</template>`
        expect(titleTagClassOf(src, NEEDLE), `needle 应定位到标签：${tag}`).toBe(NEEDLE)
        expect(judgeTitle(src), `合法形态不应判红：${tag}`).toBeUndefined()
      }
      expect(judgePlate(PLATE_OK), '合法底色块不应判红').toBeUndefined()
    })

    it('【characterization】三个真消费点的标题与底色块**恰好各一个**颜色令牌（真门禁的输入本身合规）', () => {
      for (const c of CONSUMERS) {
        const src = stripVueComments(fs.readFileSync(path.resolve(__dirname, c.rel), 'utf-8'))
        const titleClass = titleTagClassOf(src, c.titleMarker) ?? ''
        expect(colourTokenNames(titleClass, 'text', ref), `${c.name} 标题的颜色令牌`).toHaveLength(
          1,
        )
        for (const plate of extractPlates(src)) {
          expect(
            colourTokenNames(plate, 'bg', ref),
            `${c.name} 底色块的 bg- 颜色令牌：${plate}`,
          ).toHaveLength(1)
        }
      }
    })
  })
  // ── #1003 验收：抽取面真实失效面 = 三格，全部按变异验证 ──────────────────
  //
  // 纪律：**不接受「读代码觉得没问题」**。每一格都把违规写法**喂进同一个抽取器**，
  // 要求它抽到那个带 `/70` 的底色块；抽不到即判红。
  //
  // ⚠️ 为什么这组与 #1001 的方向相反：#1001 要求「跨行写法要能抽到」，
  //    那是**基于一个被否掉的前提**（实测：旧正则的 `\s` 与 `[^"]` 都匹配换行，
  //    跨行今天就能抽到）。照 #1001 写会得到一条**恒真的判别力自检**——
  //    它在改动前也绿、抓不到任何东西。本组把跨行写成**回归守卫**（钉住
  //    「重写没把这个本来能过的形态弄丢」），而不是新的判红能力。
  //
  // 期望值出处（oracle 溯源）：三格形态来自 #1003 票面逐条实测的变异矩阵。
  //
  // ⚠️「反事实」必须**编码进产物**，不能只写在注释里（code-review 发现）：此前本组声称
  //    「在旧实现上复现旧 0 / 新 1 的双向对照」，但旧正则只作为字符串出现在注释中，
  //    **产物不自证** —— 谁都无法复核那个 0。于是 `OLD_PLATE_RE` 把旧实现原样落成常量，
  //    下方「反事实」一条对它逐形态断言 0 命中：反事实从此永久可复核。
  describe('#1003 验收：底色块抽取面（变异注入，不落盘）', () => {
    /**
     * #1003 修复前的抽取器，原样保留（`git show HEAD:…` 可核对）。
     *
     * 它的存在只为让「旧实现抽不到、新实现抽得到」这个反事实**可复核** ——
     * 三格形态各断言它 0 命中、跨行形态断言它 1 命中（后者是 #1001 错误前提的实证）。
     */
    const OLD_PLATE_RE = /<view\s+class="([^"]*)"/g
    /** 用旧抽取器抽底色块（与 `extractPlates` 的过滤条件保持一致） */
    const oldPlates = (src: string): string[] =>
      [...src.matchAll(OLD_PLATE_RE)]
        .map((m) => m[1]!)
        .filter((cls) => cls.includes('bg-inverse-surface') && cls.includes('rounded-lg'))

    /** 底色块的**违规**形态：带 alpha 修饰符，`/70` 必须能被下游断言点名 */
    const PLATE_BAD = 'bg-inverse-surface/70 rounded-lg'
    /** 底色块的**合法**形态（反向对照用） */
    const PLATE_OK = 'bg-inverse-surface rounded-lg'

    it('反事实：旧抽取器对三格形态**一律抽不到**（#1001 的错误前提在此被否）', () => {
      // 这条是本组「判别力」的地基：没有它，下面三格「旧 0 / 新 1」只是注释里的说法。
      for (const src of [
        `<view class='${PLATE_BAD}'>x</view>`,
        `<view v-if="visible" class="${PLATE_BAD}">x</view>`,
        `<text class="${PLATE_BAD}">x</text>`,
      ]) {
        expect(oldPlates(src), `旧实现应抽不到：${JSON.stringify(src)}`).toHaveLength(0)
        expect(extractPlates(src), `新实现应抽得到：${JSON.stringify(src)}`).toHaveLength(1)
      }
      // ⚠️ 跨行是**唯一**旧实现也能过的形态 —— #1001 把「跨行抽不到」当核心前提是错的。
      //    这条同时钉住跨行是回归守卫、不是新判红能力（见下方「回归守卫」用例）。
      const multiline = `<view\n  class="${PLATE_BAD}">x</view>`
      expect(oldPlates(multiline), '旧实现对跨行**抽得到** ⇒ #1001 前提被否').toHaveLength(1)
      expect(extractPlates(multiline), '新实现对跨行也应抽得到').toHaveLength(1)
    })

    it('失效面 ①：单引号 class 抽得到，且能被真门禁点名 /70', () => {
      const src = `<view class='${PLATE_BAD}'>标题</view>`
      expect(extractPlates(src), '单引号写法的底色块应被抽出').toHaveLength(1)
      // 验收 1 的完整要求是「判红且**点名 /70**」⇒ 走真门禁那条共享判定，
      // 不是自己抄一份正则（抄副本 = 验的不是真门禁，见 plateAlphaViolation 注释）。
      expect(plateAlphaViolation('单引号', extractPlates(src)[0]!)).toContain('/70')
      // 反向对照：同一形态但合法底色（无 /70）时，**下游 alpha 断言不得判红**
      const ok = extractPlates(`<view class='${PLATE_OK}'>标题</view>`)
      expect(ok).toHaveLength(1)
      expect(plateAlphaViolation('单引号合法', ok[0]!)).toBeUndefined()
    })

    it('失效面 ②：class 不是第一个属性 抽得到，且能被真门禁点名 /70', () => {
      // 背景类刻意**不放在标签首位**，避免新实现「见标签就红」的假阳性混进来
      const src = `<view v-if="visible" class="${PLATE_BAD}">标题</view>`
      expect(extractPlates(src), 'class 前有属性时底色块应被抽出').toHaveLength(1)
      expect(plateAlphaViolation('class 非首属性', extractPlates(src)[0]!)).toContain('/70')
      // v-for / :key 形态（runner 卡就是这种顺序）
      const keyed = extractPlates(
        `<view v-for="x in list" :key="x.id" class="${PLATE_BAD}">标题</view>`,
      )
      expect(keyed, 'v-for + :key + class 形态应被抽出').toHaveLength(1)
      expect(plateAlphaViolation('v-for+key', keyed[0]!)).toContain('/70')
    })

    it('失效面 ③：非 <view> 标签 抽得到，且能被真门禁点名 /70', () => {
      for (const tag of ['text', 'image']) {
        const plates = extractPlates(
          `<${tag} class="${PLATE_BAD}"${tag === 'image' ? ' /' : ''}>标题</${tag}>`,
        )
        expect(plates, `${tag} 标签应被抽出`).toHaveLength(1)
        expect(plateAlphaViolation(tag, plates[0]!), `${tag} 标签应点名 /70`).toContain('/70')
      }
    })

    it('反向对照：以上三格的**合法**写法（无 /70）不得被当成违规', () => {
      // 证明新抽取器不是「见标签就红」的假阳性源：不含 /70 时下游断言必须放过。
      for (const src of [
        `<view class='${PLATE_OK}'>标题</view>`,
        `<view v-if="visible" class="${PLATE_OK}">标题</view>`,
        `<text class="${PLATE_OK}">标题</text>`,
      ]) {
        const plates = extractPlates(src)
        expect(plates, `合法写法应被抽出：${src}`).toHaveLength(1)
        expect(plateAlphaViolation('合法写法', plates[0]!), `合法写法不应判红：${src}`).toBeUndefined()
      }
    })

    it('反向对照：只有颜色没有圆角的元素不算底色块（形状约定未被放宽）', () => {
      // ⚠️ 这是**刻意不放宽**的一条：NovelIntro 的导出面板带 bg-inverse-surface
      //    + rounded-[var(--md-shape-medium)]，若只按颜色抽会被它满足掉。
      expect(
        extractPlates('<view class="bg-inverse-surface rounded-[var(--md-shape-medium)]">x</view>'),
        '无 rounded-lg 的 inverse 元素不应算底色块',
      ).toHaveLength(0)
    })

    it('回归守卫：跨行 class 本来就能抽到，重写**不能**把它弄丢', () => {
      // 这一格旧实现也过（`\s` 与 `[^"]` 都匹配换行）。它的作用是钉住「重写无退化」，
      // 断言它不是新的判红能力 —— 若哪天有人改回按行取，这里会红。
      //
      // ⚠️ brief checkbox 5 要求的不止「still extract」，还有「**still name `/70`**」
      //    ⇒ 两条都断言：抽到，且真门禁那条判定点名 `/70`。
      const cases = [
        `<view\n  class="${PLATE_BAD}">标题</view>`,
        `<view class="bg-inverse-surface/70\n  rounded-lg">标题</view>`,
      ]
      for (const src of cases) {
        const plates = extractPlates(src)
        expect(plates, `跨行写法应被抽出：${JSON.stringify(src)}`).toHaveLength(1)
        expect(
          plateAlphaViolation('跨行', plates[0]!),
          `跨行写法应仍被点名 /70：${JSON.stringify(src)}`,
        ).toContain('/70')
      }
    })

    it('HTML 注释里的底色块不算（负向：剥注释必须生效）', () => {
      // 这几个 .vue 写了大量解释「为什么不用 /85」的注释，注释里的命中会让
      // 死类名守卫自己打自己 ⇒ 抽取必须先剥注释。
      expect(
        extractPlates(`<!-- <view class="${PLATE_BAD}">注释里的反面示例</view> -->`),
        'HTML 注释里的底色块不应被抽出',
      ).toHaveLength(0)
    })

    it('<script> 块里的字符串字面量不算标签（只扫 template 块）', () => {
      // ⚠️ #1003 实施期自查发现的**新引入**失效面：`<script setup>` 里常有字符串字面量
      //    含尖括号（泛型 / 比较运算 / 测试夹具里的反例）。全文件扫标签会把它们当成
      //    真标签 ⇒ **凭空多出一块底色块**（方向 fail-open：误判红，不是漏过）。
      //    实测反例：`const s = "<view class='bg-inverse-surface/70 rounded-lg'>"`。
      const src = [
        `<script setup lang="ts">`,
        `const m = new Map<string, number>()`,
        `if (a < b && c > d) {}`,
        `const s = "<view class='${PLATE_BAD}'>"`,
        `</script>`,
        `<template><view class="${PLATE_OK}">真底板</view></template>`,
      ].join('\n')
      const plates = extractPlates(src)
      expect(plates, 'script 里的字面量不应被抽成底色块').toHaveLength(1)
      expect(plates[0], '只应抽到 template 块里那块').toBe(PLATE_OK)
      // 反向对照：script 里有字面量但 template 块里**真没有**底色块 ⇒ 抽不到
      const onlyScript = `<script>const s = "<view class='${PLATE_BAD}'>"</script><template><view>x</view></template>`
      expect(extractPlates(onlyScript), 'script 里的假底色块不应满足判据').toHaveLength(0)
    })

    it('诊断必须区分「压根没写底色块」与「写了但抽取器认不出」', () => {
      // ⚠️ 这条曾是个**恒真**用例：它重算一遍与被测实现同形的 `&&` 表达式来"验证"
      //    自己，而输入恰好不含 bg-inverse-surface ⇒ 无论真门禁怎么改都绿。
      //    现在 `missingPlateMessage` 已提成具名函数，用例直接断言**消息文本**。
      const noPlateAtAll = '<view class="rounded-lg">标题</view>'
      expect(extractPlates(noPlateAtAll)).toHaveLength(0)
      expect(missingPlateMessage('X', noPlateAtAll, [])).toContain('找不到稳定底色块')

      // 底色块存在、但两个类**分处两个元素**（抽取器认不出「同一个元素」的约定）⇒ 走「抽取器漏读」
      const splitAcross = `<view class="bg-inverse-surface"><view class="rounded-lg">标题</view>`
      expect(extractPlates(splitAcross)).toHaveLength(0)
      expect(missingPlateMessage('X', splitAcross, [])).toContain('被抽取器漏读')
      expect(missingPlateMessage('X', splitAcross, [])).not.toContain('找不到稳定底色块')
    })

    it('<script> 内含 <template> 字面量时也不能把 script 尾部扫进来', () => {
      // ⚠️ code-review 阻塞项：`templateBlock` 若用「首个开标签 + lastIndexOf 闭合」，
      //    起点会落在 script 内的 `"<template>…"` 字面量上、终点是真 template 闭合
      //    ⇒ script 尾部整段被并进扫描面，假底色块重现（实测抽出 2 块）。
      const src = [
        `<script setup lang="ts">`,
        `const doc = "<template>片段</template>"`,
        `const t = "<view class='${PLATE_BAD}'>"`,
        `</script>`,
        `<template><view class="${PLATE_OK}">真底板</view></template>`,
      ].join('\n')
      const plates = extractPlates(src)
      expect(plates, 'script 内的 <template> 字面量不得把 script 尾部并进扫描面').toHaveLength(1)
      expect(plates[0], '只应抽到 template 块里那块').toBe(PLATE_OK)
    })
  })
