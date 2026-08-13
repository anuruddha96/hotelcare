import { useEffect, useRef, useState } from 'react';
import { Bell, AlertTriangle, Bot, User as UserIcon, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useCanSeeAutomationNotifications,
  useRevenueAutomationNotifications,
  relativeTime,
  type AutomationNotification,
} from '@/hooks/useRevenueAutomationNotifications';

const money = (value: number | null | undefined, currency: string | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : `${Math.round(Number(value))} ${currency ?? ''}`.trim();

/** Bell + inbox for revenue price-automation activity. */
export function RevenueAutomationNotifications() {
  const canSee = useCanSeeAutomationNotifications();
  const { items, unreadCount, markRead, markAllRead } = useRevenueAutomationNotifications(canSee);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AutomationNotification | null>(null);
  const welcomed = useRef(false);

  // One tasteful catch-up message per session — never one toast per change.
  useEffect(() => {
    if (!canSee || welcomed.current || unreadCount === 0) return;
    welcomed.current = true;
    const unread = items.filter((n) => !n.read);
    const prices = unread.reduce((sum, n) => sum + (n.actions_count || n.changes.length), 0);
    toast.message(
      `While you were away, HotelCare updated ${prices} price${prices === 1 ? '' : 's'} across ${unread.length} automation run${unread.length === 1 ? '' : 's'}`,
      {
        action: { label: 'View', onClick: () => setOpen(true) },
        duration: 10_000,
      },
    );
  }, [canSee, unreadCount, items]);

  if (!canSee) return null;

  const openDetail = (item: AutomationNotification) => {
    setDetail(item);
    if (!item.read) void markRead(item.id);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-9 sm:w-9 shrink-0" aria-label="Pricing notifications">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] sm:w-[400px] p-0">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">Pricing activity</span>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void markAllRead()}>
                Mark all read
              </Button>
            )}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {items.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No automation activity yet.</p>
            )}
            {items.map((item) => {
              const failed = item.failed_count > 0;
              return (
                <button
                  key={item.id}
                  onClick={() => openDetail(item)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/60 transition',
                    !item.read && 'bg-primary/5',
                    failed && 'bg-destructive/5 hover:bg-destructive/10',
                  )}
                >
                  <div className="flex items-center gap-2">
                    {failed ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : item.run_source === 'automatic' ? (
                      <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <UserIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm font-medium truncate">{item.hotel_name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                      {item.run_source === 'automatic' ? 'Automatic' : 'Manual'}
                    </Badge>
                    <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                      {relativeTime(item.created_at)}
                    </span>
                  </div>
                  <p className={cn('mt-1 text-xs', failed ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                    {failed
                      ? `${item.failed_count} price${item.failed_count === 1 ? '' : 's'} need attention · ${item.pushed_count} sent`
                      : item.summary ??
                        `${item.changes.length} prices changed · ${item.pushed_count} sent · 0 failed`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{item.actor_name}</p>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.failed_count ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <Bell className="h-4 w-4" />}
              {detail?.hotel_name} — pricing run
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${detail.run_source === 'automatic' ? 'Automatic automation' : 'Manual run'} by ${detail.actor_name} · ${relativeTime(detail.created_at)}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Pickups', value: detail.pickups_count },
                  { label: 'Cells', value: detail.actions_count },
                  { label: 'Sent', value: detail.pushed_count },
                  { label: 'Failed', value: detail.failed_count },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className={cn(
                      'rounded-lg border p-2 text-center',
                      kpi.label === 'Failed' && detail.failed_count > 0 && 'border-destructive/50 bg-destructive/5',
                    )}
                  >
                    <div className="text-lg font-semibold">{kpi.value}</div>
                    <div className="text-[11px] text-muted-foreground">{kpi.label}</div>
                  </div>
                ))}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 font-medium">Stay date</th>
                      <th className="px-2 py-1.5 font-medium">Room type</th>
                      <th className="px-2 py-1.5 font-medium">Guests</th>
                      <th className="px-2 py-1.5 font-medium">Price</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.changes.map((row, index) => (
                      <tr key={`${row.stay_date}-${index}`} className="border-t">
                        <td className="px-2 py-1.5 whitespace-nowrap">{row.stay_date}</td>
                        <td className="px-2 py-1.5">{row.room_type_name ?? '—'}</td>
                        <td className="px-2 py-1.5">{row.occupancy ?? '—'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="text-muted-foreground">{money(row.old_price, row.currency ?? detail.currency)}</span>
                          <ArrowRight className="inline h-3 w-3 mx-1" />
                          <span className="font-medium">{money(row.new_price, row.currency ?? detail.currency)}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge
                            variant={row.status === 'failed' ? 'destructive' : row.status === 'pushed' ? 'default' : 'secondary'}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {row.status ?? 'pending'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {detail.changes.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                          No individual price rows recorded for this run.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
