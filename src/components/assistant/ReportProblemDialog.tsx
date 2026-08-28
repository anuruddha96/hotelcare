import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
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
  { value: "assistant", label: "Assistant answer problem" },
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
 * Formal complaint / problem report that reaches the Hotel Care team by e-mail.
 * Available at any time from the assistant header, not only after a failure.
 */
export default function ReportProblemDialog({
  open,
  onOpenChange,
  threadId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId?: string | null;
}) {
  const { page } = useAssistantContext();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("wrong_data");
  const [severity, setSeverity] = useState("normal");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (title.trim().length < 3) {
      toast.error("Please add a short title");
      return;
    }
    setSending(true);
    const result = await reportAssistantIssue({
      title: title.trim(),
      description: description.trim(),
      category,
      severity,
      threadId: threadId ?? null,
      page,
    });
    setSending(false);
    if (!result.ok) {
      toast.error(result.error ?? "Could not send the report just now.");
      return;
    }
    toast.success("Thanks — this has been sent to the Hotel Care team.");
    setTitle("");
    setDescription("");
    setCategory("wrong_data");
    setSeverity("normal");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4" /> Report a problem
          </DialogTitle>
          <DialogDescription>
            Your report goes straight to the Hotel Care team with the page you are on.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
            <Label htmlFor="report-description">Details</Label>
            <Textarea
              id="report-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What did you expect, and what happened instead?"
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
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
