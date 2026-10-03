import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  calculateResponse,
  errorResponse,
  MAX_BODY_BYTES,
  type CalculateHttpResponse
} from "./calculate.js";

export async function handleCalculate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    if (request.method !== "POST") {
      return httpResponse(calculateResponse(request.method, ""));
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return httpResponse(errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json."));
    }
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
      return requestTooLarge();
    }

    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > MAX_BODY_BYTES) {
            await reader.cancel();
            return requestTooLarge();
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    return httpResponse(calculateResponse(request.method, Buffer.concat(chunks, length).toString("utf8")));
  } catch {
    // Do not include the expression, request body, or exception details in diagnostics.
    context.error("Unexpected calculator request failure.");
    return httpResponse(errorResponse(500, "INTERNAL_ERROR", "The calculator could not complete this request."));
  }
}

function requestTooLarge(): HttpResponseInit {
  return httpResponse(errorResponse(413, "REQUEST_TOO_LARGE", "Request body must be 4 KiB or smaller."));
}

function httpResponse(response: CalculateHttpResponse): HttpResponseInit {
  return {
    status: response.status,
    jsonBody: response.jsonBody,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...(response.status === 405 ? { Allow: "POST" } : {})
    }
  };
}
