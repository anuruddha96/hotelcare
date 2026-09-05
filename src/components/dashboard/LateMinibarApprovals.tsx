import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Wine, Check, X, Loader2, Clock, MapPin, User, DoorClosed } from 'lucide-react';
import { format } from 'date-fns';

interface LateMinibarRow {
  id: string;
  room_id: string;
  quantity_used: number;
  usage_date: string;
  recorded_by: string | null;
  added_after_completion: boolean;
  pending_supervisor_review: boolean;
  refill_status?: string | null;
  refill_blocked_reason?: string | null;
  refill_blocked_at?: string | null;
  previo_charge_confirmed_at?: string | null;
  rooms: { room_number: string; hotel: string } | null;
  minibar_items: { name: string; price: number; category: string } | null;
  recorded_by_profile?: { full_name: string; nickname: string | null } | null;
}

export function LateMinibarApprovals() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<LateMinibarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    if (!profile?.organization_slug) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data, error } = await (supabase as any)
      .from('room_minibar_usage')
      .select(`
        id,
        room_id,
        quantity_used,
        usage_date,
        recorded_by,
        added_after_completion,
        pending_supervisor_review,
        refill_status,
        refill_blocked_reason,
        refill_blocked_at,
        previo_charge_confirmed_at,
        rooms:room_id ( room_number, hotel ),
        minibar_items:minibar_item_id ( name, price, category )
      `)
      .or('pending_supervisor_review.eq.true,refill_status.eq.blocked_guest_inside')
      .eq('organization_slug', profile.organization_slug)
      .order('usage_date', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Minibar follow-up fetch error', error);
      setItems([]);
      setLoading(false);
      return;
    }

    // Filter by assigned hotel using the same alias resolver as the approvals
    // badge, so a slug/display-name mismatch cannot leak or hide another hotel.
    const assignedHotel = profile.assigned_hotel;
    const hotelKeys = assignedHotel ? await resolveHotelKeys(assignedHotel) : [];
    if (assignedHotel && hotelKeys.length === 0) hotelKeys.push(assignedHotel);
    const hotelKeySet = new Set(hotelKeys);
    const filtered = (data as any[] | null || []).filter((r) => {
      const h = r.rooms?.hotel;
      return !!h && hotelKeySet.has(h);
    });

    // Look up housekeeper names in a single follow-up query
    const userIds = Array.from(
      new Set(filtered.map((r) => r.recorded_by).filter(Boolean) as string[])
    );
    let nameMap: Record<string, { full_name: string; nickname: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .in('id', userIds);
      (profs || []).forEach((p: any) => {
        nameMap[p.id] = { full_name: p.full_name, nickname: p.nickname };
      });
    }

    setItems(
      filtered.map((r) => ({
        ...r,
        recorded_by_profile: r.recorded_by ? nameMap[r.recorded_by] || null : null,
      })) as LateMinibarRow[]
    );
    setLoading(false);
  }, [profile?.organization_slug, profile?.assigned_hotel]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const approve = async (row: LateMinibarRow) => {
    setActingId(row.id);
    const { error } = await (supabase as any)
      .from('room_minibar_usage')
      .update({
        pending_supervisor_review: false,
        reviewed_by: profile?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    setActingId(null);
    if (error) {
      toast.error(t('common.error'));
      return;
    }
    toast.success(t('minibar.lateApproved'));
    setItems((prev) => prev.filter((i) => i.id !== row.id));
  };

  const reject = async (row: LateMinibarRow) => {
    if (!confirm(`${t('minibar.rejectLate')}?`)) return;
    setActingId(row.id);
    const { error } = await supabase.from('room_minibar_usage').delete().eq('id', row.id);
    setActingId(null);
    if (error) {
      toast.error(t('common.error'));
      return;
    }
    toast.success(t('minibar.lateRejected'));
    setItems((prev) => prev.filter((i) => i.id !== row.id));
  };

  const markRefilled = async (row: LateMinibarRow) => {
    setActingId(row.id);
    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from('room_minibar_usage')
      .update({
        is_cleared: true,
        cleared_at: now,
        cleared_by: profile?.id ?? null,
        refill_status: 'refilled',
        refill_resolved_at: now,
        refill_resolved_by: profile?.id ?? null,
      })
      .eq('id', row.id)
      .eq('refill_status', 'blocked_guest_inside');
    setActingId(null);
    if (error) {
      console.error('Failed to resolve blocked minibar refill', error);
      toast.error(t('common.error'));
      return;
    }
    toast.success('Minibar marked as refilled. The Previo charge is already recorded — no second charge is needed.');
    setItems((prev) => prev.filter((i) => i.id !== row.id));
  };

  const blockedCount = items.filter((i) => i.refill_status === 'blocked_guest_inside').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Wine className="h-5 w-5 text-amber-600" />
          Minibar follow-up
          {items.length > 0 && (
            <Badge variant="secondary" className="ml-2">{items.length}</Badge>
          )}
          {blockedCount > 0 && (
            <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">
              {blockedCount} refill pending
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Review late minibar entries and rooms that were charged in Previo but could not be physically refilled because access was blocked.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> {t('common.loading')}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No minibar follow-up is pending.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((row) => {
              const total = (row.minibar_items?.price || 0) * row.quantity_used;
              const isRefillBlocked = row.refill_status === 'blocked_guest_inside';
              return (
                <div
                  key={row.id}
                  className={`border rounded-lg p-3 ${
                    isRefillBlocked ? 'bg-orange-50/70 border-orange-300' : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">
                          {t('common.hotel')}: {row.rooms?.hotel || '—'}
                        </span>
                        <span>•</span>
                        <span className="font-semibold">Room {row.rooms?.room_number || '—'}</span>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">{row.minibar_items?.name || 'Item'}</span>
                        <span className="text-muted-foreground"> × {row.quantity_used}</span>
                        <span className="ml-2">€{total.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {row.recorded_by_profile?.full_name || '—'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(row.usage_date), 'MMM dd, HH:mm')}
                        </span>
                        {isRefillBlocked ? (
                          <>
                            <Badge variant="outline" className="text-xs border-orange-400 bg-orange-100 text-orange-800 gap-1">
                              <DoorClosed className="h-3 w-3" />
                              Refill pending — guest was inside
                            </Badge>
                            {row.previo_charge_confirmed_at && (
                              <Badge variant="outline" className="text-xs border-emerald-300 bg-emerald-50 text-emerald-800">
                                ✓ Charge already confirmed in Previo
                              </Badge>
                            )}
                            {row.refill_blocked_at && (
                              <span>Blocked {format(new Date(row.refill_blocked_at), 'MMM dd, HH:mm')}</span>
                            )}
                          </>
                        ) : (
                          <Badge variant="outline" className="text-xs border-amber-400 text-amber-700">
                            {t('minibar.addedAfterCompletion')}
                          </Badge>
                        )}
                      </div>
                      {isRefillBlocked && (
                        <p className="text-xs text-orange-900 mt-1">
                          Refill this minibar when room access is possible. Do not add the same charge to Previo again.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {isRefillBlocked ? (
                        <Button
                          size="sm"
                          variant="default"
                          disabled={actingId === row.id}
                          onClick={() => markRefilled(row)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {actingId === row.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                          Mark refilled
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            disabled={actingId === row.id}
                            onClick={() => approve(row)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Check className="h-4 w-4 mr-1" />
                            {t('minibar.approveLate')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actingId === row.id}
                            onClick={() => reject(row)}
                            className="border-red-300 text-red-700 hover:bg-red-50"
                          >
                            <X className="h-4 w-4 mr-1" />
                            {t('minibar.rejectLate')}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
