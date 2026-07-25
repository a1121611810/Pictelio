/**
 * Global teardown for AI-driven E2E tests.
 * Kills the Vite dev server if it was started by globalSetup.
 */
const serverProcessKey = "aiServerProcess";

export default async function globalTeardown(): Promise<void> {
  const proc = (globalThis as any)[serverProcessKey];
  if (proc) {
    console.log("[AI-E2E] Shutting down dev server...");
    proc.kill("SIGTERM");
    (globalThis as any)[serverProcessKey] = null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
