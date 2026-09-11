// backupCore 单测（spec docs/specs/webdav-backup.md §3.2/§5/§6）
// 与 app tests/unit/utils/backupCore.test.ts 同用例同 oracle（双端差分对齐）：
// spec 字面（format 标识 / schemaVersion 1 / 账号级键三类前缀 / 错误文案分类）
// 与规格派生边界（schemaVersion 过高拒绝、merge-by-keys 不触碰额外键）。
import { describe, it, expect } from "vitest"
import {
  utf8Decode,
  utf8Encode,
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  ACCOUNT_KEY_PREFIXES,
  WEBDAV_ERROR_MESSAGES,
  BackupFormatError,
  accountUidOf,
  buildSnapshot,
  isAccountScopedKey,
  parseSnapshot,
  partitionKeys,
  planRestore,
  serializeSnapshot,
  summarize,
  type BackupSnapshotV1,
} from "./backupCore"
import { WEBDAV_ERROR_KINDS } from "./webDavBridge"

const RAW = {
  settings_ugoira_mode: "fflate",
  settings_theme_color: "blue",
  show_r18_42: "true",
  show_r18g_42: "false",
  ai_filter_mode_42: "mask",
  show_r18_99: "true",
  blocked_user_ids: '["1","2"]',
}

function snapshotWith(overrides: Partial<BackupSnapshotV1> = {}): BackupSnapshotV1 {
  return {
    ...buildSnapshot({
      raw: RAW,
      excludedKeys: [],
      engine: "lynx",
      appVersion: "1.2.3",
      createdAt: "2026-09-11T17:30:00+08:00",
      sets: { blocked_user_ids: [1, 2], reported_ids: [] },
    }),
    ...overrides,
  }
}

describe("backupCore — 备份域分区", () => {
  it("账号级键按 spec §3.1 三类前缀归入 accountKeys，其余为 deviceKeys", () => {
    const { deviceKeys, accountKeys } = partitionKeys({ raw: RAW, excludedKeys: [] })
    expect(new Set(Object.keys(deviceKeys))).toEqual(new Set(["blocked_user_ids", "settings_theme_color", "settings_ugoira_mode"]))
    expect(new Set(Object.keys(accountKeys))).toEqual(new Set(["ai_filter_mode_42", "show_r18_42", "show_r18_99", "show_r18g_42"]))
  })

  it("excludedKeys 从两个分组中剔除（spec §7 敏感项排除）", () => {
    const { deviceKeys, accountKeys } = partitionKeys({
      raw: RAW,
      excludedKeys: ["show_r18_42", "ai_filter_mode_42", "settings_ugoira_mode"],
    })
    expect(deviceKeys.settings_ugoira_mode).toBeUndefined()
    expect(accountKeys.show_r18_42).toBeUndefined()
    expect(accountKeys.ai_filter_mode_42).toBeUndefined()
    expect(accountKeys.show_r18_99).toBe("true")
  })

  it("isAccountScopedKey / accountUidOf：前缀 + 数字后缀判定", () => {
    expect(ACCOUNT_KEY_PREFIXES).toEqual(["show_r18_", "show_r18g_", "ai_filter_mode_"])
    expect(isAccountScopedKey("show_r18_42")).toBe(true)
    expect(isAccountScopedKey("settings_ugoira_mode")).toBe(false)
    expect(accountUidOf("show_r18_42")).toBe(42)
    expect(accountUidOf("ai_filter_mode_7")).toBe(7)
    expect(accountUidOf("show_r18_abc")).toBeNull()
    expect(accountUidOf("settings_ugoira_mode")).toBeNull()
  })
})

describe("backupCore — 快照序列化与解析（spec §3.2/§6）", () => {
  it("buildSnapshot 字段与 spec §3.2 逐字一致", () => {
    const s = snapshotWith()
    expect(s.format).toBe("pictelio-backup")
    expect(BACKUP_FORMAT).toBe("pictelio-backup")
    expect(s.schemaVersion).toBe(1)
    expect(BACKUP_SCHEMA_VERSION).toBe(1)
    expect(s.engine).toBe("lynx")
    expect(Object.keys(s)).toEqual([
      "format",
      "schemaVersion",
      "appVersion",
      "engine",
      "createdAt",
      "excludedKeys",
      "deviceKeys",
      "accountKeys",
      "sets",
    ])
  })

  it("往返：serialize → parse 无损", () => {
    const s = snapshotWith()
    expect(parseSnapshot(serializeSnapshot(s))).toEqual(s)
  })

  it("拒绝：非 JSON / format 不符 → NOT_BACKUP", () => {
    const e1 = (() => {
      try {
        parseSnapshot(new TextEncoder().encode("not json"))
      } catch (e) {
        return e as BackupFormatError
      }
    })()
    expect(e1?.kind).toBe("NOT_BACKUP")
    const tampered = new TextEncoder().encode(JSON.stringify({ ...snapshotWith(), format: "other" }))
    const e2 = (() => {
      try {
        parseSnapshot(tampered)
      } catch (e) {
        return e as BackupFormatError
      }
    })()
    expect(e2?.kind).toBe("NOT_BACKUP")
  })

  it("拒绝：schemaVersion 过高 → SCHEMA_TOO_NEW（提示升级）", () => {
    const err = (() => {
      try {
        parseSnapshot(new TextEncoder().encode(JSON.stringify({ ...snapshotWith(), schemaVersion: 99 })))
      } catch (e) {
        return e as BackupFormatError
      }
    })()
    expect(err?.kind).toBe("SCHEMA_TOO_NEW")
    expect(err?.message).toContain("升级")
  })

  it("拒绝：字段缺失/类型不符 → CORRUPT", () => {
    const s = snapshotWith()
    for (const bad of [{ ...s, deviceKeys: undefined }, { ...s, sets: { x: "not-array" } }]) {
      const err = (() => {
        try {
          parseSnapshot(new TextEncoder().encode(JSON.stringify(bad)))
        } catch (e) {
          return e as BackupFormatError
        }
      })()
      expect(err?.kind).toBe("CORRUPT")
    }
  })
})

