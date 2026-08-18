// Email settings — one place to see whether e-mail actually works.
//
// Shows the Resend key status and verified domains, lets an admin choose the
// sender name/address and reply-to, switch transactional mail and the daily
// digest on or off, and send a real test message.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, Mail, RefreshCw, Send, ShieldCheck } from "lucide-react";

interface Settings {
  from_name: string;
  from_email: string;
  reply_to: string | null;
  transactional_enabled: boolean;
  digest_enabled: boolean;
}

interface KeyStatus {
  configured: boolean;
  valid: boolean;
  error?: string;
  domains: { name: string; status: string }[];
}

const DEFAULTS: Settings = {
  from_name: "Hotel Care",
  from_email: "onboarding@resend.dev",
  reply_to: "",
  transactional_enabled: true,
  digest_enabled: true,
};

export default function EmailSettingsPanel() {
  const { profile } = useAuth();
  const orgSlug = profile?.organization_slug ?? "";

  const [s, setS] = useState<Settings>(DEFAULTS);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invoke = async (action: string, body: Record<string, unknown> = {}) => {
    const { data, error: err } = await supabase.functions.invoke("email-config", {
      body: { action, ...body },
    });
    if (err) {
      const ctx = (err as { context?: Response }).context;
      const detail = ctx ? await ctx.text().catch(() => "") : "";
      let message = err.message;
      try { message = JSON.parse(detail).error ?? message; } catch { /* keep */ }
      throw new Error(message);
    }
    const payload = data as { error?: string } | null;
    if (payload?.error) throw new Error(payload.error);
    return data as Record<string, unknown>;
  };

  const load = useCallback(async () => {
    if (!orgSlug) return;
    setLoading(true);
    setError(null);
    const { data } = await supabase
      .from("email_settings")
      .select("from_name, from_email, reply_to, transactional_enabled, digest_enabled")
      .eq("organization_slug", orgSlug)
      .maybeSingle();
    if (data) setS({ ...DEFAULTS, ...(data as Settings), reply_to: (data as Settings).reply_to ?? "" });
    setTestTo(profile?.email ?? "");
    setLoading(false);
    try {
      const res = await invoke("status");
      setStatus(res.key as KeyStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the e-mail status");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, profile?.email]);

  useEffect(() => { void load(); }, [load]);

  const save = async (patch: Partial<Settings>) => {
    if (!orgSlug) return;
    const next = { ...s, ...patch };
    setS(next);
    setSaving(true);
    const { error: err } = await supabase.from("email_settings").upsert({
      organization_slug: orgSlug,
      from_name: next.from_name || "Hotel Care",
      from_email: next.from_email || DEFAULTS.from_email,
      reply_to: next.reply_to?.trim() ? next.reply_to.trim() : null,
      transactional_enabled: next.transactional_enabled,
      digest_enabled: next.digest_enabled,
      updated_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (err) toast.error(err.message);
  };

  const recheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await invoke("status");
      setStatus(res.key as KeyStatus);
      toast.success("Checked the Resend key");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check the key");
    } finally {
      setChecking(false);
    }
  };

  const sendTest = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await invoke("test", { to: testTo.trim() || undefined });
      toast.success(`Test sent to ${(res.to as string) ?? testTo} — check the inbox and spam folder.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The test e-mail was not sent");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading e-mail settings…
        </CardContent>
      </Card>
    );
  }

  const verified = (status?.domains ?? []).filter((d) => d.status === "verified");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" /> E-mail settings
        </CardTitle>
        <CardDescription>
          Sender identity and delivery switches for every message the app sends — ticket notifications,
          assignments, password resets and the morning revenue digest.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Key status */}
        <div className="rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {status?.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )}
                <p className="text-sm font-semibold">
                  {status?.valid
                    ? "Resend key accepted"
                    : status?.configured
                      ? "Resend rejected the stored key"
                      : "No Resend key configured"}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {status?.error
                  ? status.error
                  : status?.valid
                    ? "Sending is authorised. Ask Lovable to update the key whenever you rotate it in Resend."
                    : "Ask Lovable to save your RESEND_API_KEY, then check again."}
              </p>
              {verified.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {verified.map((d) => (
                    <Badge key={d.name} variant="secondary" className="gap-1">
                      <ShieldCheck className="h-3 w-3" /> {d.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={recheck} disabled={checking} className="gap-1.5">
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Check again
            </Button>
          </div>
        </div>

        {/* Sender identity */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Sender name</Label>
            <Input
              value={s.from_name}
              onChange={(e) => setS({ ...s, from_name: e.target.value })}
              onBlur={() => void save({ from_name: s.from_name })}
              placeholder="Hotel Care"
              className="h-9 text-base sm:text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sender address</Label>
            <Input
              value={s.from_email}
              onChange={(e) => setS({ ...s, from_email: e.target.value })}
              onBlur={() => void save({ from_email: s.from_email })}
              placeholder="noreply@yourhotel.com"
              className="h-9 text-base sm:text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Must sit on a domain verified in Resend. The default
              <code className="mx-1">onboarding@resend.dev</code>
              only reaches the Resend account owner.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Reply-to address (optional)</Label>
            <Input
              value={s.reply_to ?? ""}
              onChange={(e) => setS({ ...s, reply_to: e.target.value })}
              onBlur={() => void save({ reply_to: s.reply_to })}
              placeholder="frontoffice@yourhotel.com"
              className="h-9 text-base sm:text-sm"
            />
          </div>
        </div>

        {/* Switches */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Transactional e-mails</p>
              <p className="text-xs text-muted-foreground">
                Ticket assignments and closures, room and maintenance assignments, password resets and login links.
              </p>
            </div>
            <Switch
              checked={s.transactional_enabled}
              disabled={saving}
              onCheckedChange={(v) => void save({ transactional_enabled: v })}
            />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Daily revenue digest</p>
              <p className="text-xs text-muted-foreground">
                The morning summary. Per-hotel timing and recipients stay in Revenue → Morning e-mail.
              </p>
            </div>
            <Switch
              checked={s.digest_enabled}
              disabled={saving}
              onCheckedChange={(v) => void save({ digest_enabled: v })}
            />
          </div>
        </div>

        {/* Test */}
        <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
          <Label className="text-xs">Send a test message</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              className="h-9 text-base sm:text-sm"
            />
            <Button onClick={sendTest} disabled={sending} className="gap-1.5">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-muted-foreground break-words">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
