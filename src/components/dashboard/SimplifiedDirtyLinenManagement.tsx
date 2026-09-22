import { useAuth } from '@/hooks/useAuth';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { isMemoriesHotel } from '@/lib/memoriesLinen';
import { DirtyLinenManagementV2 } from './DirtyLinenManagementV2';
import { GozsduLinenManagement } from './GozsduLinenManagement';
import { GozsduLinenCollectionBreakdown } from './GozsduLinenCollectionBreakdown';
import { MemoriesLinenManagement } from './MemoriesLinenManagement';

/** Isolate vendor-specific collection sheets by exact property ID, never tenant-wide. */
export function SimplifiedDirtyLinenManagement() {
  const { profile } = useAuth();
  if (isMemoriesHotel(profile?.assigned_hotel)) return <MemoriesLinenManagement />;
  return isGozsduCourtHotel(profile?.assigned_hotel)
    ? <><GozsduLinenManagement /><GozsduLinenCollectionBreakdown mode="manager" /></>
    : <DirtyLinenManagementV2 />;
}
