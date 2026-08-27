// The one place the copilot is allowed to learn about Hotel Care destinations.
// The model may only return a destination `id` from this registry; the app
// resolves the real route here and checks the role before navigating, so a
// model can never invent a URL or send someone into a screen they cannot use.

export interface AssistantDestination {
  id: string;
  label: string;
  /** Short sentence the model reads to decide whether this is the right place. */
  description: string;
  /** Logical module, used for context labels and starter prompts. */
  module: string;
  /** Roles allowed to open it. Empty = every signed-in role. */
  roles?: string[];
  /** Training curriculum slug that walks the user through this screen. */
  guide?: string;
  /** Builds the in-app path for the organization. */
  path: (orgSlug: string) => string;
}

const dash = (tab: string) => (org: string) => `/${org}?tab=${tab}`;

const MANAGERS = [
  "manager",
  "housekeeping_manager",
  "maintenance_manager",
  "reception_manager",
  "back_office_manager",
  "admin",
  "top_management",
  "top_management_manager",
];

const EXEC = ["admin", "top_management", "top_management_manager", "manager"];

export const ASSISTANT_DESTINATIONS: AssistantDestination[] = [
  {
    id: "dashboard.home",
    label: "Dashboard",
    description: "The Hotel Care home screen with the main tabs.",
    module: "dashboard",
    path: (org) => `/${org}`,
  },
  {
    id: "maintenance.tickets",
    label: "Maintenance",
    description: "Maintenance tickets: open, in progress and completed issues, priorities and SLA.",
    module: "maintenance",
    guide: "manager-tickets",
    path: dash("tickets"),
  },
  {
    id: "reception.rooms",
    label: "Reception — Rooms",
    description: "Room overview for reception: status, readiness, arrivals and departures.",
    module: "reception",
    guide: "manager-reception",
    path: dash("rooms"),
  },
  {
    id: "housekeeping.overview",
    label: "Housekeeping",
    description: "Housekeeping overview with room status, progress and daily cleaning.",
    module: "housekeeping",
    guide: "manager-team",
    path: dash("housekeeping"),
  },
  {
    id: "housekeeping.team_view",
    label: "Housekeeping Team View",
    description: "Team View: who is cleaning what, assign or reassign rooms, follow live progress.",
    module: "housekeeping",
    roles: MANAGERS,
    guide: "manager-team",
    path: dash("housekeeping"),
  },
  {
    id: "housekeeping.my_rooms",
    label: "My rooms",
    description: "The housekeeper's own assigned rooms for today.",
    module: "housekeeping",
    path: dash("housekeeping"),
  },
  {
    id: "operations.minibar",
    label: "Minibar",
    description: "Minibar items, placements and room consumption.",
    module: "operations",
    path: dash("minibar"),
  },
  {
    id: "operations.lost_found",
    label: "Lost & Found",
    description: "Items found in rooms and public areas, and their handover status.",
    module: "operations",
    path: dash("lost-found"),
  },
  {
    id: "hr.attendance",
    label: "HR & Attendance",
    description: "Staff attendance, sign-in records, schedules and work hours.",
    module: "hr",
    roles: MANAGERS,
    guide: "manager-attendance",
    path: dash("attendance"),
  },
  {
    id: "admin.settings",
    label: "Admin",
    description: "Administration: users, hotels, organizations, PMS configuration and system settings.",
    module: "admin",
    roles: ["admin", "top_management", "top_management_manager"],
    guide: "admin-pms-overview",
    path: dash("admin"),
  },
  {
    id: "reception.front_desk",
    label: "Front Desk",
    description: "Front desk: check-in, check-out and in-house guests.",
    module: "reception",
    path: (org) => `/${org}/front-desk`,
  },
  {
    id: "reception.home",
    label: "Reception home",
    description: "Reception landing page with today's operational summary.",
    module: "reception",
    path: (org) => `/${org}/reception`,
  },
  {
    id: "reception.reservations",
    label: "Reservations",
    description: "Reservation list and calendar; find a booking, arrivals and departures.",
    module: "reception",
    path: (org) => `/${org}/reservations`,
  },
  {
    id: "reception.guests",
    label: "Guests",
    description: "Guest profiles and stay history.",
    module: "reception",
    path: (org) => `/${org}/guests`,
  },
  {
    id: "revenue.overview",
    label: "Revenue Management",
    description: "Revenue overview across properties: occupancy, ADR, pickup and pace.",
    module: "revenue",
    roles: EXEC,
    guide: "manager-revenue",
    path: (org) => `/${org}/revenue`,
  },
  {
    id: "revenue.calendar",
    label: "Revenue rate calendar",
    description: "The rate strategy grid: prices, min stay, restrictions and automation activity per date.",
    module: "revenue",
    roles: EXEC,
    guide: "manager-revenue",
    path: (org) => `/${org}/revenue`,
  },
  {
    id: "revenue.channel_manager",
    label: "Channel Manager",
    description: "Channels, rate plan mappings and distribution.",
    module: "revenue",
    roles: EXEC,
    path: (org) => `/${org}/channel-manager`,
  },
  {
    id: "finance.purchase_invoices",
    label: "Purchase Invoices",
    description: "Supplier invoices: upload, verification, cost centres, approval and analytics.",
    module: "finance",
    roles: [...EXEC, "control_finance", "control_manager", "finance_manager", "back_office", "back_office_manager"],
    guide: "manager-invoices",
    path: (org) => `/${org}/purchase-invoices`,
  },
  {
    id: "operations.breakfast",
    label: "Breakfast",
    description: "Breakfast roster and verification for today's guests.",
    module: "operations",
    path: (org) => `/${org}/bb`,
  },
  {
    id: "training.center",
    label: "Training Center",
    description: "Guided walkthroughs and training units for Hotel Care.",
    module: "training",
    path: (org) => `/${org}/training`,
  },
  {
    id: "billing.overview",
    label: "Billing",
    description: "Hotel Care subscription and billing overview.",
    module: "billing",
    roles: ["admin", "top_management", "top_management_manager"],
    path: (org) => `/${org}/billing`,
  },
  {
    id: "assistant.insights",
    label: "Assistant insights",
    description: "Admin analytics about assistant usage and questions.",
    module: "admin",
    roles: ["admin"],
    path: (org) => `/${org}/assistant-insights`,
  },
];

