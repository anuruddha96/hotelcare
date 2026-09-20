import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, Camera, CheckCircle, DoorOpen, ImagePlus, Smartphone } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { toast } from 'sonner';

interface EnhancedDNDPhotoCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  roomId: string;
  assignmentId?: string;
  attemptNumber?: number;
  onPhotoUploaded?: () => void;
}

type Photo = { id: string; url: string; saved: boolean };

// The native input picker can launch Android's camera even when getUserMedia
// preview is unavailable. A second picker allows a photo from the gallery.
// Both options must use precisely the same DND evidence/save path.
function fileExtension(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/heif') return 'heif';
  return 'jpg';
}

function cameraMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (!window.isSecureContext) return 'Camera preview requires a secure HTTPS connection. Use your phone camera or choose a photo below.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Chrome could not open the live camera (this can happen even when camera access is enabled). Use Phone camera below, or check this website’s camera permission.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Another app may be using the camera. Close it and try again, or use Phone camera below.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'The requested camera was not found. Try Phone camera or choose an existing photo below.';
  }
  return `Live camera could not start${name ? ` (${name})` : ''}. Try Phone camera or choose a photo below.`;
}

export function EnhancedDNDPhotoCapture({
  open, onOpenChange, roomNumber, roomId, assignmentId,
  attemptNumber = 1, onPhotoUploaded,
}: EnhancedDNDPhotoCaptureProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const openRef = useRef(open);
  const savingRef = useRef(false);
  const localUrlsRef = useRef<Set<string>>(new Set());
  openRef.current = open;

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1; // Invalidate requests still waiting for a browser prompt.
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowCamera(false);
    setCameraLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPhotos([]);
    setCameraError('');
    if (assignmentId) {
      void supabase.from('dnd_photos').select('photo_url')
        .eq('assignment_id', assignmentId).order('created_at', { ascending: false })
        .then(({ data, error }) => {
          if (!active) return;
          if (error) {
            console.error('Could not load existing DND photos:', error);
            return;
          }
          setPhotos(previous => {
            const pending = previous.filter(photo => !photo.saved);
            const existing = (data ?? []).filter(item => !!item.photo_url).map(item => ({
              id: item.photo_url, url: item.photo_url, saved: true,
            }));
            return [...existing, ...pending];
          });
        });
    }
    return () => {
      active = false;
      stopCamera();
      localUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      localUrlsRef.current.clear();
    };
  }, [open, assignmentId, stopCamera]);

  const startCamera = async () => {
    if (savingRef.current) return;
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setCameraError('The browser cannot provide a live camera preview. Use Phone camera or Choose photo below.');
      return;
    }
    const request = ++cameraRequestRef.current;
    setShowCamera(true);
    setCameraLoading(true);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (error) {
        // Some Android devices reject a requested camera but permit the default.
        if (error instanceof Error && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else throw error;
      }
      if (!openRef.current || request !== cameraRequestRef.current || !videoRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (request === cameraRequestRef.current) setCameraLoading(false);
    } catch (error) {
      console.error('DND camera preview error:', error instanceof Error ? error.name : error);
      if (request === cameraRequestRef.current) {
        setCameraError(cameraMessage(error));
        stopCamera();
      }
    }
  };

  const savePhoto = async (blob: Blob) => {
    if (!user || savingRef.current || !blob.type.startsWith('image/')) {
      if (!user) toast.error('Please sign in before saving a photo.');
      else if (!blob.type.startsWith('image/')) toast.error('Please select an image file.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    stopCamera();
    setCameraError('');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const localUrl = URL.createObjectURL(blob);
    localUrlsRef.current.add(localUrl);
    setPhotos(previous => [...previous, { id, url: localUrl, saved: false }]);
    const path = `${user.id}/${roomNumber}/dnd_door_${id}.${fileExtension(blob.type)}`;
    let recordSaved = false;
    try {
      const { data, error: uploadError } = await supabase.storage.from('dnd-photos')
        .upload(path, blob, { contentType: blob.type, cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const publicUrl = supabase.storage.from('dnd-photos').getPublicUrl(data.path).data.publicUrl;
      const { error: recordError } = await supabase.from('dnd_photos').insert({
        room_id: roomId,
        assignment_id: assignmentId || null,
        marked_by: user.id,
        photo_url: publicUrl,
        assignment_date: todayBudapest(),
        attempt_number: attemptNumber,
      } as any);
      if (recordError) {
        // The upload alone is not proof of a DND attempt; remove orphaned files.
        await supabase.storage.from('dnd-photos').remove([data.path]);
        throw recordError;
      }
      recordSaved = true;
      setPhotos(previous => previous.map(photo => photo.id === id
        ? { id, url: publicUrl, saved: true } : photo));
      URL.revokeObjectURL(localUrl);
      localUrlsRef.current.delete(localUrl);
      if (attemptNumber >= 2) {
        const { error: roomError } = await supabase.from('rooms').update({
          is_dnd: true,
          dnd_marked_at: new Date().toISOString(),
          dnd_marked_by: user.id,
        }).eq('id', roomId);
        if (roomError) throw roomError;
      }
      toast.success(t('photoCapture.photoSavedSuccess'));
      onPhotoUploaded?.();
    } catch (error) {
      console.error('DND photo save error:', error);
      if (!recordSaved) {
        setPhotos(previous => previous.filter(photo => photo.id !== id));
        URL.revokeObjectURL(localUrl);
        localUrlsRef.current.delete(localUrl);
        toast.error('Photo was not saved. Please try again.');
      } else {
        toast.error('Photo saved, but the room DND status was not updated. Please notify a manager.');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handlePicker = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // Allow selecting the same file again after a failure.
    if (file) void savePhoto(file);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera preview is not ready. Try Phone camera below.');
      stopCamera();
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (blob) void savePhoto(blob);
      else toast.error('Could not capture photo. Please use Phone camera.');
    }, 'image/jpeg', 0.9);
  };

  const handleClose = () => {
    if (savingRef.current) return;
    openRef.current = false;
    stopCamera();
    localUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    localUrlsRef.current.clear();
    setPhotos([]);
    onOpenChange(false);
  };

  const savedCount = photos.filter(photo => photo.saved).length;

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) handleClose(); }}>
      <DialogContent className="w-[100vw] sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[92dvh] p-0 gap-0 flex flex-col overflow-hidden rounded-none sm:rounded-lg"
        onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
        <DialogHeader className="px-4 py-3 border-b shrink-0 bg-gradient-to-r from-orange-50 to-red-50">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg leading-tight pr-8">
            <Camera className="h-5 w-5 text-orange-600" />
            {t('photoCapture.dndTitle').replace('{room}', roomNumber)}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{t('photoCapture.progress')}: {savedCount} {t('photoCapture.photoCaptured')}</span>
                <Badge className={savedCount ? 'bg-green-500' : ''}>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  {savedCount ? t('photoCapture.saved') : t('photoCapture.noPhotos')}
                </Badge>
              </div>
              <Progress value={savedCount ? 100 : 0} className="h-2" />
            </div>
            <div className="p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
              <p className="text-sm text-orange-800 dark:text-orange-200 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />{t('photoCapture.takeClearPhoto')}
              </p>
            </div>
            {cameraError && (
              <div role="alert" className="p-3 rounded-lg border border-amber-400 bg-amber-50 text-sm text-amber-950">
                <p>{cameraError}</p>
                <p className="mt-1 text-xs">Live camera error does not mean the phone camera is unusable. Use one of the options below.</p>
              </div>
            )}
            <div className="p-5 rounded-xl border-2 bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-lg space-y-3">
              <div className="flex items-center gap-3">
                <span className="w-14 h-14 shrink-0 rounded-full bg-white/20 flex items-center justify-center"><DoorOpen className="h-8 w-8" /></span>
                <div className="min-w-0 flex-1"><h3 className="text-xl font-bold break-words">{t('photoCapture.dndDoorPhoto')}</h3>
                  <p className="text-sm opacity-90">{savedCount} {t('photoCapture.photoCaptured')}</p></div>
              </div>
              {photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {photos.map(photo => (
                    <div key={photo.id} className="relative overflow-hidden rounded-lg aspect-video bg-black/20">
                      <img src={photo.url} alt={t('photoCapture.dndDoorPhoto')} className="w-full h-full object-cover" />
                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-2 py-1 text-xs">
                        {photo.saved ? t('photoCapture.saved') : t('photoCapture.savingPhoto')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!showCamera ? (
                <Button type="button" onClick={() => void startCamera()} disabled={saving || cameraLoading}
                  className="w-full bg-white/20 hover:bg-white/30 border border-white/30 text-white" size="lg">
                  <Camera className="h-5 w-5 mr-2" />{t('common.takePhoto')} (live preview)
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    {cameraLoading && <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm">{t('photoCapture.startingCamera')}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" onClick={capturePhoto} disabled={cameraLoading || saving} className="flex-1 bg-white text-orange-900 hover:bg-orange-50">
                      {t('common.capturePhoto')}
                    </Button>
                    <Button type="button" onClick={stopCamera} variant="outline" className="text-foreground">{t('common.cancel')}</Button>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button type="button" variant="default" size="lg" disabled={saving}
                onClick={() => { stopCamera(); nativeCameraRef.current?.click(); }}>
                <Smartphone className="h-5 w-5 mr-2" />Phone camera (recommended)
              </Button>
              <Button type="button" variant="outline" size="lg" disabled={saving}
                onClick={() => { stopCamera(); galleryRef.current?.click(); }}>
                <ImagePlus className="h-5 w-5 mr-2" />Choose photo from phone
              </Button>
            </div>
            <input aria-label="Take DND photo using phone camera" ref={nativeCameraRef} type="file"
              accept="image/*" capture="environment" onChange={handlePicker} className="hidden" />
            <input aria-label="Choose existing DND photo" ref={galleryRef} type="file"
              accept="image/*" onChange={handlePicker} className="hidden" />
            {saving && <p role="status" className="p-3 text-sm bg-blue-50 text-blue-900 rounded-lg">{t('photoCapture.savingPhoto')}</p>}
            {savedCount > 0 && <p className="text-xs text-amber-800">{t('photoCapture.afterSavingWarning')}</p>}
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>
        <div className="p-4 border-t bg-background shrink-0">
          <Button type="button" onClick={handleClose} variant="outline" className="w-full" disabled={saving}>
            {t('photoCapture.finishDnd')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
