import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { CHECKOUT_DURATION_EXAMPLES, HOUSEKEEPING_ROOM_SIZES, ROOM_SIZE_LABELS, type HousekeepingRoomSize } from '@/lib/housekeepingRoomSizing';

type Room = { id: string; hotel: string; organization_slug: string; room_number: string; cleaning_size: HousekeepingRoomSize | null; verified_bed_count: number | null };
type Target = { cleaning_size: HousekeepingRoomSize; assignment_type: string; duration_minutes: number };
const roles = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];
const cleaningTypes = [
  ['checkout_cleaning', 'Checkout'], ['daily_cleaning', 'Daily / stayover'], ['deep_cleaning', 'Deep cleaning'],
] as const;

/** Compact, deliberately opt-in settings: never changes a room, a live timer or a PMS field on mount. */
export function HousekeepingRoomSettings() {
  const { profile } = useAuth();
  const { hotels } = useTenant();
  const [open, setOpen] = useState(false);
  const [hotelId, setHotelId] = useState('');
  const [hotelName, setHotelName] = useState('');
  const [configId, setConfigId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const allowed = Boolean(profile && (roles.includes(profile.role) || profile.is_super_admin));
  const assigned = profile?.assigned_hotel || '';

  const hotelChoices = useMemo(() => {
    // Admins can pick other properties only in their own tenant. Ordinary managers
    // never get a cross-hotel selector; backend RLS/trigger remains authoritative.
    const all = (hotels || []) as Array<{ id?: string; name?: string }>;
    return profile?.role === 'admin' || profile?.role === 'top_management' || profile?.role === 'top_management_manager' || profile?.is_super_admin
      ? all.filter(h => !!h.id && !!h.name)
      : all.filter(h => h.id === assigned || h.name === assigned);
  }, [hotels, profile?.role, profile?.is_super_admin, assigned]);

  useEffect(() => {
    if (!open || !allowed) return;
    const choice = hotelChoices.find(h => h.id === assigned || h.name === assigned) || hotelChoices[0];
    if (choice && !hotelId) setHotelId(choice.id || '');
  }, [open, allowed, hotelChoices, assigned, hotelId]);

  const refresh = useCallback(async () => {
    if (!open || !hotelId || !profile?.organization_slug) return;
    setLoading(true);
    try {
      const config = await supabase.from('hotel_configurations').select('id,hotel_id,hotel_name').eq('hotel_id', hotelId).maybeSingle();
      if (config.error || !config.data) throw config.error || new Error('Hotel configuration unavailable');
      const hotel = config.data;
      const roomResult = await (supabase as any).from('rooms')
        .select('id,hotel,organization_slug,room_number,cleaning_size,verified_bed_count')
        .eq('organization_slug', profile.organization_slug).in('hotel', [hotel.hotel_id, hotel.hotel_name]).order('room_number');
      if (roomResult.error) throw roomResult.error;
      const targetResult = await (supabase as any).from('hotel_cleaning_time_targets')
        .select('cleaning_size,assignment_type,duration_minutes').eq('hotel_configuration_id', hotel.id);
      if (targetResult.error) throw targetResult.error;
      setConfigId(hotel.id);
      setHotelName(hotel.hotel_name);
      setRooms(roomResult.data || []);
      setTargets(targetResult.data || []);
    } catch (error) {
      console.error('Room settings load failed', error);
      toast.error('Could not load room settings');
      setRooms([]);
      setTargets([]);
    } finally { setLoading(false); }
  }, [open, hotelId, profile?.organization_slug]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function saveRoom(room: Room, patch: Partial<Pick<Room, 'cleaning_size' | 'verified_bed_count'>>) {
    if (saving || !profile?.organization_slug) return;
    setSaving(room.id);
    const previous = room;
    setRooms(list => list.map(r => r.id === room.id ? { ...r, ...patch } : r));
    try {
      const { data, error } = await (supabase as any).from('rooms').update(patch)
        .eq('id', room.id).eq('organization_slug', profile.organization_slug)
        .in('hotel', [hotelId, hotelName]).select('id').single();
      if (error || !data) throw error || new Error('No room updated');
      toast.success('Room mapping saved');
    } catch (error) {
      setRooms(list => list.map(r => r.id === room.id ? previous : r));
      toast.error('Room mapping could not be saved');
      console.error(error);
    } finally { setSaving(null); }
  }

  async function saveTarget(size: HousekeepingRoomSize, type: string, minutes: number) {
    if (!configId || saving || !Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
      toast.error('Enter between 1 and 480 minutes');
      return;
    }
    const key = `${size}-${type}`;
    setSaving(key);
    try {
      const { error } = await (supabase as any).from('hotel_cleaning_time_targets').upsert({
        hotel_configuration_id: configId, cleaning_size: size, assignment_type: type,
        duration_minutes: minutes, updated_at: new Date().toISOString(), updated_by: profile?.id,
      }, { onConflict: 'hotel_configuration_id,cleaning_size,assignment_type' });
      if (error) throw error;
      setTargets(previous => [...previous.filter(t => !(t.cleaning_size === size && t.assignment_type === type)),
        { cleaning_size: size, assignment_type: type, duration_minutes: minutes }]);
      toast.success('Cleaning time saved');
    } catch (error) { console.error(error); toast.error('Cleaning time could not be saved'); }
    finally { setSaving(null); }
  }

  if (!allowed) return null;
  return <section className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
    <Button type="button" variant="outline" onClick={() => setOpen(value => !value)} aria-expanded={open} className="w-full sm:w-auto">
      <Settings2 className="w-4 h-4 mr-2" /> Room sizes & cleaning times
    </Button>
    {open && <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Configure this hotel's rooms. Bed count means actual beds, not guest capacity. Existing tasks are unchanged.</p>
      {hotelChoices.length > 1 && <Select value={hotelId} onValueChange={value => { setHotelId(value); setConfigId(''); setRooms([]); }}>
        <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Choose hotel" /></SelectTrigger>
        <SelectContent>{hotelChoices.map(h => <SelectItem key={h.id} value={h.id!}>{h.name}</SelectItem>)}</SelectContent>
      </Select>}
      {loading ? <p role="status">Loading hotel mapping…</p> : <>
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Cleaning times · minutes</h3>
          <p className="text-xs text-muted-foreground">Checkout defaults are examples. Other service times remain unset until configured.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{cleaningTypes.map(([type, label]) => <div key={type} className="rounded-lg border p-3 space-y-2">
            <strong className="text-sm">{label}</strong>
            {HOUSEKEEPING_ROOM_SIZES.map(size => <TimeEditor key={`${size}-${type}`} size={size} type={type}
              initial={targets.find(t => t.cleaning_size === size && t.assignment_type === type)?.duration_minutes ?? (type === 'checkout_cleaning' ? CHECKOUT_DURATION_EXAMPLES[size] : null)}
              disabled={!!saving} onSave={minutes => void saveTarget(size, type, minutes)} />)}
          </div>)}</div>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Rooms · {hotelName || 'Choose hotel'}</h3>
          <div className="max-h-[24rem] overflow-auto rounded-lg border divide-y">{rooms.map(room => <div key={room.id} className="flex flex-wrap items-center gap-2 p-2.5">
            <strong className="w-24 text-sm shrink-0 break-all">{room.room_number}</strong>
            <Select disabled={!!saving} value={room.cleaning_size || 'unmapped'} onValueChange={value => void saveRoom(room, { cleaning_size: value === 'unmapped' ? null : value as HousekeepingRoomSize })}>
              <SelectTrigger aria-label={`Size for room ${room.room_number}`} className="w-40"><SelectValue placeholder="Size" /></SelectTrigger>
              <SelectContent><SelectItem value="unmapped">Not mapped</SelectItem>{HOUSEKEEPING_ROOM_SIZES.map(size => <SelectItem key={size} value={size}>{ROOM_SIZE_LABELS[size]}</SelectItem>)}</SelectContent>
            </Select>
            <Select disabled={!!saving} value={String(room.verified_bed_count ?? 'unknown')} onValueChange={value => void saveRoom(room, { verified_bed_count: value === 'unknown' ? null : Number(value) })}>
              <SelectTrigger aria-label={`Actual beds for room ${room.room_number}`} className="w-36"><SelectValue placeholder="Beds" /></SelectTrigger>
              <SelectContent><SelectItem value="unknown">Beds unknown</SelectItem>{Array.from({ length: 20 }, (_, i) => <SelectItem key={i+1} value={String(i+1)}>{i+1} bed{i ? 's' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>)}{!rooms.length && <p className="p-3 text-sm text-muted-foreground">No rooms found for this hotel.</p>}</div>
        </div>
      </>}
    </div>}
  </section>;
}

function TimeEditor({ size, type, initial, disabled, onSave }: { size: HousekeepingRoomSize; type: string; initial: number | null; disabled: boolean; onSave: (value: number) => void }) {
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  useEffect(() => setValue(initial === null ? '' : String(initial)), [initial, size, type]);
  return <div className="flex items-center gap-2">
    <label className="text-xs flex-1" htmlFor={`${type}-${size}`}>{ROOM_SIZE_LABELS[size]}</label>
    <Input id={`${type}-${size}`} aria-label={`${type} ${size} minutes`} className="w-20 h-9" type="number" min={1} max={480} value={value} onChange={e => setValue(e.target.value)} placeholder="—" />
    <Button type="button" variant="outline" size="sm" disabled={disabled || !value || Number(value) === initial} onClick={() => onSave(Number(value))}>Save</Button>
  </div>;
}
