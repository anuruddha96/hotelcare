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
      
      <CardContent className="p-4 flex flex-col h-full justify-between">
        {/* Header - Room Number & Floor */}
        <div className="text-center mb-3">
          <h3 className="text-xl font-bold text-foreground mb-1">
            {room.room_number}
          </h3>
          {room.floor_number !== undefined && room.floor_number !== null && (
            <span className="text-sm text-muted-foreground">FL - {room.floor_number}</span>
          )}
        </div>

        {/* Status Badge - Center */}
        <div className="flex justify-center mb-3">
          <Badge className={`${statusConfig.badge} text-sm font-medium border px-3 py-1`}>
            <StatusIcon className={`h-4 w-4 mr-1.5 ${statusConfig.iconColor}`} />
            {statusConfig.statusText}
          </Badge>
        </div>

        {/* Room Type - Simple */}
        <div className="text-center mb-3">
          <span className="text-sm text-muted-foreground">
            {room.is_checkout_room ? 'Checkout' : 'Daily'}
          </span>
          {room.is_checkout_room && room.checkout_time && (
            <div className="text-xs text-blue-600 mt-1">
              {format(new Date(room.checkout_time), 'HH:mm')}
            </div>
          )}
        </div>

        {/* Bottom indicators */}
        <div className="mt-auto space-y-2">
          {openTicketsCount > 0 && (
            <div className="flex items-center justify-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3 w-3" />
              <span>{openTicketsCount} issues</span>
            </div>
          )}
          
          {getMinibarValue() > 0 && (
            <div className="flex items-center justify-center gap-1 text-xs text-yellow-700">
              <Euro className="h-3 w-3" />
              <span>€{getMinibarValue().toFixed(0)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}