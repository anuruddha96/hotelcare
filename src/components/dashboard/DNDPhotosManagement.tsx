import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, Calendar, User, MessageSquare, X, MapPin } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';

interface DNDPhoto {
  id: string;
  photo_url: string;
  marked_at: string;
  assignment_date: string;
  notes?: string | null;
  marked_by: string;
  room_id: string;
  profiles?: {
    full_name: string;
  } | null;
  rooms?: {
    room_number: string;
    hotel: string;
  } | null;
}

export function DNDPhotosManagement() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<DNDPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('7days');
  const [selectedHotel, setSelectedHotel] = useState<string>('all');
  const [hotels, setHotels] = useState<string[]>([]);

  const canViewPhotos = profile?.role && ['admin', 'manager', 'housekeeping_manager', 'top_management'].includes(profile.role);

  useEffect(() => {
    if (canViewPhotos) {
      fetchHotels();
      fetchDNDPhotos();
    }
  }, [canViewPhotos, selectedPeriod, selectedHotel]);

  const getDateRange = () => {
    const today = new Date();
    
    switch (selectedPeriod) {
      case 'today':
        return { start: today, end: today };
      case '7days':
        return { start: subDays(today, 7), end: today };
      case '30days':
        return { start: subDays(today, 30), end: today };
      default:
        return { start: subDays(today, 7), end: today };
    }
  };

  const fetchHotels = async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('hotel')
        .not('hotel', 'is', null);

      if (error) throw error;

      const uniqueHotels = [...new Set(data?.map(room => room.hotel) || [])];
      setHotels(uniqueHotels);
    } catch (error) {
      console.error('Error fetching hotels:', error);
    }
  };

  const fetchDNDPhotos = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      
      // First get the photos
      const { data: photosData, error: photosError } = await supabase
        .from('dnd_photos')
        .select(`
          *,
          profiles!marked_by (
            full_name
          )
        `)
        .gte('assignment_date', format(start, 'yyyy-MM-dd'))
        .lte('assignment_date', format(end, 'yyyy-MM-dd'))
        .order('marked_at', { ascending: false });

      if (photosError) throw photosError;

      if (!photosData || photosData.length === 0) {
        setPhotos([]);
        setLoading(false);
        return;
      }

      // Get room data separately
      const roomIds = photosData.map(photo => photo.room_id);
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, hotel')
        .in('id', roomIds);

      if (roomsError) throw roomsError;

      // Create a map of room data
      const roomMap = new Map(roomsData?.map(room => [room.id, room]) || []);

      // Combine photos with room data and filter by hotel if needed
      let photosWithRooms = photosData.map(photo => ({
        ...photo,
        rooms: roomMap.get(photo.room_id) || null
      }));

      // Apply hotel filter if not 'all'
      if (selectedHotel !== 'all') {
        photosWithRooms = photosWithRooms.filter(photo => 
          photo.rooms?.hotel === selectedHotel
        );
      }

      // Get signed URLs for photos
      const photosWithUrls = await Promise.all(
        photosWithRooms.map(async (photo: any) => {
          const { data: urlData } = await supabase.storage
            .from('dnd-photos')
            .createSignedUrl(photo.photo_url, 3600); // 1 hour expiry

          return {
            ...photo,
            photo_url: urlData?.signedUrl || photo.photo_url
          } as DNDPhoto;
        })
      );

      setPhotos(photosWithUrls);
    } catch (error) {
      console.error('Error fetching DND photos:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPhotosByDate = () => {
    const photosByDate: { [key: string]: DNDPhoto[] } = {};
    
    photos.forEach(photo => {
      const date = photo.assignment_date;
      if (!photosByDate[date]) {
        photosByDate[date] = [];
      }
      photosByDate[date].push(photo);
    });

    return photosByDate;
  };

  if (!canViewPhotos) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Only managers and admins can view DND photo evidence.
          </p>
        </CardContent>
      </Card>
    );
  }

  const photosByDate = getPhotosByDate();
  const dates = Object.keys(photosByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            DND Photo Evidence Management
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            View and manage photographic evidence of DND notices from housekeeping staff
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedHotel} onValueChange={setSelectedHotel}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select Hotel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Hotels</SelectItem>
                {hotels.map(hotel => (
                  <SelectItem key={hotel} value={hotel}>
                    {hotel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={fetchDNDPhotos} variant="outline">
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Photos Display */}
      <div className="space-y-6">
        {loading ? (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="text-muted-foreground">Loading DND photos...</div>
            </CardContent>
          </Card>
        ) : photos.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No DND photos found for the selected period and hotel
              </p>
            </CardContent>
          </Card>
        ) : (
          dates.map(date => (
            <Card key={date}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <CardTitle className="text-lg">
                    {format(new Date(date), 'EEEE, MMMM d, yyyy')}
                  </CardTitle>
                  <Badge variant="outline">
                    {photosByDate[date].length} photo{photosByDate[date].length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {photosByDate[date].map(photo => (
                    <Card key={photo.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="p-3 space-y-3">
                        <div 
                          className="relative aspect-[4/3] bg-muted rounded-lg overflow-hidden"
                          onClick={() => setSelectedPhoto(photo.photo_url)}
                        >
                          <img
                            src={photo.photo_url}
                            alt="DND Evidence"
                            className="w-full h-full object-cover hover:scale-105 transition-transform"
                          />
                        </div>

                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            <span className="font-medium">
                              Room {photo.rooms?.room_number} - {photo.rooms?.hotel}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-muted-foreground">
                            <User className="h-3 w-3" />
                            <span>{photo.profiles?.full_name || 'Unknown Staff'}</span>
                          </div>
                          
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>{format(new Date(photo.marked_at), 'HH:mm')}</span>
                          </div>

                          {photo.notes && (
                            <div className="flex items-start gap-2 text-muted-foreground">
                              <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" />
                              <span className="text-xs line-clamp-2">{photo.notes}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Photo Viewer Dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="w-[95vw] max-w-3xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>DND Photo Evidence</DialogTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedPhoto(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          
          {selectedPhoto && (
            <div className="space-y-4">
              <img
                src={selectedPhoto}
                alt="DND Evidence - Full Size"
                className="w-full rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}