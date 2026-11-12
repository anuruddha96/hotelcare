import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HOTELS, KIND_STYLE, type WorkforceKind } from '@/lib/workforce/model';
import type { WorkforceData } from '@/hooks/useWorkforce';

type Row = Record<string, unknown> & { id?: string };
const KINDS = Object.keys(KIND_STYLE) as WorkforceKind[];
const NONE = '__none';

export function WorkforceSettings({ data, canEdit }: { data: WorkforceData; canEdit: boolean }) {
  const staffCount = (key: 'department_id' | 'job_role_id', id: string) => data.staff.filter((s) => s.is_active && s[key] === id).length;
  const save = async (table: Parameters<WorkforceData['saveReference']>[0], row: Row, done?: () => void) => {
    try { await data.saveReference(table, row); toast.success('Saved'); done?.(); }
    catch (err) { toast.error((err as { message?: string })?.message ?? 'Could not save'); }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Departments</CardTitle>
          <CardDescription>Columns of the schedule are grouped by department.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.departments.map((d) => (
            <EditableRow key={d.id} initial={d} disabled={!canEdit} onSave={(row) => save('workforce_departments', row)}
              render={(row, set) => (<>
                <input type="color" aria-label="Colour" className="h-9 w-10 rounded border bg-transparent" value={(row.color as string) ?? '#94a3b8'} onChange={(e) => set({ color: e.target.value })} />
                <Input className="flex-1" value={row.name as string} onChange={(e) => set({ name: e.target.value })} />
                <Input className="w-16" type="number" title="Order" value={row.sort_order as number} onChange={(e) => set({ sort_order: Number(e.target.value) })} />
                <span className="w-16 text-right text-xs text-muted-foreground">{staffCount('department_id', d.id)} staff</span>
                <Switch checked={row.is_active as boolean} onCheckedChange={(v) => set({ is_active: v })} title="Active" />
              </>)} />
          ))}
          {canEdit && <AddRow placeholder="New department" onAdd={(name) => save('workforce_departments', { name, color: '#64748b', sort_order: data.departments.length })} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job roles</CardTitle>
          <CardDescription>Assign roles to employees in the Staff tab. Roles feed the analytics.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.departments.map((d) => (
            <div key={d.id} className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.name}</p>
              {data.jobRoles.filter((r) => r.department_id === d.id).map((r) => (
                <EditableRow key={r.id} initial={r} disabled={!canEdit} onSave={(row) => save('workforce_job_roles', row)}
                  render={(row, set) => (<>
                    <Input className="flex-1" value={row.name as string} onChange={(e) => set({ name: e.target.value })} />
                    <Select value={row.department_id as string} onValueChange={(v) => set({ department_id: v })}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>{data.departments.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <span className="w-16 text-right text-xs text-muted-foreground">{staffCount('job_role_id', r.id)} staff</span>
                    <Switch checked={row.is_active as boolean} onCheckedChange={(v) => set({ is_active: v })} title="Active" />
                  </>)} />
              ))}
              {canEdit && <AddRow placeholder={`New role in ${d.name}`} onAdd={(name) => save('workforce_job_roles', { name, department_id: d.id, sort_order: 100 })} />}
            </div>
          ))}
          {!data.departments.length && <p className="text-sm text-muted-foreground">Add a department first.</p>}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Shift codes</CardTitle>
          <CardDescription>What a typed code means. Codes with times count those hours; others count the employee’s daily hours × part of day.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.shiftCodes.map((c) => (
            <EditableRow key={c.id} initial={c} disabled={!canEdit} onSave={(row) => save('workforce_shift_codes', row)}
              render={(row, set) => (<>
                <span className="inline-block h-6 w-6 shrink-0 rounded" style={{ backgroundColor: KIND_STYLE[row.kind as WorkforceKind].bg }} />
                <Input className="w-20" value={row.code as string} onChange={(e) => set({ code: e.target.value })} />
                <Input className="min-w-[160px] flex-1" value={row.label as string} onChange={(e) => set({ label: e.target.value })} />
                <Select value={row.kind as string} onValueChange={(v) => set({ kind: v })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_STYLE[k].label}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="w-28" type="time" value={(row.start_time as string) ?? ''} onChange={(e) => set({ start_time: e.target.value || null })} />
                <Input className="w-28" type="time" value={(row.end_time as string) ?? ''} onChange={(e) => set({ end_time: e.target.value || null })} />
                <Input className="w-20" type="number" step={0.25} min={0} max={1} title="Part of day" value={row.day_fraction as number} onChange={(e) => set({ day_fraction: Number(e.target.value) })} />
                <Select value={(row.hotel_id as string) ?? NONE} onValueChange={(v) => set({ hotel_id: v === NONE ? null : v })}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Own hotel</SelectItem>
                    {HOTELS.map((h) => <SelectItem key={h.id} value={h.id}>{h.short}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Switch checked={row.is_active as boolean} onCheckedChange={(v) => set({ is_active: v })} title="Active" />
              </>)} />
          ))}
          {canEdit && <AddRow placeholder="New code, e.g. R1" onAdd={(code) => save('workforce_shift_codes', { code, label: code, kind: 'work', day_fraction: 1, sort_order: data.shiftCodes.length })} />}
        </CardContent>
      </Card>
    </div>
  );
}

function EditableRow({ initial, render, onSave, disabled }: {
  initial: object; disabled: boolean;
  render: (row: Row, set: (patch: Row) => void) => React.ReactNode;
  onSave: (row: Row) => Promise<void>;
}) {
  const [row, setRow] = useState<Row>(initial as Row);
  const dirty = JSON.stringify(row) !== JSON.stringify(initial);
  return (
    <fieldset disabled={disabled} className="flex flex-wrap items-center gap-2">
      {render(row, (patch) => setRow((r) => ({ ...r, ...patch })))}
      <Button size="icon" variant={dirty ? 'default' : 'ghost'} disabled={!dirty} onClick={() => void onSave(row)} aria-label="Save"><Save className="h-4 w-4" /></Button>
    </fieldset>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (value: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) void onAdd(value.trim()).then(() => setValue('')); }}>
      <Input placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" variant="outline" size="icon" aria-label="Add"><Plus className="h-4 w-4" /></Button>
    </form>
  );
}