describe("backupCore — 恢复计划（spec §6 merge-by-keys + uid 过滤）", () => {
  it("merge-by-keys：apply 只含快照内键", () => {
    const plan = planRestore(snapshotWith(), 42)
    const keys = Object.keys(plan.apply)
    expect(keys).toContain("settings_ugoira_mode")
    expect(keys).toContain("show_r18_42")
    expect(keys.every((k) => k in RAW)).toBe(true)
  })

  it("账号级键按当前 uid 过滤：同 uid 应用、异 uid 跳过、未登录全跳过", () => {
    const plan42 = planRestore(snapshotWith(), 42)
    expect(plan42.apply.show_r18_42).toBe("true")
    expect(plan42.apply.show_r18_99).toBeUndefined()
    expect(plan42.skippedAccountKeys).toEqual(["show_r18_99"])

    const plan99 = planRestore(snapshotWith(), 99)
    expect(plan99.apply.show_r18_99).toBe("true")
    expect(new Set(plan99.skippedAccountKeys)).toEqual(new Set(["ai_filter_mode_42", "show_r18_42", "show_r18g_42"]))

    const planNull = planRestore(snapshotWith(), null)
    expect(planNull.skippedAccountKeys).toHaveLength(4)
    expect(Object.keys(planNull.apply).every((k) => !isAccountScopedKey(k))).toBe(true)
  })

  it("excludedKeys 防御：畸形快照中仍存在的被排除键不写回", () => {
    const plan = planRestore(snapshotWith({ excludedKeys: ["show_r18_42"] }), 42)
    expect(plan.apply.show_r18_42).toBeUndefined()
    expect(plan.skippedExcludedKeys).toEqual(["show_r18_42"])
  })

  it("sets 原样进入计划", () => {
    expect(planRestore(snapshotWith(), 42).sets).toEqual({ blocked_user_ids: [1, 2], reported_ids: [] })
  })

  it("summarize 统计与恢复确认摘要一致", () => {
    const s = snapshotWith()
    const sum = summarize(s, 42)
    expect(sum.deviceKeyCount).toBe(Object.keys(s.deviceKeys).length)
    expect(sum.accountKeyCount).toBe(4)
    expect(sum.accountKeyCountForUid).toBe(3)
    expect(sum.setCount).toBe(2)
    expect(summarize(s, null).accountKeyCountForUid).toBe(0)
  })
})

describe("backupCore — 错误分类文案（spec §5）", () => {
  it("8 个 kind 全部有非空中文文案", () => {
    expect(new Set(Object.keys(WEBDAV_ERROR_MESSAGES))).toEqual(new Set(WEBDAV_ERROR_KINDS))
    for (const kind of WEBDAV_ERROR_KINDS) {
      expect(WEBDAV_ERROR_MESSAGES[kind].length).toBeGreaterThan(0)
    }
    expect(WEBDAV_ERROR_MESSAGES.CRYPTO).toBe("密码错误或文件损坏")
  })
})
describe("backupCore — UTF-8 纯 JS 编解码（Lynx runtime 无 TextEncoder，真机实测）", () => {
  it("往返无损：ASCII / 中文 / emoji（代理对）/ 混合", () => {
    for (const s of [
      "",
      '{"a":1}',
      "设置_小说导出_格式",
      "emoji 🐧🚀 混合",
      "\u0000\u007f\u0080\u07ff\u0800\uffff", // 各编码长度边界
    ]) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  it("与 TextEncoder 字节序列一致（Node 环境可用的独立 oracle）", () => {
    for (const s of ["a", "中文", "混合🐧x", "\u0000\u0080\u0800"]) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(new TextEncoder().encode(s)));
    }
  });
});
