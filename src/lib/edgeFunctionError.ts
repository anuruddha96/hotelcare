/**
 * Read the JSON error returned by a Supabase Edge Function.
 * FunctionsHttpError.message normally says only "non-2xx status code".
 */
export async function edgeFunctionError(error: unknown, fallback: string): Promise<string> {
  const candidate = error as { message?: string; context?: Response } | null;
  const response = candidate?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
      if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
    } catch {
      // The response may be non-JSON (gateway error).
    }
  }
  return candidate?.message || fallback;
}
