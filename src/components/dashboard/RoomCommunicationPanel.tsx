interface RoomCommunicationPanelProps {
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  dateLabel?: string;
  readOnly?: boolean;
  hideWhenEmpty?: boolean;
}

/**
 * Legacy compatibility shim.
 *
 * The separate "Room messages" thread duplicated the existing manager /
 * housekeeper notes and confused room operations. Keep the component export so
 * older room cards do not break, but intentionally render nothing. Existing
 * message rows remain untouched in housekeeping_notes for audit/history.
 *
 * Operational guest requests now use RoomGuestRequestsPanel, while human room
 * instructions continue through the existing shared housekeeping notes field.
 */
export function RoomCommunicationPanel(_: RoomCommunicationPanelProps) {
  return null;
}
