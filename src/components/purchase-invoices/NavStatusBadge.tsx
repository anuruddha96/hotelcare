import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import { navStatusTone, TONE_CLASSES } from '@/lib/purchaseInvoiceNav';
import { cn } from '@/lib/utils';

export function NavStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const { t } = useTranslation();
  const value = status || 'not_checked';
  return (
    <Badge variant="outline" className={cn('text-[10px] font-medium whitespace-nowrap', TONE_CLASSES[navStatusTone(value)], className)}>
      {t(`pi.nav.status.${value}`)}
    </Badge>
  );
}
