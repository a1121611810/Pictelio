// 一次性迁移提示 store 单测（spec §7「老用户找不到收藏/追更」第 2 条缓解）。
//
// 【期望值出处】spec §7 该行的两条缓解里，第 ② 条是「一次性迁移提示」。判据钉的是
// 三条**语义不变量**，不是实现细节：
//   ① 关过一次之后不再出现（"一次性"这个词的全部含义）；
//   ② 旗标是**设备级**、不进备份域（换账号不该重看；备份恢复到新设备该再看一次）；
//   ③ 读失败按"未看过"处理且显式告警（禁静默降级：读到脏值而永久不再提示是真损失）。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { setActivePinia, createPinia } from "pinia"
import { useNavMigrationNoticeStore, NAV_MIGRATION_NOTICE_KEY } from "./navMigrationNotice"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const prefsState = vi.hoisted(() => {
  const map = new Map<string, string>()
  const control = { failGet: false, failSet: false }
  return { map, control }
})

vi.mock("./settingsStore", () => ({
  prefs: () => ({
    get: async (key: string) => {
      if (prefsState.control.failGet) throw new Error("get failed")
      return prefsState.map.get(key) ?? null
    },
    set: async (key: string, value: string) => {
      if (prefsState.control.failSet) throw new Error("set failed")
      prefsState.map.set(key, value)
    },
  }),
}))

const settingsStoreSrc = readFileSync(
  fileURLToPath(new URL("./settingsStore.ts", import.meta.url)),
  "utf8",
)

beforeEach(() => {
  setActivePinia(createPinia())
  prefsState.map.clear()
  prefsState.control = { failGet: false, failSet: false }
})

describe("navMigrationNotice store · 一次性迁移提示", () => {
  it("首次未看过：load 后 seen 为 false（提示应显示）", async () => {
    const s = useNavMigrationNoticeStore()
    await s.load()
    expect(s.seen).toBe(false)
  })

  it("dismiss 后落盘且 seen 变 true（" + '"一次性" = 关过就不再出现）' + "）", async () => {
    const s = useNavMigrationNoticeStore()
    await s.load()
    await s.dismiss()
    expect(s.seen).toBe(true)
    expect(prefsState.map.get(NAV_MIGRATION_NOTICE_KEY)).toBe("1")
  })

  it("落盘后的旗标能被下一次会话读回（跨重启仍是" + '"一次性"' + "，不是内存态）", async () => {
    const first = useNavMigrationNoticeStore()
    await first.load()
    await first.dismiss()

    // 新会话 = 新 pinia 实例，读同一份 prefs
    setActivePinia(createPinia())
    const second = useNavMigrationNoticeStore()
    await second.load()
    expect(second.seen, "重启后提示又出现了 ⇒ 一次性失效").toBe(true)
  })

  it("load 幂等：重复调用不重复读盘（Me 页在 KeepAlive 内会反复挂载）", async () => {
    const get = vi.fn(async (k: string) => prefsState.map.get(k) ?? null)
    const spy = vi.spyOn(await import("./settingsStore"), "prefs").mockReturnValue({
      get: get as never,
      set: (async () => {}) as never,
      // PrefsStorage 三方法齐全（settingsStore.ts:183）：少一个就是类型不完整
      remove: (async () => {}) as never,
    })
    const s = useNavMigrationNoticeStore()
    await s.load()
    await s.load()
    await s.load()
    expect(get.mock.calls.length, "load 被重复执行").toBe(1)
    spy.mockRestore()
  })

  it("读失败按未看过处理并显式告警（禁静默降级）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    prefsState.control.failGet = true
    const s = useNavMigrationNoticeStore()
    await s.load()
    expect(s.seen, "读失败却当成看过 ⇒ 提示永久不再出现").toBe(false)
    expect(warn.mock.calls.some((c) => String(c[0]).includes("navMigrationNotice"))).toBe(true)
    warn.mockRestore()
  })

  it("落盘失败不抛，且仍隐藏本次（关不掉提示不该让界面崩）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    prefsState.control.failSet = true
    const s = useNavMigrationNoticeStore()
    await expect(s.dismiss()).resolves.toBeUndefined()
    expect(s.seen).toBe(true)
    expect(warn.mock.calls.some((c) => String(c[0]).includes("navMigrationNotice"))).toBe(true)
    warn.mockRestore()
  })

  it("设备级：键不带 uid，且不进备份域（换账号不该重看）", async () => {
    expect(NAV_MIGRATION_NOTICE_KEY).not.toMatch(/\d{4,}/)
    expect(settingsStoreSrc, "迁移提示键被误列进备份域 ⇒ 换机/换号会继承" + '"已看过"' + "）").not.toContain(
      "nav_migration",
    )
  })
})
