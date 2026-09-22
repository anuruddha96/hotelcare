import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { isMemoriesHotel, loadMemoriesLinenCatalogue, memoriesLinenLabel, type MemoriesLinenItem } from '@/lib/memoriesLinen';

/** Memories item configuration is a paper-sheet reference, not a shared-catalogue editor.
 * Global add/delete/update controls remain available in their original screen for other hotels. */
export function MemoriesLinenItemsConfiguration() {
  const { profile } = useAuth();
  const [items, setItems] = useState<MemoriesLinenItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isMemoriesHotel(profile?.assigned_hotel)) return;
    let active = true;
    loadMemoriesLinenCatalogue().then(data => {
      if (active) { setItems(data); setError(null); }
    }).catch((caught: Error) => {
      if (active) { setItems([]); setError(caught.message); }
    });
    return () => { active = false; };
  }, [profile?.assigned_hotel]);
  if (!isMemoriesHotel(profile?.assigned_hotel)) return null;
  return <Card data-testid="memories-linen-items-configuration">
    <CardHeader><CardTitle>Hotel Memories Budapest — Linen items / Szennyes textíliák</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Only the seven laundry-provider items are available here, in their approved paper-sheet order. Quantity corrections, printing and exports are in Dirty Linen Management. Other properties' item configuration is unchanged.</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <ol className="list-decimal pl-6 space-y-2">{items.map(item =>
        <li key={item.id} className="border-b pb-2 text-sm">{memoriesLinenLabel(item, true)}</li>)}</ol>
    </CardContent>
  </Card>;
}
