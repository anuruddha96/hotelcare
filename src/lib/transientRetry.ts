export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  jitter?: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

const messageOf = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return '';
};

export const isTransientBackendError = (error: unknown) => {
  const status = error && typeof error === 'object' && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  if (status === 408 || status === 429 || status >= 500) return true;
  return /timeout|timed out|network|fetch|connection|connect error|upstream|disconnect|reset before headers|temporarily unavailable|service unavailable/i.test(messageOf(error));
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const withTimeout = async <T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

export async function retryTransient<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 5);
  const baseDelayMs = options.baseDelayMs ?? 350;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const timeoutMs = options.timeoutMs ?? 8000;
  const jitter = Math.max(0, options.jitter ?? 0.2);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTimeout(operation, timeoutMs);
    } catch (error) {
      if (!isTransientBackendError(error) || attempt === attempts) throw error;
      options.onRetry?.(attempt, error);
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const randomized = exponential * (1 + (Math.random() * 2 - 1) * jitter);
      await wait(Math.max(0, Math.round(randomized)));
    }
  }
  throw new Error('Retry attempts exhausted');
}