import React, { useState, useEffect, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Wand2, Users, ArrowRight, Check, Loader2, RefreshCw, AlertCircle, Clock, AlertTriangle, Move, MapPin, Trash2, Info, Undo2, Printer, EyeOff, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { 
  autoAssignRooms, 
  AssignmentPreview, 
  RoomForAssignment, 
  StaffForAssignment,
  moveRoom,
  calculateRoomWeight,
  formatMinutesToTime,
  getFloorFromRoomNumber,
  buildWingProximityMap,
  buildAffinityMap,
  RoomAffinityMap,
  WingProximityMap,
  CHECKOUT_MINUTES,
  DAILY_MINUTES,
  BREAK_TIME_MINUTES,
  HotelAssignmentConfig
} from '@/lib/roomAssignmentAlgorithm';
import { getLocalDateString } from '@/lib/utils';

const PUBLIC_AREAS = [
  { key: 'lobby_cleaning', name: 'Lobby', icon: '🏨' },
  { key: 'reception_cleaning', name: 'Reception', icon: '🛎️' },
  { key: 'back_office_cleaning', name: 'Back Office', icon: '🏢' },
  { key: 'kitchen_cleaning', name: 'Kitchen', icon: '🍳' },
  { key: 'guest_toilets_men', name: 'Guest Toilets (Men)', icon: '🚹' },
  { key: 'guest_toilets_women', name: 'Guest Toilets (Women)', icon: '🚺' },
  { key: 'common_areas_cleaning', name: 'Common Areas', icon: '🏠' },
  { key: 'stairways_cleaning', name: 'Stairways & Corridors', icon: '🚶' },
  { key: 'breakfast_room_cleaning', name: 'Breakfast Room', icon: '🍽️' },
  { key: 'dining_area_cleaning', name: 'Dining Area', icon: '🍴' },
];

interface AutoRoomAssignmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;
}

type Step = 'select-staff' | 'preview' | 'confirm' | 'public-areas';

// LocalStorage key for auto-save
function getSaveKey(hotel: string | null | undefined, date: string): string {
  return `auto_assignment_${hotel || 'unknown'}_${date}`;
}

