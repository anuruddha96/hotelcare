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
  { label: "Needs attention", prompt: "What needs my attention in housekeeping today?" },
];

const MAINTENANCE: StarterPrompt[] = [
  { label: "My open jobs", prompt: "Show my open maintenance jobs." },
  { label: "Overdue", prompt: "Which maintenance tickets are overdue?" },
  { label: "Urgent", prompt: "What maintenance work is urgent right now?" },
  { label: "Close a ticket", prompt: "How do I close a maintenance ticket?" },
];

const RECEPTION: StarterPrompt[] = [
  { label: "Today's arrivals", prompt: "Who arrives today?" },
  { label: "Departures", prompt: "How many departures do we have today?" },
  { label: "Rooms ready", prompt: "Which rooms are ready for arrival?" },
  { label: "Report a room issue", prompt: "I need to report a problem in a room." },
];

const REVENUE: StarterPrompt[] = [
  { label: "Pickup", prompt: "How is pickup over the next 14 days?" },
  { label: "Dates at risk", prompt: "Which dates need attention and what would you change?" },
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
  { label: "Needs attention", prompt: "What needs my attention today?" },
  { label: "Housekeeping", prompt: "How is housekeeping doing today?" },
  { label: "Maintenance", prompt: "What maintenance issues are open?" },
  { label: "Today's arrivals", prompt: "How many guests arrive today?" },
];

const ADMIN: StarterPrompt[] = [
  { label: "Needs attention", prompt: "What needs my attention today across the properties?" },
  { label: "Sync status", prompt: "Is the PMS synchronisation healthy?" },
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
  reception_manager: RECEPTION,
  breakfast_staff: RECEPTION,
  control_finance: FINANCE,
  control_manager: FINANCE,
  finance_manager: FINANCE,
  back_office: FINANCE,
  back_office_manager: FINANCE,
  manager: MANAGER,
  top_management: MANAGER,
  top_management_manager: MANAGER,
  admin: ADMIN,
};

const MODULE_EXTRA: Record<string, StarterPrompt> = {
  housekeeping: { label: "On this screen", prompt: "Explain what I can do on this housekeeping screen." },
  maintenance: { label: "On this screen", prompt: "Explain what I can do on this maintenance screen." },
  reception: { label: "On this screen", prompt: "Explain what I can do on this reception screen." },
  revenue: { label: "On this screen", prompt: "Explain what this revenue screen is showing me." },
  finance: { label: "On this screen", prompt: "Explain what this invoice screen is showing me." },
};

export function starterPrompts(role: string | null | undefined, module?: string | null): StarterPrompt[] {
  const base = (role && BY_ROLE[role]) ?? MANAGER;
  const revenueRoles = ["admin", "top_management", "top_management_manager", "manager"];
  const list = [...base];
  if (module === "revenue" && role && revenueRoles.includes(role)) list.unshift(...REVENUE.slice(0, 2));
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
