import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Clock3, ImagePlus } from 'lucide-react';
import { AssignedRoomCard as ExistingAssignedRoomCard } from './AssignedRoomCardLegacy';
import { ExtraRoomPhotos } from './ExtraRoomPhotos';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { parsePrevioLateCheckoutTime } from '@/lib/previoLateCheckout';
import { displayHousekeepingBedSetup } from '@/lib/housekeepingBedSetup';

/** The production room card and five required-photo flow remain unchanged.
 * One optional action gives every hotel unlimited additional camera angles. */
export function AssignedRoomCard(props: React.ComponentProps<typeof ExistingAssignedRoomCard>) {
  const [open, setOpen] = useState(false);
  const { language } = useTranslation();
  const room = props.assignment.rooms;
  const meta = room?.pms_metadata;

  // This is a display-only projection. The legacy room card otherwise reads
  // PMS inference *before* a manager's bed configuration. A manager's explicit
  // instruction must win; do not modify the original room object or database.
  const manualBedInstruction = displayHousekeepingBedSetup(room?.bed_configuration);
  const roomForDisplay = room && manualBedInstruction
    ? {
        ...room,
        bed_configuration: manualBedInstruction,
        pms_metadata: {
          ...(meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}),
          inferredBedConfig: null,
        },
      }
    : room;

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
    <ExistingAssignedRoomCard
      {...props}
      assignment={{ ...props.assignment, rooms: roomForDisplay }}
    />
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
