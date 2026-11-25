// Booking engine settings: the hotel's look on the guest pages. Logo and
// hero photo are uploaded to the hotel's storage folder; colours, heading
// style and tagline are stored in booking_engines.theme. The preview uses
// the very same chrome the guests see.
import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { brandStyle, headingClassFor, safeImageUrl } from '@/components/booking/brand';
import { LANG_NAMES, bookingT, type BookingLang } from '@/lib/bookingEngine/i18n';
import { brandColors, pick, type EngineTheme } from '@/lib/bookingEngine/logic';
import { cn } from '@/lib/utils';

type Brand = { display_name: string | null; logo_url: string | null; theme: EngineTheme };
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const HEX = /^#[0-9a-f]{6}$/i;

function ColourField({ label, hint, value, fallback, onChange, onReset }: {
  label: string; hint: string; value: string | undefined; fallback: string; onChange: (v: string) => void; onReset?: () => void;
}) {
  const shown = HEX.test(value ?? '') ? value! : fallback;
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <input type="color" aria-label={label} value={shown} onChange={(e) => onChange(e.target.value)} className="h-10 w-14 shrink-0 cursor-pointer rounded border bg-background" />
        <Input value={value ?? ''} placeholder={fallback} onChange={(e) => onChange(e.target.value.trim())} className="font-mono" aria-label={`${label} (hex)`} />
        {onReset && value && <Button type="button" variant="ghost" size="sm" onClick={onReset}>Reset</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{hint}{value && !HEX.test(value) ? ' Use the #rrggbb format.' : ''}</p>
    </div>
  );
}

