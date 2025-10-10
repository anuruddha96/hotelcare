import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Camera, X, CheckCircle, AlertTriangle, ArrowLeft, ArrowRight, DoorOpen } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

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
  label: 'DND Door',
  icon: DoorOpen,
  color: 'from-orange-500 to-orange-600'
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
  const [isUploading, setIsUploading] = useState(false);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [uploadingStatus, setUploadingStatus] = useState<{ [key: string]: 'uploading' | 'uploaded' | 'failed' }>({});
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (open) {
      loadExistingPhotos();
      checkCameraPermission();
    }
  }, [open, assignmentId]);

  const checkCameraPermission = async () => {
    try {
      const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
      setCameraPermissionGranted(result.state === 'granted');
    } catch (error) {
      console.error('Error checking camera permission:', error);
    }
  };

  const loadExistingPhotos = async () => {
    if (!assignmentId) return;
    
    try {
      const { data: assignment } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignmentId)
        .single();

      if (assignment?.completion_photos) {
        const reconstructedPhotos: CategorizedPhoto[] = [];
        
        for (const photoUrl of assignment.completion_photos) {
          // Check if this is a DND door photo
          const urlParts = photoUrl.split('/');
          const filename = urlParts[urlParts.length - 1];
          
          if (filename.startsWith('dnd_door_')) {
            try {
              const response = await fetch(photoUrl);
              const blob = await response.blob();
              
              reconstructedPhotos.push({
                category: 'dnd_door',
                categoryName: DND_PHOTO_CATEGORY.label,
                dataUrl: photoUrl,
                blob: blob
              });
            } catch (fetchError) {
              console.error('Error fetching photo:', fetchError);
              reconstructedPhotos.push({
                category: 'dnd_door',
                categoryName: DND_PHOTO_CATEGORY.label,
                dataUrl: photoUrl,
                blob: new Blob()
              });
            }
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
      
      setCameraPermissionGranted(true);
      
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
        toast.error('Camera permission denied', {
          description: 'Please enable camera access in your browser settings',
          action: {
            label: 'Learn How',
            onClick: () => window.open('https://support.google.com/chrome/answer/2693767', '_blank')
          }
        });
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
        
        const newPhoto: CategorizedPhoto = {
          category: 'dnd_door',
          categoryName: DND_PHOTO_CATEGORY.label,
          dataUrl: photoUrl,
          blob
        };
        
        setPhotos(prev => [...prev, newPhoto]);
        toast.success('DND door photo captured!');
        stopCamera();

        // Auto-save the photo
        const photoId = `dnd_door_${Date.now()}_${Math.random()}`;
        setUploadingStatus(prev => ({ ...prev, [photoId]: 'uploading' }));
        
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

          setUploadingStatus(prev => ({ ...prev, [photoId]: 'uploaded' }));
          toast.success('DND door photo saved!');
          
          // Show save confirmation after first photo
          if (photos.length === 0) {
            setShowSaveConfirmation(true);
          }
        } catch (error: any) {
          console.error('Auto-save error:', error);
          setUploadingStatus(prev => ({ ...prev, [photoId]: 'failed' }));
          toast.error('Failed to save DND door photo');
        }
      }
    }, 'image/jpeg', 0.95);
  }, [user, roomNumber, roomId, assignmentId, photos.length, stopCamera]);

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    toast.info('Photo removed (not deleted from server)');
  };

  const handleClose = () => {
    const newPhotosCount = photos.filter(p => !p.dataUrl.startsWith('http')).length;
    
    if (newPhotosCount > 0 && !showSaveConfirmation) {
      toast.warning('You have unsaved changes');
    }
    
    stopCamera();
    photos.forEach(photo => {
      if (!photo.dataUrl.startsWith('http')) {
        URL.revokeObjectURL(photo.dataUrl);
      }
    });
    setPhotos([]);
    setShowSaveConfirmation(false);
    onOpenChange(false);
    onPhotoUploaded?.();
  };

  const handleSaveAndContinue = () => {
    setShowSaveConfirmation(false);
    toast.success('All DND photos saved successfully!');
  };

  const completedCount = photos.length;
  const progressPercentage = Math.min(completedCount * 100, 100);

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent 
          className="max-w-2xl h-[100dvh] max-h-[100dvh] p-0 gap-0 flex flex-col overflow-hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="p-4 pb-2 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Camera className="h-5 w-5 text-primary" />
              DND Photo Capture - Room {roomNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="p-4 space-y-4">
              {/* Progress Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Progress: {completedCount} photos</span>
                  <Badge className="bg-green-500">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {progressPercentage}%
                  </Badge>
                </div>
                <Progress value={progressPercentage} className="h-2" />
                
                {/* Category Indicator */}
                <div className="flex justify-center gap-3 py-2">
                  <div className={`flex flex-col items-center p-3 rounded-xl border-2 ${
                    completedCount > 0 ? 'border-green-500 bg-green-50' : 'border-primary bg-primary/5'
                  }`}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      completedCount > 0 ? 'bg-green-500' : 'bg-primary'
                    }`}>
                      {completedCount > 0 ? (
                        <CheckCircle className="h-6 w-6 text-white" />
                      ) : (
                        <DoorOpen className="h-6 w-6 text-white" />
                      )}
                    </div>
                    <span className="text-xs font-medium mt-1">{DND_PHOTO_CATEGORY.label}</span>
                  </div>
                </div>
              </div>

              {/* Info Banner */}
              <div className="p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
                <p className="text-sm text-orange-800 dark:text-orange-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Please capture clear photo(s) of the DND sign on the door
                </p>
              </div>

              {/* Camera View or Category Display */}
              {!showCamera ? (
                <div className="space-y-4">
                  <div className={`p-6 rounded-xl border-2 bg-gradient-to-br ${DND_PHOTO_CATEGORY.color} text-white`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
                        <DoorOpen className="h-8 w-8" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold">{DND_PHOTO_CATEGORY.label}</h3>
                        <p className="text-sm opacity-90">{completedCount} photo(s) taken</p>
                      </div>
                      <Badge className="bg-white/20 text-white border-white/30">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        {completedCount}
                      </Badge>
                    </div>

                    {/* Existing Photos Grid */}
                    {photos.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {photos.map((photo, index) => (
                          <div key={index} className="relative rounded-lg overflow-hidden aspect-video">
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
                              {index + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      onClick={startCamera}
                      className="w-full bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30"
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
                      className="flex-1 bg-primary"
                      size="lg"
                      disabled={isCameraLoading}
                    >
                      <Camera className="h-5 w-5 mr-2" />
                      Capture
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

              {/* Captured Photos Summary */}
              {photos.length > 0 && !showCamera && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Captured Photos</h4>
                    <Badge variant="outline">{photos.length} Photos</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((photo, index) => (
                      <div key={index} className="relative rounded-lg overflow-hidden aspect-video">
                        <img
                          src={photo.dataUrl}
                          alt={`${photo.categoryName} ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                          <Badge className="text-xs bg-orange-500 border-0">
                            <DoorOpen className="h-3 w-3 mr-1" />
                            {photo.categoryName} #{index + 1}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t bg-background shrink-0">
            <div className="flex gap-2">
              <Button
                onClick={handleClose}
                variant="outline"
                className="flex-1"
                disabled={isUploading}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={showSaveConfirmation} onOpenChange={setShowSaveConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Photos Saved Successfully!
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your DND door photo(s) have been automatically saved. Would you like to capture more photos or continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowSaveConfirmation(false)}>
              Add More Photos
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveAndContinue} className="bg-green-600 hover:bg-green-700">
              <CheckCircle className="h-4 w-4 mr-2" />
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
