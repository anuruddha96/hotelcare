import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Trophy, Clock, TrendingUp, Medal, Star, Target, HelpCircle, AlertTriangle, Zap, Timer, Users, ShieldCheck, BarChart3, Activity } from 'lucide-react';
import { PerformanceDetailDialog } from './PerformanceDetailDialog';
import { useAuth } from '@/hooks/useAuth';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/useTranslation';

// ── Realistic data thresholds ──
const THRESHOLDS = {
  daily: { min: 5, max: 60 },       // Daily cleaning: 5-60 minutes realistic
  checkout: { min: 15, max: 150 },   // Checkout cleaning: 15-150 minutes realistic
  minRoomsForRanking: 3,             // Minimum rooms to appear on leaderboard
  minDaysForRanking: 2,              // Minimum unique work days
  maxWorkingHoursPerDay: 12,         // Cap unrealistic hours
  punctualityCutoff: '08:05',        // On-time arrival threshold
};

// ── Scoring benchmarks (100 points total) ──
const SCORING = {
  speed: { weight: 30, dailyExcellent: 18, dailyBaseline: 30, checkoutExcellent: 35, checkoutBaseline: 65 },
  productivity: { weight: 25, excellent: 2.5, good: 1.8, baseline: 1.2 },   // rooms/hour
  punctuality: { weight: 20 },
  consistency: { weight: 15 },   // Low variance = reliable
  quality: { weight: 10 },       // Manager ratings
};

interface LeaderboardEntry {
  housekeeper_id: string;
  full_name: string;
  avg_duration_minutes: number;
  total_completed: number;
  rank_position: number;
  daily_avg_time: number;
  checkout_avg_time: number;
  daily_completed: number;
  checkout_completed: number;
  punctuality_rate: number;
  performance_score: number;
  avg_working_hours: number;
  rooms_per_hour: number;
  rooms_per_day: number;
  attendance_streak: number;
  late_check_ins?: any[];
  // New smart metrics
  speed_score: number;
  productivity_score: number;
  punctuality_score: number;
  consistency_score: number;
  quality_score: number;
  daily_stddev: number;
  checkout_stddev: number;
  avg_rating: number;
  rating_count: number;
  unique_work_days: number;
  excluded_outliers: number;
  total_raw_records: number;
}

interface OverviewStats {
  avgMinutes: number;
  efficiency: number;
  completed: number;
  bestTime: number;
  totalHousekeepers: number;
  outliersExcluded: number;
}

// ── Helper: Calculate standard deviation ──
function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / values.length);
}

// ── Helper: Filter realistic performance records ──
function filterRealisticRecords(records: any[]): { valid: any[]; excluded: number } {
  let excluded = 0;
  const valid = records.filter(p => {
    // Exclude DND rooms
    if ((p as any).room_assignments?.is_dnd === true) { excluded++; return false; }
    
    const dur = p.actual_duration_minutes;
    const type = p.assignment_type;
    
    // Apply type-specific thresholds
    if (type === 'daily_cleaning') {
      if (dur < THRESHOLDS.daily.min || dur > THRESHOLDS.daily.max) { excluded++; return false; }
    } else if (type === 'checkout_cleaning') {
      if (dur < THRESHOLDS.checkout.min || dur > THRESHOLDS.checkout.max) { excluded++; return false; }
    }
    
    return true;
  });
  return { valid, excluded };
}

// ── Smart scoring functions ──
function calcSpeedScore(dailyAvg: number, checkoutAvg: number, dailyCount: number, checkoutCount: number): number {
  const { dailyExcellent, dailyBaseline, checkoutExcellent, checkoutBaseline } = SCORING.speed;
  let dailyScore = 0;
  let checkoutScore = 0;
  
  if (dailyCount > 0) {
    // Linear scale: excellent time = full points, baseline = 0 points
    dailyScore = Math.max(0, Math.min(1, (dailyBaseline - dailyAvg) / (dailyBaseline - dailyExcellent)));
  }
  if (checkoutCount > 0) {
    checkoutScore = Math.max(0, Math.min(1, (checkoutBaseline - checkoutAvg) / (checkoutBaseline - checkoutExcellent)));
  }
  
  // Weight by proportion of work done
  const total = dailyCount + checkoutCount;
  if (total === 0) return 0;
  const dailyWeight = dailyCount / total;
  const checkoutWeight = checkoutCount / total;
  
  return Math.round((dailyScore * dailyWeight + checkoutScore * checkoutWeight) * SCORING.speed.weight);
}

