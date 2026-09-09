from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{label}: start marker missing")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{label}: end marker missing")
    return text[:start] + replacement + text[end:]


impl_path = Path('src/components/dashboard/AutoRoomAssignmentImpl.tsx')
text = impl_path.read_text()

text = replace_once(
    text,
    "import { getLocalDateString } from '@/lib/utils';\n",
    "import { getLocalDateString } from '@/lib/utils';\nimport {\n  buildTomorrowAutoAssignRooms,\n  loadExistingNextDayPlan,\n  saveApprovedNextDayAutoAssignPlan,\n  type NextDayPlan,\n} from '@/lib/nextDayAutoAssignBridge';\n",
    'bridge import',
)

text = replace_once(
    text,
    "interface AutoRoomAssignmentProps {\n  open: boolean;\n  onOpenChange: (open: boolean) => void;\n  selectedDate: string;\n  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;\n}",
    "interface AutoRoomAssignmentProps {\n  open: boolean;\n  onOpenChange: (open: boolean) => void;\n  selectedDate: string;\n  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;\n  planningMode?: 'live' | 'next-day';\n  pmsSyncedAt?: string | null;\n}",
    'props',
)

text = replace_once(
    text,
    "export function AutoRoomAssignment({\n  open,\n  onOpenChange,\n  selectedDate,\n  onAssignmentCreated,\n}: AutoRoomAssignmentProps) {\n  const { user, profile } = useAuth();\n  const { t } = useTranslation();\n  const isMobile = useIsMobile();",
    "export function AutoRoomAssignment({\n  open,\n  onOpenChange,\n  selectedDate,\n  onAssignmentCreated,\n  planningMode = 'live',\n  pmsSyncedAt = null,\n}: AutoRoomAssignmentProps) {\n  const { user, profile } = useAuth();\n  const { t } = useTranslation();\n  const isMobile = useIsMobile();\n  const isNextDayPlanning = planningMode === 'next-day';",
    'destructure planning mode',
)

text = replace_once(
    text,
    "  const [draggingAreaTaskId, setDraggingAreaTaskId] = useState<string | null>(null);\n",
    "  const [draggingAreaTaskId, setDraggingAreaTaskId] = useState<string | null>(null);\n  const [nextDayPlan, setNextDayPlan] = useState<NextDayPlan | null>(null);\n  const [nextDayPmsSyncedAt, setNextDayPmsSyncedAt] = useState<string | null>(pmsSyncedAt);\n  const [autoRelease, setAutoRelease] = useState(true);\n  const [sharedByRoom, setSharedByRoom] = useState<Map<string, string>>(new Map());\n  const [suggestedByRoom, setSuggestedByRoom] = useState<Map<string, string>>(new Map());\n  const [tomorrowSchedules, setTomorrowSchedules] = useState<any[]>([]);\n",
    'next-day state',
)

text = replace_once(
    text,
    "  const refreshLiveRoomState = async () => {\n    const keys = hotelKeysRef.current;\n    if (!open || keys.length === 0) return;",
    "  const refreshLiveRoomState = async () => {\n    if (isNextDayPlanning) return;\n    const keys = hotelKeysRef.current;\n    if (!open || keys.length === 0) return;",
    'skip live refresh tomorrow',
)

text = replace_once(
    text,
    "  useEffect(() => {\n    if (!open) return;\n    let cancelled = false;\n    let debounce: ReturnType<typeof setTimeout> | null = null;\n\n    const schedule = () => {",
    "  useEffect(() => {\n    if (!open || isNextDayPlanning) return;\n    let cancelled = false;\n    let debounce: ReturnType<typeof setTimeout> | null = null;\n\n    const schedule = () => {",
    'skip realtime tomorrow',
)

text = replace_once(
    text,
    "  }, [open, selectedDate, profile?.assigned_hotel]);\n\n  const fetchData = async",
    "  }, [open, selectedDate, profile?.assigned_hotel, isNextDayPlanning]);\n\n  useEffect(() => {\n    if (isNextDayPlanning && pmsSyncedAt) setNextDayPmsSyncedAt(pmsSyncedAt);\n  }, [isNextDayPlanning, pmsSyncedAt]);\n\n  const fetchData = async",
    'realtime dependencies',
)

