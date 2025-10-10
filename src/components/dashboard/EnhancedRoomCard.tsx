import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  MapPin, 
  Calendar, 
  User, 
  Clock,
  Bed,
  Wine,
  AlertCircle,
  CheckCircle2, 
  AlertTriangle, 
  Wrench, 
  XCircle,
  Ticket,
  Camera,
  Shirt
} from 'lucide-react';
import { format } from 'date-fns';

import { DirtyLinenDialog } from './DirtyLinenDialog';
import { ImageCaptureDialog } from './ImageCaptureDialog';
import { SimplifiedPhotoCapture } from './SimplifiedPhotoCapture';
import { DNDPhotoDialog } from './DNDPhotoDialog';

interface Room {
  id: string;
  room_number: string;
  room_name?: string;
  room_type: string;
  bed_type?: string;
  hotel: string;
  status: string;
  last_cleaned_at?: string;
  last_cleaned_by?: {
    full_name: string;
  } | string;
  recent_tickets?: any[];
  minibar_usage?: Array<{
    quantity_used: number;
    minibar_item: {
      name: string;
      price: number;
    };
  }>;
  floor_number?: number;
}

interface EnhancedRoomCardProps {
  room: Room;
  onClick?: () => void;
  assignmentId?: string;
  showActions?: boolean;
}

export function EnhancedRoomCard({ room, onClick, assignmentId, showActions = false }: EnhancedRoomCardProps) {
  const [dndDialogOpen, setDndDialogOpen] = useState(false);
  const [dailyPhotoDialogOpen, setDailyPhotoDialogOpen] = useState(false);
  const [dirtyLinenDialogOpen, setDirtyLinenDialogOpen] = useState(false);
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clean': return 'bg-green-100 text-green-800 border-green-200';
      case 'dirty': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'maintenance': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'out_of_order': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'clean': return <CheckCircle2 className="h-4 w-4" />;
      case 'dirty': return <AlertTriangle className="h-4 w-4" />;
      case 'maintenance': return <Wrench className="h-4 w-4" />;
      case 'out_of_order': return <XCircle className="h-4 w-4" />;
      default: return <CheckCircle2 className="h-4 w-4" />;
    }
  };

  const getBedTypeDisplay = (bedType?: string) => {
    if (!bedType) return '';
    return bedType.charAt(0).toUpperCase() + bedType.slice(1);
  };

  const getRoomTypeDisplay = (roomType: string) => {
    return roomType.charAt(0).toUpperCase() + roomType.slice(1);
  };

  const getFloorDisplay = (floorNumber?: number) => {
    if (floorNumber === undefined || floorNumber === null) return '';
    return `F${floorNumber}`;
  };

  const getMinibarValue = () => {
    if (!room.minibar_usage || room.minibar_usage.length === 0) return 0;
    return room.minibar_usage.reduce((total, usage) => 
      total + (usage.quantity_used * usage.minibar_item.price), 0
    );
  };

  const hasActiveTickets = room.recent_tickets && room.recent_tickets.some(
    ticket => ticket.status !== 'completed' && ticket.status !== 'closed'
  );

  const minibarValue = getMinibarValue();
  const lastCleanedBy = typeof room.last_cleaned_by === 'string' 
    ? room.last_cleaned_by 
    : room.last_cleaned_by?.full_name;

  return (
    <Card 
      className={`hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 ${
        room.status === 'clean' ? 'border-l-green-500' :
        room.status === 'dirty' ? 'border-l-orange-500' :
        room.status === 'maintenance' ? 'border-l-blue-500' :
        'border-l-red-500'
      }`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header with room number and floor */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-primary">{room.room_number}</span>
            {room.floor_number !== undefined && room.floor_number !== null && (
              <Badge variant="secondary" className="text-xs">
                {getFloorDisplay(room.floor_number)}
              </Badge>
            )}
          </div>
          <Badge className={getStatusColor(room.status)} variant="outline">
            <div className="flex items-center gap-1">
              {getStatusIcon(room.status)}
              <span className="capitalize text-xs">{room.status.replace('_', ' ')}</span>
            </div>
          </Badge>
        </div>

        {/* Room details */}
        <div className="space-y-2 mb-3">
          {room.room_name && (
            <div className="font-medium text-sm text-foreground truncate">{room.room_name}</div>
          )}
          
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Bed className="h-3 w-3" />
              <span>{getRoomTypeDisplay(room.room_type)}</span>
            </div>
            {room.bed_type && (
              <div className="flex items-center gap-1">
                <span>•</span>
                <span>{getBedTypeDisplay(room.bed_type)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex flex-wrap gap-2 mb-3">
          {hasActiveTickets && (
            <Badge variant="destructive" className="text-xs">
              <Ticket className="h-3 w-3 mr-1" />
              Active Issues ({room.recent_tickets?.filter(t => t.status !== 'completed').length})
            </Badge>
          )}
          
          {minibarValue > 0 && (
            <Badge variant="secondary" className="text-xs">
              <Wine className="h-3 w-3 mr-1" />
              Minibar: €{minibarValue.toFixed(2)}
            </Badge>
          )}
        </div>

        {/* Cleaning info */}
        {room.last_cleaned_at && (
          <div className="border-t pt-2 space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Cleaned {format(new Date(room.last_cleaned_at), 'MMM dd, HH:mm')}</span>
            </div>
            {lastCleanedBy && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                <span>by {lastCleanedBy}</span>
              </div>
            )}
          </div>
        )}

        {/* Action buttons for housekeepers when cleaning */}
        {showActions && assignmentId && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <div className="text-xs font-medium text-muted-foreground mb-2">Capture During Cleaning</div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDailyPhotoDialogOpen(true);
                }}
                className="flex flex-col items-center gap-1 h-auto py-2 text-xs"
              >
                <Camera className="h-4 w-4" />
                <span>Room Photos</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDndDialogOpen(true);
                }}
                className="flex flex-col items-center gap-1 h-auto py-2 text-xs border-orange-200 hover:bg-orange-50"
              >
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <span className="text-orange-600">DND Photo</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDirtyLinenDialogOpen(true);
                }}
                className="flex flex-col items-center gap-1 h-auto py-2 text-xs"
              >
                <Shirt className="h-4 w-4" />
                <span>Dirty Linen</span>
              </Button>
            </div>
          </div>
        )}

        {/* Urgent indicators */}
        {(room.status === 'out_of_order' || hasActiveTickets) && (
          <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span>Requires attention</span>
          </div>
        )}
      </CardContent>

      {/* Dialogs */}
      {assignmentId && (
        <>
          <SimplifiedPhotoCapture
            open={dailyPhotoDialogOpen}
            onOpenChange={setDailyPhotoDialogOpen}
            roomNumber={room.room_number}
            assignmentId={assignmentId}
            onPhotoCaptured={() => {
              // Refresh room data if needed
            }}
          />

          <DirtyLinenDialog
            open={dirtyLinenDialogOpen}
            onOpenChange={setDirtyLinenDialogOpen}
            roomId={room.id}
            roomNumber={room.room_number}
            assignmentId={assignmentId}
          />
        </>
      )}
    </Card>
  );
}