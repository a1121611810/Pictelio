// 相册保存桥 + 下载队列桥跨语言契约测试（ADR-0192 D4/D7/D8 + spec docs/specs/lynx-download-naming.md
// Testing「桥字面量漂移契约测试」；模式 = clipboardBridgeContract.test.ts / ADR-0174：
// Java 源码常量提取比对，任一侧漂移即红灯，oracle = 真实源码非手写自洽）。
//
// 钉死面：
// ① lynx 桥 PictelioGalleryModule：saveImage（三参既有）/ saveImageTo（四参新增，dir 可选段）
//    方法名字面量 + 回调双参形态 + LynxRuntimeInitializer 注册；
//    ⚠️ 读点现状（#1043 review）：这两个 @LynxMethod 已**无 JS 调用方**——唯一调用者
//    `gallerySaver.ts` 随死代码删除，Java 侧 `PictelioDownloaderModule` 只用静态
//    `PictelioGalleryModule.imageLoader`。故本段是「原生 API 注册契约」防线，**不是**
//    「活链路」防线；彻底删除需同步改 Java 注册与 rspeedy-env 类型声明。
// ② ~~TS 适配器 gallerySaver.ts 的 dir 分派~~ —— 该 TS 适配器已随死代码清理删除
//    （保存链早已改走 buildImageTasks + lynxDownloadExecutor 原生下载队列，
//    gallerySaveAvailable / saveImageToGallery 零生产调用方），断言与源文件读取一并移除；
// ③ 深模块 GallerySaver：基座常量 RELATIVE_PATH = "Pictures/Pictelio"、subPath 追加形态、
//    sanitizeFileName 防御性净化规则与 JS sanitizeNameSegment 逐字镜像（双端同规则）；
// ④ ~~Capacitor 契约同形（ADR-0192 D8）~~ —— #610 起 Capacitor 线整体下线，断言移除；
// ⑤ 下载队列桥（T6）：PictelioDownloaderModule.start 载荷 dir 参数（可选、缺省空串）、
//    TS 执行器 lynxDownloadExecutor 逐字透传 task.dir、深模块 PictelioDownloader 三入口
//    dir 重载交给 GallerySaver subPath（图片链 Pictures/Pictelio、导出链 Downloads/Pictelio）。
//
// Java 路径：随宿主迁移指向 **最终位置** `packages/android-host/android/`（ADR-0203 决策 2）。
// 本文件在 `src/utils/`（深两级），故 `../../../` 到 `packages/`，再进 `android-host/android/app/`。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 宿主 Android 源码根（ADR-0203 决策 2：packages/app/android → packages/android-host/android） */
const HOST_APP = new URL('../../../android-host/android/app/src/', import.meta.url)

const javaModule = readFileSync(
  fileURLToPath(new URL('lynx/java/io/pictelio/app/PictelioGalleryModule.java', HOST_APP)),
  'utf8',
)
const javaInitializer = readFileSync(
  fileURLToPath(new URL('lynx/java/io/pictelio/app/LynxRuntimeInitializer.java', HOST_APP)),
  'utf8',
)
const javaDeepModule = readFileSync(
  fileURLToPath(new URL('main/java/io/pictelio/app/GallerySaver.java', HOST_APP)),
  'utf8',
)
// #610：WebView/Capacitor 线整体下线，GallerySaverPlugin.java 随之删除。
// 原 ADR-0192 D8 的「Capacitor 契约同形」断言失去被测对象，
// 连同其源文件读取一并移除。Lynx 侧（①/③/⑤）断言不受影响，继续钉死。
// TS 侧适配器 gallerySaver.ts 已随死代码清理删除（保存链早已改走 buildImageTasks +
// lynxDownloadExecutor 原生下载队列，两个导出零生产调用方），其 ② 段断言与
// tsAdapter 源文件读取随之移除——留着只会读一个不存在的文件。
const tsNaming = readFileSync(fileURLToPath(new URL('./galleryDownload.ts', import.meta.url)), 'utf8')
const javaDownloaderModule = readFileSync(
  fileURLToPath(new URL('lynx/java/io/pictelio/app/PictelioDownloaderModule.java', HOST_APP)),
  'utf8',
)
const javaDownloaderDeep = readFileSync(
  fileURLToPath(new URL('main/java/io/pictelio/app/PictelioDownloader.java', HOST_APP)),
  'utf8',
)
const tsExecutor = readFileSync(fileURLToPath(new URL('./lynxDownloadExecutor.ts', import.meta.url)), 'utf8')