attendance_start = "      const hotelStaffIds = new Set(staffList.map(staff => staff.id));\n      const { data: attendanceData } = await supabase"
attendance_end = "\n\n      const { data: roomRows, error: roomsErr } = await supabase"
attendance_replacement = """      const hotelStaffIds = new Set(staffList.map(staff => staff.id));
      let checked = new Set<string>();
      if (isNextDayPlanning) {
        const { data: scheduleData, error: scheduleError } = await (supabase as any)
          .from('staff_schedules')
          .select('id,user_id,work_date,shift_start,shift_end,status,notes')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', profile.assigned_hotel)
          .eq('work_date', selectedDate);
        if (scheduleError) throw scheduleError;
        const schedules = scheduleData || [];
        setTomorrowSchedules(schedules);
        checked = new Set(
          schedules
            .filter((row: any) => row.status !== 'off' && hotelStaffIds.has(row.user_id))
            .map((row: any) => row.user_id),
        );
      } else {
        const { data: attendanceData } = await supabase
          .from('staff_attendance')
          .select('user_id')
          .eq('work_date', selectedDate)
          .in('status', ['checked_in', 'on_break']);
        checked = new Set((attendanceData || []).map(row => row.user_id).filter(id => hotelStaffIds.has(id)));
        setTomorrowSchedules([]);
      }
      setCheckedInStaff(checked);"""
text = replace_between(text, attendance_start, attendance_end, attendance_replacement, 'attendance/schedule branch')

text = replace_once(
    text,
    "      if (sectionTaskIds.length > 0) {\n        const { data: liveTaskRows } = await (supabase as any)",
    "      if (!isNextDayPlanning && sectionTaskIds.length > 0) {\n        const { data: liveTaskRows } = await (supabase as any)",
    'skip live public task locks tomorrow',
)

