import { Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAnnouncements } from '@/hooks/useAnnouncements';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Announcement history — a dismissed message can always be re-read here. */
export function AnnouncementsBell() {
  const { announcements, unreadCount, markSeen } = useAnnouncements();
  if (!announcements.length) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative shrink-0" aria-label="Announcements">
          <Megaphone className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] leading-none">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-semibold">Announcements</p>
          <p className="text-[11px] text-muted-foreground">From Hotel Care System</p>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y">
          {announcements.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => void markSeen(a.id)}
              className="w-full text-left px-3 py-2 hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                {!a.seen && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                <span className="text-sm font-medium truncate">{a.title}</span>
              </div>
              <p className="text-xs text-muted-foreground whitespace-pre-line mt-0.5">{a.body}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{fmt(a.created_at)}</p>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default AnnouncementsBell;
