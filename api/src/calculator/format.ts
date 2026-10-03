export function formatResult(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const absolute = Math.abs(normalized);

  if (normalized !== 0 && (absolute >= 1e15 || absolute < 1e-9)) {
    return normalized.toExponential(14).replace(/\.?0+e/, "e");
  }

  return Number(normalized.toPrecision(15)).toString();
}
