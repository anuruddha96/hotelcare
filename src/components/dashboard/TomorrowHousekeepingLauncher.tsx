import React, { useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ArrowRight, CalendarClock, Clock3 } from 'lucide-react';
import { AutoRoomAssignment } from './AutoRoomAssignment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { todayBudapest } from '@/lib/budapestTime';
import { hasManagerPowers } from '@/lib/roleAccess';
import { housekeepingAutomationText } from '@/lib/housekeepingAutomationTranslations';

/**
 * Discoverable Team View entry point for the next-day housekeeping planner.
 *
 * The actual planning workflow remains owned by AutoRoomAssignment: passing
 * tomorrow as selectedDate routes to NextDayAssignmentPlanner. Keeping this
 * component as a launcher avoids a second planning implementation and ensures
 * the normal Auto Assign path and this shortcut always behave identically.
 */
export function TomorrowHousekeepingLauncher() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);

  const tomorrowDate = useMemo(() => {
    const today = todayBudapest();
    return format(addDays(new Date(`${today}T12:00:00`), 1), 'yyyy-MM-dd');
  }, []);

  if (!hasManagerPowers(profile?.role)) return null;

  const title = housekeepingAutomationText('title');
  const subtitle = housekeepingAutomationText('subtitle');
  const releaseLabel = housekeepingAutomationText('releaseAt');

  return (
    <>
      <Card
        className="overflow-hidden border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-background shadow-sm"
        data-training="tomorrow-housekeeping-plan"
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold leading-tight">{title}</h3>
                  <Badge variant="outline" className="gap-1 bg-background/70">
                    <Clock3 className="h-3 w-3" />
                    {releaseLabel}
                  </Badge>
                  <Badge variant="secondary">{tomorrowDate}</Badge>
                </div>
                <p className="max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => setOpen(true)}
              className="w-full shrink-0 gap-2 sm:w-auto"
              data-tour="prepare-tomorrow-housekeeping"
            >
              <CalendarClock className="h-4 w-4" />
              <span className="max-w-[240px] truncate">{title}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {open && (
        <AutoRoomAssignment
          open={open}
          onOpenChange={setOpen}
          selectedDate={tomorrowDate}
          onAssignmentCreated={() => setOpen(false)}
        />
      )}
    </>
  );
}