rooms_start = "      const allHotelRooms = (roomRows || []).map(addSectionContext);\n"
rooms_end = "      const { data: layoutData } = await supabase\n"
rooms_replacement = """      const allHotelRooms = (roomRows || []).map(addSectionContext);
      let workingRooms: RoomForAssignment[] = [];
      let existingRows: ExistingAssignment[] = [];
      let selectedFromDb = new Set<string>(checked);

      if (isNextDayPlanning) {
        if (!profile.assigned_hotel) throw new Error('Hotel access is missing');
        const [workload, saved] = await Promise.all([
          buildTomorrowAutoAssignRooms({
            organizationSlug: profile.organization_slug,
            hotelId: profile.assigned_hotel,
            selectedDate,
            roomRows: allHotelRooms,
          }),
          loadExistingNextDayPlan({
            organizationSlug: profile.organization_slug,
            hotelId: profile.assigned_hotel,
            selectedDate,
          }),
        ]);
        workingRooms = workload.rooms;
        setNextDayPlan(saved.plan);
        setAutoRelease(saved.plan?.auto_release ?? true);
        setNextDayPmsSyncedAt(pmsSyncedAt || workload.capturedAt || saved.plan?.pms_synced_at || null);

        const primaryItems = saved.items.filter(item =>
          item.source !== 'shared' && item.recommendation_context?.assignment_role !== 'shared'
        );
        const sharedItems = saved.items.filter(item =>
          item.source === 'shared' || item.recommendation_context?.assignment_role === 'shared'
        );
        setSharedByRoom(new Map(sharedItems.map(item => [item.room_id, item.assigned_to])));
        setSuggestedByRoom(new Map(primaryItems.map(item => [
          item.room_id,
          item.recommendation_context?.suggested_staff_id || item.assigned_to,
        ])));
        setSectionTaskOwners(new Map(saved.areas.flatMap(area =>
          area.source === 'mapped' && area.section_task_id
            ? [[area.section_task_id, area.assigned_to] as [string, string]]
            : []
        )));
        setPublicAreaAssignments(new Map(saved.areas.flatMap(area =>
          area.source === 'manual' && area.task_key.startsWith('manual:')
            ? [[area.task_key.slice('manual:'.length), area.assigned_to] as [string, string]]
            : []
        )));

        existingRows = primaryItems.map(item => ({
          id: item.id,
          room_id: item.room_id,
          assigned_to: item.assigned_to,
          assignment_type: item.assignment_type,
          status: 'assigned',
          priority: item.priority,
          ready_to_clean: item.assignment_type === 'daily_cleaning',
          pms_hold: false,
          pms_hold_reason: null,
        }));
        const planOwners = new Set(existingRows.map(row => row.assigned_to));
        selectedFromDb = new Set([
          ...Array.from(checked),
          ...saved.staffIds,
          ...Array.from(planOwners),
          ...sharedItems.map(item => item.assigned_to),
        ]);
      } else {
        setNextDayPlan(null);
        setAutoRelease(true);
        setSharedByRoom(new Map());
        setSuggestedByRoom(new Map());
        const roomIds = allHotelRooms.map(room => room.id);
        if (roomIds.length > 0) {
          const { data, error } = await supabase
            .from('room_assignments')
            .select('id, room_id, assigned_to, assignment_type, status, priority, ready_to_clean, pms_hold, pms_hold_reason')
            .eq('assignment_date', selectedDate)
            .in('room_id', roomIds);
          if (error) throw error;
          const assignmentRows = (data || []) as ExistingAssignment[];
          existingRows = assignmentRows.filter(row =>
            ['assigned', 'in_progress', 'dnd_pending_retry'].includes(row.status)
          );
          const completedRoomIds = new Set(assignmentRows
            .filter(row => row.status === 'completed')
            .map(row => row.room_id));
          const assignedRoomIds = new Set(existingRows.map(row => row.room_id));
          workingRooms = allHotelRooms
            .filter(room => isRoomEligibleForAutoAssign(room, {
              hasActiveAssignment: assignedRoomIds.has(room.id),
              hasCompletedAssignment: completedRoomIds.has(room.id),
            }))
            .map(room => ({
              ...room,
              ready_to_clean: existingRows.find(row => row.room_id === room.id)?.ready_to_clean ?? false,
            }));
        } else {
          workingRooms = [];
        }
        const ownerIds = new Set(existingRows.map(row => row.assigned_to));
        selectedFromDb = new Set<string>([...Array.from(checked), ...Array.from(ownerIds)]);
      }

      existingAssignmentsRef.current = new Map(existingRows.map(row => [row.room_id, row]));
      setDirtyRooms(workingRooms);

      if (!preserveDraft) {
        if (existingRows.length > 0) {
          setEditingExistingAssignments(true);
          setSelectedStaffIds(selectedFromDb);
          const roomMap = new Map(workingRooms.map(room => [room.id, room]));
          const staffById = new Map(staffList.map(staff => [staff.id, staff]));
          const ownerIds = new Set(existingRows.map(row => row.assigned_to));
          const previewStaff: StaffForAssignment[] = [];
          for (const staff of staffList) {
            if (selectedFromDb.has(staff.id)) previewStaff.push(staff);
          }
          for (const ownerId of ownerIds) {
            if (!staffById.has(ownerId)) {
              previewStaff.push({ id: ownerId, full_name: `Staff ${ownerId.slice(0, 6)}`, nickname: null });
            }
          }
          const previews = previewStaff.map(staff => {
            const rooms = existingRows
              .filter(row => row.assigned_to === staff.id)
              .map(row => roomMap.get(row.room_id))
              .filter(Boolean) as RoomForAssignment[];
            return buildPreview(staff.id, staff.full_name, rooms);
          });
          setAssignmentPreviews(previews);
          setFairnessMetrics(computeFairnessMetrics(previews));
          setPreviewHistory([]);
          setStep('preview');
        } else {
          setEditingExistingAssignments(false);
          setSelectedStaffIds(selectedFromDb);
          setAssignmentPreviews([]);
          setFairnessMetrics(null);
          setStep('select-staff');
        }
      } else {
        setEditingExistingAssignments(existingRows.length > 0);
        const liveRoomMap = new Map(workingRooms.map(room => [room.id, room]));
        setAssignmentPreviews(previous => previous.map(preview => buildPreview(
          preview.staffId,
          preview.staffName,
          preview.rooms.map(room => liveRoomMap.get(room.id) || room),
        )));
      }

"""
text = replace_between(text, rooms_start, rooms_end, rooms_replacement, 'room source / existing plan branch')

