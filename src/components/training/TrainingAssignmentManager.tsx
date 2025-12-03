import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, Send, CheckCircle, Clock, Play, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { getTrainingTranslation } from '@/lib/training-translations';
import { toast } from 'sonner';

interface TrainingGuide {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  total_steps: number;
}

interface StaffMember {
  id: string;
  full_name: string;
  nickname: string | null;
  assigned_hotel: string | null;
}

interface Assignment {
  user_id: string;
  guide_id: string;
  status: string;
}

interface TrainingAssignmentManagerProps {
  organizationSlug: string;
  hotelFilter?: string;
}

export function TrainingAssignmentManager({ 
  organizationSlug, 
  hotelFilter 
}: TrainingAssignmentManagerProps) {
  const { user } = useAuth();
  const { language } = useTranslation();
  const translations = getTrainingTranslation(language);
  
  const [guides, setGuides] = useState<TrainingGuide[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedGuide, setSelectedGuide] = useState<string>('');
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [organizationSlug, hotelFilter]);

  const fetchData = async () => {
    // Fetch training guides
    const { data: guidesData } = await supabase
      .from('training_guides')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (guidesData) {
      setGuides(guidesData);
    }

    // Fetch housekeeping staff
    let query = supabase
      .from('profiles')
      .select('id, full_name, nickname, assigned_hotel')
      .eq('role', 'housekeeping')
      .eq('organization_slug', organizationSlug);

    if (hotelFilter) {
      query = query.eq('assigned_hotel', hotelFilter);
    }

    const { data: staffData } = await query;
    if (staffData) {
      setStaff(staffData);
    }

    // Fetch existing assignments
    const { data: assignmentsData } = await supabase
      .from('user_training_assignments')
      .select('user_id, guide_id, status')
      .eq('organization_slug', organizationSlug);

    if (assignmentsData) {
      setAssignments(assignmentsData);
    }
  };

  const getStaffTrainingStatus = (staffId: string, guideId: string) => {
    const assignment = assignments.find(
      a => a.user_id === staffId && a.guide_id === guideId
    );
    return assignment?.status || 'not_assigned';
  };

  const handleAssignTraining = async () => {
    if (!selectedGuide || selectedStaff.length === 0) {
      toast.error('Please select a training guide and at least one staff member');
      return;
    }

    setLoading(true);

    try {
      const newAssignments = selectedStaff.map(staffId => ({
        user_id: staffId,
        guide_id: selectedGuide,
        assigned_by: user?.id,
        status: 'assigned',
        organization_slug: organizationSlug,
      }));

      const { error } = await supabase
        .from('user_training_assignments')
        .upsert(newAssignments, {
          onConflict: 'user_id,guide_id',
          ignoreDuplicates: false,
        });

      if (error) throw error;

      toast.success(translations.ui.trainingAssigned);
      setSelectedStaff([]);
      fetchData();
    } catch (error) {
      console.error('Error assigning training:', error);
      toast.error('Failed to assign training');
    } finally {
      setLoading(false);
    }
  };

  const toggleStaffSelection = (staffId: string) => {
    setSelectedStaff(prev =>
      prev.includes(staffId)
        ? prev.filter(id => id !== staffId)
        : [...prev, staffId]
    );
  };

  const selectAllStaff = () => {
    if (selectedStaff.length === staff.length) {
      setSelectedStaff([]);
    } else {
      setSelectedStaff(staff.map(s => s.id));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'assigned':
        return <Play className="h-4 w-4 text-blue-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="outline" className="text-green-600 border-green-600">{translations.ui.completed}</Badge>;
      case 'in_progress':
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600">{translations.ui.inProgress}</Badge>;
      case 'assigned':
        return <Badge variant="outline" className="text-blue-600 border-blue-600">{translations.ui.notStarted}</Badge>;
      default:
        return <Badge variant="secondary">—</Badge>;
    }
  };

  const getTranslatedGuideName = (guide: TrainingGuide) => {
    const translated = translations.guides[guide.slug as keyof typeof translations.guides];
    return translated?.name || guide.name;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          {translations.ui.assignTraining}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Guide Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{translations.ui.selectGuide}</label>
          <Select value={selectedGuide} onValueChange={setSelectedGuide}>
            <SelectTrigger>
              <SelectValue placeholder={translations.ui.selectGuide} />
            </SelectTrigger>
            <SelectContent>
              {guides.map(guide => (
                <SelectItem key={guide.id} value={guide.id}>
                  {getTranslatedGuideName(guide)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Staff Selection */}
        {selectedGuide && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Select Staff ({selectedStaff.length} selected)
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllStaff}
              >
                <Users className="h-4 w-4 mr-1" />
                {selectedStaff.length === staff.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>

            <div className="border rounded-md max-h-[300px] overflow-y-auto">
              {staff.map(member => {
                const status = getStaffTrainingStatus(member.id, selectedGuide);
                
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 border-b last:border-b-0 hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedStaff.includes(member.id)}
                        onCheckedChange={() => toggleStaffSelection(member.id)}
                        disabled={status === 'completed'}
                      />
                      <div>
                        <p className="font-medium text-sm">
                          {member.nickname || member.full_name}
                        </p>
                        {member.assigned_hotel && (
                          <p className="text-xs text-muted-foreground">
                            {member.assigned_hotel}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(status)}
                      {getStatusBadge(status)}
                    </div>
                  </div>
                );
              })}

              {staff.length === 0 && (
                <p className="p-4 text-center text-muted-foreground text-sm">
                  No housekeeping staff found
                </p>
              )}
            </div>
          </div>
        )}

        {/* Assign Button */}
        {selectedGuide && selectedStaff.length > 0 && (
          <Button
            onClick={handleAssignTraining}
            disabled={loading}
            className="w-full"
          >
            <Send className="h-4 w-4 mr-2" />
            {translations.ui.assignTraining} ({selectedStaff.length})
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
