import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, History, Lock, RefreshCw, Tags } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAccessPolicy } from "@/hooks/useAccessPolicy";
import { useTranslation } from "@/hooks/useTranslation";
import { useTenant } from "@/contexts/TenantContext";
import { Header } from "@/components/layout/Header";
import { MainTabsBar } from "@/components/layout/MainTabsBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buildPriceList,
  formatPrice,
  priceListDates,
  shiftDate,
  todayInBudapest,
  type PriceListResponse,
} from "@/lib/revenue/priceList";

const DAYS = 14;

/**
 * Read-only price list for managers: current and archived room prices for any hotel of the
 * organization, read-only. Revenue figures (bookings, revenue, ADR, pickup,
 * goals) are not part of it — they stay on the Revenue pages of top management.
 */
export default function PriceList() {
  const { profile, loading: authLoading } = useAuth();
  const caps = useAccessPolicy();
  const { hotels } = useTenant();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t, language } = useTranslation();
  const hu = language === "hu";
  const locale = hu ? "hu-HU" : "en-GB";

  // Start on the hotel picked in the header; managers may look at any hotel.
  const headerHotelId = useMemo(() => {
    const assigned = profile?.assigned_hotel ?? null;
    const match = hotels.find((h) => h.hotel_id === assigned || h.hotel_name === assigned);
    return match?.hotel_id ?? hotels[0]?.hotel_id ?? null;
  }, [hotels, profile?.assigned_hotel]);
  const [hotelId, setHotelId] = useState<string | null>(headerHotelId);
  useEffect(() => { setHotelId(headerHotelId); }, [headerHotelId]);

  const today = todayInBudapest();
  const [start, setStart] = useState(today);
  const dates = useMemo(() => priceListDates(start, DAYS), [start]);

  const [data, setData] = useState<PriceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!hotelId || !caps.priceList) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in the generated types yet
    (supabase as any)
      .rpc("revenue_price_list", { _hotel_id: hotelId, _from: start, _days: DAYS })
      .then(({ data: result, error: rpcError }: { data: PriceListResponse | null; error: { message?: string } | null }) => {
        if (cancelled) return;
        if (rpcError) {
          setData(null);
          setError(rpcError.message || (hu ? "Az árlista nem tölthető be." : "The price list could not be loaded."));
        } else {
          setData(result);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [hotelId, start, caps.priceList, reloadKey, hu]);

  const table = useMemo(() => buildPriceList(data, language, dates), [data, language, dates]);

  if (!authLoading && profile && !caps.priceList) {
    return <Navigate to={`/${organizationSlug || profile.organization_slug || ""}`} replace />;
  }

  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const syncedAt = data?.synced_at ? new Date(data.synced_at).toLocaleString(locale) : null;
  const hotelName = hotels.find((h) => h.hotel_id === hotelId)?.hotel_name ?? hotelId ?? "";
  const guestsLabel = (n: number) => (hu ? `${n} fő` : `${n} ${n === 1 ? "guest" : "guests"}`);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-3 sm:px-4 py-4 space-y-4">
        <MainTabsBar current="price-list" />

        <Card className="overflow-hidden">
          <CardHeader className="gap-3 border-b bg-muted/20 sm:flex-row sm:items-end sm:justify-between sm:space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Tags className="h-5 w-5 text-primary" />
                {t("nav.priceList")}
              </CardTitle>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                {hu ? "Aktuális és korábbi szobaárak, csak megtekintés." : "Current and historical room prices, view only."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={hotelId ?? undefined} onValueChange={(value) => setHotelId(value)}>
                <SelectTrigger className="h-9 w-[220px]" aria-label={hu ? "Szálloda" : "Hotel"}>
                  <SelectValue placeholder={hu ? "Válasszon szállodát" : "Choose a hotel"} />
                </SelectTrigger>
                <SelectContent>
                  {hotels.map((hotel) => (
                    <SelectItem key={hotel.hotel_id} value={hotel.hotel_id}>{hotel.hotel_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setStart(shiftDate(today, -14))}
                aria-label={hu ? "Korábbi 14 nap" : "Past 14 days"}>
                <History className="h-4 w-4" />
                <span>{hu ? "Korábbi 14 nap" : "Past 14 days"}</span>
              </Button>
              <Input type="date" value={start} onChange={(event) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setStart(event.target.value);
              }} aria-label={hu ? "Kezdődátum" : "Start date"} title={hu ? "Válasszon kezdődátumot" : "Choose a start date"}
                className="h-9 w-[155px] bg-background" />
              <div className="flex items-center rounded-md border bg-background">
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setStart(shiftDate(start, -7))}
                  aria-label={hu ? "Előző hét" : "Previous week"}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2" onClick={() => setStart(today)} disabled={start === today}>
                  <CalendarDays className="h-4 w-4" />
                  {hu ? "Ma" : "Today"}
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setStart(shiftDate(start, 7))}
                  aria-label={hu ? "Következő hét" : "Next week"}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {error ? (
              <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setReloadKey((k) => k + 1)}>
                  <RefreshCw className="h-4 w-4" /> {hu ? "Újra" : "Try again"}
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th scope="col" className="sticky left-0 z-10 min-w-[180px] bg-muted/30 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                        {hotelName}
                      </th>
                      {dates.map((date) => {
                        const day = new Date(`${date}T00:00:00Z`).getUTCDay();
                        const weekend = day === 5 || day === 6;
                        const archived = date < today;
                        return (
                          <th key={date} scope="col"
                            className={cn("px-2 py-2 text-center font-normal", weekend && "bg-primary/5", date === today && "text-primary")}>
                            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{weekday.format(new Date(`${date}T00:00:00Z`))}</div>
                            <div className={cn("whitespace-nowrap font-semibold", date === today && "text-primary")}>{dayMonth.format(new Date(`${date}T00:00:00Z`))}</div>
                            {archived && <div className="text-[10px] text-muted-foreground">{hu ? "Archív" : "Archived"}</div>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={`s-${i}`} className="border-b last:border-0">
                          <th scope="row" className="sticky left-0 bg-background px-4 py-3"><Skeleton className="h-4 w-32" /></th>
                          {dates.map((date) => <td key={date} className="px-2 py-3"><Skeleton className="mx-auto h-4 w-12" /></td>)}
                        </tr>
                      ))
                      : table.rows.length === 0
                        ? (
                          <tr>
                            <td colSpan={dates.length + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                              {hu ? "Ehhez a szállodához még nincs közzétett ár." : "No prices have been published for this hotel yet."}
                            </td>
                          </tr>
                        )
                        : table.rows.map((row) => (
                          <tr key={row.key} className={cn("border-b last:border-0 hover:bg-muted/20", row.firstOfRoom && "border-t")}>
                            <th scope="row" className="sticky left-0 z-[1] bg-background px-4 py-2 text-left font-normal">
                              {row.firstOfRoom && <div className="font-medium leading-tight">{row.roomName}</div>}
                              <div className="text-xs text-muted-foreground">
                                {row.guests === null ? (hu ? "Még nincs ár" : "No prices yet") : guestsLabel(row.guests)}
                              </div>
                            </th>
                            {dates.map((date) => {
                              const day = new Date(`${date}T00:00:00Z`).getUTCDay();
                              const price = row.prices[date];
                              return (
                                <td key={date}
                                  className={cn("px-2 py-2 text-center tabular-nums", (day === 5 || day === 6) && "bg-primary/5",
                                    price === null ? "text-muted-foreground/50" : "font-medium")}>
                                  {formatPrice(price, table.currency, locale)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                {syncedAt
                  ? `${hu ? "Previóból frissítve" : "Updated from Previo"}: ${syncedAt}`
                  : hu ? "Még nincs frissítés a Previóból." : "No update from Previo yet."}
              </span>
              <span>{hu ? "A korábbi napok az elmentett árakat mutatják. Csak a felső vezetés módosíthat árakat." : "Past dates show archived prices when available. Only top management can change rates."}</span>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
