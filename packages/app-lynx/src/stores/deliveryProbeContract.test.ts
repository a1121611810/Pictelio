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
const STORE_CODE = stripComments(
  safeRead(new URL('../stores/deliveryProbeStore.ts', import.meta.url)),
)
const TRIGGER_CODE = stripComments(
  safeRead(new URL('../utils/deliveryProbeTrigger.ts', import.meta.url)),
)
const LANDING_CODE = stripComments(
  safeRead(new URL('../utils/deliveryProbeLanding.ts', import.meta.url)),
)
const REPORT_CODE = stripComments(
  safeRead(new URL('../utils/deliveryProbeReport.ts', import.meta.url)),
)
const ROUTER_CODE = stripComments(safeRead(new URL('../router.ts', import.meta.url)))
const TAP_ACTIVITY_CODE = stripComments(
  safeRead(
    new URL(
      '../../../android-host/android/app/src/lynx/java/io/pictelio/app/NotificationTapActivity.java',
      import.meta.url,
    ),
  ),
)
const NOTIFY_MODULE_CODE = stripComments(
  safeRead(
    new URL(
      '../../../android-host/android/app/src/lynx/java/io/pictelio/app/PictelioNotificationModule.java',
      import.meta.url,
    ),
  ),
)
const RUNTIME_INIT_CODE = stripComments(
  safeRead(
    new URL('../../../android-host/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java', import.meta.url),
  ),
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

  describe('通知模块（#939 发出汇总通知）', () => {
    it('模块已在运行时注册（未注册的模块 = JS 侧永远拿不到方法）', () => {
      expect(NOTIFY_MODULE_CODE, 'PictelioNotificationModule 源文件不存在').not.toBe('')
      expect(
        RUNTIME_INIT_CODE,
        'PictelioNotification 未在 LynxRuntimeInitializer 注册 ⇒ JS 侧调不到',
      ).toMatch(/registerModule\(\s*["']PictelioNotification["']/)
    })

    it('暴露了权限状态查询方法（#939 AC-2 的宿主侧数据源）', () => {
      expect(NOTIFY_MODULE_CODE, '未暴露权限状态查询方法').toMatch(/areNotificationsEnabled/)
      // 必须是真正的系统查询，不是常量/占位
      expect(
        NOTIFY_MODULE_CODE,
        '权限查询未落到 NotificationManager/areNotificationsEnabled（占位实现）',
      ).toMatch(/NotificationManager|areNotificationsEnabled/)
    })

    it('暴露了发汇总通知的方法，且渠道名与权限声明都在（#939 AC-6）', () => {
      expect(NOTIFY_MODULE_CODE, '未暴露发通知方法').toMatch(/postSummary|notifySummary/)
      // ⚠️ 只认 `createNotificationChannel(` 这个**调用**，不认 `NotificationChannel(` 这个**类型**。
      //   变异实测：只删掉 createNotificationChannel 调用、保留 `new NotificationChannel(...)`，
      //   原断言（含类型分支）**全绿放行**——而那正是 Android 8+ 上通知静默不显示的形态：
      //   渠道对象建了但没注册 ⇒ 投递成功、用户什么都收不到 ⇒ 探测会把它读成「没人点」。
      expect(
        NOTIFY_MODULE_CODE,
        '渠道只构造未注册（缺 createNotificationChannel 调用 ⇒ Android 8+ 上通知静默不显示）',
      ).toMatch(/createNotificationChannel\s*\(/)
      expect(MANIFEST_CODE, '清单未声明 POST_NOTIFICATIONS').toContain(
        'android.permission.POST_NOTIFICATIONS',
      )
    })

    it('本组能抓到「渠道只构造未注册」的最隐蔽形态（变异自证）', () => {
      // 反例夹具：有类型、有构造，唯独没有注册调用。
      const constructedOnly = 'new NotificationChannel(CHANNEL_ID, name, IMPORTANCE_DEFAULT)'
      expect(constructedOnly).toMatch(/NotificationChannel\(/) // 旧断言形态：拦不住
      expect(constructedOnly).not.toMatch(/createNotificationChannel\s*\(/) // 本组形态：拦得住
    })

    it('⚠️ JS 调用的每个原生方法名都与宿主 @LynxMethod 声明**逐字一致**（#939 AC-6 两侧比对）', () => {
      // ⚠️ 上一条那两条 `toMatch(/areNotificationsEnabled/)` 是**子串**匹配，拦不住改名：
      //   JS 改成 areNotificationsEnabledV2 后，子串仍命中 ⇒ 门禁全绿而真机调不到方法。
      //   这正是 T1 修过的「门禁单侧」缺陷换个形态复发，故此处按**整名**比对。
      const calledOnModule = [...TRIGGER_CODE.matchAll(/\bmod\.(\w+)\s*\(/g)].map((m) => m[1] as string)
      // ⚠️ 必须钉住**应有集合**，不能只做「调用的都在宿主有声明」的单向包含。
      //   变异实测：整个删掉 mod.postSummary(...) 调用后，calledOnModule 退化成
      //   ['areNotificationsEnabled']，单向比对照样全绿 —— 而 AC-1（发出汇总通知）
      //   已经完全不成立了。
      expect(new Set(calledOnModule), '触发链没有同时调用权限查询与发通知两个方法').toEqual(
        new Set(['areNotificationsEnabled', 'postSummary']),
      )

      const declared = new Set(
        [...NOTIFY_MODULE_CODE.matchAll(/@LynxMethod\s+public\s+\w+\s+(\w+)\s*\(/g)].map(
          (m) => m[1] as string,
        ),
      )
      expect(declared.size, '未从原生模块抽出任何 @LynxMethod 方法').toBeGreaterThan(0)

      for (const name of calledOnModule) {
        expect(
          declared.has(name),
          `触发链调用 mod.${name}()，但宿主没有同名的 @LynxMethod（两侧漂移 ⇒ 真机调不到）`,
        ).toBe(true)
      }
    })

    it('⚠️ 权限查询必须真的落到系统查询上（不能是同名占位实现）', () => {
      // 反例形态：把方法体换成 `callback.invoke(true, null)`（名字对、查也没查）。
      // `toMatch(/NotificationManager|areNotificationsEnabled/)` 拦不住——**方法自己的名字**
      // 就含 areNotificationsEnabled，import 也含 NotificationManager。
      // 故这里盯**方法体**：必须取到 NotificationManager 再问 areNotificationsEnabled。
      // ⚠️ 切片必须止于**下一个 @LynxMethod**：切到文件尾会把 postSummary 里的
      //   callback.invoke(true, null)（成功回调）也划进权限方法体，凭空转红。
      const permStart = NOTIFY_MODULE_CODE.indexOf('public void areNotificationsEnabled')
      const permEnd = NOTIFY_MODULE_CODE.indexOf('@LynxMethod', permStart + 1)
      const body = NOTIFY_MODULE_CODE.slice(permStart, permEnd === -1 ? undefined : permEnd)
      expect(body, '权限查询方法体未落到 NotificationManager 查询').toMatch(
        /managerOf\([^)]*\)[\s\S]*notificationsEnabledNow\(nm\)/,
      )
      // 且**不得**直接回常量：真给用户发不出通知的机器判「已授予」比不判更糟
      expect(body, '权限查询直接回常量 ⇒ 占位实现').not.toMatch(/callback\.invoke\(\s*true\s*,/)
    })

    it('本组能抓到「JS 侧改名而宿主不改」的最隐蔽形态（变异自证）', () => {
      // 子串匹配的假阴性夹具：V2 仍含旧名 ⇒ toMatch(/旧名/) 命中，但整名比对必须不命中。
      const renamed = 'mod.areNotificationsEnabledV2((g, e) => {})'
      const declared = new Set(['areNotificationsEnabled'])
      const called = [...renamed.matchAll(/\bmod\.(\w+)\s*\(/g)].map((m) => m[1] as string)
      expect(renamed).toMatch(/areNotificationsEnabled/) // 旧断言形态：确实拦不住
      expect(called.every((n) => declared.has(n))).toBe(false) // 本组形态：拦得住
    })

    it('本组能抓到「删掉整个 postSummary 投递调用」（变异自证，双向包含才是完整体检）', () => {
      // 单向包含的假阴性夹具：只剩权限查询时，「调用的都有声明」依然成立。
      const onlyPermission = 'mod.areNotificationsEnabled((g, e) => {})'
      const declared = new Set(['areNotificationsEnabled', 'postSummary'])
      const called = [...onlyPermission.matchAll(/\bmod\.(\w+)\s*\(/g)].map((m) => m[1] as string)
      expect(called.every((n) => declared.has(n))).toBe(true) // 单向包含：拦不住
      expect(new Set(called)).not.toEqual(new Set(['areNotificationsEnabled', 'postSummary'])) // 本组：拦得住
    })

    it('⚠️ 通知点击的冷/热落点两侧逐字一致（#940：#939 的「无点击意图」绊线到此转红）', () => {
      // #939 交付时本条是「显式记录现状」的绊线：断言通知**没有** setContentIntent。
      // #940 落地后它如期转红 —— 这正是当初写它的目的（提示改成真正的跨端比对）。
      // 现在比的是**两侧事件名 + 落点路由**，事件名取自 JS 侧源码（不在本文件硬写）。
      const cold = LANDING_CODE.match(
        /export const EVENT_NOTIFICATION_TARGET\s*=\s*["']([^"']+)["']/,
      )?.[1]
      expect(cold, '未能从落点模块抽出冷启动事件名').not.toBeUndefined()

      expect(ACTIVITY_CODE, `宿主未广播落点事件 ${cold}`).toContain(cold as string)
      // ⚠️ 冷热**合并成一个事件名**（#940 实施期）：冷热在进程内不可判定，
      //   两个事件名会让 JS 侧看起来像能区分，其实只是换了广播次数。
      expect(
        LANDING_CODE,
        '落点链路仍导出热启动专用事件名 ⇒ 暗示冷热可判定，实际不可',
      ).not.toContain('EVENT_NOTIFICATION_TARGET_WARM')
      // JS 侧必须真的订阅这两个名字（导出不等于被消费）
      expect(ROUTER_CODE, 'router 未订阅落点事件').toContain('EVENT_NOTIFICATION_TARGET')
      expect(ROUTER_CODE, '落点未导航到通知列表页').toContain("navigate('/notifications'")
    })

    it('落点目标与事件名在宿主侧都是**真实代码**而非注释（#940 变异自证）', () => {
      // 正向：宿主当前确实声明了落点目标为通知列表页（剥注释后仍在）
      expect(ACTIVITY_CODE, '宿主未声明通知落点目标').toMatch(
        /TARGET_NOTIFICATIONS\s*=\s*"notifications"/,
      )

      // 变异 A：只在注释里留落点路由字符串（代码里换成别的）
      const commentOnly = '// case "notifications" -> emit pictelioNotificationTarget;'
      expect(commentOnly).toContain('notifications') // 朴素 toContain 会命中
      expect(stripComments(commentOnly)).not.toContain('notifications')

      // 变异 B：把落点改成另一个页面 —— 逐字比对必须转红
      // ⚠️ 这里必须断言**真盘源码**，不能拿测试内的字面量自证：
      //   拿 `const drift = '...'` 再断言它不匹配，等于只测了 stripComments 与正则本身，
      //   对生产代码零覆盖（双轴 review 判为假绿）。真盘形态已由上面两条正向断言覆盖。
      expect(ACTIVITY_CODE, '落点目标未在真盘源码里声明').toMatch(
        /TARGET_NOTIFICATIONS\s*=\s*"notifications"/,
      )
      expect(
        ACTIVITY_CODE,
        '真盘源码里落点目标不是 notifications ⇒ 两侧不一致',
      ).not.toMatch(/TARGET_NOTIFICATIONS\s*=\s*"(?!notifications)/)
    })

    it('⚠️ 点击意图必须带 clickId 载荷（没有它就无法去重 ⇒ 一次点击记 4 次）', () => {
      expect(
        NOTIFY_MODULE_CODE,
        '点击意图未携带 clickId ⇒ 冷启动 4 次广播会被记成 4 次点击',
      ).toMatch(/EXTRA_NOTIFICATION_CLICK_ID/)
      expect(NOTIFY_MODULE_CODE, '点击意图未设置 contentIntent').toMatch(/setContentIntent/)
      // 载荷必须真的进 intent（只读常量名 = 没接上）
      expect(NOTIFY_MODULE_CODE, 'clickId 只声明未 putExtra').toMatch(
        /putExtra\(\s*LynxActivity\.EXTRA_NOTIFICATION_CLICK_ID/,
      )
      // ⚠️ 中转那一跳此前**零断言**（TAP_ACTIVITY_CODE 读进来却没用），而它最隐蔽：
      //   LynxActivity 用 getLongExtra(..., 0L) 兜底 ⇒ 中转漏传 ⇒ clickId 恒 0
      //   ⇒ 所有点击共享一个去重键 ⇒ 第一次计数、之后全被当重复吞掉，
      //   clicked 冻结在 1 而 sent 持续上涨，产出一个「看起来很像真的」0 点击率。
      expect(TAP_ACTIVITY_CODE, '中转未把落点目标转到启动 intent').toMatch(
        /putExtra\(\s*LynxActivity\.EXTRA_NOTIFICATION_TARGET/,
      )
      expect(TAP_ACTIVITY_CODE, '中转未把 clickId 转到启动 intent').toMatch(
        /putExtra\(\s*LynxActivity\.EXTRA_NOTIFICATION_CLICK_ID/,
      )
    })

    it('⚠️ 热启动必须 override onNewIntent 且 setIntent（否则 extra 静默丢弃）', () => {
      // ADR-0220 §6-3 点名的失效机制：onNewIntent 未 override ⇒ getIntent() 仍返回首次的
      // intent ⇒ 点击带来的 extra 被丢弃 ⇒「点了像没点」。
      expect(ACTIVITY_CODE, '未 override onNewIntent ⇒ 热启动落点永不触发').toMatch(
        /protected void onNewIntent\(/,
      )
      expect(
        ACTIVITY_CODE,
        'onNewIntent 未 setIntent ⇒ getIntent() 仍返回首次 intent，extra 静默丢弃',
      ).toMatch(/onNewIntent[\s\S]*?setIntent\(intent\)/)
      // 判据必须是「活实例 ∧ bundle 已加载」：**不可**用 onLoadSuccess 置位后永不重置的
      // 进程静态——exitApp 只 finish() 不杀进程 ⇒「进程活着但没有 Activity」是可达状态，
      // 用它会把单次广播发给不存在的监听者 ⇒ 点击静默丢失（双轴 review 判为阻塞）。
      // ⚠️ 广播**恒为四次**，不得再引入「单次 / 多窗」判据（e2e #942 实测两种都错）：
      //   ① 按 onLoadSuccess/onNewIntent 硬编码 ⇒ 冷启动时 onNewIntent 在 bundle 加载**之后**
      //      才送达，判成单次 ⇒ 点击丢失；
      //   ② 按「bundle 是否已加载」实测 ⇒ onLoadSuccess 调用点在加载回调**内部**，该判据恒真。
      //   多余三次由 clickId 去重挡掉（首次到达才导航 + 计数），成本可忽略。
      const dispatchBody = ACTIVITY_CODE.slice(
        ACTIVITY_CODE.indexOf('private void dispatchNotificationTarget'),
        ACTIVITY_CODE.indexOf('private void dispatchNotificationTarget') + 2600,
      )
      expect(
        dispatchBody,
        '落点未走多窗重发 ⇒ 渲染竞态下页面级监听未挂时点击丢失',
      ).toMatch(/for \(long delay : TARGET_BROADCAST_DELAYS\)/)
      expect(
        dispatchBody,
        '落点重新引入了「单次 / 多窗」判据 ⇒ e2e #942 实测两种判据都会错',
      ).not.toMatch(/CLICK_KIND|clickKind|singleBroadcast/)
      expect(ACTIVITY_CODE, '未保留 ADR-0066 维护的 sInstance 存活标志读取').toMatch(
        /hasLiveActivityInstance\(\)[\s\S]{0,200}?sInstance/,
      )
    })

    it('⚠️ 热启动必须 override onNewIntent 且 setIntent（否则 extra 静默丢弃）', () => {
      // ADR-0220 §6-3 点名的失效机制：onNewIntent 未 override ⇒ getIntent() 仍返回首次的
      // intent ⇒ 点击带来的 extra 被丢弃 ⇒「点了像没点」。
      expect(ACTIVITY_CODE, '未 override onNewIntent ⇒ 热启动落点永不触发').toMatch(
        /protected void onNewIntent\(/,
      )
      expect(
        ACTIVITY_CODE,
        'onNewIntent 未 setIntent ⇒ getIntent() 仍返回首次 intent，extra 静默丢弃',
      ).toMatch(/onNewIntent[\s\S]*?setIntent\(intent\)/)
    })

    it('⚠️ 重置只清计数两字段、保留 startedAt（#941 AC-1）', () => {
      // ADR-0220 D12：连它一起清就丢掉了「这轮从什么时候开始」，多轮时间线断裂。
      const reset = STORE_CODE.slice(
        STORE_CODE.indexOf('async function resetRound'),
        STORE_CODE.indexOf('return { counts, load, recordSent'),
      )
      expect(reset, '未找到 resetRound 实现').not.toBe('')
      expect(
        reset,
        '重置未保留 startedAt ⇒ 多轮探测的时间线断裂',
      ).toMatch(/startedAt:\s*counts\.value\.startedAt/)
      // 不得整体替换成 emptyCounts()（那会把 startedAt 一并清成 null）
      expect(
        reset,
        '重置用 emptyCounts() 整体替换 ⇒ startedAt 被清成 null',
      ).not.toMatch(/counts\.value\s*=\s*emptyCounts\(\)/)
    })

    it('⚠️ 报告不得把「无数据」说成 0%（#941 口径诚实）', () => {
      expect(REPORT_CODE, '未找到报告模块').not.toBe('')
      // 分母为 0 ⇒ rate 必须是 null；写成 0 会被读成「发了但没人点」
      expect(
        REPORT_CODE,
        '点击率用 0 冒充「无数据」⇒ 探测器故障会被读成用户拒绝',
      ).toMatch(/rate:\s*number\s*\|\s*null/)
      expect(
        REPORT_CODE,
        'no-data 必须是独立 verdict，不能复用 not-clicked',
      ).toMatch(/"no-data"/)
      // 权限三种状态：查不到 ≠ 未授予。
      // ⚠️ 断言必须锚在**行为**上（null 分支真的映射到 unknown），不能只搜 "unknown" 字样 ——
      //   那个词在类型声明里也有，删掉实现里的映射仍然全绿（变异实测）。
      expect(
        REPORT_CODE,
        'permissionGranted === null 未映射到 "unknown" ⇒ 「查不到」被当成「未授予」',
      ).toMatch(/permissionGranted\s*===\s*null\s*\?\s*"unknown"/)
      // 比率文本：null 分支不得输出 0%
      expect(
        REPORT_CODE,
        'rateText 的 null 分支输出 0% ⇒ 无数据被读成「没人点」',
      ).toMatch(/if \(rate === null\) return\s*"[^"]*无法计算[^"]*"/)
      // 报告必须自带冷热不可分的声明（#940 已证伪四种判据）
      expect(REPORT_CODE, '报告未声明点击数无法区分冷热').toContain("无法区分")
    })

    it('⚠️ 计数里不得再出现冷/热分类字段（#940 实施期结论：不可判定）', () => {
      // 四种候选判据全被点击本身污染（回调类型 / 进程内静态 / 持久前台标记 / 进程寿命），
      // 留一个看似精确实则不可信的分类，比只留总量更危险——报告期会被误用。
      expect(
        LANDING_CODE,
        '落点链路仍传冷/热来源 ⇒ 会把不可判定的分类写进计数',
      ).not.toMatch(/provenance|\bcold\b|\bwarm\b/)
      expect(TRIGGER_CODE + LANDING_CODE, 'store 调用仍带来源参数').not.toMatch(
        /recordClicked\([^)]/
      )
      expect(
        STORE_CODE,
        '计数形状里仍有冷/热字段',
      ).not.toMatch(/clickedCold|clickedWarm|ClickProvenance/)
    })

    it('⚠️ 落点导航必须 push 且经 clickId 去重（AC-5：replace 会让返回卡死）', () => {
      // 真机实证：replace 只改真实历史栈，而返回处理器按**镜像栈** hasBackEntry() 判断
      // ⇒ 两者失配，连按返回永远判定「可返回」却无处可退。
      expect(
        ROUTER_CODE,
        '落点用了 replace ⇒ 返回键会卡死（AC-5）',
      ).not.toMatch(/navigate\('\/notifications',\s*\{\s*replace\s*:\s*true/)
      expect(ROUTER_CODE, '落点未导航到通知列表页').toMatch(/navigate\('\/notifications'\)/)
      // 导航也必须经 clickId 去重：冷启动广播 4 次，每次 push 会压出 4 层
      expect(
        ROUTER_CODE,
        '导航未经去重 ⇒ 冷启动 4 次广播压 4 层，返回要按 4 次',
      ).toMatch(/handleNotificationTarget\([\s\S]{0,80}?\)\s*\.then\(\s*\(?\s*\w*\s*\)?\s*=>\s*\{[\s\S]{0,120}?if \(/)
    })

    it('⚠️ onNewIntent 必须 setIntent（否则点击 extra 被静默丢弃）', () => {
      expect(
        ACTIVITY_CODE,
        'onNewIntent 未 setIntent ⇒ getIntent() 仍返回首次 intent，extra 静默丢弃',
      ).toMatch(/onNewIntent[\s\S]*?setIntent\(intent\)/)
      expect(ACTIVITY_CODE, 'onNewIntent 未转发落点').toMatch(
        /onNewIntent[\s\S]*?dispatchNotificationTarget\(intent\)/,
      )
    })
  })

  describe('判定链的触发点（上一轮 review 指出 quietElapsedMs 零读点）', () => {
    it('判定链真的被调用，且时长取自生命周期持有的时刻', () => {
      // 上一轮：`quietElapsedMs()` 全仓零生产引用 ⇒ 计时起点记下了也没人读，
      // 判定链永远不触发。这里钉「有人读」。
      // ⚠️ 分层后「读时刻」在生命周期侧、「判与发」在触发器侧，两处都要在。
      expect(
        LIFECYCLE_CODE,
        '无人调用 quietElapsedMs ⇒ 静默期时长没有被读出来',
      ).toMatch(/quietElapsedMs\(\)/)
      expect(LIFECYCLE_CODE, '生命周期未调用判定链的入口').toMatch(/runProbeOnce\(/)
      expect(TRIGGER_CODE, '无人调用 decideProbe').toMatch(/decideProbe\(/)
    })

    it('⚠️ 两条进入前台的路径都排了判定（事件收到 + 冷启动补投）', () => {
      // 这是本票最隐蔽的半接线形态：只在一处排判定 ⇒ 另一条入口的用户永远收不到探测，
      // 而两条日志（事件/补投）都照打，日志上看不出任何异常。
      const foregroundCb = LIFECYCLE_CODE.slice(
        LIFECYCLE_CODE.indexOf('function onForeground'),
        LIFECYCLE_CODE.indexOf('function onBackground'),
      )
      expect(foregroundCb, '收到前台事件时未排判定').toMatch(/scheduleProbe\(\)/)

      // ⚠️ 锚点必须是 initDeliveryProbeLifecycle，不能用 indexOf('foregroundedAt.value = nowMs()')：
      //   首次出现落在 onForeground 里，从那儿往后切**必然包含 onForeground 自己的
      //   scheduleProbe()**，断言恒成立。变异实测：删掉补投那行后本条仍然全绿。
      const subscribeFn = LIFECYCLE_CODE.slice(
        LIFECYCLE_CODE.indexOf('export function initDeliveryProbeLifecycle'),
      )
      expect(
        subscribeFn,
        '冷启动补投未排判定 ⇒ 补投路径的用户永远收不到探测',
      ).toMatch(/scheduleProbe\(\)/)
    })

    it('离开前台要撤掉那一轮判定（否则用户已走还会被打扰）', () => {
      const backgroundCb = LIFECYCLE_CODE.slice(
        LIFECYCLE_CODE.indexOf('function onBackground'),
        LIFECYCLE_CODE.indexOf('function nowMs'),
      )
      expect(backgroundCb, '离开前台未撤定时器').toMatch(/clearScheduledProbe\(\)/)
    })

    it('本组能抓到「只在事件路径排判定、漏掉冷启动补投」（变异自证）', () => {
      // 反例夹具：onForeground 排了、补投没排——真实源码里两条日志都照打，看不出来。
      // 用同款锚点（从 init 函数切）跑一遍，证明锚点确实落在补投那一处。
      const tailOf = (src: string): string =>
        src.slice(src.indexOf('export function initDeliveryProbeLifecycle'))
      const withFallback = tailOf(
        'export function initDeliveryProbeLifecycle() {\n  scheduleProbe()\n}',
      )
      const withoutFallback = tailOf(
        'export function initDeliveryProbeLifecycle() {\n  console.log("补投")\n}',
      )
      expect(withFallback).toMatch(/scheduleProbe\(\)/)
      expect(withoutFallback).not.toMatch(/scheduleProbe\(\)/)
    })

    it('⚠️ 在飞的那一轮必须能被切后台作废（generation-gate）', () => {
      // 只撤定时器不够：定时器触发后那轮正卡在两处 await（宿主查询 / 网络刷未读），
      // 用户切后台它照样会投出去 —— 而日志已经说了「停止静默期计时」。
      // （AGENTS.md 即时导航硬约束 3：异步请求必须做竞态防护）
      //
      // ⚠️ 必须锚在 onBackground **函数体内**：跨函数的正则会一路匹配到
      //   disposeDeliveryProbeLifecycle 里的同名代码，删掉本函数那行仍然全绿（变异实测）。
      const onBackgroundBody = LIFECYCLE_CODE.slice(
        LIFECYCLE_CODE.indexOf('function onBackground'),
        LIFECYCLE_CODE.indexOf('function nowMs'),
      )
      expect(
        onBackgroundBody,
        '离开前台只撤定时器，未作废已在飞的那一轮',
      ).toMatch(/generation\s*\+=\s*1/)
      expect(onBackgroundBody, '离开前台未撤定时器').toMatch(/clearScheduledProbe\(\)/)

      // 排定时要捕获当轮代号，投递前的判据是**代号比对**而非「当前是否在前台」
      // （切走再切回时后者又成立，旧轮会与新轮重复投递，各发一条、计数翻倍）
      expect(LIFECYCLE_CODE, '排定时未捕获当轮代号').toMatch(/const armed = generation/)
      expect(
        LIFECYCLE_CODE,
        '排定时未把代号比对器交给判定链',
      ).toMatch(/runProbeOnce\([\s\S]*?generation\s*===\s*armed\s*\)/)
    })

    it('投递前必须有**两处**代号比对（权限查询后 + 未读刷新后各一次）', () => {
      // 只写「存在 somewhere」不够：变异实测删掉其中一处，另一处仍让 toMatch 通过。
      const checks = TRIGGER_CODE.match(/!stillCurrent\(\)/g) ?? []
      expect(
        checks.length,
        `投递前的代号比对只有 ${checks.length} 处（应为 2）：两处 await 之间任一时刻切走都会漏投`,
      ).toBe(2)
      // 且必须都在**投递之前**出现
      const lastCheck = TRIGGER_CODE.lastIndexOf('!stillCurrent()')
      const postCall = TRIGGER_CODE.indexOf('mod.postSummary(')
      expect(lastCheck, '最后一次代号比对发生在投递之后 ⇒ 拦不住').toBeLessThan(postCall)
    })

    it('判定轮次的悬空 promise 必须挂 catch（否则同步抛出即 unhandled rejection）', () => {
      expect(
        LIFECYCLE_CODE,
        'void runProbeOnce(...) 未挂 .catch ⇒ 一次同步抛出就是无日志的静默失败',
      ).toMatch(/runProbeOnce\([\s\S]*?\)\.catch\(/)
    })

    it('权限轨取自宿主查询、未读轨取自通知 store（不得自造布尔值）', () => {
      // 判据：判定链的权限输入必须来自宿主权限查询，不能是字面量 true/false
      expect(TRIGGER_CODE, '权限轨未接宿主查询').toMatch(/areNotificationsEnabled/)
      // 未读轨必须读 store 那个（外环角标 + Me 圆点数据源），
      // ⚠️ 不是 pages/Updates.vue 内的页面本地同名量（ADR-0220 §6-2 警示的接错点）
      expect(TRIGGER_CODE, '未读轨未接通知 store').toMatch(/notificationStore|useNotificationStore/)
    })

    it('发出时递增发出样本（一次轮询 = 一个样本，决策 6）', () => {
      expect(TRIGGER_CODE, '发出后未递增 sent').toMatch(/recordSent\(\)/)
    })

    it('⚠️ 不得靠 try/catch 掩盖未读刷新失败（refreshUnreadBadge 保留旧值）', () => {
      // 该函数失败时**不抛、保留上次计数** ⇒ 用 try/catch 包它等于永不触发的兜底，
      // 拿旧计数当新计数发通知且零告警（禁静默降级）。
      expect(
        TRIGGER_CODE,
        '用 try/catch 包 refreshUnreadBadge ⇒ 它的失败路径根本不会抛，兜底是死的',
      ).not.toMatch(/try\s*\{[^}]*refreshUnreadBadge\(\)[^}]*\}\s*catch/)
    })

    it('发出通知后不得推进已读记忆（角标未读数必须保持真实）', () => {
      expect(
        TRIGGER_CODE,
        '发了通知却推进已读记忆 ⇒ 角标未读数被自己抹掉，对照基准失真',
      ).not.toMatch(/markNotificationsRead/)
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

    it('⚠️ 计数键是**单写者**不变量：原生侧不得直接读写它', () => {
      // ⚠️ 本条**改写过**（#939 落地时）。#938 把它写成「⚠️ 键名跨端一致性尚未成立——
      //   原生侧当前不读该键」，票面 #939 也预期本票落地后它会转红、提示改成跨端比对。
      //   **实际没有转红**，因为本票的实现让计数全程留在 JS 侧：
      //   store → PictelioPrefs（既有偏好存储），原生通知模块只发不记（ADR-0220 决策 13 不上传）。
      //
      //   ⇒ 票面前提「原生侧会有读点」是错的，跨端键名比对**不适用**——
      //   强行比对会得到一个恒真的装饰断言。故改成钉**真不变量**：
      //   原生侧一旦自己开始写这个键，两边各写一半会把计数拆成两个真相，必须走新 ADR。
      const key = probeKeyFromTs()
      expect(key, '键常量缺失').not.toBeNull()
      // 扫**两处**宿主源码：早期版本只扫通知模块，日后若新起一个原生模块去写这个键就漏了
      expect(
        NOTIFY_MODULE_CODE,
        `原生侧出现计数键 ${key} ⇒ 计数变成多写者，两边会各写一半`,
      ).not.toContain(key as string)
      expect(
        ACTIVITY_CODE,
        `宿主 Activity 出现计数键 ${key} ⇒ 计数变成多写者，两边会各写一半`,
      ).not.toContain(key as string)
    })
  })
})
