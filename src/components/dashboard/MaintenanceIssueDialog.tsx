import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Camera, Upload, X, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MaintenanceIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: string;
  roomId: string | null;
  assignmentId?: string;
  onIssueReported?: () => void;
}

export function MaintenanceIssueDialog({
  open,
  onOpenChange,
  roomNumber,
  roomId: initialRoomId,
  assignmentId,
  onIssueReported
}: MaintenanceIssueDialogProps) {
  const { user, profile } = useAuth();
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [photos, setPhotos] = useState<{ dataUrl: string; blob: Blob }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [rooms, setRooms] = useState<Array<{ id: string; room_number: string; hotel: string }>>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch rooms for general maintenance issues
  useEffect(() => {
    if (open) {
      if (!initialRoomId) {
        fetchRooms();
      } else {
        setSelectedRoomId(initialRoomId);
      }
    }
  }, [open, initialRoomId]);

  const fetchRooms = async () => {
    try {
      let query = supabase
        .from('rooms')
        .select('id, room_number, hotel');

      // Filter by hotel if user has assigned hotel
      if (profile?.assigned_hotel) {
        query = query.or(`hotel.eq.${profile.assigned_hotel},hotel.ilike.%${profile.assigned_hotel}%`);
      }

      const { data, error } = await query.order('room_number');

      if (error) throw error;
      console.log('Fetched rooms for hotel:', profile?.assigned_hotel, '- Count:', data?.length || 0);
      setRooms(data || []);
      
      if (!data || data.length === 0) {
        console.warn('No rooms found - this might be a hotel mismatch issue');
        toast.error('No rooms found for this hotel');
      }
    } catch (error) {
      console.error('Error fetching rooms:', error);
      toast.error('Failed to load rooms');
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
      toast.error('Could not access camera');
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
        setPhotos(prev => [...prev, { dataUrl: photoUrl, blob }]);
        toast.success('Photo captured');
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
        setPhotos(prev => [...prev, { dataUrl: photoUrl, blob: file }]);
      }
    });

    if (files.length > 0) {
      toast.success(`${files.length} photo(s) added`);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!user || !description.trim()) {
      toast.error('Please enter a description');
      return;
    }

    // For general maintenance, require room selection
    if (!initialRoomId && !selectedRoomId) {
      toast.error('Please select a room');
      return;
    }

    setIsUploading(true);
    const uploadedUrls: string[] = [];

    try {
      const roomToUse = initialRoomId || selectedRoomId;
      const selectedRoom = rooms.find(r => r.id === roomToUse);
      const roomNum = initialRoomId ? roomNumber : selectedRoom?.room_number || 'unknown';

      // Upload photos if any
      for (const photo of photos) {
        const fileName = `${user.id}/${roomNum}/maintenance_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        
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

      // Create maintenance issue with pending status (for supervisor approval)
      const { error: insertError } = await supabase
        .from('maintenance_issues')
        .insert({
          room_id: roomToUse,
          assignment_id: assignmentId || null,
          reported_by: user.id,
          issue_description: description,
          photo_urls: uploadedUrls,
          status: 'pending',
          priority: priority
        });

      if (insertError) throw insertError;

      toast.success('Maintenance issue reported successfully');
      
      if (onIssueReported) {
        onIssueReported();
      }
      
      handleClose();
    } catch (error: any) {
      console.error('Error reporting issue:', error);
      toast.error('Failed to report issue: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    stopCamera();
    setDescription('');
    setPriority('medium');
    setPhotos([]);
    setSelectedRoomId(initialRoomId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Report Maintenance Issue {initialRoomId ? `- Room ${roomNumber}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!initialRoomId && (
            <div className="space-y-2">
              <Label htmlFor="room">Select Room *</Label>
              <Select value={selectedRoomId || ''} onValueChange={setSelectedRoomId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a room" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      Room {room.room_number} - {room.hotel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Issue Description *</Label>
            <Textarea
              id="description"
              placeholder="Describe the maintenance issue..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select value={priority} onValueChange={(value: any) => setPriority(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
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

          {photos.length > 0 && (
            <div className="space-y-2">
              <Label>Photos ({photos.length})</Label>
              <div className="grid grid-cols-2 gap-3">
                {photos.map((photo, index) => (
                  <Card key={index} className="relative overflow-hidden">
                    <img
                      src={photo.dataUrl}
                      alt={`Photo ${index + 1}`}
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
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleClose}
              variant="outline"
              className="flex-1"
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isUploading || !description.trim()}
              className="flex-1"
            >
              {isUploading ? (
                <>Reporting...</>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Report Issue
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}