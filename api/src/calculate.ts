import { CalculatorError } from "./calculator/errors.js";
import { formatResult } from "./calculator/format.js";
import { evaluateExpression } from "./calculator/parser.js";

export const MAX_BODY_BYTES = 4096;

export interface CalculateSuccess {
  result: number;
  formattedResult: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface CalculateHttpResponse {
  status: number;
  jsonBody: CalculateSuccess | ErrorBody;
}

export function calculateResponse(method: string, rawBody: string): CalculateHttpResponse {
  if (method.toUpperCase() !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Use POST for calculations.");
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return errorResponse(413, "REQUEST_TOO_LARGE", "Request body must be 4 KiB or smaller.");
  }

  try {
    const body: unknown = JSON.parse(rawBody);
    if (!isRecord(body)) {
      return errorResponse(400, "INVALID_REQUEST", "Request body must be a JSON object.");
    }
    if (Object.keys(body).some((key) => key !== "expression" && key !== "angleMode")) {
      return errorResponse(400, "INVALID_REQUEST", "Only expression and angleMode are supported.");
    }

    const { expression, angleMode } = body;
    if (typeof expression !== "string") {
      return errorResponse(400, "INVALID_REQUEST", "Expression must be a string.");
    }
    if (angleMode !== "DEG" && angleMode !== "RAD") {
      return errorResponse(400, "INVALID_REQUEST", "Angle mode must be DEG or RAD.");
    }

    const result = evaluateExpression(expression, angleMode);
    return {
      status: 200,
      jsonBody: {
        result,
        formattedResult: formatResult(result)
      }
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorResponse(400, "INVALID_JSON", "Request body must contain valid JSON.");
    }
    if (error instanceof CalculatorError) {
      return errorResponse(400, error.code, error.message);
    }
    throw error;
  }
}

export function errorResponse(status: number, code: string, message: string): CalculateHttpResponse {
  return { status, jsonBody: { error: { code, message } } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
