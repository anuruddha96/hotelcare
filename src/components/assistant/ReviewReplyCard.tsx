import { useEffect, useState } from "react";
import { Check, Loader2, MessageSquareReply, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type ReviewReplySpec = {
  kind: "review_reply";
  reviewId: string;
  organizationSlug: string;
  location: string;
  stars: number | null;
  reviewer: string | null;
  date: string;
  review: string;
  reply: string;
};

export function isReviewReply(value: unknown): value is ReviewReplySpec {
  return Boolean(value) && typeof value === "object" && (value as any).kind === "review_reply" && typeof (value as any).reviewId === "string";
}

/** A Google review reply the assistant drafted. Published only on tap, through the Reputation service. */
export default function ReviewReplyCard({ spec }: { spec: ReviewReplySpec }) {
  const [reply, setReply] = useState(spec.reply);
  const [state, setState] = useState<"idle" | "publishing" | "published" | "dismissed">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (supabase as any)
      .from("google_reviews")
      .select("reply_status,google_reply_comment")
      .eq("id", spec.reviewId)
      .maybeSingle()
      .then(({ data }: { data: { reply_status?: string; google_reply_comment?: string } | null }) => {
        if (!cancelled && (data?.reply_status === "published" || data?.google_reply_comment)) {
          setState("published");
          if (data.google_reply_comment) setReply(data.google_reply_comment);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [spec.reviewId]);

  const publish = async () => {
    setError(null);
    setState("publishing");
    const { data, error: invokeError } = await supabase.functions.invoke("google-reputation", {
      body: { action: "publish_reply", review_id: spec.reviewId, reply: reply.trim(), organization_slug: spec.organizationSlug },
    });
    if (!invokeError && (data as any)?.ok !== false && !(data as any)?.error) {
      setState("published");
      return;
    }
    setError((data as any)?.error || "Google did not accept the reply. Try again from the Reputation screen.");
    setState("idle");
  };

  return (
    <div className="mt-3 w-full overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquareReply className="h-4 w-4 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">{spec.location}</span>
        {spec.stars !== null && (
          <span className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground" aria-label={`${spec.stars} stars`}>
            {spec.stars} <Star className="h-3 w-3 fill-current" />
          </span>
        )}
      </div>
      <div className="space-y-2 px-3 py-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {spec.reviewer || "Guest"} · {spec.date}
        </p>
        {spec.review && <p className="line-clamp-4 italic text-muted-foreground">“{spec.review}”</p>}
        {state === "published" ? (
          <p className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2">{reply}</p>
        ) : (
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} maxLength={4000} disabled={state !== "idle"} aria-label="Reply" />
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2">
        {state === "published" ? (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4" /> Published on Google
          </span>
        ) : state === "dismissed" ? (
          <span className="text-sm text-muted-foreground">Dismissed</span>
        ) : (
          <>
            <Button size="sm" onClick={() => void publish()} disabled={state !== "idle" || reply.trim().length < 10}>
              {state === "publishing" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Publish to Google
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setState("dismissed")} disabled={state !== "idle"}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
