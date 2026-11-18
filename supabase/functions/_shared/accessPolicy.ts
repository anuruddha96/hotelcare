// Access roles: what each person may see and do in HotelCare.
//
// `profiles.role` is the database permission level (RLS and Edge Functions
// rely on it and it is unchanged). `profiles.access_role` is the role a person
// really has — taken from their work-schedule job — and decides the landing
// page, Mira, work-schedule scope, review replies and revenue in the app.
// An access role is accepted only when it fits the permission level; the
// database enforces the same table (public.access_role_allows_permission).
//
// Pure TypeScript: used by the app (src/lib/accessPolicy.ts) and by the Edge
// Functions, and covered by vitest.

export type AccessRole =
  | "admin"
  | "top_management"
  | "controlling"
  | "hr"
  | "manager"
  | "housekeeping_manager"
  | "housekeeping_supervisor"
  | "reception"
  | "housekeeping"
  | "maintenance"
  | "breakfast"
  | "other";

export const ACCESS_ROLES: AccessRole[] = [
  "top_management",
  "controlling",
  "hr",
  "manager",
  "housekeeping_manager",
  "housekeeping_supervisor",
  "reception",
  "housekeeping",
  "maintenance",
  "breakfast",
  "admin",
  "other",
];

export const ACCESS_ROLE_LABEL: Record<AccessRole, string> = {
  admin: "Administrator",
  top_management: "Top management",
  controlling: "Controlling",
  hr: "HR",
  manager: "Manager",
  housekeeping_manager: "Housekeeping manager",
  housekeeping_supervisor: "Housekeeping supervisor",
  reception: "Reception",
  housekeeping: "Housekeeper",
  maintenance: "Maintenance",
  breakfast: "Breakfast staff",
  other: "Staff",
};

export const ACCESS_ROLE_DESCRIPTION: Record<AccessRole, string> = {
  admin: "Everything, in every hotel.",
  top_management: "Everything; lands on Revenue.",
  controlling: "Top-management access; lands on Purchase invoices.",
  hr: "HR, housekeeping, maintenance and staff schedules; no finance, revenue, reputation or channels.",
  manager: "All hotels and operational modules, Mira and review replies. Price list instead of Revenue: no revenue figures.",
  housekeeping_manager: "Housekeeping and maintenance; work schedule of their own hotel only; no review replies.",
  housekeeping_supervisor: "Like a housekeeping manager: own hotel only, no review replies.",
  reception: "Reception staff start on Maintenance; front-office managers start on Housekeeping.",
  housekeeping: "Own rooms and shift. No Mira. Schedule hidden until it goes live.",
  maintenance: "Own tickets and shift. No Mira. Schedule hidden until it goes live.",
  breakfast: "Breakfast lookup only.",
  other: "Basic access.",
};

/** Permission levels each access role may sit on (mirrors the SQL function). */
export const ACCESS_ROLE_PERMISSIONS: Record<AccessRole, readonly string[] | "any"> = {
  admin: ["admin"],
  top_management: ["top_management", "top_management_manager"],
  controlling: ["top_management", "top_management_manager", "control_finance", "control_manager", "finance_manager"],
  hr: ["top_management", "top_management_manager", "hr"],
  manager: ["manager", "back_office_manager"],
  housekeeping_manager: ["manager", "housekeeping_manager"],
  housekeeping_supervisor: ["manager", "housekeeping_manager", "supervisor"],
  reception: ["manager", "reception", "front_office", "reception_manager"],
  housekeeping: ["housekeeping"],
  maintenance: ["maintenance", "maintenance_manager"],
  breakfast: ["breakfast_staff"],
  other: "any",
};

/** Permission level a new person with this access role should get. */
export const DEFAULT_PERMISSION_FOR: Record<AccessRole, string> = {
  admin: "admin",
  top_management: "top_management_manager",
  controlling: "top_management_manager",
  hr: "top_management_manager",
  manager: "manager",
  housekeeping_manager: "manager",
  housekeeping_supervisor: "manager",
  reception: "manager",
  housekeeping: "housekeeping",
  maintenance: "maintenance",
  breakfast: "breakfast_staff",
  other: "marketing",
};

