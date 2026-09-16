"""One-off, exact-match patch for the large existing AutoRoomAssignmentImpl.
Executed only on the isolated GitHub Actions feature branch. Refuses unmatched code.
"""
from pathlib import Path

IMPL = Path('src/components/dashboard/AutoRoomAssignmentImpl.tsx')
PICKER = Path('src/components/dashboard/GozsduLaundryDutyPicker.tsx')


def replace(path: Path, before: str, after: str, count: int = 1):
    text = path.read_text()
    actual = text.count(before)
    if actual != count:
        raise RuntimeError(f'{path}: expected {count} copies, found {actual}: {before[:100]!r}')
    path.write_text(text.replace(before, after))


replace(IMPL,
    "import { getLocalDateString } from '@/lib/utils';",
    "import { getLocalDateString } from '@/lib/utils';\nimport { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';\nimport { isActiveGozsduLaundryner } from '@/lib/gozsduLaundryDutySession';\nimport { gozsduCanReviewAssignment, gozsduPreviewCoversWork } from '@/lib/gozsduAutoAssignGuard';")
replace(IMPL,
    "  const isNextDayPlanning = planningMode === 'next-day';",
    "  const isNextDayPlanning = planningMode === 'next-day';\n  const isGozsdu = isGozsduCourtHotel(profile?.assigned_hotel);\n  const isLaundryner = (staffId: string) => isGozsdu && isActiveGozsduLaundryner(staffId);")
replace(IMPL,
    "  const saveKey = getSaveKey(profile?.assigned_hotel, selectedDate);",
    "  const saveKey = getSaveKey(profile?.assigned_hotel, selectedDate);\n  // The shared duty bridge is populated before Gozsdu's board mounts. Count\n  // only CLEANING staff; selected laundry collectors never enter the preview.\n  const cleaningStaffIds = useMemo(\n    () => new Set([...selectedStaffIds].filter(id => !isGozsdu || !isActiveGozsduLaundryner(id))),\n    [selectedStaffIds, isGozsdu],\n  );")
replace(IMPL,
    "      existingAssignmentsRef.current = new Map(existingRows.map(row => [row.room_id, row]));\n      setDirtyRooms(workingRooms);",
    "      // Existing live work must NEVER be hidden if database duty state conflicts.\n      if (isGozsdu && existingRows.some(row => isActiveGozsduLaundryner(row.assigned_to))) {\n        throw new Error('A Laundryner still owns cleaning work. Resolve this conflict before Auto Assign.');\n      }\n      if (isGozsdu) {\n        selectedFromDb = new Set([...selectedFromDb].filter(id => !isActiveGozsduLaundryner(id)));\n      }\n      existingAssignmentsRef.current = new Map(existingRows.map(row => [row.room_id, row]));\n      setDirtyRooms(workingRooms);")
replace(IMPL,
    '      const saved = localStorage.getItem(saveKey);\n      if (saved) {',
    "      // Live Gozsdu PMS changes during the shift: never resurrect an older\n      // local 48-room snapshot when today's authoritative workload is 35.\n      // Keep other hotels' existing draft restoration unchanged.\n      if (isGozsdu) localStorage.removeItem(saveKey);\n      const saved = isGozsdu ? null : localStorage.getItem(saveKey);\n      if (saved) {")
replace(IMPL,
    '    if (!open) return;\n    if (selectedStaffIds.size === 0 && assignmentPreviews.length === 0) return;',
    '    if (!open || isGozsdu) return;\n    if (selectedStaffIds.size === 0 && assignmentPreviews.length === 0) return;')
replace(IMPL,
    '  }, [open, saveKey, selectedStaffIds, assignmentPreviews, excludedRoomIds, maintenanceHoldRoomIds]);',
    '  }, [open, saveKey, isGozsdu, selectedStaffIds, assignmentPreviews, excludedRoomIds, maintenanceHoldRoomIds]);')
replace(IMPL,
    '  const toggleStaffSelection = (staffId: string) => {\n    setSelectedStaffIds(previous => {',
    "  const toggleStaffSelection = (staffId: string) => {\n    if (isLaundryner(staffId)) {\n      toast.info('This employee is on Laundryner duty. Remove that duty first to assign cleaning rooms.');\n      return;\n    }\n    setSelectedStaffIds(previous => {")
