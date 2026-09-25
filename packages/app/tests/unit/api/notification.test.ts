import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiErrorType } from "@/api/types";

// Mock apiClient（形态对齐 illust.test.ts）
const mockGet = vi.fn();

vi.mock("@/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
  },
}));

async function loadApi() {
  vi.resetModules();
  return import("@/api/notification");
}

describe("api/notification.ts", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("loadNotifications 首屏：GET /v1/notification/list 无参数", async () => {
    mockGet.mockResolvedValue({ notifications: [], next_url: null });
    const { loadNotifications } = await loadApi();
    await loadNotifications();

    expect(mockGet).toHaveBeenCalledWith("/v1/notification/list", undefined, undefined);
  });

  it("loadNotifications 透传 signal", async () => {
    mockGet.mockResolvedValue({ notifications: [], next_url: null });
    const { loadNotifications } = await loadApi();
    const controller = new AbortController();
    await loadNotifications(undefined, controller.signal);

    expect(mockGet).toHaveBeenCalledWith("/v1/notification/list", undefined, controller.signal);
  });

  it("loadNotifications 翻页：next_url 原样透传（绝对 URL 由 client.rewriteUrl 剥域）", async () => {
    mockGet.mockResolvedValue({ notifications: [], next_url: null });
    const { loadNotifications } = await loadApi();
    const nextUrl = "https://app-api.pixiv.net/v1/notification/list?limit=30&offset=30";
    await loadNotifications(nextUrl);

    expect(mockGet).toHaveBeenCalledWith(nextUrl, undefined, undefined);
  });

  it("loadNotificationChildren 首屏：GET /v1/notification/view-more + notification_id", async () => {
    mockGet.mockResolvedValue({ notifications: [], next_url: null });
    const { loadNotificationChildren } = await loadApi();
    await loadNotificationChildren(12345);

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/notification/view-more",
      { notification_id: "12345" },
      undefined,
    );
  });

  it("loadNotificationChildren 翻页：older_than 游标 next_url 原样透传", async () => {
    mockGet.mockResolvedValue({ notifications: [], next_url: null });
    const { loadNotificationChildren } = await loadApi();
    const cursorUrl =
      "https://app-api.pixiv.net/v1/notification/view-more?notification_id=12345&limit=30&older_than=100111111";
    await loadNotificationChildren(12345, cursorUrl);

    expect(mockGet).toHaveBeenCalledWith(cursorUrl, undefined, undefined);
  });

  it("失败路径：client 抛出的 ApiError 原样上抛（不吞不改）", async () => {
    const apiError = {
      type: ApiErrorType.SERVER,
      message: "服务器错误 (HTTP 500)",
      status: 500,
    };
    mockGet.mockRejectedValue(apiError);
    const { loadNotifications, loadNotificationChildren } = await loadApi();

    await expect(loadNotifications()).rejects.toBe(apiError);
    await expect(loadNotificationChildren(1)).rejects.toBe(apiError);
  });

  it("失败路径：网络错误（TypeError）原样上抛", async () => {
    mockGet.mockRejectedValue(new TypeError("network down"));
    const { loadNotifications } = await loadApi();

    await expect(loadNotifications()).rejects.toBeInstanceOf(TypeError);
  });
});