export function isAccessRole(value: unknown): value is AccessRole {
  return typeof value === "string" && (ACCESS_ROLES as string[]).includes(value);
}

export function accessRoleFitsPermission(accessRole: AccessRole, role: string | null | undefined): boolean {
  const allowed = ACCESS_ROLE_PERMISSIONS[accessRole];
  return allowed === "any" || allowed.includes(String(role ?? ""));
}

/** Access roles that may be chosen for someone on this permission level. */
export function accessRolesForPermission(role: string | null | undefined): AccessRole[] {
  return ACCESS_ROLES.filter((accessRole) => accessRole !== "other" && accessRoleFitsPermission(accessRole, role));
}

/** What a permission level means when no access role is set (same as SQL). */
export function accessRoleFromPermission(role: string | null | undefined): AccessRole {
  switch (role) {
    case "admin": return "admin";
    case "top_management":
    case "top_management_manager": return "top_management";
    case "control_finance":
    case "control_manager":
    case "finance_manager": return "controlling";
    case "hr": return "hr";
    case "manager": return "manager";
    case "housekeeping_manager": return "housekeeping_manager";
    case "supervisor": return "housekeeping_supervisor";
    case "reception":
    case "front_office":
    case "reception_manager": return "reception";
    case "housekeeping": return "housekeeping";
    case "maintenance":
    case "maintenance_manager": return "maintenance";
    case "breakfast_staff": return "breakfast";
    default: return "other";
  }
}

export type AccessSubject = {
  role?: string | null;
  access_role?: string | null;
  email?: string | null;
  nickname?: string | null;
  is_super_admin?: boolean | null;
} | null | undefined;

/** The person's access role: their own when it fits, otherwise the derived one. */
export function effectiveAccessRole(subject: AccessSubject): AccessRole {
  if (!subject) return "other";
  const stored = subject.access_role;
  if (isAccessRole(stored) && accessRoleFitsPermission(stored, subject.role)) return stored;
  return accessRoleFromPermission(subject.role);
}

export type ScheduleScope = "org" | "property" | "home_hotel" | "self";

export type AccessCapabilities = {
  accessRole: AccessRole;
  /** May open Mira at all. */
  mira: boolean;
  /** Revenue module and Mira revenue data (revenue, ADR, pickup, goals). */
  revenueRead: boolean;
  /** Read-only price list (room prices per date, no revenue figures). */
  priceList: boolean;
  /** "Today's Sales & ADR Goal": top management and above, and Controlling. */
  salesGoal: boolean;
  /** May approve Mira rate plans (prices go through the Revenue safety queue). */
  revenueWrite: boolean;
  /** Reviews in Reputation and AI review replies in Mira. */
  reviews: boolean;
  /** Purchase invoices / finance data in Mira. */
  finance: boolean;
  /** Work schedule: whole organization, the selected hotel, their own hotel, or only themselves. */
  scheduleScope: ScheduleScope;
  /** Mira may build schedule plans for them. */
  scheduleBuilder: boolean;
  /** May switch the staff schedule live for housekeepers and maintenance. */
  scheduleGoLive: boolean;
  /** Personal mailbox in Mira. */
  mail: boolean;
};

const EXECUTIVE: AccessRole[] = ["admin", "top_management", "controlling"];
/** Sensitive sales targets: top management and above, plus Controlling (not HR). */
const SALES_GOAL: AccessRole[] = ["admin", "top_management", "controlling"];

/** The person's own access role was set (not derived from the permission level). */
export function hasExplicitAccessRole(subject: AccessSubject, accessRole: AccessRole): boolean {
  return !!subject && subject.access_role === accessRole && accessRoleFitsPermission(accessRole, subject.role);
}

