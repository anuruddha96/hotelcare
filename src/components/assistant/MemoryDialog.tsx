import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, Plus, Trash2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type MemoryFact = { id: string; fact: string; category: string; updated_at: string };

// assistant_user_memory arrives with the Mira v2 migration and is not in the
// generated database types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const memoryTable = () => (supabase as any).from("assistant_user_memory");

/**
 * What Mira remembers about the signed-in person, across hotels and chats.
 * Only the person sees it; they can add a fact, delete one or clear it all.
 */
export default function MemoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, profile } = useAuth();
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await memoryTable()
      .select("id,fact,category,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(60);
    setLoading(false);
    if (error) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setFacts((data ?? []) as MemoryFact[]);
  }, [user]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const remove = async (id?: string) => {
    if (!user) return;
    let query = memoryTable().delete().eq("user_id", user.id);
    if (id) query = query.eq("id", id);
    const { error } = await query;
    if (error) return void toast.error("Could not update Mira's memory");
    setFacts((current) => (id ? current.filter((f) => f.id !== id) : []));
    toast.success(id ? "Removed from Mira's memory" : "Mira's memory is cleared");
  };

  const add = async () => {
    const fact = draft.replace(/\s+/g, " ").trim();
    if (!user || fact.length < 4) return;
    setSaving(true);
    const { data, error } = await memoryTable()
      .insert({ user_id: user.id, organization_slug: profile?.organization_slug ?? null, fact: fact.slice(0, 300), category: "preference", source: "user" })
      .select("id,fact,category,updated_at")
      .single();
    setSaving(false);
    if (error || !data) return void toast.error("Could not save that");
    setFacts((current) => [data as MemoryFact, ...current]);
    setDraft("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4" /> Mira's memory
          </DialogTitle>
          <DialogDescription>
            What Mira remembers about you in every chat and hotel. Mira adds things you tell it to remember; only you can see this list.
          </DialogDescription>
        </DialogHeader>

        {unavailable ? (
          <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">Memory is being switched on. Please check back later.</p>
        ) : (
          <div className="space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="e.g. I mostly work with Hotel Memories checkouts"
                maxLength={300}
                aria-label="Something Mira should remember"
              />
              <Button type="submit" variant="secondary" disabled={saving || draft.trim().length < 4} className="shrink-0 gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
              </Button>
            </form>

            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {loading && facts.length === 0 && (
                <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </p>
              )}
              {!loading && facts.length === 0 && (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  Nothing yet. Tell Mira "remember that …" in any chat, or add something here.
                </p>
              )}
              {facts.map((fact) => (
                <div key={fact.id} className="group flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">{fact.fact}</span>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label={`Forget: ${fact.fact}`}
                    onClick={() => void remove(fact.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={!facts.length || unavailable} onClick={() => void remove()}>
            Clear all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
