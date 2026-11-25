/**
 * Read-only NAV Online Számla v3.0 client.
 *
 * - Runs only on the server (Edge Functions); credentials never reach browsers.
 * - Every attempt gets a fresh requestId/timestamp/signature.
 * - Honors NAV traffic restriction (spec 1.6.11: 1 query/second/IP for
 *   /queryInvoiceData and /queryTaxpayer) with per-operation pacing.
 * - Retries transient failures with bounded exponential backoff; auth and
 *   configuration errors fail fast so the connection can be marked unhealthy.
 * - fetch/sleep/now are injectable so the client is fully testable offline.
 */
import {
  buildQueryInvoiceChainDigest, buildQueryInvoiceData, buildQueryInvoiceDigest, buildQueryTaxpayer,
  NAV_BASE_URLS, type BuiltRequest, type DataQuery, type DigestQuery, type NavAuth, type NavEnvironment,
  type NavReadOperation, type NavSoftware,
} from "./navRequest.ts";
import {
  decodeInvoiceData, NavApiError, parseInvoiceChainDigestResponse, parseInvoiceDataResponse, parseInvoiceDataXml,
  parseInvoiceDigestResponse, parseTaxpayerResponse, type DigestPage, type NavInvoiceDetail, type TaxpayerResult,
} from "./navResponse.ts";

export interface NavClientEvent {
  operation: NavReadOperation;
  attempt: number;
  outcome: "ok" | "retry" | "error";
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
}

export interface NavClientOptions {
  environment: NavEnvironment;
  auth: NavAuth;
  software: NavSoftware;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxAttempts?: number;
  timeoutMs?: number;
  onEvent?: (event: NavClientEvent) => void;
}

const MIN_INTERVAL_MS: Record<NavReadOperation, number> = {
  queryInvoiceData: 1100,
  queryTaxpayer: 1100,
  queryInvoiceDigest: 350,
  queryInvoiceChainDigest: 350,
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function timeoutSignal(ms: number): AbortSignal | undefined {
  const factory = (globalThis.AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal } | undefined)?.timeout;
  return typeof factory === "function" ? factory.call(globalThis.AbortSignal, ms) : undefined;
}

export class NavClient {
  private readonly opts: Required<Omit<NavClientOptions, "onEvent">> & { onEvent?: (e: NavClientEvent) => void };
  private readonly lastCallAt = new Map<NavReadOperation, number>();

  constructor(options: NavClientOptions) {
    if (!NAV_BASE_URLS[options.environment]) throw new Error("Unknown NAV environment");
    this.opts = {
      fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
      sleep: options.sleep ?? defaultSleep,
      now: options.now ?? (() => new Date()),
      maxAttempts: Math.max(1, Math.min(5, options.maxAttempts ?? 3)),
      timeoutMs: options.timeoutMs ?? 30_000,
      environment: options.environment,
      auth: options.auth,
      software: options.software,
      onEvent: options.onEvent,
    };
  }

  get baseUrl(): string {
    return NAV_BASE_URLS[this.opts.environment];
  }

  private async pace(operation: NavReadOperation): Promise<void> {
    const last = this.lastCallAt.get(operation);
    const minGap = MIN_INTERVAL_MS[operation];
    if (last != null) {
      const elapsed = this.opts.now().getTime() - last;
      if (elapsed < minGap) await this.opts.sleep(minGap - elapsed);
    }
    this.lastCallAt.set(operation, this.opts.now().getTime());
  }

  private async call<T>(
    operation: NavReadOperation,
    build: () => Promise<BuiltRequest>,
    parse: (xml: string, httpStatus: number) => T,
  ): Promise<T> {
    let lastError: NavApiError | null = null;
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      await this.pace(operation);
      const started = this.opts.now().getTime();
      const request = await build();
      const init: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/xml", Accept: "application/xml" },
        body: request.xml,
        signal: timeoutSignal(this.opts.timeoutMs),
      };
      let httpStatus: number | null = null;
      try {
        let response: Response;
        try {
          response = await this.opts.fetchImpl(`${this.baseUrl}/${operation}`, init);
        } catch (cause) {
          const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
          throw new NavApiError(timedOut ? "NAV request timed out" : "NAV could not be reached", timedOut ? "TIMEOUT" : "NETWORK_ERROR", null);
        }
        httpStatus = response.status;
        const text = await response.text();
        const parsed = parse(text, response.status);
        this.opts.onEvent?.({ operation, attempt, outcome: "ok", httpStatus, errorCode: null, durationMs: this.opts.now().getTime() - started });
        return parsed;
      } catch (cause) {
        const error = cause instanceof NavApiError ? cause : new NavApiError(cause instanceof Error ? cause.message : "NAV request failed", null, httpStatus);
        lastError = error;
        const willRetry = error.retryable && attempt < this.opts.maxAttempts && !(error.category === "maintenance" && attempt >= 2);
        this.opts.onEvent?.({
          operation, attempt, outcome: willRetry ? "retry" : "error", httpStatus: error.httpStatus,
          errorCode: error.code, durationMs: this.opts.now().getTime() - started,
        });
        if (!willRetry) throw error;
        const backoff = Math.min(8_000, 1_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        await this.opts.sleep(backoff);
      }
    }
    throw lastError ?? new NavApiError("NAV request failed", null, null);
  }

  queryInvoiceDigest(query: DigestQuery): Promise<DigestPage> {
    return this.call("queryInvoiceDigest",
      () => buildQueryInvoiceDigest(this.opts.auth, this.opts.software, query, this.opts.now()),
      parseInvoiceDigestResponse);
  }

  /** All pages of an INBOUND digest query (NAV pages hold max 100 items). */
  async queryInvoiceDigestAll(query: Omit<DigestQuery, "page">, maxPages = 200): Promise<{ digests: DigestPage["digests"]; pages: number }> {
    const digests: DigestPage["digests"] = [];
    let page = 1;
    let available = 1;
    while (page <= available && page <= maxPages) {
      const result = await this.queryInvoiceDigest({ ...query, page });
      digests.push(...result.digests);
      available = result.availablePage;
      page++;
    }
    if (available > maxPages) throw new NavApiError(`NAV returned more than ${maxPages} pages; narrow the window`, "TOO_MANY_PAGES", 200);
    return { digests, pages: Math.min(available, maxPages) };
  }

  /** Full invoice detail, or null when NAV has no single valid instance. */
  async queryInvoiceData(query: DataQuery): Promise<{ detail: NavInvoiceDetail; audit: NonNullable<ReturnType<typeof parseInvoiceDataResponse>>["audit"] } | null> {
    const result = await this.call("queryInvoiceData",
      () => buildQueryInvoiceData(this.opts.auth, this.opts.software, query, this.opts.now()),
      parseInvoiceDataResponse);
    if (!result) return null;
    const xml = await decodeInvoiceData(result.invoiceDataBase64, result.compressed);
    return { detail: parseInvoiceDataXml(xml, query.batchIndex ?? null), audit: result.audit };
  }

  queryTaxpayer(taxNumber: string): Promise<TaxpayerResult> {
    return this.call("queryTaxpayer",
      () => buildQueryTaxpayer(this.opts.auth, this.opts.software, taxNumber, this.opts.now()),
      parseTaxpayerResponse);
  }

  queryInvoiceChainDigest(query: { invoiceNumber: string; supplierTaxNumber: string; page: number }) {
    return this.call("queryInvoiceChainDigest",
      () => buildQueryInvoiceChainDigest(this.opts.auth, this.opts.software, query, this.opts.now()),
      parseInvoiceChainDigestResponse);
  }
}
