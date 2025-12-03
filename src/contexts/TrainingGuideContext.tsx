import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { getTrainingTranslation } from '@/lib/training-translations';

interface TrainingStep {
  id: string;
  step_order: number;
  step_key: string;
  target_selector: string | null;
  position: string;
  action_type: string;
  requires_action: boolean;
  highlight_padding: number;
}

interface TrainingGuide {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  total_steps: number;
}

interface TrainingAssignment {
  id: string;
  guide_id: string;
  status: string;
  current_step: number;
  completed_steps: number[];
  guide?: TrainingGuide;
}

interface TrainingGuideContextType {
  isTrainingActive: boolean;
  currentGuide: TrainingGuide | null;
  currentStep: TrainingStep | null;
  currentStepIndex: number;
  totalSteps: number;
  steps: TrainingStep[];
  assignment: TrainingAssignment | null;
  pendingAssignments: TrainingAssignment[];
  startTraining: (guideId: string) => Promise<void>;
  nextStep: () => void;
  prevStep: () => void;
  skipTraining: () => void;
  exitTraining: () => void;
  completeTraining: () => Promise<void>;
  refreshAssignments: () => Promise<void>;
  getTranslatedStep: (stepKey: string) => { title: string; content: string; actionHint?: string };
  getTranslatedGuide: (slug: string) => { name: string; description: string };
  getTranslatedUI: () => any;
}

const TrainingGuideContext = createContext<TrainingGuideContextType | undefined>(undefined);

