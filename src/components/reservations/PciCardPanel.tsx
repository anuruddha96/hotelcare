import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Eye, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

/**
 * Channex card / virtual credit card access through the PCI Booking proxy.
 * The card is only ever rendered inside PCI Booking's own iframe, straight
 * into this user's browser — it never passes through HotelCare. Views are
 * logged server-side.
 */

interface TokenRow { id: string; masked_label: string | null; card_type: string | null; created_at?: string }
interface Status {
  configured: boolean; channex_booking_id: string | null;
  can_capture: boolean; can_view: boolean; tokens: TokenRow[];
}

async function callPci(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('pci-cards', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx?.json) {
      const parsed = await ctx.json().catch(() => null) as { error?: string } | null;
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error(error.message || 'Request failed');
  }
  if (data?.ok === false) throw new Error(String(data.error ?? 'Request failed'));
  return data as Record<string, unknown>;
}

export function PciCardPanel({ hotelId, reservationId }: { hotelId: string; reservationId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; tokenId: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await callPci({ action: 'status', hotel_id: hotelId, reservation_id: reservationId }) as unknown as Status);
    } catch { setStatus(null); }
  }, [hotelId, reservationId]);
  useEffect(() => { void refresh(); }, [refresh]);

  // Only OTA bookings carry cards; stay invisible everywhere else.
  if (!status || !status.channex_booking_id) return null;

  const capture = async () => {
    setBusy(true);
    try {
      await callPci({ action: 'capture', hotel_id: hotelId, reservation_id: reservationId });
      toast.success('Card secured in the PCI vault.');
      await refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const view = async (tokenId: string) => {
    setBusy(true);
    try {
      const res = await callPci({ action: 'view', hotel_id: hotelId, token_id: tokenId });
      setViewer({ url: String(res.display_url), tokenId });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Card data-training="pci-card-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" /> Payment card
          <Badge variant="outline" className="gap-1 text-[10px] font-normal"><ShieldCheck className="h-3 w-3" /> PCI proxy</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!status.configured && <p className="text-muted-foreground">PCI Booking is not configured yet — card access is off until the API key secret is set.</p>}
        {status.configured && status.tokens.length === 0 && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-muted-foreground">The OTA card for this booking has not been secured yet.</p>
            {status.can_capture && (
              <Button type="button" size="sm" className="gap-1.5" disabled={busy} onClick={capture}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Secure card from Channex
              </Button>
            )}
          </div>
        )}
        {status.tokens.map((tkn) => (
          <div key={tkn.id} className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs">{tkn.masked_label ?? 'Card on file'}</span>
            {tkn.card_type && <Badge variant="secondary" className="text-[10px]">{tkn.card_type}</Badge>}
            <div className="flex-1" />
            {status.can_view && (
              <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => view(tkn.id)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} View card
              </Button>
            )}
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">Card details render in PCI Booking's secure window only; every view is logged.</p>
      </CardContent>

      <Dialog open={!!viewer} onOpenChange={(open) => { if (!open) setViewer(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Card details</DialogTitle>
            <DialogDescription>Shown directly from the PCI vault. This view is logged and the link expires in 5 minutes.</DialogDescription>
          </DialogHeader>
          {viewer && (
            <iframe title="Card details (PCI Booking)" src={viewer.url} className="w-full h-64 rounded-md border bg-background" sandbox="allow-scripts allow-same-origin" />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
