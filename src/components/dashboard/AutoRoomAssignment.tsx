import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import {
  clearGozsduLaundryDutySession,
  setGozsduLaundryDutySession,
} from '@/lib/gozsduLaundryDutySession';
import { AutoRoomAssignment as OriginalAutoRoomAssignment } from './AutoRoomAssignmentLegacy';
import { GozsduLaundryDutyPicker } from './GozsduLaundryDutyPicker';

type Props = ComponentProps<typeof OriginalAutoRoomAssignment>;

/** Original portfolio and tomorrow workflows are preserved unchanged. For
 * Gozsdu only, hydrate duty exclusions before mounting the original board.
 * SQL triggers independently protect writes from stale/manual clients. */
export function AutoRoomAssignment(props: Props) {
  const { profile } = useAuth();
  const gozsdu = isGozsduCourtHotel(profile?.assigned_hotel);
  const [verified, setVerified] = useState(false);
  const [dutyIds, setDutyIds] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const date = props.selectedDate;

  useEffect(() => {
    if (gozsdu && props.open) {
      setVerified(false);
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

  if (!gozsdu) return <OriginalAutoRoomAssignment {...props} />;

  return <>
    <GozsduLaundryDutyPicker open={props.open} workDate={date}
      onReady={onReady} onChanged={() => setRevision(old => old + 1)} />
    {verified && <OriginalAutoRoomAssignment
      key={`${date}:${dutyIds.join(',')}:${revision}`}
      {...props}
    />}
  </>;
}