text = replace_once(
    text,
    "    setAssignmentPreviews(previews);\n    setFairnessMetrics(bestMetrics || computeFairnessMetrics(previews));\n    setSelectedRoomForMove(null);\n    setStep('preview');",
    "    setAssignmentPreviews(previews);\n    if (isNextDayPlanning) {\n      setSuggestedByRoom(new Map(previews.flatMap(preview =>\n        preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),\n      )));\n      setSharedByRoom(new Map());\n    }\n    setFairnessMetrics(bestMetrics || computeFairnessMetrics(previews));\n    setSelectedRoomForMove(null);\n    setStep('preview');",
    'capture tomorrow suggestions',
)

text = replace_once(
    text,
    "    setAssignmentPreviews(next);\n    setFairnessMetrics(computeFairnessMetrics(next));\n    setSelectedRoomForMove(null);",
    "    setAssignmentPreviews(next);\n    if (isNextDayPlanning && sharedByRoom.get(roomId) === toStaffId) {\n      setSharedByRoom(previous => {\n        const updated = new Map(previous);\n        updated.delete(roomId);\n        return updated;\n      });\n    }\n    setFairnessMetrics(computeFairnessMetrics(next));\n    setSelectedRoomForMove(null);",
    'shared primary move safety',
)

text = replace_once(
    text,
    "    if (markExcluded) {\n      setExcludedRoomIds(previous => new Set([...Array.from(previous), roomId]));\n    }\n    setSelectedRoomForMove(null);",
    "    if (markExcluded) {\n      setExcludedRoomIds(previous => new Set([...Array.from(previous), roomId]));\n    }\n    if (isNextDayPlanning) {\n      setSharedByRoom(previous => {\n        const updated = new Map(previous);\n        updated.delete(roomId);\n        return updated;\n      });\n    }\n    setSelectedRoomForMove(null);",
    'remove shared helper with room',
)

text = replace_once(
    text,
    "    toast.info(`Room ${room.room_number} will be put on maintenance hold when you confirm.`);",
    "    toast.info(isNextDayPlanning\n      ? `Room ${room.room_number} will be excluded from tomorrow’s housekeeping plan as a planned maintenance hold.`\n      : `Room ${room.room_number} will be put on maintenance hold when you confirm.`);",
    'maintenance tomorrow semantics',
)

text = replace_once(
    text,
    "  const handleConfirmAssignment = async () => {\n    if (!user || !profile?.organization_slug) return;\n    setSubmitting(true);",
    "  const handleConfirmAssignment = async () => {\n    if (!user || !profile?.organization_slug) return;\n    if (isNextDayPlanning) {\n      setStep('public-areas');\n      return;\n    }\n    setSubmitting(true);",
    'defer tomorrow save until public areas',
)

