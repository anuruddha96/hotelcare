import fs from 'node:fs';

const file = 'src/components/dashboard/AutoRoomAssignmentImpl.tsx';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: start text not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: start text is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceBetween(label, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceOnce(
  'venues hook import',
  "import { useAuth } from '@/hooks/useAuth';\n",
  "import { useAuth } from '@/hooks/useAuth';\nimport { useVenues } from '@/hooks/useVenues';\n",
);

replaceOnce(
  'roster helper import',
  `import {\n  activeWorkOwnedByExcludedStaff,\n  hasAutoAssignStaffPoolChanged,\n  selectedOwnerOverrides,\n} from '@/lib/autoAssignStaffAvailability';\n`,
  `import {\n  activeWorkOwnedByExcludedStaff,\n  hasAutoAssignStaffPoolChanged,\n  selectedOwnerOverrides,\n} from '@/lib/autoAssignStaffAvailability';\nimport {\n  getAutoAssignWorkStatus,\n  resolveAutoAssignStaffDefaults,\n  scheduleDurationMinutes,\n  type AutoAssignScheduleRow,\n  type AutoAssignStaffDefaultSource,\n} from '@/lib/autoAssignScheduleRoster';\n`,
);

replaceOnce(
  'venues hook',
  '  const { user, profile } = useAuth();\n',
  '  const { user, profile } = useAuth();\n  const { venueName } = useVenues();\n',
);

replaceOnce(
  'roster state',
  '  const [tomorrowSchedules, setTomorrowSchedules] = useState<any[]>([]);\n',
  "  const [staffDefaultSource, setStaffDefaultSource] = useState<AutoAssignStaffDefaultSource>('attendance_fallback');\n  const [publishedRosterRows, setPublishedRosterRows] = useState<AutoAssignScheduleRow[]>([]);\n",
);

replaceOnce(
  'published roster map',
  '  const effectiveRooms = useMemo(\n',
  `  const publishedScheduleByStaff = useMemo(\n    () => new Map<string, AutoAssignScheduleRow>(publishedRosterRows.map(row => [row.user_id, row])),\n    [publishedRosterRows],\n  );\n\n  const effectiveRooms = useMemo(\n`,
);

replaceBetween(
  'schedule-first staff defaults',
  '      const hotelStaffIds = new Set(staffList.map(staff => staff.id));\n',
  '      const { data: roomRows, error: roomsErr } = await supabase\n',
  `      const hotelStaffIds = new Set(staffList.map(staff => staff.id));\n\n      let scheduleResult = await (supabase as any)\n        .from('staff_schedules')\n        .select('id,user_id,work_date,shift_start,shift_end,status,work_status,notes,published_at,staff_schedule_venues(venue_id)')\n        .eq('organization_slug', profile.organization_slug)\n        .eq('hotel_id', profile.assigned_hotel)\n        .eq('work_date', selectedDate);\n\n      // Keep Auto Assign usable while the Phase 1 work_status migration is\n      // still rolling through an environment. The legacy resolver below maps\n      // old status values into the same operational model.\n      if (scheduleResult.error && String(scheduleResult.error.message ?? '').toLowerCase().includes('work_status')) {\n        scheduleResult = await (supabase as any)\n          .from('staff_schedules')\n          .select('id,user_id,work_date,shift_start,shift_end,status,notes,published_at,staff_schedule_venues(venue_id)')\n          .eq('organization_slug', profile.organization_slug)\n          .eq('hotel_id', profile.assigned_hotel)\n          .eq('work_date', selectedDate);\n      }\n      if (scheduleResult.error) throw scheduleResult.error;\n\n      const scheduleRows = (scheduleResult.data || []) as AutoAssignScheduleRow[];\n      let attendanceStaffIds: string[] = [];\n      let staffDefaults = resolveAutoAssignStaffDefaults(scheduleRows, attendanceStaffIds, hotelStaffIds);\n\n      // Attendance is a fallback only when there is no published roster at all.\n      // A published roster containing only Off/Leave/Sick/Training is an\n      // intentional zero-cleaner decision and must not be overwritten here.\n      if (!staffDefaults.hasPublishedRoster) {\n        const { data: attendanceData, error: attendanceError } = await supabase\n          .from('staff_attendance')\n          .select('user_id')\n          .eq('work_date', selectedDate)\n          .in('status', ['checked_in', 'on_break']);\n        if (attendanceError) throw attendanceError;\n        attendanceStaffIds = (attendanceData || []).map(row => row.user_id);\n        staffDefaults = resolveAutoAssignStaffDefaults(scheduleRows, attendanceStaffIds, hotelStaffIds);\n      }\n\n      const checked = new Set(staffDefaults.selectedStaffIds);\n      setCheckedInStaff(checked);\n      setStaffDefaultSource(staffDefaults.source);\n      setPublishedRosterRows(staffDefaults.publishedRows);\n\n`,
);

replaceBetween(
  'published shift capacity',
  '    const scheduleRows = isNextDayPlanning ? tomorrowSchedules : [];\n',
  '    // Movable area overrides owned by a cleaner the manager just excluded are\n',
  `    // Published roster rows contribute real shift capacity. Manually added\n    // cleaners remain allowed even without a published row; they use the\n    // algorithm's standard shift capacity rather than being blocked.\n    const shiftMinutes = new Map<string, number>();\n    for (const staff of selectedStaff) {\n      const minutes = scheduleDurationMinutes(publishedScheduleByStaff.get(staff.id));\n      if (minutes !== null) shiftMinutes.set(staff.id, minutes);\n    }\n`,
);

replaceBetween(
  'staff picker roster UX',
  '                    <div className="space-y-1">\n                      <h3 className="flex items-center gap-2 font-medium"><Users',
  '                    <div className="rounded-lg border p-3">',
  `                    <div className="space-y-1">\n                      <h3 className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{t('autoAssign.selectHousekeepers')} ({cleaningStaffIds.size} {t('autoAssign.selected')})</h3>\n                      <p className="text-xs text-muted-foreground">\n                        {staffDefaultSource === 'published_schedule'\n                          ? 'Published roster for ' + selectedDate + ' is the default. Staff marked Working are preselected; managers can still add or remove cleaners before generating.'\n                          : 'No published roster exists for ' + selectedDate + '. Checked-in staff are used only as a fallback; managers can still add or remove cleaners.'}\n                      </p>\n                    </div>\n                    <div className="grid max-h-[38vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">\n                      {allStaff.map(staff => {\n                        const laundryner = isLaundryner(staff.id);\n                        const selected = !laundryner && cleaningStaffIds.has(staff.id);\n                        const scheduleRow = publishedScheduleByStaff.get(staff.id);\n                        const scheduleStatus = scheduleRow ? getAutoAssignWorkStatus(scheduleRow) : null;\n                        const defaultSelected = checkedInStaff.has(staff.id);\n                        const manualSelected = selected && !defaultSelected;\n                        const scheduledHours = scheduleRow?.shift_start && scheduleRow?.shift_end\n                          ? scheduleRow.shift_start.slice(0, 5) + '–' + scheduleRow.shift_end.slice(0, 5)\n                          : null;\n                        const scheduledVenues = (scheduleRow?.staff_schedule_venues || [])\n                          .map(item => venueName(item.venue_id) || item.venue_id);\n                        const scheduleStatusLabel = scheduleStatus\n                          ? scheduleStatus.charAt(0).toUpperCase() + scheduleStatus.slice(1)\n                          : null;\n                        const staffButtonClass = [\n                          'flex items-center gap-3 rounded-lg border p-3 text-left',\n                          laundryner\n                            ? 'cursor-not-allowed border-emerald-300 bg-emerald-50/60 opacity-80 dark:bg-emerald-950/20'\n                            : selected ? 'border-primary bg-primary/5' : 'hover:bg-muted',\n                        ].join(' ');\n                        return (\n                          <button key={staff.id} type="button" disabled={laundryner} onClick={() => toggleStaffSelection(staff.id)} className={staffButtonClass}>\n                            {laundryner\n                              ? <span aria-label="Selected as Laundryner duty, not for cleaning" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-emerald-600 bg-emerald-600 text-white"><Check className="h-3 w-3" /></span>\n                              : <Checkbox checked={selected} />}\n                            <span className="min-w-0 flex-1">\n                              <span className="block truncate font-medium">{staff.full_name}</span>\n                              {staff.nickname && <span className="block truncate text-xs text-muted-foreground">{staff.nickname}</span>}\n                              {scheduledVenues.length > 0 && (\n                                <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">\n                                  <MapPin className="h-3 w-3 shrink-0" />{scheduledVenues.join(', ')}\n                                </span>\n                              )}\n                            </span>\n                            <span className="flex shrink-0 flex-wrap justify-end gap-1">\n                              {laundryner && <Badge variant="secondary" className="border border-emerald-400 text-[10px]">✓ 🧺 Laundryner</Badge>}\n                              {defaultSelected && (\n                                <Badge variant="outline" className="border-green-500 text-green-600">\n                                  <Check className="mr-1 h-3 w-3" />\n                                  {staffDefaultSource === 'published_schedule'\n                                    ? <>Scheduled{scheduledHours ? ' · ' + scheduledHours : ''}</>\n                                    : t('autoAssign.checkedIn')}\n                                </Badge>\n                              )}\n                              {staffDefaultSource === 'published_schedule' && scheduleRow && !defaultSelected && scheduleStatusLabel && (\n                                <Badge variant="outline" className="text-[10px]">{scheduleStatusLabel}{scheduledHours && scheduleStatus === 'training' ? ' · ' + scheduledHours : ''}</Badge>\n                              )}\n                              {manualSelected && <Badge variant="secondary" className="text-[10px]">Manual</Badge>}\n                            </span>\n                          </button>\n                        );\n                      })}\n                    </div>\n\n`,
);

fs.writeFileSync(file, source);
console.log(`Patched ${file} for Phase 2 schedule-first Auto Assign.`);
