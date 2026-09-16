import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import {
  clearGozsduLaundryDutySession,
  setGozsduLaundryDutySession,
} from '@/lib/gozsduLaundryDutySession';
import { AutoRoomAssignment as OriginalAutoRoomAssignment } from './AutoRoomAssignmentLegacy';
import { GozsduLaundryDutyPicker } from './GozsduLaundryDutyPicker';

type Props = React.ComponentProps<typeof OriginalAutoRoomAssignment>;

/** Keep the complete existing portfolio/next-day Auto Assign board unchanged.
 * Gozsdu is the only property which hydrates date-specific laundry exclusions
 * BEFORE its original board mounts. Database triggers enforce the same rule
 * for stale clients, manual drag and background planning/release. */
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

  const onReady = useCallback((ids: string[]) => {
    const unique = [...new Set(ids)].sort();
    setGozsduLaundryDutySession(date, unique);
    setDutyIds(old => old.join('|') === unique.join('|') ? old : unique);
    setVerified(true);
  }, [date]);

  if (!gozsdu) return <OriginalAutoRoomAssignment {...props} />;

  return <>
    <GozsduLaundryDutyPicker
      open={props.open}
      workDate={date}
      onReady={onReady}
      onChanged={() => setRevision(old => old + 1)}
    />
    {verified && <OriginalAutoRoomAssignment
      key={`${date}:${dutyIds.join(',')}:${revision}`}
      {...props}
    />}
  </>;
}
