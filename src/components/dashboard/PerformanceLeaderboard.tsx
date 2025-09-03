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
  const [timeframe, setTimeframe] = useState('7');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [timeframe, user]);

  const fetchData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data: leaderboardData } = await supabase.rpc('get_housekeeping_leaderboard', {
        days_back: parseInt(timeframe)
      });

      const { data: statsData } = await supabase.rpc('get_housekeeper_performance_stats', {
        target_housekeeper_id: user.id,
        days_back: parseInt(timeframe)
      });

      setLeaderboard(leaderboardData || []);
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
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
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Trophy className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="hidden sm:inline">Housekeeping Leaderboard - Last {timeframe} Days</span>
            <span className="sm:hidden">Leaderboard - {timeframe}d</span>
          </CardTitle>
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
                            {entry.total_completed} rooms completed
                          </div>
                        </div>
                      </div>
                      <div className="sm:hidden">
                        {getEfficiencyBadge(entry.avg_efficiency_score)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 sm:flex sm:items-center sm:gap-6">
                    <div className="text-center">
                      <div className="text-base sm:text-lg font-bold">{Math.round(entry.avg_duration_minutes)} min</div>
                      <div className="text-xs text-muted-foreground">Avg Time</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-base sm:text-lg font-bold ${getEfficiencyColor(entry.avg_efficiency_score)}`}>
                        {Math.round(entry.avg_efficiency_score)}%
                      </div>
                      <div className="text-xs text-muted-foreground">Efficiency</div>
                    </div>
                    <div className="hidden sm:block">
                      {getEfficiencyBadge(entry.avg_efficiency_score)}
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