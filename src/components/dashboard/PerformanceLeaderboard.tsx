import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy, Clock, TrendingUp, Medal, Star, Target, Info, HelpCircle } from 'lucide-react';
import { PerformanceDetailDialog } from './PerformanceDetailDialog';
import { useAuth } from '@/hooks/useAuth';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  late_check_ins?: any[]; // Track late arrivals after 2-day grace period
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
  const [timeframe, setTimeframe] = useState('7');
  const [loading, setLoading] = useState(true);
  const [detailDialog, setDetailDialog] = useState<{
    open: boolean;
    housekeeperId: string;
    fullName: string;
    metric: 'score' | 'checkout' | 'daily' | 'punctual' | 'breaks';
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
    // Speed Score (35 points max)
    // Daily: 20 points (faster is better, baseline 20min = full points)
    const dailySpeed = housekeeper.daily_avg_time > 0 ? 
      Math.min(20, Math.max(0, 20 - (housekeeper.daily_avg_time - 20) * 0.4)) : 0;
    
    // Checkout: 15 points (faster is better, baseline 45min = full points)
    const checkoutSpeed = housekeeper.checkout_avg_time > 0 ?
      Math.min(15, Math.max(0, 15 - (housekeeper.checkout_avg_time - 45) * 0.15)) : 0;

    // Punctuality Score (30 points max) - based on check-in times
    const punctuality = Math.min(housekeeper.punctuality_score || 0, 30);

    // Productivity Score (25 points max) - total rooms completed
    const totalRooms = (housekeeper.daily_completed || 0) + (housekeeper.checkout_completed || 0);
    const productivity = Math.min(totalRooms * 0.5, 25);

    // Efficiency Score (20 points max) - based on efficiency_score from performance table
    const efficiency = Math.min((housekeeper.avg_efficiency_score || 100) * 0.2, 20);

    const total = dailySpeed + checkoutSpeed + punctuality + productivity + efficiency;
    return Math.round(total);
  };

  const fetchData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const dateFrom = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Get current user profile to check assigned hotel
      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', user.id)
        .single();

      // Fetch housekeepers - filter by hotel if assigned
      let housekeeperQuery = supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'housekeeping');

      if (profileData?.assigned_hotel) {
        housekeeperQuery = housekeeperQuery.eq('assigned_hotel', profileData.assigned_hotel);
      }

      const { data: housekeepers } = await housekeeperQuery;

      if (!housekeepers || housekeepers.length === 0) {
        setLeaderboard([]);
        setOverviewStats({
          avgMinutes: 0,
          efficiency: 0,
          completed: 0,
          bestTime: 0,
          totalHousekeepers: 0
        });
        setLoading(false);
        return;
      }

      // Initialize aggregated stats
      let allPerformanceData: any[] = [];
      let allMinutes: number[] = [];
      let totalCompleted = 0;

      // Fetch performance data for all housekeepers
      const enhancedLeaderboard: LeaderboardEntry[] = [];
      
      for (const housekeeper of housekeepers) {
        // Performance data
        const { data: performanceData } = await supabase
          .from('housekeeping_performance')
          .select(`
            *,
            room_assignments!inner(is_dnd)
          `)
          .eq('housekeeper_id', housekeeper.id)
          .gte('assignment_date', dateFrom);

        // Filter out invalid performance data:
        // 1. Exclude DND rooms completely
        // 2. Checkout rooms: only >= 30 minutes (realistic time)
        // 3. Daily cleaning: only >= 5 minutes (realistic time)
        const validPerformanceData = performanceData?.filter(p => {
          // Exclude DND assignments completely
          if ((p as any).room_assignments?.is_dnd === true) {
            return false;
          }
          
          // Checkout rooms: minimum 30 minutes
          if (p.assignment_type === 'checkout_cleaning' && p.actual_duration_minutes < 30) {
            return false;
          }
          
          // Daily cleaning: minimum 5 minutes
          if (p.assignment_type === 'daily_cleaning' && p.actual_duration_minutes < 5) {
            return false;
          }
          
          return true;
        }) || [];

        if (validPerformanceData && validPerformanceData.length > 0) {
          allPerformanceData = [...allPerformanceData, ...validPerformanceData];
          totalCompleted += validPerformanceData.length;
          validPerformanceData.forEach(p => allMinutes.push(p.actual_duration_minutes));
        }

        // Attendance data for punctuality
        const { data: attendanceData } = await supabase
          .from('staff_attendance')
          .select('*')
          .eq('user_id', housekeeper.id)
          .gte('work_date', dateFrom)
          .not('check_out_time', 'is', null);

        // Separate daily and checkout performance (already filtered for valid times)
        const dailyPerf = validPerformanceData?.filter(p => p.assignment_type === 'daily_cleaning') || [];
        const checkoutPerf = validPerformanceData?.filter(p => p.assignment_type === 'checkout_cleaning') || [];

        // Calculate metrics for this housekeeper
        const dailyAvgTime = dailyPerf.length ? 
          Math.round(dailyPerf.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / dailyPerf.length) : 0;
        
        const checkoutAvgTime = checkoutPerf.length ?
          Math.round(checkoutPerf.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / checkoutPerf.length) : 0;

        const avgEfficiency = validPerformanceData?.length ?
          Math.round(validPerformanceData.reduce((sum, p) => sum + p.efficiency_score, 0) / validPerformanceData.length) : 100;

        const avgDuration = validPerformanceData?.length ?
          Math.round(validPerformanceData.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / validPerformanceData.length) : 0;

        // Calculate punctuality (8:05 AM is the cutoff - 5 minute grace period from 8:00 AM start)
        const punctualDays = attendanceData?.filter(a => 
          new Date(`1970-01-01T${new Date(a.check_in_time).toTimeString()}`).getTime() <= 
          new Date('1970-01-01T08:05:00').getTime()
        ).length || 0;
        
        // Track late check-ins (after 8:05 AM)
        const lateCheckIns = attendanceData?.filter(a => 
          new Date(`1970-01-01T${new Date(a.check_in_time).toTimeString()}`).getTime() > 
          new Date('1970-01-01T08:05:00').getTime()
        ) || [];
        
        const totalAttendanceDays = attendanceData?.length || 1;
        const punctualityRate = totalAttendanceDays > 0 ? punctualDays / totalAttendanceDays : 0;
        const punctualityScore = punctualityRate * 30; // Max 30 points

        // Calculate on-time completion rate
        const onTimeCompletions = validPerformanceData?.filter(p => 
          !p.estimated_duration_minutes || p.actual_duration_minutes <= p.estimated_duration_minutes
        ).length || 0;
        const onTimeRate = validPerformanceData?.length ? onTimeCompletions / validPerformanceData.length : 0;

        if (validPerformanceData && validPerformanceData.length > 0) {
          const housekeeperEntry: LeaderboardEntry = {
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
            performance_score: 0, // Will be calculated next
            rank_position: 0, // Will be set after sorting
            late_check_ins: lateCheckIns.length > 2 ? lateCheckIns : [] // Only show if more than 2 (after grace period)
          };

          housekeeperEntry.performance_score = calculatePerformanceScore(housekeeperEntry);
          enhancedLeaderboard.push(housekeeperEntry);
        }
      }

      // Sort by performance score and assign ranks
      enhancedLeaderboard.sort((a, b) => (b.performance_score || 0) - (a.performance_score || 0));
      enhancedLeaderboard.forEach((entry, index) => {
        entry.rank_position = index + 1;
      });

      // Calculate overview stats from ALL performance data (already filtered for valid times and excluding DND)
      const avgMinutes = allMinutes.length > 0 ? 
        Math.round(allMinutes.reduce((sum, m) => sum + m, 0) / allMinutes.length) : 0;
      
      const avgEfficiency = allPerformanceData.length > 0 ?
        Math.round(allPerformanceData.reduce((sum, p) => sum + p.efficiency_score, 0) / allPerformanceData.length) : 0;
      
      // Filter out extremely high times (> 180 minutes - likely errors)
      // Already filtered for minimums at data level (30 min checkout, 5 min daily)
      const realisticTimes = allMinutes.filter(m => m <= 180);
      const bestTime = realisticTimes.length > 0 ? Math.min(...realisticTimes) : 0;

      setOverviewStats({
        avgMinutes,
        efficiency: avgEfficiency,
        completed: totalCompleted,
        bestTime,
        totalHousekeepers: enhancedLeaderboard.length
      });

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
      default: return <div className="w-5 h-5 flex items-center justify-center text-sm font-bold">{rank}</div>;
    }
  };

  const getPerformanceBadge = (score: number) => {
    if (score >= 85) return <Badge className="bg-green-100 text-green-800">{t('performance.excellent')}</Badge>;
    if (score >= 70) return <Badge className="bg-blue-100 text-blue-800">{t('performance.great')}</Badge>;
    if (score >= 55) return <Badge className="bg-yellow-100 text-yellow-800">{t('performance.good')}</Badge>;
    if (score >= 40) return <Badge variant="secondary">{t('performance.average')}</Badge>;
    return <Badge variant="destructive">{t('performance.needsFocus')}</Badge>;
  };

  const openDetailDialog = (housekeeperId: string, fullName: string, metric: 'score' | 'checkout' | 'daily' | 'punctual' | 'breaks') => {
    setDetailDialog({
      open: true,
      housekeeperId,
      fullName,
      metric
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
        <p className="text-muted-foreground">{t('performance.loadingData')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      {/* Scoring Explanation - Mobile Optimized */}
      <Alert className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-300 shadow-sm">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-1 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <AlertDescription className="text-blue-900">
              <div className="font-bold text-base sm:text-lg mb-3 text-blue-800">📊 {t('performance.scoreBreakdown')}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
                <div className="bg-white/60 p-3 rounded-lg border border-blue-200">
                  <div className="font-bold text-blue-800 mb-1">⚡ {t('performance.speed')} (35pts)</div>
                  <div className="text-blue-700">{t('performance.speedPoints')}</div>
                  <div className="text-blue-600 text-xs mt-1">{t('performance.speedNote')}</div>
                </div>
                <div className="bg-white/60 p-3 rounded-lg border border-blue-200">
                  <div className="font-bold text-blue-800 mb-1">⏰ {t('performance.punctuality')} (30pts)</div>
                  <div className="text-blue-700">{t('performance.punctualityTime')}</div>
                  <div className="text-blue-600 text-xs mt-1">{t('performance.punctualityNote')}</div>
                </div>
                <div className="bg-white/60 p-3 rounded-lg border border-blue-200">
                  <div className="font-bold text-blue-800 mb-1">🎯 {t('performance.productivity')} (25pts)</div>
                  <div className="text-blue-700">{t('performance.productivityPoints')}</div>
                  <div className="text-blue-600 text-xs mt-1">{t('performance.productivityNote')}</div>
                </div>
                <div className="bg-white/60 p-3 rounded-lg border border-blue-200">
                  <div className="font-bold text-blue-800 mb-1">✨ {t('performance.efficiency')} (20pts)</div>
                  <div className="text-blue-700">{t('performance.efficiencyQuality')}</div>
                  <div className="text-blue-600 text-xs mt-1">{t('performance.efficiencyNote')}</div>
                </div>
              </div>
              <div className="mt-3 p-2 bg-blue-100 rounded-lg">
                <p className="text-xs text-blue-800">
                  <strong>🏆 {t('performance.selectionCriteria')}</strong> {t('performance.criteriaDescription')}
                </p>
              </div>
            </AlertDescription>
          </div>
        </div>
      </Alert>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="cursor-help hover:shadow-lg transition-shadow">
          <CardContent className="p-6 text-center">
            <Clock className="h-8 w-8 mx-auto mb-2 text-blue-500" />
            <div className="text-3xl font-bold">{overviewStats.avgMinutes}</div>
            <div className="text-sm text-muted-foreground">{t('performance.avgMinutes')}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('performance.avgMinutesDesc')}
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-help hover:shadow-lg transition-shadow">
          <CardContent className="p-6 text-center">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <div className="text-3xl font-bold">{overviewStats.efficiency}%</div>
            <div className="text-sm text-muted-foreground">{t('performance.efficiency')}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('performance.efficiencyAvg')}
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-help hover:shadow-lg transition-shadow">
          <CardContent className="p-6 text-center">
            <Target className="h-8 w-8 mx-auto mb-2 text-purple-500" />
            <div className="text-3xl font-bold">{overviewStats.completed}</div>
            <div className="text-sm text-muted-foreground">{t('performance.completed')}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('performance.completedDesc')}
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-help hover:shadow-lg transition-shadow">
          <CardContent className="p-6 text-center">
            <Star className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
            <div className="text-3xl font-bold">{overviewStats.bestTime}</div>
            <div className="text-sm text-muted-foreground">{t('performance.bestTime')}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('performance.bestTimeDesc')}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              {t('performance.ranking')} - {timeframe}d
            </span>
            <Badge variant="outline">{overviewStats.totalHousekeepers} {t('performance.active')}</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {t('performance.rankedBy')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {leaderboard.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('performance.noData')}
            </div>
          ) : (
            leaderboard.map((entry) => (
              <Card key={entry.housekeeper_id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {getRankIcon(entry.rank_position)}
                      <div>
                        <div className="font-bold text-lg">{entry.full_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {t('performance.daily')}: {entry.daily_completed} • {t('performance.checkout')}: {entry.checkout_completed} {t('performance.rooms')}
                        </div>
                      </div>
                    </div>
                    {getPerformanceBadge(entry.performance_score)}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div 
                            className="text-center p-3 bg-yellow-50 rounded-lg cursor-pointer hover:bg-yellow-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'score')}
                          >
                            <div className="text-2xl font-bold text-yellow-700">{entry.performance_score}</div>
                            <div className="text-xs text-yellow-600">{t('performance.score')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickScore')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div 
                            className="text-center p-3 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'daily')}
                          >
                            <div className="text-2xl font-bold text-blue-700">{entry.daily_avg_time}m</div>
                            <div className="text-xs text-blue-600">{t('performance.daily')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickDaily')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div 
                            className="text-center p-3 bg-green-50 rounded-lg cursor-pointer hover:bg-green-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'checkout')}
                          >
                            <div className="text-2xl font-bold text-green-700">{entry.checkout_avg_time}m</div>
                            <div className="text-xs text-green-600">{t('performance.checkout')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickCheckout')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div 
                            className="text-center p-3 bg-purple-50 rounded-lg cursor-pointer hover:bg-purple-100 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'punctual')}
                          >
                            <div className="text-2xl font-bold text-purple-700">{Math.round(entry.punctuality_rate)}%</div>
                            <div className="text-xs text-purple-600">{t('performance.punctual')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>{t('performance.clickAttendance')}</TooltipContent>
                      </Tooltip>
                     </TooltipProvider>
                  </div>

                  {/* Show late check-in warning if more than 2 late arrivals */}
                  {entry.late_check_ins && entry.late_check_ins.length > 0 && (
                    <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <div className="text-orange-600 font-semibold text-sm flex items-center gap-1">
                          ⚠️ {t('performance.lateArrivals')} ({entry.late_check_ins.length})
                        </div>
                      </div>
                      <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                        {entry.late_check_ins.slice(0, 5).map((attendance: any, idx: number) => (
                          <div key={idx} className="text-xs text-orange-700 flex justify-between">
                            <span>{new Date(attendance.work_date).toLocaleDateString()}</span>
                            <span className="font-medium">
                              {new Date(attendance.check_in_time).toLocaleTimeString('en-US', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </span>
                          </div>
                        ))}
                        {entry.late_check_ins.length > 5 && (
                          <div className="text-xs text-orange-600 italic">
                            +{entry.late_check_ins.length - 5} {t('performance.moreLate')}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-orange-600">
                        {t('performance.arrivalNote')}
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
