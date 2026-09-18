/* One-time, fail-closed patch on a GitHub feature branch. No production data writes. */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function replaceOnce(content, before, after, path) {
  const index = content.indexOf(before);
  if (index < 0 || content.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Expected exactly one matching block in ${path}: ${before.slice(0, 70)}`);
  }
  return content.replace(before, after);
}
function rewrite(path, replacements) {
  let content = fs.readFileSync(path, 'utf8');
  for (const [before, after] of replacements) content = replaceOnce(content, before, after, path);
  fs.writeFileSync(path, content);
}

// Bring across the three non-conflicting, previously CI-verified files from PR #227.
execFileSync('git', ['fetch', '--no-tags', 'origin', 'refs/heads/fix/global-housekeeping-bed-setup-controls-20260917'], { stdio: 'inherit' });
for (const path of [
  'src/components/dashboard/RoomCommunicationPanel.tsx',
  'src/lib/housekeepingBedSetup.ts',
  'src/lib/housekeepingBedSetup.test.ts',
]) {
  const content = execFileSync('git', ['show', `FETCH_HEAD:${path}`], { encoding: 'utf8' });
  fs.writeFileSync(path, content);
}

const assigned = 'src/components/dashboard/AssignedRoomCard.tsx';
rewrite(assigned, [
  ["import { Clock3, ImagePlus } from 'lucide-react';", "import { BedDouble, Clock3, ImagePlus } from 'lucide-react';"],
  ["import { ExtraRoomPhotos } from './ExtraRoomPhotos';", "import { ExtraRoomPhotos } from './ExtraRoomPhotos';\nimport { RoomCommunicationPanel } from './RoomCommunicationPanel';\nimport { useAuth } from '@/hooks/useAuth';\nimport { hasManagerPowers } from '@/lib/roleAccess';\nimport { displayHousekeepingBedSetup } from '@/lib/housekeepingBedSetup';"],
  ["  const [open, setOpen] = useState(false);", "  const [open, setOpen] = useState(false);\n  const [bedSetupOpen, setBedSetupOpen] = useState(false);"],
  ["  const { language } = useTranslation();", "  const { language } = useTranslation();\n  const { profile } = useAuth();\n  const role = String(profile?.role || '').toLowerCase();\n  const canEditBedSetup = hasManagerPowers(profile?.role) || ['supervisor', 'reception', 'front_office', 'reception_manager'].includes(role);"],
  ["  const meta = originalRoom?.pms_metadata;", "  const meta = originalRoom?.pms_metadata;\n  // Display-only: manager setup wins over stale PMS inference. Keep Gozsdu work overrides.\n  const manualBedInstruction = displayHousekeepingBedSetup(room?.bed_configuration);\n  const roomForDisplay = room && manualBedInstruction ? {\n    ...room,\n    bed_configuration: manualBedInstruction,\n    pms_metadata: {\n      ...(room.pms_metadata && typeof room.pms_metadata === 'object' && !Array.isArray(room.pms_metadata) ? room.pms_metadata : {}),\n      inferredBedConfig: null,\n    },\n  } : room;"],
  ["    <ExistingAssignedRoomCard {...props} assignment={displayAssignment} />", "    <ExistingAssignedRoomCard {...props} assignment={{ ...displayAssignment, rooms: roomForDisplay }} />"],
  ["    {lateCheckoutTime && <div role=\"status\"", `    {room && canEditBedSetup && props.assignment.status !== 'completed' && <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-2 dark:border-blue-900 dark:bg-blue-950/20">
      <Button type="button" variant="outline" size="sm" className="w-full justify-start border-blue-300 text-blue-900 dark:text-blue-200" aria-expanded={bedSetupOpen} onClick={() => setBedSetupOpen((value) => !value)}>
        <BedDouble className="mr-2 h-4 w-4" />{bedSetupOpen ? 'Hide bed setup' : 'Edit bed setup'}
      </Button>
      {bedSetupOpen && <div className="mt-2"><RoomCommunicationPanel assignmentId={props.assignment.id} roomId={props.assignment.room_id} roomNumber={room.room_number} /></div>}
    </div>}
    {lateCheckoutTime && <div role="status"`],
]);

// The separate legacy room-overview renderer caused Memories room 217 to keep showing TW.
const overview = 'src/components/dashboard/HotelRoomOverviewLive.tsx';
rewrite(overview, [
  ["import { parseRoomFlags, toggleFlag } from '@/lib/room-service-flags';", "import { parseRoomFlags, toggleFlag } from '@/lib/room-service-flags';\nimport { housekeepingBedShortCode } from '@/lib/housekeepingBedSetup';"],
  ["                if (bc.includes('Twin') && bc.includes('Sep')) return 'TW-S';\n                if (bc.includes('Twin')) return 'TW';\n                if (bc.includes('Single')) return 'SGL';", "                const shortCode = housekeepingBedShortCode(bc);\n                if (shortCode) return shortCode;\n                if (bc === 'Remove Baby Bed') return '-BB';"],
  ["value={(room as any).bed_configuration || ''}", "value={((room as any).bed_configuration === 'Twin Beds Separated' ? 'Single Bed' : (room as any).bed_configuration === 'Twin Beds' ? 'Twin Beds Together' : (room as any).bed_configuration) || ''}"],
  ["                    <option value=\"Twin Beds\">{t('roomOverview.bedTwin')}</option>\n                    <option value=\"Twin Beds Separated\">{t('roomOverview.bedTwinSeparated')}</option>\n                    <option value=\"Single Bed\">{t('roomOverview.bedSingle')}</option>\n                    <option value=\"Baby Bed\">{t('roomOverview.bedBaby')}</option>\n                    <option value=\"Extra Cot Added\">{t('roomOverview.bedExtraCot')}</option>", "                    <option value=\"Twin Beds Together\">Beds together (BT)</option>\n                    <option value=\"Single Bed\">Single beds (SB)</option>\n                    <option value=\"Sofa Bed\">Sofa bed</option>\n                    <option value=\"Extra Bed\">Extra bed</option>\n                    <option value=\"Baby Bed\">Baby bed</option>\n                    <option value=\"Remove Baby Bed\">Remove baby bed</option>\n                    <option value=\"Extra Cot Added\">{t('roomOverview.bedExtraCot')}</option>"],
]);

// The additional Memories manager overview must also respect manual bed setup.
const memories = 'src/components/dashboard/HotelMemoriesManagerRoomOverview.tsx';
rewrite(memories, [
  ["import { parseRoomFlags } from '@/lib/room-service-flags';", "import { parseRoomFlags } from '@/lib/room-service-flags';\nimport { displayHousekeepingBedSetup } from '@/lib/housekeepingBedSetup';"],
  ["  const bedConfig = room.pms_metadata?.inferredBedConfig?.value\n    || room.pms_metadata?.inferredBedConfig?.bedConfiguration\n    || room.bed_configuration\n    || null;", "  const bedConfig = room.bed_configuration\n    || room.pms_metadata?.inferredBedConfig?.value\n    || room.pms_metadata?.inferredBedConfig?.bedConfiguration\n    || null;"],
  ["<p className=\"text-sm font-semibold\">{String(bedConfig)}</p>", "<p className=\"text-sm font-semibold\">{displayHousekeepingBedSetup(String(bedConfig)) || String(bedConfig)}</p>"],
]);

const utility = 'src/lib/housekeepingBedSetup.ts';
fs.appendFileSync(utility, `\n/** Room-chip codes share exactly the same alias normalization as room cards. */
export function housekeepingBedShortCode(value: string | null | undefined): 'BT' | 'SB' | null {
  const normalized = displayHousekeepingBedSetup(value);
  if (normalized?.startsWith('BT ·')) return 'BT';
  if (normalized?.startsWith('SB ·')) return 'SB';
  return null;
}
`);
const testFile = 'src/lib/housekeepingBedSetup.test.ts';
let tests = fs.readFileSync(testFile, 'utf8');
tests = replaceOnce(tests, "import { displayHousekeepingBedSetup } from './housekeepingBedSetup';", "import { displayHousekeepingBedSetup, housekeepingBedShortCode } from './housekeepingBedSetup';", testFile);
tests += `\ndescribe('housekeepingBedShortCode across all room chips', () => {
  it('shows BT for old twin values and SB for separated / single beds', () => {
    expect(housekeepingBedShortCode('Twin Beds Together')).toBe('BT');
    expect(housekeepingBedShortCode('Twin Beds')).toBe('BT');
    expect(housekeepingBedShortCode('Twin Beds Separated')).toBe('SB');
    expect(housekeepingBedShortCode('Single Bed')).toBe('SB');
    expect(housekeepingBedShortCode('Sofa Bed')).toBeNull();
  });
});
`;
fs.writeFileSync(testFile, tests);

const chip = fs.readFileSync(overview, 'utf8');
if (chip.includes("return 'TW'" ) || chip.includes("return 'TW-S'")) throw new Error('Old room-chip TW codes remain');
console.log('Bed setup patch applied to shared controls, assigned cards, Memories manager view and live room chips.');
