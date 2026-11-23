import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HOTELS, KIND_STYLE, formatHours, intlLocale, type WorkforceEntry, type WorkforceKind, type WorkforceShiftCode, type WorkforceStaff } from '@/lib/workforce/model';
import { workedMinutes } from '@/lib/workforce/cellParser';
import { useTranslation } from '@/hooks/useTranslation';

interface Props {
  open: boolean;
  staff: WorkforceStaff | null;
  date: string | null;
  entry: WorkforceEntry | undefined;
  readOnly: boolean;
  codes: WorkforceShiftCode[];
  onClose: () => void;
  onSave: (next: WorkforceEntry | null) => Promise<boolean>;
}

const KINDS = Object.keys(KIND_STYLE) as WorkforceKind[];

export function WorkforceEntryDialog({ open, staff, date, entry, readOnly, codes, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<WorkforceEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const { t, language } = useTranslation();

  useEffect(() => {
    if (!open || !staff || !date) return;
    setDraft(entry ? { ...entry } : {
      staff_id: staff.id, work_date: date, kind: 'work', code: null, start_time: null, end_time: null, day_fraction: 1,
      extra_minutes: 0, hotel_id: staff.hotel_id, raw_text: null, note: null, status: 'draft',
    });
  }, [open, staff, date, entry]);

  if (!staff || !date || !draft) return null;
  const set = (patch: Partial<WorkforceEntry>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const minutes = workedMinutes({ kind: draft.kind, start: draft.start_time, end: draft.end_time, dayFraction: draft.day_fraction, extraMinutes: draft.extra_minutes }, staff.daily_hours);
  const pretty = new Date(`${date}T12:00:00Z`).toLocaleDateString(intlLocale(language), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const save = async (next: WorkforceEntry | null) => {
    setSaving(true);
    const ok = await onSave(next ? { ...next, raw_text: null, status: 'draft' } : null);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{staff.full_name}</DialogTitle>
          <DialogDescription>{pretty}{readOnly ? ` · ${t('wf.g.readOnly')}` : ''}{entry?.status === 'draft' ? ` · ${t('wf.e.draft')}` : ''}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={readOnly || saving} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>{t('wf.e.quick')}</Label>
            <div className="flex flex-wrap gap-1">
              {codes.filter((c) => c.is_active).slice(0, 24).map((c) => (
                <Button key={c.id} type="button" size="sm" variant={draft.code === c.code ? 'default' : 'outline'} className="h-7 px-2 text-xs" title={c.label}
                  onClick={() => set({ kind: c.kind, code: c.code, start_time: c.start_time, end_time: c.end_time, day_fraction: c.day_fraction, hotel_id: c.hotel_id ?? draft.hotel_id })}>
                  {c.code}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t('wf.e.type')}</Label>
            <Select value={draft.kind} onValueChange={(v) => set({ kind: v as WorkforceKind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{t(`wf.k.${k}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('wf.e.at')}</Label>
            <Select value={draft.hotel_id ?? 'company'} onValueChange={(v) => set({ hotel_id: v === 'company' ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="company">{t('wf.m.company')}</SelectItem>
                {HOTELS.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('wf.e.start')}</Label>
            <Input type="time" value={draft.start_time ?? ''} onChange={(e) => set({ start_time: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label>{t('wf.e.end')}</Label>
            <Input type="time" value={draft.end_time ?? ''} onChange={(e) => set({ end_time: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label>{t('wf.e.code')}</Label>
            <Input value={draft.code ?? ''} maxLength={16} onChange={(e) => set({ code: e.target.value.trim() || null })} placeholder="SZ, K, PA" />
          </div>
          <div className="space-y-1">
            <Label>{t('wf.e.extra')}</Label>
            <Input type="number" step={15} min={-720} max={720} value={draft.extra_minutes} onChange={(e) => set({ extra_minutes: Math.max(-720, Math.min(720, Number(e.target.value) || 0)) })} />
          </div>
          <div className="space-y-1">
            <Label>{t('wf.e.part')}</Label>
            <Select value={String(draft.day_fraction)} onValueChange={(v) => set({ day_fraction: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t('wf.e.full')}</SelectItem>
                <SelectItem value="0.75">{t('wf.e.threeQ')}</SelectItem>
                <SelectItem value="0.5">{t('wf.e.half')}</SelectItem>
                <SelectItem value="0.25">{t('wf.e.quarter')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end text-sm text-muted-foreground">{t('wf.e.counts')} <strong className="mx-1 text-foreground">{formatHours(minutes)} {t('wf.my.hours')}</strong></div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t('wf.m.note')}</Label>
            <Textarea rows={2} maxLength={500} value={draft.note ?? ''} onChange={(e) => set({ note: e.target.value || null })} placeholder={t('wf.e.notePh')} />
          </div>
          {entry?.raw_text && <p className="text-xs text-muted-foreground sm:col-span-2">{t('wf.e.excel')} “{entry.raw_text}”</p>}
        </fieldset>
        <DialogFooter className="gap-2 sm:justify-between">
          {!readOnly && entry ? <Button variant="ghost" className="text-destructive" disabled={saving} onClick={() => void save(null)}>{t('wf.e.clearDay')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t(readOnly ? 'wf.g.close' : 'wf.g.cancel')}</Button>
            {!readOnly && <Button disabled={saving} onClick={() => void save(draft)}>{t('wf.g.save')}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
