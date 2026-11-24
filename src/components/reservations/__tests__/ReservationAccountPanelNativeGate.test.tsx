import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReservationAccountPanel } from '../ReservationAccountPanel';
import { isNativePmsOrganization } from '@/hooks/useAccessPolicy';

const testState = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { role: 'admin', is_super_admin: true } }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: testState.rpc, from: testState.from },
}));

describe('ReservationAccountPanel external-PMS safety', () => {
  it('uses the same native-PMS rule as navigation', () => {
    expect(isNativePmsOrganization('channex')).toBe(true);
    expect(isNativePmsOrganization('rdhotels')).toBe(false);
    expect(isNativePmsOrganization(null)).toBe(false);
  });

  it('shows Previo-imported balance read-only without creating a finance folio', async () => {
    testState.rpc.mockResolvedValue({data:false,error:null});
    render(<ReservationAccountPanel reservation={{
      id: 'external-booking', hotel_id: 'previo-hotel',
      organization_slug: 'rdhotels', currency: 'EUR',
      total_amount: 300, balance_due: 97,
    }} />);
    expect(await screen.findByTestId('external-ledger-readonly')).toHaveTextContent('pms.account.externalReadOnly');
    expect(screen.getByText('pms.account.importedBalance')).toBeInTheDocument();
    expect(screen.getByText('pms.account.stayAmount', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add charge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /services/i })).not.toBeInTheDocument();
    expect(testState.rpc).toHaveBeenCalledTimes(1);
    expect(testState.rpc).toHaveBeenCalledWith('pms_finance_native_access',{_reservation_id:'external-booking'});
    expect(testState.from).not.toHaveBeenCalled();
  });
});
