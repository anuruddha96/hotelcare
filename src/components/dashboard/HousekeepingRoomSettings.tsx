import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { CHECKOUT_DURATION_EXAMPLES, HOUSEKEEPING_ROOM_SIZES, ROOM_SIZE_LABELS, type HousekeepingRoomSize } from '@/lib/housekeepingRoomSizing';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { buildGozsduRoomRegistryIndex, type GozsduRoomRegistryEntry } from '@/lib/gozsduRoomRegistryDisplay';

type Room = { id: string; room_number: string; cleaning_size: HousekeepingRoomSize | null; verified_bed_count: number | null; service_status?: string | null };
type Target = { cleaning_size: HousekeepingRoomSize; assignment_type: string; duration_minutes: number };
const roles = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];
const cleaningTypes = [
  ['checkout_cleaning', 'Checkout'], ['daily_cleaning', 'Daily / stayover'], ['deep_cleaning', 'Deep cleaning'],
] as const;

/** A compact, opt-in panel; no existing task, room, PMS or timer is mutated on mount. */
export function HousekeepingRoomSettings() {
  const { profile } = useAuth();
  const { organization, hotels } = useTenant();
  const [open, setOpen] = useState(false);
  const [hotelId, setHotelId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const allowed = Boolean(profile && (roles.includes(profile.role) || profile.is_super_admin));
  const organizationSlug = organization?.slug || profile?.organization_slug || '';
  const assigned = profile?.assigned_hotel || '';
  const choices = useMemo(() => {
    const acrossHotels = profile?.is_super_admin || ['admin', 'top_management', 'top_management_manager'].includes(profile?.role || '');
    return acrossHotels ? hotels : hotels.filter(h => assigned === h.hotel_id || assigned === h.hotel_name);
  }, [hotels, assigned, profile?.role, profile?.is_super_admin]);
  const selected = choices.find(h => h.id === hotelId) || null;
  const isGozsdu = !!selected && (isGozsduCourtHotel(selected.hotel_id) || isGozsduCourtHotel(selected.hotel_name));

  useEffect(() => {
    if (!open) return;
    if (!choices.some(h => h.id === hotelId)) {
      const first = choices.find(h => [h.hotel_id, h.hotel_name].includes(assigned)) || choices[0];
      setHotelId(first?.id || '');
    }
  }, [open, hotelId, choices, assigned]);

  useEffect(() => {
    if (!open || !selected || !organizationSlug) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      const [roomsResult, targetsResult, registryResult] = await Promise.all([
        (supabase as any).from('rooms').select('id,room_number,cleaning_size,verified_bed_count')
          .eq('organization_slug', organizationSlug).in('hotel', [selected.hotel_id, selected.hotel_name]).order('room_number'),
        (supabase as any).from('hotel_cleaning_time_targets').select('cleaning_size,assignment_type,duration_minutes')
          .eq('hotel_configuration_id', selected.id),
        isGozsdu ? (supabase as any).from('gozsdu_housekeeping_room_registry')
          .select('room_id,pms_room_name,service_status')
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      if (roomsResult.error || targetsResult.error || registryResult.error) {
        toast.error('Could not load hotel room settings or verify Gozsdu PMS names');
        setRooms([]); setTargets([]);
      } else {
        try {
          const sourceRooms = (roomsResult.data || []) as Room[];
          if (isGozsdu) {
            const registry = buildGozsduRoomRegistryIndex(sourceRooms, (registryResult.data || []) as GozsduRoomRegistryEntry[]);
            // Display-only projection: keep real DB room numbers and all stable room IDs unchanged.
            setRooms(sourceRooms.map(room => ({ ...room,
              room_number: registry.get(room.id)!.pms_room_name,
              service_status: registry.get(room.id)!.service_status,
            })).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })));
          } else setRooms(sourceRooms);
          setTargets(targetsResult.data || []);
        } catch (error) {
          console.error('[HousekeepingRoomSettings] Gozsdu room registry not verified', error);
          toast.error('Gozsdu room names are not fully verified. Mapping is blocked until the PMS registry is complete.');
          setRooms([]); setTargets([]);
        }
      }
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [open, selected?.id, organizationSlug, isGozsdu]);

  async function saveRoom(room: Room, patch: Partial<Pick<Room, 'cleaning_size' | 'verified_bed_count'>>) {
    if (!selected || saving) return;
    setSaving(true);
    const { data, error } = await (supabase as any).from('rooms').update(patch)
      .eq('id', room.id).eq('organization_slug', organizationSlug)
      .in('hotel', [selected.hotel_id, selected.hotel_name]).select('id').maybeSingle();
    if (error || !data) toast.error('Room mapping could not be saved');
    else {
      setRooms(rows => rows.map(r => r.id === room.id ? { ...r, ...patch } : r));
      toast.success('Room mapping saved');
    }
    setSaving(false);
  }

  async function saveTarget(size: HousekeepingRoomSize, type: string, minutes: number) {
    if (!selected || saving || !Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
      toast.error('Enter 1–480 minutes'); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from('hotel_cleaning_time_targets').upsert({
      hotel_configuration_id: selected.id, cleaning_size: size, assignment_type: type,
      duration_minutes: minutes, updated_at: new Date().toISOString(), updated_by: profile?.id,
    }, { onConflict: 'hotel_configuration_id,cleaning_size,assignment_type' });
    if (error) toast.error('Cleaning time could not be saved');
    else {
      setTargets(previous => [...previous.filter(t => !(t.cleaning_size === size && t.assignment_type === type)),
        { cleaning_size: size, assignment_type: type, duration_minutes: minutes }]);
      toast.success('Cleaning time saved');
    }
    setSaving(false);
  }

  if (!allowed) return null;
  return <section className="rounded-xl border bg-card p-3 space-y-3">
    <Button type="button" variant="outline" onClick={() => setOpen(value => !value)} aria-expanded={open} className="w-full sm:w-auto">
      <Settings2 className="w-4 h-4 mr-2" /> Room sizes & cleaning times
    </Button>
    {open && <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Manager-only settings for one hotel. Confirm actual beds; guest capacity is not bed count. Existing jobs stay unchanged.{isGozsdu ? ' Gozsdu displays full verified Previo apartment names. Unavailable units remain visible for reference but never enter Auto Assign.' : ''}</p>
      {choices.length > 1 && <Select value={hotelId} onValueChange={setHotelId}>
        <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Choose hotel" /></SelectTrigger>
        <SelectContent>{choices.map(h => <SelectItem key={h.id} value={h.id}>{h.hotel_name}</SelectItem>)}</SelectContent>
      </Select>}
      {loading ? <p role="status">Loading hotel mapping…</p> : selected ? <>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{cleaningTypes.map(([type, label]) => <div key={type} className="rounded-lg border p-3 space-y-2">
          <h3 className="font-semibold text-sm">{label} · minutes</h3>
          {HOUSEKEEPING_ROOM_SIZES.map(size => <TargetRow key={`${size}-${type}`} size={size} type={type}
            initial={targets.find(t => t.cleaning_size === size && t.assignment_type === type)?.duration_minutes ?? (type === 'checkout_cleaning' ? CHECKOUT_DURATION_EXAMPLES[size] : null)}
            disabled={saving} onSave={minutes => void saveTarget(size, type, minutes)} />)}
        </div>)}</div>
        <h3 className="font-semibold text-sm">{selected.hotel_name} · room mapping</h3>
        <div className="max-h-[24rem] overflow-y-auto rounded-lg border divide-y">{rooms.map(room => <div key={room.id} className="flex flex-wrap items-center gap-2 p-2.5">
          <strong className="text-sm w-28 break-all">{room.room_number}</strong>
          {isGozsdu && room.service_status !== 'operating' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">{room.service_status === 'non_guest' ? 'Private apartment' : 'Not available'}</span>}
          <Select disabled={saving} value={room.cleaning_size || 'unmapped'} onValueChange={value => void saveRoom(room, { cleaning_size: value === 'unmapped' ? null : value as HousekeepingRoomSize })}>
            <SelectTrigger aria-label={`Size for room ${room.room_number}`} className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="unmapped">Size not mapped</SelectItem>{HOUSEKEEPING_ROOM_SIZES.map(size => <SelectItem key={size} value={size}>{ROOM_SIZE_LABELS[size]}</SelectItem>)}</SelectContent>
          </Select>
          <Select disabled={saving} value={String(room.verified_bed_count ?? 'unknown')} onValueChange={value => void saveRoom(room, { verified_bed_count: value === 'unknown' ? null : Number(value) })}>
            <SelectTrigger aria-label={`Actual beds for room ${room.room_number}`} className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="unknown">Beds unverified</SelectItem>{Array.from({ length: 20 }, (_, i) => <SelectItem key={i+1} value={String(i+1)}>{i+1} bed{i ? 's' : ''}</SelectItem>)}</SelectContent>
          </Select>
        </div>)}{!rooms.length && <p className="text-xs p-3">No rooms mapped to this hotel.</p>}</div>
      </> : <p className="text-xs text-muted-foreground">No accessible hotel selected.</p>}
    </div>}
  </section>;
}

function TargetRow({ size, type, initial, disabled, onSave }: { size: HousekeepingRoomSize; type: string; initial: number | null; disabled: boolean; onSave: (value: number) => void }) {
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  useEffect(() => setValue(initial === null ? '' : String(initial)), [initial, size, type]);
  return <div className="flex items-center gap-2">
    <label className="text-xs flex-1" htmlFor={`${type}-${size}`}>{ROOM_SIZE_LABELS[size]}</label>
    <Input id={`${type}-${size}`} className="w-20 h-9" type="number" min={1} max={480} value={value} onChange={e => setValue(e.target.value)} placeholder="—" />
    <Button type="button" variant="outline" size="sm" disabled={disabled || !value || Number(value) === initial} onClick={() => onSave(Number(value))}>Save</Button>
  </div>;
}
