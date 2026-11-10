import { describe, expect, it } from "vitest";
import { buildHousekeepingActivityEmail } from "../../supabase/functions/housekeeping-activity-watchdog/emailTemplate";

const person = {
  name: "Mary - Joy",
  assignmentCount: 5,
  cutoffAt: "2026-11-10T07:15:00Z", // 08:15 in Budapest on this date
};

describe("bilingual housekeeping activity email", () => {
  it("shows Hungarian first and English second for the same facts", () => {
    const email = buildHousekeepingActivityEmail({
      hotelName: "Gozsdu Court Budapest",
      workDate: "2026-11-10",
      timezone: "Europe/Budapest",
      people: [person],
    });

    expect(email.subject).toContain("Nincs rögzített aktivitás / No activity recorded");
    expect(email.html).toContain("Aktivitási értesítés");
    expect(email.html).toContain("Activity alert");
    expect(email.html).toContain("Mary - Joy");
    expect(email.html).toContain("5 kiosztott szoba");
    expect(email.html).toContain("5 rooms assigned");
    expect(email.html).toContain("08:15");
    expect(email.text).toContain("budapesti idő");
    expect(email.text).toContain("Budapest time");
    expect(email.html).toContain("Teendő:");
    expect(email.html).toContain("Next step:");
    expect(email.html).toContain("HotelCare megnyitása");
    expect(email.html).toContain("Open HotelCare");
    expect(email.text).toContain("Nem jelenti azt, hogy a munkatárs hiányzik");
    expect(email.text).toContain("does not confirm the person was absent");
  });

  it("includes individual cutoff times and total rooms for multiple housekeepers", () => {
    const email = buildHousekeepingActivityEmail({
      hotelName: "Hotel Mika",
      workDate: "2026-11-10",
      timezone: "Europe/Budapest",
      people: [
        person,
        { name: "Dora", assignmentCount: 3, cutoffAt: "2026-11-10T07:45:00Z" },
      ],
    });
    expect(email.html).toContain("2 munkatársnál");
    expect(email.html).toContain("2 housekeepers");
    expect(email.html).toContain("08:15");
    expect(email.html).toContain("08:45");
    expect(email.text).toContain("Assigned rooms: 8");
    expect(email.text).toContain("Cutoff: 08:45");
  });

  it("escapes untrusted names and property names in HTML", () => {
    const email = buildHousekeepingActivityEmail({
      hotelName: "Hotel <script>alert(1)</script>",
      workDate: "2026-11-10",
      timezone: "Europe/Budapest",
      people: [{ ...person, name: "<img src=x onerror=alert(1)>" }],
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&lt;img");
  });

  it("falls back safely for an invalid configured timezone", () => {
    expect(() => buildHousekeepingActivityEmail({
      hotelName: "Hotel",
      workDate: "2026-11-10",
      timezone: "Invalid/Timezone",
      people: [person],
    })).not.toThrow();
  });
});
