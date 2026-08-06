import { describe, it, expect, vi } from "vitest";
import { runOutputAsync, withSpinner } from "../../../scripts/lib/release-utils.mjs";

describe("runOutputAsync", () => {
  it("成功路径：返回 trim 后的 stdout", async () => {
    const out = await runOutputAsync("node", ["-e", "process.stdout.write('  hello  \\n')"]);
    expect(out).toBe("hello");
  });

  it("失败路径：命令非零退出 → reject", async () => {
    await expect(runOutputAsync("node", ["-e", "process.exit(1)"])).rejects.toThrow();
  });

  it("trim:false 时保留首尾空白", async () => {
    const out = await runOutputAsync("node", ["-e", "process.stdout.write('  hi  ')"], {
      trim: false,
    });
    expect(out).toBe("  hi  ");
  });
});

describe("withSpinner", () => {
  it("执行 fn 并返回其结果", async () => {
    const result = await withSpinner("测试", async () => 42);
    expect(result).toBe(42);
  });

  it("fn 抛错时向上传播", async () => {
    await expect(
      withSpinner("测试", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("TTY 下（动画分支）执行 fn 并返回结果", async () => {
    const desc = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    try {
      const result = await withSpinner("x", async () => 7);
      expect(result).toBe(7);
    } finally {
      if (desc) Object.defineProperty(process.stderr, "isTTY", desc);
      else delete process.stderr.isTTY;
    }
  });
});
