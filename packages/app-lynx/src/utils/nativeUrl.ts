import { getNativeModules } from "../api/client"

/**
 * 经原生桥用系统浏览器打开外部 URL（单一实现，供 updateStore 与榜单 R-18 指引复用）。
 * 原生桥缺失（web-core 预览）或失败时 console.warn（禁静默降级）。
 * 注：warn 文案用 console 实参串（非模板插值），以通过硬编码中文门禁的 console 豁免。
 */
export function openExternalUrl(url: string, tag: string): void {
  const module = getNativeModules()?.PictelioApp as
    | { openUrl?: (url: string, cb?: (err: string | null) => void) => void }
    | undefined
  if (!module?.openUrl) {
    console.warn("[nativeUrl] 原生桥 openUrl 不可用（web-core 预览属预期），请手动打开:", tag, url)
    return
  }
  module.openUrl(url, (err) => {
    if (err) console.warn("[nativeUrl] 打开链接失败:", tag, err)
  })
}
