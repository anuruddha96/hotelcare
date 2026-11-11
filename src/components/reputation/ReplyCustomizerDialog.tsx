import { useEffect, useState } from "react";
import { Check, RefreshCw, SlidersHorizontal, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export type ReplyCustomizerOptions = {
  length: "brief" | "balanced" | "detailed";
  tone: "warm" | "professional" | "empathetic" | "confident" | "formal";
  stance: "apologize_for_experience" | "acknowledge_no_apology" | "clarify_without_admitting" | "accept_confirmed_issue";
  focus: "all" | "fees" | "food" | "staff" | "service" | "value" | "follow_up";
  language: "guest" | "en" | "hu";
  notes: string;
  iteration: number;
};
export type ReviewForCustomizer = {
  id: string; reviewer_display_name?: string | null;
  star_rating: number; comment?: string | null; ai_risk_level?: string | null;
};
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: ReviewForCustomizer | null;
  venueName: string;
  currentDraft: string;
  onGenerate: (reviewId: string, options: ReplyCustomizerOptions, previousDraft: string) => Promise<string[]>;
  onSave: (reviewId: string, content: string) => Promise<void>;
};
const defaultOptions: ReplyCustomizerOptions = {
  length: "balanced", tone: "professional", stance: "acknowledge_no_apology",
  focus: "all", language: "guest", notes: "", iteration: 0,
};
const fieldOptions = {
  length: [
    ["brief", "Short · 1–2 sentences"], ["balanced", "Medium · 2–4 sentences"], ["detailed", "Detailed · 4–6 sentences"],
  ],
  tone: [
    ["warm", "Warm & friendly"], ["professional", "Professional"], ["empathetic", "Empathetic"], ["confident", "Confident & composed"], ["formal", "Formal"],
  ],
  stance: [
    ["apologize_for_experience", "Apologize for their experience — no liability admitted"],
    ["acknowledge_no_apology", "Acknowledge feedback — do not apologize"],
    ["clarify_without_admitting", "Respectfully clarify — avoid admissions"],
    ["accept_confirmed_issue", "Accept a verified issue & apologize"],
  ],
  focus: [
    ["all", "Cover the main concerns"], ["fees", "Service charge / billing"], ["food", "Food & portions"], ["staff", "Staff interactions"],
    ["service", "Quality of service"], ["value", "Price & value"], ["follow_up", "Invite direct contact"],
  ],
  language: [["guest", "Match guest's language"], ["en", "English"], ["hu", "Hungarian"]],
} as const;
function OptionSelect({ id, label, options, value, onChange }: {
  id: string; label: string; options: readonly (readonly [string, string])[];
  value: string; onChange: (v: string) => void;
}) {
  return <div className="space-y-1.5 min-w-0">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}