function ImageField({ label, hint, url, busy, wide, disabled, onPick, onRemove }: {
  label: string; hint: string; url: string | null; busy: boolean; wide?: boolean; disabled?: boolean;
  onPick: (file: File) => void; onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const shown = safeImageUrl(url);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted/40', wide ? 'h-16 w-28' : 'h-16 w-24')}>
          {shown
            ? <img src={shown} alt="" className={cn('h-full w-full', wide ? 'object-cover' : 'object-contain p-1.5')} />
            : <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy || disabled}
            onChange={(e) => { const file = e.target.files?.[0]; if (file) onPick(file); e.currentTarget.value = ''; }} />
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy || disabled} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{shown ? 'Replace' : 'Upload'}
          </Button>
          {shown && <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={busy || disabled} onClick={onRemove}><Trash2 className="h-4 w-4" />Remove</Button>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Miniature of the guest page's first screen, in the chosen look. */
export function BrandPreview({ brand, lang, fallbackName }: { brand: Brand; lang: BookingLang; fallbackName: string }) {
  const theme = brand.theme ?? {};
  const photo = safeImageUrl(theme.hero_url);
  const logo = safeImageUrl(brand.logo_url);
  const tagline = pick(theme.tagline, lang);
  return (
    <div style={brandStyle(theme)} className="overflow-hidden rounded-xl border shadow-sm" aria-label="Preview of the booking page">
      <div className={cn('relative isolate flex min-h-[200px] flex-col justify-between p-4', photo ? 'bg-stone-900 text-white' : 'bg-[var(--be-primary)] text-[var(--be-on-primary)]')}>
        {photo && <>
          <img src={photo} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/35 to-black/20" aria-hidden="true" />
        </>}
        <div>{logo && <span className="inline-flex rounded-lg bg-white px-2 py-1 shadow-sm"><img src={logo} alt="" className="h-6 w-auto max-w-[100px] object-contain" /></span>}</div>
        <div className="pt-6">
          <div className={cn('text-2xl leading-tight', headingClassFor(theme.style))}>{brand.display_name || fallbackName}</div>
          <div className="mt-2 h-0.5 w-10 rounded-full bg-[var(--be-accent)]" aria-hidden="true" />
          {tagline && <p className="mt-2 text-xs leading-relaxed opacity-90">{tagline}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 bg-white px-4 py-3">
        <span className="text-xs text-stone-500">{bookingT(lang, 'priceFrom')} <span className="font-semibold text-[var(--be-accent-text)]">€79</span></span>
        <span className="rounded-lg bg-[var(--be-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--be-on-primary)]">{bookingT(lang, 'search')}</span>
      </div>
    </div>
  );
}

export function EngineBrandingCard({ hotelId, brand, langs, fallbackName, disabled, onChange }: {
  hotelId: string; brand: Brand; langs: BookingLang[]; fallbackName: string; disabled?: boolean;
  onChange: (patch: Partial<Brand>) => void;
}) {
  const [busy, setBusy] = useState<'logo' | 'hero' | null>(null);
  const [previewLang, setPreviewLang] = useState<BookingLang>(langs[0] ?? 'en');
  const theme = brand.theme ?? {};
  const setTheme = (patch: Partial<EngineTheme>) => onChange({ theme: { ...theme, ...patch } });
  const primary = brandColors(theme.primary).primary;

  const upload = async (kind: 'logo' | 'hero', file: File) => {
    const ext = IMAGE_TYPES[file.type];
    const max = kind === 'logo' ? 2 : 6;
    if (!ext) { toast.error('Use a PNG, JPG or WebP image.'); return; }
    if (file.size > max * 1024 * 1024) { toast.error(`The image is larger than ${max} MB.`); return; }
    setBusy(kind);
    const path = `${hotelId}/booking-engine/brand/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('hotel-assets').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    const url = supabase.storage.from('hotel-assets').getPublicUrl(path).data.publicUrl;
    if (kind === 'logo') onChange({ logo_url: url }); else setTheme({ hero_url: url });
    toast.success(kind === 'logo' ? 'Logo uploaded. Save to publish it.' : 'Photo uploaded. Save to publish it.');
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Look and branding</CardTitle>
        <p className="text-xs text-muted-foreground">How the hotel appears to guests on the booking page, the manage page and in the embedded booking engine.</p>
      </CardHeader>
      <CardContent className="grid gap-6 text-sm lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <label className="block space-y-1"><Label>Hotel name shown to guests</Label>
            <Input value={brand.display_name ?? ''} placeholder={fallbackName} disabled={disabled} onChange={(e) => onChange({ display_name: e.target.value })} />
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <ImageField label="Logo" hint="PNG with a transparent background works best, up to 2 MB. Shown on a white tile." url={brand.logo_url} busy={busy === 'logo'}
              disabled={disabled} onPick={(f) => void upload('logo', f)} onRemove={() => onChange({ logo_url: null })} />
            <ImageField wide label="Hero photo" hint="Landscape, at least 1600 px wide, up to 6 MB. Without a photo the brand colour is used." url={theme.hero_url ?? null}
              busy={busy === 'hero'} disabled={disabled} onPick={(f) => void upload('hero', f)} onRemove={() => setTheme({ hero_url: null })} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <ColourField label="Brand colour" hint="Buttons, selected dates and links. Text on it turns dark or light automatically."
              value={theme.primary} fallback="#8a6a3d" onChange={(v) => setTheme({ primary: v })} />
            <ColourField label="Accent colour" hint="Small highlights: the lowest prices, icons and the booking reference."
              value={theme.accent} fallback={primary} onChange={(v) => setTheme({ accent: v })} onReset={() => setTheme({ accent: undefined })} />
          </div>
          <div className="space-y-1.5">
            <Label>Heading style</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['classic', 'modern'] as const).map((style) => {
                const on = (theme.style ?? 'classic') === style;
                return (
                  <button key={style} type="button" disabled={disabled} onClick={() => setTheme({ style })} aria-pressed={on}
                    className={cn('rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/50')}>
                    <span className={cn('block text-xl', headingClassFor(style))}>{brand.display_name || fallbackName}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{style === 'classic' ? 'Classic serif' : 'Modern sans-serif'}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Tagline under the hotel name (optional)</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {langs.map((l) => (
                <label key={l} className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">{LANG_NAMES[l]}</span>
                  <Input value={theme.tagline?.[l] ?? ''} maxLength={120} disabled={disabled} placeholder={l === 'en' ? 'e.g. A quiet boutique hotel in the Jewish Quarter' : ''}
                    onFocus={() => setPreviewLang(l)}
                    onChange={(e) => setTheme({ tagline: { ...(theme.tagline ?? {}), [l]: e.target.value } })} />
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between gap-2">
            <Label>Preview</Label>
            {langs.length > 1 && (
              <select value={previewLang} onChange={(e) => setPreviewLang(e.target.value as BookingLang)} aria-label="Preview language"
                className="rounded-md border bg-background px-2 py-1 text-xs">
                {langs.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
              </select>
            )}
          </div>
          <BrandPreview brand={brand} lang={langs.includes(previewLang) ? previewLang : langs[0] ?? 'en'} fallbackName={fallbackName} />
          <p className="text-xs text-muted-foreground">Changes go live for guests when you save.</p>
        </div>
      </CardContent>
    </Card>
  );
}
