import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

// Keep the existing import contract for AssignedRoomCardLegacy and its callers,
// but do not make every housekeeping room card download the camera workflow.
// The guided capture is only needed after a housekeeper explicitly opens it.
const GuidedRoomPhotoCapture = lazy(async () => {
  const module = await import('./GuidedRoomPhotoCapture');
  return { default: module.GuidedRoomPhotoCapture };
});

type Props = ComponentProps<typeof GuidedRoomPhotoCapture>;

export function SimplifiedPhotoCapture(props: Props) {
  // Important for mobile housekeeping lists: returning before Suspense means
  // React does not request the photo-capture chunk while the dialog is closed.
  if (!props.open) return null;

  return (
    <Suspense fallback={null}>
      <GuidedRoomPhotoCapture {...props} />
    </Suspense>
  );
}
