import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadCipher } from "./crypto.js";
import { AppError, requireCondition } from "./errors.js";
import { acquireCloudLease } from "./cloud-lease.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cloud = process.env.APPLYMATE_CLOUD === "azure";
const dataRoot = resolve(root, process.env.APPLYMATE_DATA_DIR ?? ".applymate/local");
const port = Number(process.env.PORT ?? process.env.APPLYMATE_PORT ?? 7072);
const origin = process.env.APPLYMATE_ORIGIN ?? "http://localhost:4174";
const origins = [...new Set([origin, "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:4174", "http://127.0.0.1:4174"])];
const databaseUrl = process.env.APPLYMATE_DATABASE_URL;

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
  requireCondition(cloud ? Boolean((process.env.WEBSITE_SITE_NAME || process.env.CONTAINER_APP_NAME) && process.env.APPLYMATE_TENANT && process.env.APPLYMATE_OWNER &&
    process.env.APPLYMATE_DATA_KEY && process.env.APPLYMATE_DATA_DIR?.startsWith("/home/") && origin.startsWith("https://")) :
    process.env.NODE_ENV !== "production", 500, "HOST_CONFIG", "Public hosting requires Azure App Service identity, an owner restriction, an encryption key, HTTPS, and persistent /home storage.");
  requireCondition(cloud || !process.env.APPLYMATE_HOST || process.env.APPLYMATE_HOST === "127.0.0.1", 500, "LOCAL_ONLY", "The local mode only binds to 127.0.0.1.");
  requireCondition(Number.isInteger(port) && port >= 1024 && port <= 65535, 500, "PORT_CONFIG", "Set APPLYMATE_PORT to a valid unprivileged port.");
  requireCondition(!process.env.APPLYMATE_SMTP_URL || process.env.APPLYMATE_SMTP_FROM, 500, "SMTP_CONFIG", "Set APPLYMATE_SMTP_FROM when enabling SMTP.");
  const release = cloud ? await acquireCloudLease(() => {
    console.error("[ApplyMate] Storage lease lost; stopping immediately to prevent concurrent database access.");
    process.exit(1);
  }) : await acquireLock();
  let runtime: Awaited<ReturnType<typeof createApp>>;
  try {
    const cipher = await loadCipher(dataRoot, process.env.APPLYMATE_DATA_KEY);
    runtime = await createApp({
      directory: join(dataRoot, "postgres"), cipher, origin, origins: cloud ? [origin] : origins,
      databaseUrl, databasePoolSize: Number(process.env.APPLYMATE_DATABASE_POOL_SIZE ?? 5),
      smtpUrl: cloud ? undefined : process.env.APPLYMATE_SMTP_URL, smtpFrom: cloud ? undefined : process.env.APPLYMATE_SMTP_FROM,
      ...(cloud ? {
        cloud: { tenant: process.env.APPLYMATE_TENANT!, objectId: process.env.APPLYMATE_OWNER!, publicSignup: process.env.APPLYMATE_PUBLIC_SIGNUP === "true" },
        frontend: join(root, "applymate", "client", "dist")
      } : {})
    });
  } catch (error) { await release(); throw error; }
  const server = runtime.app.listen(port, cloud ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`ApplyMate ready on port ${port} (${cloud ? "owner-restricted Azure pilot" : "local-only"}; no request logging).`);
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
