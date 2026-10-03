import { CalculatorError } from "./errors.js";

export const MAX_EXPRESSION_LENGTH = 256;
export const MAX_TOKENS = 128;

export type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "^" | "!" | "%" }
  | { type: "leftParen" }
  | { type: "rightParen" }
  | { type: "eof" };

const numberPattern = /^(?:(?:\d+\.\d*|\d*\.\d+|\d+)(?:e[+-]?\d+)?)/i;
const identifierPattern = /^[a-z]+/i;

export function tokenize(expression: string): Token[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculatorError(
      "EXPRESSION_TOO_LONG",
      `Expression must be ${MAX_EXPRESSION_LENGTH} characters or fewer.`
    );
  }
  const input = expression.trim();
  if (!input) {
    throw new CalculatorError("EMPTY_EXPRESSION", "Enter an expression to calculate.");
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const remaining = input.slice(index);
    const character = input[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    const numberMatch = remaining.match(numberPattern);
    if (numberMatch) {
      const value = Number(numberMatch[0]);
      if (!Number.isFinite(value)) {
        throw new CalculatorError("NON_FINITE_RESULT", "Number is outside the supported range.");
      }
      tokens.push({ type: "number", value });
      index += numberMatch[0].length;
    } else {
      const identifierMatch = remaining.match(identifierPattern);
      if (identifierMatch) {
        tokens.push({ type: "identifier", value: identifierMatch[0].toLowerCase() });
        index += identifierMatch[0].length;
      } else if (isOperator(character)) {
        tokens.push({
          type: "operator",
          value: character
        });
        index += 1;
      } else if (character === "(") {
        tokens.push({ type: "leftParen" });
        index += 1;
      } else if (character === ")") {
        tokens.push({ type: "rightParen" });
        index += 1;
      } else {
        throw new CalculatorError(
          "INVALID_TOKEN",
          `Unsupported character at position ${index + 1}.`
        );
      }
    }

    if (tokens.length > MAX_TOKENS) {
      throw new CalculatorError(
        "TOO_MANY_TOKENS",
        `Expression must contain ${MAX_TOKENS} tokens or fewer.`
      );
    }
  }

  tokens.push({ type: "eof" });
  return tokens;
}

function isOperator(value: string): value is Extract<Token, { type: "operator" }>["value"] {
  return ["+", "-", "*", "/", "^", "!", "%"].includes(value);
}
