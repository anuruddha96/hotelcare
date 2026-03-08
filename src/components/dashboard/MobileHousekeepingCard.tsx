import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoldButton } from '@/components/ui/hold-button';
import { Clock, MapPin, User, Camera, PlayCircle, AlertTriangle, Shirt, BedDouble, Info } from 'lucide-react';
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
        return <Badge variant="default" className="bg-primary text-primary-foreground">{t('housekeeping.inProgress')}</Badge>;
      case 'completed':
        return <Badge variant="default" className="bg-secondary text-secondary-foreground">{t('housekeeping.completed')}</Badge>;
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

  // Check for special instructions
  const towelChangeRequired = assignment.rooms?.towel_change_required;
  const linenChangeRequired = assignment.rooms?.linen_change_required;
  const bedConfiguration = assignment.rooms?.bed_configuration;
  const roomNotes = assignment.rooms?.notes;
  const assignmentNotes = assignment.notes;
  const guestNights = assignment.rooms?.guest_nights_stayed;

  const hasSpecialInstructions = towelChangeRequired || linenChangeRequired || bedConfiguration || roomNotes || assignmentNotes;
  const instructionCount = [towelChangeRequired, linenChangeRequired, bedConfiguration, roomNotes, assignmentNotes].filter(Boolean).length;

  const cardClassName = [
    "w-full max-w-sm mx-auto shadow-md hover:shadow-lg transition-shadow",
    hasSpecialInstructions && "border-l-4 border-l-amber-400"
  ].filter(Boolean).join(" ");

  return (
    <Card className={cardClassName}>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <CardTitle className="text-xl font-bold">
            {t('common.room')} {assignment.rooms?.room_number || 'N/A'}
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasSpecialInstructions && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0.5 animate-pulse">
                ⚠️ {instructionCount}
              </Badge>
            )}
            {getStatusBadge()}
          </div>
        </div>
        <Badge variant="outline" className="w-fit">
          {getAssignmentTypeLabel()}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* === SPECIAL INSTRUCTIONS — TOP OF CARD === */}
        {hasSpecialInstructions && (
          <div className="space-y-2 -mt-1">
            {towelChangeRequired && (
              <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border-2 border-yellow-400 dark:border-yellow-600 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🧺</span>
                  <div>
                    <p className="font-bold text-yellow-800 dark:text-yellow-200 text-sm">
                      {t('roomCard.towelChangeRequired') || 'Towel Change Required'}
                    </p>
                    {guestNights > 0 && (
                      <p className="text-xs text-yellow-700 dark:text-yellow-300">
                        {t('roomCard.guestStayed')} {guestNights} {t('roomCard.nights')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {linenChangeRequired && (
              <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border-2 border-purple-400 dark:border-purple-600 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🛏️</span>
                  <div>
                    <p className="font-bold text-purple-800 dark:text-purple-200 text-sm">
                      {t('roomCard.linenChangeRequired') || 'Linen Change Required'}
                    </p>
                    {guestNights > 0 && (
                      <p className="text-xs text-purple-700 dark:text-purple-300">
                        {t('roomCard.guestStayed')} {guestNights} {t('roomCard.nights')} - {t('roomCard.changeLinenMessage')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {bedConfiguration && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-400 dark:border-blue-600 rounded-lg">
                <div className="flex items-center gap-2">
                  <BedDouble className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                      {t('roomCard.bedConfiguration') || 'Bed Configuration'}
                    </p>
                    <p className="font-bold text-blue-800 dark:text-blue-200 text-sm">{bedConfiguration}</p>
                  </div>
                </div>
              </div>
            )}

            {roomNotes && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-600 rounded-lg">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                      {t('roomCard.managerNotes') || 'Manager Notes'}
                    </p>
                    <p className="text-sm text-amber-800 dark:text-amber-200 mt-0.5">
                      {shouldTranslateContent(language) ? translateText(roomNotes, language) : roomNotes}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {assignmentNotes && (
              <div className="p-3 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950/30 dark:via-yellow-950/30 dark:to-orange-950/30 border-2 border-amber-300 dark:border-amber-600 rounded-lg shadow-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide">
                      📝 {t('housekeeping.assignmentNotes')}
                    </p>
                    <p className="text-sm text-amber-800 dark:text-amber-200 font-semibold mt-0.5">
                      {shouldTranslateContent(language) ? translateText(assignmentNotes, language) : assignmentNotes}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

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
            <div className="relative pb-8">
              <HoldButton 
                onClick={onStart}
                onHoldComplete={onStart}
                holdDuration={2000}
                className="w-full h-12 text-lg"
                holdText={t('housekeeping.holdToStart')}
                releaseText={t('housekeeping.keepHolding')}
              >
                <PlayCircle className="h-5 w-5 mr-2" />
                {t('housekeeping.start')}
              </HoldButton>
            </div>
          )}

          {assignment.status === 'in_progress' && (
            <div className="relative pb-8">
              <HoldButton 
                onClick={onComplete}
                onHoldComplete={onComplete}
                holdDuration={2000}
                className="w-full h-12 text-lg bg-green-600 hover:bg-green-700"
                holdText={t('housekeeping.holdToComplete')}
                releaseText={t('housekeeping.keepHolding')}
              >
                <Camera className="h-5 w-5 mr-2" />
                {t('housekeeping.markComplete')}
              </HoldButton>
            </div>
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
      </CardContent>
    </Card>
  );
}
