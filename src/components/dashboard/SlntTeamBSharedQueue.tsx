import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Hand,
  Loader2,
  RefreshCw,
  Settings2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { hasManagerPowers } from '@/lib/roleAccess';
import { isSlntOrganization } from '@/lib/slnt14DayHousekeeping';
import {
  isMissingTeamBOptionalSchemaError,
  resolveTeamBOperationalStaffing,
  staffingSourceLabel,
} from '@/lib/slntTeamBOperationalStaffing';
import {
  SLNT_TEAM_B_CODE,
  summarizeSlntTeamTasks,
  type SlntTeamTaskStatus,
} from '@/lib/slntTeamB';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type TeamRow = { id: string; code: string; name: string; assignment_mode: string };
type MemberRow = { user_id: string; is_active: boolean };
type ProfileRow = { id: string; full_name: string; role: string; acts_as_housekeeper: boolean };
type TaskRow = {
  id: string;
  room_id: string;
  service_date: string;
  assignment_type: 'checkout_cleaning' | 'daily_cleaning';
  priority: number;
  status: SlntTeamTaskStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  room_assignment_id: string | null;
};
type ScheduleRow = { user_id: string; status: 'draft' | 'published' | 'off' };

type Copy = {
  title: string;
  subtitle: string;
  manageStaff: string;
  refresh: string;
  noTasks: string;
  queue: string;
  claimed: string;
  claim: string;
  claiming: string;
  claimedByYou: string;
  staffTitle: string;
  staffHelp: string;
  save: string;
  cancel: string;
  noMembers: string;
  noMembersAction: string;
  notWorking: string;
  working: string;
  notSelected: string;
  checkout: string;
  daily: string;
  exceptionHelp: string;
};

const COPY: Record<'en' | 'hu', Copy> = {
  en: {
    title: 'Team B · today',
    subtitle: 'Today’s planned work is assigned automatically. Only exceptions that still need a cleaner are shown here.',
    manageStaff: 'Team B staff',
    refresh: 'Refresh',
    noTasks: 'All Team B work is assigned. No manager action is needed.',
    queue: 'Unassigned',
    claimed: 'Assigned',
    claim: 'Claim room',
    claiming: 'Claiming…',
    claimedByYou: 'Claimed by you · continue in My Rooms below',
    staffTitle: 'Team B staff',
    staffHelp: 'Choose which housekeeping employees belong to Team B. Daily working staff are taken automatically from the saved Team B day plan, then the published Staff Schedule. Managers can override a future date inside Plan Team B.',
    save: 'Save Team B staff',
    cancel: 'Cancel',
    noMembers: 'Team B rooms are mapped, but no housekeeping staff are assigned to Team B yet.',
    noMembersAction: 'Choose Team B staff',
    notWorking: 'You are not selected as working for Team B today.',
    working: 'Working',
    notSelected: 'Not working today',
    checkout: 'Checkout',
    daily: 'Service reminder',
    exceptionHelp: 'Only rooms that still need a cleaner are shown below.',
  },
  hu: {
    title: 'B csapat · ma',
    subtitle: 'A mai tervezett munkát a HotelCare automatikusan kiosztja. Itt csak a még kiosztatlan kivételek jelennek meg.',
    manageStaff: 'B csapat személyzet',
    refresh: 'Frissítés',
    noTasks: 'Minden B csapat feladat ki van osztva. Nincs szükség vezetői beavatkozásra.',
    queue: 'Kiosztatlan',
    claimed: 'Kiosztva',
    claim: 'Szoba felvétele',
    claiming: 'Felvétel…',
    claimedByYou: 'Ön vette fel · folytassa lent a Saját szobák résznél',
    staffTitle: 'B csapat személyzet',
    staffHelp: 'Válassza ki, mely takarítók tartoznak a B csapathoz. A napi dolgozókat a HotelCare először a mentett B csapat tervből, majd a közzétett munkabeosztásból veszi. A jövőbeli napok a B csapat tervezőben felülírhatók.',
    save: 'B csapat személyzet mentése',
    cancel: 'Mégse',
    noMembers: 'A B csapat szobái be vannak állítva, de még nincs takarító a B csapathoz rendelve.',
    noMembersAction: 'B csapat személyzet kiválasztása',
    notWorking: 'Ön nincs mára dolgozó B csapattagként kijelölve.',
    working: 'Dolgozik',
    notSelected: 'Ma nem dolgozik',
    checkout: 'Kijelentkezés',
    daily: 'Szervizemlékeztető',
    exceptionHelp: 'Lent csak azok a szobák láthatók, amelyekhez még takarító szükséges.',
  },
};

