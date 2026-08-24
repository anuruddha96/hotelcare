import { X, Info, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAnnouncements, type AnnouncementTone } from '@/hooks/useAnnouncements';
import { Button } from '@/components/ui/button';

const TONE: Record<AnnouncementTone, { wrap: string; icon: typeof Info }> = {
  info: { wrap: 'bg-primary/10 text-foreground border-primary/30', icon: Info },
  warning: { wrap: 'bg-amber-500/10 text-foreground border-amber-500/40', icon: AlertTriangle },
  critical: { wrap: 'bg-destructive/10 text-foreground border-destructive/40', icon: ShieldAlert },
};

/**
 * Admin-published announcements, shown once per user until dismissed. The
 * message stays available afterwards in the notification panel.
 */
export function SystemAnnouncementBanner() {
  const { banner, dismiss } = useAnnouncements();
  if (!banner.length) return null;

  return (
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
            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{a.title}</p>
              <p className="text-sm whitespace-pre-line opacity-90">{a.body}</p>
              <p className="text-[11px] mt-0.5 opacity-70">Hotel Care System</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Dismiss announcement"
              onClick={() => void dismiss(a.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export default SystemAnnouncementBanner;
