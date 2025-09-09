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
  Coffee,
  AlertCircle
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

interface ModernRoomCardProps {
  room: Room;
  onClick?: () => void;
}

export function ModernRoomCard({ room, onClick }: ModernRoomCardProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'clean':
        return {
          bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50',
          border: 'border-emerald-200',
          badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
          icon: CheckCircle2,
          iconColor: 'text-emerald-600'
        };
      case 'dirty':
        return {
          bg: 'bg-gradient-to-br from-orange-50 to-orange-100/50',
          border: 'border-orange-200',
          badge: 'bg-orange-100 text-orange-800 border-orange-300',
          icon: AlertTriangle,
          iconColor: 'text-orange-600'
        };
      case 'maintenance':
        return {
          bg: 'bg-gradient-to-br from-blue-50 to-blue-100/50',
          border: 'border-blue-200',
          badge: 'bg-blue-100 text-blue-800 border-blue-300',
          icon: Wrench,
          iconColor: 'text-blue-600'
        };
      case 'out_of_order':
        return {
          bg: 'bg-gradient-to-br from-red-50 to-red-100/50',
          border: 'border-red-200',
          badge: 'bg-red-100 text-red-800 border-red-300',
          icon: XCircle,
          iconColor: 'text-red-600'
        };
      default:
        return {
          bg: 'bg-gradient-to-br from-gray-50 to-gray-100/50',
          border: 'border-gray-200',
          badge: 'bg-gray-100 text-gray-800 border-gray-300',
          icon: CheckCircle2,
          iconColor: 'text-gray-600'
        };
    }
  };

  const statusConfig = getStatusConfig(room.status);
  const StatusIcon = statusConfig.icon;

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
      className={`
        group cursor-pointer transition-all duration-200 
        hover:shadow-md hover:scale-[1.01] active:scale-95
        ${statusConfig.bg} ${statusConfig.border} border
        ${hasActiveIssues ? 'ring-1 ring-red-300' : ''}
      `}
      onClick={onClick}
    >
      <CardContent className="p-3">
        {/* Compact Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`
              w-8 h-8 rounded-md flex items-center justify-center
              ${statusConfig.badge.includes('emerald') ? 'bg-emerald-500/10' : ''}
              ${statusConfig.badge.includes('orange') ? 'bg-orange-500/10' : ''}
              ${statusConfig.badge.includes('blue') ? 'bg-blue-500/10' : ''}
              ${statusConfig.badge.includes('red') ? 'bg-red-500/10' : ''}
              ${statusConfig.badge.includes('gray') ? 'bg-gray-500/10' : ''}
            `}>
              <StatusIcon className={`h-4 w-4 ${statusConfig.iconColor}`} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">{room.room_number}</h3>
              {room.floor_number && (
                <span className="text-xs text-muted-foreground">Floor {room.floor_number}</span>
              )}
            </div>
          </div>
          <Badge className={`${statusConfig.badge} text-xs font-medium border`}>
            {room.status.replace('_', ' ').toUpperCase()}
          </Badge>
        </div>

        {/* Compact Info */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center gap-2 text-xs">
            <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="text-foreground truncate font-medium">{room.hotel}</span>
          </div>
          
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1">
              <Coffee className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">{getRoomTypeDisplay()}</span>
            </div>
            {room.bed_type && (
              <span className="text-muted-foreground capitalize">{room.bed_type}</span>
            )}
          </div>
        </div>

        {/* Compact Status Info */}
        <div className="space-y-2">
          {/* Key indicators in a single row */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex gap-1">
              {room.is_checkout_room && (
                <Badge variant="secondary" className="text-xs px-1 py-0">
                  <Clock className="h-2 w-2 mr-1" />
                  CO
                </Badge>
              )}
              {room.guest_count && room.guest_count > 0 && (
                <Badge variant="outline" className="text-xs px-1 py-0">
                  <Users className="h-2 w-2 mr-1" />
                  {room.guest_count}
                </Badge>
              )}
              {room.recent_tickets?.length > 0 && (
                <Badge variant="destructive" className="text-xs px-1 py-0">
                  <AlertCircle className="h-2 w-2 mr-1" />
                  {room.recent_tickets.length}
                </Badge>
              )}
            </div>
            {getMinibarValue() > 0 && (
              <Badge className="text-xs px-1 py-0 bg-yellow-100 text-yellow-800 border-yellow-300">
                €{getMinibarValue().toFixed(0)}
              </Badge>
            )}
          </div>

          {/* Last cleaned - compact */}
          {room.last_cleaned_at && (
            <div className="pt-2 border-t border-border/30">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-2 w-2" />
                  <span>{format(new Date(room.last_cleaned_at), 'MMM d, HH:mm')}</span>
                </div>
                {room.last_cleaned_by && typeof room.last_cleaned_by === 'object' && (
                  <div className="flex items-center gap-1">
                    <User className="h-2 w-2" />
                    <span className="truncate max-w-16">{room.last_cleaned_by.full_name.split(' ')[0]}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}