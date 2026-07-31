import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock SecureStorage 插件 ──
const mockSecureStorage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
};

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: {
    get: (...args: unknown[]) => mockSecureStorage.get(...args),
    set: (...args: unknown[]) => mockSecureStorage.set(...args),
    remove: (...args: unknown[]) => mockSecureStorage.remove(...args),
  },
}));

// ── Mock Preferences（旧版迁移源） ──
let mockPrefToken: string | null = null;
const mockPrefRemove = vi.fn(() => Promise.resolve(undefined));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(() => Promise.resolve({ value: mockPrefToken })),
    remove: (...args: unknown[]) => mockPrefRemove(...args),
  },
}));

// ── Mock Native bridge（syncToken） ──
const mockSyncToken = vi.fn();

vi.mock("@/native/PixivApi", () => ({
  PixivApi: {
    syncToken: (...args: unknown[]) => mockSyncToken(...args),
  },
}));

import { restoreRefreshToken, saveRefreshToken, clearRefreshToken } from "@/utils/secureStorage";

describe("restoreRefreshToken（启动恢复：完整性检查 + 读取/迁移 + Native 注入）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefToken = null;
    mockSyncToken.mockResolvedValue(undefined);
    // 默认成功返回（各用例按需覆盖 get；set/remove 保持 resolved 避免 tryAsync(undefined)）
    mockSecureStorage.get.mockResolvedValue(null);
    mockSecureStorage.set.mockResolvedValue(undefined);
    mockSecureStorage.remove.mockResolvedValue(undefined);
  });

  it("正常启动: marker 存在 + token 存在 → 返回 token 并注入 Native", async () => {
    mockSecureStorage.get.mockImplementation(async (key: string) => {
      if (key === "__pictelio_backup_marker") return "1";
      if (key === "refresh_token") return "valid-refresh-token";
      return null;
    });

    const token = await restoreRefreshToken();

    expect(token).toBe("valid-refresh-token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "valid-refresh-token" });
  });

  it("首次启动: marker 不存在 → 写入 marker → 返回 token", async () => {
    mockSecureStorage.get.mockImplementation(async (key: string) => {
      if (key === "__pictelio_backup_marker") return null;
      if (key === "refresh_token") return "valid-refresh-token";
      return null;
    });

    const token = await restoreRefreshToken();

    expect(token).toBe("valid-refresh-token");
    expect(mockSecureStorage.set).toHaveBeenCalledWith("__pictelio_backup_marker", "1");
  });

  it("备份还原: marker 读取异常 → 清除 token + Native → 返回 null（强制重新登录）", async () => {
    mockSecureStorage.get.mockRejectedValue(new Error("KeyStore unavailable"));

    const token = await restoreRefreshToken();

    expect(token).toBeNull();
    expect(mockSecureStorage.remove).toHaveBeenCalledWith("refresh_token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: null });
  });

  it("解密抛错路径: token 读取 reject（密钥失效重建后旧密文 GCM 认证失败）→ 清除 → 返回 null", async () => {
    mockSecureStorage.get.mockImplementation(async (key: string) => {
      if (key === "__pictelio_backup_marker") return "1";
      throw new Error("AEADBadTagException wrapped reject");
    });

    const token = await restoreRefreshToken();

    expect(token).toBeNull();
    expect(mockSecureStorage.remove).toHaveBeenCalledWith("refresh_token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: null });
  });

  it("旧版迁移: 加密存储无 token 但 Preferences 有 → 迁移并注入 Native", async () => {
    mockSecureStorage.get.mockImplementation(async (key: string) => {
      if (key === "__pictelio_backup_marker") return "1";
      return null;
    });
    mockPrefToken = "legacy-token";

    const token = await restoreRefreshToken();

    expect(token).toBe("legacy-token");
    expect(mockSecureStorage.set).toHaveBeenCalledWith("refresh_token", "legacy-token");
    expect(mockPrefRemove).toHaveBeenCalled();
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "legacy-token" });
  });

  it("迁移写入失败（主存储异常）→ 清除 → 返回 null", async () => {
    mockSecureStorage.get.mockImplementation(async (key: string) => {
      if (key === "__pictelio_backup_marker") return "1";
      return null;
    });
    mockPrefToken = "legacy-token";
    mockSecureStorage.set.mockRejectedValue(new Error("keystore write failed"));

    const token = await restoreRefreshToken();

    expect(token).toBeNull();
    expect(mockSecureStorage.remove).toHaveBeenCalledWith("refresh_token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: null });
  });

  it("无 token 且无迁移源 → 返回 null，不注入 Native", async () => {
    mockSecureStorage.get.mockImplementation(async (key: string) => {
      if (key === "__pictelio_backup_marker") return "1";
      return null;
    });

    const token = await restoreRefreshToken();

    expect(token).toBeNull();
    expect(mockSyncToken).not.toHaveBeenCalled();
  });
});

describe("saveRefreshToken / clearRefreshToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncToken.mockResolvedValue(undefined);
    mockSecureStorage.set.mockResolvedValue(undefined);
    mockSecureStorage.remove.mockResolvedValue(undefined);
  });

  it("save: 加密存储写入 + Native 注入", async () => {
    mockSecureStorage.set.mockResolvedValue(undefined);

    await saveRefreshToken("new-token");

    expect(mockSecureStorage.set).toHaveBeenCalledWith("refresh_token", "new-token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "new-token" });
  });

  it("clear: 加密存储删除 + Native 清除（含历史明文残留）", async () => {
    mockSecureStorage.remove.mockResolvedValue(undefined);

    await clearRefreshToken();

    expect(mockSecureStorage.remove).toHaveBeenCalledWith("refresh_token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: null });
  });

  it("Native 注入失败（Web 环境）不破坏持久化主流程", async () => {
    mockSecureStorage.set.mockResolvedValue(undefined);
    mockSyncToken.mockRejectedValue(new Error("Plugin PixivApi does not exist"));

    await expect(saveRefreshToken("new-token")).resolves.toBeUndefined();
    expect(mockSecureStorage.set).toHaveBeenCalledWith("refresh_token", "new-token");
  });

  it("持久化失败（Keystore 写入异常）不阻断 Native 注入", async () => {
    mockSecureStorage.set.mockRejectedValue(new Error("keystore write failed"));
    mockSyncToken.mockResolvedValue(undefined);

    await expect(saveRefreshToken("new-token")).resolves.toBeUndefined();
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "new-token" });
  });
});
