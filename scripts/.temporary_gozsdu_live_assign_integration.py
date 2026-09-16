from pathlib import Path

path = Path('src/components/dashboard/AutoRoomAssignmentImpl.tsx')
text = path.read_text()

def once(before: str, after: str):
    global text
    count = text.count(before)
    if count != 1:
        raise SystemExit(f'Gozsdu integration safely aborted: expected one anchor, got {count}: {before[:90]!r}')
    text = text.replace(before, after, 1)

once(
    "import { gozsduCanReviewAssignment, gozsduPreviewCoversWork } from '@/lib/gozsduAutoAssignGuard';\n",
    "import { gozsduCanReviewAssignment, gozsduPreviewCoversWork } from '@/lib/gozsduAutoAssignGuard';\n"
    "import { gozsduAllocationRespectsBuildings } from '@/lib/gozsduBuildingAssignment';\n"
    "import { fetchVerifiedGozsduAutoAssignRooms } from '@/lib/gozsduVerifiedAutoAssign';\n",
)

once(
    "    const roomIds = roomRows.map(room => room.id);\n    let assignmentRows: any[] = [];",
    "    let currentRooms = roomRows.map(addSectionContext);\n"
    "    if (isGozsdu) {\n"
    "      if (!profile?.organization_slug) return;\n"
    "      try {\n"
    "        currentRooms = await fetchVerifiedGozsduAutoAssignRooms(currentRooms, profile.organization_slug, selectedDate);\n"
    "      } catch (error) {\n"
    "        // Keep the last verified preview; never replace it with misleading imported flags.\n"
    "        console.warn('[Gozsdu Auto Assign] date-matched PMS refresh not verified', error);\n"
    "        return;\n"
    "      }\n"
    "    }\n"
    "    const roomIds = currentRooms.map(room => room.id);\n    let assignmentRows: any[] = [];",
)

once(
    "    const availableRooms = roomRows\n      .filter(room => isRoomEligibleForAutoAssign(room, {",
    "    const availableRooms = currentRooms\n      .filter(room => isRoomEligibleForAutoAssign(room, {",
)
once(
    "      .map(room => ({\n        ...addSectionContext(room),\n        ready_to_clean: assignmentMap.get(room.id)?.ready_to_clean ?? false,\n      })) as RoomForAssignment[];",
    "      .map(room => ({\n        ...room,\n        ready_to_clean: assignmentMap.get(room.id)?.ready_to_clean ?? false,\n      })) as RoomForAssignment[];",
)

once(
    "      const allHotelRooms = (roomRows || []).map(addSectionContext);\n      let workingRooms: RoomForAssignment[] = [];",
    "      const allHotelRooms = (roomRows || []).map(addSectionContext);\n"
    "      const verifiedLiveRooms = isGozsdu && !isNextDayPlanning\n"
    "        ? await fetchVerifiedGozsduAutoAssignRooms(allHotelRooms, profile.organization_slug, selectedDate)\n"
    "        : allHotelRooms;\n"
    "      let workingRooms: RoomForAssignment[] = [];",
)
once(
    "          workingRooms = allHotelRooms\n            .filter(room => isRoomEligibleForAutoAssign(room, {",
    "          workingRooms = verifiedLiveRooms\n            .filter(room => isRoomEligibleForAutoAssign(room, {",
)

once(
    "      toast.error(t('autoAssign.failedToLoad'));\n    } finally {\n      setLoading(false);",
    "      toast.error(isGozsdu && error instanceof Error\n"
    "        ? `Gozsdu PMS could not be verified. Refresh Previo and retry: ${error.message}`\n"
    "        : t('autoAssign.failedToLoad'));\n    } finally {\n      setLoading(false);",
)

once(
    "    pushHistory(assignmentPreviews);\n    const next = moveRoom(assignmentPreviews, roomId, fromStaffId, toStaffId);\n    setAssignmentPreviews(next);",
    "    const next = moveRoom(assignmentPreviews, roomId, fromStaffId, toStaffId);\n"
    "    if (isGozsdu && next === assignmentPreviews) {\n"
    "      toast.warning('These buildings cannot be combined for the same housekeeper.');\n"
    "      return;\n"
    "    }\n"
    "    pushHistory(assignmentPreviews);\n    setAssignmentPreviews(next);",
)

once(
    "    if (isGozsdu && !gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)) {",
    "    if (isGozsdu && (!gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)\n"
    "      || !gozsduAllocationRespectsBuildings(assignmentPreviews))) {",
)
once(
    "    if (isGozsdu && (!gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)\n      || sectionTasks.some(task => isLaundryner(task.staff_id)))) {",
    "    if (isGozsdu && (!gozsduCanReviewAssignment(assignmentPreviews, cleaningStaffIds, isLaundryner)\n"
    "      || !gozsduAllocationRespectsBuildings(assignmentPreviews)\n"
    "      || sectionTasks.some(task => isLaundryner(task.staff_id)))) {",
)
once(
    "      toast.error('Room preview is incomplete or includes a Laundryner. Return to staff selection and regenerate.');",
    "      toast.error('Gozsdu allocation is incomplete. Check mapped buildings and select enough cleaning housekeepers for incompatible routes.');",
)

path.write_text(text)
print('Gozsdu live Auto Assign now reconciles the dated 82-room PMS feed before eligibility and on background refresh.')
print('Manual and saved-preview guards check manager-mapped building compatibility.')
