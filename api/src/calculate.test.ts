import { describe, expect, it } from "vitest";
import { calculateResponse } from "./calculate.js";

describe("calculateResponse", () => {
  it("returns a successful API contract", () => {
    const response = calculateResponse("POST", JSON.stringify({ expression: "sin(30)", angleMode: "DEG" }));
    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual({ result: expect.closeTo(0.5, 12), formattedResult: "0.5" });
  });

  it.each([
    ["GET", "{}", 405, "METHOD_NOT_ALLOWED"],
    ["POST", "{", 400, "INVALID_JSON"],
    ["POST", "[]", 400, "INVALID_REQUEST"],
    ["POST", "null", 400, "INVALID_REQUEST"],
    ["POST", JSON.stringify({ expression: 1, angleMode: "RAD" }), 400, "INVALID_REQUEST"],
    ["POST", JSON.stringify({ expression: "1+1" }), 400, "INVALID_REQUEST"],
    ["POST", JSON.stringify({ expression: "1+1", angleMode: "RAD", script: "x" }), 400, "INVALID_REQUEST"],
    ["POST", JSON.stringify({ expression: "1+1", angleMode: "GRAD" }), 400, "INVALID_REQUEST"],
    ["POST", JSON.stringify({ expression: "1/0", angleMode: "RAD" }), 400, "DIVISION_BY_ZERO"],
    ["POST", "x".repeat(4097), 413, "REQUEST_TOO_LARGE"]
  ])("rejects invalid request", (method, body, status, code) => {
    const response = calculateResponse(method, body);
    expect(response.status).toBe(status);
    expect(response.jsonBody).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code }) })
    );
  });
});