export function capabilitiesFor(subject: AccessSubject): AccessCapabilities {
  const accessRole = effectiveAccessRole(subject);
  const superAdmin = subject?.is_super_admin === true;
  const executive = superAdmin || EXECUTIVE.includes(accessRole);
  const base: AccessCapabilities = {
    accessRole,
    mira: false,
    revenueRead: false,
    priceList: false,
    salesGoal: false,
    revenueWrite: false,
    reviews: false,
    finance: false,
    scheduleScope: "self",
    scheduleBuilder: false,
    scheduleGoLive: false,
    mail: false,
  };
  // HR can be backed by an executive database permission level, but the
  // effective access role must not inherit executive finance/revenue rights.
  if (accessRole === "hr" && !superAdmin) {
    return { ...base, mira: true, scheduleScope: "org", scheduleBuilder: true, scheduleGoLive: true, mail: true };
  }
  if (executive) {
    return {
      ...base,
      mira: true,
      revenueRead: true,
      priceList: true,
      salesGoal: superAdmin || SALES_GOAL.includes(accessRole),
      revenueWrite: true,
      reviews: true,
      finance: true,
      scheduleScope: "org",
      scheduleBuilder: true,
      scheduleGoLive: true,
      mail: true,
    };
  }
  switch (accessRole) {
    case "manager": {
      // Managers named by the owner (role set explicitly) work across every
      // hotel and get a read-only price list instead of Revenue. Revenue
      // figures stay with top management. Accounts still waiting for a role
      // keep today's single-hotel schedule and no price list.
      const named = hasExplicitAccessRole(subject, "manager");
      return {
        ...base,
        mira: true,
        priceList: named,
        reviews: true,
        finance: false,
        scheduleScope: named ? "org" : "property",
        scheduleBuilder: true,
        mail: true,
      };
    }
    case "housekeeping_manager":
    case "housekeeping_supervisor":
      return { ...base, mira: true, scheduleScope: "home_hotel", scheduleBuilder: true, mail: true };
    case "reception":
      // Everything except revenue management. On the manager permission level
      // reception keeps today's screens; the schedule stays view-and-edit as
      // today, but Mira does not plan schedules for reception.
      return {
        ...base,
        mira: true,
        reviews: true,
        scheduleScope: subject?.role === "manager" ? "property" : "self",
        mail: subject?.role === "manager",
      };
    case "housekeeping":
    case "maintenance":
    case "breakfast":
      return base;
    default:
      return { ...base, mira: true };
  }
}

/** Mira data areas for the person (assistant-chat / router scopes). */
export type MiraScope = "revenue" | "housekeeping" | "maintenance" | "reception" | "finance";

export function miraScopesFor(subject: AccessSubject): MiraScope[] {
  const caps = capabilitiesFor(subject);
  if (!caps.mira) return [];
  switch (caps.accessRole) {
    case "housekeeping_manager":
    case "housekeeping_supervisor":
      return ["housekeeping", "maintenance"];
    case "reception":
      return ["housekeeping", "maintenance", "reception"];
    case "other":
      return [];
    default: {
      const scopes: MiraScope[] = ["housekeeping", "maintenance", "reception"];
      if (caps.revenueRead) scopes.unshift("revenue");
      if (caps.finance) scopes.push("finance");
      return scopes;
    }
  }
}

export type LandingContext = {
  organizationSlug: string;
  /** The person may open Purchase invoices (module rolled out for them). */
  invoicesAvailable: boolean;
  /** Their hotel runs on HotelCare's own PMS (Channex) instead of Previo. */
  nativePms: boolean;
};

/**
 * First screen after sign-in, for the roles whose landing differs from the
 * normal dashboard. Top management keeps its existing revenue-first redirect
 * (handled where it always was). Null = the normal dashboard.
 */
export function landingPathFor(subject: AccessSubject, context: LandingContext): string | null {
  const base = `/${context.organizationSlug}`;
  switch (effectiveAccessRole(subject)) {
    case "controlling":
      return context.invoicesAvailable ? `${base}/purchase-invoices` : null;
    case "hr":
      return `${base}?tab=attendance`;
    case "reception":
      // The reception permission role starts on Maintenance. A front-office
      // manager holding the manager permission level starts on Housekeeping.
      return subject?.role === "manager" ? null : `${base}?tab=tickets`;
    default:
      return null;
  }
}

/** Dashboard tab to open first (null = keep the existing per-role default). */
export function defaultDashboardTabFor(subject: AccessSubject): string | null {
  const accessRole = effectiveAccessRole(subject);
  if (accessRole === "hr") return "attendance";
  if (accessRole === "reception" && subject?.role === "manager") return "housekeeping";
  return null;
}
