import { Building2, Loader2 } from 'lucide-react';

interface HotelSwitchOverlayProps {
  hotelName?: string | null;
}

/**
 * Full-screen blur curtain shown the moment a manager picks a different hotel.
 * It hides the previous property's numbers immediately so nothing stale is
 * ever readable while the app reloads into the new tenant scope.
 */
export function HotelSwitchOverlay({ hotelName }: HotelSwitchOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-xl animate-fade-in"
    >
      <div className="flex flex-col items-center gap-4 text-center px-6 animate-scale-in">
        <div className="relative">
          <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
          <div className="relative rounded-full bg-primary/10 p-4">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Switching to {hotelName || 'your hotel'}
          </p>
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading this property&apos;s data…
          </p>
        </div>
      </div>
    </div>
  );
}
