import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Camera, Upload, X, CheckCircle, DoorOpen, Bath, Bed, Coffee } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EnhancedImageCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  assignmentId?: string;
  onPhotoCaptured?: () => void;
}

type PhotoCategory = 'trash_bin' | 'bathroom' | 'bed' | 'minibar' | 'tea_coffee_table';

interface CategorizedPhoto {
  category: PhotoCategory;
  categoryName: string;
  dataUrl: string;
  blob: Blob;
}

const PHOTO_CATEGORIES = [
  { key: 'trash_bin' as PhotoCategory, label: 'Trash Bin', displayName: 'Trash Bin', icon: DoorOpen },
  { key: 'bathroom' as PhotoCategory, label: 'Bathroom', displayName: 'Bathroom', icon: Bath },
  { key: 'bed' as PhotoCategory, label: 'Bed', displayName: 'Bed', icon: Bed },
  { key: 'minibar' as PhotoCategory, label: 'Minibar', displayName: 'Minibar', icon: Coffee },
  { key: 'tea_coffee_table' as PhotoCategory, label: 'Tea/Coffee Table', displayName: 'Tea/Coffee Table', icon: Coffee },
];

export function EnhancedImageCaptureDialog({
  open,
  onOpenChange,
  roomNumber,
  assignmentId,
  onPhotoCaptured
}: EnhancedImageCaptureDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [categorizedPhotos, setCategorizedPhotos] = useState<CategorizedPhoto[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<PhotoCategory>('trash_bin');
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
        const categoryInfo = PHOTO_CATEGORIES.find(c => c.key === selectedCategory);
        setCategorizedPhotos(prev => [...prev, {
          category: selectedCategory,
          categoryName: categoryInfo?.displayName || selectedCategory,
          dataUrl: photoUrl,
          blob
        }]);
        toast.success(`${categoryInfo?.label} photo captured`);
        stopCamera();
      }
    }, 'image/jpeg', 0.95);
  }, [selectedCategory, stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const categoryInfo = PHOTO_CATEGORIES.find(c => c.key === selectedCategory);
    
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const photoUrl = URL.createObjectURL(file);
        setCategorizedPhotos(prev => [...prev, {
          category: selectedCategory,
          categoryName: categoryInfo?.displayName || selectedCategory,
          dataUrl: photoUrl,
          blob: file
        }]);
      }
    });

    if (files.length > 0) {
      toast.success(`${files.length} photo(s) added`);
    }
  };

  const uploadPhotos = async () => {
    if (!user || categorizedPhotos.length === 0) return;

    setIsUploading(true);
    const uploadedUrls: string[] = [];

    try {
      // First, get existing photos from the assignment
      let existingPhotos: string[] = [];
      if (assignmentId) {
        const { data: assignmentData } = await supabase
          .from('room_assignments')
          .select('completion_photos')
          .eq('id', assignmentId)
          .single();
        
        existingPhotos = assignmentData?.completion_photos || [];
      }

      for (const photo of categorizedPhotos) {
        // Include category name in filename for easy identification
        const fileName = `${user.id}/${roomNumber}/${photo.category}_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        
        const { data, error } = await supabase.storage
          .from('room-photos')
          .upload(fileName, photo.blob, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('room-photos')
          .getPublicUrl(data.path);

        uploadedUrls.push(publicUrl);
      }

      // Merge existing photos with new uploads (append new photos)
      const allPhotos = [...existingPhotos, ...uploadedUrls];

      // Update room assignment with all photos (existing + new)
      if (assignmentId) {
        const { error: updateError } = await supabase
          .from('room_assignments')
          .update({
            completion_photos: allPhotos
          })
          .eq('id', assignmentId);

        if (updateError) throw updateError;
      }

      toast.success(`Successfully uploaded ${uploadedUrls.length} photo(s)`);
      
      if (onPhotoCaptured) {
        onPhotoCaptured();
      }
      
      handleClose();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Failed to upload photos: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = (index: number) => {
    setCategorizedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleClose = () => {
    stopCamera();
    setCategorizedPhotos([]);
    onOpenChange(false);
  };

  const getPhotoCategoryIcon = (category: PhotoCategory) => {
    const Icon = PHOTO_CATEGORIES.find(c => c.key === category)?.icon || Camera;
    return Icon;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Photo Capture - Room {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category Selection */}
          <div className="space-y-2">
            <Label>Select Photo Category</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PHOTO_CATEGORIES.map(({ key, label, icon: Icon }) => (
                <Button
                  key={key}
                  type="button"
                  variant={selectedCategory === key ? "default" : "outline"}
                  onClick={() => setSelectedCategory(key)}
                  className="flex items-center gap-2 text-sm"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Button>
              ))}
            </div>
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
                Take Photo
              </Button>
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="flex-1"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Photo
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
                  Capture
                </Button>
                <Button
                  type="button"
                  onClick={stopCamera}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />

          {/* Captured Photos */}
          {categorizedPhotos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Captured Photos ({categorizedPhotos.length})</Label>
                {isUploading && <Badge variant="secondary">Uploading...</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {categorizedPhotos.map((photo, index) => {
                  const Icon = getPhotoCategoryIcon(photo.category);
                  return (
                    <Card key={index} className="relative overflow-hidden">
                      <img
                        src={photo.dataUrl}
                        alt={`${photo.category} ${index + 1}`}
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
                          <Icon className="h-3 w-3" />
                          {PHOTO_CATEGORIES.find(c => c.key === photo.category)?.label}
                        </Badge>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category Status */}
          {categorizedPhotos.length > 0 && (
            <div className="space-y-2">
              <Label>Required Photos Status</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PHOTO_CATEGORIES.map(({ key, label }) => {
                  const hasPhoto = categorizedPhotos.some(p => p.category === key);
                  return (
                    <Badge
                      key={key}
                      variant={hasPhoto ? "default" : "outline"}
                      className="justify-center"
                    >
                      {hasPhoto ? '✓' : '○'} {label}
                    </Badge>
                  );
                })}
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
              Close
            </Button>
            {categorizedPhotos.length > 0 && (
              <Button
                type="button"
                onClick={uploadPhotos}
                disabled={isUploading}
                className="flex-1"
              >
                {isUploading ? (
                  <>Uploading...</>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Upload {categorizedPhotos.length} Photo(s)
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
