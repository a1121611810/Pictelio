// benchNav 场景注册跨语言奇偶校验契约（ADR-0136 / spec #753 / #754；模式 = galleryBridgeContract.test.ts
// / ADR-0174：JS 注册表 ↔ Java 事件派发字面量比对，任一侧漂移即红灯，oracle = 真实源码非手写自洽）。
//
// 背景：benchNav 场景有两处注册点——① JS 侧 router.ts 的 TARGETS / DYNAMIC_TARGETS（事件名 → 路由目标）；
// ② 原生侧 LynxActivity.onLoadSuccess 的 switch（scenario extra → sendGlobalEvent 事件名）。
// 历史缺陷：T4（/later）/ T7（/mypixiv）只注册了 ①，漏 ② → 深链静默不导航（模拟器首跑暴露）。
// 本测试钉死：router.ts 里每个 pictelioBenchNav* 事件名必须以字符串字面量出现在 LynxActivity.java，
// 反向不需要对称（Java payload 通道 illust-detail/novel-detail 不走 TARGETS）。
//
// Java 路径：随宿主迁移指向 **最终位置** `packages/android-host/android/`（ADR-0203 决策 2）。
// 本文件在 `tests/`（比 `src/utils/` 浅一级），故 `../../` 到 `packages/`，再进 `android-host/android/app/`。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routerSource = readFileSync(
  fileURLToPath(new URL('../src/router.ts', import.meta.url)),
  'utf8',
)
const lynxActivitySource = readFileSync(
  fileURLToPath(
    new URL(
      '../../android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java',
      import.meta.url,
    ),
  ),
  'utf8',
)

// 从 router.ts 的 TARGETS / DYNAMIC_TARGETS 对象字面量提取事件名（键名形态 pictelioBenchNavXxx:）
const jsEventNames = [
  ...new Set(routerSource.match(/pictelioBenchNav[A-Za-z]+(?=\s*:)/g) ?? []),
].sort()

describe('benchNav 场景注册跨语言奇偶校验（router.ts ↔ LynxActivity.java）', () => {
  it('router.ts 至少注册了已知的 benchNav 事件（防正则失配空转通过）', () => {
    expect(jsEventNames.length).toBeGreaterThanOrEqual(15)
    expect(jsEventNames).toContain('pictelioBenchNavLater')
    expect(jsEventNames).toContain('pictelioBenchNavMyPixiv')
    // 票 #929：书架段 3 与 /continue 的设备取证通道（无短名则真机进不去这两页）
    expect(jsEventNames).toContain('pictelioBenchNavShelf')
    expect(jsEventNames).toContain('pictelioBenchNavContinue')
  })

  it.each(jsEventNames)('%s 在 LynxActivity.java 有对应派发点（case 字面量）', (event) => {
    expect(lynxActivitySource).toContain(`"${event}"`)
  })
})
