// ─── 送达通道触达探测 JS↔Java 契约测试（spec docs/specs/notification-delivery-probe.md / ADR-0220）───
// 模式 = darkModeJavaContract.test.ts / safeAreaJavaContract.test.ts（读宿主源码字面量，
//        剥注释后断言两侧一致，任一侧漂移即红灯）。
// seam = **跨端契约**（本仓既有最高层 seam；宿主侧「该发/不该发」判定另有 JVM 单测，
//        计数存储的 JSON 语义另有 JS 单测——三者不重复，本文件只管**跨端接得上**）。
//
// ⚠️ 断言纪律（ADR-0163 (b)，本仓反复吃亏的成因）：
//   断言一律跑在 stripComments 之后的文本上（下方 *_CODE）。反例（修复前）：
//   expect(ACTIVITY).toContain('pictelioAppForeground') —— 把发射整段删掉、只在注释里
//   留一句说明，照样全绿。故本文件：
//   ① 断言常量 = 原文剥注释；
//   ② 跨端符号用「两侧**都**出现」而不是「单侧出现」，单侧出现正是半接线形态；
//   ③ 每个检测器带**夹具自检**（真实形态夹具命中 / 纯注释夹具不命中），证明检测器非恒真。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 宿主 Android 源码根（ADR-0203 决策 2：packages/app/android → packages/android-host/android） */
const HOST_APP = new URL('../../../android-host/android/app/src/', import.meta.url)

/**
 * 剥注释：块注释 → XML 注释 → 行注释（口径同 darkModeJavaContract.test.ts）。
 * 块注释必须先行——否则块注释内部的 `//` 会被行注释规则先截断，留下半截 `/*`。
 * 已知边界（沿用既有先例的登记）：字符串字面量内的 `//` 会被截断；本文件断言的符号
 * 不落在 `://` 之后。若将来新增断言命中该边界，须升级为词法级去除。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\/[^\n]*/g, '')
}

const ACTIVITY_CODE = stripComments(
  readFileSync(new URL('lynx/java/io/pictelio/app/LynxActivity.java', HOST_APP), 'utf8'),
)
const MANIFEST_CODE = stripComments(
  readFileSync(new URL('main/AndroidManifest.xml', HOST_APP), 'utf8'),
)

/**
 * 探测 store 尚不存在时（TDD 的红阶段）**不能让整个文件挂掉**：
 * 顶层 readFileSync 抛 ENOENT 会让 vitest 记「0 用例」而不是逐条红，失去定位价值。
 * 故缺失时返回空串，由各条断言按名字失败。
 */
function safeRead(url: URL): string {
  try {
    return readFileSync(url, 'utf8')
  } catch {
    return ''
  }
}

const PROBE_STORE_CODE = stripComments(
  safeRead(new URL('../stores/deliveryProbeStore.ts', import.meta.url)),
)
const LIFECYCLE_CODE = stripComments(
  safeRead(new URL('../utils/deliveryProbeLifecycle.ts', import.meta.url)),
)
/** ⚠️ 引号两类都收：oxfmt 配的是 `quoteStyle: "double"`，判据若钉死单引号会在有人
 *  照仓库惯例改成双引号时**误红** —— 那是格式问题不是契约问题。不变的是键**值**。 */
const PROBE_PREF_RE = /export const DELIVERY_PROBE_KEY\s*=\s*["']([^"']+)["']/

// ═══════════════════════════════════════════════════════════════════════════════
// 跨端符号：两侧同名
// ═══════════════════════════════════════════════════════════════════════════════

/** 生命周期事件名：从 **JS 侧源码**抽出来，不在本文件硬写字面量。 */
const EVENT_FOREGROUND =
  PROBE_STORE_CODE.match(/export const EVENT_APP_FOREGROUND\s*=\s*["']([^"']+)["']/)?.[1] ?? ''
const EVENT_BACKGROUND =
  PROBE_STORE_CODE.match(/export const EVENT_APP_BACKGROUND\s*=\s*["']([^"']+)["']/)?.[1] ?? ''

/** 计数存储键：从 **JS 侧源码**抽出。 */
function probeKeyFromTs(): string | null {
  const m = PROBE_STORE_CODE.match(PROBE_PREF_RE)
  return m ? (m[1] as string) : null
}

