import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Mail, Pencil, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type EmailDraftSpec = {
  kind: "email_draft";
  draftId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  external?: string[];
  inReplyTo?: string | null;
};

export function isEmailDraft(value: unknown): value is EmailDraftSpec {
  return Boolean(value) && typeof value === "object" && (value as any).kind === "email_draft" && typeof (value as any).draftId === "string";
}

type Status = "loading" | "pending" | "sending" | "sent" | "discarded" | "failed" | "expired";

const splitList = (value: string) => value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);

/** An email the assistant prepared. It is sent only when the person taps Send. */
export default function EmailDraftCard({ spec }: { spec: EmailDraftSpec }) {
  const [status, setStatus] = useState<Status>("loading");
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(spec.to.join(", "));
  const [cc, setCc] = useState(spec.cc.join(", "));
  const [subject, setSubject] = useState(spec.subject);
  const [body, setBody] = useState(spec.body);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.functions.invoke("assistant-mail", { body: { action: "draft", draft_id: spec.draftId } }).then(({ data }) => {
      if (cancelled) return;
      const state = (data as any)?.status;
      if ((data as any)?.expired && state === "pending") setStatus("expired");
      else setStatus(["pending", "sending", "sent", "discarded", "failed"].includes(state) ? state : "pending");
      if (state === "failed" && (data as any)?.error) setError(String((data as any).error));
    });
    return () => {
      cancelled = true;
    };
  }, [spec.draftId]);

  const send = async () => {
    setError(null);
    setStatus("sending");
    const { data, error: invokeError } = await supabase.functions.invoke("assistant-mail", {
      body: { action: "send", draft_id: spec.draftId, to: splitList(to), cc: splitList(cc), subject, body },
    });
    if (!invokeError && (data as any)?.status === "sent") {
      setStatus("sent");
      setEditing(false);
      return;
    }
    let message = (data as any)?.error as string | undefined;
    if (!message && invokeError && "context" in invokeError) {
      message = await (invokeError as any).context?.json?.().then((j: any) => j?.error).catch(() => undefined);
    }
    setError(message || "The email was not sent.");
    setStatus("failed");
  };

  const discard = async () => {
    await supabase.functions.invoke("assistant-mail", { body: { action: "discard", draft_id: spec.draftId } });
    setStatus("discarded");
  };

  const locked = status === "sent" || status === "discarded" || status === "expired" || status === "sending";
  const external = spec.external ?? [];

  return (
    <div className="mt-3 w-full overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{spec.inReplyTo ? "Reply" : "New email"}</span>
        <span className="ml-auto truncate text-xs text-muted-foreground">from {spec.from}</span>
      </div>
      <div className="space-y-2 px-3 py-3 text-sm">
        {editing ? (
          <>
            <label className="block text-xs text-muted-foreground">
              To
              <Input value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-8" />
            </label>
            <label className="block text-xs text-muted-foreground">
              Cc
              <Input value={cc} onChange={(e) => setCc(e.target.value)} className="mt-1 h-8" placeholder="Optional" />
            </label>
            <label className="block text-xs text-muted-foreground">
              Subject
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 h-8" maxLength={200} />
            </label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="text-sm" />
          </>
        ) : (
          <>
            <p>
              <span className="text-muted-foreground">To </span>
              {splitList(to).join(", ")}
            </p>
            {splitList(cc).length > 0 && (
              <p>
                <span className="text-muted-foreground">Cc </span>
                {splitList(cc).join(", ")}
              </p>
            )}
            <p className="font-medium">{subject}</p>
            <p className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 leading-relaxed">{body}</p>
          </>
        )}
        {external.length > 0 && status !== "sent" && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Goes outside your organisation: {external.join(", ")}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {status === "sent" ? (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4" /> Sent
          </span>
        ) : status === "discarded" ? (
          <span className="text-sm text-muted-foreground">Discarded</span>
        ) : status === "expired" ? (
          <span className="text-sm text-muted-foreground">This draft expired. Ask for a fresh one.</span>
        ) : (
          <>
            <Button size="sm" onClick={() => void send()} disabled={locked || status === "loading"}>
              {status === "sending" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Send
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} disabled={locked}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> {editing ? "Done editing" : "Edit"}
            </Button>
            <Button size="sm" variant="ghost" className={cn("ml-auto text-muted-foreground")} onClick={() => void discard()} disabled={locked}>
              <X className="mr-1 h-3.5 w-3.5" /> Discard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
