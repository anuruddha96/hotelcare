import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Clock, MapPin, Calendar, Coffee, LogOut, LogIn, Utensils, Timer } from 'lucide-react';
import { format } from 'date-fns';
import { BreakTimer } from './BreakTimer';
import { BreakTypesManagement } from './BreakTypesManagement';
import { useTranslation } from '@/hooks/useTranslation';
import { SwipeToEndBreak } from './SwipeToEndBreak';
import { BreakRequestDialog } from './BreakRequestDialog';
import { SwipeAction } from '@/components/ui/swipe-action';

interface AttendanceRecord {
  id: string;
  check_in_time: string;
  check_out_time: string | null;
  check_in_location: any;
  check_out_location: any;
  work_date: string;
  total_hours: number | null;
  break_duration: number;
  break_type: string | null;
  break_started_at: string | null;
  break_ended_at: string | null;
  status: string;
  notes: string | null;
}

interface BreakType {
  id: string;
  name: string;
  display_name: string;
  duration_minutes: number;
  icon_name: string;
  is_active: boolean;
}

export const AttendanceTracker = ({ onStatusChange }: { onStatusChange?: (status: string | null) => void }) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [currentRecord, setCurrentRecord] = useState<AttendanceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [selectedBreakType, setSelectedBreakType] = useState<string>('');
  const [breakTypes, setBreakTypes] = useState<BreakType[]>([]);
  const [location, setLocation] = useState<{ latitude: number; longitude: number; address?: string } | null>(null);
  
  const isAdminOrHR = profile?.role && ['admin', 'hr', 'manager'].includes(profile.role);

  useEffect(() => {
    if (user) {
      fetchTodaysAttendance();
      getCurrentLocation();
      fetchBreakTypes();
    }
  }, [user]);

  const getCurrentLocation = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          
          // Get address from coordinates
          try {
            const response = await fetch(
              `https://api.opencagedata.com/geocode/v1/json?q=${latitude}+${longitude}&key=demo&limit=1`
            );
            const data = await response.json();
            const address = data.results[0]?.formatted || `${latitude}, ${longitude}`;
            
            setLocation({ latitude, longitude, address });
          } catch (error) {
            setLocation({ latitude, longitude, address: `${latitude}, ${longitude}` });
          }
        },
        (error) => {
          toast({
            title: "Location Access",
            description: "Could not get your location. Please enable location services.",
            variant: "destructive"
          });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    }
  };

  const fetchBreakTypes = async () => {
    const { data, error } = await supabase
      .from('break_types')
      .select('*')
      .eq('is_active', true)
      .order('duration_minutes', { ascending: true });

    if (!error && data) {
      setBreakTypes(data);
      if (data.length > 0 && !selectedBreakType) {
        setSelectedBreakType(data[0].name);
      }
    }
  };

  const fetchTodaysAttendance = async () => {
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('*')
      .eq('user_id', user.id)
      .eq('work_date', today)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching attendance:', error);
      return;
    }

    if (data) {
      setCurrentRecord(data as AttendanceRecord);
      setNotes(data.notes || '');
      // Notify parent component about status change
      onStatusChange?.(data.status);
    } else {
      onStatusChange?.(null);
    }
  };

  const handleCheckIn = async () => {
    if (!user || !location) {
      toast({
        title: "Error",
        description: "Location is required for check-in",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    const { error } = await supabase
      .from('staff_attendance')
      .insert({
        user_id: user.id,
        check_in_location: location,
        notes: notes || null,
        status: 'checked_in'
      });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to check in. Please try again.",
        variant: "destructive"
      });
    } else {
      toast({
        title: "Welcome to Your Shift!", 
        description: "You're all set! Time to shine ✨",
      });
      fetchTodaysAttendance();
    }
    
    setIsLoading(false);
  };

  const handleCheckOut = async () => {
    if (!currentRecord || !location) {
      toast({
        title: "Error",
        description: "Location is required for check-out",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    const { error } = await supabase
      .from('staff_attendance')
      .update({
        check_out_time: new Date().toISOString(),
        check_out_location: location,
        notes: notes || null
      })
      .eq('id', currentRecord.id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to check out. Please try again.",
        variant: "destructive"
      });
    } else {
      toast({
        title: "Shift Complete",
        description: "Thank you for your hard work today! Have a great rest of your day.",
      });
      fetchTodaysAttendance();
    }

    setIsLoading(false);
  };

  const handleBreak = async (isStartingBreak: boolean) => {
    if (!currentRecord) return;

    setIsLoading(true);

    const now = new Date().toISOString();
    const updateData: any = {
      status: isStartingBreak ? 'on_break' : 'checked_in'
    };

    if (isStartingBreak) {
      updateData.break_type = selectedBreakType;
      updateData.break_started_at = now;
    } else {
      updateData.break_ended_at = now;
    }

    const { error } = await supabase
      .from('staff_attendance')
      .update(updateData)
      .eq('id', currentRecord.id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update break status",
        variant: "destructive"
      });
    } else {
      const selectedBreak = breakTypes.find(bt => bt.name === selectedBreakType);
      
      toast({
        title: isStartingBreak ? "Time to Rest & Recharge" : "Energized & Ready to Go!",
        description: isStartingBreak 
          ? "Enjoy your break! 🌸"
          : "Welcome back! Let's make great things happen ⚡"
      });
      fetchTodaysAttendance();
    }

    setIsLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'checked_in':
        return <Badge className="bg-green-500 text-white">Working</Badge>;
      case 'on_break':
        return <Badge className="bg-yellow-500 text-white">On Break</Badge>;
      case 'checked_out':
        return <Badge className="bg-gray-500 text-white">Checked Out</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const formatTime = (timeString: string) => {
    return format(new Date(timeString), 'HH:mm');
  };

  return (
    <div className="space-y-6">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <Clock className="h-5 w-5" />
            Work Status
          </CardTitle>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {format(new Date(), 'EEEE, MMMM do, yyyy')}
          </div>
        </CardHeader>

      <CardContent className="space-y-4">
        {location ? (
          <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-lg border">
            <MapPin className="h-4 w-4 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Current Location</p>
              <p className="text-xs text-muted-foreground truncate">{location.address}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border border-dashed">
            <MapPin className="h-4 w-4 text-muted-foreground animate-pulse" />
            <div className="flex-1">
              <p className="text-sm font-medium">Getting your location...</p>
              <p className="text-xs text-muted-foreground">Please allow GPS access for accurate attendance tracking</p>
            </div>
          </div>
        )}

        {currentRecord ? (
          <div className="space-y-4">
            <div className="text-center">
              {getStatusBadge(currentRecord.status)}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Check-in:</span>
                <span className="text-sm">{formatTime(currentRecord.check_in_time)}</span>
              </div>
              
              {currentRecord.check_out_time && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Check-out:</span>
                    <span className="text-sm">{formatTime(currentRecord.check_out_time)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Hours worked:</span>
                    <span className="text-sm font-bold">
                      {currentRecord.total_hours ? `${currentRecord.total_hours.toFixed(1)}h` : 'N/A'}
                    </span>
                  </div>

                  {/* Special break request option for housekeeping */}
                  <div className="pt-4 border-t">
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-muted-foreground text-center">
                        Need a different type of break?
                      </p>
                      <BreakRequestDialog onRequestSubmitted={() => {}} />
                    </div>
                  </div>
                </>
              )}
            </div>

            <Textarea
              placeholder="Add notes for today..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />

            <div className="space-y-4">
              {currentRecord.status === 'checked_in' && (
                <>
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-center">Select Break Type:</div>
                    <Select value={selectedBreakType} onValueChange={setSelectedBreakType}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {breakTypes.map((breakType) => {
                          const getIcon = (iconName: string) => {
                            switch(iconName) {
                              case 'Utensils': return Utensils;
                              case 'Timer': return Timer;
                              case 'Clock': return Clock;
                              default: return Coffee;
                            }
                          };
                          const IconComponent = getIcon(breakType.icon_name);
                          return (
                            <SelectItem key={breakType.id} value={breakType.name}>
                              <div className="flex items-center gap-2">
                                <IconComponent className="h-4 w-4" />
                                {breakType.display_name} ({breakType.duration_minutes} minutes)
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    
                    <Button
                      onClick={() => handleBreak(true)}
                      variant="outline"
                      className="w-full bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 hover:from-blue-100 hover:to-purple-100 transition-all duration-300 hover:scale-105"
                      disabled={isLoading}
                    >
                      <Coffee className="h-4 w-4 mr-2" />
                      Start Break 😌
                    </Button>
                  </div>
                  
                  <Button
                    onClick={handleCheckOut}
                    variant="outline"
                    className="w-full transition-all duration-300 hover:scale-105"
                    disabled={isLoading}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    End Shift
                  </Button>
                </>
              )}

              {currentRecord.status === 'on_break' && (
                <>
                  {currentRecord.break_started_at && (
                    <div className="mb-4">
                      <BreakTimer
                        breakType={currentRecord.break_type || 'coffee'}
                        startedAt={currentRecord.break_started_at}
                      />
                    </div>
                  )}
                  
                  <SwipeToEndBreak
                    onSwipeComplete={() => handleBreak(false)}
                    disabled={isLoading}
                  />
                  
                  <Button
                    onClick={handleCheckOut}
                    variant="outline"
                    className="w-full transition-all duration-300 hover:scale-105"
                    disabled={isLoading}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    End Shift
                  </Button>
                </>
              )}

              {currentRecord.status === 'checked_out' && (
                <div className="text-center p-6 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200 animate-fade-in">
                  <div className="text-4xl mb-3">🎉</div>
                  <div className="text-xl font-bold text-green-700 mb-3">
                    Amazing Work Today!
                  </div>
                  <div className="text-sm text-green-600 mb-2 font-medium">
                    You've completed your shift successfully
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Rest well and see you tomorrow! ✨
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <Badge variant="outline">Not Checked In</Badge>
            </div>

            <Textarea
              placeholder="Add notes for today..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />

            {/* Swipe to Check-in */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200">
                <div className="text-2xl">🌅</div>
                <div>
                  <p className="font-medium text-green-800">Ready to start?</p>
                  <p className="text-sm text-green-600">Swipe right to check in</p>
                </div>
              </div>
              
              <SwipeAction
                label="Swipe right to check in"
                onComplete={handleCheckIn}
                disabled={isLoading || !location}
              />
            </div>

            {!location && (
              <div className="text-xs text-muted-foreground text-center">
                Waiting for location access...
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Admin/HR Break Types Management */}
    {isAdminOrHR && (
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">Break Types Management</h3>
        <BreakTypesManagement />
      </div>
    )}
    </div>
  );
};