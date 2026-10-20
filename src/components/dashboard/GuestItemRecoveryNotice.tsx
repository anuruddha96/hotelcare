import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PackageCheck, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type RequestStatus = 'requested' | 'delivered' | 'returned' | 'resolved' | 'partial_return' | 'not_collected';
type RequestEvent = { status: RequestStatus; actorId: string; at: string; quantity?: number };
type GuestItemPayload = {
  version: 1;
  workDate: string;
  requestType: string;
  label: string;
  quantity: number;
  /** Number already physically recovered in one or more visits. */
  collectedQuantity?: number;
  requiresReturn: boolean;
  status: RequestStatus;
  detail?: string;
  events: RequestEvent[];
};
type NoteRow = { id: string; content: string; created_by: string; is_resolved: boolean };
type Actor = { id: string; role: string | null; full_name: string | null; nickname: string | null };

type Language = 'en' | 'hu' | 'es' | 'vi' | 'mn' | 'ru' | 'uk';

const copy: Record<Language, {
  title: string;
  collect: string;
  collected: string;
  from: Record<string, string>;
  item: Record<string, string>;
  sentence: (actor: string, qty: number, item: string, date: string) => string;
}> = {
  en: {
    title: 'Collect guest item', collect: 'Collected', collected: 'Item marked returned',
    from: { reception: 'Reception', manager: 'Manager', housekeeping: 'Housekeeping', team: 'Hotel team' },
    item: { extra_towels: 'extra towels', extra_pillow: 'extra pillow', blanket: 'blanket', baby_cot: 'baby cot', iron: 'iron', amenities: 'extra amenities', other: 'guest item' },
    sentence: (actor, qty, item, date) => `${actor} gave the guest ${qty} ${item} on ${date}. If you find ${qty === 1 ? 'it' : 'them'}, please collect ${qty === 1 ? 'it' : 'them'}.`,
  },
  hu: {
    title: 'Vendégnek adott tárgy begyűjtése', collect: 'Begyűjtve', collected: 'A tárgy visszavétele rögzítve',
    from: { reception: 'A recepció', manager: 'A vezető', housekeeping: 'A housekeeping', team: 'A szálloda csapata' },
    item: { extra_towels: 'db extra törölközőt', extra_pillow: 'db extra párnát', blanket: 'db takarót', baby_cot: 'db babaágyat', iron: 'db vasalót', amenities: 'db extra bekészítést', other: 'db vendégtárgyat' },
    sentence: (actor, qty, item, date) => `${actor} ${qty} ${item} adott a vendégnek ${date}-én. Ha megtalálod, kérlek gyűjtsd össze.`,
  },
  es: {
    title: 'Recoger artículo del huésped', collect: 'Recogido', collected: 'Artículo marcado como devuelto',
    from: { reception: 'Recepción', manager: 'Gerencia', housekeeping: 'Housekeeping', team: 'El equipo del hotel' },
    item: { extra_towels: 'toallas extra', extra_pillow: 'almohada extra', blanket: 'manta', baby_cot: 'cuna', iron: 'plancha', amenities: 'amenities extra', other: 'artículo' },
    sentence: (actor, qty, item, date) => `${actor} entregó al huésped ${qty} ${item} el ${date}. Si lo encuentras, recógelo antes de cerrar la habitación.`,
  },
  vi: {
    title: 'Thu hồi đồ đã đưa cho khách', collect: 'Đã thu hồi', collected: 'Đã ghi nhận đồ được thu hồi',
    from: { reception: 'Lễ tân', manager: 'Quản lý', housekeeping: 'Bộ phận buồng phòng', team: 'Nhân viên khách sạn' },
    item: { extra_towels: 'khăn tắm thêm', extra_pillow: 'gối thêm', blanket: 'chăn', baby_cot: 'nôi em bé', iron: 'bàn ủi', amenities: 'đồ dùng thêm', other: 'vật dụng' },
    sentence: (actor, qty, item, date) => `${actor} đã đưa cho khách ${qty} ${item} vào ${date}. Nếu bạn tìm thấy, vui lòng thu hồi.`,
  },
  mn: {
    title: 'Зочинд өгсөн зүйлийг хураах', collect: 'Хураасан', collected: 'Буцаан авсныг бүртгэлээ',
    from: { reception: 'Ресепшн', manager: 'Менежер', housekeeping: 'Өрөө үйлчилгээ', team: 'Зочид буудлын баг' },
    item: { extra_towels: 'нэмэлт алчуур', extra_pillow: 'нэмэлт дэр', blanket: 'хөнжил', baby_cot: 'хүүхдийн ор', iron: 'индүү', amenities: 'нэмэлт хэрэгсэл', other: 'зочны зүйл' },
    sentence: (actor, qty, item, date) => `${actor} ${date}-нд зочинд ${qty} ${item} өгсөн. Олбол буцаан хурааж авна уу.`,
  },
  ru: {
    title: 'Забрать выданный гостю предмет', collect: 'Забрано', collected: 'Возврат предмета отмечен',
    from: { reception: 'Ресепшен', manager: 'Менеджер', housekeeping: 'Хаускипинг', team: 'Команда отеля' },
    item: { extra_towels: 'дополнительных полотенца', extra_pillow: 'дополнительную подушку', blanket: 'одеяло', baby_cot: 'детскую кроватку', iron: 'утюг', amenities: 'дополнительные принадлежности', other: 'предмет' },
    sentence: (actor, qty, item, date) => `${actor} выдал гостю ${qty} ${item} ${date}. Если найдёте, пожалуйста, заберите и отметьте возврат.`,
  },
  uk: {
    title: 'Забрати видану гостю річ', collect: 'Забрано', collected: 'Повернення речі позначено',
    from: { reception: 'Рецепція', manager: 'Менеджер', housekeeping: 'Хаускіпінг', team: 'Команда готелю' },
    item: { extra_towels: 'додаткові рушники', extra_pillow: 'додаткову подушку', blanket: 'ковдру', baby_cot: 'дитяче ліжечко', iron: 'праску', amenities: 'додаткові приналежності', other: 'річ' },
    sentence: (actor, qty, item, date) => `${actor} видав гостю ${qty} ${item} ${date}. Якщо знайдете, будь ласка, заберіть і позначте повернення.`,
  },
};

