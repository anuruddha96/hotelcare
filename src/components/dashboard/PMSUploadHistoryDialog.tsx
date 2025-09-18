import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { format } from 'date-fns';
import { FileSpreadsheet, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

interface PMSUploadHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UploadSummary {
  id: string;
  uploaded_by: string;
  upload_date: string;
  processed_rooms: number;
  updated_rooms: number;
  assigned_rooms: number;
  checkout_rooms: any;
  daily_cleaning_rooms: any;
  errors: any;
  profiles?: {
    full_name: string;
  };
}

export function PMSUploadHistoryDialog({ open, onOpenChange }: PMSUploadHistoryDialogProps) {
  const { t } = useTranslation();
  const [summaries, setSummaries] = useState<UploadSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchUploadHistory();
    }
  }, [open]);

  const fetchUploadHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pms_upload_summary')
        .select(`
          *,
          profiles!uploaded_by (
            full_name
          )
        `)
        .order('upload_date', { ascending: false })
        .limit(20);

      if (error) throw error;
      setSummaries((data || []).map(item => ({
        ...item,
        checkout_rooms: Array.isArray(item.checkout_rooms) ? item.checkout_rooms : [],
        daily_cleaning_rooms: Array.isArray(item.daily_cleaning_rooms) ? item.daily_cleaning_rooms : [],
        errors: Array.isArray(item.errors) ? item.errors : []
      })));
    } catch (error) {
      console.error('Error fetching upload history:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            PMS Upload History
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          {loading ? (
            <div className="flex justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : summaries.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">
              No upload history found
            </div>
          ) : (
            <div className="space-y-4">
              {summaries.map((summary) => (
                <Card key={summary.id} className="border border-border">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-lg">
                        PMS Upload - {format(new Date(summary.upload_date), 'PPP p')}
                      </CardTitle>
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Completed
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Uploaded by: {summary.profiles?.full_name || 'Unknown'}
                    </p>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-2xl font-bold text-blue-900">
                          {summary.processed_rooms}
                        </div>
                        <div className="text-sm text-blue-700">
                          Processed Rooms
                        </div>
                      </div>
                      
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-2xl font-bold text-green-900">
                          {summary.updated_rooms}
                        </div>
                        <div className="text-sm text-green-700">
                          Updated Rooms
                        </div>
                      </div>
                      
                      <div className="text-center p-3 bg-purple-50 rounded-lg">
                        <div className="text-2xl font-bold text-purple-900">
                          {summary.checkout_rooms?.length || 0}
                        </div>
                        <div className="text-sm text-purple-700">
                          {t('housekeeping.assignmentType.checkoutClean')}
                        </div>
                      </div>
                      
                      <div className="text-center p-3 bg-amber-50 rounded-lg">
                        <div className="text-2xl font-bold text-amber-900">
                          {summary.daily_cleaning_rooms?.length || 0}
                        </div>
                        <div className="text-sm text-amber-700">
                          {t('housekeeping.assignmentType.dailyClean')}
                        </div>
                      </div>
                    </div>

                    {/* Errors */}
                    {summary.errors && summary.errors.length > 0 && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <h4 className="font-semibold text-red-800">
                            Errors ({summary.errors.length})
                          </h4>
                        </div>
                        <div className="space-y-1">
                          {summary.errors.slice(0, 3).map((error, index) => (
                            <p key={index} className="text-sm text-red-700">
                              {error}
                            </p>
                          ))}
                          {summary.errors.length > 3 && (
                            <p className="text-sm text-red-600 italic">
                              ... and {summary.errors.length - 3} more errors
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Room Details */}
                    {(summary.checkout_rooms?.length > 0 || summary.daily_cleaning_rooms?.length > 0) && (
                      <div className="grid md:grid-cols-2 gap-4">
                        {summary.checkout_rooms?.length > 0 && (
                          <div className="p-3 bg-purple-50 rounded-lg">
                            <h4 className="font-semibold text-purple-800 mb-2">
                              {t('housekeeping.assignmentType.checkoutClean')}
                            </h4>
                            <div className="space-y-1">
                              {summary.checkout_rooms.slice(0, 5).map((room: any, index: number) => (
                                <div key={index} className="text-sm text-purple-700">
                                  Room {room.roomNumber} - {room.roomType}
                                </div>
                              ))}
                              {summary.checkout_rooms.length > 5 && (
                                <div className="text-sm text-purple-600 italic">
                                  ... and {summary.checkout_rooms.length - 5} more
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {summary.daily_cleaning_rooms?.length > 0 && (
                          <div className="p-3 bg-amber-50 rounded-lg">
                            <h4 className="font-semibold text-amber-800 mb-2">
                              {t('housekeeping.assignmentType.dailyClean')}
                            </h4>
                            <div className="space-y-1">
                              {summary.daily_cleaning_rooms.slice(0, 5).map((room: any, index: number) => (
                                <div key={index} className="text-sm text-amber-700">
                                  Room {room.roomNumber} - {room.roomType}
                                </div>
                              ))}
                              {summary.daily_cleaning_rooms.length > 5 && (
                                <div className="text-sm text-amber-600 italic">
                                  ... and {summary.daily_cleaning_rooms.length - 5} more
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}