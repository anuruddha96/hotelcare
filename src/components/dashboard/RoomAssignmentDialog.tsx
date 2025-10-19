import { EasyRoomAssignment } from './EasyRoomAssignment';

interface RoomAssignmentDialogProps {
  onAssignmentCreated: () => void;
  selectedDate: string;
}

export function RoomAssignmentDialog({ onAssignmentCreated, selectedDate }: RoomAssignmentDialogProps) {
  return <EasyRoomAssignment onAssignmentCreated={onAssignmentCreated} />;
}
