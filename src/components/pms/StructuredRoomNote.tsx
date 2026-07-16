import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Bed, Sparkles } from "lucide-react";
import { parsePmsNote, looksLikePmsNote } from "@/lib/pmsNoteParser";

interface Props {
  /** Raw note string (may be HTML-encoded PMS blob or plain manager text). */
  notes: string | null | undefined;
  /** Show a collapsible "Original PMS note" section (default: true). */
  showOriginal?: boolean;
  className?: string;
}

/**
 * Renders the manager-relevant slice of a PMS note (bed arrangement, guest
 * special requests, meals, smoking, capacity hints) and hides finance/policy
 * noise. Falls back to the raw string when the note is not PMS-shaped.
 */
export function StructuredRoomNote({ notes, showOriginal = true, className }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const trimmed = (notes ?? "").trim();
  if (!trimmed) return null;

  const isPms = looksLikePmsNote(trimmed);
  if (!isPms) {
    // Plain manager text — render as-is.
    return (
      <div className={`text-xs whitespace-pre-wrap text-foreground ${className ?? ""}`}>
        {trimmed}
      </div>
    );
  }

  const parsed = parsePmsNote(trimmed);

  if (!parsed.hasStructuredContent) {
    // PMS-shaped but nothing useful to extract — offer only the raw fallback.
    return (
      <div className={`space-y-1 ${className ?? ""}`}>
        <p className="text-[11px] italic text-muted-foreground">
          No guest preferences detected in PMS note.
        </p>
        {showOriginal && (
          <RawToggle raw={trimmed} open={showRaw} onToggle={() => setShowRaw((v) => !v)} />
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 text-xs ${className ?? ""}`}>
      {parsed.bedArrangement && (
        <div className="flex items-center gap-1.5">
          <Bed className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-medium">{parsed.bedArrangement}</span>
        </div>
      )}

      {parsed.specialRequests.length > 0 && (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Guest requests
          </div>
          <ul className="list-disc pl-4 space-y-0.5">
            {parsed.specialRequests.map((r) => (
              <li key={r} className="text-foreground">{r}</li>
            ))}
          </ul>
        </div>
      )}

      {(parsed.meals || parsed.smoking || parsed.extras.guestsMax || parsed.extras.babyCotMax || parsed.extras.extraBeds) && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {parsed.meals && <Badge variant="secondary" className="text-[10px]">{parsed.meals}</Badge>}
          {parsed.smoking && (
            <Badge variant="outline" className="text-[10px]">
              {parsed.smoking}
            </Badge>
          )}
          {parsed.extras.guestsMax != null && (
            <Badge variant="outline" className="text-[10px]">Max {parsed.extras.guestsMax} guests</Badge>
          )}
          {parsed.extras.babyCotMax != null && parsed.extras.babyCotMax > 0 && (
            <Badge variant="outline" className="text-[10px]">Cots ≤ {parsed.extras.babyCotMax}</Badge>
          )}
          {parsed.extras.extraBeds != null && parsed.extras.extraBeds > 0 && (
            <Badge variant="outline" className="text-[10px]">{parsed.extras.extraBeds} extra bed(s)</Badge>
          )}
        </div>
      )}

      {showOriginal && (
        <RawToggle raw={trimmed} open={showRaw} onToggle={() => setShowRaw((v) => !v)} />
      )}
    </div>
  );
}

function RawToggle({ raw, open, onToggle }: { raw: string; open: boolean; onToggle: () => void }) {
  // Best-effort readable version of the raw HTML blob.
  const readable = raw
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;039;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? "Hide original PMS note" : "Show original PMS note"}
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-1.5 text-[10px] text-muted-foreground">
          {readable}
        </pre>
      )}
    </div>
  );
}

export default StructuredRoomNote;
