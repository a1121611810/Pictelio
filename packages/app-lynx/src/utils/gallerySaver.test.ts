// gallerySaver 桥单测（spec docs/specs/image-save-download.md §3 D3/§6）。
// oracle = Java 侧 PictelioGalleryModule 回调契约（cb(uri, "") / cb("", errMsg)，无 null）
// + Lynx Callback.invoke(String) JSON 序列化语义（tokenStorage.unquoteNativeString 实证注释）。
// web-core 无 NativeModules → 显式拒绝「当前环境不支持保存到相册」+ warn（无静默）。
import { afterEach, describe, expect, it, vi } from "vitest"
import { gallerySaveAvailable, saveImageToGallery } from "./gallerySaver"

type NativeModulesShape = {
  PictelioGallery?: {
    saveImage(url: string, fileName: string, cb: (uri: string, err: string) => void): void
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
