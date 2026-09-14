// @vitest-environment happy-dom
// webdavCredentials 单测（spec docs/specs/webdav-backup.md §8 / ADR-0156 D4）：
// 密码只进 secure storage、双路径（成功/失败/降级）、Web 平台不落密码、历史引号格式兼容。
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSecure = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failOn: null as "get" | "set" | "remove" | null,
}));
const mockNative = vi.hoisted(() => ({ current: false }));

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: {
    async setItem(key: string, value: string) {
      if (mockSecure.failOn === "set") throw new Error("keystore locked");
      mockSecure.store.set(key, value);
    },
    async getItem(key: string) {
      if (mockSecure.failOn === "get") throw new Error("keystore lost");
      return mockSecure.store.has(key) ? mockSecure.store.get(key)! : null;
    },
    async removeItem(key: string) {
      if (mockSecure.failOn === "remove") throw new Error("keystore locked");
      mockSecure.store.delete(key);
    },
  },
}));
vi.mock("@/utils/platform", () => ({
  isNativePlatform: () => mockNative.current,
}));

import {
  saveWebdavPassword,
  loadWebdavPassword,
  clearWebdavPassword,
  saveBackupPassword,
  loadBackupPassword,
  clearBackupPassword,
} from "@/utils/webdavCredentials";

describe("webdavCredentials", () => {
  beforeEach(() => {
    mockSecure.store.clear();
    mockSecure.failOn = null;
    mockNative.current = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("成功路径：登录密码与备份密码各自独立读写（键不同，互不可见）", async () => {
    await saveWebdavPassword("login-secret");
    await saveBackupPassword("backup-secret");
    expect(await loadWebdavPassword()).toBe("login-secret");
    expect(await loadBackupPassword()).toBe("backup-secret");
    // 物理隔离：两个键分别落盘
    expect(mockSecure.store.get("webdav_password")).toBe("login-secret");
    expect(mockSecure.store.get("webdav_backup_password")).toBe("backup-secret");
  });

  it("清除后读取为 null", async () => {
    await saveWebdavPassword("x");
    await clearWebdavPassword();
    expect(await loadWebdavPassword()).toBeNull();
  });

  it("读取失败 → 按未设置处理 + warn（禁静默降级）", async () => {
    await saveWebdavPassword("x");
    mockSecure.failOn = "get";
    const warn = vi.mocked(console.warn);
    expect(await loadWebdavPassword()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[webdavCredentials] 密码读取失败（按未设置处理）",
      expect.anything(),
    );
  });

  it("写入失败 → 抛错 + warn（密码丢失必须可见，不能假装成功）", async () => {
    mockSecure.failOn = "set";
    await expect(saveWebdavPassword("x")).rejects.toThrow();
    expect(vi.mocked(console.warn)).toHaveBeenCalled();
  });

  it("Web 平台：不落密码（save 空操作 + warn），读取恒 null", async () => {
    mockNative.current = false;
    await saveWebdavPassword("should-not-persist");
    expect(mockSecure.store.size).toBe(0);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      "[webdavCredentials] Web 平台不持久化 WebDAV 密码（功能仅原生可用）",
    );
    expect(await loadWebdavPassword()).toBeNull();
  });

  it('历史 JSON 包裹格式兼容读取（形如 "pwd" 去引号）', async () => {
    mockSecure.store.set("webdav_password", '"legacy-quoted"');
    expect(await loadWebdavPassword()).toBe("legacy-quoted");
  });

  it("备份密码独立清除不影响登录密码", async () => {
    await saveWebdavPassword("login");
    await saveBackupPassword("backup");
    await clearBackupPassword();
    expect(await loadBackupPassword()).toBeNull();
    expect(await loadWebdavPassword()).toBe("login");
  });
});
