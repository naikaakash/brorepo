import { ReadableStream } from "node:stream/web";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCalculate } from "./http.js";

afterEach(() => vi.restoreAllMocks());

function request(body: string, headers: Record<string, string> = {}): HttpRequest {
  return new HttpRequest({
    method: "POST",
    url: "http://localhost/api/calculate",
    headers: { "content-type": "application/json", ...headers },
    body: { string: body }
  });
}

const validBody = JSON.stringify({ expression: "2+2", angleMode: "RAD" });

describe("HTTP adapter", () => {
  it("returns JSON with no-store headers", async () => {
    const response = await handleCalculate(request(validBody), new InvocationContext());
    expect(response).toMatchObject({
      status: 200,
      jsonBody: { result: 4, formattedResult: "4" },
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" }
    });
  });

  it.each(["GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])("rejects %s with Allow: POST", async (method) => {
    const response = await handleCalculate(
      new HttpRequest({ method, url: "http://localhost/api/calculate" }),
      new InvocationContext()
    );
    expect(response).toMatchObject({
      status: 405,
      headers: { Allow: "POST" },
      jsonBody: { error: { code: "METHOD_NOT_ALLOWED" } }
    });
  });

  it("rejects the wrong content type", async () => {
    const response = await handleCalculate(
      request(validBody, { "content-type": "text/plain" }),
      new InvocationContext()
    );
    expect(response.status).toBe(415);
  });

  it("accepts exactly 4 KiB and rejects one byte more", async () => {
    expect((await handleCalculate(request(validBody.padEnd(4096)), new InvocationContext())).status).toBe(200);
    expect((await handleCalculate(request(validBody.padEnd(4097)), new InvocationContext())).status).toBe(413);
  });

  it("rejects an oversized Content-Length without reading", async () => {
    const input = request(validBody, { "content-length": "4097" });
    const bodyRead = vi.spyOn(input, "body", "get");
    expect((await handleCalculate(input, new InvocationContext())).status).toBe(413);
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it("counts streamed bytes even with a missing or inaccurate Content-Length", async () => {
    const input = request(validBody, { "content-length": "1" });
    const cancelled = vi.fn();
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(Buffer.alloc(2049));
      },
      cancel: cancelled
    }, { highWaterMark: 0 });
    vi.spyOn(input, "body", "get").mockReturnValue(body);
    expect((await handleCalculate(input, new InvocationContext())).status).toBe(413);
    expect(reads).toBe(2);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("surfaces unexpected failures without logging request or exception content", async () => {
    const context = new InvocationContext();
    const log = vi.spyOn(context, "error").mockImplementation(() => {});
    const input = request(validBody);
    vi.spyOn(input, "body", "get").mockImplementation(() => { throw new Error("private expression"); });
    const response = await handleCalculate(input, context);
    expect(response).toMatchObject({ status: 500, jsonBody: { error: { code: "INTERNAL_ERROR" } } });
    expect(log).toHaveBeenCalledExactlyOnceWith("Unexpected calculator request failure.");
  });
});
