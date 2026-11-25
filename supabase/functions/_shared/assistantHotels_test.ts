import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ownHotel, pickHotels } from "./assistantHotels.ts";

const HOTELS = [
  { hotel_id: "gozsdu-court", hotel_name: "Gozsdu Court Budapest" },
  { hotel_id: "memories-budapest", hotel_name: "Hotel Memories Budapest" },
];

Deno.test("a profile holding the hotel id or the hotel name resolves to both", () => {
  assertEquals(ownHotel(HOTELS, "memories-budapest"), [HOTELS[1]]);
  assertEquals(ownHotel(HOTELS, "Hotel Memories Budapest"), [HOTELS[1]]);
  assertEquals(ownHotel(HOTELS, " hotel memories budapest "), [HOTELS[1]]);
});

Deno.test("an unknown or missing hotel is not widened to other hotels", () => {
  assertEquals(ownHotel(HOTELS, "somewhere-else"), null);
  assertEquals(ownHotel(HOTELS, null), null);
});

Deno.test("a tool's hotel argument stays inside the authorized set", () => {
  assertEquals(pickHotels([HOTELS[1]], "memories-budapest").ok, true);
  assertEquals(pickHotels([HOTELS[1]], "gozsdu-court").ok, false);
});
