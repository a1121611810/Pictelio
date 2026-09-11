// @vitest-environment happy-dom
// app WebDav 桥单测（spec webdav-backup §4 薄桥；ADR-0156 D1）：
// seam = 类型化桥函数（T4 的消费面），mock Capacitor 插件验证
// 参数过桥 / base64 编解码 / reject code → WebDavError kind 映射 / Web 平台守卫。
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebDavPluginInterface } from "@/native/WebDav";

const fake = vi.hoisted(() => ({
  plugin: null as Partial<WebDavPluginInterface> | null,
  native: true,
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => {
    // 每次访问返回当前 fake.plugin（用例内可换实现）
    return new Proxy({} as WebDavPluginInterface, {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          const impl = fake.plugin?.[prop as keyof WebDavPluginInterface];
          if (typeof impl !== "function") {
            return Promise.reject(new Error("not implemented"));
          }
          return (impl as (...a: unknown[]) => unknown)(...args);
        };
      },
    });
  },
}));
vi.mock("@/utils/platform", () => ({
  isNativePlatform: () => fake.native,
}));

import {
  ensureDir,
  download,
  list,
  uploadWithVerify,
  WebDavError,
  bytesToBase64,
  base64ToBytes,
  type WebDavErrorKind,
} from "@/native/WebDav";

class FakeCapError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

describe("WebDav 桥", () => {
  beforeEach(() => {
    fake.plugin = {};
    fake.native = true;
  });

  it("base64 助手往返无损（含空数组与二进制全量程）", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array([])))).toEqual(new Uint8Array([]));
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
    expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe("aGVsbG8=");
  });

  it("成功路径：ensureDir 透传 url/creds；download 做 base64 解码", async () => {
    const calls: unknown[] = [];
    fake.plugin = {
      async ensureDir(opts: { url: string; user: string; password: string }) {
        calls.push(opts);
      },
      async download() {
        return { base64: "aGVsbG8=" }; // "hello"
      },
    };
    await ensureDir("https://dav.example.com/backup/", { user: "alice", password: "pw" });
    expect(calls).toEqual([
      { url: "https://dav.example.com/backup/", user: "alice", password: "pw" },
    ]);
    const data = await download("https://dav.example.com/f.json", { user: "u", password: "p" });
    expect(new TextDecoder().decode(data)).toBe("hello");
  });

  it("成功路径：uploadWithVerify 传 base64 与 maxAttempts（缺省不下发）", async () => {
    let received: Record<string, unknown> | null = null;
    fake.plugin = {
      async uploadWithVerify(opts: Record<string, unknown>) {
        received = opts;
      },
    };
    await uploadWithVerify(
      "https://dav/f.json",
      { user: "u", password: "p" },
      new Uint8Array([1, 2]),
      5,
    );
    expect(received).toMatchObject({
      url: "https://dav/f.json",
      user: "u",
      password: "p",
      base64: "AQI=",
      maxAttempts: 5,
    });
  });

  it("list 返回条目数组（contentLength null 透传）", async () => {
    fake.plugin = {
      async list() {
        return {
          entries: [
            { href: "/dav/backup/", isCollection: true, contentLength: null },
            { href: "/dav/backup/a.json", isCollection: false, contentLength: 123 },
          ],
        };
      },
    };
    const entries = await list("https://dav/backup/", { user: "u", password: "p" });
    expect(entries).toHaveLength(2);
    expect(entries[0].contentLength).toBeNull();
    expect(entries[1].contentLength).toBe(123);
  });

  it("失败路径：reject code 映射为 WebDavError.kind（401 → AUTH_FAILED）", async () => {
    fake.plugin = {
      async ensureDir(): Promise<void> {
        throw new FakeCapError("认证失败", "AUTH_FAILED");
      },
    };
    const err = await ensureDir("https://dav/", { user: "u", password: "bad" }).catch((e) => e);
    expect(err).toBeInstanceOf(WebDavError);
    expect((err as WebDavError).kind).toBe("AUTH_FAILED");
  });

  it("失败路径：CRYPTO code 映射（密码错误或文件损坏）", async () => {
    fake.plugin = {
      async decrypt(): Promise<{ base64: string }> {
        throw new FakeCapError("密码错误或文件损坏", "CRYPTO");
      },
    };
    const { decrypt } = await import("@/native/WebDav");
    const err = await decrypt(new Uint8Array([1]), "wrong").catch((e) => e);
    expect((err as WebDavError).kind).toBe("CRYPTO" as WebDavErrorKind);
  });

  it("失败路径：未知/缺失 code 降级为 SERVER（不静默、不崩溃）", async () => {
    fake.plugin = {
      async stat(): Promise<{ entry: never }> {
        throw new Error("无 code 的异常");
      },
    };
    const { stat } = await import("@/native/WebDav");
    const err = await stat("https://dav/f", { user: "u", password: "p" }).catch((e) => e);
    expect((err as WebDavError).kind).toBe("SERVER");
  });

  it("Web 平台守卫：原生不可用时提前抛 WebDavError（不发起插件调用）", async () => {
    fake.native = false;
    fake.plugin = {
      async ensureDir(): Promise<void> {
        throw new Error("不应被调用");
      },
    };
    const err = await ensureDir("https://dav/", { user: "u", password: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(WebDavError);
    expect((err as WebDavError).message).toContain("仅 Android 原生可用");
  });
});
