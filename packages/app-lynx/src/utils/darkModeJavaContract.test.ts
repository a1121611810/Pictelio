// ─── 暗色外观 JS↔Java 契约测试（spec docs/specs/lynx-night-mode.md T1 §4.3 + follow-up #692）───
// 模式 = safeAreaJavaContract.test.ts（Java 源码字面量提取，任一侧漂移即红灯）。
// oracle = spec §4.3 契约锚点：事件名 / 载荷格式 / 拉取方法名；
//          #692 追加：三态设置键原生读点 / system 复位哨兵 / 状态栏闩锁接线 / 下发方法名 /
//          splash 主题名资源稳定性 / 跨语言色值（tokens.css ⇄ values-night 资源）；
//          review round-2 追加：发射链（判定 ⇄ 发射「相邻性」）/ prefs 组合点 / F14 复位哨兵
//          的**代码形态**断言（ADR-0163 (b)：行为类断言一律基于剥注释文本）。
//
// ⚠ 断言纪律（ADR-0163 (b)；review round-2 B1/B2 的成因）：
// 断言一律跑在 stripComments 之后的文本上（下方 *_CODE 常量）。反例（修复前）：
//   expect(LYNX_ACTIVITY).toContain('onResume 兜底补发')
// —— 把 shouldEmitDarkEvent 判定 + sendDarkModeEvent() 发射整段删掉，只在注释里留一句
// 「onResume 兜底补发」照样全绿。故本轮：
//   ① 断言常量 = 原文剥注释；
//   ② 行为形态断言落在**方法体内**的具体调用组合上（而非全文件 toContain）；
//   ③ 每个检测器带夹具自检（真实形态夹具命中 + 注释夹具剥注释后不命中）。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 剥注释：块注释 → XML 注释 → 行注释（口径同 tests/hardcodeColorGate.test.ts 的 source-scan 模式）。
 * 顺序：块注释必须先行——否则块注释内部的 `//` 会被行注释规则先截断，留下半截 `/*`。
 * 已知边界：字符串字面量内的 `//`（如 `"http://…"`）也会被截断。本组读取的四个源文件已核对
 * 无该形态（Java 侧 LynxActivity.java 无字符串内 `//`、无 `<!--`）；若将来出现，需升级为
 * 词法级去除（或改用既有 AST 工具）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // Java / TS / CSS 块注释
    .replace(/<!--[\s\S]*?-->/g, '') // XML（values*/styles.xml）注释
    .replace(/\/\/[^\n]*/g, '') // Java / TS 行注释
}

// ── 源文件（全部 = 原文剥注释；断言只用 *_CODE，禁用原文）──
const LYNX_ACTIVITY_CODE = stripComments(
  readFileSync(
    new URL(
      '../../../app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java',
      import.meta.url,
    ),
    'utf8',
  ),
)
const APP_MODULE_CODE = stripComments(
  readFileSync(
    new URL(
      '../../../app/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java',
      import.meta.url,
    ),
    'utf8',
  ),
)
const DARK_MODE_CODE = stripComments(
  readFileSync(new URL('./darkMode.ts', import.meta.url), 'utf8'),
)
const SETTINGS_STORE_CODE = stripComments(
  readFileSync(new URL('../stores/settingsStore.ts', import.meta.url), 'utf8'),
)
// tokens.css 保持原文读入（跨语言色值契约比对的是**真实声明值**，非注释），
// 但下面对 `.theme-sky.dark` 块抽取的切片仍先剥注释（防「注释里的 hex 顶替真值」）。
const TOKENS_CSS = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const VALUES_STYLES_CODE = stripComments(
  readFileSync(
    new URL('../../../app/android/app/src/main/res/values/styles.xml', import.meta.url),
    'utf8',
  ),
)
const VALUES_NIGHT_STYLES_CODE = stripComments(
  readFileSync(
    new URL('../../../app/android/app/src/main/res/values-night/styles.xml', import.meta.url),
    'utf8',
  ),
)

