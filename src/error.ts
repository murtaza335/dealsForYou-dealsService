// errors.ts

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof TransientError) return true;

  if (typeof error === "object" && error !== null) {
    const err = error as any;

    // MongoDB transient errors
    if (
      err.code === 112 ||
      err.code === 251 ||
      err?.errorLabels?.includes?.("TransientTransactionError")
    ) {
      return true;
    }
  }

  return false;
}