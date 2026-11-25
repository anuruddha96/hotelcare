import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FlaskConical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';

type OutboxRow = {
  id: string;
  action: 'check_in' | 'check_out';
  status: 'pending' | 'sending' | 'sent' | 'dry_run' | 'failed' | 'blocked';
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  updated_at: string;
};

const STYLE: Record<OutboxRow['status'], string> = {
  sent: 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300',
  pending: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300',
  sending: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300',
  dry_run: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300',
  failed: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300',
  blocked: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
};

/**
 * What happened to this booking's check-in / check-out on the Previo side.
 * Renders nothing when write-back is off for the hotel (no outbox rows).
 */
export function PrevioWritebackStatus({ reservationId, refreshKey }: { reservationId: string; refreshKey?: unknown }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<OutboxRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const { data, error } = await supabase
        .from('pms_reservation_outbox' as never)
        .select('id, action, status, attempts, last_error, sent_at, updated_at')
        .eq('reservation_id', reservationId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      const next = error ? [] : ((data ?? []) as unknown as OutboxRow[]);
      setRows(next);
      // While something is still on its way, look again shortly (the worker runs every 2 minutes).
      if (next.some((row) => row.status === 'pending' || row.status === 'sending')) {
        timer = setTimeout(load, 30_000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reservationId, refreshKey]);

  if (!rows.length) return null;

  return (
    <div className="flex flex-col gap-1.5" aria-label={t('pms.wb.title')}>
      {rows.map((row) => {
        const action = t(`pms.wb.${row.action}`);
        const icon = row.status === 'sent' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          : row.status === 'dry_run' ? <FlaskConical className="h-3.5 w-3.5 shrink-0" />
            : row.status === 'pending' || row.status === 'sending' ? <Clock className="h-3.5 w-3.5 shrink-0" />
              : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />;
        const text = row.status === 'sent'
          ? `${t('pms.wb.sent')}${row.sent_at ? ` · ${new Date(row.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
          : row.status === 'dry_run' ? t('pms.wb.dryRun')
            : row.status === 'pending' || row.status === 'sending'
              ? `${t('pms.wb.pending')}${row.attempts > 0 && row.last_error ? ` · ${row.last_error}` : ''}`
              : `${row.status === 'failed' ? t('pms.wb.failed') : t('pms.wb.blocked')}: ${row.last_error ?? '—'} · ${t('pms.wb.doInPrevio')}`;
        return (
          <div key={row.id} role="status" className={`flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs ${STYLE[row.status]}`}>
            {icon}
            <span><span className="font-semibold">{action}:</span> {text}</span>
          </div>
        );
      })}
    </div>
  );
}

export default PrevioWritebackStatus;
