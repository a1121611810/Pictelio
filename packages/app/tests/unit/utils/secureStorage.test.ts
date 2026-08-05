import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ── Mock SecureStorage 插件 ──
// get/set：JSON 语义（backup_marker 内部用）；getItem/setItem：原始字符串语义（refresh_token 用，与 lynx 契约一致）
const mockSecureStorage = {
  get: vi.fn(),
  set: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  remove: vi.fn(),
};

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: {
    get: (...args: unknown[]) => mockSecureStorage.get(...args),
    set: (...args: unknown[]) => mockSecureStorage.set(...args),
    getItem: (...args: unknown[]) => mockSecureStorage.getItem(...args),
    setItem: (...args: unknown[]) => mockSecureStorage.setItem(...args),
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

/** 预设「marker 走 get、token 走 getItem」的读取状态 */
function mockStoredToken(token: string | null, marker: string | null = "1"): void {
  mockSecureStorage.get.mockResolvedValue(marker);
  mockSecureStorage.getItem.mockResolvedValue(token);
}

describe("restoreRefreshToken（启动恢复：完整性检查 + 读取/迁移 + Native 注入）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefToken = null;
    mockSyncToken.mockResolvedValue(undefined);
    // 默认成功返回（各用例按需覆盖；setItem/remove 保持 resolved 避免 tryAsync(undefined)）
    mockSecureStorage.get.mockResolvedValue(null);
    mockSecureStorage.set.mockResolvedValue(undefined);
    mockSecureStorage.getItem.mockResolvedValue(null);
    mockSecureStorage.setItem.mockResolvedValue(undefined);
    mockSecureStorage.remove.mockResolvedValue(undefined);
  });

  it("正常启动: marker 存在 + token 存在 → 返回 token 并注入 Native", async () => {
    mockStoredToken("valid-refresh-token", "1");

    const token = await restoreRefreshToken();

    expect(token).toBe("valid-refresh-token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "valid-refresh-token" });
  });

  it("读取 lynx 原始格式（无 JSON 引号）直通还原", async () => {
    // lynx SecureStorageCompat.setItem 写入的原始 token（base64 字符集，无引号）—— 双端共享存储的常态
    mockStoredToken("LXa0TEPb-raw-native-token", "1");

    const token = await restoreRefreshToken();

    expect(token).toBe("LXa0TEPb-raw-native-token");
    expect(mockSecureStorage.remove).not.toHaveBeenCalled(); // 不得误判为存储损坏而清除
  });

  it("读取旧版 JSON 历史格式（带引号）去引号还原", async () => {
    // 旧版 webview SecureStorage.set 写入的值是 JSON.stringify(token)（形如 "\"token\""）
    mockStoredToken('"old-json-token"', "1");

    const token = await restoreRefreshToken();

    expect(token).toBe("old-json-token");
  });

  it("非法 JSON（形似引号但解析失败）保持原样，不误删", async () => {
    mockStoredToken('"broken"value"', "1");

    const token = await restoreRefreshToken();

    expect(token).toBe('"broken"value"');
    expect(mockSecureStorage.remove).not.toHaveBeenCalled();
  });

  it("首次启动: marker 不存在 → 写入 marker → 返回 token", async () => {
    mockStoredToken("valid-refresh-token", null);

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

  it("存储损坏: token 读取 reject（getItem 失败）→ 清除 + warn + 返回 null", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockSecureStorage.get.mockResolvedValue("1");
    mockSecureStorage.getItem.mockRejectedValue(new Error("AEADBadTagException wrapped reject"));

    const token = await restoreRefreshToken();

    expect(token).toBeNull();
    expect(mockSecureStorage.remove).toHaveBeenCalledWith("refresh_token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: null });
    // 非静默降级：失败路径必须带模块前缀告警（约束「禁止静默降级」）
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[secureStorage]"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("旧版迁移: 加密存储无 token 但 Preferences 有 → 迁移（setItem 新格式）并注入 Native", async () => {
    mockStoredToken(null, "1");
    mockPrefToken = "legacy-token";

    const token = await restoreRefreshToken();

    expect(token).toBe("legacy-token");
    expect(mockSecureStorage.setItem).toHaveBeenCalledWith("refresh_token", "legacy-token");
    expect(mockPrefRemove).toHaveBeenCalled();
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "legacy-token" });
  });

  it("迁移写入失败（主存储异常）→ 清除 → 返回 null", async () => {
    mockStoredToken(null, "1");
    mockPrefToken = "legacy-token";
    mockSecureStorage.setItem.mockRejectedValue(new Error("keystore write failed"));

    const token = await restoreRefreshToken();

    expect(token).toBeNull();
    expect(mockSecureStorage.remove).toHaveBeenCalledWith("refresh_token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: null });
  });

  it("无 token 且无迁移源 → 返回 null，不注入 Native", async () => {
    mockStoredToken(null, "1");

    const token = await restoreRefreshToken();

    expect(token).toBeNull();
    expect(mockSyncToken).not.toHaveBeenCalled();
  });
});

