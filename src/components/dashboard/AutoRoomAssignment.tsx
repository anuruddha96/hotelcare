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

/** Leave every other property untouched. If the code deploys ahead of the
 * additive migration, keep the existing Gozsdu workflow available. A failed
 * read of an installed duty table still blocks allocation (fail closed). */
export function AutoRoomAssignment(props: Props) {
  const { profile } = useAuth();
  const gozsdu = isGozsduCourtHotel(profile?.assigned_hotel);
  const [verified, setVerified] = useState(false);
  const [schemaUnavailable, setSchemaUnavailable] = useState(false);
  const [dutyIds, setDutyIds] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const date = props.selectedDate;

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

  if (!gozsdu || schemaUnavailable) return <OriginalAutoRoomAssignment {...props} />;

  return <>
    <GozsduLaundryDutyPicker open={props.open} workDate={date}
      onReady={onReady} onChanged={() => setRevision(old => old + 1)}
      onSchemaUnavailable={onSchemaUnavailable} />
    {verified && <OriginalAutoRoomAssignment
      key={`${date}:${dutyIds.join(',')}:${revision}`}
      {...props}
    />}
  </>;
}
