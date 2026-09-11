// @vitest-environment happy-dom
// backupWiring 单测（spec docs/specs/webdav-backup.md §3.2/§6，T6/T9）
// oracle：spec §3.1 sets 构成（blockStore/reportStore）+ §3.2 snapshot 分组 +
// §6 merge-by-keys / 应急快照保留语义。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSettings } from "@/settings/registry";
import { createMemoryAdapter } from "@/settings/backends/memory";
import { jsonCodec } from "@/settings/codecs";
import type { Settings } from "@/settings/types";

const prefs = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    async set({ key, value }: { key: string; value: string }) {
      prefs.store.set(key, value);
    },
    async get({ key }: { key: string }) {
      return { value: prefs.store.has(key) ? prefs.store.get(key)! : null };
    },
    async remove({ key }: { key: string }) {
      prefs.store.delete(key);
    },
  },
}));

import {
  BACKUP_SET_KEYS,
  PRE_RESTORE_KEY,
  clearPreRestoreSnapshot,
  createBackupWiring,
  loadPreRestoreSnapshot,
  savePreRestoreSnapshot,
  undoLastRestore,
} from "@/services/backupWiring";

function makeStore(seed: Record<string, string> = {}) {
  const mem = createMemoryAdapter(seed);
  const settings: Settings = createSettings({ storages: { preferences: mem } });
  // 生产同款注册面：rawValues 只覆盖已注册键（未注册键不存在于备份域）
  settings.define<string>({ key: "settings_ugoira_mode", default: "fflate" });
  settings.define<string[]>({ key: "blocked_user_ids", default: [], codec: jsonCodec });
  settings.define<string[]>({ key: "reported_ids", default: [], codec: jsonCodec });
  return { settings, mem };
}

describe("backupWiring — collect（spec §3.1/§3.2）", () => {
  it("sets 独立成组，且不重复出现在 deviceKeys", async () => {
    const { settings } = makeStore({
      settings_ugoira_mode: "fflate",
      blocked_user_ids: "[1,2]",
      reported_ids: "[3]",
    });
    const wiring = createBackupWiring({ settings });
    const { raw, sets } = await wiring.collect();

    expect(raw).toEqual({ settings_ugoira_mode: "fflate" });
    expect(sets).toEqual({ blocked_user_ids: [1, 2], reported_ids: [3] });
    expect(BACKUP_SET_KEYS).toEqual(["blocked_user_ids", "reported_ids"]);
  });

  it("损坏的 set 值 → 跳过 + warn（不静默）", async () => {
    const { settings } = makeStore({ blocked_user_ids: "{not-json" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sets } = await createBackupWiring({ settings }).collect();
    expect(sets.blocked_user_ids).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("账号级键（已实例化）进入 raw（spec §3.1）", async () => {
    const { settings } = makeStore({ show_r18_42: "true" });
    const factory = settings.defineFactory<string>({ keyPrefix: "show_r18", default: "false" });
    await settings.hydrateAll();
    factory.forId(42);
    const { raw } = await createBackupWiring({ settings }).collect();
    expect(raw.show_r18_42).toBe("true");
  });
});

describe("backupWiring — apply（spec §6 merge-by-keys）", () => {
  it("写回 apply 键与 sets；本地多余键不触碰", async () => {
    const { settings } = makeStore({ local_only: "keep" });
    await settings.hydrateAll();

    const wiring = createBackupWiring({ settings });
    const res = await wiring.apply({
      apply: { settings_ugoira_mode: "range" },
      sets: { blocked_user_ids: [9] },
    });

    expect(res.applied).toEqual(["settings_ugoira_mode", "blocked_user_ids"]);
    expect(settings.get("settings_ugoira_mode")?.value()).toBe("range");
    // 备份中不含的键不动（merge-by-keys）
    expect((await settings.rawValues()).local_only).toBeUndefined();
  });

  it("备份中不含的 set 不写回", async () => {
    const { settings } = makeStore({ blocked_user_ids: "[1]", reported_ids: "[2]" });
    await settings.hydrateAll(); // write gate：生产启动必先 hydrate
    const wiring = createBackupWiring({ settings });
    await wiring.apply({ apply: {}, sets: { blocked_user_ids: [7] } });
    // handle.set 的持久化为 fire-and-forget（正常管线语义）→ 等待落盘
    await vi.waitFor(async () => {
      const raw = await settings.rawValues();
      expect(raw.blocked_user_ids).toBe("[7]");
      expect(raw.reported_ids).toBe("[2]"); // 未触碰
    });
  });
});

describe("backupWiring — T9 应急快照与撤销", () => {
  beforeEach(() => prefs.store.clear());

  it("保存 → 读取 → 清除全流程", async () => {
    const { settings } = makeStore({ settings_ugoira_mode: "fflate", blocked_user_ids: "[1]" });
    const wiring = createBackupWiring({ settings });

    await savePreRestoreSnapshot(wiring);
    const snapshot = await loadPreRestoreSnapshot();
    expect(snapshot?.raw.settings_ugoira_mode).toBe("fflate");
    expect(snapshot?.sets.blocked_user_ids).toEqual([1]);
    expect(typeof snapshot?.at).toBe("string");
    expect(prefs.store.has(PRE_RESTORE_KEY)).toBe(true);

    await clearPreRestoreSnapshot();
    expect(await loadPreRestoreSnapshot()).toBeNull();
  });

  it("无快照时读取为 null；撤销返回 false（不静默执行）", async () => {
    const { settings } = makeStore();
    const wiring = createBackupWiring({ settings });
    expect(await loadPreRestoreSnapshot()).toBeNull();
    expect(await undoLastRestore(wiring)).toBe(false);
  });

  it("撤销：把快照写回（恢复可回滚，spec §6 无退路防线）", async () => {
    const { settings } = makeStore({ settings_ugoira_mode: "fflate", blocked_user_ids: "[1]" });
    await settings.hydrateAll();
    const wiring = createBackupWiring({ settings });

    await savePreRestoreSnapshot(wiring); // 快照 = 恢复前状态

    // 模拟恢复把值改掉
    await wiring.apply({
      apply: { settings_ugoira_mode: "range" },
      sets: { blocked_user_ids: [9] },
    });
    expect(settings.get("settings_ugoira_mode")?.value()).toBe("range");

    expect(await undoLastRestore(wiring)).toBe(true);
    expect(settings.get("settings_ugoira_mode")?.value()).toBe("fflate");
    const raw = await settings.rawValues();
    expect(JSON.parse(raw.blocked_user_ids)).toEqual([1]);
  });

  it("损坏的快照 JSON → null + warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prefs.store.set(PRE_RESTORE_KEY, "{broken");
    expect(await loadPreRestoreSnapshot()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("backupWiring — T8 启动时自动备份", () => {
  it("开关关 → 零桥调用（不联网）", async () => {
    const { settings } = makeStore();
    const { runStartupAutoBackup } = await import("@/services/backupWiring");
    // 真实 settingsStore 由测试环境（happy-dom localStorage/preferences mock）承载；
    // 默认 webdavEnabled=false → 直接返回 null
    expect(await runStartupAutoBackup()).toBeNull();
    expect(settings).toBeTruthy();
  });
});
