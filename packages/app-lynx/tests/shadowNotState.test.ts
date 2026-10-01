// ─── 阴影不得承担状态语义（#885 / ADR-0212 决策 6）───
//
// 两种语义混用：「阴影 = 高度」与「阴影 = 按下」。用户会把后者读成
// 「这张卡片被按下去浮起来了」，而不是「它响应了我的点击」。
//
// 本判据锁**结构契约**（元素声明了阴影族 active: 变体），不逐点指定修法 ——
// 修法可以是删阴影、可以换成透明度/状态层，门禁不挑。
import { describe, expect, it } from 'vitest'

import { SHADOW_STATE_VIOLATIONS } from './helpers/shadowStateCorpus'

describe('阴影不得承担状态语义（#885）', () => {
  it('生产 .vue 中不得存在 active:shadow-* 变体', () => {
    const hits = SHADOW_STATE_VIOLATIONS()
    expect(
      hits.map((h) => `${h.file}｜${h.token}`),
      '阴影被当作按压反馈使用。请改为透明度或状态层表达按压；' +
        '若该元素已有颜色状态层，直接删掉阴影声明即可（重复表达）。',
    ).toEqual([])
  })

  it('扫描面不得为空（防正则塌陷后全称断言静默恒真）', () => {
    // 阳性对照：判据必须真的能扫到东西。喂一个构造正样本，它必须被抓到。
    const synthetic = 'class="bg-x shadow-[var(--md-elevation-2)] active:shadow-[var(--md-elevation-1)]"'
    expect(SHADOW_STATE_VIOLATIONS(synthetic)).toHaveLength(1)
  })

  it('静止阴影不受本判据约束（对话框/FAB 的 elevation-3 是高度语义）', () => {
    const ok = 'class="bg-primary-container shadow-[var(--md-elevation-3)]"'
    expect(SHADOW_STATE_VIOLATIONS(ok)).toEqual([])
  })
})
