import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import AssistantChat from "@/components/assistant/AssistantChat";
import { cn } from "@/lib/utils";

/** Full-page view of the assistant. Every thread has its own URL. */
export default function AssistantPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { threads, createThread, deleteThread } = useAssistant(threadId ?? null);
  const base = `/${profile?.organization_slug}/assistant`;

  useEffect(() => {
    document.title = "Hotel Care Assistant";
  }, []);

  const newThread = async () => {
    const id = await createThread();
    if (id) navigate(`${base}/${id}`);
    return id;
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Hotel Care Assistant</h1>
          <p className="text-xs text-muted-foreground">Answers stay inside your role and your property.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <Card className="p-2 h-fit space-y-2">
          <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={newThread}>
            <Plus className="h-3.5 w-3.5" /> New chat
          </Button>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {threads.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                  t.id === threadId && "border-primary bg-primary/5",
                )}
              >
                <button className="flex-1 text-left text-sm truncate" onClick={() => navigate(`${base}/${t.id}`)}>
                  {t.title}
                </button>
                <button
                  aria-label="Delete chat"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await deleteThread(t.id);
                    if (t.id === threadId) navigate(base);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-3 h-[70vh] flex flex-col min-h-0">
          <AssistantChat threadId={threadId ?? null} onNeedThread={newThread} />
        </Card>
      </div>
    </div>
  );
}
