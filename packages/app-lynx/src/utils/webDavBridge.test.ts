// app-lynx WebDav 桥单测（spec webdav-backup §4 薄桥）：
// 与 app tests/unit/native/webDav.test.ts 同语义（双端差分对齐）——
// seam = 类型化桥函数；mock NativeModules.PictelioWebDav 验证
// cb(code, payload) 契约 / 错误 JSON → WebDavError 映射 / base64 纯 JS 实现 / 无模块显式失败。
import { describe, it, expect, vi, beforeEach } from "vitest"

const env = vi.hoisted(() => ({
  module: null as Record<string, (...args: unknown[]) => void> | null,
}))

/** 注入/移除 NativeModules.PictelioWebDav */
function setModule(mod: Record<string, (...args: unknown[]) => void> | null) {
  ;(globalThis as { NativeModules?: unknown }).NativeModules = mod
    ? { PictelioWebDav: mod }
    : undefined
}

import {
  ensureDir,
  download,
  list,
  prune,
  WebDavError,
  bytesToBase64,
  base64ToBytes,
} from "./webDavBridge"

/** 构造最小模块：每个方法触发 cb(0, payload) 或 cb(1, errorJson) */
function okModule(payloads: Record<string, string>) {
  const mod: Record<string, (...args: unknown[]) => void> = {}
  for (const name of Object.keys(payloads)) {
    mod[name] = (...args: unknown[]) => {
      const cb = args[args.length - 1] as (code: number, payload: string) => void
      cb(0, payloads[name])
    }
  }
  return mod
}

describe("webDavBridge（app-lynx）", () => {
  beforeEach(() => {
    setModule(null)
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("base64 助手纯 JS 实现往返无损（不依赖 btoa/atob）", () => {
    expect(globalThis.btoa).toBeUndefined // 本环境无 btoa，证明实现自洽
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i++) all[i] = i
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all)
    expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe("aGVsbG8=")
  })

  it("成功路径：ensureDir 透传参数；download 解码 base64", async () => {
    const calls: unknown[][] = []
    setModule({
      ensureDir: (...args: unknown[]) => {
        calls.push(args.slice(0, -1))
        ;(args[args.length - 1] as (c: number, p: string) => void)(0, "")
      },
      download: (...args: unknown[]) => {
        ;(args[args.length - 1] as (c: number, p: string) => void)(0, "aGVsbG8=")
      },
    })
    await ensureDir("https://dav/backup/", { user: "alice", password: "pw" })
    expect(calls).toEqual([["https://dav/backup/", "alice", "pw"]])
    const data = await download("https://dav/f.json", { user: "u", password: "p" })
    expect(new TextDecoder().decode(data)).toBe("hello")
  })

  it("成功路径：list 解析 JSON 条目数组；prune 解析删除清单", async () => {
    setModule(
      okModule({
        list: '[{"href":"/dav/a.json","isCollection":false,"contentLength":7}]',
        prune: '["/dav/old.json"]',
      }),
    )
    const entries = await list("https://dav/backup/", { user: "u", password: "p" })
    expect(entries).toEqual([{ href: "/dav/a.json", isCollection: false, contentLength: 7 }])
    const deleted = await prune("https://dav/backup/", { user: "u", password: "p" }, "pictelio-backup-")
    expect(deleted).toEqual(["/dav/old.json"])
  })

  it("失败路径：cb(1, 错误 JSON) → WebDavError（kind/statusCode 透传）", async () => {
    setModule({
      ensureDir: (...args: unknown[]) => {
        ;(args[args.length - 1] as (c: number, p: string) => void)(
          1,
          JSON.stringify({ kind: "QUOTA_EXCEEDED", statusCode: 507, message: "配额不足" }),
        )
      },
    })
    const err = await ensureDir("https://dav/", { user: "u", password: "p" }).catch((e) => e)
    expect(err).toBeInstanceOf(WebDavError)
    expect((err as WebDavError).kind).toBe("QUOTA_EXCEEDED")
    expect((err as WebDavError).statusCode).toBe(507)
  })

  it("失败路径：非 JSON 错误 payload → SERVER 兜底（不崩溃）", async () => {
    setModule({
      download: (...args: unknown[]) => {
        ;(args[args.length - 1] as (c: number, p: string) => void)(1, "raw error text")
      },
    })
    const err = await download("https://dav/f", { user: "u", password: "p" }).catch((e) => e)
    expect((err as WebDavError).kind).toBe("SERVER")
  })

  it("web-core 无 NativeModules → 显式 WebDavError（不静默）", async () => {
    setModule(null)
    const err = await ensureDir("https://dav/", { user: "u", password: "p" }).catch((e) => e)
    expect(err).toBeInstanceOf(WebDavError)
    expect((err as WebDavError).message).toContain("仅 Android 原生可用")
  })
})
