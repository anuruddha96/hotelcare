import { useLocaleFormat } from '@/lib/i18n/localeFormat';
import { useEffect, useId, useRef, useState } from 'react';
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
import { ENTRY_DETAILS_REASONS, isVizaPlaceholder, validEntryAbsence } from '../../../supabase/functions/_shared/viza/fieldRules';
import { useTranslation } from '@/hooks/useTranslation';
import { documentRequired, scanFieldState, vizaMissingFields, vizaProblems, type VizaProblem, type VizaReview, vizaAdmissionFields, vizaFieldRequirements, isHungarianId, thirdCountry, vizaArrivalDay } from '@/lib/idScan/guestVizaChecks';

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
  document_scan?: unknown;
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

// Only discard values when this stay's review makes them inapplicable.
// Also remove stale placeholder values from otherwise inapplicable extras.
function clearInapplicableExtras(guest: GuestVizaRow, reservationId?: string, occurredAt?: string | null): GuestVizaRow {
  if (!reservationId) return guest;
  const review = guest.viza_review?.reservation_id === reservationId ? guest.viza_review : {};
  const requirements = vizaFieldRequirements(guest, reservationId, vizaArrivalDay(occurredAt));
  const clearVisa = requirements.visa_number.state === 'not_needed' &&
    (review.visa_exempt === true || isVizaPlaceholder(guest.visa_number));
  const clearEntry = requirements.entry_date.state === 'not_needed' && validEntryAbsence(review);
  const clearPlace = clearEntry || (requirements.entry_place.state === 'not_needed' && isVizaPlaceholder(guest.entry_place));
  return { ...guest, ...(clearVisa ? { visa_number: null } : {}),
    ...(clearEntry ? { entry_date: null } : {}), ...(clearPlace ? { entry_place: null } : {}) };
}

const expressErrorKeys: Record<string, string> = {
  EXPRESS_IDENTITY_CONFLICT: 'pms.express.identityConflict',
  EXPRESS_OCCUPANCY_FULL: 'pms.express.occupancyFull',
  EXPRESS_INVALID_DATA: 'pms.express.invalidData',
  EXPRESS_INVALID_ENTRY_REASON: 'pms.express.invalidEntryReason',
  EXPRESS_INVALID_SCAN: 'pms.express.invalidScan',
};

function expressErrorKey(error: unknown): string {
  const fields = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  for (const value of [fields.code, fields.message, typeof error === 'string' ? error : undefined]) {
    if (typeof value !== 'string') continue;
    const code = value.trim();
    if (Object.prototype.hasOwnProperty.call(expressErrorKeys, code)) return expressErrorKeys[code];
  }
  return 'pms.express.registerFailed';
}

export interface GuestRegistrationDraft {
  result: MrzReadResult | null;
  optical: OpticalGuestFields;
}
export type GuestRegistrationResult = { status: 'match' | 'registered'; guest_id: string };

interface GuestDetailsSectionProps {
  focusProblem?: {field:string;attempt:number}|null;
  draft?: GuestRegistrationDraft;
  onRegister?: (payload: Record<string, unknown>, confirmedMatch: string | null) => Promise<GuestRegistrationResult>;
  protectIdentity?: boolean;
  autoScan?: boolean;
  autoSave?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancelDraft?: () => void;
  guestId: string | null;
  vizaReservationId?: string;
  occurredAt?: string | null;
  onCompletenessChange?: (missing: string[]) => void;
  onSaved?: (guest: GuestVizaRow) => void;
}

