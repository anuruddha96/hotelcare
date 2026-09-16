from pathlib import Path

picker_path = Path('src/components/dashboard/GozsduLaundryDutyPicker.tsx')
impl_path = Path('src/components/dashboard/AutoRoomAssignmentImpl.tsx')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one source occurrence, found {count}')
    return source.replace(old, new, 1)


picker = picker_path.read_text()
picker = replace_once(picker,
    "import { Shirt, Loader2, AlertTriangle } from 'lucide-react';",
    "import { Shirt, Loader2, AlertTriangle, X, Check } from 'lucide-react';",
    'picker icons')
picker = replace_once(picker,
    "import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';\n",
    '', 'remove nested dialog import')
picker = replace_once(picker,
    " * The Gozsdu-specific selector mounts in the Auto Assign staff step's\n * explicit in-flow slot. It never overlays action buttons on phones or desktop.\n * Return to Staff to change duties after generating a preview.",
    " * The Gozsdu-specific selector and expanded checkbox list both live inside\n * Auto Assign Step 1. Avoid nesting a second modal over the parent dialog:\n * it obscured the cleaning roster and was hard to close on iOS. The main\n * roster separately identifies Laundryners as duty-selected, not cleaners.",
    'picker comment')
picker = replace_once(picker,
    "  const [staffSlot, setStaffSlot] = useState<HTMLElement | null>(null);",
    "  const [staffSlot, setStaffSlot] = useState<HTMLElement | null>(null);\n  useEffect(() => { if (!open) setShow(false); }, [open, workDate]);",
    'picker close on modal dismissal')
picker = replace_once(picker,
    "      <Button type=\"button\" size=\"sm\" variant=\"outline\" className=\"gap-1 border-emerald-500\"\n        onClick={() => setShow(true)} aria-label={`Select Laundryner from ${staff.length} Gozsdu housekeepers`}>\n        Select staff <Badge variant=\"secondary\">{dutyIds.length}/{staff.length}</Badge>\n      </Button>",
    "      <Button type=\"button\" size=\"sm\" variant=\"outline\" className=\"gap-1 border-emerald-500\"\n        onClick={() => setShow(current => !current)} aria-expanded={show} aria-controls=\"gozsdu-laundryner-staff-list\"\n        aria-label={`${show ? 'Close' : 'Select'} Laundryner staff from ${staff.length} Gozsdu housekeepers`}>\n        {show ? 'Close list' : 'Select staff'} <Badge variant=\"secondary\">{dutyIds.length}/{staff.length}</Badge>\n      </Button>",
    'picker accessible expand/collapse')
picker = replace_once(picker,
    "    {assigned.length > 0 && <div className=\"mt-2 flex flex-wrap gap-1\" aria-live=\"polite\">\n      {assigned.map(person => <Badge key={person.id} variant=\"secondary\" className=\"max-w-full truncate\">🧺 {person.nickname || person.full_name}</Badge>)}\n    </div>}\n  </div>;",
    """    {assigned.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-live="polite">
      {assigned.map(person => <Badge key={person.id} variant="secondary" className="max-w-full truncate border border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"><Check className="mr-1 h-3 w-3" />🧺 {person.nickname || person.full_name}</Badge>)}
    </div>}
    {show && <section id="gozsdu-laundryner-staff-list" aria-label="Select Laundryner duty staff" className="mt-3 min-w-0 border-t border-emerald-200 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Laundryner staff · {workDate}</p>
        <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1" onClick={() => setShow(false)} aria-label="Close Laundryner staff list"><X className="h-4 w-4" />Close</Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Tick a person to give them Laundryner duty for this date. Green ticks here mean Laundryner duty, not cleaning allocation. Staff with existing room or public-area work must have that work resolved first.</p>
      <div role="group" aria-label="Available Gozsdu Laundryner staff" className="max-h-[min(40dvh,320px)] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {staff.map(person => {
          const selected = dutyIds.includes(person.id);
          return <label key={person.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm ${selected ? 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30' : 'bg-background'}`}>
            <Checkbox checked={selected} disabled={!!busyId} aria-label={`${person.full_name}: Laundryner duty ${selected ? 'selected' : 'not selected'}`}
              onCheckedChange={checked => { void toggle(person.id, checked === true); }} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{person.full_name}</span>{person.nickname && <span className="block truncate text-xs text-muted-foreground">{person.nickname}</span>}</span>
            {selected && <Badge className="shrink-0 border border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Check className="mr-1 h-3 w-3" />Selected</Badge>}
            {busyId === person.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          </label>;
        })}
        {staff.length === 0 && <p className="py-2 text-sm text-muted-foreground">No eligible Gozsdu housekeepers found.</p>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-emerald-200 pt-2">
        <span className="text-xs text-muted-foreground">{dutyIds.length} selected · zero rooms and areas</span>
        <Button type="button" size="sm" onClick={() => setShow(false)} disabled={!!busyId}>Done</Button>
      </div>
    </section>}
  </div>;""",
    'replace nested modal with inline staff selection')
