// Booking engine settings: the private test link for top management. It
// opens the guest page with live prices and availability even while online
// booking is off; bookings made through it are checked and never saved.
import { useState } from 'react';
import { Check, Copy, ExternalLink, FlaskConical, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { testLinkFor } from '@/lib/bookingEngine/access';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function EngineTestLinkCard({ origin, publicId, hotelId, token, lang, enabled, onToken }: {
  origin: string; publicId: string; hotelId: string; token: string; lang: string; enabled: boolean; onToken: (token: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const link = testLinkFor(origin, publicId, token, lang);

  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  const renew = async () => {
    if (!window.confirm('Make a new test link? The current one stops working straight away.')) return;
    setRenewing(true);
    const { data, error } = await db.rpc('booking_engine_reset_preview_token', { _hotel_id: hotelId });
    setRenewing(false);
    if (error || typeof data !== 'string') { toast.error(error?.message ?? 'Could not make a new link.'); return; }
    onToken(data);
    toast.success('New test link ready. The old one no longer works.');
  };

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4 text-amber-600" />Test the booking page</CardTitle>
        <p className="text-xs text-muted-foreground">
          Opens the guest page with live prices and availability{enabled ? '' : ', even while online booking is off'}.
          Bookings made through this link are fully checked but never saved, and no e-mails go out.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex gap-2">
          <Input readOnly value={link} aria-label="Private test link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copy test link">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild className="gap-1.5"><a href={link} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Open test page</a></Button>
          <Button type="button" variant="ghost" className="gap-1.5" onClick={() => void renew()} disabled={renewing}>
            {renewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Make a new link
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Anyone with this link can see the page, so share it only with people who should test. A new link switches the old one off.</p>
      </CardContent>
    </Card>
  );
}
