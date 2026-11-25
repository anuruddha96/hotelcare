import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { GOZSDU_COURT_HOTEL_ID } from '@/lib/gozsdu-housekeeping';

type Coverage = { total: number; imported: number; missing: string[]; issue: string | null };
const normalize = (name: unknown) => String(name ?? '').normalize('NFKC').trim().toLowerCase();

/** Gozsdu-only presentation: keep the underlying PMS reconciliation and safety rules intact. */
export function GozsduQuietPmsNotice({ selectedDate, children }: { selectedDate: string; children: React.ReactNode }) {
  const { profile } = useAuth();
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const canReview = hasManagerPowers(profile?.role) || profile?.role === 'supervisor';

  useEffect(() => {
    if (!canReview || !profile?.organization_slug) return;
    let active = true;
    const loadCoverage = async () => {
      const [registry, snapshot] = await Promise.all([
        (supabase as any).from('gozsdu_housekeeping_room_registry').select('pms_room_name'),
        (supabase as any).from('daily_overview_snapshots').select('room_label')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', GOZSDU_COURT_HOTEL_ID)
          .eq('business_date', selectedDate).eq('source', 'previo'),
      ]);
      if (!active) return;
      if (registry.error || snapshot.error) {
        setCoverage({ total: 0, imported: 0, missing: [], issue: 'Coverage details could not be loaded. Check the Previo import history.' });
        return;
      }
      const names = ((registry.data || []) as Array<{ pms_room_name: string }>).map(row => row.pms_room_name);
      const imported = ((snapshot.data || []) as Array<{ room_label: string | null }>);
      const seen = new Set(imported.map(row => normalize(row.room_label)));
      setCoverage({ total: names.length, imported: imported.length,
        missing: names.filter(name => !seen.has(normalize(name))), issue: null });
    };
    void loadCoverage().catch(() => {
      if (active) setCoverage({ total: 0, imported: 0, missing: [], issue: 'Coverage details unavailable. Check the Previo import history.' });
    });
    return () => { active = false; };
  }, [canReview, profile?.organization_slug, selectedDate]);

  return (
    <div className="gozsdu-quiet-pms">
      {/* Hide ONLY Gozsdu's existing oversized amber roster notice. Validation is unchanged. */}
      <style>{'.gozsdu-quiet-pms #hotel-room-overview [role="alert"].border-amber-500 { display: none !important; }'}</style>
      {children}
      {canReview && (
        <details className="mt-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">PMS verification details{coverage && !coverage.issue && coverage.missing.length > 0 ? ` · ${coverage.missing.length} rooms to review` : ''}</summary>
          <div className="mt-2 space-y-1 pb-1">
            {coverage?.issue ? <p>{coverage.issue}</p> : coverage ? (
              <>
                <p>Selected-day Previo snapshot: {coverage.imported} entries; PMS room registry: {coverage.total}. Coverage alone does not verify arrivals, departures, or housekeeping status.</p>
                {coverage.missing.length > 0 ? (
                  <>
                    <p>Missing from imported snapshot: {coverage.missing.join(', ')}. Do not treat these rooms as vacant or confirmed checkouts solely because they are absent.</p>
                    {selectedDate === '2026-09-22' && <p>The 22 September Previo cleaning export includes these four missing rooms as arrivals at 15:00. Confirm them in Previo and run the actual PMS import; the overview refresh only reloads stored data.</p>}
                    <p>Verify each room’s arrival/departure and mapping in Previo, run the PMS import, then recheck the coverage and room chips before assigning work.</p>
                  </>
                ) : <p>All registered labels appear in the snapshot. Confirm date, freshness, and stay information in Previo before relying on room statuses.</p>}
              </>
            ) : <p>Checking Previo snapshot coverage…</p>}
          </div>
        </details>
      )}
    </div>
  );
}
