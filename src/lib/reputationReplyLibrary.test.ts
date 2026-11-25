import { describe, it, expect } from "vitest";
import {
  buildCuratedReply, classifyReview, CURATED_REPLY_BASE_COUNT, requiresCarefulReview, replyTopic, reviewTextForRiskCheck,
} from "../../supabase/functions/_shared/reputation-replies";

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

describe("automatic reply risk screen", () => {
  // Real five-star reviews that were held back for manual approval because the
  // Hungarian "de" (but) check matched "made ", "wide ", "recommande " or the
  // Spanish/French/Danish word "de".
  const positive = [
    "Sharma also made me happy with her delicious coffee and pleasant conversation. I recommend them for both breakfast and accommodation.",
    "The buffet was quality and had a wide variety; they replenished quite frequently. Highly recommended!!",
    "(Translated by Google) A super comfortable and cozy place in the heart of Budapest. The staff is incredibly friendly and polite! 100% recommended!\n\n(Original)\nUn lugar super cómodo y cálido en el centro de Budapest. Atención super amable el personal muy educado y calido!",
    "(Translated by Google) Incredible value for money, everything is great, highly recommended, impeccable service\n\n(Original)\nRapport qualité, prix incroyable, tout est très bien, on recommande service impeccable",
    "(Translated by Google) Very friendly and welcoming staff. Breakfast was quite ok and the coffee was good.\n\n(Original)\nMeget venligt og imødekommende personale. Morgenmaden var helt ok og kaffen fin.",
    "(Translated by Google) A variety of fruits, cold cuts, coffees, yogurts, pastries. Very nice.\n\n(Original)\nVariedad de frutas, charcutería, cafés, yogures, pastelitos, muy agradable",
    "Super.",
    "wonderful place! Victoria and all the staff are brilliant!!",
    "I highly recommend it, you won't be disappointed! No problems at all and late check-out was possible.",
    "Not only the food was great but also the staff.",
    "Nagyon finom volt minden, nem csalódtunk, ajánlom!",
  ];

  it.each(positive)("lets a clearly positive review through: %s", (comment) => {
    expect(requiresCarefulReview(comment)).toBe(false);
    expect(classifyReview(5, comment).risk).toBe("low");
  });

  const careful = [
    "Very nice, but our food was cold.",
    "(Translated by Google) It was very nice, but I was more impressed by the servers\n\n(Original)\nNagyon fini volt, de inkább a kiszolgálók",
    "(Translated by Google) The only thing that slightly disappointed us was the spa.\n\n(Original)\nx",
    "An average hotel, lacking basic amenities. There was no shampoo in the room.",
    "The food was disappointing.",
    "There were some issues with the room.",
    "Great location. Parking was expensive and absolutely ridiculous!",
    "We had to wait 40 minutes for a table.",
    "Everything was great except the bed.",
    "Sajnos a kávé hideg volt.",
    "Szép hely, de drága.",
  ];

  it.each(careful)("routes a mixed or negative review to managers: %s", (comment) => {
    expect(requiresCarefulReview(comment)).toBe(true);
    expect(classifyReview(5, comment).risk).not.toBe("low");
    expect(buildCuratedReply({ reviewId: "r", rating: 5, comment, venueName: "Venue" })).toBeNull();
  });

  it("screens Google's English translation in both layouts", () => {
    expect(reviewTextForRiskCheck("(Translated by Google) Lovely.\n\n(Original)\nPrecioso de verdad")).toBe("Lovely.");
    expect(reviewTextForRiskCheck("Nagyon jó, de drága\n\n(Translated by Google)\nVery good, but expensive"))
      .toBe("Very good, but expensive");
    expect(reviewTextForRiskCheck("Plain English review")).toBe("Plain English review");
  });

  it("keeps rating and high-risk rules", () => {
    expect(classifyReview(3, "Lovely place").risk).toBe("medium");
    expect(classifyReview(1, "Lovely place").risk).toBe("high");
    expect(classifyReview(5, "Great stay, but they refused a refund").risk).toBe("high");
    // Hungarian "legalább" (at least) is not the English word "legal".
    expect(classifyReview(5, "Legalább egyszer próbáld ki, nagyon jó!").risk).toBe("low");
  });
});
