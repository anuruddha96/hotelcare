import { useState } from 'react';
import { X, Info, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAnnouncements, type AnnouncementTone, type AnnouncementWithState } from '@/hooks/useAnnouncements';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const TONE: Record<AnnouncementTone, { wrap: string; icon: typeof Info }> = {
  info: { wrap: 'bg-primary/10 text-foreground border-primary/30', icon: Info },
  warning: { wrap: 'bg-amber-500/10 text-foreground border-amber-500/40', icon: AlertTriangle },
  critical: { wrap: 'bg-destructive/10 text-foreground border-destructive/40', icon: ShieldAlert },
};

/**
 * Compact announcements show only a short title and a "How it works" link.
 * The explanation opens on demand instead of covering the dashboard on mobile.
 * Existing full-body announcements keep their current presentation.
 */
export function SystemAnnouncementBanner() {
  const { banner, dismiss, markSeen } = useAnnouncements();
  const [details, setDetails] = useState<AnnouncementWithState | null>(null);
  if (!banner.length) return null;

  return (
    <>
      <div className="w-full space-y-1 px-2 pt-2">
        {banner.slice(0, 2).map((a) => {
          const tone = TONE[a.tone] ?? TONE.info;
          const Icon = tone.icon;
          return (
            <div
              key={a.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${tone.wrap}`}
              role="status"
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {a.compact ? (
                  <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-0.5">
                    <p className="text-sm font-semibold">{a.title}</p>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-7 px-0 py-0 text-xs font-semibold underline underline-offset-2"
                      onClick={() => {
                        setDetails(a);
                        void markSeen(a.id);
                      }}
                    >
                      How it works
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-semibold">{a.title}</p>
                    <p className="text-sm whitespace-pre-line opacity-90">{a.body}</p>
                    <p className="text-[11px] mt-0.5 opacity-70">Hotel Care System</p>
                  </>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={`Dismiss ${a.title}`}
                onClick={() => {
                  if (details?.id === a.id) setDetails(null);
                  void dismiss(a.id);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
      <Dialog open={!!details} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md max-h-[85dvh] overflow-y-auto rounded-xl p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-6 text-left text-lg">{details?.title}</DialogTitle>
          </DialogHeader>
          {details && (
            <div className="space-y-3 text-sm leading-relaxed">
              {details.body.split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => (
                <p key={i} className="whitespace-pre-line text-foreground/90">{paragraph}</p>
              ))}
              <Button type="button" className="w-full sm:w-auto" onClick={() => setDetails(null)}>
                Got it
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SystemAnnouncementBanner;
