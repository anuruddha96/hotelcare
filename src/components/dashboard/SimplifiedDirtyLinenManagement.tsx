import { useAuth } from '@/hooks/useAuth';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { DirtyLinenManagementV2 } from './DirtyLinenManagementV2';
import { GozsduLinenManagement } from './GozsduLinenManagement';
import { GozsduLinenCollectionBreakdown } from './GozsduLinenCollectionBreakdown';

/** The existing manager report/CSV is unchanged. Add the new reconciliation below it, for Gozsdu only. */
export function SimplifiedDirtyLinenManagement() {
  const { profile } = useAuth();
  return isGozsduCourtHotel(profile?.assigned_hotel)
    ? <><GozsduLinenManagement /><GozsduLinenCollectionBreakdown mode="manager" /></>
    : <DirtyLinenManagementV2 />;
}
