export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export function requireCondition(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}

export function safeFailure(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}
