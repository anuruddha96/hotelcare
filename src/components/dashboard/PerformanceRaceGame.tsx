import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Star, Trophy, Zap } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

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
  
  const getDailyQuote = () => {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const quotesRaw = t('performanceRace.motivationalQuotes');
    const quotes = Array.isArray(quotesRaw) ? quotesRaw : [quotesRaw];
    return quotes[dayOfYear % quotes.length];
  };

  useEffect(() => {
    if (user?.id) {
      fetchRaceData();
      
      // Set up real-time subscription for updates
      const channel = supabase
        .channel('race-updates')
        .on('postgres_changes', 
          { event: '*', schema: 'public', table: 'room_assignments' },
          () => fetchRaceData()
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
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

      if (!hotel) {
        setParticipants([]);
        setLoading(false);
        return;
      }

      // Get all housekeepers with room assignments today
      const today = new Date().toISOString().split('T')[0];
      
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

      const participantsData: RaceParticipant[] = [];

      for (const housekeeper of housekeepers) {
        // Get total assignments for today
        const { data: allAssignments } = await supabase
          .from('room_assignments')
          .select('id, status')
          .eq('assigned_to', housekeeper.id)
          .eq('assignment_date', today);

        const totalAssignments = allAssignments?.length || 0;
        
        // Only include housekeepers who have assignments
        if (totalAssignments === 0) continue;

        const completedCount = allAssignments?.filter(a => a.status === 'completed').length || 0;

        // Calculate progress as percentage of assigned rooms completed
        const progressPercentage = totalAssignments > 0 
          ? Math.round((completedCount / totalAssignments) * 100)
          : 0;

        participantsData.push({
          id: housekeeper.id,
          full_name: housekeeper.full_name,
          nickname: housekeeper.nickname,
          completedToday: completedCount,
          avgEfficiency: totalAssignments,
          progressPercentage,
          rank: 0,
          isCurrentUser: housekeeper.id === user?.id
        });
      }

      // Sort by progress percentage (descending)
      participantsData.sort((a, b) => {
        if (b.progressPercentage !== a.progressPercentage) {
          return b.progressPercentage - a.progressPercentage;
        }
        // If same progress, sort by completed count
        return b.completedToday - a.completedToday;
      });

      // Assign ranks
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

  const getRankEmoji = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '🏃';
  };

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950 dark:via-indigo-950 dark:to-purple-950 border-none shadow-2xl">
        <CardContent className="p-8">
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (participants.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950 dark:via-indigo-950 dark:to-purple-950 border-none shadow-2xl">
        <CardHeader>
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            🏁 {t('performanceRace.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground">{t('performanceRace.noData')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentUser = participants.find(p => p.isCurrentUser);

  return (
    <Card className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950 dark:via-indigo-950 dark:to-purple-950 border-none shadow-2xl overflow-hidden">
      <CardHeader className="pb-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-xl md:text-2xl font-bold flex items-center gap-2">
            🏁 {t('performanceRace.title')}
          </CardTitle>
          <div className="flex items-center gap-2 text-sm md:text-base">
            <Trophy className="h-5 w-5" />
            <span className="font-semibold">{participants.length} {t('performanceRace.racers')}</span>
          </div>
        </div>
        
        {/* Race announcement banner */}
        <div className="mt-3 bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
          <p className="text-xs md:text-sm font-medium">
            {t('performanceRace.everyoneSeesThisRace')}
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-3 md:p-6 space-y-4">
        {/* Daily Motivational Quote */}
        <div className="bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-900/30 dark:via-yellow-900/30 dark:to-orange-900/30 rounded-xl p-3 md:p-4 border-2 border-amber-300 dark:border-amber-700">
          <div className="flex items-start gap-2 md:gap-3">
            <div className="bg-yellow-400 dark:bg-yellow-600 rounded-full p-1.5 md:p-2 mt-0.5 shrink-0">
              <Star className="h-4 w-4 md:h-5 md:w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wide mb-1">
                {t('performanceRace.dailyMotivation')}
              </p>
              <p className="text-xs md:text-sm font-medium text-gray-800 dark:text-gray-200 italic leading-relaxed">
                "{getDailyQuote()}"
              </p>
            </div>
          </div>
        </div>

        {/* Race Track Container */}
        <div className="bg-white dark:bg-gray-900 rounded-xl p-3 md:p-6 shadow-lg border-2 border-gray-200 dark:border-gray-700">
          {/* Track markers */}
          <div className="flex justify-between mb-3 md:mb-4 px-2 text-[10px] md:text-xs font-bold">
            <span className="text-green-600 dark:text-green-400">🚀 {t('performanceRace.start')}</span>
            <span className="text-gray-400 hidden sm:inline">25%</span>
            <span className="text-gray-400">50%</span>
            <span className="text-gray-400 hidden sm:inline">75%</span>
            <span className="text-red-600 dark:text-red-400">🏁 {t('performanceRace.finish')}</span>
          </div>

          {/* Race lanes - All participants visible */}
          <div className="space-y-3 md:space-y-4">
            {participants.map((participant) => (
              <div 
                key={participant.id}
                className={`relative transition-all duration-300 ${
                  participant.isCurrentUser 
                    ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900 rounded-xl p-2' 
                    : ''
                }`}
              >
                {/* Participant info */}
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-base md:text-lg shrink-0">{getRankEmoji(participant.rank)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-xs md:text-sm text-gray-900 dark:text-gray-100 truncate">
                        {participant.nickname || participant.full_name}
                        {participant.isCurrentUser && (
                          <span className="ml-2 text-[10px] md:text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">
                            {t('performanceRace.you')}
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400">
                        {participant.completedToday}/{participant.avgEfficiency} {t('performanceRace.completed')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Zap className="h-3 w-3 md:h-4 md:w-4 text-yellow-500" />
                    <span className="text-xs md:text-sm font-bold text-gray-700 dark:text-gray-300">
                      {participant.progressPercentage}%
                    </span>
                  </div>
                </div>

                {/* Progress track */}
                <div className="relative h-10 md:h-12 bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                  {/* Progress fill */}
                  <div
                    className={`absolute inset-y-0 left-0 transition-all duration-1000 ease-out ${
                      participant.rank === 1
                        ? 'bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400'
                        : participant.rank === 2
                        ? 'bg-gradient-to-r from-gray-300 via-gray-400 to-gray-500'
                        : participant.rank === 3
                        ? 'bg-gradient-to-r from-orange-300 via-orange-400 to-orange-500'
                        : participant.isCurrentUser
                        ? 'bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400'
                        : 'bg-gradient-to-r from-green-400 to-emerald-400'
                    }`}
                    style={{ width: `${participant.progressPercentage}%` }}
                  />
                  
                  {/* Runner icon */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 transition-all duration-1000 ease-out z-10"
                    style={{ 
                      left: `${Math.max(2, Math.min(participant.progressPercentage - 1, 96))}%` 
                    }}
                  >
                    <div className={`rounded-full p-1.5 md:p-2 shadow-xl border-2 border-white ${
                      participant.progressPercentage === 100 ? 'animate-bounce' : ''
                    }`}>
                      <span className="text-lg md:text-2xl">
                        {participant.progressPercentage === 100 ? '🎉' : '🏃'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top 3 Podium */}
        {participants.length >= 3 && (
          <div className="bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 dark:from-yellow-900/20 dark:via-amber-900/20 dark:to-orange-900/20 rounded-xl p-4 md:p-6 border-2 border-yellow-300 dark:border-yellow-700">
            <h3 className="text-center font-bold text-sm md:text-base text-yellow-800 dark:text-yellow-200 mb-4">
              🏆 {t('performanceRace.topPerformers')}
            </h3>
            <div className="grid grid-cols-3 gap-2 md:gap-4">
              {participants.slice(0, 3).map((participant, index) => (
                <div 
                  key={participant.id}
                  className={`text-center ${index === 0 ? 'order-2' : index === 1 ? 'order-1' : 'order-3'}`}
                >
                  <div className={`${
                    index === 0 ? 'text-4xl md:text-5xl mb-2' : 
                    index === 1 ? 'text-3xl md:text-4xl mb-1 mt-4' : 
                    'text-3xl md:text-4xl mb-1 mt-6'
                  }`}>
                    {getRankEmoji(participant.rank)}
                  </div>
                  <p className="text-[10px] md:text-xs font-bold text-gray-800 dark:text-gray-200 truncate px-1">
                    {participant.nickname || participant.full_name}
                  </p>
                  <p className="text-[10px] md:text-xs text-gray-600 dark:text-gray-400">
                    {participant.completedToday} {t('performanceRace.tasks')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
