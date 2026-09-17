// 剪贴板桥跨语言契约测试（spec docs/specs/app-lynx-novel-text-selection.md §Testing Decisions：
// 「Java 模块名/方法名与 TS 侧一致（从 PictelioClipboardModule.java 源码提取常量比对）；
// 模块注册在 LynxRuntimeInitializer 存在（源级断言）」）。
//
// oracle（真实来源，非手写自洽）：① Java 源码本身（模块名/方法名/回调形态的唯一事实源）；
// ② TS 适配器源码（接口方法名）；③ 注册表源码（LynxRuntimeInitializer 的 registerModule 行）。
// 先例：packages/app/tests/unit/differential/webdavBridgeContract.test.ts（同款源码提取比对）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const javaModule = readFileSync(
  fileURLToPath(new URL('../../../app/android/app/src/lynx/java/io/pictelio/app/PictelioClipboardModule.java', import.meta.url)),
  'utf8',
)
const javaInitializer = readFileSync(
  fileURLToPath(new URL('../../../app/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java', import.meta.url)),
  'utf8',
)
const tsAdapter = readFileSync(fileURLToPath(new URL('./lynxClipboard.ts', import.meta.url)), 'utf8')

describe('剪贴板桥 TS ⇄ Java 契约', () => {
  it('方法名一致：TS 适配器调用的 setText 在 Java 侧存在且带 @LynxMethod', () => {
    const tsMethod = /setText\(text: string/.exec(tsAdapter)?.[0]
    expect(tsMethod).toBeDefined()
    expect(javaModule).toContain('@LynxMethod')
    expect(javaModule).toContain('public void setText(String text, Callback callback)')
  })

  it('回调双参形态：成功 ("1", "")、失败 ("", 非空原因)——与 TS 判据一致', () => {
    expect(javaModule).toContain('callback.invoke("1", "")')
    expect(javaModule).toContain('callback.invoke("", ')
    // TS 侧以 ok === '1' 判成功（review N2：只看 err 会把契约破坏当成功）
    expect(tsAdapter).toContain("ok !== '1'")
  })

  it('注册存在且只在全局表：LynxRuntimeInitializer 有 PictelioClipboard', () => {
    expect(javaInitializer).toContain('registerModule("PictelioClipboard", PictelioClipboardModule.class)')
  })

  it('模块名与 TS 侧探测键一致（NativeModules.PictelioClipboard）', () => {
    const registered = /registerModule\("([^"]+)", PictelioClipboardModule/.exec(javaInitializer)?.[1]
    expect(registered).toBe('PictelioClipboard')
    expect(tsAdapter).toContain('PictelioClipboard')
  })

  it('类构造函数形态：LynxModule + public (Context)（平台约束，先例 PictelioShareModule）', () => {
    expect(javaModule).toContain('extends LynxModule')
    expect(javaModule).toContain('public PictelioClipboardModule(Context context)')
  })
})
