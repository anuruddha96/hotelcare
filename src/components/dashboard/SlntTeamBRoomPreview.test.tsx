import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SlntTeamBRoomPreview, type SlntTeamBPreviewItem, type SlntIncomingArrival } from './SlntTeamBRoomPreview';

const today = '2026-10-22';
const base: SlntTeamBPreviewItem = {
  room_id: 'room-1', room_number: 'K4 – Room 1', room_name: 'K4 Room 1',
  room_status: 'dirty', notes: null, guest_count: 2,
  is_checkout_room: false, towel_change_required: false, linen_change_required: false,
  pms_metadata: { arrivalDate: '2026-10-20', departureDate: '2026-10-24' },
  is_optional: true, floor_number: 2, guest_nights_stayed: 3,
  bed_configuration: null, assignment_notes: null, manager_instruction_text: null, planned_notes: [],
  assignment_id: null, assigned_to: null, assignment_status: null, supervisor_approved: false,
};

const show = (item: SlntTeamBPreviewItem = base, hu = false, incoming?: SlntIncomingArrival | null,
  incomingStatus: 'loading' | 'verified' | 'unavailable' = 'loading') => render(
  <SlntTeamBRoomPreview
    item={item} date={today} hu={hu} userId="cleaner-1" managerView={false} busy={false}
    incoming={incoming} incomingStatus={incomingStatus} incomingAsOf="2026-10-22T08:00:00Z"
    onStart={vi.fn()} onOpen={vi.fn()}
  />
);

describe('SLNT Team B optional stayover cards', () => {
  it('uses a neutral muted card, while leaving Start Cleaning fully visible and operable', () => {
    const { container } = show();
    const card = container.querySelector('[data-training="slnt-team-b-room"]');
    expect(card).toHaveAttribute('data-room-state', 'optional');
    expect(card).toHaveAttribute('data-optional-unstarted', 'true');
    expect(card?.className).toContain('border-l-slate-300');
    expect(screen.getByText('Optional stayover — not a required task')).toBeInTheDocument();
    expect(screen.getByText('No towel or linen change is due today. Start cleaning only if needed.')).toBeInTheDocument();

    const start = screen.getByRole('button', { name: /Start Cleaning/i });
    expect(start).toBeEnabled();
    expect(start).toHaveClass('w-full');
    expect(start.closest('[data-training="slnt-team-b-claim"]')).toHaveClass('flex', 'w-full');
    expect(start).not.toHaveClass('opacity-50');
    expect(start).not.toHaveClass('pointer-events-none');
  });

  it('shows the equivalent optional message in Hungarian', () => {
    show(base, true);
    expect(screen.getByText('Opcionális napi szoba – nem kötelező feladat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Takarítás indítása/i })).toBeEnabled();
  });

  it('never subdues scheduled towel-change rooms despite a stale optional flag', () => {
    const { container } = show({ ...base, towel_change_required: true });
    const card = container.querySelector('[data-training="slnt-team-b-room"]');
    expect(card).toHaveAttribute('data-room-state', 'towel');
    expect(card).not.toHaveAttribute('data-optional-unstarted');
    expect(card?.className).toContain('border-l-emerald-500');
    expect(screen.getByText(/TOWEL CHANGE REQUIRED/)).toBeInTheDocument();
    expect(screen.queryByText('Optional stayover — not a required task')).not.toBeInTheDocument();
  });

  it('restores normal active styling after claiming an optional room', () => {
    const { container } = show({
      ...base, assignment_id: 'assignment-1', assigned_to: 'cleaner-1', assignment_status: 'in_progress',
    });
    expect(container.querySelector('[data-optional-unstarted]')).toBeNull();
    expect(screen.getByRole('button', { name: /Open my room/i })).toBeEnabled();
    expect(screen.queryByText('Optional stayover — not a required task')).not.toBeInTheDocument();
  });

  it('does not soften or unlock a checkout awaiting RTC', () => {
    const { container } = show({
      ...base, is_checkout_room: true, pms_metadata: { pmsSyncDate: today, scheduledDepartureToday: true },
    });
    expect(container.querySelector('[data-room-state="waiting-rtc"]')).toBeInTheDocument();
    expect(screen.getByText(/Cannot start — waiting for checkout/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start Cleaning/i })).not.toBeInTheDocument();
  });
});

describe('SLNT exact-room next arrival details', () => {
  const checkout = { ...base, is_checkout_room: true, pms_metadata: {
    pmsSyncDate: today, scheduledDepartureToday: true, readyToClean: true, readyToCleanDate: today,
    checkedOutToday: true, arrivalDate: '2026-10-20', departureDate: today,
  } };
  it('prominently highlights the next arrival guest count and hides outgoing stay dates', () => {
    const { container } = show(checkout, false,
      { room_id: 'room-1', status: 'confirmed', arrival_date: today, guest_count: 3 }, 'verified');
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]'))
      .toHaveTextContent('Arrival today: 3 guests');
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]'))
      .toHaveClass('bg-sky-600');
    expect(container.querySelector('[data-training="slnt-checkout-guest-count"]'))
      .toHaveTextContent('Checkout: 2 guests');
    expect(screen.queryByText(/Arrival: 2026-10-20/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Departure: 2026-10-22/)).not.toBeInTheDocument();
    expect(screen.queryByText(/total unverified/i)).not.toBeInTheDocument();
  });
  it('displays guest-list counts without an alarming warning or mislabelling them as declared totals', () => {
    const { container } = show(checkout, false,
      { room_id: 'room-1', status: 'guest_list', arrival_date: today, guest_count: 1 }, 'verified');
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]'))
      .toHaveTextContent('Arrival today: 1 guest');
    expect(screen.queryByText(/total unverified/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Based on Previo guest listing')).toBeInTheDocument();
  });
  it('distinguishes an arrival on a different date', () => {
    const { container } = show(checkout, false,
      { room_id: 'room-1', status: 'confirmed', arrival_date: '2026-10-27', guest_count: 2 }, 'verified');
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]'))
      .toHaveTextContent(/Arrival.*27 Oct.*2 guests/);
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]'))
      .not.toHaveTextContent('Arrival today');
  });
  it('shows a bounded no-booking statement only for a verified lookup', () => {
    const { container } = show(checkout, false,
      { room_id: 'room-1', status: 'not_found', arrival_date: null, guest_count: null }, 'verified');
    expect(screen.getByText(/No confirmed arrival within 30 days/)).toBeInTheDocument();
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]')).not.toBeInTheDocument();
  });
  it('fails closed when Previo lookup fails rather than showing a stale count', () => {
    const { container } = show(checkout, false, null, 'unavailable');
    expect(screen.getByText(/Arrival data unavailable/)).toBeInTheDocument();
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]')).not.toBeInTheDocument();
  });
  it('keeps outgoing stay dates for non-checkout stayover rooms', () => {
    show(base);
    expect(screen.getByText(/Arrival: 2026-10-20 · Departure: 2026-10-24/)).toBeInTheDocument();
  });
  it('preserves Hungarian arrival wording and verified guest counts', () => {
    const { container } = show(checkout, true,
      { room_id: 'room-1', status: 'confirmed', arrival_date: today, guest_count: 4 }, 'verified');
    expect(container.querySelector('[data-training="slnt-incoming-count-highlight"]'))
      .toHaveTextContent('Érkezés ma: 4 vendég');
  });
});
