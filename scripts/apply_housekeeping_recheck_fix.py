from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Patch target not found: {label}")
    return text.replace(old, new, 1)


# 1) Supervisor flow: require a short reason and preserve it on the new assignment.
path = Path("src/components/dashboard/SupervisorApprovalView.tsx")
text = path.read_text()

text = replace_once(
    text,
    "  const [selectedHousekeeper, setSelectedHousekeeper] = useState<string>('');\n",
    "  const [selectedHousekeeper, setSelectedHousekeeper] = useState<string>('');\n  const [reassignmentReason, setReassignmentReason] = useState('');\n",
    "reassignment reason state",
)

text = replace_once(
    text,
    "  const handleReassignment = async () => {\n    if (!selectedAssignment || !selectedHousekeeper) return;\n\n\n    try {",
    "  const handleReassignment = async () => {\n    if (!selectedAssignment || !selectedHousekeeper) return;\n\n    const reason = reassignmentReason.trim();\n    if (!reason) {\n      toast.error('Please add a short reason for the recheck');\n      return;\n    }\n\n    try {",
    "reassignment reason validation",
)

text = replace_once(
    text,
    "          notes: `Reassigned - Previous completion needs review`\n",
    "          notes: `[SUPERVISOR_RECHECK:${selectedHousekeeper === assignment.assigned_to ? 'same' : 'handover'}] ${reason}`\n",
    "reassignment note payload",
)

text = replace_once(
    text,
    "      setSelectedAssignment(null);\n      setSelectedHousekeeper('');\n    } catch (error: any) {",
    "      setSelectedAssignment(null);\n      setSelectedHousekeeper('');\n      setReassignmentReason('');\n    } catch (error: any) {",
    "success state reset",
)

text = replace_once(
    text,
    "        if (!open) {\n          setSelectedAssignment(null);\n          setSelectedHousekeeper('');\n        }",
    "        if (!open) {\n          setSelectedAssignment(null);\n          setSelectedHousekeeper('');\n          setReassignmentReason('');\n        }",
    "dialog close reset",
)

dialog_anchor = """            </Select>
          </div>
          <div className="flex justify-end gap-3">"""
dialog_replacement = """            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Why was the previous completion not approved? <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={reassignmentReason}
              onChange={(e) => setReassignmentReason(e.target.value)}
              placeholder="e.g. Bathroom floor still dirty"
              rows={3}
              maxLength={240}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              This reason will be shown directly to the housekeeper so they know what to check again.
            </p>
          </div>
          <div className="flex justify-end gap-3">"""
text = replace_once(text, dialog_anchor, dialog_replacement, "reassign reason field")

text = replace_once(
    text,
    "                setSelectedAssignment(null);\n                setSelectedHousekeeper('');\n              }}",
    "                setSelectedAssignment(null);\n                setSelectedHousekeeper('');\n                setReassignmentReason('');\n              }}",
    "cancel state reset",
)

text = replace_once(
    text,
    "              disabled={!selectedHousekeeper}\n",
    "              disabled={!selectedHousekeeper || !reassignmentReason.trim()}\n",
    "confirm disabled until reason",
)

path.write_text(text)


# 2) Housekeeper card: recognize both the new tagged note and today's legacy generic note,
# then show a short, localized explanation instead of the vague transfer message.
path = Path("src/components/dashboard/AssignedRoomCard.tsx")
text = path.read_text()