replace(IMPL,
    '    const selectedStaff = allStaff.filter(staff => selectedStaffIds.has(staff.id));\n    const roomsToAssign = effectiveRooms;\n    if (selectedStaff.length === 0 || roomsToAssign.length === 0) return;',
    "    const selectedStaff = allStaff.filter(staff => cleaningStaffIds.has(staff.id));\n    const roomsToAssign = effectiveRooms;\n    if (selectedStaff.length === 0 || roomsToAssign.length === 0) {\n      if (isGozsdu) toast.warning(selectedStaff.length === 0\n        ? 'Select at least one cleaning housekeeper. Laundryners cannot receive rooms.'\n        : 'There are no eligible rooms to assign. Refresh PMS or check exclusions.');\n      return;\n    }")
replace(IMPL,
    '    const previews = best || autoAssignRooms(roomsToAssign, selectedStaff, wingProximity, roomAffinity, hotelConfig);\n    pushHistory(assignmentPreviews);',
    "    const previews = best || autoAssignRooms(roomsToAssign, selectedStaff, wingProximity, roomAffinity, hotelConfig);\n    if (isGozsdu && !gozsduPreviewCoversWork(previews, roomsToAssign.length, cleaningStaffIds, isLaundryner)) {\n      toast.error('Room preview is incomplete or includes a Laundryner. Return to staff selection and regenerate.');\n      setStep('select-staff');\n      return;\n    }\n    pushHistory(assignmentPreviews);")
replace(IMPL,
    '    const eligible = assignmentPreviews.filter(preview => selectedStaffIds.has(preview.staffId));',
    '    const eligible = assignmentPreviews.filter(preview => cleaningStaffIds.has(preview.staffId));')
replace(IMPL,
    '  const handleProceedToConfirm = () => {\n    const overAllocated = assignmentPreviews',
    "  const handleProceedToConfirm = () => {\n    if (isGozsdu && !gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)) {\n      toast.error('No valid cleaning allocation to confirm. Select a cleaning housekeeper and regenerate.');\n      setStep('select-staff');\n      return;\n    }\n    const overAllocated = assignmentPreviews")
replace(IMPL,
    "  const handleConfirmAssignment = async () => {\n    if (!user || !profile?.organization_slug) return;",
    "  const handleConfirmAssignment = async () => {\n    if (!user || !profile?.organization_slug) return;\n    if (isGozsdu && (!gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)\n      || sectionTasks.some(task => isLaundryner(task.staff_id)))) {\n      toast.error('The allocation is empty or conflicts with Laundryner duty. Regenerate before saving.');\n      setStep('select-staff');\n      return;\n    }")
replace(IMPL,
    'selectedStaffIds.has(staff.id) && staff.id !== selectedRoomContext.preview.staffId',
    'cleaningStaffIds.has(staff.id) && staff.id !== selectedRoomContext.preview.staffId')
replace(IMPL,
    '{isNextDayPlanning && selectedStaffIds.size > 1 && (',
    '{isNextDayPlanning && cleaningStaffIds.size > 1 && (')
replace(IMPL,
    'allStaff.filter(staff => selectedStaffIds.has(staff.id)).map(staff => <SelectItem',
    'allStaff.filter(staff => cleaningStaffIds.has(staff.id)).map(staff => <SelectItem')
replace(IMPL,
    '          selectedStaffIds: Array.from(selectedStaffIds),',
    '          selectedStaffIds: Array.from(cleaningStaffIds),')
replace(IMPL,
    "        onAssignmentCreated(saved.roomCount, selectedStaffIds.size);",
    "        onAssignmentCreated(saved.roomCount, cleaningStaffIds.size);")
replace(IMPL,
    '<DialogContent className={`max-h-[92vh] flex flex-col p-3 sm:p-6 gap-2 sm:gap-4 ${step === \'preview\' ? \'max-w-[100vw] sm:max-w-[95vw] w-full\' : \'max-w-4xl\'}`}>' ,
    "<DialogContent className={`flex min-h-0 flex-col gap-2 p-3 sm:gap-4 sm:p-6 ${isGozsdu ? 'h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden sm:h-[min(92vh,900px)] sm:w-[95vw] sm:max-w-[95vw]' : `max-h-[92vh] ${step === 'preview' ? 'max-w-[100vw] sm:max-w-[95vw] w-full' : 'max-w-4xl'}`}`}>")