// ═══════════════════════════════════════════════════════════════════════════════
// review round-2：发射链 / prefs 组合点 / 去重哨兵的**代码形态**机器防线（ADR-0163 (b)）
//
// 反向前提（本组存在的理由）：round-2 复审发现既有断言 `toContain('onResume 兜底补发')`
// 可被**注释**满足 —— 判定（shouldEmitDarkEvent）与发射（sendDarkModeEvent）整段删除、
// 只在注释里留一句说明，防线依然全绿（B1/B2）。本组把这类契约改钉在「方法体内调用组合」上：
//   a) onConfigurationChanged 内 `shouldEmitDarkEvent(...)` 且其后 200 字符内 `sendDarkModeEvent()`
//   b) onResume 内同组合（后台期间系统翻转未走 configChanges 的兜底补发）
//   c) onDestroy 内 800 字符内含 `sLastDarkSent = ""`（F14：静态去重哨兵跨实例复位）
//   d) 状态栏组合点含 `resolveIsDark(normalizeDarkMode(readDarkModeRaw(this))`
//   e) splash 组合点含 `splashThemeIdFor(normalizeDarkMode(readDarkModeRaw(this))`
// 每项都有夹具自检（下方 DETECTOR_FIXTURES），证明检测器不是恒真 / 不恒假。
// ═══════════════════════════════════════════════════════════════════════════════

/** 方法体抽取锚点（剥注释文本上匹配） */
const ON_CONFIG_CHANGED_SIG = /public void onConfigurationChanged\(\s*Configuration newConfig\s*\)/
const ON_RESUME_SIG = /protected void onResume\(\s*\)/
const ON_DESTROY_SIG = /protected void onDestroy\(\s*\)/

/** 判定 → 发射的最大允许字符间距（「判定与发射必须相邻」的机器口径；当前实现 ≈ 100 字符） */
const MAX_JUDGE_TO_SEND_GAP = 200
/** onDestroy 方法体内 F14 复位哨兵的最大允许偏移（body 起点起算；当前实现 ≈ 300 字符） */
const MAX_DARK_SENT_RESET_OFFSET = 800

const SHOULD_EMIT_RE = /shouldEmitDarkEvent\s*\(/
const SEND_DARK_RE = /sendDarkModeEvent\s*\(\s*\)/
const DARK_SENT_RESET_RE = /sLastDarkSent\s*=\s*""/

/** 状态栏组合点字面量（三态读点唯一接线：raw 读 + 归一 + 决策同表达式） */
const STATUS_BAR_COMBO = 'resolveIsDark(normalizeDarkMode(readDarkModeRaw(this))'
/** splash 组合点字面量（同口径：兜底轨主题选择由同一读点驱动） */
const SPLASH_COMBO = 'splashThemeIdFor(normalizeDarkMode(readDarkModeRaw(this))'

/**
 * 抽取方法体（`index` = 签名起始偏移；花括号配平，不含两端花括号）。
 * 闭合失败 / 找不到 `{` 返回 null（自检夹具与真实源码共用同一条代码路径，避免双实现漂移）。
 */
function tryMethodBody(code: string, index: number): string | null {
  const open = code.indexOf('{', index)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return code.slice(open + 1, i)
    }
  }
  return null
}

/** 方法体抽取（断言版：签名缺失 / 未闭合即带 label 翻红，便于定位漂移来源） */
function methodBodyOrFail(code: string, signature: RegExp, label: string): string {
  const m = signature.exec(code)
  expect(m, `${label}：未找到方法签名（签名改名或实现被删）`).not.toBeNull()
  const body = tryMethodBody(code, m!.index + m![0].length)
  expect(body, `${label}：方法体未闭合（花括号配平失败）`).not.toBeNull()
  return body!
}

/** 检测器 a/b：方法体内 `shouldEmitDarkEvent(...)` 后 ≤ MAX_JUDGE_TO_SEND_GAP 字符内须有 `sendDarkModeEvent()` */
function hasEmitPair(code: string, signature: RegExp): boolean {
  const m = signature.exec(code)
  if (!m) return false
  const body = tryMethodBody(code, m.index + m[0].length)
  if (body === null) return false
  const judge = SHOULD_EMIT_RE.exec(body)
  if (!judge) return false
  const send = SEND_DARK_RE.exec(body.slice(judge.index))
  return send !== null && send.index <= MAX_JUDGE_TO_SEND_GAP
}

