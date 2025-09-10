import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, Calendar, User, MessageSquare, X } from 'lucide-react';
import { format } from 'date-fns';

interface DNDPhoto {
  id: string;
  photo_url: string;
  marked_at: string;
  assignment_date: string;
  notes?: string | null;
  marked_by: string;
  profiles?: {
    full_name: string;
  } | null;
}

interface DNDPhotosViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  roomNumber: string;
}

export function DNDPhotosViewer({ 
  open, 
  onOpenChange, 
  roomId, 
  roomNumber 
}: DNDPhotosViewerProps) {
  const { profile } = useAuth();
  const [photos, setPhotos] = useState<DNDPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');

  const canViewPhotos = profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role);

  useEffect(() => {
    if (open && canViewPhotos) {
      fetchDNDPhotos();
    }
  }, [open, roomId, canViewPhotos]);

  const fetchDNDPhotos = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dnd_photos')
        .select(`
          *,
          profiles!marked_by (
            full_name
          )
        `)
        .eq('room_id', roomId)
        .order('marked_at', { ascending: false });

      if (error) throw error;

      // Get signed URLs for photos
      const photosWithUrls = await Promise.all(
        (data || []).map(async (photo: any) => {
          const { data: urlData } = await supabase.storage
            .from('dnd-photos')
            .createSignedUrl(photo.photo_url, 3600); // 1 hour expiry

          return {
            id: photo.id,
            photo_url: urlData?.signedUrl || photo.photo_url,
            marked_at: photo.marked_at,
            assignment_date: photo.assignment_date,
            notes: photo.notes,
            marked_by: photo.marked_by,
            profiles: photo.profiles
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Access Restricted</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center">
            <p className="text-muted-foreground">
              Only managers and admins can view DND photo evidence.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const photosByDate = getPhotosByDate();
  const dates = Object.keys(photosByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            DND Photo Evidence - Room {roomNumber}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Photographic evidence of DND notices from housekeeping staff
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading DND photos...</div>
            </div>
          ) : photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Camera className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No DND photos found for this room
              </p>
            </div>
          ) : (
            dates.map(date => (
              <div key={date} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <h3 className="font-semibold">
                    {format(new Date(date), 'EEEE, MMMM d, yyyy')}
                  </h3>
                  <Badge variant="outline">
                    {photosByDate[date].length} photo{photosByDate[date].length !== 1 ? 's' : ''}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              </div>
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
      </DialogContent>
    </Dialog>
  );
}