export function TrainingGuideProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { language } = useTranslation();
  
  const [isTrainingActive, setIsTrainingActive] = useState(false);
  const [currentGuide, setCurrentGuide] = useState<TrainingGuide | null>(null);
  const [steps, setSteps] = useState<TrainingStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [assignment, setAssignment] = useState<TrainingAssignment | null>(null);
  const [pendingAssignments, setPendingAssignments] = useState<TrainingAssignment[]>([]);

  const translations = getTrainingTranslation(language);

  const getTranslatedStep = useCallback((stepKey: string) => {
    return translations.steps[stepKey] || {
      title: stepKey,
      content: '',
      actionHint: '',
    };
  }, [translations]);

  const getTranslatedGuide = useCallback((slug: string) => {
    const guideKey = slug as keyof typeof translations.guides;
    return translations.guides[guideKey] || { name: slug, description: '' };
  }, [translations]);

  const getTranslatedUI = useCallback(() => {
    return translations.ui;
  }, [translations]);

  const refreshAssignments = useCallback(async () => {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from('user_training_assignments')
      .select(`
        id,
        guide_id,
        status,
        current_step,
        training_guides (
          id,
          slug,
          name,
          description,
          total_steps
        )
      `)
      .eq('user_id', user.id)
      .in('status', ['assigned', 'in_progress']);

    if (!error && data) {
      const formattedAssignments = data.map((a: any) => ({
        id: a.id,
        guide_id: a.guide_id,
        status: a.status,
        current_step: a.current_step || 0,
        completed_steps: Array.isArray(a.completed_steps) ? a.completed_steps : [],
        guide: a.training_guides,
      }));
      setPendingAssignments(formattedAssignments);
    }
  }, [user?.id]);

  useEffect(() => {
    refreshAssignments();
  }, [refreshAssignments]);

  const startTraining = useCallback(async (guideId: string) => {
    // Fetch the guide
    const { data: guideData, error: guideError } = await supabase
      .from('training_guides')
      .select('*')
      .eq('id', guideId)
      .single();

    if (guideError || !guideData) {
      console.error('Failed to fetch training guide:', guideError);
      return;
    }

    // Fetch the steps
    const { data: stepsData, error: stepsError } = await supabase
      .from('training_guide_steps')
      .select('*')
      .eq('guide_id', guideId)
      .order('step_order', { ascending: true });

    if (stepsError) {
      console.error('Failed to fetch training steps:', stepsError);
      return;
    }

    // Find or create assignment
    let currentAssignment = pendingAssignments.find(a => a.guide_id === guideId);
    
    if (!currentAssignment && user?.id) {
      // Create new assignment
      const { data: newAssignment, error: assignError } = await supabase
        .from('user_training_assignments')
        .insert({
          user_id: user.id,
          guide_id: guideId,
          assigned_by: user.id,
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!assignError && newAssignment) {
        currentAssignment = {
          id: newAssignment.id,
          guide_id: newAssignment.guide_id,
          status: newAssignment.status,
          current_step: newAssignment.current_step,
          completed_steps: newAssignment.completed_steps || [],
        };
      }
    } else if (currentAssignment && currentAssignment.status === 'assigned') {
      // Update status to in_progress
      await supabase
        .from('user_training_assignments')
        .update({ 
          status: 'in_progress', 
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentAssignment.id);
      
      currentAssignment.status = 'in_progress';
    }

    setCurrentGuide(guideData);
    setSteps(stepsData || []);
    setCurrentStepIndex(currentAssignment?.current_step || 0);
    setAssignment(currentAssignment || null);
    setIsTrainingActive(true);
  }, [pendingAssignments, user?.id]);

  const updateProgress = useCallback(async (stepIndex: number, completedSteps: number[]) => {
    if (!assignment) return;

    await supabase
      .from('user_training_assignments')
      .update({
        current_step: stepIndex,
        completed_steps: completedSteps,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assignment.id);
  }, [assignment]);

  const nextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      const newIndex = currentStepIndex + 1;
      const newCompleted = [...(assignment?.completed_steps || []), currentStepIndex];
      setCurrentStepIndex(newIndex);
      if (assignment) {
        setAssignment({ ...assignment, current_step: newIndex, completed_steps: newCompleted });
        updateProgress(newIndex, newCompleted);
      }
    }
  }, [currentStepIndex, steps.length, assignment, updateProgress]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  }, [currentStepIndex]);

  const skipTraining = useCallback(async () => {
    if (assignment) {
      await supabase
        .from('user_training_assignments')
        .update({
          status: 'skipped',
          updated_at: new Date().toISOString(),
        })
        .eq('id', assignment.id);
    }
    
    setIsTrainingActive(false);
    setCurrentGuide(null);
    setSteps([]);
    setCurrentStepIndex(0);
    setAssignment(null);
    refreshAssignments();
  }, [assignment, refreshAssignments]);

  const exitTraining = useCallback(() => {
    // Save progress but don't mark as skipped
    if (assignment) {
      updateProgress(currentStepIndex, assignment.completed_steps);
    }
    
    setIsTrainingActive(false);
    setCurrentGuide(null);
    setSteps([]);
    setCurrentStepIndex(0);
    setAssignment(null);
  }, [assignment, currentStepIndex, updateProgress]);

  const completeTraining = useCallback(async () => {
    if (assignment) {
      await supabase
        .from('user_training_assignments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          current_step: steps.length,
          completed_steps: steps.map((_, i) => i),
          updated_at: new Date().toISOString(),
        })
        .eq('id', assignment.id);
    }

    setIsTrainingActive(false);
    setCurrentGuide(null);
    setSteps([]);
    setCurrentStepIndex(0);
    setAssignment(null);
    refreshAssignments();
  }, [assignment, steps, refreshAssignments]);

  const currentStep = steps[currentStepIndex] || null;

  return (
    <TrainingGuideContext.Provider
      value={{
        isTrainingActive,
        currentGuide,
        currentStep,
        currentStepIndex,
        totalSteps: steps.length,
        steps,
        assignment,
        pendingAssignments,
        startTraining,
        nextStep,
        prevStep,
        skipTraining,
        exitTraining,
        completeTraining,
        refreshAssignments,
        getTranslatedStep,
        getTranslatedGuide,
        getTranslatedUI,
      }}
    >
      {children}
    </TrainingGuideContext.Provider>
  );
}

export function useTrainingGuide() {
  const context = useContext(TrainingGuideContext);
  if (context === undefined) {
    throw new Error('useTrainingGuide must be used within a TrainingGuideProvider');
  }
  return context;
}
