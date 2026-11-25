import { assertEquals } from "jsr:@std/assert@1";
import { ignoreRpcFailure, staleScanCutoffIso } from "./cleanup.ts";

Deno.test("stale scan cutoff keeps a grace period beyond the worker timeout", () => {
  assertEquals(
    staleScanCutoffIso(new Date("2026-11-19T16:34:00.000Z"), 15),
    "2026-11-19T16:19:00.000Z",
  );
});

Deno.test("best-effort RPC invokes the requested cleanup exactly once", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  await ignoreRpcFailure({
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { ok: true };
    },
  }, "release_competitor_scan_lease", { _id: "competitor-rate-scan" });

  assertEquals(calls, [{
    fn: "release_competitor_scan_lease",
    args: { _id: "competitor-rate-scan" },
  }]);
});

Deno.test("best-effort RPC swallows cleanup transport failures", async () => {
  let calls = 0;
  await ignoreRpcFailure({
    rpc: async () => {
      calls += 1;
      throw new Error("transport down");
    },
  }, "pause_competitor_scan", { _id: "competitor-rate-scan" });

  assertEquals(calls, 1);
});