describe('送达通道触达探测 · JS↔Java 契约（spec notification-delivery-probe / ADR-0220）', () => {
  describe('检测器自检（防恒真 / 防恒假）', () => {
    it('注释形态不得被误判为接线（本组断言存在的理由）', () => {
      // 反例形态：把真实发射删掉、只在注释里留一句
      const commentOnly = `// sendGlobalEvent("${EVENT_FOREGROUND}", ...);\n/* ${EVENT_BACKGROUND} */`
      expect(commentOnly).toContain(EVENT_FOREGROUND) // 朴素 toContain 会命中
      expect(stripComments(commentOnly)).not.toContain(EVENT_FOREGROUND) // 剥注释后不命中
      expect(stripComments(commentOnly)).not.toContain(EVENT_BACKGROUND)
    })

    it('真实形态能被检出（证明上一条不是「怎么都不命中」）', () => {
      const real = `lynxView.sendGlobalEvent("${EVENT_FOREGROUND}", new JavaOnlyArray());`
      expect(stripComments(real)).toContain(EVENT_FOREGROUND)
    })

    it('本组能抓到「JS 侧改名而宿主不改」的半接线（变异 M2 自证）', () => {
      // 事件名来自 JS 源码 ⇒ JS 改字后，宿主文本不再含新名 ⇒ 下面的两侧比对必须转红。
      // 反之若事件名被硬写在本文件，改 JS 侧将**打不红**——那正是本组被修的缺陷。
      const jsRenamed = `export const EVENT_APP_FOREGROUND = "pictelioForegroundV2"`
      const hostStaysOld = `lynxView.sendGlobalEvent("pictelioAppForeground", new JavaOnlyArray());`
      const fromTs = jsRenamed.match(/export const EVENT_APP_FOREGROUND\s*=\s*["']([^"']+)["']/)?.[1]
      expect(fromTs).toBe('pictelioForegroundV2')
      expect(stripComments(hostStaysOld)).not.toContain(fromTs as string)
    })
  })

  describe('生命周期事件（进入/离开前台）', () => {
    it('事件名可从 JS 侧源码抽出（抽不出 ⇒ 下面的比对恒失效）', () => {
      expect(EVENT_FOREGROUND, '未能从 deliveryProbeStore 抽出前台事件名').not.toBe('')
      expect(EVENT_BACKGROUND, '未能从 deliveryProbeStore 抽出后台事件名').not.toBe('')
    })

    it('宿主侧发射的事件名与 JS 侧**逐字一致**', () => {
      // 两侧都要出现：单侧出现 = 半接线（原生发了没人收 / JS 收了没人发）。
      // 事件名取自 JS 源码 ⇒ JS 改名会让本条转红（变异 M2 自证，见上一组）。
      expect(ACTIVITY_CODE, `宿主未发射 ${EVENT_FOREGROUND}`).toContain(EVENT_FOREGROUND)
      expect(ACTIVITY_CODE, `宿主未发射 ${EVENT_BACKGROUND}`).toContain(EVENT_BACKGROUND)
    })

    it('宿主侧走的是全局事件通道而非 DEBUG 门禁（否则发版包无生命周期）', () => {
      const emit = new RegExp(`sendGlobalEvent\\(\\s*"${EVENT_FOREGROUND}"`)
      expect(ACTIVITY_CODE, '未找到前台事件的全局发射调用').toMatch(emit)
    })
  })

  describe('冷启动竞态（#938 AC-1 的真正落点）', () => {
    it('生命周期模块订阅了两个事件（以常量名引用，不写字面量）', () => {
      // 刻意不比对字面量：订阅点写的是**常量名**（EVENT_APP_FOREGROUND），
      // 字面量只存在于 store 的声明处。这里钉「引用了正确的常量」。
      expect(LIFECYCLE_CODE, '未订阅前台事件').toContain('EVENT_APP_FOREGROUND')
      expect(LIFECYCLE_CODE, '未订阅后台事件').toContain('EVENT_APP_BACKGROUND')
    })

    it('⚠️ 订阅时必须补投一次「当前在前台」——否则冷启动首帧事件必丢', () => {
      // 竞态：Android 的 onResume 早于 JS 挂载 ⇒ 纯推模式下冷启动那次事件到不了。
      // 本仓此前正是因此**废弃过**同款事件总线方案（见 LynxActivity 的
      // applyDevIntentHooks 说明）。本条钉住「订阅即补投」这个兜底不被悄悄删掉：
      // 删掉它全仓仍绿，而真机上静默期计时将永不启动且无任何告警。
      const subscribe = LIFECYCLE_CODE.indexOf('addListener')
      const afterSubscribe = LIFECYCLE_CODE.slice(subscribe)
      expect(
        afterSubscribe,
        '订阅之后没有补投前台时刻 ⇒ 冷启动首帧丢失，静默期永不启动',
      ).toMatch(/foregroundedAt\.value\s*=\s*nowMs\(\)/)
    })

    it('夹具自检：本检测器不是恒真（删掉兜底即不命中）', () => {
      const withoutFallback = 'emitter.addListener(EVENT)\nsubscribed.value = true'
      expect(withoutFallback).not.toMatch(/foregroundedAt\.value\s*=\s*nowMs\(\)/)
    })
  })

  describe('权限声明', () => {
    it('清单声明了通知权限（缺声明 ⇒ 运行时申请必失败）', () => {
      expect(MANIFEST_CODE, '清单未声明 POST_NOTIFICATIONS').toContain(
        'android.permission.POST_NOTIFICATIONS',
      )
    })
  })

  describe('计数存储键', () => {
    it('JS 侧导出了键常量（供跨端一致性断言）', () => {
      expect(probeKeyFromTs(), 'deliveryProbeStore 未导出 DELIVERY_PROBE_KEY').not.toBeNull()
    })

    it('⚠️ 键名跨端一致性**尚未成立**——原生侧当前不读该键（显式挂账，见下）', () => {
      // 本条是**故意记录现状**的断言，不是「一致性已保证」。
      // 原生侧读写该键属 #939（发出汇总通知）范围；在此之前原生侧零读点，
      // 「键名两侧逐字一致」无法断言——若此时写成跨端比对，会得到一个**恒真的装饰断言**。
      const key = probeKeyFromTs()
      expect(key, '键常量缺失').not.toBeNull()
      // 实证原生侧当前确实没有这个键：把它去掉后全仓仍应零命中
      // （用宿主源码做反查，确保不是「藏在别处」）
      expect(ACTIVITY_CODE, '原生侧意外出现该键字面量 ⇒ 需改为真正的跨端比对').not.toContain(key as string)
    })
  })
})
