import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isMemoriesHotel, loadMemoriesLinenCatalogue, memoriesLinenLabel, type MemoriesLinenItem } from '@/lib/memoriesLinen';

const managerRoles = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];

/** The eight base types are protected. Managers can add venue-scoped categories;
 * the catalogue is shared with housekeeper inputs and the Memories summary. */
export function MemoriesLinenItemsConfiguration() {
  const { profile } = useAuth();
  const [items, setItems] = useState<MemoriesLinenItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [english, setEnglish] = useState('');
  const [hungarian, setHungarian] = useState('');
  const [saving, setSaving] = useState(false);
  const canManage = !!profile?.role && managerRoles.includes(profile.role)
    && profile?.organization_slug === 'rdhotels';

  const load = useCallback(async () => {
    if (!isMemoriesHotel(profile?.assigned_hotel)) return;
    try {
      const data = await loadMemoriesLinenCatalogue();
      setItems(data);
      setError(null);
    } catch (caught: any) {
      setItems([]);
      setError(caught?.message || 'Could not load linen items.');
    }
  }, [profile?.assigned_hotel]);

  useEffect(() => { void load(); }, [load]);

  const addItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || saving) return;
    const en = english.trim().replace(/\s+/g, ' ');
    const hu = hungarian.trim().replace(/\s+/g, ' ');
    if (!en || !hu) { toast.error('Enter names in English and Hungarian.'); return; }
    if (en.length > 70 || hu.length > 70) { toast.error('Names must be 70 characters or fewer.'); return; }
    const slug = en.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 65);
    if (!slug) { toast.error('Please enter a valid English name.'); return; }
    const internalName = `memories_custom_${slug}`;
    if (items.some(item => item.name === internalName || item.display_name.toLowerCase() === `${en} / ${hu}`.toLowerCase())) {
      toast.error('This linen type is already listed.');
      return;
    }
    setSaving(true);
    try {
      const { data: existing, error: lookupError } = await (supabase as any).from('dirty_linen_items')
        .select('id').eq('hotel_scope', 'memories-budapest').eq('name', internalName).limit(1);
      if (lookupError) throw lookupError;
      if (existing?.length) throw new Error('This linen type already exists. Ask an admin to restore an inactive type.');
      const { error: insertError } = await (supabase as any).from('dirty_linen_items').insert({
        name: internalName,
        display_name: `${en} / ${hu}`,
        hotel_scope: 'memories-budapest',
        is_active: true,
        sort_order: Math.max(8, ...items.map(item => item.sort_order)) + 1,
      });
      if (insertError) throw insertError;
      setEnglish('');
      setHungarian('');
      await load();
      toast.success('Linen type added. Housekeepers can now record it.');
    } catch (caught: any) {
      toast.error(caught?.message || 'Failed to add linen type.');
    } finally { setSaving(false); }
  };

  if (!isMemoriesHotel(profile?.assigned_hotel)) return null;
  return <Card data-testid="memories-linen-items-configuration">
    <CardHeader><CardTitle>Hotel Memories Budapest — Linen items / Szennyes textíliák</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The original eight laundry items stay in their familiar order. New types added here belong to Hotel Memories only,
        and appear in housekeeper entry, manager corrections, the daily summary and exports.
      </p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <ol className="list-decimal pl-6 space-y-2">{items.map(item =>
        <li key={item.id} className="border-b pb-2 text-sm">{memoriesLinenLabel(item, true)}</li>)}</ol>
      {canManage && <form onSubmit={event => { void addItem(event); }} className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">Add a linen type / Új textília hozzáadása</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="new-linen-en">English name</Label>
            <Input id="new-linen-en" value={english} maxLength={70}
              onChange={event => setEnglish(event.target.value)} placeholder="e.g. Bed runner" required /></div>
          <div className="space-y-1.5"><Label htmlFor="new-linen-hu">Magyar megnevezés</Label>
            <Input id="new-linen-hu" value={hungarian} maxLength={70}
              onChange={event => setHungarian(event.target.value)} placeholder="pl. Ágysál" required /></div>
        </div>
        <Button type="submit" disabled={saving || !english.trim() || !hungarian.trim()}>
          <Plus className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Add linen type'}
        </Button>
      </form>}
    </CardContent>
  </Card>;
}
