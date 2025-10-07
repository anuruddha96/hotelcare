import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, User, Camera, PlayCircle, AlertTriangle, Shirt } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { translateText, shouldTranslateContent } from '@/lib/translation-utils';
import { format } from 'date-fns';

interface MobileHousekeepingCardProps {
  assignment: any;
  onStart: () => void;
  onComplete: () => void;
  onTakePhoto: () => void;
  onOpenLinen: () => void;
}

export function MobileHousekeepingCard({ 
  assignment, 
  onStart, 
  onComplete, 
  onTakePhoto,
  onOpenLinen 
}: MobileHousekeepingCardProps) {
  const { t, language } = useTranslation();

  const getStatusBadge = () => {
    switch (assignment.status) {
      case 'assigned':
        return <Badge variant="secondary">{t('housekeeping.waiting')}</Badge>;
      case 'in_progress':
        return <Badge variant="default" className="bg-blue-600">{t('housekeeping.inProgress')}</Badge>;
      case 'completed':
        return <Badge variant="default" className="bg-green-600">{t('housekeeping.completed')}</Badge>;
      default:
        return <Badge variant="outline">{assignment.status}</Badge>;
    }
  };

  const getAssignmentTypeLabel = () => {
    switch (assignment.assignment_type) {
      case 'daily_cleaning':
        return t('housekeeping.assignmentType.dailyClean');
      case 'checkout_cleaning':
        return t('housekeeping.assignmentType.checkoutClean');
      case 'deep_cleaning':
        return t('housekeeping.assignmentType.deepClean');
      case 'maintenance':
        return t('housekeeping.assignmentType.maintenance');
      default:
        return assignment.assignment_type;
    }
  };

  // Check for towel and linen change requirements
  const towelChangeRequired = assignment.rooms?.towel_change_required;
  const linenChangeRequired = assignment.rooms?.linen_change_required;
  const guestNights = assignment.rooms?.guest_nights_stayed;

  return (
    <Card className="w-full max-w-sm mx-auto shadow-md hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <CardTitle className="text-xl font-bold">
            {t('common.room')} {assignment.rooms?.room_number || 'N/A'}
          </CardTitle>
          {getStatusBadge()}
        </div>
        <Badge variant="outline" className="w-fit">
          {getAssignmentTypeLabel()}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Hotel and Floor Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">{t('room.hotel')}</p>
              <p className="text-muted-foreground truncate">
                {assignment.rooms?.hotel || 'N/A'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <div className="h-4 w-4 flex items-center justify-center text-muted-foreground">
              🏠
            </div>
            <div className="text-sm">
              <p className="font-medium">{t('common.floor')}</p>
              <p className="text-muted-foreground">
                {t('common.floor')} {assignment.rooms?.floor_number || 'N/A'}
              </p>
            </div>
          </div>
        </div>

        {/* Room Name */}
        {assignment.rooms?.room_name && (
          <div className="p-2 bg-muted/30 rounded">
            <p className="text-sm font-medium">{t('roomCard.roomName')}</p>
            <p className="text-lg font-semibold">{assignment.rooms.room_name}</p>
          </div>
        )}

        {/* Estimated Time */}
        <div className="flex items-center gap-2 p-2 bg-blue-50 rounded">
          <Clock className="h-4 w-4 text-blue-600" />
          <div className="text-sm">
            <p className="font-medium text-blue-800">{t('roomCard.estimatedTime')}</p>
            <p className="text-lg font-bold text-blue-900">
              {assignment.estimated_duration} {t('common.minutes')}
            </p>
          </div>
        </div>

        {/* Strong Notifications for Towel/Linen Changes */}
        {(towelChangeRequired || linenChangeRequired) && (
          <div className="space-y-2">
            {towelChangeRequired && (
              <div className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xl">🏺</div>
                  <div className="font-bold text-lg">{t('roomCard.towelChangeRequired')}</div>
                </div>
                <p className="text-sm opacity-90">
                  {t('roomCard.guestStayed')} {guestNights} {t('roomCard.nights')}
                </p>
              </div>
            )}
            
            {linenChangeRequired && (
              <div className="p-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xl">🛏️</div>
                  <div className="font-bold text-lg">{t('roomCard.linenChangeRequired')}</div>
                </div>
                <p className="text-sm opacity-90">
                  {t('roomCard.guestStayed')} {guestNights} {t('roomCard.nights')} - {t('roomCard.changeLinenMessage')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Room Status Alert */}
        {assignment.rooms?.status && (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  {t('roomCard.roomStatusAlert')}
                </p>
                <p className="text-sm text-amber-700">
                  {t('common.status')}: {assignment.rooms.status}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          {assignment.status === 'assigned' && (
            <Button onClick={onStart} className="w-full h-12 text-lg">
              <PlayCircle className="h-5 w-5 mr-2" />
              {t('housekeeping.start')}
            </Button>
          )}

          {assignment.status === 'in_progress' && (
            <Button onClick={onComplete} className="w-full h-12 text-lg bg-green-600 hover:bg-green-700">
              <Camera className="h-5 w-5 mr-2" />
              {t('housekeeping.markComplete')}
            </Button>
          )}

          {/* Additional Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onTakePhoto} className="h-10">
              <Camera className="h-4 w-4 mr-1" />
              {t('roomCard.details')}
            </Button>
            <Button variant="outline" onClick={onOpenLinen} className="h-10 flex items-center justify-center">
              <Shirt className="h-4 w-4 mr-1" />
              <span className="truncate">{t('dirtyLinen.title')}</span>
            </Button>
          </div>
        </div>

        {/* Important Assignment Notes - Prominently Displayed */}
        {assignment.notes && (
          <div className="relative p-4 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 rounded-lg border-2 border-amber-300 mt-3 shadow-md">
            <div className="absolute -top-2 -left-2 bg-amber-400 text-white rounded-full p-1.5 shadow-md">
              <AlertTriangle className="h-3 w-3" />
            </div>
            <div className="ml-4">
              <p className="text-xs font-bold text-amber-900 mb-1">📝 {t('housekeeping.assignmentNotes')}</p>
              <p className="text-xs text-amber-800 font-semibold bg-white/60 p-2 rounded border border-amber-200">
                {shouldTranslateContent(language) 
                  ? translateText(assignment.notes, language)
                  : assignment.notes
                }
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}