assign_areas_marker = "  const handleAssignPublicAreas = async () => {\n    if (publicAreaAssignments.size === 0 || !user) {"
assign_areas_replacement = """  const handleAssignPublicAreas = async () => {
    if (isNextDayPlanning) {
      if (!user || !profile?.organization_slug || !profile.assigned_hotel || !nextDayPmsSyncedAt) {
        toast.error('Tomorrow PMS data is missing. Close and reopen Auto Assign to refresh it.');
        return;
      }
      setSubmitting(true);
      try {
        const scheduleByUser = new Map(tomorrowSchedules.map((row: any) => [row.user_id, row]));
        const manualAreaTasks = Array.from(publicAreaAssignments.entries()).flatMap(([areaKey, staffId]) => {
          const area = PUBLIC_AREAS.find(candidate => candidate.key === areaKey);
          return area ? [{ key: area.key, name: area.name, assignedTo: staffId }] : [];
        });
        const saved = await saveApprovedNextDayAutoAssignPlan({
          userId: user.id,
          organizationSlug: profile.organization_slug,
          hotelId: profile.assigned_hotel,
          hotelName: managerHotelRef.current || profile.assigned_hotel,
          selectedDate,
          pmsSyncedAt: nextDayPmsSyncedAt,
          previews: assignmentPreviews,
          selectedStaffIds: Array.from(selectedStaffIds),
          scheduleByUser,
          excludedRoomIds: Array.from(excludedRoomIds),
          maintenanceHoldRoomIds: Array.from(maintenanceHoldRoomIds),
          autoRelease,
          existingPlan: nextDayPlan,
          suggestedByRoom,
          sharedByRoom,
          mappedAreaTasks: sectionTasks.map(task => ({
            id: task.id,
            task_name: task.task_name,
            staff_id: task.staff_id,
            section_id: task.section_id,
            estimated_duration: task.estimated_duration,
            sort_order: task.sort_order,
          })),
          manualAreaTasks,
        });
        localStorage.removeItem(saveKey);
        window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed', {
          detail: { hotelId: profile.assigned_hotel, planDate: selectedDate, planId: saved.planId },
        }));
        onAssignmentCreated(saved.roomCount, selectedStaffIds.size);
        toast.success(`Tomorrow’s plan approved: ${saved.roomCount} rooms · ${saved.areaCount} public-area tasks · release ${autoRelease ? '08:00' : 'held'}.`);
        onOpenChange(false);
      } catch (error) {
        console.error('[AutoRoomAssignment] tomorrow plan save failed:', error);
        toast.error(error instanceof Error ? error.message : 'Could not approve tomorrow’s plan.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (publicAreaAssignments.size === 0 || !user) {"""
text = replace_once(text, assign_areas_marker, assign_areas_replacement, 'tomorrow final save')

text = replace_once(
    text,
    "              <Badge variant=\"outline\" className=\"border-emerald-300 text-emerald-700\">● Live</Badge>",
    "              <Badge variant=\"outline\" className={isNextDayPlanning ? 'border-blue-300 text-blue-700' : 'border-emerald-300 text-emerald-700'}>{isNextDayPlanning ? `Tomorrow · 08:00 release` : '● Live'}</Badge>",
    'header mode badge',
)

text = replace_once(
    text,
    "{checkedInStaff.has(staff.id) && <Badge variant=\"outline\" className=\"border-green-500 text-green-600\"><Check className=\"mr-1 h-3 w-3\" />{t('autoAssign.checkedIn')}</Badge>}",
    "{checkedInStaff.has(staff.id) && <Badge variant=\"outline\" className=\"border-green-500 text-green-600\"><Check className=\"mr-1 h-3 w-3\" />{isNextDayPlanning ? 'Scheduled' : t('autoAssign.checkedIn')}</Badge>}",
    'scheduled badge',
)

selection_old = "<Button size=\"sm\" variant=\"destructive\" className=\"h-7 text-xs\" onClick={() => stageMaintenanceHold(selectedRoomContext.room, selectedRoomContext.preview.staffId)}><Wrench className=\"mr-1 h-3.5 w-3.5\" />Maintenance hold</Button>\n                    <Button size=\"sm\" variant=\"ghost\" className=\"h-7 text-xs\" onClick={() => setSelectedRoomForMove(null)}>Cancel</Button>"
selection_new = """<Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => stageMaintenanceHold(selectedRoomContext.room, selectedRoomContext.preview.staffId)}><Wrench className="mr-1 h-3.5 w-3.5" />Maintenance hold</Button>
                    {isNextDayPlanning && selectedStaffIds.size > 1 && (
                      <Select
                        value={sharedByRoom.get(selectedRoomContext.room.id) || 'none'}
                        onValueChange={value => setSharedByRoom(previous => {
                          const next = new Map(previous);
                          if (value === 'none') next.delete(selectedRoomContext.room.id);
                          else next.set(selectedRoomContext.room.id, value);
                          return next;
                        })}
                      >
                        <SelectTrigger className="h-7 w-[190px] text-xs"><Users className="mr-1 h-3.5 w-3.5" /><SelectValue placeholder="Share cleaning" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not shared</SelectItem>
                          {allStaff
                            .filter(staff => selectedStaffIds.has(staff.id) && staff.id !== selectedRoomContext.preview.staffId)
                            .map(staff => <SelectItem key={staff.id} value={staff.id}>Share with {staff.full_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedRoomForMove(null)}>Cancel</Button>"""
