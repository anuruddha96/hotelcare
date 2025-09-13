import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, Upload, X, CheckCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ImageCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  assignmentId: string;
  onPhotoCaptured?: (photoUrls: string[]) => void;
}

export function ImageCaptureDialog({
  open,
  onOpenChange,
  roomNumber,
  assignmentId,
  onPhotoCaptured
}: ImageCaptureDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setShowCamera(true);
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast.error('Could not access camera. Please try uploading a photo instead.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
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
        setCapturedPhotos(prev => [...prev, photoUrl]);
        
        // Store the blob for upload
        const file = new File([blob], `room-${roomNumber}-${Date.now()}.jpg`, { type: 'image/jpeg' });
        uploadPhoto(file);
      }
    }, 'image/jpeg', 0.8);

    stopCamera();
  }, [roomNumber, stopCamera]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const photoUrl = URL.createObjectURL(file);
        setCapturedPhotos(prev => [...prev, photoUrl]);
        uploadPhoto(file);
      }
    });
  }, []);

  const uploadPhoto = async (file: File) => {
    if (!user?.id) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${assignmentId}/${Date.now()}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('dnd-photos')
        .upload(fileName, file);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('dnd-photos')
        .getPublicUrl(data.path);

      // Update the assignment with the photo URL
      const { data: assignment, error: fetchError } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignmentId)
        .single();

      if (fetchError) throw fetchError;

      const existingPhotos = assignment?.completion_photos || [];
      const updatedPhotos = [...existingPhotos, publicUrl];

      const { error: updateError } = await supabase
        .from('room_assignments')
        .update({ completion_photos: updatedPhotos })
        .eq('id', assignmentId);

      if (updateError) throw updateError;

      toast.success('Photo uploaded successfully');
      onPhotoCaptured?.(updatedPhotos);
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast.error('Failed to upload photo');
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = (photoUrl: string) => {
    setCapturedPhotos(prev => prev.filter(url => url !== photoUrl));
    URL.revokeObjectURL(photoUrl);
  };

  const handleClose = () => {
    stopCamera();
    // Clean up object URLs
    capturedPhotos.forEach(url => URL.revokeObjectURL(url));
    setCapturedPhotos([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {t('imageCapture.title')} - Room {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!showCamera && (
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={startCamera}
                className="flex items-center gap-2"
                variant="outline"
              >
                <Camera className="h-4 w-4" />
                {t('imageCapture.takePhoto')}
              </Button>
              
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2"
                variant="outline"
              >
                <Upload className="h-4 w-4" />
                {t('imageCapture.uploadPhoto')}
              </Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />

          {showCamera && (
            <div className="space-y-4">
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg"
                />
                <canvas ref={canvasRef} className="hidden" />
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={capturePhoto}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  {t('imageCapture.capture')}
                </Button>
                
                <Button
                  onClick={stopCamera}
                  variant="outline"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}

          {capturedPhotos.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">{t('imageCapture.capturedPhotos')}</h4>
                <Badge variant="outline">{capturedPhotos.length}</Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                {capturedPhotos.map((photoUrl, index) => (
                  <div key={index} className="relative">
                    <img
                      src={photoUrl}
                      alt={`Captured ${index + 1}`}
                      className="w-full h-24 object-cover rounded border"
                    />
                    <Button
                      onClick={() => removePhoto(photoUrl)}
                      variant="destructive"
                      size="sm"
                      className="absolute top-1 right-1 h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isUploading && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span className="text-sm text-blue-800">{t('imageCapture.uploading')}</span>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button
              onClick={handleClose}
              variant="outline"
              className="flex-1"
            >
              {t('common.close')}
            </Button>
            
            {capturedPhotos.length > 0 && !isUploading && (
              <div className="flex items-center gap-1 text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm">{t('imageCapture.saved')}</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}