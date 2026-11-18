import { OperationsNavigation } from '@/components/layout/OperationsNavigation';

/**
 * Kept for existing pages (Reservations, Guests, Rates, Channel Manager…).
 * Renders the single shared module navigation so every page shows the same
 * tabs, names and order.
 */
export function PMSNavigation() {
  return (
    <div className="sticky z-40 w-full border-b border-sky-100 bg-background/95 backdrop-blur-md dark:border-sky-900" style={{ top: "var(--hc-header-height, 0px)" }}>
      <div className="container mx-auto px-3 sm:px-4 py-1.5">
        <OperationsNavigation />
      </div>
    </div>
  );
}
