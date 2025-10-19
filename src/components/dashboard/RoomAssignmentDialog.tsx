import { SeparatedRoomAssignment } from './SeparatedRoomAssignment';

interface RoomAssignmentDialogProps {
  onAssignmentCreated: () => void;
  selectedDate: string;
}

export function RoomAssignmentDialog({ onAssignmentCreated, selectedDate }: RoomAssignmentDialogProps) {
  return <SeparatedRoomAssignment onAssignmentCreated={onAssignmentCreated} />;
}
