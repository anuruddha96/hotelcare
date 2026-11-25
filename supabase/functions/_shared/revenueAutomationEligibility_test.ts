import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canRunLiveMinimumStay, isRevenueAutomationLive } from "./revenueAutomationEligibility.ts";

const ottofioriLive = {
  is_enabled: true,
  auto_publish: true,
  engine_version: 2,
  mode: "live",
  min_stay_automation_enabled: true,
  min_stay_automation_live: true,
};

Deno.test("Ottofiori-style live Engine V2 configuration is eligible", () => {
  assertEquals(isRevenueAutomationLive(ottofioriLive), true);
  assertEquals(canRunLiveMinimumStay(ottofioriLive), true);
});

Deno.test("pre-provisioned hotel stays non-publishing while master switch is off", () => {
  const preparedButOff = { ...ottofioriLive, is_enabled: false };
  assertEquals(isRevenueAutomationLive(preparedButOff), false);
  assertEquals(canRunLiveMinimumStay(preparedButOff), false);
});

Deno.test("minimum-stay writer needs both the master live state and its own live gate", () => {
  assertEquals(canRunLiveMinimumStay({ ...ottofioriLive, min_stay_automation_live: false }), false);
  assertEquals(canRunLiveMinimumStay({ ...ottofioriLive, min_stay_automation_enabled: false }), false);
  assertEquals(canRunLiveMinimumStay({ ...ottofioriLive, auto_publish: false }), false);
  assertEquals(canRunLiveMinimumStay({ ...ottofioriLive, mode: "shadow" }), false);
  assertEquals(canRunLiveMinimumStay({ ...ottofioriLive, engine_version: 1 }), false);
});
