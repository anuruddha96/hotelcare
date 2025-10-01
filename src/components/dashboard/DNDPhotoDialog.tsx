import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Camera, Upload, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
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

export function DNDPhotoDialog({
  open,
  onOpenChange,
  roomNumber,
  roomId,
  assignmentId,
  onPhotoUploaded
}: DNDPhotoDialogProps) {
  const { user } = useAuth();
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
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
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        await new Promise((resolve) => {
          const onLoadedMetadata = () => {
            videoRef.current?.removeEventListener('loadedmetadata', onLoadedMetadata);
            resolve(null);
          };
          videoRef.current?.addEventListener('loadedmetadata', onLoadedMetadata);
        });
        
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
        const file = new File([blob], `dnd-${roomNumber}-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setSelectedPhoto(file);
        setPhotoPreview(URL.createObjectURL(blob));
      }
    }, 'image/jpeg', 0.8);

    stopCamera();
  }, [roomNumber, stopCamera]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  }, []);

  const uploadPhoto = async (file: File) => {
    if (!user?.id) return null;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${roomId}/${Date.now()}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('dnd-photos')
        .upload(fileName, file);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('dnd-photos')
        .getPublicUrl(data.path);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading photo:', error);
      throw error;
    }
  };

  const handleSubmit = async () => {
    if (!selectedPhoto || !user?.id) {
      toast.error('Please capture or select a photo');
      return;
    }

    setIsUploading(true);
    try {
      // Upload photo
      const photoUrl = await uploadPhoto(selectedPhoto);
      if (!photoUrl) throw new Error('Failed to upload photo');

      // Save DND record
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

      toast.success('DND photo captured and room marked as Do Not Disturb');
      onPhotoUploaded?.();
      handleClose();
    } catch (error) {
      console.error('Error submitting DND photo:', error);
      toast.error('Failed to submit DND photo');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    stopCamera();
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }
    setSelectedPhoto(null);
    setPhotoPreview(null);
    setNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            DND Photo - Room {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-sm text-orange-800">
              Capture a photo showing the DND notice on the door as evidence.
            </p>
          </div>

          {!selectedPhoto && !showCamera && (
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={startCamera}
                className="flex items-center gap-2"
                variant="outline"
              >
                <Camera className="h-4 w-4" />
                Take Photo
              </Button>
              
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2"
                variant="outline"
              >
                <Upload className="h-4 w-4" />
                Upload Photo
              </Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {showCamera && (
            <div className="space-y-3">
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
                  Capture
                </Button>
                
                <Button
                  onClick={stopCamera}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {photoPreview && (
            <div className="space-y-3">
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="DND photo preview"
                  className="w-full rounded-lg border"
                />
                <Button
                  onClick={() => {
                    URL.revokeObjectURL(photoPreview);
                    setPhotoPreview(null);
                    setSelectedPhoto(null);
                  }}
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any additional notes about the DND status..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleClose}
              variant="outline"
              className="flex-1"
              disabled={isUploading}
            >
              Cancel
            </Button>
            
            {selectedPhoto && (
              <Button
                onClick={handleSubmit}
                className="flex-1 bg-orange-600 hover:bg-orange-700"
                disabled={isUploading}
              >
                {isUploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Submit DND
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
