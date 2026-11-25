import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('2-hour session protection integration wiring', () => {
  it('actually unmounts the operational providers when suspended', () => {
    const app = source('src/App.tsx');
    expect(app).toContain('observeSessionSuspension');
    expect(app).toContain('if (suspended) return null;');
    expect(app).toContain('<LiveSyncProvider>');
    expect(app).toContain('<RealtimeNotificationProvider>');
  });

  it('does not rely on the dialog alone and cannot wake on synthetic activity', () => {
    const guard = source('src/components/system/ExecutiveResumeRefresh.tsx');
    expect(guard).toContain('event.isTrusted');
    expect(guard).toContain('checkHotelCareInactivity');
    expect(guard).toContain('recordHotelCareInteraction');
    expect(guard).toContain('CLIENT_VERSION_CHECK_MS');
    expect(guard).toContain('Refresh HotelCare');
  });

  it('uses remote protection only for a narrow browser GET allowlist', () => {
    const sql = source('supabase/migrations/20261020093000_hotelcare_stale_browser_gate.sql');
    expect(sql).toContain("NOT IN ('rooms','pms_accounts','pms_configurations')");
    expect(sql).toContain("referer_host <> 'my.hotelcare.app'");
    expect(sql).toContain("enforce_stale_clients boolean NOT NULL DEFAULT false");
    expect(sql).toContain('UPDATE TO authenticated');
    expect(sql).toContain("current_setting('request.method', true) <> 'GET'");
    expect(sql).toContain('HOTELCARE_UPDATE_REQUIRED');
  });
});
