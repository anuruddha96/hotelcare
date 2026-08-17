// The automatic morning e-mail.
//
// One short message per hotel, early each morning: yesterday's pickup, today's
// occupancy, the next fourteen days that need attention and what the automation
// changed overnight. Managers can switch it off, move the time, and add extra
// recipients.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Mail, Send } from "lucide-react";

interface Props {
  hotelId: string | null;
  organizationSlug: string | null;
  canEdit: boolean;
}

interface Settings {
  enabled: boolean;
  send_hour: number;
  send_minute: number;
  recipients: string[];
  last_sent_on: string | null;
}

const DEFAULTS: Settings = { enabled: false, send_hour: 6, send_minute: 30, recipients: [], last_sent_on: null };

export default function MorningDigestPanel({ hotelId, organizationSlug, canEdit }: Props) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipientText, setRecipientText] = useState("");

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    const { data } = await supabase
      .from("revenue_digest_settings")
      .select("enabled, send_hour, send_minute, recipients, last_sent_on")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    const next = (data as Settings | null) ?? DEFAULTS;
    setS(next);
    setRecipientText((next.recipients ?? []).join(", "));
    setLoading(false);
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (patch: Partial<Settings>) => {
    if (!hotelId || !organizationSlug) return;
    const next = { ...s, ...patch };
    setS(next);
    setSaving(true);
    const { error } = await supabase.from("revenue_digest_settings").upsert({
      hotel_id: hotelId,
      organization_slug: organizationSlug,
      enabled: next.enabled,
      send_hour: next.send_hour,
      send_minute: next.send_minute,
      recipients: next.recipients,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) toast.error(error.message);
  };

  const sendNow = async () => {
    if (!hotelId) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("revenue-morning-digest", {
        body: { hotelId, force: true },
      });
      // The function returns its real failure in the body; a non-2xx arrives as
      // a generic error, so read both before claiming success.
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const detail = ctx ? await ctx.text().catch(() => "") : "";
        let message = error.message;
        try { message = JSON.parse(detail).error ?? message; } catch { /* keep */ }
        throw new Error(message);
      }
      const payload = data as { ok?: boolean; error?: string; sent?: string[] } | null;
      if (payload?.error || !payload?.sent?.length) {
        throw new Error(payload?.error ?? "The e-mail was not accepted for delivery.");
      }
      toast.success("Digest sent — check your inbox (and spam).");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the digest");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  const timeLabel = `${String(s.send_hour).padStart(2, "0")}:${String(s.send_minute).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Morning summary e-mail</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Yesterday's pickup, tonight's occupancy, the next 14 days that need attention and what the
              automation changed — every day at {timeLabel} Budapest time.
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {s.last_sent_on ? `Last sent ${s.last_sent_on}.` : "Not sent yet."}
            </p>
          </div>
          <Switch checked={s.enabled} disabled={!canEdit || saving} onCheckedChange={(v) => void save({ enabled: v })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Hour (Budapest)</Label>
          <Input
            type="number" min={0} max={23} value={s.send_hour} disabled={!canEdit}
            onChange={(e) => setS({ ...s, send_hour: Number(e.target.value) })}
            onBlur={() => void save({ send_hour: s.send_hour })}
            className="h-9 text-base sm:text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Minute</Label>
          <Input
            type="number" min={0} max={59} value={s.send_minute} disabled={!canEdit}
            onChange={(e) => setS({ ...s, send_minute: Number(e.target.value) })}
            onBlur={() => void save({ send_minute: s.send_minute })}
            className="h-9 text-base sm:text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Extra recipients (comma separated)</Label>
        <Input
          value={recipientText} disabled={!canEdit}
          placeholder="owner@example.com, director@example.com"
          onChange={(e) => setRecipientText(e.target.value)}
          onBlur={() => void save({ recipients: recipientText.split(",").map((x) => x.trim()).filter(Boolean) })}
          className="h-9 text-base sm:text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          Managers and top management of this hotel always receive it while it is switched on.
        </p>
      </div>

      <Button size="sm" variant="outline" className="w-full gap-1.5 sm:w-auto" onClick={sendNow} disabled={sending}>
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Send me one now
      </Button>
      <p className="text-[11px] text-muted-foreground">
        The test goes to your own address plus the extra recipients above.
      </p>
    </div>
  );
}

