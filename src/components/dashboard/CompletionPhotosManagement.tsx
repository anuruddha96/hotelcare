import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { CheckCircle, Calendar, Hotel, User, Eye, Download, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { format, subDays } from 'date-fns';

interface CompletionPhoto {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_date: string;
  completed_at: string;
  completion_photos: string[];
  assignment_type: string;
  rooms?: {
    room_number: string;
    hotel: string;
    room_name: string | null;
  };
  assigned_to_name?: string;
}

export function CompletionPhotosManagement() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<CompletionPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<{photo: CompletionPhoto, photoUrl: string} | null>(null);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('today');
  const [hotelFilter, setHotelFilter] = useState('all');
  const [hotels, setHotels] = useState<any[]>([]);
  const [userHotelName, setUserHotelName] = useState<string>('');

  const canDelete = (profile?.role && ['admin'].includes(profile.role)) || profile?.is_super_admin;

  useEffect(() => {
    fetchHotels();
    fetchUserHotelName();
  }, [profile]);

  useEffect(() => {
    if (userHotelName) {
      fetchCompletionPhotos();
    }
  }, [dateFilter, hotelFilter, userHotelName]);

  const fetchUserHotelName = async () => {
    if (!profile?.assigned_hotel) return;
    
    try {
      const { data, error } = await supabase
        .rpc('get_hotel_name_from_id', { hotel_id: profile.assigned_hotel });
      
      if (error) throw error;
      setUserHotelName(data || profile.assigned_hotel);
    } catch (error) {
      console.error('Error fetching user hotel name:', error);
      setUserHotelName(profile.assigned_hotel);
    }
  };

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

  const fetchCompletionPhotos = async () => {
    if (!userHotelName) return;
    
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      
      let query = supabase
        .from('room_assignments')
        .select(`
          *,
          rooms (
            room_number,
            hotel,
            room_name
          )
        `)
        .gte('assignment_date', format(start, 'yyyy-MM-dd'))
        .lte('assignment_date', format(end, 'yyyy-MM-dd'))
        .eq('status', 'completed')
        .not('completion_photos', 'is', null)
        .not('completion_photos', 'eq', '{}')
        .order('completed_at', { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching completion photos:', error);
        setPhotos([]);
        return;
      }
      
      // Filter by user's assigned hotel first, then by hotelFilter if needed
      let filteredData = (data || []).filter(photo => 
        photo.rooms?.hotel === userHotelName || 
        photo.rooms?.hotel === profile?.assigned_hotel
      );
      
      if (hotelFilter !== 'all') {
        filteredData = filteredData.filter(photo => 
          photo.rooms?.hotel === hotelFilter
        );
      }
      
      // Get profile data for assigned_to users
      const userIds = [...new Set(filteredData.map(photo => photo.assigned_to))];
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const validPhotos = filteredData
        .filter(photo => 
          photo.rooms && 
          photo.rooms.room_number && photo.rooms.hotel &&
          photo.completion_photos && photo.completion_photos.length > 0
        )
        .map(photo => ({
          ...photo,
          assigned_to_name: profilesData?.find(p => p.id === photo.assigned_to)?.full_name || 'Unknown'
        }));
      
      setPhotos(validPhotos);
    } catch (error) {
      console.error('Error fetching completion photos:', error);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  const viewPhoto = (photo: CompletionPhoto, photoUrl: string) => {
    setSelectedPhoto({photo, photoUrl});
    setPhotoDialogOpen(true);
  };

  const getImageUrl = (photoUrl: string) => {
    if (photoUrl.startsWith('http')) {
      return photoUrl;
    }
    
    // For completion photos, they might be stored with full URLs already
    return photoUrl;
  };

  const downloadPhoto = async (photo: CompletionPhoto, photoUrl: string) => {
    try {
      // Try to open the image URL directly for download
      const a = document.createElement('a');
      a.href = photoUrl;
      a.download = `completion-room-${photo.rooms?.room_number}-${format(new Date(photo.completed_at || ''), 'yyyy-MM-dd-HHmm')}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading photo:', error);
      window.open(photoUrl, '_blank');
    }
  };

  const handleDeletePhoto = async (assignmentId: string, photoUrl: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return;
    
    try {
      // Get the current assignment
      const { data: assignment, error: fetchError } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignmentId)
        .single();

      if (fetchError) throw fetchError;

      // Remove the photo from the array
      const updatedPhotos = (assignment.completion_photos || []).filter((p: string) => p !== photoUrl);

      // Update the assignment with the new photos array
      const { error: updateError } = await supabase
        .from('room_assignments')
        .update({ completion_photos: updatedPhotos })
        .eq('id', assignmentId);

      if (updateError) throw updateError;

      toast({
        title: 'Success',
        description: 'Photo deleted successfully',
      });

      fetchCompletionPhotos();
    } catch (error: any) {
      console.error('Error deleting photo:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete photo',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            {t('completionPhotos.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{t('completionPhotos.today')}</SelectItem>
                <SelectItem value="yesterday">{t('completionPhotos.yesterday')}</SelectItem>
                <SelectItem value="week">{t('completionPhotos.lastWeek')}</SelectItem>
                <SelectItem value="month">{t('completionPhotos.lastMonth')}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={hotelFilter} onValueChange={setHotelFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t('completionPhotos.selectHotel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('completionPhotos.allHotels')}</SelectItem>
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
                <div key={photo.id}>
                   {photo.completion_photos.map((photoUrl, index) => {
                    // Extract category from filename
                    const filename = photoUrl.split('/').pop() || '';
                    const category = filename.split('_')[0];
                    const categoryMap: { [key: string]: string } = {
                      'trash_bin': 'Trash Bin',
                      'bathroom': 'Bathroom',
                      'bed': 'Bed',
                      'minibar': 'Minibar',
                      'tea_coffee_table': 'Tea/Coffee Table'
                    };
                    const categoryName = categoryMap[category] || 'Room Photo';
                    
                    return (
                    <Card key={`${photo.id}-${index}`} className="overflow-hidden hover:shadow-lg transition-shadow border-green-200 mb-4">
                       <div className="aspect-video relative bg-gray-100">
                          <img
                            src={getImageUrl(photoUrl)}
                            alt={`${categoryName} - Room ${photo.rooms?.room_number}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              console.error('Failed to load image:', photoUrl);
                              (e.target as HTMLImageElement).src = '/placeholder.svg';
                            }}
                          />
                         <div className="absolute top-2 left-2">
                           <Badge className="bg-green-100 text-green-800 flex items-center gap-1">
                             <CheckCircle className="h-3 w-3" />
                             Completed
                           </Badge>
                         </div>
                          <div className="absolute top-2 right-2 flex gap-1">
                           <Button
                             size="sm"
                             variant="secondary"
                             onClick={() => viewPhoto(photo, photoUrl)}
                             className="h-8 w-8 p-0"
                           >
                             <Eye className="h-4 w-4" />
                           </Button>
                           <Button
                             size="sm"
                             variant="secondary"
                             onClick={() => downloadPhoto(photo, photoUrl)}
                             className="h-8 w-8 p-0"
                           >
                             <Download className="h-4 w-4" />
                           </Button>
                           {canDelete && (
                             <Button
                               size="sm"
                               variant="destructive"
                               onClick={() => handleDeletePhoto(photo.id, photoUrl)}
                               className="h-8 w-8 p-0"
                             >
                               <Trash2 className="h-4 w-4" />
                             </Button>
                           )}
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
                               {format(new Date(photo.completed_at || ''), 'MMM dd, HH:mm')}
                             </Badge>
                           </div>
                           
                           <div className="text-sm text-muted-foreground">
                             <div className="flex items-center gap-1">
                               <Hotel className="h-3 w-3" />
                               {photo.rooms?.hotel}
                             </div>
                             <div className="flex items-center gap-1">
                               <User className="h-3 w-3" />
                               {photo.assigned_to_name}
                             </div>
                             <div className="text-xs font-semibold text-blue-600">
                               {categoryName}
                             </div>
                             {photo.rooms?.room_name && (
                               <div className="text-xs">
                                 {photo.rooms.room_name}
                               </div>
                             )}
                           </div>
                         </div>
                       </CardContent>
                     </Card>
                   )})}
                 </div>
               ))}


              {photos.length === 0 && !loading && (
                <div className="col-span-full text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t('completionPhotos.noPhotos')}</p>
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
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              {t('completionPhotos.dialogTitle')} {selectedPhoto?.photo.rooms?.room_number} - {selectedPhoto?.photo.rooms?.hotel}
            </DialogTitle>
          </DialogHeader>
          {selectedPhoto && (
            <div className="space-y-4">
               <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
                  <img
                    src={getImageUrl(selectedPhoto.photoUrl)}
                    alt={`${t('completionPhotos.completionRoom')} ${selectedPhoto.photo.rooms?.room_number} ${t('completionPhotos.photo')}`}
                    className="w-full h-full object-contain"
                  />
                </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>{t('completionPhotos.room')}:</strong> {selectedPhoto.photo.rooms?.room_number}
                </div>
                <div>
                  <strong>{t('completionPhotos.hotel')}:</strong> {selectedPhoto.photo.rooms?.hotel}
                </div>
                <div>
                  <strong>{t('completionPhotos.completedBy')}:</strong> {selectedPhoto.photo.assigned_to_name}
                </div>
                <div>
                  <strong>{t('completionPhotos.date')}:</strong> {format(new Date(selectedPhoto.photo.completed_at || ''), 'MMM dd, yyyy HH:mm')}
                </div>
                <div>
                  <strong>{t('completionPhotos.type')}:</strong> {selectedPhoto.photo.assignment_type.replace('_', ' ').toUpperCase()}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadPhoto(selectedPhoto.photo, selectedPhoto.photoUrl)}
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