export type FreshHousekeepingKind = "checkout" | "daily";

export type HousekeepingServicePolicyInput = {
  hotelId: string;
  hotelName?: string | null;
  planDate: string;
  kind: FreshHousekeepingKind;
  arrivalDate?: string | null;
  departureDate?: string | null;
  settings?: Record<string, any> | null;
};

export type HousekeepingServicePolicyResult = {
  eligible: boolean;
  assignmentType: "checkout_cleaning" | "daily_cleaning";
  towelChangeRequired: boolean;
  linenChangeRequired: boolean;
  service: "checkout" | "daily" | "towel_change" | "change_room" | "none";
  reason: string;
};

const GOZSDU_ALIASES = new Set(["gozsdu-court", "gozsdu court budapest"]);
const MEMORIES_ALIASES = new Set(["memories-budapest", "hotel memories budapest"]);

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function dayNumber(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.round(parsed / 86_400_000) : null;
}

function stayNumbers(arrivalDate: string | null | undefined, departureDate: string | null | undefined, planDate: string) {
  const arrival = dayNumber(arrivalDate);
  const departure = dayNumber(departureDate);
  const selected = dayNumber(planDate);
  if (arrival === null || departure === null || selected === null || selected < arrival || departure <= arrival) {
    return { currentNight: 0, totalNights: 0, remainingNights: 0 };
  }
  const currentNight = selected - arrival + 1;
  const totalNights = departure - arrival;
  return {
    currentNight,
    totalNights,
    remainingNights: Math.max(0, totalNights - currentNight),
  };
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 90 ? parsed : fallback;
}

function serviceCyclePolicy(settings: Record<string, any> | null | undefined, key: string) {
  const configured = settings?.[key] && typeof settings[key] === "object" ? settings[key] : {};
  return {
    enabled: configured.enabled !== false,
    towelFirst: asPositiveInt(configured.towel_first_night, 3),
    towelRepeat: asPositiveInt(configured.towel_repeat_nights, 4),
    changeFirst: asPositiveInt(configured.change_first_night, 5),
    changeRepeat: asPositiveInt(configured.change_repeat_nights, 5),
    finalNightTowelOnly: configured.final_night_towel_only !== false,
  };
}

function isHotel(input: HousekeepingServicePolicyInput, aliases: Set<string>): boolean {
  return aliases.has(normalize(input.hotelId)) || aliases.has(normalize(input.hotelName));
}

/**
 * Reclassify an UNSOLD-at-planning room from fresh morning reservation data.
 *
 * This function is intentionally pure: it never mutates a room, assignment or
 * plan. The release transaction decides whether the proposed result may be
 * materialized, after checking that no live/manual housekeeping work exists.
 */
export function classifyUnsoldRoomAfterMorningPms(
  input: HousekeepingServicePolicyInput,
): HousekeepingServicePolicyResult {
  if (input.kind === "checkout") {
    return {
      eligible: true,
      assignmentType: "checkout_cleaning",
      towelChangeRequired: false,
      linenChangeRequired: false,
      service: "checkout",
      reason: "fresh_pms_checkout",
    };
  }

  const { currentNight, totalNights, remainingNights } = stayNumbers(
    input.arrivalDate,
    input.departureDate,
    input.planDate,
  );

  if (isHotel(input, GOZSDU_ALIASES)) {
    // Gozsdu has no generic daily clean. Its existing property rule is:
    // 3/N, 7/N, 11/N... towel; 5/N, 9/N, 13/N... full textile change
    // when at least two nights remain; otherwise towel-only.
    if (currentNight < 3 || currentNight > totalNights || currentNight % 2 === 0) {
      return {
        eligible: false,
        assignmentType: "daily_cleaning",
        towelChangeRequired: false,
        linenChangeRequired: false,
        service: "none",
        reason: "gozsdu_no_service_due",
      };
    }
    const fullChange = (currentNight - 1) % 4 === 0 && remainingNights > 1;
    return {
      eligible: true,
      assignmentType: "daily_cleaning",
      towelChangeRequired: !fullChange,
      linenChangeRequired: fullChange,
      service: fullChange ? "change_room" : "towel_change",
      reason: fullChange ? "gozsdu_change_room_due" : "gozsdu_towel_change_due",
    };
  }

  const policyKey = isHotel(input, MEMORIES_ALIASES)
    ? "memories_service_cycle"
    : "housekeeping_service_cycle";
  const hasConfiguredGenericPolicy = !!input.settings?.housekeeping_service_cycle;
  const useServiceCycle = isHotel(input, MEMORIES_ALIASES) || hasConfiguredGenericPolicy;

  if (useServiceCycle && currentNight > 0 && totalNights > 0) {
    const policy = serviceCyclePolicy(input.settings, policyKey);
    if (policy.enabled) {
      let towel = currentNight >= policy.towelFirst
        && (currentNight - policy.towelFirst) % policy.towelRepeat === 0;
      let change = currentNight >= policy.changeFirst
        && (currentNight - policy.changeFirst) % policy.changeRepeat === 0;
      if (change) towel = false;

      const departure = dayNumber(input.departureDate);
      const selected = dayNumber(input.planDate);
      const departsTomorrow = departure !== null && selected !== null && departure === selected + 1;
      if (change && departsTomorrow && policy.finalNightTowelOnly) {
        change = false;
        towel = true;
      }

      return {
        eligible: true,
        assignmentType: "daily_cleaning",
        towelChangeRequired: towel,
        linenChangeRequired: change,
        service: change ? "change_room" : towel ? "towel_change" : "daily",
        reason: isHotel(input, MEMORIES_ALIASES)
          ? "memories_service_cycle"
          : "configured_service_cycle",
      };
    }
  }

  // Existing HotelCare default used by Mika, Ottofiori, SLNT and properties
  // without a custom policy: normal daily work, with the same 3/7/11... towel
  // and 5/9/13... linen cadence already used by next-day planning.
  const genericCycle = currentNight >= 3 ? (currentNight - 3) % 4 : -1;
  const genericTowel = genericCycle === 0;
  const genericLinen = genericCycle === 2;
  return {
    eligible: true,
    assignmentType: "daily_cleaning",
    towelChangeRequired: genericTowel,
    linenChangeRequired: genericLinen,
    service: genericLinen ? "change_room" : genericTowel ? "towel_change" : "daily",
    reason: "standard_daily_cycle",
  };
}
