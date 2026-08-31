import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ShieldCheck, CreditCard } from 'lucide-react';
import {
  earlyBirdActive, formatMoney, listPriceFor, trialIsRunning, type BillingSummary,
} from '@/hooks/useBilling';

/**
 * Shown when someone without an active Revenue subscription switches price
 * automation on. It explains what the subscription covers, that the trial
 * costs nothing, and takes them to Payments with the right property and
 * module already selected.
 */
export function ActivateModuleDialog({
  open,
  onOpenChange,
  summary,
  hotelId,
  hotelName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: BillingSummary | null;
  hotelId: string | null;
  hotelName: string;
}) {
  const navigate = useNavigate();
  const settings = summary?.settings;
  const currency = settings?.currency ?? 'EUR';
  const rooms = summary?.hotels.find((h) => h.hotel_id === hotelId)?.rooms ?? 0;
  const unit = settings?.revenue_automation_price_cents ?? 0;
  const list = listPriceFor(settings, 'revenue_automation');
  const promo = earlyBirdActive(settings) && list > unit;
  const trial = trialIsRunning(summary);

  const goToPayments = () => {
    const params = new URLSearchParams();
    if (hotelId) params.set('hotel', hotelId);
    params.set('module', 'revenue_automation');
    onOpenChange(false);
    navigate(`/billing?${params.toString()}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Activate price automation for {hotelName}
          </DialogTitle>
          <DialogDescription>
            Automation belongs to the Revenue Management subscription. Start it yourself in under a minute — during the
            free trial you only add a card, nothing is charged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Revenue BI + Automation</span>
              <span className="flex items-center gap-2">
                {promo && (
                  <span className="text-xs text-muted-foreground line-through">
                    {formatMoney(list, currency)}
                  </span>
                )}
                <span className="font-semibold">{formatMoney(unit, currency)} / room</span>
                {promo && (
                  <Badge variant="secondary" className="text-[10px]">
                    {settings?.early_bird_label ?? 'Early bird'}
                  </Badge>
                )}
              </span>
            </div>
            {rooms > 0 && unit > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {rooms} rooms × {formatMoney(unit, currency)} ={' '}
                <span className="font-medium text-foreground">{formatMoney(rooms * unit, currency)}</span> / month excl.
                VAT
              </p>
            )}
            {promo && settings?.early_bird_note && (
              <p className="mt-1 text-xs text-primary">{settings.early_bird_note}</p>
            )}
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> What the fee covers
            </p>
            <p>
              Hosting and secure data storage, the Previo/channel API connections, the pricing and forecasting engine,
              daily market and competitor data, plus ongoing development and support.
            </p>
          </div>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" />
            {trial
              ? 'Due today: nothing. Billing starts only when your trial ends, and you can cancel any time before that.'
              : 'You can review the total, VAT and company details before confirming.'}
          </p>
          <p className="text-xs text-muted-foreground">
            You can add Housekeeping / Operations and your other properties on the next screen.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={goToPayments}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ActivateModuleDialog;
