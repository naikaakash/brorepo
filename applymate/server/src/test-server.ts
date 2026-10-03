import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { Cipher } from "./crypto.js";
import { AppError } from "./errors.js";
import { Gateway } from "./gateway.js";

async function main() {
  const origin = "http://127.0.0.1:4175";
  const runtime = await createApp({
    cipher: new Cipher(randomBytes(32)), origin, origins: [origin], rateLimit: 500,
    gateway: new Gateway(async () => { throw new AppError(502, "TEST_PROVIDER_DISABLED", "External providers are disabled in browser tests."); })
  });
  const server = runtime.app.listen(7073, "127.0.0.1", () => {
    console.log("ApplyMate isolated browser-test API ready. In-memory data; external providers disabled.");
  });
  server.requestTimeout = 25000;
  server.headersTimeout = 10000;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  };
  const shutdown = () => { void close().catch(() => { console.error("ApplyMate test-server shutdown failed."); process.exitCode = 1; }); };
  server.once("error", () => { console.error("ApplyMate test port 7073 is unavailable."); process.exitCode = 1; shutdown(); });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
main().catch(() => { console.error("ApplyMate test-server startup failed."); process.exitCode = 1; });