/** 检测器 c：onDestroy 方法体前 MAX_DARK_SENT_RESET_OFFSET 字符内含 `sLastDarkSent = ""`（F14） */
function hasDarkSentReset(code: string, signature: RegExp): boolean {
  const m = signature.exec(code)
  if (!m) return false
  const body = tryMethodBody(code, m.index + m[0].length)
  if (body === null) return false
  const reset = DARK_SENT_RESET_RE.exec(body)
  return reset !== null && reset.index <= MAX_DARK_SENT_RESET_OFFSET
}

describe('暗色外观 JS↔Java 契约锚点', () => {
  it('事件名 pictelioDarkMode：Java 发送 ⇄ JS 订阅', () => {
    expect(LYNX_ACTIVITY_CODE).toContain('EVENT_DARK_MODE = "pictelioDarkMode"')
    expect(LYNX_ACTIVITY_CODE).toContain('sendGlobalEvent(EVENT_DARK_MODE')
    expect(DARK_MODE_CODE).toContain("addListener('pictelioDarkMode'")
  })

  it('拉取方法 getDarkMode：Java 提供 ⇄ JS 调用', () => {
    expect(APP_MODULE_CODE).toContain('public void getDarkMode(Callback callback)')
    expect(DARK_MODE_CODE).toContain('getDarkMode')
  })

  it('载荷契约：Java JSON 字符串（{"mode":...}）⇄ JS 双路径解析', () => {
    // Java：JavaOnlyArray.of 包裹 JSON 字符串（载荷 = {"mode":"..."}）
    expect(LYNX_ACTIVITY_CODE).toContain('sendGlobalEvent(EVENT_DARK_MODE, JavaOnlyArray.of(')
    // review round-2 取证（B1/B2 同族）：Java **源码**里 JSON 是转义引号形态（`"{\"mode\":\"" + mode`），
    // 写成“未转义”的 `{"mode":"` 只可能出现在 Javadoc 里 —— 旧断言正是被那行注释满足，
    // 删掉发射实现也不会红。故此处钉**代码里的转义形态**。
    expect(
      LYNX_ACTIVITY_CODE,
      'Java 载荷字面量应为转义引号形态（未转义 `{"mode":"` 只能来自注释 = 旧断言可被注释满足）',
    ).toContain('{\\"mode\\":\\"')
    // JS：parseNativePayload 同时容忍 JSON 与裸字符串
    expect(DARK_MODE_CODE).toContain('parseNativePayload')
    expect(DARK_MODE_CODE).toContain('JSON.parse(raw)')
  })

  it('三态 id 字面量（light/dark/system）与 Java currentDarkMode 纯函数契约一致', () => {
    // JS：值域 light/dark/system
    expect(DARK_MODE_CODE).toContain('DARK_MODE_OPTIONS')
    expect(DARK_MODE_CODE).toContain("'light'")
    expect(DARK_MODE_CODE).toContain("'dark'")
    expect(DARK_MODE_CODE).toContain("'system'")
    // Java：currentDarkMode 仅返回 "light" / "dark"（system 在 JS 侧由 settingsStore 三态派生）
    expect(LYNX_ACTIVITY_CODE).toMatch(/static String currentDarkMode\(int uiMode\)/)
    expect(LYNX_ACTIVITY_CODE).toContain('"dark"')
    expect(LYNX_ACTIVITY_CODE).toContain('"light"')
  })

  it('配置变化回调 onConfigurationChanged 钉字面量：与 manifest configChanges 一致', () => {
    // manifest configChanges 已包含 uiMode（spec 决策 3）
    // Java 端通过 override onConfigurationChanged 接收 uiMode 翻转
    expect(LYNX_ACTIVITY_CODE).toContain('public void onConfigurationChanged(Configuration newConfig)')
    expect(LYNX_ACTIVITY_CODE).toContain('Configuration.UI_MODE_NIGHT_MASK')
  })

  it('onResume 兜底补发：spec 决策 3 后台翻转兜底契约', () => {
    // 旧断言 `toContain('onResume 兜底补发')` 可被一行注释满足（review round-2 B1）——
    // 已换为方法体级的真实形态断言，见下方「发射链 / prefs 组合点代码形态」组（onResume 项）。
    expect(LYNX_ACTIVITY_CODE).toMatch(ON_RESUME_SIG)
  })
})

