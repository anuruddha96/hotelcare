import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { format } from 'date-fns';
import { FileSpreadsheet, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface PMSUploadHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotelFilter?: string;
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

export function PMSUploadHistoryDialog({ open, onOpenChange, hotelFilter }: PMSUploadHistoryDialogProps) {
  const { t } = useTranslation();
  const [summaries, setSummaries] = useState<UploadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      fetchUploadHistory();
    }
  }, [open]);

  const fetchUploadHistory = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('pms_upload_summary')
        .select(`
          *,
          profiles!uploaded_by (
            full_name
          )
        `);
      
      if (hotelFilter) {
        // Resolve hotel slug from hotel_configurations since DB stores slugs
        // but parent may pass full hotel name
        const { data: hotelConfig } = await supabase
          .from('hotel_configurations')
          .select('hotel_id, hotel_name')
          .or(`hotel_id.eq.${hotelFilter},hotel_name.eq.${hotelFilter}`)
          .limit(1);
        
        const possibleValues = new Set<string>();
        possibleValues.add(hotelFilter);
        if (hotelConfig && hotelConfig.length > 0) {
          possibleValues.add(hotelConfig[0].hotel_id);
          possibleValues.add(hotelConfig[0].hotel_name);
        }
        
        const orFilter = Array.from(possibleValues).map(v => `hotel_filter.eq.${v}`).join(',');
        query = query.or(orFilter);
      }
      
      const { data, error } = await query
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

  const toggleExpanded = (id: string) => {
    setExpandedSummaries(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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
              {summaries.map((summary) => {
                const isExpanded = expandedSummaries.has(summary.id);
                const hasRoomDetails = (summary.checkout_rooms?.length > 0 || summary.daily_cleaning_rooms?.length > 0);

                return (
                  <Card key={summary.id} className="border border-border">
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-lg">
                          PMS Upload - {format(new Date(summary.upload_date), 'PPP p')}
                        </CardTitle>
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
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
                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                          <div className="text-2xl font-bold text-blue-900 dark:text-blue-300">
                            {summary.processed_rooms}
                          </div>
                          <div className="text-sm text-blue-700 dark:text-blue-400">
                            Processed Rooms
                          </div>
                        </div>
                        
                        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 rounded-lg">
                          <div className="text-2xl font-bold text-green-900 dark:text-green-300">
                            {summary.updated_rooms}
                          </div>
                          <div className="text-sm text-green-700 dark:text-green-400">
                            Updated Rooms
                          </div>
                        </div>
                        
                        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
                          <div className="text-2xl font-bold text-purple-900 dark:text-purple-300">
                            {summary.checkout_rooms?.length || 0}
                          </div>
                          <div className="text-sm text-purple-700 dark:text-purple-400">
                            {t('housekeeping.assignmentType.checkoutClean')}
                          </div>
                        </div>
                        
                        <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg">
                          <div className="text-2xl font-bold text-amber-900 dark:text-amber-300">
                            {summary.daily_cleaning_rooms?.length || 0}
                          </div>
                          <div className="text-sm text-amber-700 dark:text-amber-400">
                            {t('housekeeping.assignmentType.dailyClean')}
                          </div>
                        </div>
                      </div>

                      {/* Errors */}
                      {summary.errors && summary.errors.length > 0 && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                            <h4 className="font-semibold text-red-800 dark:text-red-300">
                              Errors ({summary.errors.length})
                            </h4>
                          </div>
                          <div className="space-y-1">
                            {summary.errors.slice(0, 3).map((error: string, index: number) => (
                              <p key={index} className="text-sm text-red-700 dark:text-red-400">
                                {error}
                              </p>
                            ))}
                            {summary.errors.length > 3 && (
                              <p className="text-sm text-red-600 dark:text-red-500 italic">
                                ... and {summary.errors.length - 3} more errors
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Room Details Toggle */}
                      {hasRoomDetails && (
                        <div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleExpanded(summary.id)}
                            className="w-full flex items-center justify-center gap-2"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="h-4 w-4" />
                                Hide Room Details
                              </>
                            ) : (
                              <>
                                <ChevronDown className="h-4 w-4" />
                                Show Room Details ({(summary.checkout_rooms?.length || 0) + (summary.daily_cleaning_rooms?.length || 0)} rooms)
                              </>
                            )}
                          </Button>

                          {isExpanded && (
                            <div className="grid md:grid-cols-2 gap-4 mt-3">
                              {summary.checkout_rooms?.length > 0 && (
                                <div className="p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
                                  <h4 className="font-semibold text-purple-800 dark:text-purple-300 mb-2">
                                    {t('housekeeping.assignmentType.checkoutClean')} ({summary.checkout_rooms.length})
                                  </h4>
                                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                                    {summary.checkout_rooms.map((room: any, index: number) => (
                                      <div key={index} className="text-sm text-purple-700 dark:text-purple-400">
                                        Room {room.roomNumber} - {room.roomType}
                                        {room.departureTime && <span className="ml-1 text-purple-500">({room.departureTime})</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {summary.daily_cleaning_rooms?.length > 0 && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg">
                                  <h4 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">
                                    {t('housekeeping.assignmentType.dailyClean')} ({summary.daily_cleaning_rooms.length})
                                  </h4>
                                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                                    {summary.daily_cleaning_rooms.map((room: any, index: number) => (
                                      <div key={index} className="text-sm text-amber-700 dark:text-amber-400">
                                        Room {room.roomNumber} - {room.roomType}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
