import { SimpleRoomAssignment } from './SimpleRoomAssignment';

interface RoomAssignmentDialogProps {
  onAssignmentCreated: () => void;
  selectedDate: string;
}

export function RoomAssignmentDialog({ onAssignmentCreated, selectedDate }: RoomAssignmentDialogProps) {
  return <SimpleRoomAssignment onAssignmentCreated={onAssignmentCreated} />;
}