export function ReplyCustomizerDialog({ open, onOpenChange, review, venueName, currentDraft, onGenerate, onSave }: Props) {
  const [options, setOptions] = useState<ReplyCustomizerOptions>(defaultOptions);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [edited, setEdited] = useState("");
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!open) return;
    setAlternatives([]); setChosen(null); setEdited(""); setGeneration(0);
    setOptions({ ...defaultOptions });
  }, [review?.id, open]);
  const update = <K extends keyof ReplyCustomizerOptions>(key: K, value: ReplyCustomizerOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }));
    // Do not silently keep older outputs if the selected guidance changes.
    setAlternatives([]); setChosen(null); setEdited("");
  };
  const generate = async () => {
    if (!review) return;
    if (options.stance === "accept_confirmed_issue" && options.notes.trim().length < 12) {
      toast.warning("To accept responsibility, first identify the independently confirmed facts in Manager instructions.");
      return;
    }
    setBusy("generate");
    try {
      const replies = await onGenerate(review.id, { ...options, iteration: generation }, currentDraft);
      setGeneration(prev => prev + 1);
      setAlternatives(replies);
      setChosen(null);
      setEdited("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate alternatives");
    } finally { setBusy(null); }
  };
  const save = async () => {
    if (!review || chosen === null || !edited.trim()) return;
    setBusy("save");
    try {
      await onSave(review.id, edited.trim());
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save reply");
    } finally { setBusy(null); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="w-[min(94vw,900px)] max-w-3xl max-h-[91vh] flex flex-col overflow-hidden">
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle className="flex flex-wrap items-center gap-2"><SlidersHorizontal className="h-5 w-5" />Customize this Google reply <Badge variant="secondary">{review?.star_rating}★</Badge></DialogTitle>
        <DialogDescription>{venueName} · {review?.reviewer_display_name || "Google guest"} · Choose your approach, compare three responses and save one as a draft. Nothing publishes automatically.</DialogDescription>
      </DialogHeader>
      <div className="overflow-y-auto flex-1 min-h-0 space-y-4 pr-1">
        <div className="rounded-lg bg-muted/40 p-3">
          <div className="text-xs font-semibold text-muted-foreground mb-1">Guest review</div>
          <p className="text-sm whitespace-pre-wrap max-h-36 overflow-y-auto">{review?.comment || "Rating only — no written comment."}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <OptionSelect id="reply-length" label="Reply length" options={fieldOptions.length} value={options.length} onChange={v => update("length", v as ReplyCustomizerOptions["length"])} />
          <OptionSelect id="reply-tone" label="Style and tone" options={fieldOptions.tone} value={options.tone} onChange={v => update("tone", v as ReplyCustomizerOptions["tone"])} />
          <div className="sm:col-span-2">
            <OptionSelect id="reply-stance" label="How should we respond?" options={fieldOptions.stance} value={options.stance} onChange={v => update("stance", v as ReplyCustomizerOptions["stance"])} />
          </div>
          <OptionSelect id="reply-focus" label="What to focus on" options={fieldOptions.focus} value={options.focus} onChange={v => update("focus", v as ReplyCustomizerOptions["focus"])} />
          <OptionSelect id="reply-language" label="Reply language" options={fieldOptions.language} value={options.language} onChange={v => update("language", v as ReplyCustomizerOptions["language"])} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-manager-notes">Manager instructions (optional)</Label>
          <Textarea id="reply-manager-notes" rows={2} maxLength={500}
            placeholder="e.g., Focus on the additional charge; don't imply the guest was warned. Invite private contact, but don't invent contact details."
            value={options.notes} onChange={e => update("notes", e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {options.stance === "accept_confirmed_issue"
              ? "Required: identify the specific facts you have verified before asking HotelCare to accept responsibility."
              : "You can mention verified policy details or explain what to emphasize. Disputed facts will not be presented as established."}
          </p>
        </div>
        {review && (review.star_rating <= 3 || review.ai_risk_level === "high") && (
          <div className="rounded-lg border border-amber-300 p-3 text-xs flex gap-2">
            <span className="text-amber-700">Manager review required.</span>
            The AI will not automatically publish these responses or admit an unverified allegation.
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-sm font-medium">Reply alternatives</p>
            <p className="text-xs text-muted-foreground">Uses a cost-efficient model. Each request generates three new options.</p></div>
          <Button onClick={() => void generate()} disabled={Boolean(busy)}>
            {busy === "generate" ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {alternatives.length ? "Generate 3 different replies" : "Generate 3 options"}
          </Button>
        </div>
        {alternatives.length > 0 && <div className="space-y-2">
          {alternatives.map((reply, index) => <button type="button" key={index}
            onClick={() => { setChosen(index); setEdited(reply); }}
            className={`block text-left w-full rounded-lg border p-3 transition-colors ${chosen === index ? "border-primary ring-1 ring-primary" : "hover:bg-muted/30"}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-semibold text-sm">Option {index + 1}</span>
              {chosen === index ? <Badge><Check className="h-3 w-3 mr-1" />Selected</Badge> : <Badge variant="outline">Select</Badge>}
            </div>
            <p className="text-sm whitespace-pre-wrap">{reply}</p>
          </button>)}
        </div>}
        {chosen !== null && <div className="space-y-1.5">
          <Label htmlFor="reply-selected-edit">Edit the selected reply before saving</Label>
          <Textarea id="reply-selected-edit" rows={5} maxLength={1500} value={edited}
            onChange={e => setEdited(e.target.value)} />
          <p className="text-xs text-muted-foreground">{edited.length}/1500 characters · Saving does not publish to Google.</p>
        </div>}
        {!alternatives.length && currentDraft && <div className="rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Your existing draft will be kept until you save a replacement</p>
          <p className="text-sm whitespace-pre-wrap">{currentDraft}</p>
        </div>}
      </div>
      <DialogFooter className="shrink-0 gap-2">
        <Button variant="outline" disabled={Boolean(busy)} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={Boolean(busy) || chosen === null || !edited.trim() || edited.length > 1500} onClick={() => void save()}>
          <Check className="h-4 w-4 mr-2" />{busy === "save" ? "Saving…" : "Use & save selected draft"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
