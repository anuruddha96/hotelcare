import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Clock3, ImagePlus } from 'lucide-react';
import { AssignedRoomCard as ExistingAssignedRoomCard } from './AssignedRoomCardLegacy';
import { ExtraRoomPhotos } from './ExtraRoomPhotos';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { parsePrevioLateCheckoutTime } from '@/lib/previoLateCheckout';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { readGozsduRoomOverride } from '@/lib/gozsduRoomBucketOverride';
import { gozsduWorkPresentation } from '@/lib/gozsduWorkPresentation';

/** The production room card and five required-photo flow remain unchanged.
 * One optional action gives every hotel unlimited additional camera angles. */
export function AssignedRoomCard(props: React.ComponentProps<typeof ExistingAssignedRoomCard>) {
  const [open, setOpen] = useState(false);
  const { language } = useTranslation();
  const date = (props.assignment as typeof props.assignment & { assignment_date?: string }).assignment_date || todayBudapest();
  const originalRoom = props.assignment.rooms;
  const gozsduOverride = originalRoom && isGozsduCourtHotel(originalRoom.hotel)
    ? readGozsduRoomOverride(originalRoom.pms_metadata, date)
    : null;
  // Presentation only: the real PMS values remain untouched in Supabase.
  const displayAssignment = gozsduWorkPresentation(props.assignment, date);
  const room = displayAssignment.rooms;
  const meta = originalRoom?.pms_metadata;

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

  return <div className="space-y-2">
    {gozsduOverride && gozsduOverride.bucket !== 'other' && <div role="status" className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold">
      Manager cleaning plan: {gozsduOverride.bucket === 'checkout' ? 'Checkout cleaning' : gozsduOverride.service === 'change_room' ? 'Full cleaning / complete textile change' : 'Towel change'}
    </div>}
    <ExistingAssignedRoomCard {...props} assignment={displayAssignment} />
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
