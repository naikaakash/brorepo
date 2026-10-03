import { CalculatorError } from "./errors.js";
import { tokenize, type Token } from "./tokenizer.js";

export type AngleMode = "DEG" | "RAD";

const MAX_PARSE_DEPTH = 16;
const TANGENT_SINGULARITY_TOLERANCE = 1e-12;
const constants: Record<string, number> = { pi: Math.PI, e: Math.E };

export function evaluateExpression(expression: string, angleMode: AngleMode): number {
  const parser = new Parser(tokenize(expression), angleMode);
  return parser.parse();
}

class Parser {
  private position = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly angleMode: AngleMode
  ) {}

  parse(): number {
    const value = this.parseAdditive();
    if (this.current().type !== "eof") {
      throw new CalculatorError("INVALID_SYNTAX", "Unexpected content after the expression.");
    }
    return ensureFinite(value);
  }

  private guarded<T>(parse: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_PARSE_DEPTH) {
      throw new CalculatorError(
        "EXPRESSION_TOO_DEEP",
        `Expression nesting must not exceed ${MAX_PARSE_DEPTH} levels.`
      );
    }
    try {
      return parse();
    } finally {
      this.depth -= 1;
    }
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.isOperator("+") || this.isOperator("-")) {
      const operator = this.consumeOperator();
      const right = this.parseMultiplicative();
      value = ensureFinite(operator === "+" ? value + right : value - right);
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (this.isOperator("*") || this.isOperator("/")) {
      const operator = this.consumeOperator();
      const right = this.parseUnary();
      if (operator === "/" && right === 0) {
        throw new CalculatorError("DIVISION_BY_ZERO", "Cannot divide by zero.");
      }
      value = ensureFinite(operator === "*" ? value * right : value / right);
    }
    return value;
  }

  private parseUnary(): number {
    if (this.isOperator("+")) {
      this.position += 1;
      return this.guarded(() => this.parseUnary());
    }
    if (this.isOperator("-")) {
      this.position += 1;
      return ensureFinite(-this.guarded(() => this.parseUnary()));
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePostfix();
    if (!this.isOperator("^")) {
      return base;
    }
    this.position += 1;
    const exponent = this.guarded(() => this.parseUnary());
    const result = Math.pow(base, exponent);
    if (Number.isNaN(result)) {
      throw new CalculatorError(
        "DOMAIN_ERROR",
        "Power operation is outside the supported real-number domain."
      );
    }
    return ensureFinite(result);
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    while (this.isOperator("!") || this.isOperator("%")) {
      const operator = this.consumeOperator();
      value = operator === "!" ? factorial(value) : ensureFinite(value / 100);
    }
    return value;
  }

  private parsePrimary(): number {
    const token = this.current();
    if (token.type === "number") {
      this.position += 1;
      return token.value;
    }
    if (token.type === "identifier") {
      this.position += 1;
      if (Object.hasOwn(constants, token.value)) {
        return constants[token.value];
      }
      if (this.current().type !== "leftParen") {
        throw new CalculatorError(
          "UNKNOWN_IDENTIFIER",
          `Unknown constant or missing function parentheses: ${token.value}.`
        );
      }
      this.position += 1;
      const argument = this.guarded(() => this.parseAdditive());
      this.expectRightParen();
      return applyFunction(token.value, argument, this.angleMode);
    }
    if (token.type === "leftParen") {
      this.position += 1;
      const value = this.guarded(() => this.parseAdditive());
      this.expectRightParen();
      return value;
    }
    throw new CalculatorError("INVALID_SYNTAX", "Expected a number, constant, or function.");
  }

  private expectRightParen(): void {
    if (this.current().type !== "rightParen") {
      throw new CalculatorError("INVALID_SYNTAX", "Missing closing parenthesis.");
    }
    this.position += 1;
  }

  private current(): Token {
    return this.tokens[this.position];
  }

  private isOperator(value: Extract<Token, { type: "operator" }>["value"]): boolean {
    const token = this.current();
    return token.type === "operator" && token.value === value;
  }

  private consumeOperator(): Extract<Token, { type: "operator" }>["value"] {
    const token = this.current();
    if (token.type !== "operator") {
      throw new CalculatorError("INVALID_SYNTAX", "Expected an operator.");
    }
    this.position += 1;
    return token.value;
  }
}

function applyFunction(name: string, input: number, angleMode: AngleMode): number {
  const angle = angleMode === "DEG" ? (input % 360) * (Math.PI / 180) : input;
  let result: number;

  switch (name) {
    case "sin":
      result = Math.sin(angle);
      break;
    case "cos":
      result = Math.cos(angle);
      break;
    case "tan":
      if (Math.abs(Math.cos(angle)) < TANGENT_SINGULARITY_TOLERANCE) {
        throw new CalculatorError("DOMAIN_ERROR", "Tangent is undefined at this angle.");
      }
      result = Math.tan(angle);
      break;
    case "asin":
    case "acos":
      if (input < -1 || input > 1) {
        throw new CalculatorError("DOMAIN_ERROR", `${name} requires a value from -1 to 1.`);
      }
      result = name === "asin" ? Math.asin(input) : Math.acos(input);
      if (angleMode === "DEG") {
        result = (result * 180) / Math.PI;
      }
      break;
    case "atan":
      result = Math.atan(input);
      if (angleMode === "DEG") {
        result = (result * 180) / Math.PI;
      }
      break;
    case "sqrt":
      if (input < 0) {
        throw new CalculatorError("DOMAIN_ERROR", "Square root requires a non-negative value.");
      }
      result = Math.sqrt(input);
      break;
    case "log":
      if (input <= 0) {
        throw new CalculatorError("DOMAIN_ERROR", "Logarithm requires a positive value.");
      }
      result = Math.log10(input);
      break;
    case "ln":
      if (input <= 0) {
        throw new CalculatorError("DOMAIN_ERROR", "Natural logarithm requires a positive value.");
      }
      result = Math.log(input);
      break;
    default:
      throw new CalculatorError("UNKNOWN_IDENTIFIER", `Unknown function: ${name}.`);
  }

  return ensureFinite(result);
}

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 170) {
    throw new CalculatorError(
      "DOMAIN_ERROR",
      "Factorial requires an integer from 0 through 170."
    );
  }
  let result = 1;
  for (let number = 2; number <= value; number += 1) {
    result *= number;
  }
  return result;
}

function ensureFinite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new CalculatorError("NON_FINITE_RESULT", "Result is outside the supported finite range.");
  }
  return Object.is(value, -0) ? 0 : value;
}
