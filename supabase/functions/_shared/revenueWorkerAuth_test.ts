import { authorizeRevenueWorkerRequest } from "./revenueWorkerAuth.ts";

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
