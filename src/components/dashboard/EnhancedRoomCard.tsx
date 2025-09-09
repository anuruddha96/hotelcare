import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Calendar, 
  User, 
  CheckCircle2, 
  AlertTriangle, 
  Wrench, 
  XCircle,
  Clock,
  Users,
  AlertCircle,
  Euro,
  Bed,
  Building2
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

interface EnhancedRoomCardProps {
  room: Room;
  onClick?: () => void;
}

export function EnhancedRoomCard({ room, onClick }: EnhancedRoomCardProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'clean':
        return {
          bg: 'bg-gradient-to-br from-emerald-50/80 to-emerald-100/40',
          border: 'border-emerald-200/60',
          badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
          icon: CheckCircle2,
          iconColor: 'text-emerald-600',
          statusText: 'Clean'
        };
      case 'dirty':
        return {
          bg: 'bg-gradient-to-br from-orange-50/80 to-orange-100/40',
          border: 'border-orange-200/60',
          badge: 'bg-orange-500/10 text-orange-700 border-orange-200',
          icon: AlertTriangle,
          iconColor: 'text-orange-600',
          statusText: 'Needs Cleaning'
        };
      case 'maintenance':
        return {
          bg: 'bg-gradient-to-br from-blue-50/80 to-blue-100/40',
          border: 'border-blue-200/60',
          badge: 'bg-blue-500/10 text-blue-700 border-blue-200',
          icon: Wrench,
          iconColor: 'text-blue-600',
          statusText: 'Maintenance'
        };
      case 'out_of_order':
        return {
          bg: 'bg-gradient-to-br from-red-50/80 to-red-100/40',
          border: 'border-red-200/60',
          badge: 'bg-red-500/10 text-red-700 border-red-200',
          icon: XCircle,
          iconColor: 'text-red-600',
          statusText: 'Out of Order'
        };
      default:
        return {
          bg: 'bg-gradient-to-br from-slate-50/80 to-slate-100/40',
          border: 'border-slate-200/60',
          badge: 'bg-slate-500/10 text-slate-700 border-slate-200',
          icon: CheckCircle2,
          iconColor: 'text-slate-600',
          statusText: 'Available'
        };
    }
  };

  const statusConfig = getStatusConfig(room.status);
  const StatusIcon = statusConfig.icon;

  const getRoomTypeDisplay = () => {
    if (room.is_checkout_room && room.checkout_time) {
      return `Checkout at ${format(new Date(room.checkout_time), 'HH:mm')}`;
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

  const openTicketsCount = room.recent_tickets?.filter(ticket => 
    ['open', 'in_progress'].includes(ticket.status)
  ).length || 0;

  return (
    <Card 
      className={`
        group cursor-pointer transition-all duration-300 ease-out
        hover:shadow-lg hover:shadow-black/5 hover:-translate-y-1
        active:scale-[0.98] active:shadow-sm
        ${statusConfig.bg} ${statusConfig.border} border-2
        ${hasActiveIssues ? 'ring-2 ring-red-200 ring-offset-1' : ''}
        animate-fade-in relative overflow-hidden
        aspect-square flex flex-col
      `}
      onClick={onClick}
    >
      {/* Status Indicator Strip */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${statusConfig.iconColor.replace('text-', 'bg-')}`} />
      
      <CardContent className="p-3 flex flex-col h-full justify-between">
        {/* Header - Room Number & Status */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className={`
              w-6 h-6 rounded-md flex items-center justify-center
              ${statusConfig.badge.split(' ')[0]} backdrop-blur-sm
            `}>
              <StatusIcon className={`h-3 w-3 ${statusConfig.iconColor}`} />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground leading-none">
                {room.room_number}
              </h3>
              {room.floor_number && (
                <span className="text-xs text-muted-foreground">Floor {room.floor_number}</span>
              )}
            </div>
          </div>
          <Badge className={`${statusConfig.badge} text-xs font-medium border px-1.5 py-0.5 leading-none`}>
            {statusConfig.statusText}
          </Badge>
        </div>

        {/* Room Type & Bed Type */}
        <div className="space-y-1 mb-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {room.is_checkout_room ? 'Checkout Room' : 'Daily Room'}
              </span>
            </div>
            {room.bed_type && (
              <div className="flex items-center gap-1">
                <Bed className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground capitalize">{room.bed_type}</span>
              </div>
            )}
          </div>

          {/* Checkout time if applicable */}
          {room.is_checkout_room && room.checkout_time && (
            <div className="flex items-center gap-1 text-xs text-blue-600 font-medium">
              <Clock className="h-3 w-3" />
              <span>Checkout: {format(new Date(room.checkout_time), 'HH:mm')}</span>
            </div>
          )}
        </div>

        {/* Key Indicators Row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-1">
            {room.is_checkout_room && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 border-blue-200 leading-none">
                Checkout Room
              </Badge>
            )}
            {room.guest_count && room.guest_count > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span>{room.guest_count}</span>
              </div>
            )}
            {openTicketsCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-red-600">
                <AlertCircle className="h-3 w-3" />
                <span>{openTicketsCount}</span>
              </div>
            )}
          </div>
          {getMinibarValue() > 0 && (
            <div className="flex items-center gap-1 text-xs text-yellow-700">
              <Euro className="h-3 w-3" />
              <span>{getMinibarValue().toFixed(0)}</span>
            </div>
          )}
        </div>

        {/* Last Cleaned - Bottom */}
        {room.last_cleaned_at && (
          <div className="mt-auto pt-2 border-t border-border/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <span>{format(new Date(room.last_cleaned_at), 'MMM d, HH:mm')}</span>
              </div>
              {room.last_cleaned_by && typeof room.last_cleaned_by === 'object' && (
                <div className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span className="truncate max-w-12">{room.last_cleaned_by.full_name.split(' ')[0]}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}