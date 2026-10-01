/**
 * `--shimmer-motion` 骨架屏闸门的**接线与形态**门禁。
 *
 * ## 为什么需要这个文件（背景，别只当格式检查看）
 * 根 `<page>` 在「减弱动效」偏好开启时经内联 `:style` 注入
 * `--shimmer-motion: none`，全树 `.shimmer` 消费它。
 * code-review 提出一条 MAJOR：若 Lynx 支持 `var()` 却不支持**回退实参**，
 * 变量未定义时整条 `animation` 会落入 invalid-at-computed-value-time ⇒ 取 `none`
 * ⇒ **全站 79 处骨架屏同时消失**；而该变量只在偏好**开启**时注入，
 * 受害者是**所有**用户（偏好关闭 ⇒ 变量恒未定义），且不报错。
 *
 * 该推断已被真机实测**推翻**（2026-09-30，pictelio_ui / API 34 / 1080×2160）：
 * 冷启动连拍 8 帧、间隔 260ms、限内容区逐像素比对（阈值 |Δ|>6）——
 *   骨架期 frame1↔2 **47.84%**、frame1↔4 **43.27%**、frame1↔5 5.15%  ← 在动
 *   阴性对照 frame6↔7 **0.00%**（内容加载完，静止）                      ← 探针能分辨动/不动
 * 拍摄时偏好关闭（变量未定义），shimmer 照常播 ⇒ Lynx 解析回退实参。
 *
 * **但实测结论写在注释里，注释会被后人「顺手改简洁」**。
 * 所以这里把「消费点必须带回退实参」锁成机器判据：
 * 一旦有人把 `var(--shimmer-motion, …)` 改成裸 `var(--shimmer-motion)`，
 * 门禁立刻转红并指回 App.vue 的注释去看实测数据。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = fileURLToPath(new URL('./App.vue', import.meta.url))

/** 剥注释后再做形态匹配。
 *
 *  ⚠️ 必须剥：本文件的脚本区注释里**画了一个反面示例**
 *  `「根 page 挂降级类 + .降级类 .shimmer { animation: none }」`，
 *  它长得和真规则一模一样。第一版没剥，`/\.shimmer \{[^}]*\}/` 命中的是**这段注释**
 *  （`animation: none`，且没有 var()）⇒ 判据把示例当实现，红得莫名其妙。
 *  「注释里的示意代码」是形态判据最常见的误伤源，本轮第 N 次。 */
const stripComments = (s: string): string =>
  s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

const app = readFileSync(APP, 'utf8')
const code = stripComments(app)

/** 脚本侧注入的变量名，必须与 <style> 里的消费点逐字一致 */
const VAR_NAME = '--shimmer-motion'

describe('--shimmer-motion 闸门：变量名配对 + 回退实参必须在', () => {
  it('脚本侧注入的变量名与 <style> 消费点逐字一致', () => {
    expect(code).toMatch(/const SHIMMER_MOTION_VAR = '--shimmer-motion'/)
    expect(code).toContain(`var(${VAR_NAME},`)
  })

  it('.shimmer 的 animation 必须带回退实参（裸 var() 会让偏好关闭的全站骨架屏消失）', () => {
    const block = /\.shimmer \{[^}]*\}/.exec(code)?.[0]
    expect(block, '没找到 .shimmer 规则').toBeDefined()
    const decl = /animation:\s*([^;]+);/.exec(block!)?.[1] ?? ''
    expect(decl, '没找到 .shimmer 的 animation 声明').not.toBe('')
    expect(
      decl,
      `animation 是 ${decl} —— 缺回退实参。偏好关闭时 --shimmer-motion 恒未定义，` +
        '若引擎不解析回退实参，整条 animation 取初始值 none ⇒ 全站骨架屏消失。' +
        '（实测 Lynx 确实解析回退，但去掉它没有任何好处，只留下这个风险面。）',
    ).toContain(`var(${VAR_NAME},`)
  })

  it('闸门只在偏好开启时注入（注入条件不得放宽成「总是注入」）', () => {
    // 总是注入 none ⇒ 骨架屏永远不闪；无条件注入 '' ⇒ 永远闪。两种都是错的方向。
    expect(code).toMatch(/\.\.\.\(animationStyle\.value \? \{ \[SHIMMER_MOTION_VAR\]: animationStyle\.value \} : \{\}\)/)
  })

  it('注释里保留「真机实测已排除回退不生效」这一结论（防被顺手删掉后又重新怀疑）', () => {
    expect(app).toMatch(/真机实测已排除该风险/)
    expect(app, '实测百分比是判据的证据，随手改数字等于把结论变成传闻').toContain('47.84%')
    expect(app).toContain('0.00%') // 阴性对照，证明探针能分辨动/不动
  })
})
