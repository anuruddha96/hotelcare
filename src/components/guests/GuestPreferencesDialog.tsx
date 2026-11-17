import { useEffect, useState } from 'react';
import { Check, Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PRESET_TAGS, cleanTags, countryName, guestTagLabel, isPresetTag, type GuestPreferencesPatch } from '@/lib/guestJourney';

export interface GuestPreferencesValue {
  tags: string[];
  dietary: string | null;
  notes: string | null;
  vip: boolean;
  nationality: string | null;
}

/**
 * Edit what the team should remember about a guest. For a guest known only
 * from Previo bookings the first save creates the guest profile; the bookings
 * themselves are never changed.
 */
export function GuestPreferencesDialog({ open, onOpenChange, hotelId, profileKey, hasProfile, value, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotelId: string;
  profileKey: string;
  hasProfile: boolean;
  value: GuestPreferencesValue;
  onSaved: (result: { key: string; guestId: string }) => void;
}) {
  const { t, language } = useTranslation();
  const [tags, setTags] = useState<string[]>(value.tags);
  const [custom, setCustom] = useState('');
  const [dietary, setDietary] = useState(value.dietary ?? '');
  const [notes, setNotes] = useState(value.notes ?? '');
  const [vip, setVip] = useState(value.vip);
  const [nationality, setNationality] = useState(value.nationality ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTags(value.tags);
    setCustom('');
    setDietary(value.dietary ?? '');
    setNotes(value.notes ?? '');
    setVip(value.vip);
    setNationality(value.nationality ?? '');
  }, [open, value]);

  const toggle = (tag: string) => setTags((current) => (current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag]));
  const addCustom = () => {
    const next = cleanTags([...tags, custom]);
    setTags(next);
    setCustom('');
  };
  const customTags = tags.filter((tag) => !isPresetTag(tag));
  const natValid = nationality === '' || /^[A-Za-z]{2}$/.test(nationality);

  const save = async () => {
    if (!natValid) return;
    setSaving(true);
    const patch: GuestPreferencesPatch = {
      tags: cleanTags(tags),
      dietary: dietary.trim(),
      notes: notes.trim(),
      vip,
      nationality: nationality.trim().toUpperCase(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('pms_guest_profile_save', { _hotel_id: hotelId, _key: profileKey, _patch: patch });
    setSaving(false);
    if (error || !data?.ok) {
      toast.error(t('pms.guest.saveFailed'));
      return;
    }
    toast.success(t('pms.guest.saved'));
    onSaved({ key: String(data.key), guestId: String(data.guest_id) });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('pms.guest.preferences')}</DialogTitle>
          <DialogDescription>{hasProfile ? t('pms.guest.preferencesHelp') : t('pms.guest.createsProfile')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>{t('pms.guest.likes')}</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('pms.guest.likes')}>
              {PRESET_TAGS.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(tag)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${on
                      ? 'border-violet-600 bg-violet-600 text-white'
                      : 'border-border bg-background text-foreground hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40'}`}
                  >
                    {on && <Check className="h-3 w-3" aria-hidden="true" />}
                    {guestTagLabel(tag, t)}
                  </button>
                );
              })}
              {customTags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-violet-600 bg-violet-600 px-2.5 py-1 text-xs text-white">
                  {tag}
                  <button type="button" onClick={() => toggle(tag)} aria-label={`${t('common.remove')} ${tag}`} className="rounded-full hover:bg-white/20">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={custom}
                maxLength={40}
                placeholder={t('pms.guest.addOwn')}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (custom.trim()) addCustom(); } }}
                className="h-9"
              />
              <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1" disabled={!custom.trim()} onClick={addCustom}>
                <Plus className="h-4 w-4" /> {t('pms.guest.add')}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-dietary">{t('pms.guest.dietary')}</Label>
            <Input id="guest-dietary" value={dietary} maxLength={300} placeholder={t('pms.guest.dietaryPlaceholder')} onChange={(e) => setDietary(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('pms.guest.dietaryHelp')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-notes">{t('pms.guest.notes')}</Label>
            <Textarea id="guest-notes" value={notes} maxLength={2000} rows={3} placeholder={t('pms.guest.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="guest-nationality">{t('pms.guests.nationality')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="guest-nationality"
                  value={nationality}
                  maxLength={2}
                  placeholder="HU"
                  className={`h-9 w-16 uppercase ${natValid ? '' : 'border-destructive'}`}
                  onChange={(e) => setNationality(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())}
                />
                <span className="truncate text-sm text-muted-foreground">{nationality.length === 2 ? countryName(nationality, language) : t('pms.guest.countryCode')}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div>
                <Label htmlFor="guest-vip">VIP</Label>
                <p className="text-xs text-muted-foreground">{t('pms.guest.vipHelp')}</p>
              </div>
              <Switch id="guest-vip" checked={vip} onCheckedChange={setVip} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={saving || !natValid} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('pms.guest.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
