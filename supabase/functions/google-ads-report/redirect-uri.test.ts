import { googleAdsRedirectUri } from "./redirect-uri.ts";

Deno.test("returns to the authenticated HotelCare tenant route", () => {
  for (const slug of ["rdhotels", "channex", "hotelcare", "test-tenant"]) {
    if (googleAdsRedirectUri(slug) !== "https://my.hotelcare.app/" + slug + "/google-ads") throw new Error("WRONG_CALLBACK");
  }
});
Deno.test("rejects malformed or attacker-controlled redirect paths", () => {
  for (const slug of ["", "../rdhotels", "rdhotels/other", "rdhotels?x=1", "rdhotels#x", "https://example.com", "//example.com", "%2f", "RDHOTELS", "-rdhotels"]) {
    if (googleAdsRedirectUri(slug) !== null) throw new Error("UNSAFE_CALLBACK");
  }
});
