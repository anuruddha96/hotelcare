import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocalDateString } from '@/lib/utils';
import { translateLinenItem } from '@/lib/linen-item-i18n';
import { CheckCircle2, Minus, Plus, Shirt } from 'lucide-react';
import { toast } from 'sonner';

export const TOWEL_CHANGE_ONLY_MARKER = '[TOWEL_CHANGE_ONLY]';

interface LinenItem {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  onCompleted?: () => void;
}

const copyFor = (language: string) => {
  switch (language) {
    case 'hu':
      return {
        title: 'Csak törölköző / textília',
        intro: 'A vendég nem kért teljes takarítást. Rögzítsd az elvitt törölközőket vagy textíliát, majd zárd le ezt a korlátozott szolgáltatást.',
        noPhotos: 'Ehhez nem szükséges az öt teljes szobatakarítási fotó. A rendszer ezt nem teljes szobatakarításként rögzíti.',
        count: 'Rögzített darab',
        complete: 'Korlátozott szolgáltatás befejezése',
        needItem: 'A lezárás előtt rögzíts legalább egy törölközőt vagy textíliát.',
        success: 'Törölköző / textília szolgáltatás rögzítve',
        failed: 'A szolgáltatás lezárása sikertelen',
      };
    case 'vi':
      return {
        title: 'Chỉ khăn / đồ vải',
        intro: 'Khách không yêu cầu dọn phòng đầy đủ. Hãy ghi lại khăn hoặc đồ vải đã thu rồi hoàn tất dịch vụ giới hạn này.',
        noPhotos: 'Không cần năm ảnh dọn phòng đầy đủ. Hệ thống sẽ ghi nhận đây không phải là dọn phòng đầy đủ.',
        count: 'Đã ghi nhận',
        complete: 'Hoàn tất dịch vụ giới hạn',
        needItem: 'Hãy ghi nhận ít nhất một khăn hoặc đồ vải trước khi hoàn tất.',
        success: 'Đã ghi nhận dịch vụ khăn / đồ vải',
        failed: 'Không thể hoàn tất dịch vụ',
      };
    case 'mn':
      return {
        title: 'Зөвхөн алчуур / цагаан хэрэглэл',
        intro: 'Зочин бүрэн цэвэрлэгээ хүсээгүй. Авсан алчуур эсвэл цагаан хэрэглэлийг бүртгээд хязгаарлагдмал үйлчилгээг дуусгана уу.',
        noPhotos: 'Бүрэн цэвэрлэгээний таван зураг шаардлагагүй. Систем үүнийг бүрэн өрөө цэвэрлэгээ гэж бүртгэхгүй.',
        count: 'Бүртгэсэн',
        complete: 'Хязгаарлагдмал үйлчилгээг дуусгах',
        needItem: 'Дуусгахаасаа өмнө дор хаяж нэг алчуур эсвэл цагаан хэрэглэл бүртгэнэ үү.',
        success: 'Алчуур / цагаан хэрэглэлийн үйлчилгээ бүртгэгдлээ',
        failed: 'Үйлчилгээг дуусгаж чадсангүй',
      };
    case 'es':
      return {
        title: 'Solo toallas / ropa de cama',
        intro: 'El huésped no solicitó una limpieza completa. Registra las toallas o la ropa recogida y completa este servicio limitado.',
        noPhotos: 'No se requieren las cinco fotos de limpieza completa. El sistema registrará que no fue una limpieza completa.',
        count: 'Registrado',
        complete: 'Completar servicio limitado',
        needItem: 'Registra al menos una toalla o pieza de ropa antes de completar.',
        success: 'Servicio de toallas / ropa registrado',
        failed: 'No se pudo completar el servicio',
      };
    default:
      return {
        title: 'Towels / linen only',
        intro: 'The guest did not require a full room clean. Record the returned towels or linen below, then close this limited service.',
        noPhotos: 'The five full-clean photos are not required for this path. HotelCare records this as a limited service, not a full room clean.',
        count: 'Recorded items',
        complete: 'Complete limited service',
        needItem: 'Record at least one towel or linen item before completing.',
        success: 'Towel / linen service recorded',
        failed: 'Could not complete limited service',
      };
  }
};

