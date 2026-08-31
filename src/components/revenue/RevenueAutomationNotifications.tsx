import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Bot, User as UserIcon, ArrowRight, Info, ArrowUpRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  type AutomationDecision,
} from '@/hooks/useRevenueAutomationNotifications';
import {
  runHeadline,
  runPreview,
  runReasons,
  runStats,
  runStatus,
} from '@/lib/revenue/automationSummary';
import { ReasonSettingEditor } from '@/components/revenue/ReasonSettingEditor';
import { reasonInfo } from '@/lib/revenue/reasonSettings';


const money = (value: number | null | undefined, currency: string | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : `${Math.round(Number(value))} ${currency ?? ''}`.trim();


/** Bell + inbox for revenue price-automation activity. */
export function RevenueAutomationNotifications() {
  const canSee = useCanSeeAutomationNotifications();
  const navigate = useNavigate();
  const { items, unreadCount, markRead, markAllRead, loadDecisions } = useRevenueAutomationNotifications(canSee);

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AutomationNotification | null>(null);
  const [decisions, setDecisions] = useState<AutomationDecision[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(false);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
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
    setDecisions([]);
    setDecisionsError(null);
    if (!item.read) void markRead(item.id);
    if (item.automation_run_id) {
      setDecisionsLoading(true);
      void loadDecisions(item.automation_run_id)
        .then(setDecisions)
        .catch(() => setDecisionsError('The date-by-date breakdown could not be loaded.'))
        .finally(() => setDecisionsLoading(false));
    }
  };

  const reasonCounts = decisions.reduce<Record<string, number>>((counts, row) => {
    const key = row.decision_reason || 'other';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

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
                    {runPreview(item)}
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
              {detail?.hotel_name} — price update
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${detail.run_source === 'automatic' ? 'Run automatically' : `Started by ${detail.actor_name}`} · ${relativeTime(detail.created_at)}`
                : ''}
            </DialogDescription>

          </DialogHeader>

          {detail && (
            <>
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-sm font-medium">{runHeadline(detail)}</p>
                <p
                  className={cn(
                    'mt-0.5 text-xs',
                    runStatus(detail).tone === 'attention' ? 'text-destructive font-medium' : 'text-muted-foreground',
                  )}
                >
                  {runStatus(detail).text}
                </p>
                {runReasons(detail).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {runReasons(detail).map((reason) => (
                      <Tooltip key={reason.label}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {reason.label}
                            <Info className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[260px] text-xs">{reason.explain}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(detail.run ? [
                  { label: 'Dates checked', value: detail.run.dates_evaluated },
                  { label: 'Increased', value: detail.run.dates_increased },
                  { label: 'Decreased', value: detail.run.dates_decreased },
                  detail.run.mode === 'shadow'
                    ? { label: 'Cells simulated', value: decisions.reduce((sum, row) => sum + row.cells_simulated, 0) }
                    : detail.run.cells_failed > 0
                      ? { label: 'Failed', value: detail.run.cells_failed, danger: true }
                      : detail.run.cells_verified > 0
                        ? { label: 'Confirmed', value: detail.run.cells_verified }
                        : detail.run.cells_published > 0
                          ? { label: 'Accepted', value: detail.run.cells_published }
                          : { label: 'Cells queued', value: detail.run.cells_queued },
                ] : runStats(detail)).map((kpi) => (
                  <div
                    key={kpi.label}
                    className={cn(
                      'rounded-lg border p-2 text-center',
                      'danger' in kpi && kpi.danger && 'border-destructive/50 bg-destructive/5',
                    )}
                  >
                    <div className="text-lg font-semibold">{kpi.value.toLocaleString()}</div>
                    <div className="text-[11px] text-muted-foreground">{kpi.label}</div>
                  </div>
                ))}
              </div>

              {detail.run && (
                <div className={cn('rounded-lg border px-3 py-2 text-xs', detail.run.mode === 'shadow' ? 'border-primary/30 bg-primary/5' : 'bg-muted/30')}>
                  <p className="font-medium">
                    {detail.run.mode === 'shadow'
                      ? 'Review only — no prices were sent to Previo.'
                      : detail.run.status === 'completed'
                        ? runStatus(detail).text
                        : `Run status: ${detail.run.status.replace(/_/g, ' ')}`}
                  </p>
                  {detail.run.failure_reason && <p className="mt-1 text-destructive">{detail.run.failure_reason}</p>}
                </div>
              )}

              {decisions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(reasonCounts).map(([reason, count]) => (
                    <Badge key={reason} variant="outline" className="text-[10px] font-normal">
                      {reason.replace(/_/g, ' ')} · {count}
                    </Badge>
                  ))}
                </div>
              )}

              {decisionsLoading ? (
                <div className="flex min-h-28 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading run breakdown…
                </div>
              ) : decisionsError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{decisionsError}</div>
              ) : decisions.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="text-left">
                        <th className="px-2 py-1.5 font-medium">Stay date</th>
                        <th className="px-2 py-1.5 font-medium">Decision</th>
                        <th className="px-2 py-1.5 font-medium">Price</th>
                        <th className="px-2 py-1.5 font-medium">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decisions.map((row) => (
                        <tr key={row.id} className="border-t align-top">
                          <td className="px-2 py-2 whitespace-nowrap">{row.stay_date}</td>
                          <td className="px-2 py-2 capitalize">{row.direction}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {row.current_price == null ? '—' : money(row.current_price, detail.currency)}
                            {row.target_price != null && row.target_price !== row.current_price && (
                              <><ArrowRight className="mx-1 inline h-3 w-3" /><span className="font-medium">{money(row.target_price, detail.currency)}</span></>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <p className="font-medium">{reasonInfo(row.decision_reason).title}</p>
                            <p className="mt-0.5 text-muted-foreground">{reasonInfo(row.decision_reason).explain}</p>
                            {row.movement !== 0 && row.cells_simulated > 0 && (
                              <p className="mt-0.5">
                                All {row.cells_simulated} price{row.cells_simulated === 1 ? '' : 's'} moved by the same {row.movement > 0 ? '+' : '−'}
                                {money(Math.abs(row.movement), detail.currency)}
                                {row.limited_by_room_type
                                  ? ` (reduced from ${money(Math.abs(row.movement_requested ?? row.movement), detail.currency)} so ${row.limited_by_room_type} stays inside its limits)`
                                  : ''}
                              </p>
                            )}
                            {row.reason_detail && <p className="mt-0.5 text-muted-foreground">{row.reason_detail}</p>}
                            <div className="mt-1">
                              <ReasonSettingEditor
                                hotelId={detail.hotel_id}
                                hotelName={detail.hotel_name}
                                reason={row.decision_reason}
                                stayDate={row.stay_date}
                                currency={detail.currency}
                                compact
                              />
                            </div>
                          </td>


                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : detail.changes.length > 0 ? (
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
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    This run applied a rule across the whole calendar, so the prices are summarised here rather
                    than listed one by one.
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3 gap-1.5"
                    onClick={() => {
                      const slug = detail.organization_slug;
                      setDetail(null);
                      setOpen(false);
                      navigate(slug ? `/${slug}/revenue/${detail.hotel_id}` : `/revenue/${detail.hotel_id}`);
                    }}
                  >
                    Open the rate calendar
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </>
          )}

        </DialogContent>
      </Dialog>
    </>
  );
}
