import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import AssistantChat from "@/components/assistant/AssistantChat";
import ReportProblemDialog from "@/components/assistant/ReportProblemDialog";
import { canUseAssistant } from "@/lib/assistantAccess";
import {
  forgetActiveAssistantThread,
  getRememberedAssistantThread,
  rememberActiveAssistantThread,
} from "@/lib/assistant/activeThread";
import { cn } from "@/lib/utils";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

/** Full-page view of the assistant. Every thread has its own URL. */
export default function AssistantPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { threads, loadingThreads, createThread, renameThread, deleteThread } = useAssistant(threadId ?? null);
  const [reportOpen, setReportOpen] = useState(false);
  const base = `/${profile?.organization_slug}/assistant`;
  const userId = user?.id ?? null;
  const organizationSlug = profile?.organization_slug ?? null;

  useEffect(() => {
    document.title = "Hotel Care Assistant";
  }, []);

  useEffect(() => {
    if (!userId || !organizationSlug) return;
    if (threadId) {
      rememberActiveAssistantThread(userId, organizationSlug, threadId);
      return;
    }
    const remembered = getRememberedAssistantThread(userId, organizationSlug);
    if (remembered) navigate(`${base}/${remembered}`, { replace: true });
  }, [base, navigate, organizationSlug, threadId, userId]);

  // Controlled rollout: admins plus enabled pilot users.
  const allowed = canUseAssistant(profile);
  useEffect(() => {
    if (profile && !allowed) navigate(`/${profile.organization_slug ?? ""}`, { replace: true });
  }, [profile, allowed, navigate]);
  if (!allowed) return null;

  const newThread = async () => {
    const id = await createThread();
    if (id) {
      rememberActiveAssistantThread(userId, organizationSlug, id);
      navigate(`${base}/${id}`);
    }
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
        <Button size="sm" variant="ghost" className="ml-auto gap-1.5" onClick={() => setReportOpen(true)}>
          <Flag className="h-3.5 w-3.5" /> Report a problem
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <Card className="hidden p-2 h-fit space-y-2 md:block">
          <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={newThread}>
            <Plus className="h-3.5 w-3.5" /> New chat
          </Button>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {loadingThreads && threads.length === 0 &&
              [0, 1, 2].map((row) => <Skeleton key={row} className="h-10 w-full rounded-lg" />)}
            {threads.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "flex items-start gap-1.5 rounded-lg border px-2 py-1.5",
                  t.id === threadId && "border-primary bg-primary/5",
                )}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    rememberActiveAssistantThread(userId, organizationSlug, t.id);
                    navigate(`${base}/${t.id}`);
                  }}
                >
                  <span className="block truncate text-sm">{t.title}</span>
                  {t.preview && (
                    <span className="block truncate text-[11px] text-muted-foreground">{t.preview}</span>
                  )}
                </button>
                <button
                  aria-label="Rename chat"
                  className="mt-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    const next = window.prompt("Rename this conversation", t.title);
                    if (next) void renameThread(t.id, next);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Delete chat"
                  className="mt-0.5 text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await deleteThread(t.id);
                    if (t.id === threadId) {
                      forgetActiveAssistantThread(userId, organizationSlug);
                      navigate(base);
                    }
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

      <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} threadId={threadId ?? null} />
    </div>
  );
}