describe('相册保存桥 TS ⇄ Java 契约（ADR-0192 D4/D7）', () => {
  it('原生桥既有三参 saveImage 签名保持不动（现无 JS 调用方，见文件头 ①）', () => {
    expect(javaModule).toContain('public void saveImage(String url, String fileName, Callback callback)')
  })

  it('新增四参 saveImageTo：dir = 目录段（非模板），带 @LynxMethod', () => {
    expect(javaModule).toContain(
      'public void saveImageTo(String url, String fileName, String dir, Callback callback)',
    )
    // 方法注解紧邻（@LynxMethod 与 saveImageTo 之间无其他方法声明）
    const annotated = javaModule.match(/@LynxMethod\s+public void saveImageTo\(/)
    expect(annotated).not.toBeNull()
  })

  it('回调双参契约：成功 cb(uri, "")、失败 cb("", msg)', () => {
    expect(javaModule).toContain('callback.invoke(r.uri.toString(), "")')
    expect(javaModule).toContain('callback.invoke("", ')
  })

  it('注册存在：LynxRuntimeInitializer 有 PictelioGallery', () => {
    expect(javaInitializer).toContain('registerModule("PictelioGallery", PictelioGalleryModule.class)')
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

})

// ── 下载队列桥 TS ⇄ Java 契约（T6 / ADR-0192 D4/D7 / spec D5/D7）───
describe('下载队列桥 TS ⇄ Java 契约（ADR-0192 D4/D7）', () => {
  it('start 载荷：dir 为第 8 参（Callback 前），带 @LynxMethod——TS/Java 参数序一致', () => {
    expect(javaDownloaderModule).toContain(
      'public void start(String id, String sourceUrl, String fileName, String kind, String targetFormat,\n            String framesJson, String payloadJson, String dir, Callback callback) {',
    )
    // 方法注解紧邻（@LynxMethod 与 start 之间无其他方法声明）
    expect(javaDownloaderModule.match(/@LynxMethod\s+public void start\(/)).not.toBeNull()
    // TS 执行器接口与调用同序（dir 在 payloadJson 之后、回调之前）
    expect(tsExecutor).toContain('payloadJson: string,\n    /** 作者目录段（ADR-0192 D7；空串 = 无子目录，字节不变） */\n    dir: string,')
    expect(tsExecutor).toContain('native.start(task.id, task.sourceUrl, task.fileName, task.kind, task.targetFormat, framesJson, payloadJson, task.dir ?? \'\', (uri, err) => {')
  })

  it('dir 可选语义：Java 壳层 null → 空串（字节不变），净化不在壳层（单一事实源在 JS）', () => {
    expect(javaDownloaderModule).toContain('final String authorDir = dir == null ? "" : dir;')
    expect(javaDownloaderModule).toContain('PictelioDownloader.download(app, PictelioGalleryModule.imageLoader(app),\n                            id, sourceUrl, fileName, authorDir, listener)')
    expect(javaDownloaderModule).toContain('PictelioDownloader.downloadUgoira(app, PictelioGalleryModule.imageLoader(app),\n                            id, sourceUrl, targetFormat, fileName, authorDir, framesJson, listener)')
    expect(javaDownloaderModule).toContain('PictelioDownloader.downloadNovel(app, PictelioGalleryModule.imageLoader(app),\n                            id, payloadJson, targetFormat, fileName, authorDir, listener)')
  })

  it('深模块三入口：老签名保留+ dir 重载交 GallerySaver subPath', () => {
    // 老签名委托空串 = 现行为字节不变
    expect(javaDownloaderDeep).toContain('return download(context, loader, id, sourceUrl, fileName, "", listener);')
    expect(javaDownloaderDeep).toContain('return downloadUgoira(context, loader, id, zipUrl, format, fileName, "", framesJson, listener);')
    expect(javaDownloaderDeep).toContain('return downloadNovel(context, loader, id, payloadJson, format, fileName, "", listener);')
    // 新签名落盘：图片链 → saveFile subPath（Pictures/Pictelio 基座）；导出链 → saveDownloadFile subPath
    expect(javaDownloaderDeep).toContain('GallerySaver.saveFile(context, source, fileName, dir)')
    expect(javaDownloaderDeep).toContain('GallerySaver.saveDownloadFile(context, exported, fileName, dir)')
  })

  it('GallerySaver.saveDownloadFile 四参重载（Downloads/Pictelio 基座 + subPath 追加同形）', () => {
    expect(javaDeepModule).toContain(
      'public static SaveResult saveDownloadFile(Context context, File source, String fileName,\n            String subPath) throws IOException {',
    )
    // Downloads 基座 = DIRECTORY_DOWNLOADS + "/" + DOWNLOAD_DIR_NAME，subPath 追加在基座之后
    expect(javaDeepModule).toContain('String base = Environment.DIRECTORY_DOWNLOADS + "/" + DOWNLOAD_DIR_NAME;')
    expect(javaDeepModule).toContain('subPath == null || subPath.isEmpty() ? base : base + "/" + subPath')
  })

  it('任务类型：DownloadTask.dir 可选字段（空串 = 无子目录）+ 队列快照透传（ADR-0192 D7）', () => {
    // 队列核心任务类型 dir 字段（单一事实源注释锚点）
    const queueCore = readFileSync(fileURLToPath(new URL('./downloadQueueCore.ts', import.meta.url)), 'utf8')
    expect(queueCore).toContain('dir?: string')
    // 任务构造：buildImageTasks / buildUgoiraTask 均经 buildAuthorDirSegment 统一产出（spec D6）
    expect(tsNaming).toContain('buildAuthorDirSegment(naming?.authorDir === true, illust.user?.name)')
  })
})
