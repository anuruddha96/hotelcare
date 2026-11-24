import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, IdCard, Loader2, PencilLine, ScanLine, TriangleAlert, X } from 'lucide-react';
import { IdScanDialog, type ScanApplyOutcome } from '@/components/frontdesk/IdScanDialog';
import type { MrzReadResult } from '@/lib/idScan/mrz';
import { toVizaDocumentScan, type VizaDocumentScan } from '@/lib/idScan/vizaScan';
import { guestScanPatch, recognizedNationality, type OpticalGuestFields } from '@/lib/idScan/opticalGuestFields';
import { useTranslation } from '@/hooks/useTranslation';
import { documentRequired, scanFieldState, vizaMissingFields, vizaProblems, type VizaProblem, type VizaReview, vizaAdmissionFields, isHungarianId, thirdCountry, vizaArrivalDay } from '@/lib/idScan/guestVizaChecks';

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
  mother_family_name?: string | null;
  mother_given_name?: string | null;
  viza_review?: VizaReview | null;
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
const REVIEW_COLUMNS = 'mother_family_name, mother_given_name, viza_review';

/** What still stands between this guest and a report VIZA accepts: empty required fields plus refused values. */
const openItems = (guest: GuestVizaRow | null, reservationId?: string, occurredAt?: string | null) => reservationId ? vizaAdmissionFields(guest, reservationId, vizaArrivalDay(occurredAt)) : [...vizaMissingFields(guest), ...vizaProblems(guest)];

export interface GuestRegistrationDraft {
  result: MrzReadResult | null;
  optical: OpticalGuestFields;
}
export type GuestRegistrationResult = { status: 'match' | 'registered'; guest_id: string };

interface GuestDetailsSectionProps {
  draft?: GuestRegistrationDraft;
  onRegister?: (payload: Record<string, unknown>, confirmedMatch: string | null) => Promise<GuestRegistrationResult>;
  protectIdentity?: boolean;
  autoScan?: boolean;
  autoSave?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
  onCancelDraft?: () => void;
  guestId: string | null;
  vizaReservationId?: string;
  occurredAt?: string | null;
  onCompletenessChange?: (missing: string[]) => void;
  onSaved?: (guest: GuestVizaRow) => void;
}

