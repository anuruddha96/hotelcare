import { describe, expect, it } from 'vitest';
import { canCollectRdOneTimePayment as allowed } from '../../supabase/functions/_shared/rdOneTimePermissions';

describe('RD Hotels one-time payment authorization', () => {
  it.each(['top_management', 'top_management_manager', 'admin'])(
    'allows an RD Hotels %s account to start checkout',
    role => {
      expect(allowed({ role, organizationSlug: 'rdhotels' }, 'rdhotels')).toBe(true);
    },
  );

  it('allows a super admin even when assigned to another organization', () => {
    expect(allowed({ role: 'admin', organizationSlug: 'other', isSuperAdmin: true }, 'rdhotels')).toBe(true);
  });

  it.each(['manager', 'reception', 'housekeeping', 'finance_manager', 'maintenance', 'control_finance'])(
    'does not extend collection rights to %s',
    role => {
      expect(allowed({ role, organizationSlug: 'rdhotels' }, 'rdhotels')).toBe(false);
    },
  );

  it('rejects a Top Manager from another organization and any checkout outside RD Hotels', () => {
    expect(allowed({ role: 'top_management', organizationSlug: 'slnt' }, 'rdhotels')).toBe(false);
    expect(allowed({ role: 'top_management_manager', organizationSlug: 'rdhotels' }, 'slnt')).toBe(false);
    expect(allowed({ role: 'admin', organizationSlug: 'slnt' }, 'rdhotels')).toBe(false);
    expect(allowed({ role: 'admin', organizationSlug: 'rdhotels', isSuperAdmin: true }, 'slnt')).toBe(false);
  });

  it('requires an authenticated principal with the correct organization', () => {
    expect(allowed(null, 'rdhotels')).toBe(false);
    expect(allowed({ role: 'top_management', organizationSlug: null }, 'rdhotels')).toBe(false);
    expect(allowed({ role: 'top_management' }, 'rdhotels')).toBe(false);
  });
});
