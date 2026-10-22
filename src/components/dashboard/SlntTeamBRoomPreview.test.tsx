import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SlntTeamBRoomPreview, type SlntTeamBPreviewItem } from './SlntTeamBRoomPreview';

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

const show = (item: SlntTeamBPreviewItem = base, hu = false) => render(
  <SlntTeamBRoomPreview
    item={item} date={today} hu={hu} userId="cleaner-1" managerView={false} busy={false}
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
