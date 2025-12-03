import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HelpCircle, BookOpen, Play, CheckCircle, Clock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useTrainingGuide } from '@/contexts/TrainingGuideContext';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState as useReactState } from 'react';

interface TrainingGuide {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  total_steps: number;
}

export function TrainingHelpButton() {
  const { 
    pendingAssignments, 
    startTraining, 
    getTranslatedUI,
    getTranslatedGuide,
  } = useTrainingGuide();
  
  const [allGuides, setAllGuides] = useReactState<TrainingGuide[]>([]);
  const ui = getTranslatedUI();

  useEffect(() => {
    const fetchGuides = async () => {
      const { data } = await supabase
        .from('training_guides')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      
      if (data) {
        setAllGuides(data);
      }
    };
    fetchGuides();
  }, []);

  const getGuideStatus = (guideId: string) => {
    const assignment = pendingAssignments.find(a => a.guide_id === guideId);
    if (!assignment) return 'available';
    return assignment.status;
  };

  const handleStartGuide = (guideId: string) => {
    startTraining(guideId);
  };

  const hasPendingTraining = pendingAssignments.some(
    a => a.status === 'assigned' || a.status === 'in_progress'
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          className="relative"
          data-training="help-button"
        >
          <HelpCircle className="h-5 w-5" />
          {hasPendingTraining && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary animate-pulse" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          {ui.helpButton}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {allGuides.map((guide) => {
          const status = getGuideStatus(guide.id);
          const translated = getTranslatedGuide(guide.slug);
          
          return (
            <DropdownMenuItem
              key={guide.id}
              onClick={() => handleStartGuide(guide.id)}
              className="flex items-start gap-3 p-3 cursor-pointer"
            >
              <div className="mt-0.5">
                {status === 'completed' ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : status === 'in_progress' ? (
                  <Clock className="h-4 w-4 text-yellow-500" />
                ) : (
                  <Play className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {translated.name}
                  </span>
                  {status === 'assigned' && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      New
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {translated.description}
                </p>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
