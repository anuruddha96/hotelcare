import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import postcss from 'postcss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenant = vi.hoisted(() => ({ slug: 'slnt' as string | null, venues: true }));

vi.mock('@/hooks/useTenantFeatures', () => ({
  useTenantFeatures: () => ({ orgSlug: tenant.slug, venuesEnabled: tenant.venues }),
}));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-09-22' }));
vi.mock('@/lib/hotel-memories-housekeeping', () => ({
  isHotelMemoriesBudapest: (name: string) => name === 'Hotel Memories Budapest',
}));
vi.mock('@/lib/gozsdu-housekeeping', () => ({
  isGozsduCourtHotel: (name: string) => name === 'Gozsdu Court Budapest',
}));
vi.mock('./HotelRoomOverviewLive', () => ({
  HotelRoomOverview: ({ hotelName, staffMap }: { hotelName: string; staffMap: Record<string, string> }) => (
    <div data-testid="live-overview" data-hotel={hotelName} data-staff-count={Object.keys(staffMap).length}>
      Live room board
    </div>
  ),
}));
vi.mock('./GozsduRoomOverviewActions', () => ({
  GozsduRoomOverviewActions: () => <div data-testid="gozsdu-overview" />,
}));
vi.mock('./GozsduQuietPmsNotice', () => ({
  GozsduQuietPmsNotice: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./HistoricalHotelRoomOverviewSaved', () => ({
  HistoricalHotelRoomOverviewSaved: () => <div data-testid="historical-overview" />,
}));
vi.mock('./MemoriesHistoricalRoomOverview', () => ({
  MemoriesHistoricalRoomOverview: () => <div data-testid="memories-history" />,
}));
vi.mock('./RoomOperationsQuickHub', () => ({
  RoomOperationsQuickHub: ({ children }: { children: ReactNode }) => <div data-testid="quick-hub">{children}</div>,
}));
vi.mock('./RoomHoverIntentGuard', () => ({
  RoomHoverIntentGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./RoomTypeDropBoundary', () => ({
  RoomTypeDropBoundary: ({ children }: { children: ReactNode }) => <div data-testid="drop-boundary">{children}</div>,
}));
vi.mock('./TomorrowHousekeepingLauncher', () => ({
  TomorrowHousekeepingLauncher: () => null,
}));

import { HotelRoomOverview } from './HotelRoomOverview';

const renderOverview = (hotelName = 'SLNT Group', selectedDate = '2026-09-22') =>
  render(<HotelRoomOverview selectedDate={selectedDate} hotelName={hotelName} staffMap={{ hk1: 'Housekeeper' }} />);

describe('SLNT Team View property-row isolation', () => {
  beforeEach(() => {
    tenant.slug = 'slnt';
    tenant.venues = true;
  });

  it.each(['slnt', 'slnt-group'])('wraps the live board for active tenant %s without replacing its props or actions', (slug) => {
    tenant.slug = slug;
    const { container } = renderOverview();
    expect(container.querySelector('.slnt-team-property-rows')).toContainElement(screen.getByTestId('live-overview'));
    expect(screen.getByTestId('live-overview')).toHaveAttribute('data-hotel', 'SLNT Group');
    expect(screen.getByTestId('live-overview')).toHaveAttribute('data-staff-count', '1');
    expect(screen.getByTestId('quick-hub')).toBeInTheDocument();
    expect(screen.getByTestId('drop-boundary')).toBeInTheDocument();
  });

  it.each(['rdhotels', 'other', ''])('does not style another organization (%s)', (slug) => {
    tenant.slug = slug;
    const { container } = renderOverview('Hotel Ottofiori');
    expect(container.querySelector('.slnt-team-property-rows')).toBeNull();
    expect(screen.getByTestId('live-overview')).toBeInTheDocument();
  });

  it('respects the active tenant feature flag', () => {
    tenant.venues = false;
    const { container } = renderOverview();
    expect(container.querySelector('.slnt-team-property-rows')).toBeNull();
  });

  it('does not affect historical snapshots', () => {
    const { container } = renderOverview('SLNT Group', '2026-09-21');
    expect(screen.getByTestId('historical-overview')).toBeInTheDocument();
    expect(container.querySelector('.slnt-team-property-rows')).toBeNull();
    expect(screen.queryByTestId('live-overview')).not.toBeInTheDocument();
  });

  it('retains the Memories-specific historical path', () => {
    renderOverview('Hotel Memories Budapest', '2026-09-21');
    expect(screen.getByTestId('memories-history')).toBeInTheDocument();
  });

  it('retains the Gozsdu-specific live room actions', () => {
    const { container } = renderOverview('Gozsdu Court Budapest');
    expect(screen.getByTestId('gozsdu-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('quick-hub')).not.toBeInTheDocument();
    expect(container.querySelector('.slnt-team-property-rows')).toBeNull();
  });
});

describe('SLNT stylesheet safety', () => {
  const css = readFileSync(new URL('./slnt-team-property-rows.css', import.meta.url), 'utf8');

  it('parses as CSS and scopes every rule to SLNT Team View', () => {
    const root = postcss.parse(css);
    let count = 0;
    root.walkRules((rule) => {
      count++;
      expect(rule.selector).toContain('[data-training="team-view"] .slnt-team-property-rows #hotel-room-overview');
    });
    expect(count).toBeGreaterThan(5);
  });

  it('switches the property rail using available container width, not viewport width', () => {
    const root = postcss.parse(css);
    const containerQueries: string[] = [];
    root.walkAtRules('container', (rule) => { containerQueries.push(rule.params); });
    expect(containerQueries).toContain('(min-width: 34rem)');
    expect(css).toContain('div[class~="animate-fade-in"]');
  });
});
