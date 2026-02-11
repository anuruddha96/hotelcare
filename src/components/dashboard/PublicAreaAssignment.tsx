import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { MapPin, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/utils';

interface PublicAreaAssignmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: { id: string; full_name: string; nickname: string | null }[];
  hotelName: string;
  onAssigned: () => void;
}

const PUBLIC_AREAS = [
  { key: 'lobby_cleaning', name: 'Lobby', icon: '🏨', description: 'Main lobby and entrance area' },
  { key: 'reception_cleaning', name: 'Reception', icon: '🛎️', description: 'Reception desk and waiting area' },
  { key: 'back_office_cleaning', name: 'Back Office', icon: '🏢', description: 'Staff back office areas' },
  { key: 'kitchen_cleaning', name: 'Kitchen', icon: '🍳', description: 'Hotel kitchen and prep areas' },
  { key: 'guest_toilets_men', name: 'Guest Toilets (Men)', icon: '🚹', description: 'Men\'s guest restrooms' },
  { key: 'guest_toilets_women', name: 'Guest Toilets (Women)', icon: '🚺', description: 'Women\'s guest restrooms' },
  { key: 'common_areas_cleaning', name: 'Hotel Common Areas', icon: '🏠', description: 'Hallways and common spaces' },
  { key: 'stairways_cleaning', name: 'Stairways & Corridors', icon: '🚶', description: 'Stairways, corridors, and elevators' },
  { key: 'breakfast_room_cleaning', name: 'Breakfast Room', icon: '🍽️', description: 'Breakfast and dining room' },
  { key: 'dining_area_cleaning', name: 'Dining Area', icon: '🍴', description: 'Restaurant and dining spaces' },
];

export function PublicAreaAssignment({ open, onOpenChange, staff, hotelName, onAssigned }: PublicAreaAssignmentProps) {
  const { user, profile } = useAuth();
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);

  const toggleArea = (key: string) => {
    const newSet = new Set(selectedAreas);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setSelectedAreas(newSet);
  };

  const handleAssign = async () => {
    if (!selectedStaffId || selectedAreas.size === 0 || !user) return;

    setSubmitting(true);
    try {
      const today = getLocalDateString();
      const tasks = Array.from(selectedAreas).map(areaKey => {
        const area = PUBLIC_AREAS.find(a => a.key === areaKey)!;
        return {
          task_name: area.name,
          task_description: area.description + (notes ? `\n\nNotes: ${notes}` : ''),
          task_type: areaKey,
          assigned_to: selectedStaffId,
          assigned_by: user.id,
          assigned_date: today,
          hotel: hotelName,
          priority,
          status: 'assigned',
          organization_slug: profile?.organization_slug || 'rdhotels',
        };
      });

      const { error } = await supabase.from('general_tasks').insert(tasks);
      if (error) throw error;

      const staffName = staff.find(s => s.id === selectedStaffId)?.full_name || 'staff';
      toast.success(`Assigned ${selectedAreas.size} public area(s) to ${staffName}`);
      
      // Reset
      setSelectedStaffId('');
      setSelectedAreas(new Set());
      setNotes('');
      setPriority(1);
      onAssigned();
      onOpenChange(false);
    } catch (error) {
      console.error('Error assigning public areas:', error);
      toast.error('Failed to assign public areas');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Assign Public Areas
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-1">
          <div className="space-y-4">
            {/* Select Housekeeper */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Housekeeper</label>
              <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a housekeeper..." />
                </SelectTrigger>
                <SelectContent>
                  {staff.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name} {s.nickname ? `(${s.nickname})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Select Areas */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Areas ({selectedAreas.size} selected)</label>
              <div className="grid grid-cols-1 gap-2">
                {PUBLIC_AREAS.map(area => {
                  const isSelected = selectedAreas.has(area.key);
                  return (
                    <div
                      key={area.key}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                      }`}
                      onClick={() => toggleArea(area.key)}
                    >
                      <Checkbox checked={isSelected} />
                      <span className="text-lg">{area.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{area.name}</p>
                        <p className="text-xs text-muted-foreground">{area.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Normal</SelectItem>
                  <SelectItem value="2">High</SelectItem>
                  <SelectItem value="3">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any special instructions..."
                rows={2}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Cancel</Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedStaffId || selectedAreas.size === 0 || submitting}
            className="w-full sm:w-auto"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Assigning...</>
            ) : (
              <><Check className="h-4 w-4 mr-2" />Assign {selectedAreas.size} Area(s)</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
