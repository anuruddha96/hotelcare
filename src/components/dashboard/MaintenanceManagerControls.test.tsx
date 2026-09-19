import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { canManageMaintenance, MaintenanceManagerControls, type ManagerMaintenanceTicket } from './MaintenanceManagerControls';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const ticket: ManagerMaintenanceTicket = {
  id: '3b140a71-a0fd-457b-a702-c1668fc3ea60',
  ticket_number: 'MNT-20260919074846-8D095E',
  room_number: '1B-3/3/5', status: 'open', on_hold: false,
  pending_supervisor_approval: false,
  updated_at: '2026-09-19T09:48:46.000Z',
  sla_due_date: '2099-09-19T12:00:00.000Z', resolution_text: null,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('maintenance manager workflow', () => {
  it('allows manager and top-management roles but not housekeeping or reception staff', () => {
    expect(canManageMaintenance('manager')).toBe(true);
    expect(canManageMaintenance('top_management')).toBe(true);
    expect(canManageMaintenance('top_management_manager')).toBe(true);
    expect(canManageMaintenance('maintenance_manager')).toBe(true);
    expect(canManageMaintenance('reception_manager')).toBe(true);
    expect(canManageMaintenance('housekeeping')).toBe(false);
    expect(canManageMaintenance('reception')).toBe(false);
  });

  it('records manual resolution of an unassigned open issue without requiring a photo or worker', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const onUpdated = vi.fn();
    render(<MaintenanceManagerControls ticket={ticket} language="en" onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resolved manually' }));
    fireEvent.change(screen.getByLabelText(/Explain what happened/), { target: { value: 'Fixed the curtains directly by reception.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save update' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledWith('manage_maintenance_ticket', {
      p_ticket_id: ticket.id, p_action: 'resolve',
      p_note: 'Fixed the curtains directly by reception.',
      p_expected_updated_at: ticket.updated_at,
      p_sla_breach_reason: null,
    });
    expect(onUpdated).toHaveBeenCalledOnce();
  });

  it('requires an explanation when reopening a completed ticket', () => {
    render(<MaintenanceManagerControls ticket={{ ...ticket, status: 'completed' }} language="en" onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen issue' }));
    expect((screen.getByRole('button', { name: 'Save update' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Explain what happened/), { target: { value: 'Problem returned' } });
    expect((screen.getByRole('button', { name: 'Save update' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('requires a documented SLA delay for an overdue manual resolution', () => {
    render(<MaintenanceManagerControls ticket={{ ...ticket, sla_due_date: '2020-01-01T00:00:00Z' }} language="en" onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resolved manually' }));
    fireEvent.change(screen.getByLabelText(/Explain what happened/), { target: { value: 'Curtain replaced' } });
    expect((screen.getByRole('button', { name: 'Save update' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason for missed SLA/), { target: { value: 'Replacement part arrived late' } });
    expect((screen.getByRole('button', { name: 'Save update' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
