import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Preferences } from "@capacitor/preferences";
import {
  CLIENT_KIND_KEY,
  DEFAULT_CLIENT,
  readClientKind,
  setClientKind,
} from "@/utils/clientSwitch";

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockedGet = vi.mocked(Preferences.get);
const mockedSet = vi.mocked(Preferences.set);

describe("clientSwitch（webview ↔ lynx 开关，IO 边界）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readClientKind", () => {
    it("读取到 lynx → 返回 lynx", async () => {
      mockedGet.mockResolvedValueOnce({ value: "lynx" });
      await expect(readClientKind()).resolves.toBe("lynx");
      expect(mockedGet).toHaveBeenCalledWith({ key: CLIENT_KIND_KEY });
    });

    it("读取到 webview → 返回 webview", async () => {
      mockedGet.mockResolvedValueOnce({ value: "webview" });
      await expect(readClientKind()).resolves.toBe("webview");
    });

    it("无记录（null）→ 默认 webview", async () => {
      mockedGet.mockResolvedValueOnce({ value: null });
      await expect(readClientKind()).resolves.toBe(DEFAULT_CLIENT);
    });

    it("异常值 → 默认 webview（不抛）", async () => {
      mockedGet.mockResolvedValueOnce({ value: "unknown-kind" });
      await expect(readClientKind()).resolves.toBe("webview");
    });

    it("读取失败（Preferences.get reject）→ 默认 webview + console.warn（禁止静默降级）", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockedGet.mockRejectedValueOnce(new Error("keystore unavailable"));
      await expect(readClientKind()).resolves.toBe("webview");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("setClientKind", () => {
    it("写入 lynx → Preferences.set 调用 key/value", async () => {
      await setClientKind("lynx");
      expect(mockedSet).toHaveBeenCalledWith({ key: CLIENT_KIND_KEY, value: "lynx" });
    });

    it("写入失败 → reject 向上抛（调用方负责提示）", async () => {
      mockedSet.mockRejectedValueOnce(new Error("write failed"));
      await expect(setClientKind("lynx")).rejects.toThrow("write failed");
    });
  });
});
