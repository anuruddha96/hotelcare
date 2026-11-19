// Role- and time-aware opening suggestions. Replaces the old revenue-only list
// so a housekeeper is never greeted with pickup questions.

export interface StarterPrompt {
  label: string;
  prompt: string;
}

const HOUSEKEEPING: StarterPrompt[] = [
  { label: "My rooms", prompt: "What rooms are assigned to me right now?" },
  { label: "What next?", prompt: "What should I clean next?" },
  { label: "Complete a room", prompt: "How do I complete a room in Hotel Care?" },
  { label: "Report a problem", prompt: "I need to report a maintenance problem in a room." },
];

const HOUSEKEEPING_MANAGER: StarterPrompt[] = [
  { label: "Unassigned rooms", prompt: "Which rooms are still unassigned today?" },
  { label: "Team workload", prompt: "Show me the housekeeping workload per person today." },
  { label: "Open Team View", prompt: "Take me to Team View." },
  { label: "Urgent guest requests", prompt: "Which extra towels or other guest requests are still waiting for a housekeeper, and who is responsible?" },
  { label: "Yesterday's DND", prompt: "Show me the DND room photos for yesterday, with the room and capture time if available." },
  { label: "Team performance", prompt: "Compare verified room-cleaning durations with room type and workload. Flag unusual delays without judging staff unfairly." },
];

const MAINTENANCE: StarterPrompt[] = [
  { label: "My open jobs", prompt: "Show my open maintenance jobs." },
  { label: "Overdue", prompt: "Which maintenance tickets are overdue?" },
  { label: "Urgent", prompt: "What maintenance work is urgent right now?" },
  { label: "Close a ticket", prompt: "How do I close a maintenance ticket?" },
];

const RECEPTION: StarterPrompt[] = [
  { label: "Create repair ticket", prompt: "Create a maintenance ticket for room 205: the guest says the AC is not working and water is leaking in the bathroom. Check the room and booking context first, assign the correct priority, and show me the action for confirmation." },
  { label: "Guest requests", prompt: "Which guest requests still need action today, and who is assigned?" },
  { label: "Yesterday's DND", prompt: "Show the DND photos for room 105 yesterday and their timestamps, if recorded." },
  { label: "Departures", prompt: "How many departures do we have today?" },
  { label: "Rooms ready", prompt: "Which rooms are ready for arrival?" },
];

const REVENUE: StarterPrompt[] = [
  { label: "Pickup", prompt: "How is pickup over the next 14 days?" },
  { label: "Dates at risk", prompt: "Which revenue dates need attention and what would you change?" },
  { label: "Compare properties", prompt: "Compare my properties for the next 30 days." },
  { label: "Review automation", prompt: "Review my automation rules and suggest one improvement." },
];

const FINANCE: StarterPrompt[] = [
  { label: "Needs verification", prompt: "Which invoices still need verification?" },
  { label: "Overdue invoices", prompt: "Which purchase invoices are overdue?" },
  { label: "Open Invoices", prompt: "Take me to purchase invoices." },
  { label: "How it works", prompt: "How does invoice verification work in Hotel Care?" },
];

const MANAGER: StarterPrompt[] = [
  { label: "Today's priorities", prompt: "What needs my attention today across the departments I can access? Prioritize verified issues and tell me what Mira can help resolve." },
  { label: "Create repair ticket", prompt: "Prepare a maintenance ticket for room 205 about AC failure and water leakage. Verify the correct property and room before asking for confirmation." },
  { label: "Housekeeping", prompt: "How is housekeeping doing today, including outstanding guest requests and room progress?" },
  { label: "Maintenance", prompt: "What maintenance issues are open?" },
  { label: "Next month's schedule", prompt: "Help me prepare next month's staff schedule, checking staffing, leave and coverage before proposing changes." },
];

const ADMIN: StarterPrompt[] = [
  { label: "Today's priorities", prompt: "What needs my attention today? Review all departments within my access and suggest actions." },
  { label: "Review urgent tickets", prompt: "Which urgent or overdue maintenance tickets can I act on today?" },
  { label: "Create repair ticket", prompt: "Prepare a ticket for room 205: guest reports no AC and a bathroom leak. Check reservation context and correct maintenance routing, then ask for confirmation." },
  { label: "Revenue opportunities", prompt: "Which near-term nights need a verified pricing review?" },
  { label: "Send housekeeping items", prompt: "Please send 3 extra towels to room 202." },
  { label: "Change room bed setup", prompt: "Room 108 beds together." },
  { label: "Access requests", prompt: "Are there any pending assistant access requests?" },
  { label: "Help me use Hotel Care", prompt: "Show me how to use Hotel Care." },
];

