import { z } from "@applymate/contracts";

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) { super(message); }
}
const errorSchema = z.union([
  z.object({ error: z.object({ code: z.string(), message: z.string() }) }).transform(({ error }) => error),
  z.object({ message: z.string(), code: z.string().optional() }).transform(({ message, code }) => ({ message, code: code ?? "REQUEST_FAILED" }))
]);
export const savedSchema = z.object({ saved: z.literal(true) });
export const successSchema = z.object({ success: z.literal(true) });
interface Options { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> }

export class ApiClient {
  private generation = 0;
  private pending = new Set<AbortController>();
  onUnauthorized: (() => void) | null = null;

  reset() {
    this.generation++;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
  async request<T>(path: string, schema: z.ZodType<T>, options: Options = {}): Promise<T> {
    return this.receive(path, options, async (response) => {
      let body: unknown;
      try { body = await response.json(); }
      catch { throw new ApiError("The server returned an unreadable response. Refresh before retrying.", "INVALID_RESPONSE"); }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ApiError("The server response did not match the expected format. Refresh before retrying.", "INVALID_RESPONSE");
      return parsed.data;
    });
  }
  async download(path: string, filename: string, mime: string): Promise<void> {
    const blob = await this.receive(path, {}, async (response) => {
      if (!(response.headers.get("content-type") ?? "").startsWith(mime)) throw new ApiError("The document download returned an unexpected format.", "INVALID_DOWNLOAD");
      return response.blob();
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  private async receive<T>(path: string, options: Options, consume: (response: Response) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const controller = new AbortController();
    this.pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 60000);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      const multipart = options.body instanceof FormData;
      const response = await fetch(`/api${path}`, {
        method: options.method ?? "GET", credentials: "same-origin", signal,
        headers: { "X-Applymate-Request": "1", ...(options.body !== undefined && !multipart ? { "Content-Type": "application/json" } : {}), ...options.headers },
        body: multipart ? options.body as FormData : options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = errorSchema.safeParse(body);
        if (response.status === 401 && generation === this.generation) this.onUnauthorized?.();
        throw new ApiError(detail.success ? detail.data.message : `The request failed (${response.status}). Refresh before retrying.`,
          detail.success ? detail.data.code : "REQUEST_FAILED", response.status);
      }
      const result = await consume(response);
      if (generation !== this.generation || signal.aborted) throw new DOMException("Request cancelled.", "AbortError");
      return result;
    } catch (error) {
      if (generation !== this.generation || options.signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");
      if (controller.signal.aborted) throw new ApiError("The server took too long. Refresh to check whether your change was saved before retrying.", "TIMEOUT");
      if (error instanceof ApiError) throw error;
      throw new ApiError("Cannot reach ApplyMate. Check that the local API is running, then try again.", "OFFLINE");
    } finally { clearTimeout(timeout); this.pending.delete(controller); }
  }
}
export const api = new ApiClient();
export const cancelled = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export async function microsoftSignOut(destination = "/"): Promise<void> {
  const response = await fetch("/.auth/logout", { credentials: "same-origin", redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new ApiError("Microsoft sign-out failed. Retry before changing accounts.", "SIGN_OUT_FAILED", response.status);
  window.location.assign(destination);
}