text = replace_once(text, selection_old, selection_new, 'shared room picker')

text = replace_once(
    text,
    "{maintenanceHoldRoomIds.size > 0 && <div className=\"rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200\"><Wrench className=\"mr-1 inline h-3.5 w-3.5\" />{maintenanceHoldRoomIds.size} room{maintenanceHoldRoomIds.size === 1 ? '' : 's'} will be placed on maintenance hold when you confirm.</div>}",
    "{maintenanceHoldRoomIds.size > 0 && <div className=\"rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200\"><Wrench className=\"mr-1 inline h-3.5 w-3.5\" />{maintenanceHoldRoomIds.size} room{maintenanceHoldRoomIds.size === 1 ? '' : 's'} {isNextDayPlanning ? 'will be excluded from tomorrow’s plan as planned maintenance holds.' : 'will be placed on maintenance hold when you confirm.'}</div>}",
    'maintenance message',
)

confirm_marker = "                <div className=\"space-y-2 text-left\">\n                  {assignmentPreviews.filter(preview => staffIdsWithWork.has(preview.staffId)).map(preview => { const areaCount = sectionTasks.filter(task => task.staff_id === preview.staffId).length; const total = preview.totalWithBreak + sectionTaskMinutesForStaff(sectionTasks, preview.staffId); return <div key={preview.staffId} className=\"flex items-center justify-between rounded bg-muted p-2\"><span className=\"font-medium\">{preview.staffName}</span><div className=\"flex items-center gap-2\"><Badge variant=\"outline\">{preview.rooms.length} {t('autoAssign.rooms')}</Badge><Badge variant=\"outline\">{areaCount} areas</Badge><span className=\"text-sm text-green-600\">{formatMinutesToTime(total)}</span></div></div>; })}\n                </div>"
confirm_replacement = confirm_marker + """
                {isNextDayPlanning && (
                  <label className="mx-auto flex max-w-xl cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 text-left">
                    <Checkbox checked={autoRelease} onCheckedChange={value => setAutoRelease(value === true)} className="mt-0.5" />
                    <span>
                      <span className="font-medium">Automatically release tomorrow’s approved plan at 08:00</span>
                      <span className="mt-1 block text-xs text-muted-foreground">If unticked, the plan stays approved but held until an eligible manager releases or changes it.</span>
                    </span>
                  </label>
                )}"""
text = replace_once(text, confirm_marker, confirm_replacement, 'auto-release confirm control')

text = replace_once(
    text,
    "<div className=\"text-center\"><Check className=\"mx-auto mb-2 h-12 w-12 text-green-600\" /><h3 className=\"text-lg font-semibold\">{t('autoAssign.roomsAssignedSuccess')}</h3><p className=\"text-sm text-muted-foreground\">Mapped section tasks are already assigned. Add only any extra one-off public areas needed today.</p></div>",
    "<div className=\"text-center\"><Check className=\"mx-auto mb-2 h-12 w-12 text-green-600\" /><h3 className=\"text-lg font-semibold\">{isNextDayPlanning ? 'Review tomorrow’s public areas' : t('autoAssign.roomsAssignedSuccess')}</h3><p className=\"text-sm text-muted-foreground\">{isNextDayPlanning ? 'Mapped section tasks are included in the same 08:00 plan. Add any extra one-off public areas, then approve the complete plan.' : 'Mapped section tasks are already assigned. Add only any extra one-off public areas needed today.'}</p></div>",
    'public area step copy',
)

