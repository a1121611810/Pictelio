/**
 * Vitest setup for agent-browser tests.
 * 在每个测试文件运行前清理 agent-browser daemon socket。
 */
import { beforeAll, afterAll } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const DAEMON_SOCKET = resolve(
  process.env.HOME || "/tmp",
  ".agent-browser/default.sock",
);

beforeAll(() => {
  // 清理残留 daemon socket
  try {
    if (existsSync(DAEMON_SOCKET)) {
      rmSync(DAEMON_SOCKET);
    }
  } catch { /* ignore */ }
  // 杀掉残留 daemon 进程
  try {
    execSync("pkill -f 'agent-browser.*daemon' 2>/dev/null", { timeout: 2000 });
  } catch { /* ignore */ }
  console.log("[agent-browser] 测试套件开始");
});

afterAll(() => {
  console.log("[agent-browser] 测试套件结束");
});
