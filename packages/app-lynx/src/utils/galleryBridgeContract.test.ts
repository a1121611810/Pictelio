// 相册保存桥跨语言契约测试（ADR-0192 D4/D7/D8 + spec docs/specs/lynx-download-naming.md
// Testing「桥字面量漂移契约测试」；模式 = clipboardBridgeContract.test.ts / ADR-0174：
// Java 源码常量提取比对，任一侧漂移即红灯，oracle = 真实源码非手写自洽）。
//
// 钉死面：
// ① lynx 桥 PictelioGalleryModule：saveImage（三参既有）/ saveImageTo（四参新增，dir 可选段）
//    方法名字面量 + 回调双参形态 + LynxRuntimeInitializer 注册；
// ② TS 适配器 gallerySaver.ts：dir 缺省空串走 saveImage（旧原生包兼容）、非空走 saveImageTo；
// ③ 深模块 GallerySaver：基座常量 RELATIVE_PATH = "Pictures/Pictelio"、subPath 追加形态、
//    sanitizeFileName 防御性净化规则与 JS sanitizeNameSegment 逐字镜像（双端同规则）；
// ④ Capacitor 契约同形（ADR-0192 D8）：GallerySaverPlugin.saveImage 可选 dir 载荷键。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const javaModule = readFileSync(
  fileURLToPath(new URL('../../../app/android/app/src/lynx/java/io/pictelio/app/PictelioGalleryModule.java', import.meta.url)),
  'utf8',
)
const javaInitializer = readFileSync(
  fileURLToPath(new URL('../../../app/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java', import.meta.url)),
  'utf8',
)
const javaDeepModule = readFileSync(
  fileURLToPath(new URL('../../../app/android/app/src/main/java/io/pictelio/app/GallerySaver.java', import.meta.url)),
  'utf8',
)
const javaCapacitorPlugin = readFileSync(
  fileURLToPath(new URL('../../../app/android/app/src/webview/java/io/pictelio/app/GallerySaverPlugin.java', import.meta.url)),
  'utf8',
)
const tsAdapter = readFileSync(fileURLToPath(new URL('./gallerySaver.ts', import.meta.url)), 'utf8')
const tsNaming = readFileSync(fileURLToPath(new URL('./galleryDownload.ts', import.meta.url)), 'utf8')

describe('相册保存桥 TS ⇄ Java 契约（ADR-0192 D4/D7）', () => {
  it('既有三参 saveImage 保持不动（旧调用点兼容）', () => {
    expect(javaModule).toContain('public void saveImage(String url, String fileName, Callback callback)')
  })

  it('新增四参 saveImageTo：dir = JS 展开好的目录段（非模板），带 @LynxMethod', () => {
    expect(javaModule).toContain(
      'public void saveImageTo(String url, String fileName, String dir, Callback callback)',
    )
    // 方法注解紧邻（@LynxMethod 与 saveImageTo 之间无其他方法声明）
    const annotated = javaModule.match(/@LynxMethod\s+public void saveImageTo\(/)
    expect(annotated).not.toBeNull()
  })

  it('回调双参契约：成功 cb(uri, "")、失败 cb("", msg)——与 TS 判据一致', () => {
    expect(javaModule).toContain('callback.invoke(r.uri.toString(), "")')
    expect(javaModule).toContain('callback.invoke("", ')
    // TS 侧以 err 非空判失败（unquote 后消费）
    expect(tsAdapter).toContain('unquoteNativeString(err)')
  })

  it('注册存在：LynxRuntimeInitializer 有 PictelioGallery，模块名与 TS 探测键一致', () => {
    expect(javaInitializer).toContain('registerModule("PictelioGallery", PictelioGalleryModule.class)')
    expect(tsAdapter).toContain('PictelioGallery')
  })

  it('TS 适配器：dir 缺省空串走 saveImage（字节不变）；非空走 saveImageTo 四参透传', () => {
    expect(tsAdapter).toContain('saveImageToGallery(url: string, fileName: string, dir = "")')
    expect(tsAdapter).toContain('mod.saveImage(url, fileName, onDone)')
    expect(tsAdapter).toContain('mod.saveImageTo(url, fileName, dir, onDone)')
    // 版本漂移（原生缺 saveImageTo）显式失败，不静默降级平铺
    expect(tsAdapter).toContain("typeof mod.saveImageTo !== 'function'")
  })

  it('深模块基座常量：RELATIVE_PATH = "Pictures/Pictelio"，subPath 追加在基座之后', () => {
    expect(javaDeepModule).toContain('static final String RELATIVE_PATH = "Pictures/Pictelio"')
    expect(javaDeepModule).toContain('RELATIVE_PATH + "/" + subPath')
    // 深模块入口：save / saveFile 均有可选 subPath 重载
    expect(javaDeepModule).toContain(
      'public static SaveResult save(Context context, PixivImageLoader loader, String officialUrl,\n            String fileName, String subPath) throws IOException',
    )
    expect(javaDeepModule).toContain(
      'public static SaveResult saveFile(Context context, File source, String fileName, String subPath)\n            throws IOException',
    )
  })

  it('净化规则双端逐字镜像：JS sanitizeNameSegment ⇄ Java sanitizeFileName（同一替换表）', () => {
    // JS：路径分隔符与控制字符 → _（galleryDownload 单一事实源第一道）
    // Java 源文本：input.replace(/[/\\\x00-\x1f]/g, "_")
    expect(tsNaming).toContain('input.replace(/[/\\\\\\x00-\\x1f]/g, "_")')
    // Java：同一替换表（第二道防御，ADR-0145 边界保持不动）
    // Java 源文本：fileName.replaceAll("[/\\\\\\x00-\\x1f]", "_")（6+2 个反斜杠字符）
    expect(javaDeepModule).toContain('fileName.replaceAll("[/\\\\\\\\\\\\x00-\\\\x1f]", "_")')
  })

  it('Capacitor 契约同形（ADR-0192 D8）：GallerySaverPlugin.saveImage 读可选 dir 载荷', () => {
    expect(javaCapacitorPlugin).toContain('call.getString("dir")')
    // webview 同走深模块 subPath 重载（dir null → 空串字节不变）
    expect(javaCapacitorPlugin).toContain('dir == null ? "" : dir')
  })
})