/**
 * 检测器自检夹具（ADR-0163 (b)「正则失效恒真」防线）：
 * - `hit`：含真实形态 → 剥注释后必须命中；
 * - `commentOnly`：形态**只出现在注释里**（注释位于方法体内部 = B1/B2 的真实缺陷形态）→
 *   剥注释前命中（证明「注释即可满足」的旧断言口径确实存在），剥注释后必须不命中。
 */
const DETECTOR_FIXTURES: Array<{
  label: string
  detect: (code: string) => boolean
  hit: string
  commentOnly: string
}> = [
  {
    label: 'a/b onConfigurationChanged 判定 ⇄ 发射',
    detect: (code) => hasEmitPair(code, ON_CONFIG_CHANGED_SIG),
    hit: `@Override public void onConfigurationChanged(Configuration newConfig) {
      if (shouldEmitDarkEvent(sLastUiMode, newConfig.uiMode)) { sendDarkModeEvent(); }
    }`,
    commentOnly: `@Override public void onConfigurationChanged(Configuration newConfig) {
      // shouldEmitDarkEvent(sLastUiMode, n); sendDarkModeEvent();
    }`,
  },
  {
    label: 'a/b onResume 判定 ⇄ 发射',
    detect: (code) => hasEmitPair(code, ON_RESUME_SIG),
    hit: `@Override protected void onResume() {
      int current = 1;
      if (shouldEmitDarkEvent(sLastUiMode, current)) { sLastUiMode = current; sendDarkModeEvent(); }
    }`,
    commentOnly: `@Override protected void onResume() {
      /* shouldEmitDarkEvent(sLastUiMode, current) → sendDarkModeEvent() */
    }`,
  },
  {
    label: 'c onDestroy F14 复位',
    detect: (code) => hasDarkSentReset(code, ON_DESTROY_SIG),
    hit: `@Override protected void onDestroy() { cancelLoadTimeout(); sLastDarkSent = ""; }`,
    commentOnly: `@Override protected void onDestroy() {
      /* F14：sLastDarkSent = "" 复位 */
    }`,
  },
  {
    label: 'd 状态栏组合点',
    detect: (code) => code.includes(STATUS_BAR_COMBO),
    hit: `Boolean appearance = resolveStatusBarAppearance(
      resolveIsDark(normalizeDarkMode(readDarkModeRaw(this)), sLastUiMode), statusBarHidden);`,
    commentOnly: '// 决策 = resolveIsDark(normalizeDarkMode(readDarkModeRaw(this)), sLastUiMode)',
  },
  {
    label: 'e splash 组合点',
    detect: (code) => code.includes(SPLASH_COMBO),
    hit: 'int splashThemeId = splashThemeIdFor(normalizeDarkMode(readDarkModeRaw(this)));',
    commentOnly: '/* splash 兜底轨输入 = splashThemeIdFor(normalizeDarkMode(readDarkModeRaw(this))) */',
  },
]

