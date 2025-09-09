import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Clock, CheckCircle, XCircle, User, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface BreakRequest {
  id: string;
  user_id: string;
  reason: string;
  status: string; // Changed from union type to string
  requested_at: string;
  rejection_reason?: string;
  profiles: {
    full_name: string;
    nickname: string;
  };
  break_types: {
    display_name: string;
    duration_minutes: number;
    icon_name: string;
  };
}

export function BreakRequestApprovalView() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [requests, setRequests] = useState<BreakRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [showRejectionInput, setShowRejectionInput] = useState<string | null>(null);

  useEffect(() => {
    fetchBreakRequests();
    
    // Set up real-time listener
    const channel = supabase
      .channel('break-requests-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'break_requests'
        },
        () => {
          fetchBreakRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchBreakRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('break_requests')
        .select(`
          *,
          profiles!break_requests_user_id_fkey(full_name, nickname),
          break_types(display_name, duration_minutes, icon_name)
        `)
        .order('requested_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error fetching break requests:', error);
      toast.error(t('breakRequest.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      const { error } = await supabase
        .from('break_requests')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (error) throw error;
      
      toast.success(t('breakRequest.approved'));
      fetchBreakRequests();
    } catch (error) {
      console.error('Error approving break request:', error);
      toast.error(t('breakRequest.approveError'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    if (!rejectionReason.trim()) {
      toast.error(t('breakRequest.rejectionReasonRequired'));
      return;
    }

    setProcessingId(requestId);
    try {
      const { error } = await supabase
        .from('break_requests')
        .update({
          status: 'rejected',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectionReason.trim()
        })
        .eq('id', requestId);

      if (error) throw error;
      
      toast.success(t('breakRequest.rejected'));
      setRejectionReason('');
      setShowRejectionInput(null);
      fetchBreakRequests();
    } catch (error) {
      console.error('Error rejecting break request:', error);
      toast.error(t('breakRequest.rejectError'));
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">{t('breakRequest.pending')}</Badge>;
      case 'approved':
        return <Badge variant="default" className="bg-green-500">{t('breakRequest.approved')}</Badge>;
      case 'rejected':
        return <Badge variant="destructive">{t('breakRequest.rejected')}</Badge>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  const pendingRequests = requests.filter(req => req.status === 'pending');
  const processedRequests = requests.filter(req => req.status !== 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-4">{t('breakRequest.pendingRequests')}</h2>
        {pendingRequests.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">
                {t('breakRequest.noPendingRequests')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {pendingRequests.map((request) => (
              <Card key={request.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <User className="h-5 w-5" />
                      {request.profiles.full_name}
                      <span className="text-sm text-muted-foreground">
                        (@{request.profiles.nickname})
                      </span>
                    </CardTitle>
                    {getStatusBadge(request.status)}
                  </div>
                  <CardDescription className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {request.break_types.display_name} ({request.break_types.duration_minutes} {t('common.minutes')})
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {formatDistanceToNow(new Date(request.requested_at), { addSuffix: true })}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">{t('breakRequest.reason')}:</Label>
                      <p className="text-sm text-muted-foreground mt-1">{request.reason}</p>
                    </div>

                    {showRejectionInput === request.id ? (
                      <div className="space-y-3">
                        <Label htmlFor="rejection-reason">{t('breakRequest.rejectionReason')}</Label>
                        <Textarea
                          id="rejection-reason"
                          placeholder={t('breakRequest.rejectionReasonPlaceholder')}
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowRejectionInput(null);
                              setRejectionReason('');
                            }}
                          >
                            {t('common.cancel')}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => handleReject(request.id)}
                            disabled={processingId === request.id}
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            {t('breakRequest.confirmReject')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleApprove(request.id)}
                          disabled={processingId === request.id}
                          className="flex items-center gap-2"
                        >
                          <CheckCircle className="h-4 w-4" />
                          {t('breakRequest.approve')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowRejectionInput(request.id)}
                          disabled={processingId === request.id}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          {t('breakRequest.reject')}
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {processedRequests.length > 0 && (
        <div>
          <h3 className="text-md font-medium mb-4">{t('breakRequest.processedRequests')}</h3>
          <div className="space-y-2">
            {processedRequests.slice(0, 10).map((request) => (
              <Card key={request.id} className="py-2">
                <CardContent className="py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{request.profiles.full_name}</span>
                      <span className="text-sm text-muted-foreground">
                        {request.break_types.display_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(request.requested_at), { addSuffix: true })}
                      </span>
                    </div>
                    {getStatusBadge(request.status)}
                  </div>
                  {request.status === 'rejected' && request.rejection_reason && (
                    <p className="text-xs text-red-600 mt-1">
                      {t('breakRequest.rejectionReason')}: {request.rejection_reason}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}