function languageOf(value: string): Language {
  const short = String(value || 'en').toLowerCase().split('-')[0] as Language;
  return short in copy ? short : 'en';
}

function parse(content: string): GuestItemPayload | null {
  try {
    const value = JSON.parse(content) as Partial<GuestItemPayload>;
    if (value.version !== 1 || !value.requestType || !value.workDate || !value.status || !Array.isArray(value.events)) return null;
    return {
      version: 1,
      workDate: value.workDate,
      requestType: value.requestType,
      label: value.label || 'Guest item',
      quantity: Math.max(1, Number(value.quantity) || 1),
      collectedQuantity: Math.max(0, Number(value.collectedQuantity) || 0),
      requiresReturn: !!value.requiresReturn,
      status: value.status,
      detail: value.detail || '',
      events: value.events,
    };
  } catch {
    return null;
  }
}

function actorKind(role?: string | null) {
  const value = String(role || '').toLowerCase();
  if (value === 'reception' || value === 'front_office' || value === 'reception_manager') return 'reception';
  if (['manager', 'admin', 'top_management', 'top_management_manager', 'housekeeping_manager', 'supervisor'].includes(value)) return 'manager';
  if (value === 'housekeeping') return 'housekeeping';
  return 'team';
}

export function GuestItemRecoveryNotice({
  roomId,
  memoriesMode = false,
  readOnly = false,
}: {
  roomId?: string | null;
  /** HMB-only recovery UX; other properties keep their existing behavior. */
  memoriesMode?: boolean;
  /** Managers can monitor the outstanding quantity; collection is for cleaners. */
  readOnly?: boolean;
}) {
  const { user } = useAuth();
  const { language } = useTranslation();
  const lang = languageOf(language);
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [actors, setActors] = useState<Record<string, Actor>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!roomId) return;
    const { data, error } = await supabase
      .from('housekeeping_notes')
      .select('id,content,created_by,is_resolved')
      .eq('room_id', roomId)
      .eq('note_type', 'guest_request')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      console.warn('[GuestItemRecovery] load failed', error);
      setLoadError(true);
      return;
    }
    setLoadError(false);
    const next = (data || []) as NoteRow[];
    setRows(next);
    const actorIds = [...new Set(next.flatMap((row) => {
      const payload = parse(row.content);
      const delivered = payload?.events.filter((event) => event.status === 'delivered').at(-1);
      return [delivered?.actorId || row.created_by];
    }))];
    if (!actorIds.length) return;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id,role,full_name,nickname')
      .in('id', actorIds);
    setActors(Object.fromEntries(((profiles || []) as Actor[]).map((profile) => [profile.id, profile])));
  }, [roomId]);

  useEffect(() => {
    void load();
    if (!roomId) return;
    const channel = supabase
      .channel(`guest-item-recovery-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'housekeeping_notes', filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, roomId]);

  const items = useMemo(() => rows.flatMap((row) => {
    const payload = parse(row.content);
    if (!payload || payload.status !== 'delivered' || !payload.requiresReturn) return [];
    const delivered = payload.events.filter((event) => event.status === 'delivered').at(-1);
    const actorId = delivered?.actorId || row.created_by;
    return [{ row, payload, actor: actors[actorId] }];
  }), [actors, rows]);

  const updateRecovery = async (row: NoteRow, payload: GuestItemPayload, action: 'collected' | 'not_collected') => {
    if (!user?.id || saving || readOnly) return;
    const at = new Date().toISOString();
    const already = Math.min(payload.quantity, Math.max(0, payload.collectedQuantity || 0));
    const outstanding = payload.quantity - already;
    if (outstanding <= 0) return;

    const requested = quantities[row.id] ?? outstanding;
    const amount = memoriesMode
      ? Math.max(1, Math.min(outstanding, Math.floor(Number.isFinite(requested) ? requested : outstanding)))
      : outstanding;
    const recovered = action === 'collected' ? amount : 0;
    const total = already + recovered;
    const fullyReturned = total >= payload.quantity;
    const eventStatus: RequestStatus = action === 'not_collected'
      ? 'not_collected'
      : fullyReturned ? 'returned' : 'partial_return';
    const next: GuestItemPayload = {
      ...payload,
      collectedQuantity: total,
      status: fullyReturned ? 'returned' : 'delivered',
      events: [...payload.events, { status: eventStatus, actorId: user.id, at, ...(recovered ? { quantity: recovered } : {}) }],
    };

    setSaving(row.id);
    try {
      // Compare-and-swap prevents simultaneous cleaners from over-collecting
      // the same items or overwriting another housekeeper's event history.
      const { data, error } = await supabase.from('housekeeping_notes').update({
        content: JSON.stringify(next),
        is_resolved: fullyReturned,
        resolved_by: fullyReturned ? user.id : null,
        resolved_at: fullyReturned ? at : null,
      } as any)
        .eq('id', row.id)
        .eq('content', row.content)
        .eq('is_resolved', false)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) throw new Error('This item was updated by someone else. Please refresh.');
      window.dispatchEvent(new CustomEvent('hc:guest-request-changed', { detail: { roomId } }));
      toast.success(action === 'not_collected'
        ? 'Still pending — this item will remain on the next housekeeping visit.'
        : fullyReturned
          ? copy[lang].collected
          : `${recovered} collected · ${payload.quantity - total} still pending`);
      await load();
      setQuantities((previous) => ({ ...previous, [row.id]: Math.max(1, payload.quantity - total) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the guest item.');
      await load();
    } finally {
      setSaving(null);
    }
  };

  if (loadError && memoriesMode) {
    return <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">Unable to load outstanding guest items. Refresh before closing the room.</p>;
  }
  if (!items.length) return null;

  return (
    <div className="space-y-2" aria-label={memoriesMode ? 'Outstanding items to collect' : undefined}>
      {memoriesMode && <p className="text-xs font-bold text-orange-800 dark:text-orange-200">Extra items to collect · pending until the housekeeper confirms collection</p>}
      {items.map(({ row, payload, actor }) => {
        const kind = actorKind(actor?.role);
        const item = copy[lang].item[payload.requestType] || payload.label;
        const remaining = Math.max(0, payload.quantity - (payload.collectedQuantity || 0));
        const message = copy[lang].sentence(copy[lang].from[kind], memoriesMode ? remaining : payload.quantity, item, payload.workDate);
        return (
          <div key={row.id} className="rounded-lg border-2 border-orange-400 bg-orange-50 p-3 dark:border-orange-600 dark:bg-orange-950/30">
            <div className="flex items-start gap-2">
              <PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300">{copy[lang].title}</p>
                <p className="mt-1 text-sm font-medium text-orange-900 dark:text-orange-100">{message}</p>
                {payload.detail && <p className="mt-1 text-xs text-orange-800/80 dark:text-orange-200/80">{payload.detail}</p>}
                {memoriesMode && (
                  <p className="mt-1 text-xs font-semibold text-orange-900 dark:text-orange-100">
                    Pending: {remaining} of {payload.quantity} · originally issued {payload.workDate}
                  </p>
                )}
                {!readOnly && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {memoriesMode && remaining > 1 && (
                      <label className="flex items-center gap-1 text-xs">
                        Collected quantity
                        <input
                          type="number"
                          min={1}
                          max={remaining}
                          value={quantities[row.id] ?? remaining}
                          onChange={(event) => setQuantities((previous) => ({
                            ...previous,
                            [row.id]: Number(event.target.value),
                          }))}
                          className="h-8 w-16 rounded border bg-background px-2 text-sm"
                          aria-label={`Quantity collected for ${payload.label}`}
                        />
                      </label>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-orange-400 bg-background/80 text-xs"
                      disabled={saving !== null}
                      onClick={() => void updateRecovery(row, payload, 'collected')}
                    >
                      {saving === row.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                      {copy[lang].collect}
                    </Button>
                    {memoriesMode && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-slate-300 text-xs"
                        disabled={saving !== null}
                        onClick={() => void updateRecovery(row, payload, 'not_collected')}
                      >
                        Not collected
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