describe('review round-2 发射链 / prefs 组合点代码形态（剥注释后源码级）', () => {
  it('断言器自检：五组检测器命中真实形态夹具；注释夹具剥注释前命中、剥注释后一律不命中', () => {
    for (const { label, detect, hit, commentOnly } of DETECTOR_FIXTURES) {
      expect(detect(stripComments(hit)), `${label}：真实形态夹具未命中 → 检测器失效（真实断言会恒假）`).toBe(
        true,
      )
      // 关键一步：注释夹具在**未剥注释**时必须命中——这正是 review round-2 的 B1/B2 缺陷形态
      // （旧断言口径下「删实现、留注释」即可通过），也是「剥注释」这一步存在的唯一理由。
      expect(detect(commentOnly), `${label}：注释夹具未命中 → 未能复现「注释可满足」缺陷形态`).toBe(true)
      expect(
        detect(stripComments(commentOnly)),
        `${label}：剥注释后注释夹具仍命中 → 剥注释失效（断言恒真）`,
      ).toBe(false)
    }
    // 夹具表规模下界（防表被清空后本自检恒真通过）
    expect(DETECTOR_FIXTURES.length).toBe(5)
  })

  it('方法体抽取自检：花括号配平（不吞下一个方法体、方法体非空）', () => {
    const fixture = `void a() { one(); } void b() { two(); }`
    const body = methodBodyOrFail(stripComments(fixture), /void a\(\s*\)/, 'a')
    expect(body).toContain('one()')
    expect(body, '花括号配平失败：抽取吞入了下一个方法体').not.toContain('two()')
  })

  it('a) onConfigurationChanged：shouldEmitDarkEvent 判定后 200 字符内 sendDarkModeEvent()', () => {
    expect(LYNX_ACTIVITY_CODE, 'LynxActivity.java 缺少 onConfigurationChanged 覆写').toMatch(
      ON_CONFIG_CHANGED_SIG,
    )
    expect(
      hasEmitPair(LYNX_ACTIVITY_CODE, ON_CONFIG_CHANGED_SIG),
      'onConfigurationChanged 内缺少「shouldEmitDarkEvent 判定 → 200 字符内 sendDarkModeEvent() 发射」组合（系统 uiMode 即时翻转链断裂）',
    ).toBe(true)
  })

  it('b) onResume：同组合（后台期间系统翻转未走 configChanges 的兜底补发）', () => {
    expect(LYNX_ACTIVITY_CODE, 'LynxActivity.java 缺少 onResume 覆写').toMatch(ON_RESUME_SIG)
    expect(
      hasEmitPair(LYNX_ACTIVITY_CODE, ON_RESUME_SIG),
      'onResume 内缺少「shouldEmitDarkEvent 判定 → 200 字符内 sendDarkModeEvent() 发射」组合（后台翻转兜底断裂）',
    ).toBe(true)
  })

  it('c) onDestroy：F14 去重哨兵复位 sLastDarkSent = ""（静态字段跨实例复用不得短路新实例首帧）', () => {
    expect(LYNX_ACTIVITY_CODE, 'LynxActivity.java 缺少 onDestroy 覆写').toMatch(ON_DESTROY_SIG)
    expect(
      hasDarkSentReset(LYNX_ACTIVITY_CODE, ON_DESTROY_SIG),
      'onDestroy 内 800 字符内缺少 sLastDarkSent = "" 复位（F14 防线缺失：重建后同一值的首次事件会被旧记忆短路）',
    ).toBe(true)
  })

  it('d) 状态栏组合点：resolveIsDark(normalizeDarkMode(readDarkModeRaw(this)) 成形（唯一读点接线）', () => {
    expect(
      LYNX_ACTIVITY_CODE.includes(STATUS_BAR_COMBO),
      '状态栏外观决策未按「raw 读 + 归一 + 决策」单表达式接线（可能退化为只读系统 uiMode = #692 的零读点缺陷）',
    ).toBe(true)
    // 两处组合点（状态栏 / splash）都必须走同一读点形态；计数为**下界**（允许未来新增消费者）
    const readPoints = LYNX_ACTIVITY_CODE.match(/readDarkModeRaw\(this\)/g) ?? []
    expect(readPoints.length, 'readDarkModeRaw(this) 读点数不足 2（状态栏 / splash 组合点至少各一）').toBeGreaterThanOrEqual(2)
  })

  it('e) splash 组合点：splashThemeIdFor(normalizeDarkMode(readDarkModeRaw(this)) 成形（兜底轨输入同源）', () => {
    expect(
      LYNX_ACTIVITY_CODE.includes(SPLASH_COMBO),
      'splash 兜底轨未按同一读点组合点取输入（可能退化为手写主题 id 或系统 uiMode）',
    ).toBe(true)
  })

  it('f) sendDarkModeEvent：去重短路 → 记录 → 发射 三段式（删短路或删发射即断链）', () => {
    const sig = /private void sendDarkModeEvent\(\s*\)/
    expect(LYNX_ACTIVITY_CODE, 'LynxActivity.java 缺少 sendDarkModeEvent 方法').toMatch(sig)
    const body = methodBodyOrFail(LYNX_ACTIVITY_CODE, sig, 'sendDarkModeEvent')
    const detector = /sLastDarkSent[\s\S]{0,40}?return[\s\S]{0,200}?sendGlobalEvent/
    expect(
      detector.test(body),
      'sendDarkModeEvent 缺少「sLastDarkSent 短路 → sendGlobalEvent 发射」组合（去重不变量断裂或发射丢失）',
    ).toBe(true)
    // 负极对照：同形态仅存在于注释中时，剥注释后不得命中（防检测器被注释满足）
    const commentOnly = '// if (mode.equals(sLastDarkSent)) return;\n// sLastDarkSent = mode;\n// sendGlobalEvent(e)'
    expect(detector.test(stripComments(commentOnly)), '检测器可被注释满足（剥注释失效）').toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// follow-up #692 原生接线机器防线（JS 写入 ⇄ Java 读点 / splash 资源 / 跨语言色值）
//
// 反向守卫（本组存在的理由）：#692 之前 settings_dark_mode 的**原生侧零读点**——
// JS 写键、Java 只读系统 uiMode，手动 light/dark 完全未接线，而测试全绿（JS 侧自洽）。
// 故本组逐条钉「跨语言读点 / 资源名 / 色值」的字面量，任一侧改名或删除即红灯。
// ═══════════════════════════════════════════════════════════════════════════════

describe('#692 三态设置键的原生读点（模板 B：JS 写入 ⇄ Java 读点）', () => {
  it('LynxActivity.java 含设置键字面量 settings_dark_mode（读点存在）', () => {
    expect(LYNX_ACTIVITY_CODE).toContain('settings_dark_mode')
    // 键常量声明（唯一所有者 = Java 侧；TS 侧镜像常量写入侧，见下方 settingsStore 断言）
    expect(LYNX_ACTIVITY_CODE).toContain('KEY_DARK_MODE = "settings_dark_mode"')
    // 读取经 SharedPreferences（与 PictelioPrefsModule 同一文件 "CapacitorStorage"）
    expect(LYNX_ACTIVITY_CODE).toContain('SYSTEMBARS_PREFS = "CapacitorStorage"')
    expect(LYNX_ACTIVITY_CODE).toContain('getSharedPreferences(SYSTEMBARS_PREFS')
  })

  it('LynxActivity.java 含 Resources.ID_NULL（system 复位哨兵，禁兜底到某支手动主题）', () => {
    expect(LYNX_ACTIVITY_CODE).toContain('Resources.ID_NULL')
    // system → 0 哨兵 → ID_NULL 复位（撤销手动选择的唯一通道）
    expect(LYNX_ACTIVITY_CODE).toMatch(/splashThemeId == 0 \? Resources\.ID_NULL/)
  })

  it('LynxActivity.java 含 syncStatusBarHidden（状态栏隐藏态单一写点，B4 闩锁修复接线）', () => {
    expect(LYNX_ACTIVITY_CODE).toContain('syncStatusBarHidden')
    expect(LYNX_ACTIVITY_CODE).toMatch(/syncStatusBarHidden\(boolean hidden\)/)
    // 运行时切换必须回写闩锁（旧缺陷：只在 onCreate 写过一次 → 单向闩锁）
    expect(LYNX_ACTIVITY_CODE).toContain('((LynxActivity) activity).syncStatusBarHidden(hidden)')
  })

  it('settingsStore.ts 含与 Java 键逐字一致的写入侧常量（键名两侧同源）', () => {
    expect(SETTINGS_STORE_CODE).toContain('const DARK_MODE_KEY = "settings_dark_mode"')
  })
})

describe('#692 原生下发方法 applyDarkModePreference（Java 提供 ⇄ JS 调用）', () => {
  it('PictelioAppModule.java 提供 applyDarkModePreference + 主线程转交 Activity', () => {
    expect(APP_MODULE_CODE).toContain('applyDarkModePreference')
    expect(APP_MODULE_CODE).toMatch(/public void applyDarkModePreference\(Callback callback\)/)
    expect(APP_MODULE_CODE).toContain('activity.runOnUiThread(activity::applyDarkModePreference)')
  })

  it('LynxActivity.java 含运行时重下发实现（状态栏外观 + splash 兜底轨同轨重设）', () => {
    expect(LYNX_ACTIVITY_CODE).toMatch(/void applyDarkModePreference\(\)/)
    expect(LYNX_ACTIVITY_CODE).toContain('applySplashScreenThemeFromPref()')
  })

  it('JS 调用方存在：settingsStore.setDarkMode 下发 applyDarkModePreference(cb)', () => {
    // 仅「类型别名里出现方法名」不算接线：必须存在带回调的实调用点
    expect(SETTINGS_STORE_CODE).toMatch(/applyDarkModePreference\(\(err\)/)
    // 分支口径 = setFullscreenMode：原生判定 + 缺方法 warn（禁静默）
    expect(SETTINGS_STORE_CODE).toContain('applyDarkModePreference 不可用')
  })
})

describe('#692 splash 双轨资源（主题名跨配置稳定 + plate 接线）', () => {
  const FILES = [
    { name: 'values/styles.xml', css: VALUES_STYLES_CODE },
    { name: 'values-night/styles.xml', css: VALUES_NIGHT_STYLES_CODE },
  ] as const

  /** 声明式主题条目（`<style name="..." parent="...">`）；注释内提及不计入（css 已剥注释） */
  function styleDecls(css: string): Array<{ name: string; parent: string }> {
    return [...css.matchAll(/<style\s+name="([^"]+)"\s+parent="([^"]+)"/g)].map((m) => ({
      name: m[1]!,
      parent: m[2]!,
    }))
  }

  it('两文件各自定义 Theme.SplashScreen.Light + Dark（名稳定性：跨配置均可解析）', () => {
    for (const { name, css } of FILES) {
      const splash = styleDecls(css).filter((d) => d.name.startsWith('Theme.SplashScreen.'))
      // 精确计数：恰好两支（漏一支 → 反配置下解析失败回落 manifest 主题 = 手动覆盖失效；
      // 多写一支 → 名空间漂移），抽取器失效（如改名/格式变化）亦在此翻红
      expect(splash.map((d) => d.name).sort(), `${name} splash 主题支数`).toEqual([
        'Theme.SplashScreen.Dark',
        'Theme.SplashScreen.Light',
      ])
    }
  })

  it('两文件同名主题集合一致（名不稳定 = 反配置下解析失败）', () => {
    const names = FILES.map(({ css }) =>
      styleDecls(css)
        .map((d) => d.name)
        .filter((n) => n.startsWith('Theme.SplashScreen.'))
        .sort(),
    )
    expect(names[0]).toEqual(names[1])
  })

  it('两文件 plate 接线：两支 splash 主题父主题 = Theme.SplashScreen.IconBackground', () => {
    for (const { name, css } of FILES) {
      const pairs = styleDecls(css)
        .filter((d) => d.name.startsWith('Theme.SplashScreen.'))
        .map((d) => `${d.name}=${d.parent}`)
        .sort()
      // API 31+ IconBackground 覆写才把 platform 属性指向本 app 的 windowSplashScreenIconBackgroundColor；
      // 缺这条父链 → 下面写的 plate 色对系统 splash 完全无效（登记未生效）
      expect(pairs, `${name} 两支 splash 主题的父主题`).toEqual([
        'Theme.SplashScreen.Dark=Theme.SplashScreen.IconBackground',
        'Theme.SplashScreen.Light=Theme.SplashScreen.IconBackground',
      ])
      expect(css, `${name} 缺少 plate 项`).toContain('windowSplashScreenIconBackgroundColor')
    }
  })
})

describe('#692 跨语言色值契约（tokens.css 暗色色板 ⇄ values-night 资源）', () => {
  /** `.theme-sky.dark` 块内 `token: #rrggbb;` 抽取（跨语言色值契约的唯一 oracle 通道）。
   *  切片先剥注释：否则注释里的 `--md-x: #rrggbb;` 形态会被当作真值计入（同 ADR-0163 (b) 纪律）。 */
  function extractSkyDarkHex(): Map<string, string> {
    const selector = '.theme-sky.dark {'
    const start = TOKENS_CSS.indexOf(selector)
    expect(start, `tokens.css 缺少 ${selector}`).toBeGreaterThan(-1)
    const end = TOKENS_CSS.indexOf('\n}', start)
    expect(end, `${selector} 块未闭合（'\\n}' 边界失效）`).toBeGreaterThan(start)
    const block = stripComments(TOKENS_CSS.slice(start, end))
    const map = new Map<string, string>()
    for (const m of block.matchAll(/(--md-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      map.set(m[1]!, m[2]!)
    }
    return map
  }

  const skyDarkHex = extractSkyDarkHex()
  /** 契约锚点清单：抽取器必须**恰好**解析出这 4 项（少一项 = 正则/块边界失效，下方断言会恒真） */
  const ANCHORS = [
    '--md-surface',
    '--md-surface-container',
    '--md-primary',
    '--md-state-pressed-primary',
  ] as const

  it('抽取器自检：.theme-sky.dark 块内锚点 token 全部可解析（非空 + 精确计数）', () => {
    const found = ANCHORS.filter((t) => skyDarkHex.has(t))
    expect(found.length, `抽取器漏解析：${ANCHORS.filter((t) => !skyDarkHex.has(t)).join(', ')}`).toBe(
      ANCHORS.length,
    )
    // 全块 hex 抽取规模下界（块内除 rgba/vw/px 令牌外均为 6 位 hex）
    expect(skyDarkHex.size).toBeGreaterThan(40)
  })

  it('values-night 暗面 = .theme-sky.dark 的 --md-surface（原生 splash 底与 JS 暗面色板同源）', () => {
    const surface = skyDarkHex.get('--md-surface')!
    // 冻结锚点：#101418 既是原生 values-night 的底，也是 JS 暗色 surface —— 任一侧漂移即红灯
    expect(surface.toLowerCase(), '.theme-sky.dark --md-surface 漂移（原生暗面冻结值 #101418）').toBe(
      '#101418',
    )
    expect(VALUES_NIGHT_STYLES_CODE, `values-night/styles.xml 缺少暗面 ${surface}`).toContain(surface)
  })

  it('暗 plate #1C2024 登记于两文件且 ≠ 暗面（离底有差 → 前景圆盘可见）', () => {
    const surface = skyDarkHex.get('--md-surface')!
    const container = skyDarkHex.get('--md-surface-container')!
    // 冻结锚点：暗 plate = .theme-sky.dark 的 --md-surface-container（面上方一阶）
    expect(container.toLowerCase(), '--md-surface-container 对应 plate 冻结值 #1C2024').toBe('#1c2024')
    for (const [name, css] of [
      ['values/styles.xml', VALUES_STYLES_CODE],
      ['values-night/styles.xml', VALUES_NIGHT_STYLES_CODE],
    ] as const) {
      expect(css, `${name} 缺少暗色 plate #1C2024`).toContain('#1C2024')
    }
    // 离底有差（亮色轨 plate==底 为有意；暗色轨必须可分辨，否则前景圆盘不可见）
    expect(container.toLowerCase()).not.toBe(surface.toLowerCase())
  })
})