replace(IMPL,
    '<div className="flex flex-wrap items-center justify-center gap-1.5 py-1">',
    "<div className={isGozsdu ? 'grid grid-cols-4 items-center gap-1 py-1 text-center sm:flex sm:flex-wrap sm:justify-center' : 'flex flex-wrap items-center justify-center gap-1.5 py-1'}>")
replace(IMPL,
    '<ArrowRight className="h-3 w-3 text-muted-foreground" />',
    "<ArrowRight className={`h-3 w-3 text-muted-foreground ${isGozsdu ? 'hidden sm:block' : ''}`} />", count=3)
replace(IMPL,
    '<div className="flex-1 min-h-0 overflow-y-auto px-1">',
    '<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1">')
replace(IMPL,
    '            ) : step === \'select-staff\' ? (\n              <div className="space-y-4">',
    '            ) : step === \'select-staff\' ? (\n              <div className="space-y-4">\n                {isGozsdu && <div data-gozsdu-laundryner-slot className="min-w-0" />}')
replace(IMPL,
    '<h3 className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{t(\'autoAssign.selectHousekeepers\')} ({selectedStaffIds.size} {t(\'autoAssign.selected\')})</h3>',
    '<h3 className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{t(\'autoAssign.selectHousekeepers\')} ({cleaningStaffIds.size} {t(\'autoAssign.selected\')})</h3>')
replace(IMPL,
    "                        const selected = selectedStaffIds.has(staff.id);\n                        return (\n                          <button key={staff.id} type=\"button\" onClick={() => toggleStaffSelection(staff.id)} className={`flex items-center gap-3 rounded-lg border p-3 text-left ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>\n                            <Checkbox checked={selected} />",
    "                        const laundryner = isLaundryner(staff.id);\n                        const selected = !laundryner && cleaningStaffIds.has(staff.id);\n                        return (\n                          <button key={staff.id} type=\"button\" disabled={laundryner} onClick={() => toggleStaffSelection(staff.id)} className={`flex items-center gap-3 rounded-lg border p-3 text-left ${laundryner ? 'cursor-not-allowed border-emerald-300 bg-emerald-50/60 opacity-80 dark:bg-emerald-950/20' : selected ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>\n                            <Checkbox checked={selected} disabled={laundryner} />")
replace(IMPL,
    "                            {checkedInStaff.has(staff.id) && <Badge variant=\"outline\" className=\"border-green-500 text-green-600\"><Check className=\"mr-1 h-3 w-3\" />{isNextDayPlanning ? 'Scheduled' : t('autoAssign.checkedIn')}</Badge>}",
    "                            {laundryner && <Badge variant=\"secondary\" className=\"shrink-0 border border-emerald-400 text-[10px]\">🧺 Laundryner</Badge>}\n                            {checkedInStaff.has(staff.id) && <Badge variant=\"outline\" className=\"border-green-500 text-green-600\"><Check className=\"mr-1 h-3 w-3\" />{isNextDayPlanning ? 'Scheduled' : t('autoAssign.checkedIn')}</Badge>}")
replace(IMPL,
    "isMobile && assignmentPreviews.length >= 3 ? 'grid grid-cols-2 gap-2 overflow-y-auto' : 'flex gap-2 overflow-x-auto'",
    "isMobile && assignmentPreviews.length >= 3 ? (isGozsdu ? 'grid grid-cols-1 min-[520px]:grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2 overflow-y-auto') : 'flex gap-2 overflow-x-auto'")
replace(IMPL,
    '<DialogFooter className="flex-shrink-0 gap-2">',
    "<DialogFooter className={isGozsdu ? '!grid grid-cols-2 gap-2 border-t pt-2 sm:!flex sm:flex-wrap sm:justify-end' : 'flex-shrink-0 gap-2'}>")
replace(IMPL,
    'disabled={selectedStaffIds.size === 0 || effectiveRooms.length === 0}',
    'disabled={cleaningStaffIds.size === 0 || effectiveRooms.length === 0}')
replace(IMPL,
    '<Button variant="outline" onClick={handleGeneratePreview}><RefreshCw',
    '<Button variant="outline" onClick={handleGeneratePreview} disabled={isGozsdu && (cleaningStaffIds.size === 0 || effectiveRooms.length === 0)}><RefreshCw')
replace(IMPL,
    '<Button onClick={handleProceedToConfirm}>{editingExistingAssignments',
    '<Button onClick={handleProceedToConfirm} disabled={isGozsdu && !gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)} className={isGozsdu ? \'col-span-2 sm:w-auto\' : undefined}>{editingExistingAssignments')
