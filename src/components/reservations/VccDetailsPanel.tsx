import { CalendarClock, CreditCard, Info, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { deriveVccInfo, type VccReservation, type VccState } from '@/lib/vccInfo';

const STATE_STYLE: Record<VccState, string> = {
  charged: 'bg-emerald-600 text-white',
  chargeable: 'bg-sky-600 text-white',
  not_yet: 'bg-amber-100 text-amber-900 border border-amber-300',
  unknown: 'bg-muted text-muted-foreground',
};

/**
 * Virtual credit card facts for an OTA-collect booking: can it be charged yet,
 * how much, and where the card is. Read-only — it shows what the booking
 * already says and never loads, stores or changes anything. Renders nothing
 * for bookings without a virtual card.
 */
export function VccDetailsPanel({ reservation }: { reservation: VccReservation }) {
  const { t } = useTranslation();
  const info = deriveVccInfo(reservation, todayBudapest());
  if (!info) return null;
  const money = (value: number) => `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${info.currency ? ` ${info.currency}` : ''}`;

  return (
    <Card data-training="vcc-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <CreditCard className="h-4 w-4 text-primary" /> {t('pms.vcc.title')}
          <Badge className={`text-[10px] font-medium ${STATE_STYLE[info.state]}`}>{t(`pms.vcc.state_${info.state}`)}</Badge>
          {info.confidence === 'inferred' && <Badge variant="outline" className="text-[10px] font-normal">{t('pms.vcc.inferred')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1">
          {info.channel && <><dt className="text-muted-foreground">{t('pms.vcc.paidBy')}</dt><dd className="font-medium">{info.channel}</dd></>}
          <dt className="text-muted-foreground">{t('pms.vcc.chargeableFrom')}</dt>
          <dd className="flex items-center gap-1.5 flex-wrap">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            {info.chargeableFrom
              ? <><span className="font-medium">{info.chargeableFrom}</span>{info.state === 'not_yet' && info.daysUntilChargeable != null && <span className="text-xs text-muted-foreground">({info.daysUntilChargeable} {t('pms.vcc.daysLeft')})</span>}</>
              : <span className="text-muted-foreground">{t('pms.vcc.dateUnknown')}</span>}
          </dd>
          {info.amountToCharge != null && (
            <><dt className="text-muted-foreground">{t('pms.vcc.amount')}</dt><dd className="font-semibold">{money(info.amountToCharge)}</dd></>
          )}
        </dl>
        {info.instructions.length > 0 && (
          <ul className="rounded-md bg-muted/40 px-3 py-2 text-xs space-y-0.5">
            {info.instructions.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
        <p className="flex items-start gap-1.5 text-xs">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" /> {t(`pms.vcc.where_${info.cardLocation}`)}
        </p>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-px text-emerald-600" /> {t('pms.vcc.privacy')}
        </p>
      </CardContent>
    </Card>
  );
}

export default VccDetailsPanel;
