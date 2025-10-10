import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Camera, Upload, X, CheckCircle, AlertCircle, ChevronRight, ChevronLeft, DoorOpen, Bath, Bed, Coffee } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SimplifiedPhotoCaptureProps {
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
  { key: 'trash_bin' as PhotoCategory, label: 'Trash Bin', icon: DoorOpen, color: 'bg-blue-500' },
  { key: 'bathroom' as PhotoCategory, label: 'Bathroom', icon: Bath, color: 'bg-cyan-500' },
  { key: 'bed' as PhotoCategory, label: 'Bed', icon: Bed, color: 'bg-purple-500' },
  { key: 'minibar' as PhotoCategory, label: 'Minibar', icon: Coffee, color: 'bg-orange-500' },
  { key: 'tea_coffee_table' as PhotoCategory, label: 'Tea/Coffee Table', icon: Coffee, color: 'bg-green-500' },
];

export function SimplifiedPhotoCapture({
  open,
  onOpenChange,
  roomNumber,
  assignmentId,
  onPhotoCaptured
}: SimplifiedPhotoCaptureProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [categorizedPhotos, setCategorizedPhotos] = useState<CategorizedPhoto[]>([]);
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentCategory = PHOTO_CATEGORIES[currentCategoryIndex];
  const hasPhotoForCurrentCategory = categorizedPhotos.some(p => p.category === currentCategory.key);
  const allPhotosComplete = PHOTO_CATEGORIES.every(cat => 
    categorizedPhotos.some(p => p.category === cat.key)
  );
  const progress = (categorizedPhotos.filter((photo, index, self) => 
    index === self.findIndex(p => p.category === photo.category)
  ).length / PHOTO_CATEGORIES.length) * 100;

  // Load existing photos when dialog opens
  useEffect(() => {
    if (open && assignmentId) {
      loadExistingPhotos();
    }
  }, [open, assignmentId]);

  const loadExistingPhotos = async () => {
    if (!assignmentId) return;
    
    try {
      const { data: assignmentData } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignmentId)
        .single();
      
      if (assignmentData?.completion_photos) {
        setExistingPhotos(assignmentData.completion_photos);
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
        toast.error(t('photoCapture.cameraNotSupported'));
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
              toast.error(t('photoCapture.cameraStartError'));
              setIsCameraLoading(false);
            });
            setIsCameraLoading(false);
          }
        };
      }
    } catch (error: any) {
      console.error('Error accessing camera:', error);
      let errorMessage = t('photoCapture.cameraAccessError');
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = t('photoCapture.cameraPermissionError');
      } else if (error.name === 'NotFoundError') {
        errorMessage = t('photoCapture.cameraNotFound');
      }
      
      toast.error(errorMessage);
      setShowCamera(false);
      setIsCameraLoading(false);
    }
  }, [t]);

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
        
        // Remove existing photo for this category if any
        setCategorizedPhotos(prev => prev.filter(p => p.category !== currentCategory.key));
        
        // Add new photo
        setCategorizedPhotos(prev => [...prev, {
          category: currentCategory.key,
          categoryName: currentCategory.label,
          dataUrl: photoUrl,
          blob
        }]);
        
        toast.success(`${currentCategory.label} ${t('photoCapture.photoCaptured')}`);
        stopCamera();
        
        // Auto-advance to next category if not the last one
        if (currentCategoryIndex < PHOTO_CATEGORIES.length - 1) {
          setTimeout(() => {
            setCurrentCategoryIndex(prev => prev + 1);
          }, 500);
        }
      }
    }, 'image/jpeg', 0.95);
  }, [currentCategory, currentCategoryIndex, stopCamera, t]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0]; // Take only the first file
    if (file.type.startsWith('image/')) {
      const photoUrl = URL.createObjectURL(file);
      
      // Remove existing photo for this category if any
      setCategorizedPhotos(prev => prev.filter(p => p.category !== currentCategory.key));
      
      // Add new photo
      setCategorizedPhotos(prev => [...prev, {
        category: currentCategory.key,
        categoryName: currentCategory.label,
        dataUrl: photoUrl,
        blob: file
      }]);
      
      toast.success(`${currentCategory.label} ${t('photoCapture.photoAdded')}`);
      
      // Auto-advance to next category if not the last one
      if (currentCategoryIndex < PHOTO_CATEGORIES.length - 1) {
        setTimeout(() => {
          setCurrentCategoryIndex(prev => prev + 1);
        }, 500);
      }
    }
  };

  const uploadPhotos = async () => {
    if (!user || categorizedPhotos.length === 0) return;

    setIsUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (const photo of categorizedPhotos) {
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

      const allPhotos = [...existingPhotos, ...uploadedUrls];

      if (assignmentId) {
        const { error: updateError } = await supabase
          .from('room_assignments')
          .update({
            completion_photos: allPhotos
          })
          .eq('id', assignmentId);

        if (updateError) throw updateError;
      }

      toast.success(`${t('photoCapture.uploadSuccess')}: ${uploadedUrls.length}`);
      
      if (onPhotoCaptured) {
        await onPhotoCaptured();
      }
      
      handleClose(true);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(t('photoCapture.uploadError') + ': ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = (category: PhotoCategory) => {
    setCategorizedPhotos(prev => prev.filter(p => p.category !== category));
  };

  const handleClose = (force: boolean = false) => {
    if (!force && categorizedPhotos.length > 0 && !allPhotosComplete) {
      setShowExitWarning(true);
      return;
    }
    
    stopCamera();
    setCategorizedPhotos([]);
    setCurrentCategoryIndex(0);
    setExistingPhotos([]);
    onOpenChange(false);
  };

  const goToNextCategory = () => {
    if (currentCategoryIndex < PHOTO_CATEGORIES.length - 1) {
      setCurrentCategoryIndex(prev => prev + 1);
    }
  };

  const goToPreviousCategory = () => {
    if (currentCategoryIndex > 0) {
      setCurrentCategoryIndex(prev => prev - 1);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={() => handleClose(false)}>
        <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg pr-8">
              <Camera className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              <span className="truncate">{t('photoCapture.title')} - {t('common.room')} {roomNumber}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 sm:space-y-6">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {t('photoCapture.progress')}: {categorizedPhotos.filter((photo, index, self) => 
                    index === self.findIndex(p => p.category === photo.category)
                  ).length} / {PHOTO_CATEGORIES.length}
                </span>
                {allPhotosComplete && (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {t('photoCapture.allComplete')}
                  </Badge>
                )}
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Category Stepper - Mobile Optimized */}
            <div className="relative -mx-4 sm:mx-0">
              <div className="flex gap-2 overflow-x-auto px-4 py-2 snap-x snap-mandatory scrollbar-hide">
                {PHOTO_CATEGORIES.map((cat, index) => {
                  const hasPhoto = categorizedPhotos.some(p => p.category === cat.key);
                  const isCurrent = index === currentCategoryIndex;
                  const Icon = cat.icon;
                  
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setCurrentCategoryIndex(index)}
                      className={cn(
                        "flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-xl transition-all w-20 snap-center",
                        isCurrent && "bg-primary/10 ring-2 ring-primary scale-105",
                        !isCurrent && "hover:bg-muted active:scale-95"
                      )}
                    >
                      <div className={cn(
                        "w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-sm",
                        hasPhoto ? "bg-green-600 text-white" : isCurrent ? cat.color + " text-white" : "bg-muted"
                      )}>
                        {hasPhoto ? <CheckCircle className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
                      </div>
                      <span className={cn(
                        "text-[10px] font-medium text-center leading-tight line-clamp-2",
                        isCurrent && "text-primary font-semibold"
                      )}>
                        {cat.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Scroll indicators */}
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none sm:hidden" />
              <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none sm:hidden" />
            </div>

            {/* Current Category Card - Mobile Optimized */}
            <div className={cn(
              "p-4 sm:p-6 rounded-lg border-2 transition-all",
              currentCategory.color.replace('bg-', 'border-'),
              "bg-gradient-to-br from-background to-muted/20"
            )}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={cn(
                    "w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center flex-shrink-0",
                    currentCategory.color,
                    "text-white shadow-lg"
                  )}>
                    <currentCategory.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base sm:text-lg font-semibold truncate">{currentCategory.label}</h3>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {hasPhotoForCurrentCategory ? t('photoCapture.photoTaken') : t('photoCapture.takePhotoFor')}
                    </p>
                  </div>
                </div>
                
                {hasPhotoForCurrentCategory && (
                  <Badge variant="default" className="bg-green-600 flex-shrink-0 ml-2">
                    <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    <span className="hidden sm:inline">{t('common.done')}</span>
                    <span className="sm:hidden">✓</span>
                  </Badge>
                )}
              </div>

              {/* Current Photo Preview */}
              {hasPhotoForCurrentCategory && (
                <div className="relative mb-4 rounded-lg overflow-hidden">
                  <img
                    src={categorizedPhotos.find(p => p.category === currentCategory.key)?.dataUrl}
                    alt={currentCategory.label}
                    className="w-full h-40 sm:h-48 object-cover"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="absolute top-2 right-2 h-8 sm:h-9"
                    onClick={() => removePhoto(currentCategory.key)}
                  >
                    <X className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    <span className="text-xs sm:text-sm">{t('common.remove')}</span>
                  </Button>
                </div>
              )}

              {/* Camera View or Action Buttons - Mobile Optimized */}
              {!showCamera ? (
                <div className="space-y-2 sm:space-y-3">
                  <Button
                    type="button"
                    onClick={startCamera}
                    className="w-full h-14 sm:h-16 text-base sm:text-lg touch-manipulation"
                    variant={hasPhotoForCurrentCategory ? "outline" : "default"}
                  >
                    <Camera className="h-5 w-5 sm:h-6 sm:w-6 mr-2" />
                    {hasPhotoForCurrentCategory ? t('photoCapture.retakePhoto') : t('common.takePhoto')}
                  </Button>
                  
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    className="w-full h-14 sm:h-16 text-base sm:text-lg touch-manipulation"
                  >
                    <Upload className="h-5 w-5 sm:h-6 sm:w-6 mr-2" />
                    {t('common.uploadPhoto')}
                  </Button>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
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
                          <p className="text-sm sm:text-base">{t('photoCapture.startingCamera')}</p>
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
                      className="flex-1 h-12 sm:h-14 text-base sm:text-lg touch-manipulation"
                      disabled={isCameraLoading}
                    >
                      <Camera className="h-5 w-5 mr-2" />
                      {t('common.capture')}
                    </Button>
                    <Button
                      type="button"
                      onClick={stopCamera}
                      variant="outline"
                      className="h-12 sm:h-14 px-4 touch-manipulation"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {/* Navigation and Action Buttons - Mobile Optimized */}
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={goToPreviousCategory}
                variant="outline"
                disabled={currentCategoryIndex === 0}
                className="h-12 w-12 p-0 flex-shrink-0 touch-manipulation"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              
              <Button
                type="button"
                onClick={() => handleClose(false)}
                variant="outline"
                className="flex-1 h-12 text-sm sm:text-base touch-manipulation"
                disabled={isUploading}
              >
                {t('common.close')}
              </Button>
              
              {categorizedPhotos.length > 0 && (
                <Button
                  type="button"
                  onClick={uploadPhotos}
                  disabled={isUploading}
                  className="flex-1 h-12 text-sm sm:text-base touch-manipulation"
                  variant={allPhotosComplete ? "default" : "secondary"}
                >
                  {isUploading ? (
                    <>{t('common.uploading')}</>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-1 sm:mr-2 flex-shrink-0" />
                      <span className="hidden sm:inline">{t('photoCapture.savePhotos')}</span>
                      <span className="sm:hidden">Save</span>
                      <span className="ml-1">({categorizedPhotos.length})</span>
                    </>
                  )}
                </Button>
              )}
              
              <Button
                type="button"
                onClick={goToNextCategory}
                variant="outline"
                disabled={currentCategoryIndex === PHOTO_CATEGORIES.length - 1}
                className="h-12 w-12 p-0 flex-shrink-0 touch-manipulation"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {/* Warning for incomplete photos - Mobile Optimized */}
            {categorizedPhotos.length > 0 && !allPhotosComplete && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs sm:text-sm min-w-0">
                  <p className="font-medium text-amber-900 dark:text-amber-100">
                    {t('photoCapture.incompleteWarning')}
                  </p>
                  <p className="text-amber-700 dark:text-amber-200 mt-1 break-words">
                    {t('photoCapture.missingCategories')}: {PHOTO_CATEGORIES
                      .filter(cat => !categorizedPhotos.some(p => p.category === cat.key))
                      .map(cat => cat.label)
                      .join(', ')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Exit Warning Dialog */}
      <AlertDialog open={showExitWarning} onOpenChange={setShowExitWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              {t('photoCapture.exitWarningTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('photoCapture.exitWarningMessage')}
              <div className="mt-3 p-3 bg-muted rounded-lg">
                <p className="font-medium text-sm mb-2">{t('photoCapture.missingCategories')}:</p>
                <ul className="text-sm space-y-1">
                  {PHOTO_CATEGORIES
                    .filter(cat => !categorizedPhotos.some(p => p.category === cat.key))
                    .map(cat => (
                      <li key={cat.key} className="flex items-center gap-2">
                        <cat.icon className="h-4 w-4" />
                        {cat.label}
                      </li>
                    ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('photoCapture.continueCapturing')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowExitWarning(false);
              handleClose(true);
            }}>
              {t('photoCapture.exitAnyway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
