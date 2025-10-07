import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Camera, Upload, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DNDPhotoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  roomId: string;
  assignmentId?: string;
  onPhotoUploaded?: () => void;
}

interface CapturedPhoto {
  dataUrl: string;
  blob: Blob;
}

export function DNDPhotoDialog({ 
  open, 
  onOpenChange, 
  roomNumber,
  roomId,
  assignmentId,
  onPhotoUploaded 
}: DNDPhotoDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { t } = useTranslation();
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startCamera = useCallback(async () => {
    try {
      setShowCamera(true);
      setIsCameraLoading(true);
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Camera not supported on this device. Please use the upload option.');
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
      let errorMessage = 'Could not access camera. ';
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage += 'Please allow camera permissions in your browser settings.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No camera found on this device.';
      } else {
        errorMessage += 'Please try uploading a photo instead.';
      }
      
      toast.error(errorMessage);
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

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (blob) {
        const photoUrl = URL.createObjectURL(blob);
        setCapturedPhotos(prev => [...prev, {
          dataUrl: photoUrl,
          blob
        }]);
        toast.success('Photo captured successfully');
        stopCamera();
      }
    }, 'image/jpeg', 0.95);
  }, [stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const photoUrl = URL.createObjectURL(file);
        setCapturedPhotos(prev => [...prev, {
          dataUrl: photoUrl,
          blob: file
        }]);
      }
    });

    if (files.length > 0) {
      toast.success(`${files.length} photo(s) added`);
    }
  };

  const removePhoto = (index: number) => {
    setCapturedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const uploadPhotos = async () => {
    if (!user || capturedPhotos.length === 0) return;

    setIsUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (const photo of capturedPhotos) {
        const fileName = `${user.id}/${roomNumber}/dnd_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        
        const { data, error } = await supabase.storage
          .from('dnd-photos')
          .upload(fileName, photo.blob, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('dnd-photos')
          .getPublicUrl(data.path);

        uploadedUrls.push(publicUrl);
      }

      // Save DND records for each photo
      for (const photoUrl of uploadedUrls) {
        const { error: dndError } = await supabase
          .from('dnd_photos')
          .insert({
            room_id: roomId,
            assignment_id: assignmentId || null,
            marked_by: user.id,
            photo_url: photoUrl,
            notes: notes || null,
            assignment_date: new Date().toISOString().split('T')[0]
          });

        if (dndError) throw dndError;
      }

      // Update room status to DND
      const { error: roomError } = await supabase
        .from('rooms')
        .update({
          is_dnd: true,
          dnd_marked_at: new Date().toISOString(),
          dnd_marked_by: user.id
        })
        .eq('id', roomId);

      if (roomError) throw roomError;

      toast.success(`Successfully uploaded ${uploadedUrls.length} DND photo(s) and marked room as Do Not Disturb`);
      onPhotoUploaded?.();
      handleClose();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Failed to upload photos: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    stopCamera();
    capturedPhotos.forEach(photo => URL.revokeObjectURL(photo.dataUrl));
    setCapturedPhotos([]);
    setNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            {t('dnd.title')} - {t('common.room')} {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
            <p className="text-sm text-orange-800 dark:text-orange-200">
              {t('dnd.notice')}
            </p>
          </div>

          {!showCamera ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                onClick={startCamera}
                variant="outline"
                className="flex-1"
              >
                <Camera className="h-4 w-4 mr-2" />
                {t('common.takePhoto')}
              </Button>
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="flex-1"
              >
                <Upload className="h-4 w-4 mr-2" />
                {t('dnd.uploadPhotos')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
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
                  type="button"
                  onClick={capturePhoto}
                  className="flex-1"
                  disabled={isCameraLoading}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  {t('common.capture')}
                </Button>
                <Button
                  type="button"
                  onClick={stopCamera}
                  variant="outline"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />

          {/* Captured Photos */}
          {capturedPhotos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('dnd.capturedPhotos')} ({capturedPhotos.length})</Label>
                {isUploading && <Badge variant="secondary">{t('dnd.uploading')}</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {capturedPhotos.map((photo, index) => (
                  <Card key={index} className="relative overflow-hidden">
                    <img
                      src={photo.dataUrl}
                      alt={`DND photo ${index + 1}`}
                      className="w-full h-32 object-cover"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="absolute top-2 right-2 h-8 w-8"
                      onClick={() => removePhoto(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <div className="absolute bottom-2 left-2">
                      <Badge className="flex items-center gap-1">
                        <Camera className="h-3 w-3" />
                        {index + 1}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
              
              <div className="space-y-2 mt-4">
                <Label htmlFor="notes">{t('dnd.notes')}</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('dnd.notesPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleClose}
              variant="outline"
              className="flex-1"
              disabled={isUploading}
            >
              {t('common.close')}
            </Button>
            {capturedPhotos.length > 0 && (
              <Button
                type="button"
                onClick={uploadPhotos}
                disabled={isUploading}
                className="flex-1 bg-orange-600 hover:bg-orange-700"
              >
                {isUploading ? (
                  <>{t('dnd.uploading')}</>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {t('dnd.upload')} {capturedPhotos.length} {t('common.photos')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