describe("saveRefreshToken / clearRefreshToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncToken.mockResolvedValue(undefined);
    mockSecureStorage.setItem.mockResolvedValue(undefined);
    mockSecureStorage.remove.mockResolvedValue(undefined);
  });

  it("save: setItem 写原始字符串（不 JSON 包裹）+ Native 注入", async () => {
    mockSecureStorage.setItem.mockResolvedValue(undefined);

    await saveRefreshToken("new-token");

    expect(mockSecureStorage.setItem).toHaveBeenCalledWith("refresh_token", "new-token");
    expect(mockSecureStorage.set).not.toHaveBeenCalled(); // 不得退回 JSON 包裹的 set 路径
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "new-token" });
  });

  it("clear: 加密存储删除 + Native 清除（含历史明文残留）", async () => {
    mockSecureStorage.remove.mockResolvedValue(undefined);

    await clearRefreshToken();

    expect(mockSecureStorage.remove).toHaveBeenCalledWith("refresh_token");
    expect(mockSyncToken).toHaveBeenCalledWith({ token: null });
  });

  it("Native 注入失败（Web 环境）不破坏持久化主流程", async () => {
    mockSecureStorage.setItem.mockResolvedValue(undefined);
    mockSyncToken.mockRejectedValue(new Error("Plugin PixivApi does not exist"));

    await expect(saveRefreshToken("new-token")).resolves.toBeUndefined();
    expect(mockSecureStorage.setItem).toHaveBeenCalledWith("refresh_token", "new-token");
  });

  it("持久化失败（Keystore 写入异常）不阻断 Native 注入", async () => {
    mockSecureStorage.setItem.mockRejectedValue(new Error("keystore write failed"));
    mockSyncToken.mockResolvedValue(undefined);

    await expect(saveRefreshToken("new-token")).resolves.toBeUndefined();
    expect(mockSyncToken).toHaveBeenCalledWith({ token: "new-token" });
  });
});

/**
 * 双端 refresh_token 存储契约一致性测试（防漂移，仿 backupRulesConsistency.test.ts 模式）
 *
 * 背景（T1 修复，issue #127）：
 * lynx 端 SecureStorageCompat（Java，原始字符串写入）与 webview 端
 * @aparajita/capacitor-secure-storage 共享同一加密存储
 * （SharedPreferences `WSSecureStorageSharedPreferences`，落盘 key = `capacitor-storage_` + key），
 * 任何一端存储 key / 前缀 / 写入格式漂移都会导致对方读取失败。
 * 历史 bug：webview 用 JSON 语义的 set/get 读写，读到 lynx 写入的原始字符串时
 * JSON.parse 抛 StorageError → 误判存储损坏 → 清 token → 引擎切换后白屏。
 *
 * 本测试从源码提取真实常量比对，任一端漂移即红灯（不手写"与实现自洽"的 mock）。
 */

// ── 契约源文件路径（相对本测试文件：packages/app/tests/unit/utils/） ──
const contractTestDir = path.dirname(fileURLToPath(import.meta.url));
const webviewSourcePath = path.resolve(contractTestDir, "../../../src/utils/secureStorage.ts");
const lynxSourcePath = path.resolve(
  contractTestDir,
  "../../../../app-lynx/src/utils/tokenStorage.ts",
);
// Java 侧前缀常量（lynx 原生路径实际写入方，SecureStorageCompat.java）
const javaCompatPath = path.resolve(
  contractTestDir,
  "../../../android/app/src/main/java/io/pictelio/app/SecureStorageCompat.java",
);
// 插件 JS 端前缀常量（webview 原生路径实际写入方，base.js）
const pluginBasePath = path.resolve(
  contractTestDir,
  "../../../node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js",
);

