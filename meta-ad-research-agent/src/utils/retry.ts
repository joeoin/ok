export interface RetryOptions {
  /** Total attempts including the first one. */
  attempts?: number;
  /** Delay before the first retry; doubles each retry. */
  baseDelayMs?: number;
  /** Upper bound for any single delay. */
  maxDelayMs?: number;
  /** Return false to stop retrying for non-transient errors. */
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` with exponential backoff. Rethrows the last error once attempts
 * are exhausted or `shouldRetry` returns false.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseDelayMs = 1000, maxDelayMs = 15_000, shouldRetry = () => true, onRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) throw error;
      onRetry?.(error, attempt);
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }
  // Unreachable, but satisfies the type checker.
  throw lastError;
}
