import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Camera, X, CheckCircle, AlertCircle, ChevronRight, ChevronLeft, Trash2, Bath, Bed, Wine, Coffee, Plus } from 'lucide-react';
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
  { key: 'trash_bin' as PhotoCategory, label: 'Trash Bin', icon: Trash2, color: 'bg-blue-500' },
  { key: 'bathroom' as PhotoCategory, label: 'Bathroom', icon: Bath, color: 'bg-cyan-500' },
  { key: 'bed' as PhotoCategory, label: 'Bed', icon: Bed, color: 'bg-purple-500' },
  { key: 'minibar' as PhotoCategory, label: 'Minibar', icon: Wine, color: 'bg-orange-500' },
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
  const [uploadingPhotos, setUploadingPhotos] = useState<Set<string>>(new Set());
  const [uploadedPhotos, setUploadedPhotos] = useState<Set<string>>(new Set());
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<CategorizedPhoto | null>(null);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const currentCategory = PHOTO_CATEGORIES[currentCategoryIndex];
  const photosForCurrentCategory = categorizedPhotos.filter(p => p.category === currentCategory.key);
  const hasPhotoForCurrentCategory = photosForCurrentCategory.length > 0;
  const allPhotosComplete = PHOTO_CATEGORIES.every(cat => 
    categorizedPhotos.some(p => p.category === cat.key)
  );
  const categoriesWithPhotos = PHOTO_CATEGORIES.filter(cat => 
    categorizedPhotos.some(p => p.category === cat.key)
  ).length;
  const progress = (categoriesWithPhotos / PHOTO_CATEGORIES.length) * 100;

  // Load existing photos and check camera permission when dialog opens
  useEffect(() => {
    if (open && assignmentId) {
      loadExistingPhotos();
      checkCameraPermission();
    }
  }, [open, assignmentId]);

  const checkCameraPermission = async () => {
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
      setCameraPermissionGranted(permissionStatus.state === 'granted');
      
      permissionStatus.addEventListener('change', () => {
        setCameraPermissionGranted(permissionStatus.state === 'granted');
      });
    } catch (error) {
      console.log('Permission API not supported');
      setCameraPermissionGranted(null);
    }
  };

  const loadExistingPhotos = async () => {
    if (!assignmentId) return;
    
    try {
      const { data: assignmentData } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignmentId)
        .single();
      
      if (assignmentData?.completion_photos && assignmentData.completion_photos.length > 0) {
        setExistingPhotos(assignmentData.completion_photos);
        
        // Parse existing photos and reconstruct categorizedPhotos
        const reconstructedPhotos: CategorizedPhoto[] = [];
        
        for (const photoUrl of assignmentData.completion_photos) {
          // Extract category from filename (format: userId/roomNumber/category_timestamp_random.jpg)
          const urlParts = photoUrl.split('/');
          const filename = urlParts[urlParts.length - 1];
          
          // Try to match against known category keys (some have underscores)
          let matchedCategory: PhotoCategory | null = null;
          
          for (const cat of PHOTO_CATEGORIES) {
            // Check if filename starts with category key followed by underscore and timestamp
            if (filename.startsWith(cat.key + '_')) {
              matchedCategory = cat.key;
              break;
            }
          }
          
          if (matchedCategory) {
            const categoryInfo = PHOTO_CATEGORIES.find(c => c.key === matchedCategory);
            
            if (categoryInfo) {
              // Fetch the image to create a blob
              try {
                const response = await fetch(photoUrl);
                const blob = await response.blob();
                
                reconstructedPhotos.push({
                  category: matchedCategory,
                  categoryName: categoryInfo.label,
                  dataUrl: photoUrl, // Use the URL directly for display
                  blob: blob
                });
              } catch (fetchError) {
                console.error('Error fetching photo:', fetchError);
                // If fetch fails, still add it with URL only
                reconstructedPhotos.push({
                  category: matchedCategory,
                  categoryName: categoryInfo.label,
                  dataUrl: photoUrl,
                  blob: new Blob() // Empty blob as fallback
                });
              }
            }
          }
        }
        
        if (reconstructedPhotos.length > 0) {
          setCategorizedPhotos(reconstructedPhotos);
          toast.success(`Loaded ${reconstructedPhotos.length} existing photos`);
        }
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
      
      setCameraPermissionGranted(true);
      
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
        setCameraPermissionGranted(false);
        errorMessage = t('photoCapture.cameraPermissionError');
        toast.error(errorMessage, {
          action: {
            label: 'Settings',
            onClick: () => {
              toast.info('Please enable camera permission in your browser settings');
            }
          }
        });
      } else if (error.name === 'NotFoundError') {
        errorMessage = t('photoCapture.cameraNotFound');
        toast.error(errorMessage);
      } else {
        toast.error(errorMessage);
      }
      
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

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !user) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (blob) {
        const photoUrl = URL.createObjectURL(blob);
        const photoId = `${currentCategory.key}_${Date.now()}_${Math.random()}`;
        
        // Add new photo (allow multiple per category)
        const newPhoto = {
          category: currentCategory.key,
          categoryName: currentCategory.label,
          dataUrl: photoUrl,
          blob
        };
        
        setCategorizedPhotos(prev => [...prev, newPhoto]);
        toast.success(`${currentCategory.label} ${t('photoCapture.photoCaptured')}`);
        stopCamera();

        // Auto-save the photo immediately
        setUploadingPhotos(prev => new Set(prev).add(photoId));
        
        try {
          const fileName = `${user.id}/${roomNumber}/${currentCategory.key}_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
          
          const { data, error } = await supabase.storage
            .from('completion-photos')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
              upsert: false
            });

          if (error) throw error;

          const { data: { publicUrl } } = supabase.storage
            .from('completion-photos')
            .getPublicUrl(data.path);

          // Update the assignment with the new photo URL
          if (assignmentId) {
            const { data: existingAssignment } = await supabase
              .from('room_assignments')
              .select('completion_photos')
              .eq('id', assignmentId)
              .single();

            const currentPhotos = existingAssignment?.completion_photos || [];
            
            await supabase
              .from('room_assignments')
              .update({
                completion_photos: [...currentPhotos, publicUrl]
              })
              .eq('id', assignmentId);
          }

          setUploadingPhotos(prev => {
            const next = new Set(prev);
            next.delete(photoId);
            return next;
          });
          setUploadedPhotos(prev => new Set(prev).add(photoId));
          toast.success(`${currentCategory.label} photo saved!`, { duration: 2000 });
        } catch (error: any) {
          console.error('Auto-save error:', error);
          setUploadingPhotos(prev => {
            const next = new Set(prev);
            next.delete(photoId);
            return next;
          });
          toast.error(`Failed to save ${currentCategory.label} photo`);
        }
        
        // Check if this is the last category and all have at least one photo
        const updatedPhotos = [...categorizedPhotos, newPhoto];
        
        const allCategoriesHavePhotos = PHOTO_CATEGORIES.every(cat => 
          updatedPhotos.some(p => p.category === cat.key)
        );
        
        if (allCategoriesHavePhotos && currentCategoryIndex === PHOTO_CATEGORIES.length - 1) {
          // Show save confirmation after a brief delay
          setTimeout(() => {
            setShowSaveConfirmation(true);
          }, 800);
        } else if (currentCategoryIndex < PHOTO_CATEGORIES.length - 1) {
          // Auto-advance to next category if not the last one
          setTimeout(() => {
            setCurrentCategoryIndex(prev => prev + 1);
          }, 500);
        }
      }
    }, 'image/jpeg', 0.95);
  }, [currentCategory, currentCategoryIndex, categorizedPhotos, stopCamera, t, user, roomNumber, assignmentId]);


  const uploadPhotos = async () => {
    if (!user || categorizedPhotos.length === 0) return;

    setIsUploading(true);
    const uploadedUrls: string[] = [];
    const newPhotosOnly = categorizedPhotos.filter(photo => !photo.dataUrl.startsWith('http'));

    try {
      // Only upload photos that haven't been uploaded yet (new captures)
      for (const photo of newPhotosOnly) {
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

      // Get URLs of already uploaded photos (those that start with http)
      const existingUploadedUrls = categorizedPhotos
        .filter(photo => photo.dataUrl.startsWith('http'))
        .map(photo => photo.dataUrl);

      // Combine all photos: existing uploaded + newly uploaded
      const allPhotos = [...existingUploadedUrls, ...uploadedUrls];

      if (assignmentId) {
        const { error: updateError } = await supabase
          .from('room_assignments')
          .update({
            completion_photos: allPhotos
          })
          .eq('id', assignmentId);

        if (updateError) throw updateError;
      }

      if (uploadedUrls.length > 0) {
        toast.success(`${t('photoCapture.uploadSuccess')}: ${uploadedUrls.length} new photos`);
      } else {
        toast.success('Photos updated successfully');
      }
      
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

  const removePhoto = (photoIndex: number) => {
    setCategorizedPhotos(prev => prev.filter((_, index) => index !== photoIndex));
  };

  const handleClose = (force: boolean = false) => {
    // Check if there are unsaved new photos (those without http URLs)
    const hasUnsavedPhotos = categorizedPhotos.some(photo => !photo.dataUrl.startsWith('http'));
    
    if (!force && hasUnsavedPhotos && !allPhotosComplete) {
      setShowExitWarning(true);
      return;
    }
    
    stopCamera();
    setCategorizedPhotos([]);
    setCurrentCategoryIndex(0);
    setExistingPhotos([]);
    setShowSaveConfirmation(false);
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
        <DialogContent className="w-[100vw] h-[100dvh] max-w-full sm:max-w-2xl sm:h-auto sm:max-h-[95vh] p-0 gap-0">
          <div className="flex flex-col h-full max-h-[100dvh]">
            <DialogHeader className="px-4 py-3 sm:p-6 border-b flex-shrink-0">
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg pr-8">
                <Camera className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="truncate">{t('photoCapture.title')} - {t('common.room')} {roomNumber}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="space-y-4 sm:space-y-6 max-w-2xl mx-auto">
                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs sm:text-sm gap-2">
                    <span className="font-medium flex-shrink-0">
                      {t('photoCapture.progress')}: {categoriesWithPhotos} / {PHOTO_CATEGORIES.length}
                    </span>
                    {allPhotosComplete && (
                      <Badge variant="default" className="bg-green-600 text-xs flex-shrink-0">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        <span className="hidden sm:inline">{t('photoCapture.allComplete')}</span>
                        <span className="sm:hidden">✓</span>
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
                            "flex-shrink-0 flex flex-col items-center gap-2 p-2 sm:p-3 rounded-xl transition-all w-16 sm:w-20 snap-center",
                            isCurrent && "bg-primary/10 ring-2 ring-primary scale-105",
                            !isCurrent && "hover:bg-muted active:scale-95"
                          )}
                        >
                          <div className={cn(
                            "w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all shadow-sm",
                            hasPhoto ? "bg-green-600 text-white" : isCurrent ? cat.color + " text-white" : "bg-muted"
                          )}>
                            {hasPhoto ? <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6" /> : <Icon className="h-5 w-5 sm:h-6 sm:w-6" />}
                          </div>
                          <span className={cn(
                            "text-[9px] sm:text-[10px] font-medium text-center leading-tight line-clamp-2 w-full",
                            isCurrent && "text-primary font-semibold"
                          )}>
                            {cat.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Scroll indicators */}
                  <div className="absolute right-0 top-0 bottom-0 w-6 sm:w-8 bg-gradient-to-l from-background to-transparent pointer-events-none sm:hidden" />
                  <div className="absolute left-0 top-0 bottom-0 w-6 sm:w-8 bg-gradient-to-r from-background to-transparent pointer-events-none sm:hidden" />
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
                      {hasPhotoForCurrentCategory ? `${photosForCurrentCategory.length} photo${photosForCurrentCategory.length > 1 ? 's' : ''} taken` : t('photoCapture.takePhotoFor')}
                    </p>
                  </div>
                </div>
                
                {hasPhotoForCurrentCategory && (
                  <Badge variant="default" className="bg-green-600 flex-shrink-0 ml-2">
                    <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    <span>{photosForCurrentCategory.length}</span>
                  </Badge>
                )}
              </div>

              {/* Current Category Photos Preview */}
              {hasPhotoForCurrentCategory && (
                <div className="mb-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {photosForCurrentCategory.map((photo, index) => {
                      const photoGlobalIndex = categorizedPhotos.findIndex(p => p === photo);
                      return (
                        <div key={photoGlobalIndex} className="relative rounded-lg overflow-hidden group">
                          <img
                            src={photo.dataUrl}
                            alt={`${currentCategory.label} ${index + 1}`}
                            className="w-full h-32 sm:h-40 object-cover"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removePhoto(photoGlobalIndex)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                          <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded">
                            {index + 1}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Camera View or Action Buttons - Mobile Optimized */}
              {!showCamera ? (
                <div className="space-y-2 sm:space-y-3">
                  <Button
                    type="button"
                    onClick={startCamera}
                    className="w-full h-14 sm:h-16 text-base sm:text-lg touch-manipulation relative"
                    variant={hasPhotoForCurrentCategory ? "outline" : "default"}
                  >
                    <Camera className="h-5 w-5 sm:h-6 sm:w-6 mr-2" />
                    {hasPhotoForCurrentCategory ? (
                      <>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Another Photo
                      </>
                    ) : (
                      t('common.takePhoto')
                    )}
                  </Button>
                  
                  {cameraPermissionGranted === false && (
                    <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="text-xs">
                        <p className="font-medium text-amber-900 dark:text-amber-100">
                          Camera permission required
                        </p>
                        <p className="text-amber-700 dark:text-amber-200 mt-1">
                          Please enable camera access in your browser settings
                        </p>
                      </div>
                    </div>
                  )}
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

                {/* Captured Photos Gallery - with count per category */}
                {categorizedPhotos.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{t('photoCapture.capturedPhotos')}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {categorizedPhotos.length} {t('common.photos')}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {categorizedPhotos.map((photo, photoIndex) => {
                        const Icon = PHOTO_CATEGORIES.find(c => c.key === photo.category)?.icon || Camera;
                        const categoryInfo = PHOTO_CATEGORIES.find(c => c.key === photo.category);
                        const categoryPhotos = categorizedPhotos.filter(p => p.category === photo.category);
                        const photoIndexInCategory = categoryPhotos.findIndex(p => p === photo) + 1;
                        
                        return (
                          <button
                            key={photoIndex}
                            onClick={() => setSelectedPhotoPreview(photo)}
                            className="relative aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all active:scale-95 touch-manipulation"
                          >
                            <img
                              src={photo.dataUrl}
                              alt={photo.categoryName}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                            <div className="absolute bottom-0 left-0 right-0 p-1.5">
                              <div className={cn(
                                "flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[9px] font-medium w-full",
                                categoryInfo?.color || "bg-primary"
                              )}>
                                <Icon className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{photo.categoryName}</span>
                                {categoryPhotos.length > 1 && (
                                  <span className="ml-auto">#{photoIndexInCategory}</span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

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
            </div>
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

      {/* Photo Preview Dialog */}
      <Dialog open={!!selectedPhotoPreview} onOpenChange={(open) => !open && setSelectedPhotoPreview(null)}>
        <DialogContent className="max-w-4xl w-full p-0">
          <div className="relative">
            <button
              onClick={() => setSelectedPhotoPreview(null)}
              className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-all touch-manipulation"
            >
              <X className="h-5 w-5" />
            </button>
            {selectedPhotoPreview && (
              <div className="space-y-4 p-4 sm:p-6">
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = PHOTO_CATEGORIES.find(c => c.key === selectedPhotoPreview.category)?.icon || Camera;
                    const categoryInfo = PHOTO_CATEGORIES.find(c => c.key === selectedPhotoPreview.category);
                    return (
                      <>
                        <div className={cn(
                          "w-12 h-12 rounded-full flex items-center justify-center",
                          categoryInfo?.color || "bg-primary",
                          "text-white"
                        )}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold">{selectedPhotoPreview.categoryName}</h3>
                          <p className="text-sm text-muted-foreground">{t('photoCapture.photoPreview')}</p>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <img
                  src={selectedPhotoPreview.dataUrl}
                  alt={selectedPhotoPreview.categoryName}
                  className="w-full rounded-lg"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      const photoIndex = categorizedPhotos.findIndex(p => p === selectedPhotoPreview);
                      if (photoIndex !== -1) {
                        removePhoto(photoIndex);
                      }
                      setSelectedPhotoPreview(null);
                    }}
                    variant="destructive"
                    className="flex-1"
                  >
                    <X className="h-4 w-4 mr-2" />
                    {t('photoCapture.deletePhoto')}
                  </Button>
                  <Button
                    onClick={() => setSelectedPhotoPreview(null)}
                    variant="outline"
                    className="flex-1"
                  >
                    {t('common.close')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={showSaveConfirmation} onOpenChange={setShowSaveConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              All Photos Captured!
            </AlertDialogTitle>
            <AlertDialogDescription>
              You've taken photos for all categories ({categorizedPhotos.length} total photos). Would you like to save them now?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Add More Photos</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowSaveConfirmation(false);
              uploadPhotos();
            }}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Save & Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
