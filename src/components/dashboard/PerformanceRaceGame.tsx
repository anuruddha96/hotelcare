import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Flag, Users, TrendingUp, Star, Zap } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { format } from 'date-fns';

interface RaceParticipant {
  id: string;
  full_name: string;
  nickname: string | null;
  completedToday: number;
  avgEfficiency: number;
  progressPercentage: number;
  rank: number;
  isCurrentUser: boolean;
}

export function PerformanceRaceGame() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [participants, setParticipants] = useState<RaceParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [userHotel, setUserHotel] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      fetchRaceData();
    }
  }, [user?.id]);

  const fetchRaceData = async () => {
    try {
      setLoading(true);

      // Get current user's hotel
      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', user?.id)
        .single();

      const hotel = profileData?.assigned_hotel;
      setUserHotel(hotel);

      if (!hotel) {
        setParticipants([]);
        setLoading(false);
        return;
      }

      // Get all housekeepers from the same hotel
      const { data: housekeepers, error: housekeepersError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .eq('assigned_hotel', hotel);

      if (housekeepersError) throw housekeepersError;

      if (!housekeepers || housekeepers.length === 0) {
        setParticipants([]);
        setLoading(false);
        return;
      }

      // Fetch today's performance data for all housekeepers
      const today = format(new Date(), 'yyyy-MM-dd');
      const participantsData: RaceParticipant[] = [];

      for (const housekeeper of housekeepers) {
        // Get completed assignments for today
        const { data: assignments } = await supabase
          .from('room_assignments')
          .select('id, status')
          .eq('assigned_to', housekeeper.id)
          .eq('assignment_date', today)
          .eq('status', 'completed');

        const completedCount = assignments?.length || 0;

        // Get performance data for today
        const { data: performance } = await supabase
          .from('housekeeping_performance')
          .select('efficiency_score, actual_duration_minutes')
          .eq('housekeeper_id', housekeeper.id)
          .eq('assignment_date', today);

        // Calculate average efficiency
        const avgEfficiency = performance && performance.length > 0
          ? performance.reduce((sum, p) => sum + (p.efficiency_score || 100), 0) / performance.length
          : 100;

        // Calculate progress percentage (based on completed tasks and efficiency)
        // Formula: (completed tasks * 10) + (efficiency/10) 
        // This gives more weight to completing tasks while still valuing efficiency
        const progressPercentage = Math.min(100, (completedCount * 10) + (avgEfficiency / 10));

        participantsData.push({
          id: housekeeper.id,
          full_name: housekeeper.full_name,
          nickname: housekeeper.nickname,
          completedToday: completedCount,
          avgEfficiency: Math.round(avgEfficiency),
          progressPercentage,
          rank: 0, // Will be set after sorting
          isCurrentUser: housekeeper.id === user?.id
        });
      }

      // Sort by progress and assign ranks
      participantsData.sort((a, b) => b.progressPercentage - a.progressPercentage);
      participantsData.forEach((p, index) => {
        p.rank = index + 1;
      });

      setParticipants(participantsData);
    } catch (error) {
      console.error('Error fetching race data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRunnerColor = (rank: number, isCurrentUser: boolean) => {
    if (isCurrentUser) return 'bg-blue-500';
    if (rank === 1) return 'bg-yellow-500';
    if (rank === 2) return 'bg-gray-400';
    if (rank === 3) return 'bg-amber-600';
    return 'bg-gray-300';
  };

  const getRunnerEmoji = (rank: number) => {
    if (rank === 1) return '🏆';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '🏃';
  };

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950">
        <CardContent className="p-6">
          <div className="flex justify-center items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-3 text-muted-foreground">{t('common.loading')}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (participants.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-purple-600" />
            {t('performanceRace.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('performanceRace.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  const currentUser = participants.find(p => p.isCurrentUser);

  return (
    <Card className="bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50 dark:from-purple-950 dark:via-pink-950 dark:to-orange-950 border-2 border-purple-300 dark:border-purple-700 shadow-xl">
      <CardHeader className="pb-3 space-y-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-yellow-500 animate-pulse" />
            <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              {t('performanceRace.title')}
            </span>
          </div>
          <Badge variant="secondary" className="flex items-center gap-1 text-base px-3 py-1">
            <Users className="h-4 w-4" />
            {participants.length} {t('performanceRace.racers')}
          </Badge>
        </CardTitle>
        
        {/* Current User Stats - More Prominent */}
        {currentUser && (
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-full p-3">
                  <Star className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs opacity-90 uppercase tracking-wide">{t('performanceRace.yourPosition')}</p>
                  <p className="text-3xl font-bold">#{currentUser.rank}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs opacity-90 uppercase tracking-wide">{t('performanceRace.completed')}</p>
                <p className="text-3xl font-bold">{currentUser.completedToday}</p>
                <div className="flex items-center gap-1 justify-end mt-1">
                  <Zap className="h-4 w-4" />
                  <span className="text-sm">{currentUser.avgEfficiency}%</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Competition Info */}
        <div className="bg-gradient-to-r from-yellow-100 to-orange-100 dark:from-yellow-900/30 dark:to-orange-900/30 rounded-lg p-3 border border-yellow-300 dark:border-yellow-700">
          <p className="text-sm font-semibold text-center flex items-center justify-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-600" />
            {t('performanceRace.everyoneSeesThisRace')}
          </p>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Race Track with Milestones */}
        <div className="relative bg-gradient-to-b from-green-100 to-blue-100 dark:from-green-900/20 dark:to-blue-900/20 rounded-xl p-6 border-2 border-purple-300 dark:border-purple-700 shadow-inner">
          {/* Start Line */}
          <div className="absolute left-4 top-0 bottom-0 w-2 bg-gradient-to-b from-green-400 to-green-600 rounded-full shadow-lg"></div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90">
            <Badge className="bg-green-500 text-white text-xs font-bold shadow-lg">
              START 🚀
            </Badge>
          </div>

          {/* Milestone Markers - 25%, 50%, 75% */}
          {[25, 50, 75].map((milestone) => (
            <div key={milestone} className="absolute top-0 bottom-0 w-1 bg-gray-300 dark:bg-gray-600 opacity-50" style={{ left: `${milestone}%` }}>
              <div className="absolute top-0 -translate-y-1/2 -translate-x-1/2">
                <span className="text-xs font-bold text-gray-500">{milestone}%</span>
              </div>
            </div>
          ))}

          {/* Finish Line */}
          <div className="absolute right-4 top-0 bottom-0 w-2 bg-gradient-to-b from-yellow-400 via-orange-500 to-red-500 rounded-full shadow-lg animate-pulse"></div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <Flag className="h-8 w-8 text-red-500 animate-bounce drop-shadow-lg" />
          </div>

          {/* Runners */}
          <div className="space-y-4 pl-12 pr-14">
            {participants.map((participant, index) => {
              const displayName = participant.nickname || participant.full_name;
              const isTopThree = participant.rank <= 3;
              
              return (
                <div 
                  key={participant.id}
                  className={`relative transition-all duration-500 ${
                    participant.isCurrentUser ? 'scale-110 z-10' : ''
                  }`}
                  style={{ 
                    animationDelay: `${index * 100}ms`,
                    animation: 'slideIn 0.5s ease-out forwards'
                  }}
                >
                  {/* Track Lane */}
                  <div className={`h-16 rounded-xl relative overflow-hidden shadow-lg border-2 ${
                    participant.isCurrentUser 
                      ? 'border-blue-400 dark:border-blue-500 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/40 dark:to-blue-800/40' 
                      : isTopThree
                      ? 'border-yellow-300 dark:border-yellow-600 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700'
                  }`}>
                    {/* Progress Bar with Gradient */}
                    <div 
                      className={`absolute inset-0 transition-all duration-1000 ease-out ${
                        participant.isCurrentUser 
                          ? 'bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600' 
                          : participant.rank === 1
                          ? 'bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400'
                          : participant.rank === 2
                          ? 'bg-gradient-to-r from-gray-300 via-gray-400 to-gray-500'
                          : participant.rank === 3
                          ? 'bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700'
                          : 'bg-gradient-to-r from-purple-200 via-pink-200 to-purple-300 dark:from-purple-700 dark:to-pink-700'
                      } opacity-40`}
                      style={{ width: `${participant.progressPercentage}%` }}
                    ></div>

                    {/* Runner Icon - Animated */}
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 transition-all duration-1000 ease-out z-20"
                      style={{ left: `${Math.max(3, Math.min(participant.progressPercentage - 2, 94))}%` }}
                    >
                      <div className={`${getRunnerColor(participant.rank, participant.isCurrentUser)} rounded-full p-3 shadow-2xl border-2 border-white ${
                        participant.isCurrentUser ? 'animate-bounce' : 'animate-pulse'
                      }`}>
                        <span className="text-2xl">{getRunnerEmoji(participant.rank)}</span>
                      </div>
                      {/* Speed Trail Effect */}
                      {participant.progressPercentage > 10 && (
                        <div className="absolute right-full top-1/2 -translate-y-1/2 flex gap-1 mr-1">
                          <div className="w-1 h-1 bg-white rounded-full opacity-60 animate-ping"></div>
                          <div className="w-1 h-1 bg-white rounded-full opacity-40 animate-ping" style={{ animationDelay: '0.1s' }}></div>
                        </div>
                      )}
                    </div>

                    {/* Name and Rank Badge */}
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
                      <Badge 
                        variant={participant.isCurrentUser ? "default" : isTopThree ? "secondary" : "outline"} 
                        className={`text-sm font-bold px-2 py-1 shadow-md ${
                          participant.rank === 1 ? 'bg-yellow-500 text-white' :
                          participant.rank === 2 ? 'bg-gray-400 text-white' :
                          participant.rank === 3 ? 'bg-amber-600 text-white' : ''
                        }`}
                      >
                        #{participant.rank}
                      </Badge>
                      <span className={`text-sm font-bold truncate max-w-[120px] drop-shadow ${
                        participant.isCurrentUser ? 'text-blue-700 dark:text-blue-200' : 'text-gray-800 dark:text-gray-200'
                      }`}>
                        {displayName}
                        {participant.isCurrentUser && ' 👈'}
                      </span>
                    </div>

                    {/* Stats - More Visual */}
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-3 bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-1 shadow-md">
                      <div className="text-center">
                        <p className="text-xl font-bold text-green-600">{participant.completedToday}</p>
                        <p className="text-[10px] text-gray-600 dark:text-gray-400">✅ {t('performanceRace.tasks')}</p>
                      </div>
                      <div className="w-px h-8 bg-gray-300"></div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-purple-600">{participant.avgEfficiency}%</p>
                        <p className="text-[10px] text-gray-600 dark:text-gray-400">⚡ {t('performanceRace.efficiency')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Leaderboard Podium - Top 3 */}
        {participants.length >= 3 && (
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-xl p-4 border border-yellow-200 dark:border-yellow-800">
            <h3 className="text-sm font-bold text-center mb-3 flex items-center justify-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-600" />
              {t('performanceRace.topPerformers')}
            </h3>
            <div className="flex items-end justify-center gap-4">
              {/* 2nd Place */}
              {participants[1] && (
                <div className="text-center flex-1">
                  <div className="bg-gray-400 text-white rounded-t-lg p-3 h-20 flex flex-col items-center justify-end">
                    <span className="text-2xl mb-1">🥈</span>
                    <span className="text-xs font-bold truncate max-w-full">{participants[1].nickname || participants[1].full_name}</span>
                  </div>
                  <div className="bg-gray-300 dark:bg-gray-700 py-1 rounded-b text-xs font-bold">
                    {participants[1].completedToday} {t('performanceRace.tasks')}
                  </div>
                </div>
              )}
              
              {/* 1st Place - Taller */}
              {participants[0] && (
                <div className="text-center flex-1">
                  <div className="bg-yellow-500 text-white rounded-t-lg p-3 h-28 flex flex-col items-center justify-end shadow-xl">
                    <span className="text-3xl mb-1">🏆</span>
                    <span className="text-sm font-bold truncate max-w-full">{participants[0].nickname || participants[0].full_name}</span>
                  </div>
                  <div className="bg-yellow-400 dark:bg-yellow-600 py-1 rounded-b text-sm font-bold">
                    {participants[0].completedToday} {t('performanceRace.tasks')}
                  </div>
                </div>
              )}
              
              {/* 3rd Place */}
              {participants[2] && (
                <div className="text-center flex-1">
                  <div className="bg-amber-600 text-white rounded-t-lg p-3 h-16 flex flex-col items-center justify-end">
                    <span className="text-xl mb-1">🥉</span>
                    <span className="text-xs font-bold truncate max-w-full">{participants[2].nickname || participants[2].full_name}</span>
                  </div>
                  <div className="bg-amber-500 dark:bg-amber-700 py-1 rounded-b text-xs font-bold">
                    {participants[2].completedToday} {t('performanceRace.tasks')}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Help Message */}
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-center font-medium">
            💪 {t('performanceRace.helpEachOther')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

