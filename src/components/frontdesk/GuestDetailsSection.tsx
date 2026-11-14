import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { IdCard, Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Hungarian guest-registration (VIZA) data, captured at check-in.
 * Shows what is still missing and lets reception fill it in one place;
 * later the tablet ID-scan flow will prefill the same fields.
 */

export interface GuestVizaRow {
  id: string;
  first_name: string;
  last_name: string;
  nationality: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  gender: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  visa_number: string | null;
}

const REQUIRED: Array<keyof GuestVizaRow> = [
  'nationality', 'date_of_birth', 'birth_place', 'gender', 'id_document_type', 'id_document_number',
];

function vizaMissingFields(guest: Partial<GuestVizaRow> | null | undefined): string[] {
  if (!guest) return [...REQUIRED] as string[];
  return REQUIRED.filter((field) => !String(guest[field] ?? '').trim());
}

interface GuestDetailsSectionProps {
  guestId: string | null;
  onCompletenessChange?: (missing: string[]) => void;
}

export function GuestDetailsSection({ guestId, onCompletenessChange }: GuestDetailsSectionProps) {
  const { t } = useTranslation();
  const [guest, setGuest] = useState<GuestVizaRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!guestId) { setGuest(null); onCompletenessChange?.(vizaMissingFields(null)); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      const { data } = await supabase.from('guests')
        .select('id, first_name, last_name, nationality, date_of_birth, birth_place, gender, id_document_type, id_document_number, visa_number')
        .eq('id', guestId).maybeSingle();
      if (!alive) return;
      const row = (data ?? null) as GuestVizaRow | null;
      setGuest(row);
      setDirty(false);
      onCompletenessChange?.(vizaMissingFields(row));
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId]);

  const set = (field: keyof GuestVizaRow, value: string) => {
    setGuest((g) => (g ? { ...g, [field]: value || null } : g));
    setDirty(true);
  };

  const save = async () => {
    if (!guest) return;
    setSaving(true);
    const payload = {
      nationality: guest.nationality, date_of_birth: guest.date_of_birth || null,
      birth_place: guest.birth_place, gender: guest.gender,
      id_document_type: guest.id_document_type, id_document_number: guest.id_document_number,
      visa_number: guest.visa_number,
    };
    // Generated types may lag behind the latest migration for the new columns.
    const { error } = await (supabase.from('guests') as never as {
      update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> };
    }).update(payload).eq('id', guest.id);
    setSaving(false);
    if (error) { toast.error(t('pms.guest.saveFailed')); return; }
    setDirty(false);
    toast.success(t('pms.guest.saved'));
    onCompletenessChange?.(vizaMissingFields(guest));
  };

  if (!guestId) return null;
  const missing = vizaMissingFields(guest);
  const fieldLabel: Record<string, string> = {
    nationality: t('pms.guest.nationality'), date_of_birth: t('pms.guest.birthDate'),
    birth_place: t('pms.guest.birthPlace'), gender: t('pms.guest.gender'),
    id_document_type: t('pms.guest.docType'), id_document_number: t('pms.guest.docNumber'),
  };

  return (
    <details className="rounded-lg border border-border" open={missing.length > 0} data-training="fd-guest-viza">
      <summary className="list-none cursor-pointer select-none px-3 py-2 flex items-center gap-2 text-sm font-medium">
        <IdCard className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1">{t('pms.guest.detailsTitle')}</span>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : missing.length === 0
          ? <Badge className="bg-emerald-600 text-white">✓ {t('pms.guest.complete')}</Badge>
          : <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">{t('pms.guest.missing')}: {missing.length}</Badge>}
      </summary>
      {guest && (
        <div className="px-3 pb-3 space-y-2.5">
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('pms.guest.missing')}: {missing.map((f) => fieldLabel[f] ?? f).join(', ')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">{t('pms.guest.nationality')}</Label>
              <Input className="h-8" value={guest.nationality ?? ''} onChange={(e) => set('nationality', e.target.value)} placeholder="HU / DE / US…" />
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.birthDate')}</Label>
              <Input className="h-8" type="date" value={guest.date_of_birth ?? ''} onChange={(e) => set('date_of_birth', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.birthPlace')}</Label>
              <Input className="h-8" value={guest.birth_place ?? ''} onChange={(e) => set('birth_place', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.gender')}</Label>
              <Select value={guest.gender ?? ''} onValueChange={(v) => set('gender', v)}>
                <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t('pms.guest.genderMale')}</SelectItem>
                  <SelectItem value="female">{t('pms.guest.genderFemale')}</SelectItem>
                  <SelectItem value="other">{t('pms.guest.genderOther')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.docType')}</Label>
              <Select value={guest.id_document_type ?? ''} onValueChange={(v) => set('id_document_type', v)}>
                <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="passport">{t('pms.guest.docPassport')}</SelectItem>
                  <SelectItem value="id_card">{t('pms.guest.docIdCard')}</SelectItem>
                  <SelectItem value="driving_licence">{t('pms.guest.docDriving')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.docNumber')}</Label>
              <Input className="h-8" value={guest.id_document_number ?? ''} onChange={(e) => set('id_document_number', e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('pms.guest.visaNumber')}</Label>
              <Input className="h-8" value={guest.visa_number ?? ''} onChange={(e) => set('visa_number', e.target.value)} />
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={!dirty || saving} onClick={save}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t('pms.guest.save')}
          </Button>
        </div>
      )}
    </details>
  );
}
