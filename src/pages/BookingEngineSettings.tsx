// Website booking engine settings for one hotel: switch on/off, private test
// link, embed code for the hotel's web team, look & branding, languages, guest
// e-mails, what guests see for each room type, which rates are sold online with
// which cancellation terms, policies and recent website bookings.
// Top management only (admin, top management, super admin): other managers do
// not see the page, the embed code or the test link.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Globe, ImagePlus, Loader2, Lock, MailCheck, RefreshCw, Save, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { EngineBrandingCard } from '@/components/booking/settings/EngineBrandingCard';
import { EngineTestLinkCard } from '@/components/booking/settings/EngineTestLinkCard';
import { AMENITY_KEYS, BOOKING_LANGS, LANG_NAMES, bookingT, type BookingLang } from '@/lib/bookingEngine/i18n';
import { isTopManagement } from '@/lib/bookingEngine/access';
import { toHex, type EngineTheme } from '@/lib/bookingEngine/logic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const ORIGIN = 'https://my.hotelcare.app';

type LangText = Partial<Record<BookingLang, string>>;
interface EngineRow {
  id: string; public_id: string; hotel_id: string; enabled: boolean; display_name: string | null; logo_url: string | null;
  theme: EngineTheme; languages: BookingLang[]; default_language: BookingLang; preview_token: string; reminder_days: number;
  contact: { email?: string; phone?: string; address?: string; website?: string }; notification_emails: string[];
  policies: { check_in_from?: string; check_out_until?: string; free_cancellation_days?: number; terms_url?: string; privacy_url?: string; city_tax_note?: LangText; extra_note?: LangText };
  booking_window: { min_lead_days?: number; max_advance_days?: number; max_nights?: number; max_rooms?: number; same_day_cutoff?: string };
  rate_plans: Record<string, { enabled?: boolean; refundable?: boolean; free_cancellation_days?: number }>;
}
interface RoomTypeRow { id: string; name: string; num_rooms: number; is_sellable: boolean | null; counts_toward_inventory: boolean | null; sort_order: number | null }
interface ProfileRow {
  room_type_id: string; max_adults: number; max_children: number; max_occupancy: number; size_sqm: number | null;
  bed_setup: LangText; description: LangText; amenities: string[]; photos: Array<{ url: string; path?: string }>;
}
interface RatePlanRow { id: string; name: string; room_type_id: string | null; meal_plan: string | null; base_rate: number | null; currency: string | null; is_active: boolean | null; sort_order: number | null }
interface WebBooking { id: string; reference: string; guest_name: string; check_in_date: string; check_out_date: string; total_amount: number; currency: string; status: string; created_at: string; rooms: Array<{ reservation_id: string }> }

const emptyProfile = (roomTypeId: string): ProfileRow => ({
  room_type_id: roomTypeId, max_adults: 2, max_children: 0, max_occupancy: 2, size_sqm: null,
  bed_setup: {}, description: {}, amenities: ['wifi'], photos: [],
});

function CopyField({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        {multiline
          ? <Textarea readOnly value={value} className="font-mono text-xs h-28" onFocus={(e) => e.currentTarget.select()} />
          : <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />}
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={`Copy ${label}`}>{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</Button>
      </div>
    </div>
  );
}

function LangFields({ langs, value, onChange, multiline = false, placeholder }: { langs: BookingLang[]; value: LangText; onChange: (v: LangText) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {langs.map((l) => (
        <label key={l} className="block space-y-1">
          <span className="text-[11px] font-medium uppercase text-muted-foreground">{LANG_NAMES[l]}</span>
          {multiline
            ? <Textarea value={value[l] ?? ''} rows={3} placeholder={placeholder} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
            : <Input value={value[l] ?? ''} placeholder={placeholder} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />}
        </label>
      ))}
    </div>
  );
}

/** Drop empty theme values so the guest page falls back to its defaults. */
function cleanTheme(theme: EngineTheme | undefined): EngineTheme {
  const t = theme ?? {};
  const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
  const tagline = Object.fromEntries(Object.entries(t.tagline ?? {}).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 120)]).filter(([, v]) => v));
  return {
    primary: hex(t.primary) ?? '#8a6a3d',
    ...(hex(t.accent) ? { accent: hex(t.accent) } : {}),
    style: t.style === 'modern' ? 'modern' : 'classic',
    ...(t.hero_url ? { hero_url: t.hero_url } : {}),
    ...(Object.keys(tagline).length ? { tagline } : {}),
  };
}

