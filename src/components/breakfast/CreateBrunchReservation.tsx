import { useEffect, useState } from "react";
import { Plus, Loader2, CalendarClock, UserRound, Phone, Mail, Users, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { breakfastAuthUrl } from "@/lib/breakfastAuth";
import { bbT } from "@/lib/breakfast-translations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface Props {
  hotelId: string;
  date: string;
  language: string;
  onCreated: (id: string, date: string) => void;
}
const SOURCES = ["phone", "walk_in", "hotel_guest", "other"] as const;
type Source = typeof SOURCES[number];

export default function CreateBrunchReservation({ hotelId, date, language, onCreated }: Props) {
  const tt = (k: string) => bbT(language, k);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [arrivalDate, setArrivalDate] = useState(date);
  const [arrivalTime, setArrivalTime] = useState("09:00");
  const [guests, setGuests] = useState(2);
  const [mode, setMode] = useState<Source>("phone");
  const [notes, setNotes] = useState("");

  useEffect(() => { if (!open) setArrivalDate(date); }, [date, open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setChecking(true);
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.user));
    }).catch(() => { if (active) setSignedIn(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn || saving) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("restaurant-reservation-create", {
      body: {
        hotel_id: hotelId, guest_name: name.trim(), guest_email: email.trim(),
        guest_phone: phone.trim(), date: arrivalDate, time: arrivalTime,
        party_size: guests, booking_mode: mode, notes: notes.trim(),
      },
    });
    setSaving(false);
    if (error || data?.error || !data?.reservation?.id) {
      toast.error(data?.error || error?.message || tt("resCreateFailed"));
      return;
    }
    // Staff who created the booking has already seen it; keep the global
    // unread indicator meaningful to colleagues on other devices.
    await supabase.functions.invoke("restaurant-reservation-seen", {
      body: { reservation_id: data.reservation.id },
    }).catch(() => undefined);
    toast.success(tt("resCreated"));
    setOpen(false);
    setName(""); setEmail(""); setPhone(""); setNotes(""); setGuests(2); setMode("phone");
    onCreated(data.reservation.id, arrivalDate);
  }

  const sourceLabels: Record<Source, string> = {
    phone: tt("resModePhone"), walk_in: tt("resModeWalkIn"),
    hotel_guest: tt("resModeHotelGuest"), other: tt("resModeOther"),
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5">
          <Plus className="h-4 w-4" /> {tt("resAdd")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" />{tt("resAdd")}</DialogTitle>
          <DialogDescription>{tt("resAddHint")}</DialogDescription>
        </DialogHeader>
        {checking ? (
          <div className="py-10 flex justify-center"><Loader2 className="animate-spin" /></div>
        ) : !signedIn ? (
          <div className="space-y-3 py-3">
            <p className="text-sm text-muted-foreground">{tt("resStaffLogin")}</p>
            <Button className="w-full" onClick={() => window.location.assign(breakfastAuthUrl(window.location.pathname + window.location.search))}>{tt("staffSignIn")}</Button>
          </div>
        ) : (
          <form onSubmit={e => void submit(e)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bb-res-name"><UserRound className="inline h-3.5 w-3.5 mr-1" />{tt("resGuestName")} *</Label>
              <Input id="bb-res-name" required maxLength={120} minLength={2} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={tt("resGuestName")} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="bb-res-date">{tt("date")} *</Label>
                <Input id="bb-res-date" type="date" required value={arrivalDate} onChange={e => setArrivalDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bb-res-time">{tt("resArrivalTime")} *</Label>
                <Input id="bb-res-time" type="time" required value={arrivalTime} onChange={e => setArrivalTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="bb-res-guests"><Users className="inline h-3.5 w-3.5 mr-1" />{tt("resGuests")} *</Label>
                <Input id="bb-res-guests" type="number" min={1} max={30} required value={guests} onChange={e => setGuests(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bb-res-mode">{tt("resBookingMode")} *</Label>
                <select id="bb-res-mode" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={mode} onChange={e => setMode(e.target.value as Source)}>
                  {SOURCES.map(key => <option key={key} value={key}>{sourceLabels[key]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="bb-res-phone"><Phone className="inline h-3.5 w-3.5 mr-1" />{tt("resPhoneOptional")}</Label>
                <Input id="bb-res-phone" type="tel" maxLength={32} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+36..." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bb-res-email"><Mail className="inline h-3.5 w-3.5 mr-1" />{tt("resEmailOptional")}</Label>
                <Input id="bb-res-email" type="email" maxLength={250} value={email} onChange={e => setEmail(e.target.value)} placeholder="@" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bb-res-notes"><NotebookPen className="inline h-3.5 w-3.5 mr-1" />{tt("resNotesOptional")}</Label>
              <Textarea id="bb-res-notes" rows={2} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder={tt("resNotesHint")} />
            </div>
            <Button className="w-full h-11" type="submit" disabled={saving || !name.trim() || !arrivalDate || !arrivalTime || guests < 1}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? tt("resSaving") : tt("resSaveBooking")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
