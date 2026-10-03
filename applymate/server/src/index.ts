import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadCipher } from "./crypto.js";
import { AppError, requireCondition } from "./errors.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dataRoot = resolve(root, process.env.APPLYMATE_DATA_DIR ?? ".applymate/local");
const port = Number(process.env.APPLYMATE_PORT ?? 7072);
const origin = process.env.APPLYMATE_ORIGIN ?? "http://localhost:4174";
const origins = [...new Set([origin, "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:4174", "http://127.0.0.1:4174"])];

async function acquireLock(): Promise<() => Promise<void>> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const path = join(dataRoot, "runtime.lock");
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    await handle.close();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const lock: unknown = JSON.parse(await readFile(path, "utf8"));
    requireCondition(typeof lock === "object" && lock !== null && "pid" in lock && Number.isInteger(lock.pid) && Number(lock.pid) > 0, 500, "DATA_LOCK", "The private data lock is unreadable. Choose a new data directory or inspect the lock before retrying.");
    try {
      process.kill(Number(lock.pid), 0);
      throw new AppError(500, "DATA_IN_USE", "Another process owns this data directory. Stop it or choose a separate APPLYMATE_DATA_DIR.");
    } catch (processError) {
      if (!(processError instanceof Error && "code" in processError && processError.code === "ESRCH")) throw processError;
      await unlink(path);
      return acquireLock();
    }
  }
  return () => unlink(path);
}

async function main() {
  requireCondition(process.env.NODE_ENV !== "production", 500, "LOCAL_ONLY", "Public production deployment is not enabled. Run the local build without NODE_ENV=production.");
  requireCondition(!process.env.APPLYMATE_HOST || process.env.APPLYMATE_HOST === "127.0.0.1", 500, "LOCAL_ONLY", "ApplyMate only binds to 127.0.0.1 in this milestone.");
  requireCondition(Number.isInteger(port) && port >= 1024 && port <= 65535, 500, "PORT_CONFIG", "Set APPLYMATE_PORT to a valid unprivileged port.");
  requireCondition(!process.env.APPLYMATE_SMTP_URL || process.env.APPLYMATE_SMTP_FROM, 500, "SMTP_CONFIG", "Set APPLYMATE_SMTP_FROM when enabling SMTP.");
  const release = await acquireLock();
  let runtime: Awaited<ReturnType<typeof createApp>>;
  try {
    const cipher = await loadCipher(dataRoot, process.env.APPLYMATE_DATA_KEY);
    runtime = await createApp({
      directory: join(dataRoot, "postgres"), cipher, origin, origins,
      smtpUrl: process.env.APPLYMATE_SMTP_URL, smtpFrom: process.env.APPLYMATE_SMTP_FROM
    });
  } catch (error) { await release(); throw error; }
  const server = runtime.app.listen(port, "127.0.0.1", () => {
    console.log(`ApplyMate API ready at http://127.0.0.1:${port} (local-only; no request logging).`);
  });
  server.requestTimeout = 25000;
  server.headersTimeout = 10000;
  server.on("error", () => {
    console.error("[ApplyMate] The API could not bind its local port. Stop the conflicting process or change APPLYMATE_PORT.");
    process.exitCode = 1;
    void shutdown().catch(() => {
      console.error("[ApplyMate] Local shutdown failed. Check the data-directory lock before restarting.");
    });
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { await runtime.close(); } finally { await release(); }
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
}

main().catch((error: unknown) => {
  console.error(error instanceof AppError ? `[ApplyMate] ${error.message}` : "[ApplyMate] Startup failed. Check your private data directory, encryption key, and local configuration.");
  process.exitCode = 1;
});
