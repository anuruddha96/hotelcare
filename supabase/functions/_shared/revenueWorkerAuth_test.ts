import { authorizeRevenueWorkerRequest, authorizeRevenueWorkerWithVault } from "./revenueWorkerAuth.ts";

const SERVICE_KEY = "test-only-internal-service-secret";
const request = (headers: HeadersInit = {}) =>
  new Request("https://example.invalid/functions/v1/revenue-publish-queue", {
    method: "POST",
    headers,
  });

function expectValue<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

Deno.test("revenue workers accept the existing internal engine handoff credential", () => {
  expectValue(authorizeRevenueWorkerRequest(request({ "x-engine-key": SERVICE_KEY }), SERVICE_KEY), "engine-key");
});

Deno.test("revenue workers accept existing service-role cron bearer credentials", () => {
  expectValue(authorizeRevenueWorkerRequest(request({ Authorization: `Bearer ${SERVICE_KEY}` }), SERVICE_KEY), "service-bearer");
  expectValue(authorizeRevenueWorkerRequest(request({ authorization: `bearer ${SERVICE_KEY}` }), SERVICE_KEY), "service-bearer");
});

Deno.test("revenue workers accept service-role apikey but reject an anon key", () => {
  expectValue(authorizeRevenueWorkerRequest(request({ apikey: SERVICE_KEY }), SERVICE_KEY), "service-apikey");
  expectValue(authorizeRevenueWorkerRequest(request({ apikey: "anon-publishable-key" }), SERVICE_KEY), null);
});

Deno.test("revenue workers refuse anonymous, malformed and browser credentials", () => {
  expectValue(authorizeRevenueWorkerRequest(request(), SERVICE_KEY), null);
  expectValue(authorizeRevenueWorkerRequest(request({ Authorization: "Bearer user-jwt" }), SERVICE_KEY), null);
  expectValue(authorizeRevenueWorkerRequest(request({ Authorization: `Basic ${SERVICE_KEY}` }), SERVICE_KEY), null);
  expectValue(authorizeRevenueWorkerRequest(request({ Authorization: `Bearer ${SERVICE_KEY} extra` }), SERVICE_KEY), null);
  expectValue(authorizeRevenueWorkerRequest(request({ "x-engine-key": "wrong" }), SERVICE_KEY), null);
  expectValue(authorizeRevenueWorkerRequest(request({ "x-forwarded-for": SERVICE_KEY }), SERVICE_KEY), null);
});

Deno.test("revenue workers refuse missing, empty and mismatched server secrets", () => {
  const req = request({ "x-engine-key": SERVICE_KEY });
  expectValue(authorizeRevenueWorkerRequest(req, undefined), null);
  expectValue(authorizeRevenueWorkerRequest(req, ""), null);
  expectValue(authorizeRevenueWorkerRequest(req, "a-different-server-key"), null);
  expectValue(authorizeRevenueWorkerRequest(request({ "x-engine-key": " " }), " "), null);
});

Deno.test("revenue workers refuse forged scheduler flags without worker credentials", () => {
  const req = new Request("https://example.invalid/functions/v1/revenue-engine-tick", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: "anon-publishable-key" },
    body: JSON.stringify({ scheduled: true, trigger: "cron", hotel_id: "a-hotel" }),
  });
  expectValue(authorizeRevenueWorkerRequest(req, SERVICE_KEY), null);
});

const CRON_TOKEN = "a".repeat(64);

Deno.test("Vault authenticated cron jobs work with the existing public gateway apikey", async () => {
  let calls = 0;
  const caller = await authorizeRevenueWorkerWithVault(
    request({ apikey: "public-anon-key", "x-hotelcare-worker": CRON_TOKEN }),
    SERVICE_KEY, async token => { calls++; return token === CRON_TOKEN; },
  );
  expectValue(caller, "vault-cron");
  expectValue(calls, 1);
});

Deno.test("public anon key and forged cron bodies cannot bypass Vault verification", async () => {
  let calls = 0;
  const denied = await authorizeRevenueWorkerWithVault(
    new Request("https://example.invalid", {
      method: "POST", headers: { apikey: "public-anon-key" },
      body: JSON.stringify({ scheduled: true, trigger: "cron" }),
    }),
    SERVICE_KEY, async () => { calls++; return true; },
  );
  expectValue(denied, null);
  expectValue(calls, 0);
});

Deno.test("invalid, missing and rejected Vault credentials always fail closed", async () => {
  const verify = async (candidate: string) => candidate === CRON_TOKEN;
  for (const token of ["", "b".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(65), "not-a-secret"]) {
    const req = request({ apikey: "public-anon-key", "x-hotelcare-worker": token });
    expectValue(await authorizeRevenueWorkerWithVault(req, SERVICE_KEY, verify), null);
  }
  expectValue(await authorizeRevenueWorkerWithVault(
    request({ "x-hotelcare-worker": CRON_TOKEN }), null, verify,
  ), null);
});

Deno.test("database verification failures never authorize a cron caller", async () => {
  const denied = await authorizeRevenueWorkerWithVault(
    request({ "x-hotelcare-worker": CRON_TOKEN }),
    SERVICE_KEY, async () => { throw new Error("database offline"); },
  );
  expectValue(denied, null);
});

Deno.test("service-role callers remain compatible without a Vault lookup", async () => {
  let calls = 0;
  const result = await authorizeRevenueWorkerWithVault(
    request({ "x-engine-key": SERVICE_KEY }), SERVICE_KEY,
    async () => { calls++; return false; },
  );
  expectValue(result, "engine-key");
  expectValue(calls, 0);
});
