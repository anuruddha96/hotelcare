import { useEffect, useState } from "react";
import { Flag, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssistantContext } from "@/hooks/useAssistantContext";
import { reportAssistantIssue } from "@/lib/assistant/issueReports";

const CATEGORIES = [
  { value: "wrong_data", label: "Wrong or missing data" },
  { value: "assistant", label: "Mira could not do it" },
  { value: "bug", label: "Something is broken" },
  { value: "access", label: "Access or permissions" },
  { value: "idea", label: "Idea or improvement" },
  { value: "other", label: "Something else" },
];

const SEVERITIES = [
  { value: "low", label: "Low — minor annoyance" },
  { value: "normal", label: "Normal — slows me down" },
  { value: "high", label: "High — blocks my work" },
  { value: "urgent", label: "Urgent — guests affected" },
];

/**
 * Report to the HotelCare team, by e-mail. With a conversation attached, Mira
 * writes the summary and the technical log itself; the person only adds a
 * note if they want to. Available at any time, not only after a failure.
 */
export default function ReportProblemDialog({
  open,
  onOpenChange,
  threadId,
  messageId,
  defaultCategory,
  defaultNote,
  technicalError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId?: string | null;
  /** The answer the report starts from, if any. */
  messageId?: string | null;
  defaultCategory?: string;
  defaultNote?: string;
  /** The error the app showed, sent with the technical log. */
  technicalError?: string | null;
}) {
  const { page } = useAssistantContext();
  const withConversation = Boolean(threadId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(defaultCategory ?? (withConversation ? "assistant" : "wrong_data"));
  const [severity, setSeverity] = useState("normal");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory(defaultCategory ?? (withConversation ? "assistant" : "wrong_data"));
    setDescription(defaultNote ?? "");
  }, [open, defaultCategory, defaultNote, withConversation]);

  const submit = async () => {
    if (!withConversation && title.trim().length < 3 && description.trim().length < 3) {
      toast.error("Tell us briefly what went wrong");
      return;
    }
    setSending(true);
    const result = await reportAssistantIssue({
      title: title.trim(),
      description: description.trim(),
      category,
      severity,
      threadId: threadId ?? null,
      messageId: messageId ?? null,
      page,
      diagnostics: { error: technicalError ?? null },
    });
    setSending(false);
    if (!result.ok) {
      toast.error(result.error ?? "Could not send the report just now.");
      return;
    }
    if (result.emailed) toast.success(`Sent to the HotelCare team (reference ${String(result.id).slice(0, 8)}). Thank you.`);
    else toast.warning(`Report saved (reference ${String(result.id).slice(0, 8)}), but the e-mail could not be confirmed.`);
    setTitle("");
    setDescription("");
    setSeverity("normal");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4" /> Report to the HotelCare team
          </DialogTitle>
          <DialogDescription>
            {withConversation
              ? "Mira summarises this conversation and adds the technical log. Add a note if you like, then send."
              : "Your report is e-mailed to the HotelCare team with the page and technical details."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {withConversation && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>Included: Mira's summary of the problem, the latest messages of this chat, and what Mira checked (no passwords or keys).</span>
            </div>
          )}

          {!withConversation && (
            <div className="space-y-1.5">
              <Label htmlFor="report-title">What is the problem?</Label>
              <Input
                id="report-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Occupancy for tomorrow looks wrong"
                maxLength={200}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Impact</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-description">{withConversation ? "Your note (optional)" : "Details"}</Label>
            <Textarea
              id="report-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={withConversation ? "For example: it named the wrong supervisor" : "What did you expect, and what happened instead?"}
              rows={4}
              maxLength={4000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={sending} className="gap-1.5">
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {sending ? "Sending…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
