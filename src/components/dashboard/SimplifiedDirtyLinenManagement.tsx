import { useAuth } from '@/hooks/useAuth';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { DirtyLinenManagementV2 } from './DirtyLinenManagementV2';
import { GozsduLinenManagement } from './GozsduLinenManagement';

/** All other hotels retain the existing management UI and catalogue. */
export function SimplifiedDirtyLinenManagement() {
  const { profile } = useAuth();
  return isGozsduCourtHotel(profile?.assigned_hotel)
    ? <GozsduLinenManagement />
    : <DirtyLinenManagementV2 />;
}
