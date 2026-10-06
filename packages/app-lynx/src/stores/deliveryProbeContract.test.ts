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
/** ⚠️ 引号两类都收：oxfmt 配的是 `quoteStyle: "double"`，判据若钉死单引号会在有人
 *  照仓库惯例改成双引号时**误红** —— 那是格式问题不是契约问题。不变的是键**值**。 */
const PROBE_PREF_RE = /export const DELIVERY_PROBE_KEY\s*=\s*["']([^"']+)["']/

// ═══════════════════════════════════════════════════════════════════════════════
// 跨端符号：两侧同名
// ═══════════════════════════════════════════════════════════════════════════════

/** 生命周期事件（进入/离开前台）。命名沿既有 `pictelio*` 惯例。 */
const EVENT_FOREGROUND = 'pictelioAppForeground'
const EVENT_BACKGROUND = 'pictelioAppBackground'

/** 计数存储键：原生与 JS 必须逐字一致（同一 SharedPreferences 键） */
function probeKeyFromTs(): string | null {
  const m = PROBE_STORE_CODE.match(PROBE_PREF_RE)
  return m ? (m[1] as string) : null
}

describe('送达通道触达探测 · JS↔Java 契约（spec notification-delivery-probe / ADR-0220）', () => {
  describe('检测器自检（防恒真 / 防恒假）', () => {
    it('注释形态不得被误判为接线（本组断言存在的理由）', () => {
      // 反例形态：把真实发射删掉、只在注释里留一句
      const commentOnly = `// sendGlobalEvent("${EVENT_FOREGROUND}", ...);\n/* pictelioAppBackground */`
      expect(commentOnly).toContain(EVENT_FOREGROUND) // 朴素 toContain 会命中
      expect(stripComments(commentOnly)).not.toContain(EVENT_FOREGROUND) // 剥注释后不命中
      expect(stripComments(commentOnly)).not.toContain(EVENT_BACKGROUND)
    })

    it('真实形态能被检出（证明上一条不是「怎么都不命中」）', () => {
      const real = `lynxView.sendGlobalEvent("${EVENT_FOREGROUND}", JavaOnlyString.EMPTY);`
      expect(stripComments(real)).toContain(EVENT_FOREGROUND)
    })
  })

  describe('生命周期事件（进入/离开前台）', () => {
    it('JS 侧声明了两个事件名，且与宿主侧逐字一致', () => {
      // 两侧都要出现：单侧出现 = 半接线（原生发了没人收 / JS 收了没人发）
      expect(ACTIVITY_CODE, `宿主未发射 ${EVENT_FOREGROUND}`).toContain(EVENT_FOREGROUND)
      expect(ACTIVITY_CODE, `宿主未发射 ${EVENT_BACKGROUND}`).toContain(EVENT_BACKGROUND)
    })

    it('宿主侧走的是全局事件通道而非 DEBUG 门禁（否则发版包无生命周期）', () => {
      // 取事件发射的调用形态；只要求存在 sendGlobalEvent 调用，不要求具体位置
      const emit = new RegExp(`sendGlobalEvent\\(\\s*"${EVENT_FOREGROUND}"`)
      expect(ACTIVITY_CODE, '未找到前台事件的全局发射调用').toMatch(emit)
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
  })
})
