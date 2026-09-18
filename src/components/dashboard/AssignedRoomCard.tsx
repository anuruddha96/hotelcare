import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { BedDouble, Clock3, ImagePlus } from 'lucide-react';
import { AssignedRoomCard as ExistingAssignedRoomCard } from './AssignedRoomCardLegacy';
import { ExtraRoomPhotos } from './ExtraRoomPhotos';
import { RoomCommunicationPanel } from './RoomCommunicationPanel';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { displayHousekeepingBedSetup } from '@/lib/housekeepingBedSetup';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { parsePrevioLateCheckoutTime } from '@/lib/previoLateCheckout';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { readGozsduRoomOverride } from '@/lib/gozsduRoomBucketOverride';
import { gozsduWorkPresentation } from '@/lib/gozsduWorkPresentation';
import { supabase } from '@/integrations/supabase/client';
import './housekeeper-card-visibility.css';

/** Resolve the manager's building mapping once for all Gozsdu housekeeper cards.
 * Never infer a building from a PMS prefix or room number, and never write a
 * display-only building label back to the room or to Previo. */
async function loadGozsduHousekeeperBuildings(): Promise<Map<string, string>> {
  const { data: sections, error: sectionError } = await (supabase as any)
    .from('hotel_housekeeping_sections')
    .select('id,name')
    .eq('hotel_name', 'Gozsdu Court Budapest')
    .eq('is_active', true);
  if (sectionError) throw sectionError;
  const sectionNames = new Map<string, string>(
    (sections || []).map((section: { id: string; name: string }) => [section.id, section.name]),
  );
  if (!sectionNames.size) return new Map();
  const { data: mappings, error: mappingError } = await (supabase as any)
    .from('hotel_housekeeping_section_rooms')
    .select('room_id,section_id')
    .in('section_id', Array.from(sectionNames.keys()));
  if (mappingError) throw mappingError;
  const result = new Map<string, string>();
  for (const mapping of (mappings || []) as { room_id: string; section_id: string }[]) {
    const name = sectionNames.get(mapping.section_id)?.trim();
    if (name) result.set(mapping.room_id, name);
  }
  return result;
}

/** The production room card and five required-photo flow remain unchanged.
 * One optional action gives every hotel unlimited additional camera angles. */
