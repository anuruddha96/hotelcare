import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wand2, Users, ArrowRight, Check, Loader2, RefreshCw, AlertCircle, Clock, AlertTriangle, Move } from 'lucide-react';
import { toast } from 'sonner';
import { 
  autoAssignRooms, 
  AssignmentPreview, 
  RoomForAssignment, 
  StaffForAssignment,
  moveRoom,
  calculateRoomWeight,
  formatMinutesToTime,
  CHECKOUT_MINUTES,
  DAILY_MINUTES,
  BREAK_TIME_MINUTES
} from '@/lib/roomAssignmentAlgorithm';

interface AutoRoomAssignmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: () => void;
}

type Step = 'select-staff' | 'preview' | 'confirm';

export function AutoRoomAssignment({
  open,
  onOpenChange,
  selectedDate,
  onAssignmentCreated
}: AutoRoomAssignmentProps) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  
  const [step, setStep] = useState<Step>('select-staff');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Data
  const [allStaff, setAllStaff] = useState<StaffForAssignment[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [dirtyRooms, setDirtyRooms] = useState<RoomForAssignment[]>([]);
  const [checkedInStaff, setCheckedInStaff] = useState<Set<string>>(new Set());
  
  // Preview
  const [assignmentPreviews, setAssignmentPreviews] = useState<AssignmentPreview[]>([]);
  const [selectedRoomForMove, setSelectedRoomForMove] = useState<{roomId: string; fromStaffId: string} | null>(null);
  
  // Over-allocation confirmation
  const [showOverAllocationDialog, setShowOverAllocationDialog] = useState(false);
  const [overAllocatedStaff, setOverAllocatedStaff] = useState<AssignmentPreview[]>([]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('select-staff');
      setSelectedStaffIds(new Set());
      setAssignmentPreviews([]);
      setSelectedRoomForMove(null);
      setShowOverAllocationDialog(false);
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get manager's hotel
      const hotelName = await getManagerHotel();
      if (!hotelName) {
        toast.error('No hotel assigned');
        return;
      }

      // Fetch housekeeping staff for this hotel
      const { data: staffData } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .eq('assigned_hotel', hotelName)
        .eq('organization_slug', profile?.organization_slug)
        .order('full_name');

      const staffList = staffData || [];
      setAllStaff(staffList);
      
      // Get staff IDs from this hotel only
      const hotelStaffIds = new Set(staffList.map(s => s.id));

      // Fetch today's attendance to see who's checked in
      const { data: attendanceData } = await supabase
        .from('staff_attendance')
        .select('user_id')
        .eq('work_date', selectedDate)
        .in('status', ['checked_in', 'on_break']);

      // Filter checked-in staff to only include those from this hotel
      const allCheckedIn = (attendanceData || []).map(a => a.user_id);
      const hotelCheckedIn = allCheckedIn.filter(id => hotelStaffIds.has(id));
      
      setCheckedInStaff(new Set(hotelCheckedIn));
      // Auto-select only staff who are checked in AND from this hotel
      setSelectedStaffIds(new Set(hotelCheckedIn));

      // Fetch dirty rooms that don't have assignments for today
      const { data: roomsData } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, status')
        .eq('hotel', hotelName)
        .eq('status', 'dirty');

      // Get existing assignments for today
      const { data: existingAssignments } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('assignment_date', selectedDate);

      const assignedRoomIds = new Set((existingAssignments || []).map(a => a.room_id));
      
      // Filter out already assigned rooms
      const availableRooms = (roomsData || []).filter(r => !assignedRoomIds.has(r.id));
      setDirtyRooms(availableRooms);

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const getManagerHotel = async (): Promise<string | null> => {
    if (!profile?.assigned_hotel) return null;

    // Try to get hotel name from hotel_id
    const { data: hotelConfig } = await supabase
      .from('hotel_configurations')
      .select('hotel_name')
      .eq('hotel_id', profile.assigned_hotel)
      .single();

    return hotelConfig?.hotel_name || profile.assigned_hotel;
  };

  const toggleStaffSelection = (staffId: string) => {
    const newSelection = new Set(selectedStaffIds);
    if (newSelection.has(staffId)) {
      newSelection.delete(staffId);
    } else {
      newSelection.add(staffId);
    }
    setSelectedStaffIds(newSelection);
  };

  const handleGeneratePreview = () => {
    const selectedStaff = allStaff.filter(s => selectedStaffIds.has(s.id));
    const previews = autoAssignRooms(dirtyRooms, selectedStaff);
    setAssignmentPreviews(previews);
    setStep('preview');
  };

  const handleMoveRoom = (toStaffId: string) => {
    if (!selectedRoomForMove) return;
    
    const newPreviews = moveRoom(
      assignmentPreviews,
      selectedRoomForMove.roomId,
      selectedRoomForMove.fromStaffId,
      toStaffId
    );
    
    setAssignmentPreviews(newPreviews);
    setSelectedRoomForMove(null);
  };

  const handleProceedToConfirm = () => {
    // Check for over-allocated staff
    const overAllocated = assignmentPreviews.filter(p => p.exceedsShift && p.rooms.length > 0);
    
    if (overAllocated.length > 0) {
      setOverAllocatedStaff(overAllocated);
      setShowOverAllocationDialog(true);
    } else {
      setStep('confirm');
    }
  };

  const handleConfirmAssignment = async () => {
    if (!user) return;
    
    setSubmitting(true);
    try {
      // Create all assignments
      const assignments = assignmentPreviews.flatMap(preview => 
        preview.rooms.map((room, index) => ({
          room_id: room.id,
          assigned_to: preview.staffId,
          assigned_by: user.id,
          assignment_date: selectedDate,
          assignment_type: (room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning') as 'checkout_cleaning' | 'daily_cleaning',
          status: 'assigned' as const,
          priority: index + 1,
          organization_slug: profile?.organization_slug,
          ready_to_clean: !room.is_checkout_room // Daily rooms are ready, checkout rooms wait
        }))
      );

      if (assignments.length === 0) {
        toast.error('No rooms to assign');
        return;
      }

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      const totalRooms = assignments.length;
      const staffCount = assignmentPreviews.filter(p => p.rooms.length > 0).length;
      
      toast.success(`Assigned ${totalRooms} rooms to ${staffCount} housekeepers`);
      onAssignmentCreated();
      onOpenChange(false);

    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error('Failed to create assignments');
    } finally {
      setSubmitting(false);
    }
  };

  const getWeightColor = (weight: number, avgWeight: number) => {
    const diff = weight - avgWeight;
    if (Math.abs(diff) < 0.5) return 'text-green-600';
    if (diff > 0) return 'text-amber-600';
    return 'text-blue-600';
  };

  const avgWeight = assignmentPreviews.length > 0 
    ? assignmentPreviews.reduce((sum, p) => sum + p.totalWeight, 0) / assignmentPreviews.length 
    : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Auto Room Assignment
            </DialogTitle>
          </DialogHeader>

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 py-2">
            <Badge variant={step === 'select-staff' ? 'default' : 'secondary'}>1. Select Staff</Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant={step === 'preview' ? 'default' : 'secondary'}>2. Preview</Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant={step === 'confirm' ? 'default' : 'secondary'}>3. Confirm</Badge>
          </div>

          <ScrollArea className="flex-1 px-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : step === 'select-staff' ? (
              <div className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{dirtyRooms.length}</p>
                    <p className="text-sm text-muted-foreground">Total Rooms</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-600">
                      {dirtyRooms.filter(r => r.is_checkout_room).length}
                    </p>
                    <p className="text-sm text-muted-foreground">Checkouts</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {dirtyRooms.filter(r => !r.is_checkout_room).length}
                    </p>
                    <p className="text-sm text-muted-foreground">Daily</p>
                  </div>
                </div>

                {/* Time estimation info */}
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>
                    Checkout rooms: <strong>{CHECKOUT_MINUTES} min</strong> | 
                    Daily rooms: <strong>{DAILY_MINUTES} min</strong> | 
                    Break: <strong>{BREAK_TIME_MINUTES} min</strong>
                  </span>
                </div>

                {dirtyRooms.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No dirty rooms available for assignment</p>
                  </div>
                ) : (
                  <>
                    <h3 className="font-medium flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Select Working Housekeepers ({selectedStaffIds.size} selected)
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {allStaff.map(staff => {
                        const isCheckedIn = checkedInStaff.has(staff.id);
                        const isSelected = selectedStaffIds.has(staff.id);

                        return (
                          <div
                            key={staff.id}
                            className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                              isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                            }`}
                            onClick={() => toggleStaffSelection(staff.id)}
                          >
                            <Checkbox checked={isSelected} />
                            <div className="flex-1">
                              <p className="font-medium">{staff.full_name}</p>
                              {staff.nickname && (
                                <p className="text-sm text-muted-foreground">{staff.nickname}</p>
                              )}
                            </div>
                            {isCheckedIn && (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                <Check className="h-3 w-3 mr-1" />
                                Checked In
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : step === 'preview' ? (
              <div className="space-y-4">
                {/* Summary */}
                <div className="p-3 bg-muted rounded-lg text-sm">
                  <p>
                    <strong>{dirtyRooms.length}</strong> rooms distributed among{' '}
                    <strong>{assignmentPreviews.filter(p => p.rooms.length > 0).length}</strong> housekeepers.
                  </p>
                  {selectedRoomForMove ? (
                    <p className="mt-1 text-primary font-medium flex items-center gap-1">
                      <Move className="h-4 w-4" />
                      Click on a housekeeper card below to move the selected room, or click the room again to cancel.
                    </p>
                  ) : (
                    <p className="mt-1 text-muted-foreground">Click on a room to reassign it.</p>
                  )}
                </div>

                {/* Assignment Preview Cards */}
                <div className="space-y-4">
                  {assignmentPreviews.map(preview => {
                    const isDropTarget = selectedRoomForMove && selectedRoomForMove.fromStaffId !== preview.staffId;
                    
                    return (
                      <Card 
                        key={preview.staffId} 
                        className={`overflow-hidden transition-all ${
                          isDropTarget 
                            ? 'ring-2 ring-primary ring-offset-2 cursor-pointer' 
                            : ''
                        } ${preview.exceedsShift && preview.rooms.length > 0 ? 'border-destructive' : ''}`}
                        onClick={() => isDropTarget && handleMoveRoom(preview.staffId)}
                      >
                        <CardHeader className={`py-3 ${preview.exceedsShift && preview.rooms.length > 0 ? 'bg-destructive/10' : 'bg-muted/50'}`}>
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <CardTitle className="text-base flex items-center gap-2">
                              {preview.staffName}
                              {preview.exceedsShift && preview.rooms.length > 0 && (
                                <AlertTriangle className="h-4 w-4 text-destructive" />
                              )}
                            </CardTitle>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline">
                                {preview.rooms.length} rooms
                              </Badge>
                              <Badge variant="outline" className="text-amber-600">
                                {preview.checkoutCount} CO
                              </Badge>
                              <Badge variant="outline" className="text-blue-600">
                                {preview.dailyCount} Daily
                              </Badge>
                            </div>
                          </div>
                          
                          {/* Time estimation row */}
                          <div className="flex items-center gap-4 mt-2 text-sm">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>
                                Work: <strong>{formatMinutesToTime(preview.estimatedMinutes)}</strong>
                              </span>
                            </div>
                            <span className="text-muted-foreground">+</span>
                            <span>{BREAK_TIME_MINUTES}m break</span>
                            <span className="text-muted-foreground">=</span>
                            <span className={`font-semibold ${preview.exceedsShift && preview.rooms.length > 0 ? 'text-destructive' : 'text-green-600'}`}>
                              {formatMinutesToTime(preview.totalWithBreak)} total
                            </span>
                            {preview.exceedsShift && preview.rooms.length > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                +{formatMinutesToTime(preview.overageMinutes)} over 8h
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="py-3">
                          {preview.rooms.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-2">
                              No rooms assigned
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {preview.rooms.map(room => {
                                const isSelected = selectedRoomForMove?.roomId === room.id;
                                const weight = calculateRoomWeight(room);
                                
                                return (
                                  <div
                                    key={room.id}
                                    className={`relative px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all ${
                                      room.is_checkout_room 
                                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300' 
                                        : 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300'
                                    } ${isSelected ? 'ring-2 ring-primary ring-offset-2 scale-105 animate-pulse' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isSelected) {
                                        setSelectedRoomForMove(null);
                                      } else {
                                        setSelectedRoomForMove({ roomId: room.id, fromStaffId: preview.staffId });
                                      }
                                    }}
                                    title={`${room.room_number} | ${room.room_size_sqm || '?'}m² | ${room.is_checkout_room ? CHECKOUT_MINUTES : DAILY_MINUTES}min | Weight: ${weight.toFixed(1)}`}
                                  >
                                    {room.room_number}
                                    {room.room_size_sqm && room.room_size_sqm >= 30 && (
                                      <span className="ml-1 text-xs opacity-70">L</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Drop zone indicator */}
                          {isDropTarget && (
                            <div className="mt-3 p-2 border-2 border-dashed border-primary rounded-lg text-center text-sm text-primary">
                              Click to move room here
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-center py-8">
                <Check className="h-16 w-16 mx-auto text-green-600" />
                <h3 className="text-xl font-semibold">Ready to Assign</h3>
                <p className="text-muted-foreground">
                  {dirtyRooms.length} rooms will be assigned to {assignmentPreviews.filter(p => p.rooms.length > 0).length} housekeepers.
                </p>
                
                {/* Summary of assignments */}
                <div className="mt-4 text-left">
                  <div className="space-y-2">
                    {assignmentPreviews.filter(p => p.rooms.length > 0).map(preview => (
                      <div key={preview.staffId} className="flex items-center justify-between p-2 bg-muted rounded">
                        <span className="font-medium">{preview.staffName}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{preview.rooms.length} rooms</Badge>
                          <span className={`text-sm ${preview.exceedsShift ? 'text-destructive' : 'text-green-600'}`}>
                            {formatMinutesToTime(preview.totalWithBreak)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="flex-shrink-0 gap-2">
            {step === 'select-staff' && (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleGeneratePreview}
                  disabled={selectedStaffIds.size === 0 || dirtyRooms.length === 0}
                >
                  Generate Preview
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
            
            {step === 'preview' && (
              <>
                <Button variant="outline" onClick={() => setStep('select-staff')}>
                  Back
                </Button>
                <Button 
                  variant="outline"
                  onClick={handleGeneratePreview}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate
                </Button>
                <Button onClick={handleProceedToConfirm}>
                  Proceed to Confirm
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
            
            {step === 'confirm' && (
              <>
                <Button variant="outline" onClick={() => setStep('preview')}>
                  Back
                </Button>
                <Button 
                  onClick={handleConfirmAssignment}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Confirm & Assign
                    </>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Over-allocation confirmation dialog */}
      <AlertDialog open={showOverAllocationDialog} onOpenChange={setShowOverAllocationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Shift Hours Exceeded
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>The following housekeepers have been allocated more work than the standard 8-hour shift:</p>
              <div className="space-y-2 mt-2">
                {overAllocatedStaff.map(staff => (
                  <div key={staff.staffId} className="flex justify-between items-center p-2 bg-destructive/10 rounded">
                    <span className="font-medium">{staff.staffName}</span>
                    <span className="text-destructive font-semibold">
                      {formatMinutesToTime(staff.totalWithBreak)} 
                      <span className="text-sm ml-1">(+{formatMinutesToTime(staff.overageMinutes)})</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-sm">
                You can go back and adjust the assignments, or proceed with the current allocation.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back & Adjust</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                setShowOverAllocationDialog(false);
                setStep('confirm');
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
