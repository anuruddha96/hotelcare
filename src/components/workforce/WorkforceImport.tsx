import { useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { fetchAllRows, type WorkforceData } from '@/hooks/useWorkforce';
import { DEFAULT_SHIFT_CODES, planWorkforceImport, readScheduleWorkbook, type ImportPlan, type WorkbookMonth } from '@/lib/workforce/excelImport';
import { KIND_STYLE, type WorkforceKind } from '@/lib/workforce/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const ENTRY_BATCH = 2500;

export function WorkforceImport({ data, today, onDone }: { data: WorkforceData; today: string; onDone: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [months, setMonths] = useState<WorkbookMonth[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const replan = async (all: WorkbookMonth[], keys: Set<string>) => {
    const staff = await fetchAllRows<{ id: string; full_name: string; nickname: string | null; profile_id: string | null; is_active: boolean }>(
      (a, b) => db.from('workforce_staff').select('id,full_name,nickname,profile_id,is_active').order('id').range(a, b));
    const profiles = await fetchAllRows<{ id: string; full_name: string | null; nickname: string | null }>(
      (a, b) => supabase.from('profiles').select('id,full_name,nickname').order('id').range(a, b) as never);
    setPlan(planWorkforceImport(all, {
      departments: data.departments, jobRoles: data.jobRoles, staff, profiles,
    }, { today, monthKeys: keys, newId: () => crypto.randomUUID() }));
  };

  const onFile = async (file: File) => {
    setBusy('Reading the workbook…'); setResult(null); setPlan(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellStyles: true, cellDates: true });
      const read = readScheduleWorkbook(XLSX as never, wb as never);
      if (!read.length) { toast.error('No month tabs found (expected tabs like "November 2026")'); return; }
      const keys = new Set(read.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`));
      setFileName(file.name); setMonths(read); setSelected(keys);
      await replan(read, keys);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Could not read the file');
    } finally { setBusy(null); }
  };

  const toggleMonth = async (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
    setBusy('Updating preview…');
    try { await replan(months, next); } finally { setBusy(null); }
  };

  const run = async () => {
    if (!plan) return;
    setBusy('Importing…'); setProgress(0);
    try {
      const totals = { departments: 0, job_roles: 0, staff: 0, entries: 0, notes: 0 };
      const call = async (payload: Record<string, unknown>) => {
        const { data: res, error } = await db.rpc('workforce_import', { _payload: payload, _overwrite: overwrite, _source: fileName });
        if (error) throw error;
        for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(res?.[k] ?? 0);
      };
      await call({
        departments: plan.departments, job_roles: plan.jobRoles, staff: plan.newStaff,
        shift_codes: data.shiftCodes.length ? [] : DEFAULT_SHIFT_CODES,
      });
      const batches = Math.ceil(plan.entries.length / ENTRY_BATCH);
      for (let i = 0; i < batches; i++) {
        await call({ entries: plan.entries.slice(i * ENTRY_BATCH, (i + 1) * ENTRY_BATCH) });
        setProgress(Math.round(((i + 1) / (batches + 1)) * 100));
      }
      await call({ notes: plan.notes });
      setProgress(100);
      setResult(`Imported ${totals.staff} new employees, ${totals.entries.toLocaleString('en-GB')} days and ${totals.notes} monthly remarks${overwrite ? ' (existing days overwritten)' : ' (days already in Hotel Care were kept)'}.`);
      toast.success('Schedule imported');
      onDone();
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? 'Import failed. Nothing after the failed batch was written; you can run it again safely.');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-5 w-5" />Import the Excel work schedule</CardTitle>
          <CardDescription>
            Reads every month tab, the department and name rows, cell colours (leave, sick, fixed day off, other hotels), remarks and leave balances.
            The file is read on this device; only the reviewed result is saved. Running it again only fills days that are still empty.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm hover:bg-muted">
            <Upload className="h-4 w-4" />{fileName ?? 'Choose WORK_SCHEDULE .xlsx'}
            <input type="file" accept=".xlsx,.xlsm,.xls" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          </label>
          {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{busy}</p>}
          {busy === 'Importing…' && <Progress value={progress} />}
          {result && <Alert><AlertDescription>{result}</AlertDescription></Alert>}
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>Months before {today.slice(0, 7)} and the current month are imported as published; later months as drafts you can still change and publish.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {months.map((m) => {
                const key = `${m.year}-${String(m.month).padStart(2, '0')}`;
                const stat = plan.months.find((x) => x.key === key);
                return (
                  <label key={key} className="flex items-center gap-2 rounded border px-2 py-1">
                    <Checkbox checked={selected.has(key)} onCheckedChange={() => void toggleMonth(key)} />
                    {m.sheet}{stat ? <span className="text-xs text-muted-foreground">{stat.entries} days · {stat.staff} people</span> : null}
                  </label>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="New employees" value={plan.newStaff.length} hint={`${plan.newStaff.filter((s) => s.is_active).length} active · ${plan.matchedStaff} already in Hotel Care`} />
              <Stat label="Days" value={plan.entries.length} hint={`${plan.entries.filter((e) => e.status === 'draft').length} drafts`} />
              <Stat label="Linked app accounts" value={plan.links.length} hint={plan.ambiguousLinks.length ? `${plan.ambiguousLinks.length} to link by hand` : undefined} />
              <Stat label="New departments / roles" value={plan.departments.length} hint={`${plan.jobRoles.length} job roles`} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(plan.byKind).sort((a, b) => b[1] - a[1]).map(([kind, n]) => {
                const st = KIND_STYLE[kind as WorkforceKind];
                return <span key={kind} className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: st.bg, color: st.fg }}>{st.label}: {n.toLocaleString('en-GB')}</span>;
              })}
            </div>
            {plan.ambiguousLinks.length > 0 && (
              <div>
                <p className="font-medium">Accounts to link by hand (Staff tab)</p>
                <ul className="list-disc pl-5 text-muted-foreground">{plan.ambiguousLinks.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            )}
            {plan.unreadable.length > 0 && (
              <div>
                <p className="font-medium">Texts kept as notes (marked “to confirm”)</p>
                <p className="text-muted-foreground">{plan.unreadable.slice(0, 12).map((u) => `“${u.text.replace(/\s+/g, ' ')}” ×${u.count}`).join(' · ')}</p>
              </div>
            )}
            <label className="flex items-center gap-2"><Switch checked={overwrite} onCheckedChange={setOverwrite} />Overwrite days that already exist in Hotel Care</label>
            <Button onClick={() => void run()} disabled={!!busy || !plan.entries.length}>Import {plan.entries.length.toLocaleString('en-GB')} days</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value.toLocaleString('en-GB')}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
