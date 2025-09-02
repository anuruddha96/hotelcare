import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  XCircle,
  Eye,
  User,
  Calendar,
  Ticket,
  Wine
} from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';
import { MobileOptimizedCard } from './MobileOptimizedCard';

interface Room {
  id: string;
  hotel: string;
  room_name?: string;
  room_number: string;
  room_type: string;
  status: string;
  last_cleaned_at?: string;
  last_cleaned_by?: string;
  floor_number?: number;
  recent_tickets: any[];
  minibar_usage: any[];
}

interface SimpleRoomCardProps {
  room: Room;
  onStatusChange: (roomId: string, newStatus: string) => void;
  onViewDetails: (room: Room) => void;
  loading: boolean;
}

export function SimpleRoomCard({ room, onStatusChange, onViewDetails, loading }: SimpleRoomCardProps) {
  const { t } = useTranslation();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clean': return 'bg-green-500 text-white';
      case 'dirty': return 'bg-red-500 text-white';
      case 'maintenance': return 'bg-yellow-500 text-white';
      case 'out_of_order': return 'bg-gray-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'clean': return <CheckCircle2 className="h-4 w-4" />;
      case 'dirty': return <AlertTriangle className="h-4 w-4" />;
      case 'maintenance': return <Clock className="h-4 w-4" />;
      case 'out_of_order': return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const activeUsage = room.minibar_usage?.filter(usage => usage.quantity_used > 0) || [];
  const recentTicketsCount = room.recent_tickets?.length || 0;

  return (
    <MobileOptimizedCard className="relative">
      <div className="p-4 space-y-3">
        {/* Room Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">
              {room.room_name || room.room_number}
            </h3>
            <p className="text-sm text-muted-foreground">
              {room.hotel} • Floor {room.floor_number || 'N/A'}
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {room.room_type} Room
            </p>
          </div>
          
          <Badge className={`${getStatusColor(room.status)} flex items-center gap-1`}>
            {getStatusIcon(room.status)}
            {room.status.charAt(0).toUpperCase() + room.status.slice(1).replace('_', ' ')}
          </Badge>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {recentTicketsCount > 0 && (
            <div className="flex items-center gap-1">
              <Ticket className="h-3 w-3" />
              <span>{recentTicketsCount} ticket{recentTicketsCount > 1 ? 's' : ''}</span>
            </div>
          )}
          
          {activeUsage.length > 0 && (
            <div className="flex items-center gap-1">
              <Wine className="h-3 w-3" />
              <span>{activeUsage.length} minibar item{activeUsage.length > 1 ? 's' : ''}</span>
            </div>
          )}
          
          {room.last_cleaned_at && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>Cleaned {format(new Date(room.last_cleaned_at), 'MMM dd')}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewDetails(room)}
            className="flex items-center gap-1 flex-1 min-w-[100px]"
          >
            <Eye className="h-3 w-3" />
            Details
          </Button>
          
          {room.status !== 'clean' && (
            <Button
              size="sm"
              onClick={() => onStatusChange(room.id, 'clean')}
              disabled={loading}
              className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white flex-1 min-w-[100px]"
            >
              <CheckCircle2 className="h-3 w-3" />
              {t('rooms.clean')}
            </Button>
          )}
          
          {room.status !== 'dirty' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatusChange(room.id, 'dirty')}
              disabled={loading}
              className="flex items-center gap-1 border-red-200 text-red-600 hover:bg-red-50 flex-1 min-w-[100px]"
            >
              <AlertTriangle className="h-3 w-3" />
              {t('rooms.dirty')}
            </Button>
          )}
        </div>
      </div>
    </MobileOptimizedCard>
  );
}