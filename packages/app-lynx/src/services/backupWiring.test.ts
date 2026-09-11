// backupWiring 单测（app-lynx，spec docs/specs/webdav-backup.md §3.1/§3.2/§6/§7；T7/T8/T9）
// oracle：spec §3.1 键域、§6 merge-by-keys + uid 过滤、§6 应急快照保留、§7 启动钩子语义。
// 与 app tests/unit/services/backupWiring.test.ts 同用例同判据（双端差分对齐）。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { ref } from "vue"

const env = vi.hoisted(() => ({
  prefs: new Map<string, string>(),
  idb: new Map<string, string>(),
  bridge: {
    ensureDir: vi.fn(async () => {}),
    uploadWithVerify: vi.fn(async () => {}),
    download: vi.fn(async () => new Uint8Array()),
    list: vi.fn(async () => [] as unknown[]),
    prune: vi.fn(async () => [] as string[]),
    encrypt: vi.fn(async (d: Uint8Array) => d),
    decrypt: vi.fn(async (d: Uint8Array) => d),
    isEncrypted: vi.fn(async () => false),
  },
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

const native = vi.hoisted(() => ({ mode: true }))
vi.mock("../api/client", () => ({
  isNativeMode: () => native.mode,
  getNativeModules: () => ({
    PictelioPrefs: {
      prefsGet: (key: string, cb: (v: string, e: string | null) => void) =>
        cb(env.prefs.has(key) ? JSON.stringify(env.prefs.get(key)!) : "", null),
      prefsSet: (key: string, value: string, cb: (e: string | null) => void) => {
        env.prefs.set(key, value)
        cb(null)
      },
      prefsRemove: (key: string, cb: (e: string | null) => void) => {
        env.prefs.delete(key)
        cb(null)
      },
    },
  }),
}))

const mockUser = vi.hoisted(() => ({ id: 42 as number | null }))
vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.id === null ? null : { id: mockUser.id }
    },
  }),
}))

vi.mock("../utils/webDavBridge", () => env.bridge)
vi.mock("../utils/webdavCredentials", () => ({
  loadWebdavPassword: vi.fn(async () => "login-pw"),
  loadBackupPassword: vi.fn(async () => null),
  saveWebdavPassword: vi.fn(async () => {}),
  saveBackupPassword: vi.fn(async () => {}),
}))

import { useSettingsStore } from "../stores/settingsStore"
import {
  PRE_RESTORE_KEY,
  clearPreRestoreSnapshot,
  createLynxBackupWiring,
  loadPreRestoreSnapshot,
  runStartupAutoBackup,
  savePreRestoreSnapshot,
  undoLastRestore,
  currentUid,
} from "./backupWiring"

function fresh() {
  setActivePinia(createPinia())
  return useSettingsStore()
}

describe("backupWiring（lynx）— collect / apply（spec §3.1/§6）", () => {
  beforeEach(() => {
    env.prefs.clear()
    env.idb.clear()
    mockUser.id = 42
    vi.clearAllMocks()
  })

  it("collect：设备级键 + 当前账号级键进入 raw；异账号键排除；sets 为空", async () => {
    env.idb.set("settings_ugoira_mode", "fflate") // idbKV 源（ugoiraMode/detailQuality）
    env.prefs.set("show_r18_42", "true")
    env.prefs.set("show_r18_99", "true")
    env.prefs.set("ai_filter_mode_42", "mask")
    const store = fresh()
    const { raw, sets } = await createLynxBackupWiring().collect()

    expect(raw.settings_ugoira_mode).toBe("fflate")
    expect(raw.show_r18_42).toBe("true")
    expect(raw.ai_filter_mode_42).toBe("mask")
    expect(raw.show_r18_99).toBeUndefined()
    expect(sets).toEqual({}) // lynx 无 sets store
    expect(store).toBeTruthy()
  })

  it("apply：设备键写回并更新 store；异账号账号级键跳过（merge-by-keys）", async () => {
    const store = fresh()
    const res = await createLynxBackupWiring().apply({
      apply: {
        settings_ugoira_mode: "range",
        settings_theme_color: "pink",
        show_r18_42: "true",
        show_r18_99: "true",
        upstream_only_key: "x",
      },
      sets: {},
    })

    expect(store.ugoiraMode).toBe("range")
    expect(store.themeColor).toBe("pink")
    expect(store.showR18).toBe(true)
    expect(res.applied).toContain("settings_ugoira_mode")
    expect(res.applied).toContain("show_r18_42")
    expect(res.skipped).toContain("show_r18_99")
    expect(res.skipped).toContain("upstream_only_key")
    // 异账号键未落盘
    expect(env.prefs.has("show_r18_99")).toBe(false)
  })

  it("apply：非法值（ugoira 模式非法）跳过 + 保持默认", async () => {
    const store = fresh()
    const res = await createLynxBackupWiring().apply({ apply: { settings_ugoira_mode: "bogus" }, sets: {} })
    expect(store.ugoiraMode).toBe("fflate")
    expect(res.skipped).toEqual(["settings_ugoira_mode"])
  })

  it("currentUid：登录返回 uid，未登录 null（spec §6）", () => {
    fresh()
    expect(currentUid()).toBe(42)
    mockUser.id = null
    expect(currentUid()).toBeNull()
  })
})