export function findDestination(id: string): AssistantDestination | undefined {
  return ASSISTANT_DESTINATIONS.find((d) => d.id === id);
}

export function canOpenDestination(destination: AssistantDestination, role: string | null | undefined): boolean {
  if (!destination.roles || destination.roles.length === 0) return true;
  return Boolean(role && destination.roles.includes(role));
}

export function destinationsForRole(role: string | null | undefined): AssistantDestination[] {
  return ASSISTANT_DESTINATIONS.filter((d) => canOpenDestination(d, role));
}

/** Compact catalogue handed to the model — ids, labels and purpose only. */
export function destinationCatalogue(role: string | null | undefined) {
  return destinationsForRole(role).map((d) => ({
    id: d.id,
    label: d.label,
    description: d.description,
    module: d.module,
    guide: d.guide ?? null,
  }));
}

/** Best-effort reverse lookup: which destination does this path represent? */
export function destinationForLocation(pathname: string, tab: string | null): AssistantDestination | undefined {
  const withoutOrg = pathname.replace(/^\/[^/]+/, "") || "/";
  if (withoutOrg === "/" && tab) {
    const byTab: Record<string, string> = {
      tickets: "maintenance.tickets",
      rooms: "reception.rooms",
      housekeeping: "housekeeping.overview",
      attendance: "hr.attendance",
      minibar: "operations.minibar",
      "lost-found": "operations.lost_found",
      admin: "admin.settings",
    };
    const id = byTab[tab];
    if (id) return findDestination(id);
  }
  return ASSISTANT_DESTINATIONS.find((d) => {
    const path = d.path("org").replace(/^\/org/, "");
    const base = path.split("?")[0];
    return base !== "/" && withoutOrg.startsWith(base);
  });
}
