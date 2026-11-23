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
import { IdCard, Loader2, ScanLine } from 'lucide-react';
import { IdScanDialog } from '@/components/frontdesk/IdScanDialog';
import type { MrzReadResult } from '@/lib/idScan/mrz';
import { toVizaDocumentScan, type VizaDocumentScan } from '@/lib/idScan/vizaScan';
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
  birth_last_name: string | null;
  birth_first_name: string | null;
  mother_name: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  gender: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  visa_number: string | null;
  entry_date: string | null;
  entry_place: string | null;
}

const BASE_COLUMNS = 'id, first_name, last_name, nationality, date_of_birth, birth_place, gender, id_document_type, id_document_number, visa_number, mother_name';
// Added for VIZA (birth name, entry into Hungary); read separately so the form keeps working until the migration is applied.
const EXTRA_COLUMNS = 'birth_last_name, birth_first_name, entry_date, entry_place';

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
  const [scanOpen, setScanOpen] = useState(false);
  const [pendingScan, setPendingScan] = useState<VizaDocumentScan | null>(null);
  const [hasExtraColumns, setHasExtraColumns] = useState(false);

  useEffect(() => {
    if (!guestId) { setGuest(null); onCompletenessChange?.(vizaMissingFields(null)); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      const guests = supabase.from('guests') as never as {
        select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }> } };
      };
      let { data, error } = await guests.select(`${BASE_COLUMNS}, ${EXTRA_COLUMNS}`).eq('id', guestId).maybeSingle();
      const extended = !error;
      if (error) ({ data, error } = await guests.select(BASE_COLUMNS).eq('id', guestId).maybeSingle());
      if (!alive) return;
      const row = (data ? { birth_last_name: null, birth_first_name: null, entry_date: null, entry_place: null, ...data } : null) as GuestVizaRow | null;
      setGuest(row);
      setHasExtraColumns(extended);
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

  // Names are required columns: keep the text as typed, never null.
  const setName = (field: 'first_name' | 'last_name', value: string) => {
    setGuest((g) => (g ? { ...g, [field]: value } : g));
    setDirty(true);
  };

  // Fill from a scanned passport/ID: only the fields the document holds; the
  // receptionist reviews them and presses Save (nothing is stored before that).
  const applyScan = (scan: MrzReadResult) => {
    const f = scan.fields;
    setGuest((g) => g ? {
      ...g,
      first_name: g.first_name?.trim() && !/^(ota|sandbox)/i.test(g.first_name) ? g.first_name : f.firstName || g.first_name,
      last_name: g.last_name?.trim() && !/^guest$/i.test(g.last_name) ? g.last_name : f.lastName || g.last_name,
      nationality: f.nationality || g.nationality,
      date_of_birth: f.dateOfBirth || g.date_of_birth,
      gender: f.gender || g.gender,
      id_document_type: f.documentType,
      id_document_number: f.documentNumber || g.id_document_number,
    } : g);
    setPendingScan(toVizaDocumentScan(scan));
    setDirty(true);
    toast.success(t('pms.scan.applied'));
  };

  const save = async () => {
    if (!guest) return;
    setSaving(true);
    const payload = {
      first_name: guest.first_name,
      last_name: guest.last_name,
      nationality: guest.nationality, date_of_birth: guest.date_of_birth || null,
      birth_place: guest.birth_place, gender: guest.gender,
      id_document_type: guest.id_document_type, id_document_number: guest.id_document_number,
      visa_number: guest.visa_number, mother_name: guest.mother_name,
      ...(hasExtraColumns ? {
        birth_last_name: guest.birth_last_name, birth_first_name: guest.birth_first_name,
        entry_date: guest.entry_date || null, entry_place: guest.entry_place,
      } : {}),
      ...(pendingScan ? { document_scan: pendingScan } : {}),
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
          <Button type="button" size="sm" className="h-9 w-full gap-1.5" onClick={() => setScanOpen(true)} data-training="fd-id-scan-open">
            <ScanLine className="h-4 w-4" /> {t('pms.scan.button')}
          </Button>
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('pms.guest.missing')}: {missing.map((f) => fieldLabel[f] ?? f).join(', ')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">{t('pms.guest.familyName')}</Label>
              <Input className="h-8" value={guest.last_name ?? ''} onChange={(e) => setName('last_name', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.givenName')}</Label>
              <Input className="h-8" value={guest.first_name ?? ''} onChange={(e) => setName('first_name', e.target.value)} />
            </div>
            {hasExtraColumns && (
              <>
                <div>
                  <Label className="text-xs">{t('pms.guest.birthFamilyName')}</Label>
                  <Input className="h-8" value={guest.birth_last_name ?? ''} onChange={(e) => set('birth_last_name', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t('pms.guest.birthGivenName')}</Label>
                  <Input className="h-8" value={guest.birth_first_name ?? ''} onChange={(e) => set('birth_first_name', e.target.value)} />
                </div>
              </>
            )}
            <div className="col-span-2">
              <Label className="text-xs">{t('pms.guest.motherName')}</Label>
              <Input className="h-8" value={guest.mother_name ?? ''} onChange={(e) => set('mother_name', e.target.value)} />
            </div>
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
            {hasExtraColumns && (
              <>
                <div>
                  <Label className="text-xs">{t('pms.guest.entryDate')}</Label>
                  <Input className="h-8" type="date" value={guest.entry_date ?? ''} onChange={(e) => set('entry_date', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t('pms.guest.entryPlace')}</Label>
                  <Input className="h-8" value={guest.entry_place ?? ''} onChange={(e) => set('entry_place', e.target.value)} />
                </div>
              </>
            )}
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={!dirty || saving} onClick={save}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t('pms.guest.save')}
          </Button>
        </div>
      )}
      <IdScanDialog open={scanOpen} onOpenChange={setScanOpen} onApply={applyScan} />
    </details>
  );
}
