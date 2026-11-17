export type StaffWorkVenueState = {
  home_hotel: string;
  last_worked_hotel: string;
  last_switched_on: string | null;
  prompt_next_day: boolean;
};

/** A previous property switch only prompts when a *new Budapest day* starts. */
export function shouldPromptStaffWorkVenue(
  state: StaffWorkVenueState | null,
  currentHotel: string | null | undefined,
  today: string,
): boolean {
  if (!currentHotel && !state) return true;
  return state?.prompt_next_day === true
    && !!state.last_switched_on
    && state.last_switched_on < today;
}
