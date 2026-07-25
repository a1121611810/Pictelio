/**
 * Vitest setup for agent-browser tests.
 *
 * 使用 AGENT_BROWSER_NAMESPACE 隔离每个测试文件的 daemon socket，
 * 并在 afterAll 中强制清理 daemon 进程。
 */
import { beforeAll, afterAll } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

// 每个测试文件使用唯一的 namespace，避免 daemon socket 冲突
const NAMESPACE = `pictelio-test-${randomBytes(4).toString("hex")}`;
const DAEMON_SOCKET = resolve(process.env.HOME || "/tmp", ".agent-browser", `${NAMESPACE}.sock`);

beforeAll(() => {
  // 设置 namespace，agent-browser CLI 会读取此环境变量
  process.env.AGENT_BROWSER_NAMESPACE = NAMESPACE;

  // 确保 socket 目录存在
  try {
    const dir = resolve(process.env.HOME || "/tmp", ".agent-browser");
    if (!existsSync(dir)) {
      execSync(`mkdir -p "${dir}"`, { timeout: 2000 });
    }
  } catch {
    /* ignore */
  }

  // 清理可能残留的 socket
  try {
    if (existsSync(DAEMON_SOCKET)) rmSync(DAEMON_SOCKET);
  } catch {
    /* ignore */
  }

  console.log(`[agent-browser] namespace=${NAMESPACE} 测试套件开始`);
});

afterAll(() => {
  // 强制杀掉当前 namespace 的 daemon 进程
  try {
    execSync("pkill -f 'agent-browser.*daemon' 2>/dev/null", { timeout: 3000 });
  } catch {
    /* ignore */
  }

  // 清理 socket 文件
  try {
    if (existsSync(DAEMON_SOCKET)) rmSync(DAEMON_SOCKET);
    // 也清理默认 socket
    const defSock = resolve(process.env.HOME || "/tmp", ".agent-browser/default.sock");
    if (existsSync(defSock)) rmSync(defSock);
  } catch {
    /* ignore */
  }

  console.log("[agent-browser] 测试套件结束");
});
