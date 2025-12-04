import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Wand2, Users, ArrowRight, Check, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { 
  autoAssignRooms, 
  AssignmentPreview, 
  RoomForAssignment, 
  StaffForAssignment,
  moveRoom,
  calculateRoomWeight
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

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('select-staff');
      setSelectedStaffIds(new Set());
      setAssignmentPreviews([]);
      setSelectedRoomForMove(null);
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

      setAllStaff(staffData || []);

      // Fetch today's attendance to see who's checked in
      const { data: attendanceData } = await supabase
        .from('staff_attendance')
        .select('user_id')
        .eq('work_date', selectedDate)
        .in('status', ['checked_in', 'on_break']);

      const checkedIn = new Set((attendanceData || []).map(a => a.user_id));
      setCheckedInStaff(checkedIn);

      // Auto-select staff who are checked in
      setSelectedStaffIds(checkedIn);

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
              <div className="flex gap-4 p-4 bg-muted rounded-lg">
                <div className="text-center">
                  <p className="text-2xl font-bold">{dirtyRooms.length}</p>
                  <p className="text-sm text-muted-foreground">Dirty Rooms</p>
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
                  <strong>{dirtyRooms.length}</strong> rooms will be distributed among{' '}
                  <strong>{assignmentPreviews.filter(p => p.rooms.length > 0).length}</strong> housekeepers.
                  Click on a room to reassign it.
                </p>
              </div>

              {/* Assignment Preview Cards */}
              <div className="space-y-4">
                {assignmentPreviews.map(preview => (
                  <Card key={preview.staffId} className="overflow-hidden">
                    <CardHeader className="py-3 bg-muted/50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{preview.staffName}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {preview.rooms.length} rooms
                          </Badge>
                          <Badge variant="outline" className="text-amber-600">
                            {preview.checkoutCount} CO
                          </Badge>
                          <Badge variant="outline" className="text-blue-600">
                            {preview.dailyCount} Daily
                          </Badge>
                          <span className={`text-sm font-medium ${getWeightColor(preview.totalWeight, avgWeight)}`}>
                            Weight: {preview.totalWeight.toFixed(1)}
                          </span>
                        </div>
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
                                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' 
                                    : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                                } ${isSelected ? 'ring-2 ring-primary ring-offset-1' : ''}`}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedRoomForMove(null);
                                  } else {
                                    setSelectedRoomForMove({ roomId: room.id, fromStaffId: preview.staffId });
                                  }
                                }}
                                title={`${room.room_number} | ${room.room_size_sqm || '?'}m² | Weight: ${weight.toFixed(1)}`}
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

                      {/* Move target button */}
                      {selectedRoomForMove && selectedRoomForMove.fromStaffId !== preview.staffId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => handleMoveRoom(preview.staffId)}
                        >
                          Move room here
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-center py-8">
              <Check className="h-16 w-16 mx-auto text-green-600" />
              <h3 className="text-xl font-semibold">Ready to Assign</h3>
              <p className="text-muted-foreground">
                {dirtyRooms.length} rooms will be assigned to {assignmentPreviews.filter(p => p.rooms.length > 0).length} housekeepers.
              </p>
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
              <Button onClick={() => setStep('confirm')}>
                Continue
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
  );
}
