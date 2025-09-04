import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, Wrench, XCircle, MapPin, UserX, User } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { MobileOptimizedCard } from './MobileOptimizedCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';

interface Room {
  id: string;
  hotel: string;
  room_number: string;
  room_name?: string;
  room_type: string;
  bed_type?: string;
  floor_number?: number;
  status: 'clean' | 'dirty' | 'out_of_order' | 'maintenance';
  last_cleaned_at?: string;
  last_cleaned_by?: {
    full_name: string;
  };
  checkout_time?: string;
  is_checkout_room?: boolean;
  minibar_usage?: Array<{
    id: string;
    quantity_used: number;
    minibar_item: {
      name: string;
      price: number;
    };
  }>;
  recent_tickets?: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    created_at: string;
  }>;
  created_at: string;
  updated_at: string;
}

interface CompactRoomCardProps {
  room: Room;
  onClick?: () => void;
}

export function CompactRoomCard({ room, onClick }: CompactRoomCardProps) {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  
  const getStatusColor = (status: string) => {
    const colors = {
      clean: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      dirty: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
      maintenance: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
      out_of_order: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
    };
    return colors[status as keyof typeof colors] || colors.clean;
  };

  const getStatusIcon = (status: string) => {
    const icons = {
      clean: <CheckCircle2 className="h-3 w-3" />,
      dirty: <AlertTriangle className="h-3 w-3" />,
      maintenance: <Wrench className="h-3 w-3" />,
      out_of_order: <XCircle className="h-3 w-3" />
    };
    return icons[status as keyof typeof icons] || icons.clean;
  };

  const getRoomTypeDisplay = (type: string) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getMinibarValue = () => {
    if (!room.minibar_usage?.length) return 0;
    return room.minibar_usage.reduce((total, item) => 
      total + (item.quantity_used * item.minibar_item.price), 0
    );
  };

  const hasActiveIssues = room.recent_tickets?.some(ticket => 
    ticket.status === 'open' || ticket.status === 'in_progress'
  );

  const minibarTotal = getMinibarValue();

  return (
    <MobileOptimizedCard 
      className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
        hasActiveIssues ? 'ring-1 ring-destructive/30' : ''
      } ${isMobile ? 'p-2' : ''}`}
      onClick={onClick}
    >
      <CardContent className={`${isMobile ? 'p-3 space-y-2' : 'p-4 space-y-3'}`}>
        {/* Header - Room Number and Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className={`font-bold text-foreground ${isMobile ? 'text-base' : 'text-lg'}`}>
              {room.room_number}
            </h3>
            {room.floor_number && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                F{room.floor_number}
              </span>
            )}
          </div>
          <Badge 
            variant="outline" 
            className={`text-xs px-1.5 py-0.5 ${getStatusColor(room.status)}`}
          >
            {getStatusIcon(room.status)}
            <span className="ml-1 capitalize">{room.status.replace('_', ' ')}</span>
          </Badge>
        </div>

        {/* Room Details */}
        {isMobile ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{getRoomTypeDisplay(room.room_type)}</span>
              {room.bed_type && (
                <span className="text-muted-foreground">
                  {room.bed_type.charAt(0).toUpperCase() + room.bed_type.slice(1)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{room.hotel}</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span>{getRoomTypeDisplay(room.room_type)}</span>
            </div>
            {room.bed_type && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span>{room.bed_type.charAt(0).toUpperCase() + room.bed_type.slice(1)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{room.hotel}</span>
            </div>
          </div>
        )}

        {/* Bottom Indicators */}
        <div className="flex flex-wrap gap-1">
          {/* Room Type Indicator */}
          {room.is_checkout_room ? (
            <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
              <UserX className="h-2.5 w-2.5 mr-1" />
              {t('rooms.checkoutRoom')}
              {room.checkout_time && (
                <span className="ml-1">
                  {format(new Date(room.checkout_time), 'MMM d, HH:mm')}
                </span>
              )}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5">
              <User className="h-2.5 w-2.5 mr-1" />
              {t('rooms.dailyCleaningRoom')}
            </Badge>
          )}

          {hasActiveIssues && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0.5">
              <AlertTriangle className="h-2.5 w-2.5 mr-1" />
              {room.recent_tickets?.filter(t => t.status === 'open' || t.status === 'in_progress').length}
            </Badge>
          )}
          
          {minibarTotal > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
              €{minibarTotal.toFixed(2)}
            </Badge>
          )}
          
          {room.recent_tickets && room.recent_tickets.length > 0 && (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5">
              {room.recent_tickets.length}
            </Badge>
          )}
        </div>
      </CardContent>
    </MobileOptimizedCard>
  );
}