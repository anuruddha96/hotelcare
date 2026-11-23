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
import { CheckCircle2, IdCard, Loader2, PencilLine, ScanLine, TriangleAlert, X } from 'lucide-react';
import { IdScanDialog } from '@/components/frontdesk/IdScanDialog';
import type { MrzReadResult } from '@/lib/idScan/mrz';
import { toVizaDocumentScan, type VizaDocumentScan } from '@/lib/idScan/vizaScan';
import { useTranslation } from '@/hooks/useTranslation';
import { documentRequired, scanFieldState, vizaMissingFields, vizaProblems, type VizaProblem } from '@/lib/idScan/guestVizaChecks';

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

const BASE_COLUMNS = 'id, first_name, last_name, nationality, date_of_birth, birth_place, gender, id_document_type, id_document_number, visa_number, mother_name, document_scan';
// Added for VIZA (birth name, entry into Hungary); read separately so the form keeps working until the migration is applied.
const EXTRA_COLUMNS = 'birth_last_name, birth_first_name, entry_date, entry_place';

/** What still stands between this guest and a report VIZA accepts: empty required fields plus refused values. */
const openItems = (guest: GuestVizaRow | null) => [...vizaMissingFields(guest), ...vizaProblems(guest)];

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
  // The reader's output for this guest: loaded with the guest, replaced by a new scan, cleared by "remove".
  const [scan, setScan] = useState<VizaDocumentScan | null>(null);
  const [scanChanged, setScanChanged] = useState(false);
  const [hasExtraColumns, setHasExtraColumns] = useState(false);

  useEffect(() => {
    if (!guestId) { setGuest(null); setScan(null); onCompletenessChange?.(openItems(null)); return; }
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
      const { document_scan: storedScan, ...columns } = (data ?? {}) as Record<string, unknown>;
      const row = (data ? { birth_last_name: null, birth_first_name: null, entry_date: null, entry_place: null, ...columns } : null) as GuestVizaRow | null;
      setGuest(row);
      setScan((storedScan as VizaDocumentScan | null) ?? null);
      setScanChanged(false);
      setHasExtraColumns(extended);
      setDirty(false);
      onCompletenessChange?.(openItems(row));
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

  // Fill from a scanned passport/ID. The document is the guest's legal
  // identity, so what it says replaces the booking's name and details; the
  // receptionist then corrects anything misread (sent to VIZA as a manual
  // correction next to the unchanged reading) and presses Save.
  const applyScan = (result: MrzReadResult) => {
    const f = result.fields;
    setGuest((g) => g ? {
      ...g,
      first_name: f.firstName || g.first_name,
      last_name: f.lastName || g.last_name,
      nationality: result.unknownCountry ? g.nationality : f.nationality || g.nationality,
      date_of_birth: f.dateOfBirth || g.date_of_birth,
      gender: f.gender || g.gender,
      id_document_type: f.documentType,
      id_document_number: f.documentNumber || g.id_document_number,
    } : g);
    setScan(toVizaDocumentScan(result));
    setScanChanged(true);
    setDirty(true);
    toast.success(t('pms.scan.applied'));
  };

  const removeScan = () => {
    setScan(null);
    setScanChanged(true);
    setDirty(true);
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
      ...(scanChanged ? { document_scan: scan } : {}),
    };
    // Generated types may lag behind the latest migration for the new columns.
    const { error } = await (supabase.from('guests') as never as {
      update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> };
    }).update(payload).eq('id', guest.id);
    setSaving(false);
    if (error) { toast.error(t('pms.guest.saveFailed')); return; }
    setDirty(false);
    setScanChanged(false);
    toast.success(t('pms.guest.saved'));
    onCompletenessChange?.(openItems(guest));
  };

  if (!guestId) return null;
  const missing = vizaMissingFields(guest);
  const problems = vizaProblems(guest);
  const open = missing.length + problems.length;
  const needsDocument = documentRequired(guest?.date_of_birth);
  const problemText: Record<VizaProblem, string> = {
    birthNamePair: t('pms.guest.problem.birthNamePair'), motherName: t('pms.guest.problem.motherName'),
    entryDate: t('pms.guest.problem.entryDate'), nationality: t('pms.guest.problem.nationality'),
    birthDate: t('pms.guest.problem.birthDate'),
  };
  // Under each field the reader filled: unchanged from the document, or corrected by hand.
  const mark = (field: Exclude<keyof GuestVizaRow, 'id'>) => {
    const state = guest ? scanFieldState(field, guest, scan) : null;
    if (!state) return null;
    return state === 'fromDocument'
      ? <p className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> {t('pms.guest.fromDocument')}</p>
      : <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400"><PencilLine className="h-3 w-3" /> {t('pms.guest.correctedByHand')}</p>;
  };
  const read = scan?.fields;
  const fieldLabel: Record<string, string> = {
    last_name: t('pms.guest.familyName'), first_name: t('pms.guest.givenName'),
    nationality: t('pms.guest.nationality'), date_of_birth: t('pms.guest.birthDate'),
    birth_place: t('pms.guest.birthPlace'), gender: t('pms.guest.gender'),
    id_document_type: t('pms.guest.docType'), id_document_number: t('pms.guest.docNumber'),
  };

  return (
    <details className="rounded-lg border border-border" open={open > 0} data-training="fd-guest-viza">
      <summary className="list-none cursor-pointer select-none px-3 py-2 flex items-center gap-2 text-sm font-medium">
        <IdCard className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1">{t('pms.guest.detailsTitle')}</span>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open === 0
          ? <Badge className="bg-emerald-600 text-white">✓ {t('pms.guest.complete')}</Badge>
          : <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">{t('pms.guest.missing')}: {open}</Badge>}
      </summary>
      {guest && (
        <div className="px-3 pb-3 space-y-2.5">
          <Button type="button" size="sm" variant={read ? 'outline' : 'default'} className="h-9 w-full gap-1.5" onClick={() => setScanOpen(true)} data-training="fd-id-scan-open">
            <ScanLine className="h-4 w-4" /> {read ? t('pms.scan.retry') : t('pms.scan.button')}
          </Button>
          {read && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/20" data-training="fd-guest-scan-panel">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <p className="flex-1 text-xs font-semibold">{t('pms.guest.scanPanelTitle')}</p>
                {scan?.read_at && <time className="text-[10px] text-muted-foreground">{new Date(scan.read_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</time>}
                <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" onClick={removeScan}><X className="h-3 w-3" /> {t('pms.guest.scanRemove')}</Button>
              </div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
                <dt className="font-sans text-muted-foreground">{t('pms.scan.name')}</dt><dd>{[read.csaladnev, read.utonev].filter(Boolean).join(', ') || '—'}</dd>
                <dt className="font-sans text-muted-foreground">{t('pms.guest.birthDate')}</dt><dd>{read.szuletesiDatum ?? '—'}</dd>
                <dt className="font-sans text-muted-foreground">{t('pms.guest.nationality')}</dt><dd>{read.allampolgarsagKod ?? '—'}</dd>
                <dt className="font-sans text-muted-foreground">{t('pms.guest.docNumber')}</dt><dd>{read.okmanyAzonositoSzam ?? '—'}</dd>
              </dl>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t('pms.guest.scanPanelNote')}</p>
            </div>
          )}
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('pms.guest.missing')}: {missing.map((f) => fieldLabel[f] ?? f).join(', ')}
            </p>
          )}
          {problems.length > 0 && (
            <ul role="alert" className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {problems.map((problem) => <li key={problem} className="flex items-start gap-1.5"><TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {problemText[problem]}</li>)}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">{t('pms.guest.familyName')}</Label>
              <Input className="h-8" value={guest.last_name ?? ''} onChange={(e) => setName('last_name', e.target.value)} />
              {mark('last_name')}
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.givenName')}</Label>
              <Input className="h-8" value={guest.first_name ?? ''} onChange={(e) => setName('first_name', e.target.value)} />
              {mark('first_name')}
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
              <Input className="h-8 uppercase" maxLength={3} value={guest.nationality ?? ''} onChange={(e) => set('nationality', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="HU / DE / USA…" />
              {mark('nationality')}
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.birthDate')}</Label>
              <Input className="h-8" type="date" value={guest.date_of_birth ?? ''} onChange={(e) => set('date_of_birth', e.target.value)} />
              {mark('date_of_birth')}
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
              {mark('gender')}
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.docType')}</Label>
              <Select value={guest.id_document_type ?? ''} onValueChange={(v) => set('id_document_type', v)}>
                <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="passport">{t('pms.guest.docPassport')}</SelectItem>
                  <SelectItem value="id_card">{t('pms.guest.docIdCard')}</SelectItem>
                  <SelectItem value="driving_licence">{t('pms.guest.docDriving')}</SelectItem>
                  <SelectItem value="other">{t('pms.guest.docOther')}</SelectItem>
                </SelectContent>
              </Select>
              {mark('id_document_type')}
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.docNumber')}</Label>
              <Input className="h-8" maxLength={100} value={guest.id_document_number ?? ''} onChange={(e) => set('id_document_number', e.target.value)} />
              {mark('id_document_number')}
            </div>
            {!needsDocument && <p className="col-span-2 text-[11px] text-muted-foreground">{t('pms.guest.under14')}</p>}
            <p className="col-span-2 mt-1 border-t border-border pt-2 text-[11px] font-medium text-muted-foreground">{t('pms.guest.thirdCountry')}</p>
            <div className="col-span-2">
              <Label className="text-xs">{t('pms.guest.visaNumber')}</Label>
              <Input className="h-8" maxLength={100} value={guest.visa_number ?? ''} onChange={(e) => set('visa_number', e.target.value)} />
            </div>
            {hasExtraColumns && (
              <>
                <div>
                  <Label className="text-xs">{t('pms.guest.entryDate')}</Label>
                  <Input className="h-8" type="date" max={new Date().toISOString().slice(0, 10)} value={guest.entry_date ?? ''} onChange={(e) => set('entry_date', e.target.value)} />
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
