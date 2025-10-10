import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Camera, X, CheckCircle, AlertTriangle, DoorOpen } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EnhancedDNDPhotoCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  roomId: string;
  assignmentId?: string;
  onPhotoUploaded?: () => void;
}

interface CategorizedPhoto {
  category: 'dnd_door';
  categoryName: string;
  dataUrl: string;
  blob: Blob;
}

const DND_PHOTO_CATEGORY = {
  key: 'dnd_door' as const,
  label: 'DND Door Photo',
  icon: DoorOpen,
  color: 'from-orange-500 to-red-500'
};

export function EnhancedDNDPhotoCapture({ 
  open, 
  onOpenChange, 
  roomNumber,
  roomId,
  assignmentId,
  onPhotoUploaded 
}: EnhancedDNDPhotoCaptureProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<CategorizedPhoto[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState<Set<string>>(new Set());
  const [uploadedPhotos, setUploadedPhotos] = useState<Set<string>>(new Set());
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (open) {
      loadExistingPhotos();
    }
  }, [open, assignmentId]);

  const loadExistingPhotos = async () => {
    if (!assignmentId) return;
    
    try {
      const { data: dndPhotos } = await supabase
        .from('dnd_photos')
        .select('photo_url')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: false });

      if (dndPhotos && dndPhotos.length > 0) {
        const reconstructedPhotos: CategorizedPhoto[] = [];
        
        for (const dndPhoto of dndPhotos) {
          try {
            const response = await fetch(dndPhoto.photo_url);
            const blob = await response.blob();
            
            reconstructedPhotos.push({
              category: 'dnd_door',
              categoryName: DND_PHOTO_CATEGORY.label,
              dataUrl: dndPhoto.photo_url,
              blob: blob
            });
          } catch (fetchError) {
            console.error('Error fetching photo:', fetchError);
            reconstructedPhotos.push({
              category: 'dnd_door',
              categoryName: DND_PHOTO_CATEGORY.label,
              dataUrl: dndPhoto.photo_url,
              blob: new Blob()
            });
          }
        }
        
        setPhotos(reconstructedPhotos);
      }
    } catch (error) {
      console.error('Error loading existing photos:', error);
    }
  };

  const startCamera = useCallback(async () => {
    try {
      setShowCamera(true);
      setIsCameraLoading(true);
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Camera not supported on this device');
        setShowCamera(false);
        setIsCameraLoading(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.play().catch(err => {
              console.error('Error playing video:', err);
              toast.error('Could not start camera preview');
              setIsCameraLoading(false);
            });
            setIsCameraLoading(false);
          }
        };
      }
    } catch (error: any) {
      console.error('Error accessing camera:', error);
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        toast.error('Camera permission denied. Please enable camera access in your browser settings.');
      } else {
        toast.error('Could not access camera');
      }
      
      setShowCamera(false);
      setIsCameraLoading(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setShowCamera(false);
    setIsCameraLoading(false);
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (blob && user) {
        const photoUrl = URL.createObjectURL(blob);
        const photoId = `dnd_door_${Date.now()}_${Math.random()}`;
        
        const newPhoto: CategorizedPhoto = {
          category: 'dnd_door',
          categoryName: DND_PHOTO_CATEGORY.label,
          dataUrl: photoUrl,
          blob
        };
        
        setPhotos(prev => [...prev, newPhoto]);
        toast.success('DND door photo captured!');
        
        // Show warning about DND marking
        toast.warning('Room will be marked as DND after saving', {
          description: 'This room will skip cleaning today',
          duration: 4000
        });
        
        stopCamera();

        // Auto-save the photo immediately
        setUploadingPhotos(prev => new Set(prev).add(photoId));
        
        try {
          const fileName = `${user.id}/${roomNumber}/dnd_door_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
          
          const { data, error } = await supabase.storage
            .from('dnd-photos')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
              upsert: false
            });

          if (error) throw error;

          const { data: { publicUrl } } = supabase.storage
            .from('dnd-photos')
            .getPublicUrl(data.path);

          // Save DND record
          await supabase
            .from('dnd_photos')
            .insert({
              room_id: roomId,
              assignment_id: assignmentId || null,
              marked_by: user.id,
              photo_url: publicUrl,
              assignment_date: new Date().toISOString().split('T')[0]
            });

          // Update room status to DND
          await supabase
            .from('rooms')
            .update({
              is_dnd: true,
              dnd_marked_at: new Date().toISOString(),
              dnd_marked_by: user.id
            })
            .eq('id', roomId);

          setUploadingPhotos(prev => {
            const next = new Set(prev);
            next.delete(photoId);
            return next;
          });
          setUploadedPhotos(prev => new Set(prev).add(photoId));
          toast.success('DND photo saved successfully!', { duration: 2000 });
        } catch (error: any) {
          console.error('Auto-save error:', error);
          setUploadingPhotos(prev => {
            const next = new Set(prev);
            next.delete(photoId);
            return next;
          });
          toast.error('Failed to save DND photo');
        }
      }
    }, 'image/jpeg', 0.95);
  }, [user, roomNumber, roomId, assignmentId, stopCamera]);

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    toast.info('Photo removed (not deleted from server)');
  };

  const handleClose = () => {
    stopCamera();
    photos.forEach(photo => {
      if (!photo.dataUrl.startsWith('http')) {
        URL.revokeObjectURL(photo.dataUrl);
      }
    });
    onOpenChange(false);
    onPhotoUploaded?.();
  };

  const completedCount = photos.length;
  const progressPercentage = Math.min(completedCount * 100, 100);
  const isUploading = uploadingPhotos.size > 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent 
        className="max-w-2xl h-[100dvh] max-h-[100dvh] p-0 gap-0 flex flex-col overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-4 pb-2 border-b shrink-0 bg-gradient-to-r from-orange-50 to-red-50">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Camera className="h-5 w-5 text-orange-600" />
            DND Photo - Room {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="p-4 space-y-4">
            {/* Progress Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('photoCapture.progress')}: {completedCount} {t('photoCapture.photoCaptured')}</span>
                <Badge className="bg-green-500">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  {completedCount > 0 ? t('photoCapture.saved') : t('photoCapture.noPhotos')}
                </Badge>
              </div>
              <Progress value={completedCount > 0 ? 100 : 0} className="h-2" />
            </div>

            {/* Info Banners */}
            <div className="space-y-2">
              <div className="p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
                <p className="text-sm text-orange-800 dark:text-orange-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {t('photoCapture.takeClearPhoto')}
                </p>
              </div>
              
              {photos.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs text-amber-800">
                    ⚠️ {t('photoCapture.afterSavingWarning')}
                  </p>
                </div>
              )}
            </div>

            {/* Camera View or Photo Display */}
            {!showCamera ? (
              <div className="space-y-4">
                  <div className={`p-6 rounded-xl border-2 bg-gradient-to-br ${DND_PHOTO_CATEGORY.color} text-white shadow-lg`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <DoorOpen className="h-8 w-8" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold">{t('photoCapture.dndDoorPhoto')}</h3>
                      <p className="text-sm opacity-90">{completedCount} {t('photoCapture.photoCaptured')}</p>
                    </div>
                    {completedCount > 0 && (
                      <Badge className="bg-white/20 text-white border-white/30">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        {t('photoCapture.saved')}
                      </Badge>
                    )}
                  </div>

                  {/* Existing Photos Grid */}
                  {photos.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {photos.map((photo, index) => (
                        <div key={index} className="relative rounded-lg overflow-hidden aspect-video bg-black/20">
                          <img
                            src={photo.dataUrl}
                            alt={`DND door ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="destructive"
                            className="absolute top-1 right-1 h-6 w-6"
                            onClick={() => removePhoto(index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                          <div className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-2 py-1 rounded">
                            Photo {index + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    onClick={startCamera}
                    disabled={isUploading}
                    className="w-full bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 text-white"
                    size="lg"
                  >
                    <Camera className="h-5 w-5 mr-2" />
                    {photos.length > 0 ? 'Add Another Photo' : 'Take Photo'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
                  {isCameraLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                      <div className="text-white text-center">
                        <Camera className="h-8 w-8 mx-auto mb-2 animate-pulse" />
                        <p>Starting camera...</p>
                      </div>
                    </div>
                  )}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={capturePhoto}
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                    size="lg"
                    disabled={isCameraLoading}
                  >
                    <Camera className="h-5 w-5 mr-2" />
                    Capture Photo
                  </Button>
                  <Button
                    onClick={stopCamera}
                    variant="outline"
                    size="lg"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />

            {/* Upload Status */}
            {isUploading && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 animate-spin" />
                  Saving photo...
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t bg-background shrink-0">
          <Button
            onClick={handleClose}
            variant="outline"
            className="w-full"
            disabled={isUploading}
          >
            {t('dnd.markRoomDND')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