function isHungarian(language?: string | null) {
  return (language || '').toLowerCase().startsWith('hu');
}

export function SlntTeamBSharedQueue() {
  const { user, profile } = useAuth();
  const isSlnt = isSlntOrganization(profile?.organization_slug);
  const canManage = !!profile?.role && hasManagerPowers(profile.role);
  const language: 'en' | 'hu' = isHungarian(profile?.preferred_language) ? 'hu' : 'en';
  const text = COPY[language];
  const today = todayBudapest();

  const [team, setTeam] = useState<TeamRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [roomNames, setRoomNames] = useState<Map<string, string>>(new Map());
  const [profileNames, setProfileNames] = useState<Map<string, string>>(new Map());
  const [dayStaffIds, setDayStaffIds] = useState<Set<string>>(new Set());
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const [optionalSchemaFallback, setOptionalSchemaFallback] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [savingMembers, setSavingMembers] = useState(false);
  const [materializedForDate, setMaterializedForDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSlnt || !user) return;
    setLoading(true);
    setLoadError(null);
    setOptionalSchemaFallback(false);
    try {
      const { data: teamData, error: teamError } = await (supabase as any)
        .from('housekeeping_teams')
        .select('id,code,name,assignment_mode')
        .eq('organization_slug', 'slnt')
        .eq('code', SLNT_TEAM_B_CODE)
        .eq('is_active', true)
        .maybeSingle();
      if (teamError) throw teamError;
      if (!teamData) {
        setTeam(null);
        return;
      }
      const activeTeam = teamData as TeamRow;
      setTeam(activeTeam);

      // These are the only data sources required for the Today queue itself.
      const [memberResult, taskResult] = await Promise.all([
        (supabase as any).from('housekeeping_team_members')
          .select('user_id,is_active').eq('team_id', activeTeam.id).eq('is_active', true),
        (supabase as any).from('housekeeping_team_tasks')
          .select('id,room_id,service_date,assignment_type,priority,status,claimed_by,claimed_at,room_assignment_id')
          .eq('team_id', activeTeam.id).eq('service_date', today).neq('status', 'cancelled')
          .order('priority', { ascending: true }).order('created_at', { ascending: true }),
      ]);
      if (memberResult.error) throw memberResult.error;
      if (taskResult.error) throw taskResult.error;

      const nextMembers = (memberResult.data || []) as MemberRow[];
      let nextTasks = (taskResult.data || []) as TaskRow[];

      // Managers opening Today reconcile saved Team B planned candidates into
      // normal room assignments once per business date. The RPC is idempotent:
      // existing live assignments are preserved and only valid day-plan staff
      // can be materialized. Cleaners never need this permission or side effect.
      if (canManage && materializedForDate !== today && nextTasks.some(task => task.status === 'queued')) {
        const materializeResult = await (supabase as any).rpc('materialize_slnt_team_b_planned_assignments', {
          p_service_date: today,
        });
        if (materializeResult.error) {
          if (!isMissingTeamBOptionalSchemaError(materializeResult.error)) {
            console.warn('[SlntTeamBSharedQueue] planned assignment reconciliation failed:', materializeResult.error);
          }
        } else {
          setMaterializedForDate(today);
          const refreshedTasks = await (supabase as any).from('housekeeping_team_tasks')
            .select('id,room_id,service_date,assignment_type,priority,status,claimed_by,claimed_at,room_assignment_id')
            .eq('team_id', activeTeam.id).eq('service_date', today).neq('status', 'cancelled')
            .order('priority', { ascending: true }).order('created_at', { ascending: true });
          if (!refreshedTasks.error) nextTasks = (refreshedTasks.data || []) as TaskRow[];
          window.dispatchEvent(new CustomEvent('hk-assignment-updated', { detail: { source: 'slnt-team-b-auto-materialize' } }));
        }
      }
      const memberIds = nextMembers.map(member => member.user_id);
      setMembers(nextMembers);
      setTasks(nextTasks);
      setSelectedMembers(new Set(memberIds));

      // Day-plan staffing is newer schema. Missing optional schema must never blank Today.
      const dayStaffResult = await (supabase as any).from('housekeeping_team_day_staff')
        .select('user_id').eq('team_id', activeTeam.id).eq('service_date', today);
      if (dayStaffResult.error) {
        if (isMissingTeamBOptionalSchemaError(dayStaffResult.error)) {
          setOptionalSchemaFallback(true);
          setDayStaffIds(new Set());
        } else {
          console.warn('[SlntTeamBSharedQueue] day staffing unavailable:', dayStaffResult.error);
          setDayStaffIds(new Set());
        }
      } else {
        setDayStaffIds(new Set((dayStaffResult.data || []).map((row: any) => row.user_id)));
      }

      // Staff Schedule is an upstream convenience, not a hard dependency.
      if (memberIds.length > 0) {
        const scheduleResult = await (supabase as any).from('staff_schedules')
          .select('user_id,status').eq('organization_slug', 'slnt').eq('work_date', today).in('user_id', memberIds);
        if (scheduleResult.error) {
          console.warn('[SlntTeamBSharedQueue] Staff Schedule unavailable:', scheduleResult.error);
          setPublishedIds(new Set());
        } else {
          const schedules = (scheduleResult.data || []) as ScheduleRow[];
          setPublishedIds(new Set(schedules.filter(row => row.status === 'published').map(row => row.user_id)));
        }
      } else {
        setPublishedIds(new Set());
      }

      // Labels and manager staff picker are presentation data. Failure here is non-fatal.
      const roomIds = Array.from(new Set(nextTasks.map(task => task.room_id)));
      const personIds = Array.from(new Set([
        ...memberIds,
        ...nextTasks.map(task => task.claimed_by).filter((id): id is string => !!id),
      ]));
      const [roomsResult, namesResult, profileResult] = await Promise.all([
        roomIds.length ? (supabase as any).from('rooms').select('id,room_number').in('id', roomIds) : Promise.resolve({ data: [], error: null }),
        personIds.length ? (supabase as any).from('profiles').select('id,full_name').in('id', personIds) : Promise.resolve({ data: [], error: null }),
        canManage
          ? (supabase as any).from('profiles').select('id,full_name,role,acts_as_housekeeper').eq('organization_slug', 'slnt').is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!roomsResult.error) setRoomNames(new Map((roomsResult.data || []).map((room: any) => [room.id, room.room_number])));
      if (!namesResult.error) setProfileNames(new Map((namesResult.data || []).map((person: any) => [person.id, person.full_name])));
      if (!profileResult.error) {
        setProfiles(((profileResult.data || []) as ProfileRow[])
          .filter(candidate => candidate.role === 'housekeeping' || candidate.acts_as_housekeeper === true)
          .sort((a, b) => a.full_name.localeCompare(b.full_name)));
      } else {
        console.warn('[SlntTeamBSharedQueue] staff picker labels unavailable:', profileResult.error);
      }
    } catch (error) {
      console.error('[SlntTeamBSharedQueue] essential load failed:', error);
      const message = error instanceof Error ? error.message : 'Team B today could not be loaded.';
      setLoadError(message);
      if (canManage) toast.error(language === 'hu' ? 'A B csapat mai nézete nem tölthető be.' : 'Team B today could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canManage, isSlnt, language, materializedForDate, today, user]);

  useEffect(() => { void load(); }, [load]);

  const memberIds = useMemo(() => new Set(members.map(member => member.user_id)), [members]);
  const staffing = useMemo(() => resolveTeamBOperationalStaffing({
    memberIds,
    dayPlanIds: dayStaffIds,
    publishedIds,
    allowMemberFallback: false,
  }), [dayStaffIds, memberIds, publishedIds]);
  const isMember = !!user && memberIds.has(user.id);
  const summary = useMemo(() => summarizeSlntTeamTasks(tasks), [tasks]);
  const canClaimToday = !!user && isMember && staffing.selectedIds.has(user.id);

  const claim = async (taskId: string) => {
    if (!canClaimToday) {
      toast.warning(text.notWorking);
      return;
    }
    setClaimingId(taskId);
    try {
      const { error } = await (supabase as any).rpc('claim_housekeeping_team_task', { p_task_id: taskId });
      if (error) throw error;
      toast.success(language === 'hu' ? 'A szoba hozzáadva a saját feladataihoz.' : 'Room added to your own assignments.');
      await load();
      window.dispatchEvent(new CustomEvent('hk-assignment-updated', { detail: { source: 'slnt-team-b' } }));
    } catch (error) {
      console.error('[SlntTeamBSharedQueue] claim failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not claim this room.');
      await load();
    } finally {
      setClaimingId(null);
    }
  };

  const toggleMember = (userId: string, checked: boolean) => {
    setSelectedMembers(previous => {
      const next = new Set(previous);
      if (checked) next.add(userId); else next.delete(userId);
      return next;
    });
  };

  const saveMembers = async () => {
    setSavingMembers(true);
    try {
      const { error } = await (supabase as any).rpc('set_slnt_housekeeping_team_members', {
        p_team_code: SLNT_TEAM_B_CODE,
        p_user_ids: Array.from(selectedMembers),
      });
      if (error) throw error;
      toast.success(language === 'hu' ? 'B csapat személyzet frissítve.' : 'Team B staff updated.');
      setStaffOpen(false);
      await load();
    } catch (error) {
      console.error('[SlntTeamBSharedQueue] membership save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not update Team B staff.');
    } finally {
      setSavingMembers(false);
    }
  };

  if (!isSlnt || !user || !team) return null;
  if (!canManage && !isMember) return null;

  return (
    <>
      <Card className="border-sky-300/60 bg-sky-50/40 dark:bg-sky-950/10">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-semibold">
                <Users className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                {text.title}
                <Badge variant="outline">{text.queue}: {summary.queued}</Badge>
                <Badge variant="secondary">{text.claimed}: {summary.claimed}</Badge>
                {members.length > 0 && <Badge variant="secondary">{staffing.selectedIds.size} {text.working.toLowerCase()}</Badge>}
              </div>
              <p className="mt-1 max-w-4xl text-sm text-muted-foreground">{text.subtitle}</p>
              {members.length > 0 && staffing.source !== 'none' && (
                <p className="mt-1 text-xs text-muted-foreground">{staffingSourceLabel(staffing.source)}</p>
              )}
            </div>
            <div className="flex gap-2">
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setStaffOpen(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />{text.manageStaff}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{text.refresh}
              </Button>
            </div>
          </div>

          {loadError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><strong>{language === 'hu' ? 'A mai B csapat adatai nem tölthetők be.' : 'Team B today needs attention.'}</strong><div className="mt-0.5 text-xs opacity-80">{loadError}</div></div>
            </div>
          )}

          {/* Schema fallback is a deployment diagnostic, not an operational warning. */}

          {canManage && members.length === 0 && !loadError && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/20 dark:text-amber-100">
              <span>{text.noMembers}</span>
              <Button size="sm" variant="outline" onClick={() => setStaffOpen(true)}>{text.noMembersAction}</Button>
            </div>
          )}

          {isMember && !canClaimToday && tasks.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">{text.notWorking}</div>
          )}

          {canManage && members.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {members.map(member => {
                const working = staffing.selectedIds.has(member.user_id);
                return <Badge key={member.user_id} variant={working ? 'default' : 'outline'}>{profileNames.get(member.user_id) || member.user_id.slice(0, 8)} · {working ? text.working : text.notSelected}</Badge>;
              })}
            </div>
          )}

          {summary.queued === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : text.noTasks}</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {tasks.filter(task => task.status === 'queued').map(task => {
                const claimedByMe = task.claimed_by === user.id;
                const isQueued = task.status === 'queued';
                return (
                  <div key={task.id} className="rounded-xl border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div><div className="font-semibold">{roomNames.get(task.room_id) || task.room_id.slice(0, 8)}</div><div className="mt-1 text-xs text-muted-foreground">{task.assignment_type === 'checkout_cleaning' ? text.checkout : text.daily}</div></div>
                      <Badge variant={isQueued ? 'outline' : 'secondary'}>{isQueued ? text.queue : text.claimed}</Badge>
                    </div>
                    {task.status === 'claimed' ? (
                      <div className="mt-3 flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{claimedByMe ? text.claimedByYou : `${text.claimed}: ${task.claimed_by ? (profileNames.get(task.claimed_by) || task.claimed_by.slice(0, 8)) : '—'}`}</div>
                    ) : isMember ? (
                      <Button className="mt-3 w-full" size="sm" disabled={!canClaimToday || claimingId === task.id} onClick={() => void claim(task.id)}>
                        {claimingId === task.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Hand className="mr-2 h-4 w-4" />}{claimingId === task.id ? text.claiming : text.claim}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Dialog open={staffOpen} onOpenChange={setStaffOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{text.staffTitle}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{text.staffHelp}</p>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto py-2">
              {profiles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{language === 'hu' ? 'Nem található aktív takarítói profil.' : 'No active housekeeping staff profiles are available.'}</div>
              ) : profiles.map(candidate => (
                <label key={candidate.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <Checkbox checked={selectedMembers.has(candidate.id)} onCheckedChange={checked => toggleMember(candidate.id, checked === true)} />
                  <div className="min-w-0 flex-1"><div className="font-medium">{candidate.full_name}</div><div className="text-xs text-muted-foreground">{candidate.role}</div></div>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStaffOpen(false)}>{text.cancel}</Button>
              <Button disabled={savingMembers || profiles.length === 0} onClick={() => void saveMembers()}>{savingMembers && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{text.save}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
