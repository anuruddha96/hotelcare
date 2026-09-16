import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImagePlus } from 'lucide-react';
import { AssignedRoomCard as ExistingAssignedRoomCard } from './AssignedRoomCardLegacy';
import { ExtraRoomPhotos } from './ExtraRoomPhotos';
import { useTranslation } from '@/hooks/useTranslation';

/** The production room card and five required-photo flow remain unchanged.
 * One optional action gives every hotel unlimited additional camera angles. */
export function AssignedRoomCard(props: React.ComponentProps<typeof ExistingAssignedRoomCard>) {
  const [open, setOpen] = useState(false);
  const { language } = useTranslation();
  const room = props.assignment.rooms;
  return <div className="space-y-2">
    <ExistingAssignedRoomCard {...props} />
    {room && props.assignment.status === 'in_progress' && <>
      <Button type="button" variant="outline" size="sm" className="w-full min-h-11 border-dashed" onClick={() => setOpen(true)}>
        <ImagePlus className="h-4 w-4 mr-2" />{language === 'hu' ? 'További szobafotók / több szög' : 'Add more room photos / angles'}
      </Button>
      <ExtraRoomPhotos open={open} onOpenChange={setOpen} roomNumber={room.room_number} assignmentId={props.assignment.id} />
    </>}
  </div>;
}
