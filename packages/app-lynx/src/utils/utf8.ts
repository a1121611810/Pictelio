// ─── 纯 JS UTF-8 编解码（Lynx JS runtime 不提供 TextEncoder / TextDecoder） ───
//
// 真机实测（2026-09-19，app-lynx PrimJS；SharedPreferences 探针读回）：
//   typeof TextEncoder === "undefined" · typeof TextDecoder === "undefined"
//   typeof crypto === "undefined" · typeof indexedDB === "undefined"
// 2026-09-11 的 WebDAV 备份实测同样结论 —— 当时已在本目录 backupCore.ts 内联实现
// utf8Encode/utf8Decode；翻译缓存 FNV-1a 又独立用了 Web API，真机直接抛 ReferenceError
// （translateChapter 同步段中断 → 按钮永久停在「0% 翻译中」）。本文件把纯 JS 实现收敛为
// 单一事实源，新增使用点不再各自复制一份（防同一坑第三次复发）。

/**
 * UTF-8 编码（含代理对 → 4 字节序列）。
 *
 * 与 `TextEncoder#encode` 的差异：孤立代理项按「逐 code unit」编码（`TextEncoder` 产出
 * U+FFFD），但调用方只把它用于哈希 / 序列化自产字符串，不存在孤立代理面的输入。
 */
export function utf8Encode(input: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      }
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return new Uint8Array(bytes)
}

/** UTF-8 解码（代理对还原为 4 字节序列对应的 UTF-16 代理对）。 */
export function utf8Decode(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i]
    let code: number
    let size: number
    if (b0 < 0x80) {
      code = b0
      size = 1
    } else if ((b0 & 0xe0) === 0xc0) {
      code = b0 & 0x1f
      size = 2
    } else if ((b0 & 0xf0) === 0xe0) {
      code = b0 & 0x0f
      size = 3
    } else {
      code = b0 & 0x07
      size = 4
    }
    for (let k = 1; k < size; k++) code = (code << 6) | (bytes[i + k] & 0x3f)
    i += size
    if (code > 0xffff) {
      const c = code - 0x10000
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff))
    } else {
      out += String.fromCharCode(code)
    }
  }
  return out
}