function calcProductivityScore(roomsPerHour: number): number {
  const { excellent, baseline } = SCORING.productivity;
  if (roomsPerHour <= 0) return 0;
  const normalized = Math.max(0, Math.min(1, (roomsPerHour - baseline) / (excellent - baseline)));
  return Math.round(normalized * SCORING.productivity.weight);
}

function calcPunctualityScore(rate: number): number {
  // rate is 0-1
  return Math.round(rate * SCORING.punctuality.weight);
}

function calcConsistencyScore(dailyTimes: number[], checkoutTimes: number[]): number {
  // Lower stddev relative to mean = more consistent = higher score
  let consistencyRatio = 1;
  const allTimes = [...dailyTimes, ...checkoutTimes];
  
  if (allTimes.length >= 3) {
    const mean = allTimes.reduce((s, v) => s + v, 0) / allTimes.length;
    const sd = stddev(allTimes);
    // Coefficient of variation (CV): sd/mean. CV < 0.15 = very consistent, CV > 0.5 = inconsistent
    const cv = mean > 0 ? sd / mean : 0;
    consistencyRatio = Math.max(0, Math.min(1, (0.5 - cv) / 0.35));
  }
  
  return Math.round(consistencyRatio * SCORING.consistency.weight);
}

function calcQualityScore(avgRating: number, ratingCount: number): number {
  if (ratingCount === 0) return Math.round(SCORING.quality.weight * 0.5); // Neutral if no ratings
  // Rating is 1-5, normalize to 0-1
  const normalized = Math.max(0, Math.min(1, (avgRating - 1) / 4));
  return Math.round(normalized * SCORING.quality.weight);
}

