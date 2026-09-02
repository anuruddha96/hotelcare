import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  mapPrevioStatus,
  parsePrevioReservations,
} from "./previoReservations.ts";

const SAMPLE = `<?xml version="1.0"?>
<response>
  <reservations>
    <reservation>
      <resId>123456</resId>
      <statusId>3</statusId>
      <created>2026-08-30 14:22:10</created>
      <term><from>2026-09-04</from><to>2026-09-07</to></term>
      <price>450.00</price>
      <currency><currId>2</currId><code>EUR</code></currency>
      <object><objId>782</objId><name>Double Deluxe 204</name></object>
      <objectKind><obkId>55</obkId><name>Double</name></objectKind>
      <guest><name>Anna</name><surname>Kovacs</surname><email>anna@example.com</email></guest>
      <guest><name>Peter</name><surname>Kovacs</surname></guest>
      <note>Late arrival after 22:00</note>
      <sourceName>Booking.com</sourceName>
    </reservation>
    <reservation>
      <resId>777001</resId>
      <statusId>7</statusId>
      <created>2026-08-01 10:00:00</created>
      <dateCanc>2026-08-20 09:30:00</dateCanc>
      <term><from>2026-09-10</from><to>2026-09-12</to></term>
      <price>62000</price>
      <currency>9 HUF</currency>
      <object><objId>790</objId><name>Single 101</name></object>
    </reservation>
    <reservation>
      <resId>888002</resId>
      <statusId>2</statusId>
      <term><from>2026-10-01</from><to>2026-10-03</to></term>
      <object><objId>801</objId><name>Twin 301</name></object>
    </reservation>
    <reservation>
      <resId>888002</resId>
      <statusId>2</statusId>
      <term><from>2026-10-01</from><to>2026-10-03</to></term>
      <object><objId>802</objId><name>Twin 302</name></object>
    </reservation>
  </reservations>
</response>`;

Deno.test("parses reservation core fields without inventing data", () => {
  const rows = parsePrevioReservations(SAMPLE);
  assertEquals(rows.length, 4);

  const first = rows[0];
  assertEquals(first.resId, "123456");
  assertEquals(first.sourceRef, "123456");
  assertEquals(first.arrivalDate, "2026-09-04");
  assertEquals(first.departureDate, "2026-09-07");
  assertEquals(first.nights, 3);
  assertEquals(first.objId, "782");
  assertEquals(first.obkId, "55");
  assertEquals(first.roomName, "Double Deluxe 204");
  assertEquals(first.guestsCount, 2);
  assertEquals(first.guestName, "Anna Kovacs");
  assertEquals(first.guestEmail, "anna@example.com");
  assertEquals(first.totalPrice, 450);
  assertEquals(first.currency, "EUR");
  assertEquals(first.channel, "Booking.com");
  assertEquals(first.note, "Late arrival after 22:00");
  assertEquals(first.cancelledAtIso, null);
});

Deno.test("maps cancelled status and nested HUF currency", () => {
  const rows = parsePrevioReservations(SAMPLE);
  const cancelled = rows[1];
  assertEquals(cancelled.statusId, 7);
  assertEquals(mapPrevioStatus(cancelled.statusId), "cancelled");
  assertEquals(cancelled.currency, "HUF");
  assertEquals(cancelled.guestName, null); // no guest block -> no invented name
  assertEquals(cancelled.guestsCount, 1);
  assertEquals(typeof cancelled.cancelledAtIso, "string");
});

Deno.test("multi-room bookings get distinct stable sourceRefs", () => {
  const rows = parsePrevioReservations(SAMPLE);
  const multi = rows.filter((r) => r.resId === "888002");
  assertEquals(multi.length, 2);
  assertEquals(multi[0].sourceRef, "888002:801");
  assertEquals(multi[1].sourceRef, "888002:802");
});

Deno.test("status mapping only maps proven ids", () => {
  assertEquals(mapPrevioStatus(7), "cancelled");
  assertEquals(mapPrevioStatus(8), "no_show");
  assertEquals(mapPrevioStatus(2), "confirmed");
  assertEquals(mapPrevioStatus(0), "confirmed");
});