interface SavedState {
  staffIds: string[];
  previews: AssignmentPreview[];
  savedAt: number;
}

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
  
  // Room exclusion
  const [excludedRoomIds, setExcludedRoomIds] = useState<Set<string>>(new Set());
  
  // Preview
  const [assignmentPreviews, setAssignmentPreviews] = useState<AssignmentPreview[]>([]);
  const [selectedRoomForMove, setSelectedRoomForMove] = useState<{roomId: string; fromStaffId: string} | null>(null);
  
  // Undo history
  const [previewHistory, setPreviewHistory] = useState<AssignmentPreview[][]>([]);
  
  // Drag and drop
  const [dragOverStaffId, setDragOverStaffId] = useState<string | null>(null);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
  const [justDroppedStaffId, setJustDroppedStaffId] = useState<string | null>(null);
  const [justDroppedRoomId, setJustDroppedRoomId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // Over-allocation confirmation
  const [showOverAllocationDialog, setShowOverAllocationDialog] = useState(false);
  const [overAllocatedStaff, setOverAllocatedStaff] = useState<AssignmentPreview[]>([]);
  // Auto-save restored flag
  const [restoredFromSave, setRestoredFromSave] = useState(false);

  // Wing proximity map for smart assignments
  const [wingProximity, setWingProximity] = useState<WingProximityMap | undefined>(undefined);
  const [roomAffinity, setRoomAffinity] = useState<RoomAffinityMap | undefined>(undefined);

  // Public area assignments (post-room assignment step)
  const [publicAreaAssignments, setPublicAreaAssignments] = useState<Map<string, string>>(new Map());

  const saveKey = getSaveKey(profile?.assigned_hotel, selectedDate);

  // Undo support with Ctrl+Z
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && step === 'preview' && previewHistory.length > 0) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, previewHistory]);

  const pushHistory = (previews: AssignmentPreview[]) => {
    setPreviewHistory(prev => [...prev.slice(-19), previews]);
  };

  const handleUndo = () => {
    if (previewHistory.length === 0) return;
    const previous = previewHistory[previewHistory.length - 1];
    setPreviewHistory(prev => prev.slice(0, -1));
    setAssignmentPreviews(previous);
    toast.success(t('autoAssign.undoSuccess'));
  };

  // Auto-save: persist staff selection and previews
  useEffect(() => {
    if (!open) return;
    if (selectedStaffIds.size === 0 && assignmentPreviews.length === 0) return;
    
    const data: SavedState = {
      staffIds: Array.from(selectedStaffIds),
      previews: assignmentPreviews,
      savedAt: Date.now()
    };
    try {
      localStorage.setItem(saveKey, JSON.stringify(data));
    } catch (e) {
      // localStorage full or unavailable, ignore
    }
  }, [selectedStaffIds, assignmentPreviews, saveKey, open]);

  // Clear saved state
  const handleClearSaved = () => {
    localStorage.removeItem(saveKey);
    setRestoredFromSave(false);
    setStep('select-staff');
    setSelectedStaffIds(new Set());
    setAssignmentPreviews([]);
    setSelectedRoomForMove(null);
    setExcludedRoomIds(new Set());
    setPreviewHistory([]);
    toast.success(t('autoAssign.savedCleared'));
  };

  // Reset state when dialog opens - restore from localStorage if available
  useEffect(() => {
    if (open) {
      setSelectedRoomForMove(null);
      setShowOverAllocationDialog(false);
      setPublicAreaAssignments(new Map());
      setExcludedRoomIds(new Set());
      setPreviewHistory([]);

      // Try to restore from localStorage
      try {
        const saved = localStorage.getItem(saveKey);
        if (saved) {
          const data: SavedState = JSON.parse(saved);
          // Only restore if less than 12 hours old
          if (Date.now() - data.savedAt < 12 * 60 * 60 * 1000) {
            setSelectedStaffIds(new Set(data.staffIds));
            if (data.previews?.length > 0) {
              setAssignmentPreviews(data.previews);
              setStep('preview');
              setRestoredFromSave(true);
            } else {
              setStep('select-staff');
              setRestoredFromSave(true);
            }
          } else {
            localStorage.removeItem(saveKey);
            setStep('select-staff');
            setSelectedStaffIds(new Set());
            setAssignmentPreviews([]);
            setRestoredFromSave(false);
          }
        } else {
          setStep('select-staff');
          setSelectedStaffIds(new Set());
          setAssignmentPreviews([]);
          setRestoredFromSave(false);
        }
      } catch {
        setStep('select-staff');
        setSelectedStaffIds(new Set());
        setAssignmentPreviews([]);
        setRestoredFromSave(false);
      }

      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get manager's hotel
      const hotelName = await getManagerHotel();
      if (!hotelName) {
        toast.error(t('autoAssign.noHotelAssigned'));
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
      
      // Only auto-select checked-in staff if NOT restored from save
      if (!restoredFromSave) {
        setSelectedStaffIds(new Set(hotelCheckedIn));
      }

      // Fetch dirty rooms that don't have assignments for today
      const { data: roomsData } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration')
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

      // Fetch wing layouts for proximity-based smart assignment
      const { data: layoutData } = await supabase
        .from('hotel_floor_layouts')
        .select('floor_number, wing, x, y')
        .eq('hotel_name', hotelName);
      
      if (layoutData && layoutData.length > 0) {
        setWingProximity(buildWingProximityMap(layoutData.map(l => ({
          floor_number: l.floor_number,
          wing: l.wing,
          x: Number(l.x),
          y: Number(l.y),
        }))));
      } else {
        setWingProximity(undefined);
      }

      // Fetch assignment patterns for learning
      const { data: patternData } = await supabase
        .from('assignment_patterns')
        .select('room_number_a, room_number_b, pair_count')
        .eq('hotel', hotelName)
        .eq('organization_slug', profile?.organization_slug || 'rdhotels');

      if (patternData && patternData.length > 0) {
        setRoomAffinity(buildAffinityMap(patternData));
      } else {
        setRoomAffinity(undefined);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error(t('autoAssign.failedToLoad'));
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

  const toggleRoomExclusion = (roomId: string) => {
    setExcludedRoomIds(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const handleGeneratePreview = async () => {
    const selectedStaff = allStaff.filter(s => selectedStaffIds.has(s.id));
    const roomsToAssign = dirtyRooms.filter(r => !excludedRoomIds.has(r.id));
    
    // Build hotel-specific config - read from DB instead of hardcoding
    const hotelName = await getManagerHotel();
    let hotelConfig: HotelAssignmentConfig | undefined;
    
    try {
      // Load zone mapping from hotel_configurations.settings
      const { data: configData } = await supabase
        .from('hotel_configurations')
        .select('settings')
        .eq('hotel_name', hotelName || '')
        .single();
      
      const settings = (configData?.settings as any) || {};
      const dbZoneMapping = settings.wing_zone_mapping;
      
      // Load AI insights from localStorage
      let staffPreferences: Record<string, string[]> | undefined;
      try {
        const insightsKey = `ai_insights_${hotelName}`;
        const cached = localStorage.getItem(insightsKey);
        if (cached) {
          const insights = JSON.parse(cached);
          if (Date.now() - (insights.cachedAt || 0) < 7 * 24 * 60 * 60 * 1000) {
            staffPreferences = insights.staff_preferences;
          }
        }
      } catch { /* ignore */ }
      
      if (dbZoneMapping && Object.keys(dbZoneMapping).length > 0) {
        hotelConfig = { wingZoneMapping: dbZoneMapping, staffPreferences };
      } else if (hotelName === 'Hotel Memories Budapest') {
        // Fallback for Hotel Memories Budapest if no DB config yet
        hotelConfig = {
          wingZoneMapping: {
            'A': 'ground', 'B': 'ground', 'C': 'ground',
            'D': 'f1-left', 'E': 'f1-right',
            'F': 'f1-back', 'G': 'f1-back', 'H': 'f1-back',
            'I': 'f2-f3', 'J': 'f2-f3',
          },
          staffPreferences,
        };
      } else if (staffPreferences) {
        hotelConfig = { staffPreferences };
      }
    } catch {
      // Fallback to hardcoded for Memories Budapest
      if (hotelName === 'Hotel Memories Budapest') {
        hotelConfig = {
          wingZoneMapping: {
            'A': 'ground', 'B': 'ground', 'C': 'ground',
            'D': 'f1-left', 'E': 'f1-right',
            'F': 'f1-back', 'G': 'f1-back', 'H': 'f1-back',
            'I': 'f2-f3', 'J': 'f2-f3',
          },
        };
      }
    }
    
    const previews = autoAssignRooms(roomsToAssign, selectedStaff, wingProximity, roomAffinity, hotelConfig);
    setAssignmentPreviews(previews);
    setPreviewHistory([]);
    setStep('preview');
  };

  const handleMoveRoom = (toStaffId: string) => {
    if (!selectedRoomForMove) return;
    
    pushHistory(assignmentPreviews);
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
      // Create all assignments with checkout-first priority ordering
      const assignments = assignmentPreviews.flatMap(preview => {
        // Sort: checkouts first, then daily, by floor and room number
        const sorted = [...preview.rooms].sort((a, b) => {
          if (a.is_checkout_room && !b.is_checkout_room) return -1;
          if (!a.is_checkout_room && b.is_checkout_room) return 1;
          const floorA = getFloorFromRoomNumber(a.room_number);
          const floorB = getFloorFromRoomNumber(b.room_number);
          if (floorA !== floorB) return floorA - floorB;
          return parseInt(a.room_number) - parseInt(b.room_number);
        });
        return sorted.map((room, index) => ({
          room_id: room.id,
          assigned_to: preview.staffId,
          assigned_by: user.id,
          assignment_date: selectedDate,
          assignment_type: (room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning') as 'checkout_cleaning' | 'daily_cleaning',
          status: 'assigned' as const,
          priority: index + 1,
          organization_slug: profile?.organization_slug,
          ready_to_clean: !room.is_checkout_room
        }));
      });

      if (assignments.length === 0) {
        toast.error(t('autoAssign.noRoomsToAssign'));
        return;
      }

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      // Save assignment patterns for learning
      const hotelName = await getManagerHotel();
      if (hotelName) {
        const pairsToUpsert: Array<{ hotel: string; room_number_a: string; room_number_b: string; organization_slug: string }> = [];
        for (const preview of assignmentPreviews) {
          const roomNumbers = preview.rooms.map(r => r.room_number);
          for (let i = 0; i < roomNumbers.length; i++) {
            for (let j = i + 1; j < roomNumbers.length; j++) {
              const [a, b] = roomNumbers[i] < roomNumbers[j] 
                ? [roomNumbers[i], roomNumbers[j]] 
                : [roomNumbers[j], roomNumbers[i]];
              pairsToUpsert.push({
                hotel: hotelName,
                room_number_a: a,
                room_number_b: b,
                organization_slug: profile?.organization_slug || 'rdhotels',
              });
            }
          }
        }

        if (pairsToUpsert.length > 0) {
          const upsertPromises = pairsToUpsert.map(p =>
            supabase.rpc('upsert_assignment_pattern' as any, {
              p_hotel: p.hotel,
              p_room_a: p.room_number_a,
              p_room_b: p.room_number_b,
              p_org_slug: p.organization_slug,
            })
          );
          Promise.allSettled(upsertPromises).catch(() => {
            console.warn('Some pattern learning calls failed');
          });
        }
      }

      // Clear saved state after successful assignment
      localStorage.removeItem(saveKey);

      const totalRooms = assignments.length;
      const staffCount = assignmentPreviews.filter(p => p.rooms.length > 0).length;
      
      toast.success(`${t('autoAssign.assigned')} ${totalRooms} ${t('autoAssign.roomsTo')} ${staffCount} ${t('autoAssign.housekeepers')}`);
      onAssignmentCreated(totalRooms, staffCount);
      
      // Move to public areas step instead of closing
      setStep('public-areas');

    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error(t('autoAssign.failedToAssign'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignPublicAreas = async () => {
    if (publicAreaAssignments.size === 0 || !user) {
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    try {
      const today = getLocalDateString();
      const hotelName = await getManagerHotel();
      
      const tasks = Array.from(publicAreaAssignments.entries()).map(([areaKey, staffId]) => {
        const area = PUBLIC_AREAS.find(a => a.key === areaKey)!;
        return {
          task_name: area.name,
          task_description: area.name,
          task_type: areaKey,
          assigned_to: staffId,
          assigned_by: user.id,
          assigned_date: today,
          hotel: hotelName || '',
          priority: 1,
          status: 'assigned',
          organization_slug: profile?.organization_slug || '',
        };
      });

      const { error } = await supabase.from('general_tasks').insert(tasks);
      if (error) throw error;

      toast.success(`${t('autoAssign.assigned')} ${tasks.length} ${t('autoAssign.publicAreas')}`);
      onAssignmentCreated(tasks.length, 0);
      onOpenChange(false);
    } catch (error) {
      console.error('Error assigning public areas:', error);
      toast.error(t('autoAssign.failedToAssignAreas'));
    } finally {
      setSubmitting(false);
    }
  };

  const togglePublicAreaAssignment = (areaKey: string, staffId: string) => {
    const newMap = new Map(publicAreaAssignments);
    if (newMap.get(areaKey) === staffId) {
      newMap.delete(areaKey);
    } else {
      newMap.set(areaKey, staffId);
    }
    setPublicAreaAssignments(newMap);
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

  // Calculate max time for workload bar scaling
  const maxTime = assignmentPreviews.length > 0
    ? Math.max(...assignmentPreviews.filter(p => p.rooms.length > 0).map(p => p.totalWithBreak), 1)
    : 1;

  // Group rooms by floor for a given set of rooms
  const groupByFloor = (rooms: RoomForAssignment[]) => {
    const groups: Record<number, RoomForAssignment[]> = {};
    rooms.forEach(r => {
      const floor = getFloorFromRoomNumber(r.room_number);
      if (!groups[floor]) groups[floor] = [];
      groups[floor].push(r);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([floor, floorRooms]) => ({
        floor: parseInt(floor),
        rooms: floorRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number))
      }));
  };

  // Convert full room category name to short label
  const getCategoryShortName = (category: string): string => {
    const lower = category.toLowerCase();
    if (lower.includes('single')) return 'Sgl';
    if (lower.includes('triple')) return 'Trpl';
    if (lower.includes('quadruple') || lower.includes('quad')) return 'Quad';
    if (lower.includes('queen')) return 'Queen';
    if (lower.includes('double or twin') || lower.includes('twin or double')) return 'DB/TW';
    if (lower.includes('double')) return 'Dbl';
    if (lower.includes('twin')) return 'Twin';
    if (lower.includes('suite')) return 'Suite';
    if (lower.includes('studio')) return 'Studio';
    if (lower.includes('economy')) return 'Eco';
    if (lower.includes('comfort')) return 'Comf';
    if (lower.includes('deluxe')) return 'Dlx';
    if (lower.includes('superior')) return 'Sup';
    // Fallback: first 4 chars
    return category.substring(0, 4);
  };

  // Print assignment sheets
  const handlePrintAssignments = () => {
    const activePreviews = assignmentPreviews.filter(p => p.rooms.length > 0);
    if (activePreviews.length === 0) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error(t('autoAssign.popupBlocked'));
      return;
    }

    const html = `<!DOCTYPE html>
<html><head><title>${t('autoAssign.assignmentSheets')} - ${selectedDate}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
  .page { page-break-after: always; padding: 20px; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; color: #666; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 12px; }
  th { background: #f5f5f5; font-weight: 600; }
  .type-co { background: #fef3c7; }
  .type-daily { background: #dbeafe; }
  .summary { font-size: 13px; margin-bottom: 12px; color: #333; }
  .special { color: #dc2626; font-weight: 600; }
  @media print { body { padding: 0; } }
</style></head><body>
${activePreviews.map(preview => {
  const checkouts = preview.rooms.filter(r => r.is_checkout_room);
  const daily = preview.rooms.filter(r => !r.is_checkout_room);
  const sortByRoom = (rooms: RoomForAssignment[]) => 
    [...rooms].sort((a, b) => {
      const fa = getFloorFromRoomNumber(a.room_number);
      const fb = getFloorFromRoomNumber(b.room_number);
      return fa !== fb ? fa - fb : parseInt(a.room_number) - parseInt(b.room_number);
    });

  return `<div class="page">
    <h1>${preview.staffName}</h1>
    <h2>${selectedDate} · ${preview.rooms.length} ${t('autoAssign.rooms')} · ${formatMinutesToTime(preview.totalWithBreak)}</h2>
    <div class="summary">${t('autoAssign.checkouts')}: ${checkouts.length} · ${t('autoAssign.daily')}: ${daily.length}</div>
    <table>
      <tr><th>#</th><th>${t('autoAssign.room')}</th><th>${t('autoAssign.type')}</th><th>${t('autoAssign.floor')}</th><th>${t('autoAssign.category')}</th><th>${t('autoAssign.special')}</th></tr>
      ${sortByRoom(preview.rooms).map((room, i) => {
        const specials: string[] = [];
        if (room.towel_change_required) specials.push('🧺 Towel');
        if (room.linen_change_required) specials.push('🛏️ Linen');
        if (room.bed_configuration) specials.push(`Bed: ${room.bed_configuration}`);
        return `<tr class="${room.is_checkout_room ? 'type-co' : 'type-daily'}">
          <td>${i + 1}</td>
          <td><strong>${room.room_number}</strong></td>
          <td>${room.is_checkout_room ? 'Checkout' : 'Daily'}</td>
          <td>F${getFloorFromRoomNumber(room.room_number)}</td>
          <td>${room.room_category || '—'}</td>
          <td class="${specials.length > 0 ? 'special' : ''}">${specials.join(', ') || '—'}</td>
        </tr>`;
      }).join('')}
    </table>
  </div>`;
}).join('')}
</body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  const renderRoomChip = (room: RoomForAssignment, preview: AssignmentPreview) => {
    const isSelected = selectedRoomForMove?.roomId === room.id;
    const chipColor = room.is_checkout_room
      ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300'
      : 'bg-blue-100 text-blue-900 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300';

    return (
      <div
        key={room.id}
        draggable={!isMobile}
        onDragStart={(e) => {
          e.dataTransfer.setData('roomId', room.id);
          e.dataTransfer.setData('fromStaffId', preview.staffId);
          e.dataTransfer.effectAllowed = 'move';
          setDraggingRoomId(room.id);
          const ghost = document.createElement('div');
          ghost.textContent = room.room_number;
          ghost.style.cssText = `position:fixed;top:-100px;left:-100px;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:9999;background:${room.is_checkout_room ? '#fef3c7' : '#dbeafe'};color:${room.is_checkout_room ? '#92400e' : '#1e40af'};border:2px solid ${room.is_checkout_room ? '#f59e0b' : '#3b82f6'};`;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 20, 15);
          requestAnimationFrame(() => document.body.removeChild(ghost));
        }}
        onDragEnd={() => { setDraggingRoomId(null); setDragOverStaffId(null); }}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-all duration-200 select-none ${
          !isMobile ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        } ${chipColor} ${isSelected ? 'ring-2 ring-primary ring-offset-1 scale-105' : ''}
        ${draggingRoomId === room.id ? 'opacity-30 scale-95' : ''}
        ${justDroppedRoomId === room.id ? 'animate-scale-in ring-2 ring-green-500' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isSelected) setSelectedRoomForMove(null);
          else setSelectedRoomForMove({ roomId: room.id, fromStaffId: preview.staffId });
        }}
        title={`${t('autoAssign.room')} ${room.room_number}${room.room_category ? ` · ${room.room_category}` : ''}${room.wing ? ` · Wing ${room.wing}` : ''}${room.room_size_sqm ? ` · ${room.room_size_sqm}m²` : ''}`}
      >
        <span>{room.room_number}</span>
        {room.room_category && (
          <span className="text-[9px] opacity-70 font-normal">{getCategoryShortName(room.room_category)}</span>
        )}
        {room.towel_change_required && (
          <span className="text-[10px] px-0.5 font-bold text-red-600">T</span>
        )}
        {room.linen_change_required && (
          <span className="text-[10px] px-0.5 font-bold text-red-600">L</span>
        )}
        {room.bed_configuration && (
          <span className="text-[9px] px-0.5 opacity-70">🛏️{room.bed_configuration.length > 8 ? room.bed_configuration.substring(0, 8) : room.bed_configuration}</span>
        )}
      </div>
    );
  };

  // Summary table for consolidated preview
  const renderSummaryTable = () => {
    const activePreviews = assignmentPreviews.filter(p => p.rooms.length > 0);
    if (activePreviews.length === 0) return null;

    return (
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr,auto,auto,auto,auto,1fr] gap-x-3 gap-y-0 text-xs">
          {/* Header */}
          <div className="px-3 py-2 bg-muted/60 font-semibold">{t('autoAssign.staff')}</div>
          <div className="px-2 py-2 bg-muted/60 font-semibold text-center">CO</div>
          <div className="px-2 py-2 bg-muted/60 font-semibold text-center">{t('autoAssign.daily')}</div>
          <div className="px-2 py-2 bg-muted/60 font-semibold text-center">{t('autoAssign.tasks')}</div>
          <div className="px-2 py-2 bg-muted/60 font-semibold text-right">{t('autoAssign.time')}</div>
          <div className="px-3 py-2 bg-muted/60 font-semibold">{t('autoAssign.workload')}</div>
          
          {/* Rows */}
          {activePreviews.map((p, i) => {
            const towelCount = p.rooms.filter(r => r.towel_change_required).length;
            const linenCount = p.rooms.filter(r => r.linen_change_required).length;
            const workloadPct = Math.min(100, Math.round((p.totalWithBreak / maxTime) * 100));
            const barColor = p.exceedsShift ? 'bg-destructive' : workloadPct > 80 ? 'bg-amber-500' : 'bg-green-500';
            
            return (
              <React.Fragment key={p.staffId}>
                <div className={`px-3 py-1.5 font-medium truncate ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  {p.staffName}
                </div>
                <div className={`px-2 py-1.5 text-center text-amber-600 font-semibold ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  {p.checkoutCount}
                </div>
                <div className={`px-2 py-1.5 text-center text-blue-600 font-semibold ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  {p.dailyCount}
                </div>
                <div className={`px-2 py-1.5 text-center ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  {towelCount > 0 && <span className="text-red-600 font-semibold">{towelCount}T</span>}
                  {towelCount > 0 && linenCount > 0 && ' '}
                  {linenCount > 0 && <span className="text-red-600 font-semibold">{linenCount}L</span>}
                  {towelCount === 0 && linenCount === 0 && '—'}
                </div>
                <div className={`px-2 py-1.5 text-right ${p.exceedsShift ? 'text-destructive font-semibold' : ''} ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  {formatMinutesToTime(p.totalWithBreak)}
                </div>
                <div className={`px-3 py-1.5 flex items-center ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${workloadPct}%` }} />
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  // Effective rooms (after exclusion)
  const effectiveRooms = dirtyRooms.filter(r => !excludedRoomIds.has(r.id));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`max-h-[90vh] flex flex-col ${step === 'preview' ? 'max-w-[95vw] w-full' : 'max-w-4xl'}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              {t('autoAssign.title')}
              {restoredFromSave && (
                <Badge variant="outline" className="text-xs text-green-600 border-green-300 ml-2">
                  {t('autoAssign.restored')}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-1.5 py-2 flex-wrap">
            <Badge variant={step === 'select-staff' ? 'default' : 'secondary'} className="text-xs">1. {t('autoAssign.stepStaff')}</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'preview' ? 'default' : 'secondary'} className="text-xs">2. {t('autoAssign.stepPreview')}</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'confirm' ? 'default' : 'secondary'} className="text-xs">3. {t('autoAssign.stepConfirm')}</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge variant={step === 'public-areas' ? 'default' : 'secondary'} className="text-xs">4. {t('autoAssign.stepPublicAreas')}</Badge>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : step === 'select-staff' ? (
              <div className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{effectiveRooms.length}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('autoAssign.totalRooms')}
                      {excludedRoomIds.size > 0 && (
                        <span className="text-xs text-destructive ml-1">(-{excludedRoomIds.size})</span>
                      )}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-600">
                      {effectiveRooms.filter(r => r.is_checkout_room).length}
                    </p>
                    <p className="text-sm text-muted-foreground">{t('autoAssign.checkouts')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {effectiveRooms.filter(r => !r.is_checkout_room).length}
                    </p>
                    <p className="text-sm text-muted-foreground">{t('autoAssign.daily')}</p>
                  </div>
                </div>

                {/* Time estimation info */}
                <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>
                    {t('autoAssign.checkoutRooms')}: <strong>{CHECKOUT_MINUTES} min</strong> | 
                    {t('autoAssign.dailyRooms')}: <strong>{DAILY_MINUTES} min</strong> | 
                    {t('autoAssign.break')}: <strong>{BREAK_TIME_MINUTES} min</strong>
                  </span>
                </div>

                {dirtyRooms.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t('autoAssign.noDirtyRooms')}</p>
                  </div>
                ) : (
                  <>
                    <h3 className="font-medium flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {t('autoAssign.selectHousekeepers')} ({selectedStaffIds.size} {t('autoAssign.selected')})
                    </h3>

                    <div className="max-h-[40vh] overflow-y-auto">
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
                                {t('autoAssign.checkedIn')}
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    </div>

                    {/* Pre-Assignment: Room Exclusion */}
                    {dirtyRooms.length > 0 && (
                      <div className="mt-4 border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-sm font-medium"
                          onClick={() => {
                            const el = document.getElementById('room-exclusion-section');
                            if (el) el.classList.toggle('hidden');
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <EyeOff className="h-4 w-4" />
                            {t('autoAssign.excludeRooms')} ({excludedRoomIds.size}/{dirtyRooms.length})
                          </span>
                          <span className="text-xs text-muted-foreground">{t('autoAssign.clickToExpand')}</span>
                        </button>
                        <div id="room-exclusion-section" className="hidden p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">{t('autoAssign.excludeRoomsDesc')}</p>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => setExcludedRoomIds(new Set())}
                              >
                                {t('autoAssign.includeAll')}
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {dirtyRooms.map(room => {
                              const isExcluded = excludedRoomIds.has(room.id);
                              return (
                                <button
                                  key={room.id}
                                  type="button"
                                  className={`px-2 py-1 rounded-md text-xs font-medium transition-all border ${
                                    isExcluded
                                      ? 'bg-red-100 border-red-400 text-red-800 line-through dark:bg-red-900/40 dark:text-red-300 dark:border-red-600'
                                      : 'bg-muted border-border text-foreground hover:bg-muted/80'
                                  }`}
                                  onClick={() => toggleRoomExclusion(room.id)}
                                >
                                  {room.room_number} {isExcluded ? '✕' : ''}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Pre-Assignment Towel Change Settings */}
                    {dirtyRooms.length > 0 && (
                      <div className="border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-sm font-medium"
                          onClick={() => {
                            const el = document.getElementById('towel-toggle-section');
                            if (el) el.classList.toggle('hidden');
                          }}
                        >
                          <span className="flex items-center gap-2">
                            🧺 {t('autoAssign.towelChange')} ({dirtyRooms.filter(r => r.towel_change_required).length}/{dirtyRooms.length})
                          </span>
                          <span className="text-xs text-muted-foreground">{t('autoAssign.clickToExpand')}</span>
                        </button>
                        <div id="towel-toggle-section" className="hidden p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">{t('autoAssign.towelChangeDesc')}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={async () => {
                                const allSet = dirtyRooms.every(r => r.towel_change_required);
                                const newVal = !allSet;
                                const roomIds = dirtyRooms.map(r => r.id);
                                await supabase.from('rooms').update({ towel_change_required: newVal } as any).in('id', roomIds);
                                setDirtyRooms(prev => prev.map(r => ({ ...r, towel_change_required: newVal })));
                                toast.success(newVal ? t('autoAssign.allTowelSet') : t('autoAssign.allTowelRemoved'));
                              }}
                            >
                              {dirtyRooms.every(r => r.towel_change_required) ? t('autoAssign.deselectAll') : t('autoAssign.selectAll')}
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {dirtyRooms.map(room => (
                              <button
                                key={room.id}
                                type="button"
                                className={`px-2 py-1 rounded-md text-xs font-medium transition-all border ${
                                  room.towel_change_required
                                    ? 'bg-yellow-100 border-yellow-400 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-600'
                                    : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'
                                }`}
                                onClick={async () => {
                                  const newVal = !room.towel_change_required;
                                  await supabase.from('rooms').update({ towel_change_required: newVal } as any).eq('id', room.id);
                                  setDirtyRooms(prev => prev.map(r => r.id === room.id ? { ...r, towel_change_required: newVal } : r));
                                }}
                              >
                                {room.room_number} {room.towel_change_required ? '🧺' : ''}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Pre-Assignment Linen Change Settings */}
                    {dirtyRooms.length > 0 && (
                      <div className="border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-sm font-medium"
                          onClick={() => {
                            const el = document.getElementById('linen-toggle-section');
                            if (el) el.classList.toggle('hidden');
                          }}
                        >
                          <span className="flex items-center gap-2">
                            🛏️ {t('autoAssign.linenChange')} ({dirtyRooms.filter(r => r.linen_change_required).length}/{dirtyRooms.length})
                          </span>
                          <span className="text-xs text-muted-foreground">{t('autoAssign.clickToExpand')}</span>
                        </button>
                        <div id="linen-toggle-section" className="hidden p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">{t('autoAssign.linenChangeDesc')}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={async () => {
                                const allSet = dirtyRooms.every(r => r.linen_change_required);
                                const newVal = !allSet;
                                const roomIds = dirtyRooms.map(r => r.id);
                                await supabase.from('rooms').update({ linen_change_required: newVal } as any).in('id', roomIds);
                                setDirtyRooms(prev => prev.map(r => ({ ...r, linen_change_required: newVal })));
                                toast.success(newVal ? t('autoAssign.allLinenSet') : t('autoAssign.allLinenRemoved'));
                              }}
                            >
                              {dirtyRooms.every(r => r.linen_change_required) ? t('autoAssign.deselectAll') : t('autoAssign.selectAll')}
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {dirtyRooms.map(room => (
                              <button
                                key={room.id}
                                type="button"
                                className={`px-2 py-1 rounded-md text-xs font-medium transition-all border ${
                                  room.linen_change_required
                                    ? 'bg-purple-100 border-purple-400 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-600'
                                    : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'
                                }`}
                                onClick={async () => {
                                  const newVal = !room.linen_change_required;
                                  await supabase.from('rooms').update({ linen_change_required: newVal } as any).eq('id', room.id);
                                  setDirtyRooms(prev => prev.map(r => r.id === room.id ? { ...r, linen_change_required: newVal } : r));
                                }}
                              >
                                {room.room_number} {room.linen_change_required ? '🛏️' : ''}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : step === 'preview' ? (
              <div className="space-y-3">
                {/* Summary bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 rounded-lg text-sm">
                  <p>
                    <strong>{assignmentPreviews.reduce((sum, p) => sum + p.rooms.length, 0)}</strong> {t('autoAssign.rooms')} → <strong>{assignmentPreviews.filter(p => p.rooms.length > 0).length}</strong> {t('autoAssign.staff')}
                    {excludedRoomIds.size > 0 && (
                      <span className="text-xs text-destructive ml-2">({excludedRoomIds.size} {t('autoAssign.excluded')})</span>
                    )}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-400"></span>{t('autoAssign.checkout')}</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-200 border border-blue-400"></span>{t('autoAssign.daily')}</span>
                    <span className="flex items-center gap-1"><span className="text-[10px] font-bold text-red-600">T</span>{t('autoAssign.towel')}</span>
                    <span className="flex items-center gap-1"><span className="text-[10px] font-bold text-red-600">L</span>{t('autoAssign.linen')}</span>
                  </div>
                </div>

                {/* Multi-column layout: all housekeepers side by side */}
                <div className="flex gap-2 overflow-x-auto pb-2" style={{ minHeight: '300px' }}>
                  {assignmentPreviews.filter(p => p.rooms.length > 0).map(preview => {
                    const isDropTarget = selectedRoomForMove && selectedRoomForMove.fromStaffId !== preview.staffId;
                    const isDragOver = dragOverStaffId === preview.staffId;
                    const isOverShift = preview.exceedsShift && preview.rooms.length > 0;
                    const workloadPct = Math.min(100, Math.round((preview.totalWithBreak / maxTime) * 100));
                    const barColor = isOverShift ? 'bg-destructive' : workloadPct > 80 ? 'bg-amber-500' : 'bg-green-500';
                    const checkoutRooms = preview.rooms.filter(r => r.is_checkout_room);
                    const dailyRooms = preview.rooms.filter(r => !r.is_checkout_room);
                    const towelCount = preview.rooms.filter(r => r.towel_change_required).length;
                    const linenCount = preview.rooms.filter(r => r.linen_change_required).length;
                    const activeStaffCount = assignmentPreviews.filter(p => p.rooms.length > 0).length;
                    // Column width: fill equally, min 180px
                    const colStyle: React.CSSProperties = {
                      minWidth: activeStaffCount <= 4 ? '220px' : '180px',
                      flex: `1 1 0`,
                    };

                    return (
                      <div
                        key={preview.staffId}
                        style={colStyle}
                        className={`rounded-lg border flex flex-col transition-all duration-200 ${
                          isDropTarget ? 'ring-2 ring-primary cursor-pointer' : ''
                        } ${isDragOver ? 'ring-2 ring-blue-500 border-dashed bg-blue-50/50 dark:bg-blue-950/20' : ''}
                        ${justDroppedStaffId === preview.staffId ? 'ring-2 ring-green-500 bg-green-50/50 dark:bg-green-950/20' : ''}
                        ${isOverShift ? 'border-destructive' : 'border-border'}`}
                        onClick={() => isDropTarget && handleMoveRoom(preview.staffId)}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDragEnter={(e) => { e.preventDefault(); setDragOverStaffId(preview.staffId); }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStaffId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverStaffId(null);
                          setDraggingRoomId(null);
                          const roomId = e.dataTransfer.getData('roomId');
                          const fromStaffId = e.dataTransfer.getData('fromStaffId');
                          if (roomId && fromStaffId && fromStaffId !== preview.staffId) {
                            pushHistory(assignmentPreviews);
                            const newPreviews = moveRoom(assignmentPreviews, roomId, fromStaffId, preview.staffId);
                            setAssignmentPreviews(newPreviews);
                            setJustDroppedStaffId(preview.staffId);
                            setJustDroppedRoomId(roomId);
                            setTimeout(() => { setJustDroppedStaffId(null); setJustDroppedRoomId(null); }, 600);
                          }
                        }}
                      >
                        {/* Column header */}
                        <div className={`px-2 py-1.5 border-b ${isOverShift ? 'bg-destructive/10' : 'bg-muted/40'}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs truncate">{preview.staffName}</span>
                            {isOverShift && <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />}
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-[10px] text-muted-foreground">
                              {checkoutRooms.length}co · {dailyRooms.length}d
                              {towelCount > 0 && <> · <span className="text-red-600 font-semibold">{towelCount}T</span></>}
                              {linenCount > 0 && <> · <span className="text-red-600 font-semibold">{linenCount}L</span></>}
                            </p>
                            <span className={`text-[10px] font-medium ${isOverShift ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {formatMinutesToTime(preview.totalWithBreak)}
                            </span>
                          </div>
                          <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-1">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${workloadPct}%` }} />
                          </div>
                        </div>

                        {/* Room chips - scrollable column body */}
                        <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5" style={{ maxHeight: '50vh' }}>
                          {/* Checkouts */}
                          {checkoutRooms.length > 0 && (
                            <div>
                              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5 px-0.5">{t('autoAssign.checkouts')}</p>
                              {groupByFloor(checkoutRooms).map(({ floor, rooms }) => (
                                <div key={`co-${floor}`} className="flex items-start gap-1 mb-1">
                                  <span className="text-[8px] text-muted-foreground bg-muted px-0.5 rounded mt-0.5 flex-shrink-0">F{floor}</span>
                                  <div className="flex flex-wrap gap-1">
                                    {rooms.map(room => renderRoomChip(room, preview))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Daily */}
                          {dailyRooms.length > 0 && (
                            <div>
                              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5 px-0.5">{t('autoAssign.daily')}</p>
                              {groupByFloor(dailyRooms).map(({ floor, rooms }) => (
                                <div key={`d-${floor}`} className="flex items-start gap-1 mb-1">
                                  <span className="text-[8px] text-muted-foreground bg-muted px-0.5 rounded mt-0.5 flex-shrink-0">F{floor}</span>
                                  <div className="flex flex-wrap gap-1">
                                    {rooms.map(room => renderRoomChip(room, preview))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Drop indicator */}
                          {isDropTarget && !isDragOver && (
                            <div className="p-1 border border-dashed border-primary rounded text-center text-[10px] text-primary">
                              {t('autoAssign.tapToMoveHere')}
                            </div>
                          )}
                          {isDragOver && (
                            <div className="p-1 border border-dashed border-blue-500 rounded text-center text-[10px] text-blue-600 bg-blue-50 dark:bg-blue-950/30">
                              {t('autoAssign.dropHere')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Info about room order */}
                <div className="flex items-start gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-[11px] text-blue-800 dark:text-blue-300">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>{t('autoAssign.previewInfo')} {isMobile ? t('autoAssign.tapToMove') : t('autoAssign.dragToReassign')}</span>
                </div>
              </div>
            ) : step === 'confirm' ? (
              <div className="space-y-4 text-center py-8">
                <Check className="h-16 w-16 mx-auto text-green-600" />
                <h3 className="text-xl font-semibold">{t('autoAssign.readyToAssign')}</h3>
                <p className="text-muted-foreground">
                  {assignmentPreviews.reduce((sum, p) => sum + p.rooms.length, 0)} {t('autoAssign.roomsWillBeAssigned')} {assignmentPreviews.filter(p => p.rooms.length > 0).length} {t('autoAssign.housekeepers')}.
                </p>
                
                {/* Summary of assignments */}
                <div className="mt-4 text-left">
                  <div className="space-y-2">
                    {assignmentPreviews.filter(p => p.rooms.length > 0).map(preview => (
                      <div key={preview.staffId} className="flex items-center justify-between p-2 bg-muted rounded">
                        <span className="font-medium">{preview.staffName}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{preview.rooms.length} {t('autoAssign.rooms')}</Badge>
                          <span className={`text-sm ${preview.exceedsShift ? 'text-destructive' : 'text-green-600'}`}>
                            {formatMinutesToTime(preview.totalWithBreak)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : step === 'public-areas' ? (
              <div className="space-y-4">
                <div className="text-center">
                  <Check className="h-12 w-12 mx-auto text-green-600 mb-2" />
                  <h3 className="text-lg font-semibold">{t('autoAssign.roomsAssignedSuccess')}</h3>
                  <p className="text-sm text-muted-foreground">{t('autoAssign.assignPublicAreasDesc')}</p>
                </div>

                <div className="space-y-2">
                  {PUBLIC_AREAS.map(area => {
                    const assignedStaffId = publicAreaAssignments.get(area.key);
                    return (
                      <div key={area.key} className="flex items-center gap-3 p-3 border rounded-lg">
                        <span className="text-lg">{area.icon}</span>
                        <span className="text-sm font-medium flex-1 min-w-0">{area.name}</span>
                        <Select
                          value={assignedStaffId || ''}
                          onValueChange={(val) => {
                            const newMap = new Map(publicAreaAssignments);
                            if (val === 'none') {
                              newMap.delete(area.key);
                            } else {
                              newMap.set(area.key, val);
                            }
                            setPublicAreaAssignments(newMap);
                          }}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder={t('autoAssign.notAssigned')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('autoAssign.notAssigned')}</SelectItem>
                            {allStaff.filter(s => selectedStaffIds.has(s.id)).map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                {publicAreaAssignments.size > 0 && (
                  <div className="p-3 bg-primary/5 rounded-lg text-sm">
                    <p className="font-medium">{publicAreaAssignments.size} {t('autoAssign.areasWillBeAssigned')}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter className="flex-shrink-0 gap-2">
            {step === 'select-staff' && (
              <>
                {restoredFromSave && (
                  <Button variant="ghost" size="sm" onClick={handleClearSaved} className="mr-auto text-muted-foreground">
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('autoAssign.clearSaved')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button 
                  onClick={handleGeneratePreview}
                  disabled={selectedStaffIds.size === 0 || effectiveRooms.length === 0}
                >
                  {t('autoAssign.generatePreview')}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
            
            {step === 'preview' && (
              <>
                {restoredFromSave && (
                  <Button variant="ghost" size="sm" onClick={handleClearSaved} className="mr-auto text-muted-foreground">
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('autoAssign.clearSaved')}
                  </Button>
                )}
                {previewHistory.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleUndo} className="text-muted-foreground">
                    <Undo2 className="h-3.5 w-3.5 mr-1" />
                    {t('autoAssign.undo')} ({previewHistory.length})
                  </Button>
                )}
                <Button variant="outline" onClick={() => setStep('select-staff')}>
                  {t('autoAssign.back')}
                </Button>
                <Button 
                  variant="outline"
                  onClick={handleGeneratePreview}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('autoAssign.regenerate')}
                </Button>
                <Button onClick={handleProceedToConfirm}>
                  {t('autoAssign.proceedToConfirm')}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </>
            )}
            
            {step === 'confirm' && (
              <>
                <Button variant="outline" onClick={() => setStep('preview')}>
                  {t('autoAssign.back')}
                </Button>
                <Button variant="outline" onClick={handlePrintAssignments}>
                  <Printer className="h-4 w-4 mr-2" />
                  {t('autoAssign.print')}
                </Button>
                <Button 
                  onClick={handleConfirmAssignment}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('autoAssign.assigning')}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      {t('autoAssign.confirmAndAssign')}
                    </>
                  )}
                </Button>
              </>
            )}

            {step === 'public-areas' && (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t('autoAssign.skipAndClose')}
                </Button>
                <Button
                  onClick={handleAssignPublicAreas}
                  disabled={submitting || publicAreaAssignments.size === 0}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('autoAssign.assigning')}
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4 mr-2" />
                      {t('autoAssign.assignAreas')} ({publicAreaAssignments.size})
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
              {t('autoAssign.shiftExceeded')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>{t('autoAssign.shiftExceededDesc')}</p>
              <div className="space-y-2 mt-2">
                {overAllocatedStaff.map(staff => (
                  <div key={staff.staffId} className="flex justify-between items-center p-2 bg-destructive/10 rounded">
                    <span className="font-medium">{staff.staffName}</span>
                    <span className="text-destructive font-semibold">
                      {formatMinutesToTime(staff.totalWithBreak)} 
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-sm">{t('autoAssign.continueAnyway')}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('autoAssign.goBackAndAdjust')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowOverAllocationDialog(false); setStep('confirm'); }}>
              {t('autoAssign.proceedAnyway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
