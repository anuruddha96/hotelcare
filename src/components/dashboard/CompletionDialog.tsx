import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Camera, Upload, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';
import { ImageCaptureDialog } from './ImageCaptureDialog';
import { DirtyLinenDialog } from './DirtyLinenDialog';

interface CompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  roomNumber: string;
  roomId: string;
  onTaskCompleted?: () => void;
}

export function CompletionDialog({
  open,
  onOpenChange,
  assignmentId,
  roomNumber,
  roomId,
  onTaskCompleted
}: CompletionDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);
  const [showImageCapture, setShowImageCapture] = useState(false);
  const [showDirtyLinen, setShowDirtyLinen] = useState(false);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [completionStep, setCompletionStep] = useState(1); // 1: Basic completion, 2: Photos, 3: Dirty linen

  const handleBasicCompletion = async () => {
    if (!user?.id) return;

    setIsCompleting(true);
    try {
      const { error } = await supabase
        .from('room_assignments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          notes: notes || null
        })
        .eq('id', assignmentId);

      if (error) throw error;

      toast.success(`Room ${roomNumber} marked as completed`);
      setCompletionStep(2); // Move to photo capture step
      
    } catch (error) {
      console.error('Error completing assignment:', error);
      toast.error('Failed to complete assignment');
      setIsCompleting(false);
    }
  };

  const handlePhotoCaptured = (photoUrls: string[]) => {
    setCapturedPhotos(photoUrls);
    setShowImageCapture(false);
    toast.success('Photos saved successfully');
  };

  const handleSkipPhotos = () => {
    setCompletionStep(3); // Move to dirty linen step
  };

  const handleComplete = () => {
    onTaskCompleted?.();
    onOpenChange(false);
    setCompletionStep(1);
    setNotes('');
    setCapturedPhotos([]);
    setIsCompleting(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    setCompletionStep(1);
    setNotes('');
    setCapturedPhotos([]);
    setIsCompleting(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Complete Room {roomNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Step Indicator */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                completionStep >= 1 ? 'bg-green-500 text-white' : 'bg-gray-200'
              }`}>
                1
              </div>
              <div className={`w-4 h-1 ${completionStep >= 2 ? 'bg-green-500' : 'bg-gray-200'}`} />
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                completionStep >= 2 ? 'bg-green-500 text-white' : 'bg-gray-200'
              }`}>
                2
              </div>
              <div className={`w-4 h-1 ${completionStep >= 3 ? 'bg-green-500' : 'bg-gray-200'}`} />
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                completionStep >= 3 ? 'bg-green-500 text-white' : 'bg-gray-200'
              }`}>
                3
              </div>
            </div>

            {completionStep === 1 && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    <CheckCircle className="h-4 w-4 inline mr-1" />
                    Mark this room as completed to proceed with optional photo capture and dirty linen tracking.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="completion-notes">Notes (Optional)</Label>
                  <Textarea
                    id="completion-notes"
                    placeholder="Add any notes about the room cleaning..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    className="flex-1"
                    disabled={isCompleting}
                  >
                    Cancel
                  </Button>
                  
                  <Button
                    onClick={handleBasicCompletion}
                    className="flex-1"
                    disabled={isCompleting}
                  >
                    {isCompleting ? (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Completing...
                      </div>
                    ) : (
                      'Complete Task'
                    )}
                  </Button>
                </div>
              </div>
            )}

            {completionStep === 2 && (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm text-green-800">
                    <CheckCircle className="h-4 w-4 inline mr-1" />
                    Task completed! Now you can optionally add photos as proof of work.
                  </p>
                </div>

                {capturedPhotos.length > 0 && (
                  <div className="space-y-2">
                    <Label>Captured Photos</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {capturedPhotos.slice(0, 4).map((photoUrl, index) => (
                        <img
                          key={index}
                          src={photoUrl}
                          alt={`Photo ${index + 1}`}
                          className="w-full h-20 object-cover rounded border"
                        />
                      ))}
                    </div>
                    {capturedPhotos.length > 4 && (
                      <p className="text-sm text-muted-foreground">
                        +{capturedPhotos.length - 4} more photos
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowImageCapture(true)}
                    variant="outline"
                    className="flex-1"
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    Add Photos
                  </Button>
                  
                  <Button
                    onClick={handleSkipPhotos}
                    className="flex-1"
                  >
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {completionStep === 3 && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    <AlertTriangle className="h-4 w-4 inline mr-1" />
                    Finally, track any dirty linen collected from this room.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowDirtyLinen(true)}
                    variant="outline"
                    className="flex-1"
                  >
                    Track Dirty Linen
                  </Button>
                  
                  <Button
                    onClick={handleComplete}
                    className="flex-1"
                  >
                    Finish
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ImageCaptureDialog
        open={showImageCapture}
        onOpenChange={setShowImageCapture}
        roomNumber={roomNumber}
        assignmentId={assignmentId}
        onPhotoCaptured={handlePhotoCaptured}
      />

      <DirtyLinenDialog
        open={showDirtyLinen}
        onOpenChange={setShowDirtyLinen}
        roomId={roomId}
        roomNumber={roomNumber}
        assignmentId={assignmentId}
      />
    </>
  );
}