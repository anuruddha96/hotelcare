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
        group cursor-pointer transition-all duration-300 
        hover:shadow-xl hover:scale-[1.02] active:scale-95
        ${statusConfig.bg} ${statusConfig.border} border-2
        ${hasActiveIssues ? 'ring-2 ring-red-300 shadow-lg' : 'hover:shadow-lg'}
      `}
      onClick={onClick}
    >
      <CardContent className="p-5">
        {/* Header Section */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`
              w-10 h-10 rounded-lg flex items-center justify-center
              ${statusConfig.badge.includes('emerald') ? 'bg-emerald-500/10' : ''}
              ${statusConfig.badge.includes('orange') ? 'bg-orange-500/10' : ''}
              ${statusConfig.badge.includes('blue') ? 'bg-blue-500/10' : ''}
              ${statusConfig.badge.includes('red') ? 'bg-red-500/10' : ''}
              ${statusConfig.badge.includes('gray') ? 'bg-gray-500/10' : ''}
            `}>
              <StatusIcon className={`h-5 w-5 ${statusConfig.iconColor}`} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground">{room.room_number}</h3>
              {room.floor_number && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
                  Floor {room.floor_number}
                </span>
              )}
            </div>
          </div>
          
          <Badge className={`${statusConfig.badge} font-medium border`}>
            {room.status.replace('_', ' ').toUpperCase()}
          </Badge>
        </div>

        {/* Room Information */}
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-foreground truncate">{room.hotel}</span>
          </div>
          
          <div className="flex items-center gap-2 text-sm">
            <Coffee className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-muted-foreground">{getRoomTypeDisplay()}</span>
          </div>

          {room.bed_type && (
            <div className="text-sm text-muted-foreground">
              <span className="capitalize">{room.bed_type} bed</span>
            </div>
          )}
        </div>

        {/* Status Badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          {room.is_checkout_room && (
            <Badge variant="secondary" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              Checkout Room
            </Badge>
          )}
          
          {room.guest_count && room.guest_count > 0 && (
            <Badge variant="outline" className="text-xs">
              <Users className="h-3 w-3 mr-1" />
              {room.guest_count} guest{room.guest_count > 1 ? 's' : ''}
            </Badge>
          )}

          {room.recent_tickets?.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              <AlertCircle className="h-3 w-3 mr-1" />
              {room.recent_tickets.length} issue{room.recent_tickets.length > 1 ? 's' : ''}
            </Badge>
          )}

          {getMinibarValue() > 0 && (
            <Badge className="text-xs bg-yellow-100 text-yellow-800 border-yellow-300">
              €{getMinibarValue().toFixed(2)} minibar
            </Badge>
          )}
        </div>

        {/* Last Cleaned Info */}
        {room.last_cleaned_at && (
          <div className="pt-3 border-t border-border/50 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Last cleaned: {format(new Date(room.last_cleaned_at), 'MMM d, HH:mm')}</span>
            </div>
            {room.last_cleaned_by && typeof room.last_cleaned_by === 'object' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                <span className="truncate">by {room.last_cleaned_by.full_name}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}