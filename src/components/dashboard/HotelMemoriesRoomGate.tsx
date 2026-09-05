import React, { useMemo, useState } from 'react';
import { Camera, CheckCircle2, DoorOpen, MessageSquare, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { AssignedRoomCard } from './AssignedRoomCard';
import { ImageCaptureDialog } from './ImageCaptureDialog';
import { RoomCommunicationPanel } from './RoomCommunicationPanel';
import { parseRoomFlags, toggleFlag } from '@/lib/room-service-flags';
import { todayBudapest } from '@/lib/budapestTime';
import {
  MEMORIES_GREEN_BOARD_MARKER,
  MEMORIES_NO_BOARD_MARKER,
  appendAssignmentMarker,
  hasMemoriesGreenBoardRequest,
  isHotelMemoriesBudapest,
} from '@/lib/hotel-memories-housekeeping';

type AssignmentStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'dnd_pending_retry';

type MemoriesAssignment = {
  id: string;
  room_id: string;
  assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
  status: AssignmentStatus;
  priority: number;
  estimated_duration: number;
  notes: string;
  started_at?: string | null;
  completed_at?: string | null;
  ready_to_clean?: boolean;
  manager_instruction_text?: string | null;
  manager_instruction_updated_at?: string | null;
  [key: string]: any;
  rooms: {
    room_number: string;
    hotel: string;
    status: string;
    room_name: string | null;
    floor_number: number | null;
    towel_change_required?: boolean;
    linen_change_required?: boolean;
    guest_nights_stayed?: number;
    bed_configuration?: string | null;
    notes?: string | null;
    pms_metadata?: any;
    is_checkout_room?: boolean | null;
    [key: string]: any;
  } | null;
};

interface HotelMemoriesRoomGateProps {
  assignment: MemoriesAssignment;
  onStatusUpdate: (assignmentId: string, newStatus: AssignmentStatus) => void;
}

/**
 * Hotel Memories Budapest has an opt-in stayover cleaning policy:
 * a plain daily room is NOT a cleaning task until a towel/clean request exists
 * or the housekeeper sees the green Clean My Room card at the door.
 *
 * All other properties, checkouts, and already-triggered daily rooms fall
 * straight through to the normal AssignedRoomCard unchanged.
 */
export function HotelMemoriesRoomGate({ assignment, onStatusUpdate }: HotelMemoriesRoomGateProps) {
  const initialGreenRequest = hasMemoriesGreenBoardRequest(assignment.notes);
  const [greenBoardReleased, setGreenBoardReleased] = useState(initialGreenRequest);
  const [updatedAssignmentNotes, setUpdatedAssignmentNotes] = useState<string | null>(null);
  const [savingGreenBoard, setSavingGreenBoard] = useState(false);
  const [noCleaningOpen, setNoCleaningOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [doorChecked, setDoorChecked] = useState(false);
  const [noCleaningNote, setNoCleaningNote] = useState('');
  const [savingNoCleaning, setSavingNoCleaning] = useState(false);

  const roomFlags = useMemo(
    () => parseRoomFlags(assignment.rooms?.notes ?? null),
    [assignment.rooms?.notes],
  );

  const pmsMeta = assignment.rooms?.pms_metadata;
  const hasFreshPms = pmsMeta?.pmsSyncDate === todayBudapest();
  const pmsSaysCheckout = !!assignment.rooms?.is_checkout_room || pmsMeta?.scheduledDepartureToday === true;
  const isCheckout = hasFreshPms
    ? pmsSaysCheckout
    : assignment.assignment_type === 'checkout_cleaning' || pmsSaysCheckout;

  const isMemories = isHotelMemoriesBudapest(assignment.rooms?.hotel);
  const isDaily = assignment.assignment_type === 'daily_cleaning' && !isCheckout;
  const hasTowelRequest = !!assignment.rooms?.towel_change_required;
  const hasCleanRequest = roomFlags.roomCleaning || greenBoardReleased || initialGreenRequest;
  const isOptionalDaily =
    isMemories &&
    isDaily &&
    assignment.status === 'assigned' &&
    !hasTowelRequest &&
    !hasCleanRequest;

  if (!isOptionalDaily) {
    const shouldShowGreenBoardAsCleanRequest = greenBoardReleased || initialGreenRequest;
    const releasedAssignment = shouldShowGreenBoardAsCleanRequest
      ? {
          ...assignment,
          notes: updatedAssignmentNotes ?? assignment.notes,
          rooms: assignment.rooms
            ? {
                ...assignment.rooms,
                // Render the existing clean-room UI for this assignment only.
                // Do not persist ROOM_CLEANING on the room itself because a
                // physical green-board request is valid only for today's task.
                notes: toggleFlag(assignment.rooms.notes ?? null, 'ROOM_CLEANING', true),
              }
            : assignment.rooms,
        }
      : assignment;

    return <AssignedRoomCard assignment={releasedAssignment} onStatusUpdate={onStatusUpdate} />;
  }

  const markGreenBoardSeen = async () => {
    if (!assignment.rooms) return;
    setSavingGreenBoard(true);
    try {
      const nextAssignmentNotes = appendAssignmentMarker(
        assignment.notes,
        MEMORIES_GREEN_BOARD_MARKER,
        'Green Clean My Room card seen at the door — cleaning requested.',
      );

      // Keep the physical door-card request assignment-scoped. Writing the
      // ROOM_CLEANING flag to rooms.notes could make today's request leak into
      // a future stayover day; the assignment marker is already date-specific.
      const { error: assignmentError } = await supabase
        .from('room_assignments')
        .update({ notes: nextAssignmentNotes })
        .eq('id', assignment.id);
      if (assignmentError) throw assignmentError;

      setUpdatedAssignmentNotes(nextAssignmentNotes);
      setGreenBoardReleased(true);
      toast.success(`Room ${assignment.rooms.room_number}: cleaning request recorded`);
    } catch (error) {
      console.error('Failed to record Hotel Memories green-board request:', error);
      toast.error('Could not record the cleaning request. Please try again.');
    } finally {
      setSavingGreenBoard(false);
    }
  };

  const markNoCleaningRequested = async () => {
    if (!doorChecked) return;
    setSavingNoCleaning(true);
    try {
      const now = new Date().toISOString();
      const detail = noCleaningNote.trim();
      const message = detail
        ? `Door checked — no green Clean My Room card / no cleaning request. ${detail}`
        : 'Door checked — no green Clean My Room card / no cleaning request.';
      const withNoBoard = appendAssignmentMarker(
        assignment.notes,
        MEMORIES_NO_BOARD_MARKER,
        message,
      );
      const finalNotes = withNoBoard.includes('[NO_SERVICE]')
        ? withNoBoard
        : `[NO_SERVICE]\n${withNoBoard}`.trim();

      const { error } = await supabase
        .from('room_assignments')
        .update({
          status: 'completed',
          completed_at: now,
          notes: finalNotes,
        })
        .eq('id', assignment.id);
      if (error) throw error;

      onStatusUpdate(assignment.id, 'completed');
      setNoCleaningOpen(false);
      setDoorChecked(false);
      setNoCleaningNote('');
      toast.success(`Room ${assignment.rooms?.room_number ?? ''}: no cleaning required today`);
    } catch (error) {
      console.error('Failed to record Hotel Memories no-cleaning result:', error);
      toast.error('Could not save the no-cleaning result. Please try again.');
    } finally {
      setSavingNoCleaning(false);
    }
  };

  const cancelNoCleaning = () => {
    setNoCleaningOpen(false);
    setDoorChecked(false);
    setNoCleaningNote('');
  };

  const managerInstruction = String(assignment.manager_instruction_text || '').trim();

  return (
    <>
      <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/10 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl font-bold">
                Room {assignment.rooms?.room_number || 'N/A'}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Hotel Memories Budapest · Daily room</p>
            </div>
            <Badge variant="outline" className="border-emerald-400 text-emerald-700 dark:text-emerald-300 whitespace-normal text-center">
              🚪 Optional · check door
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {managerInstruction && (
            <div className="rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/30 p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <MessageSquare className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">Manager instruction</p>
                  <p className="text-sm font-semibold leading-snug whitespace-pre-wrap break-words mt-1">{managerInstruction}</p>
                </div>
              </div>
            </div>
          )}

          <RoomCommunicationPanel
            assignmentId={assignment.id}
            roomId={assignment.room_id}
            roomNumber={assignment.rooms?.room_number || 'N/A'}
            hideWhenEmpty
          />

          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-background/80 p-4">
            <div className="flex items-start gap-3">
              <DoorOpen className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-sm">Check the guest's door first</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Do not enter this daily room just because it is assigned. Clean only when the green “Clean My Room” card is outside, the guest asks for cleaning, or another service request appears.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <Button
              size="lg"
              onClick={markGreenBoardSeen}
              disabled={savingGreenBoard}
              className="w-full min-h-12 bg-emerald-600 hover:bg-emerald-700 text-white whitespace-normal"
            >
              <CheckCircle2 className="h-5 w-5 mr-2 shrink-0" />
              {savingGreenBoard ? 'Saving…' : 'Green board seen → Clean room'}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setNoCleaningOpen(true)}
              className="w-full min-h-12 border-slate-400 whitespace-normal"
            >
              <ShieldCheck className="h-5 w-5 mr-2 shrink-0" />
              No board / no cleaning request
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Checkout, towel-change and explicit clean-request rooms remain priority work. This card is only a door check.
          </p>
        </CardContent>
      </Card>

      <Dialog open={noCleaningOpen} onOpenChange={setNoCleaningOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>No cleaning requested · Room {assignment.rooms?.room_number || 'N/A'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use this after checking the door. A photo is optional and should show only the door/sign — never photograph the guest.
            </p>

            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/40">
              <Checkbox
                id={`memories-door-checked-${assignment.id}`}
                checked={doorChecked}
                onCheckedChange={(checked) => setDoorChecked(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor={`memories-door-checked-${assignment.id}`} className="text-sm font-medium leading-snug cursor-pointer">
                I checked the door and there is no green Clean My Room card, or the guest does not want cleaning today.
              </label>
            </div>

            <Textarea
              value={noCleaningNote}
              onChange={(e) => setNoCleaningNote(e.target.value)}
              placeholder="Optional note, e.g. guest said no cleaning today"
              rows={2}
            />

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setNoCleaningOpen(false);
                setEvidenceOpen(true);
              }}
            >
              <Camera className="h-4 w-4 mr-2" />
              Capture optional door photo
            </Button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                onClick={markNoCleaningRequested}
                disabled={!doorChecked || savingNoCleaning}
                className="w-full bg-slate-700 hover:bg-slate-800 text-white"
              >
                {savingNoCleaning ? 'Saving…' : 'Save · no cleaning'}
              </Button>
              <Button variant="outline" onClick={cancelNoCleaning} className="w-full">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ImageCaptureDialog
        open={evidenceOpen}
        onOpenChange={(open) => {
          setEvidenceOpen(open);
          if (!open) setNoCleaningOpen(true);
        }}
        roomNumber={assignment.rooms?.room_number || 'N/A'}
        assignmentId={assignment.id}
      />
    </>
  );
}
