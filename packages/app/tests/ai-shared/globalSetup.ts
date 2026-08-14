/**
 * Global setup for AI-driven E2E tests (agent-browser & page-agent).
 * Starts the Vite dev server before all tests.
 * Reuses the same logic as the Playwright globalSetup.
 */
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const DEV_SERVER_PORT = 5173;
const serverProcessKey = "aiServerProcess";
const DAEMON_SOCKET = pathResolve(process.env.HOME || "/tmp", ".agent-browser/default.sock");

function loadEnvFile(): void {
  const envPath = pathResolve(new URL("../../.env", import.meta.url).pathname);
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => {
      s.close();
      resolve(false);
    });
    s.listen(port);
  });
}

function killProcessOnPort(port: number): void {
  try {
    const pid = execSync(`lsof -ti :${port}`, { encoding: "utf-8", timeout: 3000 }).trim();
    if (pid) {
      execSync(`kill -9 ${pid}`, { timeout: 3000 });
      console.log(`[AI-E2E] Killed existing process on port ${port} (PID ${pid})`);
    }
  } catch {
    /* nothing listening */
  }
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server did not start within ${timeoutMs}ms`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  console.log("[AI-E2E] Starting global setup...");
  loadEnvFile();

  // 清理残留的 agent-browser daemon socket
  try {
    if (existsSync(DAEMON_SOCKET)) {
      rmSync(DAEMON_SOCKET);
      console.log("[AI-E2E] Cleaned stale agent-browser daemon socket");
    }
  } catch {
    /* ignore */
  }

  if (!process.env.PIXIV_REFRESH_TOKEN) {
    console.warn("[AI-E2E] PIXIV_REFRESH_TOKEN not set. Login tests will be skipped.");
  }

  if (await isPortInUse(DEV_SERVER_PORT)) {
    try {
      const res = await fetch(`http://localhost:${DEV_SERVER_PORT}`);
      if (res.ok || res.status === 404) {
        console.log(`[AI-E2E] Existing Vite server found on port ${DEV_SERVER_PORT}, reusing`);
        // 复用外部 server：teardown 不回收（避免误杀开发者自己启动的服务器）
        return async () => {};
      }
    } catch {
      console.log(`[AI-E2E] Port ${DEV_SERVER_PORT} in use but not responding, killing...`);
      killProcessOnPort(DEV_SERVER_PORT);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`[AI-E2E] Starting Vite dev server on port ${DEV_SERVER_PORT}...`);
  const proc = spawn("pnpm", ["dev", "--port", String(DEV_SERVER_PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    shell: true,
  });

  (globalThis as any)[serverProcessKey] = proc;

  proc.stdout?.on("data", (d: Buffer) => {
    if (process.env.DEBUG) process.stdout.write(`[vite] ${d.toString()}`);
  });
  proc.stderr?.on("data", (d: Buffer) => {
    if (process.env.DEBUG) process.stderr.write(`[vite:err] ${d.toString()}`);
  });
  proc.on("exit", (code) => {
    if (code && process.env.DEBUG) console.log(`[AI-E2E] Vite exited with code ${code}`);
    (globalThis as any)[serverProcessKey] = null;
  });

  await waitForServer(`http://localhost:${DEV_SERVER_PORT}`);
  console.log("[AI-E2E] Dev server is ready");

  // 返回 teardown 函数：Vitest 4 中独立 globalTeardown 配置项不生效
  // （globalSetup 与 globalTeardown 运行在不同进程，globalThis 不共享，且实测
  // 独立 globalTeardown 文件根本不被加载）。setup 返回的函数在测试结束后执行，
  // 闭包直接持有 proc，无需跨进程传递。
  // 进程树为 shell → pnpm → vite：仅 SIGTERM pnpm 时 vite 孙进程收不到信号
  // （pnpm 不转发），会变成孤儿进程继续占用端口——必须按端口强制回收。
  return async () => {
    console.log("[AI-E2E] Shutting down dev server on port 5173...");
    try {
      proc.kill("SIGTERM");
    } catch {
      // pnpm 包装进程可能已自行退出（ESRCH），vite 孙进程按端口回收兜底
    }
    // 轮询等待端口真正释放（最多 5s）。每轮用单条组合命令回收全部监听进程
    // （lsof -ti 可能同时列出 vite 主进程与子进程，逐个 kill 在进程树转换时
    // 可能漏杀，组合命令 xargs 一次性全杀最鲁棒）。
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        execSync(`lsof -ti :${DEV_SERVER_PORT} | xargs -r kill -9`, {
          encoding: "utf-8",
          timeout: 3000,
          stdio: "pipe",
        });
      } catch {
        /* 端口无监听进程（lsof 无输出）或已全部杀掉 */
      }
      let leftover: string[] = [];
      try {
        const out = execSync(`lsof -ti :${DEV_SERVER_PORT}`, {
          encoding: "utf-8",
          timeout: 3000,
        }).trim();
        leftover = out.split("\n").filter(Boolean);
      } catch {
        /* 端口无监听进程 */
      }
      if (leftover.length === 0) {
        console.log("[AI-E2E] Dev server port 5173 released");
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  };
}