describe("backupWiring（lynx）— T9 应急快照与撤销", () => {
  beforeEach(() => {
    env.prefs.clear()
    env.idb.clear()
    mockUser.id = 42
    vi.clearAllMocks()
  })

  it("保存 → 读取 → 清除全流程（idbKV 单键）", async () => {
    env.idb.set("settings_ugoira_mode", "fflate")
    const wiring = createLynxBackupWiring()
    await savePreRestoreSnapshot(wiring)

    const snapshot = await loadPreRestoreSnapshot()
    expect(snapshot?.raw.settings_ugoira_mode).toBe("fflate")
    expect(env.idb.has(PRE_RESTORE_KEY)).toBe(true)

    await clearPreRestoreSnapshot()
    expect(await loadPreRestoreSnapshot()).toBeNull()
  })

  it("无快照 → 撤销返回 false；损坏快照 → null + warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const wiring = createLynxBackupWiring()
    expect(await undoLastRestore(wiring)).toBe(false)

    env.idb.set(PRE_RESTORE_KEY, "{broken")
    expect(await loadPreRestoreSnapshot()).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("撤销：把快照写回（恢复可回滚）", async () => {
    const store = fresh()
    store.setUgoiraMode("fflate")
    const wiring = createLynxBackupWiring()
    await savePreRestoreSnapshot(wiring)

    // 模拟恢复改值
    store.setUgoiraMode("range")
    expect(store.ugoiraMode).toBe("range")

    expect(await undoLastRestore(wiring)).toBe(true)
    expect(store.ugoiraMode).toBe("fflate")
  })
})

describe("backupWiring（lynx）— T8 启动时自动备份（spec §7）", () => {
  beforeEach(() => {
    env.prefs.clear()
    env.idb.clear()
    mockUser.id = 42
    vi.clearAllMocks()
  })

  it("开关关 → 零桥调用（不联网）", async () => {
    fresh()
    expect(await runStartupAutoBackup()).toBeNull()
    expect(env.bridge.ensureDir).not.toHaveBeenCalled()
  })

  it("开关开但自动备份关 → 不执行", async () => {
    const store = fresh()
    store.setWebdavEnabled(true)
    store.setWebdavUrl("https://dav.example.com/")
    expect(await runStartupAutoBackup()).toBeNull()
    expect(env.bridge.ensureDir).not.toHaveBeenCalled()
  })

  it("开关开 + 自动备份开 + 从未备份 → 执行并记录时间", async () => {
    const store = fresh()
    store.setWebdavEnabled(true)
    store.setWebdavUrl("https://dav.example.com/")
    store.setWebdavAutoBackup(true)

    const result = await runStartupAutoBackup()
    expect(result).not.toBeNull()
    expect(env.bridge.ensureDir).toHaveBeenCalledWith(
      "https://dav.example.com/Pictelio/backup/",
      expect.anything(),
    )
    expect(env.bridge.uploadWithVerify).toHaveBeenCalled()
    expect(store.webdavLastBackup).not.toBe("")
  })

  it("桥失败 → 仅 warn，不抛（不阻塞启动）", async () => {
    const store = fresh()
    store.setWebdavEnabled(true)
    store.setWebdavUrl("https://dav.example.com/")
    store.setWebdavAutoBackup(true)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    env.bridge.ensureDir.mockRejectedValueOnce(new Error("network down"))

    expect(await runStartupAutoBackup()).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
