// ─── 沉浸态影院底（#896）───
//
// 问题：方形作品在竖屏上按原比例渲染（100vw）必然短于视口 ⇒ 沉浸态下
// 底部露出页面底色（实测 (248,250,255)），读作「布局坏了」而非「沉浸」。
//
// 关键认知：**方图在竖屏上不可能既铺满又不变形**。所以修法不是拉伸图片
// （会变形），而是让露出的区域变成**影院黑边**，这是所有图库/相册的既有做法。
//
// 本文件只锁「露出的底色该是什么」这一条纯逻辑，不碰模板。
import { describe, expect, it } from 'vitest'

import { immersiveBackdropClass } from './immersiveBackdrop'

describe('沉浸态影院底（#896）', () => {
  it('沉浸态 ⇒ 影院黑边（不是页面底色）', () => {
    // 期望值溯源：沉浸态的唯一目的是「只剩画」，露出的区域必须视觉上退到画之后 ⇒ 近黑
    expect(immersiveBackdropClass(true)).toBe('bg-black')
  })

  it('非沉浸态 ⇒ 保持原页面底色（不得改变既有阅读排版）', () => {
    // oracle = 现有页面根类名 bg-surface（IllustDetail.vue 模板实读）
    expect(immersiveBackdropClass(false)).toBe('bg-surface')
  })

  it('⚠️ 判别力：两种状态必须给出不同值（否则本判据恒真）', () => {
    expect(immersiveBackdropClass(true)).not.toBe(immersiveBackdropClass(false))
  })

  it('影院底不得引入 MD3 surface 角色（那是浅色系，正是本缺陷的元凶）', () => {
    // 回归防线：若有人「顺手」改成 surface-container-* 变体，露出的仍是浅色 ⇒ 缺陷复现
    expect(immersiveBackdropClass(true)).not.toMatch(/surface/)
  })
})
