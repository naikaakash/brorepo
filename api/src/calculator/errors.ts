export type CalculatorErrorCode =
  | "EMPTY_EXPRESSION"
  | "EXPRESSION_TOO_LONG"
  | "TOO_MANY_TOKENS"
  | "EXPRESSION_TOO_DEEP"
  | "INVALID_TOKEN"
  | "INVALID_SYNTAX"
  | "UNKNOWN_IDENTIFIER"
  | "DIVISION_BY_ZERO"
  | "DOMAIN_ERROR"
  | "NON_FINITE_RESULT";

export class CalculatorError extends Error {
  constructor(
    public readonly code: CalculatorErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CalculatorError";
  }
}
