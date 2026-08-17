import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MessageCircleQuestion, Plus, ShieldQuestion, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import AssistantChat from "./AssistantChat";
import AssistantAccessRequests, { canApproveAssistantAccess } from "./AssistantAccessRequests";
import { cn } from "@/lib/utils";

/**
 * Floating assistant available on every authenticated page. The active thread
 * lives in the URL (?assistant=<threadId>) so a reload restores the conversation.
 */
export default function AssistantLauncher() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const threadId = params.get("assistant");
  const { threads, createThread, deleteThread, loadThreads } = useAssistant(threadId);

  useEffect(() => {
    if (threadId) setOpen(true);
  }, [threadId]);

  const setThread = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set("assistant", id);
      else next.delete("assistant");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const newThread = useCallback(async () => {
    const id = await createThread();
    if (id) setThread(id);
    return id;
  }, [createThread, setThread]);

  // Hidden on public/unauthenticated screens.
  if (!user || !profile?.organization_slug) return null;
  if (location.pathname.startsWith("/bb") || location.pathname.startsWith("/auth")) return null;

  const isApprover = canApproveAssistantAccess(profile.role);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed z-40 rounded-full shadow-lg gap-2 h-12 px-4",
          "bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4",
        )}
        aria-label="Open the Hotel Care Assistant"
      >
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">Ask</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-3 flex flex-col gap-2 h-[100dvh] max-h-[100dvh] overflow-hidden
                     pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]
                     duration-300 data-[state=open]:duration-300"
        >
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold">Hotel Care Assistant</p>
                <p className="text-[11px] text-muted-foreground">Ask anything about your work</p>
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <Tabs defaultValue="chat" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">
                Chat
              </TabsTrigger>
              <TabsTrigger value="threads" className="flex-1">
                History
              </TabsTrigger>
              {isApprover && (
                <TabsTrigger value="requests" className="flex-1">
                  Requests
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="chat" className="flex-1 min-h-0 mt-2">
              <AssistantChat threadId={threadId} onNeedThread={newThread} />
            </TabsContent>

            <TabsContent value="threads" className="flex-1 min-h-0 mt-2 overflow-y-auto">
              <div className="space-y-2">
                <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={newThread}>
                  <Plus className="h-3.5 w-3.5" /> New chat
                </Button>
                {threads.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                      t.id === threadId && "border-primary bg-primary/5",
                    )}
                  >
                    <button className="flex-1 text-left text-sm truncate" onClick={() => setThread(t.id)}>
                      {t.title}
                    </button>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete chat"
                      onClick={async () => {
                        await deleteThread(t.id);
                        if (t.id === threadId) setThread(null);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {threads.length === 0 && (
                  <p className="text-sm text-muted-foreground px-1">No conversations yet.</p>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full gap-1.5"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/${profile.organization_slug}/assistant${threadId ? `/${threadId}` : ""}`);
                  }}
                >
                  <MessageCircleQuestion className="h-3.5 w-3.5" /> Open full page
                </Button>
              </div>
            </TabsContent>

            {isApprover && (
              <TabsContent value="requests" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                <div className="flex items-center gap-1.5 px-1 pb-1 text-xs text-muted-foreground">
                  <ShieldQuestion className="h-3.5 w-3.5" /> Temporary access requests from your team
                </div>
                <AssistantAccessRequests />
                <Button size="sm" variant="ghost" className="w-full mt-2" onClick={loadThreads}>
                  Refresh
                </Button>
              </TabsContent>
            )}
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