const BookingEngineSettings = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { hotelId, ready, isPortfolio, role } = useOperationalHotel();
  const [native, setNative] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<EngineRow | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [ratePlans, setRatePlans] = useState<RatePlanRow[]>([]);
  const [bookings, setBookings] = useState<WebBooking[]>([]);
  const [brand, setBrand] = useState<{ name: string; logo: string | null; color: string | null }>({ name: '', logo: null, color: null });
  const [loadingData, setLoadingData] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [snippetLang, setSnippetLang] = useState<BookingLang>('en');
  const canManage = isTopManagement(role, profile?.is_super_admin);

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoadingData(true);
    const [nativeRes, engineRes, typesRes, profilesRes, plansRes, brandRes, bookingsRes] = await Promise.all([
      db.rpc('pms_ari_native_hotel', { _hotel_id: hotelId }),
      db.from('booking_engines').select('*').eq('hotel_id', hotelId).maybeSingle(),
      db.from('room_types').select('id, name, num_rooms, is_sellable, counts_toward_inventory, sort_order').eq('hotel_id', hotelId).order('sort_order'),
      db.from('room_type_profiles').select('*').eq('hotel_id', hotelId),
      db.from('rate_plans').select('id, name, room_type_id, meal_plan, base_rate, currency, is_active, sort_order').eq('hotel_id', hotelId).order('sort_order'),
      db.from('hotel_configurations').select('hotel_name, custom_logo_url, custom_primary_color').eq('hotel_id', hotelId).maybeSingle(),
      db.from('booking_engine_bookings').select('id, reference, guest_name, check_in_date, check_out_date, total_amount, currency, status, created_at, rooms').eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(10),
    ]);
    setNative(Boolean(nativeRes.data));
    setEngine(engineRes.data ?? null);
    setRoomTypes((typesRes.data ?? []).filter((r: RoomTypeRow) => r.is_sellable !== false && r.counts_toward_inventory !== false));
    const byType: Record<string, ProfileRow> = {};
    for (const p of profilesRes.data ?? []) byType[p.room_type_id] = p;
    setProfiles(byType);
    setRatePlans((plansRes.data ?? []).filter((p: RatePlanRow) => p.is_active !== false));
    setBrand({ name: brandRes.data?.hotel_name ?? hotelId, logo: brandRes.data?.custom_logo_url ?? null, color: brandRes.data?.custom_primary_color ?? null });
    setBookings(bookingsRes.data ?? []);
    if (engineRes.data?.default_language) setSnippetLang(engineRes.data.default_language);
    setDirty(false);
    setLoadingData(false);
  }, [hotelId]);

  useEffect(() => { if (ready && hotelId && canManage) void load(); }, [ready, hotelId, canManage, load]);

  const update = (patch: Partial<EngineRow>) => { setEngine((e) => (e ? { ...e, ...patch } : e)); setDirty(true); };
  const updateProfile = (roomTypeId: string, patch: Partial<ProfileRow>) => {
    setProfiles((current) => ({ ...current, [roomTypeId]: { ...(current[roomTypeId] ?? emptyProfile(roomTypeId)), ...patch } }));
    setDirty(true);
  };

  const create = async () => {
    if (!hotelId) return;
    const { data, error } = await db.from('booking_engines').insert({
      hotel_id: hotelId, organization_slug: organizationSlug, display_name: brand.name, logo_url: brand.logo,
      theme: { primary: toHex(brand.color) ?? '#8a6a3d', style: 'classic' },
    }).select('*').single();
    if (error) { toast.error(error.message); return; }
    setEngine(data);
    toast.success('Booking engine created. It stays off until you switch it on.');
  };

  const save = async (next?: Partial<EngineRow>) => {
    if (!engine) return;
    const row = { ...engine, ...next };
    if (!row.languages.length) { toast.error('Choose at least one language.'); return; }
    const languages = BOOKING_LANGS.filter((l) => row.languages.includes(l));
    const defaultLanguage = languages.includes(row.default_language) ? row.default_language : languages[0];
    setSaving(true);
    const { error } = await db.from('booking_engines').update({
      enabled: row.enabled, display_name: row.display_name, logo_url: row.logo_url, theme: cleanTheme(row.theme),
      languages, default_language: defaultLanguage, contact: row.contact,
      reminder_days: Math.min(14, Math.max(0, Math.round(Number(row.reminder_days ?? 3)))),
      notification_emails: row.notification_emails, policies: row.policies, booking_window: row.booking_window, rate_plans: row.rate_plans,
    }).eq('id', row.id);
    let profileError: string | null = null;
    if (!error && !next) {
      const rows = roomTypes.map((rt) => {
        const p = profiles[rt.id] ?? emptyProfile(rt.id);
        return {
          room_type_id: rt.id, hotel_id: hotelId, max_adults: p.max_adults, max_children: p.max_children,
          max_occupancy: Math.max(p.max_occupancy, 1), size_sqm: p.size_sqm || null, bed_setup: p.bed_setup,
          description: p.description, amenities: p.amenities, photos: p.photos,
        };
      });
      if (rows.length) {
        const res = await db.from('room_type_profiles').upsert(rows, { onConflict: 'room_type_id' });
        profileError = res.error?.message ?? null;
      }
    }
    setSaving(false);
    if (error || profileError) { toast.error(error?.message ?? profileError ?? 'Could not save'); return; }
    setEngine({ ...row, languages, default_language: defaultLanguage });
    if (!next) setDirty(false);
    toast.success(next?.enabled === true ? 'Online booking is live.' : next?.enabled === false ? 'Online booking is switched off.' : 'Booking engine saved.');
  };

  const toggleEnabled = (enabled: boolean) => {
    if (dirty) { toast.error('Save your other changes first.'); return; }
    if (enabled && !window.confirm('Switch online booking on? Guests can then book this hotel from the website, and every booking updates availability in Channex.')) return;
    void save({ enabled });
  };

  const uploadPhotos = async (roomTypeId: string, files: FileList | null) => {
    if (!files?.length || !hotelId) return;
    setUploading(roomTypeId);
    const added: Array<{ url: string; path: string }> = [];
    for (const file of Array.from(files).slice(0, 10)) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast.error(`${file.name}: use JPG, PNG or WebP.`); continue; }
      if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name}: larger than 5 MB.`); continue; }
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${hotelId}/booking-engine/${roomTypeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('hotel-assets').upload(path, file, { contentType: file.type, upsert: false });
      if (error) { toast.error(`${file.name}: ${error.message}`); continue; }
      added.push({ url: supabase.storage.from('hotel-assets').getPublicUrl(path).data.publicUrl, path });
    }
    const current = profiles[roomTypeId] ?? emptyProfile(roomTypeId);
    if (added.length) updateProfile(roomTypeId, { photos: [...current.photos, ...added].slice(0, 12) });
    setUploading(null);
  };

  const removePhoto = (roomTypeId: string, index: number) => {
    const current = profiles[roomTypeId] ?? emptyProfile(roomTypeId);
    const photo = current.photos[index];
    updateProfile(roomTypeId, { photos: current.photos.filter((_, i) => i !== index) });
    if (photo?.path) void supabase.storage.from('hotel-assets').remove([photo.path]);
  };

  const movePhoto = (roomTypeId: string, index: number, delta: number) => {
    const photos = [...(profiles[roomTypeId] ?? emptyProfile(roomTypeId)).photos];
    const target = index + delta;
    if (target < 0 || target >= photos.length) return;
    [photos[index], photos[target]] = [photos[target], photos[index]];
    updateProfile(roomTypeId, { photos });
  };

  const typeName = useMemo(() => new Map(roomTypes.map((r) => [r.id, r.name])), [roomTypes]);
  const langs = engine?.languages?.length ? BOOKING_LANGS.filter((l) => engine.languages.includes(l)) : ['en' as BookingLang];

  if (loading || !ready) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" aria-label="Loading" /></div>;
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;

  const page = (content: React.ReactNode) => (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-5 space-y-5 max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Globe className="h-5 w-5" />Website booking engine</h1>
            <p className="text-xs text-muted-foreground mt-1">Direct bookings from the hotel's own website, with live rates and availability from HotelCare.</p>
          </div>
          <Button asChild variant="outline" size="sm"><Link to={`/${organizationSlug}/channel-manager`}>Channel Manager</Link></Button>
        </div>
        {content}
      </main>
    </div>
  );

  if (!canManage) {
    return page(
      <Card><CardContent className="flex items-start gap-3 py-8 text-sm">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">The booking engine is managed by top management.</p>
          <p className="text-muted-foreground">Its settings, the code for the hotel website and the private test link are visible to admins and top management only. Website bookings still arrive in Reception as usual.</p>
        </div>
      </CardContent></Card>,
    );
  }
  if (!hotelId || isPortfolio) return page(<Card><CardContent className="py-10 text-center text-sm">Select one hotel to set up its booking engine.</CardContent></Card>);
  if (loadingData) return page(<div className="flex items-center gap-2 py-10 justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading…</div>);
  if (!native) {
    return page(
      <Card><CardContent className="py-8 space-y-2 text-sm">
        <p className="font-medium">The booking engine is for hotels where HotelCare is the PMS.</p>
        <p className="text-muted-foreground">{brand.name} still takes its bookings in Previo, so the website keeps using Previo's booking engine for now. Once the hotel runs on HotelCare with Channex, its website booking engine is set up here.</p>
      </CardContent></Card>,
    );
  }
  if (!engine) {
    return page(
      <Card><CardContent className="py-8 space-y-3 text-sm">
        <p className="font-medium">No booking engine yet for {brand.name}.</p>
        <p className="text-muted-foreground">It is created switched off, so you can add room photos and texts and preview it before guests can book.</p>
        <Button onClick={() => void create()} disabled={!canManage}>Create booking engine</Button>
      </CardContent></Card>,
    );
  }

  const link = `${ORIGIN}/book/${engine.public_id}`;
  const snippet = `<div data-hotelcare-booking="${engine.public_id}" data-lang="${snippetLang}"></div>\n<script async src="${ORIGIN}/booking-engine/loader.js"></script>`;
  const policies = engine.policies ?? {};
  const windowCfg = engine.booking_window ?? {};
  const setPolicy = (patch: Partial<EngineRow['policies']>) => update({ policies: { ...policies, ...patch } });
  const setWindow = (patch: Partial<EngineRow['booking_window']>) => update({ booking_window: { ...windowCfg, ...patch } });
  const setPlan = (id: string, patch: { enabled?: boolean; refundable?: boolean; free_cancellation_days?: number }) =>
    update({ rate_plans: { ...engine.rate_plans, [id]: { ...(engine.rate_plans?.[id] ?? {}), ...patch } } });
  const num = (v: string, fallback: number) => (v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

  return page(<>
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Online booking</CardTitle>
          <Badge variant={engine.enabled ? 'default' : 'outline'} className={engine.enabled ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>{engine.enabled ? 'Live' : 'Off'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span>
            <span className="font-medium block">Guests can book from the website</span>
            <span className="text-xs text-muted-foreground">Bookings arrive as confirmed reservations (unassigned room, pay at the hotel). Availability updates in Channex automatically.</span>
          </span>
          <Switch checked={engine.enabled} disabled={!canManage || saving} onCheckedChange={toggleEnabled} aria-label="Online booking" />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <CopyField label="Booking page link for guests" value={link} />
          {engine.enabled && <Button asChild variant="outline" className="gap-1.5"><a href={link} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Open live page</a></Button>}
        </div>
      </CardContent>
    </Card>

    <EngineTestLinkCard origin={ORIGIN} publicId={engine.public_id} hotelId={engine.hotel_id} token={engine.preview_token}
      lang={engine.default_language} enabled={engine.enabled} onToken={(preview_token) => setEngine((e) => (e ? { ...e, preview_token } : e))} />

    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Add it to the hotel website</CardTitle>
        <p className="text-xs text-muted-foreground">Send this code to whoever looks after the hotel website. It is only shown to top management.</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Language on the website:</span>
          {langs.map((l) => <Button key={l} type="button" size="sm" variant={snippetLang === l ? 'default' : 'outline'} onClick={() => setSnippetLang(l)}>{LANG_NAMES[l]}</Button>)}
        </div>
        <CopyField label="Embed code (paste where the booking engine should appear)" value={snippet} multiline />
        <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
          <li>The engine grows with its content; no height settings needed.</li>
          <li>Dates and campaign tags in the page URL are passed through, e.g. <code>?check_in=2026-12-20&amp;check_out=2026-12-22&amp;adults=2</code>.</li>
          <li>Each completed booking pushes a <code>purchase</code> event to <code>dataLayer</code> (Google Tag Manager / Google Ads conversion) and fires <code>hotelcare:booking</code> on the page.</li>
        </ul>
      </CardContent>
    </Card>

    <EngineBrandingCard
      hotelId={engine.hotel_id}
      brand={{ display_name: engine.display_name, logo_url: engine.logo_url, theme: engine.theme ?? {} }}
      langs={langs}
      fallbackName={brand.name}
      onChange={(patch) => update(patch)}
    />

    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Languages</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Label>Languages guests can choose</Label>
        <div className="flex flex-wrap gap-2">
          {BOOKING_LANGS.map((l) => {
            const on = engine.languages.includes(l);
            return <Button key={l} type="button" size="sm" variant={on ? 'default' : 'outline'} className="gap-1"
              onClick={() => update({ languages: on ? engine.languages.filter((x) => x !== l) : [...engine.languages, l] })}>{on && <Check className="h-3.5 w-3.5" />}{LANG_NAMES[l]}</Button>;
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Default:</span>
          <select value={engine.default_language} onChange={(e) => update({ default_language: e.target.value as BookingLang })} className="rounded-md border bg-background px-2 py-1 text-sm">
            {langs.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><MailCheck className="h-4 w-4" />Guest e-mails</CardTitle>
        <p className="text-xs text-muted-foreground">Sent in the guest's language with the hotel's colour and logo.</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Confirmation right after booking. Returning guests (same e-mail or name as an earlier stay) get a short welcome-back line.</li>
          <li>If they used the jacuzzi or sauna last time, the e-mail offers it again with a link straight to the time slots. Their stay history is never shown on the booking page.</li>
        </ul>
        <label className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Pre-arrival e-mail</span>
          <Input type="number" min={0} max={14} className="h-9 w-20" aria-label="Days before arrival"
            value={engine.reminder_days ?? 3} onChange={(e) => update({ reminder_days: num(e.target.value, 0) })} />
          <span className="text-muted-foreground">days before arrival (0 = off)</span>
        </label>
        <p className="text-xs text-muted-foreground">Includes the stay details, the jacuzzi and sauna slots (when switched on in In-Suite) and the taxi prices, with a link to manage the booking.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Rooms shown to guests</CardTitle>
        <p className="text-xs text-muted-foreground">Photos, texts and the number of guests each room type takes. Guests only see room types that are sellable.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {roomTypes.length === 0 && <p className="text-sm text-muted-foreground">No sellable room types yet.</p>}
        {roomTypes.map((rt) => {
          const p = profiles[rt.id] ?? emptyProfile(rt.id);
          const isOpen = openRoom === rt.id;
          return (
            <div key={rt.id} className="rounded-lg border">
              <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" aria-expanded={isOpen} onClick={() => setOpenRoom(isOpen ? null : rt.id)}>
                <span className="flex items-center gap-3 min-w-0">
                  {p.photos[0] ? <img src={p.photos[0].url} alt="" className="h-10 w-14 rounded object-cover" /> : <span className="grid h-10 w-14 place-items-center rounded bg-muted text-muted-foreground"><ImagePlus className="h-4 w-4" /></span>}
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{rt.name}</span>
                    <span className="block text-xs text-muted-foreground">{rt.num_rooms} rooms · up to {p.max_occupancy} guests · {p.photos.length} photos{p.description.en || p.description[langs[0]] ? '' : ' · no description yet'}</span>
                  </span>
                </span>
                <span className="text-xs text-primary shrink-0">{isOpen ? 'Close' : 'Edit'}</span>
              </button>
              {isOpen && (
                <div className="space-y-4 border-t p-3 text-sm">
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                    <label className="space-y-1"><Label>Max adults</Label><Input type="number" min={1} max={20} value={p.max_adults} onChange={(e) => updateProfile(rt.id, { max_adults: num(e.target.value, 1) })} /></label>
                    <label className="space-y-1"><Label>Max children</Label><Input type="number" min={0} max={20} value={p.max_children} onChange={(e) => updateProfile(rt.id, { max_children: num(e.target.value, 0) })} /></label>
                    <label className="space-y-1"><Label>Max guests in total</Label><Input type="number" min={1} max={30} value={p.max_occupancy} onChange={(e) => updateProfile(rt.id, { max_occupancy: num(e.target.value, 1) })} /></label>
                    <label className="space-y-1"><Label>Size (m²)</Label><Input type="number" min={0} value={p.size_sqm ?? ''} onChange={(e) => updateProfile(rt.id, { size_sqm: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  </div>
                  <div className="space-y-1"><Label>Beds</Label><LangFields langs={langs} value={p.bed_setup} placeholder="e.g. 1 queen bed" onChange={(v) => updateProfile(rt.id, { bed_setup: v })} /></div>
                  <div className="space-y-1"><Label>Description</Label><LangFields langs={langs} value={p.description} multiline onChange={(v) => updateProfile(rt.id, { description: v })} /></div>
                  <div className="space-y-2">
                    <Label>Amenities</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {AMENITY_KEYS.map((a) => {
                        const on = p.amenities.includes(a);
                        return <Button key={a} type="button" size="sm" variant={on ? 'default' : 'outline'} className="h-7 gap-1 text-xs"
                          onClick={() => updateProfile(rt.id, { amenities: on ? p.amenities.filter((x) => x !== a) : [...p.amenities, a] })}>{on && <Check className="h-3 w-3" />}{bookingT('en', `am_${a}`)}</Button>;
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Photos (first one is the cover; JPG, PNG or WebP up to 5 MB)</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {p.photos.map((photo, index) => (
                        <div key={photo.url} className="group relative overflow-hidden rounded-lg border">
                          <img src={photo.url} alt="" className="h-28 w-full object-cover" />
                          {index === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Cover</span>}
                          <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                            <div className="flex gap-1">
                              <Button type="button" size="icon" variant="secondary" className="h-7 w-7" disabled={index === 0} onClick={() => movePhoto(rt.id, index, -1)} aria-label="Move earlier"><ArrowLeft className="h-3.5 w-3.5" /></Button>
                              <Button type="button" size="icon" variant="secondary" className="h-7 w-7" disabled={index === p.photos.length - 1} onClick={() => movePhoto(rt.id, index, 1)} aria-label="Move later"><ArrowRight className="h-3.5 w-3.5" /></Button>
                            </div>
                            <Button type="button" size="icon" variant="destructive" className="h-7 w-7" onClick={() => removePhoto(rt.id, index)} aria-label="Remove photo"><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                      <label className="grid h-28 cursor-pointer place-items-center rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/40">
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading === rt.id || !canManage}
                          onChange={(e) => { void uploadPhotos(rt.id, e.target.files); e.currentTarget.value = ''; }} />
                        {uploading === rt.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="flex flex-col items-center gap-1"><ImagePlus className="h-5 w-5" />Add photos</span>}
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Rates sold online</CardTitle>
        <p className="text-xs text-muted-foreground">Prices, minimum/maximum stay and closed dates come from Rates &amp; availability, exactly as sent to the OTAs.</p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {ratePlans.length === 0 && <p className="text-muted-foreground">No active rate plans.</p>}
        {ratePlans.map((rp) => {
          const cfg = engine.rate_plans?.[rp.id] ?? {};
          const enabled = cfg.enabled !== false;
          const refundable = cfg.refundable !== false;
          return (
            <div key={rp.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
              <div>
                <div className="font-medium">{typeName.get(rp.room_type_id ?? '') ?? '—'} · {rp.name}</div>
                <div className="text-xs text-muted-foreground">{rp.meal_plan ? bookingT('en', `meal_${rp.meal_plan}`) : 'Room only'} · base {rp.base_rate ?? '—'} {rp.currency ?? ''}</div>
              </div>
              <label className="flex items-center gap-2 text-xs"><Switch checked={enabled} onCheckedChange={(v) => setPlan(rp.id, { enabled: v })} aria-label={`Sell ${rp.name} online`} />Sell online</label>
              <label className="flex items-center gap-2 text-xs"><Switch checked={refundable} disabled={!enabled} onCheckedChange={(v) => setPlan(rp.id, { refundable: v })} aria-label={`${rp.name} refundable`} />Free cancellation</label>
              <label className="flex items-center gap-2 text-xs">
                <Input type="number" min={0} max={60} className="h-8 w-16" disabled={!enabled || !refundable}
                  value={cfg.free_cancellation_days ?? policies.free_cancellation_days ?? 2}
                  onChange={(e) => setPlan(rp.id, { free_cancellation_days: num(e.target.value, 0) })} />
                days before arrival
              </label>
            </div>
          );
        })}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Policies, contact and booking window</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <label className="space-y-1"><Label>Check-in from</Label><Input type="time" value={policies.check_in_from ?? ''} onChange={(e) => setPolicy({ check_in_from: e.target.value })} /></label>
          <label className="space-y-1"><Label>Check-out until</Label><Input type="time" value={policies.check_out_until ?? ''} onChange={(e) => setPolicy({ check_out_until: e.target.value })} /></label>
          <label className="space-y-1"><Label>Default free cancellation (days)</Label><Input type="number" min={0} max={60} value={policies.free_cancellation_days ?? 2} onChange={(e) => setPolicy({ free_cancellation_days: num(e.target.value, 0) })} /></label>
          <label className="space-y-1"><Label>Same-day bookings until</Label><Input type="time" value={windowCfg.same_day_cutoff ?? '22:00'} onChange={(e) => setWindow({ same_day_cutoff: e.target.value })} /></label>
          <label className="space-y-1"><Label>Book at least (days ahead)</Label><Input type="number" min={0} max={60} value={windowCfg.min_lead_days ?? 0} onChange={(e) => setWindow({ min_lead_days: num(e.target.value, 0) })} /></label>
          <label className="space-y-1"><Label>Book at most (days ahead)</Label><Input type="number" min={1} max={490} value={windowCfg.max_advance_days ?? 365} onChange={(e) => setWindow({ max_advance_days: num(e.target.value, 365) })} /></label>
          <label className="space-y-1"><Label>Longest stay (nights)</Label><Input type="number" min={1} max={60} value={windowCfg.max_nights ?? 30} onChange={(e) => setWindow({ max_nights: num(e.target.value, 30) })} /></label>
          <label className="space-y-1"><Label>Rooms per booking</Label><Input type="number" min={1} max={10} value={windowCfg.max_rooms ?? 4} onChange={(e) => setWindow({ max_rooms: num(e.target.value, 4) })} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><Label>Booking terms URL</Label><Input value={policies.terms_url ?? ''} placeholder="https://…" onChange={(e) => setPolicy({ terms_url: e.target.value })} /></label>
          <label className="space-y-1"><Label>Privacy policy URL</Label><Input value={policies.privacy_url ?? ''} placeholder="https://…" onChange={(e) => setPolicy({ privacy_url: e.target.value })} /></label>
        </div>
        <div className="space-y-1"><Label>City tax note</Label><LangFields langs={langs} value={policies.city_tax_note ?? {}} placeholder="e.g. City tax of 4% is payable at the hotel." onChange={(v) => setPolicy({ city_tax_note: v })} /></div>
        <div className="space-y-1"><Label>Other note for guests (optional)</Label><LangFields langs={langs} value={policies.extra_note ?? {}} onChange={(v) => setPolicy({ extra_note: v })} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><Label>Hotel phone</Label><Input value={engine.contact?.phone ?? ''} onChange={(e) => update({ contact: { ...engine.contact, phone: e.target.value } })} /></label>
          <label className="space-y-1"><Label>Hotel e-mail</Label><Input type="email" value={engine.contact?.email ?? ''} onChange={(e) => update({ contact: { ...engine.contact, email: e.target.value } })} /></label>
          <label className="space-y-1 sm:col-span-2"><Label>Address</Label><Input value={engine.contact?.address ?? ''} onChange={(e) => update({ contact: { ...engine.contact, address: e.target.value } })} /></label>
          <label className="space-y-1 sm:col-span-2"><Label>Send new-booking e-mails to (comma separated)</Label>
            <Input value={(engine.notification_emails ?? []).join(', ')} placeholder="reception@hotel.com, manager@hotel.com"
              onChange={(e) => update({ notification_emails: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </label>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Recent website bookings</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {bookings.length === 0 ? <p className="text-muted-foreground">No website bookings yet.</p> : (
          <div className="divide-y">
            {bookings.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <span className="font-medium">{b.reference}</span> · {b.guest_name}
                  <div className="text-xs text-muted-foreground">{b.check_in_date} → {b.check_out_date} · {b.rooms?.length ?? 1} room(s) · booked {new Date(b.created_at).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{Number(b.total_amount).toFixed(2)} {b.currency}</span>
                  <Badge variant={b.status === 'cancelled' ? 'outline' : 'secondary'}>{b.status}</Badge>
                  {b.rooms?.[0]?.reservation_id && <Button asChild size="sm" variant="ghost"><Link to={`/${organizationSlug}/reservations/${b.rooms[0].reservation_id}`}>Open</Link></Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    {canManage && (
      <div className="sticky bottom-3 z-20 flex justify-end">
        <Button onClick={() => void save()} disabled={!dirty || saving} className="gap-1.5 shadow-lg">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>
    )}
  </>);
};

export default BookingEngineSettings;
