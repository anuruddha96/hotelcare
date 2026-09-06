from pathlib import Path

TARGET = Path('src/components/dashboard/SupervisorApprovalView.tsx')
text = TARGET.read_text()
original = text


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)


def remove_between(start: str, end: str, label: str) -> None:
    global text
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f'{label}: start marker not found')
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f'{label}: end marker not found')
    text = text[:start_index] + text[end_index:]


replace_once(
    "import { CompletionDataView } from './CompletionDataView';",
    "import { CompletionDataView } from './CompletionDataView';\nimport { ApprovalReviewContext } from './ApprovalReviewContext';",
    'approval review import',
)

replace_once(
    "  completion_photos?: string[] | null;",
    "  completion_photos?: string[] | null;\n  instruction_snapshot?: any | null;",
    'instruction snapshot type',
)

render_context_start = "    const housekeepingNote = assignment.rooms?.notes?.trim() || '';\n"
render_context_end = "\n\n    return ("
start_index = text.find(render_context_start)
if start_index < 0:
    raise RuntimeError('render context: start marker not found')
end_index = text.find(render_context_end, start_index)
if end_index < 0:
    raise RuntimeError('render context: end marker not found')
text = (
    text[:start_index]
    + "    // Every real cleaning exposes its captured work details. No Service only\n"
      "    // expands when optional door/evidence photos were captured.\n"
      "    const hasDetails = !guestDeclined || Boolean(completionPhotoUrls[assignment.id]?.length);"
    + text[end_index:]
)

replace_once(
    "          </div>\n\n          {/* Special Requirements are cleaning instructions and therefore are",
    "          </div>\n\n          {/* What the housekeeper was originally asked to do, plus the exact\n"
    "              assignment conversation. This uses the frozen instruction\n"
    "              snapshot for new assignments and a labelled legacy fallback\n"
    "              for older rows. */}\n"
    "          <ApprovalReviewContext assignment={assignment} guestDeclined={guestDeclined} />\n\n"
    "          {/* Special Requirements are cleaning instructions and therefore are",
    'approval context insertion',
)

remove_between(
    "          {/* Special Requirements are cleaning instructions and therefore are",
    "          {/* No Service: show only the final outcome + the housekeeper's actual",
    'legacy special requirements',
)

remove_between(
    "          {/* Ordinary assignment notes remain unchanged for real cleaning",
    "          {/* Expandable Details */}",
    'legacy notes and messages',
)

remove_between(
    "                  {/* DND, bed and room-service details apply only to actual",
    "                  {/* Start/Complete times */}",
    'mutable room context inside details',
)

if text == original:
    raise RuntimeError('Patch produced no changes')

TARGET.write_text(text)
print(f'Patched {TARGET}')
