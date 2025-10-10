import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Star, Eye, EyeOff } from 'lucide-react';
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
  const [showRace, setShowRace] = useState(true);
  const [personalRating, setPersonalRating] = useState<number | null>(null);
  
  const getDailyQuote = () => {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const quotesRaw = t('performanceRace.motivationalQuotes');
    const quotes = Array.isArray(quotesRaw) ? quotesRaw : [quotesRaw];
    return quotes[dayOfYear % quotes.length];
  };

  useEffect(() => {
    if (user?.id) {
      fetchRaceData();
      fetchPersonalRating();
    }
  }, [user?.id]);

  const fetchPersonalRating = async () => {
    if (!user?.id) return;
    
    const { data, error } = await supabase.rpc('get_housekeeper_avg_rating', {
      p_housekeeper_id: user.id,
      days_back: 30
    });
    
    if (!error && data) {
      setPersonalRating(data);
    }
  };

  const fetchRaceData = async () => {
    try {
      setLoading(true);

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

      const today = new Date().toISOString().split('T')[0];
      const participantsData: RaceParticipant[] = [];

      for (const housekeeper of housekeepers) {
        const { data: assignments } = await supabase
          .from('room_assignments')
          .select('id, status')
          .eq('assigned_to', housekeeper.id)
          .eq('assignment_date', today)
          .eq('status', 'completed');

        const completedCount = assignments?.length || 0;

        const { data: performance } = await supabase
          .from('housekeeping_performance')
          .select('efficiency_score')
          .eq('housekeeper_id', housekeeper.id)
          .eq('assignment_date', today);

        const avgEfficiency = performance && performance.length > 0
          ? performance.reduce((sum, p) => sum + (p.efficiency_score || 100), 0) / performance.length
          : 100;

        const progressPercentage = Math.min(100, (completedCount * 10) + (avgEfficiency / 10));

        participantsData.push({
          id: housekeeper.id,
          full_name: housekeeper.full_name,
          nickname: housekeeper.nickname,
          completedToday: completedCount,
          avgEfficiency: Math.round(avgEfficiency),
          progressPercentage,
          rank: 0,
          isCurrentUser: housekeeper.id === user?.id
        });
      }

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

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-blue-950 dark:via-purple-950 dark:to-pink-950 border-2 shadow-xl">
        <CardContent className="p-6">
          <div className="flex justify-center items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (participants.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-blue-950 dark:via-purple-950 dark:to-pink-950 border-2 shadow-xl">
        <CardHeader>
          <CardTitle>🏁 {t('performanceRace.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('performanceRace.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  const currentUser = participants.find(p => p.isCurrentUser);
  const totalRacers = participants.length;

  return (
    <Card className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-blue-950 dark:via-purple-950 dark:to-pink-950 border-2 shadow-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              🏁 {t('performanceRace.title')}
            </CardTitle>
            {currentUser && (
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <span className="bg-blue-100 dark:bg-blue-900 px-3 py-1 rounded-full font-semibold">
                  📦 {currentUser.completedToday} {t('performanceRace.roomsCompleted')}
                </span>
                <span className="bg-purple-100 dark:bg-purple-900 px-3 py-1 rounded-full font-semibold">
                  ⚡ {currentUser.avgEfficiency}% {t('performanceRace.efficiency')}
                </span>
                {personalRating !== null && personalRating > 0 && (
                  <span className="bg-yellow-100 dark:bg-yellow-900 px-3 py-1 rounded-full font-semibold flex items-center gap-1">
                    <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                    {personalRating.toFixed(1)} {t('ratings.yourRating')}
                  </span>
                )}
              </div>
            )}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRace(!showRace)}
            className="ml-4"
          >
            {showRace ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Daily Motivational Quote - Always visible */}
        <div className="bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-900/20 dark:via-yellow-900/20 dark:to-orange-900/20 rounded-xl p-4 border-2 border-amber-200 dark:border-amber-800 shadow-md">
          <div className="flex items-start gap-3">
            <div className="bg-yellow-400 dark:bg-yellow-600 rounded-full p-2 mt-1 animate-pulse">
              <Star className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wide mb-1">
                {t('performanceRace.dailyMotivation')}
              </p>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 italic leading-relaxed">
                "{getDailyQuote()}"
              </p>
            </div>
          </div>
        </div>

        {showRace && (
          <>
            {/* Race Description */}
            <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950 dark:to-blue-950 rounded-xl p-3 border border-green-200 dark:border-green-800">
              <p className="text-center text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('performanceRace.trackYourProgress')}
              </p>
            </div>

            {/* Race Track - Only show current user's position */}
            <div className="relative bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-lg border-2 border-gray-200 dark:border-gray-700">
              <div className="flex justify-between mb-2 text-xs font-bold">
                <span className="text-green-600 dark:text-green-400">START 🚀</span>
                <span className="text-sm text-gray-500">25%</span>
                <span className="text-sm text-gray-500">50%</span>
                <span className="text-sm text-gray-500">75%</span>
                <span className="text-red-600 dark:text-red-400">🏁 FINISH</span>
              </div>

              <div className="space-y-4">
                {currentUser && (
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                        {t('performanceRace.yourPosition')}: {currentUser.rank}/{totalRacers}
                      </span>
                      <span className="text-xs text-gray-500">
                        ({currentUser.completedToday} {t('performanceRace.rooms')})
                      </span>
                    </div>

                    <div className="relative h-16 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/40 dark:to-purple-900/40 rounded-xl overflow-hidden border-2 border-blue-300 dark:border-blue-600 shadow-lg">
                      <div
                        className="absolute inset-0 bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 transition-all duration-1000 opacity-50"
                        style={{ width: `${currentUser.progressPercentage}%` }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 transition-all duration-1000"
                        style={{ left: `${Math.max(3, Math.min(currentUser.progressPercentage - 2, 94))}%` }}
                      >
                        <div className="bg-blue-500 rounded-full p-3 shadow-2xl border-2 border-white animate-bounce">
                          <span className="text-2xl">🏃</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Your Achievement Badge - Only if in top 3 */}
        {currentUser && currentUser.rank <= 3 && (
          <div className="bg-gradient-to-r from-yellow-50 via-amber-50 to-orange-50 dark:from-yellow-900/20 dark:via-amber-900/20 dark:to-orange-900/20 rounded-xl p-4 border-2 border-yellow-300 dark:border-yellow-700">
            <p className="text-center font-bold text-yellow-800 dark:text-yellow-200 mb-2">
              🏆 {t('performanceRace.yourAchievement')}
            </p>
            <div className="flex justify-center">
              <div className="flex flex-col items-center">
                <div className="text-4xl mb-2">
                  {currentUser.rank === 1 ? "🥇" : currentUser.rank === 2 ? "🥈" : "🥉"}
                </div>
                <div className="text-lg font-bold text-yellow-700 dark:text-yellow-300">
                  {t('performanceRace.topPerformer')}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
