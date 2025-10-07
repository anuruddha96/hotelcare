import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, Eye, X } from 'lucide-react';
import { format } from 'date-fns';

interface RoomPhotosViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  roomNumber: string;
}

interface RoomPhoto {
  id: string;
  photo_url: string;
  marked_at: string;
  assignment_date: string;
  notes?: string;
  marked_by: string;
  staff_name?: string;
  photo_type: 'dnd' | 'completion';
}

export function RoomPhotosViewer({ open, onOpenChange, roomId, roomNumber }: RoomPhotosViewerProps) {
  const { profile } = useAuth();
  const [photos, setPhotos] = useState<RoomPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<RoomPhoto | null>(null);

  const canViewPhotos = profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role);

  useEffect(() => {
    if (open && canViewPhotos) {
      fetchRoomPhotos();
    }
  }, [open, roomId, canViewPhotos]);

  const fetchRoomPhotos = async () => {
    setLoading(true);
    try {
      // Fetch DND photos
      const { data: dndPhotos, error: dndError } = await supabase
        .from('dnd_photos')
        .select('*')
        .eq('room_id', roomId)
        .order('marked_at', { ascending: false });

      if (dndError) throw dndError;

      // Fetch completion photos from room assignments
      const { data: assignments, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('*')
        .eq('room_id', roomId)
        .not('completion_photos', 'is', null)
        .order('completed_at', { ascending: false });

      if (assignmentError) throw assignmentError;

      // Process and combine all photos
      const allPhotos: RoomPhoto[] = [];

      // Add DND photos
      if (dndPhotos) {
        for (const photo of dndPhotos) {
          // Get staff name
          const { data: staffData } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', photo.marked_by)
            .single();

          const filename = photo.photo_url.includes('/') ? photo.photo_url.split('/').pop() : photo.photo_url;
          const { data: urlData } = await supabase.storage
            .from('dnd-photos')
            .createSignedUrl(filename || photo.photo_url, 3600);

          allPhotos.push({
            id: photo.id,
            photo_url: urlData?.signedUrl || photo.photo_url,
            marked_at: photo.marked_at,
            assignment_date: photo.assignment_date,
            notes: photo.notes,
            marked_by: photo.marked_by,
            staff_name: staffData?.full_name || 'Unknown',
            photo_type: 'dnd'
          });
        }
      }

      // Add completion photos
      if (assignments) {
        for (const assignment of assignments) {
          if (assignment.completion_photos && Array.isArray(assignment.completion_photos) && assignment.completion_photos.length > 0) {
            // Get staff name
            const { data: staffData } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('id', assignment.assigned_to)
              .single();

              for (const photoUrl of assignment.completion_photos) {
              const filename = photoUrl.includes('/') ? photoUrl.split('/').pop() : photoUrl;
              
              // Extract category from filename (format: category_timestamp_random.jpg)
              let categoryName = 'Room Photo';
              if (filename) {
                const category = filename.split('_')[0];
                const categoryMap: { [key: string]: string } = {
                  'trash_bin': 'Trash Bin',
                  'bathroom': 'Bathroom',
                  'bed': 'Bed',
                  'minibar': 'Minibar',
                  'tea_coffee_table': 'Tea/Coffee Table'
                };
                categoryName = categoryMap[category] || 'Room Photo';
              }
              
              const { data: urlData } = await supabase.storage
                .from('room-photos')
                .createSignedUrl(filename || photoUrl, 3600);

              allPhotos.push({
                id: `${assignment.id}-${photoUrl}`,
                photo_url: urlData?.signedUrl || photoUrl,
                marked_at: assignment.completed_at || assignment.updated_at,
                assignment_date: assignment.assignment_date,
                notes: categoryName, // Use category name as notes
                marked_by: assignment.assigned_to,
                staff_name: staffData?.full_name || 'Unknown',
                photo_type: 'completion'
              });
            }
          }
        }
      }

      // Sort all photos by date (newest first)
      allPhotos.sort((a, b) => new Date(b.marked_at).getTime() - new Date(a.marked_at).getTime());

      setPhotos(allPhotos);
    } catch (error) {
      console.error('Error fetching room photos:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPhotosByDate = () => {
    const photosByDate: { [key: string]: RoomPhoto[] } = {};
    
    photos.forEach(photo => {
      const date = photo.assignment_date;
      if (!photosByDate[date]) {
        photosByDate[date] = [];
      }
      photosByDate[date].push(photo);
    });
    
    return photosByDate;
  };

  const photosByDate = getPhotosByDate();
  const dates = Object.keys(photosByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  if (!canViewPhotos) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Room Photos - Access Restricted
            </DialogTitle>
          </DialogHeader>
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              You don't have permission to view room photos. 
              Only managers and admins can access this feature.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Room {roomNumber} - Photo History
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : photos.length === 0 ? (
            <div className="text-center py-12">
              <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No photos found for this room.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {dates.map(date => (
                <div key={date}>
                  <h3 className="text-lg font-semibold mb-3">
                    {format(new Date(date), 'MMMM dd, yyyy')}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {photosByDate[date].map((photo, index) => (
                      <Card key={`${photo.id}-${index}`} className="overflow-hidden">
                        <div className="relative">
                          <img
                            src={photo.photo_url}
                            alt={`Room photo from ${photo.marked_at}`}
                            className="w-full h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setSelectedPhoto(photo)}
                          />
                          <Badge 
                            className={`absolute top-2 right-2 ${
                              photo.photo_type === 'dnd' 
                                ? 'bg-red-500 hover:bg-red-600' 
                                : 'bg-green-500 hover:bg-green-600'
                            }`}
                          >
                            {photo.photo_type === 'dnd' ? 'DND' : 'Completed'}
                          </Badge>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="absolute bottom-2 right-2"
                            onClick={() => setSelectedPhoto(photo)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                        <CardContent className="p-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {photo.staff_name || 'Unknown'}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(photo.marked_at), 'HH:mm')}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">
                                {photo.notes || 'Room Photo'}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Photo Viewer Dialog */}
      {selectedPhoto && (
        <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh]">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  Room {roomNumber} - {format(new Date(selectedPhoto.marked_at), 'MMM dd, yyyy HH:mm')}
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedPhoto(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>
            <div className="space-y-4">
              <div className="relative">
                <img
                  src={selectedPhoto.photo_url}
                  alt="Full size room photo"
                  className="w-full max-h-[60vh] object-contain rounded-lg"
                />
                <Badge 
                  className={`absolute top-4 right-4 ${
                    selectedPhoto.photo_type === 'dnd' 
                      ? 'bg-red-500 hover:bg-red-600' 
                      : 'bg-green-500 hover:bg-green-600'
                  }`}
                >
                  {selectedPhoto.photo_type === 'dnd' ? 'DND Photo' : 'Completion Photo'}
                </Badge>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Staff Member:</span>
                  <span>{selectedPhoto.staff_name || 'Unknown'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Time:</span>
                  <span>{format(new Date(selectedPhoto.marked_at), 'MMM dd, yyyy HH:mm')}</span>
                </div>
                {selectedPhoto.notes && (
                  <div className="space-y-1">
                    <span className="font-medium">Notes:</span>
                    <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                      {selectedPhoto.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}