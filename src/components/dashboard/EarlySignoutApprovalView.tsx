import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Clock, User, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface EarlySignoutRequest {
  id: string;
  user_id: string;
  attendance_id: string;
  requested_at: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  profiles: {
    full_name: string;
    nickname: string;
  } | null;
  staff_attendance: {
    check_in_time: string;
    work_date: string;
  } | null;
}

export function EarlySignoutApprovalView() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [requests, setRequests] = useState<EarlySignoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchRequests();
    
    // Real-time subscription
    const channel = supabase
      .channel('early-signout-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'early_signout_requests'
        },
        () => {
          fetchRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      // Get current user's assigned hotel
      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', user?.id)
        .single();

      let query = supabase
        .from('early_signout_requests')
        .select(`
          *,
          profiles!early_signout_requests_user_id_fkey(full_name, nickname, assigned_hotel),
          staff_attendance(check_in_time, work_date)
        `)
        .order('requested_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      // Filter by hotel for managers
      const filteredData = (data || []).filter((request: any) => {
        if (!profileData?.assigned_hotel) return true; // Admin sees all
        return request.profiles?.assigned_hotel === profileData.assigned_hotel;
      });

      setRequests(filteredData);
    } catch (error) {
      console.error('Error fetching early signout requests:', error);
      toast.error('Failed to load early signout requests');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string, attendanceId: string) => {
    setProcessingId(requestId);
    try {
      // Update the request
      const { error: requestError } = await supabase
        .from('early_signout_requests')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (requestError) throw requestError;

      // Now complete the check-out
      const { error: attendanceError } = await supabase
        .from('staff_attendance')
        .update({
          check_out_time: new Date().toISOString(),
          check_out_location: { approved_early_signout: true }
        })
        .eq('id', attendanceId);

      if (attendanceError) throw attendanceError;

      toast.success('Early sign-out approved');
      fetchRequests();
    } catch (error) {
      console.error('Error approving request:', error);
      toast.error('Failed to approve request');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    const reason = rejectionReason[requestId]?.trim();
    if (!reason) {
      toast.error('Please provide a rejection reason');
      return;
    }

    setProcessingId(requestId);
    try {
      const { error } = await supabase
        .from('early_signout_requests')
        .update({
          status: 'rejected',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          rejection_reason: reason
        })
        .eq('id', requestId);

      if (error) throw error;

      toast.success('Early sign-out rejected');
      setRejectionReason(prev => ({ ...prev, [requestId]: '' }));
      fetchRequests();
    } catch (error) {
      console.error('Error rejecting request:', error);
      toast.error('Failed to reject request');
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500 text-white">Pending Approval</Badge>;
      case 'approved':
        return <Badge className="bg-green-500 text-white">Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500 text-white">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const processedRequests = requests.filter(r => r.status !== 'pending');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Early Sign-Out Requests
            {pendingRequests.length > 0 && (
              <Badge className="bg-red-500 text-white ml-2">
                {pendingRequests.length} Pending
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingRequests.length === 0 && processedRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No early sign-out requests</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Pending Requests */}
              {pendingRequests.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-yellow-600 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Pending Approval ({pendingRequests.length})
                  </h3>
                  {pendingRequests.map((request) => (
                    <Card key={request.id} className="border-yellow-200 bg-yellow-50/50">
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {request.profiles?.full_name || 'Unknown'}
                              </span>
                              {request.profiles?.nickname && (
                                <span className="text-sm text-muted-foreground">
                                  ({request.profiles.nickname})
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <p>
                                <strong>Requested:</strong>{' '}
                                {format(new Date(request.requested_at), 'MMM dd, yyyy HH:mm')}
                              </p>
                              {request.staff_attendance && (
                                <>
                                  <p>
                                    <strong>Work Date:</strong>{' '}
                                    {format(new Date(request.staff_attendance.work_date), 'MMM dd, yyyy')}
                                  </p>
                                  <p>
                                    <strong>Check-in Time:</strong>{' '}
                                    {format(new Date(request.staff_attendance.check_in_time), 'HH:mm')}
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                          {getStatusBadge(request.status)}
                        </div>

                        <div className="pt-3 border-t space-y-3">
                          <Textarea
                            placeholder="Rejection reason (if rejecting)..."
                            value={rejectionReason[request.id] || ''}
                            onChange={(e) =>
                              setRejectionReason(prev => ({
                                ...prev,
                                [request.id]: e.target.value
                              }))
                            }
                            rows={2}
                            className="text-sm"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(request.id, request.attendance_id)}
                              disabled={processingId === request.id}
                              className="flex-1 bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(request.id)}
                              disabled={processingId === request.id}
                              className="flex-1"
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Processed Requests */}
              {processedRequests.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Recent History
                  </h3>
                  {processedRequests.slice(0, 5).map((request) => (
                    <Card key={request.id} className="border-gray-200">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {request.profiles?.full_name || 'Unknown'}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <p>
                                <strong>Requested:</strong>{' '}
                                {format(new Date(request.requested_at), 'MMM dd, yyyy HH:mm')}
                              </p>
                              {request.approved_at && (
                                <p>
                                  <strong>Processed:</strong>{' '}
                                  {format(new Date(request.approved_at), 'MMM dd, yyyy HH:mm')}
                                </p>
                              )}
                              {request.rejection_reason && (
                                <p className="text-red-600">
                                  <strong>Reason:</strong> {request.rejection_reason}
                                </p>
                              )}
                            </div>
                          </div>
                          {getStatusBadge(request.status)}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}