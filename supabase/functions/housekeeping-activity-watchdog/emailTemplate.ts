/**
 * Bilingual (Hungarian first, English second) housekeeping activity alert.
 * This module only renders e-mail content. Alert eligibility, recipients,
 * delivery and absence detection remain the watchdog worker's responsibility.
 */
export type ActivityEmailPerson = {
  name: string;
  assignmentCount: number;
  cutoffAt: string;
};

export type ActivityEmailInput = {
  hotelName: string;
  workDate: string;
  timezone: string;
  people: ActivityEmailPerson[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

function localTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function localDate(workDate: string, locale: string): string {
  const date = new Date(\`\${workDate}T12:00:00Z\`);
  if (Number.isNaN(date.getTime())) return oneLine(workDate);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** A single readable e-mail for both languages, also usable as plain text. */
export function buildHousekeepingActivityEmail(input: ActivityEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const hotelName = oneLine(input.hotelName);
  const timezone = safeTimezone(input.timezone || "Europe/Budapest");
  const zoneHu = timezone === "Europe/Budapest" ? "budapesti idő" : timezone;
  const zoneEn = timezone === "Europe/Budapest" ? "Budapest time" : timezone;
  const staffCount = input.people.length;
  const roomCount = input.people.reduce((total, person) => total + person.assignmentCount, 0);
  const cutoffTimes = input.people.map((person) => localTime(person.cutoffAt, timezone));
  const sameCutoff = cutoffTimes.every((time) => time === cutoffTimes[0]);
  const time = cutoffTimes[0] || "—";

  const subject = \`[HotelCare] Nincs rögzített aktivitás / No activity recorded · \${hotelName}\`;
  const titleHu = \`\${staffCount} munkatársnál nincs rögzített aktivitás\`;
  const titleEn = \`No activity recorded for \${staffCount} housekeeper\${staffCount === 1 ? "" : "s"}\`;
  const alertHu = sameCutoff
    ? \`A HotelCare-ben \${time}-ig (\${zoneHu} szerint) nem került aktivitás rögzítésre.\`
    : \`A HotelCare-ben az egyes munkatársak ellenőrzési időpontjáig (\${zoneHu} szerint) nem került aktivitás rögzítésre.\`;
  const alertEn = sameCutoff
    ? \`No HotelCare activity was recorded by \${time} (\${zoneEn}).\`
    : \`No HotelCare activity was recorded by each person's cutoff time (\${zoneEn}).\`;

  const staffHtml = input.people.map((person, index) => {
    const name = oneLine(person.name);
    const deadline = localTime(person.cutoffAt, timezone);
    const cutoffDetails = sameCutoff ? "" : \`
      <div style="margin-top:4px;font-size:12px;line-height:18px;color:#64748b">
        Ellenőrzés: \${escapeHtml(deadline)} <span lang="en">/ Cutoff: \${escapeHtml(deadline)}</span>
      </div>\`;
    return \`
      <tr><td style="padding:14px 16px;\${index ? "border-top:1px solid #e7ecf2;" : ""}">
        <div style="font-size:15px;line-height:22px;font-weight:700;color:#172338">\${escapeHtml(name)}</div>
        <div style="font-size:13px;line-height:20px;color:#536379;margin-top:3px">
          \${person.assignmentCount} kiosztott szoba <span lang="en">/ \${person.assignmentCount} room\${person.assignmentCount === 1 ? "" : "s"} assigned</span>
        </div>
        \${cutoffDetails}
      </td></tr>\`;
  }).join("");

  // One card, each Hungarian message immediately followed by its English translation.
  // Inline-only styles and presentation tables keep it readable in Gmail and on mobile.
  const html = \`
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
      \${escapeHtml(titleHu)} / \${escapeHtml(titleEn)} · \${roomCount} szoba / rooms
    </div>
    <div style="margin:0;padding:18px 10px;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#172338">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px;margin:0 auto;border-spacing:0">
        <tr><td style="background:#111c2e;border-radius:12px 12px 0 0;padding:19px 22px">
          <div style="font-size:12px;line-height:18px;letter-spacing:0.7px;font-weight:700;color:#bfcee2">
            HOTELCARE · TAKARÍTÁS <span lang="en">/ HOUSEKEEPING</span>
          </div>
          <div style="font-size:23px;line-height:30px;font-weight:700;color:white;margin-top:7px">
            Aktivitási értesítés <span lang="en" style="display:block;font-size:16px;line-height:23px;font-weight:400;color:#d4dfed">Activity alert</span>
          </div>
        </td></tr>
        <tr><td style="padding:22px;background:#ffffff;border:1px solid #e1e7ef;border-top:0;border-radius:0 0 12px 12px">
          <div style="color:#55657b;font-size:13px;line-height:19px">
            \${escapeHtml(hotelName)} · \${escapeHtml(localDate(input.workDate, "hu-HU"))} / <span lang="en">\${escapeHtml(localDate(input.workDate, "en-GB"))}</span>
          </div>
          <div style="font-size:21px;line-height:27px;font-weight:700;color:#172338;margin:15px 0 5px">\${escapeHtml(titleHu)}</div>
          <div lang="en" style="font-size:15px;line-height:22px;color:#536379;margin:0 0 16px">\${escapeHtml(titleEn)}</div>
          <div style="background:#fff6e7;border-left:4px solid #db9225;border-radius:5px;padding:13px 14px">
            <div style="font-size:14px;line-height:21px;font-weight:700;color:#644816">\${escapeHtml(alertHu)}</div>
            <div lang="en" style="font-size:13px;line-height:20px;color:#71572e;margin-top:5px">\${escapeHtml(alertEn)}</div>
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:18px;border-spacing:0">
            <tr>
              <td width="50%" style="padding:11px 12px;border:1px solid #e7ecf2;border-radius:7px 0 0 7px;vertical-align:top">
                <div style="font-size:23px;font-weight:700;color:#172338">\${staffCount}</div>
                <div style="font-size:12px;line-height:17px;color:#56657a">Munkatárs <span lang="en">/ Staff</span></div>
              </td>
              <td width="50%" style="padding:11px 12px;border:1px solid #e7ecf2;border-left:0;border-radius:0 7px 7px 0;vertical-align:top">
                <div style="font-size:23px;font-weight:700;color:#172338">\${roomCount}</div>
                <div style="font-size:12px;line-height:17px;color:#56657a">Kiosztott szoba <span lang="en">/ Assigned rooms</span></div>
              </td>
            </tr>
          </table>
          <div style="font-size:13px;font-weight:700;color:#536379;margin:22px 0 8px">
            Érintett munkatársak <span lang="en">/ Affected staff</span>
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e7ecf2;border-radius:8px;border-spacing:0">
            \${staffHtml}
          </table>
          <div style="margin-top:22px;font-size:14px;line-height:22px;color:#26354b">
            <strong>Teendő:</strong> Kérjük, egyeztessen az érintett munkatárssal, és ellenőrizze, hogy hozzáfér-e a HotelCare alkalmazáshoz.
          </div>
          <div lang="en" style="margin-top:5px;font-size:13px;line-height:21px;color:#536379">
            <strong>Next step:</strong> Check with the housekeeper\${staffCount === 1 ? "" : "s"} and confirm they can access HotelCare.
          </div>
          <div style="margin-top:18px">
            <a href="https://my.hotelcare.app" style="display:inline-block;background:#20528f;color:#ffffff;padding:12px 16px;border-radius:7px;font-size:14px;line-height:20px;font-weight:700;text-decoration:none">
              HotelCare megnyitása <span lang="en">/ Open HotelCare</span>
            </a>
          </div>
          <div style="margin-top:23px;padding-top:15px;border-top:1px solid #edf0f4;font-size:12px;line-height:19px;color:#66778e">
            Ez az értesítés csak azt jelzi, hogy nem történt rögzített aktivitás a HotelCare-ben. Nem jelenti azt, hogy a munkatárs hiányzik a munkahelyéről.
            <div lang="en" style="margin-top:5px">This alert only means activity was not recorded in HotelCare. It does not confirm the person was absent from work.</div>
          </div>
        </td></tr>
      </table>
    </div>\`;

  const peopleText = input.people.map((person) => {
    const suffix = sameCutoff ? "" : \` | Ellenőrzés / Cutoff: \${localTime(person.cutoffAt, timezone)}\`;
    return \`- \${oneLine(person.name)}: \${person.assignmentCount} kiosztott szoba / \${person.assignmentCount} room\${person.assignmentCount === 1 ? "" : "s"} assigned\${suffix}\`;
  }).join("\n");

  const text = \`HOTELCARE · TAKARÍTÁS / HOUSEKEEPING
\${hotelName} · \${localDate(input.workDate, "hu-HU")} / \${localDate(input.workDate, "en-GB")}

\${titleHu}
\${titleEn}

\${alertHu}
\${alertEn}

Munkatárs / Staff: \${staffCount}
Kiosztott szoba / Assigned rooms: \${roomCount}

\${peopleText}

Teendő: Kérjük, egyeztessen az érintett munkatárssal, és ellenőrizze, hogy hozzáfér-e a HotelCare alkalmazáshoz.
Next step: Check with the housekeeper\${staffCount === 1 ? "" : "s"} and confirm they can access HotelCare.

HotelCare megnyitása / Open HotelCare: https://my.hotelcare.app

Ez az értesítés csak azt jelzi, hogy nem történt rögzített aktivitás a HotelCare-ben. Nem jelenti azt, hogy a munkatárs hiányzik a munkahelyéről.
This alert only means activity was not recorded in HotelCare. It does not confirm the person was absent from work.\`;

  return { subject, html, text };
}
