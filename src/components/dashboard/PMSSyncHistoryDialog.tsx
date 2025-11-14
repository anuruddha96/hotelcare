import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface PMSSyncHistory {
  id: string;
  hotel_id: string;
  sync_type: string;
  room_number: string | null;
  status: string;
  request_payload: any;
  response_payload: any;
  error_message: string | null;
  synced_at: string;
  profiles: {
    full_name: string;
    nickname: string;
  } | null;
}

interface PMSSyncHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotelId?: string;
}

export function PMSSyncHistoryDialog({ open, onOpenChange, hotelId }: PMSSyncHistoryDialogProps) {
  const [history, setHistory] = useState<PMSSyncHistory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [open, hotelId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('pms_sync_history')
        .select(`
          *,
          profiles:synced_by (
            full_name,
            nickname
          )
        `)
        .order('synced_at', { ascending: false })
        .limit(100);

      if (hotelId) {
        query = query.eq('hotel_id', hotelId);
      }

      const { data, error } = await query;

      if (error) throw error;

      setHistory((data as any) || []);
    } catch (error) {
      console.error('Error fetching PMS sync history:', error);
      toast.error('Failed to load sync history');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'partial':
        return <AlertCircle className="h-4 w-4 text-amber-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="bg-green-600">Success</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'partial':
        return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Partial</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getSyncTypeLabel = (syncType: string) => {
    switch (syncType) {
      case 'room_status_update':
        return 'Room Status Update';
      case 'full_sync':
        return 'Full Sync';
      case 'reservation_sync':
        return 'Reservation Sync';
      default:
        return syncType;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            PMS Sync History
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing recent synchronization events with Previo PMS
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHistory}
              disabled={loading}
            >
              {loading ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </>
              )}
            </Button>
          </div>

          <ScrollArea className="h-[500px] pr-4">
            {history.length === 0 && !loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>No sync history found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="border rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {getStatusIcon(item.status)}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-sm">
                              {getSyncTypeLabel(item.sync_type)}
                            </h4>
                            {getStatusBadge(item.status)}
                          </div>
                          {item.room_number && (
                            <p className="text-sm text-muted-foreground">
                              Room: {item.room_number}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{format(new Date(item.synced_at), 'MMM dd, yyyy')}</p>
                        <p>{format(new Date(item.synced_at), 'HH:mm:ss')}</p>
                      </div>
                    </div>

                    {item.profiles && (
                      <p className="text-xs text-muted-foreground">
                        Synced by: {item.profiles.full_name} (@{item.profiles.nickname})
                      </p>
                    )}

                    {item.error_message && (
                      <div className="bg-red-50 border border-red-200 rounded p-2">
                        <p className="text-xs text-red-800 font-mono">
                          {item.error_message}
                        </p>
                      </div>
                    )}

                    {item.response_payload && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          View Response
                        </summary>
                        <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto">
                          {JSON.stringify(item.response_payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
