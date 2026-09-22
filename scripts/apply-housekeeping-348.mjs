// One-time patch for the large existing UI. Every anchor is asserted; never
// silently patch the wrong version of this file. Run on the dedicated #348 PR
// branch, then remove the temporary patch workflow after its commit.
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/components/dashboard/AutoRoomAssignmentImpl.tsx';
let source = readFileSync(path, 'utf8');
function once(oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`Missing source anchor: ${label}`);
  if (source.split(oldText).length !== 2) throw new Error(`Ambiguous source anchor: ${label}`);
  source = source.replace(oldText, newText);
}
function within(from, to, replacement, label) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`Missing bounded source anchors: ${label}`);
  source = source.slice(0, a) + replacement + source.slice(b);
}
once("import { moveSelectedRooms } from '@/lib/autoAssignmentBulkMove';",
`import { moveSelectedRooms } from '@/lib/autoAssignmentBulkMove';
import { generateSmartHousekeepingPlan, type HousekeepingPlanningGoal } from '@/lib/housekeepingSmartPlanner';
import { sanitizeStaffPreferences } from '@/lib/housekeepingAssignmentLearning';`, 'planning imports');
once("  savedAt: number;\n}", "  savedAt: number;\n  lockedRoomIds?: string[];\n}", 'saved draft lock model');
once("function getSaveKey(hotel: string | null | undefined, date: string): string {",
"function getSaveKey(organization: string | null | undefined, hotel: string | null | undefined, date: string): string {", 'scope draft cache');
once("  return `auto_assignment_v2_${hotel || 'unknown'}_${date}`;",
"  return `auto_assignment_v3_${organization || 'unknown'}_${hotel || 'unknown'}_${date}`;", 'version tenant cache');
once("  const saveKey = getSaveKey(profile?.assigned_hotel, selectedDate);",
"  const saveKey = getSaveKey(profile?.organization_slug, profile?.assigned_hotel, selectedDate);", 'cache key call');
once("  const [tomorrowSchedules, setTomorrowSchedules] = useState<any[]>([]);",
`  const [tomorrowSchedules, setTomorrowSchedules] = useState<any[]>([]);
  const [planningGoal, setPlanningGoal] = useState<HousekeepingPlanningGoal>('rebalance');
  const [planningExplanation, setPlanningExplanation] = useState('');
  const [lockedRoomIds, setLockedRoomIds] = useState<Set<string>>(new Set());
  const [lockHistory, setLockHistory] = useState<Set<string>[]>([]);
  const [historicalSampleCount, setHistoricalSampleCount] = useState(0);
  const [historicalPreferences, setHistoricalPreferences] = useState<Record<string, string[]>>({});`, 'planning states');
once("      .in('hotel', keys);\n    if (roomErr || !roomRows) return;",
"      .in('hotel', keys)\n      .eq('organization_slug', profile?.organization_slug || '');\n    if (roomErr || !roomRows) return;", 'live org scoped rooms');
once("        .in('hotel', hotelKeys);\n      if (roomsErr) throw roomsErr;",
"        .in('hotel', hotelKeys)\n        .eq('organization_slug', profile.organization_slug);\n      if (roomsErr) throw roomsErr;", 'fetch org scoped rooms');
once("          setPreviewHistory([]);\n          setStep('preview');",
"          setPreviewHistory([]);\n          setLockedRoomIds(new Set(isNextDayPlanning ? existingRows.filter(row =>\n            primaryItemsForLocks.some(item => item.room_id === row.room_id && item.recommendation_context?.manager_changed === true)\n          ).map(row => row.room_id) : []));\n          setStep('preview');", 'restore manager locks');
// Capture saved manager corrections without exposing them outside the hotel.
once("      existingAssignmentsRef.current = new Map(existingRows.map(row => [row.room_id, row]));",
`      const primaryItemsForLocks = isNextDayPlanning ?
        (nextDayPlan?.id ? [] : []) : [];
      existingAssignmentsRef.current = new Map(existingRows.map(row => [row.room_id, row]));`, 'lock source placeholder');
