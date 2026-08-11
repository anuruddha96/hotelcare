import { Building2, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';

interface HotelSwitchOverlayProps {
  hotelName?: string | null;
}

/**
 * Full-screen curtain shown the moment a manager picks a different hotel.
 * Rendered through a body portal so it sits above the header and menus instead
 * of inside the dropdown's own stacking context, and painted with a solid
 * surface so nothing from the previous property stays readable.
 */
export function HotelSwitchOverlay({ hotelName }: HotelSwitchOverlayProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background animate-fade-in"
    >
      <div className="flex flex-col items-center gap-4 text-center px-6 animate-scale-in">
        <div className="relative">
          <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
          <div className="relative rounded-full bg-primary/10 p-4">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-foreground">
            Switching to {hotelName || 'your hotel'}
          </p>
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading this property&apos;s data…
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

