from pathlib import Path


def replace_once(path: str, old: str, new: str, marker: str):
    p = Path(path)
    text = p.read_text()
    if marker in text:
        return
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


room_card = 'src/components/dashboard/AssignedRoomCard.tsx'
replace_once(
    room_card,
    "import { DirtyLinenDialog } from './DirtyLinenDialog';\n",
    "import { DirtyLinenDialog } from './DirtyLinenDialog';\nimport { TowelChangeOnlyDialog } from './TowelChangeOnlyDialog';\n",
    "import { TowelChangeOnlyDialog } from './TowelChangeOnlyDialog';",
)
replace_once(
    room_card,
    "  const [dirtyLinenDialogOpen, setDirtyLinenDialogOpen] = useState(false);\n",
    "  const [dirtyLinenDialogOpen, setDirtyLinenDialogOpen] = useState(false);\n  const [towelChangeOnlyOpen, setTowelChangeOnlyOpen] = useState(false);\n",
    'const [towelChangeOnlyOpen, setTowelChangeOnlyOpen]',
)

old_linen = '''                  <button
                    type="button"
                    onClick={() => setDirtyLinenDialogOpen(true)}
                    className={`${tileBase} border-border`}
                    data-training="dirty-linen-button"
                  >
                    <span className={`${iconWrap} bg-amber-100 text-amber-700`}>
                      <Shirt className="h-4 w-4" />
                    </span>
                    <span className={label}>{t('actions.dirtyLinen')}</span>
                  </button>'''
towel_button = '''                  {assignment.assignment_type === 'daily_cleaning' && !isCheckoutClean && (
                    <button
                      type="button"
                      onClick={() => setTowelChangeOnlyOpen(true)}
                      className={`${tileBase} border-cyan-200 bg-cyan-50/40 hover:bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/20`}
                      data-training="towel-change-only-button"
                    >
                      <span className={`${iconWrap} bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300`}>
                        <span className="text-base" aria-hidden="true">🧺</span>
                      </span>
                      <span className={label}>
                        {language === 'hu' ? 'Csak törölközőcsere'
                          : language === 'vi' ? 'Chỉ thay khăn'
                          : language === 'mn' ? 'Зөвхөн алчуур солих'
                          : language === 'es' ? 'Solo cambio de toallas'
                          : 'Towel change only'}
                      </span>
                    </button>
                  )}

''' + old_linen
replace_once(room_card, old_linen, towel_button, 'data-training="towel-change-only-button"')

old_dialog = '''      {/* Dirty Linen Dialog */}
      <DirtyLinenDialog
        open={dirtyLinenDialogOpen}
        onOpenChange={setDirtyLinenDialogOpen}
        roomId={assignment.room_id}
        roomNumber={assignment.rooms?.room_number || 'Unknown'}
        assignmentId={assignment.id}
      />

'''
new_dialog = old_dialog + '''      {/* Towel-only stayover service — deliberately separate from full cleaning. */}
      <TowelChangeOnlyDialog
        open={towelChangeOnlyOpen}
        onOpenChange={setTowelChangeOnlyOpen}
        roomId={assignment.room_id}
        roomNumber={assignment.rooms?.room_number || 'Unknown'}
        assignmentId={assignment.id}
        onCompleted={() => onStatusUpdate(assignment.id, 'completed')}
      />

'''
replace_once(room_card, old_dialog, new_dialog, '<TowelChangeOnlyDialog')

