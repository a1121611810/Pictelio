// ─── WebDAV NativeModules 桥（app-lynx 薄桥，ADR-0156 D1 / spec webdav-backup §4）───
// 与 app native/WebDav.ts 同源同语义（双端差分对齐约定）：
// 统一类型 + base64 字节过桥 + cb(code, payload) → WebDavError 分类映射。
// 协议逻辑全在 Java PictelioWebDavModule → WebDavClient / BackupCrypto。
import { isNativeMode } from "../api/client"

/** 与 Java WebDavClient.Kind 逐字一致（+CRYPTO：密码错误或文件损坏） */
export type WebDavErrorKind =
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "QUOTA_EXCEEDED"
  | "CONFLICT"
  | "NETWORK"
  | "SERVER"
  | "CRYPTO"

export const WEBDAV_ERROR_KINDS: readonly WebDavErrorKind[] = [
  "AUTH_FAILED",
  "FORBIDDEN",
  "NOT_FOUND",
  "QUOTA_EXCEEDED",
  "CONFLICT",
  "NETWORK",
  "SERVER",
  "CRYPTO",
]

/** 分类后的 WebDAV 错误（spec §5 用户文案由调用层按 kind 渲染） */
export class WebDavError extends Error {
  constructor(
    public readonly kind: WebDavErrorKind,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = "WebDavError"
  }
}

/** 与 Java WebDavClient.DavEntry 同构 */
export interface WebDavEntry {
  href: string
  isCollection: boolean
  contentLength: number | null
}

export interface WebDavCreds {
  user: string
  password: string
}

/** lynx Callback 契约（PictelioWebDavModule）：code 0 = 成功，1 = 失败（payload 为错误 JSON） */
type WebDavCallback = (code: number, payload: string) => void

/** NativeModules.PictelioWebDav 方法集（与 PictelioWebDavModule.java 逐字对应） */
interface PictelioWebDavModule {
  ensureDir(url: string, user: string, password: string, cb: WebDavCallback): void
  upload(url: string, user: string, password: string, base64: string, cb: WebDavCallback): void
  uploadWithVerify(
    url: string, user: string, password: string, base64: string,
    maxAttempts: number | null, cb: WebDavCallback,
  ): void
  download(url: string, user: string, password: string, cb: WebDavCallback): void
  list(url: string, user: string, password: string, cb: WebDavCallback): void
  stat(url: string, user: string, password: string, cb: WebDavCallback): void
  delete(url: string, user: string, password: string, cb: WebDavCallback): void
  prune(
    dirUrl: string, user: string, password: string, prefix: string,
    keep: number | null, cb: WebDavCallback,
  ): void
  encrypt(base64: string, password: string, cb: WebDavCallback): void
  decrypt(base64: string, password: string, cb: WebDavCallback): void
  isEncrypted(base64: string, cb: WebDavCallback): void
}

/** 原生 Module 探测（web-core dev 无 NativeModules → null，调用方显式失败） */
function nativeModule(): PictelioWebDavModule | null {
  // 全局 NativeModules 类型声明（types/）未列 PictelioWebDav——收窄引用即可
  const nm = (typeof NativeModules !== "undefined"
    ? (NativeModules as { PictelioWebDav?: PictelioWebDavModule })
    : undefined) ??
    (globalThis as { NativeModules?: { PictelioWebDav?: PictelioWebDavModule } }).NativeModules
  return nm?.PictelioWebDav ?? null
}

