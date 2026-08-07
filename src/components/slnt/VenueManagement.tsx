import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenues } from '@/hooks/useVenues';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, Plus, Pencil, Home, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Unit = {
  id: string;
  room_number: string;
  room_name: string | null;
  hotel: string;
  venue_id: string | null;
};

/**
 * SLNT-only: manage physical venues (addresses/buildings) and place units
 * into them. Only rendered for tenants with the venue feature enabled, and
 * every query is scoped to the caller's organization.
 */
export const VenueManagement: React.FC = () => {
  const { profile } = useAuth();
  const { venues, loading, refresh } = useVenues();

  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; name: string; address: string; sort_order: number } | null>(null);
  const [filterVenue, setFilterVenue] = useState<string>('unassigned');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<string>('');

  const orgSlug = profile?.organization_slug ?? '';

  const loadUnits = async () => {
    if (!orgSlug) return;
    setUnitsLoading(true);
    const { data, error } = await supabase
      .from('rooms')
      .select('id, room_number, room_name, hotel, venue_id')
      .eq('organization_slug', orgSlug)
      .order('room_number');
    if (error) toast.error('Could not load units');
    setUnits((data ?? []) as Unit[]);
    setUnitsLoading(false);
  };

  useEffect(() => {
    loadUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

  const filteredUnits = useMemo(() => {
    if (filterVenue === 'all') return units;
    if (filterVenue === 'unassigned') return units.filter((u) => !u.venue_id);
    return units.filter((u) => u.venue_id === filterVenue);
  }, [units, filterVenue]);

  const countFor = (venueId: string) => units.filter((u) => u.venue_id === venueId).length;

  const saveVenue = async () => {
    if (!editing?.name.trim()) {
      toast.error('Venue name is required');
      return;
    }
    setSaving(true);
    const payload = {
      name: editing.name.trim(),
      address: editing.address.trim() || null,
      sort_order: editing.sort_order ?? 0,
      organization_slug: orgSlug,
      hotel_id: profile?.assigned_hotel ?? orgSlug,
    };
    const { error } = editing.id
      ? await supabase.from('venues').update(payload).eq('id', editing.id)
      : await supabase.from('venues').insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing.id ? 'Venue updated' : 'Venue created');
    setDialogOpen(false);
    setEditing(null);
    refresh();
  };

  const applyMove = async () => {
    if (!moveTarget || selected.size === 0) return;
    setSaving(true);
    const venueId = moveTarget === 'none' ? null : moveTarget;
    const { error } = await supabase
      .from('rooms')
      .update({ venue_id: venueId })
      .in('id', Array.from(selected));
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${selected.size} unit(s) updated`);
    setSelected(new Set());
    setMoveTarget('');
    loadUnits();
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Venues
            </CardTitle>
            <CardDescription>
              Physical addresses or buildings. Units are grouped by venue, and supervisors are
              given access per venue.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing({ name: '', address: '', sort_order: venues.length });
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add venue
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading venues…
            </div>
          ) : venues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No venues yet. Add the first address.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {venues.map((v) => (
                <div key={v.id} className="rounded-lg border p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{v.name}</p>
                    {v.address && (
                      <p className="text-xs text-muted-foreground truncate">{v.address}</p>
                    )}
                    <Badge variant="secondary" className="mt-2">
                      {countFor(v.id)} units
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${v.name}`}
                    onClick={() => {
                      setEditing({ id: v.id, name: v.name, address: v.address ?? '', sort_order: v.sort_order });
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-5 w-5" /> Units
          </CardTitle>
          <CardDescription>Select units and move them into a venue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filterVenue} onValueChange={(v) => { setFilterVenue(v); setSelected(new Set()); }}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned units</SelectItem>
                <SelectItem value="all">All units</SelectItem>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Move selected to…" />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
                <SelectItem value="none">Remove from venue</SelectItem>
              </SelectContent>
            </Select>

            <Button size="sm" disabled={!moveTarget || selected.size === 0 || saving} onClick={applyMove}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Apply (${selected.size})`}
            </Button>
          </div>

          {unitsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading units…
            </div>
          ) : filteredUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No units in this view.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-[420px] overflow-y-auto pr-1">
              {filteredUnits.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-3 rounded-md border p-2 cursor-pointer hover:bg-accent/50"
                >
                  <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggle(u.id)} />
                  <span className="min-w-0">
                    <span className="font-medium">{u.room_number}</span>
                    {u.room_name && (
                      <span className="text-muted-foreground text-xs block truncate">{u.room_name}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit venue' : 'New venue'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="venue-name">Name</Label>
              <Input
                id="venue-name"
                value={editing?.name ?? ''}
                onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
                placeholder="e.g. Kazinczy 21"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venue-address">Address</Label>
              <Input
                id="venue-address"
                value={editing?.address ?? ''}
                onChange={(e) => setEditing((p) => (p ? { ...p, address: e.target.value } : p))}
                placeholder="Full street address"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveVenue} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VenueManagement;
