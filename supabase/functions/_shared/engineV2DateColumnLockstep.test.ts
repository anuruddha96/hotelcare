import {
  effectiveDateColumnBounds,
  hotelDateSafetyBounds,
} from "./engineV2DateColumnLockstep.ts";

const assertEquals = (actual: unknown, expected: unknown, message?: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test("lockstep uses the shared hotel boundary instead of child bounds", () => {
  assertEquals(
    effectiveDateColumnBounds({
      lockstep: true,
      cellMin: 120,
      cellMax: 300,
      globalMin: 80,
      globalMax: 500,
    }),
    { min: 80, max: 500, source: "hotel_safety_lockstep" },
  );
});

Deno.test("Ottofiori arrival day retains the exceptional EUR75 floor", () => {
  assertEquals(
    hotelDateSafetyBounds({
      hotelId: "ottofiori",
      daysOut: 0,
      hotelMin: 75,
      hotelMax: 500,
      ruleMinimumAdr: 80,
    }),
    { min: 75, max: 500, source: "hotel_safety_lockstep" },
  );
});

Deno.test("Ottofiori future child cells retain the saved EUR80 floor", () => {
  assertEquals(
    hotelDateSafetyBounds({
      hotelId: "ottofiori",
      daysOut: 93,
      hotelMin: 75,
      hotelMax: 500,
      ruleMinimumAdr: 80,
    }),
    { min: 80, max: 500, source: "hotel_safety_lockstep" },
  );
});

Deno.test("a stricter saved Ottofiori floor wins for future dates", () => {
  assertEquals(
    hotelDateSafetyBounds({
      hotelId: "ottofiori",
      daysOut: 1,
      hotelMin: 75,
      hotelMax: 85,
      ruleMinimumAdr: 90,
    }),
    { min: 90, max: 90, source: "hotel_safety_lockstep" },
  );
});
