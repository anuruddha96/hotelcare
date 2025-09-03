import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Wrench, 
  XCircle,
  MapPin,
  Bed,
  Clock,
  User,
  Droplet,
  UserCheck,
  UserX,
  Brush
} from 'lucide-react';
import { MobileOptimizedCard } from './MobileOptimizedCard';
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
  last_checkout_at?: string;
  last_checkout_by?: {
    full_name: string;
  };
  last_checkin_at?: string;
  last_checkin_by?: {
    full_name: string;
  };
  status_changed_by?: {
    full_name: string;
  };
  status_changed_at?: string;
  notes?: string;
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

interface EnhancedRoomCardV2Props {
  room: Room;
  onClick?: () => void;
}

export function EnhancedRoomCardV2({ room, onClick }: EnhancedRoomCardV2Props) {
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

  const getBedTypeDisplay = (type?: string) => {
    if (!type) return '';
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

  const needsAttention = room.status === 'out_of_order' || hasActiveIssues;

  return (
    <MobileOptimizedCard 
      className={`cursor-pointer transition-all duration-300 hover:shadow-lg ${
        needsAttention ? 'ring-2 ring-destructive/20 shadow-destructive/10' : ''
      }`}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header Section */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-foreground">{room.room_number}</h3>
              <Badge 
                variant="outline" 
                className={`text-xs px-2 py-0.5 ${getStatusColor(room.status)}`}
              >
                {getStatusIcon(room.status)}
                <span className="ml-1 capitalize">{room.status.replace('_', ' ')}</span>
              </Badge>
            </div>
            {room.room_name && (
              <p className="text-sm text-muted-foreground font-medium">{room.room_name}</p>
            )}
          </div>
          
          {/* Priority Indicators */}
          <div className="flex flex-col items-end gap-1">
            {needsAttention && (
              <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
            )}
            {room.floor_number && (
              <div className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                Floor {room.floor_number}
              </div>
            )}
          </div>
        </div>

        {/* Room Details */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Bed className="h-3 w-3" />
            <span>{getRoomTypeDisplay(room.room_type)}</span>
          </div>
          {room.bed_type && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-xs">🛏️</span>
              <span>{getBedTypeDisplay(room.bed_type)}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
            <MapPin className="h-3 w-3" />
            <span className="truncate">{room.hotel}</span>
          </div>
        </div>

        <Separator className="my-2" />

        {/* Status Information */}
        <div className="space-y-2">
          {/* Last Cleaned Info */}
          {room.last_cleaned_at && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Brush className="h-3 w-3" />
                <span>Cleaned</span>
              </div>
              <div className="text-right">
                <div className="font-medium">{format(new Date(room.last_cleaned_at), 'MMM d, HH:mm')}</div>
                {room.last_cleaned_by && (
                  <div className="text-muted-foreground">{room.last_cleaned_by.full_name}</div>
                )}
              </div>
            </div>
          )}

          {/* Last Check-out Info */}
          {room.last_checkout_at && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <UserX className="h-3 w-3" />
                <span>Check-out</span>
              </div>
              <div className="text-right">
                <div className="font-medium">{format(new Date(room.last_checkout_at), 'MMM d, HH:mm')}</div>
                {room.last_checkout_by && (
                  <div className="text-muted-foreground">{room.last_checkout_by.full_name}</div>
                )}
              </div>
            </div>
          )}

          {/* Last Check-in Info */}
          {room.last_checkin_at && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <UserCheck className="h-3 w-3" />
                <span>Check-in</span>
              </div>
              <div className="text-right">
                <div className="font-medium">{format(new Date(room.last_checkin_at), 'MMM d, HH:mm')}</div>
                {room.last_checkin_by && (
                  <div className="text-muted-foreground">{room.last_checkin_by.full_name}</div>
                )}
              </div>
            </div>
          )}

          {/* Status Changed Info */}
          {room.status_changed_at && room.status_changed_by && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Status changed</span>
              </div>
              <div className="text-right">
                <div className="font-medium">{format(new Date(room.status_changed_at), 'MMM d, HH:mm')}</div>
                <div className="text-muted-foreground">{room.status_changed_by.full_name}</div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Section - Badges and Issues */}
        <div className="flex flex-wrap gap-1.5 pt-2">
          {/* Active Issues Badge */}
          {hasActiveIssues && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {room.recent_tickets?.filter(t => t.status === 'open' || t.status === 'in_progress').length} Active Issues
            </Badge>
          )}

          {/* Minibar Badge */}
          {room.minibar_usage && room.minibar_usage.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              <Droplet className="h-3 w-3 mr-1" />
              €{getMinibarValue().toFixed(2)}
            </Badge>
          )}

          {/* Recent Activity Badge */}
          {room.recent_tickets && room.recent_tickets.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {room.recent_tickets.length} Recent {room.recent_tickets.length === 1 ? 'Ticket' : 'Tickets'}
            </Badge>
          )}
        </div>

        {/* Notes Preview */}
        {room.notes && (
          <div className="mt-2 p-2 bg-muted/30 rounded text-xs">
            <p className="text-muted-foreground line-clamp-2">{room.notes}</p>
          </div>
        )}
      </CardContent>
    </MobileOptimizedCard>
  );
}