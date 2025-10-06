import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { CheckCircle, Camera, Shirt, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface CompletionChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  roomNumber: string;
}

export function CompletionChecklistDialog({
  open,
  onOpenChange,
  onConfirm,
  roomNumber
}: CompletionChecklistDialogProps) {
  const { t } = useTranslation();
  const [checklist, setChecklist] = useState({
    photos: false,
    dirtyLinen: false,
    minibar: false,
  });

  const allChecked = Object.values(checklist).every(v => v === true);

  const handleCheckChange = (key: keyof typeof checklist, checked: boolean) => {
    setChecklist(prev => ({ ...prev, [key]: checked }));
  };

  const handleConfirm = () => {
    onConfirm();
    // Reset checklist
    setChecklist({
      photos: false,
      dirtyLinen: false,
      minibar: false,
    });
    onOpenChange(false);
  };

  const handleCancel = () => {
    setChecklist({
      photos: false,
      dirtyLinen: false,
      minibar: false,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-blue-600" />
            Complete Room {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Before marking this room as complete, please confirm you have captured all required data:
              </p>
            </div>
          </div>

          <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Checkbox
                id="photos"
                checked={checklist.photos}
                onCheckedChange={(checked) => handleCheckChange('photos', checked as boolean)}
              />
              <Label
                htmlFor="photos"
                className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                <Camera className="h-4 w-4 text-blue-600" />
                Room photos captured (Bed, Bathroom, Desk, Trash Bin)
              </Label>
            </div>

            <div className="flex items-center space-x-3">
              <Checkbox
                id="dirtyLinen"
                checked={checklist.dirtyLinen}
                onCheckedChange={(checked) => handleCheckChange('dirtyLinen', checked as boolean)}
              />
              <Label
                htmlFor="dirtyLinen"
                className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                <Shirt className="h-4 w-4 text-purple-600" />
                Dirty linen count updated (if applicable)
              </Label>
            </div>

            <div className="flex items-center space-x-3">
              <Checkbox
                id="minibar"
                checked={checklist.minibar}
                onCheckedChange={(checked) => handleCheckChange('minibar', checked as boolean)}
              />
              <Label
                htmlFor="minibar"
                className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                <span className="text-base">🍷</span>
                Minibar consumption recorded (if applicable)
              </Label>
            </div>
          </div>

          {!allChecked && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs text-red-700">
                ⚠️ Please confirm all items above to proceed with completion. You can still access these features after completing if needed.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!allChecked}
            className={allChecked ? '' : 'opacity-50'}
          >
            {allChecked ? 'Mark as Complete' : 'Please Confirm All Items'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
