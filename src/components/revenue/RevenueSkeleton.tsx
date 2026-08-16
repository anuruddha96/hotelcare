import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a property's revenue payload is still on its way.
 *
 * It mirrors the real layout — month header, KPI strip, calendar rows, chart —
 * so the first screen after login reads as "loading" instead of "empty".
 */
export function RevenueSkeleton() {
  return (
    <div className="space-y-3 animate-fade-in" aria-busy="true" aria-live="polite">
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-40 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
          <Skeleton className="h-4 w-56" />
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-[76%] shrink-0 rounded-lg sm:w-auto sm:flex-1" />
            ))}
          </div>
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-[124px] shrink-0 rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <Skeleton className="h-4 w-44" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-[180px] w-full rounded-lg" />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Loading this property's prices, pickup and occupancy…
      </p>
    </div>
  );
}

export default RevenueSkeleton;
