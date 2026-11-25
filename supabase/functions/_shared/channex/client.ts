/**
 * Thin Channex API client. Server-side only: the API key is read from an
 * edge-function secret and never returned to a browser or written to a log.
 *
 *   staging:    HOTELCARE_CHANNEX_API (current project secret) or CHANNEX_STAGING_API_KEY
 *               -> https://staging.channex.io/api/v1
 *   production: CHANNEX_PRODUCTION_API_KEY -> https://app.channex.io/api/v1
 * A staging key is never used against production and vice versa.
 *
 * Responses: {"data": ...} (+ "meta" on lists). Errors: {"errors": {code, title, details?}}.
 */
export type ChannexEnvironment = "staging" | "production";

export const CHANNEX_BASE_URL: Record<ChannexEnvironment, string> = {
  staging: "https://staging.channex.io/api/v1",
  production: "https://app.channex.io/api/v1",
};

/** Accepted secret names per environment, first match wins. */
export const CHANNEX_KEY_SECRETS: Record<ChannexEnvironment, string[]> = {
  staging: ["HOTELCARE_CHANNEX_API", "CHANNEX_STAGING_API_KEY"],
  production: ["CHANNEX_PRODUCTION_API_KEY"],
};

export function readChannexKey(env: ChannexEnvironment, getEnv: (k: string) => string | undefined): string | null {
  for (const name of CHANNEX_KEY_SECRETS[env]) {
    const value = getEnv(name)?.trim();
    if (value) return value;
  }
  return null;
}

export class ChannexError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "ChannexError";
  }
  /** 429 / 5xx / network: safe to retry later. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export type ChannexResponse<T> = { data: T; meta?: Record<string, unknown> };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function channexKeyConfigured(env: ChannexEnvironment, getEnv: (k: string) => string | undefined): boolean {
  return readChannexKey(env, getEnv) !== null;
}

export class ChannexClient {
  private readonly base: string;
  constructor(
    readonly environment: ChannexEnvironment,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly maxRetries = 2,
  ) {
    if (!apiKey) throw new Error(`Channex ${environment} API key is not configured`);
    this.base = CHANNEX_BASE_URL[environment];
  }

  static fromEnv(env: ChannexEnvironment, getEnv: (k: string) => string | undefined): ChannexClient {
    const key = readChannexKey(env, getEnv);
    if (!key) throw new ChannexError(`Channex ${env} API key is not configured`, 0, "missing_key", null);
    return new ChannexClient(env, key);
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<ChannexResponse<T>> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.base + path, {
          method,
          headers: { "user-api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        const error = new ChannexError(`Channex unreachable: ${err instanceof Error ? err.message : "network error"}`, 0, "network", null);
        if (attempt++ < this.maxRetries) { await sleep(backoffMs(attempt)); continue; }
        throw error;
      }
      const text = await res.text();
      let parsed: any = null;
      if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
      if (res.ok) return { data: parsed?.data as T, meta: parsed?.meta };

      const err = parsed?.errors ?? {};
      const error = new ChannexError(
        `Channex ${res.status}: ${String(err.title ?? err.code ?? res.statusText ?? "error")}`,
        res.status,
        err.code ? String(err.code) : null,
        err.details ?? null,
      );
      if (error.retryable && attempt++ < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  get<T = unknown>(path: string) { return this.request<T>("GET", path); }
  post<T = unknown>(path: string, body: unknown = {}) { return this.request<T>("POST", path, body); }
  put<T = unknown>(path: string, body: unknown) { return this.request<T>("PUT", path, body); }

  // --- convenience wrappers (shapes: docs.channex.io + references/api.md) ---
  /** Health probe: one property, no details returned to callers. */
  probe() { return this.get<any[]>("/properties?pagination[page]=1&pagination[limit]=1"); }
  getProperty(id: string) { return this.get<any>(`/properties/${encodeURIComponent(id)}`); }
  createProperty(attrs: Record<string, unknown>) { return this.post<any>("/properties", { property: attrs }); }

  listRoomTypes(propertyId: string) {
    return this.get<any[]>(`/room_types?filter[property_id]=${encodeURIComponent(propertyId)}&pagination[limit]=100`);
  }
  createRoomType(attrs: Record<string, unknown>) { return this.post<any>("/room_types", { room_type: attrs }); }
  updateRoomType(id: string, attrs: Record<string, unknown>) {
    return this.put<any>(`/room_types/${encodeURIComponent(id)}`, { room_type: attrs });
  }
  listRatePlans(propertyId: string) {
    return this.get<any[]>(`/rate_plans?filter[property_id]=${encodeURIComponent(propertyId)}&pagination[limit]=100`);
  }
  createRatePlan(attrs: Record<string, unknown>) { return this.post<any>("/rate_plans", { rate_plan: attrs }); }

  createWebhook(attrs: Record<string, unknown>) { return this.post<any>("/webhooks", { webhook: attrs }); }
  updateWebhook(id: string, attrs: Record<string, unknown>) {
    return this.put<any>(`/webhooks/${encodeURIComponent(id)}`, { webhook: attrs });
  }

  readAvailability(propertyId: string, from: string, to: string) {
    return this.get<Record<string, Record<string, number>>>(
      `/availability?filter[property_id]=${encodeURIComponent(propertyId)}&filter[date][gte]=${from}&filter[date][lte]=${to}`,
    );
  }
  readRestrictions(propertyId: string, from: string, to: string, fields = "rate,min_stay_arrival,stop_sell,closed_to_arrival,closed_to_departure") {
    return this.get<Record<string, Record<string, Record<string, unknown>>>>(
      `/restrictions?filter[property_id]=${encodeURIComponent(propertyId)}&filter[date][gte]=${from}&filter[date][lte]=${to}&filter[restrictions]=${fields}`,
    );
  }
  /** Outage recovery: revisions created since a point in time for ONE property (manual, time-scoped). */
  listRevisionsSince(propertyId: string, sinceIso: string, page = 1) {
    return this.get<any[]>(
      `/booking_revisions?filter[property_id]=${encodeURIComponent(propertyId)}&filter[inserted_at][gte]=${encodeURIComponent(sinceIso)}&pagination[page]=${page}&pagination[limit]=100&order[inserted_at]=asc`,
    );
  }
  bookingFeed(propertyId: string) {
    return this.get<any[]>(`/booking_revisions/feed?filter[property_id]=${encodeURIComponent(propertyId)}`);
  }
  getRevision(id: string) { return this.get<any>(`/booking_revisions/${encodeURIComponent(id)}`); }
  ackRevision(id: string) { return this.post(`/booking_revisions/${encodeURIComponent(id)}/ack`, {}); }
  pushAvailability(values: unknown[]) { return this.post<any>("/availability", { values }); }
  pushRestrictions(values: unknown[]) { return this.post<any>("/restrictions", { values }); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number) => Math.min(500 * 2 ** attempt, 4000);

/** Collect task ids and per-item warnings from an ARI response (200 = accepted, not proven). */
export function summarizeAriResponse(res: ChannexResponse<unknown>): { taskIds: string[]; warnings: unknown[] } {
  const taskIds: string[] = [];
  const data = res.data as any;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  for (const item of list) if (item && typeof item.id === "string") taskIds.push(item.id);
  const warnings = Array.isArray((res.meta as any)?.warnings) ? (res.meta as any).warnings : [];
  return { taskIds, warnings };
}
