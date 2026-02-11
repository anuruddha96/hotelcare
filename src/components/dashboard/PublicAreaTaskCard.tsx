import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Play, CheckCircle, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
};

interface PublicAreaTaskCardProps {
  task: PublicAreaTask;
  onStatusUpdate?: (taskId: string, status: string) => void;
  readOnly?: boolean;
}

export function PublicAreaTaskCard({ task, onStatusUpdate, readOnly = false }: PublicAreaTaskCardProps) {
  const [loading, setLoading] = useState(false);
  const icon = AREA_ICONS[task.task_type] || '📍';

  const handleStart = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('general_tasks')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', task.id);

      if (error) throw error;
      toast.success(`Started: ${task.task_name}`);
      onStatusUpdate?.(task.id, 'in_progress');
    } catch (error) {
      console.error('Error starting task:', error);
      toast.error('Failed to start task');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('general_tasks')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', task.id);

      if (error) throw error;
      toast.success(`Completed: ${task.task_name}`);
      onStatusUpdate?.(task.id, 'completed');
    } catch (error) {
      console.error('Error completing task:', error);
      toast.error('Failed to complete task');
    } finally {
      setLoading(false);
    }
  };

  const priorityLabel = task.priority >= 3 ? 'Urgent' : task.priority >= 2 ? 'High' : 'Normal';
  const priorityColor = task.priority >= 3 ? 'bg-red-100 text-red-700 border-red-200' 
    : task.priority >= 2 ? 'bg-amber-100 text-amber-700 border-amber-200' 
    : 'bg-muted text-muted-foreground';

  const statusColor = task.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300'
    : task.status === 'in_progress' ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300'
    : 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300';

  return (
    <Card className={`overflow-hidden ${task.status === 'completed' ? 'opacity-70' : ''}`}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{icon}</span>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold truncate">{task.task_name}</h4>
              <Badge variant="outline" className={`text-[10px] shrink-0 ${statusColor}`}>
                {task.status === 'completed' ? 'Done' : task.status === 'in_progress' ? 'In Progress' : 'Assigned'}
              </Badge>
            </div>

            {task.task_description && (
              <p className="text-xs text-muted-foreground line-clamp-2">{task.task_description}</p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-[10px] ${priorityColor}`}>{priorityLabel}</Badge>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <MapPin className="h-3 w-3" />
                Public Area
              </div>
            </div>

            {/* Action buttons for housekeepers */}
            {!readOnly && task.status !== 'completed' && (
              <div className="flex gap-2 mt-2">
                {task.status === 'assigned' && (
                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleStart} disabled={loading}>
                    {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                    Start
                  </Button>
                )}
                {task.status === 'in_progress' && (
                  <Button size="sm" variant="default" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={handleComplete} disabled={loading}>
                    {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                    Complete
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
