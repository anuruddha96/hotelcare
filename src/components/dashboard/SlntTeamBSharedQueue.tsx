import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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

type TeamRow = {
  id: string;
  code: string;
  name: string;
  assignment_mode: string;
};

type MemberRow = {
  user_id: string;
  is_active: boolean;
};

type ProfileRow = {
  id: string;
  full_name: string;
  role: string;
  acts_as_housekeeper: boolean;
};

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

type ScheduleRow = {
  user_id: string;
  status: 'draft' | 'published' | 'off';
};

type Copy = {
  title: string;
  subtitle: string;
  configure: string;
  refresh: string;
  noTasks: string;
  queue: string;
  claimed: string;
  claim: string;
  claiming: string;
  claimedByYou: string;
  configureTitle: string;
  configureHelp: string;
  save: string;
  cancel: string;
  noMembers: string;
  notWorking: string;
  working: string;
  notSelected: string;
  checkout: string;
  daily: string;
};

const COPY: Record<'en' | 'hu', Copy> = {
  en: {
    title: 'Team B shared rooms',
    subtitle: 'All Team B cleaners selected as working today see the same released room queue. A room becomes individual only after one cleaner claims it.',
    configure: 'Configure Team B logins',
    refresh: 'Refresh',
    noTasks: 'No Team B shared rooms have been released for today.',
    queue: 'Available',
    claimed: 'Claimed',
    claim: 'Claim room',
    claiming: 'Claiming…',
    claimedByYou: 'Claimed by you · continue in My Rooms below',
    configureTitle: 'Configure Team B logins',
    configureHelp: 'Select the HotelCare housekeeping logins that belong to Team B. Daily working staff are chosen separately inside the Team B 14-day planner.',
    save: 'Save Team B',
    cancel: 'Cancel',
    noMembers: 'Team B room mapping is ready, but no HotelCare logins are mapped to Team B yet.',
    notWorking: 'You are not selected as working for Team B today.',
    working: 'Working',
    notSelected: 'Not selected today',
    checkout: 'Checkout',
    daily: 'Daily',
  },
  hu: {
    title: 'B csapat közös szobái',
    subtitle: 'A ma dolgozónak kijelölt B csapattagok ugyanazt a kiadott szobalistát látják. A szoba csak felvétel után lesz egyéni feladat.',
    configure: 'B csapat belépések beállítása',
    refresh: 'Frissítés',
    noTasks: 'Mára még nincs kiadott közös B csapat feladat.',
    queue: 'Elérhető',
    claimed: 'Lefoglalva',
    claim: 'Szoba felvétele',
    claiming: 'Felvétel…',
    claimedByYou: 'Ön vette fel · folytassa lent a Saját szobák résznél',
    configureTitle: 'B csapat belépések beállítása',
    configureHelp: 'Válassza ki, mely HotelCare takarítói belépések tartoznak a B csapathoz. A napi dolgozókat külön, a B csapat 14 napos tervezőjében lehet kiválasztani.',
    save: 'B csapat mentése',
    cancel: 'Mégse',
    noMembers: 'A B csapat 46 szobás térképe kész, de még nincs HotelCare belépés hozzárendelve.',
    notWorking: 'Ön nincs mára dolgozó B csapattagként kijelölve.',
    working: 'Dolgozik',
    notSelected: 'Ma nincs kijelölve',
    checkout: 'Kijelentkezés',
    daily: 'Napi',
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
  const [hasDayStaffPlan, setHasDayStaffPlan] = useState(false);
  const [legacyPublishedIds, setLegacyPublishedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [savingMembers, setSavingMembers] = useState(false);

  const load = useCallback(async () => {
    if (!isSlnt || !user) return;
    setLoading(true);
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

      const [memberResult, taskResult, profileResult, dayStaffResult] = await Promise.all([
        (supabase as any)
          .from('housekeeping_team_members')
          .select('user_id,is_active')
          .eq('team_id', activeTeam.id)
          .eq('is_active', true),
        (supabase as any)
          .from('housekeeping_team_tasks')
          .select('id,room_id,service_date,assignment_type,priority,status,claimed_by,claimed_at,room_assignment_id')
          .eq('team_id', activeTeam.id)
          .eq('service_date', today)
          .neq('status', 'cancelled')
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true }),
        canManage
          ? (supabase as any)
              .from('profiles')
              .select('id,full_name,role,acts_as_housekeeper')
              .eq('organization_slug', 'slnt')
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
        (supabase as any)
          .from('housekeeping_team_day_staff')
          .select('user_id')
          .eq('team_id', activeTeam.id)
          .eq('service_date', today),
      ]);
      if (memberResult.error) throw memberResult.error;
      if (taskResult.error) throw taskResult.error;
      if (profileResult.error) throw profileResult.error;
      if (dayStaffResult.error) throw dayStaffResult.error;

      const nextMembers = (memberResult.data || []) as MemberRow[];
      const nextTasks = (taskResult.data || []) as TaskRow[];
      const nextDayStaffIds = new Set((dayStaffResult.data || []).map((row: any) => row.user_id));
      const eligibleProfiles = ((profileResult.data || []) as ProfileRow[])
        .filter(candidate => candidate.role === 'housekeeping' || candidate.acts_as_housekeeper === true)
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
      setMembers(nextMembers);
      setTasks(nextTasks);
      setProfiles(eligibleProfiles);
      setSelectedMembers(new Set(nextMembers.map(member => member.user_id)));
      setDayStaffIds(nextDayStaffIds);
      setHasDayStaffPlan(nextDayStaffIds.size > 0);

      const roomIds = Array.from(new Set(nextTasks.map(task => task.room_id)));
      const personIds = Array.from(new Set([
        ...nextMembers.map(member => member.user_id),
        ...nextTasks.map(task => task.claimed_by).filter((id): id is string => !!id),
      ]));

      const [roomsResult, namesResult, scheduleResult] = await Promise.all([
        roomIds.length
          ? (supabase as any).from('rooms').select('id,room_number').in('id', roomIds)
          : Promise.resolve({ data: [], error: null }),
        personIds.length
          ? (supabase as any).from('profiles').select('id,full_name').in('id', personIds)
          : Promise.resolve({ data: [], error: null }),
        nextMembers.length
          ? (supabase as any)
              .from('staff_schedules')
              .select('user_id,status')
              .eq('organization_slug', 'slnt')
              .eq('work_date', today)
              .in('user_id', nextMembers.map(member => member.user_id))
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (roomsResult.error) throw roomsResult.error;
      if (namesResult.error) throw namesResult.error;
      if (scheduleResult.error) throw scheduleResult.error;

      const schedules = (scheduleResult.data || []) as ScheduleRow[];
      setLegacyPublishedIds(new Set(schedules.filter(row => row.status === 'published').map(row => row.user_id)));
      setRoomNames(new Map((roomsResult.data || []).map((room: any) => [room.id, room.room_number])));
      setProfileNames(new Map((namesResult.data || []).map((person: any) => [person.id, person.full_name])));
    } catch (error) {
      console.error('[SlntTeamBSharedQueue] load failed:', error);
      if (canManage) toast.error(error instanceof Error ? error.message : 'Could not load Team B.');
    } finally {
      setLoading(false);
    }
  }, [canManage, isSlnt, today, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberIds = useMemo(() => new Set(members.map(member => member.user_id)), [members]);
  const isMember = !!user && memberIds.has(user.id);
  const summary = useMemo(() => summarizeSlntTeamTasks(tasks), [tasks]);
  const canClaimToday = !!user && isMember && (
    hasDayStaffPlan ? dayStaffIds.has(user.id) : legacyPublishedIds.has(user.id)
  );

  const claim = async (taskId: string) => {
    if (!canClaimToday) {
      toast.warning(text.notWorking);
      return;
    }
    setClaimingId(taskId);
    try {
      const { error } = await (supabase as any).rpc('claim_housekeeping_team_task', {
        p_task_id: taskId,
      });
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
      if (checked) next.add(userId);
      else next.delete(userId);
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
      toast.success(language === 'hu' ? 'B csapat frissítve.' : 'Team B logins updated.');
      setConfigOpen(false);
      await load();
    } catch (error) {
      console.error('[SlntTeamBSharedQueue] membership save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not update Team B.');
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
              </div>
              <p className="mt-1 max-w-4xl text-sm text-muted-foreground">{text.subtitle}</p>
            </div>
            <div className="flex gap-2">
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  {text.configure}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {text.refresh}
              </Button>
            </div>
          </div>

          {canManage && members.length === 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              {text.noMembers}
            </div>
          )}

          {isMember && !canClaimToday && tasks.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              {text.notWorking}
            </div>
          )}

          {canManage && members.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {members.map(member => {
                const working = hasDayStaffPlan
                  ? dayStaffIds.has(member.user_id)
                  : legacyPublishedIds.has(member.user_id);
                return (
                  <Badge key={member.user_id} variant={working ? 'default' : 'outline'}>
                    {profileNames.get(member.user_id) || member.user_id.slice(0, 8)} · {working ? text.working : text.notSelected}
                  </Badge>
                );
              })}
            </div>
          )}

          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : text.noTasks}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {tasks.map(task => {
                const claimedByMe = task.claimed_by === user.id;
                const isQueued = task.status === 'queued';
                return (
                  <div key={task.id} className="rounded-xl border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{roomNames.get(task.room_id) || task.room_id.slice(0, 8)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {task.assignment_type === 'checkout_cleaning' ? text.checkout : text.daily}
                        </div>
                      </div>
                      <Badge variant={isQueued ? 'outline' : 'secondary'}>{isQueued ? text.queue : text.claimed}</Badge>
                    </div>

                    {task.status === 'claimed' ? (
                      <div className="mt-3 flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        {claimedByMe
                          ? text.claimedByYou
                          : `${text.claimed}: ${task.claimed_by ? (profileNames.get(task.claimed_by) || task.claimed_by.slice(0, 8)) : '—'}`}
                      </div>
                    ) : isMember ? (
                      <Button
                        className="mt-3 w-full"
                        size="sm"
                        disabled={!canClaimToday || claimingId === task.id}
                        onClick={() => void claim(task.id)}
                      >
                        {claimingId === task.id
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <Hand className="mr-2 h-4 w-4" />}
                        {claimingId === task.id ? text.claiming : text.claim}
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
        <Dialog open={configOpen} onOpenChange={setConfigOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{text.configureTitle}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{text.configureHelp}</p>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto py-2">
              {profiles.map(candidate => (
                <label key={candidate.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={selectedMembers.has(candidate.id)}
                    onCheckedChange={checked => toggleMember(candidate.id, checked === true)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{candidate.full_name}</div>
                    <div className="text-xs text-muted-foreground">{candidate.role}</div>
                  </div>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfigOpen(false)}>{text.cancel}</Button>
              <Button disabled={savingMembers} onClick={() => void saveMembers()}>
                {savingMembers && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {text.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
