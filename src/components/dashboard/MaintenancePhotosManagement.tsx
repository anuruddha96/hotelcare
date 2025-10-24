import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, Calendar as CalendarIcon, Clock, MapPin, Wrench, Trash2, Plus, CheckCircle, User } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { MaintenanceIssueDialog } from './MaintenanceIssueDialog';
import { MaintenanceResolutionDialog } from './MaintenanceResolutionDialog';

interface MaintenanceIssue {
  id: string;
  room_id: string;
  assignment_id: string | null;
  reported_by: string;
  issue_description: string;
  photo_urls: string[];
  status: string;
  priority: string;
  notes: string | null;
  resolution_text: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  rooms: {
    room_number: string;
    hotel: string;
  };
  profiles: {
    full_name: string;
    nickname: string;
  };
  resolved_by_profile?: {
    full_name: string;
    nickname: string;
  };
}

export function MaintenancePhotosManagement() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [issues, setIssues] = useState<MaintenanceIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [resolutionDialog, setResolutionDialog] = useState<{
    open: boolean;
    issueId: string;
    roomNumber: string;
    issueDescription: string;
  }>({
    open: false,
    issueId: '',
    roomNumber: '',
    issueDescription: ''
  });

  const canDelete = (profile?.role && ['admin'].includes(profile.role)) || profile?.is_super_admin;
  const canCreate = profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role);
  const canResolve = profile?.role && ['admin', 'manager', 'housekeeping_manager', 'maintenance'].includes(profile.role);

  useEffect(() => {
    fetchMaintenanceIssues();
  }, [selectedDate]);

  const fetchMaintenanceIssues = async () => {
    setLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      // Get current user's hotel to filter
      const { data: currentUserProfile } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      const userHotel = currentUserProfile?.assigned_hotel;
      
      const { data, error } = await supabase
        .from('maintenance_issues')
        .select(`
          *,
          rooms (
            room_number,
            hotel
          )
        `)
        .lte('created_at', `${dateStr}T23:59:59`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      // Fetch reporter profiles and resolver profiles separately
      if (data && data.length > 0) {
        const reporterIds = [...new Set(data.map((item: any) => item.reported_by))];
        const resolverIds = [...new Set(data.filter((item: any) => item.resolved_by).map((item: any) => item.resolved_by))];
        const allUserIds = [...new Set([...reporterIds, ...resolverIds])];
        
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', allUserIds);
        
        // Map profiles to issues
        let issuesWithProfiles = data.map((issue: any) => ({
          ...issue,
          profiles: profiles?.find((p: any) => p.id === issue.reported_by) || { full_name: 'Unknown', nickname: '' },
          resolved_by_profile: issue.resolved_by ? profiles?.find((p: any) => p.id === issue.resolved_by) : null
        }));

        // Filter by user's assigned hotel
        if (userHotel) {
          issuesWithProfiles = issuesWithProfiles.filter((issue: any) => 
            issue.rooms?.hotel === userHotel || 
            issue.rooms?.hotel === (profile?.assigned_hotel)
          );
        }
        
        console.log('Fetched maintenance issues:', issuesWithProfiles.length, 'records');
        setIssues(issuesWithProfiles as any);
      } else {
        setIssues([]);
      }
    } catch (error) {
      console.error('Error fetching maintenance issues:', error);
      toast.error('Failed to fetch maintenance issues');
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'approved':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'ticket_created':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'resolved':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const handleDeleteIssue = async (issueId: string) => {
    if (!confirm('Are you sure you want to delete this maintenance issue?')) return;
    
    try {
      const { error } = await supabase
        .from('maintenance_issues')
        .delete()
        .eq('id', issueId);

      if (error) throw error;

      toast.success('Maintenance issue deleted successfully');
      fetchMaintenanceIssues();
    } catch (error: any) {
      console.error('Error deleting issue:', error);
      toast.error('Failed to delete maintenance issue');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="h-6 w-6 text-destructive" />
            {t('maintenance.pageTitle')}
          </h2>
          <p className="text-muted-foreground mt-1">
            {t('maintenance.subtitle')}
          </p>
        </div>
        
        <div className="flex gap-2">
          {canCreate && (
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('maintenance.reportIssue')}
            </Button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                <CalendarIcon className="h-4 w-4 mr-2" />
                {format(selectedDate, 'PPP')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {issues.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Wrench className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {t('maintenance.noIssues')}
            </h3>
            <p className="text-muted-foreground">
              {t('maintenance.noIssuesDate')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {issues.map((issue) => (
            <Card 
              key={issue.id} 
              className={`border-2 ${
                issue.priority === 'urgent' || issue.priority === 'high'
                  ? 'border-destructive shadow-lg'
                  : 'border-border'
              }`}
            >
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle className="text-xl font-bold">
                      Room {issue.rooms?.room_number || 'N/A'}
                    </CardTitle>
                    <Badge className={getPriorityColor(issue.priority)}>
                      {t(`priority.${issue.priority}`).toUpperCase()}
                    </Badge>
                    <Badge className={getStatusColor(issue.status)}>
                      {t(`status.${issue.status}`).toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    {canResolve && issue.status !== 'resolved' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-green-50 hover:bg-green-100 text-green-700 border-green-300"
                        onClick={() => setResolutionDialog({
                          open: true,
                          issueId: issue.id,
                          roomNumber: issue.rooms?.room_number || 'N/A',
                          issueDescription: issue.issue_description
                        })}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {t('maintenance.markResolved')}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteIssue(issue.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t('maintenance.delete')}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        {t('maintenance.reportedBy')}
                      </p>
                      <p className="text-lg font-semibold">
                        {issue.profiles?.full_name || 'Unknown'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        {t('maintenance.hotel')}
                      </p>
                      <p className="text-lg font-semibold">
                        {issue.rooms?.hotel || 'Unknown'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        {t('maintenance.reportedAt')}
                      </p>
                      <p className="text-lg font-semibold">
                        {new Date(issue.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-destructive/10 rounded-lg border-2 border-destructive/30">
                  <h4 className="font-semibold text-destructive mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {t('maintenance.issueDescription')}
                  </h4>
                  <p className="text-foreground">{issue.issue_description}</p>
                  {issue.notes && (
                    <p className="text-muted-foreground mt-2 text-sm">
                      {t('maintenance.notes')}: {issue.notes}
                    </p>
                  )}
                </div>

                {issue.status === 'resolved' && issue.resolution_text && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border-2 border-green-300 dark:border-green-700">
                    <h4 className="font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      {t('maintenance.resolutionDetails')}
                    </h4>
                    <p className="text-foreground mb-3">{issue.resolution_text}</p>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-green-300 dark:border-green-700">
                      {issue.resolved_by_profile && (
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">{t('maintenance.resolvedBy')}</p>
                            <p className="text-sm font-semibold">{issue.resolved_by_profile.full_name}</p>
                          </div>
                        </div>
                      )}
                      {issue.resolved_at && (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs text-muted-foreground">{t('maintenance.resolvedAt')}</p>
                            <p className="text-sm font-semibold">
                              {new Date(issue.resolved_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {issue.photo_urls && issue.photo_urls.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      📷 {t('maintenance.photos')} ({issue.photo_urls.length})
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {issue.photo_urls.map((url, index) => (
                        <Dialog key={index}>
                          <DialogTrigger asChild>
                            <div 
                              className="relative aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity border-2 border-destructive"
                            >
                              <img
                                src={url}
                                alt={`Maintenance ${index + 1}`}
                                className="object-cover w-full h-full"
                              />
                            </div>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl">
                            <img
                              src={url}
                              alt={`Maintenance ${index + 1}`}
                              className="w-full h-auto"
                            />
                          </DialogContent>
                        </Dialog>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <MaintenanceIssueDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        roomId={null}
        roomNumber="General"
        onIssueReported={() => {
          fetchMaintenanceIssues();
          setIsAddDialogOpen(false);
        }}
      />

      <MaintenanceResolutionDialog
        open={resolutionDialog.open}
        onOpenChange={(open) => setResolutionDialog({ ...resolutionDialog, open })}
        issueId={resolutionDialog.issueId}
        roomNumber={resolutionDialog.roomNumber}
        issueDescription={resolutionDialog.issueDescription}
        onResolved={fetchMaintenanceIssues}
      />
    </div>
  );
}