text = replace_once(
    text,
    "{step === 'confirm' && <><Button variant=\"outline\" onClick={() => setStep('preview')}>{t('autoAssign.back')}</Button><Button variant=\"outline\" onClick={handlePrintAssignments}><Printer className=\"mr-2 h-4 w-4\" />{t('autoAssign.print')}</Button><Button onClick={handleConfirmAssignment} disabled={submitting}>{submitting ? <><Loader2 className=\"mr-2 h-4 w-4 animate-spin\" />{t('autoAssign.assigning')}</> : <><Check className=\"mr-2 h-4 w-4\" />{editingExistingAssignments ? 'Save Changes' : t('autoAssign.confirmAndAssign')}</>}</Button></>}\n            {step === 'public-areas' && <><Button variant=\"outline\" onClick={() => onOpenChange(false)}>{t('autoAssign.skipAndClose')}</Button><Button onClick={handleAssignPublicAreas} disabled={submitting || publicAreaAssignments.size === 0}>{submitting ? <Loader2 className=\"mr-2 h-4 w-4 animate-spin\" /> : <MapPin className=\"mr-2 h-4 w-4\" />}{t('autoAssign.assignAreas')} ({publicAreaAssignments.size})</Button></>}",
    "{step === 'confirm' && <><Button variant=\"outline\" onClick={() => setStep('preview')}>{t('autoAssign.back')}</Button><Button variant=\"outline\" onClick={handlePrintAssignments}><Printer className=\"mr-2 h-4 w-4\" />{t('autoAssign.print')}</Button><Button onClick={handleConfirmAssignment} disabled={submitting}>{submitting ? <><Loader2 className=\"mr-2 h-4 w-4 animate-spin\" />{t('autoAssign.assigning')}</> : <><Check className=\"mr-2 h-4 w-4\" />{isNextDayPlanning ? 'Continue to Public Areas' : editingExistingAssignments ? 'Save Changes' : t('autoAssign.confirmAndAssign')}</>}</Button></>}\n            {step === 'public-areas' && <><Button variant=\"outline\" onClick={() => isNextDayPlanning ? setStep('confirm') : onOpenChange(false)}>{isNextDayPlanning ? t('autoAssign.back') : t('autoAssign.skipAndClose')}</Button><Button onClick={handleAssignPublicAreas} disabled={submitting || (!isNextDayPlanning && publicAreaAssignments.size === 0)}>{submitting ? <Loader2 className=\"mr-2 h-4 w-4 animate-spin\" /> : <MapPin className=\"mr-2 h-4 w-4\" />}{isNextDayPlanning ? `Approve tomorrow’s plan (${sectionTasks.length + publicAreaAssignments.size} areas)` : `${t('autoAssign.assignAreas')} (${publicAreaAssignments.size})`}</Button></>}",
    'footer next-day flow',
)

impl_path.write_text(text)

# Team View: trust a clean room if either HotelCare cleaned it on the selected
# date OR a fresh PMS snapshot for that same selected date explicitly confirms
# the room is clean. Do not rewrite last_cleaned_at just to satisfy rendering.
overview_path = Path('src/components/dashboard/HotelRoomOverviewLive.tsx')
overview = overview_path.read_text()
overview = replace_once(
    overview,
    "      const cleanedToday = !!room.last_cleaned_at &&\n        new Date(room.last_cleaned_at).toISOString().slice(0, 10) === selectedDate;\n      if (room.status === 'clean' && cleanedToday) statusKey = 'clean';\n      else if (room.status && room.status !== 'clean') statusKey = room.status;\n      else statusKey = 'dirty';",
    "      const cleanedToday = !!room.last_cleaned_at &&\n        new Date(room.last_cleaned_at).toISOString().slice(0, 10) === selectedDate;\n      const pmsConfirmedCleanForSelectedDate = room.status === 'clean' && (\n        room.pms_metadata?.pmsSyncDate === selectedDate\n        || room.pms_metadata?.lastPmsRefreshDate === selectedDate\n      );\n      if (room.status === 'clean' && (cleanedToday || pmsConfirmedCleanForSelectedDate)) statusKey = 'clean';\n      else if (room.status && room.status !== 'clean') statusKey = room.status;\n      else statusKey = 'dirty';",
    'Team View PMS clean rendering',
)
overview_path.write_text(overview)

print('Unified tomorrow Auto Assign source patches applied successfully.')
