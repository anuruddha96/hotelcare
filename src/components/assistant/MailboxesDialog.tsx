import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Eye, EyeOff, Loader2, Mail, Unplug } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Provider = "google" | "microsoft" | "imap";
type Account = { id: string; provider: Provider; email: string; status: string; created_at: string };
type Status = { allowed: boolean; configured: boolean; providers: Record<Provider, boolean>; accounts: Account[] };

const PROVIDER_LABEL: Record<Provider, string> = {
  google: "Gmail / Google Workspace",
  microsoft: "Outlook / Microsoft 365",
  imap: "Email (IMAP)",
};

async function errorText(data: unknown, error: unknown): Promise<string | null> {
  const fromData = (data as { error?: string } | null)?.error;
  if (fromData) return fromData;
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    const body = await context.json().catch(() => null);
    if (body?.error) return String(body.error);
  }
  return error ? "Something went wrong. Try again." : null;
}

/** Each person connects and removes their own mailbox for the assistant. */
export default function MailboxesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [username, setUsername] = useState("");
  const [hint, setHint] = useState<{ gmail?: boolean; microsoft?: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("assistant-mail", { body: { action: "status" } });
    setStatus(
      error
        ? { allowed: false, configured: false, providers: { google: false, microsoft: false, imap: false }, accounts: [] }
        : (data as Status),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setPassword("");
    setFormError(null);
    void load();
  }, [open, load]);

  // Suggest the right servers (and warn about app passwords) once the address is typed.
  useEffect(() => {
    if (!open || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) {
      setHint(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.functions.invoke("assistant-mail", { body: { action: "imap_discover", email: email.trim() } });
      const result = data as { microsoft?: boolean; gmail?: boolean; suggested?: { imap: string; smtp: string } } | null;
      if (!result) return;
      setHint({ gmail: result.gmail, microsoft: result.microsoft });
      if (result.suggested) {
        setImapHost((value) => value || result.suggested!.imap);
        setSmtpHost((value) => value || result.suggested!.smtp);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [email, open]);

  const connectOAuth = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    const returnUrl = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.functions.invoke("assistant-mail", { body: { action: "start_oauth", provider, return_url: returnUrl } });
    const url = (data as { authorization_url?: string } | null)?.authorization_url;
    if (!url) {
      setBusy(null);
      toast.error((await errorText(data, error)) || "The sign-in could not be started");
      return;
    }
    window.location.assign(url);
  };

  const connectImap = async () => {
    setFormError(null);
    setBusy("imap");
    const { data, error } = await supabase.functions.invoke("assistant-mail", {
      body: {
        action: "imap_connect",
        email: email.trim(),
        password,
        ...(advanced ? { imap_host: imapHost.trim(), smtp_host: smtpHost.trim(), username: username.trim() || undefined } : {}),
      },
    });
    setBusy(null);
    if ((data as { ok?: boolean } | null)?.ok) {
      setPassword("");
      setEmail("");
      setImapHost("");
      setSmtpHost("");
      setUsername("");
      setAdvanced(false);
      toast.success("Mailbox connected. Ask me about your inbox.");
      void load();
      return;
    }
    setFormError((await errorText(data, error)) || "The mailbox could not be connected.");
  };

  const disconnect = async (account: Account) => {
    setBusy(account.id);
    const { error } = await supabase.functions.invoke("assistant-mail", { body: { action: "disconnect", account_id: account.id } });
    setBusy(null);
    if (error) return void toast.error("The mailbox could not be removed");
    toast.success(`${account.email} disconnected`);
    void load();
  };

  const oauthProviders = status ? (["google", "microsoft"] as const).filter((p) => status.providers[p]) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mailboxes</DialogTitle>
          <DialogDescription>
            Connect your own work mailbox so the assistant can find emails and prepare replies. Nothing is sent until you tap Send on the draft.
          </DialogDescription>
        </DialogHeader>

        {!status ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !status.allowed ? (
          <p className="text-sm text-muted-foreground">Mailbox access is available to managers and management roles.</p>
        ) : !status.configured ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            Mailbox connection is not switched on yet. An administrator needs to finish the setup.
          </p>
        ) : (
          <div className="space-y-5">
            {status.accounts.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected</h3>
                <ul className="space-y-2">
                  {status.accounts.map((account) => (
                    <li key={account.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{account.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {PROVIDER_LABEL[account.provider] ?? account.provider}
                          {account.status !== "active" && <span className="text-destructive"> · reconnect needed</span>}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy === account.id} onClick={() => void disconnect(account)} aria-label={`Disconnect ${account.email}`}>
                        <Unplug className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {oauthProviders.length > 0 && (
              <section className="grid gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sign in with</h3>
                {oauthProviders.map((provider) => (
                  <Button key={provider} variant="outline" className="justify-start" disabled={busy !== null} onClick={() => void connectOAuth(provider)}>
                    {busy === provider ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                    {PROVIDER_LABEL[provider]}
                  </Button>
                ))}
              </section>
            )}

            {status.providers.imap && (
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {oauthProviders.length ? "Or connect with your password" : "Connect your mailbox"}
                </h3>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void connectImap();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-email">Email address</Label>
                    <Input id="mail-email" type="email" autoComplete="email" placeholder="name@yourhotel.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="mail-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {hint?.gmail && (
                      <p className="text-xs text-muted-foreground">
                        Google mailbox: use an <strong>app password</strong>, not your normal password. Google Account → Security → 2-Step Verification → App passwords.
                      </p>
                    )}
                    {hint?.microsoft && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        This looks like an Outlook / Microsoft 365 mailbox. Microsoft does not allow password sign-in for apps;
                        {status.providers.microsoft ? " use “Outlook / Microsoft 365” above." : " your administrator needs to switch on Microsoft sign-in."}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    aria-expanded={advanced}
                    onClick={() => setAdvanced((v) => !v)}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-180")} /> Advanced server settings
                  </button>
                  {advanced && (
                    <div className="space-y-3 rounded-lg border p-3">
                      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="mail-imap">Incoming server (IMAP)</Label>
                          <Input id="mail-imap" placeholder="mail.yourhotel.com" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
                        </div>
                        <span className="pb-2 text-xs text-muted-foreground">port 993</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="mail-smtp">Outgoing server (SMTP)</Label>
                          <Input id="mail-smtp" placeholder="mail.yourhotel.com" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                        </div>
                        <span className="pb-2 text-xs text-muted-foreground">port 465</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mail-user">Username (if not the email address)</Label>
                        <Input id="mail-user" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                      </div>
                      <p className="text-xs text-muted-foreground">Only secure connections are used: IMAP over SSL (993) and SMTP over SSL (465).</p>
                    </div>
                  )}

                  {formError && <p className="text-sm text-destructive">{formError}</p>}
                  <Button type="submit" className="w-full" disabled={busy !== null || !email.trim() || !password}>
                    {busy === "imap" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {busy === "imap" ? "Checking the mail servers…" : "Connect mailbox"}
                  </Button>
                </form>
              </section>
            )}

            <p className="text-xs text-muted-foreground">
              Your password is stored encrypted and used only to read your inbox and send the emails you approve. Administrators can see who sent which email, to whom and when — never the message text.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
