/**
 * Global setup for AI-driven E2E tests (agent-browser & page-agent).
 * Starts the Vite dev server before all tests.
 * Reuses the same logic as the Playwright globalSetup.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
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

export default async function globalSetup(): Promise<void> {
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
        return;
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
}