export function PerformanceLeaderboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [overviewStats, setOverviewStats] = useState<OverviewStats>({
    avgMinutes: 0, efficiency: 0, completed: 0, bestTime: 0, totalHousekeepers: 0, outliersExcluded: 0
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
        setOverviewStats({ avgMinutes: 0, efficiency: 0, completed: 0, bestTime: 0, totalHousekeepers: 0, outliersExcluded: 0 });
        setLoading(false);
        return;
      }

      let allValidMinutes: number[] = [];
      let totalCompleted = 0;
      let totalOutliers = 0;
      const enhancedLeaderboard: LeaderboardEntry[] = [];
      
      for (const housekeeper of housekeepers) {
        // Fetch performance data with assignment info
        const { data: performanceData } = await supabase
          .from('housekeeping_performance')
          .select('*, room_assignments(is_dnd, break_periods, total_break_time_minutes)')
          .eq('housekeeper_id', housekeeper.id)
          .gte('assignment_date', dateFrom);

        const totalRaw = performanceData?.length || 0;
        const { valid: validPerformanceData, excluded } = filterRealisticRecords(performanceData || []);
        totalOutliers += excluded;

        // Adjust durations for break time
        const adjustedData = validPerformanceData.map(p => {
          const breakMinutes = (p as any).room_assignments?.total_break_time_minutes || 0;
          return {
            ...p,
            actual_duration_minutes: Math.max(1, p.actual_duration_minutes - breakMinutes)
          };
        });

        // Attendance data
        const { data: attendanceData } = await supabase
          .from('staff_attendance')
          .select('*')
          .eq('user_id', housekeeper.id)
          .gte('work_date', dateFrom)
          .not('check_out_time', 'is', null)
          .order('work_date', { ascending: false });

        // Ratings data
        const { data: ratingsData } = await supabase
          .from('housekeeper_ratings')
          .select('rating')
          .eq('housekeeper_id', housekeeper.id)
          .gte('rating_date', dateFrom);

        const uniqueDays = new Set(adjustedData.map(p => p.assignment_date)).size;

        // Skip housekeepers with insufficient data
        if (adjustedData.length < THRESHOLDS.minRoomsForRanking || uniqueDays < THRESHOLDS.minDaysForRanking) {
          continue;
        }

        totalCompleted += adjustedData.length;
        adjustedData.forEach(p => allValidMinutes.push(p.actual_duration_minutes));

        // ── Calculate metrics ──
        const dailyPerf = adjustedData.filter(p => p.assignment_type === 'daily_cleaning');
        const checkoutPerf = adjustedData.filter(p => p.assignment_type === 'checkout_cleaning');

        const dailyTimes = dailyPerf.map(p => p.actual_duration_minutes);
        const checkoutTimes = checkoutPerf.map(p => p.actual_duration_minutes);

        const dailyAvgTime = dailyTimes.length ? Math.round(dailyTimes.reduce((s, v) => s + v, 0) / dailyTimes.length) : 0;
        const checkoutAvgTime = checkoutTimes.length ? Math.round(checkoutTimes.reduce((s, v) => s + v, 0) / checkoutTimes.length) : 0;
        const avgDuration = adjustedData.length ? Math.round(adjustedData.reduce((s, p) => s + p.actual_duration_minutes, 0) / adjustedData.length) : 0;

        // Working hours (capped at realistic max)
        const validAttendance = attendanceData?.filter(a => {
          const hours = parseFloat(a.total_hours?.toString() || '0') || 0;
          return hours > 0 && hours <= THRESHOLDS.maxWorkingHoursPerDay;
        }) || [];
        const totalWorkingHours = validAttendance.reduce((sum, a) => sum + (parseFloat(a.total_hours?.toString() || '0') || 0), 0);
        const avgWorkingHours = validAttendance.length ? totalWorkingHours / validAttendance.length : 0;

        // Rooms per hour (the most meaningful productivity metric)
        const roomsPerHour = totalWorkingHours > 0 ? adjustedData.length / totalWorkingHours : 0;
        const roomsPerDay = uniqueDays > 0 ? adjustedData.length / uniqueDays : 0;

        // Punctuality
        const punctualDays = attendanceData?.filter(a => {
          const checkInTime = new Date(a.check_in_time);
          const timeStr = checkInTime.toTimeString().slice(0, 5); // "HH:MM"
          return timeStr <= THRESHOLDS.punctualityCutoff;
        }).length || 0;
        const totalAttendanceDays = attendanceData?.length || 0;
        const punctualityRate = totalAttendanceDays > 0 ? punctualDays / totalAttendanceDays : 0;

        // Attendance streak
        let streak = 0;
        if (attendanceData) {
          for (const a of attendanceData) {
            const checkInTime = new Date(a.check_in_time);
            const timeStr = checkInTime.toTimeString().slice(0, 5);
            if (timeStr <= THRESHOLDS.punctualityCutoff) streak++;
            else break;
          }
        }

        const lateCheckIns = attendanceData?.filter(a => {
          const checkInTime = new Date(a.check_in_time);
          const timeStr = checkInTime.toTimeString().slice(0, 5);
          return timeStr > THRESHOLDS.punctualityCutoff;
        }) || [];

        // Ratings
        const avgRating = ratingsData?.length ? ratingsData.reduce((s, r) => s + Number(r.rating), 0) / ratingsData.length : 0;
        const ratingCount = ratingsData?.length || 0;

        // ── Calculate scores ──
        const speedScore = calcSpeedScore(dailyAvgTime, checkoutAvgTime, dailyPerf.length, checkoutPerf.length);
        const productivityScore = calcProductivityScore(roomsPerHour);
        const punctualityScore = calcPunctualityScore(punctualityRate);
        const consistencyScore = calcConsistencyScore(dailyTimes, checkoutTimes);
        const qualityScore = calcQualityScore(avgRating, ratingCount);
        const totalScore = speedScore + productivityScore + punctualityScore + consistencyScore + qualityScore;

        const entry: LeaderboardEntry = {
          housekeeper_id: housekeeper.id,
          full_name: housekeeper.full_name,
          avg_duration_minutes: avgDuration,
          total_completed: adjustedData.length,
          daily_avg_time: dailyAvgTime,
          checkout_avg_time: checkoutAvgTime,
          daily_completed: dailyPerf.length,
          checkout_completed: checkoutPerf.length,
          punctuality_rate: punctualityRate * 100,
          performance_score: totalScore,
          avg_working_hours: Math.round(avgWorkingHours * 10) / 10,
          rooms_per_hour: Math.round(roomsPerHour * 100) / 100,
          rooms_per_day: Math.round(roomsPerDay * 10) / 10,
          attendance_streak: streak,
          late_check_ins: lateCheckIns.length > 2 ? lateCheckIns : [],
          rank_position: 0,
          // Smart metrics
          speed_score: speedScore,
          productivity_score: productivityScore,
          punctuality_score: punctualityScore,
          consistency_score: consistencyScore,
          quality_score: qualityScore,
          daily_stddev: Math.round(stddev(dailyTimes) * 10) / 10,
          checkout_stddev: Math.round(stddev(checkoutTimes) * 10) / 10,
          avg_rating: Math.round(avgRating * 10) / 10,
          rating_count: ratingCount,
          unique_work_days: uniqueDays,
          excluded_outliers: excluded,
          total_raw_records: totalRaw,
        };
        enhancedLeaderboard.push(entry);
      }

      enhancedLeaderboard.sort((a, b) => b.performance_score - a.performance_score);
      enhancedLeaderboard.forEach((entry, index) => { entry.rank_position = index + 1; });

      const avgMinutes = allValidMinutes.length > 0 ? Math.round(allValidMinutes.reduce((s, m) => s + m, 0) / allValidMinutes.length) : 0;
      const realisticTimes = allValidMinutes.filter(m => m <= 120);
      const bestTime = realisticTimes.length > 0 ? Math.min(...realisticTimes) : 0;

      setOverviewStats({
        avgMinutes,
        efficiency: 0,
        completed: totalCompleted,
        bestTime,
        totalHousekeepers: enhancedLeaderboard.length,
        outliersExcluded: totalOutliers
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
      default: return <div className="w-5 h-5 flex items-center justify-center text-sm font-bold text-muted-foreground">{rank}</div>;
    }
  };

  const getPerformanceBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{t('performance.excellent')}</Badge>;
    if (score >= 60) return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">{t('performance.great')}</Badge>;
    if (score >= 45) return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">{t('performance.good')}</Badge>;
    if (score >= 30) return <Badge variant="secondary">{t('performance.average')}</Badge>;
    return <Badge variant="destructive">{t('performance.needsFocus')}</Badge>;
  };

  const getTierColor = (score: number) => {
    if (score >= 80) return 'border-l-4 border-l-green-500';
    if (score >= 60) return 'border-l-4 border-l-blue-500';
    if (score >= 45) return 'border-l-4 border-l-yellow-500';
    return 'border-l-4 border-l-red-500';
  };

  const getProgressColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-blue-500';
    if (score >= 45) return 'bg-yellow-500';
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
  const teamAvgRPH = leaderboard.length > 0 ? Math.round(leaderboard.reduce((s, e) => s + e.rooms_per_hour, 0) / leaderboard.length * 10) / 10 : 0;

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

      {/* Smart Scoring Explanation */}
      <Accordion type="single" collapsible>
        <AccordionItem value="scoring" className="border rounded-lg bg-muted/30">
          <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline">
            <span className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">📊 {t('performance.scoreBreakdown')} (Smart Scoring v2)</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Scores are based on 100 points. Unrealistic data is automatically excluded 
                (daily &lt;{THRESHOLDS.daily.min}m or &gt;{THRESHOLDS.daily.max}m, checkout &lt;{THRESHOLDS.checkout.min}m or &gt;{THRESHOLDS.checkout.max}m).
                Staff need at least {THRESHOLDS.minRoomsForRanking} rooms across {THRESHOLDS.minDaysForRanking}+ days to be ranked.
                Break time is subtracted from cleaning durations.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs sm:text-sm">
                <div className="bg-background p-2 rounded border">
                  <div className="font-bold mb-0.5">⚡ Speed ({SCORING.speed.weight}pts)</div>
                  <div className="text-muted-foreground">Daily: {SCORING.speed.dailyExcellent}-{SCORING.speed.dailyBaseline}m • Checkout: {SCORING.speed.checkoutExcellent}-{SCORING.speed.checkoutBaseline}m</div>
                </div>
                <div className="bg-background p-2 rounded border">
                  <div className="font-bold mb-0.5">🏭 Productivity ({SCORING.productivity.weight}pts)</div>
                  <div className="text-muted-foreground">Rooms/hour: {SCORING.productivity.baseline}-{SCORING.productivity.excellent} r/h</div>
                </div>
                <div className="bg-background p-2 rounded border">
                  <div className="font-bold mb-0.5">⏰ Punctuality ({SCORING.punctuality.weight}pts)</div>
                  <div className="text-muted-foreground">Arrival before {THRESHOLDS.punctualityCutoff}</div>
                </div>
                <div className="bg-background p-2 rounded border">
                  <div className="font-bold mb-0.5">📏 Consistency ({SCORING.consistency.weight}pts)</div>
                  <div className="text-muted-foreground">Low time variance = reliable worker</div>
                </div>
                <div className="bg-background p-2 rounded border">
                  <div className="font-bold mb-0.5">⭐ Quality ({SCORING.quality.weight}pts)</div>
                  <div className="text-muted-foreground">Manager rating average (1-5)</div>
                </div>
                <div className="bg-background p-2 rounded border">
                  <div className="font-bold mb-0.5">🚫 Data Hygiene</div>
                  <div className="text-muted-foreground">{overviewStats.outliersExcluded} outlier records excluded</div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Top Performer, Team Avg, Needs Attention */}
      {leaderboard.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {topPerformer && (
            <Card className="border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-900/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-4 w-4 text-yellow-500" />
                  <span className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase">Top Performer</span>
                </div>
                <div className="font-bold text-lg truncate">{topPerformer.full_name}</div>
                <div className="flex items-center gap-3 mt-1 text-sm text-green-700 dark:text-green-400">
                  <span className="font-semibold">{topPerformer.performance_score}/100</span>
                  <span>•</span>
                  <span>{topPerformer.rooms_per_hour} r/h</span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Team Average</span>
              </div>
              <div className="font-bold text-lg">{teamAvgScore}/100</div>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span>{overviewStats.totalHousekeepers} ranked</span>
                <span>•</span>
                <span>{teamAvgRPH} r/h avg</span>
              </div>
            </CardContent>
          </Card>

          {needsAttention && needsAttention.performance_score < 40 && (
            <Card className="border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-900/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase">{t('performance.needsAttention')}</span>
                </div>
                <div className="font-bold text-lg truncate">{needsAttention.full_name}</div>
                <div className="flex items-center gap-3 mt-1 text-sm text-red-700 dark:text-red-400">
                  <span className="font-semibold">{needsAttention.performance_score}/100</span>
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
            <Activity className="h-6 w-6 mx-auto mb-1 text-green-500" />
            <div className="text-2xl font-bold">{teamAvgRPH}</div>
            <div className="text-xs text-muted-foreground">{t('performance.avgRoomsHour')}</div>
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
            <ShieldCheck className="h-6 w-6 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold">{overviewStats.outliersExcluded}</div>
            <div className="text-xs text-muted-foreground">{t('performance.outliersFiltered')}</div>
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
            <div className="text-center py-8 text-muted-foreground">
              <p className="font-medium">{t('performance.noData')}</p>
              <p className="text-xs mt-1">{t('performance.minRoomsNote').replace('{minRooms}', String(THRESHOLDS.minRoomsForRanking)).replace('{minDays}', String(THRESHOLDS.minDaysForRanking))}</p>
            </div>
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
                          {t('performance.roomsInDays').replace('{rooms}', String(entry.total_completed)).replace('{days}', String(entry.unique_work_days))}
                          {entry.excluded_outliers > 0 && (
                            <span className="text-orange-500 ml-1">({t('performance.outliersRemoved').replace('{count}', String(entry.excluded_outliers))})</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {getPerformanceBadge(entry.performance_score)}
                  </div>

                  {/* Score breakdown bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{entry.performance_score}/100</span>
                      {entry.attendance_streak > 0 && (
                        <span className="text-green-600">🔥 {t('performance.dayStreak').replace('{count}', String(entry.attendance_streak))}</span>
                      )}
                    </div>
                    {/* Stacked score breakdown */}
                    <div className="w-full bg-secondary rounded-full h-2.5 flex overflow-hidden">
                      <div className="bg-blue-500 h-full transition-all" style={{ width: `${entry.speed_score}%` }} title={`Speed: ${entry.speed_score}`} />
                      <div className="bg-green-500 h-full transition-all" style={{ width: `${entry.productivity_score}%` }} title={`Productivity: ${entry.productivity_score}`} />
                      <div className="bg-purple-500 h-full transition-all" style={{ width: `${entry.punctuality_score}%` }} title={`Punctuality: ${entry.punctuality_score}`} />
                      <div className="bg-teal-500 h-full transition-all" style={{ width: `${entry.consistency_score}%` }} title={`Consistency: ${entry.consistency_score}`} />
                      <div className="bg-yellow-500 h-full transition-all" style={{ width: `${entry.quality_score}%` }} title={`Quality: ${entry.quality_score}`} />
                    </div>
                    <div className="flex gap-2 mt-1 text-[9px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Spd:{entry.speed_score}</span>
                      <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Prod:{entry.productivity_score}</span>
                      <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />Punc:{entry.punctuality_score}</span>
                      <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-teal-500 inline-block" />Cons:{entry.consistency_score}</span>
                      <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Qual:{entry.quality_score}</span>
                    </div>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'daily')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-blue-700 dark:text-blue-400">
                              {entry.daily_completed === 0 ? '-' : `${entry.daily_avg_time}m`}
                            </div>
                            <div className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-500">{t('performance.daily')}</div>
                            {entry.daily_stddev > 0 && (
                              <div className="text-[8px] text-muted-foreground">±{entry.daily_stddev}m</div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Avg daily clean time (±{entry.daily_stddev}m stddev)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'checkout')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-green-700 dark:text-green-400">
                              {entry.checkout_completed === 0 ? '-' : `${entry.checkout_avg_time}m`}
                            </div>
                            <div className="text-[10px] sm:text-xs text-green-600 dark:text-green-500">{t('performance.checkout')}</div>
                            {entry.checkout_stddev > 0 && (
                              <div className="text-[8px] text-muted-foreground">±{entry.checkout_stddev}m</div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Avg checkout clean time (±{entry.checkout_stddev}m stddev)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-center p-2 bg-teal-50 dark:bg-teal-900/20 rounded-lg cursor-pointer hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors">
                            <div className="text-lg sm:text-xl font-bold text-teal-700 dark:text-teal-400">{entry.rooms_per_hour}</div>
                            <div className="text-[10px] sm:text-xs text-teal-600 dark:text-teal-500">Rooms/Hr</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Rooms per working hour ({entry.rooms_per_day} rooms/day)</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'punctual')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-purple-700 dark:text-purple-400">{Math.round(entry.punctuality_rate)}%</div>
                            <div className="text-[10px] sm:text-xs text-purple-600 dark:text-purple-500">{t('performance.punctual')}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>On-time arrival rate (before {THRESHOLDS.punctualityCutoff})</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="text-center p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors"
                            onClick={() => openDetailDialog(entry.housekeeper_id, entry.full_name, 'hours')}
                          >
                            <div className="text-lg sm:text-xl font-bold text-orange-700 dark:text-orange-400">{entry.avg_working_hours}h</div>
                            <div className="text-[10px] sm:text-xs text-orange-600 dark:text-orange-500">Hours</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>Avg working hours per day</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                            <div className="text-lg sm:text-xl font-bold text-yellow-700 dark:text-yellow-400">
                              {entry.rating_count > 0 ? `${entry.avg_rating}★` : '-'}
                            </div>
                            <div className="text-[10px] sm:text-xs text-yellow-600 dark:text-yellow-500">Quality</div>
                            {entry.rating_count > 0 && (
                              <div className="text-[8px] text-muted-foreground">{entry.rating_count} reviews</div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {entry.rating_count > 0 
                            ? `Manager rating: ${entry.avg_rating}/5 (${entry.rating_count} reviews)`
                            : 'No ratings yet — scored at 50%'
                          }
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Late check-in warning */}
                  {entry.late_check_ins && entry.late_check_ins.length > 0 && (
                    <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                      <div className="text-orange-600 dark:text-orange-400 font-semibold text-xs flex items-center gap-1">
                        ⚠️ {t('performance.lateArrivals')} ({entry.late_check_ins.length})
                      </div>
                      <div className="mt-1 space-y-0.5 max-h-20 overflow-y-auto">
                        {entry.late_check_ins.slice(0, 3).map((attendance: any, idx: number) => (
                          <div key={idx} className="text-[10px] text-orange-700 dark:text-orange-400 flex justify-between">
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
