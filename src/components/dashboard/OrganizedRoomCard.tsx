import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  MapPin, 
  Calendar, 
  User, 
  CheckCircle2, 
  AlertTriangle, 
  Wrench, 
  XCircle,
  Clock,
  Users,
  Coffee
} from 'lucide-react';
import { format } from 'date-fns';

interface Room {
  id: string;
  room_number: string;
  room_name?: string;
  hotel: string;
  room_type: string;
  bed_type?: string;
  floor_number?: number;
  status: string;
  last_cleaned_at?: string;
  last_cleaned_by?: {
    full_name: string;
  } | string;
  recent_tickets?: any[];
  minibar_usage?: any[];
  is_checkout_room?: boolean;
  checkout_time?: string;
  guest_count?: number;
  notes?: string;
}

interface OrganizedRoomCardProps {
  room: Room;
  onClick?: () => void;
}

export function OrganizedRoomCard({ room, onClick }: OrganizedRoomCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clean': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'dirty': return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'maintenance': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'out_of_order': return 'bg-red-50 text-red-700 border-red-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'clean': return <CheckCircle2 className="h-3 w-3" />;
      case 'dirty': return <AlertTriangle className="h-3 w-3" />;
      case 'maintenance': return <Wrench className="h-3 w-3" />;
      case 'out_of_order': return <XCircle className="h-3 w-3" />;
      default: return <CheckCircle2 className="h-3 w-3" />;
    }
  };

  const getRoomTypeDisplay = () => {
    if (room.is_checkout_room) {
      return room.checkout_time ? `Checkout ${format(new Date(room.checkout_time), 'HH:mm')}` : 'Checkout';
    }
    return room.room_type ? room.room_type.charAt(0).toUpperCase() + room.room_type.slice(1) : 'Standard';
  };

  const getMinibarValue = () => {
    if (!room.minibar_usage?.length) return 0;
    return room.minibar_usage.reduce((total, usage) => 
      total + (usage.quantity_used * usage.minibar_item.price), 0
    );
  };

  const hasActiveIssues = room.recent_tickets?.some(ticket => 
    ['open', 'in_progress'].includes(ticket.status)
  ) || room.status === 'out_of_order';

  return (
    <Card 
      className={`group cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02] ${
        hasActiveIssues ? 'ring-2 ring-red-200 bg-red-50/30' : 'hover:bg-muted/20'
      }`}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-foreground">{room.room_number}</span>
              {room.floor_number !== undefined && room.floor_number !== null && (
                <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                  F{room.floor_number}
                </span>
              )}
            </div>
            {room.room_name && (
              <p className="text-xs text-muted-foreground truncate max-w-20">{room.room_name}</p>
            )}
          </div>
        </div>

        {/* Status Badge - Now in its own section with proper spacing */}
        <div className="mb-3">
          <Badge className={`${getStatusColor(room.status)} text-xs border w-fit`}>
            <div className="flex items-center gap-1">
              {getStatusIcon(room.status)}
              <span className="capitalize">{room.status.replace('_', ' ')}</span>
            </div>
          </Badge>
        </div>

        {/* Room Details */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{room.hotel}</span>
          </div>
          
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Coffee className="h-3 w-3 flex-shrink-0" />
            <span>{getRoomTypeDisplay()}</span>
          </div>

          {room.bed_type && (
            <div className="text-muted-foreground">
              <span className="capitalize">{room.bed_type} bed</span>
            </div>
          )}
        </div>

        {/* Status Indicators */}
        <div className="flex flex-wrap gap-1">
          {room.is_checkout_room && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
              <Clock className="h-2.5 w-2.5 mr-1" />
              Checkout
            </Badge>
          )}
          
          {room.guest_count && room.guest_count > 0 && (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5">
              <Users className="h-2.5 w-2.5 mr-1" />
              {room.guest_count}
            </Badge>
          )}

          {room.recent_tickets?.length > 0 && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0.5">
              {room.recent_tickets.length} issue{room.recent_tickets.length > 1 ? 's' : ''}
            </Badge>
          )}

          {getMinibarValue() > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0.5 bg-yellow-50 text-yellow-700">
              €{getMinibarValue().toFixed(2)}
            </Badge>
          )}
        </div>

        {/* Cleaning Info */}
        {room.last_cleaned_at && (
          <div className="pt-2 border-t border-border/30 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{format(new Date(room.last_cleaned_at), 'MMM d, HH:mm')}</span>
            </div>
            {room.last_cleaned_by && typeof room.last_cleaned_by === 'object' && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                <span className="truncate">{room.last_cleaned_by.full_name}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}