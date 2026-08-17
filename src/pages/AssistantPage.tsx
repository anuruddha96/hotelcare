import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import AssistantChat from "@/components/assistant/AssistantChat";
import { cn } from "@/lib/utils";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

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

  // Not launched yet: admins only.
  const isAdmin = profile?.role === "admin";
  useEffect(() => {
    if (profile && !isAdmin) navigate(`/${profile.organization_slug ?? ""}`, { replace: true });
  }, [profile, isAdmin, navigate]);
  if (!isAdmin) return null;

  const newThread = async () => {
    const id = await createThread();
    if (id) navigate(`${base}/${id}`);
    return id;
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-[100dvh]">
      <div className="flex items-center gap-2 mb-4">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Back"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/${profile?.organization_slug}`))}
        >
          <ArrowLeft />
        </Button>
        <img src={hotelCareMark} alt="Hotel Care" className="h-9 w-9 rounded-lg" />
        <div>
          <h1 className="text-lg font-semibold leading-tight">Hotel Care Assistant</h1>
          <p className="text-xs text-muted-foreground">Answers stay inside your role and your property.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <Card className="hidden p-2 h-fit space-y-2 md:block">
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

        <Card className="p-3 h-[calc(100dvh-8rem)] min-h-[32rem] flex flex-col min-h-0">
          <AssistantChat threadId={threadId ?? null} onNeedThread={newThread} />
        </Card>
      </div>
    </div>
  );
}
