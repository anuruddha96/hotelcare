import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, User, Bed } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface CheckoutRoom {
  roomNumber: string;
  roomType?: string;
  departureTime?: string;
  guestCount?: number;
  status: 'checkout' | 'daily_cleaning';
  notes?: string;
}

interface CheckoutRoomsViewProps {
  checkoutRooms: CheckoutRoom[];
  dailyCleaningRooms: CheckoutRoom[];
}

export function CheckoutRoomsView({ checkoutRooms, dailyCleaningRooms }: CheckoutRoomsViewProps) {
  const { t } = useTranslation();

  const RoomCard = ({ room }: { room: CheckoutRoom }) => (
    <div className="flex items-center justify-between p-3 bg-background border rounded-lg">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Bed className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{room.roomNumber}</span>
        </div>
        {room.roomType && (
          <Badge variant="outline" className="text-xs">
            {room.roomType}
          </Badge>
        )}
      </div>
      
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {room.guestCount && room.guestCount > 0 && (
          <div className="flex items-center gap-1">
            <User className="h-3 w-3" />
            <span>{room.guestCount}</span>
          </div>
        )}
        {room.departureTime && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{room.departureTime}</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Checkout Rooms */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="text-orange-700">{t('pms.checkoutToday')}</span>
            <Badge variant="destructive" className="ml-2">
              {checkoutRooms.length}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('pms.departureTime')} - Rooms requiring checkout cleaning
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {checkoutRooms.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bed className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No checkout rooms today</p>
            </div>
          ) : (
            checkoutRooms
              .sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber))
              .map((room) => (
                <RoomCard key={room.roomNumber} room={room} />
              ))
          )}
        </CardContent>
      </Card>

      {/* Daily Cleaning Rooms */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="text-blue-700">{t('pms.stayingGuests')}</span>
            <Badge variant="secondary" className="ml-2">
              {dailyCleaningRooms.length}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Occupied rooms requiring daily cleaning
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {dailyCleaningRooms.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bed className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No daily cleaning rooms</p>
            </div>
          ) : (
            dailyCleaningRooms
              .sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber))
              .map((room) => (
                <RoomCard key={room.roomNumber} room={room} />
              ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}