const contractWebviewSource = readFileSync(webviewSourcePath, "utf8");
const contractLynxSource = readFileSync(lynxSourcePath, "utf8");
const contractJavaSource = readFileSync(javaCompatPath, "utf8");
const contractPluginBaseSource = readFileSync(pluginBasePath, "utf8");

/** 提取形如 `NAME = "值"` 的字符串常量（兼容单/双引号，插件 base.js 用单引号） */
function extractStringConst(source: string, name: string): string {
  const m = source.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`));
  if (!m) {
    throw new Error(`未能从源码提取常量 ${name}`);
  }
  return m[1];
}

describe("双端 refresh_token 存储契约一致性（webview secureStorage ↔ lynx tokenStorage）", () => {
  const webKey = extractStringConst(contractWebviewSource, "REFRESH_TOKEN_KEY");
  const lynxKey = extractStringConst(contractLynxSource, "KEY");
  const pluginPrefix = extractStringConst(contractPluginBaseSource, "prefix");
  const javaPrefix = extractStringConst(contractJavaSource, "PREFIX");

  it(`存储 key 一致：webview REFRESH_TOKEN_KEY = lynx KEY = "refresh_token"`, () => {
    expect(webKey).toBe("refresh_token");
    expect(lynxKey).toBe("refresh_token");
    expect(lynxKey).toBe(webKey);
  });

  it(`prefixedKey 一致：插件 base.js prefix 与 Java SecureStorageCompat PREFIX 均为 "capacitor-storage_"，拼接 = "capacitor-storage_refresh_token"`, () => {
    expect(javaPrefix).toBe("capacitor-storage_");
    expect(pluginPrefix).toBe("capacitor-storage_");
    expect(`${pluginPrefix}${webKey}`).toBe("capacitor-storage_refresh_token");
    expect(`${javaPrefix}${lynxKey}`).toBe("capacitor-storage_refresh_token");
  });

  it("写入格式一致：两端保存路径均以原始字符串 setItem（无 JSON.stringify 包裹）", () => {
    // webview: saveRefreshToken 走 SecureStorage.setItem(REFRESH_TOKEN_KEY, token)，不再退回 JSON 包裹的 set
    expect(contractWebviewSource).toMatch(/SecureStorage\.setItem\(REFRESH_TOKEN_KEY,\s*token\)/);
    expect(contractWebviewSource).not.toMatch(/SecureStorage\.set\(REFRESH_TOKEN_KEY/);
    // lynx: 原生路径 mod.setItem(KEY, token) 直接写原始 token
    expect(contractLynxSource).toMatch(/mod\.setItem\(KEY,\s*token,/);
  });

  it("迁移路径同样以原始字符串写入新格式（setItem）", () => {
    // 旧版 @capacitor/preferences 明文迁移写入也必须走 setItem（无 JSON 包裹），否则旧数据二次污染
    expect(contractWebviewSource).toMatch(/SecureStorage\.setItem\(REFRESH_TOKEN_KEY,\s*legacy\)/);
  });

  it("读取路径兼容：两端均对读出值做条件去引号（而非无条件 JSON.parse 或原样直用）", () => {
    // webview: getItem 读原始字符串 + unquoteTokenValue 兼容旧 JSON 历史格式
    expect(contractWebviewSource).toMatch(/SecureStorage\.getItem\(REFRESH_TOKEN_KEY\)/);
    expect(contractWebviewSource).toMatch(/startsWith\('"'\)/);
    expect(contractWebviewSource).toMatch(/JSON\.parse/);
    // lynx: getItem 回调 + unquoteNativeString（native→JS 回调 JSON 序列化去引号）
    expect(contractLynxSource).toMatch(/unquoteNativeString\(value\)/);
    expect(contractLynxSource).toMatch(/startsWith\('"'\)/);
    expect(contractLynxSource).toMatch(/JSON\.parse/);
  });

  it("backup_marker 仍用 JSON 语义 get/set（webview 内部标记，不参与双端共享 token 契约）", () => {
    // marker 仅 webview 内部使用，保持 get/set（JSON 自洽）即可，但不得误用于 refresh_token 路径
    expect(contractWebviewSource).toMatch(/SecureStorage\.get\(BACKUP_MARKER_KEY\)/);
    expect(contractWebviewSource).toMatch(/SecureStorage\.set\(BACKUP_MARKER_KEY/);
  });
});
