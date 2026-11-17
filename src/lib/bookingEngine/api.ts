// Client for the public booking-engine edge function. Guests are anonymous:
// no session, no app providers; only the project URL and publishable key.
const base = import.meta.env.VITE_SUPABASE_URL
  || (import.meta.env.VITE_SUPABASE_PROJECT_ID ? `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

export class BookingApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export async function bookingApi<T = Record<string, unknown>>(action: string, body: Record<string, unknown>): Promise<T> {
  if (!base) throw new BookingApiError('NOT_CONFIGURED', 0);
  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/booking-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ action, ...body }),
      cache: 'no-store',
    });
  } catch {
    throw new BookingApiError('NETWORK', 0);
  }
  let data: Record<string, unknown> | null = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data || data.ok === false) {
    throw new BookingApiError(String(data?.error ?? 'SERVER_ERROR'), res.status);
  }
  return data as T;
}
