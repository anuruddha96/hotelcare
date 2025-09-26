import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Camera, Calendar, Hotel, User, Eye, Download } from 'lucide-react';
import { format, subDays } from 'date-fns';

interface DNDPhoto {
  id: string;
  room_id: string;
  assignment_id: string | null;
  marked_by: string;
  marked_at: string;
  assignment_date: string;
  notes: string | null;
  photo_url: string;
  rooms?: {
    room_number: string;
    hotel: string;
    room_name: string | null;
  };
  profiles?: {
    full_name: string;
  };
}

export function DailyPhotosManagement() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<DNDPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<DNDPhoto | null>(null);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('today');
  const [hotelFilter, setHotelFilter] = useState('all');
  const [hotels, setHotels] = useState<any[]>([]);

  useEffect(() => {
    fetchHotels();
    fetchDNDPhotos();
  }, [dateFilter, hotelFilter]);

  const fetchHotels = async () => {
    try {
      const { data, error } = await supabase
        .from('hotels')
        .select('*')
        .order('name');

      if (error) throw error;
      setHotels(data || []);
    } catch (error) {
      console.error('Error fetching hotels:', error);
    }
  };

  const getDateRange = () => {
    const today = new Date();
    switch (dateFilter) {
      case 'today':
        return { start: today, end: today };
      case 'yesterday':
        return { start: subDays(today, 1), end: subDays(today, 1) };
      case 'week':
        return { start: subDays(today, 7), end: today };
      case 'month':
        return { start: subDays(today, 30), end: today };
      default:
        return { start: today, end: today };
    }
  };

  const fetchDNDPhotos = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      
      // First get the photos with proper joins
      let query = supabase
        .from('dnd_photos')
        .select(`
          *,
          rooms (
            room_number,
            hotel,
            room_name
          ),
          profiles (
            full_name
          )
        `)
        .gte('assignment_date', format(start, 'yyyy-MM-dd'))
        .lte('assignment_date', format(end, 'yyyy-MM-dd'))
        .order('marked_at', { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching DND photos:', error);
        setPhotos([]);
        return;
      }
      
      // Filter by hotel if specified
      let filteredData = data || [];
      if (hotelFilter !== 'all') {
        filteredData = filteredData.filter(photo => 
          photo.rooms?.hotel === hotelFilter
        );
      }
      
      // Only set photos that have valid room and profile data
      const validPhotos = filteredData.filter(photo => 
        photo.rooms && photo.profiles && 
        photo.rooms.room_number && photo.rooms.hotel
      );
      
      setPhotos(validPhotos);
    } catch (error) {
      console.error('Error fetching DND photos:', error);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  const viewPhoto = (photo: DNDPhoto) => {
    setSelectedPhoto(photo);
    setPhotoDialogOpen(true);
  };

  const downloadPhoto = async (photo: DNDPhoto) => {
    try {
      // Extract filename from photo_url - handle both bucket path and full URL
      const filename = photo.photo_url.includes('/') 
        ? photo.photo_url.split('/').pop() || ''
        : photo.photo_url;

      const { data, error } = await supabase.storage
        .from('dnd-photos')
        .download(filename);

      if (error) {
        console.error('Storage download error:', error);
        // Try direct download as fallback
        const link = document.createElement('a');
        link.href = photo.photo_url;
        link.download = `room-${photo.rooms?.room_number}-${format(new Date(photo.marked_at), 'yyyy-MM-dd-HHmm')}.jpg`;
        link.target = '_blank';
        link.click();
        return;
      }

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `room-${photo.rooms?.room_number}-${format(new Date(photo.marked_at), 'yyyy-MM-dd-HHmm')}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading photo:', error);
      // Final fallback - direct download
      const link = document.createElement('a');
      link.href = photo.photo_url;
      link.download = `room-${photo.rooms?.room_number}-${format(new Date(photo.marked_at), 'yyyy-MM-dd-HHmm')}.jpg`;
      link.target = '_blank';
      link.click();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Daily Room Photos Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="week">Last 7 Days</SelectItem>
                <SelectItem value="month">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>

            <Select value={hotelFilter} onValueChange={setHotelFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select Hotel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Hotels</SelectItem>
                {hotels.map(hotel => (
                  <SelectItem key={hotel.id} value={hotel.name}>
                    {hotel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo) => (
                <Card key={photo.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                   <div className="aspect-video relative bg-gray-100">
                     <img
                       src={photo.photo_url}
                       alt={`Room ${photo.rooms?.room_number} photo`}
                       className="w-full h-full object-cover"
                       onError={(e) => {
                         console.error('Failed to load image:', photo.photo_url);
                         (e.target as HTMLImageElement).src = '/placeholder.svg';
                       }}
                     />
                    <div className="absolute top-2 right-2 flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => viewPhoto(photo)}
                        className="h-8 w-8 p-0"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => downloadPhoto(photo)}
                        className="h-8 w-8 p-0"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Hotel className="h-3 w-3" />
                          Room {photo.rooms?.room_number}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {format(new Date(photo.marked_at), 'MMM dd, HH:mm')}
                        </Badge>
                      </div>
                      
                      <div className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Hotel className="h-3 w-3" />
                          {photo.rooms?.hotel}
                        </div>
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {photo.profiles?.full_name}
                        </div>
                        {photo.rooms?.room_name && (
                          <div className="text-xs">
                            {photo.rooms.room_name}
                          </div>
                        )}
                      </div>

                      {photo.notes && (
                        <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                          {photo.notes}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {photos.length === 0 && !loading && (
                <div className="col-span-full text-center py-8 text-muted-foreground">
                  <Camera className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No photos found for the selected period</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Photo Viewer Dialog */}
      <Dialog open={photoDialogOpen} onOpenChange={setPhotoDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Room {selectedPhoto?.rooms?.room_number} - {selectedPhoto?.rooms?.hotel}
            </DialogTitle>
          </DialogHeader>
          {selectedPhoto && (
            <div className="space-y-4">
              <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
                <img
                  src={selectedPhoto.photo_url}
                  alt={`Room ${selectedPhoto.rooms?.room_number} photo`}
                  className="w-full h-full object-contain"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>Room:</strong> {selectedPhoto.rooms?.room_number}
                </div>
                <div>
                  <strong>Hotel:</strong> {selectedPhoto.rooms?.hotel}
                </div>
                <div>
                  <strong>Taken by:</strong> {selectedPhoto.profiles?.full_name}
                </div>
                <div>
                  <strong>Date:</strong> {format(new Date(selectedPhoto.marked_at), 'MMM dd, yyyy HH:mm')}
                </div>
              </div>

              {selectedPhoto.notes && (
                <div className="bg-muted p-3 rounded">
                  <strong>Notes:</strong> {selectedPhoto.notes}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadPhoto(selectedPhoto)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button onClick={() => setPhotoDialogOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}