insert_after = "  const hasManagerNotes = !!managerVisibleNote;\n"
insert_block = r'''  const hasManagerNotes = !!managerVisibleNote;

  // A supervisor reassigning a completed room means the previous completion was
  // not approved. Store only the supervisor's reason in a tagged assignment note,
  // then turn it into a short housekeeper-facing instruction here. Also recognize
  // the legacy generic note so rooms already reassigned today become clearer.
  const rawAssignmentNote = (assignment.notes || '').trim();
  const recheckMatch = rawAssignmentNote.match(/^\[SUPERVISOR_RECHECK(?::(same|handover))?\]\s*(.*)$/s);
  const isLegacySupervisorRecheck = rawAssignmentNote === 'Reassigned - Previous completion needs review';
  const isSupervisorRecheck = !!recheckMatch || isLegacySupervisorRecheck;
  const recheckScope = recheckMatch?.[1] || 'handover';
  const supervisorRecheckReason = (recheckMatch?.[2] || '').trim().replace(/[.!?]+$/, '');
  const recheckCopy = (() => {
    switch (language) {
      case 'vi':
        return {
          title: 'CẦN KIỂM TRA LẠI',
          introSelf: 'Giám sát chưa duyệt lần hoàn thành trước của bạn.',
          introHandover: 'Giám sát chưa duyệt lần hoàn thành trước.',
          reason: 'Lý do',
          action: 'Vui lòng kiểm tra lại phòng.'
        };
      case 'hu':
        return {
          title: 'ÚJRA ELLENŐRIZENDŐ',
          introSelf: 'A felügyelő nem hagyta jóvá az előző befejezésedet.',
          introHandover: 'A felügyelő nem hagyta jóvá az előző befejezést.',
          reason: 'Ok',
          action: 'Kérjük, ellenőrizd újra a szobát.'
        };
      case 'es':
        return {
          title: 'REVISAR DE NUEVO',
          introSelf: 'El supervisor no aprobó tu finalización anterior.',
          introHandover: 'El supervisor no aprobó la finalización anterior.',
          reason: 'Motivo',
          action: 'Por favor, revisa la habitación de nuevo.'
        };
      case 'mn':
        return {
          title: 'ДАХИН ШАЛГАХ ШААРДЛАГАТАЙ',
          introSelf: 'Хянагч таны өмнөх дуусгалтыг зөвшөөрөөгүй.',
          introHandover: 'Хянагч өмнөх дуусгалтыг зөвшөөрөөгүй.',
          reason: 'Шалтгаан',
          action: 'Өрөөг дахин шалгана уу.'
        };
      default:
        return {
          title: 'NEEDS RECHECK',
          introSelf: 'Supervisor did not approve your previous completion.',
          introHandover: 'Supervisor did not approve the previous completion.',
          reason: 'Reason',
          action: 'Please check the room again.'
        };
    }
  })();
  const recheckIntro = recheckScope === 'same' ? recheckCopy.introSelf : recheckCopy.introHandover;
  const displayAssignmentNote = isSupervisorRecheck
    ? `${recheckIntro}${supervisorRecheckReason ? ` ${recheckCopy.reason}: ${supervisorRecheckReason}.` : ''} ${recheckCopy.action}`
    : rawAssignmentNote;
'''
text = replace_once(text, insert_after, insert_block, "housekeeper recheck formatter")

text = replace_once(
    text,
    "                  <p className=\"text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide\">📝 {t('housekeeping.assignmentNotes')}</p>",
    "                  <p className=\"text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide\">{isSupervisorRecheck ? `⚠️ ${recheckCopy.title}` : `📝 ${t('housekeeping.assignmentNotes')}`}</p>",
    "recheck banner title",
)

text = replace_once(
    text,
    "                    {translatedAssignmentNote || (shouldTranslateContent(language) ? translateText(assignment.notes, language) : assignment.notes)}",
    "                    {translatedAssignmentNote || (isSupervisorRecheck ? displayAssignmentNote : (shouldTranslateContent(language) ? translateText(displayAssignmentNote, language) : displayAssignmentNote))}",
    "recheck banner body",
)

text = replace_once(
    text,
    "                      onClick={() => handleTranslateNote(assignment.notes, setTranslatedAssignmentNote)}",
    "                      onClick={() => handleTranslateNote(displayAssignmentNote, setTranslatedAssignmentNote)}",
    "recheck translate source",
)

path.write_text(text)
