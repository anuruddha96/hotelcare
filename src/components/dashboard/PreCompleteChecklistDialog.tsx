import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Shirt, BedDouble, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface PreCompleteChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onOpenDirtyLinen: () => void;
  onOpenMinibar: () => void;
  loading?: boolean;
}

export function PreCompleteChecklistDialog({
  open,
  onOpenChange,
  onConfirm,
  onOpenDirtyLinen,
  onOpenMinibar,
  loading = false,
}: PreCompleteChecklistDialogProps) {
  const { t } = useTranslation();
  const [linenChecked, setLinenChecked] = useState(false);
  const [minibarChecked, setMinibarChecked] = useState(false);

  useEffect(() => {
    if (open) {
      setLinenChecked(false);
      setMinibarChecked(false);
    }
  }, [open]);

  const canConfirm = linenChecked && minibarChecked && !loading;

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 p-3 rounded-full bg-primary/10">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">
            {t('preComplete.title')}
          </DialogTitle>
          <DialogDescription className="text-center">
            {t('preComplete.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <label
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 cursor-pointer hover:bg-accent/30 transition-colors"
          >
            <Checkbox
              checked={linenChecked}
              onCheckedChange={(v) => setLinenChecked(v === true)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Shirt className="h-4 w-4 text-amber-600" />
                {t('preComplete.linenLabel')}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('preComplete.linenHelp')}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenDirtyLinen();
                }}
                className="text-xs text-primary underline mt-1.5"
              >
                {t('preComplete.openLinen')}
              </button>
            </div>
          </label>

          <label
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 cursor-pointer hover:bg-accent/30 transition-colors"
          >
            <Checkbox
              checked={minibarChecked}
              onCheckedChange={(v) => setMinibarChecked(v === true)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <BedDouble className="h-4 w-4 text-purple-600" />
                {t('preComplete.minibarLabel')}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('preComplete.minibarHelp')}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenMinibar();
                }}
                className="text-xs text-primary underline mt-1.5"
              >
                {t('preComplete.openMinibar')}
              </button>
            </div>
          </label>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="flex-1 min-h-11"
          >
            {t('preComplete.notYet')}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="flex-1 min-h-11 bg-green-600 hover:bg-green-700 text-white"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {t('preComplete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
