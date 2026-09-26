// gallerySaver 桥单测（spec docs/specs/image-save-download.md §3 D3/§6）。
// oracle = Java 侧 PictelioGalleryModule 回调契约（cb(uri, "") / cb("", errMsg)，无 null）
// + Lynx Callback.invoke(String) JSON 序列化语义（tokenStorage.unquoteNativeString 实证注释）。
// web-core 无 NativeModules → 显式拒绝「当前环境不支持保存到相册」+ warn（无静默）。
import { afterEach, describe, expect, it, vi } from "vitest"
import { gallerySaveAvailable, saveImageToGallery } from "./gallerySaver"

type NativeModulesShape = {
  PictelioGallery?: {
    saveImage(url: string, fileName: string, cb: (uri: string, err: string) => void): void
    saveImageTo?(
      url: string,
      fileName: string,
      dir: string,
      cb: (uri: string, err: string) => void,
    ): void
  }
}

function setNativeModules(mod: NativeModulesShape | undefined): void {
  ;(globalThis as { NativeModules?: NativeModulesShape }).NativeModules = mod
}

afterEach(() => {
  setNativeModules(undefined)
  vi.restoreAllMocks()
})

describe("gallerySaveAvailable", () => {
  it("有 PictelioGallery → true；无 → false", () => {
    setNativeModules({ PictelioGallery: { saveImage: () => {} } })
    expect(gallerySaveAvailable()).toBe(true)
    setNativeModules(undefined)
    expect(gallerySaveAvailable()).toBe(false)
  })
})

describe("saveImageToGallery", () => {
  it("成功：cb(JSON 序列化 uri, \"\") → resolve 去引号 uri", async () => {
    setNativeModules({
      PictelioGallery: {
        saveImage: (url, fileName, cb) => {
          expect(url).toBe("https://i.pximg.net/img-original/1_p0.jpg")
          expect(fileName).toBe("Pictelio_1_p0.jpg")
          // native→JS 字符串 JSON 序列化（首尾带引号，实测语义）
          cb('"content://media/external_primary/images/media/42"', "")
        },
      },
    })
    await expect(saveImageToGallery("https://i.pximg.net/img-original/1_p0.jpg", "Pictelio_1_p0.jpg")).resolves.toBe(
      "content://media/external_primary/images/media/42",
    )
  })

  it("失败：cb(\"\", errMsg) → reject 可读错误 + console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    setNativeModules({
      PictelioGallery: {
        saveImage: (_url, _fileName, cb) =>
          // invoke("", errMsg) 的 JSON 序列化形态：首参 '""'、次参带引号
          cb('""', '"保存失败: HTTP 404"'),
      },
    })
    await expect(saveImageToGallery("u", "f.jpg")).rejects.toThrow("HTTP 404")
    expect(warn).toHaveBeenCalled()
  })

  it("web-core（无 NativeModules）→ 显式拒绝，不触原生", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(saveImageToGallery("u", "f.jpg")).rejects.toThrow("当前环境不支持保存到相册")
    expect(warn).toHaveBeenCalled()
  })
})

// ─── dir 子目录透传（ADR-0192 D4 / spec docs/specs/lynx-download-naming.md D7）───
// oracle = PictelioGalleryModule.saveImageTo 四参签名 + GallerySaver.save 可选 subPath
// （空串 = 现行为字节不变，走既有三参 saveImage 保持旧原生包兼容）。
describe("saveImageToGallery dir 透传（ADR-0192 D4）", () => {
  it("dir 非空 → 走 saveImageTo(url, fileName, dir, cb)，回调和 saveImage 同契约", async () => {
    const saveImage = vi.fn()
    setNativeModules({
      PictelioGallery: {
        saveImage,
        saveImageTo: (url, fileName, dir, cb) => {
          expect(url).toBe("https://i.pximg.net/img-original/1_p0.jpg")
          expect(fileName).toBe("Pictelio_1.jpg")
          expect(dir).toBe("画师名")
          cb('"content://media/external_primary/images/media/7"', "")
        },
      },
    })
    await expect(saveImageToGallery("https://i.pximg.net/img-original/1_p0.jpg", "Pictelio_1.jpg", "画师名")).resolves.toBe(
      "content://media/external_primary/images/media/7",
    )
    expect(saveImage).not.toHaveBeenCalled()
  })

  it("dir 缺省/空串 → 走既有三参 saveImage（现行为字节不变，不触 saveImageTo）", async () => {
    const saveImage = vi.fn((_url: string, _fileName: string, cb: (uri: string, err: string) => void) =>
      cb('"content://media/external_primary/images/media/1"', ""),
    )
    const saveImageTo = vi.fn()
    setNativeModules({ PictelioGallery: { saveImage, saveImageTo } })
    await expect(saveImageToGallery("u", "f.jpg")).resolves.toBe("content://media/external_primary/images/media/1")
    await expect(saveImageToGallery("u", "f.jpg", "")).resolves.toBe("content://media/external_primary/images/media/1")
    expect(saveImageTo).not.toHaveBeenCalled()
  })

  it("原生缺 saveImageTo（版本漂移）+ dir 非空 → 显式失败 + warn（禁静默降级平铺）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    setNativeModules({ PictelioGallery: { saveImage: () => {} } })
    await expect(saveImageToGallery("u", "f.jpg", "作者")).rejects.toThrow("不支持子目录保存")
    expect(warn).toHaveBeenCalled()
  })
})
