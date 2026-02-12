import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Trophy, Clock, TrendingUp, Medal, Star, Target, HelpCircle, AlertTriangle, Zap, Timer, Users } from 'lucide-react';
import { PerformanceDetailDialog } from './PerformanceDetailDialog';
import { useAuth } from '@/hooks/useAuth';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/useTranslation';

interface LeaderboardEntry {
  housekeeper_id: string;
  full_name: string;
  avg_duration_minutes: number;
  avg_efficiency_score: number;
  total_completed: number;
  rank_position: number;
  daily_avg_time: number;
  checkout_avg_time: number;
  daily_completed: number;
  checkout_completed: number;
  punctuality_score: number;
  punctuality_rate: number;
  performance_score: number;
  on_time_rate: number;
  avg_working_hours: number;
  rooms_per_hour: number;
  rooms_per_day: number;
  attendance_streak: number;
  late_check_ins?: any[];
}

interface OverviewStats {
  avgMinutes: number;
  efficiency: number;
  completed: number;
  bestTime: number;
  totalHousekeepers: number;
}

export function PerformanceLeaderboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [overviewStats, setOverviewStats] = useState<OverviewStats>({
    avgMinutes: 0,
    efficiency: 0,
    completed: 0,
    bestTime: 0,
    totalHousekeepers: 0
  });
  const [timeframe, setTimeframe] = useState('30');
  const [loading, setLoading] = useState(true);
  const [detailDialog, setDetailDialog] = useState<{
    open: boolean;
    housekeeperId: string;
    fullName: string;
    metric: 'score' | 'checkout' | 'daily' | 'punctual' | 'breaks' | 'hours';
  }>({
    open: false,
    housekeeperId: '',
    fullName: '',
    metric: 'score'
  });

  useEffect(() => {
    fetchData();
  }, [timeframe, user]);

  const calculatePerformanceScore = (housekeeper: any) => {
    const dailySpeed = housekeeper.daily_avg_time > 0 ? 
      Math.min(20, Math.max(0, 20 - (housekeeper.daily_avg_time - 20) * 0.4)) : 0;
    const checkoutSpeed = housekeeper.checkout_avg_time > 0 ?
      Math.min(15, Math.max(0, 15 - (housekeeper.checkout_avg_time - 45) * 0.15)) : 0;
    const punctuality = Math.min(housekeeper.punctuality_score || 0, 30);
    const totalRooms = (housekeeper.daily_completed || 0) + (housekeeper.checkout_completed || 0);
    const productivity = Math.min(totalRooms * 0.5, 25);
    const efficiency = Math.min((housekeeper.avg_efficiency_score || 100) * 0.2, 20);
    const total = dailySpeed + checkoutSpeed + punctuality + productivity + efficiency;
    return Math.round(total);
  };

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const dateFrom = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel, organization_slug')
        .eq('id', user.id)
        .single();

      let hotelNames: string[] = [];
      if (profileData?.assigned_hotel) {
        const { data: hotelConfig } = await supabase
          .from('hotel_configurations')
          .select('hotel_name, hotel_id')
          .or(`hotel_id.eq.${profileData.assigned_hotel},hotel_name.ilike.%${profileData.assigned_hotel}%`)
          .limit(1)
          .maybeSingle();
        if (hotelConfig) {
          hotelNames = [hotelConfig.hotel_name, hotelConfig.hotel_id, profileData.assigned_hotel];
        } else {
          hotelNames = [profileData.assigned_hotel];
        }
      }

      const { data: allHousekeepers } = await supabase
        .from('profiles')
        .select('id, full_name, assigned_hotel')
        .eq('role', 'housekeeping')
        .eq('organization_slug', profileData?.organization_slug || '');

      let housekeepers = allHousekeepers || [];
      if (hotelNames.length > 0) {
        housekeepers = housekeepers.filter(hk => {
          if (!hk.assigned_hotel) return false;
          const hkHotel = hk.assigned_hotel.toLowerCase();
          return hotelNames.some(h => 
            hkHotel === h.toLowerCase() || hkHotel.includes(h.toLowerCase()) || h.toLowerCase().includes(hkHotel)
          );
        });
      }

      if (!housekeepers || housekeepers.length === 0) {
        setLeaderboard([]);
        setOverviewStats({ avgMinutes: 0, efficiency: 0, completed: 0, bestTime: 0, totalHousekeepers: 0 });
        setLoading(false);
        return;
      }

      let allPerformanceData: any[] = [];
      let allMinutes: number[] = [];
      let totalCompleted = 0;
      const enhancedLeaderboard: LeaderboardEntry[] = [];
      
      for (const housekeeper of housekeepers) {
        const { data: performanceData } = await supabase
          .from('housekeeping_performance')
          .select('*, room_assignments(is_dnd)')
          .eq('housekeeper_id', housekeeper.id)
          .gte('assignment_date', dateFrom);

        const validPerformanceData = performanceData?.filter(p => {
          if ((p as any).room_assignments?.is_dnd === true) return false;
          if (p.assignment_type === 'checkout_cleaning' && p.actual_duration_minutes < 30) return false;
          if (p.assignment_type === 'daily_cleaning' && p.actual_duration_minutes < 5) return false;
          return true;
        }) || [];

        if (validPerformanceData.length > 0) {
          allPerformanceData = [...allPerformanceData, ...validPerformanceData];
          totalCompleted += validPerformanceData.length;
          validPerformanceData.forEach(p => allMinutes.push(p.actual_duration_minutes));
        }

        // Attendance data
        const { data: attendanceData } = await supabase
          .from('staff_attendance')
          .select('*')
          .eq('user_id', housekeeper.id)
          .gte('work_date', dateFrom)
          .not('check_out_time', 'is', null)
          .order('work_date', { ascending: false });

        // Calculate working hours
        const totalWorkingHours = attendanceData?.reduce((sum, a) => sum + (parseFloat(a.total_hours?.toString() || '0') || 0), 0) || 0;
        const avgWorkingHours = attendanceData?.length ? totalWorkingHours / attendanceData.length : 0;

        // Calculate rooms per hour and per day
        const roomsPerHour = totalWorkingHours > 0 ? validPerformanceData.length / totalWorkingHours : 0;
        const uniqueDays = new Set(validPerformanceData.map(p => p.assignment_date)).size;
        const roomsPerDay = uniqueDays > 0 ? validPerformanceData.length / uniqueDays : 0;

        // Calculate attendance streak (consecutive on-time days)
        let streak = 0;
        if (attendanceData) {
          for (const a of attendanceData) {
            const checkInTime = new Date(`1970-01-01T${new Date(a.check_in_time).toTimeString()}`).getTime();
            const cutoff = new Date('1970-01-01T08:05:00').getTime();
            if (checkInTime <= cutoff) streak++;
            else break;
          }
        }

        const dailyPerf = validPerformanceData.filter(p => p.assignment_type === 'daily_cleaning');
        const checkoutPerf = validPerformanceData.filter(p => p.assignment_type === 'checkout_cleaning');

        const dailyAvgTime = dailyPerf.length ? Math.round(dailyPerf.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / dailyPerf.length) : 0;
        const checkoutAvgTime = checkoutPerf.length ? Math.round(checkoutPerf.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / checkoutPerf.length) : 0;
        const avgEfficiency = validPerformanceData.length ? Math.round(validPerformanceData.reduce((sum, p) => sum + p.efficiency_score, 0) / validPerformanceData.length) : 100;
        const avgDuration = validPerformanceData.length ? Math.round(validPerformanceData.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / validPerformanceData.length) : 0;

        const punctualDays = attendanceData?.filter(a => 
          new Date(`1970-01-01T${new Date(a.check_in_time).toTimeString()}`).getTime() <= new Date('1970-01-01T08:05:00').getTime()
        ).length || 0;
        const lateCheckIns = attendanceData?.filter(a => 
          new Date(`1970-01-01T${new Date(a.check_in_time).toTimeString()}`).getTime() > new Date('1970-01-01T08:05:00').getTime()
        ) || [];
        const totalAttendanceDays = attendanceData?.length || 1;
        const punctualityRate = totalAttendanceDays > 0 ? punctualDays / totalAttendanceDays : 0;
        const punctualityScore = punctualityRate * 30;

        const onTimeCompletions = validPerformanceData.filter(p => !p.estimated_duration_minutes || p.actual_duration_minutes <= p.estimated_duration_minutes).length;
        const onTimeRate = validPerformanceData.length ? onTimeCompletions / validPerformanceData.length : 0;

        if (validPerformanceData.length > 0) {
          const entry: LeaderboardEntry = {
            housekeeper_id: housekeeper.id,
            full_name: housekeeper.full_name,
            avg_duration_minutes: avgDuration,
            avg_efficiency_score: avgEfficiency,
            total_completed: validPerformanceData.length,
            daily_avg_time: dailyAvgTime,
            checkout_avg_time: checkoutAvgTime,
            daily_completed: dailyPerf.length,
            checkout_completed: checkoutPerf.length,
            punctuality_score: punctualityScore,
            punctuality_rate: punctualityRate * 100,
            on_time_rate: onTimeRate * 100,
            performance_score: 0,
            rank_position: 0,
            avg_working_hours: Math.round(avgWorkingHours * 10) / 10,
            rooms_per_hour: Math.round(roomsPerHour * 10) / 10,
            rooms_per_day: Math.round(roomsPerDay * 10) / 10,
            attendance_streak: streak,
            late_check_ins: lateCheckIns.length > 2 ? lateCheckIns : []
          };
          entry.performance_score = calculatePerformanceScore(entry);
          enhancedLeaderboard.push(entry);
        }
      }

      enhancedLeaderboard.sort((a, b) => (b.performance_score || 0) - (a.performance_score || 0));
      enhancedLeaderboard.forEach((entry, index) => { entry.rank_position = index + 1; });

      const avgMinutes = allMinutes.length > 0 ? Math.round(allMinutes.reduce((sum, m) => sum + m, 0) / allMinutes.length) : 0;
      const avgEfficiency = allPerformanceData.length > 0 ? Math.round(allPerformanceData.reduce((sum, p) => sum + p.efficiency_score, 0) / allPerformanceData.length) : 0;
      const realisticTimes = allMinutes.filter(m => m <= 180);
      const bestTime = realisticTimes.length > 0 ? Math.min(...realisticTimes) : 0;

      setOverviewStats({ avgMinutes, efficiency: avgEfficiency, completed: totalCompleted, bestTime, totalHousekeepers: enhancedLeaderboard.length });
      setLeaderboard(enhancedLeaderboard);
    } catch (error) {
      console.error('Error fetching performance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 2: return <Medal className="h-5 w-5 text-gray-400" />;
      case 3: return <Medal className="h-5 w-5 text-amber-600" />;
      default: return <div className="w-5 h-5 flex items-center justify-center text-sm font-bold text-muted-foreground">{rank}</div>;
    }
  };

  const getPerformanceBadge = (score: number) => {
    if (score >= 85) return <Badge className="bg-green-100 text-green-800">{t('performance.excellent')}</Badge>;
    if (score >= 70) return <Badge className="bg-blue-100 text-blue-800">{t('performance.great')}</Badge>;
    if (score >= 55) return <Badge className="bg-yellow-100 text-yellow-800">{t('performance.good')}</Badge>;
    if (score >= 40) return <Badge variant="secondary">{t('performance.average')}</Badge>;
    return <Badge variant="destructive">{t('performance.needsFocus')}</Badge>;
  };

  const getTierColor = (score: number) => {
    if (score >= 85) return 'border-l-4 border-l-green-500';
    if (score >= 70) return 'border-l-4 border-l-blue-500';
    if (score >= 55) return 'border-l-4 border-l-yellow-500';
    return 'border-l-4 border-l-red-500';
  };

  const getProgressColor = (score: number) => {
    if (score >= 85) return 'bg-green-500';
    if (score >= 70) return 'bg-blue-500';
    if (score >= 55) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const openDetailDialog = (housekeeperId: string, fullName: string, metric: 'score' | 'checkout' | 'daily' | 'punctual' | 'breaks' | 'hours') => {
    setDetailDialog({ open: true, housekeeperId, fullName, metric });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
        <p className="text-muted-foreground">{t('performance.loadingData')}</p>
      </div>
    );
  }

  const topPerformer = leaderboard[0];
  const needsAttention = leaderboard.length > 1 ? leaderboard[leaderboard.length - 1] : null;
  const teamAvgScore = leaderboard.length > 0 ? Math.round(leaderboard.reduce((s, e) => s + e.performance_score, 0) / leaderboard.length) : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-500" />
          <h2 className="text-lg sm:text-2xl font-bold">{t('performance.analytics')}</h2>
        </div>
        <Tabs value={timeframe} onValueChange={setTimeframe}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="7" className="flex-1 sm:flex-none">{t('performance.days7')}</TabsTrigger>
            <TabsTrigger value="30" className="flex-1 sm:flex-none">{t('performance.days30')}</TabsTrigger>
            <TabsTrigger value="90" className="flex-1 sm:flex-none">{t('performance.days90')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Collapsible Scoring Explanation */}
      <Accordion type="single" collapsible>
        <AccordionItem value="scoring" className="border rounded-lg bg-muted/30">
          <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline">
            <span className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">📊 {t('performance.scoreBreakdown')}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
              <div className="bg-background p-2 rounded border">
                <div className="font-bold mb-0.5">⚡ {t('performance.speed')} (35pts)</div>
                <div className="text-muted-foreground">{t('performance.speedPoints')}</div>
              </div>
              <div className="bg-background p-2 rounded border">
                <div className="font-bold mb-0.5">⏰ {t('performance.punctuality')} (30pts)</div>
                <div className="text-muted-foreground">{t('performance.punctualityTime')}</div>
              </div>
              <div className="bg-background p-2 rounded border">
                <div className="font-bold mb-0.5">🎯 {t('performance.productivity')} (25pts)</div>
                <div className="text-muted-foreground">{t('performance.productivityPoints')}</div>
              </div>
              <div className="bg-background p-2 rounded border">
                <div className="font-bold mb-0.5">✨ {t('performance.efficiency')} (20pts)</div>
                <div className="text-muted-foreground">{t('performance.efficiencyQuality')}</div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Top Performer & Needs Attention Highlights */}
      {leaderboard.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Top Performer */}
          {topPerformer && (
            <Card className="border-l-4 border-l-green-500 bg-green-50/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-4 w-4 text-yellow-500" />
                  <span className="text-xs font-semibold text-green-700 uppercase">Top Performer</span>
                </div>
                <div className="font-bold text-lg truncate">{topPerformer.full_name}</div>
                <div className="flex items-center gap-3 mt-1 text-sm text-green-700">
                  <span className="font-semibold">{topPerformer.performance_score} pts</span>
                  <span>•</span>
                  <span>{topPerformer.rooms_per_day} rooms/day</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Team Average */}
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Team Average</span>
              </div>
              <div className="font-bold text-lg">{teamAvgScore} pts</div>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span>{overviewStats.totalHousekeepers} active</span>
                <span>•</span>
                <span>{overviewStats.completed} rooms</span>
              </div>
            </CardContent>
          </Card>

          {/* Needs Attention */}
          {needsAttention && needsAttention.performance_score < 55 && (
            <Card className="border-l-4 border-l-red-500 bg-red-50/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-xs font-semibold text-red-700 uppercase">Needs Attention</span>
                </div>
                <div className="font-bold text-lg truncate">{needsAttention.full_name}</div>
                <div className="flex items-center gap-3 mt-1 text-sm text-red-700">
                  <span className="font-semibold">{needsAttention.performance_score} pts</span>
                  <span>•</span>
                  <span>{Math.round(needsAttention.punctuality_rate)}% on-time</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="h-6 w-6 mx-auto mb-1 text-blue-500" />
            <div className="text-2xl font-bold">{overviewStats.avgMinutes}m</div>
            <div className="text-xs text-muted-foreground">{t('performance.avgMinutes')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-6 w-6 mx-auto mb-1 text-green-500" />
            <div className="text-2xl font-bold">{overviewStats.efficiency}%</div>
            <div className="text-xs text-muted-foreground">{t('performance.efficiency')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Target className="h-6 w-6 mx-auto mb-1 text-purple-500" />
            <div className="text-2xl font-bold">{overviewStats.completed}</div>
            <div className="text-xs text-muted-foreground">{t('performance.completed')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Star className="h-6 w-6 mx-auto mb-1 text-yellow-500" />
            <div className="text-2xl font-bold">{overviewStats.bestTime}m</div>
            <div className="text-xs text-muted-foreground">{t('performance.bestTime')}</div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-base sm:text-lg">
              <Trophy className="h-5 w-5" />
              {t('performance.ranking')} - {timeframe}d
            </span>
            <Badge variant="outline">{overviewStats.totalHousekeepers} {t('performance.active')}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {leaderboard.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{t('performance.noData')}</div>
          ) : (
            leaderboard.map((entry) => (
              <Card key={entry.housekeeper_id} className={`${getTierColor(entry.performance_score)} hover:shadow-md transition-shadow`}>
                <CardContent className="p-3 sm:p-4">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {getRankIcon(entry.rank_position)}
                      <div className="min-w-0">
                        <div className="font-bold text-sm sm:text-base truncate">{entry.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {entry.daily_completed} daily • {entry.checkout_completed} checkout
                        </div>
                      </div>
                    </div>
                    {getPerformanceBadge(entry.performance_score)}
                  </div>

                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{entry.performance_score}/110</span>
                      {entry.attendance_streak > 0 && (
                        <span className="text-green-600">🔥 {entry.attendance_streak} day streak</span>
                      )}
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${getProgressColor(entry.performance_score)}`}
                        style={{ width: `${Math.min(100, (entry.performance_score / 110) * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Metrics grid - 3 cols on mobile, 6 on desktop */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-yellow-50 rounded-lg cursor-pointer hover:bg-yellow-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'score')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-yellow-700">{entry.performance_score}</div>
                            <div className="text-[10px] sm:text-xs text-yellow-600">{t('performance.score')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickScore')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'daily')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-blue-700">
                              {entry.daily_completed === 0 ? '-' : `${entry.daily_avg_time}m`}
                            </div>
                            <div className="text-[10px] sm:text-xs text-blue-600">{t('performance.daily')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickDaily')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-green-50 rounded-lg cursor-pointer hover:bg-green-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'checkout')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-green-700">
                              {entry.checkout_completed === 0 ? '-' : `${entry.checkout_avg_time}m`}
                            </div>
                            <div className="text-[10px] sm:text-xs text-green-600">{t('performance.checkout')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickCheckout')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-purple-50 rounded-lg cursor-pointer hover:bg-purple-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'punctual')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-purple-700">{Math.round(entry.punctuality_rate)}%</div>
                            <div className="text-[10px] sm:text-xs text-purple-600">{t('performance.punctual')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickAttendance')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-orange-50 rounded-lg cursor-pointer hover:bg-orange-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'hours')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-orange-700">{entry.avg_working_hours}h</div>
                            <div className="text-[10px] sm:text-xs text-orange-600">Hours</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Avg working hours per day (8.5h max)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-center p-2 bg-teal-50 rounded-lg cursor-pointer hover:bg-teal-100 transition-colors">
                            <div className="text-lg sm:text-xl font-bold text-teal-700">{entry.rooms_per_day}</div>
                            <div className="text-[10px] sm:text-xs text-teal-600">Rooms/Day</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Average rooms cleaned per day ({entry.rooms_per_hour}/hr)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Late check-in warning */}
                  {entry.late_check_ins && entry.late_check_ins.length > 0 && (
                    <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-lg">
                      <div className="text-orange-600 font-semibold text-xs flex items-center gap-1">
                        ⚠️ {t('performance.lateArrivals')} ({entry.late_check_ins.length})
                      </div>
                      <div className="mt-1 space-y-0.5 max-h-20 overflow-y-auto">
                        {entry.late_check_ins.slice(0, 3).map((attendance: any, idx: number) => (
                          <div key={idx} className="text-[10px] text-orange-700 flex justify-between">
                            <span>{new Date(attendance.work_date).toLocaleDateString()}</span>
                            <span className="font-medium">
                              {new Date(attendance.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                        {entry.late_check_ins.length > 3 && (
                          <div className="text-[10px] text-orange-600 italic">+{entry.late_check_ins.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <PerformanceDetailDialog
        open={detailDialog.open}
        onOpenChange={(open) => setDetailDialog({ ...detailDialog, open })}
        housekeeperId={detailDialog.housekeeperId}
        fullName={detailDialog.fullName}
        metric={detailDialog.metric}
        timeframe={timeframe}
      />
    </div>
  );
}
