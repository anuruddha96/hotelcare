import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, MapPinned, Save, Trash2, UsersRound } from 'lucide-react';
import { HotelFloorMap as BaseHotelFloorMap } from '../components/dashboard/HotelFloorMap';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type Props = React.ComponentProps<typeof BaseHotelFloorMap>;
type Section = { id: string; name: string; floor_number: number };
type SectionLink = {
  id: string;
  source_section_id: string;
  target_section_id: string;
  relation_type: 'nearby' | 'overflow' | 'avoid';
  priority: number;
  is_directional: boolean;
  low_load_threshold_minutes: number | null;
  notes: string | null;
};
type RoomLink = {
  id: string;
  room_id: string;
  related_room_id: string;
  relation_type: 'together' | 'nearby' | 'far';
  priority: number;
  notes: string | null;
};

type RoomProfile = {
  id: string;
  room_number: string;
  room_size_sqm: number | null;
  room_capacity: number | null;
  verified_bed_count: number | null;
  bed_configuration: string | null;
  cleaning_size: string | null;
  elevator_proximity: number | null;
  room_category: string | null;
};

const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value);

function relationLabel(type: SectionLink['relation_type']) {
  if (type === 'nearby') return 'Nearby / can share a route';
  if (type === 'overflow') return 'Overflow when source is lighter';
  return 'Keep separate';
}

function roomRelationLabel(type: RoomLink['relation_type']) {
  if (type === 'together') return 'Keep together';
  if (type === 'nearby') return 'Nearby';
  return 'Far apart';
}