export function AssignedRoomCard(props: React.ComponentProps<typeof ExistingAssignedRoomCard>) {
  const [open, setOpen] = useState(false);
  const [bedSetupOpen, setBedSetupOpen] = useState(false);
  const { language } = useTranslation();
  const { user, profile } = useAuth();
  const role = String(profile?.role || '').toLowerCase();
  const canEditBedSetup = hasManagerPowers(profile?.role) || ['supervisor', 'reception', 'front_office', 'reception_manager'].includes(role);
  const date = (props.assignment as typeof props.assignment & { assignment_date?: string }).assignment_date || todayBudapest();
  const originalRoom = props.assignment.rooms;
  const isGozsduRoom = !!originalRoom && isGozsduCourtHotel(originalRoom.hotel);
  const { data: buildingByRoom } = useQuery({
    queryKey: ['gozsdu-housekeeper-building-map', user?.id],
    queryFn: loadGozsduHousekeeperBuildings,
    enabled: !!user?.id && isGozsduRoom,
    staleTime: 60_000,
    retry: 1,
  });
  const mappedBuilding = isGozsduRoom ? buildingByRoom?.get(props.assignment.room_id) : undefined;
  const gozsduOverride = originalRoom && isGozsduRoom
    ? readGozsduRoomOverride(originalRoom.pms_metadata, date)
    : null;
  // Presentation only: the real PMS values remain untouched in Supabase.
  const displayAssignment = gozsduWorkPresentation(props.assignment, date);
  const room = displayAssignment.rooms;
  const meta = originalRoom?.pms_metadata;
  // Display-only: manager setup wins over stale PMS inference. Keep Gozsdu work overrides.
  const manualBedInstruction = displayHousekeepingBedSetup(room?.bed_configuration);
  const bedConfiguredRoom = room && manualBedInstruction ? {
    ...room,
    bed_configuration: manualBedInstruction,
    pms_metadata: {
      ...(room.pms_metadata && typeof room.pms_metadata === 'object' && !Array.isArray(room.pms_metadata) ? room.pms_metadata : {}),
      inferredBedConfig: null,
    },
  } : room;
  // The legacy card renders room_name on the compact Floor · Hotel location
  // line. Append the manager-mapped building there without changing hotel
  // identity (which is used for property-specific business rules).
  const buildingLabel = mappedBuilding
    ? (/^building\b/i.test(mappedBuilding) ? mappedBuilding : `${language === 'hu' ? 'Épület' : 'Building'}: ${mappedBuilding}`)
    : null;
  const originalRoomName = bedConfiguredRoom?.room_name?.trim();
  const roomForDisplay = bedConfiguredRoom && buildingLabel ? {
    ...bedConfiguredRoom,
    room_name: [buildingLabel, originalRoomName && originalRoomName !== mappedBuilding && originalRoomName !== buildingLabel ? originalRoomName : null]
      .filter(Boolean).join(' · '),
  } : bedConfiguredRoom;

  // Match the shared card's PMS-first checkout classification, using the
  // date-specific Gozsdu manager presentation when present. A stale checkout
  // assignment must not hide DND on what is currently a stayover room.
  const checkoutMeta = roomForDisplay?.pms_metadata;
  const freshCheckoutPms = checkoutMeta?.pmsSyncDate === todayBudapest();
  const pmsSaysCheckout = roomForDisplay?.is_checkout_room === true || checkoutMeta?.scheduledDepartureToday === true;
  const isCheckoutClean = freshCheckoutPms
    ? pmsSaysCheckout
    : displayAssignment.assignment_type === 'checkout_cleaning' || pmsSaysCheckout;

  // Hotel Memories only. The live Previo feed currently carries "LCO UNTIL
  // 1500" in a reservation note even though its ordinary Departure field is
  // still 10:00. Show only the extracted time: never expose the raw OTA note,
  // which may contain guest/payment information. The notice is advisory and
  // NEVER changes ready_to_clean or permits automatic entry at that time.
  const isMemories = ['hotel memories budapest', 'memories'].includes(
    String(room?.hotel ?? '').trim().toLowerCase(),
  );
  const waitingForCheckout = isMemories
    && props.assignment.assignment_type === 'checkout_cleaning'
    && props.assignment.ready_to_clean !== true
    && meta?.scheduledDepartureToday === true
    && meta?.checkedOutToday !== true
    && meta?.pmsSyncDate === todayBudapest();
  const lateCheckoutTime = waitingForCheckout
    ? parsePrevioLateCheckoutTime(meta?.noteInternal)
      ?? parsePrevioLateCheckoutTime(meta?.noteOta)
    : null;

  return <div className={`space-y-2${isGozsduRoom ? ' gozsdu-housekeeper-card' : ''}${isCheckoutClean ? ' checkout-housekeeper-card' : ''}`}>
    {gozsduOverride && gozsduOverride.bucket !== 'other' && <div role="status" className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold">
      Manager cleaning plan: {gozsduOverride.bucket === 'checkout' ? 'Checkout cleaning' : gozsduOverride.service === 'change_room' ? 'Full cleaning / complete textile change' : 'Towel change'}
    </div>}
    <ExistingAssignedRoomCard {...props} assignment={{ ...displayAssignment, rooms: roomForDisplay }} />
    {room && canEditBedSetup && props.assignment.status !== 'completed' && <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-2 dark:border-blue-900 dark:bg-blue-950/20">
      <Button type="button" variant="outline" size="sm" className="w-full justify-start border-blue-300 text-blue-900 dark:text-blue-200" aria-expanded={bedSetupOpen} onClick={() => setBedSetupOpen((value) => !value)}>
        <BedDouble className="mr-2 h-4 w-4" />{bedSetupOpen ? 'Hide bed setup' : 'Edit bed setup'}
      </Button>
      {bedSetupOpen && <div className="mt-2"><RoomCommunicationPanel assignmentId={props.assignment.id} roomId={props.assignment.room_id} roomNumber={room.room_number} /></div>}
    </div>}
    {lateCheckoutTime && <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{language === 'hu'
        ? `Késői kijelentkezés: várhatóan ${lateCheckoutTime}. A takarítással várjon, amíg a recepció megerősíti a kijelentkezést.`
        : `Late checkout until ${lateCheckoutTime}. Please wait for reception to confirm checkout before cleaning.`}</span>
    </div>}
    {room && props.assignment.status === 'in_progress' && <>
      <Button type="button" variant="outline" size="sm" className="w-full min-h-11 border-dashed" onClick={() => setOpen(true)}>
        <ImagePlus className="h-4 w-4 mr-2" />{language === 'hu' ? 'További szobafotók / több szög' : 'Add more room photos / angles'}
      </Button>
      <ExtraRoomPhotos open={open} onOpenChange={setOpen} roomNumber={room.room_number} assignmentId={props.assignment.id} />
    </>}
  </div>;
}
