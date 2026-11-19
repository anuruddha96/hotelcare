import { describe, expect, it } from "vitest";
import { usageBlocked, usageNotice, type AssistantUsage } from "./usage";
import { answerLooksUnresolved } from "./answerSignals";

const base: AssistantUsage = {
  allowed: true, tier: "standard", plan: "Standard", used: 10, usedToday: 3,
  limit: 300, dailyLimit: 60, remaining: 290, unlimited: false,
};

describe("Mira usage in the composer", () => {
  it("never blocks or nags an unlimited manager, even after hundreds of messages", () => {
    const manager = { ...base, tier: "leadership" as const, plan: "Unlimited", used: 900, usedToday: 40, limit: null, remaining: null, unlimited: true, dailyLimit: 300 };
    expect(usageBlocked(manager)).toBe(false);
    expect(usageNotice(manager)).toBeNull();
  });

  it("stays quiet until a standard plan is close to its limit", () => {
    expect(usageNotice(base)).toBeNull();
    expect(usageNotice({ ...base, used: 285, remaining: 15 })).toBe("15 of 300 monthly messages left.");
  });

  it("pauses sending at the monthly or the daily limit, and says why", () => {
    expect(usageBlocked({ ...base, used: 300, remaining: 0 })).toBe(true);
    expect(usageNotice({ ...base, used: 300, remaining: 0 })).toMatch(/resets on the 1st/);
    expect(usageBlocked({ ...base, usedToday: 60 })).toBe(true);
    expect(usageNotice({ ...base, usedToday: 60 })).toMatch(/Daily limit of 60/);
  });

  it("does not block when the status could not be loaded", () => {
    expect(usageBlocked(null)).toBe(false);
  });
});

describe("answers that offer a report", () => {
  it("recognises when Mira could not do something", () => {
    expect(answerLooksUnresolved("I couldn't verify the latest Hotel Care data just now.")).toBe(true);
    expect(answerLooksUnresolved("I can’t access revenue information with your current role.")).toBe(true);
    expect(answerLooksUnresolved("Nem sikerült lekérni az adatokat.")).toBe(true);
  });

  it("leaves normal answers alone", () => {
    expect(answerLooksUnresolved("Room 038 was cleaned by Sofia and approved by Bea at 10:58.")).toBe(false);
  });
});
