import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, MapPin, Plus, RefreshCw, Save } from 'lucide-react';
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

type Area = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  task_type: string;
  sort_order: number;
  is_active: boolean;
};
type Staff = { id: string; full_name: string; nickname: string | null; scheduled: boolean; inPlan: boolean };
type ExistingAreaTask = { task_name: string; task_type: string; assigned_to: string; source: string };
type PlanStatus = 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed' | null;

type Props = { visible: boolean; selectedDate: string };

// The same types, icons and hotel_public_areas table used by Room Overview's
// PublicAreaAssignment. Do not reintroduce the wizard's static PUBLIC_AREAS list.
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

/**
 * Tomorrow's authoritative property-area editor. It is inserted INSIDE the
 * existing Auto Assign dialog's scroll container, not as a competing modal or
 * a floating button outside Radix's focus trap. It edits only the independent
 * property-area assignment table: an approved room plan is never rewritten.
 */
export function UnifiedNextDayPublicAreas({ visible, selectedDate }: Props) {
  const { user, profile } = useAuth();
  const db = supabase as any;
  const canManage = hasManagerPowers(profile?.role);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [areas, setAreas] = useState<Area[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [previousTasks, setPreviousTasks] = useState<ExistingAreaTask[]>([]);
  const [planStatus, setPlanStatus] = useState<PlanStatus>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState<string>('public_area_cleaning');

  const activeAreas = useMemo(() => areas.filter(area => area.is_active), [areas]);
  const selectedCount = activeAreas.filter(area => assignments.has(area.id)).length;
  const editable = planStatus !== 'releasing' && planStatus !== 'released';
  const eligibleStaffIds = useMemo(() => new Set(staff.map(person => person.id)), [staff]);

  const conflictingEarlierTasks = useMemo(() => activeAreas.flatMap(area => {
    const owner = assignments.get(area.id);
    if (!owner) return [];
    return previousTasks.some(task => task.assigned_to !== owner && (
      task.task_type === area.task_type || task.task_name.trim().toLowerCase() === area.name.trim().toLowerCase()
    )) ? [area.name] : [];
  }), [activeAreas, assignments, previousTasks]);

  const load = useCallback(async (showSpinner = true) => {
    const organizationSlug = profile?.organization_slug;
    const assignedHotel = profile?.assigned_hotel;
    if (!visible || !canManage || !organizationSlug || !assignedHotel) return;
    if (showSpinner) setLoading(true);
    setLoadError(null);
    try {
      const canonicalId = await resolveCanonicalHotelId(assignedHotel);
      if (!canonicalId) throw new Error('The property could not be resolved.');
      const { data: config, error: configError } = await db.from('hotel_configurations')
        .select('hotel_name').eq('hotel_id', canonicalId).maybeSingle();
      if (configError) throw configError;
      const propertyName = config?.hotel_name || assignedHotel;
      const hotelKeys = new Set([canonicalId, propertyName, assignedHotel, ...await resolveHotelKeys(propertyName)]);
      const [areaResult, peopleResult, scheduleResult, assignedResult, planResult, dutyResult] = await Promise.all([
        db.from('hotel_public_areas')
          .select('id,name,description,icon,task_type,sort_order,is_active')
          .eq('hotel_name', propertyName).order('sort_order').order('name'),
        db.from('profiles')
          .select('id,full_name,nickname,assigned_hotel,hotel_id,role,acts_as_housekeeper,deleted_at')
          .eq('organization_slug', organizationSlug).is('deleted_at', null),
        db.from('staff_schedules').select('user_id,status')
          .eq('organization_slug', organizationSlug).eq('hotel_id', canonicalId).eq('work_date', selectedDate),
        db.from('next_day_housekeeping_public_area_assignments').select('public_area_id,assigned_to')
          .eq('organization_slug', organizationSlug).eq('hotel_id', canonicalId).eq('plan_date', selectedDate),
        db.from('next_day_housekeeping_plans').select('id,status')
          .eq('organization_slug', organizationSlug).eq('hotel_id', canonicalId).eq('plan_date', selectedDate).maybeSingle(),
        isGozsduCourtHotel(canonicalId)
          ? db.from('gozsdu_laundry_duties').select('user_id')
            .eq('organization_slug', organizationSlug).eq('hotel_id', canonicalId).eq('work_date', selectedDate)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of [areaResult, peopleResult, scheduleResult, assignedResult, planResult, dutyResult]) {
        if (result.error) throw result.error;
      }
      const planId = planResult.data?.id as string | undefined;
      const [planStaffResult, earlierResult] = await Promise.all([
        planId ? db.from('next_day_housekeeping_plan_staff').select('user_id,selected')
          .eq('plan_id', planId).eq('selected', true) : Promise.resolve({ data: [], error: null }),
        planId ? db.from('next_day_housekeeping_plan_area_tasks')
          .select('task_name,task_type,assigned_to,source').eq('plan_id', planId)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (planStaffResult.error) throw planStaffResult.error;
      if (earlierResult.error) throw earlierResult.error;
      const schedules = new Map<string, { status: string }>(
        (scheduleResult.data || []).map((row: any) => [row.user_id, row]),
      );
      const laundryIds = new Set((dutyResult.data || []).map((row: any) => row.user_id));
      const roomPlanIds = new Set((planStaffResult.data || []).map((row: any) => row.user_id));
      const eligible = (peopleResult.data || []).filter((person: any) => {
        const isCleaner = ['housekeeping', 'housekeeping_manager', 'supervisor'].includes(String(person.role || ''))
          || person.acts_as_housekeeper === true;
        return isCleaner && (hotelKeys.has(person.assigned_hotel) || hotelKeys.has(person.hotel_id))
          && schedules.get(person.id)?.status !== 'off' && !laundryIds.has(person.id);
      }).map((person: any): Staff => ({
        id: person.id,
        full_name: person.full_name || person.nickname || 'Housekeeper',
        nickname: person.nickname,
        scheduled: schedules.has(person.id),
        inPlan: roomPlanIds.has(person.id),
      })).sort((a: Staff, b: Staff) => Number(b.inPlan) - Number(a.inPlan)
        || Number(b.scheduled) - Number(a.scheduled) || a.full_name.localeCompare(b.full_name));
      setHotelId(canonicalId);
      setHotelName(propertyName);
      setAreas((areaResult.data || []) as Area[]);
      setStaff(eligible);
      setAssignments(new Map<string, string>((assignedResult.data || []).map((row: any) => [row.public_area_id, row.assigned_to])));
      setPreviousTasks((earlierResult.data || []) as ExistingAreaTask[]);
      setPlanStatus((planResult.data?.status || null) as PlanStatus);
      setDirty(false);
      setRefreshNeeded(false);
    } catch (cause) {
      console.error('[UnifiedNextDayPublicAreas] load failed:', cause);
      setLoadError(cause instanceof Error ? cause.message : 'Could not load the property public areas.');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [canManage, db, profile?.assigned_hotel, profile?.organization_slug, selectedDate, visible]);

  useEffect(() => {
    if (!visible || !canManage) {
      setExpanded(false);
      setSlot(null);
      return;
    }
    void load(true);
  }, [visible, canManage, load]);

  useEffect(() => {
    if (!visible || !canManage) return;
    const refresh = () => {
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
      const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .find(element => element.textContent?.includes('Tomorrow · 08:00 release'));
      const scroller = dialog?.querySelector<HTMLElement>('.flex-1.min-h-0.overflow-y-auto');
      if (!scroller) {
        setSlot(previous => previous === null ? previous : null);
        return;
      }
      let target = scroller.querySelector<HTMLElement>(':scope > [data-next-day-property-areas-slot]');
      if (!target) {
        target = document.createElement('div');
        target.dataset.nextDayPropertyAreasSlot = 'true';
        scroller.prepend(target);
      }
      setSlot(previous => previous === target ? previous : target);
      // Step 4 should show the actual property catalog without requiring a
      // second modal or a floating button outside the Auto Assign wizard.
      if (scroller.textContent?.includes('Review tomorrow’s public areas')) setExpanded(true);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); setSlot(null); };
  }, [visible, canManage]);

  const change = (areaId: string, staffId: string) => {
    if (!editable) return;
    setAssignments(previous => {
      const next = new Map(previous);
      if (staffId === 'none') next.delete(areaId);
      else next.set(areaId, staffId);
      return next;
    });
    setDirty(true);
  };

  const createArea = async () => {
    const name = newName.trim();
    if (!user || !hotelName || !editable || !canManage || creating) return;
    if (!name || name.length > 80) {
      toast.error('Enter an area name (up to 80 characters).');
      return;
    }
    const existing = areas.find(area => area.name.trim().toLowerCase() === name.toLowerCase());
    if (existing?.is_active) {
      toast.info('This area already exists in Room Overview. Choose it below.');
      return;
    }
    setCreating(true);
    try {
      let updated: Area;
      if (existing) {
        const { data, error } = await db.from('hotel_public_areas')
          .update({ is_active: true }).eq('id', existing.id).eq('hotel_name', hotelName)
          .select('id,name,description,icon,task_type,sort_order,is_active').single();
        if (error) throw error;
        updated = data as Area;
      } else {
        const kind = AREA_TYPES.find(type => type.value === newType) || AREA_TYPES[0];
        const sortOrder = areas.reduce((max, area) => Math.max(max, area.sort_order), 0) + 10;
        const { data, error } = await db.from('hotel_public_areas').insert({
          hotel_name: hotelName,
          name,
          description: newDescription.trim() || null,
          icon: kind.icon,
          task_type: kind.value,
          sort_order: sortOrder,
          is_active: true,
          created_by: user.id,
        }).select('id,name,description,icon,task_type,sort_order,is_active').single();
        if (error) throw error;
        updated = data as Area;
      }
      setAreas(previous => [...previous.filter(area => area.id !== updated.id), updated]
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      setNewName('');
      setNewDescription('');
      setNewType('public_area_cleaning');
      setShowCreate(false);
      toast.success(`${updated.name} is now available in Room Overview and tomorrow assignments.`);
      window.dispatchEvent(new CustomEvent('hotel-public-areas-changed', { detail: { hotelName } }));
    } catch (cause: any) {
      toast.error(cause?.code === '23505' ? 'This area already exists.' : 'Could not create the public area.');
    } finally {
      setCreating(false);
    }
  };

  const save = async () => {
    if (!user || !profile?.organization_slug || !hotelId || !editable || saving || !dirty) return;
    if (refreshNeeded) {
      toast.error('The plan changed while you were editing. Refresh and review before saving.');
      return;
    }
    if (conflictingEarlierTasks.length) {
      toast.error('An earlier one-off or mapped task assigns the same area to another person. Align or remove that duplicate in the room plan first.');
      return;
    }
    const activeIds = new Set(activeAreas.map(area => area.id));
    const entries = [...assignments.entries()].filter(([areaId]) => activeIds.has(areaId));
    if (entries.some(([, staffId]) => !eligibleStaffIds.has(staffId))) {
      toast.error('One or more selected workers are now unavailable or on Laundryner duty. Reassign those areas first.');
      return;
    }
    setSaving(true);
    try {
      const payload = entries.map(([areaId, staffId]) => ({ public_area_id: areaId, assigned_to: staffId }));
      const { error } = await db.rpc('save_next_day_housekeeping_public_area_assignments', {
        p_organization_slug: profile.organization_slug,
        p_hotel_id: hotelId,
        p_plan_date: selectedDate,
        p_assignments: payload,
      });
      if (error) throw error;
      setDirty(false);
      await load(false);
      window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed', {
        detail: { hotelId, planDate: selectedDate, publicAreaAssignments: payload.length },
      }));
      toast.success(`${payload.length} property public area${payload.length === 1 ? '' : 's'} saved for ${selectedDate}. Room assignments were not changed.`);
    } catch (cause) {
      console.error('[UnifiedNextDayPublicAreas] save failed:', cause);
      toast.error(cause instanceof Error ? cause.message : 'Could not save public areas.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible || !canManage || !slot) return null;
  return createPortal(
    <section data-testid="unified-next-day-property-areas" className="mb-3 rounded-xl border-2 border-emerald-300 bg-background p-3 shadow-sm" aria-label="Property public areas from Room Overview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Property public areas <Badge variant="outline">{selectedCount}/{activeAreas.length}</Badge></p>
            <p className="text-[11px] text-muted-foreground">Same areas as Hotel Room Overview · {hotelName || 'this hotel'} · {selectedDate}</p>
          </div>
        </div>
        <Button type="button" size="sm" variant={expanded ? 'secondary' : 'outline'} className="h-8 gap-1.5" aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{expanded ? 'Hide areas' : 'Manage areas'}</Button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">Assign or unassign the hotel's actual public areas, including newly created areas. Public-area-only housekeepers are supported. Saving here does not regenerate or overwrite an approved room plan.</p>
          {loading ? <div role="status" className="flex items-center gap-2 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading property areas…</div>
            : loadError ? <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm"><p>{loadError}</p><Button className="mt-2" size="sm" variant="outline" onClick={() => void load(true)}>Retry</Button></div>
            : <>
              {(planStatus === 'releasing' || planStatus === 'released') && <p role="status" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">The plan is {planStatus}; property-area assignments are read-only.</p>}
              {refreshNeeded && <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400 p-2 text-xs">The plan changed elsewhere. Your unsaved selections were not replaced.<Button size="sm" variant="outline" onClick={() => void load(true)}><RefreshCw className="mr-1 h-3 w-3" />Discard edits & refresh</Button></p>}
              {conflictingEarlierTasks.length > 0 && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />A previous one-off/mapped task for {conflictingEarlierTasks.join(', ')} has a different owner. Resolve it before saving to avoid duplicate work.</p>}
              <div className="max-h-[min(38dvh,370px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                {activeAreas.map(area => <div key={area.id} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_215px] sm:items-center">
                  <div className="flex min-w-0 items-center gap-2"><span className="text-lg" aria-hidden>{area.icon || '🧹'}</span><div className="min-w-0"><p className="text-sm font-medium">{area.name}</p>{area.description && <p className="text-[11px] text-muted-foreground">{area.description}</p>}</div></div>
                  <Select value={assignments.get(area.id) || 'none'} disabled={!editable || saving || staff.length === 0}
                    onValueChange={value => change(area.id, value)}><SelectTrigger className="h-9 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger><SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {staff.map(person => <SelectItem key={person.id} value={person.id}>{person.full_name}{person.inPlan ? ' · room plan' : person.scheduled ? ' · scheduled' : ' · area only'}</SelectItem>)}
                      {assignments.has(area.id) && !eligibleStaffIds.has(assignments.get(area.id)!) && <SelectItem value={assignments.get(area.id)!} disabled>Previously assigned worker — unavailable; change required</SelectItem>}
                    </SelectContent></Select>
                </div>)}
                {activeAreas.length === 0 && <p className="rounded-lg border border-dashed p-3 text-sm">No active property areas yet. Create one below; it will also appear in Room Overview.</p>}
              </div>
              {previousTasks.length > 0 && <p className="text-[11px] text-muted-foreground">Existing mapped/one-off tasks remain in the room plan. They are separate from this shared property catalog; duplicates with different owners must be reconciled before saving.</p>}
              <div className="rounded-lg border p-2">
                <Button type="button" size="sm" variant="ghost" className="gap-1" disabled={!editable} onClick={() => setShowCreate(value => !value)}><Plus className="h-4 w-4" />Create public area (also in Room Overview)</Button>
                {showCreate && <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Input aria-label="New public area name" placeholder="Area name" maxLength={80} value={newName} onChange={event => setNewName(event.target.value)} />
                  <Select value={newType} onValueChange={setNewType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{AREA_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.icon} {type.label}</SelectItem>)}</SelectContent></Select>
                  <Textarea className="sm:col-span-2" aria-label="New public area description" placeholder="Optional description" rows={2} value={newDescription} onChange={event => setNewDescription(event.target.value)} />
                  <Button type="button" size="sm" disabled={creating || !newName.trim()} onClick={() => void createArea()}>{creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Add to both views</Button>
                </div>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><span className="text-xs text-muted-foreground">{selectedCount} of {activeAreas.length} property areas · {staff.length} eligible cleaners</span>
                <Button size="sm" type="button" disabled={!editable || saving || loading || !!loadError || !dirty || refreshNeeded || conflictingEarlierTasks.length > 0} onClick={() => void save()}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Save property areas</Button>
              </div>
              {dirty && <p className="text-xs text-amber-700">Unsaved area changes. Save them before approving or closing the room plan.</p>}
            </>}
        </div>
      )}
    </section>,
    slot,
  );
}
