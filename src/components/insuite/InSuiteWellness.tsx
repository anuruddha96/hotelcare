import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { inSuiteGuest } from "@/lib/insuiteApi";
import { wellnessWords, type WellnessResource, type WellnessStayBooking } from "@/lib/wellness";
import { WellnessPicker } from "@/components/wellness/WellnessPicker";
import type { WellnessTicketData } from "@/components/wellness/WellnessTicket";

type Props = {
  lang: string;
  accent: string;
  stayActive: boolean;
  roomNumber: string;
  hotelName?: string;
  awaitingText: string;
  /** Bookings of this stay pushed by guest-state polling (any channel). */
  stayBookings: WellnessStayBooking[];
  onChanged: () => Promise<void>;
};

const REFRESH_MS = 15_000;

/**
 * The room page's jacuzzi / sauna booking. Slots refresh every 15 seconds
 * while the page is visible, and again right before a booking is shown as
 * confirmed, so guests always look at current availability.
 */
export function InSuiteWellness({ lang, accent, stayActive, roomNumber, hotelName, awaitingText, stayBookings, onChanged }: Props) {
  const w = wellnessWords(lang);
  const [resources, setResources] = useState<WellnessResource[]>([]);
  const [bookings, setBookings] = useState<WellnessStayBooking[]>(stayBookings);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!stayActive) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await inSuiteGuest("guest-wellness");
      if (!alive.current) return;
      setResources(data.resources || []);
      setBookings(data.bookings || []);
    } catch (e) {
      if (alive.current) toast.error((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [stayActive]);

  useEffect(() => {
    alive.current = true;
    void load();
    const id = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => { alive.current = false; window.clearInterval(id); };
  }, [load]);
  useEffect(() => { setBookings(stayBookings); }, [stayBookings]);

  const onBook = async ({ resource, slot, partySize }: { resource: WellnessResource; slot: { starts_at: string }; partySize: number }) => {
    const data = await inSuiteGuest("guest-wellness-book", {
      resource_id: resource.id, starts_at: slot.starts_at, party_size: partySize, client_request_id: crypto.randomUUID(),
    });
    void load(); void onChanged();
    return data.booking as WellnessTicketData;
  };
  const onCancel = async (booking: { id: string }) => {
    await inSuiteGuest("guest-wellness-cancel", { booking_id: booking.id });
    toast.success(w.cancelled);
    await load(); void onChanged();
  };

  return (
    <WellnessPicker lang={lang} accent={accent} resources={resources} bookings={bookings} loading={loading}
      canBook={stayActive} disabledReason={stayActive ? undefined : awaitingText}
      roomNumber={roomNumber} hotelName={hotelName}
      onBook={onBook} onCancel={onCancel} onRefresh={load} />
  );
}