replace(IMPL,
    '<Button onClick={handleConfirmAssignment} disabled={submitting}>',
    '<Button onClick={handleConfirmAssignment} disabled={submitting || (isGozsdu && !gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner))}>')

# Remove brittle DOM target inference and fixed overlay from the duty picker.
replace(PICKER,
    '  const [staffGrid, setStaffGrid] = useState<HTMLElement | null>(null);',
    '  const [staffSlot, setStaffSlot] = useState<HTMLElement | null>(null);')
replace(PICKER,
    '''  useEffect(() => {
    if (!open || !allowed) { setStaffGrid(null); return; }
    // The staff grid only exists during Step 1. Watch for it because the board
    // mounts AFTER duties have been verified and later changes steps in place.
    const findGrid = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      const grid = dialogs.flatMap(dialog => Array.from(dialog.querySelectorAll<HTMLElement>('.grid')))
        .find(node => node.classList.contains('max-h-[38vh]')) || null;
      setStaffGrid(previous => previous === grid ? previous : grid);
    };
    findGrid();
    const observer = new MutationObserver(findGrid);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); setStaffGrid(null); };
  }, [open, allowed]);''',
    '''  useEffect(() => {
    if (!open || !allowed) { setStaffSlot(null); return; }
    // The first staff step declares a stable, in-flow portal slot. No floating
    // controls in Preview, Confirm or Public Areas; Back returns to this picker.
    const findSlot = () => {
      const slot = document.querySelector<HTMLElement>('[role="dialog"] [data-gozsdu-laundryner-slot]');
      setStaffSlot(previous => previous === slot ? previous : slot);
    };
    findSlot();
    const observer = new MutationObserver(findSlot);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); setStaffSlot(null); };
  }, [open, allowed]);''')
replace(PICKER,
    '''  if (loading && staff.length === 0 && !failed) return <div role="status"
    className="pointer-events-none fixed bottom-36 right-4 z-[10002] rounded-md bg-background px-3 py-2 text-xs shadow">''',
    '''  if (loading && staff.length === 0 && !failed) return <div role="status"
    className="pointer-events-none fixed left-1/2 top-1/2 z-[10002] w-max max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-md bg-background px-3 py-2 text-xs shadow">''')
replace(PICKER,
    '''  if (failed) return <div role="alert" className="fixed bottom-36 right-4 z-[10002] max-w-sm rounded-md border border-destructive bg-background p-3 text-xs shadow">''',
    '''  if (failed) return <div role="alert" className="fixed left-1/2 top-1/2 z-[10002] w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-destructive bg-background p-3 text-xs shadow">''')
replace(PICKER,
    '''  const control = <div data-testid="gozsdu-laundryner-autoassign-control"
    className={staffGrid
      ? 'order-first col-span-full sticky top-0 z-10 rounded-lg border-2 border-emerald-300 bg-background p-3 shadow-sm'
      : 'fixed bottom-[calc(10rem+env(safe-area-inset-bottom))] right-4 z-[10002] max-w-[min(94vw,370px)] rounded-lg border-2 border-emerald-300 bg-background p-3 shadow-xl'}>''',
    '''  const control = <div data-testid="gozsdu-laundryner-autoassign-control"
    className="w-full min-w-0 rounded-lg border-2 border-emerald-300 bg-background p-2.5 shadow-sm sm:p-3">''')
replace(PICKER,
    '    {staffGrid ? createPortal(control, staffGrid) : control}',
    '    {staffSlot ? createPortal(control, staffSlot) : null}')
replace(PICKER,
    ''' * The duty selector must be INSIDE the staff step, not fixed at top:3px: on
 * iOS/PWA that old button sat behind the status bar / modal and was invisible.
 * The original Auto Assign grid is kept intact for every other hotel. The
 * portal inserts a Gozsdu-only control as the FIRST grid item; when the board
 * is on Preview/Confirm it remains available above the bottom action buttons.''',
    ''' * The Gozsdu-specific selector mounts in the Auto Assign staff step's
 * explicit in-flow slot. It never overlays action buttons on phones or desktop.
 * Return to Staff to change duties after generating a preview.''')
print('Exact-match Gozsdu UI, state and guard patch applied; 2 existing files changed.')