export function GuestDetailsSection({ guestId, vizaReservationId, occurredAt, onCompletenessChange, onSaved, draft, onRegister, protectIdentity = false, autoScan = false, onCancelDraft, autoSave = false, onSavePendingChange, onDirtyChange, focusProblem }: GuestDetailsSectionProps) {
  const { t, language } = useTranslation();
  const locale = useLocaleFormat();
  const entryPlacesId = useId();
  const otherReasonId = useId();
  const [guest, setGuest] = useState<GuestVizaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const sectionRef=useRef<HTMLElement|null>(null);
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
    onDirtyChange?.(true);
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
        document_scan: draft.result ? toVizaDocumentScan(draft.result) : null,
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
      const loadedRow = (data ? { birth_last_name: null, birth_first_name: null, entry_date: null, entry_place: null, ...columns, ...(vizaReservationId ? {document_scan: storedScan ?? null} : {}) } : null) as GuestVizaRow | null;
      const row = loadedRow ? clearInapplicableExtras(loadedRow, vizaReservationId, occurredAt) : null;
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
    setGuest(g => g ? { ...g, [field]: value || null, ...(vizaReservationId && field === 'visa_number' && value ? {viza_review:{...(g.viza_review?.reservation_id===vizaReservationId ? g.viza_review : {}),reservation_id:vizaReservationId,visa_exempt:false}} : {}) } : g);
    markDirty();
  };

  const review: VizaReview = guest?.viza_review?.reservation_id === vizaReservationId ? guest?.viza_review ?? {} : {};
  const setReview = (patch: Partial<VizaReview>) => {
    invalidateConfirmation();
    setGuest(g => {
      if (!g) return g;
      const current = g.viza_review?.reservation_id===vizaReservationId ? g.viza_review : {};
      const next = {...current,...patch,reservation_id:vizaReservationId};
      if (next.entry_details_absent && next.entry_details_reason === 'lives_in_hungary_with_permit') next.visa_exempt=false;
      return {...g, ...(patch.visa_exempt === true ? {visa_number:null} : {}), ...(patch.entry_details_absent === true ? {entry_date:null,entry_place:null} : {}), viza_review:next};
    });
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
          document_scan: toVizaDocumentScan(result),
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
    if (vizaReservationId) { setReview({ scan_reviewed: false }); setGuest(g=>g?{...g,document_scan:null}:g); }
    setScanChanged(true);
    markDirty();
  };

  const save = async () => {
    if (!guest || !dirty || inFlight.current || (vizaReservationId && !hasReviewColumns)) return;
    const normalizedGuest = clearInapplicableExtras(guest, vizaReservationId, occurredAt);
    const saveRequirements = vizaReservationId ? vizaFieldRequirements({ ...normalizedGuest, document_scan: scan }, vizaReservationId, vizaArrivalDay(occurredAt)) : null;
    const placeholderFields = ['visa_number', 'entry_place', 'birth_place', 'birth_last_name', 'birth_first_name', 'mother_family_name', 'mother_given_name'] as const;
    if (saveRequirements && placeholderFields.some(field => saveRequirements[field].state !== 'not_needed' && isVizaPlaceholder(normalizedGuest[field]))) {
      setSaveFailed(true);
      return;
    }
    const savingRevision = revision.current;
    inFlight.current = true;
    setSaveFailed(false);
    setSaving(true);
    const savedGuest = vizaReservationId ? { ...normalizedGuest, document_scan:scan, mother_name: [guest.mother_family_name, guest.mother_given_name].filter(Boolean).join(' ') || (review.mother_name_absent ? null : guest.mother_name) } : guest;
    const payload = {
      first_name: guest.first_name,
      last_name: guest.last_name,
      nationality: guest.nationality, date_of_birth: guest.date_of_birth || null,
      birth_place: guest.birth_place, gender: guest.gender,
      id_document_type: guest.id_document_type, id_document_number: guest.id_document_number,
      visa_number: savedGuest.visa_number, mother_name: savedGuest.mother_name,
      ...(hasReviewColumns && vizaReservationId ? { mother_family_name: guest.mother_family_name ?? null, mother_given_name: guest.mother_given_name ?? null, viza_review: guest.viza_review ?? null } : {}),
      ...(hasExtraColumns ? {
        birth_last_name: guest.birth_last_name, birth_first_name: guest.birth_first_name,
        entry_date: savedGuest.entry_date || null, entry_place: savedGuest.entry_place,
      } : {}),
      ...(scanChanged ? { document_scan: scan } : {}),
    };
    if (draft && onRegister) {
      try {
        const result = await onRegister(payload, matchId);
        if (result.status === 'match') setMatchId(result.guest_id);
        else { setDirty(false); onSaved?.({ ...savedGuest, id: result.guest_id }); }
      } catch (error) {
        setRegisterError(t(expressErrorKey(error)));
      } finally { inFlight.current = false; setSaving(false); }
      return;
    }
    // Generated types may lag behind the latest migration for the new columns.
    try {
      const update = (supabase.from('guests') as never as {
        update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> & { select: (columns: string) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }> } } };
      }).update(payload).eq('id', guest.id);
      if (autosaving || onDirtyChange) {
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
      onDirtyChange?.(false);
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
  }, [autosaving, guest, dirty, saving, saveFailed, scanOpen, scan, scanChanged, vizaReservationId, occurredAt, hasReviewColumns]);

  useEffect(()=>{if(focusProblem){setExpanded(true);setShowAllFields(true);}},[focusProblem]);
  useEffect(()=>{
    if(!focusProblem || !expanded || loading || !guest)return;
    const timer=window.setTimeout(()=>{const target=sectionRef.current?.querySelector<HTMLElement>('[data-viza-field="'+focusProblem.field+'"]');(target??sectionRef.current)?.scrollIntoView?.({block:'center'});target?.focus();},50);
    return ()=>window.clearTimeout(timer);
  },[focusProblem,expanded,loading,guest]);
  if (!guestId && !draft) return null;
  const requirements = vizaReservationId ? vizaFieldRequirements(guest ? {...guest,document_scan:scan} : null,vizaReservationId,vizaArrivalDay(occurredAt)) : null;
  const missing = requirements ? Object.keys(requirements).filter(key=>!requirements[key].ok) : vizaMissingFields(guest);
  // A printed name is one review item even when both name inputs are missing.
  const printedGroups = new Map<string, string[]>();
  for (const key of missing) {
    if (requirements?.[key].state !== 'printed_only') continue;
    const group = key === 'birth_last_name' || key === 'birth_first_name' ? 'birth_name'
      : key === 'mother_family_name' || key === 'mother_given_name' ? 'mother_name' : key;
    printedGroups.set(group, [...(printedGroups.get(group) ?? []), key]);
  }
  const toConfirm = [...printedGroups.values()].filter(fields => fields.every(key => !guest?.[key as keyof GuestVizaRow])).length;
  const toFill = missing.filter(key => requirements?.[key].state !== 'printed_only').length + printedGroups.size - toConfirm;
  const counter = t('pms.guest.requirement.counter').replace('{n}',String(toFill)).replace('{m}',String(toConfirm));
  const fieldTag = (key: string) => requirements?.[key] ? <><span className={`block text-[11px] font-medium ${requirements[key].ok?'text-muted-foreground':'text-destructive'}`}>{t('pms.guest.requirement.'+({required:'required',printed_only:'printedOnly',optional:'optional',not_needed:'notNeeded'}[requirements[key].state]))}</span>{focusProblem?.field===key && !requirements[key].ok && <span role="alert" className="text-xs text-destructive">{t('pms.guest.vizaArrivalBlocked')}</span>}{requirements[key].messageKey==='pms.guest.requirement.placeholder' && <span role="alert" className="text-xs text-destructive">{t(requirements[key].messageKey)}</span>}</> : null;
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
    <label className="col-span-2 flex min-h-11 items-center gap-2 text-xs">
      <input type="checkbox" className="!w-6 !h-6" checked={review[key] === true} onChange={e => setReview({ [key]: e.target.checked })} />
      {t('pms.guest.notOnDocument')}
    </label>
  ) : null;
  const fieldLabel: Record<string, string> = {
    last_name: t('pms.guest.familyName'), first_name: t('pms.guest.givenName'),
    nationality: t('pms.guest.nationality'), date_of_birth: t('pms.guest.birthDate'),
    birth_last_name: t('pms.guest.birthFamilyName'), birth_first_name: t('pms.guest.birthGivenName'), mother_name: t('pms.guest.motherName'),
    mother_family_name: t('pms.guest.motherFamily'), mother_given_name: t('pms.guest.motherGiven'),
    manual_reason: t('pms.guest.manualReason'), parent_statement: t('pms.guest.parentStatement'), entry_details_reason:t('pms.guest.requirement.reason'),
    visa_number: t('pms.guest.visaNumber'), entry_date: t('pms.guest.entryDate'), entry_place: t('pms.guest.entryPlace'),
    birth_place: t('pms.guest.birthPlace'), gender: t('pms.guest.gender'),
    id_document_type: t('pms.guest.docType'), id_document_number: t('pms.guest.docNumber'),
  };

  return (
    <section ref={sectionRef} className="min-w-0 rounded-xl border border-border/80 bg-card text-card-foreground" data-training="fd-guest-viza">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
        className="grid w-full min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 px-3 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <IdCard className="h-4 w-4 text-primary shrink-0" />
        <span className="min-w-0 break-words leading-snug">{t('pms.guest.detailsTitle')}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <span className="col-start-2 col-end-4 min-w-0">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open === 0
          ? <Badge variant="outline" className="max-w-full whitespace-normal border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mr-1 h-3.5 w-3.5 shrink-0" />{t('pms.guest.complete')}</Badge>
          : <Badge variant="outline" className="max-w-full whitespace-normal border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">{requirements ? counter : `${t('pms.guest.missing')}: ${open}`}</Badge>}
        </span>
      </button>
      {autosaving && !loading && guest && <div role="status" aria-live="polite" className="px-3 pb-2 flex flex-wrap items-center gap-1.5 text-xs">
        {saveFailed || (dirty && !!vizaReservationId && !hasReviewColumns) ? <><TriangleAlert className="h-3.5 w-3.5 text-destructive" /><span className="text-destructive">{t('pms.guest.autosaveFailed')}</span><Button type="button" size="sm" variant="outline" disabled={saving || (!!vizaReservationId && !hasReviewColumns)} onClick={() => void save()}>{t('pms.guest.autosaveRetry')}</Button></>
          : dirty || saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">{t('pms.guest.autosaving')}</span></>
          : savedAt ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /><span className="text-emerald-700 dark:text-emerald-400">{t('pms.guest.autosaved')} · {locale.formatTime(savedAt)}</span></>
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
                  {scan?.read_at && <time className="block text-xs text-muted-foreground">{locale.formatDateTime(scan.read_at)}</time>}
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
              {requirements ? t('pms.guest.requirement.openItems') : t('pms.guest.missing')}: {missing.map((f) => <button key={f} type="button" className="mr-2 underline" onClick={e=>{setShowAllFields(true); const scope=e.currentTarget.closest('section'); const target=scope?.querySelector<HTMLElement>('[data-viza-field="'+f+'"]'); target?.scrollIntoView?.({block:'center'}); target?.focus();}}>{fieldLabel[f] ?? f}</button>)}
            </p>
          )}
          {problems.length > 0 && (
            <ul role="alert" className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {problems.map((problem) => <li key={problem} className="flex items-start gap-1.5"><TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {problemText[problem]}</li>)}
            </ul>
          )}
          <div className="grid w-full min-w-0 grid-cols-2 gap-x-3 gap-y-4 [&>div]:min-w-0 [&>div:not([hidden])]:flex [&>div:not([hidden])]:flex-col [&>div:not([hidden])]:gap-1.5 [&>div>label]:leading-snug [&>div>label:first-child]:min-h-[2rem] [&_input]:min-w-0 [&_input]:max-w-full [&_input]:w-full [&_input]:box-border [&_button]:min-w-0 data-[viza-attempted=true]:[&_[aria-invalid=true]]:border-destructive" data-viza-attempted={!!savedAt || saveFailed || !!focusProblem}>
            {requirements && <h4 className="col-span-2 text-sm font-semibold">{t('pms.guest.requirement.readGroup')}</h4>}
            <div hidden={hideExtracted('last_name')}>
              <Label className="text-xs">{t('pms.guest.familyName')}</Label>{fieldTag('last_name')}
              <Input data-viza-field="last_name" aria-invalid={!!requirements && !requirements['last_name']?.ok} className="h-11 bg-background/70 text-foreground" value={guest.last_name ?? ''} onChange={(e) => setName('last_name', e.target.value)} />
              {mark('last_name')}
            </div>
            <div hidden={hideExtracted('first_name')}>
              <Label className="text-xs">{t('pms.guest.givenName')}</Label>{fieldTag('first_name')}
              <Input data-viza-field="first_name" aria-invalid={!!requirements && !requirements['first_name']?.ok} className="h-11 bg-background/70 text-foreground" value={guest.first_name ?? ''} onChange={(e) => setName('first_name', e.target.value)} />
              {mark('first_name')}
            </div>
            <div hidden={hideExtracted('nationality')}>
              <Label className="text-xs">{t('pms.guest.nationality')}</Label>{fieldTag('nationality')}
              <Input data-viza-field="nationality" aria-invalid={!!requirements && !requirements['nationality']?.ok} className="h-11 bg-background/70 uppercase text-foreground" maxLength={3} value={guest.nationality ?? ''} onChange={(e) => set('nationality', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder={t('pms.guest.nationalityPlaceholder')} />
              {mark('nationality')}
              {knownNationality && <p className="text-xs text-muted-foreground">{new Intl.DisplayNames([language || 'en', 'en'], {type:'region'}).of(knownNationality)} ({knownNationality})</p>}
            </div>
            <div hidden={hideExtracted('date_of_birth')}>
              <Label className="text-xs">{t('pms.guest.birthDate')}</Label>{fieldTag('date_of_birth')}
              <Input data-viza-field="date_of_birth" aria-invalid={!!requirements && !requirements['date_of_birth']?.ok} className="block h-10 w-full min-w-0 max-w-full appearance-none text-left text-base sm:h-10" type="date" style={{ width: "100%", minWidth: 0, maxWidth: "100%", WebkitAppearance: "none", boxSizing: "border-box" }} value={guest.date_of_birth ?? ''} onChange={(e) => set('date_of_birth', e.target.value)} />
              {mark('date_of_birth')}
            </div>
            <div hidden={hideExtracted('gender')}>
              <Label className="text-xs">{t('pms.guest.gender')}</Label>{fieldTag('gender')}
              <Select value={guest.gender ?? ''} onValueChange={(v) => set('gender', v)}>
                <SelectTrigger data-viza-field="gender" aria-invalid={!!requirements && !requirements.gender.ok} className="h-11 bg-background/70 text-foreground"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t('pms.guest.genderMale')}</SelectItem>
                  <SelectItem value="female">{t('pms.guest.genderFemale')}</SelectItem>
                  <SelectItem value="other">{t('pms.guest.genderOther')}</SelectItem>
                </SelectContent>
              </Select>
              {mark('gender')}
            </div>
            <div hidden={hideExtracted('id_document_type')}>
              <Label className="text-xs">{t('pms.guest.docType')}</Label>{fieldTag('id_document_type')}
              <Select value={guest.id_document_type ?? ''} onValueChange={(v) => set('id_document_type', v)}>
                <SelectTrigger data-viza-field="id_document_type" aria-invalid={!!requirements && !requirements.id_document_type.ok} className="h-11 bg-background/70 text-foreground"><SelectValue placeholder="—" /></SelectTrigger>
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
              <Label className="text-xs">{t('pms.guest.docNumber')}</Label>{fieldTag('id_document_number')}
              <Input data-viza-field="id_document_number" aria-invalid={!!requirements && !requirements['id_document_number']?.ok} className="h-11 bg-background/70 text-foreground" maxLength={100} value={guest.id_document_number ?? ''} onChange={(e) => set('id_document_number', e.target.value)} />
              {mark('id_document_number')}
            </div>
            {requirements && <h4 className="col-span-2 border-t pt-3 text-sm font-semibold">{t('pms.guest.requirement.printedGroup')}</h4>}
            {vizaReservationId && guest.id_document_type === 'passport' && review.scan_reviewed && (skipBirthName || skipMotherName) && <div className="col-span-2 rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">{t('pms.guest.confirmAbsentHint')}</p>
              <Button type="button" variant="outline" size="sm" className="h-auto min-h-10 w-full whitespace-normal" onClick={() => setReview({ ...(skipBirthName ? { birth_name_absent: true } : {}), ...(skipMotherName ? { mother_name_absent: true } : {}) })}>{t('pms.guest.confirmAbsentNames')}</Button>
            </div>}
            {hasExtraColumns && (
              <>
                <div>
                  <Label className="text-xs">{t('pms.guest.birthFamilyName')}</Label>{fieldTag('birth_last_name')}
                  <Input data-viza-field="birth_last_name" aria-invalid={!!requirements && !requirements['birth_last_name']?.ok} className="h-11 bg-background/70 text-foreground" value={guest.birth_last_name ?? ''} onChange={(e) => set('birth_last_name', e.target.value)} />
                  {mark('birth_last_name')}
                </div>
                <div>
                  <Label className="text-xs">{t('pms.guest.birthGivenName')}</Label>{fieldTag('birth_first_name')}
                  <Input data-viza-field="birth_first_name" aria-invalid={!!requirements && !requirements['birth_first_name']?.ok} className="h-11 bg-background/70 text-foreground" value={guest.birth_first_name ?? ''} onChange={(e) => set('birth_first_name', e.target.value)} />
                  {mark('birth_first_name')}
                </div>
                {absent('birth_name_absent')}
              </>
            )}
            {vizaReservationId ? <>
              {guest.mother_name && !guest.mother_family_name && !guest.mother_given_name && <p className="col-span-2 text-xs text-muted-foreground">{t('pms.guest.motherName')}: {guest.mother_name}</p>}
              <div><Label className="text-xs">{t('pms.guest.motherFamily')}</Label>{fieldTag('mother_family_name')}<Input data-viza-field="mother_family_name" aria-invalid={!!requirements && !requirements['mother_family_name']?.ok} className="h-11 bg-background/70 text-foreground" value={guest.mother_family_name ?? ''} onChange={e => set('mother_family_name', e.target.value)} /></div>
              <div><Label className="text-xs">{t('pms.guest.motherGiven')}</Label>{fieldTag('mother_given_name')}<Input data-viza-field="mother_given_name" aria-invalid={!!requirements && !requirements['mother_given_name']?.ok} className="h-11 bg-background/70 text-foreground" value={guest.mother_given_name ?? ''} onChange={e => set('mother_given_name', e.target.value)} /></div>
              {absent('mother_name_absent')}
            </> : <div className="col-span-2">
              <Label className="text-xs">{t('pms.guest.motherName')}</Label>
              <Input className="h-11 bg-background/70 text-foreground" value={guest.mother_name ?? ''} onChange={(e) => set('mother_name', e.target.value)} />
                  {mark('mother_name')}
            </div>}
            <div>
              <Label className="text-xs">{t('pms.guest.birthPlace')}</Label>{fieldTag('birth_place')}
              <Input data-viza-field="birth_place" aria-invalid={!!requirements && !requirements['birth_place']?.ok} className="h-11 bg-background/70 text-foreground" maxLength={200} value={guest.birth_place ?? ''} onChange={(e) => set('birth_place', e.target.value)} />
                  {mark('birth_place')}
                  {guest.id_document_type==='passport' && requirements && <p className="text-xs text-muted-foreground">{t('pms.guest.requirement.birthHint')}</p>}
                  {absent('birth_place_absent')}
                  {guest.id_document_type==='passport' && review.birth_place_absent && <p className="text-xs text-amber-700 dark:text-amber-300">{t('pms.guest.requirement.birthWarning')}</p>}
            </div>
            {vizaReservationId && !needsDocument && !guest.id_document_number && <label className="col-span-2 flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="!w-6 !h-6" data-viza-field="parent_statement" checked={review.parent_statement === true} onChange={e => setReview({ parent_statement: e.target.checked })} />{t('pms.guest.parentStatement')}</label>}
            {vizaReservationId && (needsDocument || guest.id_document_number) && (!review.scan_reviewed || !scan) && <div className="col-span-2"><Label className="text-xs">{t('pms.guest.manualReason')}</Label>{fieldTag('manual_reason')}<Input data-viza-field="manual_reason" value={review.manual_reason ?? ''} onChange={e => setReview({ manual_reason: e.target.value })} /></div>}
            {!needsDocument && <p className="col-span-2 text-[11px] text-muted-foreground">{t('pms.guest.under14')}</p>}
            {(!vizaReservationId || thirdCountry(guest)) && <details key={entryOptional ? 'optional' : 'required'} open={!entryOptional || undefined} className="col-span-2 min-w-0 rounded-lg border border-border/70 bg-muted/20 p-3">
              <summary className="cursor-pointer break-words text-xs font-semibold leading-relaxed text-foreground">{t('pms.guest.thirdCountry')}</summary>
              <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&_label]:leading-snug">
                <div className="min-w-0 sm:col-span-2">
                  <Label className="text-xs">{t('pms.guest.visaNumber')}</Label>{fieldTag('visa_number')}
                  <Input data-viza-field="visa_number" aria-invalid={!!requirements && !requirements['visa_number']?.ok} className="h-10 sm:h-10" disabled={!!vizaReservationId && review.visa_exempt===true} maxLength={100} value={guest.visa_number ?? ''} onChange={(e) => set('visa_number', e.target.value)} />
                </div>
                {vizaReservationId && thirdCountry(guest) && <label className="sm:col-span-2 flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="!w-6 !h-6" disabled={review.entry_details_absent && review.entry_details_reason==='lives_in_hungary_with_permit'} checked={review.visa_exempt === true} onChange={e => setReview({ visa_exempt: e.target.checked })} />{t('pms.guest.visaExempt')}</label>}
                {hasExtraColumns && <>
                  <div className="min-w-0">
                    <Label className="text-xs">{t('pms.guest.entryDate')}</Label>{fieldTag('entry_date')}
                    <Input data-viza-field="entry_date" aria-invalid={!!requirements && !requirements['entry_date']?.ok} className="block h-10 w-full min-w-0 max-w-full appearance-none text-left text-base sm:h-10" type="date" style={{ width: "100%", minWidth: 0, maxWidth: "100%", WebkitAppearance: "none", boxSizing: "border-box" }} disabled={!!vizaReservationId && review.entry_details_absent===true} max={vizaArrivalDay(occurredAt).toISOString().slice(0,10)} min={guest.date_of_birth ?? undefined} value={guest.entry_date ?? ''} onChange={(e) => set('entry_date', e.target.value)} />
                    {vizaReservationId && <div className="flex gap-2">{[0,1].map(offset=><Button key={offset} type="button" variant="outline" size="sm" className="min-h-11 flex-1" disabled={review.entry_details_absent===true} onClick={()=>{const day=vizaArrivalDay(occurredAt);day.setUTCDate(day.getUTCDate()-offset);set('entry_date',day.toISOString().slice(0,10));}}>{t(offset?'pms.guest.requirement.yesterday':'pms.guest.requirement.today')}</Button>)}</div>}
                  </div>
                  <div className="min-w-0">
                    <Label className="text-xs">{t('pms.guest.entryPlace')}</Label>{fieldTag('entry_place')}
                    <Input data-viza-field="entry_place" aria-invalid={!!requirements && !requirements['entry_place']?.ok} className="h-10 sm:h-10" disabled={!!vizaReservationId && review.entry_details_absent===true} list={entryPlacesId} value={guest.entry_place ?? ''} onChange={(e) => set('entry_place', e.target.value)} />
                    <datalist id={entryPlacesId}>{["Budapest Liszt Ferenc Airport","Debrecen Airport","Hegyeshalom","Röszke","Záhony"].map(place=><option key={place} value={place}/>)}</datalist>
                    {vizaReservationId && <p className="text-xs text-muted-foreground">{t('pms.guest.requirement.entryHelp')}</p>}
                  </div>
                  {vizaReservationId && thirdCountry(guest) && <label className="sm:col-span-2 flex min-h-11 items-start gap-2 text-xs"><input type="checkbox" className="!w-6 !h-6 mt-0.5 shrink-0" checked={review.entry_details_absent === true} onChange={e => setReview({ entry_details_absent: e.target.checked })} />{t('pms.guest.entryDetailsAbsent')}</label>}
                  {vizaReservationId && thirdCountry(guest) && review.entry_details_absent && <div className="sm:col-span-2 space-y-2"><Label>{t('pms.guest.requirement.reason')}</Label>{fieldTag('entry_details_reason')}<Select value={review.entry_details_reason??''} onValueChange={value=>setReview({entry_details_reason:value as VizaReview['entry_details_reason']})}><SelectTrigger data-viza-field="entry_details_reason" className="min-h-11"><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{ENTRY_DETAILS_REASONS.map(reason=><SelectItem key={reason} value={reason}>{t('pms.guest.requirement.'+reason)}</SelectItem>)}</SelectContent></Select>{review.entry_details_reason==='other' && <div className="space-y-1.5"><Label htmlFor={otherReasonId}>{t('pms.guest.requirement.other')}</Label><Input id={otherReasonId} aria-describedby={`${otherReasonId}-hint`} value={review.entry_details_reason_text??''} onChange={e=>setReview({entry_details_reason_text:e.target.value})} minLength={10} /><p id={`${otherReasonId}-hint`} className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{t('pms.guest.requirement.minReasonLength')}</span><span aria-live="polite">{[...(review.entry_details_reason_text??'').trim()].length} / 10</span></p></div>}</div>}
                </>}
              </div>
            </details>}
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
