import { describe, expect, it } from 'vitest';
import { isAnnouncementVisible } from './announcementVisibility';

const now = Date.parse('2026-10-11T18:27:46Z');
const notice = {
  published: true, starts_at: '2026-10-11T18:27:46Z',
  ends_at: '2026-10-13T18:27:46Z',
  target_roles: ['top_management_manager', 'top_management'],
  target_org_slugs: [],
};

describe('announcement banner targeting', () => {
  it('shows the compact upgrade notice to top managers within 48 hours', () => {
    expect(isAnnouncementVisible(notice, { role: 'top_management_manager' }, now + 1000)).toBe(true);
  });
  it('does not show top-manager notices to regular admins or other staff', () => {
    expect(isAnnouncementVisible(notice, { role: 'admin' }, now + 1000)).toBe(false);
    expect(isAnnouncementVisible(notice, { role: 'manager' }, now + 1000)).toBe(false);
    expect(isAnnouncementVisible(notice, { role: 'reception' }, now + 1000)).toBe(false);
  });
  it('hides the notice exactly when the two-day window ends', () => {
    expect(isAnnouncementVisible(notice, { role: 'top_management_manager' }, now - 1)).toBe(false);
    expect(isAnnouncementVisible(notice, { role: 'top_management_manager' }, Date.parse(notice.ends_at))).toBe(false);
  });
  it('also respects organization restriction and unpublished notices', () => {
    const limited = { ...notice, target_org_slugs: ['rdhotels'] };
    expect(isAnnouncementVisible(limited, { role: 'top_management_manager', organization_slug: 'slnt' }, now + 1000)).toBe(false);
    expect(isAnnouncementVisible(limited, { role: 'top_management_manager', organization_slug: 'rdhotels' }, now + 1000)).toBe(true);
    expect(isAnnouncementVisible({ ...notice, published: false }, { role: 'top_management_manager' }, now + 1000)).toBe(false);
  });
});
