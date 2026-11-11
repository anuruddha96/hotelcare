import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, Unplug } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Account = { id: string; provider: "google" | "microsoft"; email: string; status: string; created_at: string };
type Status = { allowed: boolean; configured: boolean; providers: { google: boolean; microsoft: boolean }; accounts: Account[] };

const PROVIDER_LABEL = { google: "Gmail / Google Workspace", microsoft: "Outlook / Microsoft 365" } as const;

/** Connect or remove the person's own mailbox for the assistant. */
export default function MailboxesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("assistant-mail", { body: { action: "status" } });
    setStatus(error ? { allowed: false, configured: false, providers: { google: false, microsoft: false }, accounts: [] } : (data as Status));
  }, []);

  useEffect(() => {
    if (open) {
      setStatus(null);
      void load();
    }
  }, [open, load]);

  const connect = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    const returnUrl = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.functions.invoke("assistant-mail", { body: { action: "start_oauth", provider, return_url: returnUrl } });
    const url = (data as any)?.authorization_url;
    if (error || !url) {
      setBusy(null);
      toast.error((data as any)?.error || "The sign-in could not be started");
      return;
    }
    window.location.assign(url);
  };

  const disconnect = async (account: Account) => {
    setBusy(account.id);
    const { error } = await supabase.functions.invoke("assistant-mail", { body: { action: "disconnect", account_id: account.id } });
    setBusy(null);
    if (error) return void toast.error("The mailbox could not be removed");
    toast.success(`${account.email} disconnected`);
    void load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
        ) : (
          <div className="space-y-4">
            {status.accounts.length > 0 && (
              <ul className="space-y-2">
                {status.accounts.map((account) => (
                  <li key={account.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {PROVIDER_LABEL[account.provider]}
                        {account.status !== "active" && <span className="text-destructive"> · reconnect needed</span>}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" disabled={busy === account.id} onClick={() => void disconnect(account)} aria-label={`Disconnect ${account.email}`}>
                      <Unplug className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {status.configured ? (
              <div className="grid gap-2">
                {(["google", "microsoft"] as const)
                  .filter((p) => status.providers[p])
                  .map((provider) => (
                    <Button key={provider} variant="outline" className="justify-start" disabled={busy !== null} onClick={() => void connect(provider)}>
                      {busy === provider ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                      Connect {PROVIDER_LABEL[provider]}
                    </Button>
                  ))}
              </div>
            ) : (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                Mailbox sign-in is not switched on yet. An administrator needs to finish the Google or Microsoft setup.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Administrators can see who sent which email, to whom and when — never the message text.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
