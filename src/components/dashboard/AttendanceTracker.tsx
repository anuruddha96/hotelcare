import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Clock, MapPin, Calendar, Coffee, LogOut, LogIn } from 'lucide-react';
import { format } from 'date-fns';

interface AttendanceRecord {
  id: string;
  check_in_time: string;
  check_out_time: string | null;
  check_in_location: any;
  check_out_location: any;
  work_date: string;
  total_hours: number | null;
  break_duration: number;
  status: string;
  notes: string | null;
}

export const AttendanceTracker = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentRecord, setCurrentRecord] = useState<AttendanceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number; address?: string } | null>(null);

  useEffect(() => {
    if (user) {
      fetchTodaysAttendance();
      getCurrentLocation();
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
        title: "Check-in Successful",
        description: `Checked in at ${format(new Date(), 'HH:mm')}`
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
        title: "Check-out Successful",
        description: `Checked out at ${format(new Date(), 'HH:mm')}`
      });
      fetchTodaysAttendance();
    }

    setIsLoading(false);
  };

  const handleBreak = async (isStartingBreak: boolean) => {
    if (!currentRecord) return;

    setIsLoading(true);

    const { error } = await supabase
      .from('staff_attendance')
      .update({
        status: isStartingBreak ? 'on_break' : 'checked_in'
      })
      .eq('id', currentRecord.id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update break status",
        variant: "destructive"
      });
    } else {
      toast({
        title: isStartingBreak ? "Break Started" : "Break Ended",
        description: `${isStartingBreak ? 'On break' : 'Back to work'} at ${format(new Date(), 'HH:mm')}`
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
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <Clock className="h-5 w-5" />
          Attendance Tracker
        </CardTitle>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          {format(new Date(), 'EEEE, MMMM do, yyyy')}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span className="truncate">{location.address}</span>
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
                </>
              )}
            </div>

            <Textarea
              placeholder="Add notes for today..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />

            <div className="space-y-2">
              {currentRecord.status === 'checked_in' && (
                <>
                  <Button
                    onClick={() => handleBreak(true)}
                    variant="outline"
                    className="w-full"
                    disabled={isLoading}
                  >
                    <Coffee className="h-4 w-4 mr-2" />
                    Start Break
                  </Button>
                  <Button
                    onClick={handleCheckOut}
                    className="w-full"
                    disabled={isLoading}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Check Out
                  </Button>
                </>
              )}

              {currentRecord.status === 'on_break' && (
                <>
                  <Button
                    onClick={() => handleBreak(false)}
                    variant="outline"
                    className="w-full"
                    disabled={isLoading}
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    End Break
                  </Button>
                  <Button
                    onClick={handleCheckOut}
                    className="w-full"
                    disabled={isLoading}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Check Out
                  </Button>
                </>
              )}

              {currentRecord.status === 'checked_out' && (
                <div className="text-center text-sm text-muted-foreground">
                  You have completed your work day. See you tomorrow!
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

            <Button
              onClick={handleCheckIn}
              className="w-full"
              disabled={isLoading || !location}
            >
              <LogIn className="h-4 w-4 mr-2" />
              Check In
            </Button>

            {!location && (
              <div className="text-xs text-muted-foreground text-center">
                Waiting for location access...
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};