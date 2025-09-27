import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy, Clock, TrendingUp, Medal, Star, Target } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface LeaderboardEntry {
  housekeeper_id: string;
  full_name: string;
  avg_duration_minutes: number;
  avg_efficiency_score: number;
  total_completed: number;
  rank_position: number;
  daily_avg_time?: number;
  checkout_avg_time?: number;
  daily_completed?: number;
  checkout_completed?: number;
  punctuality_score?: number;
  attendance_rate?: number;
  performance_score?: number;
  on_time_completion_rate?: number;
}

interface PerformanceStats {
  avg_duration_minutes: number;
  avg_efficiency_score: number;
  total_completed: number;
  best_time_minutes: number;
  total_rooms_today: number;
}

export function PerformanceLeaderboard() {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [personalStats, setPersonalStats] = useState<PerformanceStats | null>(null);
  const [enhancedStats, setEnhancedStats] = useState<any>(null);
  const [timeframe, setTimeframe] = useState('7');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [timeframe, user]);

  const calculatePerformanceScore = (housekeeper: any) => {
    let score = 0;
    
    // Punctuality Score (30 points max)
    const punctualityScore = Math.min(housekeeper.punctuality_score || 0, 30);
    
    // Cleaning Speed Score (25 points max)
    // Lower time = higher score, with diminishing returns
    const dailySpeedScore = housekeeper.daily_avg_time ? 
      Math.max(0, 15 - (housekeeper.daily_avg_time - 20) * 0.5) : 0;
    const checkoutSpeedScore = housekeeper.checkout_avg_time ? 
      Math.max(0, 10 - (housekeeper.checkout_avg_time - 45) * 0.2) : 0;
    
    // Productivity Score (25 points max)
    const totalRooms = (housekeeper.daily_completed || 0) + (housekeeper.checkout_completed || 0);
    const productivityScore = Math.min(totalRooms * 0.5, 25);
    
    // Efficiency Score (20 points max)
    const efficiencyScore = Math.min((housekeeper.avg_efficiency_score || 100) * 0.2, 20);
    
    score = punctualityScore + dailySpeedScore + checkoutSpeedScore + productivityScore + efficiencyScore;
    return Math.round(score);
  };

  const fetchData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const dateFrom = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Fetch all housekeepers
      const { data: housekeepers } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'housekeeping');

      if (!housekeepers) {
        setLeaderboard([]);
        return;
      }

      // Fetch performance data for all housekeepers
      const enhancedLeaderboard: LeaderboardEntry[] = [];
      
      for (const housekeeper of housekeepers) {
        // Performance data
        const { data: performanceData } = await supabase
          .from('housekeeping_performance')
          .select('*')
          .eq('housekeeper_id', housekeeper.id)
          .gte('assignment_date', dateFrom);

        // Attendance data
        const { data: attendanceData } = await supabase
          .from('staff_attendance')
          .select('*')
          .eq('user_id', housekeeper.id)
          .gte('work_date', dateFrom)
          .not('check_out_time', 'is', null);

        // Separate daily and checkout performance
        const dailyPerf = performanceData?.filter(p => p.assignment_type === 'daily_cleaning') || [];
        const checkoutPerf = performanceData?.filter(p => p.assignment_type === 'checkout_cleaning') || [];

        // Calculate metrics
        const dailyAvgTime = dailyPerf.length ? 
          dailyPerf.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / dailyPerf.length : 0;
        
        const checkoutAvgTime = checkoutPerf.length ?
          checkoutPerf.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / checkoutPerf.length : 0;

        const avgEfficiency = performanceData?.length ?
          performanceData.reduce((sum, p) => sum + p.efficiency_score, 0) / performanceData.length : 100;

        const avgDuration = performanceData?.length ?
          performanceData.reduce((sum, p) => sum + p.actual_duration_minutes, 0) / performanceData.length : 0;

        // Calculate punctuality score
        const punctualDays = attendanceData?.filter(a => 
          new Date(`1970-01-01T${new Date(a.check_in_time).toTimeString()}`).getTime() <= 
          new Date('1970-01-01T09:00:00').getTime()
        ).length || 0;
        
        const totalAttendanceDays = attendanceData?.length || 1;
        const punctualityRate = punctualDays / totalAttendanceDays;
        const punctualityScore = punctualityRate * 30; // Max 30 points

        // Calculate on-time completion rate
        const onTimeCompletions = performanceData?.filter(p => 
          !p.estimated_duration_minutes || p.actual_duration_minutes <= p.estimated_duration_minutes
        ).length || 0;
        const onTimeRate = performanceData?.length ? onTimeCompletions / performanceData.length : 0;

        if (performanceData && performanceData.length > 0) {
        const housekeeperEntry: LeaderboardEntry = {
          housekeeper_id: housekeeper.id,
          full_name: housekeeper.full_name,
          avg_duration_minutes: avgDuration,
          avg_efficiency_score: avgEfficiency,
          total_completed: performanceData.length,
          daily_avg_time: dailyAvgTime,
          checkout_avg_time: checkoutAvgTime,
          daily_completed: dailyPerf.length,
          checkout_completed: checkoutPerf.length,
          punctuality_score: punctualityScore,
          attendance_rate: punctualityRate * 100,
          on_time_completion_rate: onTimeRate * 100,
          performance_score: 0, // Will be calculated next
          rank_position: 0 // Will be set after sorting
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

      // Fetch personal stats
      const { data: statsData } = await supabase.rpc('get_housekeeper_performance_stats', {
        target_housekeeper_id: user.id,
        days_back: parseInt(timeframe)
      });

      // Enhanced stats for current user
      const userEntry = enhancedLeaderboard.find(e => e.housekeeper_id === user.id);
      if (userEntry) {
        setEnhancedStats({
          daily_avg_time: userEntry.daily_avg_time,
          checkout_avg_time: userEntry.checkout_avg_time,
          daily_completed: userEntry.daily_completed,
          checkout_completed: userEntry.checkout_completed,
          daily_efficiency: userEntry.daily_completed ? 
            (userEntry.avg_efficiency_score || 0) : 0,
          checkout_efficiency: userEntry.checkout_completed ? 
            (userEntry.avg_efficiency_score || 0) : 0,
          performance_score: userEntry.performance_score,
          punctuality_score: userEntry.punctuality_score,
          on_time_completion_rate: userEntry.on_time_completion_rate
        });
      }

      setLeaderboard(enhancedLeaderboard);
      if (statsData && typeof statsData === 'object' && !Array.isArray(statsData)) {
        setPersonalStats(statsData as unknown as PerformanceStats);
      }
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

  const getEfficiencyColor = (score: number) => {
    if (score >= 120) return 'text-green-600';
    if (score >= 100) return 'text-blue-600';
    if (score >= 80) return 'text-orange-600';
    return 'text-red-600';
  };

  const getEfficiencyBadge = (score: number) => {
    if (score >= 120) return <Badge className="bg-green-100 text-green-800">Excellent</Badge>;
    if (score >= 100) return <Badge className="bg-blue-100 text-blue-800">Great</Badge>;
    if (score >= 80) return <Badge variant="secondary">Good</Badge>;
    return <Badge variant="destructive">Needs Improvement</Badge>;
  };

  const getPerformanceBadge = (score: number) => {
    if (score >= 85) return <Badge className="bg-green-100 text-green-800">Elite</Badge>;
    if (score >= 70) return <Badge className="bg-blue-100 text-blue-800">Excellent</Badge>;
    if (score >= 55) return <Badge className="bg-yellow-100 text-yellow-800">Good</Badge>;
    if (score >= 40) return <Badge variant="secondary">Average</Badge>;
    return <Badge variant="destructive">Needs Focus</Badge>;
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8">Loading performance data...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-500" />
          <h2 className="text-lg sm:text-2xl font-bold">Performance Analytics</h2>
        </div>
        <Tabs value={timeframe} onValueChange={setTimeframe}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="7" className="flex-1 sm:flex-none">7 Days</TabsTrigger>
            <TabsTrigger value="30" className="flex-1 sm:flex-none">30 Days</TabsTrigger>
            <TabsTrigger value="90" className="flex-1 sm:flex-none">90 Days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {personalStats && (
        <div className="space-y-6">
          {/* Enhanced Performance Metrics */}
          {enhancedStats && (
            <Card className="border-2 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Trophy className="h-5 w-5" />
                  Advanced Performance Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <Clock className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                    <div className="text-2xl font-bold text-blue-800">{Math.round(enhancedStats.daily_avg_time || 0)}</div>
                    <div className="text-sm text-blue-600">Daily Room Time</div>
                    <div className="text-xs text-muted-foreground">{enhancedStats.daily_completed || 0} rooms</div>
                  </div>
                  
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <Clock className="h-8 w-8 mx-auto mb-2 text-green-600" />
                    <div className="text-2xl font-bold text-green-800">{Math.round(enhancedStats.checkout_avg_time || 0)}</div>
                    <div className="text-sm text-green-600">Checkout Time</div>
                    <div className="text-xs text-muted-foreground">{enhancedStats.checkout_completed || 0} rooms</div>
                  </div>
                  
                  <div className="text-center p-4 bg-purple-50 rounded-lg">
                    <Star className="h-8 w-8 mx-auto mb-2 text-purple-600" />
                    <div className="text-2xl font-bold text-purple-800">{Math.round(enhancedStats.punctuality_score || 0)}</div>
                    <div className="text-sm text-purple-600">Punctuality Score</div>
                    <div className="text-xs text-muted-foreground">out of 30 points</div>
                  </div>
                  
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <Target className="h-8 w-8 mx-auto mb-2 text-orange-600" />
                    <div className="text-2xl font-bold text-orange-800">{Math.round(enhancedStats.on_time_completion_rate || 0)}%</div>
                    <div className="text-sm text-orange-600">On-Time Rate</div>
                    <div className="text-xs text-muted-foreground">within estimates</div>
                  </div>

                  <div className="text-center p-4 bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg border-2 border-yellow-200">
                    <Trophy className="h-8 w-8 mx-auto mb-2 text-yellow-600" />
                    <div className="text-2xl font-bold text-yellow-800">{Math.round(enhancedStats.performance_score || 0)}</div>
                    <div className="text-sm text-yellow-600">Total Score</div>
                    <div className="text-xs text-muted-foreground">out of 100 points</div>
                  </div>
                </div>
                
                <div className="text-center p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-200">
                  <div className="text-lg font-semibold text-green-800 mb-2">Performance Rating</div>
                  <div className="flex justify-center items-center gap-4">
                    <div>
                      {getPerformanceBadge(enhancedStats.performance_score || 0)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Based on speed, punctuality, productivity & efficiency
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Basic Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            <Card>
              <CardContent className="p-3 sm:p-4 text-center">
                <Clock className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1.5 sm:mb-2 text-blue-500" />
                <div className="text-xl sm:text-2xl font-bold">{Math.round(personalStats.avg_duration_minutes)}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Avg Minutes</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 sm:p-4 text-center">
                <TrendingUp className={`h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1.5 sm:mb-2 ${getEfficiencyColor(personalStats.avg_efficiency_score)}`} />
                <div className={`text-xl sm:text-2xl font-bold ${getEfficiencyColor(personalStats.avg_efficiency_score)}`}>
                  {Math.round(personalStats.avg_efficiency_score)}%
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">Efficiency</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 sm:p-4 text-center">
                <Target className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1.5 sm:mb-2 text-green-500" />
                <div className="text-xl sm:text-2xl font-bold">{personalStats.total_completed}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Completed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 sm:p-4 text-center">
                <Star className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1.5 sm:mb-2 text-purple-500" />
                <div className="text-xl sm:text-2xl font-bold">{personalStats.best_time_minutes}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Best Time</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 sm:p-4 text-center">
                <Medal className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1.5 sm:mb-2 text-orange-500" />
                <div className="text-xl sm:text-2xl font-bold">{personalStats.total_rooms_today}</div>
                <div className="text-xs sm:text-sm text-muted-foreground">Today</div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Trophy className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="hidden sm:inline">Performance Ranking - Last {timeframe} Days</span>
            <span className="sm:hidden">Ranking - {timeframe}d</span>
          </CardTitle>
          <div className="text-sm text-muted-foreground mt-2">
            Ranked by comprehensive score: Speed (35pts) + Punctuality (30pts) + Productivity (25pts) + Efficiency (20pts)
          </div>
        </CardHeader>
        <CardContent>
          {leaderboard.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No performance data available for the selected period
            </div>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((entry) => (
                <div
                  key={entry.housekeeper_id}
                  className={`p-4 sm:p-5 rounded-lg border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                    entry.housekeeper_id === user?.id ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'
                  }`}
                >
                  <div className="w-full">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8">
                          {getRankIcon(entry.rank_position)}
                        </div>
                        <div>
                          <div className="font-semibold">
                            {entry.full_name}
                            {entry.housekeeper_id === user?.id && (
                              <Badge variant="outline" className="ml-2">You</Badge>
                            )}
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground">
                            Daily: {entry.daily_completed || 0} • Checkout: {entry.checkout_completed || 0} rooms
                          </div>
                        </div>
                      </div>
                      <div className="sm:hidden">
                        {getPerformanceBadge(entry.performance_score || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-yellow-600">{entry.performance_score || 0}</div>
                      <div className="text-xs text-muted-foreground">Score</div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold text-blue-600">{Math.round(entry.daily_avg_time || 0)}m</div>
                      <div className="text-xs text-muted-foreground">Daily</div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold text-green-600">{Math.round(entry.checkout_avg_time || 0)}m</div>
                      <div className="text-xs text-muted-foreground">Checkout</div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold text-purple-600">{Math.round(entry.attendance_rate || 0)}%</div>
                      <div className="text-xs text-muted-foreground">Punctual</div>
                    </div>
                    <div className="hidden sm:block text-center">
                      {getPerformanceBadge(entry.performance_score || 0)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}