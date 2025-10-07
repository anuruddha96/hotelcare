import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, Calendar as CalendarIcon, Clock, MapPin, Wrench, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';

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
  created_at: string;
  rooms: {
    room_number: string;
    hotel: string;
  };
  profiles: {
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

  const canDelete = (profile?.role && ['admin'].includes(profile.role)) || profile?.is_super_admin;

  useEffect(() => {
    fetchMaintenanceIssues();
  }, [selectedDate]);

  const fetchMaintenanceIssues = async () => {
    setLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('maintenance_issues')
        .select(`
          *,
          rooms!inner (
            room_number,
            hotel
          ),
          profiles!maintenance_issues_reported_by_fkey (
            full_name,
            nickname
          )
        `)
        .gte('created_at', `${dateStr}T00:00:00`)
        .lt('created_at', `${dateStr}T23:59:59`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setIssues((data as any) || []);
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
            Maintenance Issues
          </h2>
          <p className="text-muted-foreground mt-1">
            View all reported maintenance issues and photos
          </p>
        </div>
        
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

      {issues.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Wrench className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              No Maintenance Issues
            </h3>
            <p className="text-muted-foreground">
              No maintenance issues reported for this date
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
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-xl font-bold">
                      Room {issue.rooms?.room_number || 'N/A'}
                    </CardTitle>
                    <Badge className={getPriorityColor(issue.priority)}>
                      {issue.priority.toUpperCase()}
                    </Badge>
                    <Badge className={getStatusColor(issue.status)}>
                      {issue.status.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteIssue(issue.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Reported By
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
                        Hotel
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
                        Reported At
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
                    Issue Description
                  </h4>
                  <p className="text-foreground">{issue.issue_description}</p>
                  {issue.notes && (
                    <p className="text-muted-foreground mt-2 text-sm">
                      Notes: {issue.notes}
                    </p>
                  )}
                </div>

                {issue.photo_urls && issue.photo_urls.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      📷 Maintenance Photos ({issue.photo_urls.length})
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
    </div>
  );
}
