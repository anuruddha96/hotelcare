import { OperationsNavigation } from '@/components/layout/OperationsNavigation';

/**
 * Kept for existing pages (Reservations, Guests, Rates, Channel Manager…).
 * Renders the single shared module navigation so every page shows the same
 * tabs, names and order.
 */
export function PMSNavigation() {
  return (
    <div className="w-full bg-card border-b border-border">
      <div className="container mx-auto px-3 sm:px-4 py-1.5">
        <OperationsNavigation />
      </div>
    </div>
  );
}
