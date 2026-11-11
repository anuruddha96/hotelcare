import { describe, it, expect } from "vitest";
import { buildCuratedReply, CURATED_REPLY_BASE_COUNT, requiresCarefulReview, replyTopic } from "../../supabase/functions/_shared/reputation-replies";

const make = (id: string, rating = 5, comment = "") =>
  buildCuratedReply({
    reviewId: id, rating, comment, venueName: "Memories Brunch & Café",
    reviewerName: "Anna Kovács", languageMode: "match_guest",
    venueContext: "Verified facts: barista-made coffee; Budapest city-centre location.",
  });

describe("HotelCare curated Google review reply pool", () => {
  it("contains at least 100 editorial topic/rating variants", () => {
    expect(CURATED_REPLY_BASE_COUNT).toBeGreaterThanOrEqual(100);
  });

  it("varies wording for consecutive five-star rating-only reviews", () => {
    const replies = Array.from({ length: 100 }, (_, i) => make("review-" + i)?.text);
    expect(new Set(replies).size).toBeGreaterThan(12);
    expect(replies.every((s) => !!s && s.includes("Anna"))).toBe(true);
  });

  it("does not invent barista coffee, city centre, no waiting or an event from a rating alone", () => {
    const text = make("rating-only", 5, "")?.text || "";
    expect(text).not.toMatch(/coffee|barista|city.cent|no wait|conference/i);
  });

  it("only references a coffee product when the review actually does", () => {
    const coffee = make("positive-coffee", 5, "The cappuccino and coffee were delicious!")?.text || "";
    expect(coffee).toMatch(/coffee/i);
    const service = make("staff-rating", 5, "Lovely staff, very kind and helpful.")?.text || "";
    expect(service).toMatch(/team|staff|colleagues|people/i);
    expect(service).not.toMatch(/coffee|barista/i);
  });

  it("routes mixed or potentially negative four- and five-star comments to manual judgment", () => {
    expect(requiresCarefulReview("Very nice, but our food was cold.")).toBe(true);
    expect(make("mixed", 4, "Friendly, but the coffee was cold.")).toBeNull();
    expect(make("negative", 3, "Bad experience")).toBeNull();
  });

  it("provides Hungarian responses when explicitly configured", () => {
    const reply = buildCuratedReply({ reviewId: "hungarian-1", rating: 5,
      venueName: "Hotel Memories Budapest", languageMode: "hungarian", reviewerName: "Gábor" });
    expect(reply?.language).toBe("hu");
    expect(reply?.text).toMatch(/Köszönjük|Hálásak/);
    expect(reply?.text).toContain("Gábor");
  });

  it("uses the hotel brand, not an appended conference listing title", () => {
    const reply = buildCuratedReply({
      reviewId: "memories-hotel-review", rating: 5, comment: "Great location!",
      reviewerName: "Marta", venueName: "Hotel Memories Budapest",
      venueCategory: "hotel", venueContext: "Budapest city center",
    });
    expect(reply?.text).not.toMatch(/Rumbach|Conference/i);
    expect(reply?.topic).toBe("location");
  });

  it("detects essential review topics for relevant rather than generic replies", () => {
    expect(replyTopic("The breakfast buffet was a real highlight!")).toBe("breakfast");
    expect(replyTopic("Friendly staff helped us")).toBe("staff");
    expect(replyTopic("Very clean and tidy")).toBe("cleanliness");
  });
});
