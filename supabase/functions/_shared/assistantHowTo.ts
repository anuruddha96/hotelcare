// Compact how-to knowledge for the Hotel Care Assistant. Short, factual entries
// describing the real workflows in this app so answers never get invented.

export interface HowToEntry {
  id: string;
  scope: "general" | "housekeeping" | "maintenance" | "reception" | "revenue";
  title: string;
  body: string;
}

export const HOW_TO: HowToEntry[] = [
  {
    id: "signin-attendance",
    scope: "general",
    title: "Signing in for a shift",
    body:
      "Staff must have an active attendance record ('signed in') before they can start cleaning a room or working a ticket. Sign in from the attendance card on the dashboard; sign out at the end of the shift. If a room cannot be started, the usual cause is a missing sign-in.",
  },
  {
    id: "switch-property",
    scope: "general",
    title: "Switching property",
    body:
      "Use the property switcher in the header. The choice applies to the current browser tab only, so you can keep two hotels open side by side. The URL always shows the organization and the selected hotel.",
  },
  {
    id: "language",
    scope: "general",
    title: "Changing language",
    body: "Open your profile menu in the header and pick the language. Supported: English, Hungarian, Spanish, Vietnamese, Mongolian, Russian, Ukrainian.",
  },
  {
    id: "assign-room",
    scope: "housekeeping",
    title: "Assigning a room to a housekeeper",
    body:
      "Open Team View (or the Housekeeping tab), pick the housekeeper column and tap a room chip to assign it; on desktop you can also drag the room onto the housekeeper. Assignments are staged first and become live when you confirm them. Auto-Assign distributes the whole day at once using the hotel's cleaning capacities and priority tiers.",
  },
  {
    id: "unassign-room",
    scope: "housekeeping",
    title: "Unassigning a room",
    body: "In Team View tap the assigned room chip and choose Remove, or drag it back to the unassigned pool. Rooms already started must be cancelled by a manager.",
  },
  {
    id: "dnd",
    scope: "housekeeping",
    title: "DND rooms",
    body: "Mark the room as DND with a photo. The room returns for a retry later in the day; after repeated attempts it is escalated to reception.",
  },
  {
    id: "linen",
    scope: "housekeeping",
    title: "Dirty linen counts",
    body: "Enter dirty linen at the end of the room or the end of the shift from the linen dialog on the room card. Counts roll up per hotel and per day for the laundry report.",
  },
  {
    id: "ticket-create",
    scope: "maintenance",
    title: "Creating a maintenance ticket",
    body:
      "Use Create Ticket, pick the room, category and priority, and attach a photo. Photos are mandatory when completing the work. The SLA due date is set automatically from the priority.",
  },
  {
    id: "ticket-hold",
    scope: "maintenance",
    title: "Putting a ticket on hold",
    body: "Open the ticket and choose Hold with a reason (waiting for parts, guest in room). Held tickets stop the SLA clock and appear separately for managers.",
  },
  {
    id: "breakfast",
    scope: "reception",
    title: "Breakfast lookup",
    body: "The public /bb screen looks up a room number and shows breakfast entitlement. It is fed by the nightly Previo Daily Overview upload made by reception.",
  },
  {
    id: "checkin",
    scope: "reception",
    title: "Check-in and check-out",
    body: "Front Desk lists today's arrivals and departures. Checking a guest out flags the room as a checkout room for housekeeping automatically.",
  },
  {
    id: "rate-edit",
    scope: "revenue",
    title: "Changing prices",
    body:
      "In the Rate & pickup calendar drag across any cell range (press and hold on mobile) and the price editor opens. Sold-out room types and dates are excluded automatically. Confirmed changes are queued and pushed to Previo as whole numbers.",
  },
  {
    id: "automation",
    scope: "revenue",
    title: "Price automation",
    body:
      "Pickup automation works in lead-time bands: 0-7 days markdown when rooms remain, 8-30 days reacts to pickup, 31-90 days holds, and bookings beyond 90 days trigger a surcharge lift plus a notification. It never moves sold-out dates. Rules are configured per hotel in the automation panel.",
  },
  {
    id: "minstay",
    scope: "revenue",
    title: "Minimum stay",
    body: "Minimum stay is set per date (not per room type) in the calendar's Min stay row and is pushed to Previo. Rooms to sell is read-only because Previo's channel refuses inventory writes.",
  },
];

export function searchHowTo(query: string, scopes: string[]): HowToEntry[] {
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const allowed = HOW_TO.filter((e) => e.scope === "general" || scopes.includes(e.scope));
  const scored = allowed.map((e) => {
    const hay = `${e.title} ${e.body}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += 1;
    return { e, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  return (hits.length ? hits : scored.slice(0, 3)).map((s) => s.e);
}