supervisor = 'src/components/dashboard/SupervisorApprovalView.tsx'
replace_once(
    supervisor,
    "      const guestDeclined = isGuestDeclinedService(assignment?.service_result, assignment?.notes);\n\n      const updateData: any = {",
    "      const guestDeclined = isGuestDeclinedService(assignment?.service_result, assignment?.notes);\n      const towelChangeOnly = String(assignment?.notes || '').includes('[TOWEL_CHANGE_ONLY]');\n      const nonCleaningOutcome = guestDeclined || towelChangeOnly;\n\n      const updateData: any = {",
    'const nonCleaningOutcome = guestDeclined || towelChangeOnly;',
)
replace_once(
    supervisor,
    "      const pmsResult = !guestDeclined && assignment?.room_id\n        ? await pushCleanStatusToPrevio(assignment.room_id, assignment.id)\n        : { status: 'skipped' as const };\n\n      toast.success(guestDeclined ? 'No Service outcome approved' : 'Assignment approved successfully');",
    "      const pmsResult = !nonCleaningOutcome && assignment?.room_id\n        ? await pushCleanStatusToPrevio(assignment.room_id, assignment.id)\n        : { status: 'skipped' as const };\n\n      toast.success(towelChangeOnly ? 'Towel change approved' : guestDeclined ? 'No Service outcome approved' : 'Assignment approved successfully');",
    "toast.success(towelChangeOnly ? 'Towel change approved'",
)
replace_once(
    supervisor,
    "      if (guestDeclined) {\n        showNotification('No Service approved — room was not marked clean in PMS', 'success');\n      } else {\n        showNotification(t('supervisor.roomMarkedClean'), 'success');\n      }",
    "      if (towelChangeOnly) {\n        showNotification('Towel change approved — room remains dirty / not marked as a full clean in PMS', 'success');\n      } else if (guestDeclined) {\n        showNotification('No Service approved — room was not marked clean in PMS', 'success');\n      } else {\n        showNotification(t('supervisor.roomMarkedClean'), 'success');\n      }",
    "showNotification('Towel change approved — room remains dirty",
)
replace_once(
    supervisor,
    "    if (isGuestDeclinedService(assignment.service_result, assignment.notes)) {\n      return performApproval(assignmentId);\n    }",
    "    if (isGuestDeclinedService(assignment.service_result, assignment.notes)\n      || String(assignment.notes || '').includes('[TOWEL_CHANGE_ONLY]')) {\n      return performApproval(assignmentId);\n    }",
    "|| String(assignment.notes || '').includes('[TOWEL_CHANGE_ONLY]'))",
)
replace_once(
    supervisor,
    "          const guestDeclined = isGuestDeclinedService(assignment.service_result, assignment.notes);\n          // Fire per-row so one failure doesn't break the batch. No Service\n          // outcomes count as intentionally skipped and never reach Previo.\n          if (assignment.room_id && !guestDeclined) {",
    "          const guestDeclined = isGuestDeclinedService(assignment.service_result, assignment.notes);\n          const towelChangeOnly = String(assignment.notes || '').includes('[TOWEL_CHANGE_ONLY]');\n          const nonCleaningOutcome = guestDeclined || towelChangeOnly;\n          // Fire per-row so one failure doesn't break the batch. Non-cleaning\n          // outcomes count as intentionally skipped and never reach Previo.\n          if (assignment.room_id && !nonCleaningOutcome) {",
    'if (assignment.room_id && !nonCleaningOutcome)',
)
replace_once(
    supervisor,
    "          } else if (guestDeclined) {\n            pmsSkipped++;\n          }",
    "          } else if (nonCleaningOutcome) {\n            pmsSkipped++;\n          }",
    '} else if (nonCleaningOutcome) {',
)
replace_once(
    supervisor,
    "    const cleanAssignments = assignments.filter(a => !isGuestDeclinedService(a.service_result, a.notes));",
    "    const cleanAssignments = assignments.filter(a => !isGuestDeclinedService(a.service_result, a.notes)\n      && !String(a.notes || '').includes('[TOWEL_CHANGE_ONLY]'));",
    "const cleanAssignments = assignments.filter(a => !isGuestDeclinedService(a.service_result, a.notes)\n      && !String(a.notes || '').includes('[TOWEL_CHANGE_ONLY]'))",
)

edge = Path('supabase/functions/previo-update-room-status/index.ts')
text = edge.read_text()
if "const towelChangeOnly = String(assignment?.notes || '').includes('[TOWEL_CHANGE_ONLY]');" not in text:
    old = '''      const guestDeclined = assignment?.service_result === 'guest_declined'
        || String(assignment?.notes || '').includes('[NO_SERVICE]');

      if (guestDeclined) {
        console.log(`[previo-update-room-status] Skipping clean push for guest-declined assignment ${assignmentId}`);'''
    new = '''      const guestDeclined = assignment?.service_result === 'guest_declined'
        || String(assignment?.notes || '').includes('[NO_SERVICE]');
      const towelChangeOnly = String(assignment?.notes || '').includes('[TOWEL_CHANGE_ONLY]');
      const nonCleaningOutcome = guestDeclined || towelChangeOnly;

      if (nonCleaningOutcome) {
        const reason = towelChangeOnly ? 'towel_change_only' : 'guest_declined_service';
        console.log(`[previo-update-room-status] Skipping clean push for ${reason} assignment ${assignmentId}`);'''
    if old not in text:
        raise SystemExit('Expected Previo guard block not found')
    text = text.replace(old, new, 1)
    text = text.replace("            reason: 'guest_declined_service',", "            reason,", 1)
    text = text.replace(
        "            message: 'No Service assignment must not mark the room clean in Previo',",
        "            message: towelChangeOnly\n              ? 'Towel-only service must not mark the room clean in Previo'\n              : 'No Service assignment must not mark the room clean in Previo',",
        1,
    )
    edge.write_text(text)

print('Mika towel-only patch applied')