function MemoriesSpatialMapTools({ rooms, hotelName }: Pick<Props, 'rooms' | 'hotelName'>) {
  const { user } = useAuth();
  const roomList = useMemo(() => [...(rooms as any[])].sort((a, b) =>
    String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true })), [rooms]);
  const roomById = useMemo(() => new Map(roomList.map(room => [room.id, room])), [roomList]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionLinks, setSectionLinks] = useState<SectionLink[]>([]);
  const [roomLinks, setRoomLinks] = useState<RoomLink[]>([]);

  const [sourceSection, setSourceSection] = useState('');
  const [targetSection, setTargetSection] = useState('');
  const [sectionRelation, setSectionRelation] = useState<SectionLink['relation_type']>('nearby');
  const [sectionPriority, setSectionPriority] = useState('80');
  const [loadThreshold, setLoadThreshold] = useState('');

  const [roomA, setRoomA] = useState('');
  const [roomB, setRoomB] = useState('');
  const [roomRelation, setRoomRelation] = useState<RoomLink['relation_type']>('nearby');
  const [roomPriority, setRoomPriority] = useState('80');

  const [profileRoomId, setProfileRoomId] = useState('');
  const [profile, setProfile] = useState<RoomProfile | null>(null);

  const sectionName = useMemo(() => new Map(sections.map(section => [section.id, section.name])), [sections]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sectionRows, error: sectionError } = await (supabase as any)
        .from('hotel_housekeeping_sections')
        .select('id,name,floor_number')
        .eq('hotel_name', hotelName)
        .eq('is_active', true)
        .order('floor_number')
        .order('sort_order');
      if (sectionError) throw sectionError;
      const [{ data: links, error: linksError }, { data: roomRelationships, error: roomLinksError }] = await Promise.all([
        (supabase as any)
          .from('hotel_housekeeping_section_links')
          .select('id,source_section_id,target_section_id,relation_type,priority,is_directional,low_load_threshold_minutes,notes')
          .eq('hotel_name', hotelName)
          .order('priority', { ascending: false }),
        (supabase as any)
          .from('hotel_housekeeping_room_relationships')
          .select('id,room_id,related_room_id,relation_type,priority,notes')
          .eq('hotel_name', hotelName)
          .order('priority', { ascending: false }),
      ]);
      if (linksError) throw linksError;
      if (roomLinksError) throw roomLinksError;
      setSections(sectionRows || []);
      setSectionLinks(links || []);
      setRoomLinks(roomRelationships || []);
      const first = (sectionRows || [])[0]?.id || '';
      if (!sourceSection) setSourceSection(first);
      if (!targetSection) setTargetSection((sectionRows || [])[1]?.id || first);
      if (!roomA) setRoomA(roomList[0]?.id || '');
      if (!roomB) setRoomB(roomList[1]?.id || roomList[0]?.id || '');
    } catch (error) {
      console.error('[MemoriesSpatialMapTools] load failed', error);
      toast.error('Physical assignment mapping could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [hotelName, roomList, sourceSection, targetSection, roomA, roomB]);

  useEffect(() => { void load(); }, [hotelName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!profileRoomId) { setProfile(null); return; }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('rooms')
        .select('id,room_number,room_size_sqm,room_capacity,verified_bed_count,bed_configuration,cleaning_size,elevator_proximity,room_category')
        .eq('id', profileRoomId)
        .maybeSingle();
      if (!cancelled) {
        if (error) toast.error('Room profile could not be loaded');
        else setProfile(data as RoomProfile | null);
      }
    })();
    return () => { cancelled = true; };
  }, [profileRoomId]);

  const addSectionLink = async () => {
    if (!sourceSection || !targetSection || sourceSection === targetSection) {
      toast.error('Choose two different sections');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        hotel_name: hotelName,
        source_section_id: sourceSection,
        target_section_id: targetSection,
        relation_type: sectionRelation,
        priority: Math.max(1, Math.min(100, Number(sectionPriority) || 50)),
        is_directional: sectionRelation === 'overflow',
        low_load_threshold_minutes: sectionRelation === 'overflow' ? numberOrNull(loadThreshold) : null,
        created_by: user?.id || null,
      };
      const { error } = await (supabase as any)
        .from('hotel_housekeeping_section_links')
        .upsert(payload, { onConflict: 'source_section_id,target_section_id,relation_type' });
      if (error) throw error;
      toast.success('Section relationship saved');
      await load();
    } catch (error) {
      console.error(error);
      toast.error('Section relationship could not be saved');
    } finally { setSaving(false); }
  };

  const addRoomLink = async () => {
    if (!roomA || !roomB || roomA === roomB) {
      toast.error('Choose two different rooms');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        hotel_name: hotelName,
        room_id: roomA,
        related_room_id: roomB,
        relation_type: roomRelation,
        priority: Math.max(1, Math.min(100, Number(roomPriority) || 50)),
        created_by: user?.id || null,
      };
      const { error } = await (supabase as any)
        .from('hotel_housekeeping_room_relationships')
        .upsert(payload, { onConflict: 'room_id,related_room_id,relation_type' });
      if (error) throw error;
      toast.success('Room relationship saved');
      await load();
    } catch (error) {
      console.error(error);
      toast.error('Room relationship could not be saved');
    } finally { setSaving(false); }
  };

  const removeSectionLink = async (id: string) => {
    setSectionLinks(previous => previous.filter(link => link.id !== id));
    const { error } = await (supabase as any).from('hotel_housekeeping_section_links').delete().eq('id', id);
    if (error) { toast.error('Relationship could not be removed'); await load(); }
  };

  const removeRoomLink = async (id: string) => {
    setRoomLinks(previous => previous.filter(link => link.id !== id));
    const { error } = await (supabase as any).from('hotel_housekeeping_room_relationships').delete().eq('id', id);
    if (error) { toast.error('Relationship could not be removed'); await load(); }
  };

  const saveRoomProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('rooms').update({
        room_size_sqm: profile.room_size_sqm,
        room_capacity: profile.room_capacity,
        verified_bed_count: profile.verified_bed_count,
        bed_configuration: profile.bed_configuration?.trim() || null,
        cleaning_size: profile.cleaning_size?.trim() || null,
        elevator_proximity: profile.elevator_proximity,
        room_category: profile.room_category?.trim() || null,
      }).eq('id', profile.id);
      if (error) throw error;
      toast.success(`Room ${profile.room_number} profile saved`);
    } catch (error) {
      console.error(error);
      toast.error('Room profile could not be saved');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center rounded-xl border p-5"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2"><MapPinned className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Assignment intelligence</h3></div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Add physical knowledge that room numbers alone cannot tell Auto-Assign: which sections are close, where light-load staff may help, which rooms belong together or are far apart, and the actual cleaning effort of each room.</p>
        </div>
        <Badge variant="secondary">Hotel Memories only</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2"><Link2 className="h-4 w-4" /><h4 className="text-sm font-semibold">Section proximity</h4></div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div><Label>From section</Label><Select value={sourceSection} onValueChange={setSourceSection}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sections.map(section => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>To section</Label><Select value={targetSection} onValueChange={setTargetSection}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sections.map(section => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Relationship</Label><Select value={sectionRelation} onValueChange={value => setSectionRelation(value as SectionLink['relation_type'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nearby">Nearby / share route</SelectItem><SelectItem value="overflow">Overflow when lighter</SelectItem><SelectItem value="avoid">Keep separate</SelectItem></SelectContent></Select></div>
            <div><Label>Priority (1–100)</Label><Input type="number" min={1} max={100} value={sectionPriority} onChange={event => setSectionPriority(event.target.value)} /></div>
            {sectionRelation === 'overflow' && <div><Label>Optional source-load limit (minutes)</Label><Input type="number" min={0} max={450} placeholder="Adaptive if blank" value={loadThreshold} onChange={event => setLoadThreshold(event.target.value)} /></div>}
          </div>
          <Button size="sm" onClick={addSectionLink} disabled={saving}>Save section link</Button>
          <div className="space-y-1.5">{sectionLinks.map(link => <div key={link.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"><div><strong>{sectionName.get(link.source_section_id)}</strong> → <strong>{sectionName.get(link.target_section_id)}</strong><div className="text-muted-foreground">{relationLabel(link.relation_type)} · priority {link.priority}{link.low_load_threshold_minutes != null ? ` · ≤${link.low_load_threshold_minutes}m` : ''}</div></div><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void removeSectionLink(link.id)}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div>
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2"><UsersRound className="h-4 w-4" /><h4 className="text-sm font-semibold">Room-to-room relationship</h4></div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div><Label>Room A</Label><Select value={roomA} onValueChange={setRoomA}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roomList.map(room => <SelectItem key={room.id} value={room.id}>{room.room_number}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Room B</Label><Select value={roomB} onValueChange={setRoomB}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roomList.map(room => <SelectItem key={room.id} value={room.id}>{room.room_number}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Relationship</Label><Select value={roomRelation} onValueChange={value => setRoomRelation(value as RoomLink['relation_type'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="together">Keep together</SelectItem><SelectItem value="nearby">Nearby</SelectItem><SelectItem value="far">Far apart</SelectItem></SelectContent></Select></div>
            <div><Label>Priority (1–100)</Label><Input type="number" min={1} max={100} value={roomPriority} onChange={event => setRoomPriority(event.target.value)} /></div>
          </div>
          <Button size="sm" onClick={addRoomLink} disabled={saving}>Save room link</Button>
          <div className="space-y-1.5">{roomLinks.map(link => <div key={link.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"><div><strong>{roomById.get(link.room_id)?.room_number || 'Room'}</strong> ↔ <strong>{roomById.get(link.related_room_id)?.room_number || 'Room'}</strong><div className="text-muted-foreground">{roomRelationLabel(link.relation_type)} · priority {link.priority}</div></div><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void removeRoomLink(link.id)}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div>
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <div><h4 className="text-sm font-semibold">Room cleaning profile</h4><p className="text-xs text-muted-foreground">Used to estimate effort for double, triple, quadruple and larger rooms.</p></div>
          <div><Label>Room</Label><Select value={profileRoomId} onValueChange={setProfileRoomId}><SelectTrigger><SelectValue placeholder="Choose room" /></SelectTrigger><SelectContent>{roomList.map(room => <SelectItem key={room.id} value={room.id}>{room.room_number}</SelectItem>)}</SelectContent></Select></div>
          {profile && <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div><Label>Room size (m²)</Label><Input type="number" min={0} value={profile.room_size_sqm ?? ''} onChange={e => setProfile({ ...profile, room_size_sqm: numberOrNull(e.target.value) })} /></div>
            <div><Label>Guest capacity</Label><Input type="number" min={1} max={20} value={profile.room_capacity ?? ''} onChange={e => setProfile({ ...profile, room_capacity: numberOrNull(e.target.value) })} /></div>
            <div><Label>Verified bed count</Label><Input type="number" min={1} max={20} value={profile.verified_bed_count ?? ''} onChange={e => setProfile({ ...profile, verified_bed_count: numberOrNull(e.target.value) })} /></div>
            <div><Label>Bed configuration</Label><Input placeholder="e.g. 1 double + 2 singles" value={profile.bed_configuration ?? ''} onChange={e => setProfile({ ...profile, bed_configuration: e.target.value })} /></div>
            <div><Label>Cleaning size</Label><Select value={profile.cleaning_size || 'unset'} onValueChange={value => setProfile({ ...profile, cleaning_size: value === 'unset' ? null : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unset">Not set</SelectItem><SelectItem value="small">Small</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="large">Large</SelectItem><SelectItem value="extra_large">Extra large</SelectItem></SelectContent></Select></div>
            <div><Label>Elevator proximity (0 closest)</Label><Input type="number" min={0} value={profile.elevator_proximity ?? ''} onChange={e => setProfile({ ...profile, elevator_proximity: numberOrNull(e.target.value) })} /></div>
            <div className="sm:col-span-2 xl:col-span-1"><Label>Room category</Label><Input placeholder="Double / Triple / Quadruple / Suite…" value={profile.room_category ?? ''} onChange={e => setProfile({ ...profile, room_category: e.target.value })} /></div>
            <Button size="sm" onClick={saveRoomProfile} disabled={saving}><Save className="mr-1 h-3.5 w-3.5" />Save room profile</Button>
          </div>}
        </section>
      </div>
    </div>
  );
}

export function HotelFloorMap(props: Props) {
  const memories = props.hotelName === 'Hotel Memories Budapest';
  return <div className="space-y-4"><BaseHotelFloorMap {...props} />{memories && props.isAdmin && <MemoriesSpatialMapTools rooms={props.rooms} hotelName={props.hotelName} />}</div>;
}
