import { useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { useIsMobile } from "@/hooks/use-mobile";
import { destinationCatalogue, destinationForLocation } from "@/lib/assistant/navigationRegistry";
import { ALL_CURRICULA } from "@/components/training/v2/TrainingV2Provider";

const HOTEL_TIMEZONE = "Europe/Budapest";

function dateKeyInTimezone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assistantRuntimeContext() {
  const now = new Date();
  const today = dateKeyInTimezone(now, HOTEL_TIMEZONE);
  return {
    timezone: HOTEL_TIMEZONE,
    today,
    yesterday: addCalendarDays(today, -1),
    tomorrow: addCalendarDays(today, 1),
    localDateTime: new Intl.DateTimeFormat("en-GB", {
      timeZone: HOTEL_TIMEZONE,
      dateStyle: "full",
      timeStyle: "long",
    }).format(now),
    utcNow: now.toISOString(),
    interpretation:
      "Resolve relative dates from this hotel-local clock. Treat sales, sold, bookings, booking pace and pickup as revenue-performance language. A statement such as 'not much sales today' is a request for live revenue/pickup analysis and practical next actions, not generic advice. 'Sales today' means booking/pickup activity made today unless the user explicitly asks about guests staying today. If the available pickup metric covers a rolling period rather than exactly today, state that period clearly instead of presenting it as today's exact sales.",
  };
}

/**
 * Everything the copilot needs to know about "where the user is". This is a UX
 * signal only — the backend re-derives identity, organization, property and
 * role from the JWT and never trusts anything sent from here for authorization.
 */
export interface AssistantPageContext {
  organizationSlug: string | null;
  hotelId: string | null;
  role: string | null;
  route: string;
  module: string | null;
  destinationId: string | null;
  tab: string | null;
  entityType: string | null;
  entityId: string | null;
  language: string;
  device: "mobile" | "desktop";
  timezone: string;
  runtime: ReturnType<typeof assistantRuntimeContext>;
}

function entityFromPath(pathname: string): { type: string | null; id: string | null } {
  const segments = pathname.split("/").filter(Boolean).slice(1); // drop the org slug
  const [section, id] = segments;
  if (!id) return { type: null, id: null };
  const map: Record<string, string> = {
    reservations: "reservation",
    guests: "guest",
    revenue: "hotel",
    "purchase-invoices": "invoice",
  };
  const type = map[section];
  return type ? { type, id } : { type: null, id: null };
}

export function useAssistantContext() {
  const { profile } = useAuth();
  const { language } = useTranslation();
  const location = useLocation();
  const [params] = useSearchParams();
  const { organizationSlug, hotelId: routeHotelId } = useParams<{
    organizationSlug: string;
    hotelId?: string;
  }>();
  const isMobile = useIsMobile();

  const tab = params.get("tab");
  const destination = useMemo(
    () => destinationForLocation(location.pathname, tab),
    [location.pathname, tab],
  );

  const page: AssistantPageContext = useMemo(() => {
    const entity = entityFromPath(location.pathname);
    return {
      organizationSlug: organizationSlug ?? profile?.organization_slug ?? null,
      // On /revenue/:hotelId the route is the hotel the user is actually
      // looking at. This must win over profile.assigned_hotel, especially for
      // portfolio managers, otherwise the assistant may analyze another hotel
      // or widen the request to the whole portfolio.
      hotelId: routeHotelId ?? profile?.assigned_hotel ?? null,
      role: profile?.role ?? null,
      route: location.pathname,
      module: destination?.module ?? null,
      destinationId: destination?.id ?? null,
      tab,
      entityType: entity.type,
      entityId: entity.id,
      language,
      device: isMobile ? "mobile" : "desktop",
      timezone: HOTEL_TIMEZONE,
      // JSON.stringify invokes this getter when each chat request is sent, so a
      // tab left open for hours still gets a fresh hotel-local clock.
      get runtime() {
        return assistantRuntimeContext();
      },
    };
  }, [location.pathname, organizationSlug, routeHotelId, profile, destination, tab, language, isMobile]);

  /** Destinations and walkthroughs the model may reference, for this role. */
  const capabilities = useMemo(() => {
    const role = profile?.role ?? null;
    const guides = ALL_CURRICULA.filter((c) => !role || c.roles.includes(role as never)).map((c) => ({
      slug: c.slug,
      name: c.name.en,
      description: c.description.en,
      steps: c.steps.slice(0, 12).map((s) => s.title.en),
    }));
    return { destinations: destinationCatalogue(role), guides };
  }, [profile?.role]);

  return { page, capabilities };
}