const BY_ROLE: Record<string, StarterPrompt[]> = {
  housekeeping: HOUSEKEEPING,
  supervisor: HOUSEKEEPING_MANAGER,
  housekeeping_manager: HOUSEKEEPING_MANAGER,
  maintenance: MAINTENANCE,
  maintenance_manager: MAINTENANCE,
  reception: RECEPTION,
  front_office: RECEPTION,
  reception_manager: [
    { label: "Next month's schedule", prompt: "Help me prepare next month's front office schedule, considering staffing, approved leave and shift coverage." },
    ...RECEPTION,
  ],
  breakfast_staff: RECEPTION,
  control_finance: FINANCE,
  control_manager: FINANCE,
  finance_manager: FINANCE,
  back_office: FINANCE,
  back_office_manager: [
    { label: "Next month's schedule", prompt: "Help me prepare next month's work schedule, considering approved leave, coverage and workload." },
    ...FINANCE,
  ],
  manager: MANAGER,
  top_management: [
    ...MANAGER,
    { label: "Revenue dates at risk", prompt: "Which revenue management dates need attention across my authorized hotels, and why?" },
  ],
  top_management_manager: [
    ...MANAGER,
    { label: "Revenue dates at risk", prompt: "Which revenue management dates need attention across my authorized hotels, and why?" },
  ],
  admin: ADMIN,
};

const MODULE_EXTRA: Record<string, StarterPrompt> = {
  housekeeping: { label: "On this screen", prompt: "Explain what I can do on this housekeeping screen." },
  maintenance: { label: "On this screen", prompt: "Explain what I can do on this maintenance screen." },
  reception: { label: "On this screen", prompt: "Explain what I can do on this reception screen." },
  revenue: { label: "On this screen", prompt: "Explain what this revenue screen is showing me." },
  finance: { label: "On this screen", prompt: "Explain what this invoice screen is showing me." },
};

/**
 * `canSeeRevenue`: the person may read revenue figures in Mira (top
 * management and above). Managers work from the price list, so revenue
 * starters would only lead to a refusal.
 */
export function starterPrompts(role: string | null | undefined, module?: string | null, canSeeRevenue?: boolean): StarterPrompt[] {
  const base = (role && BY_ROLE[role]) ?? MANAGER;
  const revenueRoles = ["admin", "top_management", "top_management_manager"];
  const list = [...base];
  const revenueAllowed = canSeeRevenue ?? (!!role && revenueRoles.includes(role));
  if (module === "revenue" && revenueAllowed) list.unshift(...REVENUE.slice(0, 2));
  else if (revenueAllowed && ["top_management", "top_management_manager"].includes(role ?? "")) list.unshift(REVENUE[1]);
  const extra = module ? MODULE_EXTRA[module] : undefined;
  if (extra) list.push(extra);
  return list.slice(0, 5);
}

export function greeting(name?: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", hour12: false }).format(new Date()),
  );
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** Examples are suggestions, never a claim that Mira already performed an action. */
export function rolePlaceholderExamples(role: string | null | undefined): string[] {
  if (["reception", "front_office", "reception_manager", "manager", "top_management", "top_management_manager", "admin"].includes(role ?? "")) {
    const common = [
      "Create a maintenance ticket for room 205: AC not working and water leaking in the bathroom.",
      "Show the DND photos for room 105 yesterday, including their timestamps.",
      "Which guest requests need attention right now?",
      "Help me prepare next month's staff schedule.",
    ];
    return ["admin", "top_management", "top_management_manager"].includes(role ?? "")
      ? [...common, "Which revenue dates need attention this week?"]
      : common;
  }
  if (["housekeeping_manager", "supervisor"].includes(role ?? "")) {
    return [
      "Which guest requests for extra towels are still open?",
      "Show yesterday's DND photos for room 105.",
      "Which rooms are behind schedule today?",
      "Compare room cleaning times fairly by room type and workload.",
    ];
  }
  if (["housekeeping"].includes(role ?? "")) return [
    "What room should I clean next?",
    "Show the guest requests assigned to me.",
  ];
  if (["maintenance", "maintenance_manager"].includes(role ?? "")) return [
    "What are my urgent maintenance tickets?",
    "Which tickets are waiting for an update?",
  ];
  if (["control_finance", "control_manager", "finance_manager", "back_office", "back_office_manager"].includes(role ?? "")) return [
    "Which invoices need verification?",
    "Help me prepare next month's staff schedule.",
  ];
  return ["What needs my attention today?", "Help me with my next task."];
}
