import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, MapPin, Plus, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import { hasManagerPowers } from '@/lib/roleAccess';
import {
  findLegacyAreaConflicts, planAreaPayload, sameAreaAssignments,
  type LegacyAreaTask, type PropertyArea,
} from '@/lib/nextDayPropertyAreaSafety';

type Area = PropertyArea & {
  description: string | null;
  icon: string;
  sort_order: number;
};
type Staff = { id: string; full_name: string; scheduled: boolean; inPlan: boolean };
type PlanStatus = 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed' | null;
type Props = { visible: boolean; selectedDate: string };

// Same options and persistent table as Room Overview's PublicAreaAssignment.
const AREA_TYPES = [
  { value: 'public_area_cleaning', label: 'General area', icon: '🧹' },
  { value: 'lobby_cleaning', label: 'Entrance / lobby', icon: '🏨' },
  { value: 'reception_cleaning', label: 'Reception', icon: '🛎️' },
  { value: 'guest_toilets', label: 'Restrooms', icon: '🚻' },
  { value: 'stairways_cleaning', label: 'Corridors / stairs', icon: '🚶' },
  { value: 'common_areas_cleaning', label: 'Common area', icon: '🏠' },
  { value: 'back_office_cleaning', label: 'Office / back office', icon: '🏢' },
  { value: 'kitchen_cleaning', label: 'Kitchen', icon: '🍳' },
  { value: 'breakfast_room_cleaning', label: 'Breakfast / dining', icon: '🍽️' },
  { value: 'gym_cleaning', label: 'Gym / fitness', icon: '🏋️' },
  { value: 'sauna_cleaning', label: 'Sauna', icon: '♨️' },
  { value: 'jacuzzi_cleaning', label: 'Jacuzzi / wellness', icon: '🫧' },
] as const;

const legacyFingerprint = (tasks: readonly LegacyAreaTask[]) => tasks.map(task =>
  [task.task_name, task.task_type, task.assigned_to, task.source].join('\u001f'),
).sort().join('\u001e');

/** This editor is inside the existing wizard, rather than a second focus-trapped
 * modal. The property catalog and date-specific ownership are independent of
 * the PMS room allocation and never rewrite an already approved room plan. */
