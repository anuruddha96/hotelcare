import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface BulkRoom {
  room_number: string;
  room_type: string;
  bed_type: string;
  floor_number: string;
  room_name?: string;
}

interface BulkRoomCreationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotels: any[];
  onComplete: () => void;
}

export function BulkRoomCreation({ open, onOpenChange, hotels, onComplete }: BulkRoomCreationProps) {
  const [selectedHotel, setSelectedHotel] = useState('');
  const [rooms, setRooms] = useState<BulkRoom[]>([]);
  const [bulkInput, setBulkInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const roomTypes = [
    { value: 'economy', label: 'Economy' },
    { value: 'comfort', label: 'Comfort' },
    { value: 'standard', label: 'Standard' },
    { value: 'deluxe', label: 'Deluxe' },
    { value: 'suite', label: 'Suite' },
    { value: 'presidential', label: 'Presidential' }
  ];

  const bedTypes = [
    { value: 'single', label: 'Single' },
    { value: 'double', label: 'Double' },
    { value: 'queen', label: 'Queen' },
    { value: 'king', label: 'King' },
    { value: 'triple', label: 'Triple' },
    { value: 'quadruple', label: 'Quadruple' }
  ];

  const addSingleRoom = () => {
    setRooms([...rooms, {
      room_number: '',
      room_type: 'standard',
      bed_type: 'double',
      floor_number: '',
      room_name: ''
    }]);
  };

  const removeRoom = (index: number) => {
    setRooms(rooms.filter((_, i) => i !== index));
  };

  const updateRoom = (index: number, field: keyof BulkRoom, value: string) => {
    const updatedRooms = [...rooms];
    updatedRooms[index] = { ...updatedRooms[index], [field]: value };
    setRooms(updatedRooms);
  };

  const parseBulkInput = () => {
    const lines = bulkInput.trim().split('\n').filter(line => line.trim());
    const parsedRooms: BulkRoom[] = [];

    lines.forEach(line => {
      const parts = line.trim().split(',').map(part => part.trim());
      if (parts.length >= 3) {
        parsedRooms.push({
          room_number: parts[0] || '',
          room_type: parts[1]?.toLowerCase() || 'standard',
          bed_type: parts[2]?.toLowerCase() || 'double',
          floor_number: parts[3] || '',
          room_name: parts[4] || ''
        });
      }
    });

    setRooms([...rooms, ...parsedRooms]);
    setBulkInput('');
  };

  const generateRoomName = (room: BulkRoom) => {
    const paddedNumber = room.room_number.padStart(3, '0');
    const typeCapitalized = room.room_type.charAt(0).toUpperCase() + room.room_type.slice(1);
    const bedCapitalized = room.bed_type.charAt(0).toUpperCase() + room.bed_type.slice(1);
    return `${paddedNumber}-${typeCapitalized}-${bedCapitalized}`;
  };

  const handleSubmit = async () => {
    if (!selectedHotel || rooms.length === 0) {
      toast({
        title: 'Error',
        description: 'Please select a hotel and add at least one room',
        variant: 'destructive',
      });
      return;
    }

    const validRooms = rooms.filter(room => room.room_number.trim());
    if (validRooms.length === 0) {
      toast({
        title: 'Error',
        description: 'Please ensure all rooms have valid room numbers',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const roomData = validRooms.map(room => ({
        hotel: selectedHotel,
        room_number: room.room_number,
        room_name: room.room_name || generateRoomName(room),
        room_type: room.room_type,
        bed_type: room.bed_type,
        floor_number: room.floor_number ? parseInt(room.floor_number) : null,
        status: 'clean'
      }));

      const { error } = await supabase
        .from('rooms')
        .insert(roomData);

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Successfully created ${roomData.length} rooms`,
      });

      setRooms([]);
      setSelectedHotel('');
      onOpenChange(false);
      onComplete();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Room Creation</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Hotel Selection */}
          <div>
            <Label>Select Hotel</Label>
            <Select value={selectedHotel} onValueChange={setSelectedHotel}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a hotel" />
              </SelectTrigger>
              <SelectContent>
                {hotels.map((hotel) => (
                  <SelectItem key={hotel.id} value={hotel.name}>
                    {hotel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bulk Input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Bulk Input</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Paste room data (CSV format)</Label>
                <Textarea
                  placeholder="101, deluxe, queen, 1, Executive Suite
102, standard, double, 1
103, economy, single, 1"
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Format: Room Number, Room Type, Bed Type, Floor (optional), Room Name (optional)
                </p>
              </div>
              <Button onClick={parseBulkInput} disabled={!bulkInput.trim()}>
                <Upload className="h-4 w-4 mr-2" />
                Parse & Add Rooms
              </Button>
            </CardContent>
          </Card>

          {/* Individual Room Creation */}
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Rooms to Create ({rooms.length})</h3>
            <Button onClick={addSingleRoom} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add Single Room
            </Button>
          </div>

          {/* Rooms List */}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {rooms.map((room, index) => (
              <Card key={index}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline">Room {index + 1}</Badge>
                    <div className="text-sm text-muted-foreground">
                      Preview: {generateRoomName(room)}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRoom(index)}
                      className="ml-auto"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div>
                      <Label className="text-xs">Room Number *</Label>
                      <Input
                        value={room.room_number}
                        onChange={(e) => updateRoom(index, 'room_number', e.target.value)}
                        placeholder="101"
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Room Type</Label>
                      <Select
                        value={room.room_type}
                        onValueChange={(value) => updateRoom(index, 'room_type', value)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roomTypes.map(type => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Bed Type</Label>
                      <Select
                        value={room.bed_type}
                        onValueChange={(value) => updateRoom(index, 'bed_type', value)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {bedTypes.map(bed => (
                            <SelectItem key={bed.value} value={bed.value}>
                              {bed.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Floor</Label>
                      <Input
                        value={room.floor_number}
                        onChange={(e) => updateRoom(index, 'floor_number', e.target.value)}
                        placeholder="1"
                        type="number"
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Custom Name</Label>
                      <Input
                        value={room.room_name || ''}
                        onChange={(e) => updateRoom(index, 'room_name', e.target.value)}
                        placeholder="Auto-generated"
                        className="h-8"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {rooms.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No rooms added yet. Use bulk input or add rooms individually.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={!selectedHotel || rooms.length === 0 || isSubmitting}
            >
              {isSubmitting ? 'Creating...' : `Create ${rooms.length} Rooms`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}