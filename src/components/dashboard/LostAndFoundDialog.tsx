import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Camera, Upload, X, Package, CheckCircle, ArrowLeft, ArrowRight, Search, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { searchLostFoundItems, labelFor, LOST_FOUND_ITEMS, type LangKey, type LostFoundItem } from '@/lib/lostFoundItems';
import { cn } from '@/lib/utils';

interface LostAndFoundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  roomId: string | null;
  assignmentId?: string | null;
  onItemReported?: () => void;
}

type Step = 'photo' | 'item' | 'details';

export function LostAndFoundDialog({
  open,
  onOpenChange,
  roomNumber,
  roomId,
  assignmentId,
  onItemReported,
}: LostAndFoundDialogProps) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const lang = (['en', 'hu', 'es', 'vi', 'mn', 'uk'].includes(language) ? language : 'en') as LangKey;

  const [step, setStep] = useState<Step>('photo');
  const [selectedItem, setSelectedItem] = useState<LostFoundItem | null>(null);
  const [customText, setCustomText] = useState('');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ dataUrl: string; blob: Blob }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => searchLostFoundItems(query, lang), [query, lang]);

  const resetAll = useCallback(() => {
    setStep('photo');
    setSelectedItem(null);
    setCustomText('');
    setQuery('');
    setNotes('');
    setPhotos([]);
  }, []);

  useEffect(() => {
    if (!open) resetAll();
  }, [open, resetAll]);

  const startCamera = useCallback(async () => {
    try {
      setShowCamera(true);
      setIsCameraLoading(true);
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('Camera not supported on this device');
        setShowCamera(false);
        setIsCameraLoading(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => setIsCameraLoading(false));
          setIsCameraLoading(false);
        };
      }
    } catch {
      toast.error('Could not access camera');
      setShowCamera(false);
      setIsCameraLoading(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowCamera(false);
    setIsCameraLoading(false);
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        setPhotos((prev) => [...prev, { dataUrl: url, blob }]);
        toast.success('Photo captured');
        stopCamera();
      }
    }, 'image/jpeg', 0.95);
  }, [stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        setPhotos((prev) => [...prev, { dataUrl: url, blob: file }]);
      }
    });
    if (files.length > 0) toast.success(`${files.length} photo(s) added`);
  };

  const removePhoto = (idx: number) =>
    setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const finalDescription = useMemo(() => {
    if (customText.trim()) return customText.trim();
    if (selectedItem) return labelFor(selectedItem, lang);
    return '';
  }, [customText, selectedItem, lang]);

  const handleSubmit = async () => {
    if (!user || !finalDescription) {
      toast.error('Please select or type an item');
      return;
    }
    setIsUploading(true);
    const uploadedUrls: string[] = [];
    try {
      for (const photo of photos) {
        const fileName = `${user.id}/${roomId || 'general'}/lost_found_${Date.now()}_${Math.random()
          .toString(36)
          .substring(7)}.jpg`;
        const { data, error } = await supabase.storage
          .from('room-photos')
          .upload(fileName, photo.blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('room-photos').getPublicUrl(data.path);
        uploadedUrls.push(publicUrl);
      }
      const { error: insertError } = await supabase.from('lost_and_found').insert({
        room_id: roomId || null,
        assignment_id: assignmentId || null,
        reported_by: user.id,
        item_description: finalDescription,
        photo_urls: uploadedUrls,
        notes: notes || null,
        status: 'pending',
      });
      if (insertError) throw insertError;
      toast.success('Lost & Found item reported successfully');
      onItemReported?.();
      handleClose();
    } catch (error: any) {
      toast.error('Failed to report item: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    stopCamera();
    resetAll();
    onOpenChange(false);
  };

  const canGoNext =
    (step === 'photo' && photos.length > 0) ||
    (step === 'item' && !!finalDescription);

  const stepIndex = step === 'photo' ? 0 : step === 'item' ? 1 : 2;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : handleClose())}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-emerald-100 text-emerald-700">
              <Package className="h-4 w-4" />
            </span>
            <span>
              {t('lostFound.title')} · {t('common.room')} {roomNumber}
            </span>
          </DialogTitle>

          {/* Stepper */}
          <div className="flex items-center gap-2 mt-3">
            {(['photo', 'item', 'details'] as const).map((s, i) => (
              <div key={s} className="flex-1 flex items-center gap-2">
                <div
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-colors',
                    i <= stepIndex ? 'bg-primary' : 'bg-muted',
                  )}
                />
                <span
                  className={cn(
                    'text-[10px] uppercase tracking-wide',
                    i === stepIndex ? 'text-primary font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {t(`lostFound.step${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                </span>
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          {step === 'photo' && (
            <div className="space-y-4">
              <div>
                <div className="font-semibold text-foreground">
                  {t('lostFound.photoTitle')}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('lostFound.photoSubtitle')}
                </p>
              </div>

              {!showCamera ? (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    onClick={startCamera}
                    className="h-24 flex-col gap-2 bg-primary hover:bg-primary/90"
                  >
                    <Camera className="h-6 w-6" />
                    <span>{t('common.takePhoto')}</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    className="h-24 flex-col gap-2"
                  >
                    <Upload className="h-6 w-6" />
                    <span>{t('common.uploadPhoto')}</span>
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
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                    {isCameraLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                        <div className="text-center text-white">
                          <Camera className="h-8 w-8 mx-auto mb-2 animate-pulse" />
                          <p>Starting camera…</p>
                        </div>
                      </div>
                    )}
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={capturePhoto} className="flex-1" disabled={isCameraLoading}>
                      <Camera className="h-4 w-4 mr-2" />
                      {t('common.capture')}
                    </Button>
                    <Button onClick={stopCamera} variant="outline">
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />

              {photos.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t('common.photos')} ({photos.length})
                  </Label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {photos.map((p, i) => (
                      <Card key={i} className="relative overflow-hidden rounded-xl">
                        <img src={p.dataUrl} alt={`Photo ${i + 1}`} className="w-full h-24 object-cover" />
                        <Button
                          size="icon"
                          variant="destructive"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => removePhoto(i)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'item' && (
            <div className="space-y-3">
              <div>
                <div className="font-semibold text-foreground">
                  {t('lostFound.pickItemTitle')}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('lostFound.pickItemSubtitle')}
                </p>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedItem(null);
                  }}
                  placeholder={t('lostFound.searchItem')}
                  className="pl-9 h-12 text-base"
                />
              </div>

              {selectedItem ? (
                <div className="flex items-center justify-between rounded-xl border-2 border-primary bg-primary/5 p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-primary" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">
                        {t('lostFound.selected')}
                      </div>
                      <div className="font-medium text-foreground">
                        {labelFor(selectedItem, lang)}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedItem(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> {t('lostFound.suggested')}
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                    {suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedItem(item);
                          setCustomText('');
                        }}
                        className="text-left rounded-xl border border-border bg-card p-3 hover:border-primary hover:bg-accent/40 transition-colors"
                      >
                        <div className="text-sm font-medium text-foreground">
                          {labelFor(item, lang)}
                        </div>
                      </button>
                    ))}
                  </div>
                  {query && suggestions.length === 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomText(query);
                        setSelectedItem(null);
                      }}
                      className="w-full text-left rounded-xl border-2 border-dashed border-border p-3 hover:border-primary"
                    >
                      <div className="text-xs text-muted-foreground">
                        {t('lostFound.useCustom')}
                      </div>
                      <div className="text-sm font-medium text-foreground">"{query}"</div>
                    </button>
                  )}
                </>
              )}

              <div className="pt-2">
                <Label htmlFor="custom" className="text-xs text-muted-foreground">
                  {t('lostFound.useCustom')}
                </Label>
                <Input
                  id="custom"
                  value={customText}
                  onChange={(e) => {
                    setCustomText(e.target.value);
                    if (e.target.value) setSelectedItem(null);
                  }}
                  placeholder={t('lostFound.itemDescriptionPlaceholder') || 'Describe the item'}
                  className="mt-1"
                />
              </div>
            </div>
          )}

          {step === 'details' && (
            <div className="space-y-3">
              <div>
                <div className="font-semibold text-foreground">
                  {t('lostFound.detailsTitle')}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('lostFound.detailsSubtitle')}
                </p>
              </div>

              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  {t('lostFound.selected')}
                </div>
                <div className="font-medium text-foreground">{finalDescription}</div>
              </div>

              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder={t('lostFound.additionalNotesPlaceholder') || ''}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t bg-muted/30">
          {step !== 'photo' ? (
            <Button
              variant="outline"
              onClick={() => setStep(step === 'details' ? 'item' : 'photo')}
              className="min-h-11"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              {t('lostFound.back')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleClose} className="min-h-11">
              {t('common.cancel')}
            </Button>
          )}

          <div className="flex-1" />

          {step !== 'details' ? (
            <Button
              onClick={() => setStep(step === 'photo' ? 'item' : 'details')}
              disabled={!canGoNext}
              className="min-h-11"
            >
              {t('lostFound.next')}
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isUploading || !finalDescription}
              className="min-h-11 bg-primary hover:bg-primary/90"
            >
              {isUploading ? (
                <>{t('lostFound.reporting')}</>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-1.5" />
                  {t('lostFound.reportItem')}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
