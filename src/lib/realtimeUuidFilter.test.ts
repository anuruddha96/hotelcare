import { describe, expect, it } from "vitest";
import { isValidRealtimeUuid } from "./realtimeUuidFilter";

describe("Realtime UUID guard", () => {
  it("rejects missing and malformed IDs before subscription", () => {
    for (const value of [null, undefined, "", "null", "undefined", "ottofiori", "not-a-uuid"]) {
      expect(isValidRealtimeUuid(value)).toBe(false);
    }
  });
  it("allows real UUIDs", () => {
    expect(isValidRealtimeUuid("e4005ade-f2a0-47bd-a190-33193de9773f")).toBe(true);
  });
});
