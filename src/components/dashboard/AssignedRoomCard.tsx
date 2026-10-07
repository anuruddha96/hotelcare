import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { BedDouble, CalendarDays, Clock3, ImagePlus } from 'lucide-react';
import { AssignedRoomCard as ExistingAssignedRoomCard } from './AssignedRoomCardLegacy';
import { ExtraRoomPhotos } from './ExtraRoomPhotos';
import { RoomCommunicationPanel } from './RoomCommunicationPanel';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { displayHousekeepingBedSetup } from '@/lib/housekeepingBedSetup';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { parsePrevioLateCheckoutTime } from '@/lib/previoLateCheckout';
import { gozsduServiceLabel, isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { roomServiceLabel, type RoomTypeNotice } from '@/lib/roomTypeTransition';
import { readGozsduRoomOverride } from '@/lib/gozsduRoomBucketOverride';
import { gozsduWorkPresentation } from '@/lib/gozsduWorkPresentation';
import { supabase } from '@/integrations/supabase/client';
import './housekeeper-card-visibility.css';

type HousekeeperPlannedNote = {
  id: string;
  content: string;
  instruction_type: string;
  start_date: string;
  end_date: string;
  selected_dates: string[] | null;
};

const plannedTypeLabel: Record<string, string> = {
  general: 'General',
  baby_bed: 'Baby bed',
  extra_bed: 'Extra bed',
  towels: 'Towels',
  linen: 'Linen',
  vip: 'VIP',
  maintenance: 'Maintenance',
  cleaning: 'Cleaning',
  guest_request: 'Guest request',
  other: 'Other',
};

async function loadHousekeeperPlannedRoomNotes(roomId: string, date: string): Promise<HousekeeperPlannedNote[]> {
  const { data, error } = await (supabase as any)
    .from('room_planned_notes')
    .select('id,content,instruction_type,start_date,end_date,selected_dates')
    .eq('room_id', roomId)
    .eq('status', 'active')
    .lte('start_date', date)
    .gte('end_date', date)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data || []) as HousekeeperPlannedNote[]).filter((note) => !note.selected_dates?.length || note.selected_dates.includes(date));
}

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
  const { data: plannedRoomNotes = [] } = useQuery({
    queryKey: ['housekeeper-planned-room-notes', props.assignment.room_id, date],
    queryFn: () => loadHousekeeperPlannedRoomNotes(props.assignment.room_id, date),
    enabled: !!user?.id && !!props.assignment.room_id,
    staleTime: 30_000,
    refetchInterval: 60_000,
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

  const roomTypeNotice = meta?.roomTypeChangeNotice as RoomTypeNotice | undefined;
  const activeManagerTypeNotice = roomTypeNotice?.date === date
    && (roomTypeNotice.to === 'daily' || roomTypeNotice.to === 'checkout')
    ? roomTypeNotice
    : null;
  const currentStayNight = Number(
    meta?.continuousStay?.currentNight
      ?? roomForDisplay?.guest_nights_stayed
      ?? meta?.currentNight
      ?? activeManagerTypeNotice?.nightsStayed
      ?? 0,
  ) || null;
  const managerRequiredService = activeManagerTypeNotice?.to === 'daily'
    ? isGozsduRoom && gozsduOverride
      ? gozsduServiceLabel(gozsduOverride.service)
      : roomServiceLabel({
          towelChangeRequired: roomForDisplay?.towel_change_required,
          linenChangeRequired: roomForDisplay?.linen_change_required,
        })
    : null;

  return <div className={`space-y-2${isGozsduRoom ? ' gozsdu-housekeeper-card' : ''}${isCheckoutClean ? ' checkout-housekeeper-card' : ''}`}>
    {gozsduOverride && gozsduOverride.bucket !== 'other' && <div role="status" className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold">
      Manager cleaning plan: {gozsduOverride.bucket === 'checkout' ? 'Checkout cleaning' : gozsduOverride.service === 'change_room' ? 'Full cleaning / complete textile change' : 'Towel change'}
    </div>}
    {activeManagerTypeNotice && <div role="status" aria-live="polite" className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100">
      <p className="text-xs font-bold uppercase tracking-wide">Manager update</p>
      {activeManagerTypeNotice.to === 'daily' ? <>
        <p className="mt-1 text-sm font-bold">Guest staying — Daily service</p>
        <p className="mt-1 text-sm"><strong>Required today:</strong> {managerRequiredService || 'Daily service'}</p>
        {currentStayNight && <p className="text-xs opacity-80">Continuous stay: night {currentStayNight}</p>}
        <p className="mt-1 text-xs opacity-80">Changed by {activeManagerTypeNotice.by}. Follow the required service above.</p>
      </> : <>
        <p className="mt-1 text-sm font-bold">Checkout cleaning</p>
        <p className="mt-1 text-sm">Wait for <strong>Guest Checked Out</strong> before entering.</p>
        <p className="mt-1 text-xs opacity-80">Changed by {activeManagerTypeNotice.by}.</p>
      </>}
    </div>}
    {plannedRoomNotes.length > 0 && <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
      <div className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide">{language === 'hu' ? 'Mai tervezett szobautasítás' : 'Planned room instruction for today'}</p>
          <div className="mt-1 space-y-1">
            {plannedRoomNotes.map((note) => <p key={note.id} className="text-sm font-semibold"><span className="font-normal opacity-75">{plannedTypeLabel[note.instruction_type] || 'General'}:</span> {note.content}</p>)}
          </div>
          <p className="mt-1 text-[10px] opacity-70">{language === 'hu' ? 'A recepció/vezető által előre ütemezve a HotelCare-ben.' : 'Scheduled in advance by reception/management in HotelCare.'}</p>
        </div>
      </div>
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
