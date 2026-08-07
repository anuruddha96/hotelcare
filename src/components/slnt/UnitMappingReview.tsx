import React, { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUnitMappings } from '@/hooks/useUnitMappings';
import { useVenues } from '@/hooks/useVenues';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { STATUS_LABELS, type MappingStatus, type UnitMapping } from '@/lib/slntUnitMapping';
import PrevioXlsxImporter from './PrevioXlsxImporter';

const STATUS_VARIANT: Record<MappingStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  suggested: 'secondary',
  confirmed: 'default',
  needs_review: 'outline',
  conflict: 'destructive',
  ignored: 'outline',
  applied: 'default',
};

/**
 * SLNT-only: manager review of draft Previo unit mappings. Nothing here
 * touches live housekeeping inventory — only the explicit
 * "Apply verified mapping" action creates rooms and venues.
 */
export const UnitMappingReview: React.FC = () => {
  const { profile } = useAuth();
  const { mappings, accounts, loading, refresh, orgSlug } = useUnitMappings();
  const { venues, refresh: refreshVenues } = useVenues();

  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountFilter, setAccountFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | MappingStatus>('open');

  const hotelId = mappings[0]?.hotel_id ?? profile?.assigned_hotel ?? 'slnt-group';

  const visible = useMemo(() => {
    return mappings.filter((m) => {
      if (accountFilter !== 'all' && m.pms_hotel_id !== accountFilter) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'open') return m.status !== 'applied' && m.status !== 'ignored';
      return m.status === statusFilter;
    });
  }, [mappings, accountFilter, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, UnitMapping[]>();
    for (const m of visible) {
      const key = `${m.pms_hotel_id ?? '—'} · ${m.suggested_venue_name ?? 'Unassigned'}`;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [visible]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of mappings) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [mappings]);

  const patch = async (ids: string[], values: Partial<UnitMapping>) => {
    if (!ids.length) return;
    setSaving(true);
    const { error } = await supabase
      .from('pms_unit_mappings')
      .update(values as never)
      .in('id', ids);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    refresh();
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleCluster = (rows: UnitMapping[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = rows.every((r) => next.has(r.id));
      rows.forEach((r) => (allIn ? next.delete(r.id) : next.add(r.id)));
      return next;
    });

  const reconcile = async () => {
    setReconciling(true);
    const { data, error } = await supabase.functions.invoke('slnt-previo-reconcile', { body: {} });
    setReconciling(false);
    if (error) {
      toast.error('Reconciliation failed — check the Previo account configuration');
      return;
    }
    // deno-lint-ignore no-explicit-any
    const report = (data as any)?.accounts ?? [];
    const notConfigured = report.filter((r: { status: string }) => r.status === 'not_configured').length;
    toast.success(
      notConfigured
        ? `Reconciled. ${notConfigured} Previo account(s) still need API credentials.`
        : 'Reconciled with the Previo API.',
    );
    refresh();
  };

  const applyVerified = async () => {
    const ids = mappings.filter((m) => m.status === 'confirmed').map((m) => m.id);
    if (!ids.length) {
      toast.error('Confirm at least one mapping first');
      return;
    }
    setApplying(true);
    const { data, error } = await supabase.functions.invoke('slnt-apply-unit-mappings', {
      body: { mapping_ids: ids },
    });
    setApplying(false);
    if (error) {
      toast.error('Apply failed');
      return;
    }
    // deno-lint-ignore no-explicit-any
    const res = data as any;
    toast.success(`${res?.applied ?? 0} unit(s) applied to housekeeping inventory`);
    refresh();
    refreshVenues();
  };

  if (!orgSlug) return null;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Previo unit mapping review</CardTitle>
            <CardDescription>
              Draft units from the Previo exports. Nothing becomes live housekeeping inventory until you confirm
              rows and press “Apply verified mapping”.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrevioXlsxImporter accounts={accounts} orgSlug={orgSlug} hotelId={hotelId} onImported={refresh} />
            <Button size="sm" variant="outline" onClick={reconcile} disabled={reconciling}>
              {reconciling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Re-run reconciliation
            </Button>
            <Button size="sm" onClick={applyVerified} disabled={applying || !counts.confirmed}>
              {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Rocket className="h-4 w-4 mr-1" />}
              Apply verified mapping ({counts.confirmed ?? 0})
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS_LABELS) as MappingStatus[]).map((s) =>
            counts[s] ? (
              <Badge key={s} variant={STATUS_VARIANT[s]}>
                {STATUS_LABELS[s]}: {counts[s]}
              </Badge>
            ) : null,
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Previo accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.pms_hotel_id}>
                  {a.label} · {a.pms_hotel_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open items</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS_LABELS) as MappingStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant="secondary"
            disabled={!selected.size || saving}
            onClick={() => patch([...selected], { status: 'confirmed' } as Partial<UnitMapping>)}
          >
            <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm ({selected.size})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!selected.size || saving}
            onClick={() => patch([...selected], { status: 'ignored' } as Partial<UnitMapping>)}
          >
            Mark ignored
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading draft mapping…
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to review in this view.</p>
        ) : (
          <div className="space-y-5">
            {grouped.map(([key, rows]) => (
              <div key={key} className="rounded-lg border">
                <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Checkbox
                      checked={rows.every((r) => selected.has(r.id))}
                      onCheckedChange={() => toggleCluster(rows)}
                      aria-label={`Select cluster ${key}`}
                    />
                    <span className="font-medium truncate">{key}</span>
                    <Badge variant="secondary">{rows.length}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => patch(rows.map((r) => r.id), { status: 'confirmed' } as Partial<UnitMapping>)}
                  >
                    Confirm cluster
                  </Button>
                </div>

                <div className="divide-y">
                  {rows.map((m) => (
                    <div key={m.id} className="grid gap-2 p-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
                      <Checkbox
                        checked={selected.has(m.id)}
                        onCheckedChange={() => toggle(m.id)}
                        aria-label={`Select ${m.source_name}`}
                      />

                      <div className="min-w-0">
                        <p className="text-sm truncate" title={m.source_name}>
                          {m.source_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          PMS {m.pms_hotel_id ?? '—'} · type {m.external_type_id ?? '—'} · unit{' '}
                          {m.external_room_id ?? '—'} · confidence {Math.round((m.confidence ?? 0) * 100)}%
                        </p>
                        {m.conflict_reason && (
                          <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {m.conflict_reason}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          className="h-8 text-sm"
                          defaultValue={m.canonical_room_name ?? ''}
                          aria-label="Canonical unit name"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== m.canonical_room_name) {
                              patch([m.id], { canonical_room_name: v } as Partial<UnitMapping>);
                            }
                          }}
                        />
                        <Input
                          className="h-8 text-sm"
                          defaultValue={m.suggested_venue_name ?? ''}
                          aria-label="Suggested venue"
                          list="slnt-venue-options"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (m.suggested_venue_name ?? '')) {
                              patch([m.id], { suggested_venue_name: v || null } as Partial<UnitMapping>);
                            }
                          }}
                        />
                      </div>

                      <Badge variant={STATUS_VARIANT[m.status]}>{STATUS_LABELS[m.status]}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <datalist id="slnt-venue-options">
              {venues.map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UnitMappingReview;