// ── base64 助手（纯 JS 实现：Lynx JS runtime 不假设 btoa/atob 可用）──

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined
    out += B64_ALPHABET[b0 >> 2]
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? "=" : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? "=" : B64_ALPHABET[b2 & 0x3f]
  }
  return out
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "")
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const ch of clean) {
    const idx = B64_ALPHABET.indexOf(ch)
    if (idx < 0) {
      // 非法字符不静默丢弃（硬约束 #3）：继续解析但 warn 可见
      console.warn("[webDavBridge] base64 含非法字符，已跳过:", ch)
      continue
    }
    value = (value << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

// ── 统一调用器：cb(code, payload) → Promise；失败 payload 解析为 WebDavError ──

interface WebDavErrorPayload {
  kind: string
  statusCode: number
  message: string
}

function call<T>(invoke: (cb: WebDavCallback) => void, map: (payload: string) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const mod = nativeModule()
    if (!mod) {
      // web-core dev 显式失败（spec §2：Web 端不暴露入口；降级可见不静默）
      reject(new WebDavError("SERVER", -1, "WebDAV 备份仅 Android 原生可用（web-core 无原生模块）"))
      return
    }
    invoke((code, payload) => {
      if (code === 0) {
        try {
          resolve(map(payload))
        } catch (e) {
          reject(new WebDavError("SERVER", -1, `WebDAV 响应解析失败: ${String(e)}`))
        }
        return
      }
      let parsed: WebDavErrorPayload = { kind: "SERVER", statusCode: -1, message: payload }
      try {
        parsed = JSON.parse(payload) as WebDavErrorPayload
      } catch {
        // payload 非 JSON（契约破坏）：显式 warn，按 SERVER 原样上抛
        console.warn("[webDavBridge] 错误 payload 非 JSON，按 SERVER 处理:", payload)
      }
      const known = WEBDAV_ERROR_KINDS.includes(parsed.kind as WebDavErrorKind)
      if (!known) {
        console.warn("[webDavBridge] 未知错误 kind，按 SERVER 归类:", parsed.kind, parsed.message)
      }
      const kind = known ? (parsed.kind as WebDavErrorKind) : "SERVER"
      reject(new WebDavError(kind, parsed.statusCode, parsed.message))
    })
  })
}

function parseEntry(json: string): WebDavEntry {
  const o = JSON.parse(json) as { href: string; isCollection: boolean; contentLength: number | null }
  return { href: o.href, isCollection: o.isCollection, contentLength: o.contentLength }
}

// ── 类型化桥方法 ──

export function ensureDir(url: string, creds: WebDavCreds): Promise<void> {
  return call((cb) => nativeModule()!.ensureDir(url, creds.user, creds.password, cb), () => undefined)
}

export function upload(url: string, creds: WebDavCreds, data: Uint8Array): Promise<void> {
  return call((cb) => nativeModule()!.upload(url, creds.user, creds.password, bytesToBase64(data), cb), () => undefined)
}

export function uploadWithVerify(
  url: string,
  creds: WebDavCreds,
  data: Uint8Array,
  maxAttempts?: number,
): Promise<void> {
  return call(
    (cb) => nativeModule()!.uploadWithVerify(url, creds.user, creds.password, bytesToBase64(data), maxAttempts ?? null, cb),
    () => undefined,
  )
}

export function download(url: string, creds: WebDavCreds): Promise<Uint8Array> {
  return call((cb) => nativeModule()!.download(url, creds.user, creds.password, cb), (p) => base64ToBytes(p))
}

export function list(url: string, creds: WebDavCreds): Promise<WebDavEntry[]> {
  return call(
    (cb) => nativeModule()!.list(url, creds.user, creds.password, cb),
    (p) => JSON.parse(p) as WebDavEntry[],
  )
}

export function stat(url: string, creds: WebDavCreds): Promise<WebDavEntry> {
  return call((cb) => nativeModule()!.stat(url, creds.user, creds.password, cb), parseEntry)
}

export function deleteResource(url: string, creds: WebDavCreds): Promise<void> {
  return call((cb) => nativeModule()!.delete(url, creds.user, creds.password, cb), () => undefined)
}

export function prune(dirUrl: string, creds: WebDavCreds, prefix: string, keep?: number): Promise<string[]> {
  return call(
    (cb) => nativeModule()!.prune(dirUrl, creds.user, creds.password, prefix, keep ?? null, cb),
    (p) => JSON.parse(p) as string[],
  )
}

export function encrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  return call((cb) => nativeModule()!.encrypt(bytesToBase64(data), password, cb), (p) => base64ToBytes(p))
}

export function decrypt(data: Uint8Array, password: string): Promise<Uint8Array> {
  return call((cb) => nativeModule()!.decrypt(bytesToBase64(data), password, cb), (p) => base64ToBytes(p))
}

export function isEncrypted(data: Uint8Array): Promise<boolean> {
  return call((cb) => nativeModule()!.isEncrypted(bytesToBase64(data), cb), (p) => p === "true")
}

/** isNativeMode 重导出：T6 UI 用它控制「仅原生」显隐（web-core 显式不渲染） */
export { isNativeMode }
