import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Calendar } from 'lucide-react';
import { CheckCircle2, AlertTriangle, Wrench, XCircle } from 'lucide-react';

interface Room {
  id: string;
  room_number: string;
  room_name?: string;
  hotel: string;
  status: string;
  last_cleaned_at?: string;
  last_cleaned_by?: {
    full_name: string;
  } | string;
  recent_tickets?: any[];
  minibar_usage?: any[];
}

interface SimpleRoomCardProps {
  room: Room;
  onClick?: () => void;
}

export function SimpleRoomCard({ room, onClick }: SimpleRoomCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clean': return 'bg-green-100 text-green-800';
      case 'dirty': return 'bg-orange-100 text-orange-800';
      case 'maintenance': return 'bg-blue-100 text-blue-800';
      case 'out_of_order': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
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

  return (
    <Card 
      className="hover:shadow-md transition-shadow cursor-pointer" 
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{room.room_number}</span>
            {room.room_name && (
              <span className="text-sm text-muted-foreground">- {room.room_name}</span>
            )}
          </div>
          <Badge className={getStatusColor(room.status)}>
            <div className="flex items-center gap-1">
              {getStatusIcon(room.status)}
              <span className="capitalize">{room.status.replace('_', ' ')}</span>
            </div>
          </Badge>
        </div>
        
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <MapPin className="h-4 w-4" />
          <span>{room.hotel}</span>
        </div>
        
        {room.last_cleaned_at && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>Cleaned {new Date(room.last_cleaned_at).toLocaleDateString()}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}