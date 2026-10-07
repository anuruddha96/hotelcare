import {
  shouldHealSlntCheckoutRtc,
} from "./slntRtcInvariant.ts";

Deno.test("heals a dirty SLNT assignment after explicit same-day Previo checkout", () => {
  const ok = shouldHealSlntCheckoutRtc({
    status: "dirty",
    checkout_time: "2026-10-07T13:58:54.000Z",
    pms_metadata: {
      checkedOutToday: true,
      readyToClean: true,
      checkedOutAt: "2026-10-07T13:58:54.000Z",
      previoRoomCleanStatusId: 1,
    },
  }, "2026-10-07");

  if (!ok) throw new Error("expected RTC invariant to heal the assignment");
});

Deno.test("does not release a room already clean in Previo", () => {
  const ok = shouldHealSlntCheckoutRtc({
    status: "clean",
    checkout_time: "2026-10-07T13:58:54.000Z",
    pms_metadata: {
      checkedOutToday: true,
      readyToClean: true,
      checkedOutAt: "2026-10-07T13:58:54.000Z",
      previoRoomCleanStatusId: 2,
    },
  }, "2026-10-07");

  if (ok) throw new Error("clean room must not show RTC");
});

Deno.test("does not release stale previous-day checkout state", () => {
  const ok = shouldHealSlntCheckoutRtc({
    status: "dirty",
    checkout_time: "2026-10-06T13:58:54.000Z",
    pms_metadata: {
      checkedOutToday: true,
      readyToClean: true,
      checkedOutAt: "2026-10-06T13:58:54.000Z",
      previoRoomCleanStatusId: 1,
    },
  }, "2026-10-07");

  if (ok) throw new Error("stale checkout metadata must not release today's room");
});

Deno.test("does not infer RTC from scheduled departure alone", () => {
  const ok = shouldHealSlntCheckoutRtc({
    status: "dirty",
    pms_metadata: {
      scheduledDepartureToday: true,
      checkedOutToday: false,
      readyToClean: false,
      previoRoomCleanStatusId: 1,
    },
  }, "2026-10-07");

  if (ok) throw new Error("scheduled departure is not physical checkout evidence");
});
