import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Flag, Users, TrendingUp } from 'lucide-react';
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
    <Card className="bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50 dark:from-purple-950 dark:via-pink-950 dark:to-orange-950 border-purple-200 dark:border-purple-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-purple-600" />
            <span className="text-lg">{t('performanceRace.title')}</span>
          </div>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {participants.length}
          </Badge>
        </CardTitle>
        {currentUser && (
          <p className="text-sm text-muted-foreground">
            {t('performanceRace.yourPosition')}: <span className="font-bold text-purple-600">#{currentUser.rank}</span> • 
            <span className="ml-1">{t('performanceRace.completed')}: <span className="font-bold text-green-600">{currentUser.completedToday}</span></span>
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Race Track */}
        <div className="relative bg-white dark:bg-gray-900 rounded-lg p-4 border-2 border-purple-200 dark:border-purple-800">
          {/* Start Line */}
          <div className="absolute left-2 top-0 bottom-0 w-1 bg-green-500 rounded"></div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 text-xs font-bold text-green-600 rotate-90">
            {t('performanceRace.start')}
          </div>

          {/* Finish Line */}
          <div className="absolute right-2 top-0 bottom-0 w-1 bg-gradient-to-b from-yellow-400 via-orange-500 to-red-500 rounded"></div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <Flag className="h-6 w-6 text-red-500 animate-pulse" />
          </div>

          {/* Runners */}
          <div className="space-y-3 pl-8 pr-12">
            {participants.map((participant) => {
              const displayName = participant.nickname || participant.full_name;
              
              return (
                <div 
                  key={participant.id}
                  className={`relative transition-all duration-300 ${
                    participant.isCurrentUser ? 'scale-105' : ''
                  }`}
                >
                  {/* Track Lane */}
                  <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded-lg relative overflow-hidden">
                    {/* Progress Bar */}
                    <div 
                      className={`absolute inset-0 ${
                        participant.isCurrentUser 
                          ? 'bg-gradient-to-r from-blue-200 to-blue-100 dark:from-blue-900 dark:to-blue-800' 
                          : 'bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900 dark:to-pink-900'
                      } transition-all duration-500 ease-out`}
                      style={{ width: `${participant.progressPercentage}%` }}
                    ></div>

                    {/* Runner Icon */}
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out flex items-center"
                      style={{ left: `${Math.max(2, participant.progressPercentage - 3)}%` }}
                    >
                      <div className={`${getRunnerColor(participant.rank, participant.isCurrentUser)} rounded-full p-2 shadow-lg animate-bounce`}>
                        <span className="text-lg">{getRunnerEmoji(participant.rank)}</span>
                      </div>
                    </div>

                    {/* Name and Stats */}
                    <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
                      <Badge 
                        variant={participant.isCurrentUser ? "default" : "outline"} 
                        className="text-xs font-bold"
                      >
                        #{participant.rank}
                      </Badge>
                      <span className={`text-xs font-semibold truncate max-w-[100px] ${
                        participant.isCurrentUser ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {displayName}
                      </span>
                    </div>

                    {/* Progress Info */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-xs font-bold text-green-600">{participant.completedToday}</p>
                        <p className="text-[10px] text-gray-500">{t('performanceRace.tasks')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-purple-600">{participant.avgEfficiency}%</p>
                        <p className="text-[10px] text-gray-500">{t('performanceRace.efficiency')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-xs text-muted-foreground bg-white/50 dark:bg-gray-900/50 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3 w-3 text-purple-600" />
            <span>{t('performanceRace.legend')}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span>{t('performanceRace.you')}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span>{t('performanceRace.leader')}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

