export type AngleMode = "DEG" | "RAD";

interface CalculateSuccess {
  result: number;
  formattedResult: string;
}

export async function calculate(
  expression: string,
  angleMode: AngleMode,
  signal: AbortSignal
): Promise<CalculateSuccess> {
  let response: Response;
  try {
    response = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression, angleMode }),
      signal
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Cannot reach the calculator API. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("The calculator API returned an invalid response. Please try again.");
  }

  if (!response.ok) {
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
      throw new Error(body.error.message);
    }
    throw new Error("The calculator service is unavailable. Please try again.");
  }
  if (
    !isRecord(body) ||
    typeof body.result !== "number" ||
    !Number.isFinite(body.result) ||
    typeof body.formattedResult !== "string" ||
    !body.formattedResult ||
    body.formattedResult.length > 32 ||
    !Number.isFinite(Number(body.formattedResult))
  ) {
    throw new Error("The calculator API returned an invalid result. Please try again.");
  }
  return { result: body.result, formattedResult: body.formattedResult };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
