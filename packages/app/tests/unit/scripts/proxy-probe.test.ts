import { describe, it, expect } from "vitest";
import {
  noProxyMatch,
  probeProxyRouting,
  describeUploadRouting,
} from "../../../scripts/lib/proxy-probe.mjs";

describe("noProxyMatch（httpproxy 域名/子域语义）", () => {
  it("* 匹配一切", () => {
    expect(noProxyMatch("uploads.github.com", "*")).toBe(true);
    expect(noProxyMatch("example.com", "*")).toBe(true);
  });

  it("无前导点域名匹配「自身 + 所有子域」", () => {
    expect(noProxyMatch("github.com", "github.com")).toBe(true);
    expect(noProxyMatch("uploads.github.com", "github.com")).toBe(true); // 关键：gh 上传域是子域
    expect(noProxyMatch("api.github.com", "github.com")).toBe(true);
    expect(noProxyMatch("githubusercontent.com", "github.com")).toBe(false); // 后缀陷阱
    expect(noProxyMatch("example.com", "github.com")).toBe(false);
  });

  it("前导点域名只匹配子域，不匹配自身", () => {
    expect(noProxyMatch("uploads.github.com", ".github.com")).toBe(true);
    expect(noProxyMatch("github.com", ".github.com")).toBe(false);
  });

  it("host:port 条目不匹配无端口目标（目标默认端口 443）", () => {
    expect(noProxyMatch("uploads.github.com", "uploads.github.com:443")).toBe(false);
  });

  it("IPv4 精确匹配", () => {
    expect(noProxyMatch("20.205.243.161", "20.205.243.161")).toBe(true);
    expect(noProxyMatch("20.205.243.162", "20.205.243.161")).toBe(false);
  });

  it("IPv4 CIDR 前缀匹配", () => {
    expect(noProxyMatch("20.205.243.161", "20.205.243.0/24")).toBe(true);
    expect(noProxyMatch("20.205.244.161", "20.205.243.0/24")).toBe(false);
    expect(noProxyMatch("20.205.243.161", "0.0.0.0/0")).toBe(true);
    expect(noProxyMatch("20.205.243.161", "20.205.243.161/32")).toBe(true);
  });

  it("IPv6 精确字符串匹配（剥 []）", () => {
    expect(noProxyMatch("::1", "::1")).toBe(true);
    expect(noProxyMatch("::1", "[::1]")).toBe(true);
  });
});

describe("probeProxyRouting", () => {
  const uploads = "uploads.github.com";

  it("无代理环境变量 → 直连", () => {
    const r = probeProxyRouting(uploads, {});
    expect(r.mode).toBe("direct");
    expect(r.reason).toContain("未配置代理");
  });

  it("HTTPS_PROXY 配置且 NO_PROXY 未覆盖 → 代理", () => {
    const r = probeProxyRouting(uploads, { HTTPS_PROXY: "http://127.0.0.1:10808" });
    expect(r.mode).toBe("proxy");
    expect(r.proxyUrl).toBe("http://127.0.0.1:10808");
  });

  it("NO_PROXY=github.com 命中子域 → 直连（研究关键推论）", () => {
    const r = probeProxyRouting(uploads, {
      HTTPS_PROXY: "http://127.0.0.1:10808",
      NO_PROXY: "github.com",
    });
    expect(r.mode).toBe("direct");
    expect(r.noProxyMatch).toBe("github.com");
  });

  it("NO_PROXY=api.github.com,uploads.github.com 精确域名 → 直连", () => {
    const r = probeProxyRouting(uploads, {
      HTTPS_PROXY: "http://127.0.0.1:10808",
      NO_PROXY: "api.github.com,uploads.github.com",
    });
    expect(r.mode).toBe("direct");
    expect(r.noProxyMatch).toBe("uploads.github.com");
  });

  it("NO_PROXY 只含 api.github.com → uploads 仍走代理", () => {
    const r = probeProxyRouting(uploads, {
      HTTPS_PROXY: "http://127.0.0.1:10808",
      NO_PROXY: "api.github.com",
    });
    expect(r.mode).toBe("proxy");
    expect(r.proxyUrl).toBe("http://127.0.0.1:10808");
  });

  it("NO_PROXY=* → 直连", () => {
    const r = probeProxyRouting(uploads, { HTTPS_PROXY: "http://127.0.0.1:10808", NO_PROXY: "*" });
    expect(r.mode).toBe("direct");
  });

  it("小写环境变量同样生效", () => {
    expect(probeProxyRouting(uploads, { https_proxy: "http://x:1" }).mode).toBe("proxy");
    expect(
      probeProxyRouting(uploads, { https_proxy: "http://x:1", no_proxy: "uploads.github.com" })
        .mode,
    ).toBe("direct");
  });

  it("ALL_PROXY 作为 HTTPS_PROXY 的 fallback（Go httpproxy 语义）", () => {
    // 仅 ALL_PROXY → 走代理
    const r = probeProxyRouting(uploads, { ALL_PROXY: "http://127.0.0.1:10809" });
    expect(r.mode).toBe("proxy");
    expect(r.proxyUrl).toBe("http://127.0.0.1:10809");
    // HTTPS_PROXY 优先于 ALL_PROXY
    const r2 = probeProxyRouting(uploads, {
      HTTPS_PROXY: "http://127.0.0.1:10808",
      ALL_PROXY: "http://127.0.0.1:10809",
    });
    expect(r2.proxyUrl).toBe("http://127.0.0.1:10808");
    // HTTP_PROXY 不参与 https 目标判定（uploads 是 https）
    expect(probeProxyRouting(uploads, { HTTP_PROXY: "http://127.0.0.1:10808" }).mode).toBe(
      "direct",
    );
  });
});

describe("describeUploadRouting", () => {
  it("直连描述", () => {
    expect(describeUploadRouting("uploads.github.com", {})).toContain("直连");
  });
  it("代理描述含代理地址", () => {
    expect(
      describeUploadRouting("uploads.github.com", { HTTPS_PROXY: "http://127.0.0.1:10808" }),
    ).toContain("http://127.0.0.1:10808");
  });
});
