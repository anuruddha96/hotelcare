import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDisplayedWelcomeQuote, displayedWelcomeQuote, rememberDisplayedWelcomeQuote, subscribeDisplayedWelcomeQuote } from "./welcomeQuoteDisplay";

const quote = { quote_key: "test", quote_text: "A sample thought", author: "Example" };
afterEach(clearDisplayedWelcomeQuote);
describe("welcome quote header handoff", () => {
  it("retains the exact displayed quote for the same user only", () => {
    rememberDisplayedWelcomeQuote("a", quote);
    expect(displayedWelcomeQuote("a")).toBe(quote);
    expect(displayedWelcomeQuote("b")).toBeNull();
    expect(displayedWelcomeQuote(null)).toBeNull();
    clearDisplayedWelcomeQuote();
    expect(displayedWelcomeQuote("a")).toBeNull();
  });
  it("notifies mounted headers only on a new quote or reset", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayedWelcomeQuote(listener);
    rememberDisplayedWelcomeQuote("a", quote);
    rememberDisplayedWelcomeQuote("a", quote);
    expect(listener).toHaveBeenCalledTimes(1);
    clearDisplayedWelcomeQuote();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    rememberDisplayedWelcomeQuote("a", quote);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