// The currently loaded `saved.items` local is scoped to the next-day block, so
// retain its correction IDs in a function-local variable rather than relying
// on stale React state in this fetch cycle.
once("      let selectedFromDb = new Set<string>(checked);",
"      let selectedFromDb = new Set<string>(checked);\n      let savedManagerRoomIds = new Set<string>();", 'correction local');
once("        const primaryItems = saved.items.filter(item =>",
"        savedManagerRoomIds = new Set(saved.items.filter(item => item.recommendation_context?.manager_changed === true).map(item => item.room_id));\n        const primaryItems = saved.items.filter(item =>", 'saved manager correction data');
once("          setLockedRoomIds(new Set(isNextDayPlanning ? existingRows.filter(row =>\n            primaryItemsForLocks.some(item => item.room_id === row.room_id && item.recommendation_context?.manager_changed === true)\n          ).map(row => row.room_id) : []));",
"          setLockedRoomIds(new Set(isNextDayPlanning ? [...savedManagerRoomIds] : []));", 'correct saved locks');
once("      const primaryItemsForLocks = isNextDayPlanning ?\n        (nextDayPlan?.id ? [] : []) : [];\n", '', 'remove temporary local');
once("        .from('assignment_patterns')\n        .select('room_number_a, room_number_b, pair_count')\n        .eq('hotel', hotelName)\n        .eq('organization_slug', profile.organization_slug);\n      setRoomAffinity(patternData?.length ? buildAffinityMap(patternData) : undefined);",
`        .from('assignment_patterns')
        .select('room_number_a, room_number_b, pair_count, last_seen_at')
        .eq('hotel', hotelName)
        .eq('organization_slug', profile.organization_slug)
        .order('last_seen_at', { ascending: false })
        .limit(250);
      // Keep tenant-specific historical signals bounded, recent and interpretable.
      const recentPatterns = (patternData || []).flatMap(pattern => {
        const age = pattern.last_seen_at ? (Date.now() - Date.parse(pattern.last_seen_at)) / 86400000 : 999;
        if (!Number.isFinite(age) || age < 0 || age > 180 || pattern.pair_count < 2) return [];
        return [{ ...pattern, pair_count: Math.max(1, Math.round(pattern.pair_count * Math.exp(-age / 90))) }];
      });
      setRoomAffinity(recentPatterns.length >= 3 ? buildAffinityMap(recentPatterns) : undefined);
      const { data: learningProfile } = await (supabase as any)
        .from('housekeeping_assignment_learning_profiles')
        .select('sample_count,correction_count,staff_preferences')
        .eq('organization_slug', profile.organization_slug)
        .eq('hotel_id', profile.assigned_hotel)
        .maybeSingle();
      const samples = Math.max(0, Number(learningProfile?.sample_count) || 0);
      setHistoricalSampleCount(samples);
      const validStaffIds = new Set(staffList.map(staff => staff.id));
      const localPrefs = sanitizeStaffPreferences(learningProfile?.staff_preferences);
      setHistoricalPreferences(samples >= 5
        ? Object.fromEntries(Object.entries(localPrefs).filter(([id]) => validStaffIds.has(id))) : {});`, 'bounded scoped learning');
