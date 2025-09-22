import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Camera, Upload, X, Check } from 'lucide-react';
import { toast } from 'sonner';

interface DNDPhotoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  roomId: string;
  assignmentId: string;
  onPhotoUploaded: (photoUrl: string) => void;
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
  const { toast: showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment', // Use rear camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      showToast({
        title: "Camera Error",
        description: "Unable to access camera. Please use file upload instead.",
        variant: "destructive"
      });
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const context = canvas.getContext('2d');
    
    if (!context) return;
    
    // Set canvas dimensions to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to blob and create file
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `dnd-photo-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        setSelectedFile(file);
        setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.8));
        stopCamera();
      }
    }, 'image/jpeg', 0.8);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setCapturedPhoto(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      stopCamera();
    }
  };

  const uploadPhoto = async () => {
    if (!selectedFile || !user) return null;

    const fileName = `${roomId}/${assignmentId}/${Date.now()}-${selectedFile.name}`;
    
    const { data, error } = await supabase.storage
      .from('dnd-photos')
      .upload(fileName, selectedFile, {
        contentType: selectedFile.type,
      });

    if (error) {
      throw error;
    }

    return data.path;
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      showToast({
        title: "Photo Required",
        description: "Please take a photo of the DND notice before proceeding.",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      // Upload photo to storage
      const photoPath = await uploadPhoto();
      if (!photoPath) throw new Error('Failed to upload photo');

      // Save DND photo record to database
      const { error: dbError } = await supabase
        .from('dnd_photos')
        .insert({
          room_id: roomId,
          assignment_id: assignmentId,
          photo_url: photoPath,
          marked_by: user?.id,
          marked_at: new Date().toISOString(),
          assignment_date: new Date().toISOString().split('T')[0],
          notes: notes.trim() || null
        });

      if (dbError) throw dbError;

      // Get the photo URL for display
      const { data: urlData } = supabase.storage
        .from('dnd-photos')
        .getPublicUrl(photoPath);

      onPhotoUploaded(urlData.publicUrl);
      
      toast.success(`Room ${roomNumber} marked as DND with photo evidence`);
      onOpenChange(false);
    } catch (error) {
      console.error('Error submitting DND photo:', error);
      showToast({
        title: "Error",
        description: "Failed to submit DND photo. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const resetPhoto = () => {
    setCapturedPhoto(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) {
        stopCamera();
        resetPhoto();
        setNotes('');
      }
      onOpenChange(open);
    }}>
      <DialogContent className="w-[95vw] max-w-md max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-4">
          <DialogTitle className="text-lg font-bold text-center">
            📷 DND Photo Evidence
          </DialogTitle>
          <p className="text-sm text-muted-foreground text-center">
            Take a photo of the DND notice for Room {roomNumber}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Photo Capture Section */}
          {!capturedPhoto && (
            <Card>
              <CardContent className="p-4 space-y-3">
                {/* Camera View */}
                {cameraActive && (
                  <div className="relative">
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      className="w-full rounded-lg"
                    />
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
                      <Button
                        size="lg"
                        onClick={capturePhoto}
                        className="bg-white text-black hover:bg-gray-100 rounded-full w-16 h-16 p-0"
                      >
                        <Camera className="h-6 w-6" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Camera Controls */}
                {!cameraActive && (
                  <div className="space-y-3">
                    <Button
                      onClick={startCamera}
                      className="w-full"
                      size="lg"
                    >
                      <Camera className="h-5 w-5 mr-2" />
                      Start Camera
                    </Button>
                    
                    <div className="relative">
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full"
                        size="lg"
                      >
                        <Upload className="h-5 w-5 mr-2" />
                        Upload Photo
                      </Button>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Photo Preview */}
          {capturedPhoto && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="relative">
                  <img 
                    src={capturedPhoto} 
                    alt="DND Photo" 
                    className="w-full rounded-lg"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetPhoto}
                    className="absolute top-2 right-2 bg-white/90 hover:bg-white"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  <span>Photo captured successfully</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes Section */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <label className="text-sm font-medium">
                Additional Notes (Optional)
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional notes about the DND situation..."
                className="min-h-[80px]"
              />
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="flex-shrink-0 flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !selectedFile}
            className="flex-1 bg-orange-600 hover:bg-orange-700"
          >
            {loading ? 'Submitting...' : 'Submit DND'}
          </Button>
        </div>

        {/* Hidden canvas for photo capture */}
        <canvas ref={canvasRef} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}