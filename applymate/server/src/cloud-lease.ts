import { randomUUID } from "node:crypto";
import { AppError, requireCondition } from "./errors.js";

export async function acquireCloudLease(failed: () => void): Promise<() => Promise<void>> {
  const endpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;
  const clientId = process.env.APPLYMATE_IDENTITY_CLIENT_ID;
  const leaseUrl = process.env.APPLYMATE_LEASE_URL;
  requireCondition(endpoint && identityHeader && clientId && leaseUrl &&
    /^https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\/runtime\/lease$/.test(leaseUrl),
  500, "LEASE_CONFIG", "The Azure pilot requires managed identity and its private storage lease.");
  const leaseId = randomUUID();
  async function storage(action?: "acquire" | "renew" | "release") {
    const url = new URL(endpoint!);
    url.searchParams.set("resource", "https://storage.azure.com/");
    url.searchParams.set("api-version", "2019-08-01");
    url.searchParams.set("client_id", clientId!);
    const tokenResponse = await fetch(url, { headers: { "X-IDENTITY-HEADER": identityHeader! }, signal: AbortSignal.timeout(10000) });
    requireCondition(tokenResponse.ok, 500, "LEASE_IDENTITY", "Could not authenticate the storage lease.");
    const token: unknown = await tokenResponse.json();
    requireCondition(typeof token === "object" && token !== null && "access_token" in token && typeof token.access_token === "string",
      500, "LEASE_IDENTITY", "Managed identity returned an invalid storage token.");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.access_token}`, "x-ms-version": "2023-11-03", "x-ms-date": new Date().toUTCString()
    };
    if (action) {
      headers["x-ms-lease-action"] = action;
      headers[action === "acquire" ? "x-ms-proposed-lease-id" : "x-ms-lease-id"] = leaseId;
      if (action === "acquire") headers["x-ms-lease-duration"] = "60";
    } else { headers["x-ms-blob-type"] = "BlockBlob"; headers["If-None-Match"] = "*"; }
    const response = await fetch(action ? `${leaseUrl}?comp=lease` : leaseUrl!, {
      method: "PUT", headers, body: "", signal: AbortSignal.timeout(10000)
    });
    await response.body?.cancel();
    return response;
  }
  const created = await storage();
  const alreadyExists = created.status === 412 || (created.status === 409 &&
    ["BlobAlreadyExists", "LeaseIdMissing", "LeaseIdMissingWithBlobOperation"].includes(created.headers.get("x-ms-error-code") ?? ""));
  requireCondition(created.ok || alreadyExists, 500, "LEASE_STORAGE", `Could not initialize the storage lease (HTTP ${created.status}).`);
  const acquired = await storage("acquire");
  requireCondition(acquired.ok, 500, "DATA_IN_USE", "Another replica owns the pilot database, or the previous lease has not expired.");
  let closed = false;
  let renewing = false;
  const timer = setInterval(() => {
    if (closed || renewing) return;
    renewing = true;
    void storage("renew").then((response) => {
      if (!response.ok && !closed) failed();
    }, () => { if (!closed) failed(); }).finally(() => { renewing = false; });
  }, 20000);
  timer.unref();
  return async () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    const released = await storage("release");
    if (!released.ok) throw new AppError(500, "LEASE_RELEASE", "The storage lease could not be released; it will expire automatically.");
  };
}
