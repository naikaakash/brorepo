import { describe, expect, it } from "vitest";
import { formatResult } from "./format.js";
import { evaluateExpression } from "./parser.js";

describe("evaluateExpression", () => {
  it.each([
    ["2+3*4", "RAD", 14],
    ["(2+3)*4", "RAD", 20],
    ["-2^2", "RAD", -4],
    ["2^3^2", "RAD", 512],
    ["2^-2", "RAD", 0.25],
    ["5!", "RAD", 120],
    ["25%", "RAD", 0.25],
    ["sin(30)", "DEG", 0.5],
    ["cos(pi)", "RAD", -1],
    ["asin(1)", "DEG", 90],
    ["log(1000)", "RAD", 3],
    ["ln(e)", "RAD", 1],
    ["sqrt(81)", "RAD", 9],
    ["0!", "RAD", 1],
    [".5+1e-3", "RAD", 0.501],
    ["acos(-1)", "DEG", 180],
    ["atan(1)", "DEG", 45],
    ["atan(1)", "RAD", Math.PI / 4],
    ["tan(45)", "DEG", 1],
    ["cos(540)", "DEG", -1],
    ["sin(1e308)", "DEG", Math.sin((1e308 % 360) * (Math.PI / 180))],
    ["(-2)^3", "RAD", -8],
    ["2*50%", "RAD", 1],
    ["-0", "RAD", 0]
  ] as const)("evaluates %s in %s mode", (expression, mode, expected) => {
    expect(evaluateExpression(expression, mode)).toBeCloseTo(expected, 12);
  });

  it("supports sixteen nested groups", () => {
    expect(evaluateExpression(`${"(".repeat(16)}1${")".repeat(16)}`, "RAD")).toBe(1);
  });

  it.each([
    ["1/0", "DIVISION_BY_ZERO"],
    ["sqrt(-1)", "DOMAIN_ERROR"],
    ["tan(90)", "DOMAIN_ERROR"],
    ["171!", "DOMAIN_ERROR"],
    ["(-1)!", "DOMAIN_ERROR"],
    ["1.5!", "DOMAIN_ERROR"],
    ["ln(0)", "DOMAIN_ERROR"],
    ["log(-1)", "DOMAIN_ERROR"],
    ["asin(2)", "DOMAIN_ERROR"],
    ["acos(-2)", "DOMAIN_ERROR"],
    ["(-2)^.5", "DOMAIN_ERROR"],
    ["1e999", "NON_FINITE_RESULT"],
    ["(1e308*2)*0", "NON_FINITE_RESULT"],
    ["2pi", "INVALID_SYNTAX"],
    ["1 2", "INVALID_SYNTAX"],
    ["2+", "INVALID_SYNTAX"],
    ["sin()", "INVALID_SYNTAX"],
    ["(1+2", "INVALID_SYNTAX"],
    ["2)", "INVALID_SYNTAX"],
    ["globalThis", "UNKNOWN_IDENTIFIER"],
    ["constructor", "UNKNOWN_IDENTIFIER"],
    ["constructor(1)", "UNKNOWN_IDENTIFIER"],
    ["foo(1)", "UNKNOWN_IDENTIFIER"],
    ["1;process.exit()", "INVALID_TOKEN"],
    ["x=1", "INVALID_TOKEN"],
    ["   ", "EMPTY_EXPRESSION"],
    ["1".repeat(257), "EXPRESSION_TOO_LONG"],
    ["1".padEnd(257), "EXPRESSION_TOO_LONG"],
    [`1${"+1".repeat(64)}`, "TOO_MANY_TOKENS"],
    [`${"-".repeat(17)}1`, "EXPRESSION_TOO_DEEP"],
    [`1${"^1".repeat(17)}`, "EXPRESSION_TOO_DEEP"],
    [`${"(".repeat(17)}1${")".repeat(17)}`, "EXPRESSION_TOO_DEEP"]
  ])("rejects %s with %s", (expression, code) => {
    expect(() => evaluateExpression(expression, "DEG")).toThrow(expect.objectContaining({ code }));
  });

  it("accepts exact token and character limits", () => {
    expect(evaluateExpression(`+1${"+1".repeat(63)}`, "RAD")).toBe(64);
    expect(evaluateExpression("1".padEnd(256), "RAD")).toBe(1);
    expect(Number.isFinite(evaluateExpression("170!", "RAD"))).toBe(true);
  });

  it("rejects tangent singularities in radians", () => {
    expect(() => evaluateExpression("tan(pi/2)", "RAD")).toThrow(
      expect.objectContaining({ code: "DOMAIN_ERROR" })
    );
  });
});

describe("formatResult", () => {
  it("normalizes negative zero and limits precision", () => {
    expect(formatResult(-0)).toBe("0");
    expect(formatResult(1 / 3)).toBe("0.333333333333333");
  });

  it("uses scientific notation for extreme magnitudes", () => {
    expect(formatResult(1e20)).toBe("1e+20");
    expect(formatResult(1e-10)).toBe("1e-10");
  });
});
