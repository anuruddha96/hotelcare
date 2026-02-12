import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Clock, Target, Star, TrendingUp, Calendar, User, CheckCircle, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';

interface PerformanceDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  housekeeperId: string;
  fullName: string;
  metric: 'score' | 'checkout' | 'daily' | 'punctual' | 'breaks' | 'hours';
  timeframe: string;
}

export function PerformanceDetailDialog({
  open,
  onOpenChange,
  housekeeperId,
  fullName,
  metric,
  timeframe
}: PerformanceDetailDialogProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    if (open) {
      fetchDetailData();
    }
  }, [open, housekeeperId, metric, timeframe]);

  const fetchDetailData = async () => {
    setLoading(true);
    try {
      const dateFrom = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      if (metric === 'punctual' || metric === 'breaks' || metric === 'hours') {
        // Fetch attendance data
        const { data: attendanceData } = await supabase
          .from('staff_attendance')
          .select(`
            *,
            break_requests(*)
          `)
          .eq('user_id', housekeeperId)
          .gte('work_date', dateFrom)
          .order('work_date', { ascending: false });

        setData(attendanceData || []);

        if (metric === 'hours') {
          const validDays = attendanceData?.filter(a => a.total_hours != null) || [];
          const totalHours = validDays.reduce((sum, a) => sum + (parseFloat(a.total_hours?.toString() || '0') || 0), 0);
          const avgHours = validDays.length ? totalHours / validDays.length : 0;
          const maxHours = validDays.length ? Math.max(...validDays.map(a => parseFloat(a.total_hours?.toString() || '0') || 0)) : 0;
          const minHours = validDays.length ? Math.min(...validDays.map(a => parseFloat(a.total_hours?.toString() || '0') || 0)) : 0;
          setSummary({
            total: validDays.length,
            avgHours: Math.round(avgHours * 10) / 10,
            maxHours: Math.round(maxHours * 10) / 10,
            minHours: Math.round(minHours * 10) / 10,
            totalHours: Math.round(totalHours * 10) / 10
          });
        } else if (metric === 'punctual') {
          const punctualCount = attendanceData?.filter(a => 
            new Date(`1970-01-01T${new Date(a.check_in_time).toTimeString()}`).getTime() <= 
            new Date('1970-01-01T09:00:00').getTime()
          ).length || 0;
          
          setSummary({
            total: attendanceData?.length || 0,
            punctual: punctualCount,
            late: (attendanceData?.length || 0) - punctualCount,
            punctualityRate: attendanceData?.length ? (punctualCount / attendanceData.length * 100) : 0
          });
        }
      } else {
        // Fetch performance data
        let query = supabase
          .from('housekeeping_performance')
          .select(`
            *,
            rooms(room_number, hotel)
          `)
          .eq('housekeeper_id', housekeeperId)
          .gte('assignment_date', dateFrom)
          .order('completed_at', { ascending: false });

        if (metric === 'daily') {
          query = query.eq('assignment_type', 'daily_cleaning');
        } else if (metric === 'checkout') {
          query = query.eq('assignment_type', 'checkout_cleaning');
        }

        const { data: performanceData } = await query;
        setData(performanceData || []);

        if (performanceData) {
          const avgTime = performanceData.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / performanceData.length;
          const avgEfficiency = performanceData.reduce((sum, p) => sum + p.efficiency_score, 0) / performanceData.length;
          const onTimeCount = performanceData.filter(p => 
            !p.estimated_duration_minutes || p.actual_duration_minutes <= p.estimated_duration_minutes
          ).length;

          setSummary({
            total: performanceData.length,
            avgTime: Math.round(avgTime),
            avgEfficiency: Math.round(avgEfficiency),
            bestTime: Math.min(...performanceData.map(p => p.actual_duration_minutes)),
            onTimeRate: performanceData.length ? (onTimeCount / performanceData.length * 100) : 0
          });
        }
      }
    } catch (error) {
      console.error('Error fetching detail data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMetricTitle = () => {
    switch (metric) {
      case 'score': return 'Performance Score Details';
      case 'checkout': return 'Checkout Room Performance';
      case 'daily': return 'Daily Cleaning Performance';
      case 'punctual': return 'Punctuality Details';
      case 'breaks': return 'Break Management';
      case 'hours': return 'Working Hours Details';
      default: return 'Performance Details';
    }
  };

  const getMetricIcon = () => {
    switch (metric) {
      case 'score': return <Star className="h-5 w-5 text-yellow-500" />;
      case 'checkout': return <Clock className="h-5 w-5 text-green-500" />;
      case 'daily': return <Target className="h-5 w-5 text-blue-500" />;
      case 'punctual': return <CheckCircle className="h-5 w-5 text-purple-500" />;
      case 'breaks': return <TrendingUp className="h-5 w-5 text-orange-500" />;
      case 'hours': return <Clock className="h-5 w-5 text-orange-500" />;
      default: return <Star className="h-5 w-5" />;
    }
  };

  const renderPerformanceData = () => {
    if (metric === 'hours') {
      return (
        <div className="space-y-4">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-800">{summary.avgHours}h</div>
                <div className="text-sm text-orange-600">Avg Hours/Day</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-800">{summary.maxHours}h</div>
                <div className="text-sm text-green-600">Best Day</div>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-800">{summary.totalHours}h</div>
                <div className="text-sm text-blue-600">Total Hours</div>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-800">{summary.total}</div>
                <div className="text-sm text-purple-600">Days Worked</div>
              </div>
            </div>
          )}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {data.filter((a: any) => a.total_hours != null).map((attendance: any) => (
              <Card key={attendance.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{format(new Date(attendance.work_date), 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span>{format(new Date(attendance.check_in_time), 'HH:mm')} - {attendance.check_out_time ? format(new Date(attendance.check_out_time), 'HH:mm') : '-'}</span>
                    <Badge className={parseFloat(attendance.total_hours?.toString() || '0') >= 7.5 ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}>
                      {(parseFloat(attendance.total_hours?.toString() || '0') || 0).toFixed(1)}h
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      );
    }

    if (metric === 'punctual') {
      return (
        <div className="space-y-4">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-800">{summary.punctual}</div>
                <div className="text-sm text-green-600">On Time</div>
              </div>
                <div className="text-center p-3 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold text-red-800">{summary.late}</div>
                  <div className="text-sm text-red-600">{t('hr.late')}</div>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-800">{summary.total}</div>
                  <div className="text-sm text-blue-600">{t('hr.totalDays')}</div>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-800">{Math.round(summary.punctualityRate)}%</div>
                  <div className="text-sm text-purple-600">{t('hr.punctualityRate')}</div>
                </div>
            </div>
          )}
          
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {data.map((attendance: any, index) => (
              <Card key={attendance.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <span className="font-medium">{format(new Date(attendance.work_date), 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{format(new Date(attendance.check_in_time), 'HH:mm')}</span>
                    {new Date(`1970-01-01T${new Date(attendance.check_in_time).toTimeString()}`).getTime() <= 
                     new Date('1970-01-01T09:00:00').getTime() ? (
                      <Badge className="bg-green-100 text-green-800">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        On Time
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Late
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-800">{summary.avgTime}</div>
              <div className="text-sm text-blue-600">Avg Minutes</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-800">{summary.avgEfficiency}%</div>
              <div className="text-sm text-green-600">Avg Efficiency</div>
            </div>
            <div className="text-center p-3 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-800">{summary.bestTime}</div>
              <div className="text-sm text-purple-600">Best Time</div>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <div className="text-2xl font-bold text-orange-800">{Math.round(summary.onTimeRate)}%</div>
              <div className="text-sm text-orange-600">On-Time Rate</div>
            </div>
          </div>
        )}
        
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {data.map((performance: any, index) => (
            <Card key={performance.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-gray-500" />
                  <span className="font-medium">Room {performance.rooms?.room_number}</span>
                  <Badge variant="outline" className="text-xs">
                    {performance.assignment_type.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-center">
                    <div className="font-semibold">{performance.actual_duration_minutes}m</div>
                    <div className="text-gray-500">Duration</div>
                  </div>
                  <div className="text-center">
                    <div className={`font-semibold ${performance.efficiency_score >= 100 ? 'text-green-600' : 'text-orange-600'}`}>
                      {Math.round(performance.efficiency_score)}%
                    </div>
                    <div className="text-gray-500">Efficiency</div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {format(new Date(performance.completed_at), 'MMM dd, HH:mm')}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getMetricIcon()}
            {getMetricTitle()} - {fullName}
          </DialogTitle>
        </DialogHeader>
        
        <div className="mt-4">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            renderPerformanceData()
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}