export function UnifiedNextDayPublicAreasSafe({ visible, selectedDate }: Props) {
  const { user, profile } = useAuth();
  const db = supabase as any;
  const canManage = hasManagerPowers(profile?.role);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [areas, setAreas] = useState<Area[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [legacy, setLegacy] = useState<LegacyAreaTask[]>([]);
  const [planStatus, setPlanStatus] = useState<PlanStatus>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState<string>('public_area_cleaning');
  const baseline = useRef(new Map<string, string>());
  const baselinePlan = useRef<{ id: string | null; status: PlanStatus }>({ id: null, status: null });
  const request = useRef(0);

  const active = useMemo(() => areas.filter(area => area.is_active), [areas]);
  const archivedAssigned = useMemo(() => areas.filter(area => !area.is_active && assignments.has(area.id)), [areas, assignments]);
  const assignedCount = active.filter(area => assignments.has(area.id)).length;
  const editable = planStatus !== 'releasing' && planStatus !== 'released';
  const eligibleIds = useMemo(() => new Set(staff.map(person => person.id)), [staff]);
  const overlaps = useMemo(() => findLegacyAreaConflicts(active, assignments, legacy), [active, assignments, legacy]);

  const load = useCallback(async (spinner = true) => {
    if (!visible || !canManage || !profile?.organization_slug || !profile.assigned_hotel) return;
    const generation = ++request.current;
    if (spinner) setLoading(true);
    setError(null);
    try {
      const organization = profile.organization_slug;
      const id = await resolveCanonicalHotelId(profile.assigned_hotel);
      if (!id) throw new Error('The hotel could not be resolved.');
      const config = await db.from('hotel_configurations').select('hotel_name').eq('hotel_id', id).maybeSingle();
      if (config.error) throw config.error;
      const name = config.data?.hotel_name || profile.assigned_hotel;
      const keys = new Set([id, name, profile.assigned_hotel, ...await resolveHotelKeys(name)]);
      const [definitions, people, shifts, owners, plan, duties] = await Promise.all([
        db.from('hotel_public_areas').select('id,name,description,icon,task_type,sort_order,is_active')
          .eq('hotel_name', name).order('sort_order').order('name'),
        db.from('profiles').select('id,full_name,nickname,assigned_hotel,hotel_id,role,acts_as_housekeeper')
          .eq('organization_slug', organization).is('deleted_at', null),
        db.from('staff_schedules').select('user_id,status').eq('organization_slug', organization)
          .eq('hotel_id', id).eq('work_date', selectedDate),
        db.from('next_day_housekeeping_public_area_assignments').select('public_area_id,assigned_to')
          .eq('organization_slug', organization).eq('hotel_id', id).eq('plan_date', selectedDate),
        db.from('next_day_housekeeping_plans').select('id,status').eq('organization_slug', organization)
          .eq('hotel_id', id).eq('plan_date', selectedDate).maybeSingle(),
        isGozsduCourtHotel(id)
          ? db.from('gozsdu_laundry_duties').select('user_id').eq('organization_slug', organization)
            .eq('hotel_id', id).eq('work_date', selectedDate)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of [definitions, people, shifts, owners, plan, duties]) if (result.error) throw result.error;
      const planId: string | null = plan.data?.id || null;
      const [planStaff, earlier] = await Promise.all([
        planId ? db.from('next_day_housekeeping_plan_staff').select('user_id').eq('plan_id', planId)
          .eq('selected', true) : Promise.resolve({ data: [], error: null }),
        planId ? db.from('next_day_housekeeping_plan_area_tasks').select('task_name,task_type,assigned_to,source')
          .eq('plan_id', planId) : Promise.resolve({ data: [], error: null }),
      ]);
      if (planStaff.error) throw planStaff.error;
      if (earlier.error) throw earlier.error;
      if (generation !== request.current) return;
      const off = new Set((shifts.data || []).filter((row: any) => row.status === 'off').map((row: any) => row.user_id));
      const scheduled = new Set((shifts.data || []).map((row: any) => row.user_id));
      const planned = new Set((planStaff.data || []).map((row: any) => row.user_id));
      const laundry = new Set((duties.data || []).map((row: any) => row.user_id));
      const cleaners: Staff[] = (people.data || []).filter((person: any) =>
        (['housekeeping', 'housekeeping_manager', 'supervisor'].includes(String(person.role || ''))
          || person.acts_as_housekeeper === true)
        && (keys.has(person.assigned_hotel) || keys.has(person.hotel_id))
        && !off.has(person.id) && !laundry.has(person.id),
      ).map((person: any) => ({
        id: person.id, full_name: person.full_name || person.nickname || 'Housekeeper',
        scheduled: scheduled.has(person.id), inPlan: planned.has(person.id),
      })).sort((a: Staff, b: Staff) => Number(b.inPlan) - Number(a.inPlan)
        || Number(b.scheduled) - Number(a.scheduled) || a.full_name.localeCompare(b.full_name));
      const loadedOwners = new Map<string, string>((owners.data || []).map((row: any) => [row.public_area_id, row.assigned_to]));
      setHotelId(id);
      setHotelName(name);
      setAreas((definitions.data || []) as Area[]);
      setStaff(cleaners);
      setAssignments(loadedOwners);
      baseline.current = new Map(loadedOwners);
      baselinePlan.current = { id: planId, status: (plan.data?.status || null) as PlanStatus };
      setPlanStatus(baselinePlan.current.status);
      setLegacy((earlier.data || []) as LegacyAreaTask[]);
      setDirty(false);
      setRefreshNeeded(false);
    } catch (cause) {
      if (generation === request.current) {
        console.error('[UnifiedNextDayPublicAreas] load:', cause);
        setError(cause instanceof Error ? cause.message : 'Unable to load property areas.');
      }
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }, [db, visible, canManage, profile?.organization_slug, profile?.assigned_hotel, selectedDate]);

  useEffect(() => {
    if (visible && canManage) void load(true);
    else { request.current += 1; setSlot(null); setExpanded(false); }
  }, [visible, canManage, load]);

  useEffect(() => {
    if (!visible || !canManage) return;
    const refresh = (event: Event) => {
      if ((event as CustomEvent)?.detail?.origin === 'unified-next-day-area-editor') return;
      if (dirty) setRefreshNeeded(true);
      else void load(false);
    };
    window.addEventListener('hk-next-day-plan-changed', refresh);
    window.addEventListener('hotel-public-areas-changed', refresh);
    return () => {
      window.removeEventListener('hk-next-day-plan-changed', refresh);
      window.removeEventListener('hotel-public-areas-changed', refresh);
    };
  }, [visible, canManage, dirty, load]);

  useEffect(() => {
    if (!visible || !canManage) return;
    const locate = () => {
      const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .find(node => node.textContent?.includes('Tomorrow · 08:00 release'));
      const scroll = dialog?.querySelector<HTMLElement>('.flex-1.min-h-0.overflow-y-auto');
      if (!scroll) { setSlot(previous => previous === null ? previous : null); return; }
      let node = scroll.querySelector<HTMLElement>(':scope > [data-next-day-property-areas-slot]');
      if (!node) { node = document.createElement('div'); node.dataset.nextDayPropertyAreasSlot = 'true'; scroll.prepend(node); }
      setSlot(previous => previous === node ? previous : node);
      if (scroll.textContent?.includes('Review tomorrow’s public areas')) setExpanded(true);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); setSlot(null); };
  }, [visible, canManage]);

  const changeOwner = (id: string, value: string) => {
    if (!editable) return;
    setAssignments(previous => {
      const next = new Map(previous);
      if (value === 'none') next.delete(id);
      else next.set(id, value);
      return next;
    });
    setDirty(true);
  };

  const addArea = async () => {
    const name = newName.trim();
    if (!user || !canManage || !editable || !hotelName || creating) return;
    if (!name || name.length > 80) { toast.error('Enter a name of up to 80 characters.'); return; }
    const existing = areas.find(area => area.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing?.is_active) { toast.info('That area already exists in Room Overview.'); return; }
    setCreating(true);
    try {
      let result: any;
      if (existing) {
        result = await db.from('hotel_public_areas').update({ is_active: true }).eq('hotel_name', hotelName)
          .eq('id', existing.id).select('id,name,description,icon,task_type,sort_order,is_active').single();
      } else {
        const type = AREA_TYPES.find(candidate => candidate.value === newType) || AREA_TYPES[0];
        result = await db.from('hotel_public_areas').insert({
          hotel_name: hotelName, name, description: newDescription.trim() || null,
          icon: type.icon, task_type: type.value,
          sort_order: areas.reduce((max, area) => Math.max(max, area.sort_order), 0) + 10,
          is_active: true, created_by: user.id,
        }).select('id,name,description,icon,task_type,sort_order,is_active').single();
      }
      if (result.error) throw result.error;
      const saved = result.data as Area;
      setAreas(previous => [...previous.filter(area => area.id !== saved.id), saved]
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      setNewName(''); setNewDescription(''); setNewType('public_area_cleaning'); setShowCreate(false);
      // Own event is ignored: creating an area must NOT discard unsaved owners.
      window.dispatchEvent(new CustomEvent('hotel-public-areas-changed', {
        detail: { hotelName, origin: 'unified-next-day-area-editor' },
      }));
      toast.success(`${saved.name} is now in Room Overview and tomorrow planning.`);
    } catch (cause: any) {
      toast.error(cause?.code === '23505' ? 'That public area already exists.' : 'Could not add the public area.');
    } finally { setCreating(false); }
  };

  const save = async () => {
    if (!user || !profile?.organization_slug || !hotelId || !editable || !dirty || saving || refreshNeeded) return;
    if (overlaps.length) {
      toast.error('Some areas overlap existing one-off tasks. Reconcile those tasks in the room plan before adding the same work again.');
      return;
    }
    const payload = planAreaPayload(areas, assignments);
    if (payload.some(entry => active.some(area => area.id === entry.public_area_id)
      && !eligibleIds.has(entry.assigned_to))) {
      toast.error('An assignee is unavailable or on Laundryner duty. Choose another housekeeper.');
      return;
    }
    setSaving(true);
    try {
      // The existing save RPC replaces the property-area rows in one transaction.
      // Detect changes by other managers BEFORE calling it rather than overwriting
      // their choices from a stale browser tab.
      const [latestOwners, latestPlan, latestLegacy, latestDuties] = await Promise.all([
        db.from('next_day_housekeeping_public_area_assignments').select('public_area_id,assigned_to')
          .eq('organization_slug', profile.organization_slug).eq('hotel_id', hotelId).eq('plan_date', selectedDate),
        db.from('next_day_housekeeping_plans').select('id,status').eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', hotelId).eq('plan_date', selectedDate).maybeSingle(),
        baselinePlan.current.id ? db.from('next_day_housekeeping_plan_area_tasks')
          .select('task_name,task_type,assigned_to,source').eq('plan_id', baselinePlan.current.id)
          : Promise.resolve({ data: [], error: null }),
        isGozsduCourtHotel(hotelId) ? db.from('gozsdu_laundry_duties').select('user_id')
          .eq('organization_slug', profile.organization_slug).eq('hotel_id', hotelId).eq('work_date', selectedDate)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const response of [latestOwners, latestPlan, latestLegacy, latestDuties]) if (response.error) throw response.error;
      const currentOwners = new Map<string, string>((latestOwners.data || []).map((row: any) => [row.public_area_id, row.assigned_to]));
      if (!sameAreaAssignments(baseline.current, currentOwners)
        || (latestPlan.data?.id || null) !== baselinePlan.current.id
        || (latestPlan.data?.status || null) !== baselinePlan.current.status
        || legacyFingerprint((latestLegacy.data || []) as LegacyAreaTask[]) !== legacyFingerprint(legacy)) {
        setRefreshNeeded(true);
        throw new Error('Another manager changed this plan. Refresh and review before saving; your edits were retained.');
      }
      if (payload.some(entry => (latestDuties.data || []).some((row: any) => row.user_id === entry.assigned_to))) {
        throw new Error('A selected cleaner has Laundryner duty. Reassign the public area before saving.');
      }
      const { error: saveError } = await db.rpc('save_next_day_housekeeping_public_area_assignments', {
        p_organization_slug: profile.organization_slug, p_hotel_id: hotelId,
        p_plan_date: selectedDate, p_assignments: payload,
      });
      if (saveError) throw saveError;
      await load(false);
      window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed', {
        detail: { hotelId, planDate: selectedDate, origin: 'unified-next-day-area-editor' },
      }));
      toast.success(`${payload.length} public areas saved for ${selectedDate}; room assignments were not changed.`);
    } catch (cause) {
      console.error('[UnifiedNextDayPublicAreas] save:', cause);
      toast.error(cause instanceof Error ? cause.message : 'Could not save public areas.');
    } finally { setSaving(false); }
  };

  if (!visible || !canManage || !slot) return null;
  return createPortal(
    <section data-testid="unified-next-day-property-areas" aria-label="Property public areas from Room Overview"
      className="mb-3 rounded-xl border-2 border-emerald-300 bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-emerald-700" />
          <div><p className="text-sm font-semibold">Property public areas <Badge variant="outline">{assignedCount}/{active.length}</Badge>{dirty && <Badge className="ml-1" variant="secondary">Unsaved</Badge>}</p>
            <p className="text-[11px] text-muted-foreground">Shared with Hotel Room Overview · {hotelName || 'this hotel'} · {selectedDate}</p></div>
        </div>
        <Button type="button" size="sm" variant={expanded ? 'secondary' : 'outline'} aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}{expanded ? 'Hide areas' : 'Manage areas'}</Button>
      </div>
      {expanded && <div className="mt-3 space-y-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">These are the exact property areas created in Hotel Room Overview. The wizard’s older Step 4 choices are separate one-off extras; avoid assigning the same work twice. Changes here do not regenerate room assignments.</p>
        {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading public areas…</p>
          : error ? <div role="alert" className="rounded border border-destructive p-3 text-sm">{error}<Button type="button" size="sm" className="ml-2" variant="outline" onClick={() => void load(true)}>Retry</Button></div>
          : <>
            {!editable && <p role="status" className="rounded bg-amber-50 p-2 text-xs text-amber-900">The plan is {planStatus}; public-area assignments are read-only.</p>}
            {refreshNeeded && <p role="alert" className="rounded border border-amber-400 p-2 text-xs">The plan changed elsewhere. Your unsaved choices remain visible. <Button type="button" size="sm" variant="outline" onClick={() => void load(true)}><RefreshCw className="mr-1 h-3 w-3" />Discard edits & refresh</Button></p>}
            {overlaps.length > 0 && <p role="alert" className="flex items-start gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />{overlaps.join(', ')} overlap existing one-off/mapped work. Leave these unassigned here until the old tasks are reconciled; no existing work is removed automatically.</p>}
            <div className="max-h-[min(40dvh,380px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {active.map(area => <div key={area.id} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_215px] sm:items-center">
                <div className="flex min-w-0 items-center gap-2"><span aria-hidden className="text-lg">{area.icon || '🧹'}</span><div className="min-w-0"><p className="text-sm font-medium">{area.name}</p>{area.description && <p className="text-[11px] text-muted-foreground">{area.description}</p>}</div></div>
                <Select value={assignments.get(area.id) || 'none'} disabled={!editable || saving || staff.length === 0}
                  onValueChange={value => changeOwner(area.id, value)}><SelectTrigger className="h-9 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger><SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {staff.map(person => <SelectItem key={person.id} value={person.id}>{person.full_name}{person.inPlan ? ' · room plan' : person.scheduled ? ' · scheduled' : ' · area only'}</SelectItem>)}
                    {assignments.has(area.id) && !eligibleIds.has(assignments.get(area.id)!) && <SelectItem disabled value={assignments.get(area.id)!}>Previously assigned worker — unavailable</SelectItem>}
                  </SelectContent></Select>
              </div>)}
              {active.length === 0 && <p className="rounded border border-dashed p-3 text-sm">No property areas yet. Create an area below to add it to both views.</p>}
            </div>
            {archivedAssigned.length > 0 && <p className="rounded border border-blue-300 p-2 text-xs">{archivedAssigned.length} archived area assignment(s) from the approved plan will be preserved unchanged when you save other areas.</p>}
            {legacy.length > 0 && <div className="rounded border bg-muted/30 p-2 text-xs"><p className="font-medium">Existing older one-off / mapped plan tasks (preserved)</p><p className="mt-1 text-muted-foreground">{legacy.map(task => task.task_name).join(' · ')}</p></div>}
            <div className="rounded-lg border p-2"><Button type="button" size="sm" variant="ghost" disabled={!editable} onClick={() => setShowCreate(value => !value)}><Plus className="mr-1 h-4 w-4" />Create area in both views</Button>
              {showCreate && <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input aria-label="New public area name" placeholder="Area name" maxLength={80} value={newName} onChange={event => setNewName(event.target.value)} />
                <Select value={newType} onValueChange={setNewType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{AREA_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.icon} {type.label}</SelectItem>)}</SelectContent></Select>
                <Textarea className="sm:col-span-2" aria-label="New public area description" rows={2} placeholder="Optional description" value={newDescription} onChange={event => setNewDescription(event.target.value)} />
                <Button type="button" size="sm" disabled={creating || !newName.trim()} onClick={() => void addArea()}>{creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Add area</Button>
              </div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><span className="text-xs text-muted-foreground">{assignedCount}/{active.length} areas · {staff.length} eligible cleaners</span><Button type="button" size="sm" onClick={() => void save()}
              disabled={!editable || !dirty || saving || loading || !!error || refreshNeeded || overlaps.length > 0}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Save property areas</Button></div>
          </>}
      </div>}
    </section>, slot,
  );
}
