import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { todayBudapest } from '@/lib/budapestTime';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { isSlntOrganization } from '@/lib/slnt14DayHousekeeping';
import {
  clearGozsduLaundryDutySession,
  setGozsduLaundryDutySession,
} from '@/lib/gozsduLaundryDutySession';
import { AutoRoomAssignment as OriginalAutoRoomAssignment } from './AutoRoomAssignmentLegacy';
import { GozsduLaundryDutyPicker } from './GozsduLaundryDutyPicker';
import { GozsduLaundryDutyUniversalSlot } from './GozsduLaundryDutyUniversalSlot';

type Props = ComponentProps<typeof OriginalAutoRoomAssignment>;

/** Gozsdu alone has a date-specific Laundryner duty. All other hotels use
 * exactly the existing allocation board. The DB must verify exclusion before
 * a new Gozsdu preview can be generated.
 *
 * SLNT future work is intentionally routed to its isolated 14-day planner.
 * The current Auto Assign engine remains a current-business-day action there,
 * so selecting a future date can never accidentally run current-day logic.
 */
export function AutoRoomAssignment(props: Props) {
  const { profile } = useAuth();
  const gozsdu = isGozsduCourtHotel(profile?.assigned_hotel);
  const isSlnt = isSlntOrganization(profile?.organization_slug);
  const [verified, setVerified] = useState(false);
  const [schemaUnavailable, setSchemaUnavailable] = useState(false);
  const [dutyIds, setDutyIds] = useState<string[]>([]);
  const [commitRevision, setCommitRevision] = useState(0);
  const date = props.selectedDate;
  const slntFutureDate = isSlnt && date !== todayBudapest();

  useEffect(() => {
    if (!slntFutureDate || !props.open) return;
    toast.info('Use “Next 14 days assignments” to prepare future SLNT housekeeping work. Auto Assign remains for today.');
    props.onOpenChange(false);
  }, [props.onOpenChange, props.open, slntFutureDate]);

  useEffect(() => {
    if (gozsdu && props.open) {
      setVerified(false);
      setSchemaUnavailable(false);
      setDutyIds([]);
    }
    return () => clearGozsduLaundryDutySession(date);
  }, [gozsdu, props.open, date]);

  const onReady = useCallback((ids: string[] | null) => {
    if (ids === null) {
      clearGozsduLaundryDutySession(date);
      setVerified(false);
      return;
    }
    const unique = [...new Set(ids)].sort();
    setGozsduLaundryDutySession(date, unique);
    setDutyIds(old => old.join('|') === unique.join('|') ? old : unique);
    setVerified(true);
  }, [date]);

  const onSchemaUnavailable = useCallback(() => {
    clearGozsduLaundryDutySession(date);
    setVerified(false);
    setSchemaUnavailable(true);
  }, [date]);

  if (slntFutureDate) return null;
  if (!gozsdu) return <OriginalAutoRoomAssignment {...props} />;

  if (schemaUnavailable) return <>
    <OriginalAutoRoomAssignment {...props} />
    {props.open && <div role="alert" className="fixed bottom-[calc(10rem+env(safe-area-inset-bottom))] left-4 right-4 z-[10002] mx-auto max-w-md rounded-lg border-2 border-amber-500 bg-background p-3 text-sm shadow-xl">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" /> Laundryner setup incomplete</p>
      <p className="mt-1 text-xs text-muted-foreground">The Gozsdu duty database is not installed. Ordinary Auto Assign remains available, but no staff can be safely marked Laundryner or guaranteed zero cleaning rooms. Complete the database rollout, then close and reopen Auto Assign.</p>
    </div>}
  </>;

  return <>
    <GozsduLaundryDutyPicker open={props.open} workDate={date}
      onReady={onReady} onChanged={() => setCommitRevision(old => old + 1)}
      onSchemaUnavailable={onSchemaUnavailable} />
    {verified && <OriginalAutoRoomAssignment
      {...props}
      laundryDutyIds={dutyIds}
      laundryDutyCommitRevision={commitRevision}
    />}
    {verified && <GozsduLaundryDutyUniversalSlot open={props.open} workDate={date} />}
  </>;
}
