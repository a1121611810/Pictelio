import { describe, it, expect } from 'vitest'
import { createFabMenuState } from './createFabMenu'

describe('createFabMenuState', () => {
  it('初始状态：收起且不忙', () => {
    const menu = createFabMenuState()
    expect(menu.isOpen).toBe(false)
    expect(menu.isBusy).toBe(false)
  })

  it('toggle 在收起/展开之间切换', () => {
    const menu = createFabMenuState()
    menu.toggle()
    expect(menu.isOpen).toBe(true)
    menu.toggle()
    expect(menu.isOpen).toBe(false)
  })

  it('open 展开，close 收起', () => {
    const menu = createFabMenuState()
    menu.open()
    expect(menu.isOpen).toBe(true)
    menu.close()
    expect(menu.isOpen).toBe(false)
  })

  it('busy 时 toggle/open 被忽略（互斥不变量 #1）', () => {
    const menu = createFabMenuState()
    menu.startRefresh()
    expect(menu.isBusy).toBe(true)
    expect(menu.isOpen).toBe(false)

    menu.open()
    expect(menu.isOpen).toBe(false)

    menu.toggle()
    expect(menu.isOpen).toBe(false)
  })

  it('展开时 toggle 触发收起（close button 语义，互斥不变量 #2）', () => {
    const menu = createFabMenuState()
    menu.open()
    expect(menu.isOpen).toBe(true)

    menu.toggle()
    expect(menu.isOpen).toBe(false)
  })

  it('startRefresh 同时收起菜单并置忙（互斥不变量 #3）', () => {
    const menu = createFabMenuState()
    menu.open()
    menu.startRefresh()
    expect(menu.isOpen).toBe(false)
    expect(menu.isBusy).toBe(true)
  })

  it('endRefresh 释放 busy 但不影响 open', () => {
    const menu = createFabMenuState()
    menu.startRefresh()
    menu.endRefresh()
    expect(menu.isBusy).toBe(false)
    expect(menu.isOpen).toBe(false)

    menu.open()
    menu.endRefresh()
    expect(menu.isOpen).toBe(true)
  })

  it('reset 归零（互斥不变量 #4）', () => {
    const menu = createFabMenuState()
    menu.open()
    menu.startRefresh()
    menu.endRefresh()
    menu.open()
    menu.reset()
    expect(menu.isOpen).toBe(false)
    expect(menu.isBusy).toBe(false)
  })
})
