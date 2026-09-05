import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, CheckCircle, Loader2, Shirt, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { PublicAreaDirtyLinenDialog, PublicLinenArea } from './PublicAreaDirtyLinenDialog';
import {
  publicAreaTaskCopy,
  isExceptionalPublicAreaTask,
  formatElapsed,
} from '@/lib/publicAreaTasks';

interface PublicAreaTask {
  id: string;
  task_name: string;
  task_description: string | null;
  task_type: string;
  status: string;
  priority: number;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  hotel: string;
}

const AREA_ICONS: Record<string, string> = {
  lobby_cleaning: '🏨',
  reception_cleaning: '🛎️',
  back_office_cleaning: '🏢',
  kitchen_cleaning: '🍳',
  guest_toilets_men: '🚹',
  guest_toilets_women: '🚺',
  common_areas_cleaning: '🏠',
  stairways_cleaning: '🚶',
  breakfast_room_cleaning: '🍽️',
  dining_area_cleaning: '🍴',
  gym_cleaning: '🏋️',
  sauna_cleaning: '♨️',
  jacuzzi_cleaning: '🫧',
};

const LINEN_AREA_BY_TASK: Partial<Record<string, PublicLinenArea>> = {
  gym_cleaning: 'gym',
  sauna_cleaning: 'sauna',
  jacuzzi_cleaning: 'jacuzzi',
};

interface PublicAreaTaskCardProps {
  task: PublicAreaTask;
  onStatusUpdate?: (taskId: string, status: string) => void;
  readOnly?: boolean;
}

/**
 * Housekeeper execution card. Deliberately minimal: area name, one plain
 * instruction, a short section cue when needed, and one big action. The
 * manager-only "Mapped section:" wording and other configuration metadata stay
 * hidden from housekeepers.
 */
export function PublicAreaTaskCard({ task, onStatusUpdate, readOnly = false }: PublicAreaTaskCardProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [linenOpen, setLinenOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const icon = AREA_ICONS[task.task_type] || '🧹';
  const linenArea = LINEN_AREA_BY_TASK[task.task_type];
  const { title, instruction, location } = publicAreaTaskCopy(task, t);
  const isDone = task.status === 'completed';
  const isRunning = task.status === 'in_progress';

  useEffect(() => {
    if (!isRunning || !task.started_at) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isRunning, task.started_at]);

  // Both transitions are conditional on the current status, so a double tap or
  // a stale card can never re-open or re-close a task.
  const transition = async (
    from: string,
    patch: Record<string, unknown>,
    nextStatus: string,
    conflictMessage: string,
    failureMessage: string,
  ) => {
    if (inFlight.current || loading) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('general_tasks')
        .update(patch as any)
        .eq('id', task.id)
        .eq('status', from)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.info(conflictMessage);
        onStatusUpdate?.(task.id, nextStatus);
        return;
      }
      onStatusUpdate?.(task.id, nextStatus);
    } catch (error) {
      console.error('[PublicAreaTaskCard] transition failed:', error);
      toast.error(failureMessage);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  const handleStart = () => transition(
    'assigned',
    { status: 'in_progress', started_at: new Date().toISOString() },
    'in_progress',
    t('publicAreaTask.alreadyStarted'),
    t('publicAreaTask.startFailed'),
  );

  const handleFinish = () => transition(
    'in_progress',
    { status: 'completed', completed_at: new Date().toISOString() },
    'completed',
    t('publicAreaTask.alreadyFinished'),
    t('publicAreaTask.finishFailed'),
  );

  const elapsed = isRunning ? formatElapsed(task.started_at, now) : '';

  return (
    <>
      <Card className={isDone ? 'opacity-70' : ''}>
        <CardContent className="flex items-center gap-3 p-3">
          <span className="text-xl leading-none" aria-hidden>{icon}</span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="min-w-0 text-sm font-semibold">{title}</h4>
              {location && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {location}
                </span>
              )}
              {isExceptionalPublicAreaTask(task) && (
                <Badge variant="outline" className="shrink-0 border-red-300 bg-red-50 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                  {t('publicAreaTask.urgent')}
                </Badge>
              )}
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{instruction}</p>
            {isRunning && elapsed && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-300">
                <Clock className="h-3 w-3" />{elapsed}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            {readOnly || isDone ? (
              <Badge
                variant="outline"
                className={isDone
                  ? 'border-green-300 bg-green-50 text-[11px] text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                  : 'text-[11px]'}
              >
                {isDone ? t('publicAreaTask.done') : isRunning ? t('publicAreaTask.inProgress') : t('publicAreaTask.toDo')}
              </Badge>
            ) : isRunning ? (
              <Button size="sm" className="h-10 min-w-[104px] bg-green-600 text-sm hover:bg-green-700" onClick={handleFinish} disabled={loading}>
                {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />}
                {t('publicAreaTask.finish')}
              </Button>
            ) : (
              <Button size="sm" className="h-10 min-w-[104px] text-sm" onClick={handleStart} disabled={loading}>
                {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                {t('publicAreaTask.start')}
              </Button>
            )}

            {!readOnly && linenArea && !isDone && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setLinenOpen(true)}>
                <Shirt className="mr-1 h-3.5 w-3.5" />
                {t('publicAreaTask.linen')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {linenArea && (
        <PublicAreaDirtyLinenDialog
          open={linenOpen}
          onOpenChange={setLinenOpen}
          areaType={linenArea}
          hotel={task.hotel}
          taskId={task.id}
        />
      )}
    </>
  );
}