once("          setPreviewHistory([]);\n          setLockedRoomIds(", "          setPreviewHistory([]);\n          setPlanningExplanation('Existing assignment loaded. Regeneration preserves manager-adjusted rooms.');\n          setLockedRoomIds(", 'restore explanation');
once("          setAssignmentPreviews([]);\n          setFairnessMetrics(null);\n          setStep('select-staff');",
"          setAssignmentPreviews([]);\n          setFairnessMetrics(null);\n          setPlanningExplanation('');\n          setLockedRoomIds(new Set());\n          setStep('select-staff');", 'fresh explanation');
once("          setRestoredFromSave(true);\n          setStep('preview');",
"          setRestoredFromSave(true);\n          setLockedRoomIds(new Set(data.lockedRoomIds || []));\n          setStep('preview');", 'draft lock restoration');
once("    setPreviewHistory([]);\n\n    let restored = false;",
"    setPreviewHistory([]);\n    setLockHistory([]);\n    setPlanningExplanation('');\n\n    let restored = false;", 'reset feedback');
once("    setPreviewHistory([]);\n    setSectionTaskOwners(new Map());",
"    setPreviewHistory([]);\n    setLockHistory([]);\n    setLockedRoomIds(new Set());\n    setSectionTaskOwners(new Map());", 'laundry guard clear');
once("      savedAt: Date.now(),\n    };",
"      savedAt: Date.now(),\n      lockedRoomIds: Array.from(lockedRoomIds),\n    };", 'draft snapshot locks');
once("  }, [open, saveKey, isGozsdu, selectedStaffIds, assignmentPreviews, excludedRoomIds, maintenanceHoldRoomIds]);",
"  }, [open, saveKey, isGozsdu, selectedStaffIds, assignmentPreviews, excludedRoomIds, maintenanceHoldRoomIds, lockedRoomIds]);", 'draft deps');
once("    setPreviewHistory(history => [...history.slice(-19), previews]);",
"    setPreviewHistory(history => [...history.slice(-19), previews]);\n    setLockHistory(history => [...history.slice(-19), new Set(lockedRoomIds)]);", 'lock history');
once("    setPreviewHistory(history => history.slice(0, -1));\n    setAssignmentPreviews(previous);",
"    setPreviewHistory(history => history.slice(0, -1));\n    setLockedRoomIds(lockHistory[lockHistory.length - 1] || new Set());\n    setLockHistory(history => history.slice(0, -1));\n    setAssignmentPreviews(previous);", 'undo restores locks');
once("    setExcludedRoomIds(new Set());\n    setMaintenanceHoldRoomIds(new Set());\n    setSelectedRoomForMove(null);",
"    setExcludedRoomIds(new Set());\n    setMaintenanceHoldRoomIds(new Set());\n    setLockedRoomIds(new Set());\n    setSelectedRoomForMove(null);", 'clear draft locks');
once("    let best: AssignmentPreview[] | null = null;\n", "    let best: AssignmentPreview[] | null = null;\n", 'ensure generation anchor');
within("    let best: AssignmentPreview[] | null = null;", "  };\n\n  const applyRoomMove",
`    const scheduleRows = isNextDayPlanning ? tomorrowSchedules : [];
    const scheduleByStaff = new Map(scheduleRows.map((row: any) => [row.user_id, row]));
    if (isNextDayPlanning && scheduleRows.length && selectedStaff.some(staff => {
      const row = scheduleByStaff.get(staff.id) as any;
      return !row || ['off', 'leave', 'sick', 'absent', 'cancelled'].includes(row.status);
    })) {
      toast.error('Some selected employees have no active shift on this date. Update their schedule or remove them before regenerating.');
      return;
    }
    const toMinutes = (value: unknown): number | null => {
      if (typeof value !== 'string' || !/^\\d{2}:\\d{2}/.test(value)) return null;
      const [hours, minutes] = value.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const shiftMinutes = new Map<string, number>();
    if (isNextDayPlanning) for (const staff of selectedStaff) {
      const schedule = scheduleByStaff.get(staff.id) as any;
      if (!schedule) continue;
      const start = toMinutes(schedule.shift_start);
      const end = toMinutes(schedule.shift_end);
      if (start !== null && end !== null) shiftMinutes.set(staff.id, (end - start + 1440) % 1440 || 1440);
    }
    const fixedAreaOwners = new Map(sectionTaskOwners);
    lockedSectionTasks.forEach((value, taskId) => {
      if (value.status !== 'assigned' && value.assignedTo) fixedAreaOwners.set(taskId, value.assignedTo);
    });
    hotelConfig.staffPreferences = historicalPreferences;
    const result = generateSmartHousekeepingPlan({
      rooms: roomsToAssign,
      staff: selectedStaff,
      organizationSlug: profile?.organization_slug || '',
      hotelId: profile?.assigned_hotel || '',
      hotelConfig,
      goal: planningGoal,
      previous: assignmentPreviews.length ? assignmentPreviews : undefined,
      lockedRoomIds,
      shiftMinutes,
      publicAreaTemplates: sectionTaskTemplates,
      fixedAreaOwners,
      wingProximity,
      affinity: roomAffinity,
      historicalSampleCount,
      gozsdu: isGozsdu,
      seed: Date.now(),
    });
    setPlanningExplanation(result.reason);
    if (!result.changed || !result.plan) {
      if (result.plan) toast.info(result.reason);
      else toast.error(result.reason);
      return;
    }
    const previews = result.plan;
    if (isGozsdu && !gozsduPreviewCoversWork(previews, roomsToAssign.length, cleaningStaffIds, isLaundryner)) {
      toast.error('Allocation incomplete: check building routes, unavailable rooms and staffing.');
      return;
    }
    pushHistory(assignmentPreviews);
    setAssignmentPreviews(previews);
    if (isNextDayPlanning) {
      setSuggestedByRoom(new Map(previews.flatMap(preview =>
        preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),
      )));
      setSharedByRoom(new Map());
    }
    setFairnessMetrics(computeFairnessMetrics(previews));
    setSelectedRoomForMove(null);
    setBulkSelectedRoomIds(new Set());
    setBulkDestinationStaffId('');
    setStep('preview');
`, 'replace regeneration with validated planner');
// Eliminate stale / cross-tenant AI insight cache; historical preferences above
// are only loaded from organization+property-scoped RLS backed data.
within("      const insightsKey = `ai_insights_${hotelName}`;", "    } catch {\n      // Smart settings", "      hotelConfig.staffPreferences = historicalPreferences;\n", 'remove unscoped preferences');
once("        .in('hotel_id', searchKeys)\n        .limit(1)",
"        .in('hotel_id', searchKeys)\n        .eq('organization_slug', profile?.organization_slug || '')\n        .limit(1)", 'scope autoassign profile');
once("    pushHistory(assignmentPreviews);\n    setAssignmentPreviews(next);\n    if (isNextDayPlanning && sharedByRoom.get(roomId)",
"    pushHistory(assignmentPreviews);\n    setLockedRoomIds(previous => new Set([...previous, roomId]));\n    setAssignmentPreviews(next);\n    if (isNextDayPlanning && sharedByRoom.get(roomId)", 'lock manual room move');
once("    pushHistory(assignmentPreviews); // one Undo restores the whole bulk action\n    setAssignmentPreviews(result.previews);",
"    pushHistory(assignmentPreviews); // one Undo restores the whole bulk action\n    setLockedRoomIds(previous => new Set([...previous, ...result.movedRoomIds]));\n    setAssignmentPreviews(result.previews);", 'lock manual bulk');
once("  const removeRoomFromPreview = (roomId: string, fromStaffId: string, markExcluded: boolean = true) => {\n    pushHistory(assignmentPreviews);",
"  const removeRoomFromPreview = (roomId: string, fromStaffId: string, markExcluded: boolean = true) => {\n    pushHistory(assignmentPreviews);\n    setLockedRoomIds(previous => new Set([...previous].filter(id => id !== roomId)));", 'remove excluded lock');
once("        <span className=\"font-semibold\">{roomDisplayName(room)}</span>",
`        <span className="font-semibold">{roomDisplayName(room)}</span>
        {lockedRoomIds.has(room.id) && <button type="button" className="rounded border border-amber-500 px-1 text-[9px]" title="Manual assignment locked; tap to allow auto-regeneration" aria-label={'Unlock room ' + roomDisplayName(room)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setLockedRoomIds(previous => new Set([...previous].filter(id => id !== room.id))); }}>🔒</button>}`, 'room lock badge');
// The replacement above emits a template string inside TSX after escaping; no
// runtime interpolation from this script is permitted.
once("                <div role=\"note\" className=\"flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-sky-200",
`                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
                  <label htmlFor="hk-planning-goal" className="font-semibold">Regeneration goal</label>
                  <Select value={planningGoal} onValueChange={value => setPlanningGoal(value as HousekeepingPlanningGoal)}>
                    <SelectTrigger id="hk-planning-goal" aria-label="Regeneration goal" className="h-8 w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rebalance">Rebalance workload</SelectItem>
                      <SelectItem value="locality">Keep rooms close</SelectItem>
                      <SelectItem value="checkouts">Balance checkouts</SelectItem>
                      <SelectItem value="alternative">Try another arrangement</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">{lockedRoomIds.size} manually locked room(s)</span>
                  {planningExplanation && <p role="status" className="w-full text-foreground">{planningExplanation}</p>}
                </div>
                <div role="note" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-sky-200`, 'regeneration control and feedback');
once("  }, [step, previewHistory]);", "  }, [step, previewHistory, lockHistory]);", 'undo lock deps');
writeFileSync(path, source);
console.log('Applied source patch for #348: tenant-aware learning, capacity-aware regeneration, locks, undo and feedback.');