old_return = "  return <>\n    {staffSlot ? createPortal(control, staffSlot) : null}\n    <Dialog open={show} onOpenChange={setShow}>"
if picker.count(old_return) != 1:
    raise RuntimeError('picker nested modal return anchor missing')
picker = picker[:picker.index(old_return)] + '  return staffSlot ? createPortal(control, staffSlot) : null;\n}\n'
if '<Dialog' in picker or 'DialogContent' in picker:
    raise RuntimeError('nested picker dialog still present')
picker_path.write_text(picker)

impl = impl_path.read_text()
impl = replace_once(impl,
    "  Shuffle,\n", "  Shuffle,\n  Shirt,\n", 'summary icon')
impl = replace_once(impl,
    "  return (\n    <>\n      <Dialog open={open} onOpenChange={onOpenChange}>",
    "  // Read from the verified, date-scoped Gozsdu duty session, never a draft.\n  const laundrynerStaff = isGozsdu ? allStaff.filter(staff => isLaundryner(staff.id)) : [];\n\n  return (\n    <>\n      <Dialog open={open} onOpenChange={onOpenChange}>",
    'Gozsdu duty names in all assignment steps')
impl = replace_once(impl,
    "          <div className=\"flex-1 min-h-0 overflow-y-auto overscroll-contain px-1\">",
    """          {isGozsdu && !loading && step !== 'select-staff' && (
            <div data-testid="gozsdu-laundryner-progress-summary" role="status" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-300 bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100">
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold"><Shirt className="h-3.5 w-3.5" />Laundryners ({laundrynerStaff.length})</span>
              {laundrynerStaff.length > 0
                ? laundrynerStaff.map(staff => <Badge key={staff.id} variant="outline" className="max-w-full border-emerald-400 bg-background text-[11px] text-emerald-800 dark:text-emerald-100"><Check className="mr-1 h-3 w-3 shrink-0" /><span className="truncate">{staff.nickname || staff.full_name}</span></Badge>)
                : <span>None selected</span>}
              <span className="text-[11px] text-muted-foreground">0 cleaning rooms · 0 public areas · Back to Staff to edit</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1">""",
    'summary on Preview Confirm and Public Areas')
impl = replace_once(impl,
    "                            <Checkbox checked={selected} disabled={laundryner} />",
    """                            {laundryner
                              ? <span aria-label="Selected as Laundryner duty, not for cleaning" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-emerald-600 bg-emerald-600 text-white"><Check className="h-3 w-3" /></span>
                              : <Checkbox checked={selected} />}""",
    'selected Laundryner marker separate from cleaning checkbox')
impl = replace_once(impl,
    "                            {laundryner && <Badge variant=\"secondary\" className=\"shrink-0 border border-emerald-400 text-[10px]\">🧺 Laundryner</Badge>}",
    "                            {laundryner && <Badge variant=\"secondary\" className=\"shrink-0 border border-emerald-400 text-[10px]\">✓ 🧺 Laundryner</Badge>}",
    'duty badge selected marker')
impl_path.write_text(impl)

assert 'gozsdu-laundryner-progress-summary' in impl
assert 'gozsdu-laundryner-staff-list' in picker
assert 'return staffSlot ? createPortal(control, staffSlot) : null;' in picker
print('Exact-match Gozsdu inline selector, checked duty indicators, and step summary installed.')
