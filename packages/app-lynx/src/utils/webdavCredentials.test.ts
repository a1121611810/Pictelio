// webdavCredentials 单测（spec docs/specs/webdav-backup.md §8）：
// 与 app 侧 utils/webdavCredentials.test.ts 同语义（双端差分对齐）——
// 原生 PictelioSecureStorage 路径 + dev idbKV 降级路径，成功/失败双覆盖。
import { describe, it, expect, vi, beforeEach } from "vitest"

const env = vi.hoisted(() => ({
  native: false,
  store: new Map<string, string>(),
  failOn: null as "get" | "set" | "remove" | null,
  idb: new Map<string, string>(),
}))

vi.mock("../utils/idbKV", () => ({
  idbGet: vi.fn(async (key: string) => (env.idb.has(key) ? env.idb.get(key)! : null)),
  idbSet: vi.fn(async (key: string, value: string) => {
    env.idb.set(key, value)
  }),
  idbRemove: vi.fn(async (key: string) => {
    env.idb.delete(key)
  }),
}))

/** 注入 NativeModules.PictelioSecureStorage（web-core 无 NativeModules，需模拟） */
function setNativeModule(enabled: boolean) {
  ;(globalThis as { NativeModules?: unknown }).NativeModules = enabled
    ? {
        PictelioSecureStorage: {
          getItem(key: string, cb: (v: string | null, e: string | null) => void) {
            if (env.failOn === "get") {
              cb(null, "keystore lost")
              return
            }
            cb(env.store.has(key) ? env.store.get(key)! : null, null)
          },
          setItem(key: string, value: string, cb: (e: string | null) => void) {
            if (env.failOn === "set") {
              cb("keystore locked")
              return
            }
            env.store.set(key, value)
            cb(null)
          },
          removeItem(key: string, cb: (e: string | null) => void) {
            if (env.failOn === "remove") {
              cb("keystore locked")
              return
            }
            env.store.delete(key)
            cb(null)
          },
        },
      }
    : undefined
}

import {
  saveWebdavPassword,
  loadWebdavPassword,
  clearWebdavPassword,
  saveBackupPassword,
  loadBackupPassword,
} from "./webdavCredentials"

describe("webdavCredentials（app-lynx）", () => {
  beforeEach(() => {
    env.native = true
    env.store.clear()
    env.idb.clear()
    env.failOn = null
    setNativeModule(true)
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("原生路径：登录密码与备份密码独立读写", async () => {
    await saveWebdavPassword("login-secret")
    await saveBackupPassword("backup-secret")
    expect(await loadWebdavPassword()).toBe("login-secret")
    expect(await loadBackupPassword()).toBe("backup-secret")
  })

  it("原生读取失败 → null + warn（按未设置处理）", async () => {
    env.failOn = "get"
    expect(await loadWebdavPassword()).toBeNull()
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      "[webdavCredentials] 原生存储读取失败（按未设置处理）",
      "keystore lost",
    )
  })

  it("原生写入失败 → reject + warn（密码丢失必须可见）", async () => {
    env.failOn = "set"
    await expect(saveWebdavPassword("x")).rejects.toThrow("keystore locked")
    expect(vi.mocked(console.warn)).toHaveBeenCalled()
  })

  it("清除：原生 removeItem 被调用", async () => {
    await saveWebdavPassword("x")
    await clearWebdavPassword()
    expect(env.store.size).toBe(0)
  })

  it("dev 降级路径（无 NativeModules）：写读走 idbKV", async () => {
    setNativeModule(false)
    await saveWebdavPassword("dev-secret")
    expect(env.idb.get("webdav_password")).toBe("dev-secret")
    expect(await loadWebdavPassword()).toBe("dev-secret")
  })
})
