import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';
import { IFA_EXEMPTIONS } from '../../../supabase/functions/_shared/ntak/codes';
import { autoIfaStatus } from '../../../supabase/functions/_shared/ntak/ifa';

type Row = {
  guest_id: string;
  ifa_status: string | null;
  guests: { first_name: string | null; last_name: string | null; date_of_birth: string | null } | null;
};

/** A per-stay tax classification, not an NTAK settings/reporting control. */
export function ReservationGuestIfa({ reservationId, night }: { reservationId: string; night: string }) {
  const { t, language } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { data, error } = await (supabase as any).from('reservation_guests')
        .select('guest_id,ifa_status,guests:guest_id(first_name,last_name,date_of_birth)')
        .eq('reservation_id', reservationId).order('is_primary', { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as Row[]);
    } catch {
      setRows([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [reservationId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (id: string, value: string) => {
    setBusy(id);
    try {
      const { error } = await (supabase as any).rpc('pms_set_guest_ifa_status', { _reservation_id: reservationId, _guest_id: id, _status: value || null });
      if (error) throw error;
      setRows((old) => old.map((r) => r.guest_id === id ? { ...r, ifa_status: value || null } : r));
      toast.success(t('ntak.ifaSaved'));
    } catch {
      toast.error(t('common.error'));
    } finally { setBusy(null); }
  };

  return <section className="rounded-lg border p-3 space-y-2" aria-label={t('ntak.ifaGuest')}>
    <h2 className="text-sm font-semibold">{t('ntak.ifaGuest')}</h2>
    <p className="text-xs text-muted-foreground">{t('ntak.ifaAnnexRequired')}</p>
    {loading && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{t('common.error')} <button type="button" className="underline" onClick={() => void refresh()}>{t('ntak.refreshReports')}</button></p>}
    {!loading && !error && rows.length === 0 && <p className="text-xs text-muted-foreground">{t('pms.stayGuest.noGuests')}</p>}
    {rows.map((r) => {
      const name = [r.guests?.first_name, r.guests?.last_name].filter(Boolean).join(' ');
      const minor = autoIfaStatus(r.guests?.date_of_birth, night) === 'im1';
      const unknown = !!r.ifa_status && r.ifa_status !== 'KOTELES' && !IFA_EXEMPTIONS.some(x => x.code === r.ifa_status);
      return <label key={r.guest_id} className="flex flex-wrap gap-2 items-center justify-between text-sm">
        <span>{name}</span>
        <select className="max-w-full rounded-md border bg-background p-2 text-xs" aria-label={name + ' ' + t('ntak.ifaGuest')}
          disabled={busy !== null} value={r.ifa_status ?? ''} onChange={(e) => void save(r.guest_id, e.target.value)}>
          <option value="">{t('ntak.ifaAuto')}{minor ? ' · ' + (language === 'hu' ? '18 év alatti' : 'Under 18') : ''}</option>
          <option value="KOTELES">{t('ntak.ifaPays')}</option>
          {unknown && <option value={r.ifa_status!} disabled>{r.ifa_status} — {t('ntak.ifaAnnexRequired')}</option>}
          {IFA_EXEMPTIONS.filter(x => x.code !== 'im1' || r.ifa_status === 'im1').map(x => <option key={x.code} value={x.code}>{language === 'hu' ? x.hu : x.en}</option>)}
        </select>
      </label>;
    })}
  </section>;
}
