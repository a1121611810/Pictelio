// ─── 引擎切换 JS↔Java 契约测试（#806）───
// 模式 = darkModeJavaContract.test.ts / safeAreaJavaContract.test.ts
//       （Java 源码字面量提取，任一侧漂移即红灯）。
//
// 为什么需要本文件（review B1 反事实检验）：
//   仅测 TS 侧 `normalizeKinds` 时，把 Java 侧改回 `callback.invoke(BuildConfig.CLIENT_KINDS)`
//   （旧写法）app-lynx **全绿**——因为旧写法因 `Callback.invoke(Object...)` 是变参签名，
//   把 String[] 摊平成位置参数，JS 实收字符串 `"lynx"` 而非数组。
//   ⇒ 覆盖面必须含**发送方**。本文件即该机器防线。
//
// 平台事实（ADR-0163 (b)：平台行为 = 探针记录 + 源级守卫，happy-dom 单测不作 Lynx 运行时 oracle）：
//   `com.lynx.react.bridge.Callback` 的唯一签名是 `void invoke(Object... args)`（变参）。
//   `javap` 实证（lynx-4.0.1.aar）：
//     public abstract void invoke(java.lang.Object...);
//   故：传 String[] → 数组被摊平成位置参数；传 JSONArray → 亦不转成 JS 数组
//   （真机 logcat 诊断：typeof="object"、Array.isArray=false、JSON.stringify=null）。
//   ⇒ 唯一可靠送达形态是 **JSON 文本**。
//
// 断言纪律：断言一律跑在 stripComments 之后的文本上（下方 *_CODE），禁用原文——
// 否则「删实现、只在注释里留一句」照样全绿。
//
// Java 路径：随宿主迁移指向 **最终位置** `packages/android-host/android/`（ADR-0203 决策 2）。
// 本文件在 `src/utils/`（深两级），故 `../../../` 到 `packages/`，再进 `android-host/android/app/`。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 剥注释：块注释 → XML 注释 → 行注释（块注释必须先行，否则块内的 // 会先被行注释截断） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\/[^\n]*/g, '')
}

const APP_MODULE_CODE = stripComments(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
)

const APP_BUILD_GRADLE_CODE = stripComments(
  readFileSync(
    fileURLToPath(new URL('../../../android-host/android/app/build.gradle', import.meta.url)),
    'utf8',
  ),
)

const ME_VUE_CODE = stripComments(
  readFileSync(fileURLToPath(new URL('../pages/Me.vue', import.meta.url)), 'utf8'),
)

/** 截取 getClientKinds 方法体（到下一个方法声明或类尾为止） */
function methodBody(code: string, signature: string): string {
  const at = code.indexOf(signature)
  if (at < 0) return ''
  const rest = code.slice(at + signature.length)
  const next = rest.search(/\n\s{4}(?:@LynxMethod|public|private|protected|\})/)
  return next < 0 ? rest : rest.slice(0, next)
}

const GET_CLIENT_KINDS_BODY = methodBody(APP_MODULE_CODE, 'public void getClientKinds(Callback callback)')

describe('#806 引擎切换桥：送达形态（发送方防线）', () => {
  it('getClientKinds 方法体存在（抽取器下界自检：抽取器失效时本组会全空）', () => {
    expect(GET_CLIENT_KINDS_BODY).not.toBe('')
    expect(GET_CLIENT_KINDS_BODY).toContain('JSONArray')
  })

  it('✅ 正确形态：以 JSON 文本送达（callback.invoke(kinds.toString())）', () => {
    expect(GET_CLIENT_KINDS_BODY).toContain('kinds.toString()')
  })

  it('❌ 反向钉子：不得回退为 callback.invoke(BuildConfig.CLIENT_KINDS)（变参摊平）', () => {
    // 这正是本次修复前的写法。回退 = 桥再次摊平 = availableKinds=null
    // → supportsClientSwitch(null) 按「未知=视为支持」返回 true → 单引擎包重现客户端卡。
    expect(GET_CLIENT_KINDS_BODY).not.toContain('callback.invoke(BuildConfig.CLIENT_KINDS)')
  })

  it('❌ 反向钉子：不得回退为裸传 JSONArray（实测不转成 JS 数组）', () => {
    expect(GET_CLIENT_KINDS_BODY).not.toMatch(/callback\.invoke\(kinds\)/)
  })

  it('遍历 CLIENT_KINDS 逐项入 JSONArray（多引擎取值同样可送达）', () => {
    expect(GET_CLIENT_KINDS_BODY).toMatch(/for\s*\(\s*String\s+\w+\s*:\s*BuildConfig\.CLIENT_KINDS\s*\)/)
    expect(GET_CLIENT_KINDS_BODY).toContain('.put(')
  })
})

describe('#806 引擎切换桥：错误路径不得伪装成成功（review S1）', () => {
  it('catch 分支以 (null, errMsg) 双参回调——与 TS 声明 (kinds, err) 同形', () => {
    // 反例（修复前）：catch 走 callback.invoke(String.valueOf(e.getMessage()))
    // → 错误串落进 kinds 槽，JS 的 `if (!err)` 判为成功 → normalizeKinds(错误串) → null
    // → 卡片重现，且全程无告警。
    expect(GET_CLIENT_KINDS_BODY).toMatch(/callback\.invoke\(\s*null\s*,/)
  })

  it('异常路径留痕（Log.w），不留静默失败（AGENTS.md 测试硬约束 #3）', () => {
    expect(GET_CLIENT_KINDS_BODY).toContain('Log.w(')
  })
})

describe('#806 CLIENT_KINDS 事实源：gradle → Java → JS 单引擎取值', () => {
  it('build.gradle 声明 CLIENT_KINDS 为 {"lynx"}（单引擎塌缩后的唯一事实源）', () => {
    expect(APP_BUILD_GRADLE_CODE).toMatch(/buildConfigField\s+"String\[\]"\s*,\s*"CLIENT_KINDS"\s*,\s*'?\{"lynx"\}'?/)
  })

  it('build.gradle 已无 flavorDimensions client（单引擎化后不再按 flavor 注入）', () => {
    expect(APP_BUILD_GRADLE_CODE).not.toContain('flavorDimensions')
  })
})

describe('#806 Me.vue 门控：客户端卡仍挂在 supportsClientSwitch 上', () => {
  it('客户端组由 supportsClientSwitch 门控（删掉 v-if 必须红）', () => {
    // review B1 第二半：此前无任何测试断言 Me.vue 消费该门控，
    // 删掉 v-if 全程无感。
    expect(ME_VUE_CODE).toMatch(/v-if="supportsClientSwitch\(clientSwitch\.availableKinds\)"/)
  })

  it('全屏模式已移出引擎门控（#806 修复自引入回归的防线）', () => {
    // 全屏模式是 Lynx 侧沉浸式功能（systembars D5），与引擎无关，
    // 不得随单引擎隐藏客户端组而一并消失。
    const gateAt = ME_VUE_CODE.indexOf('v-if="supportsClientSwitch(clientSwitch.availableKinds)"')
    const fullscreenAt = ME_VUE_CODE.indexOf('ME_A11Y_LABELS.fullscreenMode')
    expect(gateAt).toBeGreaterThanOrEqual(0)
    expect(fullscreenAt).toBeGreaterThan(gateAt)
    // 门控块在「客户端组标题」之后即结束：全屏模式必须在其块外
    const gateEnd = ME_VUE_CODE.indexOf('me.client.restarting', gateAt)
    expect(gateEnd).toBeGreaterThan(gateAt)
    expect(fullscreenAt).toBeGreaterThan(gateEnd)
  })
})