export function GuestDetailsSection({ guestId, vizaReservationId, occurredAt, onCompletenessChange, onSaved, draft, onRegister, protectIdentity = false, autoScan = false, onCancelDraft, autoSave = false, onSavePendingChange }: GuestDetailsSectionProps) {
  const { t } = useTranslation();
  const [guest, setGuest] = useState<GuestVizaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const autosaving = autoSave && !draft && !!guestId;
  const markDirty = () => {
    revision.current += 1;
    setDirty(true);
    setSaveFailed(false);
    if (autosaving) onSavePendingChange?.(true);
  };
  const [scanOpen, setScanOpen] = useState(false);
  // The reader's output for this guest: loaded with the guest, replaced by a new scan, cleared by "remove".
  const [scan, setScan] = useState<VizaDocumentScan | null>(null);
  const [scanChanged, setScanChanged] = useState(false);
  const [optical, setOptical] = useState<OpticalGuestFields>({});
  const [hasExtraColumns, setHasExtraColumns] = useState(false);
  const [hasReviewColumns, setHasReviewColumns] = useState(false);
  const [verified, setVerified] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);

  useEffect(() => {
    setOptical({});
    setSaveFailed(false);
    setSavedAt(null);
    setExpanded(false);
    setGuest(null);
    setVerified(false);
    setShowAllFields(false);
    setMatchId(null);
    setRegisterError(null);
    if (draft) {
      const patch = draft.result ? guestScanPatch(draft.result, draft.optical) : {};
      const mother = draft.optical.mother_name?.trim().split(/\s+/);
      const initial: GuestVizaRow = {
        id: 'unsaved', first_name: '', last_name: '', nationality: null, date_of_birth: null,
        birth_last_name: null, birth_first_name: null, birth_place: null, gender: null,
        mother_name: null, mother_family_name: null, mother_given_name: null,
        id_document_type: null, id_document_number: null, visa_number: null, entry_date: null, entry_place: null,
        ...patch, ...(mother?.length === 2 ? { mother_family_name: mother[0], mother_given_name: mother[1] } : {}),
        viza_review: { reservation_id: vizaReservationId, scan_reviewed: !!draft.result },
      };
      setGuest(initial);
      setScan(draft.result ? toVizaDocumentScan(draft.result) : null);
      setOptical(draft.optical);
      setScanChanged(true);
      setHasExtraColumns(true);
      setHasReviewColumns(true);
      setDirty(true);
      setExpanded(true);
      setLoading(false);
      return;
    }
    if (!guestId) { setGuest(null); setScan(null); onCompletenessChange?.(openItems(null, vizaReservationId, occurredAt)); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      const guests = supabase.from('guests') as never as {
        select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }> } };
      };
      let { data, error } = await guests.select(`${BASE_COLUMNS}, ${EXTRA_COLUMNS}, ${REVIEW_COLUMNS}`).eq('id', guestId).maybeSingle();
      const reviewed = !error;
      if (error) ({ data, error } = await guests.select(`${BASE_COLUMNS}, ${EXTRA_COLUMNS}`).eq('id', guestId).maybeSingle());
      const extended = !error;
      if (error) ({ data, error } = await guests.select(BASE_COLUMNS).eq('id', guestId).maybeSingle());
      if (!alive) return;
      const { document_scan: storedScan, ...columns } = (data ?? {}) as Record<string, unknown>;
      const row = (data ? { birth_last_name: null, birth_first_name: null, entry_date: null, entry_place: null, ...columns } : null) as GuestVizaRow | null;
      setGuest(row);
      setExpanded(openItems(row, vizaReservationId, occurredAt).length > 0);
      setScan((storedScan as VizaDocumentScan | null) ?? null);
      setScanChanged(false);
      setHasExtraColumns(extended);
      setHasReviewColumns(reviewed);
      setDirty(false);
      onCompletenessChange?.(openItems(row, vizaReservationId, occurredAt));
      setLoading(false);
      if (autoScan && row) { setExpanded(true); setScanOpen(true); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, loadAttempt, vizaReservationId, draft, autoScan]);

  const invalidateConfirmation = () => { setVerified(false); setMatchId(null); setRegisterError(null); };
  const set = (field: Exclude<keyof GuestVizaRow, 'viza_review'>, value: string) => {
    invalidateConfirmation();
    setGuest(g => g ? { ...g, [field]: value || null } : g);
    markDirty();
  };

  const review: VizaReview = guest?.viza_review?.reservation_id === vizaReservationId ? guest?.viza_review ?? {} : {};
  const setReview = (patch: Partial<VizaReview>) => {
    invalidateConfirmation();
    setGuest(g => g ? { ...g, viza_review: { ...review, ...patch, reservation_id: vizaReservationId } } : g);
    markDirty();
  };

  // Names are required columns: keep the text as typed, never null.
  const setName = (field: 'first_name' | 'last_name', value: string) => {
    invalidateConfirmation();
    setGuest((g) => (g ? { ...g, [field]: value } : g));
    markDirty();
  };

  // Fill from a scanned passport/ID. The document is the guest's legal
  // identity, so what it says replaces the booking's name and details; the
  // receptionist then corrects anything misread (sent to VIZA as a manual
  // correction next to the unchanged reading) and presses Save.
  const applyScan = (result: MrzReadResult, opticalFields: OpticalGuestFields = {}, confirmNameChange = false): ScanApplyOutcome => {
    if (!guest || loading || (vizaReservationId && !hasReviewColumns)) return 'unavailable';
    // A scan for a different occupant must not overwrite this saved profile.
    if (protectIdentity && !draft && guest) {
      const next = guestScanPatch(result, opticalFields);
      const normalize = (v?: string | null) => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const knownName = normalize(guest.first_name) + '|' + normalize(guest.last_name);
      const readName = normalize(next.first_name) + '|' + normalize(next.last_name);
      const sameNumber = !!guest.id_document_number && normalize(guest.id_document_number) === normalize(next.id_document_number) && guest.id_document_type === next.id_document_type && recognizedNationality(guest.nationality) === recognizedNationality(next.nationality);
      const dobMismatch = !!guest.date_of_birth && !!next.date_of_birth && guest.date_of_birth !== next.date_of_birth;
      const nameMismatch = !sameNumber && knownName !== '|' && readName !== knownName;
      if (dobMismatch) return 'identity-mismatch';
      if (nameMismatch) {
        // Only a name-only, unverified profile can be corrected after explicit
        // confirmation that this is the same occupant, not a replacement guest.
        const establishedIdentity = !!(guest.date_of_birth || guest.id_document_number || scan || guest.viza_review?.scan_reviewed);
        if (establishedIdentity || !hasExtraColumns || !next.first_name || !next.last_name || !result.valid) return 'identity-mismatch';
        if (!confirmNameChange) return 'confirm-name-change';
      }
    }
    invalidateConfirmation();
    setGuest(g => {
      if (!g) return g;
      const proposals = Object.fromEntries(Object.entries(opticalFields).filter(([, value]) => typeof value === 'string' && value.trim() !== '')) as OpticalGuestFields;
      const patch = guestScanPatch(result, proposals);
      const normalizeNumber = (value?: string | null) => value?.trim().toUpperCase() || '';
      const number = normalizeNumber(result.fields.documentNumber);
      const previous = [normalizeNumber(scan?.fields.okmanyAzonositoSzam), normalizeNumber(g.id_document_number)].filter(Boolean);
      const changedDocument = !!number && previous.length > 0 && !previous.includes(number) && !previous.includes(normalizeNumber(patch.id_document_number));
      const mother = proposals.mother_name?.trim().split(/\s+/);
      const currentReview = g.viza_review?.reservation_id === vizaReservationId ? g.viza_review : {};
      return {
        ...g,
        ...(changedDocument && vizaReservationId ? {
          birth_last_name: null, birth_first_name: null, birth_place: null,
          mother_name: null, mother_family_name: null, mother_given_name: null,
        } : {}),
        ...patch,
        ...(vizaReservationId ? {
          ...(mother?.length === 2 ? { mother_family_name: mother[0], mother_given_name: mother[1] } :
            mother && mother.length > 2 ? { mother_family_name: null, mother_given_name: null } : {}),
          viza_review: { ...(changedDocument ? {} : currentReview), reservation_id: vizaReservationId, scan_reviewed: true },
        } : {}),
      };
    });
    setShowAllFields(false);
    setOptical(opticalFields);
    setScan(toVizaDocumentScan(result));
    setScanChanged(true);
    markDirty();
    setExpanded(true);
    if (!autosaving) toast.success(t('pms.scan.applied'));
    return 'applied';
  };

  const removeScan = () => {
    invalidateConfirmation();
    setOptical({});
    setScan(null);
    if (vizaReservationId) setReview({ scan_reviewed: false });
    setScanChanged(true);
    markDirty();
  };

  const save = async () => {
    if (!guest || !dirty || inFlight.current || (vizaReservationId && !hasReviewColumns)) return;
    const savingRevision = revision.current;
    inFlight.current = true;
    setSaveFailed(false);
    setSaving(true);
    const savedGuest = vizaReservationId ? { ...guest, mother_name: [guest.mother_family_name, guest.mother_given_name].filter(Boolean).join(' ') || (review.mother_name_absent ? null : guest.mother_name) } : guest;
    const payload = {
      first_name: guest.first_name,
      last_name: guest.last_name,
      nationality: guest.nationality, date_of_birth: guest.date_of_birth || null,
      birth_place: guest.birth_place, gender: guest.gender,
      id_document_type: guest.id_document_type, id_document_number: guest.id_document_number,
      visa_number: guest.visa_number, mother_name: savedGuest.mother_name,
      ...(hasReviewColumns && vizaReservationId ? { mother_family_name: guest.mother_family_name ?? null, mother_given_name: guest.mother_given_name ?? null, viza_review: guest.viza_review ?? null } : {}),
      ...(hasExtraColumns ? {
        birth_last_name: guest.birth_last_name, birth_first_name: guest.birth_first_name,
        entry_date: guest.entry_date || null, entry_place: guest.entry_place,
      } : {}),
      ...(scanChanged ? { document_scan: scan } : {}),
    };
    if (draft && onRegister) {
      try {
        const result = await onRegister(payload, matchId);
        if (result.status === 'match') setMatchId(result.guest_id);
        else { setDirty(false); onSaved?.({ ...savedGuest, id: result.guest_id }); }
      } catch {
        setRegisterError(t('pms.express.registerFailed'));
      } finally { inFlight.current = false; setSaving(false); }
      return;
    }
    // Generated types may lag behind the latest migration for the new columns.
    try {
      const update = (supabase.from('guests') as never as {
        update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> & { select: (columns: string) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }> } } };
      }).update(payload).eq('id', guest.id);
      if (autosaving) {
        // An RLS-filtered update may succeed with zero affected rows. Only
        // acknowledge a save once the server returns the actual guest id.
        const { data, error } = await update.select('id').maybeSingle();
        if (error || data?.id !== guest.id) throw new Error('Guest update not acknowledged');
      } else {
        const { error } = await update;
        if (error) throw error;
      }
      // A newer edit may have arrived while this request was in flight.
      // Never replace that text, clear its dirty flag or unlock navigation.
      if (revision.current !== savingRevision) return;
      setDirty(false);
      setScanChanged(false);
      setSavedAt(new Date());
      setGuest(savedGuest);
      onCompletenessChange?.(openItems(savedGuest, vizaReservationId, occurredAt));
      onSaved?.(savedGuest);
      if (autosaving) onSavePendingChange?.(false);
      else toast.success(t('pms.guest.saved'));
    } catch {
      if (revision.current === savingRevision) setSaveFailed(true);
      if (!autosaving) toast.error(t('pms.guest.saveFailed'));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!autosaving || !guest || !dirty || saving || saveFailed || scanOpen || (vizaReservationId && !hasReviewColumns)) return;
    const timeout = window.setTimeout(() => { void save(); }, 650);
    return () => window.clearTimeout(timeout);
    // save is intentionally scheduled from the current form snapshot, not
    // from unstable parent callbacks or every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaving, guest, dirty, saving, saveFailed, scanOpen, scan, scanChanged, vizaReservationId, hasReviewColumns]);

  if (!guestId && !draft) return null;
  const missing = vizaReservationId ? vizaAdmissionFields(guest, vizaReservationId, vizaArrivalDay(occurredAt)) : vizaMissingFields(guest);
  const problems = vizaReservationId ? [] : vizaProblems(guest);
  const open = missing.length + problems.length;
  const needsDocument = documentRequired(guest?.date_of_birth, vizaArrivalDay(occurredAt));
  const problemText: Record<VizaProblem, string> = {
    birthNamePair: t('pms.guest.problem.birthNamePair'), motherName: t('pms.guest.problem.motherName'),
    entryDate: t('pms.guest.problem.entryDate'), nationality: t('pms.guest.problem.nationality'),
    birthDate: t('pms.guest.problem.birthDate'),
  };
  // Under each field the reader filled: unchanged from the document, or corrected by hand.
  const mark = (field: Exclude<keyof GuestVizaRow, 'id' | 'viza_review'>) => {
    const opticalValue = optical[field as keyof OpticalGuestFields];
    if (guest && opticalValue && guest[field] === opticalValue) return <p className="flex items-start gap-1 text-xs leading-snug text-amber-700 dark:text-amber-400"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" /> {t('pms.scan.printedFieldsReview')}</p>;
    const state = guest ? scanFieldState(field, guest, scan) : null;
    if (!state) return null;
    if (state === 'fromDocument' && scan?.valid === false) return <p className="flex items-start gap-1 text-xs leading-snug text-amber-700 dark:text-amber-400"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" /> {t('pms.scan.fieldNeedsReview')}</p>;
    return state === 'fromDocument'
      ? <p className="flex items-start gap-1 text-xs leading-snug text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> {t('pms.guest.fromDocument')}</p>
      : <p className="flex items-start gap-1 text-xs leading-snug text-amber-700 dark:text-amber-400"><PencilLine className="mt-0.5 h-3 w-3 shrink-0" /> {t('pms.guest.correctedByHand')}</p>;
  };
  const read = scan?.fields;
  const compactReview = (!!draft || protectIdentity) && !!scan?.valid && !!read;
  const hideExtracted = (field: Exclude<keyof GuestVizaRow, 'id' | 'viza_review'>) => compactReview && !showAllFields && !!guest && !missing.includes(field) && !optical[field as keyof OpticalGuestFields] && scanFieldState(field,guest,scan)==='fromDocument';
  const euEea = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO']);
  const knownNationality = recognizedNationality(guest?.nationality);
  const entryOptional = !!knownNationality && (euEea.has(knownNationality) || knownNationality === 'CH') && !guest?.visa_number && !guest?.entry_date && !guest?.entry_place;
  const skipBirthName = !!guest && !guest.birth_last_name?.trim() && !guest.birth_first_name?.trim() && !review.birth_name_absent;
  const skipMotherName = !!guest && !guest.mother_name?.trim() && !guest.mother_family_name?.trim() && !guest.mother_given_name?.trim() && !review.mother_name_absent;
  const absent = (key: 'birth_name_absent' | 'birth_place_absent' | 'mother_name_absent') => vizaReservationId && guest && !isHungarianId(guest) && (needsDocument || !!guest.id_document_number) ? (
    <label className="col-span-2 flex items-center gap-2 text-xs">
      <input type="checkbox" className="!w-4 !h-4" checked={review[key] === true} onChange={e => setReview({ [key]: e.target.checked })} />
      {t('pms.guest.notOnDocument')}
    </label>
  ) : null;
  const fieldLabel: Record<string, string> = {
    last_name: t('pms.guest.familyName'), first_name: t('pms.guest.givenName'),
    nationality: t('pms.guest.nationality'), date_of_birth: t('pms.guest.birthDate'),
    birth_last_name: t('pms.guest.birthFamilyName'), birth_first_name: t('pms.guest.birthGivenName'), mother_name: t('pms.guest.motherName'),
    mother_family_name: t('pms.guest.motherFamily'), mother_given_name: t('pms.guest.motherGiven'),
    manual_reason: t('pms.guest.manualReason'), parent_statement: t('pms.guest.parentStatement'),
    visa_number: t('pms.guest.visaNumber'), entry_date: t('pms.guest.entryDate'), entry_place: t('pms.guest.entryPlace'),
    birth_place: t('pms.guest.birthPlace'), gender: t('pms.guest.gender'),
    id_document_type: t('pms.guest.docType'), id_document_number: t('pms.guest.docNumber'),
  };

  return (
    <section className="min-w-0 rounded-xl border border-border/80 bg-card text-card-foreground" data-training="fd-guest-viza">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
        className="grid w-full min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 px-3 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <IdCard className="h-4 w-4 text-primary shrink-0" />
        <span className="min-w-0 break-words leading-snug">{t('pms.guest.detailsTitle')}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <span className="col-start-2 col-end-4 min-w-0">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open === 0
          ? <Badge variant="outline" className="max-w-full whitespace-normal border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mr-1 h-3.5 w-3.5 shrink-0" />{t('pms.guest.complete')}</Badge>
          : <Badge variant="outline" className="max-w-full whitespace-normal border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">{t('pms.guest.missing')}: {open}</Badge>}
        </span>
      </button>
      {autosaving && !loading && guest && <div role="status" aria-live="polite" className="px-3 pb-2 flex flex-wrap items-center gap-1.5 text-xs">
        {saveFailed || (dirty && !!vizaReservationId && !hasReviewColumns) ? <><TriangleAlert className="h-3.5 w-3.5 text-destructive" /><span className="text-destructive">{t('pms.guest.autosaveFailed')}</span><Button type="button" size="sm" variant="outline" disabled={saving || (!!vizaReservationId && !hasReviewColumns)} onClick={() => void save()}>{t('pms.guest.autosaveRetry')}</Button></>
          : dirty || saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">{t('pms.guest.autosaving')}</span></>
          : savedAt ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /><span className="text-emerald-700 dark:text-emerald-400">{t('pms.guest.autosaved')} · {savedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></>
          : <span className="text-muted-foreground">{t('pms.guest.autosaveEnabled')}</span>}
      </div>}
      {!loading && !guest && expanded && (
        <div role="alert" className="px-3 pb-3 space-y-2">
          <p className="text-sm text-destructive">{t('pms.guest.vizaArrivalBlocked')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setLoadAttempt((n) => n + 1)}>{t('ntak.refreshReports')}</Button>
        </div>
      )}
      {guest && expanded && (
        <div className="min-w-0 space-y-4 border-t border-border/60 px-3 py-3">
          <Button type="button" size="sm" variant={read ? 'outline' : 'default'} className="min-h-11 h-auto w-full gap-2 whitespace-normal py-2" onClick={() => setScanOpen(true)} data-training="fd-id-scan-open">
            <ScanLine className="h-4 w-4" /> {read ? t('pms.scan.retry') : t('pms.scan.button')}
          </Button>
          {read && (
            <div className={`min-w-0 rounded-lg border p-3 ${scan?.valid === false ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`} data-training="fd-guest-scan-panel">
              <div className="flex min-w-0 items-start gap-2">
                {scan?.valid === false ? <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words text-sm font-semibold leading-snug">{t('pms.guest.scanPanelTitle')}</p>
                  {scan?.read_at && <time className="block text-xs text-muted-foreground">{new Date(scan.read_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</time>}
                </div>
                <Button type="button" size="sm" variant="ghost" className="min-h-9 h-auto max-w-[45%] shrink-0 gap-1 whitespace-normal px-2 text-xs text-muted-foreground" onClick={removeScan}><X className="mt-0.5 h-3 w-3 shrink-0" /> {t('pms.guest.scanRemove')}</Button>
              </div>
              <dl className="mt-3 grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-2 border-t border-border/60 pt-3 text-xs leading-snug [&_dt]:break-words [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:font-medium [&_dd]:text-foreground">
                <dt className="font-sans text-muted-foreground">{t('pms.scan.name')}</dt><dd>{[read.csaladnev, read.utonev].filter(Boolean).join(', ') || '—'}</dd>
                <dt className="font-sans text-muted-foreground">{t('pms.guest.birthDate')}</dt><dd>{read.szuletesiDatum ?? '—'}</dd>
                <dt className="font-sans text-muted-foreground">{t('pms.guest.nationality')}</dt><dd>{read.allampolgarsagKod ?? '—'}</dd>
                <dt className="font-sans text-muted-foreground">{t('pms.guest.docNumber')}</dt><dd>{read.okmanyAzonositoSzam ?? '—'}</dd>
                {compactReview && <><dt className="font-sans text-muted-foreground">{t('pms.guest.gender')}</dt><dd>{read.nem==='NO'?t('pms.guest.genderFemale'):read.nem==='FERFI'?t('pms.guest.genderMale'):read.nem?t('pms.guest.genderOther'):'—'}</dd>
                <dt className="font-sans text-muted-foreground">{t('pms.guest.docType')}</dt><dd>{read.okmanyTipus==='UTLEVEL'?t('pms.guest.docPassport'):read.okmanyTipus==='SZEM_IG'?t('pms.guest.docIdCard'):read.okmanyTipus??'—'}</dd></>}
              </dl>
              <p className="mt-3 border-t border-border/60 pt-2.5 text-xs leading-relaxed text-muted-foreground">{t('pms.guest.scanPanelNote')}</p>
            </div>
          )}
          {compactReview && <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg bg-muted/50 px-3 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">{t('pms.express.reviewExtracted')}</p>
            <Button type="button" variant="ghost" size="sm" className="min-h-10 h-auto w-full justify-start gap-2 whitespace-normal px-2 text-primary" aria-expanded={showAllFields} onClick={()=>setShowAllFields(v=>!v)}><PencilLine className="h-3.5 w-3.5"/>{t(showAllFields?'pms.express.hideExtracted':'pms.express.editExtracted')}</Button>
          </div>}
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
          <div className="grid w-full min-w-0 grid-cols-2 gap-x-3 gap-y-4 [&>div]:min-w-0 [&>div:not([hidden])]:flex [&>div:not([hidden])]:flex-col [&>div:not([hidden])]:gap-1.5 [&>div>label]:leading-snug [&>div>label:first-child]:min-h-[2rem] [&_input]:min-w-0 [&_input]:max-w-full [&_input]:w-full [&_input]:box-border [&_button]:min-w-0">
            <div hidden={hideExtracted('last_name')}>
              <Label className="text-xs">{t('pms.guest.familyName')}</Label>
              <Input className="h-11 bg-background/70 text-foreground" value={guest.last_name ?? ''} onChange={(e) => setName('last_name', e.target.value)} />
              {mark('last_name')}
            </div>
            <div hidden={hideExtracted('first_name')}>
              <Label className="text-xs">{t('pms.guest.givenName')}</Label>
              <Input className="h-11 bg-background/70 text-foreground" value={guest.first_name ?? ''} onChange={(e) => setName('first_name', e.target.value)} />
              {mark('first_name')}
            </div>
            {vizaReservationId && guest.id_document_type === 'passport' && review.scan_reviewed && (skipBirthName || skipMotherName) && <div className="col-span-2 rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">{t('pms.guest.confirmAbsentHint')}</p>
              <Button type="button" variant="outline" size="sm" className="h-auto min-h-10 w-full whitespace-normal" onClick={() => setReview({ ...(skipBirthName ? { birth_name_absent: true } : {}), ...(skipMotherName ? { mother_name_absent: true } : {}) })}>{t('pms.guest.confirmAbsentNames')}</Button>
            </div>}
            {hasExtraColumns && (
              <>
                <div>
                  <Label className="text-xs">{t('pms.guest.birthFamilyName')}</Label>
                  <Input className="h-11 bg-background/70 text-foreground" value={guest.birth_last_name ?? ''} onChange={(e) => set('birth_last_name', e.target.value)} />
                  {mark('birth_last_name')}
                </div>
                <div>
                  <Label className="text-xs">{t('pms.guest.birthGivenName')}</Label>
                  <Input className="h-11 bg-background/70 text-foreground" value={guest.birth_first_name ?? ''} onChange={(e) => set('birth_first_name', e.target.value)} />
                  {mark('birth_first_name')}
                </div>
                {absent('birth_name_absent')}
              </>
            )}
            {vizaReservationId ? <>
              {guest.mother_name && !guest.mother_family_name && !guest.mother_given_name && <p className="col-span-2 text-xs text-muted-foreground">{t('pms.guest.motherName')}: {guest.mother_name}</p>}
              <div><Label className="text-xs">{t('pms.guest.motherFamily')}</Label><Input className="h-11 bg-background/70 text-foreground" value={guest.mother_family_name ?? ''} onChange={e => set('mother_family_name', e.target.value)} /></div>
              <div><Label className="text-xs">{t('pms.guest.motherGiven')}</Label><Input className="h-11 bg-background/70 text-foreground" value={guest.mother_given_name ?? ''} onChange={e => set('mother_given_name', e.target.value)} /></div>
              {absent('mother_name_absent')}
            </> : <div className="col-span-2">
              <Label className="text-xs">{t('pms.guest.motherName')}</Label>
              <Input className="h-11 bg-background/70 text-foreground" value={guest.mother_name ?? ''} onChange={(e) => set('mother_name', e.target.value)} />
                  {mark('mother_name')}
            </div>}
            <div hidden={hideExtracted('nationality')}>
              <Label className="text-xs">{t('pms.guest.nationality')}</Label>
              <Input className="h-11 bg-background/70 uppercase text-foreground" maxLength={3} value={guest.nationality ?? ''} onChange={(e) => set('nationality', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="HU / DE / USA…" />
              {mark('nationality')}
            </div>
            <div hidden={hideExtracted('date_of_birth')}>
              <Label className="text-xs">{t('pms.guest.birthDate')}</Label>
              <Input className="block h-10 w-full min-w-0 max-w-full appearance-none text-left text-base sm:h-10" type="date" style={{ width: "100%", minWidth: 0, maxWidth: "100%", WebkitAppearance: "none", boxSizing: "border-box" }} value={guest.date_of_birth ?? ''} onChange={(e) => set('date_of_birth', e.target.value)} />
              {mark('date_of_birth')}
            </div>
            <div>
              <Label className="text-xs">{t('pms.guest.birthPlace')}</Label>
              <Input className="h-11 bg-background/70 text-foreground" value={guest.birth_place ?? ''} onChange={(e) => set('birth_place', e.target.value)} />
                  {mark('birth_place')}
                  {absent('birth_place_absent')}
            </div>
            <div hidden={hideExtracted('gender')}>
              <Label className="text-xs">{t('pms.guest.gender')}</Label>
              <Select value={guest.gender ?? ''} onValueChange={(v) => set('gender', v)}>
                <SelectTrigger className="h-11 bg-background/70 text-foreground"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t('pms.guest.genderMale')}</SelectItem>
                  <SelectItem value="female">{t('pms.guest.genderFemale')}</SelectItem>
                  <SelectItem value="other">{t('pms.guest.genderOther')}</SelectItem>
                </SelectContent>
              </Select>
              {mark('gender')}
            </div>
            <div hidden={hideExtracted('id_document_type')}>
              <Label className="text-xs">{t('pms.guest.docType')}</Label>
              <Select value={guest.id_document_type ?? ''} onValueChange={(v) => set('id_document_type', v)}>
                <SelectTrigger className="h-11 bg-background/70 text-foreground"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="passport">{t('pms.guest.docPassport')}</SelectItem>
                  <SelectItem value="id_card">{t('pms.guest.docIdCard')}</SelectItem>
                  <SelectItem value="driving_licence">{t('pms.guest.docDriving')}</SelectItem>
                  <SelectItem value="other">{t('pms.guest.docOther')}</SelectItem>
                </SelectContent>
              </Select>
              {mark('id_document_type')}
            </div>
            <div hidden={hideExtracted('id_document_number')}>
              <Label className="text-xs">{t('pms.guest.docNumber')}</Label>
              <Input className="h-11 bg-background/70 text-foreground" maxLength={100} value={guest.id_document_number ?? ''} onChange={(e) => set('id_document_number', e.target.value)} />
              {mark('id_document_number')}
            </div>
            {vizaReservationId && !needsDocument && !guest.id_document_number && <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" className="!w-4 !h-4" checked={review.parent_statement === true} onChange={e => setReview({ parent_statement: e.target.checked })} />{t('pms.guest.parentStatement')}</label>}
            {vizaReservationId && (needsDocument || guest.id_document_number) && !review.scan_reviewed && <div className="col-span-2"><Label className="text-xs">{t('pms.guest.manualReason')}</Label><Input value={review.manual_reason ?? ''} onChange={e => setReview({ manual_reason: e.target.value })} /></div>}
            {!needsDocument && <p className="col-span-2 text-[11px] text-muted-foreground">{t('pms.guest.under14')}</p>}
            <details key={entryOptional ? 'optional' : 'required'} open={!entryOptional || undefined} className="col-span-2 min-w-0 rounded-lg border border-border/70 bg-muted/20 p-3">
              <summary className="cursor-pointer break-words text-xs font-semibold leading-relaxed text-foreground">{t('pms.guest.thirdCountry')}</summary>
              <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&_label]:leading-snug">
                <div className="min-w-0 sm:col-span-2">
                  <Label className="text-xs">{t('pms.guest.visaNumber')}</Label>
                  <Input className="h-10 sm:h-10" maxLength={100} value={guest.visa_number ?? ''} onChange={(e) => set('visa_number', e.target.value)} />
                </div>
                {vizaReservationId && thirdCountry(guest) && <label className="sm:col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" className="!w-4 !h-4" checked={review.visa_exempt === true} onChange={e => setReview({ visa_exempt: e.target.checked })} />{t('pms.guest.visaExempt')}</label>}
                {hasExtraColumns && <>
                  <div className="min-w-0">
                    <Label className="text-xs">{t('pms.guest.entryDate')}</Label>
                    <Input className="block h-10 w-full min-w-0 max-w-full appearance-none text-left text-base sm:h-10" type="date" style={{ width: "100%", minWidth: 0, maxWidth: "100%", WebkitAppearance: "none", boxSizing: "border-box" }} max={new Date().toISOString().slice(0, 10)} value={guest.entry_date ?? ''} onChange={(e) => set('entry_date', e.target.value)} />
                  </div>
                  <div className="min-w-0">
                    <Label className="text-xs">{t('pms.guest.entryPlace')}</Label>
                    <Input className="h-10 sm:h-10" value={guest.entry_place ?? ''} onChange={(e) => set('entry_place', e.target.value)} />
                  </div>
                  {vizaReservationId && thirdCountry(guest) && <label className="sm:col-span-2 flex items-start gap-2 text-xs"><input type="checkbox" className="!w-4 !h-4 mt-0.5 shrink-0" checked={review.entry_details_absent === true} onChange={e => setReview({ entry_details_absent: e.target.checked })} />{t('pms.guest.entryDetailsAbsent')}</label>}
                </>}
              </div>
            </details>
          </div>
          {draft && <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} className="!w-5 !h-5 mt-0.5 shrink-0 accent-primary" />{t('pms.express.verify')}</label>
            {matchId && <p role="status" className="rounded-md bg-primary/10 p-2 text-sm">{t('pms.express.returningMatch')}</p>}
            {registerError && <p role="alert" className="text-sm text-destructive">{registerError}</p>}
          </div>}
          <Button type="button" size="sm" variant={dirty ? 'default' : 'outline'} className="min-h-11 h-auto w-full whitespace-normal py-2 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" disabled={!dirty || saving || (!!vizaReservationId && !hasReviewColumns) || (!!draft && (!verified || open > 0))} onClick={save}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t(draft ? matchId ? 'pms.express.confirmMatch' : 'pms.express.confirmGuest' : autosaving ? 'pms.guest.autosaveNow' : 'pms.guest.save')}
          </Button>
          {draft && <Button type="button" size="sm" variant="ghost" className="min-h-10 w-full text-muted-foreground" disabled={saving} onClick={onCancelDraft}>{t('common.cancel')}</Button>}
        </div>
      )}
      <IdScanDialog open={scanOpen} onOpenChange={setScanOpen} onApply={applyScan} />
    </section>
  );
}