export function TowelChangeOnlyDialog({
  open,
  onOpenChange,
  assignmentId,
  roomId,
  roomNumber,
  onCompleted,
}: Props) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const copy = useMemo(() => copyFor(language), [language]);
  const [items, setItems] = useState<LinenItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

  const total = useMemo(
    () => Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [counts],
  );

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;

    (async () => {
      setLoadingItems(true);
      try {
        const today = getLocalDateString(new Date());
        const [{ data: linenItems, error: itemsError }, { data: existing, error: existingError }] = await Promise.all([
          supabase
            .from('dirty_linen_items')
            .select('id, name, display_name, sort_order')
            .eq('is_active', true)
            .order('sort_order'),
          supabase
            .from('dirty_linen_counts')
            .select('linen_item_id, count')
            .eq('housekeeper_id', user.id)
            .eq('room_id', roomId)
            .eq('work_date', today),
        ]);

        if (itemsError) throw itemsError;
        if (existingError) throw existingError;
        if (cancelled) return;

        setItems((linenItems || []) as LinenItem[]);
        setCounts(Object.fromEntries((existing || []).map((row: any) => [row.linen_item_id, row.count || 0])));
      } catch (error) {
        console.error('Could not load towel-only linen data:', error);
        toast.error(copy.failed);
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [copy.failed, open, roomId, user?.id]);

  const updateCount = (id: string, next: number) => {
    setCounts((current) => ({
      ...current,
      [id]: Math.max(0, Number.isFinite(next) ? next : 0),
    }));
  };

  const completeTowelChange = async () => {
    if (!user?.id || !assignmentId) return;
    if (total <= 0) {
      toast.error(copy.needItem);
      return;
    }

    setLoading(true);
    try {
      const { data: fresh, error: freshError } = await supabase
        .from('room_assignments')
        .select('assignment_type, status, notes, room_id')
        .eq('id', assignmentId)
        .eq('room_id', roomId)
        .maybeSingle();

      if (freshError || !fresh) throw freshError || new Error('Assignment not found');
      if (fresh.assignment_type !== 'daily_cleaning' || fresh.status !== 'in_progress') {
        throw new Error('Towel / linen only completion is available only for an active daily room');
      }

      const today = getLocalDateString(new Date());
      for (const item of items) {
        const count = counts[item.id] || 0;
        if (count > 0) {
          const { error } = await supabase
            .from('dirty_linen_counts')
            .upsert(
              {
                housekeeper_id: user.id,
                room_id: roomId,
                assignment_id: assignmentId,
                linen_item_id: item.id,
                count,
                work_date: today,
              },
              {
                onConflict: 'housekeeper_id,room_id,linen_item_id,work_date',
                ignoreDuplicates: false,
              },
            );
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('dirty_linen_counts')
            .delete()
            .eq('housekeeper_id', user.id)
            .eq('room_id', roomId)
            .eq('linen_item_id', item.id)
            .eq('work_date', today);
          if (error) throw error;
        }
      }

      const noteLine = `${TOWEL_CHANGE_ONLY_MARKER} Guest requested limited towel / linen service only; returned items were recorded. Full room cleaning was not performed and full-clean photos were intentionally not required.`;
      const existingNotes = String(fresh.notes || '').trim();
      const notes = existingNotes.includes(TOWEL_CHANGE_ONLY_MARKER)
        ? existingNotes
        : [existingNotes, noteLine].filter(Boolean).join('\n');

      const { error: completionError } = await supabase
        .from('room_assignments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          notes,
        })
        .eq('id', assignmentId)
        .eq('status', 'in_progress');

      if (completionError) throw completionError;

      const { error: noteError } = await supabase
        .from('housekeeping_notes')
        .insert({
          room_id: roomId,
          assignment_id: assignmentId,
          content: 'Limited towel / linen service completed. Dirty towels/linen recorded; no full room clean was performed.',
          note_type: 'general',
          created_by: user.id,
        });

      if (noteError) {
        console.warn('Could not add towel-only audit note:', noteError);
      }

      toast.success(`${copy.success} — ${t('common.room')} ${roomNumber}`);
      onOpenChange(false);
      onCompleted?.();
    } catch (error: any) {
      console.error('Towel / linen only completion failed:', error);
      toast.error(copy.failed, { description: error?.message || undefined });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[92dvh] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 pr-8 text-lg">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">🧺</span>
            <span>{copy.title} — {t('common.room')} {roomNumber}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto px-4 py-4 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-3 space-y-2 dark:bg-cyan-950/20 dark:border-cyan-900">
            <p className="text-sm font-medium text-cyan-950 dark:text-cyan-100">{copy.intro}</p>
            <p className="text-xs leading-relaxed text-cyan-800 dark:text-cyan-200">{copy.noPhotos}</p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{copy.count}</span>
            <Badge variant="outline">{total}</Badge>
          </div>

          {loadingItems ? (
            <div className="py-8 text-center text-sm text-muted-foreground">…</div>
          ) : (
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
              {items.map((item) => {
                const value = counts[item.id] || 0;
                const raw = item.display_name || item.name.replace(/_/g, ' ');
                return (
                  <div key={item.id} className="rounded-xl border bg-card p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Shirt className="h-4 w-4 text-cyan-700 mt-0.5 shrink-0" />
                      <Label className="text-sm leading-tight">{translateLinenItem(raw, t)}</Label>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 w-10 p-0"
                        disabled={value <= 0 || loading}
                        onClick={() => updateCount(item.id, value - 1)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={value}
                        disabled={loading}
                        onChange={(event) => updateCount(item.id, parseInt(event.target.value, 10) || 0)}
                        className="h-10 min-w-0 flex-1 text-center"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 w-10 p-0"
                        disabled={loading}
                        onClick={() => updateCount(item.id, value + 1)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 border-t p-4 bg-background">
          <Button
            onClick={completeTowelChange}
            disabled={loading || loadingItems || total <= 0}
            className="min-h-11 bg-cyan-700 hover:bg-cyan-800 text-white"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {loading ? '…' : copy.complete}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="min-h-11">
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
